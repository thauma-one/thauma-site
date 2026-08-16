#!/usr/bin/env node
/**
 * Tests for workers/src/lib/github.js
 *   node workers/test/github.test.mjs
 *
 * Two things here are worth testing and the rest is plumbing:
 *
 *   1. BASE64 ROUND-TRIPPING NON-ASCII. Every file this module will ever touch
 *      is Croatian or Serbian. The naive btoa/atob pair does not throw on
 *      Cyrillic coming back — it returns mojibake, which would be committed and
 *      deployed before anyone noticed. English tests cannot catch it.
 *
 *   2. THE SHA BEING MANDATORY. Omitting it turns the Contents API into an
 *      unconditional overwrite, which is the exact accident the SHA exists to
 *      prevent.
 */
import { toBase64, fromBase64, getFile, putFile, githubConfig,
         compareBranches, mergeBranches, __resetTokenCache } from "../src/lib/github.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  __resetTokenCache();
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ENV = { GITHUB_TOKEN: "t", GITHUB_REPO: "thauma-one/thauma-site", CONTENT_BRANCH: "main" };

/* A real RSA key, generated here, exported as PKCS#8 — the format the App
   credential must actually be in. Generating rather than hardcoding means the
   signing path is genuinely exercised. */
const appPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const pkcs8 = await crypto.subtle.exportKey("pkcs8", appPair.privateKey);
const pemBody = Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n");
const APP_PEM = `-----BEGIN PRIVATE KEY-----\n${pemBody}\n-----END PRIVATE KEY-----\n`;

const APP_ENV = {
  GITHUB_REPO: "thauma-one/thauma-site", CONTENT_BRANCH: "main",
  GITHUB_APP_ID: "123456", GITHUB_INSTALLATION_ID: "7654321",
  GITHUB_APP_PRIVATE_KEY: APP_PEM,
};

/** Scripted GitHub that mints an installation token and records every call. */
function appFetch(handler) {
  const seen = [];
  const f = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || "GET",
                auth: (init.headers || {}).Authorization,
                body: init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/access_tokens")) {
      return new Response(JSON.stringify({
        token: "ghs_installation_token",
        expires_at: new Date(Date.now() + 3600e3).toISOString(),
      }), { status: 201 });
    }
    return handler(String(url), init);
  };
  f.seen = seen;
  return f;
}

console.log("github — the Contents API client\n");

/* ---------------------------- base64 ---------------------------- */

await check("round-trips Croatian diacritics", () => {
  const s = "Što je Thauma? Božja služba — čežnja, žrtva, ćud.";
  eq(fromBase64(toBase64(s)), s, "round trip");
});

await check("round-trips Serbian Cyrillic", () => {
  const s = "Шта је Тхаума? Ђорђе, Њива, Џак, Ћирилица.";
  eq(fromBase64(toBase64(s)), s, "round trip");
});

await check("round-trips an emoji (4-byte, outside the BMP)", () => {
  // Surrogate pairs are where a per-character encoder goes wrong differently
  // from how it goes wrong on 2-byte Cyrillic. Both, or neither.
  const s = "prayer 🙏 and fire 🔥";
  eq(fromBase64(toBase64(s)), s, "round trip");
});

await check("round-trips the real en.json shape", () => {
  const s = JSON.stringify({ a: "quote \" and \\ backslash", b: ["x", "y"], c: { d: 1 } }, null, 2);
  eq(JSON.parse(fromBase64(toBase64(s))), JSON.parse(s), "round trip");
});

await check("btoa alone would have been wrong", () => {
  // Stated as a test so the reason the helpers exist survives a refactor that
  // "simplifies" them back to the builtins.
  let threwOrDiffered = false;
  try {
    const naive = btoa("Ђорђе");
    threwOrDiffered = naive !== toBase64("Ђорђе");
  } catch { threwOrDiffered = true; }
  assert(threwOrDiffered, "btoa handled Cyrillic — then these helpers are pointless");
});

await check("decodes GitHub's column-wrapped base64", () => {
  // The API returns base64 with newlines every 60 characters. atob rejects it.
  const raw = toBase64("Božja služba, more than sixty characters of it, so it wraps.");
  const wrapped = raw.replace(/(.{20})/g, "$1\n");
  eq(fromBase64(wrapped), "Božja služba, more than sixty characters of it, so it wraps.", "decoded");
});

/* --------------------------- config ----------------------------- */

await check("no credential at all says so, and says where to look", () => {
  const r = githubConfig({ GITHUB_REPO: "a/b", CONTENT_BRANCH: "main" });
  assert(/GITHUB_APP_ID/.test(r.error), "names the App variables");
  assert(/RUNBOOK/.test(r.error), "points at the instructions");
});

await check("a malformed repo is refused before any request", () => {
  const r = githubConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "not-a-repo", CONTENT_BRANCH: "main" });
  assert(/owner\/name/.test(r.error), "explains the shape");
});

/* ------------------------- GitHub App authentication -------------------- */

await check("the App is preferred over a leftover PAT", () => {
  // A token from an earlier setup must not quietly outrank the credential the
  // organisation actually owns.
  const r = githubConfig({ ...APP_ENV, GITHUB_TOKEN: "leftover-pat" });
  eq(r.auth, "app", "which credential");
});

await check("a PAT alone still works", () => {
  eq(githubConfig(ENV).auth, "pat", "which credential");
});

await check("an App request exchanges a signed JWT for an installation token", async () => {
  const f = appFetch(async () => new Response(JSON.stringify({
    type: "file", sha: "s", content: toBase64("{}"),
  }), { status: 200 }));

  const r = await getFile(APP_ENV, "src/_data/site.json", f);
  eq(r.sha, "s", "read the file");

  const mint = f.seen.find((c) => c.url.includes("/access_tokens"));
  assert(mint, "never minted an installation token");
  eq(mint.method, "POST", "mint method");
  assert(mint.url.includes("/app/installations/7654321/"), "used the installation id");

  // The JWT is signed, three-part, and claims to be the App.
  const jwt = mint.auth.replace(/^Bearer /, "");
  eq(jwt.split(".").length, 3, "JWT parts");
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
  eq(payload.iss, "123456", "issuer is the App id");
  assert(payload.iat < Math.floor(Date.now() / 1000), "iat must be backdated for clock skew");
  assert(payload.exp - payload.iat <= 600, "GitHub caps App JWTs at ten minutes");

  // The repository call uses the INSTALLATION token, never the JWT.
  const read = f.seen.find((c) => c.url.includes("/contents/"));
  eq(read.auth, "Bearer ghs_installation_token", "wrong credential on the repo call");
});

await check("the installation token is cached, not re-minted per request", async () => {
  const f = appFetch(async () => new Response(JSON.stringify({
    type: "file", sha: "s", content: toBase64("{}"),
  }), { status: 200 }));

  await getFile(APP_ENV, "src/_data/site.json", f);
  await getFile(APP_ENV, "src/_data/i18n/en.json", f);
  await getFile(APP_ENV, "src/_data/i18n/hr.json", f);

  const mints = f.seen.filter((c) => c.url.includes("/access_tokens"));
  eq(mints.length, 1, "minted a token per request — three round trips became six");
});

await check("a PKCS#1 key says exactly which command converts it", async () => {
  /* GitHub hands you PKCS#1; WebCrypto imports PKCS#8 and nothing else, and
     its own failure names neither format. This is the message that turns a
     twenty-minute confusion into a thirty-second fix. */
  const f = appFetch(async () => new Response("{}", { status: 200 }));
  const r = await getFile(
    { ...APP_ENV, GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----" },
    "src/_data/site.json", f);
  assert(/PKCS#1/.test(r.error), "should name the format it got");
  assert(/openssl pkcs8 -topk8/.test(r.error), "should give the command");
});

await check("a rejected App credential does not look like a missing file", async () => {
  const f = async (url) => {
    if (String(url).includes("/access_tokens")) {
      return new Response(JSON.stringify({ message: "Integration not found" }), { status: 404 });
    }
    throw new Error("should not have reached the repository");
  };
  const r = await getFile(APP_ENV, "src/_data/site.json", f);
  assert(/installation token/.test(r.error), `unclear: ${r.error}`);
  assert(/GITHUB_APP_ID/.test(r.error), "should say what to check");
});

/* ---------------------------- getFile --------------------------- */

await check("getFile reads at the configured branch", async () => {
  let seen = null;
  const fake = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({
      type: "file", sha: "abc123", content: toBase64('{"hi":"Bok"}'),
    }), { status: 200 });
  };
  const r = await getFile(ENV, "src/_data/i18n/hr.json", fake);
  eq(r.sha, "abc123", "sha");
  eq(JSON.parse(r.text), { hi: "Bok" }, "content");
  assert(seen.url.includes("ref=main"), "asked for the branch");
  assert(seen.init.headers.Authorization === "Bearer t", "sent the token");
  assert(seen.init.headers["User-Agent"], "sent a User-Agent — GitHub rejects requests without one");
});

await check("a missing file is 404, not 500", async () => {
  const fake = async () => new Response("{}", { status: 404 });
  const r = await getFile(ENV, "src/_data/i18n/xx.json", fake);
  eq(r.status, 404, "status");
});

await check("a GitHub failure surfaces GitHub's message", async () => {
  const fake = async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
  const r = await getFile(ENV, "src/_data/site.json", fake);
  assert(/Bad credentials/.test(r.error), `lost the reason: ${r.error}`);
});

/* ---------------------------- putFile --------------------------- */

await check("putFile REFUSES without a SHA", async () => {
  // Without one the Contents API treats the write as a create, which for an
  // existing path is an unconditional overwrite.
  let called = false;
  const fake = async () => { called = true; return new Response("{}", { status: 200 }); };
  const r = await putFile(ENV, { path: "src/_data/site.json", text: "{}", message: "m" }, fake);
  eq(r.status, 400, "status");
  assert(!called, "it sent the request anyway");
});

await check("putFile sends branch, sha and UTF-8 content", async () => {
  let body = null;
  const fake = async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      content: { sha: "new" }, commit: { sha: "c1", html_url: "https://gh/c1" },
    }), { status: 200 });
  };
  const r = await putFile(ENV, {
    path: "src/_data/i18n/sr.json", text: '{"a":"Ђорђе"}', sha: "old",
    message: "Update Serbian", authorName: "Chase Roush", authorEmail: "chase@thauma.one",
  }, fake);

  eq(body.sha, "old", "sent the sha it read");
  eq(body.branch, "main", "sent the branch");
  eq(JSON.parse(fromBase64(body.content)), { a: "Ђорђе" }, "content survived the trip");
  eq(body.author.name, "Chase Roush", "attributed the commit to the person");
  eq(r.commit, "c1", "returned the commit");
});

await check("a stale SHA is a clear conflict, not a server error", async () => {
  const fake = async () => new Response(JSON.stringify({ message: "is at abc but expected def" }), { status: 409 });
  const r = await putFile(ENV, { path: "p", text: "{}", sha: "stale", message: "m" }, fake);
  eq(r.status, 409, "status");
  assert(/Nothing was written/.test(r.error), "must say the write did not happen");
  assert(/[Rr]eload/.test(r.error), "must say what to do about it");
});

/* --------------------------- branches --------------------------- */

await check("compare reports the gap AND what is in it", async () => {
  const fake = async () => new Response(JSON.stringify({
    status: "ahead", ahead_by: 2, behind_by: 0,
    commits: [
      { sha: "aaaaaaa1", commit: { message: "older\n\nbody", author: { name: "Chase", date: "2026-08-14T10:00:00Z" } } },
      { sha: "bbbbbbb2", commit: { message: "newer", author: { name: "Chase", date: "2026-08-15T10:00:00Z" } } },
    ],
    files: [{ filename: "src/_data/i18n/hr.json" }],
  }), { status: 200 });

  const r = await compareBranches(ENV, "main", "dev", fake);
  eq(r.ahead_by, 2, "count");
  eq(r.status_, "ahead", "relationship");
  eq(r.commits[0].message, "newer", "newest first, like everything else here");
  eq(r.commits[0].sha, "bbbbbbb", "short sha");
  eq(r.files, ["src/_data/i18n/hr.json"], "files");
});

await check("compare passes GitHub's 'diverged' through rather than flattening it", async () => {
  // ahead_by > 0 renders a diverged pair as an ordinary promote. It is not
  // one: the merge can conflict, and the page has to be able to say so.
  const fake = async () => new Response(JSON.stringify({
    status: "diverged", ahead_by: 3, behind_by: 1, commits: [], files: [],
  }), { status: 200 });
  const r = await compareBranches(ENV, "main", "dev", fake);
  eq(r.status_, "diverged", "relationship");
  eq(r.behind_by, 1, "behind count");
});

await check("merge sends base, head and a message", async () => {
  let body = null;
  const fake = async (_u, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ sha: "merge1", html_url: "https://gh/m1" }), { status: 201 });
  };
  const r = await mergeBranches(ENV, { base: "main", head: "dev", message: "Publish" }, fake);
  eq(body.base, "main", "base");
  eq(body.head, "dev", "head");
  eq(r.commit, "merge1", "commit");
});

await check("nothing to merge is a fact, not a failure", async () => {
  const fake = async () => new Response(null, { status: 204 });
  const r = await mergeBranches(ENV, { base: "main", head: "dev", message: "m" }, fake);
  eq(r.alreadyUpToDate, true, "should report the desired end state plainly");
  assert(!r.error, "reported an error for the state we wanted");
});

await check("a conflict says a person with a terminal is needed", async () => {
  const fake = async () => new Response(JSON.stringify({ message: "Merge conflict" }), { status: 409 });
  const r = await mergeBranches(ENV, { base: "main", head: "dev", message: "m" }, fake);
  eq(r.status, 409, "status");
  assert(/Nothing was changed/.test(r.error), "must say the merge did not happen");
  assert(/terminal/.test(r.error), "must say what it actually takes to fix");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
