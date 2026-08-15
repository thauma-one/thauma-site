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
  * goal progress is derived, and clamps at 100%
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


def t_goal_progress_computed_and_clamped():
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
    # overfunded clamps
    db.execute("INSERT INTO goal_snapshots (id,goal_id,partner_id,raised_cents,source,captured_at)"
               " VALUES (?,?,?,?,?,?)", ("s_3", "g_1", "p_chase", 150000, "donorbox", "2026-08-20T00:00:00Z"))
    db.commit()
    pct = db.execute("SELECT percent FROM goal_progress WHERE goal_id='g_1'").fetchone()[0]
    assert pct == 100, f"overfunded goal should clamp to 100, got {pct}"


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


if __name__ == "__main__":
    print(f"schema tests — {len(MIGRATIONS)} migrations: "
          f"{', '.join(p.name for p in MIGRATIONS)}\n")
    for name, fn in [
        ("migration runs and creates all tables/views", t_migration_runs),
        ("milestones default to unpublished",           t_milestones_default_to_private),
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
        ("goal progress uses latest snapshot, clamps",  t_goal_progress_computed_and_clamped),
    ]:
        check(name, fn)
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
