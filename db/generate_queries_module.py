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
            # A REPEATED NAME IS A MISTAKE, NOT A REDEFINITION. Writing one that
            # already existed silently replaced it, and two callers then got
            # different columns from what they believed was one query. Nothing
            # failed — one of them just stopped returning a field it needed.
            if m.group(1) in out:
                sys.exit(f"db/queries.sql defines {m.group(1)!r} twice")
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

    def as_template(sql: str) -> str:
        """Make SQL safe inside a JavaScript template literal.

        THE SQL IS EMITTED BETWEEN BACKTICKS, which means three characters have
        a meaning there that they do not have in SQL:

          \\   escapes the next character, so `ESCAPE '\\'` — a perfectly ordinary
               LIKE escape clause — arrived at the Worker as `ESCAPE ''`. The
               query still ran, still returned rows, and silently stopped
               matching anything containing a literal % or _.

          `    ends the literal outright.

          ${   starts an interpolation, and would either throw at load time or
               splice a variable into a query, which is the worst of the three.

        None had ever appeared in this file, so the omission cost nothing until
        it did. Escaped rather than forbidden: a query has every right to
        contain a backslash.
        """
        return (sql.replace("\\", "\\\\")
                   .replace("`", "\\`")
                   .replace("${", "\\${"))

    body = ",\n".join(
        f"  {name.replace('-', '_')}: `{as_template(sql)}`"
        for name, sql in sorted(queries.items())
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
