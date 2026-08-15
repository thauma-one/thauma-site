#!/usr/bin/env python3
"""
mint_api_key.py — issue a partner API key

    python3 db/mint_api_key.py --partner p_chase --name "chaseroush.com build"
    python3 db/mint_api_key.py --partner p_chase --name "..." --apply --remote

WHAT A KEY CAN DO
-----------------
Read one partner's PUBLIC goals and PUBLIC milestones, through
GET /api/partner/v1/site. Nothing else. It cannot reach contacts,
interactions, users or the audit log — see the PARTNER API section of
db/queries.sql for how that is enforced rather than promised.

THE KEY IS PRINTED ONCE AND NEVER STORED
----------------------------------------
Only SHA-256 of it goes in the database. If it is lost, revoke and mint
another; there is no recovery, by design. A database dump yields no working
credentials.

The key is 32 bytes from secrets.token_urlsafe — a CSPRNG, not `random`, which
is seeded predictably and would make keys guessable.

WHERE TO PUT IT
---------------
The partner site's BUILD environment (Netlify/Cloudflare build variables), and
nowhere else. Never in a repo, never in client-side JavaScript, never in a
query string. The API refuses `?key=` for that reason: query strings end up in
access logs, browser history and Referer headers.
"""
import argparse, hashlib, pathlib, secrets, subprocess, sys, datetime

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--partner", required=True, help="partner id, e.g. p_chase")
    ap.add_argument("--name", required=True, help="what this key is for, e.g. 'chaseroush.com build'")
    ap.add_argument("--scopes", default="read:public")
    ap.add_argument("--db", default="thauma-ops-dev")
    ap.add_argument("--remote", action="store_true", help="apply to the remote D1, not local")
    ap.add_argument("--apply", action="store_true", help="actually insert; otherwise print the SQL")
    args = ap.parse_args()

    if args.scopes != "read:public":
        print(f"NOTE: minting with non-default scopes: {args.scopes}", file=sys.stderr)

    raw = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key_id = "k_" + secrets.token_hex(6)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    sql = (
        "INSERT INTO api_keys (id, partner_id, name, key_hash, scopes, created_at) VALUES "
        f"('{key_id}', '{args.partner}', '{args.name.replace(chr(39), chr(39)*2)}', "
        f"'{key_hash}', '{args.scopes}', '{now}')"
    )

    if not args.apply:
        print("DRY RUN — nothing written. Re-run with --apply.\n")
        print(sql)
        return

    cmd = ["npx", "wrangler", "d1", "execute", args.db, "-y",
           "--remote" if args.remote else "--local", "--command", sql]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=180)
    if out.returncode != 0:
        sys.exit(f"insert failed:\n{out.stdout[-800:]}{out.stderr[-800:]}")

    where = "remote" if args.remote else "local"
    print(f"Key minted for {args.partner} in {args.db} ({where}).")
    print(f"  key id : {key_id}")
    print(f"  scopes : {args.scopes}")
    print()
    print("COPY THIS NOW — it is not stored and cannot be shown again:")
    print()
    print(f"    {raw}")
    print()
    print("Put it in the partner site's BUILD environment as THAUMA_API_KEY.")
    print("Test it with:")
    print(f'    curl -H "Authorization: Bearer {raw}" \\')
    print("         https://next.thauma.one/api/partner/v1/site")
    print()
    print(f"Revoke with:  UPDATE api_keys SET revoked_at = '<now>' WHERE id = '{key_id}';")


if __name__ == "__main__":
    main()
