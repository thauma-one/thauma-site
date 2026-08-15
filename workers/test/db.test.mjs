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

await check("all nine named queries are present", async () => {
  const expected = [
    "audit_recent_for_partner", "contact_timeline", "contacts_stewardship",
    "dashboard_needs_attention", "dashboard_partner_summary", "goal_history",
    "goals_for_partner", "interactions_for_partner", "partners_for_user",
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
    contact_id: "c_1", goal_id: "g_1", email: "chase@thauma.one", limit: 10,
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
  for (const q of ["contacts_stewardship", "goals_for_partner", "contact_timeline",
                   "interactions_for_partner"]) {
    let threw = null;
    try { await db.query(q, { today: "2026-08-15", contact_id: "c_1" }); }
    catch (e) { threw = e.message; }
    assert(threw && threw.includes("partner_id"), `${q} did not require partner_id`);
  }
});

await check("partners_for_user is not tenant-scoped (it decides scope)", async () => {
  const db = createDb(null, async () => [{ id: "p_chase" }]);
  const rows = await db.query("partners_for_user", { email: "chase@thauma.one" });
  eq(rows.length, 1, "rows");
});

await check("partners_for_user takes an EMAIL, not an internal user id", async () => {
  // Regression. It was keyed on users.id (`u_chase`) while the only identifier
  // Cloudflare Access supplies is an email address, so every authenticated
  // request 403'd. Binding :user_id here must now be a hard error.
  assert(/:email\b/.test(QUERIES.partners_for_user), "query no longer binds :email");
  assert(!/:user_id\b/.test(QUERIES.partners_for_user), "query still binds :user_id");

  const db = createDb(null, async () => [{ id: "p_chase" }]);
  let threw = null;
  try { await db.query("partners_for_user", { user_id: "u_chase" }); }
  catch (e) { threw = e.message; }
  assert(threw && threw.includes("email"), `expected a throw naming email, got ${threw}`);
});

await check("partners_for_user requires an ACTIVE user", async () => {
  // A suspended or merely invited account must lose access without anyone
  // having to hunt down its partner_users rows.
  assert(/status\s*=\s*'active'/.test(QUERIES.partners_for_user),
    "the status gate is gone — a suspended user would still be granted a partner");
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

/* --------------------------- the live snapshot --------------------------- */

// Stands in for D1 with the shapes the real queries return.
function fakeD1({ contacts = [{ id: "c_1" }, { id: "c_2" }], interactions = [] } = {}) {
  return createDb(null, async (sql) => {
    if (sql.includes("contacts_total")) return [{ contacts_total: 4, newsletter_optin: 2 }];
    if (sql.includes("stale_count")) return [{ stale_count: 1 }];
    if (sql.includes("FROM interactions i")) return interactions;
    if (sql.includes("FROM contacts c")) return contacts;
    if (sql.includes("goal_progress")) return [{ goal_id: "g_1", percent: 68 }];
    if (sql.includes("audit_log")) return [{ action: "read" }];
    return [];
  });
}

await check("partnerSnapshot returns the same shape build_snapshot.py does", async () => {
  const snap = await partnerSnapshot(fakeD1(), "p_chase");
  for (const k of ["as_of", "stale_days", "summary", "needs_attention",
                   "contacts", "timelines", "goals", "audit"]) {
    assert(k in snap, `missing key ${k}`);
  }
  eq(snap.needs_attention.stale_count, 1, "stale_count");
  eq(snap.contacts.length, 2, "contacts");
});

await check("every key partnerSnapshot emits also exists in the committed snapshot.json", async () => {
  // The console was built against build_snapshot.py's output and switched to
  // this endpoint by changing one URL. That only holds while the two agree.
  // `timelines` was missing here and the stewardship drawer threw on
  // `d.timelines[c.id]`; this is the check that would have caught it.
  const file = JSON.parse(
    readFileSync(join(ROOT, "src", "staff", "data", "snapshot.json"), "utf8"));
  const snap = await partnerSnapshot(fakeD1(), "p_chase");
  const missing = Object.keys(snap).filter((k) => !(k in file));
  assert(!missing.length,
    `the endpoint emits keys the generator does not: ${missing.join(", ")}`);
});

await check("EVERY contact gets a timeline key, even with no interactions", async () => {
  // The drawer renders "No interactions logged." for [] but throws on
  // undefined, so a contact who has never been touched must still get a key.
  const snap = await partnerSnapshot(fakeD1({
    contacts: [{ id: "c_1" }, { id: "c_quiet" }],
    interactions: [{ contact_id: "c_1", id: "i_1", type: "call", is_personal: 1 }],
  }), "p_chase");
  eq(Object.keys(snap.timelines).sort(), ["c_1", "c_quiet"], "timeline keys");
  eq(snap.timelines.c_quiet, [], "a contact with no interactions must get []");
});

await check("timelines group by contact and drop the grouping column", async () => {
  const snap = await partnerSnapshot(fakeD1({
    contacts: [{ id: "c_1" }, { id: "c_2" }],
    interactions: [
      { contact_id: "c_1", id: "i_1", occurred_on: "2026-08-01", is_personal: 1 },
      { contact_id: "c_2", id: "i_2", occurred_on: "2026-07-01", is_personal: 0 },
      { contact_id: "c_1", id: "i_3", occurred_on: "2026-06-01", is_personal: 1 },
    ],
  }), "p_chase");
  eq(snap.timelines.c_1.map((i) => i.id), ["i_1", "i_3"], "c_1 events, in query order");
  eq(snap.timelines.c_2.map((i) => i.id), ["i_2"], "c_2 events");
  assert(!("contact_id" in snap.timelines.c_1[0]),
    "contact_id is the key, it should not also be repeated in every event");
});

await check("an interaction for an unknown contact is dropped, not crashed on", async () => {
  const snap = await partnerSnapshot(fakeD1({
    contacts: [{ id: "c_1" }],
    interactions: [{ contact_id: "c_gone", id: "i_x" }],
  }), "p_chase");
  eq(Object.keys(snap.timelines), ["c_1"], "keys");
  eq(snap.timelines.c_1, [], "orphan leaked into a timeline");
});

await check("partnerSnapshot runs a FIXED number of queries, not one per contact", async () => {
  // The reason interactions_for_partner exists. With a per-contact loop this
  // would grow with the directory and nobody would notice until it was slow.
  let calls = 0;
  const db = createDb(null, async (sql) => {
    calls++;
    if (sql.includes("FROM contacts c")) {
      return Array.from({ length: 50 }, (_, i) => ({ id: `c_${i}` }));
    }
    return [];
  });
  await partnerSnapshot(db, "p_chase");
  eq(calls, 6, "query count must not scale with the number of contacts");
});

await check("partnerSnapshot refuses to run without a partner", async () => {
  const db = createDb(null, async () => []);
  let threw = null;
  try { await partnerSnapshot(db, null); } catch (e) { threw = e.message; }
  assert(threw, "ran unscoped");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
