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
  const r = await staff.handle(get(), OPEN, memoryStore());
  eq(r.status, 401, "status");
});

await check("unauthenticated POST cannot write", async () => {
  const s = memoryStore();
  const r = await staff.handle(post({ contacts: [{ name: "Injected" }] }), OPEN, s);
  eq(r.status, 401, "status");
  eq(s._dump().data, undefined, "an unauthenticated write reached the store");
});

await check("a misconfigured deploy FAILS CLOSED with 500", async () => {
  const r = await staff.handle(get(), {}, memoryStore());
  eq(r.status, 500, "status");
});

await check("contacts are sanitised: bad emails and phones dropped", async () => {
  const out = staff.sanitizeContacts([
    { name: "Real", emails: ["ok@x.com", "not-an-email"], phones: ["+1 (816) 555-0100", "<script>"] },
    { name: "", emails: ["x@y.z"] },
  ]);
  eq(out.length, 1, "nameless contact kept");
  eq(out[0].emails, ["ok@x.com"], "emails");
  eq(out[0].phones, ["+1 (816) 555-0100", ""].filter(Boolean), "phones");
});

await check("javascript: and data: links are stripped from resources", async () => {
  const out = staff.sanitizeResources([
    { title: "Bad", link: "javascript:alert(1)" },
    { title: "Bad2", link: "data:text/html,<script>" },
    { title: "Good", link: "https://example.com" },
  ]);
  eq(out.map((r) => r.link), ["", "", "https://example.com"], "links");
});

await check("photo sources must be http(s) or root-relative", async () => {
  const out = staff.sanitizeResources([
    { title: "a", photo: "javascript:x" },
    { title: "b", photo: "/img/ok.webp" },
    { title: "c", photo: "https://cdn.example/x.png" },
  ]);
  eq(out.map((r) => r.photo), ["", "/img/ok.webp", "https://cdn.example/x.png"], "photos");
});

await check("list and field lengths are capped", async () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ name: "n" + i }));
  eq(staff.sanitizeContacts(many).length, 50, "contacts cap");
  const c = staff.sanitizeContacts([{ name: "x".repeat(400) }])[0];
  assert(c.name.length === 100, "name not clamped");
  const emails = Array.from({ length: 20 }, (_, i) => `a${i}@b.co`);
  eq(staff.sanitizeContacts([{ name: "n", emails }])[0].emails.length, 5, "emails cap");
});

await check("non-array input yields an empty list, not a crash", async () => {
  for (const bad of [null, undefined, "nope", 42, {}]) {
    eq(staff.sanitizeContacts(bad), [], `contacts ${JSON.stringify(bad)}`);
    eq(staff.sanitizeResources(bad), [], `resources ${JSON.stringify(bad)}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
