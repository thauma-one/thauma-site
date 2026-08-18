/**
 * sqlsplit.js — cut a migration file into individual statements
 *
 * WHY THIS EXISTS AND WHY IT IS NOT A ONE-LINER
 * ---------------------------------------------------------------------------
 * D1's binding has no "run this file" call. `exec()` comes closest, and its
 * own documentation says it splits on NEWLINES — which mangles every
 * multi-line CREATE TABLE in this repository. So the statements have to be
 * separated here and sent one at a time through prepare().
 *
 * `sql.split(";")` is the obvious approach and it is wrong, because a trigger
 * body contains semicolons:
 *
 *     CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
 *     BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
 *
 * Splitting on `;` produces two fragments, neither of which is valid SQL. That
 * is a real line from 0001_init.sql. There are seventeen triggers across these
 * migrations and every one of them would break.
 *
 * WHAT THE SCANNER TRACKS
 * ---------------------------------------------------------------------------
 * A semicolon ends a statement only at nesting depth zero, and only outside
 * quoted text. So it walks the file once, tracking:
 *
 *   · -- line comments and slash-star block comments  (stripped)
 *   · 'string literals', including the '' escape       (kept, never scanned)
 *   · "identifiers", [identifiers] and `identifiers`   (kept, never scanned)
 *   · BEGIN and CASE as openers, END as closer
 *
 * CASE HAS TO COUNT. This looks like an over-reach until you read the triggers:
 * they are all `BEGIN SELECT CASE WHEN ... END; END;`, so END appears twice and
 * counting only BEGIN would close the statement one END too early — on the
 * CASE's END, splitting the trigger in half. Counting CASE as an opener makes
 * the two nest correctly.
 *
 * This is a pragmatic scanner for the SQL in THIS repository, not a SQLite
 * parser. It is exercised against all ten real migration files, and the test
 * asserts the statement count and that every trigger survives whole.
 */

/** Openers and closers, matched case-insensitively as whole words. */
const OPENS = new Set(["BEGIN", "CASE"]);
const CLOSES = new Set(["END"]);

const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * Split `sql` into executable statements.
 *
 * Returns `[{ sql, line }]` — the text with comments removed, and the 1-based
 * line the statement started on, which is the only useful thing to put in an
 * error message when statement 14 of 31 fails.
 */
export function splitStatements(sql) {
  const src = String(sql);
  const out = [];

  let buf = "";
  let depth = 0;
  let line = 1;
  let startLine = 1;
  let started = false;   // has this statement seen any non-whitespace yet?

  const bump = (text) => { for (const ch of text) if (ch === "\n") line++; };

  const push = () => {
    const text = buf.trim();
    if (text) out.push({ sql: text, line: startLine });
    buf = "";
    started = false;
    depth = 0;   // a stray END must not poison the statements after it
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    /* ---- comments: dropped, but their newlines still count ---- */
    if (c === "-" && next === "-") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      bump(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      bump(src.slice(i, stop));
      i = stop;
      continue;
    }

    /* ---- quoted runs: copied verbatim, never scanned for keywords or ; ---- */
    if (c === "'" || c === '"' || c === "`") {
      const close = c;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === close) {
          // Doubled quote is an escaped quote, not the end.
          if (src[j + 1] === close) { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      const run = src.slice(i, j);
      bump(run);
      buf += run;
      if (!started && run.trim()) { started = true; startLine = line; }
      i = j;
      continue;
    }
    if (c === "[") {
      const end = src.indexOf("]", i);
      const stop = end === -1 ? src.length : end + 1;
      const run = src.slice(i, stop);
      bump(run);
      buf += run;
      if (!started) { started = true; startLine = line; }
      i = stop;
      continue;
    }

    /* ---- words: the only things that change nesting depth ---- */
    if (isWordChar(c) && !/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && isWordChar(src[j])) j++;
      const word = src.slice(i, j);
      const upper = word.toUpperCase();

      if (OPENS.has(upper)) depth++;
      else if (CLOSES.has(upper)) depth = Math.max(0, depth - 1);

      if (!started) { started = true; startLine = line; }
      buf += word;
      i = j;
      continue;
    }

    /* ---- the boundary ---- */
    if (c === ";" && depth === 0) {
      buf += c;
      push();
      i++;
      continue;
    }

    if (c === "\n") line++;
    if (!started && !/\s/.test(c)) { started = true; startLine = line; }
    buf += c;
    i++;
  }

  push();   // a final statement with no trailing semicolon
  return out;
}
