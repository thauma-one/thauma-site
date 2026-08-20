#!/usr/bin/env node
/**
 * Uploads, and what must not get into the bucket
 *   node workers/test/media.test.mjs
 *
 * This endpoint takes bytes from a browser and stores them on a domain that
 * also serves the staff console. The interesting cases are all refusals: a
 * bucket that will store whatever it is told, on a domain with a session
 * cookie, is a way to run script as an administrator.
 *
 * The magic-byte check is the one that matters. A caller writes its own
 * Content-Type header, so "image/webp" on an HTML file is trivially arranged
 * and would otherwise be stored and later served back under that type.
 */
import handler, { serve } from "../src/media.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- a real Access token, verified for real (see admin-content.test.mjs) -- */
const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1";
jwk.alg = "RS256";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "admin@thauma.one",
                sub: "u-1", exp: Math.floor(Date.now() / 1000) + 600 });
const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
  new TextEncoder().encode(`${h}.${p}`));
const TOKEN = `${h}.${p}.${b64url(sig)}`;

globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + url);
};

/** Just enough R2 to tell whether something was stored, and what. */
function bucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes, opts) { objects.set(key, { bytes, opts }); },
    async get(key) {
      if (!objects.has(key)) return null;
      const o = objects.get(key);
      return {
        body: o.bytes,
        httpEtag: '"etag-' + key + '"',
        writeHttpMetadata(hs) { hs.set("Content-Type", o.opts.httpMetadata.contentType); },
      };
    },
  };
}

function envWith(roles, MEDIA = bucket()) {
  return {
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, MEDIA,
    DB: {
      prepare(sql) {
        return { bind() { return { async all() {
          // user_by_id is asked for the person being uploaded FOR
          if (/FROM users\s+WHERE\s+id/i.test(sql) || sql.includes(":id")) {
            return { results: [{ user_id: "u_2", email: "mira@thauma.one",
                                 user_name: "Mira", status: "active", roles: "staff" }] };
          }
          return { results: roles === null ? [] :
            [{ user_id: "u_1", email: "admin@thauma.one", user_name: "Chase Roush",
               status: "active", preferred_lang: "en", roles }] };
        } }; } };
      },
    },
  };
}

const URL_BASE = "https://dev.thauma.one/api/admin/media?for=u_2&kind=photo";
const withToken = (init = {}) => ({
  ...init,
  headers: { ...(init.headers || {}), Cookie: `CF_Authorization=${TOKEN}` },
});

/* A real, minimal WebP header: RIFF....WEBP */
function webp(extra = 40) {
  const b = new Uint8Array(12 + extra);
  b.set([0x52, 0x49, 0x46, 0x46], 0);          // RIFF
  b.set([0x57, 0x45, 0x42, 0x50], 8);          // WEBP
  return b;
}
const put = (env, body, type, url = URL_BASE) =>
  handler.fetch(new Request(url, withToken({
    method: "PUT", body, headers: { "Content-Type": type },
  })), env);

await check("a WebP is stored, and the key is its content", async () => {
  const env = envWith("admin,staff");
  const res = await put(env, webp(), "image/webp");
  const body = await res.json();
  eq(res.status, 200, "status");
  assert(body.url.startsWith("/media/team/u_2-photo-"), `url was ${body.url}`);
  assert(body.url.endsWith(".webp"), "extension");
  eq(env.MEDIA.objects.size, 1, "one object stored");

  // The same bytes again must land on the same key rather than a second copy.
  const again = await (await put(env, webp(), "image/webp")).json();
  eq(again.url, body.url, "same bytes, same key");
  eq(env.MEDIA.objects.size, 1, "still one object");
});

await check("different bytes get a different key, so replacing is not an overwrite", async () => {
  const env = envWith("admin,staff");
  const a = await (await put(env, webp(40), "image/webp")).json();
  const b = await (await put(env, webp(80), "image/webp")).json();
  assert(a.url !== b.url, "keys should differ");
  eq(env.MEDIA.objects.size, 2, "both kept — the old URL stays valid until Save");
});

await check("HTML wearing an image Content-Type is refused", async () => {
  const env = envWith("admin,staff");
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const res = await put(env, html, "image/webp");
  eq(res.status, 415, "status");
  assert((await res.json()).error.includes("not really"), "should say why");
  eq(env.MEDIA.objects.size, 0, "NOTHING may be stored");
});

await check("a type that is not an image at all is refused", async () => {
  const env = envWith("admin,staff");
  const res = await put(env, new Uint8Array([1, 2, 3]), "text/html");
  eq(res.status, 415, "status");
  eq(env.MEDIA.objects.size, 0, "nothing stored");
});

await check("an oversized upload is refused rather than stored", async () => {
  const env = envWith("admin,staff");
  const big = new Uint8Array(5 * 1024 * 1024);
  big.set([0x52, 0x49, 0x46, 0x46], 0); big.set([0x57, 0x45, 0x42, 0x50], 8);
  const res = await put(env, big, "image/webp");
  eq(res.status, 413, "status");
  eq(env.MEDIA.objects.size, 0, "nothing stored");
});

await check("an empty upload is refused", async () => {
  const env = envWith("admin,staff");
  const res = await put(env, new Uint8Array(0), "image/webp");
  eq(res.status, 400, "status");
});

await check("a non-administrator cannot upload", async () => {
  const env = envWith("staff");
  const res = await put(env, webp(), "image/webp");
  eq(res.status, 403, "status");
  eq(env.MEDIA.objects.size, 0, "nothing stored");
});

await check("no token, no upload", async () => {
  const env = envWith("admin");
  const res = await handler.fetch(new Request(URL_BASE, {
    method: "PUT", body: webp(), headers: { "Content-Type": "image/webp" },
  }), env);
  eq(res.status, 401, "status");
  eq(env.MEDIA.objects.size, 0, "nothing stored");
});

await check("an unknown kind is refused, so the key space stays predictable", async () => {
  const env = envWith("admin,staff");
  const res = await put(env, webp(), "image/webp",
    "https://dev.thauma.one/api/admin/media?for=u_2&kind=../../etc");
  eq(res.status, 400, "status");
  eq(env.MEDIA.objects.size, 0, "nothing stored");
});

await check("a misconfigured deploy FAILS CLOSED", async () => {
  const res = await put({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }, webp(), "image/webp");
  eq(res.status, 500, "no bucket bound");
});

/* ---- serving ---- */

await check("a stored object is served with its type and cannot be sniffed", async () => {
  const env = envWith("admin,staff");
  const { key } = await (await put(env, webp(), "image/webp")).json();
  const res = await serve(new Request("https://dev.thauma.one/media/" + key), env, key);
  eq(res.status, 200, "status");
  eq(res.headers.get("X-Content-Type-Options"), "nosniff", "nosniff");
  assert(res.headers.get("Cache-Control").includes("immutable"),
    "content-addressed keys are cacheable forever");
  assert(res.headers.get("Content-Security-Policy").includes("sandbox"),
    "a stored file must not be able to act as a page");
});

await check("a path trying to climb out of the bucket is a 404", async () => {
  const env = envWith("admin,staff");
  for (const bad of ["../../secret", "team/../../x", "a b"]) {
    const res = await serve(new Request("https://x/media/" + bad), env, bad);
    eq(res.status, 404, `should refuse ${bad}`);
  }
});

await check("a missing object is a 404, not a crash", async () => {
  const env = envWith("admin,staff");
  const res = await serve(new Request("https://x/media/team/nope.webp"), env, "team/nope.webp");
  eq(res.status, 404, "status");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
