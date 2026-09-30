#!/usr/bin/env node
/**
 * Dev's data carried to staging (Preview) and live (Publish) — for real
 *   node workers/test/carry.test.mjs
 *
 * Three SQLite databases built from every migration in the repository: dev,
 * a staging that was seeded on its own, and a live that was seeded on its own
 * with a ministry under a different id and a sign-up only it has. Then the
 * real carry(), talking to them through a stand-in for D1's HTTP API.
 *
 * Needs node:sqlite (Node 22). CI runs Node 20, where this says SKIP; the
 * planning underneath is covered everywhere by dbsync.test.mjs.
 */
import fs from "node:fs";

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
console.log("carrying dev's data forward\n");
if (!sqlite) { console.log("  SKIP  node:sqlite is not available on this Node"); process.exit(0); }
const { DatabaseSync } = sqlite;
const { carry } = await import("../src/lib/carry.js");

const ROOT = new URL("../../", import.meta.url).pathname;
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

function built(extra = "") {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, applied_by TEXT, statements INTEGER, baselined INTEGER NOT NULL DEFAULT 0)");
  for (const f of fs.readdirSync(ROOT + "db/migrations").filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) {
    db.exec(fs.readFileSync(ROOT + "db/migrations/" + f, "utf8"));
    db.prepare("INSERT INTO schema_migrations VALUES (?, 'x', 'x', 0, 0)").run(f);
  }
  if (extra) db.exec(extra);
  return db;
}
const binding = (db) => {
  const wrap = (q, args = []) => ({ bind: (...a) => wrap(q, a),
    all: async () => ({ results: db.prepare(q).all(...args) }), first: async () => db.prepare(q).get(...args) });
  return { prepare: (q) => wrap(q) };
};
/** D1's HTTP API, answered by a local database. */
const d1 = (dbs) => async (url, init = {}) => {
  const name = decodeURIComponent((url.split("name=")[1] || ""));
  if (!init.body) return new Response(JSON.stringify({ success: true, result: [{ name, uuid: name }] }));
  const db = dbs[url.split("/database/")[1].split("/")[0]];
  const { sql } = JSON.parse(init.body);
  try {
    if (/^\s*SELECT/i.test(sql) && !/;\s*\S/.test(sql)) {
      return new Response(JSON.stringify({ success: true, result: [{ results: db.prepare(sql).all() }] }));
    }
    db.exec(sql);
    return new Response(JSON.stringify({ success: true, result: [{ results: [] }] }));
  } catch (e) { return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] })); }
};
const one = (db, sql) => db.prepare(sql).get();

/* DEV: the ministry as it is made on the Pi. */
const now = "2026-09-29T00:00:00Z";
const dev = built(fs.readFileSync(ROOT + "db/seed.production-first-admin.sql", "utf8") + `
  INSERT INTO users (id, email, name, status, created_at) VALUES ('u_chase_dev', 'chase.roush@thauma.one', 'Chase Roush', 'active', '${now}');
  INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES ('u_chase_dev','admin','u_chase_dev','${now}'), ('u_chase_dev','partner','u_chase_dev','${now}');
  INSERT INTO partners (id, slug, display_name, status, created_at, updated_at) VALUES ('p_chase_roush', 'chase-roush-dev', 'Chase Roush', 'active', '${now}', '${now}');
  INSERT INTO partner_users (partner_id, user_id, role, granted_by, granted_at) VALUES ('p_chase_roush', 'u_chase_dev', 'owner', 'u_chase_dev', '${now}');
  UPDATE partners SET slug = 'x-old' WHERE id = 'p_chase';
  DELETE FROM partner_languages WHERE partner_id = 'p_chase';
  DELETE FROM partner_users WHERE partner_id = 'p_chase';
  DELETE FROM partners WHERE id = 'p_chase';
  UPDATE partners SET slug = 'chase-roush' WHERE id = 'p_chase_roush';
  INSERT INTO contact_forms (partner_id, deliver_to, updated_at) VALUES (NULL, 'hello@thauma.one', '${now}');
  INSERT INTO partner_sites (partner_id, subdomain, enabled, draft, created_at, updated_at)
    VALUES ('p_chase_roush', 'chaseroush', 0, '${"x".repeat(70000)}', '${now}', '${now}');
`);

/* LIVE: seeded on its own — the same ministry under p_chase — plus a real
   person's sign-up that dev knows nothing about. */
const liveSeed = fs.readFileSync(ROOT + "db/seed.production-first-admin.sql", "utf8") + `
  INSERT INTO mailing_lists (id, partner_id, slug, name, from_name, from_email, created_at, updated_at)
    VALUES ('l_live','p_chase','friends','Friends','Chase','news@thauma.one','${now}','${now}');
  INSERT INTO subscribers (id, partner_id, list_id, email, subscribed_at, updated_at)
    VALUES ('s_live','p_chase','l_live','a.real.person@gmail.com','${now}','${now}');`;

await check("Publish: dev's account and ministry reach live, onto live's own ministry", async () => {
  const live = built(liveSeed);
  const env = { DB: binding(dev), SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t", SYNC_LIVE_DB: "live" };
  const r = await carry(env, { target: "live", branch: "main", who: "t", migrate: false, fetchImpl: d1({ live }) });
  eq(r.matched, [{ table: "partners", dev: "p_chase_roush", live: "p_chase" }], "the same ministry recognized");
  const me = one(live, "SELECT u.status, (SELECT GROUP_CONCAT(role) FROM user_roles WHERE user_id = u.id) AS roles, " +
    "(SELECT GROUP_CONCAT(partner_id || ':' || role) FROM partner_users WHERE user_id = u.id) AS p FROM users u WHERE email = 'chase.roush@thauma.one'");
  eq([me.status, me.p], ["active", "p_chase:owner"], "account, owning live's ministry");
  assert(me.roles.includes("admin"), "with its roles");
  eq(one(live, "SELECT COUNT(*) AS n FROM partners").n, 1, "no second copy of the ministry");
  eq(one(live, "SELECT length(draft) AS n FROM partner_sites WHERE partner_id = 'p_chase'").n, 70000, "a 70 KB website, in pieces, whole");
  eq(one(live, "SELECT COUNT(*) AS n FROM subscribers WHERE id = 's_live'").n, 1, "live's own sign-up kept");
  eq(one(live, "SELECT status, protected FROM users WHERE email = 'admin@thauma.one'"), { status: "active", protected: 1 }, "master account untouched");

  /* And again: publishing twice must be uneventful. */
  await carry(env, { target: "live", branch: "main", who: "t", migrate: false, fetchImpl: d1({ live }) });
  eq(one(live, "SELECT COUNT(*) AS n FROM contact_forms WHERE partner_id IS NULL").n, 1, "the organization's form once, not twice");
  eq(one(live, "SELECT COUNT(*) AS n FROM users").n, 2, "nobody doubled");
});

await check("Preview: staging becomes dev's copy, except the master account it cannot lose", async () => {
  /* The real staging's master account has English set, and the first real
     Preview died deleting the language it points at. */
  const stg = built(fs.readFileSync(ROOT + "db/seed.dev.sql", "utf8") +
    "\nUPDATE users SET protected = 1, preferred_lang = 'en' WHERE email = 'admin@thauma.one';");
  assert(one(stg, "SELECT preferred_lang AS l FROM users WHERE protected = 1").l === "en", "the master account has a language");
  assert(one(stg, "SELECT 1 AS x FROM users WHERE email = 'chase@thauma.one'"), "staging starts with the old seed account");
  const env = { DB: binding(dev), SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t", SYNC_REMOTE_DB: "stg" };
  await carry(env, { target: "staging", branch: "dev", who: "t", migrate: false, fetchImpl: d1({ stg }) });
  for (const t of ["users", "partners", "partner_users", "user_roles", "partner_sites"]) {
    eq(one(stg, `SELECT COUNT(*) AS n FROM ${t}`).n, one(dev, `SELECT COUNT(*) AS n FROM ${t}`).n, t);
  }
  assert(!one(stg, "SELECT 1 AS x FROM users WHERE email = 'chase@thauma.one'"), "the old seed account is gone");
  assert(one(stg, "SELECT 1 AS x FROM users WHERE email = 'chase.roush@thauma.one'"), "the real one is there");
});

await check("staging can never be the live database, whatever .dev.vars says", async () => {
  const env = { DB: binding(dev), SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t", SYNC_REMOTE_DB: "thauma-ops", SYNC_LIVE_DB: "thauma-ops" };
  const r = await carry(env, { target: "staging", branch: "dev", who: "t", migrate: false, fetchImpl: d1({}) });
  assert(r.error && /live database/.test(r.error), "refused");
});

await check("one database: Preview and Publish copy nothing, even with the credential", async () => {
  const full = { DB: binding(dev), SYNC_ACCOUNT_ID: "a", SYNC_D1_TOKEN: "t", SYNC_REMOTE_DB: "stg", SYNC_LIVE_DB: "live", ONE_DATABASE: "thauma-ops" };
  let asked = 0;
  const count = async () => { asked++; return new Response("{}"); };
  for (const target of ["live", "staging"]) {
    eq(await carry(full, { target, branch: "main", who: "t", fetchImpl: count }), { skipped: true }, `${target} skipped`);
  }
  eq(asked, 0, "no request reached any database");
});

await check("without the Pi's credential it does nothing, and says so", async () => {
  const r = await carry({ DB: binding(dev) }, { target: "live", branch: "main", who: "t" });
  eq(r, { skipped: true }, "skipped");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
