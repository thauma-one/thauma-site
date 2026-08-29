#!/usr/bin/env node
/**
 * Moving rows between deployments
 *   node workers/test/dbsync.test.mjs
 *
 * The shell versions of this had five bugs that only appeared when run — an
 * append-only table, an ordering that alphabetised wrongly, a dependency that
 * was a trigger rather than a foreign key, a guard that rejected its own seed
 * data, and a Cloudflare-internal table that does not exist on both sides.
 *
 * So the logic here is pure and the tests are the run. Nothing below touches a
 * database, a binding, or the network.
 */
import {
  invented, copyableTables, loadOrder, buildStatements, renderSql, lit,
  realAddresses, SKIP_TABLES,
} from "../src/lib/dbsync.js";
import { isProduction, remoteConfig } from "../src/admin-dbsync.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("moving rows between deployments\n");

/* ------------------------- what may be a target ------------------------- */

check("PRODUCTION IS NEVER A DESTINATION", () => {
  for (const n of ["thauma-ops", "thauma-prod", "thauma-ops-prod",
                   "thauma-production", "anything-production"]) {
    assert(isProduction(n), `would have allowed ${n}`);
  }
  assert(!isProduction("thauma-ops-dev"), "refused staging, which IS the target");
});

check("a deployment with no credential does not offer this at all", () => {
  /* The gate is what the deployment HAS, not what it is called. Staging and
     production carry no D1 credential, so they answer "not available" without
     anybody maintaining a hostname list. */
  for (const env of [{}, { SYNC_ACCOUNT_ID: "a" }, { SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t" }]) {
    eq(remoteConfig(env).ok, false, `offered it with ${JSON.stringify(env)}`);
  }
  const full = { SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t", SYNC_REMOTE_DB: "thauma-ops-dev" };
  eq(remoteConfig(full).ok, true, "refused a complete configuration");
  eq(remoteConfig({ ...full, SYNC_REMOTE_DB: "thauma-ops" }).ok, false,
     "let production be configured as the target");
});

/* --------------------------- the address guard -------------------------- */

check("reserved domains pass and real ones do not", () => {
  for (const ok of ["a@example.com", "b@example.hr", "c@x.invalid",
                    "d@sub.example.org", "e@thing.test", "f@localhost"]) {
    assert(invented(ok), `refused its own seed data: ${ok}`);
  }
  for (const real of ["someone@gmail.com", "pastor@church.hr", "chase@thauma.one",
                      "a@example.com.evil.net"]) {
    assert(!invented(real), `treated a real address as invented: ${real}`);
  }
});

check("the guard names the table a real address is in", () => {
  const found = realAddresses({
    subscribers: [{ email: "a@example.invalid" }, { email: "real@gmail.com" }],
    contacts: [{ email: "b@example.hr" }],
  });
  eq(found, [{ table: "subscribers", address: "real@gmail.com" }], "found");
});

/* ------------------------------ what moves ------------------------------ */

check("Cloudflare's own tables and the append-only ones never move", () => {
  const got = copyableTables(["users", "_cf_METADATA", "sqlite_sequence",
                              "audit_log", "sessions", "schema_migrations", "videos"]);
  eq(got, ["users", "videos"], "copyable");
  for (const t of ["audit_log", "sessions", "schema_migrations"]) {
    assert(SKIP_TABLES.has(t), `${t} is not skipped`);
  }
});

check("parents load before children, whatever the alphabet says", () => {
  /* milestone_translations sorts BEFORE milestones, and its trigger reads the
     milestone. This is the ordering bug the shell version shipped with. */
  const deps = new Map([
    ["milestone_translations", new Set(["milestones"])],
    ["milestones", new Set()],
    ["directory_contacts", new Set(["partner_users"])],
    ["partner_users", new Set(["partners"])],
    ["partners", new Set()],
  ]);
  const order = loadOrder([...deps.keys()], deps);
  const at = Object.fromEntries(order.map((t, i) => [t, i]));
  assert(at.milestones < at.milestone_translations, "translations before milestones");
  assert(at.partners < at.partner_users, "partner_users before partners");
  assert(at.partner_users < at.directory_contacts, "directory before partner_users");
});

check("a dependency cycle ends, rather than hanging", () => {
  const deps = new Map([["a", new Set(["b"])], ["b", new Set(["a"])]]);
  eq(loadOrder(["a", "b"], deps).sort(), ["a", "b"], "both still emitted");
});

/* ------------------------------ the SQL --------------------------------- */

check("an apostrophe cannot end a statement early", () => {
  eq(lit("O'Brien"), "'O''Brien'", "doubled");
  eq(renderSql([{ sql: "INSERT INTO t (a) VALUES (?)", params: ["it's"] }]),
     "INSERT INTO t (a) VALUES ('it''s');", "rendered");
});

check("a NUL is refused rather than silently truncating the row", () => {
  let threw = null;
  try { lit("a" + String.fromCharCode(0) + "b"); } catch (e) { threw = e.message; }
  assert(threw && /NUL/.test(threw), `expected a refusal, got ${threw}`);
});

check("numbers, nulls and booleans render without quotes", () => {
  eq([lit(42), lit(null), lit(undefined), lit(true), lit(false)],
     ["42", "NULL", "NULL", "1", "0"], "scalars");
});

/* ---------------------------- the statements ---------------------------- */

const ROWS = {
  partners: [{ id: "p", name: "A" }],
  subscribers: [{ id: "s", email: "real@gmail.com", name: "Real Person" }],
};
const ORDER = ["partners", "subscribers"];

check("every table is cleared before anything is written", () => {
  const { statements } = buildStatements(ORDER, ROWS);
  const deletes = statements.filter((s) => s.sql.startsWith("DELETE"));
  eq(deletes.map((s) => s.sql), ["DELETE FROM subscribers", "DELETE FROM partners"],
     "children cleared first");
  assert(statements.indexOf(deletes[deletes.length - 1]) <
         statements.findIndex((s) => s.sql.startsWith("INSERT")),
         "an INSERT runs before the last DELETE");
});

check("coming DOWN to a development site, people are replaced", () => {
  const { statements } = buildStatements(ORDER, ROWS, { scrub: true });
  const ins = statements.find((s) => s.sql.includes("INSERT INTO subscribers"));
  assert(!ins.params.includes("real@gmail.com"), "a real address was copied down");
  assert(!ins.params.includes("Real Person"), "a real name was copied down");
  assert(ins.params.some((p) => String(p).includes("@example.invalid")),
         `expected an invented address, got ${JSON.stringify(ins.params)}`);
});

check("going UP, nothing is rewritten — it is refused instead", () => {
  /* Scrubbing on the way up would quietly publish a fiction to a public site.
     The push refuses; only the download rewrites. */
  const { statements } = buildStatements(ORDER, ROWS, { scrub: false });
  const ins = statements.find((s) => s.sql.includes("INSERT INTO subscribers"));
  assert(ins.params.includes("real@gmail.com"), "the push silently altered data");
  assert(realAddresses(ROWS).length, "and the guard would not have caught it");
});

check("values are bound, not interpolated, on the local side", () => {
  const { statements } = buildStatements(ORDER, ROWS);
  for (const s of statements.filter((x) => x.sql.startsWith("INSERT"))) {
    assert(/VALUES \((\?, )*\?\)$/.test(s.sql), `not parameterised: ${s.sql}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
