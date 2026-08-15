#!/usr/bin/env python3
"""
build_snapshot.py — run db/queries.sql against schema+seed, emit JSON.

The admin UI is built against the OUTPUT of the real queries rather than
hand-written fixtures, so the shapes it renders are the shapes the database
actually returns. When a live backend is wired up, the UI's fetch target
changes and nothing else does.

    python3 db/build_snapshot.py

Writes src/staff/data/snapshot.json
"""
import sqlite3, pathlib, json, re, datetime, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "db"
OUT = ROOT / "src" / "staff" / "data" / "snapshot.json"

PARTNER = "p_chase"
TODAY = "2026-08-14"
STALE_DAYS = 120


def load_queries():
    """Parse queries.sql into {name: sql}, keyed by the -- name: comments."""
    text = (DB_DIR / "queries.sql").read_text()
    out, name, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r"^--\s*name:\s*(\S+)", line)
        if m:
            if name:
                out[name] = "\n".join(buf).strip()
            name, buf = m.group(1), []
            continue
        if name is not None and not line.startswith("-- ="):
            buf.append(line)
    if name:
        out[name] = "\n".join(buf).strip()
    return {k: v for k, v in out.items() if v}


def rows(db, sql, params):
    """Run a :named-param query and return list[dict]."""
    db.row_factory = sqlite3.Row
    return [dict(r) for r in db.execute(sql, params).fetchall()]


def main():
    db = sqlite3.connect(":memory:")
    db.executescript((DB_DIR / "migrations" / "0001_init.sql").read_text())
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript((DB_DIR / "seed.dev.sql").read_text())

    q = load_queries()
    base = {"partner_id": PARTNER, "today": TODAY}

    summary   = rows(db, q["dashboard_partner_summary"], base)[0]
    attention = rows(db, q["dashboard_needs_attention"], {**base, "stale_days": STALE_DAYS})[0]
    contacts  = rows(db, q["contacts_stewardship"], base)
    goals     = rows(db, q["goals_for_partner"], base)
    audit     = rows(db, q["audit_recent_for_partner"], {**base, "limit": 10})

    timelines = {c["id"]: rows(db, q["contact_timeline"],
                               {"contact_id": c["id"], "partner_id": PARTNER})
                 for c in contacts}
    histories = {g["goal_id"]: rows(db, q["goal_history"],
                                    {"goal_id": g["goal_id"], "partner_id": PARTNER})
                 for g in goals}

    partner = rows(db, "SELECT id, slug, display_name, status FROM partners WHERE id = :p",
                   {"p": PARTNER})[0]

    snapshot = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
                          .isoformat(timespec="seconds").replace("+00:00", "Z"),
        "as_of": TODAY,
        "stale_days": STALE_DAYS,
        "source": "db/seed.dev.sql via db/queries.sql",
        "partner": partner,
        "summary": summary,
        "needs_attention": attention,
        "contacts": contacts,
        "timelines": timelines,
        "goals": goals,
        "goal_history": histories,
        "audit": audit,
    }

    # Guard: the snapshot must never carry another tenant's rows.
    leaked = [c for c in contacts if str(c["id"]).startswith("c_demo")]
    if leaked:
        sys.exit(f"ABORT: snapshot contains other-tenant rows: {[c['id'] for c in leaked]}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  partner   : {partner['display_name']}")
    print(f"  contacts  : {len(contacts)}  ({attention['stale_count']} overdue >{STALE_DAYS}d)")
    print(f"  goals     : {len(goals)}")
    print(f"  timelines : {sum(len(v) for v in timelines.values())} interactions")


if __name__ == "__main__":
    main()
