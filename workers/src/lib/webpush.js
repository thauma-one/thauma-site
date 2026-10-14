/**
 * webpush.js — sending a push notification to a phone or browser
 *
 * docs/APP-PLAN.md: the console and every ministry's site can be installed as
 * an app, and the thing that makes them apps is that they can be told
 * something with the phone in a pocket. That is the Web Push standard, and it
 * needs no outside service: the browser hands us a subscription (an address
 * at Google, Apple or Mozilla, and two keys), and we send to that address —
 *
 *   ENCRYPTED for that one browser (RFC 8291, "aes128gcm", RFC 8188): only
 *   the phone can read the message; the push service only carries it.
 *
 *   SIGNED as Thauma (VAPID, RFC 8292): a short token signed with our own
 *   key pair, so the push service knows every message for these
 *   subscriptions comes from whoever created them.
 *
 * WebCrypto does all of it — the same API in a Worker and in Node, which is
 * what lets workers/test/webpush.test.mjs decrypt what this encrypts, the
 * way a phone would.
 *
 * THE KEYS. VAPID_PUBLIC_KEY (wrangler.toml, not secret — it is handed to
 * every browser that subscribes) is the 65-byte public point, base64url.
 * VAPID_PRIVATE_KEY is a secret: the 32-byte private number, base64url, set
 * with `wrangler secret put` by the command in docs/APP-PLAN.md, never
 * printed and never committed. With either missing, push is simply off.
 */

const enc = new TextEncoder();

export const b64u = {
  encode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(s + "===".slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
/* HKDF (RFC 5869) by hand, because the extract and expand steps are used
   with different salts and infos and WebCrypto's HKDF fuses them. */
const extract = (salt, ikm) => hmac(salt, ikm);
async function expand(prk, info, length) {
  const out = await hmac(prk, concat(info, new Uint8Array([1])));
  return out.slice(0, length);
}

/** Is push set up on this deploy? */
export function pushReady(env) {
  return !!(env && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/** The keys as WebCrypto wants them. */
async function vapidKey(env) {
  const pub = b64u.decode(env.VAPID_PUBLIC_KEY);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error("VAPID_PUBLIC_KEY is not an uncompressed P-256 point");
  return crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", ext: true,
    x: b64u.encode(pub.slice(1, 33)), y: b64u.encode(pub.slice(33, 65)),
    d: String(env.VAPID_PRIVATE_KEY).trim(),
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** The VAPID Authorization header for one push service (RFC 8292). */
export async function vapidAuth(env, endpoint, { subject = "mailto:hello@thauma.one", now = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const head = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await vapidKey(env), enc.encode(head + "." + body)));
  return `vapid t=${head}.${body}.${b64u.encode(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/**
 * The body of one push message for one subscription (RFC 8291 + 8188).
 * `keys`: the subscription's { p256dh, auth }. `fixed`: test seams only.
 */
export async function encryptPayload(keys, plaintext, fixed = {}) {
  const uaPublic = b64u.decode(keys.p256dh);
  const authSecret = b64u.decode(keys.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("not a push subscription's keys");

  const local = fixed.localKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  // the input keying material, bound to both public keys and the auth secret
  const prkKey = await extract(authSecret, ecdh);
  const ikm = await expand(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);

  const salt = fixed.salt || crypto.getRandomValues(new Uint8Array(16));
  const prk = await extract(salt, ikm);
  const cek = await expand(prk, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await expand(prk, enc.encode("Content-Encoding: nonce\0"), 12);

  // one record: the message, then the 0x02 that says it is the last
  const text = typeof plaintext === "string" ? enc.encode(plaintext) : plaintext;
  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(text, new Uint8Array([2]))));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/**
 * Send one message. `sub`: { endpoint, p256dh, auth }. `message`: an object,
 * sent as JSON (the service worker reads title, body, link, tag).
 * Returns { ok, status, gone } — gone means the subscription no longer
 * exists (404/410: the app was removed, or permission withdrawn) and should
 * be forgotten. Never throws.
 */
export async function sendPush(env, sub, message, { ttl = 86400, urgency = "normal", fetchImpl = fetch } = {}) {
  if (!pushReady(env)) return { ok: false, status: 0, error: "push is not set up on this deploy" };
  try {
    const body = await encryptPayload({ p256dh: sub.p256dh, auth: sub.auth }, JSON.stringify(message));
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(env, sub.endpoint),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

/* A push service is one of a handful of known hosts. A subscription naming
   anything else is refused when it is saved, so a stranger cannot make the
   Worker POST to an address of their choosing. */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
                    /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
export function validSubscription(s) {
  if (!s || typeof s !== "object") return null;
  const keys = s.keys || {};
  let url;
  try { url = new URL(String(s.endpoint || "")); } catch { return null; }
  if (url.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(url.hostname))) return null;
  const p256dh = String(keys.p256dh || ""), auth = String(keys.auth || "");
  try {
    if (b64u.decode(p256dh).length !== 65 || b64u.decode(auth).length < 16) return null;
  } catch { return null; }
  if (url.toString().length > 1000) return null;
  return { endpoint: url.toString(), p256dh, auth };
}
