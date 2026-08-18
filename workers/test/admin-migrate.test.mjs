#!/usr/bin/env node
/**
 * Tests for workers/src/admin-migrate.js
 *   node workers/test/admin-migrate.test.mjs
 *
 * The binding here is a fake that RECORDS the SQL it is given and can be told
 * to fail on a chosen statement. That is enough to prove the things that
 * actually go wrong with a migration runner:
 *
 *   · applying twice
 *   · applying out of order
 *   · recording a migration that failed
 *   · carrying on after a failure
 *   · baseline pretending to be apply
 *
 * Whether the SQL itself is valid SQLite is a different question, answered by
 * sqlsplit.test.mjs against the real files and by the splitter having been run
 * against the real database.
 */
import handler from "../src/admin-migrate.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------ the fakes ------------------------------- */

/**
 * A D1-shaped binding over a plain array.
 *
 * It understands exactly the four statements this module issues and treats
 * everything else as migration SQL to be remembered. `failOn` makes a chosen
 * migration statement throw, which is the only way to test the failure path.
 */
function fakeBinding({ rows = [], failOn = null } = {}) {
  const state = { rows: [...rows], ran: [], created: false };

  const run = async (sql, binds) => {
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(sql)) {
      state.created = true;
      return { success: true };
    }
    if (/^INSERT INTO schema_migrations/i.test(sql.trim())) {
      state.rows.push({
        name: binds[0], applied_at: binds[1], applied_by: binds[2],
        baselined: /VALUES \(\?, \?, \?, NULL, 1\)/.test(sql) ? 1 : 0,
      });
      return { success: true };
    }
    state.ran.push(sql);
    if (failOn && sql.includes(failOn)) throw new Error("near \"NOPE\": syntax error");
    return { success: true };
  };

  const all = async (sql) => {
    if (/FROM schema_migrations/i.test(sql)) {
      return { results: [...state.rows].sort((a, b) => a.name.localeCompare(b.name)) };
    }
    // user_by_email — the admin gate
    return { results: [{ user_id: "u_1", email: "admin@thauma.one",
                         user_name: "Chase Roush", status: "active", roles: "admin" }] };
  };

  return {
    state,
    prepare(sql) {
      return {
        bind: (...binds) => ({ run: () => run(sql, binds), all: () => all(sql) }),
        run: () => run(sql, []),
        all: () => all(sql),
      };
    },
  };
}

/** Two small migrations, served as if from the repository. */
const FILES = {
  "0001_init.sql": "CREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT);",
  "0002_more.sql": "CREATE TABLE c (id TEXT);",
  "0003_bad.sql":  "CREATE TABLE d (id TEXT);\nNOPE THIS IS NOT SQL;\nCREATE TABLE e (id TEXT);",
  "0004_after.sql": "CREATE TABLE f (id TEXT);",
};

/* ---- a real Access token -------------------------------------------------
   Same approach as admin-content.test.mjs: signed and genuinely verified, so
   the admin gate is exercised on every request below rather than stubbed
   past. This endpoint can execute SQL against production; the gate in front
   of it is the thing most worth not faking. */
const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1";
jwk.alg = "RS256";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mint(email = "admin@thauma.one") {
  const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
  const p = enc({ iss: `https://${TEAM}`, aud: AUD, email, sub: "u-1",
                  exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}
const TOKEN = await mint();

/** Which migration files the repository is pretending to hold, per test. */
let repoNames = ["0001_init.sql", "0002_more.sql"];

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  if (/\/contents\/db\/migrations(\?|$)/.test(u)) {
    return new Response(JSON.stringify(
      repoNames.map((n) => ({ type: "file", name: n, path: `db/migrations/${n}`, sha: "s", size: 1 }))
    ), { status: 200 });
  }
  const m = u.match(/db\/migrations\/([^?]+)/);
  if (m) {
    const name = decodeURIComponent(m[1]);
    return new Response(JSON.stringify({
      type: "file", sha: "s",
      content: Buffer.from(FILES[name] || "", "utf8").toString("base64"),
    }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + u);
};

const ENV = (binding) => ({
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  DB: binding,
  GITHUB_TOKEN: "t",
  GITHUB_REPO: "thauma-one/thauma-site",
  CONTENT_BRANCH: "main",
});

const req = (method, body) => new Request("https://thauma.one/api/admin/migrate", {
  method,
  headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

/** Run `fn` with the repository holding `names`. */
async function withFetch(names, fn) {
  const before = repoNames;
  if (names) repoNames = names;
  try { return await fn(); } finally { repoNames = before; }
}

/* --------------------------------- tests -------------------------------- */

await check("GET lists pending migrations against an empty tracking table", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined, () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(res.status, 200, "status");
  eq(body.pending, ["0001_init.sql", "0002_more.sql"], "pending");
  eq(body.applied, [], "applied");
  assert(b.state.created, "the tracking table was never created");
});

await check("a database with schema but no records asks to be baselined", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined, () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(body.needsBaseline, true, "should offer baseline, not apply");
});

await check("apply runs pending migrations IN ORDER and records each", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined,
    () => handler.fetch(req("POST", { action: "apply", confirm: "MIGRATE" }), ENV(b)));
  const body = await res.json();
  eq(res.status, 200, `status — ${JSON.stringify(body)}`);
  eq(body.ran.map((r) => r.name), ["0001_init.sql", "0002_more.sql"], "order");
  eq(b.state.ran, ["CREATE TABLE a (id TEXT);", "CREATE TABLE b (id TEXT);",
                   "CREATE TABLE c (id TEXT);"], "statements, in order");
  eq(b.state.rows.map((r) => r.name), ["0001_init.sql", "0002_more.sql"], "recorded");
});

await check("an already-applied migration is not run again", async () => {
  const b = fakeBinding({ rows: [{ name: "0001_init.sql", applied_at: "x", applied_by: "y", baselined: 0 }] });
  await withFetch(undefined,
    () => handler.fetch(req("POST", { action: "apply", confirm: "MIGRATE" }), ENV(b)));
  eq(b.state.ran, ["CREATE TABLE c (id TEXT);"], "re-ran an applied migration");
});

await check("nothing pending is a success, not an error", async () => {
  const b = fakeBinding({ rows: [
    { name: "0001_init.sql", applied_at: "x", applied_by: "y", baselined: 0 },
    { name: "0002_more.sql", applied_at: "x", applied_by: "y", baselined: 0 },
  ] });
  const res = await withFetch(undefined,
    () => handler.fetch(req("POST", { action: "apply", confirm: "MIGRATE" }), ENV(b)));
  const body = await res.json();
  eq(res.status, 200, "status");
  eq(body.ran, [], "ran nothing");
});

await check("a failing migration is NOT recorded as applied", async () => {
  /* The one that matters most. Recording a migration that did not finish
     means the next apply skips it, and the schema is permanently wrong with
     nothing saying so. */
  const b = fakeBinding({ failOn: "NOPE" });
  const res = await withFetch(["0001_init.sql", "0003_bad.sql"],
    () => handler.fetch(req("POST", { action: "apply", confirm: "MIGRATE" }), ENV(b)));
  const body = await res.json();
  assert(res.status >= 400, "should not report success");
  eq(body.stoppedAt, "0003_bad.sql", "stopped at");
  eq(b.state.rows.map((r) => r.name), ["0001_init.sql"], "recorded the failed one");
  assert(/statement 2 of 3/.test(body.error), `should say where: ${body.error}`);
  eq(body.partial, true, "statement 1 ran, so the file is half-applied — say so");
});

await check("a failure stops the run — later migrations are not attempted", async () => {
  const b = fakeBinding({ failOn: "NOPE" });
  const res = await withFetch(["0003_bad.sql", "0004_after.sql"],
    () => handler.fetch(req("POST", { action: "apply", confirm: "MIGRATE" }), ENV(b)));
  const body = await res.json();
  eq(body.remaining, ["0004_after.sql"], "remaining");
  assert(!b.state.ran.includes("CREATE TABLE f (id TEXT);"),
         "carried on past a failure");
});

await check("apply refuses without the typed word", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined,
    () => handler.fetch(req("POST", { action: "apply" }), ENV(b)));
  eq(res.status, 400, "status");
  eq(b.state.ran, [], "it ran SQL anyway");
});

await check("an unrecognised action is treated as apply, not waved through", async () => {
  /* Fail toward the confirmation. A typo in the action must not become an
     unguarded execution path. */
  const b = fakeBinding();
  const res = await withFetch(undefined,
    () => handler.fetch(req("POST", { action: "aply" }), ENV(b)));
  eq(res.status, 400, "status");
  eq(b.state.ran, [], "it ran SQL anyway");
});

await check("baseline records without executing anything", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined, () => handler.fetch(
    req("POST", { action: "baseline", confirm: "BASELINE", through: "0002_more.sql" }), ENV(b)));
  const body = await res.json();
  eq(res.status, 200, `status — ${JSON.stringify(body)}`);
  eq(body.marked, ["0001_init.sql", "0002_more.sql"], "marked");
  eq(b.state.ran, [], "baseline must not execute migration SQL");
  assert(b.state.rows.every((r) => r.baselined === 1), "should be flagged as baselined");
});

await check("baseline stops at `through` — later migrations stay pending", async () => {
  const b = fakeBinding();
  await withFetch(undefined, () => handler.fetch(
    req("POST", { action: "baseline", confirm: "BASELINE", through: "0001_init.sql" }), ENV(b)));
  const res = await withFetch(undefined, () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(body.pending, ["0002_more.sql"], "pending after baseline");
});

await check("baseline refuses a name that is not a migration", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined, () => handler.fetch(
    req("POST", { action: "baseline", confirm: "BASELINE", through: "9999_nope.sql" }), ENV(b)));
  eq(res.status, 400, "status");
  eq(b.state.rows, [], "recorded something anyway");
});

await check("baseline refuses without its own word — MIGRATE is not enough", async () => {
  const b = fakeBinding();
  const res = await withFetch(undefined, () => handler.fetch(
    req("POST", { action: "baseline", confirm: "MIGRATE", through: "0001_init.sql" }), ENV(b)));
  eq(res.status, 400, "status");
  eq(b.state.rows, [], "recorded something anyway");
});

await check("files that are not migrations are ignored, and reported", async () => {
  const b = fakeBinding();
  const res = await withFetch(["0001_init.sql", "README.md", "notes.txt"],
    () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(body.pending, ["0001_init.sql"], "pending");
  eq(body.skipped, ["README.md", "notes.txt"], "skipped");
});

await check("a record with no file behind it is surfaced, not hidden", async () => {
  const b = fakeBinding({ rows: [
    { name: "0001_init.sql", applied_at: "x", applied_by: "y", baselined: 0 },
    { name: "0099_renamed.sql", applied_at: "x", applied_by: "y", baselined: 0 },
  ] });
  const res = await withFetch(undefined, () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(body.orphaned, ["0099_renamed.sql"], "orphaned");
});

await check("migrations sort numerically — 0010 comes after 0009, not after 0001", async () => {
  const b = fakeBinding();
  const names = ["0010_ten.sql", "0002_more.sql", "0009_nine.sql", "0001_init.sql"];
  const res = await withFetch(names, () => handler.fetch(req("GET"), ENV(b)));
  const body = await res.json();
  eq(body.pending, ["0001_init.sql", "0002_more.sql", "0009_nine.sql", "0010_ten.sql"], "order");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
