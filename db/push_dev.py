#!/usr/bin/env python3
"""
push_dev.py — send the Pi's database up to staging

    python3 db/push_dev.py            # dry run: show what would go, change nothing
    python3 db/push_dev.py --apply    # replace staging's contents with dev's

THE OTHER HALF OF db/pull_staging.py. That one brings staging down so dev
matches after you have been editing on the live-ish site; this one sends dev up
after you have built something locally that staging should now have. Between
them either machine can be the one you worked on.

THEY ARE NOT A MERGE, AND MUST NOT BE MISTAKEN FOR ONE
-----------------------------------------------------------------------------
Each direction REPLACES the target. Whichever way you run it, the other side's
rows are gone — there is no reconciliation, because there is no honest answer
to "this partner was edited in both places". So the rule to hold in your head
is: decide where the work happened, push that way, once. Running both
directions in a session means the second one undoes the first.

WHY THE TARGET IS PINNED TO STAGING
-----------------------------------------------------------------------------
Production is not a valid destination for this and never will be. It holds the
only records that are real, and a script whose whole job is "replace
everything over there" must not be able to point at them — not by a flag, not
by a typo. The database name is a constant below, and there is no argument to
change it.

WHAT IT REFUSES TO SEND
-----------------------------------------------------------------------------
Other people's addresses. next.thauma.one is on the public internet behind
Access; the Pi is not. Seed data is invented and safe to publish there, but if
real supporters have found their way into the dev database, sending them
somewhere more exposed is the wrong direction of travel. So subscribers,
contacts and mailing_recipients are checked and the push stops if they hold
anything that is not obviously fake.
"""
import argparse
import importlib.util
import pathlib
import re
import sqlite3
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAGING = "thauma-ops-dev"          # NOT configurable — see the note above.

# Shared with pull_staging so the two directions cannot drift on which tables
# are copied or in what order.
_spec = importlib.util.spec_from_file_location(
    "pull_staging", str(pathlib.Path(__file__).resolve().parent / "pull_staging.py"))
_pull = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pull)
SKIP_TABLES, load_order, local_db_path, copyable_tables = (
    _pull.SKIP_TABLES, _pull.load_order, _pull.local_db_path, _pull.copyable_tables)

# Where somebody else's address can be, and what a safe one looks like.
ADDRESS_TABLES = {"subscribers": "email", "contacts": "email",
                  "mailing_recipients": "email"}


def invented(address):
    """Is this address obviously not a real person's?

    A function rather than a regex because the first version was a regex that
    allowed example.com/org/net and refused example.hr — which is seed data for
    the Croatian partner and exactly as invented as the rest. A guard that
    cries wolf on its own fixtures gets switched off.

    RFC 2606 reserves .invalid, .test, .example and the example.* domains for
    precisely this. Anything under them is safe to publish anywhere.
    """
    domain = str(address).rsplit("@", 1)[-1].strip().lower().rstrip(".")
    labels = domain.split(".")
    # `example` as the SECOND-TO-LAST label, so example.com, example.hr and
    # sub.example.org all count while example.com.evil.net does not — a domain
    # somebody registered to look reserved is not reserved.
    if len(labels) >= 2 and labels[-2] == "example":
        return True
    return (domain.endswith((".invalid", ".test", ".example", ".localhost"))
            or domain in ("localhost", "invalid", "test", "example"))


def d1_file(path):
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", STAGING, "-y", "--remote", "--file", str(path)],
        cwd=ROOT, capture_output=True, text=True, timeout=900)
    if out.returncode != 0:
        raise RuntimeError((out.stdout + out.stderr)[-1500:])
    return out.stdout


def d1_json(sql):
    import json
    out = subprocess.run(
        ["npx", "wrangler", "d1", "execute", STAGING, "--json", "-y", "--remote",
         "--command", sql],
        cwd=ROOT, capture_output=True, text=True, timeout=300)
    m = re.search(r"\[\s*{.*}\s*\]", out.stdout, re.S)
    if not m:
        raise RuntimeError(f"no JSON from wrangler:\n{out.stdout[-400:]}{out.stderr[-400:]}")
    return json.loads(m.group(0))[0].get("results", [])


def lit(v):
    """A SQL literal. Parameters are not available through `d1 execute --file`,
    so values are quoted here — doubling quotes, and sending bytes as a hex
    literal rather than something that would arrive corrupted."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (bytes, bytearray)):
        return "X'" + v.hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"


def build_sql(con, order, counts=None):
    """The whole push as one list of statements. Separate from main() so it can
    be generated and replayed against a scratch database in a test, rather than
    only ever being proved by running it at staging."""
    sql = ["PRAGMA defer_foreign_keys = TRUE;"]
    total = 0
    for t in reversed(order):
        sql.append(f"DELETE FROM {t};")
    for t in order:
        rows = con.execute(f"SELECT * FROM {t}").fetchall()
        if counts is not None:
            print(f"  {t:26}{len(rows):>7}{counts.get(t, 0):>10}")
        total += len(rows)
        for r in rows:
            cols = r.keys()
            sql.append(f"INSERT INTO {t} ({', '.join(cols)}) VALUES "
                       f"({', '.join(lit(r[c]) for c in cols)});")
    return sql, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write to staging")
    args = ap.parse_args()

    con = sqlite3.connect(local_db_path())
    con.row_factory = sqlite3.Row

    # SCHEMA PARITY, both ways. Sending rows into a database missing their
    # columns fails halfway; sending them into one that is AHEAD leaves staging
    # holding a mixture. Either way the deploy that follows is a guess.
    here = {r[0] for r in con.execute("SELECT name FROM schema_migrations")}
    there = {r["name"] for r in d1_json("SELECT name FROM schema_migrations")}
    if here != there:
        only_here, only_there = sorted(here - there), sorted(there - here)
        if only_here:
            print(f"  staging is BEHIND by {len(only_here)}: " + ", ".join(only_here))
            print("  run:  node deploy/migration-state.mjs --database thauma-ops-dev --apply")
        if only_there:
            print(f"  this machine is BEHIND by {len(only_there)}: " + ", ".join(only_there))
        sys.exit("\n  Bring them into step first.")

    tables = copyable_tables(con)
    order = load_order(con, tables)

    # THE ONE THING THAT STOPS THE PUSH. Checked before anything is generated.
    leaks = []
    for t, col in ADDRESS_TABLES.items():
        if t not in tables:
            continue
        for (addr,) in con.execute(
                f"SELECT {col} FROM {t} WHERE {col} IS NOT NULL AND {col} <> ''"):
            if not invented(addr):
                leaks.append((t, addr))
    if leaks:
        print("  REFUSING: the dev database holds addresses that do not look invented.\n")
        for t, a in leaks[:10]:
            print(f"    {t:22} {a[:3]}***{a[a.find('@'):] if '@' in a else ''}")
        if len(leaks) > 10:
            print(f"    … and {len(leaks) - 10} more")
        sys.exit(
            "\n  next.thauma.one is reachable from the internet and this machine is not,\n"
            "  so this would move real people somewhere more exposed. Replace them with\n"
            "  seed data, or scrub them, before pushing.")

    print(f"  from : {local_db_path()}")
    print(f"  to   : {STAGING}\n")
    print(f"  {'table':26}{'dev':>7}{'staging':>10}")
    print("  " + "-" * 43)

    counts = {t: d1_json(f"SELECT COUNT(*) AS n FROM {t}")[0]["n"] for t in order}
    sql, total = build_sql(con, order, counts)

    if not args.apply:
        print(f"\n  DRY RUN — nothing written. {total} rows would REPLACE staging's.")
        print(f"  {len(sql)} statements would be sent as one file.")
        print("\n  Re-run with --apply to do it.")
        return

    print(f"\n  This REPLACES every row in {STAGING} with this machine's.")
    print("  Anything edited on staging and not here is lost.")
    if input("  Type 'push to staging' to continue: ").strip() != "push to staging":
        sys.exit("  aborted")

    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False) as fh:
        fh.write("\n".join(sql) + "\n")
        path = fh.name
    # ONE call, not one per row. A row-at-a-time push is a few hundred round
    # trips to Cloudflare and leaves staging half-replaced if it stops.
    print(f"\n  sending {total} rows in one file…")
    d1_file(path)
    pathlib.Path(path).unlink()

    after = d1_json("SELECT COUNT(*) AS n FROM users")[0]["n"]
    print(f"  done. staging now reports {after} users.")


if __name__ == "__main__":
    main()
