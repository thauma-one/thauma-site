#!/usr/bin/env node
/**
 * Tests for workers/src/staff-stewardship.js
 *   node workers/test/staff-stewardship.test.mjs
 *
 * This endpoint holds the most sensitive data in the system and owns the only
 * write path into `interactions`. The questions worth asking here are:
 *
 *   · can a life event be saved that says nothing
 *   · can an interaction be logged with no date, which would make it
 *     invisible to the one view this whole page is built on
 *   · is `is_personal` carried through honestly, rather than guessed
 *   · do the validators agree with the CHECK constraints in the schema, so a
 *     value that passes here cannot still be refused by the database
 *
 * The last one is checked against db/migrations/0034_life_events.sql and
 * 0001_init.sql themselves rather than against a copied list, because a
 * copied list is exactly what goes stale.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cleanLifeEvent, cleanInteraction } from "../src/staff-stewardship.js";

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

console.log("staff-stewardship.js — the supporter dialog\n");

/* ------------------------------------------------------------ life events */

await check("a life event needs a kind the schema knows", async () => {
  assert(cleanLifeEvent({ kind: "promotion", note: "x" }).error, "accepted an invented kind");
  assert(!cleanLifeEvent({ kind: "birth", note: "x" }).error, "refused a real kind");
});

await check("a life event may have no date", async () => {
  const { value, error } = cleanLifeEvent({ kind: "birth", note: "Expecting in the spring." });
  assert(!error, `refused: ${error}`);
  eq(value.occurred_on, null, "occurred_on");
});

await check("but it must say SOMETHING", async () => {
  /* A row carrying only "bereavement" records a category and cannot say
     whose or when — it is not worth the storage or the disclosure. */
  assert(cleanLifeEvent({ kind: "bereavement" }).error, "accepted an empty event");
  assert(cleanLifeEvent({ kind: "bereavement", note: "  " }).error, "accepted whitespace");
});

await check("a date must be a date", async () => {
  assert(cleanLifeEvent({ kind: "move", occurred_on: "last tuesday" }).error, "accepted prose");
  assert(cleanLifeEvent({ kind: "move", occurred_on: "10/09/2026" }).error, "accepted a local format");
  assert(!cleanLifeEvent({ kind: "move", occurred_on: "2026-09-10" }).error, "refused ISO");
});

await check("nothing recurs without a date to recur on", async () => {
  /* The table's CHECK says the same. This exists so the person gets a
     sentence instead of a constraint violation. */
  const r = cleanLifeEvent({ kind: "birth", note: "Expecting.", recurs: true });
  assert(r.error, "accepted a recurring event with no date");
  assert(!cleanLifeEvent({ kind: "birth", occurred_on: "2026-04-02", recurs: true }).error,
    "refused a dated recurring event");
});

await check("a blank note is stored as nothing, not as empty text", async () => {
  const { value } = cleanLifeEvent({ kind: "move", occurred_on: "2026-09-10", note: "   " });
  eq(value.note, null, "note");
});

/* ----------------------------------------------------------- interactions */

await check("an interaction MUST have a date", async () => {
  /* Unlike a life event. Without one it cannot sit in the timeline and cannot
     move last_personal_contact, which is the only reason to log it. */
  assert(cleanInteraction({ type: "call" }).error, "accepted an undated interaction");
  assert(!cleanInteraction({ type: "call", occurred_on: "2026-09-21" }).error, "refused a dated one");
});

await check("is_personal is carried, not guessed from the type", async () => {
  const yes = cleanInteraction({ type: "email", occurred_on: "2026-09-21", is_personal: true });
  const no = cleanInteraction({ type: "email", occurred_on: "2026-09-21", is_personal: false });
  eq(yes.value.is_personal, 1, "personal email");
  eq(no.value.is_personal, 0, "bulk email");
});

await check("a newsletter cannot be logged by hand here at all", async () => {
  /* Bulk sends are written by the mailing run. Offering the type on this form
     would invite somebody to log one and then wonder why it did not count. */
  assert(cleanInteraction({ type: "newsletter", occurred_on: "2026-09-21" }).error,
    "the form accepted a newsletter");
});

await check("an invented channel is refused", async () => {
  assert(cleanInteraction({ type: "call", occurred_on: "2026-09-21", channel: "carrier_pigeon" }).error,
    "accepted an invented channel");
});

/* ------------------------------------ the validators against the SCHEMA -- */

function checkListFrom(sql, column) {
  /* Pulls `CHECK (<column> IN ('a','b',...))` out of the migration, however
     it is wrapped across lines. */
  const re = new RegExp(`${column}\\s+TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)`, "m");
  const m = sql.match(re);
  assert(m, `no CHECK list for ${column}`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

await check("every kind the form offers is a kind the database accepts", async () => {
  const sql = readFileSync(join(ROOT, "db", "migrations", "0034_life_events.sql"), "utf8");
  for (const kind of checkListFrom(sql, "kind")) {
    assert(!cleanLifeEvent({ kind, note: "x" }).error,
      `the schema allows '${kind}' and the validator refuses it`);
  }
});

await check("and every type, minus the one deliberately withheld", async () => {
  const sql = readFileSync(join(ROOT, "db", "migrations", "0001_init.sql"), "utf8");
  const types = checkListFrom(sql, "type");
  assert(types.includes("newsletter"), "0001 no longer lists newsletter — this test is stale");
  for (const type of types) {
    const r = cleanInteraction({ type, occurred_on: "2026-09-21" });
    if (type === "newsletter") {
      assert(r.error, "newsletter should be withheld from this form");
    } else {
      assert(!r.error, `the schema allows '${type}' and the validator refuses it`);
    }
  }
});

await check("the endpoint is wired into the router", async () => {
  /* A validator nothing can reach is not a feature. The route table is the
     one place this is decided, and a typo there is a 404 rather than an
     error — see the note at the top of worker.js. */
  const sql = readFileSync(join(ROOT, "workers", "src", "worker.js"), "utf8");
  assert(sql.includes('"/api/staff-stewardship"'), "no route for /api/staff-stewardship");
  assert(sql.includes("staff-stewardship.js"), "the handler is not imported");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
