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



# ---------------------------------------------------------------------------
# THE QUERIES THEMSELVES, RUN AGAINST REAL ROWS.
#
# Everything else here tests the SCHEMA. These test db/queries.sql, and they
# exist because of a bug nothing else could see: the subscriber list came back
# empty while the counts above it were correct.
#
# The cause was a parameter bound as NULL instead of "". The SQL asks
# `:status = ''` to mean "no filter", and in SQLite `NULL = ''` is not FALSE —
# it is NULL, so the whole OR collapses and every row fails the test. Reading
# the SQL, it looks right. Substituting values into it by hand, it works.
# Only binding the values the Worker actually binds shows it.
# ---------------------------------------------------------------------------

def _query(name):
    """One named query out of db/queries.sql, comments stripped, ready to bind."""
    import re
    text = (HERE / "queries.sql").read_text()
    m = re.search(r"-- name: %s\n((?:(?!-- name:)[\s\S])*)" % re.escape(name), text)
    assert m, f"no query named {name}"
    sql = re.sub(r"^\s*--.*$", "", m.group(1), flags=re.M).strip().rstrip(";")
    names = re.findall(r":(\w+)", sql)
    return re.sub(r":(\w+)", "?", sql), names


def _run(db, name, **args):
    sql, names = _query(name)
    missing = [n for n in names if n not in args]
    assert not missing, f"{name} needs {sorted(set(missing))}"
    return db.execute(sql, [args[n] for n in names]).fetchall()


def _people(db):
    """A list with five people on it, in three states."""
    _list(db, "l1", "p_chase")
    rows = [("s1", "zoe@x.invalid", "Zoe", "subscribed", "2026-01-01"),
            ("s2", "adam@x.invalid", "Adam", "pending", "2026-06-01"),
            ("s3", "mia@x.invalid", None, "bounced", "2026-03-01"),
            ("s4", "bob@x.invalid", "Bob 50%off", "subscribed", "2026-09-01"),
            ("s5", "u@x.invalid", "A_B", "unsubscribed", "2026-02-01")]
    for sid, email, name, status, at in rows:
        db.execute(
            "INSERT INTO subscribers (id,list_id,partner_id,email,name,status,"
            "subscribed_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (sid, "l1", "p_chase", email, name, status, at, at))
    return db


def t_an_absent_filter_must_be_an_empty_string_not_null():
    db = _people(fresh())
    base = dict(list_id="l1", partner_id="p_chase", limit=50, offset=0)

    empty = _run(db, "subscribers_for_list", status="", q="", like="", sort="", tag="", **base)
    assert len(empty) == 5, f"an unfiltered list should show everyone, got {len(empty)}"

    # What a NULL does, so nobody restores it thinking it is equivalent.
    nulls = _run(db, "subscribers_for_list",
                 status=None, q=None, like=None, sort=None, tag="", **base)
    assert len(nulls) == 0, (
        "NULL happens to return rows here, which means this test would no longer "
        "catch the bug it was written for")


def t_the_count_agrees_with_the_list_it_counts():
    db = _people(fresh())
    for status, q, like in [("", "", ""), ("subscribed", "", ""), ("", "o", "%o%")]:
        rows = _run(db, "subscribers_for_list", status=status, q=q, like=like,
                    sort="", tag="", list_id="l1", partner_id="p_chase", limit=50, offset=0)
        n = _run(db, "subscribers_for_list_count", status=status, q=q, like=like,
                 tag="", list_id="l1", partner_id="p_chase")[0][0]
        assert n == len(rows), (
            f"status={status!r} q={q!r}: the count says {n}, the list has {len(rows)}")


def t_every_sort_orders_by_what_it_says():
    db = _people(fresh())
    def emails(sort):
        return [r[1] for r in _run(db, "subscribers_for_list", sort=sort, status="",
                                   q="", like="", tag="", list_id="l1", partner_id="p_chase",
                                   limit=50, offset=0)]
    assert emails("")[0] == "bob@x.invalid", "the default is newest first"
    assert emails("oldest")[0] == "zoe@x.invalid", "oldest first"
    assert emails("email") == sorted(emails("email")), "by address"
    # A missing name falls back to the ADDRESS, so nobody sorts to the top as a
    # blank. mia has no name and lands under "mia@x.invalid", between Bob and
    # Zoe, exactly where a reader would look for her.
    by_name = emails("name")
    assert by_name == ["u@x.invalid",     # A_B
                       "adam@x.invalid",  # Adam
                       "bob@x.invalid",   # Bob 50%off
                       "mia@x.invalid",   # no name — sorted by address
                       "zoe@x.invalid"], f"by name: {by_name}"
    # An unrecognised sort must not be an error, and must not be a hole.
    assert emails("; DROP TABLE subscribers --") == emails(""), \
        "an unknown sort should fall through to the default"


def t_a_literal_percent_in_a_name_is_not_a_wildcard():
    # The Worker escapes % and _ ; the query needs ESCAPE for that to mean
    # anything. Without it the escaping stops the wildcard AND the match.
    db = _people(fresh())
    def search(q):
        like = "%" + q.replace("%", "\\%").replace("_", "\\_") + "%"
        return [r[1] for r in _run(db, "subscribers_for_list", q=q, like=like,
                                   status="", sort="", tag="", list_id="l1",
                                   partner_id="p_chase", limit=50, offset=0)]
    assert search("50%") == ["bob@x.invalid"], f"literal per cent: {search('50%')}"
    assert search("A_B") == ["u@x.invalid"], f"literal underscore: {search('A_B')}"
    assert search("A%B") == [], "a wildcard typed by a person must stay literal"


def t_paging_never_shows_or_skips_a_person():
    db = _people(fresh())
    seen = []
    for page in range(3):
        seen += [r[1] for r in _run(db, "subscribers_for_list", status="", q="",
                                    like="", sort="", tag="", list_id="l1",
                                    partner_id="p_chase", limit=2, offset=page * 2)]
    assert len(seen) == 5, f"paging returned {len(seen)} of 5"
    assert len(set(seen)) == 5, f"somebody appeared on two pages: {seen}"


def t_a_subscriber_list_cannot_be_read_by_id_alone():
    # Knowing a list id must not be enough; the partner is checked on the LIST.
    db = _people(fresh())
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_other','other','Other','active',?,?)", (NOW, NOW))
    rows = _run(db, "subscribers_for_list", status="", q="", like="", sort="", tag="",
                list_id="l1", partner_id="p_other", limit=50, offset=0)
    assert rows == [], "another partner could read this list's subscribers"


def _two_partners(db):
    for pid in ("p_a", "p_b"):
        db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
                   " VALUES (?,?,?,'active',?,?)", (pid, pid, pid, NOW, NOW))
        _list(db, "l_" + pid, pid)
        db.execute("INSERT INTO subscribers (id,list_id,partner_id,email,status,"
                   "subscribed_at,updated_at) VALUES (?,?,?,?,'subscribed',?,?)",
                   ("s_" + pid, "l_" + pid, pid, pid + "@x.invalid", NOW, NOW))
    return db


def _bulk(db, name, partner, ids, **extra):
    """A bulk query with its IDS placeholder expanded, exactly as db.js does."""
    sql, names = _query(name)
    sql = sql.replace("IDS", ", ".join("?" for _ in ids))
    args = {"partner_id": partner, "now": NOW, **extra}
    return db.execute(sql, [args[n] for n in names] + list(ids))


def t_a_bulk_action_cannot_reach_another_partner():
    # A bulk endpoint is precisely where one borrowed id would do the most
    # damage, so the partner check is inside every one of these statements.
    db = _two_partners(fresh())
    _bulk(db, "subscribers_bulk_delete", "p_a", ["s_p_b"])
    left = [r[0] for r in db.execute("SELECT id FROM subscribers ORDER BY id")]
    assert left == ["s_p_a", "s_p_b"], f"partner A reached B's row: {left}"

    _bulk(db, "subscribers_bulk_delete", "p_a", ["s_p_a"])
    left = [r[0] for r in db.execute("SELECT id FROM subscribers ORDER BY id")]
    assert left == ["s_p_b"], f"partner A could not delete their own: {left}"


def t_bulk_status_cannot_mark_anybody_subscribed():
    """Marking somebody confirmed is a claim they agreed. Made two hundred at a
    time, that is how a list stops being one people opted into — so the bulk
    path only ever REDUCES what may be sent."""
    db = _two_partners(fresh())
    db.execute("UPDATE subscribers SET status='pending' WHERE id='s_p_a'")

    _bulk(db, "subscribers_bulk_status", "p_a", ["s_p_a"], status="unsubscribed")
    got = db.execute("SELECT status, unsubscribed_at FROM subscribers WHERE id='s_p_a'").fetchone()
    assert got[0] == "unsubscribed", f"unsubscribe did not apply: {got}"
    assert got[1] == NOW, "unsubscribing should record when"

    # The statement would technically write it, which is why the WORKER refuses
    # the value — asserted in workers/test/staff-mailing.test.mjs. What this
    # checks is that nothing else in the statement quietly does it.
    assert "'subscribed'" not in _query("subscribers_bulk_status")[0], \
        "the bulk status statement must not name 'subscribed' at all"


def t_bulk_tagging_cannot_borrow_another_partners_tag():
    db = _two_partners(fresh())
    db.execute("INSERT INTO mailing_tags (id,partner_id,name,sort_order,created_at)"
               " VALUES ('t_b','p_b','B tag',0,?)", (NOW,))
    _bulk(db, "subscribers_bulk_tag_add", "p_a", ["s_p_a"], tag_id="t_b")
    n = db.execute("SELECT COUNT(*) FROM subscriber_tags").fetchone()[0]
    assert n == 0, "a tag belonging to another partner was applied"


def t_a_partner_with_no_channel_does_not_break_the_partner_api():
    """`LIMIT (SELECT ...)` is NULL when the partner has no channel row, and
    SQLite rejects LIMIT NULL with "datatype mismatch". That does not fail
    quietly on the videos section — it throws inside partnerPublicSite and
    takes down the WHOLE partner API response for that partner, videos or
    not. Most partners will never set a channel, so this is the common path.

    Found by running the query against the real database rather than reading
    it, which is why it is pinned here."""
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    sql, names = _query("public_videos_for_partner")
    rows = db.execute(sql, ["p_a"] * len(names)).fetchall()
    assert rows == [], f"expected no videos, got {rows}"


def t_videos_are_returned_only_for_a_channel_that_is_switched_on():
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO video_sources (partner_id,source_id,is_public,max_items,"
               "updated_at) VALUES ('p_a','UC0000000000000000000000',0,3,?)", (NOW,))
    db.execute("INSERT INTO videos (source_id,video_id,title,published_at,fetched_at)"
               " VALUES ('UC0000000000000000000000','vvvvvvvvvvv','V',?,?)", (NOW, NOW))

    sql, names = _query("public_videos_for_partner")
    got = db.execute(sql, ["p_a"] * len(names)).fetchall()
    assert got == [], "an unpublished channel's videos reached the public query"

    db.execute("UPDATE video_sources SET is_public = 1")
    got = db.execute(sql, ["p_a"] * len(names)).fetchall()
    assert len(got) == 1, f"a published channel returned {got}"


def t_repointing_a_channel_forgets_when_the_old_one_was_checked():
    """synced_at describes a CHANNEL, not a row. Carrying it across a change of
    channel would show a timestamp belonging to somebody else's videos, and the
    console would say "checked two minutes ago" about a feed never read."""
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    sql, names = _query("video_source_save")

    def save(channel):
        args = {"partner_id": "p_a", "source_id": channel, "source_kind": "channel",
                "source_title": None, "is_public": 1, "max_items": 3, "now": NOW}
        db.execute(sql, [args[n] for n in names])

    save("UC0000000000000000000000")
    db.execute("UPDATE video_sources SET synced_at = 'yesterday'")

    save("UC0000000000000000000000")          # same channel
    got = db.execute("SELECT synced_at FROM video_sources").fetchone()[0]
    assert got == "yesterday", f"re-saving the same channel lost synced_at: {got}"

    save("UC1111111111111111111111")          # a different one
    got = db.execute("SELECT synced_at FROM video_sources").fetchone()[0]
    assert got is None, f"a new channel kept the old channel's timestamp: {got}"


def t_buttons_follow_the_channels_publication_switch():
    """The rail belongs to the video section. A partner who switched videos off
    switched the whole section off — without the join, the buttons would keep
    appearing under nothing."""
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO video_sources (partner_id,source_id,is_public,max_items,"
               "updated_at) VALUES ('p_a','UC0000000000000000000000',0,3,?)", (NOW,))
    db.execute("INSERT INTO video_links (id,partner_id,label,url,sort_order,created_at)"
               " VALUES ('vl_1','p_a','Give','https://x.org',0,?)", (NOW,))

    sql, names = _query("public_video_links_for_partner")
    assert db.execute(sql, ["p_a"] * len(names)).fetchall() == [], \
        "buttons published while the channel was switched off"

    db.execute("UPDATE video_sources SET is_public = 1")
    assert len(db.execute(sql, ["p_a"] * len(names)).fetchall()) == 1, \
        "buttons vanished with the channel switched on"


def t_a_partner_with_no_channel_publishes_no_buttons():
    """Same trap as the LIMIT NULL one above: this runs for EVERY partner on
    every partner-API call, so it has to be correct for the common case of a
    partner who has never touched the video section."""
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    db.execute("INSERT INTO video_links (id,partner_id,label,url,sort_order,created_at)"
               " VALUES ('vl_1','p_a','Give','https://x.org',0,?)", (NOW,))
    sql, names = _query("public_video_links_for_partner")
    assert db.execute(sql, ["p_a"] * len(names)).fetchall() == [], \
        "buttons published with no channel row at all"


def t_one_partners_buttons_are_not_anothers():
    db = fresh()
    for pid in ("p_a", "p_b"):
        db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
                   " VALUES (?,?,?,'active',?,?)", (pid, pid, pid, NOW, NOW))
        db.execute("INSERT INTO video_sources (partner_id,source_id,is_public,"
                   "max_items,updated_at) VALUES (?,'UC0000000000000000000000',1,3,?)",
                   (pid, NOW))
        db.execute("INSERT INTO video_links (id,partner_id,label,url,sort_order,created_at)"
                   " VALUES (?,?,?,'https://x.org',0,?)",
                   ("vl_" + pid, pid, "Give " + pid, NOW))

    sql, names = _query("public_video_links_for_partner")
    got = [r[0] for r in db.execute(sql, ["p_a"] * len(names))]
    assert got == ["Give p_a"], f"partner A saw {got}"


def t_two_buttons_cannot_share_a_label():
    """SQLite treats NULLs as distinct in a UNIQUE index, so the organisation
    would be exempt without the COALESCE — which is exactly the owner most
    likely to accumulate duplicates."""
    db = fresh()
    def add(partner, label):
        db.execute("INSERT INTO video_links (id,partner_id,label,url,sort_order,created_at)"
                   " VALUES (?,?,?,'https://x.org',0,?)",
                   (f"vl_{partner}_{label}", partner, label, NOW))
    add(None, "Give")
    try:
        add(None, "Give")
        raise AssertionError("the organisation was allowed two buttons called Give")
    except sqlite3.IntegrityError:
        pass


def t_a_playlist_is_stored_as_one_and_a_channel_stays_a_channel():
    """The two ids live in DIFFERENT namespaces and the feed takes a different
    query parameter for each, so which kind this is has to be stored rather
    than guessed from the string later."""
    db = fresh()
    db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,updated_at)"
               " VALUES ('p_a','a','A','active',?,?)", (NOW, NOW))
    sql, names = _query("video_source_save")

    def save(kind, sid):
        args = {"partner_id": "p_a", "source_id": sid, "source_kind": kind,
                "source_title": None, "is_public": 1, "max_items": 3, "now": NOW}
        db.execute(sql, [args[n] for n in names])

    save("playlist", "PLryve-LPyY0x5F6-uVcT0K3giNi9dXvaW")
    got = db.execute("SELECT source_kind, source_id FROM video_sources").fetchone()
    assert got == ("playlist", "PLryve-LPyY0x5F6-uVcT0K3giNi9dXvaW"), got

    # Switching a partner from a playlist to a channel must carry the kind
    # across too, or the sync would ask for a playlist that does not exist.
    save("channel", "UCnp-pBzHdpTwMonf7xuN1Ug")
    got = db.execute("SELECT source_kind, source_id, synced_at FROM video_sources").fetchone()
    assert got[:2] == ("channel", "UCnp-pBzHdpTwMonf7xuN1Ug"), got
    assert got[2] is None, "changing source kept the old source's timestamp"


def t_two_partners_may_read_two_playlists_from_one_channel():
    """The shape Thauma is actually built for: one channel, a playlist per
    partner. Videos are keyed by SOURCE, so the two shelves cannot bleed into
    each other even though both playlists live on the same channel."""
    db = fresh()
    for pid, pl in [("p_a", "PLaaaaaaaaaaaaaaaaaaaa"), ("p_b", "PLbbbbbbbbbbbbbbbbbbbb")]:
        db.execute("INSERT INTO partners (id,slug,display_name,status,created_at,"
                   "updated_at) VALUES (?,?,?,'active',?,?)", (pid, pid, pid, NOW, NOW))
        db.execute("INSERT INTO video_sources (partner_id,source_id,source_kind,"
                   "is_public,max_items,updated_at) VALUES (?,?,'playlist',1,3,?)",
                   (pid, pl, NOW))
        db.execute("INSERT INTO videos (source_id,video_id,title,published_at,"
                   "fetched_at) VALUES (?,?,?,?,?)",
                   (pl, "v" + pid, "Video for " + pid, NOW, NOW))

    sql, names = _query("public_videos_for_partner")
    for pid in ("p_a", "p_b"):
        got = [r[1] for r in db.execute(sql, [pid] * len(names))]
        assert got == ["Video for " + pid], f"{pid} saw {got}"


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


# ---------------------------------------------------------------------------
# Mailing — isolation is the product, so it is tested rather than assumed
# ---------------------------------------------------------------------------
# Chase's requirement, in his words: "Mira can't see Chase's lists and vice
# versa." That is a promise about data, and a promise about data belongs in the
# schema where a mistaken query cannot break it — not in a WHERE clause
# somebody has to remember.

def _list(db, lid, partner, slug="newsletter"):
    db.execute(
        "INSERT INTO mailing_lists (id,partner_id,slug,name,from_name,from_email,"
        "created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (lid, partner, slug, "A list", "Sender", "from@thauma.one", NOW, NOW))


def _sub(db, sid, lid, partner, email):
    db.execute(
        "INSERT INTO subscribers (id,list_id,partner_id,email,subscribed_at,updated_at)"
        " VALUES (?,?,?,?,?,?)", (sid, lid, partner, email, NOW, NOW))


def t_a_subscriber_cannot_belong_to_another_partner():
    db = fresh()
    _list(db, "l_chase", "p_chase")
    _sub(db, "s1", "l_chase", "p_chase", "someone@example.com")
    try:
        _sub(db, "s2", "l_chase", "p_sara", "other@example.com")
        raise AssertionError("Sara's partner_id was accepted on Chase's list")
    except sqlite3.IntegrityError:
        pass


def t_the_organisation_list_belongs_to_no_partner():
    db = fresh()
    _list(db, "l_org", None)
    _sub(db, "s_org", "l_org", None, "supporter@example.com")
    try:
        _sub(db, "s_bad", "l_org", "p_chase", "someone@example.com")
        raise AssertionError("a partner claimed a subscriber on the organisation list")
    except sqlite3.IntegrityError:
        pass


def t_the_same_address_cannot_be_added_to_one_list_twice():
    """The bug chaseroush.com's JSON files cannot prevent.

    There, two people subscribing in the same second both read the old file and
    one write wins — the other subscription is gone, with nothing to show it
    ever happened. A unique index makes the second write fail loudly instead."""
    db = fresh()
    _list(db, "l_chase", "p_chase")
    _sub(db, "s1", "l_chase", "p_chase", "same@example.com")
    try:
        _sub(db, "s2", "l_chase", "p_chase", "same@example.com")
        raise AssertionError("the same address was added to one list twice")
    except sqlite3.IntegrityError:
        pass


def t_one_person_may_be_on_two_different_lists():
    db = fresh()
    _list(db, "l_chase", "p_chase")
    _list(db, "l_sara", "p_sara")
    _sub(db, "s1", "l_chase", "p_chase", "same@example.com")
    _sub(db, "s2", "l_sara", "p_sara", "same@example.com")
    n = db.execute("SELECT COUNT(*) FROM subscribers WHERE email='same@example.com'").fetchone()[0]
    assert n == 2, f"expected the address on both lists, got {n}"


def t_two_organisation_lists_cannot_share_a_slug():
    """SQLite treats NULLs as distinct in a UNIQUE constraint, so the index
    coalesces partner_id. Without that, the organisation could have two lists
    both called `newsletter` and no way to tell them apart in a URL."""
    db = fresh()
    _list(db, "l_org", None)
    try:
        _list(db, "l_org2", None)
        raise AssertionError("two organisation lists share a slug")
    except sqlite3.IntegrityError:
        pass


def t_partners_may_each_have_a_list_of_the_same_name():
    db = fresh()
    _list(db, "l_chase", "p_chase")
    _list(db, "l_sara", "p_sara")   # both "newsletter", different partners


def t_deleting_a_list_takes_its_subscribers():
    """A subscription is to a LIST. If the list is gone the consent it was
    given under is gone with it, and keeping the address would be keeping
    something nobody agreed to."""
    db = fresh()
    _list(db, "l_chase", "p_chase")
    _sub(db, "s1", "l_chase", "p_chase", "someone@example.com")
    db.execute("DELETE FROM mailing_lists WHERE id='l_chase'")
    n = db.execute("SELECT COUNT(*) FROM subscribers").fetchone()[0]
    assert n == 0, f"{n} subscriber(s) outlived their list"


def t_communications_is_a_role_and_nonsense_is_not():
    db = fresh()
    db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES (?,?,?)",
               ("u_chase", "communications", NOW))
    try:
        db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES (?,?,?)",
                   ("u_chase", "wizard", NOW))
        raise AssertionError("an invented role was accepted")
    except sqlite3.IntegrityError:
        pass


def t_the_existing_roles_survived_the_rebuild():
    """0015 rebuilds user_roles to widen its CHECK, the same dance 0007 did.
    A rebuild that quietly dropped rows would be silent until somebody lost
    access."""
    db = fresh()
    for role in ("admin", "partner", "staff", "board"):
        db.execute("INSERT INTO user_roles (user_id,role,granted_at) VALUES (?,?,?)",
                   ("u_chase", role, NOW))
    n = db.execute("SELECT COUNT(*) FROM user_roles WHERE user_id='u_chase'").fetchone()[0]
    assert n == 4, f"expected all four legacy roles to still be grantable, got {n}"


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
        ("a subscriber cannot belong to another partner", t_a_subscriber_cannot_belong_to_another_partner),
        ("the organisation list belongs to no partner",  t_the_organisation_list_belongs_to_no_partner),
        ("one address cannot join a list twice",         t_the_same_address_cannot_be_added_to_one_list_twice),
        ("one person may be on two lists",               t_one_person_may_be_on_two_different_lists),
        ("two organisation lists cannot share a slug",   t_two_organisation_lists_cannot_share_a_slug),
        ("partners may reuse each other's list names",   t_partners_may_each_have_a_list_of_the_same_name),
        ("deleting a list takes its subscribers",        t_deleting_a_list_takes_its_subscribers),
        ("communications is a role, nonsense is not",    t_communications_is_a_role_and_nonsense_is_not),
        ("the existing roles survived the rebuild",      t_the_existing_roles_survived_the_rebuild),
        ("an absent filter is '' and never NULL",        t_an_absent_filter_must_be_an_empty_string_not_null),
        ("the count agrees with the list it counts",     t_the_count_agrees_with_the_list_it_counts),
        ("every sort orders by what it says",            t_every_sort_orders_by_what_it_says),
        ("a literal % in a name is not a wildcard",      t_a_literal_percent_in_a_name_is_not_a_wildcard),
        ("paging never shows or skips a person",         t_paging_never_shows_or_skips_a_person),
        ("a list cannot be read by id alone",            t_a_subscriber_list_cannot_be_read_by_id_alone),
        ("a bulk action cannot reach another partner",   t_a_bulk_action_cannot_reach_another_partner),
        ("no channel does not break the partner API",    t_a_partner_with_no_channel_does_not_break_the_partner_api),
        ("videos need the channel switched on",          t_videos_are_returned_only_for_a_channel_that_is_switched_on),
        ("repointing a channel forgets the old check",   t_repointing_a_channel_forgets_when_the_old_one_was_checked),
        ("a playlist is stored as a playlist",            t_a_playlist_is_stored_as_one_and_a_channel_stays_a_channel),
        ("one channel, a playlist per partner",           t_two_partners_may_read_two_playlists_from_one_channel),
        ("buttons follow the channel's switch",          t_buttons_follow_the_channels_publication_switch),
        ("no channel publishes no buttons",              t_a_partner_with_no_channel_publishes_no_buttons),
        ("one partner's buttons are not another's",      t_one_partners_buttons_are_not_anothers),
        ("two buttons cannot share a label",             t_two_buttons_cannot_share_a_label),
        ("bulk status cannot mark anybody subscribed",   t_bulk_status_cannot_mark_anybody_subscribed),
        ("bulk tagging cannot borrow another's tag",     t_bulk_tagging_cannot_borrow_another_partners_tag),
    ]:
        check(name, fn)
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
