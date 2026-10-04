#!/usr/bin/env node
/**
 * A ministry's unused uploads — found, and removed only when truly unused
 *   node workers/test/media-cleanup.test.mjs
 *
 * This deletes files, so the rules are pinned here: anything the site (draft
 * or published), a mailing, an attachment or an edit's original still names
 * stays; anything newer than a week stays; only the ministry's own folders
 * are looked at; and the delete step re-checks on the server, ignoring
 * whatever the browser sent that is not in the unused set.
 */
import handler from "../src/media-cleanup.js";
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

const OLD = new Date(Date.now() - 30 * 864e5).toISOString(), NEW = new Date().toISOString();
function world() {
  const objects = {
    "partnersite/chase-roush/in-draft-aaaa.webp": OLD,
    "partnersite/chase-roush/in-published-bbbb.webp": OLD,
    "partnersite/chase-roush/original-behind-edit-cccc.webp": OLD,
    "partnersite/chase-roush/replaced-dddd.webp": OLD,
    "partnersite/chase-roush/just-uploaded-eeee.webp": NEW,
    "newsletter/chase-roush/in-mail-ffff.jpg": OLD,
    "newsletter/chase-roush/removed-from-mail-gggg.jpg": OLD,
    "attachments/p_chase/report-hhhh.pdf": OLD,
    "attachments/p_chase/old-attachment-iiii.pdf": OLD,
    "partnersite/someone-else/theirs-jjjj.webp": OLD,
    "team/u_1-photo-kkkk.webp": OLD,
  };
  const deleted = [];
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
      const run = async () => {
        if (/FROM users/i.test(sql) && /email/i.test(sql) && !/partner_users/i.test(sql)) return { results: [{ user_id: "u_1", email: "chase@thauma.one", status: "active", roles: "staff" }] };
        if (/partner_users/i.test(sql)) return { results: [{ id: "p_chase", slug: "chase-roush", display_name: "Chase Roush" }] };
        if (sql === sqlOf("partner_site_get")) return { results: [{ draft: JSON.stringify({ photo: "/media/partnersite/chase-roush/in-draft-aaaa.webp", photoEdit: { x: 0 }, shareOrig: "/media/partnersite/chase-roush/original-behind-edit-cccc.webp" }),
                                                                     published: JSON.stringify({ photo: "https://thauma.one/media/partnersite/chase-roush/in-published-bbbb.webp" }) }] };
        if (sql === sqlOf("media_refs_mailings")) return { results: [{ body_html: '<img src="/media/newsletter/chase-roush/in-mail-ffff.jpg">' }] };
        if (sql === sqlOf("media_refs_attachments")) return { results: [{ object_key: "attachments/p_chase/report-hhhh.pdf" }] };
        return { results: [] };
      };
      return { bind() { return { all: run, run }; }, all: run, run };
    } },
  };
  return { env, deleted, objects };
}
const req = (method, body) => new Request("https://x/api/staff-media-cleanup", {
  method, headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN }, body: body ? JSON.stringify(body) : undefined });

console.log("media-cleanup — unused uploads, and only those\n");

await check("lists only what nothing uses, older than a week, in the ministry's own folders", async () => {
  const { env } = world();
  const res = await handler.fetch(req("GET"), env);
  eq(res.status, 200, "status");
  const keys = (await res.json()).files.map((f) => f.key).sort();
  eq(keys, ["attachments/p_chase/old-attachment-iiii.pdf", "newsletter/chase-roush/removed-from-mail-gggg.jpg", "partnersite/chase-roush/replaced-dddd.webp"], "unused");
});

await check("deletes only keys that are really unused, whatever the browser sends", async () => {
  const { env, deleted } = world();
  const res = await handler.fetch(req("POST", { keys: [
    "partnersite/chase-roush/replaced-dddd.webp",               // unused: goes
    "partnersite/chase-roush/in-draft-aaaa.webp",               // used: stays
    "partnersite/chase-roush/just-uploaded-eeee.webp",          // too new: stays
    "partnersite/someone-else/theirs-jjjj.webp",                // not theirs: stays
    "team/u_1-photo-kkkk.webp",                                 // Thauma's: stays
  ] }), env);
  eq(res.status, 200, "status");
  eq(deleted, ["partnersite/chase-roush/replaced-dddd.webp"], "deleted");
  eq((await res.json()).removed, 1, "count");
});

await check("without a signed-in account, nothing", async () => {
  const { env, deleted } = world();
  const res = await handler.fetch(new Request("https://x/api/staff-media-cleanup", { method: "POST", body: "{}" }), env);
  assert(res.status === 401 || res.status === 403, `status ${res.status}`);
  eq(deleted, [], "deleted");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
