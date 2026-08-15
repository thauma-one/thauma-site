#!/usr/bin/env node
/**
 * Tests for workers/src/lib/access.js (WebCrypto version)
 *
 * Mirrors netlify/functions/_shared/access.test.js so the port is provably
 * equivalent. Runs on plain Node — WebCrypto is global from Node 18.
 *
 *   node workers/test/access.test.mjs
 */
import { verifyAccessJwt, extractToken, requireAccess, __resetJwksCache }
  from "../src/lib/access.js";

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag-0123456789abcdef";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1";
jwk.alg = "RS256";

const otherPair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);

// Stand in as https://<team>/cdn-cgi/access/certs
globalThis.fetch = async (url) => {
  if (!String(url).includes("/cdn-cgi/access/certs")) throw new Error("unexpected fetch " + url);
  return new Response(JSON.stringify({ keys: [jwk] }), {
    headers: { "Content-Type": "application/json" },
  });
};

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mint({ kid = "test-kid-1", iss = `https://${TEAM}`, aud = AUD,
                      exp = Math.floor(Date.now() / 1000) + 600,
                      email = "chase@thauma.one", alg = "RS256",
                      key = pair.privateKey, tamper = false } = {}) {
  const h = enc({ alg, kid, typ: "JWT" });
  const p = enc({ iss, aud, exp, email, sub: "user-1" });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key,
    new TextEncoder().encode(`${h}.${p}`));
  let s = b64url(sig);
  if (tamper) s = s.slice(0, -4) + "AAAA";
  return `${h}.${p}.${s}`;
}

let pass = 0, fail = 0;
async function check(name, fn) {
  __resetJwksCache();
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const req = (headers) => new Request("https://dev.thauma.one/staff/", { headers });

console.log("access.js (Workers/WebCrypto) — Cloudflare Access JWT verification\n");
const opts = { teamDomain: TEAM, aud: AUD };

await check("valid token is accepted, email extracted", async () => {
  const p = await verifyAccessJwt(await mint(), opts);
  assert(p, "expected a payload");
  assert(p.email === "chase@thauma.one", `email was ${p && p.email}`);
});

await check("token for a DIFFERENT application is refused (aud)", async () => {
  assert(await verifyAccessJwt(await mint({ aud: "someone-elses-app" }), opts) === null,
    "a token for another Access app was accepted");
});

await check("token from a DIFFERENT team is refused (iss)", async () => {
  assert(await verifyAccessJwt(await mint({ iss: "https://attacker.cloudflareaccess.com" }), opts) === null,
    "a token from another team was accepted");
});

await check("expired token is refused", async () => {
  assert(await verifyAccessJwt(await mint({ exp: Math.floor(Date.now() / 1000) - 10 }), opts) === null,
    "an expired token was accepted");
});

await check("tampered signature is refused", async () => {
  assert(await verifyAccessJwt(await mint({ tamper: true }), opts) === null,
    "a tampered token was accepted");
});

await check("token signed by the wrong key is refused", async () => {
  assert(await verifyAccessJwt(await mint({ key: otherPair.privateKey }), opts) === null,
    "a token signed by an unknown key was accepted");
});

await check("unknown kid is refused", async () => {
  assert(await verifyAccessJwt(await mint({ kid: "nope" }), opts) === null,
    "unknown kid accepted");
});

await check("alg=none is refused", async () => {
  const h = enc({ alg: "none", kid: "test-kid-1", typ: "JWT" });
  const p = enc({ iss: `https://${TEAM}`, aud: AUD, exp: Math.floor(Date.now() / 1000) + 600 });
  assert(await verifyAccessJwt(`${h}.${p}.`, opts) === null, "alg=none accepted");
});

await check("malformed input is refused, not thrown", async () => {
  for (const bad of [null, "", "abc", "a.b", "a.b.c.d", "!!!.???.###"]) {
    assert(await verifyAccessJwt(bad, opts) === null, `accepted ${JSON.stringify(bad)}`);
  }
});

await check("token read from the Cf-Access-Jwt-Assertion header", async () => {
  const t = await mint();
  assert(extractToken(req({ "cf-access-jwt-assertion": t })) === t, "header not read");
});

await check("token read from the CF_Authorization cookie", async () => {
  const t = await mint();
  assert(extractToken(req({ cookie: `a=1; CF_Authorization=${t}; b=2` })) === t, "cookie not read");
});

await check("no token yields null", async () => {
  assert(extractToken(req({})) === null, "expected null");
});

await check("requireAccess FAILS CLOSED when env is missing", async () => {
  const r = await requireAccess(req({ "cf-access-jwt-assertion": await mint() }), {});
  assert(r.denied, "expected denial");
  assert(r.denied.status === 500, `expected 500, got ${r.denied.status}`);
  assert(!r.user, "must not return a user when unconfigured");
});

await check("requireAccess allows a good token when configured", async () => {
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const r = await requireAccess(req({ "cf-access-jwt-assertion": await mint() }), env);
  assert(!r.denied, "unexpected denial");
  assert(r.user?.email === "chase@thauma.one", "user not returned");
});

await check("requireAccess denies with 401 on a bad token", async () => {
  const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
  const r = await requireAccess(req({ "cf-access-jwt-assertion": await mint({ aud: "x" }) }), env);
  assert(r.denied?.status === 401, "expected 401");
});

await check("denials are JSON, not an HTML error page", async () => {
  const r = await requireAccess(req({}), { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
  assert(r.denied.headers.get("content-type") === "application/json", "not JSON");
  assert((await r.denied.json()).error, "no error field");
});

await check("ACCESS_AUD accepts a COMMA-SEPARATED list", async () => {
  // dev.thauma.one and next.thauma.one are separate Access applications with
  // separate tags; one Worker has to accept both.
  const other = "second-app-tag";
  const multi = { teamDomain: TEAM, aud: `${AUD},${other}` };
  assert(await verifyAccessJwt(await mint({ aud: AUD }), multi), "first tag rejected");
  assert(await verifyAccessJwt(await mint({ aud: other }), multi), "second tag rejected");
  assert(await verifyAccessJwt(await mint({ aud: "third" }), multi) === null,
    "a tag NOT in the list was accepted");
});

await check("whitespace around list entries is tolerated", async () => {
  const multi = { teamDomain: TEAM, aud: `  ${AUD} , other-tag  ` };
  assert(await verifyAccessJwt(await mint(), multi), "padded tag rejected");
});

await check("an empty ACCESS_AUD denies rather than allowing everything", async () => {
  for (const bad of ["", "   ", ",,,"]) {
    const r = await verifyAccessJwt(await mint(), { teamDomain: TEAM, aud: bad });
    assert(r === null, `empty aud (${JSON.stringify(bad)}) accepted a token`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
