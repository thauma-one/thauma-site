/**
 * apikey.js — authenticate a partner site's build against Thauma
 *
 * WHAT THIS IS FOR, AND WHY IT IS NOT ACCESS
 * ---------------------------------------------------------------------------
 * The staff console authenticates a HUMAN with Cloudflare Access. This
 * authenticates a BUILD — chaseroush.com's CI, which has no browser, no
 * session and nobody to click a login button.
 *
 * The two must not share a mechanism. An Access token identifies a person and
 * unlocks their whole console; an API key identifies a partner site and
 * unlocks only what that site may publish. Reusing one for the other is how a
 * public website ends up holding a credential that can read supporter records.
 *
 * KEYS ARE STORED HASHED
 * ---------------------------------------------------------------------------
 * `api_keys.key_hash` holds SHA-256 of the key; the key itself is shown once,
 * at creation, and never stored. A dump of this database yields no working
 * credentials.
 *
 * SHA-256 with no salt and no stretching is the right call HERE and would be
 * wrong for passwords. A key is 32 bytes from a CSPRNG, so there is no
 * dictionary to attack and nothing for bcrypt's slowness to buy. Unsalted
 * also means the lookup is a single indexed query rather than a scan of every
 * row — which matters, because a per-row comparison would be a scan on the
 * hot path of every build.
 *
 * Comparison is done by the UNIQUE index on key_hash, not in JS, so there is
 * no byte-by-byte compare to time. The hash is over an already-random secret,
 * so a timing leak on the index lookup reveals nothing usable.
 */

/** SHA-256 hex, matching what db/mint_api_key.py writes. */
export async function hashKey(raw) {
  const bytes = new TextEncoder().encode(String(raw));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Read the key from the request.
 *
 * `Authorization: Bearer <key>` is the primary form. A `?key=` query parameter
 * is deliberately NOT accepted: query strings land in access logs, browser
 * history, and Referer headers, which is exactly how a build credential
 * escapes into places nobody is auditing.
 */
export function extractKey(request) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

/**
 * Resolve a request to the partner it may read, or a denial.
 *
 * Returns { partner } or { denied: Response }. Fails closed on everything:
 * no key, unknown key, revoked key, inactive partner, missing scope.
 */
export async function requirePartnerKey(request, db, { scope = "read:public" } = {}) {
  const deny = (status, error) => ({
    denied: new Response(JSON.stringify({ error }), {
      status,
      headers: {
        "Content-Type": "application/json",
        // A 401 without this is a protocol violation, and some HTTP clients
        // retry forever rather than surfacing the error.
        ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="thauma-partner-api"' } : {}),
      },
    }),
  });

  const raw = extractKey(request);
  if (!raw) return deny(401, "Missing API key. Send: Authorization: Bearer <key>");

  // Length check before hashing: rejects obvious junk without a crypto call,
  // and keeps a caller who pasted an empty variable from looking like a real
  // authentication failure in the logs.
  if (raw.length < 32) return deny(401, "Malformed API key");

  const row = await db.queryOne("api_key_lookup", { key_hash: await hashKey(raw) });
  // Same message for unknown, revoked and inactive-partner. Distinguishing
  // them tells an attacker which keys once existed.
  if (!row) return deny(401, "Invalid or revoked API key");

  const scopes = String(row.scopes || "").split(/[,\s]+/).filter(Boolean);
  if (!scopes.includes(scope)) {
    return deny(403, `This key does not carry the "${scope}" scope`);
  }

  return {
    partner: {
      id: row.partner_id,
      slug: row.slug,
      display_name: row.display_name,
      key_id: row.key_id,
      scopes,
    },
  };
}
