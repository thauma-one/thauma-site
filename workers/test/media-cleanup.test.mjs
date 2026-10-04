#!/usr/bin/env node
/**
 * Unused uploads — removed automatically, and only when truly unused
 *   node workers/test/media-cleanup.test.mjs
 *
 * This deletes files with nobody watching, so the rules are pinned here:
 * anything a site (draft or published), a mailing, an attachment or an
 * edit's original still names stays; anything newer than 30 days stays; only
 * partners' folders and Thauma's own mail folders are looked at (never team/,
 * library/ or site/); it runs once a day; and there is no route to call it.
 */
import { cleanUnusedMedia, isCleanupHour } from "../src/media-cleanup.js";
import worker from "../src/worker.js";
import { QUERIES } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

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
        if (sql === sqlOf("partner_site_get")) return { results: [{ draft: JSON.stringify({ photo: "/media/partnersite/chase-roush/in-draft-aaaa.webp", photoEdit: { x: 0 }, shareOrig: "/media/partnersite/chase-roush/original-behind-edit-cccc.webp" }),
                                                                     published: JSON.stringify({ photo: "https://thauma.one/media/partnersite/chase-roush/in-published-bbbb.webp" }) }] };
        if (sql === sqlOf("media_refs_mailings")) return { results: args[0] === "p_chase"
          ? [{ body_html: '<img src="/media/newsletter/chase-roush/in-mail-ffff.jpg">' }]
          : [{ body_html: '<img src="/media/newsletter/thauma/in-thauma-mail-llll.jpg">' }] };
        if (sql === sqlOf("media_refs_attachments")) return { results: args[0] === "p_chase" ? [{ object_key: "attachments/p_chase/report-hhhh.pdf" }] : [] };
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

await check("there is no route to call it by hand", async () => {
  const res = await worker.fetch(new Request("https://x/api/staff-media-cleanup", { method: "POST", body: "{}" }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  eq(res.status, 404, "status");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
