#!/usr/bin/env python3
"""
generate_queries_module.py — db/queries.sql -> workers/src/lib/queries.generated.js

Workers cannot read files at runtime, so the SQL has to be bundled. Rather
than keeping a second hand-maintained copy (which would drift the first time
somebody edits one and not the other), this generates a JS module from
db/queries.sql.

**db/queries.sql stays the single source of truth.** The generated file is
committed so the Worker builds without a preprocessing step, and
workers/test/db.test.mjs asserts the two are in sync — so a stale generated
file fails the tests rather than silently shipping old SQL.

    python3 db/generate_queries_module.py
"""
import pathlib, re, sys, hashlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "db" / "queries.sql"
OUT = ROOT / "workers" / "src" / "lib" / "queries.generated.js"


def parse(text):
    """{name: sql}, keyed by the `-- name:` markers. Comments stripped."""
    out, name, buf = {}, None, []
    for line in text.splitlines():
        m = re.match(r"^--\s*name:\s*(\S+)", line)
        if m:
            if name:
                out[name] = "\n".join(buf).strip()
            name, buf = m.group(1), []
            continue
        if name is not None:
            # Drop full-line comments; keep everything else verbatim.
            if re.match(r"^\s*--", line):
                continue
            buf.append(line)
    if name:
        out[name] = "\n".join(buf).strip()
    return {k: v for k, v in out.items() if v}


def main():
    text = SRC.read_text()
    queries = parse(text)
    if not queries:
        sys.exit("no named queries found in db/queries.sql")

    digest = hashlib.sha256(text.encode()).hexdigest()[:16]

    body = ",\n".join(
        f"  {name.replace('-', '_')}: `{sql}`" for name, sql in sorted(queries.items())
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(f"""// GENERATED FILE — DO NOT EDIT.
// Source: db/queries.sql
// Regenerate: python3 db/generate_queries_module.py
//
// Workers cannot read files at runtime, so the SQL is bundled here.
// db/queries.sql remains the single source of truth; workers/test/db.test.mjs
// asserts this file is in sync with it, so a stale copy fails the tests
// rather than silently shipping old SQL.

/** sha256 of db/queries.sql at generation time, first 16 hex chars. */
export const SOURCE_DIGEST = "{digest}";

export const QUERIES = {{
{body}
}};
""")
    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  queries: {len(queries)}")
    for n in sorted(queries):
        params = sorted(set(re.findall(r":([a-z_]+)", queries[n])))
        print(f"    {n:28} params: {', '.join(params) or 'none'}")
    print(f"  digest : {digest}")


if __name__ == "__main__":
    main()
