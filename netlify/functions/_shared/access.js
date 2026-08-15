// ============================================================================
// _shared/access.js — verify a Cloudflare Access JWT
// ============================================================================
// Replaces the Netlify Identity check that used to live in staff-data.js.
//
// WHY THE FUNCTION VERIFIES THIS ITSELF, rather than trusting Access to be in
// front of it: the Access application is scoped to /staff*, but functions are
// served from /.netlify/functions/*, which is NOT under that path. Verified on
// 2026-08-14 — /staff/ redirected to the login while the function endpoint was
// reachable directly. Access path rules are easy to get subtly wrong, and an
// endpoint that only works because of a routing rule somewhere else is one
// dashboard edit away from being public.
//
// Two places the token can arrive:
//   Cf-Access-Jwt-Assertion   header, injected when the path IS covered
//   CF_Authorization          cookie, set for the whole domain after login
// We accept either, so this keeps working regardless of how the Access
// application is scoped.
//
// Env:
//   ACCESS_TEAM_DOMAIN  e.g. thaumaone.cloudflareaccess.com
//   ACCESS_AUD          the application's Audience tag (Access app → Overview)
// Both are required. If either is missing this DENIES rather than allowing —
// a misconfigured deploy must fail closed.
// ============================================================================

const crypto = require("crypto");

const JWKS_TTL_MS = 60 * 60 * 1000; // Cloudflare rotates keys; an hour is fine
let jwksCache = { url: null, at: 0, keys: null };

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

async function getKeys(teamDomain) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = jwksCache.keys && jwksCache.url === url &&
                Date.now() - jwksCache.at < JWKS_TTL_MS;
  if (fresh) return jwksCache.keys;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json();
  const keys = body && Array.isArray(body.keys) ? body.keys : [];
  if (!keys.length) throw new Error("JWKS returned no keys");

  jwksCache = { url, at: Date.now(), keys };
  return keys;
}

// Pull the token out of the header, falling back to the cookie.
function extractToken(event) {
  const h = event.headers || {};
  const header = h["cf-access-jwt-assertion"] || h["Cf-Access-Jwt-Assertion"];
  if (header) return String(header).trim();

  const cookie = h.cookie || h.Cookie || "";
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

// Returns the verified payload, or null. Never throws on bad input — a
// malformed token is just an unauthenticated request.
async function verifyAccessJwt(token, { teamDomain, aud }) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headB64, payloadB64, sigB64] = parts;

  let head, payload;
  try {
    head = JSON.parse(b64urlToBuf(headB64).toString("utf8"));
    payload = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
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
    const pub = crypto.createPublicKey({ key: jwk, format: "jwk" });
    ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${headB64}.${payloadB64}`),
      pub,
      b64urlToBuf(sigB64)
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  // Signature is good; now the claims have to be right too. A valid token for
  // a DIFFERENT Access application is still not a token for this one.
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (payload.nbf && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;

  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(aud)) return null;

  return payload;
}

// Guard for handlers. Returns { user } when authorised, or { denied } — a
// ready-to-return 401/500 response.
async function requireAccess(event) {
  const teamDomain = process.env.ACCESS_TEAM_DOMAIN;
  const aud = process.env.ACCESS_AUD;

  if (!teamDomain || !aud) {
    // Fail CLOSED. A deploy missing its config must not serve staff data.
    return {
      denied: {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Access is not configured on this deploy" }),
      },
    };
  }

  const payload = await verifyAccessJwt(extractToken(event), { teamDomain, aud });
  if (!payload) {
    return {
      denied: {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Not authorized" }),
      },
    };
  }

  return {
    user: {
      email: payload.email || payload.common_name || "unknown",
      sub: payload.sub || null,
      identity: payload.identity_nonce || null,
    },
  };
}

module.exports = { requireAccess, verifyAccessJwt, extractToken };
