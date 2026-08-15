#!/usr/bin/env node
/**
 * Tests for _shared/access.js
 *
 * Generates a throwaway RSA keypair, stands in as Cloudflare's JWKS endpoint,
 * and mints tokens to prove the verifier accepts exactly what it should and
 * refuses everything else.
 *
 * The negative cases matter more than the positive one. A verifier that
 * accepts a valid signature but ignores `aud` will happily accept a token
 * minted for someone ELSE'S Access application.
 *
 *   node netlify/functions/_shared/access.test.js
 */
const crypto = require("crypto");
const path = require("path");

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag-0123456789abcdef";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });
jwk.kid = "test-kid-1";
jwk.alg = "RS256";
jwk.use = "sig";

// Stand in as https://<team>/cdn-cgi/access/certs
global.fetch = async (url) => {
  if (!String(url).includes("/cdn-cgi/access/certs")) throw new Error("unexpected fetch " + url);
  return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
};

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mint({ kid = "test-kid-1", iss = `https://${TEAM}`, aud = AUD,
                exp = Math.floor(Date.now() / 1000) + 600, email = "chase@thauma.one",
                alg = "RS256", key = privateKey, tamper = false } = {}) {
  const h = b64url(JSON.stringify({ alg, kid, typ: "JWT" }));
  const p = b64url(JSON.stringify({ iss, aud, exp, email, sub: "user-1" }));
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key));
  return `${h}.${p}.${tamper ? sig.slice(0, -4) + "AAAA" : sig}`;
}

// Loaded AFTER fetch is stubbed
const mod = require(path.join(__dirname, "access.js"));
const { verifyAccessJwt, extractToken, requireAccess } = mod;

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  console.log("access.js — Cloudflare Access JWT verification\n");
  const opts = { teamDomain: TEAM, aud: AUD };

  await check("valid token is accepted, email extracted", async () => {
    const p = await verifyAccessJwt(mint(), opts);
    assert(p, "expected a payload");
    assert(p.email === "chase@thauma.one", `email was ${p && p.email}`);
  });

  await check("token for a DIFFERENT application is refused (aud)", async () => {
    const p = await verifyAccessJwt(mint({ aud: "someone-elses-app-tag" }), opts);
    assert(p === null, "a token for another Access app was accepted");
  });

  await check("token from a DIFFERENT team is refused (iss)", async () => {
    const p = await verifyAccessJwt(mint({ iss: "https://attacker.cloudflareaccess.com" }), opts);
    assert(p === null, "a token from another team was accepted");
  });

  await check("expired token is refused", async () => {
    const p = await verifyAccessJwt(mint({ exp: Math.floor(Date.now() / 1000) - 10 }), opts);
    assert(p === null, "an expired token was accepted");
  });

  await check("tampered signature is refused", async () => {
    const p = await verifyAccessJwt(mint({ tamper: true }), opts);
    assert(p === null, "a tampered token was accepted");
  });

  await check("token signed by the wrong key is refused", async () => {
    const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const p = await verifyAccessJwt(mint({ key: other }), opts);
    assert(p === null, "a token signed by an unknown key was accepted");
  });

  await check("unknown kid is refused", async () => {
    const p = await verifyAccessJwt(mint({ kid: "not-a-real-kid" }), opts);
    assert(p === null, "a token with an unknown kid was accepted");
  });

  await check("alg=none is refused", async () => {
    const h = b64url(JSON.stringify({ alg: "none", kid: "test-kid-1", typ: "JWT" }));
    const p = b64url(JSON.stringify({ iss: `https://${TEAM}`, aud: AUD,
                                      exp: Math.floor(Date.now() / 1000) + 600 }));
    const r = await verifyAccessJwt(`${h}.${p}.`, opts);
    assert(r === null, "alg=none was accepted");
  });

  await check("malformed input is refused, not thrown", async () => {
    for (const bad of [null, "", "abc", "a.b", "a.b.c.d", "{}.{}.{}"]) {
      const r = await verifyAccessJwt(bad, opts);
      assert(r === null, `accepted malformed input: ${JSON.stringify(bad)}`);
    }
  });

  await check("token read from the Cf-Access-Jwt-Assertion header", async () => {
    const t = mint();
    assert(extractToken({ headers: { "cf-access-jwt-assertion": t } }) === t, "header not read");
  });

  await check("token read from the CF_Authorization cookie", async () => {
    const t = mint();
    const got = extractToken({ headers: { cookie: `foo=1; CF_Authorization=${t}; bar=2` } });
    assert(got === t, "cookie not read");
  });

  await check("no token at all yields null", async () => {
    assert(extractToken({ headers: {} }) === null, "expected null");
  });

  await check("requireAccess FAILS CLOSED when env is missing", async () => {
    delete process.env.ACCESS_TEAM_DOMAIN;
    delete process.env.ACCESS_AUD;
    const r = await requireAccess({ headers: { "cf-access-jwt-assertion": mint() } });
    assert(r.denied, "expected denial when unconfigured");
    assert(r.denied.statusCode === 500, `expected 500, got ${r.denied.statusCode}`);
    assert(!r.user, "must not return a user when unconfigured");
  });

  await check("requireAccess allows a good token when configured", async () => {
    process.env.ACCESS_TEAM_DOMAIN = TEAM;
    process.env.ACCESS_AUD = AUD;
    const r = await requireAccess({ headers: { "cf-access-jwt-assertion": mint() } });
    assert(!r.denied, "unexpected denial: " + JSON.stringify(r.denied));
    assert(r.user && r.user.email === "chase@thauma.one", "user not returned");
  });

  await check("requireAccess denies with 401 when the token is bad", async () => {
    const r = await requireAccess({ headers: { "cf-access-jwt-assertion": mint({ aud: "wrong" }) } });
    assert(r.denied && r.denied.statusCode === 401, "expected 401");
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
