#!/usr/bin/env python3
"""
pull_staging.py — copy staging's data down onto the Pi, without its people

    python3 db/pull_staging.py            # dry run: compare, change nothing
    python3 db/pull_staging.py --apply    # replace the local database's contents

WHAT THIS IS FOR
-----------------------------------------------------------------------------
dev.thauma.one runs `wrangler dev --local`, so it reads a SQLite FILE on this
machine. next.thauma.one reads D1 `thauma-ops-dev` in Cloudflare. They share a
name in wrangler.toml and are not the same database, which is the single most
confusing thing about this setup.

So a user added on staging is invisible to dev until something carries it
across. Words already cross by themselves — the console commits them to git,
sync-dev.yml merges them, and the Pi's timer pulls them. Rows do not. This is
the missing half, run by hand when you want dev to match.

ONE DIRECTION ONLY, AND DELIBERATELY
-----------------------------------------------------------------------------
Staging down to dev. Never the reverse.

Two writable copies with changes flowing both ways diverge the first time the
same row is touched on both, and there is no honest merge for "Chase edited
this partner in two places". One source of truth and copies downstream is the
only arrangement that stays correct. If dev has something worth keeping, it
belongs in a migration or a seed file, not in a sync.

IT SCRUBS, AND THERE IS NO FLAG TO STOP IT
-----------------------------------------------------------------------------
Staging holds seed data today. It will not always. The moment a real person's
address is in it, copying unscrubbed would create a second record of them on a
machine with looser access that nobody thinks of as production — which is a
GDPR record you are responsible for and would forget you had.

So the scrub is unconditional. There is no --no-scrub, on purpose: the flag
would be added for one good reason and used for a bad one at 1am.

TABLES ARE READ FROM THE SCHEMA, NOT LISTED HERE
-----------------------------------------------------------------------------
db/refresh_dev.py hardcodes nine tables and has silently omitted mailing lists,
subscribers, contact forms and videos ever since they were added — it copies a
fraction of the database and says nothing. This asks SQLite what exists, so a
table added tomorrow is included without anybody remembering to edit a list.
"""
import argparse
import glob
import json
import pathlib
import re
import sqlite3
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAGING = "thauma-ops-dev"

# Columns holding personal data, per table. Kept in step with db/refresh_dev.py
# — if you add one there, add it here.
SCRUB = {
    "contacts": ["first_name", "last_name", "email", "phone",
                 "address_1", "address_2", "city", "postal_code", "notes"],
    "interactions": ["note"],
    # The largest store of other people's addresses in this system. They gave
    # them on the understanding they would be written to; a copy on a
    # development machine is a second place to leak from that nobody agreed to.
    # confirm_token goes too — it is a live credential, not a value to fake.
    "subscribers": ["email", "name", "confirm_token"],
    # Where a message actually WENT, snapshotted at send time so it survives
    # the subscriber changing — which also means it survives the subscriber
    # being scrubbed, unless it is scrubbed as well.
    "mailing_recipients": ["email"],
    "signup_attempts": ["ip_hash"],
}

# Never copied. Bookkeeping that describes the TARGET, not the data.
SKIP_TABLES = {
    "schema_migrations", "_cf_KV", "sqlite_sequence",
    # APPEND-ONLY BY TRIGGER, and rightly so — trg_audit_no_delete refuses the
    # DELETE this script would need. Skipped rather than worked around: an
    # audit log is the record of what happened ON THAT DEPLOYMENT, and
    # overwriting dev's history with staging's would make it a fiction. Each
    # environment keeps its own.
    "audit_log",
    # Somebody's signed-in session on staging. Copying it would hand this
    # machine a live credential for a browser that is not here.
    "sessions",
}


def load_order(con, tables):
    """Tables ordered so a row's parents exist before it does.

    NOT ALPHABETICAL, AND THAT IS THE POINT. Foreign keys are switched off for
    the load, so ordering would not matter for THEM — but the TRIGGERS stay
    live, and several check across tables: mtx_partner_match reads the
    milestone a translation belongs to, subscriber_same_partner reads the list.
    Alphabetically `milestone_translations` sorts before `milestones`, so the
    obvious order fails on the first real dataset.

    Derived from the schema rather than written down, for the same reason the
    table list is: a hardcoded order goes stale exactly like a hardcoded list,
    and silently.
    """
    known = set(tables)
    deps = {}
    for t in tables:
        parents = {r[2] for r in con.execute(f"PRAGMA foreign_key_list({t})")}
        d = {p for p in parents if p in known and p != t}

        # AND THE TABLES ITS TRIGGERS READ, which are not always its foreign
        # keys. `contacts` has no key to `partner_users`, but a trigger checks
        # the owner's access through it — so inserting contacts first fails
        # with "contact owner has no access to that partner". Found by running
        # this, not by reading the schema.
        for (sql,) in con.execute(
                "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name = ?", (t,)):
            for other in known:
                if other != t and re.search(rf"\b{other}\b", sql or ""):
                    d.add(other)

        deps[t] = d

    out, remaining = [], dict(deps)
    while remaining:
        ready = sorted(t for t, d in remaining.items() if not (d - set(out)))
        if not ready:
            # A cycle, or a parent outside this set. Emit what is left in a
            # stable order rather than looping — the foreign key check at the
            # end will report anything this could not satisfy.
            out.extend(sorted(remaining))
            break
        out.extend(ready)
        for t in ready:
            remaining.pop(t)
    return out


def local_db_path():
    hits = [p for p in glob.glob(str(
        ROOT / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite"))
        if "metadata" not in p]
    if not hits:
        sys.exit("No local D1 file. Start `wrangler dev --env dev` once to create it.")
    return hits[0]


def d1(sql):
    """One statement against the REMOTE staging database."""
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", STAGING, "--json", "-y",
         "--remote", "--command", sql],
        cwd=ROOT, capture_output=True, text=True, timeout=300)
    m = re.search(r"\[\s*{.*}\s*\]", out.stdout, re.S)
    if not m:
        raise RuntimeError(
            f"no JSON from wrangler for: {sql[:70]}\n"
            f"{out.stdout[-400:]}{out.stderr[-400:]}")
    return json.loads(m.group(0))[0].get("results", [])


def fake(col, i):
    """Deterministic, so two runs produce the same dev data and diffs stay readable."""
    if col == "first_name":   return ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"][i % 6]
    if col == "last_name":    return ["Doe", "Roe", "Poe", "Loe", "Moe", "Noe"][i % 6]
    if col == "name":         return f"Person {i}"
    if col == "email":        return f"user{i}@example.invalid"
    if col == "phone":        return f"+1 555 01{i % 100:02d}"
    if col == "city":         return "Anytown"
    if col == "notes":        return "[scrubbed] stewardship note"
    if col == "note":         return "[scrubbed] interaction note"
    if col == "ip_hash":      return "0" * 32
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="actually replace the local database's contents")
    args = ap.parse_args()

    path = local_db_path()
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row

    # SCHEMA PARITY FIRST. Copying rows into a database that is missing the
    # columns they came from fails halfway and leaves dev holding a mixture of
    # two databases — worse than either. Checked before anything is read.
    here = {r[0] for r in con.execute("SELECT name FROM schema_migrations")}
    there = {r["name"] for r in d1("SELECT name FROM schema_migrations")}
    if there - here:
        sys.exit(
            f"Staging is ahead of this machine by {len(there - here)} migration(s):\n  "
            + "\n  ".join(sorted(there - here))
            + "\n\nApply them locally first, then re-run.")

    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name")
        if r[0] not in SKIP_TABLES]

    print(f"  local file : {path}")
    print(f"  staging    : {STAGING}\n")
    print(f"  {'table':26}{'staging':>9}{'local':>8}")
    print("  " + "-" * 43)

    remote_rows, total = {}, 0
    for t in tables:
        rows = d1(f"SELECT * FROM {t}")
        remote_rows[t] = rows
        mine = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        total += len(rows)
        mark = "  <- scrubbed" if t in SCRUB and rows else ""
        print(f"  {t:26}{len(rows):>9}{mine:>8}{mark}")

    if not args.apply:
        print(f"\n  DRY RUN — nothing written. {total} rows would be copied.")
        print("  Personal columns replaced on the way in:")
        for t, cols in SCRUB.items():
            print(f"    {t:24} {', '.join(cols)}")
        print("\n  Re-run with --apply to do it.")
        return

    print(f"\n  This REPLACES every row in the local database with staging's.")
    if input("  Type 'pull staging' to continue: ").strip() != "pull staging":
        sys.exit("  aborted")

    # FOREIGN KEYS OFF for the load, which is what lets the tables go in
    # alphabetically instead of in dependency order. A dependency order derived
    # by hand is a list that goes stale exactly like the hardcoded table list
    # this script exists to avoid. Re-enabled and CHECKED afterwards.
    con.execute("PRAGMA foreign_keys = OFF")
    order = load_order(con, tables)
    with con:
        # Deletes go the other way, children first — harmless with foreign keys
        # off, but it keeps the two halves readable as mirror images.
        for t in reversed(order):
            con.execute(f"DELETE FROM {t}")
        for t in order:
            rows = remote_rows[t]
            if not rows:
                continue
            cols = list(rows[0].keys())
            ph = ", ".join("?" for _ in cols)
            stmt = f"INSERT INTO {t} ({', '.join(cols)}) VALUES ({ph})"
            for i, row in enumerate(rows):
                vals = [fake(c, i) if c in SCRUB.get(t, []) else row.get(c) for c in cols]
                con.execute(stmt, vals)
            print(f"  {t:26}{len(rows):>9} rows")
    con.execute("PRAGMA foreign_keys = ON")

    broken = con.execute("PRAGMA foreign_key_check").fetchall()
    if broken:
        print(f"\n  WARNING: {len(broken)} foreign key violation(s) after the load.")
        print("  Staging may hold rows whose parents this machine does not have.")
    else:
        print("\n  Done. Foreign keys check out. Restart dev to pick it up:")
        print("    sudo systemctl restart thauma-dev.service")


if __name__ == "__main__":
    main()
