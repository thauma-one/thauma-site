/**
 * signed-link.js — links that prove something without a session
 *
 * An invited person cannot be signed in yet: that is the thing the link
 * exists to establish. So the link itself has to carry the proof, which means
 * a signature over the account it names.
 *
 * MODELLED ON lib/unsub.js, which does the same job for unsubscribe links, and
 * sharing its secret deliberately. The PURPOSE is mixed into the key, so a
 * token minted to confirm an account cannot be replayed to change an address —
 * the two produce different digests from the same secret, which is what makes
 * one secret safe for both.
 *
 * IT EXPIRES. unsub links must work forever; these must not. An invitation
 * forwarded to a colleague a year later should not still create an account, so
 * the deadline is signed alongside the subject and checked on the way back.
 * That is the whole reason the expiry travels in the URL rather than being
 * looked up: a value in the signature cannot be edited by whoever holds it.
 */
const enc = new TextEncoder();

/** Seven days. Long enough to survive a holiday, short enough to be a link
    somebody acts on rather than files. */
export const DEFAULT_TTL = 7 * 24 * 60 * 60;

async function key(env, purpose) {
  const secret = env.SIGNUP_SALT;
  if (!secret || String(secret).length < 16) {
    throw new Error(
      "SIGNUP_SALT is not set on this deploy, so account links cannot be " +
      "signed. Nothing that relies on one will be sent until it is.");
  }
  return crypto.subtle.importKey(
    "raw", enc.encode(`${purpose}:${secret}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function mac(env, purpose, subject, expires) {
  const sig = await crypto.subtle.sign(
    "HMAC", await key(env, purpose), enc.encode(`${subject}|${expires}`));
  return [...new Uint8Array(sig)].slice(0, 20)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `{ token, expires }` — both belong in the URL. */
export async function sign(env, purpose, subject, { ttl = DEFAULT_TTL, now } = {}) {
  const expires = Math.floor((now ?? Date.now()) / 1000) + ttl;
  return { token: await mac(env, purpose, subject, expires), expires };
}

/**
 * Constant-time compare, and expiry checked first.
 *
 * Returns a reason rather than a boolean: "this link has expired" and "this
 * link is not valid" are different things to a person holding one, and a page
 * that says the same thing for both sends somebody hunting for a problem they
 * do not have.
 */
export async function verify(env, purpose, subject, { token, expires, now } = {}) {
  const exp = Number(expires);
  if (!Number.isFinite(exp) || !token) return { ok: false, reason: "malformed" };
  if (exp * 1000 < (now ?? Date.now())) return { ok: false, reason: "expired" };

  let want;
  try { want = await mac(env, purpose, subject, exp); }
  catch { return { ok: false, reason: "unconfigured" }; }

  const got = String(token);
  if (got.length !== want.length) return { ok: false, reason: "invalid" };
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: "invalid" };
}

/** The query string both halves of a signed link need. */
export async function linkParams(env, purpose, subject, opts) {
  const { token, expires } = await sign(env, purpose, subject, opts);
  return `u=${encodeURIComponent(subject)}&e=${expires}&t=${token}`;
}
