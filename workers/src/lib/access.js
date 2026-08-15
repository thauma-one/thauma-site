/**
 * access.js — verify a Cloudflare Access JWT, Workers-native
 *
 * Port of netlify/functions/_shared/access.js. Same checks, same fail-closed
 * behaviour, but built on **WebCrypto** rather than node:crypto.
 *
 * Why not just run the Node version under nodejs_compat: it would work, but
 * WebCrypto is native to the runtime, needs no compatibility flag, and is the
 * thing Workers is actually optimised for. It also runs unmodified on Node 18+,
 * so the tests need no Worker runtime.
 *
 * WHY THE WORKER VERIFIES THIS AT ALL, rather than trusting Access to be in
 * front: an Access application is scoped to a hostname/path, and it is easy for
 * a route to end up outside that scope. Measured on Netlify 2026-08-14 —
 * /staff/ was gated while /.netlify/functions/staff-data was not. The same
 * mistake is available on Workers. An endpoint that is only safe because of a
 * routing rule elsewhere is one dashboard edit away from being public.
 *
 * Bindings/vars expected on `env`:
 *   ACCESS_TEAM_DOMAIN   e.g. thaumaone.cloudflareaccess.com
 *   ACCESS_AUD           comma-separated Audience tag(s)
 *
 * ACCESS_AUD IS A LIST, not a single value, and that is not speculative
 * generality. Each Access application has its own AUD, and one Worker serves
 * several hostnames — dev, staging and production each need their own
 * application. Verified 2026-08-15: dev.thauma.one and next.thauma.one issue
 * tokens with different tags, so a single-value check silently rejected every
 * token from the newer one.
 *
 * The aud check itself stays strict: the token's audience must appear in this
 * list. Widening it to "any audience" would accept a token minted for an
 * unrelated Access application in any organisation.
 */

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = { url: null, at: 0, keys: null };

function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

async function getKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache.keys && jwksCache.url === url && Date.now() - jwksCache.at < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  if (!keys.length) throw new Error("JWKS returned no keys");
  jwksCache = { url, at: Date.now(), keys };
  return keys;
}

/** Header first, then the domain-wide cookie Access sets after login. */
export function extractToken(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header.trim();
  const cookie = request.headers.get("cookie") || "";
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Returns the verified payload, or null. Never throws on bad input — a
 * malformed token is simply an unauthenticated request.
 */
export async function verifyAccessJwt(token, { teamDomain, aud }) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headB64, payloadB64, sigB64] = parts;

  let head, payload;
  try {
    head = JSON.parse(b64urlToString(headB64));
    payload = JSON.parse(b64urlToString(payloadB64));
  } catch {
    return null;
  }
  // Pin the algorithm. Accepting whatever the token claims is how "alg: none"
  // and algorithm-confusion attacks work.
  if (!head || head.alg !== "RS256" || !head.kid) return null;

  let keys;
  try {
    keys = await getKeys(teamDomain);
  } catch {
    return null; // can't reach the JWKS -> fail closed
  }
  const jwk = keys.find((k) => k.kid === head.kid);
  if (!jwk) return null;

  let ok = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(sigB64),
      new TextEncoder().encode(`${headB64}.${payloadB64}`)
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  // Signature is good; the claims still have to be right. A valid token for a
  // DIFFERENT Access application is not a token for this one.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;

  // Both sides can be lists: a token may carry several audiences, and we may
  // accept several applications. Any overlap is a match; no overlap is not.
  const tokenAuds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const allowed = String(aud).split(",").map((a) => a.trim()).filter(Boolean);
  if (!allowed.length) return null;
  if (!tokenAuds.some((a) => allowed.includes(a))) return null;

  return payload;
}

/**
 * Guard for a Worker route. Returns { user } or { denied: Response }.
 * Missing configuration DENIES — a misconfigured deploy must not serve
 * staff data unauthenticated.
 */
export async function requireAccess(request, env) {
  const teamDomain = env?.ACCESS_TEAM_DOMAIN;
  const aud = env?.ACCESS_AUD;

  const deny = (status, error) => ({
    denied: new Response(JSON.stringify({ error }), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  });

  if (!teamDomain || !aud) return deny(500, "Access is not configured on this deploy");

  const payload = await verifyAccessJwt(extractToken(request), { teamDomain, aud });
  if (!payload) return deny(401, "Not authorized");

  return {
    user: {
      email: payload.email || payload.common_name || "unknown",
      sub: payload.sub || null,
    },
  };
}

/** Test seam — the module-level JWKS cache would otherwise leak between tests. */
export function __resetJwksCache() {
  jwksCache = { url: null, at: 0, keys: null };
}
