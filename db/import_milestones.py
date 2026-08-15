#!/usr/bin/env python3
"""
import_milestones.py — bring a partner's milestones in from the old R2 JSON

    python3 db/import_milestones.py --partner p_chase            # dry run
    python3 db/import_milestones.py --partner p_chase --apply --remote

Source: https://assets.chaseroush.com/JSON/milestones.json — hand-edited, no
history, no review, owned by the partner site. This moves it to the
organisation, which is the point of Thauma being the system of record.

WHAT THE REAL DATA TAUGHT US
----------------------------------------------------------------------------
Four mismatches, all handled here rather than by loosening the schema:

1. `status: "hidden"` is used to mean "do not show this yet". That conflates
   VISIBILITY with LIFECYCLE — hidden is not a thing a milestone IS, it is a
   thing somebody DECIDED. The schema keeps them apart: status stays a
   lifecycle value, and is_public carries the decision. "hidden" therefore
   imports as status='upcoming', is_public=0.

2. `status: ""` — one row has no status at all. Defaults to 'upcoming' rather
   than failing the import, because an empty string is plainly a missing
   value, not an assertion.

3. `parent` is the parent's TITLE ("Visa Application"), not an id. Titles get
   edited; the link would silently break. Resolved to a real parent_id here,
   and the schema enforces that both sides belong to one partner.

4. `completion` is sometimes the string "0" and sometimes the number 0. Coerced
   to INTEGER, which the CHECK constraint then holds to 0..100.

VISIBILITY MAPPING, STATED PLAINLY BECAUSE IT IS THE RISKY PART
    is_public   = active AND status != 'hidden'
    is_featured = homepage

Anything ambiguous imports as NOT public. A milestone wrongly withheld is a
missing entry somebody notices; a milestone wrongly published cannot be
unpublished from other people's screens.
"""
import argparse, datetime, json, pathlib, re, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = "https://assets.chaseroush.com/JSON/milestones.json"
VALID_STATUS = {"upcoming", "in_progress", "complete", "cancelled"}


def q(v):
    if v is None or v == "":
        return "NULL"
    if isinstance(v, (int, float)):
        return str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def slug_id(partner, title, i):
    base = re.sub(r"[^a-z0-9]+", "_", str(title).lower()).strip("_")[:40] or f"item_{i}"
    return f"m_{partner.removeprefix('p_')}_{base}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--partner", required=True)
    ap.add_argument("--source", default=SOURCE)
    ap.add_argument("--db", default="thauma-ops-dev")
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--out", help="write the SQL here instead of executing it")
    args = ap.parse_args()

    # Cloudflare's bot rules 403 the default "Python-urllib/3.x" agent. Say who
    # we actually are rather than pretending to be a browser.
    req = urllib.request.Request(
        args.source, headers={"User-Agent": "thauma-import-milestones/1.0 (+https://thauma.one)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = json.load(r)
    items = raw if isinstance(raw, list) else (raw.get("milestones") or list(raw.values())[0])

    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    by_title = {str(m.get("title", "")).strip(): slug_id(args.partner, m.get("title"), i)
                for i, m in enumerate(items)}

    rows, notes = [], []
    for i, m in enumerate(items):
        status = str(m.get("status") or "").strip().lower()
        active = int(m.get("active") or 0)

        if status == "hidden":
            notes.append(f"  {m.get('title')!r}: status 'hidden' -> upcoming + NOT public")
            status, is_public = "upcoming", 0
        elif status not in VALID_STATUS:
            if status:
                notes.append(f"  {m.get('title')!r}: unknown status {status!r} -> upcoming")
            else:
                notes.append(f"  {m.get('title')!r}: empty status -> upcoming")
            status = "upcoming"
            is_public = active
        else:
            is_public = active

        parent_title = str(m.get("parent") or "").strip()
        parent_id = by_title.get(parent_title) if parent_title else None
        if parent_title and not parent_id:
            notes.append(f"  {m.get('title')!r}: parent {parent_title!r} not found -> top level")

        try:
            completion = max(0, min(100, int(float(m.get("completion") or 0))))
        except (TypeError, ValueError):
            completion = 0
            notes.append(f"  {m.get('title')!r}: unreadable completion -> 0")

        rows.append((
            slug_id(args.partner, m.get("title"), i), args.partner, parent_id,
            m.get("title"), m.get("title_hr"), m.get("description"), m.get("description_hr"),
            m.get("target_date"), m.get("target_date_hr"), m.get("actual_date"),
            status, completion, is_public, int(m.get("homepage") or 0), i, now,
        ))

    # Parents before children, or the foreign key rejects the child.
    rows.sort(key=lambda r: (r[2] is not None, r[14]))

    sql = "\n".join(
        "INSERT INTO milestones (id, partner_id, parent_id, title, title_hr, description, "
        "description_hr, target_label, target_label_hr, actual_date, status, completion, "
        "is_public, is_featured, sort_order, created_at, updated_at) VALUES ("
        + ", ".join(q(v) for v in r[:15]) + f", {q(r[15])}, {q(r[15])});"
        for r in rows)

    pub = sum(1 for r in rows if r[12])
    print(f"{len(rows)} milestones from {args.source}")
    print(f"  {pub} public, {len(rows) - pub} withheld, "
          f"{sum(1 for r in rows if r[2])} nested")
    if notes:
        print("\nMappings applied:")
        print("\n".join(notes))

    if args.out:
        pathlib.Path(args.out).write_text(sql + "\n")
        print(f"\nwrote {args.out}")
        return
    if not args.apply:
        print("\nDRY RUN — re-run with --apply. SQL:\n")
        print(sql)
        return

    cmd = ["npx", "wrangler", "d1", "execute", args.db, "-y",
           "--remote" if args.remote else "--local", "--command", sql]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        sys.exit(f"import failed:\n{out.stdout[-900:]}{out.stderr[-900:]}")
    print(f"\nImported into {args.db} ({'remote' if args.remote else 'local'}).")


if __name__ == "__main__":
    main()
