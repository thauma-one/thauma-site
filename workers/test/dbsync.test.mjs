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
  realAddresses, SKIP_TABLES, planMerge, planReplace, scripts, LIVE_KEEPS,
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

/* ---- carrying dev's data forward (Preview and Publish) ---- */

const CMETA = {
  users: { cols: ["id", "email", "protected"], pk: ["id"], uniques: [["email"]], fks: [] },
  partners: { cols: ["id", "slug"], pk: ["id"], uniques: [["slug"]], fks: [] },
  partner_users: { cols: ["partner_id", "user_id", "role"], pk: ["partner_id", "user_id"], uniques: [],
    fks: [{ from: "partner_id", table: "partners", to: "id" }, { from: "user_id", table: "users", to: "id" }] },
  subscribers: { cols: ["id", "email"], pk: ["id"], uniques: [], fks: [] },
  contact_forms: { cols: ["partner_id", "heading"], pk: ["partner_id"], uniques: [], fks: [] },
};
const CORDER = ["users", "partners", "partner_users", "subscribers", "contact_forms"];
const CDEV = {
  users: [{ id: "u_d", email: "Chase.Roush@thauma.one", protected: 0 }],
  partners: [{ id: "p_chase_roush", slug: "chase-roush" }],
  partner_users: [{ partner_id: "p_chase_roush", user_id: "u_d", role: "owner" }],
  subscribers: [{ id: "s1", email: "x@example.com" }],
  contact_forms: [{ partner_id: null, heading: "Hi" }],
};

check("Publish: the same ministry under another id is live's, and its members follow it", () => {
  const { statements, matched } = planMerge(CORDER, CDEV, CMETA, { partners: [{ id: "p_chase", slug: "chase-roush" }], users: [] });
  eq(matched, [{ table: "partners", dev: "p_chase_roush", live: "p_chase" }], "matched on the slug");
  const pu = statements.find((x) => /INTO partner_users/.test(x.sql));
  eq(pu.params.slice(0, 2), ["p_chase", "u_d"], "membership points at live's id");
  assert(statements.every((x) => !/^DELETE/.test(x.sql)), "nothing is deleted on live");
  assert(/ON CONFLICT \(id\) DO UPDATE SET email = excluded.email/.test(statements[0].sql), "dev's version wins");
});

check("Publish: what only live has is not touched; an email matches whatever its case", () => {
  const { statements, matched } = planMerge(CORDER, CDEV, CMETA, { users: [{ id: "u_live", email: "chase.roush@thauma.one" }], partners: [] });
  assert(LIVE_KEEPS.has("subscribers") && !statements.some((x) => /subscribers/.test(x.sql)), "sign-ups left alone");
  eq(matched[0], { table: "users", dev: "u_d", live: "u_live" }, "the same person");
});

check("a NULL key is updated in place and added only when absent", () => {
  const { statements } = planMerge(CORDER, CDEV, CMETA, {});
  const cf = statements.filter((x) => /contact_forms/.test(x.sql));
  assert(/^UPDATE contact_forms SET heading = \? WHERE partner_id IS \?/.test(cf[0].sql), "update where it is");
  assert(/WHERE NOT EXISTS/.test(cf[1].sql), "insert only if missing");
});

check("Preview: staging replaced, but never the master account or its roles", () => {
  const meta = { ...CMETA, user_roles: { cols: ["user_id", "role"], pk: ["user_id", "role"], uniques: [], fks: [] } };
  const { statements } = planReplace(["users", "user_roles", "subscribers"], { ...CDEV, user_roles: [] }, meta, {});
  eq(statements.filter((x) => /^DELETE/.test(x.sql)).map((x) => x.sql), [
    "DELETE FROM subscribers",
    "DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users WHERE protected = 1)",
    "DELETE FROM users WHERE protected = 0",
  ], "deletes in reverse order, the master account spared");
  const sub = statements.find((x) => /INTO subscribers/.test(x.sql));
  assert(sub.params[1] !== "x@example.com", "personal columns scrubbed on staging");
});

check("a long value goes in pieces, each small enough for D1", () => {
  const big = "é".repeat(50000);
  const meta = { notes: { cols: ["id", "body"], pk: ["id"], uniques: [], fks: [] } };
  const { statements } = planMerge(["notes"], { notes: [{ id: "n1", body: big }] }, meta, {});
  eq(statements.length, 4, "one insert, three appends");
  eq(statements.slice(1).map((x) => x.params[0]).join(""), big, "the whole value, in order");
  const parts = scripts(statements, 90000);
  assert(parts.every((p) => new TextEncoder().encode(p).length <= 90000 + 70000), "requests stay bounded");
});

check("a site's own translation count is never carried to another", () => {
  assert(SKIP_TABLES.has("ai_usage"), "ai_usage would be copied");
  eq(copyableTables(["ai_usage", "users"]), ["users"], "left out of every transfer");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
