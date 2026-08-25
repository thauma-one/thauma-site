/**
 * unsub.js — the token in an unsubscribe link
 *
 * WHY NOT A COLUMN. `subscribers.confirm_token` exists and is deliberately
 * CLEARED once used, so a stale confirmation link stops working. An
 * unsubscribe link is the opposite: it has to keep working for as long as the
 * email it sits in exists, which may be years. Reusing that column would mean
 * either never clearing it — losing the single-use property that makes
 * confirmation safe — or storing a second token that can never be rotated.
 *
 * So there is no token stored at all. The link carries a subscriber's id and
 * an HMAC of that id under a secret only this Worker holds. Nothing to leak
 * from the database, nothing to keep in step, and no lookup that can drift.
 *
 * IDs ARE GUESSABLE AND THAT IS FINE. The signature is what authorises, not
 * the id — someone who knows an id still cannot produce a link that verifies.
 * The reverse would not be true of a stored token discovered in a backup.
 *
 * Truncated to 128 bits. This authorises removing somebody from a list, which
 * is the SAFE direction: the worst a forged link achieves is what its holder
 * could achieve by clicking the real one in their own email.
 */

const enc = new TextEncoder();

/**
 * NO FALLBACK, AND THAT IS THE POINT.
 *
 * This began as `env.SIGNUP_SALT || env.MAIL_FROM || "thauma-dev-salt"`, which
 * looks accommodating and is a hole: MAIL_FROM lives in wrangler.toml, in the
 * repository, in the open. A signing key anybody can read is not a signing key
 * — every unsubscribe link becomes forgeable by anyone who can clone the repo,
 * and the failure is invisible because the links keep working perfectly.
 *
 * A missing secret THROWS instead. A newsletter whose unsubscribe links cannot
 * be signed is a newsletter that must not go out, so the send fails loudly
 * here rather than arriving in a thousand inboxes with a broken way out.
 *
 * The "unsub:" prefix keeps this use from producing the same digest as any
 * other use of the same secret, which is what makes sharing one safe.
 */
async function key(env) {
  const secret = env.SIGNUP_SALT;
  if (!secret || String(secret).length < 16) {
    throw new Error(
      "SIGNUP_SALT is not set on this deploy, so unsubscribe links cannot be " +
      "signed. Nothing will be sent until it is.");
  }
  return crypto.subtle.importKey(
    "raw", enc.encode("unsub:" + secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function sign(env, subscriberId) {
  const mac = await crypto.subtle.sign("HMAC", await key(env), enc.encode(String(subscriberId)));
  return [...new Uint8Array(mac)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Constant-time compare. A timing leak here would let a signature be found.
 *
 * Returns false rather than throwing when the secret is missing: a visitor who
 * followed a link should see the ordinary page, not a stack trace, and a
 * deploy that cannot verify must not unsubscribe anybody on trust.
 */
export async function verify(env, subscriberId, token) {
  let want;
  try { want = await sign(env, subscriberId); }
  catch { return false; }
  const got = String(token || "");
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function unsubscribeUrl(env, origin, subscriberId) {
  return `${origin}/unsubscribe?s=${encodeURIComponent(subscriberId)}` +
         `&t=${await sign(env, subscriberId)}`;
}
