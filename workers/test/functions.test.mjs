#!/usr/bin/env node
/**
 * Tests for the ported Workers functions.
 *
 *   node workers/test/functions.test.mjs
 *
 * The sanitisation tests matter most: that logic was carried over verbatim
 * from the Netlify versions, and these assert the port did not quietly change
 * behavior. The auth tests assert staff-data cannot be read or written
 * without a valid Access token — including when the deploy is misconfigured.
 */
import { memoryStore } from "../src/lib/store.js";
import * as game from "../src/game-scores.js";
import * as arcade from "../src/admin-arcade.js";
import * as staff from "../src/staff-data.js";
import worker, { isProtected } from "../src/worker.js";

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
const get = (query = "", headers = {}) => new Request("https://x/" + query, { method: "GET", headers });

/* ===================== game-scores ===================== */
console.log("game-scores — the arcade's boards\n");

const read = async (s, g = "loadout") => (await (await game.handle(get("?game=" + g), {}, s)).json()).scores;

await check("each game has its own board, empty to begin with", async () => {
  const s = memoryStore();
  eq(await (await game.handle(get("?game=loadout"), {}, s)).json(), { game: "loadout", scores: [] }, "empty");
  await game.handle(post({ game: "loadout", name: "CHR", score: 120 }), {}, s);
  eq(await read(s, "loadout"), [{ name: "CHR", score: 120 }], "loadout");
  eq(await read(s, "soundcheck"), [], "another game's board untouched");
});

await check("a board keeps the top five, highest first", async () => {
  const s = memoryStore();
  for (const n of [50, 300, 10, 200, 400, 250, 5]) await game.handle(post({ game: "cablerun", name: "AAA", score: n }), {}, s);
  eq((await read(s, "cablerun")).map((x) => x.score), [400, 300, 250, 200, 50], "top five");
});

await check("only real games have boards", async () => {
  const s = memoryStore();
  eq((await game.handle(get("?game=flappy"), {}, s)).status, 404, "unknown game read");
  eq((await game.handle(get(""), {}, s)).status, 404, "no game named");
  eq((await game.handle(post({ game: "../etc", name: "AAA", score: 9 }), {}, s)).status, 404, "invented key");
  eq(Object.keys(s._dump()).length, 0, "nothing stored for an unknown game");
});

await check("initials: three letters or digits, upper-cased", async () => {
  eq(game.sanitizeInitials("chr"), "CHR", "upper-cased");
  eq(game.sanitizeInitials("a-b!c"), "ABC", "only letters and digits");
  eq(game.sanitizeInitials("ABCDEF"), "ABC", "three at most");
  eq(game.sanitizeInitials(""), "???", "blank");
  eq(game.sanitizeInitials(123), "???", "not a string");
  eq(game.sanitizeInitials("<b>"), "B", "markup stripped");
});

await check("crude initials become ???, leetspeak and the classics included", async () => {
  for (const bad of ["ASS", "a55", "KKK", "FUK", "cum", "SEX", "sh1t", "fag", "CUK", "kuk", "cuc", "PNS", "pn5", "PNZ"]) eq(game.sanitizeInitials(bad), "???", bad);
  for (const ok of ["CHR", "DAD", "ANA", "007"]) eq(game.sanitizeInitials(ok), ok, ok);
});

/* ---- Website › Arcade (admin-arcade.js) and what the public API makes of it ---- */
const DEV = { SITE_ORIGIN: "https://dev.thauma.one" }, LIVE = { SITE_ORIGIN: "https://thauma.one" };
const admin = async (s, body) => (await arcade.handle(body ? post(body) : get(""), LIVE, s)).json();

await check("every game is open until an admin closes it, and each site reads its own column", async () => {
  const s = memoryStore();
  eq(await (await game.handle(get("?config=1"), LIVE, s)).json(), { closed: [] }, "all open");
  await admin(s, { action: "game", game: "strike", column: "live", on: false });
  eq((await (await game.handle(get("?config=1"), LIVE, s)).json()).closed, ["strike"], "closed on live");
  eq((await (await game.handle(get("?config=1"), DEV, s)).json()).closed, [], "still open on dev");
  eq((await game.handle(post({ game: "strike", name: "AAA", score: 50 }), LIVE, s)).status, 403, "an out-of-order game takes no scores");
  eq((await game.handle(post({ game: "strike", name: "AAA", score: 50 }), DEV, s)).status, 200, "dev still does");
  await admin(s, { action: "game", game: "strike", column: "live", on: true });
  eq((await (await game.handle(get("?config=1"), LIVE, s)).json()).closed, [], "open again");
});

await check("an admin removes a score or hides its name, named by name and value, not place", async () => {
  const s = memoryStore();
  for (const [n, v] of [["BOB", 300], ["ZED", 200], ["AMY", 100]]) await game.handle(post({ game: "loadout", name: n, score: v }), LIVE, s);
  let st = await admin(s);
  assert(st.games[0].scores[0].at, "scores carry when they were made");
  st = await admin(s, { action: "hide", game: "loadout", name: "ZED", score: 200 });
  eq(st.games[0].scores.map((x) => x.name), ["BOB", "???", "AMY"], "hidden");
  st = await admin(s, { action: "remove", game: "loadout", name: "BOB", score: 300 });
  eq(st.games[0].scores.map((x) => x.name), ["???", "AMY"], "removed");
  const again = await arcade.handle(post({ action: "remove", game: "loadout", name: "BOB", score: 300 }), LIVE, s);
  eq(again.status, 409, "a score already gone is refused, with the boards as they are");
  eq((await again.json()).games[0].scores.length, 2, "and the answer is the current board");
  st = await admin(s, { action: "clear", game: "loadout" });
  eq(st.games[0].scores, [], "cleared");
});

await check("a blocked name is ??? on the boards now and on every score after", async () => {
  const s = memoryStore();
  await game.handle(post({ game: "cuestack", name: "XYZ", score: 90 }), LIVE, s);
  let st = await admin(s, { action: "block", name: "xyz" });
  eq(st.blocked.map((b) => b.name), ["XYZ"], "blocked, upper-cased");
  eq(st.games.find((g) => g.id === "cuestack").scores[0].name, "???", "the board now");
  await game.handle(post({ game: "cuestack", name: "xyz", score: 95 }), LIVE, s);
  eq((await read(s, "cuestack")).map((x) => x.name), ["???", "???"], "and after");
  st = await admin(s, { action: "unblock", name: "XYZ" });
  eq(st.blocked, [], "unblocked");
  eq((await (await arcade.handle(post({ action: "block", name: "!!" }), LIVE, s)).status), 400, "a name needs a letter or digit");
});

await check("scores are clamped and never negative", async () => {
  eq(game.sanitizeScore(-5), 0, "negative");
  eq(game.sanitizeScore(1e12), 9999999, "over max");
  eq(game.sanitizeScore("abc"), 0, "NaN");
  eq(game.sanitizeScore(12.9), 12, "floored");
});

await check("a zero score is not recorded", async () => {
  const s = memoryStore();
  await game.handle(post({ game: "loadout", name: "NOB", score: 0 }), {}, s);
  eq(await read(s), [], "zero recorded");
});

await check("delete requires the admin token", async () => {
  const s = memoryStore({ "board:loadout": { scores: [{ name: "AAA", score: 9 }] } });
  const env = { GAME_ADMIN_TOKEN: "secret" };
  eq((await game.handle(post({ action: "delete", game: "loadout", index: 0 }), env, s)).status, 403, "no token");
  eq((await game.handle(post({ action: "delete", game: "loadout", index: 0, token: "wrong" }), env, s)).status, 403, "wrong token");
  const ok = await game.handle(post({ action: "delete", game: "loadout", index: 0, token: "secret" }), env, s);
  eq(ok.status, 200, "right token");
  eq((await ok.json()).scores, [], "not deleted");
});

await check("delete is DISABLED, not open, when no token is configured", async () => {
  const s = memoryStore({ "board:loadout": { scores: [{ name: "AAA", score: 9 }] } });
  eq((await game.handle(post({ action: "delete", game: "loadout", index: 0, token: "" }), {}, s)).status, 403, "allowed");
});

await check("out-of-range delete index is ignored, not an error", async () => {
  const s = memoryStore({ "board:loadout": { scores: [{ name: "AAA", score: 9 }] } });
  const r = await game.handle(post({ action: "delete", game: "loadout", index: 99, token: "secret" }), { GAME_ADMIN_TOKEN: "secret" }, s);
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

await check("/staff and /admin are gated IDENTICALLY", async () => {
  /* Chase asked for these to work the same way, and "they're both in the same
     if statement" is true until somebody edits one clause. This compares the
     actual behavior of the two areas rather than trusting the source to stay
     symmetrical.

     It is also the property the Cloudflare Access application got wrong: it
     covered `staff` and not `admin`, so one area had a login page and the
     other had a JSON error. The dashboard is not something this test can
     check — this is the half that can be. */
  const env = { ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" };

  const staffPaths = ["/staff", "/staff/", "/staff/settings/", "/staff/data/snapshot.json"];
  const adminPaths = ["/admin", "/admin/", "/admin/users/", "/admin/website/"];

  for (const [a, b] of staffPaths.map((p, i) => [p, adminPaths[i]])) {
    for (const accept of ["text/html", "application/json"]) {
      const ra = await worker.fetch(new Request("https://x" + a, { headers: { Accept: accept } }), env);
      const rb = await worker.fetch(new Request("https://x" + b, { headers: { Accept: accept } }), env);
      eq(ra.status, rb.status, `${a} and ${b} disagree on status (${accept})`);
      eq(ra.headers.get("content-type"), rb.headers.get("content-type"),
         `${a} and ${b} disagree on content type (${accept})`);
    }
  }
});

await check("an old console address leads to where the page moved", async () => {
  const { movedTo, MOVED } = await import("../src/worker.js");
  const go = (u) => movedTo(new URL("https://x" + u));
  eq(go("/admin/content/"), "https://x/admin/website/", "Content");
  eq(go("/admin/site"), "https://x/admin/website/settings/", "without the slash");
  eq(go("/admin/publish/"), "https://x/admin/website/?review", "Publish opens the review");
  eq(go("/admin/library/?tab=gatherings"), "https://x/admin/website/resources/?tab=gatherings", "keeps the query");
  eq(go("/admin/website/library/"), "https://x/admin/website/resources/", "Library became Resources and Events");
  eq(go("/staff/ministry/"), "https://x/staff/updates/", "Ministry became Updates");
  eq(go("/staff/mailing/?scope=organization"), "https://x/staff/mail/?scope=organization",
    "Mailing became Mail, still Thauma's");
  eq(go("/admin/users/"), null, "a page that did not move");
  /* And nobody reaches a moved page without signing in first: the forward
     happens after the gate, so an old bookmark still meets the sign-in. */
  for (const from of Object.keys(MOVED)) assert(isProtected(from), `${from} is not behind the gate`);
});

await check("isProtected covers both areas and nothing else", () => {
  for (const p of ["/staff", "/staff/", "/staff/settings/", "/admin", "/admin/", "/admin/users/"]) {
    assert(isProtected(p), `${p} must be protected`);
  }
  /* The near-misses matter more than the hits. A prefix check written as
     startsWith("/admin") alone would swallow /administration, and one written
     too loosely would leave /staffing gated for no reason. */
  for (const p of ["/", "/en/", "/en/give/", "/staffing", "/administration", "/admin-x",
                   "/api/admin", "/api/staff-data", "/img/logo.svg"]) {
    assert(!isProtected(p), `${p} must NOT be protected`);
  }
});

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
