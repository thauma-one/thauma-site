#!/usr/bin/env node
/**
 * Unused uploads — released when an editor closes, swept daily, only when truly unused
 *   node workers/test/media-cleanup.test.mjs
 *
 * This deletes files with nobody watching, so the rules are pinned here:
 * anything a site (draft or published), a mailing, an attachment or an
 * edit's original still names stays; anything newer than 30 days stays; only
 * partners' folders and Thauma's own mail folders are looked at (never team/,
 * library/ or site/); it runs once a day. An editor closing releases what it
 * replaced: deleted at once, but only from the caller's folders and only if
 * nothing anywhere (any site, any mailing) still names it.
 */
import release, { cleanUnusedMedia, isCleanupHour, releaseMedia, keyOf } from "../src/media-cleanup.js";
import { createDb } from "../src/lib/db.js";
import worker from "../src/worker.js";
import { QUERIES } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* A real Access token, verified for real (as staff-mailing.test.mjs does). */
const TEAM = "thaumaone.cloudflareaccess.com", AUD = "test-aud-tag";
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey); jwk.kid = "k1"; jwk.alg = "RS256";
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const h = enc({ alg: "RS256", kid: "k1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "chase@thauma.one", sub: "u-1", exp: Math.floor(Date.now() / 1000) + 600 });
const TOKEN = `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
  throw new Error("unexpected fetch " + url);
};

const OLD = new Date(Date.now() - 45 * 864e5).toISOString(), RECENT = new Date(Date.now() - 10 * 864e5).toISOString();
function world() {
  const objects = {
    "partnersite/chase-roush/in-draft-aaaa.webp": OLD,
    "partnersite/chase-roush/in-published-bbbb.webp": OLD,
    "partnersite/chase-roush/original-behind-edit-cccc.webp": OLD,
    "partnersite/chase-roush/replaced-dddd.webp": OLD,
    "partnersite/chase-roush/ten-days-old-eeee.webp": RECENT,
    "newsletter/chase-roush/in-mail-ffff.jpg": OLD,
    "newsletter/chase-roush/removed-from-mail-gggg.jpg": OLD,
    "newsletter/chase-roush/thauma-mail-in-chase-folder-qqqq.jpg": OLD,
    "attachments/p_chase/report-hhhh.pdf": OLD,
    "attachments/p_chase/old-attachment-iiii.pdf": OLD,
    "newsletter/thauma/in-thauma-mail-llll.jpg": OLD,
    "newsletter/thauma/removed-from-thauma-mail-mmmm.jpg": OLD,
    "attachments/org/old-org-attachment-nnnn.pdf": OLD,
    "team/u_1-photo-kkkk.webp": OLD,
    "site/home-worship-stage-oooo.webp": OLD,
    "library/resource-pppp.webp": OLD,
  };
  const deleted = [], audits = [];
  const sqlOf = (n) => QUERIES[n].replace(/:[a-z_][a-z0-9_]*/gi, "?");
  const env = {
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    MEDIA: {
      async list({ prefix }) {
        return { truncated: false, objects: Object.keys(objects).filter((k) => k.startsWith(prefix)).map((k) => ({ key: k, size: 1000, uploaded: objects[k] })) };
      },
      async delete(k) { deleted.push(k); delete objects[k]; },
    },
    DB: { prepare(sql) {
      let args = [];
      const run = async () => {
        if (sql === sqlOf("admin_partners")) return { results: [{ id: "p_chase", slug: "chase-roush", display_name: "Chase Roush" }] };
        if (sql === sqlOf("media_refs_sites")) return { results: [{ draft: JSON.stringify({ photo: "/media/partnersite/chase-roush/in-draft-aaaa.webp", photoEdit: { x: 0 }, shareOrig: "/media/partnersite/chase-roush/original-behind-edit-cccc.webp" }),
                                                                     published: JSON.stringify({ photo: "https://thauma.one/media/partnersite/chase-roush/in-published-bbbb.webp" }) }] };
        if (sql === sqlOf("media_refs_mailings")) return { results: [
          { body_html: '<img src="/media/newsletter/chase-roush/in-mail-ffff.jpg">' },
          { body_html: '<img src="/media/newsletter/thauma/in-thauma-mail-llll.jpg">' },
          /* Thauma's own mail, written by an admin attached to a partner:
             its picture sits in that partner's folder. */
          { body_html: '<img src="/media/newsletter/chase-roush/thauma-mail-in-chase-folder-qqqq.jpg">' }] };
        if (sql === sqlOf("media_refs_attachments")) return { results: [{ object_key: "attachments/p_chase/report-hhhh.pdf" }] };
        if (sql === sqlOf("media_refs_resources")) return { results: [] };
        if (/FROM users/i.test(sql) && /email/i.test(sql) && !/partner_users/i.test(sql)) return { results: [{ user_id: "u_1", email: "chase@thauma.one", status: "active", roles: "staff" }] };
        if (/partner_users/i.test(sql)) return { results: [{ id: "p_chase", slug: "chase-roush", display_name: "Chase Roush" }] };
        if (sql === sqlOf("audit_write")) { audits.push(args); return { results: [] }; }
        return { results: [] };
      };
      const st = { bind(...a) { args = a; return st; }, all: run, run, first: async () => (await run()).results[0] || null };
      return st;
    } },
  };
  return { env, deleted, audits, objects };
}

console.log("media-cleanup — unused uploads, automatically, and only those\n");

await check("removes only what nothing uses, older than 30 days, in partner and Thauma mail folders", async () => {
  const { env, deleted } = world();
  await cleanUnusedMedia(env);
  eq(deleted.sort(), [
    "attachments/org/old-org-attachment-nnnn.pdf",
    "attachments/p_chase/old-attachment-iiii.pdf",
    "newsletter/chase-roush/removed-from-mail-gggg.jpg",
    "newsletter/thauma/removed-from-thauma-mail-mmmm.jpg",
    "partnersite/chase-roush/replaced-dddd.webp",
  ], "deleted");
});

await check("leaves the activity log a line per owner that lost something", async () => {
  const { env, audits } = world();
  await cleanUnusedMedia(env);
  eq(audits.length, 2, "audit rows");
});

await check("a second run finds nothing more", async () => {
  const { env, deleted } = world();
  await cleanUnusedMedia(env);
  const n = deleted.length;
  await cleanUnusedMedia(env);
  eq(deleted.length, n, "deleted again");
});

await check("runs once a day: the 03:00 UTC quarter hour only", async () => {
  eq(isCleanupHour(Date.UTC(2026, 9, 4, 3, 0)), true, "03:00");
  eq(isCleanupHour(Date.UTC(2026, 9, 4, 3, 15)), false, "03:15");
  eq(isCleanupHour(Date.UTC(2026, 9, 4, 15, 0)), false, "15:00");
});

await check("Thauma's mail keeps its picture even when it sits in a partner's folder", async () => {
  const { env, deleted } = world();
  await cleanUnusedMedia(env);
  assert(!deleted.includes("newsletter/chase-roush/thauma-mail-in-chase-folder-qqqq.jpg"), "deleted Thauma's picture");
});

await check("released on close: unused goes at once, however new; used, foreign and Thauma's site files stay", async () => {
  const { env, deleted } = world();
  const n = await releaseMedia(env, createDb(env.DB), [
    "/media/partnersite/chase-roush/replaced-dddd.webp",          // unused: goes
    "https://x/media/partnersite/chase-roush/ten-days-old-eeee.webp", // unused, recent: goes (the editor is closed)
    "/media/partnersite/chase-roush/in-draft-aaaa.webp",          // the draft uses it
    "/media/partnersite/chase-roush/in-published-bbbb.webp",      // the live site uses it
    "/media/newsletter/chase-roush/thauma-mail-in-chase-folder-qqqq.jpg", // Thauma's mail uses it
    "partnersite/someone-else/theirs-jjjj.webp",                  // not the caller's folder
    "/media/site/home-worship-stage-oooo.webp",                   // never tidied
    "/media/partnersite/../team/u_1-photo-kkkk.webp",             // no climbing out
  ], ["partnersite/chase-roush/", "newsletter/chase-roush/", "attachments/p_chase/"]);
  eq(deleted.sort(), ["partnersite/chase-roush/replaced-dddd.webp", "partnersite/chase-roush/ten-days-old-eeee.webp"], "deleted");
  eq(n, 2, "count");
});

await check("keyOf reads paths, URLs and bare keys, and refuses anything else", async () => {
  eq(keyOf("/media/a/b-1.webp?v=2"), "a/b-1.webp", "path");
  eq(keyOf("https://thauma.one/media/a/b.webp"), "a/b.webp", "url");
  eq(keyOf("attachments/p_chase/x.pdf"), "attachments/p_chase/x.pdf", "bare");
  eq(keyOf("/media/a/../b.webp"), "", "climb");
  eq(keyOf("javascript:alert(1)"), "", "junk");
});

await check("the release route: signed in, own folders only", async () => {
  const { env, deleted } = world();
  const ask = (headers) => release.fetch(new Request("https://x/api/staff-media-release", { method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ keys: ["/media/partnersite/chase-roush/replaced-dddd.webp", "/media/newsletter/thauma/removed-from-thauma-mail-mmmm.jpg"] }) }), env);
  const anon = await ask({});
  assert(anon.status === 401 || anon.status === 403, `anonymous status ${anon.status}`);
  eq(deleted, [], "nothing without a sign-in");
  const res = await ask({ "Cf-Access-Jwt-Assertion": TOKEN });
  eq(res.status, 200, "status");
  /* staff, not admin: Thauma's own folder is not theirs to tidy */
  eq(deleted, ["partnersite/chase-roush/replaced-dddd.webp"], "deleted");
});

await check("the old manual button's route is gone", async () => {
  const res = await worker.fetch(new Request("https://x/api/staff-media-cleanup", { method: "POST", body: "{}" }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  eq(res.status, 404, "status");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
