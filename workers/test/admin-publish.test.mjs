#!/usr/bin/env node
/**
 * Tests for workers/src/admin-publish.js
 *   node workers/test/admin-publish.test.mjs
 *
 * This endpoint takes everything on the working branch and makes it live. Its
 * blast radius is the whole site, so the tests are about the things standing
 * between a click and a release:
 *
 *   · the admin role
 *   · the confirmation word, checked on the SERVER
 *   · the gap being re-read at merge time rather than trusted from the browser
 *   · migrations being named rather than buried in a file list
 */
import handler from "../src/admin-publish.js";
import { __resetTokenCache } from "../src/lib/github.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  __resetTokenCache();
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------- harness ------------------------------- */

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1"; jwk.alg = "RS256";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "admin@thauma.one", sub: "u-1",
                exp: Math.floor(Date.now() / 1000) + 600 });
const TOKEN = `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
  pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;

function envWith(roles, extra = {}) {
  return {
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    GITHUB_TOKEN: "t", GITHUB_REPO: "thauma-one/thauma-site",
    CONTENT_BRANCH: "main", LIVE_BRANCH: "main", STAGING_BRANCH: "dev",
    ...extra,
    DB: {
      prepare() {
        return { bind() { return { async all() {
          return { results: roles === null ? [] : [{ id: "u_1", name: "Chase Roush", roles }] };
        } }; } };
      },
    },
  };
}

/** GitHub, scripted. `seen` records only the GitHub calls. */
let github = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  if (!github) throw new Error("unexpected fetch, no GitHub stub active: " + u);
  return github.handle(u, init);
};

function stubGitHub({ ahead = 2, behind = 0, status_ = "ahead", files = [],
                      mergeStatus = 201 } = {}) {
  const seen = [];
  seen.handle = async (u, init) => {
    seen.push({ url: u, method: init.method || "GET",
                body: init.body ? JSON.parse(init.body) : null });
    if (u.includes("/compare/")) {
      return new Response(JSON.stringify({
        status: status_, ahead_by: ahead, behind_by: behind,
        commits: Array.from({ length: ahead }, (_, i) => ({
          sha: `sha${i}0000`,
          commit: { message: `commit ${i}`, author: { name: "Chase", date: "2026-08-15T10:00:00Z" } },
        })),
        files: files.map((f) => ({ filename: f })),
        permalink_url: "https://gh/compare",
      }), { status: 200 });
    }
    if (u.endsWith("/merges")) {
      if (mergeStatus === 204) return new Response(null, { status: 204 });
      if (mergeStatus === 409) {
        return new Response(JSON.stringify({ message: "Merge conflict" }), { status: 409 });
      }
      return new Response(JSON.stringify({ sha: "merge1", html_url: "https://gh/m1" }), { status: 201 });
    }
    throw new Error("unexpected GitHub call: " + u);
  };
  seen.restore = () => { github = null; };
  github = seen;
  return seen;
}

const req = (method, body) =>
  new Request("https://x/api/admin/publish", {
    method,
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });

console.log("admin-publish — the button that ships everything\n");

/* -------------------------------- the gate ----------------------------- */

await check("no Access token is refused", async () => {
  const res = await handler.fetch(new Request("https://x/api/admin/publish"), envWith("admin"));
  eq(res.status, 401, "status");
});

await check("a signed-in NON-admin cannot publish", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { confirm: "PUBLISH" }), envWith("partner,staff"));
    eq(res.status, 403, "status");
    assert(!g.some((c) => c.url.endsWith("/merges")), "it merged anyway");
  } finally { g.restore(); }
});

await check("a misconfigured deploy FAILS CLOSED", async () => {
  const res = await handler.fetch(req("GET"), { DB: {} });
  eq(res.status, 500, "status");
});

await check("no handler method throws", async () => {
  const g = stubGitHub();
  try {
    for (const m of ["GET", "POST", "PUT", "DELETE"]) {
      const res = await handler.fetch(req(m, m === "GET" ? undefined : {}), envWith("admin"));
      assert(res && typeof res.status === "number", `${m} returned no Response`);
      await res.json().catch(() => ({}));
    }
  } finally { g.restore(); }
});

/* -------------------------------- status ------------------------------- */

await check("GET reports the gap and lists what is in it", async () => {
  const g = stubGitHub({ ahead: 3, files: ["src/_data/i18n/hr.json", "workers/src/worker.js"] });
  try {
    const res = await handler.fetch(req("GET"), envWith("admin"));
    const b = await res.json();
    eq(b.waiting, 3, "waiting");
    eq(b.live, "main", "live branch");
    eq(b.staging, "dev", "staging branch");
    eq(b.commits.length, 3, "commit list");
    assert(b.files.includes("workers/src/worker.js"), "file list");
    eq(b.confirm_word, "PUBLISH", "the word the browser must collect");
  } finally { g.restore(); }
});

await check("MIGRATIONS in a release are named, not buried in the file list", async () => {
  /* Code that expects a table the production database has not got fails after
     deploying, on a live site. This is the warning that has to arrive before
     the button, not after the outage. */
  const g = stubGitHub({
    ahead: 4,
    files: ["src/_data/site.json", "db/migrations/0009_thing.sql", "db/migrations/0010_other.sql"],
  });
  try {
    const res = await handler.fetch(req("GET"), envWith("admin"));
    const b = await res.json();
    eq(b.migrations, ["db/migrations/0009_thing.sql", "db/migrations/0010_other.sql"], "migrations");
  } finally { g.restore(); }
});

await check("a release with no migrations says so with an empty list", async () => {
  const g = stubGitHub({ files: ["src/_data/i18n/hr.json"] });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.migrations, [], "migrations");
  } finally { g.restore(); }
});

await check("drift — live commits staging has not got — is reported", async () => {
  // Production's own content editor commits to main, so this WILL happen.
  const g = stubGitHub({ ahead: 2, behind: 1, status_: "diverged" });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.drifted, 1, "drifted");
    eq(b.relationship, "diverged", "relationship");
  } finally { g.restore(); }
});

/* ------------------------------- publishing ---------------------------- */

await check("publishing WITHOUT the confirmation word is refused", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { direction: "publish" }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((c) => c.url.endsWith("/merges")), "it merged without the word");
  } finally { g.restore(); }
});

await check("the wrong word is refused too", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { direction: "publish", confirm: "publish" }),
                                    envWith("admin"));
    eq(res.status, 400, "lowercase must not pass");
    assert(!g.some((c) => c.url.endsWith("/merges")), "it merged anyway");
  } finally { g.restore(); }
});

await check("publishing merges staging INTO live, not the other way round", async () => {
  const g = stubGitHub({ ahead: 2 });
  try {
    const res = await handler.fetch(req("POST", { direction: "publish", confirm: "PUBLISH" }),
                                    envWith("admin"));
    const b = await res.json();
    eq(res.status, 200, "status");
    const merge = g.find((c) => c.url.endsWith("/merges"));
    eq(merge.body.base, "main", "base must be the live branch");
    eq(merge.body.head, "dev", "head must be the staging branch");
    eq(b.deploying, true, "publishing triggers the deploy");
    eq(b.merged, 2, "count");
  } finally { g.restore(); }
});

await check("the commit message lists what shipped", async () => {
  const g = stubGitHub({ ahead: 3 });
  try {
    await handler.fetch(req("POST", { direction: "publish", confirm: "PUBLISH" }), envWith("admin"));
    const merge = g.find((c) => c.url.endsWith("/merges"));
    assert(/commit 0/.test(merge.body.commit_message), "should list the subjects");
    assert(/Chase Roush/.test(merge.body.commit_message), "should name who published");
  } finally { g.restore(); }
});

await check("the gap is re-read at merge time, not trusted from the browser", async () => {
  // What the page showed may be minutes old, and it is what gets audited.
  const g = stubGitHub({ ahead: 2 });
  try {
    await handler.fetch(req("POST", { direction: "publish", confirm: "PUBLISH" }), envWith("admin"));
    const compares = g.filter((c) => c.url.includes("/compare/"));
    eq(compares.length, 1, "should compare again during the POST");
    assert(g.findIndex((c) => c.url.includes("/compare/")) <
           g.findIndex((c) => c.url.endsWith("/merges")), "compared after merging");
  } finally { g.restore(); }
});

await check("publishing when there is nothing to publish is not an error", async () => {
  const g = stubGitHub({ ahead: 0 });
  try {
    const res = await handler.fetch(req("POST", { direction: "publish", confirm: "PUBLISH" }),
                                    envWith("admin"));
    const b = await res.json();
    eq(res.status, 200, "status");
    eq(b.alreadyUpToDate, true, "should say so plainly");
    assert(!g.some((c) => c.url.endsWith("/merges")), "merged nothing into nothing");
  } finally { g.restore(); }
});

await check("a merge conflict says a person with a terminal is needed", async () => {
  const g = stubGitHub({ ahead: 2, mergeStatus: 409 });
  try {
    const res = await handler.fetch(req("POST", { direction: "publish", confirm: "PUBLISH" }),
                                    envWith("admin"));
    eq(res.status, 409, "status");
    const b = await res.json();
    assert(/terminal/.test(b.error), "should say what it actually takes");
  } finally { g.restore(); }
});

/* --------------------------------- sync -------------------------------- */

await check("sync merges live INTO staging, and needs no confirmation word", async () => {
  /* Pulling commits into the working branch changes nothing anybody can see.
     Ceremony people perform by reflex stops being a check, so it is spent only
     on the direction that reaches the public. */
  const g = stubGitHub({ ahead: 1 });
  try {
    const res = await handler.fetch(req("POST", { direction: "sync" }), envWith("admin"));
    eq(res.status, 200, "status");
    const merge = g.find((c) => c.url.endsWith("/merges"));
    eq(merge.body.base, "dev", "base must be the staging branch");
    eq(merge.body.head, "main", "head must be the live branch");
    const b = await res.json();
    eq(b.deploying, false, "a sync must not claim a deploy is running");
  } finally { g.restore(); }
});

await check("an unknown direction is treated as publish, so it still needs the word", async () => {
  // Fail toward the guarded path, never away from it.
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { direction: "wat" }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((c) => c.url.endsWith("/merges")), "it merged anyway");
  } finally { g.restore(); }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
