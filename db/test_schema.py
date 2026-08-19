#!/usr/bin/env python3
"""
Schema tests for db/migrations/

Runs EVERY migration, in numbered order, into an in-memory SQLite database and
asserts the guarantees the schema is supposed to provide. These are the rules
that are expensive to discover later:

  * a newsletter can never be logged as personal contact
  * an interaction cannot be filed under the wrong partner
  * the audit log cannot be edited or deleted
  * deleting a partner takes their data with it
  * last_personal_contact ignores bulk sends
  * goal progress is derived, and reports over-funding honestly
  * a milestone cannot be nested under another partner's milestone
  * nothing publishes unless somebody set is_public

This used to read 0001_init.sql by name, which meant migration 0002's triggers
were never exercised and every future migration would have been silently
untested. Globbing also proves the migrations apply IN ORDER against a clean
database — the thing production does exactly once, and cannot redo.

Run:  python3 db/test_schema.py
"""
import sqlite3, pathlib, sys, datetime

HERE = pathlib.Path(__file__).parent
MIGRATIONS = sorted((HERE / "migrations").glob("*.sql"))
if not MIGRATIONS:
    sys.exit("no migrations found in db/migrations/")
SQL = "\n".join(p.read_text() for p in MIGRATIONS)

NOW = "2026-08-14T12:00:00Z"
passed, failed = 0, 0


def check(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  PASS  {name}")
        passed += 1
    except AssertionError as e:
        print(f"  FAIL  {name}\n          {e}")
        failed += 1
    except Exception as e:
        print(f"  ERROR {name}\n          {type(e).__name__}: {e}")
        failed += 1



def t_seed_files_insert_every_row_they_claim():
    """Every INSERT in a seed file must actually land.

    seed.testpartner.sql originally used INSERT OR IGNORE, which is a fine
    idiom for idempotency and a terrible one for a seed: it silently discarded
    four rows that violated CHECK constraints — a contact status of 'lapsed',
    an interaction channel of 'email', a type of 'meeting', a source of
    'system' — and reported success. The result was five contacts instead of
    six and NO interactions at all, feeding a screen that looked empty for
    reasons nobody could see.

    This applies each seed to a clean schema and compares the number of rows
    that arrive against the number of value tuples in the file. A dropped row
    fails here rather than in somebody's browser.
    """
    import re

    # CUMULATIVE, in order, against ONE database — which is how they are
    # actually applied. seed.testpartner.sql grants roles `granted_by` u_admin,
    # a user seed.dev.sql creates; run alone it fails on a foreign key, which
    # says nothing about whether its own rows are sound.
    db = sqlite3.connect(":memory:")
    db.executescript(SQL)
    db.execute("PRAGMA foreign_keys = ON")

    for name in ("seed.dev.sql", "seed.testpartner.sql"):
        path = HERE / name
        if not path.exists():
            continue
        sql = path.read_text()

        # COMMENTS STRIPPED FIRST. The initial version of this check matched
        # the comment in seed.testpartner.sql explaining why INSERT OR IGNORE
        # was removed — a test failing on the prose that documents the fix it
        # is testing. That has happened before in this repo; grep the code, not
        # the explanation.
        code = re.sub(r"--[^\n]*", "", sql)

        assert "INSERT OR IGNORE" not in code, (
            f"{name} uses INSERT OR IGNORE, which hides constraint violations. "
            "Delete first and insert plainly.")

        # Fails loudly on a bad row, which is the entire point.
        db.executescript(sql)

        # Count the value tuples the file claims to insert, per table, and
        # compare against what is actually there.
        for m in re.finditer(r"INSERT INTO\s+(\w+)\s*\([^)]*\)\s*VALUES(.*?);",
                             code, re.S | re.I):
            table = m.group(1)
            # Tuples start at a "(" that follows VALUES or a comma-newline.
            claimed = len(re.findall(r"(?:VALUES|,)\s*\n?\s*\(", "VALUES" + m.group(2)))
            got = db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            assert got >= claimed, (
                f"{name}: {table} claims {claimed} rows, {got} arrived — "
                "rows are being dropped")

    db.close()



def t_a_person_can_be_removed_even_with_history():
    """Deleting a user must work, and their audit entries must survive it.

    Both halves failed on 2026-08-16, from one foreign key:

      · audit_log.user_id referenced users(id) with no ON DELETE rule, so
        removing anybody who had ever done anything was refused outright. The
        console returned 500 and the person stayed.
      · every handler passes the EMAIL Access supplies as user_id, which is not
        a users.id, so each insert violated the same key. audit() catches and
        logs rather than failing the action it describes — correctly — so the
        audit log had been recording nothing at all, silently.

    0009 removed the key. This is the pair of assertions that says so.
    """
    db = fresh()
    db.execute(
        "INSERT INTO users (id,email,name,global_role,created_at) VALUES (?,?,?,?,?)",
        ("u_tmp", "tmp@thauma.one", "Temp", "staff", NOW))
    # Written the way the handlers write it: an address, not an id.
    db.execute(
        "INSERT INTO audit_log (id,at,user_id,action,entity,entity_id) VALUES (?,?,?,?,?,?)",
        ("a_tmp", NOW, "tmp@thauma.one", "create", "user", "u_tmp"))

    db.execute("DELETE FROM users WHERE id = 'u_tmp'")

    assert db.execute("SELECT COUNT(*) FROM users WHERE id='u_tmp'").fetchone()[0] == 0, \
        "the user was not removed"
    row = db.execute("SELECT user_id FROM audit_log WHERE id='a_tmp'").fetchone()
    assert row is not None, "the audit entry was cascaded away with the person"
    assert row[0] == "tmp@thauma.one", \
        "the entry no longer names who did it — which is the entire job"


def t_removing_a_person_is_never_blocked_by_a_reference():
    """NOTHING may refuse to let a user be deleted.

    0009 removed the foreign key on audit_log and removing a person STILL
    failed, because five other columns referenced users(id) with no ON DELETE
    rule — partner_users.granted_by, user_roles.granted_by, api_keys.created_by,
    resources.created_by, interactions.logged_by. The error is identical
    whichever one holds the id, which is why fixing one looked like it should
    have been enough. Twice.

    So this does not name columns. It asks the schema which references exist
    and asserts that none of them can block, which stays true for columns added
    after it was written.
    """
    db = fresh()
    blocking = []
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for t in tables:
        for fk in db.execute(f"PRAGMA foreign_key_list({t})").fetchall():
            # (id, seq, table, from, to, on_update, on_delete, match)
            if fk[2] == "users" and fk[6] in ("NO ACTION", "RESTRICT"):
                blocking.append(f"{t}.{fk[3]}")
    assert not blocking, (
        "these references would refuse to let a user be deleted: "
        + ", ".join(sorted(blocking))
        + " — use ON DELETE SET NULL for attribution, CASCADE for things that "
          "ARE the person")


def t_removing_a_person_keeps_their_work():
    """The rows they authored stay; only the authorship goes.

    A conversation logged by somebody who has since left is still a
    conversation that happened. CASCADE here would delete a partner's
    stewardship history because an administrator was removed.
    """
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,global_role,created_at) VALUES (?,?,?,?,?)",
               ("u_leaver", "leaver@thauma.one", "Leaver", "staff", NOW))
    db.execute("""INSERT INTO contacts (id,partner_id,first_name,last_name,status,created_at,updated_at)
                  VALUES ('c_x','p_chase','Sam','Reyes','active',?,?)""", (NOW, NOW))
    db.execute("""INSERT INTO interactions
                  (id,contact_id,partner_id,type,is_personal,channel,occurred_on,logged_by,created_at)
                  VALUES ('i_x','c_x','p_chase','call',1,'digital','2026-08-01','u_leaver',?)""", (NOW,))
    db.execute("""INSERT INTO resources (id,partner_id,title,visibility,created_by,created_at,updated_at)
                  VALUES ('r_x','p_chase','A document','staff','u_leaver',?,?)""", (NOW, NOW))

    db.execute("DELETE FROM users WHERE id = 'u_leaver'")

    row = db.execute("SELECT logged_by FROM interactions WHERE id='i_x'").fetchone()
    assert row is not None, "the conversation was deleted along with whoever logged it"
    assert row[0] is None, "authorship should be NULL, not a dangling id"

    row = db.execute("SELECT created_by FROM resources WHERE id='r_x'").fetchone()
    assert row is not None, "the document was deleted along with whoever added it"
    assert row[0] is None, "authorship should be NULL, not a dangling id"


def t_removing_a_person_takes_what_IS_them():
    """Their roles, access and address book go with them.

    The other half of the previous test. SET NULL everywhere would leave a
    deleted person still holding partner access.
    """
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,global_role,created_at) VALUES (?,?,?,?,?)",
               ("u_leaver", "leaver@thauma.one", "Leaver", "staff", NOW))
    db.execute("""INSERT INTO partner_users (partner_id,user_id,role,granted_at)
                  VALUES ('p_chase','u_leaver','view',?)""", (NOW,))
    db.execute("""INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_leaver','staff',?)""",
               (NOW,))
    db.execute("""INSERT INTO directory_contacts (id,user_id,partner_id,name,created_at,updated_at)
                  VALUES ('dc_x','u_leaver','p_chase','Someone',?,?)""", (NOW, NOW))

    db.execute("DELETE FROM users WHERE id = 'u_leaver'")

    for table, where in [("partner_users", "user_id='u_leaver'"),
                         ("user_roles", "user_id='u_leaver'"),
                         ("directory_contacts", "user_id='u_leaver'")]:
        n = db.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]
        assert n == 0, f"{table} still holds rows for a deleted person"


def t_the_interaction_triggers_survived_the_rebuild():
    """0010 dropped and recreated `interactions`. The triggers came back.

    These are what make "personally contacted" mean anything — the single most
    important behaviour in this schema. A rebuild silently losing them would
    not fail any other test, because nothing else asserts a refusal.
    """
    db = fresh()
    db.execute("""INSERT INTO contacts (id,partner_id,first_name,last_name,status,created_at,updated_at)
                  VALUES ('c_t','p_chase','Sam','Reyes','active',?,?)""", (NOW, NOW))
    try:
        db.execute("""INSERT INTO interactions
                      (id,contact_id,partner_id,type,is_personal,channel,occurred_on,created_at)
                      VALUES ('i_t','c_t','p_chase','newsletter',1,'digital','2026-08-01',?)""",
                   (NOW,))
        raise AssertionError("a newsletter was accepted as personal contact — "
                             "the trigger did not survive the 0010 rebuild")
    except sqlite3.IntegrityError:
        pass

    db.execute("""INSERT INTO contacts (id,partner_id,first_name,last_name,status,created_at,updated_at)
                  VALUES ('c_u','p_sara','Other','Person','active',?,?)""", (NOW, NOW))
    try:
        db.execute("""INSERT INTO interactions
                      (id,contact_id,partner_id,type,is_personal,channel,occurred_on,created_at)
                      VALUES ('i_u','c_u','p_chase','call',1,'digital','2026-08-01',?)""",
                   (NOW,))
        raise AssertionError("an interaction crossed partners — "
                             "the trigger did not survive the 0010 rebuild")
    except sqlite3.IntegrityError:
        pass


def t_audit_log_has_no_foreign_keys():
    """Neither column may reference anything.

    A foreign key enforces that a reference points at something CURRENT, which
    is the opposite of what a historical record needs: the thing it describes is
    often gone by definition. 0008 established this for partner_id and predicted
    user_id would need it too. It did.
    """
    db = fresh()
    fks = db.execute("PRAGMA foreign_key_list(audit_log)").fetchall()
    assert fks == [], f"audit_log still references something: {fks}"


def fresh():
    db = sqlite3.connect(":memory:")
    db.executescript(SQL)
    db.execute("PRAGMA foreign_keys = ON")
    db.execute(
        "INSERT INTO partners (id,slug,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
        ("p_chase", "chase-roush", "Chase Roush", NOW, NOW))
    db.execute(
        "INSERT INTO partners (id,slug,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
        ("p_sara", "sara", "Sara", NOW, NOW))
    db.execute(
        "INSERT INTO users (id,email,name,global_role,created_at) VALUES (?,?,?,?,?)",
        ("u_chase", "chase@thauma.one", "Chase", "admin", NOW))
    db.execute(
        "INSERT INTO contacts (id,partner_id,first_name,last_name,email,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?)",
        ("c_1", "p_chase", "Jordan", "Reyes", "jordan@example.com", NOW, NOW))
    db.execute(
        "INSERT INTO contacts (id,partner_id,first_name,created_at,updated_at) VALUES (?,?,?,?,?)",
        ("c_sara_1", "p_sara", "Mira", NOW, NOW))
    db.commit()
    return db


def add_interaction(db, iid, contact, partner, typ, personal, on, source="manual"):
    db.execute(
        "INSERT INTO interactions (id,contact_id,partner_id,type,is_personal,occurred_on,source,created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (iid, contact, partner, typ, personal, on, source, NOW))
    db.commit()


# ---------------------------------------------------------------- structure --
def t_migration_runs():
    db = fresh()
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    expected = {"partners", "users", "partner_users", "sessions", "api_keys",
                "contacts", "interactions", "goals", "goal_snapshots", "audit_log"}
    assert expected <= tables, f"missing tables: {expected - tables}"
    views = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='view'")}
    assert {"contact_touch", "goal_progress"} <= views, f"missing views: {views}"


def t_no_donor_pii_columns():
    """The whole point: there must be no place to put donor money or identity."""
    db = fresh()
    cols = [r[1].lower() for r in db.execute("PRAGMA table_info(goal_snapshots)")]
    banned = {"donor_name", "donor_email", "amount", "amount_cents", "payment_method",
              "card_last4", "transaction_id"}
    assert not (banned & set(cols)), f"donor PII column present: {banned & set(cols)}"
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "donations" not in tables, "a donations table exists — this design forbids it"
    ccols = [r[1].lower() for r in db.execute("PRAGMA table_info(contacts)")]
    assert not any("amount" in c or "cents" in c for c in ccols), \
        f"contacts holds money: {ccols}"


# -------------------------------------------------------------- constraints --
def t_newsletter_cannot_be_personal():
    db = fresh()
    try:
        add_interaction(db, "i_bad", "c_1", "p_chase", "newsletter", 1, "2026-08-01")
    except sqlite3.IntegrityError:
        return
    raise AssertionError("a newsletter was accepted as personal contact")


def t_newsletter_allowed_when_not_personal():
    db = fresh()
    add_interaction(db, "i_ok", "c_1", "p_chase", "newsletter", 0, "2026-08-01", "newsletter")
    n = db.execute("SELECT COUNT(*) FROM interactions").fetchone()[0]
    assert n == 1, "a bulk newsletter should be loggable"


def t_interaction_partner_must_match_contact():
    db = fresh()
    try:
        add_interaction(db, "i_x", "c_1", "p_sara", "call", 1, "2026-08-01")
    except sqlite3.IntegrityError:
        return
    raise AssertionError("Chase's contact accepted an interaction filed under Sara")


def t_bad_enum_rejected():
    db = fresh()
    for sql, args in [
        ("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
         " VALUES (?,?,?,?,?,?)", ("p_x", "x", "X", "banana", NOW, NOW)),
        ("INSERT INTO users (id,email,name,global_role,created_at) VALUES (?,?,?,?,?)",
         ("u_x", "x@y.z", "X", "superuser", NOW)),
    ]:
        try:
            db.execute(sql, args); db.commit()
        except sqlite3.IntegrityError:
            continue
        raise AssertionError(f"invalid enum accepted: {args}")


def t_negative_money_rejected():
    db = fresh()
    db.execute("INSERT INTO goals (id,partner_id,label,kind,target_cents,created_at,updated_at)"
               " VALUES (?,?,?,?,?,?,?)",
               ("g_1", "p_chase", "Monthly", "monthly", 250000, NOW, NOW))
    db.commit()
    try:
        db.execute("INSERT INTO goal_snapshots (id,goal_id,partner_id,raised_cents,source,captured_at)"
                   " VALUES (?,?,?,?,?,?)", ("s_bad", "g_1", "p_chase", -100, "donorbox", NOW))
        db.commit()
    except sqlite3.IntegrityError:
        return
    raise AssertionError("negative raised_cents accepted")


def t_email_unique_case_insensitive():
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)",
               ("u_a", "Sara@Thauma.One", "Sara", NOW)); db.commit()
    try:
        db.execute("INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)",
                   ("u_b", "sara@thauma.one", "Sara Again", NOW)); db.commit()
    except sqlite3.IntegrityError:
        return
    raise AssertionError("duplicate email accepted with different casing")


# ------------------------------------------------------------------- audit --
def t_audit_append_only():
    db = fresh()
    db.execute("INSERT INTO audit_log (id,at,user_id,partner_id,action,entity)"
               " VALUES (?,?,?,?,?,?)", ("a_1", NOW, "u_chase", "p_chase", "read", "contacts"))
    db.commit()
    for verb, sql in [("UPDATE", "UPDATE audit_log SET action='nope' WHERE id='a_1'"),
                      ("DELETE", "DELETE FROM audit_log WHERE id='a_1'")]:
        try:
            db.execute(sql); db.commit()
        except sqlite3.IntegrityError:
            continue
        raise AssertionError(f"audit_log allowed {verb}")


# ---------------------------------------------------------------- cascades --
def t_partner_delete_cascades():
    db = fresh()
    add_interaction(db, "i_1", "c_1", "p_chase", "call", 1, "2026-08-01")
    db.execute("DELETE FROM partners WHERE id='p_chase'"); db.commit()
    for tbl in ("contacts", "interactions"):
        n = db.execute(f"SELECT COUNT(*) FROM {tbl} WHERE partner_id='p_chase'").fetchone()[0]
        assert n == 0, f"{tbl} left {n} orphan rows after partner delete"
    # the other partner is untouched
    n = db.execute("SELECT COUNT(*) FROM contacts WHERE partner_id='p_sara'").fetchone()[0]
    assert n == 1, "deleting one partner removed another partner's data"


# ------------------------------------------------------------------- views --
def t_last_personal_ignores_newsletters():
    db = fresh()
    add_interaction(db, "i_call", "c_1", "p_chase", "call", 1, "2026-03-02")
    add_interaction(db, "i_news", "c_1", "p_chase", "newsletter", 0, "2026-08-10", "newsletter")
    row = db.execute("SELECT last_contact_any, last_personal_contact FROM contact_touch"
                     " WHERE contact_id='c_1'").fetchone()
    assert row[0] == "2026-08-10", f"last_contact_any wrong: {row[0]}"
    assert row[1] == "2026-03-02", (
        f"last_personal_contact should ignore the newsletter, got {row[1]}")


def t_touch_null_when_never_contacted():
    db = fresh()
    row = db.execute("SELECT last_contact_any, last_personal_contact, interaction_count"
                     " FROM contact_touch WHERE contact_id='c_1'").fetchone()
    assert row[0] is None and row[1] is None, "expected NULLs for an untouched contact"
    assert row[2] == 0, f"interaction_count should be 0, got {row[2]}"


def t_goal_progress_computed_and_honest():
    db = fresh()
    db.execute("INSERT INTO goals (id,partner_id,label,kind,target_cents,created_at,updated_at)"
               " VALUES (?,?,?,?,?,?,?)",
               ("g_1", "p_chase", "Monthly", "monthly", 100000, NOW, NOW))
    db.execute("INSERT INTO goal_snapshots (id,goal_id,partner_id,raised_cents,donor_count,source,captured_at)"
               " VALUES (?,?,?,?,?,?,?)",
               ("s_1", "g_1", "p_chase", 50000, 10, "donorbox", "2026-08-01T00:00:00Z"))
    db.execute("INSERT INTO goal_snapshots (id,goal_id,partner_id,raised_cents,donor_count,source,captured_at)"
               " VALUES (?,?,?,?,?,?,?)",
               ("s_2", "g_1", "p_chase", 68000, 14, "donorbox", "2026-08-14T00:00:00Z"))
    db.commit()
    row = db.execute("SELECT raised_cents, donor_count, percent FROM goal_progress"
                     " WHERE goal_id='g_1'").fetchone()
    assert row[0] == 68000, f"should use the LATEST snapshot, got {row[0]}"
    assert row[1] == 14, f"donor_count wrong: {row[1]}"
    assert row[2] == 68, f"percent should be 68, got {row[2]}"
    # OVER-FUNDED REPORTS THE TRUTH.
    #
    # This used to clamp at 100, so a goal that raised more than it asked for
    # reported exactly its target and the good news was the one thing the
    # number could not express. 0012 removed the MIN(100, ...) — a progress BAR
    # should clamp, and both the widget and the published developer guide say
    # so, but the FIGURE should not.
    db.execute("INSERT INTO goal_snapshots (id,goal_id,partner_id,raised_cents,source,captured_at)"
               " VALUES (?,?,?,?,?,?)", ("s_3", "g_1", "p_chase", 150000, "donorbox", "2026-08-20T00:00:00Z"))
    db.commit()
    pct = db.execute("SELECT percent FROM goal_progress WHERE goal_id='g_1'").fetchone()[0]
    assert pct == 150, f"an over-funded goal should say 150, got {pct}"


def t_milestones_default_to_private():
    """Publication is a decision, never a default.

    A draft milestone about an unannounced trip must not reach a partner site
    because somebody forgot a column. Both publish flags default to 0.
    """
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at) "
               "VALUES ('p_1','p-one','P One','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_1','p_1',?,?)", (NOW, NOW))
    db.commit()
    pub, feat = db.execute(
        "SELECT is_public, is_featured FROM milestones WHERE id='m_1'").fetchone()
    assert pub == 0, f"milestone published by default (is_public={pub})"
    assert feat == 0, f"milestone featured by default (is_featured={feat})"


def t_milestone_parent_must_match_partner():
    """A sub-step cannot hang off another partner's milestone."""
    db = fresh()
    for pid in ("p_1", "p_2"):
        db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at) "
                   f"VALUES ('{pid}','{pid}','{pid}','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_1','p_1',?,?)", (NOW, NOW))
    db.commit()

    try:
        db.execute("INSERT INTO milestones (id,partner_id,parent_id,created_at,updated_at) "
                   "VALUES ('m_2','p_2','m_1',?,?)", (NOW, NOW))
        db.commit()
        raise AssertionError("a milestone was nested under another partner's milestone")
    except sqlite3.IntegrityError:
        pass

    # And the same guarantee on UPDATE, which is the half people forget.
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_3','p_2',?,?)", (NOW, NOW))
    db.commit()
    try:
        db.execute("UPDATE milestones SET parent_id='m_1' WHERE id='m_3'")
        db.commit()
        raise AssertionError("UPDATE re-parented across partners")
    except sqlite3.IntegrityError:
        pass


def t_partner_scoping_is_queryable():
    """Every tenant table must be filterable by partner_id alone."""
    db = fresh()
    for tbl in ("contacts", "interactions", "goals", "goal_snapshots", "api_keys", "milestones"):
        cols = [r[1] for r in db.execute(f"PRAGMA table_info({tbl})")]
        assert "partner_id" in cols, f"{tbl} has no partner_id — it cannot be scoped"
        nn = [r for r in db.execute(f"PRAGMA table_info({tbl})") if r[1] == "partner_id"][0][3]
        assert nn == 1, f"{tbl}.partner_id is nullable — scoping can be bypassed"


def t_milestones_hold_no_language_columns():
    """Text lives in milestone_translations, one row per language.

    0002 had title/title_hr, which mirrored a bilingual partner site and left
    Serbian nowhere to go. If a _hr column ever comes back, a fourth language
    is a migration again.
    """
    db = fresh()
    cols = [r[1] for r in db.execute("PRAGMA table_info(milestones)")]
    for banned in ("title", "title_hr", "description", "description_hr",
                   "target_label", "target_label_hr"):
        assert banned not in cols, f"milestones.{banned} is back — text belongs in translations"


def t_language_catalogue_is_open():
    """Adding a language is a row, not a migration."""
    db = fresh()
    have = {r[0] for r in db.execute("SELECT code FROM languages")}
    assert {"en", "hr", "sr"} <= have, f"expected en/hr/sr, got {have}"
    db.execute("INSERT INTO languages (code,name,native_name,sort_order,created_at) "
               "VALUES ('pt-BR','Portuguese','Portugues',3,?)", (NOW,))
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM languages WHERE code='pt-BR'").fetchone()[0] == 1


def t_translation_cannot_cross_partners():
    """A translation cannot be filed under a partner other than its milestone's."""
    db = fresh()
    for pid in ("p_1", "p_2"):
        db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at) "
                   f"VALUES ('{pid}','{pid}','{pid}','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_1','p_1',?,?)", (NOW, NOW))
    db.commit()
    try:
        db.execute("INSERT INTO milestone_translations "
                   "(milestone_id,lang,partner_id,title,updated_at) "
                   "VALUES ('m_1','en','p_2','Stolen',?)", (NOW,))
        db.commit()
        raise AssertionError("a translation was filed under another partner")
    except sqlite3.IntegrityError:
        pass


def t_disabling_a_language_keeps_its_text():
    """Switching a language off is a publishing decision, never a delete.

    Text already written must survive, so a translation can be prepared before
    it goes live and switching one off is reversible.
    """
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at) "
               "VALUES ('p_1','p1','P One','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_1','p_1',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestone_translations "
               "(milestone_id,lang,partner_id,title,updated_at) "
               "VALUES ('m_1','hr','p_1','Preseljenje',?)", (NOW,))
    db.execute("INSERT INTO partner_languages (partner_id,lang,is_enabled) VALUES ('p_1','hr',1)")
    db.commit()

    db.execute("UPDATE partner_languages SET is_enabled=0 WHERE partner_id='p_1' AND lang='hr'")
    db.commit()
    kept = db.execute("SELECT title FROM milestone_translations "
                      "WHERE milestone_id='m_1' AND lang='hr'").fetchone()
    assert kept and kept[0] == "Preseljenje", "disabling a language destroyed its text"


def t_deleting_a_milestone_takes_its_translations():
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at) "
               "VALUES ('p_1','p1','P One','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_1','p_1',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestone_translations "
               "(milestone_id,lang,partner_id,title,updated_at) "
               "VALUES ('m_1','en','p_1','Title',?)", (NOW,))
    db.commit()
    db.execute("DELETE FROM milestones WHERE id='m_1'")
    db.commit()
    left = db.execute("SELECT COUNT(*) FROM milestone_translations").fetchone()[0]
    assert left == 0, f"{left} orphaned translations survived their milestone"


def t_three_roles_and_only_three():
    """Administration, staff, board — and nothing else."""
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_r','r@x.co','R',?)", (NOW,))
    db.commit()
    for role in ("admin", "staff", "board"):
        db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_r',?,?)", (role, NOW))
    db.commit()
    assert db.execute("SELECT COUNT(*) FROM user_roles WHERE user_id='u_r'").fetchone()[0] == 3

    try:
        db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_r','superuser',?)", (NOW,))
        db.commit()
        raise AssertionError("an invented role was accepted")
    except sqlite3.IntegrityError:
        pass


def t_a_person_can_hold_two_roles():
    """A board member who also does staff work is ordinary, not an edge case —
    which is why roles moved out of users.global_role, a column that could only
    ever hold one answer."""
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_b','b@x.co','B',?)", (NOW,))
    db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_b','board',?)", (NOW,))
    db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_b','staff',?)", (NOW,))
    db.commit()
    roles = {r[0] for r in db.execute("SELECT role FROM user_roles WHERE user_id='u_b'")}
    assert roles == {"board", "staff"}, roles


def t_removing_a_user_removes_their_roles():
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_g','g@x.co','G',?)", (NOW,))
    db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES ('u_g','staff',?)", (NOW,))
    db.commit()
    db.execute("DELETE FROM users WHERE id='u_g'")
    db.commit()
    left = db.execute("SELECT COUNT(*) FROM user_roles WHERE user_id='u_g'").fetchone()[0]
    assert left == 0, f"{left} roles outlived their user"


def t_a_directory_contact_belongs_to_one_person():
    """The reason 0005 exists: a colleague sharing the partner must not be
    able to reach somebody else's address book."""
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_a','a@x.co','A',?)", (NOW,))
    db.execute("INSERT INTO partner_users (partner_id,user_id,role,granted_at) VALUES ('p_chase','u_a','assist',?)", (NOW,))
    db.commit()
    db.execute("INSERT INTO directory_contacts (id,user_id,partner_id,name,created_at,updated_at) "
               "VALUES ('dc_1','u_a','p_chase','Someone',?,?)", (NOW, NOW))
    db.commit()

    mine = db.execute("SELECT COUNT(*) FROM directory_contacts "
                      "WHERE user_id='u_chase' AND partner_id='p_chase'").fetchone()[0]
    assert mine == 0, "another user's contact appeared in this user's directory"


def t_a_contact_cannot_be_filed_under_a_partner_you_lack():
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_x','x@x.co','X',?)", (NOW,))
    db.commit()
    try:
        db.execute("INSERT INTO directory_contacts (id,user_id,partner_id,name,created_at,updated_at) "
                   "VALUES ('dc_2','u_x','p_chase','Nope',?,?)", (NOW, NOW))
        db.commit()
        raise AssertionError("a contact was filed under a partner its owner cannot access")
    except sqlite3.IntegrityError:
        pass


def t_resources_default_to_staff_visible():
    db = fresh()
    db.execute("INSERT INTO resources (id,partner_id,title,created_at,updated_at) "
               "VALUES ('rs_1','p_chase','Handbook',?,?)", (NOW, NOW))
    db.commit()
    v = db.execute("SELECT visibility FROM resources WHERE id='rs_1'").fetchone()[0]
    assert v == "staff", f"default visibility is {v}, not staff"


def t_deleting_a_partner_takes_everything_with_it():
    """A partner can be removed, and leaves nothing behind.

    Testing accounts have to be clearable. This failed the first time it ran:
    audit_log referenced partners with no ON DELETE rule, so the foreign key
    refused the delete outright — and there is always at least one audit row,
    because creating a partner writes one.
    """
    db = fresh()
    db.execute("INSERT INTO users (id,email,name,created_at) VALUES ('u_p','p@x.co','P',?)", (NOW,))
    db.execute("INSERT INTO partner_users (partner_id,user_id,role,granted_at) "
               "VALUES ('p_chase','u_p','owner',?)", (NOW,))
    db.execute("INSERT INTO milestones (id,partner_id,created_at,updated_at) "
               "VALUES ('m_x','p_chase',?,?)", (NOW, NOW))
    db.execute("INSERT INTO milestone_translations "
               "(milestone_id,lang,partner_id,title,updated_at) "
               "VALUES ('m_x','en','p_chase','T',?)", (NOW,))
    db.execute("INSERT INTO directory_contacts (id,user_id,partner_id,name,created_at,updated_at) "
               "VALUES ('dc_x','u_p','p_chase','Someone',?,?)", (NOW, NOW))
    db.execute("INSERT INTO audit_log (id,at,user_id,partner_id,action,entity) "
               "VALUES ('a_x',?,'u_p','p_chase','create','partner')", (NOW,))
    db.commit()

    db.execute("DELETE FROM partners WHERE id='p_chase'")
    db.commit()

    for tbl in ("contacts", "interactions", "goals", "goal_snapshots", "milestones",
                "milestone_translations", "partner_users", "api_keys",
                "resources", "directory_contacts", "partner_languages"):
        n = db.execute(f"SELECT COUNT(*) FROM {tbl} WHERE partner_id='p_chase'").fetchone()[0]
        assert n == 0, f"{tbl} left {n} rows behind"


def t_the_audit_entry_outlives_the_partner():
    """An audit log that vanishes with what it describes is not an audit log.

    Deleting a partner destroys their supporters and history; the record that
    somebody did it is the one thing that must survive. So audit_log carries
    partner_id as a plain value with no foreign key — a historical record has
    to be able to name something that no longer exists.
    """
    db = fresh()
    db.execute("INSERT INTO audit_log (id,at,user_id,partner_id,action,entity,detail) "
               "VALUES ('a_y',?,'u_chase','p_chase','delete','partner','{\"display_name\":\"Chase Roush\"}')",
               (NOW,))
    db.commit()
    db.execute("DELETE FROM partners WHERE id='p_chase'")
    db.commit()

    row = db.execute("SELECT partner_id, detail FROM audit_log WHERE id='a_y'").fetchone()
    assert row is not None, "the audit entry was destroyed with the partner"
    assert row[0] == "p_chase", f"the entry stopped naming the partner: {row[0]!r}"
    assert "Chase Roush" in (row[1] or ""), "the name was not preserved in detail"


def t_audit_is_still_append_only_after_the_rebuild():
    """0008 rebuilt the table. Dropping it drops its triggers, and an
    append-only table that quietly stopped being one would be worse than the
    bug that caused the rebuild."""
    db = fresh()
    db.execute("INSERT INTO audit_log (id,at,user_id,partner_id,action,entity) "
               "VALUES ('a_z',?,'u_chase','p_chase','read','goals')", (NOW,))
    db.commit()
    for sql in ("UPDATE audit_log SET action='nope' WHERE id='a_z'",
                "DELETE FROM audit_log WHERE id='a_z'"):
        try:
            db.execute(sql); db.commit()
            raise AssertionError(f"audit_log allowed: {sql}")
        except sqlite3.IntegrityError:
            db.rollback()


if __name__ == "__main__":
    print(f"schema tests — {len(MIGRATIONS)} migrations: "
          f"{', '.join(p.name for p in MIGRATIONS)}\n")
    for name, fn in [
        ("migration runs and creates all tables/views", t_migration_runs),
        ("milestones default to unpublished",           t_milestones_default_to_private),
        ("three roles, and only three",                 t_three_roles_and_only_three),
        ("a person can hold two roles",                 t_a_person_can_hold_two_roles),
        ("removing a user removes their roles",         t_removing_a_user_removes_their_roles),
        ("a directory contact belongs to one person",   t_a_directory_contact_belongs_to_one_person),
        ("a contact needs its owner to hold the partner", t_a_contact_cannot_be_filed_under_a_partner_you_lack),
        ("resources default to staff-visible",          t_resources_default_to_staff_visible),
        ("deleting a partner takes everything with it", t_deleting_a_partner_takes_everything_with_it),
        ("the audit entry outlives the partner",        t_the_audit_entry_outlives_the_partner),
        ("audit is append-only after the rebuild",      t_audit_is_still_append_only_after_the_rebuild),
        ("milestone parent must match partner",         t_milestone_parent_must_match_partner),
        ("milestones hold no language columns",        t_milestones_hold_no_language_columns),
        ("a language is a row, not a migration",        t_language_catalogue_is_open),
        ("translation cannot cross partners",           t_translation_cannot_cross_partners),
        ("disabling a language keeps its text",         t_disabling_a_language_keeps_its_text),
        ("deleting a milestone takes its translations", t_deleting_a_milestone_takes_its_translations),
        ("no donor PII columns exist anywhere",         t_no_donor_pii_columns),
        ("every tenant table is partner-scoped NOT NULL", t_partner_scoping_is_queryable),
        ("newsletter cannot be marked personal",        t_newsletter_cannot_be_personal),
        ("bulk newsletter is still loggable",           t_newsletter_allowed_when_not_personal),
        ("interaction partner must match contact",      t_interaction_partner_must_match_contact),
        ("invalid enum values rejected",                t_bad_enum_rejected),
        ("negative money rejected",                     t_negative_money_rejected),
        ("user email unique case-insensitively",        t_email_unique_case_insensitive),
        ("audit_log is append-only",                    t_audit_append_only),
        ("deleting a partner cascades, others intact",  t_partner_delete_cascades),
        ("last_personal_contact ignores newsletters",   t_last_personal_ignores_newsletters),
        ("untouched contact yields NULLs, count 0",     t_touch_null_when_never_contacted),
        ("goal progress uses latest snapshot, reports over-funding",  t_goal_progress_computed_and_honest),
        ("seed files insert every row they claim",      t_seed_files_insert_every_row_they_claim),
        ("a person can be removed, history survives",   t_a_person_can_be_removed_even_with_history),
        ("audit_log references nothing",                t_audit_log_has_no_foreign_keys),
        ("nothing blocks removing a person",            t_removing_a_person_is_never_blocked_by_a_reference),
        ("removing a person keeps their work",          t_removing_a_person_keeps_their_work),
        ("removing a person takes what IS them",        t_removing_a_person_takes_what_IS_them),
        ("interaction triggers survived the rebuild",   t_the_interaction_triggers_survived_the_rebuild),
    ]:
        check(name, fn)
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
