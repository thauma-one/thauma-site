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
import { toBase64, fromBase64, getFile, putFile, githubConfig } from "../src/lib/github.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ENV = { GITHUB_TOKEN: "t", GITHUB_REPO: "thauma-one/thauma-site", CONTENT_BRANCH: "main" };

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

await check("a missing token says so, and says how to fix it", () => {
  const r = githubConfig({ GITHUB_REPO: "a/b", CONTENT_BRANCH: "main" });
  assert(/GITHUB_TOKEN/.test(r.error), "names the variable");
  assert(/wrangler secret put/.test(r.error), "says how to set it");
});

await check("a malformed repo is refused before any request", () => {
  const r = githubConfig({ GITHUB_TOKEN: "t", GITHUB_REPO: "not-a-repo", CONTENT_BRANCH: "main" });
  assert(/owner\/name/.test(r.error), "explains the shape");
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
