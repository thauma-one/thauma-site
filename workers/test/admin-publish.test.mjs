#!/usr/bin/env node
/**
 * Tests for workers/src/admin-publish.js
 *   node workers/test/admin-publish.test.mjs
 *
 * This endpoint takes everything that has been saved and makes it public. Its
 * blast radius is the whole site, so the tests are about the things standing
 * between a click and a release:
 *
 *   · the admin role
 *   · the confirmation word, checked on the SERVER, on the right action only
 *   · "what is live" coming from the DEPLOY rather than from the branch
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

function stubGitHub({ ahead = 2, files = [], lastProdSha = "live000",
                      prodNever = false, previewSha = "live000",
                      dispatchStatus = 204 } = {}) {
  const seen = [];
  seen.handle = async (u, init) => {
    seen.push({ url: u, method: init.method || "GET",
                body: init.body ? JSON.parse(init.body) : null });

    if (u.includes("/actions/workflows/") && u.includes("/runs")) {
      const isProd = u.includes("deploy.yml");
      if (isProd && prodNever) {
        return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ workflow_runs: [{
        head_sha: isProd ? lastProdSha : previewSha,
        updated_at: "2026-08-16T10:00:00Z",
        html_url: "https://gh/run", run_number: 7,
      }] }), { status: 200 });
    }

    if (u.includes("/actions/workflows/") && u.endsWith("/dispatches")) {
      if (dispatchStatus === 403) {
        return new Response(JSON.stringify({ message: "Resource not accessible" }), { status: 403 });
      }
      return new Response(null, { status: 204 });
    }

    if (u.includes("/compare/")) {
      return new Response(JSON.stringify({
        status: ahead ? "ahead" : "identical", ahead_by: ahead, behind_by: 0,
        commits: Array.from({ length: ahead }, (_, i) => ({
          sha: `sha${i}0000`,
          commit: { message: `Update hr content: 1 value [skip ci]`,
                    author: { name: "Chase", date: "2026-08-16T10:00:00Z" } },
        })),
        files: files.map((f) => ({ filename: f })),
        permalink_url: "https://gh/compare",
      }), { status: 200 });
    }

    if (u.includes("/commits/")) return new Response("head000", { status: 200 });

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

console.log("admin-publish — Preview and Publish\n");

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
    assert(!g.some((c) => c.url.endsWith("/dispatches")), "it built anyway");
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

await check("GET asks the DEPLOY what is live, not the branch", async () => {
  /* A branch does not record which of its commits is deployed. Comparing
     against the branch tip would always say "nothing waiting", which is the
     one answer that is never useful. */
  const g = stubGitHub({ ahead: 3, files: ["src/_data/i18n/hr.json"] });
  try {
    const res = await handler.fetch(req("GET"), envWith("admin"));
    const b = await res.json();
    eq(b.waiting, 3, "waiting");
    eq(b.published.sha, "live000", "published sha");
    assert(g.some((c) => c.url.includes("deploy.yml/runs")), "never asked the production workflow");
    assert(g.some((c) => c.url.includes("status=success")),
           "must ignore failed runs — a failed deploy published nothing");
  } finally { g.restore(); }
});

await check("a site that has never published says so instead of comparing", async () => {
  const g = stubGitHub({ prodNever: true });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.neverPublished, true, "neverPublished");
    assert(!g.some((c) => c.url.includes("/compare/")),
           "compared against a commit that does not exist");
  } finally { g.restore(); }
});

await check("MIGRATIONS are named, not buried in the file list", async () => {
  const g = stubGitHub({ ahead: 4,
    files: ["src/_data/site.json", "db/migrations/0009_a.sql", "db/migrations/0010_b.sql"] });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.migrations, ["db/migrations/0009_a.sql", "db/migrations/0010_b.sql"], "migrations");
  } finally { g.restore(); }
});

await check("the page can tell whether the preview is current", async () => {
  // A preview quietly out of date is worse than none, because it is believed.
  const fresh = stubGitHub({ previewSha: "head000" });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.preview.current, true, "preview matches the branch head");
  } finally { fresh.restore(); }

  const stale = stubGitHub({ previewSha: "older00" });
  try {
    const b = await (await handler.fetch(req("GET"), envWith("admin"))).json();
    eq(b.preview.current, false, "preview is behind and must say so");
  } finally { stale.restore(); }
});

/* ------------------------------- publishing ---------------------------- */

await check("publishing WITHOUT the confirmation word is refused", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { action: "publish" }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((c) => c.url.endsWith("/dispatches")), "it built anyway");
  } finally { g.restore(); }
});

await check("the wrong word is refused too", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { action: "publish", confirm: "publish" }),
                                    envWith("admin"));
    eq(res.status, 400, "lowercase must not pass");
    assert(!g.some((c) => c.url.endsWith("/dispatches")), "it built anyway");
  } finally { g.restore(); }
});

await check("publish builds PRODUCTION from the site branch", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { action: "publish", confirm: "PUBLISH" }),
                                    envWith("admin"));
    const b = await res.json();
    eq(res.status, 200, "status");
    const d = g.find((c) => c.url.endsWith("/dispatches"));
    assert(d.url.includes("deploy.yml"), "wrong workflow: " + d.url);
    eq(d.body.ref, "main", "must build the site branch");
    eq(b.where, "thauma.one", "where");
  } finally { g.restore(); }
});

await check("preview builds STAGING, and needs no confirmation", async () => {
  /* Preview changes nothing anybody outside can see. A dialog on a harmless
     action trains people to dismiss dialogs, which costs you the one on the
     action that matters. */
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { action: "preview" }), envWith("admin"));
    eq(res.status, 200, "status");
    const d = g.find((c) => c.url.endsWith("/dispatches"));
    assert(d.url.includes("deploy-staging.yml"), "wrong workflow: " + d.url);
    const b = await res.json();
    eq(b.where, "next.thauma.one", "where");
  } finally { g.restore(); }
});

await check("an unknown action is treated as publish, so it still needs the word", async () => {
  // Fail toward the guarded path, never away from it.
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("POST", { action: "wat" }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((c) => c.url.endsWith("/dispatches")), "it built anyway");
  } finally { g.restore(); }
});

await check("a missing Actions permission is reported, not swallowed", async () => {
  const g = stubGitHub({ dispatchStatus: 403 });
  try {
    const res = await handler.fetch(req("POST", { action: "preview" }), envWith("admin"));
    eq(res.status, 403, "status");
    const b = await res.json();
    assert(/Actions: read and write/.test(b.error), "must name the permission");
  } finally { g.restore(); }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
