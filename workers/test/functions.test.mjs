#!/usr/bin/env node
/**
 * Tests for the ported Workers functions.
 *
 *   node workers/test/functions.test.mjs
 *
 * The sanitisation tests matter most: that logic was carried over verbatim
 * from the Netlify versions, and these assert the port did not quietly change
 * behaviour. The auth tests assert staff-data cannot be read or written
 * without a valid Access token — including when the deploy is misconfigured.
 */
import { memoryStore } from "../src/lib/store.js";
import * as game from "../src/game-scores.js";
import * as staff from "../src/staff-data.js";
import worker from "../src/worker.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const post = (body) => new Request("https://x/", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
});
const get = (headers = {}) => new Request("https://x/", { method: "GET", headers });

/* ===================== game-scores ===================== */
console.log("game-scores\n");

await check("GET on an empty store returns the empty shape", async () => {
  const r = await game.handle(get(), {}, memoryStore());
  eq(await r.json(), { scores: [], totalDeaths: 0 }, "empty");
});

await check("a score is added and read back", async () => {
  const s = memoryStore();
  await game.handle(post({ name: "Chase", score: 120 }), {}, s);
  const r = await game.handle(get(), {}, s);
  eq((await r.json()).scores, [{ name: "Chase", score: 120 }], "scores");
});

await check("only the top 3 survive, highest first", async () => {
  const s = memoryStore();
  for (const n of [50, 300, 10, 200, 400]) {
    await game.handle(post({ name: "P" + n, score: n }), {}, s);
  }
  const { scores } = await (await game.handle(get(), {}, s)).json();
  eq(scores.map((x) => x.score), [400, 300, 200], "top three");
});

await check("crude names are replaced entirely, including leetspeak", async () => {
  eq(game.sanitizeName("sh1t"), "Anonymous", "leet sh1t");
  eq(game.sanitizeName("F   U   C   K"), "Anonymous", "spaced");
  eq(game.sanitizeName("@sshole"), "Anonymous", "symbol substitution");
  eq(game.sanitizeName("$hit"), "Anonymous", "dollar substitution");
  eq(game.sanitizeName("Chase"), "Chase", "clean name survived");
});

await check("KNOWN LIMITATION: substring matching over-blocks (Scunthorpe)", async () => {
  // Documented, not fixed. Substring matching means an innocent name
  // containing a blocked word is renamed. True of the original too; for a
  // hidden leaderboard, over-blocking is the cheaper mistake. This test
  // exists so the behaviour is a known decision rather than a surprise.
  eq(game.sanitizeName("Scunthorpe"), "Anonymous", "Scunthorpe now passes — did the policy change?");
});

await check("names are stripped of markup and clamped to 20 chars", async () => {
  eq(game.sanitizeName("<script>x</script>"), "scriptxscript", "html stripped");
  assert(game.sanitizeName("A".repeat(50)).length === 20, "not clamped");
  eq(game.sanitizeName("   "), "Anonymous", "whitespace-only");
  eq(game.sanitizeName(12345), "Anonymous", "non-string");
});

await check("non-latin names are preserved", async () => {
  eq(game.sanitizeName("Тomislav"), "Тomislav", "cyrillic dropped");
  eq(game.sanitizeName("Željko"), "Željko", "diacritic dropped");
});

await check("scores are clamped and never negative", async () => {
  eq(game.sanitizeScore(-5), 0, "negative");
  eq(game.sanitizeScore(1e9), 999999, "over max");
  eq(game.sanitizeScore("abc"), 0, "NaN");
  eq(game.sanitizeScore(12.9), 12, "floored");
});

await check("a zero score is not recorded", async () => {
  const s = memoryStore();
  await game.handle(post({ name: "Nobody", score: 0 }), {}, s);
  eq((await (await game.handle(get(), {}, s)).json()).scores, [], "zero recorded");
});

await check("death increments the counter", async () => {
  const s = memoryStore();
  await game.handle(post({ death: true }), {}, s);
  await game.handle(post({ death: true }), {}, s);
  eq((await (await game.handle(get(), {}, s)).json()).totalDeaths, 2, "deaths");
});

await check("delete requires the admin token", async () => {
  const s = memoryStore({ data: { scores: [{ name: "A", score: 9 }], totalDeaths: 0 } });
  const env = { GAME_ADMIN_TOKEN: "secret" };
  eq((await game.handle(post({ action: "delete", index: 0 }), env, s)).status, 403, "no token");
  eq((await game.handle(post({ action: "delete", index: 0, token: "wrong" }), env, s)).status, 403, "wrong token");
  const ok = await game.handle(post({ action: "delete", index: 0, token: "secret" }), env, s);
  eq(ok.status, 200, "right token");
  eq((await ok.json()).scores, [], "not deleted");
});

await check("delete is DISABLED, not open, when no token is configured", async () => {
  const s = memoryStore({ data: { scores: [{ name: "A", score: 9 }], totalDeaths: 0 } });
  const r = await game.handle(post({ action: "delete", index: 0, token: "" }), {}, s);
  eq(r.status, 403, "unconfigured deploy allowed a delete");
});

await check("out-of-range delete index is ignored, not an error", async () => {
  const s = memoryStore({ data: { scores: [{ name: "A", score: 9 }], totalDeaths: 0 } });
  const env = { GAME_ADMIN_TOKEN: "secret" };
  const r = await game.handle(post({ action: "delete", index: 99, token: "secret" }), env, s);
  eq(r.status, 200, "status");
  eq((await r.json()).scores.length, 1, "list changed");
});

await check("invalid JSON is a 400", async () => {
  const bad = new Request("https://x/", { method: "POST", body: "{not json" });
  eq((await game.handle(bad, {}, memoryStore())).status, 400, "status");
});

await check("unsupported methods are 405", async () => {
  const r = await game.handle(new Request("https://x/", { method: "DELETE" }), {}, memoryStore());
  eq(r.status, 405, "status");
});

/* ===================== staff-data ===================== */
console.log("\nstaff-data\n");

const OPEN = { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" };

await check("unauthenticated GET is refused", async () => {
  const r = await staff.default.fetch(get(), OPEN);
  eq(r.status, 401, "status");
});

await check("unauthenticated POST cannot write", async () => {
  const r = await staff.default.fetch(post({ kind: "contact", name: "Injected" }), OPEN);
  eq(r.status, 401, "status");
});

await check("a misconfigured deploy FAILS CLOSED with 500", async () => {
  const r = await staff.default.fetch(get(), { DB: {} });
  eq(r.status, 500, "status");
});

await check("javascript: and data: links are refused", async () => {
  // Resources render as clickable anchors, so a link field is a place to put
  // stored XSS. Escaping the text does not help — the browser executes the
  // scheme, not the markup. This was dropped in the 0005 rewrite and these
  // tests are what caught it.
  eq(staff.safeLink("javascript:alert(1)"), null, "javascript:");
  eq(staff.safeLink("data:text/html,<script>"), null, "data:");
  eq(staff.safeLink("JaVaScRiPt:alert(1)"), null, "mixed case");
  eq(staff.safeLink("vbscript:msgbox"), null, "vbscript:");
});

await check("ordinary links and paths survive", async () => {
  eq(staff.safeLink("https://example.com"), "https://example.com", "https");
  eq(staff.safeLink("mailto:a@b.co"), "mailto:a@b.co", "mailto");
  eq(staff.safeLink("/img/photo.jpg"), "/img/photo.jpg", "relative path");
  eq(staff.safeLink(""), null, "empty");
});

await check("an allow-list, not a block-list", async () => {
  // Blocking known-bad schemes invites the next one. Only http, https and
  // mailto pass, so a scheme nobody has thought of is refused by default.
  for (const s of ["ftp://x/y", "file:///etc/passwd", "chrome://settings",
                   "blob:https://x/1", "intent://scan/#Intent;end"]) {
    eq(staff.safeLink(s), null, s);
  }
});

await check("addresses that are not addresses are dropped", async () => {
  eq(staff.isEmail("ok@x.com"), true, "valid");
  eq(staff.isEmail("not-an-email"), false, "no @");
  eq(staff.isEmail("a@b"), false, "no tld");
  eq(staff.isEmail("a b@c.com"), false, "space");
});








await check("photo sources go through the same allow-list as links", async () => {
  // A photo URL ends up in an <img src>, which is another place a scheme is
  // executed rather than displayed.
  eq(staff.safeLink("javascript:alert(1)"), null, "javascript photo");
  eq(staff.safeLink("/img/x.jpg"), "/img/x.jpg", "root-relative photo");
  eq(staff.safeLink("https://cdn.example.com/x.jpg"), "https://cdn.example.com/x.jpg", "https photo");
});


/* ---------------------------------------------------------------------------
   The sign-in page

   Added after /admin/ returned the bare string {"error":"Not authorized"} in a
   browser window — no explanation and nothing to click, reported as "not
   authorized with no way to authorize". The cause was a path-scoped Access
   application; the lesson is that this Worker must not assume the dashboard is
   configured correctly.
   --------------------------------------------------------------------------- */

await check("a refused PAGE gets HTML with a way in", async () => {
  const res = await worker.fetch(
    new Request("https://dev.thauma.one/admin/", { headers: { Accept: "text/html" } }),
    { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" });
  eq(res.status, 401, "status");
  assert((res.headers.get("content-type") || "").includes("text/html"), "must be a page");
  const body = await res.text();
  assert(/Sign in/.test(body), "must offer a way in");
  assert(/href="\/staff\/"/.test(body), "the link must be relative — a built hostname is wrong under wrangler dev");
});

await check("a refused API CALL still gets JSON", async () => {
  // A redirect or an HTML body here would break every fetch() in the console
  // silently. Those callers handle 401 correctly already.
  for (const path of ["/api/admin", "/api/staff-snapshot", "/api/admin/content"]) {
    const res = await worker.fetch(
      new Request("https://dev.thauma.one" + path, { headers: { Accept: "application/json" } }),
      { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" });
    eq(res.status, 401, path + " status");
    assert(!(res.headers.get("content-type") || "").includes("text/html"),
           path + " must not answer a program with a web page");
  }
});

await check("a page request from a script is not given HTML", async () => {
  // fetch() without an Accept header must get JSON, not the sign-in page.
  const res = await worker.fetch(
    new Request("https://dev.thauma.one/admin/"),
    { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" });
  eq(res.status, 401, "status");
  assert(!(res.headers.get("content-type") || "").includes("text/html"), "should be JSON");
});


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
