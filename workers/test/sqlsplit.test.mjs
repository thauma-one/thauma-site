#!/usr/bin/env node
/**
 * Tests for workers/src/lib/sqlsplit.js
 *   node workers/test/sqlsplit.test.mjs
 *
 * The synthetic cases below are the ones a naive splitter fails. The last
 * block is the one that matters most: it runs the splitter over all ten REAL
 * migration files and asserts that what comes out is executable — because the
 * cost of getting this wrong is a half-applied migration on production.
 */
import { splitStatements } from "../src/lib/sqlsplit.js";
import { readFileSync, readdirSync } from "node:fs";

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const texts = (sql) => splitStatements(sql).map((s) => s.sql);

/* ------------------------------ the basics ------------------------------ */

check("splits ordinary statements", () => {
  eq(texts("SELECT 1; SELECT 2;"), ["SELECT 1;", "SELECT 2;"], "two");
});

check("a trailing statement with no semicolon still comes out", () => {
  eq(texts("SELECT 1;\nSELECT 2"), ["SELECT 1;", "SELECT 2"], "two");
});

check("blank input yields nothing, not one empty statement", () => {
  eq(texts("\n\n   \n"), [], "empty");
  eq(texts("-- just a comment\n"), [], "comment only");
});

check("comments are stripped", () => {
  eq(texts("-- explain\nSELECT 1;"), ["SELECT 1;"], "line comment");
  eq(texts("/* block\n   comment */ SELECT 1;"), ["SELECT 1;"], "block comment");
});

/* ------------------------- what breaks naive code ------------------------ */

check("a semicolon inside a string is not a boundary", () => {
  const sql = "INSERT INTO t VALUES ('a;b');";
  eq(texts(sql).length, 1, "split inside a literal");
});

check("a doubled quote is an escape, not the end of the string", () => {
  const sql = "INSERT INTO t VALUES ('it''s; fine');";
  eq(texts(sql).length, 1, "mis-read the '' escape");
});

check("-- inside a string is not a comment", () => {
  const sql = "INSERT INTO t VALUES ('a -- b');\nSELECT 2;";
  const got = texts(sql);
  eq(got.length, 2, "count");
  assert(got[0].includes("-- b"), "ate text inside the literal");
});

check("a ONE-LINE trigger body survives — the real line from 0001", () => {
  /* This is verbatim from 0001_init.sql and is the single most likely thing
     to be split in half: the semicolon after RAISE(...) is inside BEGIN/END. */
  const sql =
    "CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log\n" +
    "BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;\n" +
    "SELECT 1;";
  const got = texts(sql);
  eq(got.length, 2, "the trigger was cut in half");
  assert(got[0].startsWith("CREATE TRIGGER"), "first is the trigger");
  assert(got[0].trimEnd().endsWith("END;"), `trigger truncated: ${got[0]}`);
});

check("BEGIN ... CASE ... END ... END nests correctly", () => {
  /* Counting only BEGIN closes on the CASE's END — one too early — and the
     trigger comes out in two useless pieces. This is the shape of every
     guard trigger in the schema. */
  const sql =
    "CREATE TRIGGER t BEFORE INSERT ON m FOR EACH ROW\n" +
    "BEGIN\n" +
    "  SELECT CASE WHEN 1 <> 2 THEN RAISE(ABORT, 'no') END;\n" +
    "END;\n" +
    "SELECT 9;";
  const got = texts(sql);
  eq(got.length, 2, "CASE was not counted as an opener");
  assert(got[0].includes("RAISE"), "body lost");
  eq(got[1], "SELECT 9;", "the statement after the trigger");
});

check("reports the line each statement started on", () => {
  const got = splitStatements("-- header\n\nSELECT 1;\n\nSELECT 2;");
  eq(got.map((s) => s.line), [3, 5], "line numbers");
});

check("a stray END does not poison everything after it", () => {
  const got = texts("END;\nSELECT 1;\nSELECT 2;");
  eq(got.length, 3, "depth went negative and swallowed the rest");
});

/* ---------------------- against the real migrations ---------------------- */

const DIR = new URL("../../db/migrations/", import.meta.url);
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

check("all ten migration files are present", () => {
  assert(FILES.length >= 10, `found ${FILES.length} migration files`);
});

for (const f of FILES) {
  check(`${f} splits into executable statements`, () => {
    const raw = readFileSync(new URL(f, DIR), "utf8");
    const stmts = splitStatements(raw);
    assert(stmts.length > 0, "produced nothing");

    for (const { sql, line } of stmts) {
      /* Every statement must start with a verb. A fragment — the tail of a
         trigger that got cut — starts with END, or a bare identifier, and
         would fail on production halfway through a migration. */
      assert(/^(CREATE|DROP|ALTER|INSERT|UPDATE|DELETE|PRAGMA|SELECT|REPLACE|WITH|VACUUM|ANALYZE)\b/i.test(sql),
        `${f}:${line} is not a statement: ${sql.slice(0, 60)}`);

      /* Balanced quotes: an odd number of unescaped ' means the scanner lost
         track and the statement spans a boundary it should not. */
      const quotes = (sql.replace(/''/g, "").match(/'/g) || []).length;
      eq(quotes % 2, 0, `${f}:${line} has unbalanced quotes`);
    }

    /* Every trigger comes out whole. */
    const declared = (raw.match(/CREATE\s+TRIGGER/gi) || []).length;
    const intact = stmts.filter((s) => /^CREATE\s+TRIGGER/i.test(s.sql) &&
                                       /END\s*;?$/i.test(s.sql.trim())).length;
    eq(intact, declared, `${f}: ${declared} triggers declared, ${intact} came out complete`);
  });
}

check("recombining the statements loses no SQL", () => {
  /* A splitter that drops a statement is worse than one that fails: the
     migration would report success having skipped a table. Compare on
     non-whitespace, non-comment characters. */
  for (const f of FILES) {
    const raw = readFileSync(new URL(f, DIR), "utf8");
    const strip = (s) => s
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\s+/g, "");
    const before = strip(raw);
    const after = splitStatements(raw).map((s) => s.sql).join("");
    eq(after.replace(/\s+/g, ""), before, `${f} lost or invented characters`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
