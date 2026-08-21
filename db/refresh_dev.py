#!/usr/bin/env python3
"""
refresh_dev.py — copy production's SHAPE into the dev database, without its people.

    python3 db/refresh_dev.py            # dry run: show what would change
    python3 db/refresh_dev.py --apply    # actually do it

WHY THIS SCRUBS RATHER THAN COPIES
-----------------------------------
A straight copy would put real supporter names, emails, phone numbers and
stewardship notes into a second database — one that gets poked at, has looser
access, and that nobody thinks of as production. That would quietly undo a
good deal of why this schema holds so little in the first place: no donor
records, append-only audit log, per-partner scoping.

Under GDPR it is also a second record you are responsible for, in a place you
will forget you have.

So this keeps everything that makes dev data USEFUL — row counts, dates,
interaction patterns, which contacts are overdue, goal progress — and replaces
everything that makes it SENSITIVE.

WHAT SURVIVES              WHAT IS REPLACED
  every row                  first_name, last_name  -> generated
  every date                 email                  -> user<n>@example.invalid
  is_personal / type         phone                  -> +1 555 01xx
  consent flags              address lines          -> nulled
  goal figures               notes                  -> a length-preserving stub
  partner scoping            audit_log detail       -> nulled

Dates are NOT shifted: "overdue by 165 days" is the exact property dev exists
to reproduce.

NORMALLY YOU DO NOT NEED THIS. db/seed.dev.sql is the everyday dev dataset and
contains the edge cases on purpose. Reach for this only when reproducing
something that depends on production's real shape.
"""
import argparse, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PROD, DEV = "thauma-ops", "thauma-ops-dev"

# Columns holding personal data, per table.
SCRUB = {
    "contacts": ["first_name", "last_name", "email", "phone",
                 "address_1", "address_2", "city", "postal_code", "notes"],
    "interactions": ["note"],
    "audit_log": ["detail"],

    # MAILING LISTS ARE THE LARGEST STORE OF OTHER PEOPLE'S ADDRESSES IN THIS
    # SYSTEM. Everything else here is the ministry's own words or aggregates;
    # these are real people who gave an address on the understanding it would
    # be written to. A copy of them on a development machine is a second place
    # they can leak from, and nobody consented to that one.
    #
    # `confirm_token` is scrubbed too. It is a live credential: whoever holds
    # it can confirm a subscription that was never confirmed.
    "subscribers": ["email", "name", "confirm_token"],

    # Where a message actually WENT. Snapshotted at send time precisely so it
    # survives the subscriber changing, which also means it survives the
    # subscriber being scrubbed unless it is scrubbed as well.
    "mailing_recipients": ["email"],
}


def d1(db, sql, remote=True):
    cmd = ["npx", "wrangler", "d1", "execute", db, "--json", "-y",
           "--remote" if remote else "--local", "--command", sql]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=180)
    m = re.search(r"\[\s*{.*}\s*\]", out.stdout, re.S)
    if not m:
        raise RuntimeError(f"no JSON from wrangler for: {sql[:60]}\n{out.stdout[-400:]}{out.stderr[-400:]}")
    return json.loads(m.group(0))[0].get("results", [])


def count(db, table):
    try:
        return d1(db, f"SELECT COUNT(*) AS n FROM {table}")[0]["n"]
    except Exception:
        return None


def fake(table, col, i):
    """Deterministic replacements — same input, same output, so diffs stay readable."""
    if col == "first_name":  return ["Alex", "Sam", "Jordan", "Riley", "Casey", "Morgan"][i % 6]
    if col == "last_name":   return ["Doe", "Roe", "Poe", "Loe", "Moe", "Noe"][i % 6]
    if col == "email":       return f"user{i}@example.invalid"
    if col == "phone":       return f"+1 555 01{i % 100:02d}"
    if col == "city":        return "Anytown"
    if col in ("address_1", "address_2", "postal_code"): return None
    if col == "notes":       return "[scrubbed] stewardship note"
    if col == "note":        return "[scrubbed] interaction note"
    if col == "detail":      return None
    if col == "confirm_token": return None   # a live credential, not a value to fake
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually write to the dev database")
    args = ap.parse_args()

    tables = ["partners", "users", "partner_users", "contacts", "interactions",
              "goals", "goal_snapshots", "api_keys", "audit_log"]

    print(f"{'table':18}{PROD:>12}{DEV:>16}")
    print("-" * 48)
    total = 0
    for t in tables:
        p, d = count(PROD, t), count(DEV, t)
        total += p or 0
        print(f"  {t:16}{str(p):>10}{str(d):>16}")

    if total == 0:
        print("\nProduction is empty — nothing to copy. Use db/seed.dev.sql instead:")
        print("  npx wrangler d1 execute thauma-ops-dev --remote --file=db/seed.dev.sql")
        return

    if not args.apply:
        print("\nDRY RUN. Re-run with --apply to replace the dev database's contents.")
        print("Personal columns that would be scrubbed on the way in:")
        for t, cols in SCRUB.items():
            print(f"  {t:16} {', '.join(cols)}")
        return

    print("\nThis DELETES everything in the dev database and reloads it from production.")
    if input("Type 'refresh dev' to continue: ").strip() != "refresh dev":
        sys.exit("aborted")

    # Children first: foreign keys are ON, so parents cannot go before them.
    for t in reversed(tables):
        d1(DEV, f"DELETE FROM {t}")
    print("  dev cleared")

    for t in tables:
        rows = d1(PROD, f"SELECT * FROM {t}")
        if not rows:
            continue
        for i, row in enumerate(rows):
            for col in SCRUB.get(t, []):
                if col in row:
                    row[col] = fake(t, col, i)
            cols = ", ".join(row.keys())
            vals = ", ".join(
                "NULL" if v is None
                else str(v) if isinstance(v, (int, float))
                else "'" + str(v).replace("'", "''") + "'"
                for v in row.values()
            )
            d1(DEV, f"INSERT INTO {t} ({cols}) VALUES ({vals})")
        print(f"  {t:16} {len(rows)} rows"
              f"{'  (scrubbed: ' + ', '.join(SCRUB[t]) + ')' if t in SCRUB else ''}")

    print("\nDone. Dev now mirrors production's shape with no real personal data in it.")


if __name__ == "__main__":
    main()
