#!/usr/bin/env node
/**
 * Tests for workers/src/lib/db.js
 *   node workers/test/db.test.mjs
 *
 * Two jobs:
 *   1. The named -> positional conversion is exactly right. A silently
 *      mis-ordered argument list produces WRONG ANSWERS, not errors, which is
 *      the worst failure mode available here.
 *   2. queries.generated.js is in sync with db/queries.sql, so a stale
 *      generated file fails here rather than shipping old SQL.
 *
 * The SQL itself is exercised against real SQLite by db/test_schema.py and
 * db/build_snapshot.py — Node 20 has no built-in SQLite, so that half lives
 * in Python on purpose.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { toPositional, createDb, partnerSnapshot, QUERIES, SOURCE_DIGEST }
  from "../src/lib/db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("db.js — D1 query layer\n");

/* ------------------------------ generation ------------------------------ */

await check("queries.generated.js is in sync with db/queries.sql", async () => {
  const src = readFileSync(join(ROOT, "db", "queries.sql"), "utf8");
  const digest = createHash("sha256").update(src).digest("hex").slice(0, 16);
  assert(digest === SOURCE_DIGEST,
    `stale generated file — run: python3 db/generate_queries_module.py`);
});

await check("all eight named queries are present", async () => {
  const expected = [
    "audit_recent_for_partner", "contact_timeline", "contacts_stewardship",
    "dashboard_needs_attention", "dashboard_partner_summary", "goal_history",
    "goals_for_partner", "partners_for_user",
  ];
  eq(Object.keys(QUERIES).sort(), expected, "query names");
});

await check("no generated query still contains a comment marker", async () => {
  for (const [name, sql] of Object.entries(QUERIES)) {
    assert(!/^\s*--/m.test(sql), `${name} kept a comment line`);
  }
});

/* --------------------------- param conversion --------------------------- */

await check("a single parameter converts", async () => {
  const r = toPositional("SELECT 1 WHERE a = :x", { x: 5 });
  eq(r.sql, "SELECT 1 WHERE a = ?", "sql");
  eq(r.args, [5], "args");
});

await check("a REPEATED parameter is expanded once per occurrence", async () => {
  // The reason named params exist here: dashboard_partner_summary mentions
  // :partner_id four times and :today twice.
  const r = toPositional("SELECT :a, :b, :a, :a", { a: 1, b: 2 });
  eq(r.sql, "SELECT ?, ?, ?, ?", "sql");
  eq(r.args, [1, 2, 1, 1], "args must repeat in order");
});

await check("arguments come out in SQL order, not object order", async () => {
  // Object key order must never influence binding.
  const r = toPositional("SELECT :second, :first", { first: "F", second: "S" });
  eq(r.args, ["S", "F"], "order");
});

await check("a missing parameter throws instead of binding undefined", async () => {
  let threw = null;
  try { toPositional("SELECT :a, :b", { a: 1 }); } catch (e) { threw = e.message; }
  assert(threw && threw.includes("b"), `expected a throw naming b, got ${threw}`);
});

await check("null and 0 are real values, not 'missing'", async () => {
  const r = toPositional("SELECT :a, :b", { a: null, b: 0 });
  eq(r.args, [null, 0], "falsy values dropped");
});

await check("a `::` cast is not mistaken for a parameter", async () => {
  const r = toPositional("SELECT x::text WHERE a = :a", { a: 1 });
  eq(r.args, [1], "args");
  assert(r.sql.includes("::text"), "cast was mangled");
});

await check("every real query converts with its documented params", async () => {
  const params = {
    partner_id: "p_chase", today: "2026-08-15", stale_days: 120,
    contact_id: "c_1", goal_id: "g_1", user_id: "u_1", limit: 10,
  };
  for (const [name, sql] of Object.entries(QUERIES)) {
    const r = toPositional(sql, params);
    assert(!r.sql.includes(":"), `${name} left a named placeholder behind`);
    assert(r.args.length > 0, `${name} bound no arguments`);
  }
});

/* ------------------------------- scoping -------------------------------- */

await check("a tenant query without partner_id THROWS", async () => {
  const db = createDb(null, async () => []);
  for (const q of ["contacts_stewardship", "goals_for_partner", "contact_timeline"]) {
    let threw = null;
    try { await db.query(q, { today: "2026-08-15", contact_id: "c_1" }); }
    catch (e) { threw = e.message; }
    assert(threw && threw.includes("partner_id"), `${q} did not require partner_id`);
  }
});

await check("partners_for_user is not tenant-scoped (it decides scope)", async () => {
  const db = createDb(null, async () => [{ id: "p_chase" }]);
  const rows = await db.query("partners_for_user", { user_id: "u_1" });
  eq(rows.length, 1, "rows");
});

await check("an unknown query name throws and lists the valid ones", async () => {
  const db = createDb(null, async () => []);
  let threw = null;
  try { await db.query("nope", { partner_id: "p" }); } catch (e) { threw = e.message; }
  assert(threw && threw.includes("contacts_stewardship"), `unhelpful error: ${threw}`);
});

/* ------------------------------ execution ------------------------------- */

await check("query passes converted SQL and args to the executor", async () => {
  const seen = [];
  const db = createDb(null, async (sql, args) => { seen.push({ sql, args }); return []; });
  await db.query("goals_for_partner", { partner_id: "p_chase" });
  assert(!seen[0].sql.includes(":partner_id"), "named placeholder reached the executor");
  eq(seen[0].args, ["p_chase"], "args");
});

await check("queryOne returns the row or null, never undefined", async () => {
  const some = createDb(null, async () => [{ a: 1 }, { a: 2 }]);
  eq(await some.queryOne("goals_for_partner", { partner_id: "p" }), { a: 1 }, "first row");
  const none = createDb(null, async () => []);
  eq(await none.queryOne("goals_for_partner", { partner_id: "p" }), null, "empty");
});

await check("today() is YYYY-MM-DD", async () => {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(createDb(null, async () => []).today()), "format");
});

await check("partnerSnapshot returns the same shape build_snapshot.py does", async () => {
  const db = createDb(null, async (sql) => {
    if (sql.includes("contacts_total")) return [{ contacts_total: 4, newsletter_optin: 2 }];
    if (sql.includes("stale_count")) return [{ stale_count: 1 }];
    if (sql.includes("FROM contacts c")) return [{ id: "c_1" }];
    if (sql.includes("goal_progress")) return [{ goal_id: "g_1", percent: 68 }];
    if (sql.includes("audit_log")) return [{ action: "read" }];
    return [];
  });
  const snap = await partnerSnapshot(db, "p_chase");
  for (const k of ["as_of", "stale_days", "summary", "needs_attention", "contacts", "goals", "audit"]) {
    assert(k in snap, `missing key ${k}`);
  }
  eq(snap.needs_attention.stale_count, 1, "stale_count");
  eq(snap.contacts.length, 1, "contacts");
});

await check("partnerSnapshot refuses to run without a partner", async () => {
  const db = createDb(null, async () => []);
  let threw = null;
  try { await partnerSnapshot(db, null); } catch (e) { threw = e.message; }
  assert(threw, "ran unscoped");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
