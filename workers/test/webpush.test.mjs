#!/usr/bin/env node
/**
 * Web Push: encrypted for the phone, signed as Thauma
 *   node test/webpush.test.mjs
 *
 * The receiving side is written out here on its own, step by step from
 * RFC 8291 and RFC 8188, as a browser does it — so a message lib/webpush.js
 * sends is proven readable by the thing it is sent to, not merely by itself.
 */
import { encryptPayload, vapidAuth, sendPush, validSubscription, pushReady, b64u } from "../src/lib/webpush.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const enc = new TextEncoder(), dec = new TextDecoder();
const subtle = crypto.subtle;
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let a = 0; for (const x of p) { o.set(x, a); a += x.length; } return o; };
const hmac = async (k, d) => new Uint8Array(await subtle.sign("HMAC", await subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));

console.log("web push\n");

/* A browser: its key pair and auth secret, as PushManager.subscribe makes them. */
async function aBrowser() {
  const keys = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, sub: { p256dh: b64u.encode(pub), auth: b64u.encode(auth) }, pub, auth };
}

/* …and how it reads a message: RFC 8188's header, RFC 8291's keys. */
async function browserReads(browser, body) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  assert(rs === 4096 && idlen === 65, `header rs=${rs} idlen=${idlen}`);
  const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey }, browser.keys.privateKey, 256));
  const prkKey = await hmac(browser.auth, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), browser.pub, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce },
    await subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]), sealed));
  assert(plain[plain.length - 1] === 2, "the last record is not marked last");
  return dec.decode(plain.slice(0, -1));
}

async function vapidEnv() {
  const k = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await subtle.exportKey("jwk", k.privateKey);
  const pub = new Uint8Array(await subtle.exportKey("raw", k.publicKey));
  return { env: { VAPID_PUBLIC_KEY: b64u.encode(pub), VAPID_PRIVATE_KEY: jwk.d }, publicKey: k.publicKey };
}

await check("a message is readable by the browser it was encrypted for — and only by it", async () => {
  const b = await aBrowser();
  const msg = JSON.stringify({ title: "Ana Horvat sent bio changes", link: "/admin/users/#u_1/team", note: "čćžšđ ✓" });
  const body = await encryptPayload(b.sub, msg);
  assert(await browserReads(b, body) === msg, "read back differently");
  const other = await aBrowser();
  let refused = false;
  try { await browserReads({ ...other, auth: b.auth }, body); } catch { refused = true; }
  assert(refused, "another browser could read it");
  const again = await encryptPayload(b.sub, msg);
  assert(b64u.encode(again) !== b64u.encode(body), "two messages encrypted the same way (no fresh salt and key)");
});

await check("the VAPID token is signed by our key, for that push service, for twelve hours", async () => {
  const { env, publicKey } = await vapidEnv();
  const now = Date.UTC(2026, 9, 13, 12);
  const header = await vapidAuth(env, "https://fcm.googleapis.com/fcm/send/abc", { now });
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert(m && m[4] === env.VAPID_PUBLIC_KEY, "header shape: " + header.slice(0, 60));
  const claims = JSON.parse(dec.decode(b64u.decode(m[2])));
  assert(claims.aud === "https://fcm.googleapis.com" && claims.exp === now / 1000 + 12 * 3600 && /^mailto:/.test(claims.sub), JSON.stringify(claims));
  const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, b64u.decode(m[3]), enc.encode(m[1] + "." + m[2]));
  assert(ok, "the signature does not verify with our public key");
});

await check("sending: the right headers; a removed subscription is reported gone; no keys, no push", async () => {
  const { env } = await vapidEnv();
  const b = await aBrowser();
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/xyz", ...b.sub };
  let seen = null;
  const r = await sendPush(env, sub, { title: "Hi" }, { fetchImpl: async (u, o) => { seen = { u, o }; return { status: 201 }; } });
  assert(r.ok && seen.u === sub.endpoint && seen.o.headers["Content-Encoding"] === "aes128gcm" && /^vapid t=/.test(seen.o.headers.Authorization) && seen.o.headers.TTL, "headers: " + JSON.stringify(seen && seen.o.headers));
  assert(JSON.parse(await browserReads(b, seen.o.body)).title === "Hi", "the body is not the message");
  const gone = await sendPush(env, sub, { title: "x" }, { fetchImpl: async () => ({ status: 410 }) });
  assert(!gone.ok && gone.gone, "410 is not reported as gone");
  assert(!pushReady({ VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY }), "ready without a private key");
  assert((await sendPush({}, sub, {})).ok === false, "sent without keys");
});

await check("only a real push service's address is kept", async () => {
  const b = await aBrowser();
  assert(validSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: b.sub }), "Google refused");
  assert(validSubscription({ endpoint: "https://web.push.apple.com/abc", keys: b.sub }), "Apple refused");
  assert(validSubscription({ endpoint: "https://updates.push.services.mozilla.com/wpush/v2/a", keys: b.sub }), "Mozilla refused");
  assert(!validSubscription({ endpoint: "https://evil.example/collect", keys: b.sub }), "any address accepted");
  assert(!validSubscription({ endpoint: "http://fcm.googleapis.com/x", keys: b.sub }), "http accepted");
  assert(!validSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "short", auth: b.sub.auth } }), "bad key accepted");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
