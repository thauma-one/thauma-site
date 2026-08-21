#!/usr/bin/env node
/**
 * A partner's mailing lists, and the wall around them
 *   node workers/test/staff-mailing.test.mjs
 *
 * WHAT THIS TESTS, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 * db/test_schema.py proves the DATABASE refuses a subscriber whose partner
 * disagrees with its list. That is the wall. This proves the ENDPOINT never
 * hands the database a partner id that came from the caller — because a
 * perfect wall does not help if the code politely carries requests over it.
 *
 * So every query call is recorded and its partner_id asserted against the
 * partner resolved from the SIGNED-IN ACCOUNT. A request that names a partner,
 * a list, or a subscriber belonging to somebody else must still be scoped to
 * the caller's own.
 */
import handler, { cleanList, slugify } from "../src/staff-mailing.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- a real Access token, verified for real ---- */
const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1"; jwk.alg = "RS256";
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "chase@thauma.one", sub: "u-1",
                exp: Math.floor(Date.now() / 1000) + 600 });
const TOKEN = `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
  pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;

globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch: " + url);
};

/**
 * A database that records every call. Returns plausible rows so the handler
 * reaches its own logic, and keeps the params so the test can inspect them.
 */
function envWith(roles = "staff", { partners = [{ id: "p_chase", display_name: "Chase" }] } = {}) {
  const calls = [];
  const env = {
    ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD,
    calls,
    DB: {
      prepare(sql) {
        const run = async () => {
          calls.push({ sql, params: env._lastParams });
          /* partner_users FIRST. partners_for_user selects FROM users too, so
             matching on that alone hands back an identity row where a list of
             partners was asked for — which made an account with no partner
             look like it had one. */
          if (/partner_users/i.test(sql)) return { results: partners };
          if (/FROM users/i.test(sql) && /email/i.test(sql)) {
            return { results: [{ user_id: "u_1", email: "chase@thauma.one",
                                 user_name: "Chase", status: "active", roles }] };
          }
          if (/FROM mailing_lists/i.test(sql)) {
            return { results: [{ id: "ml_1", partner_id: "p_chase", slug: "newsletter",
                                 name: "News", from_name: "C", from_email: "c@x.one" }] };
          }
          return { results: [] };
        };
        return { bind(...args) { env._lastParams = args; return { all: run, run }; },
                 all: run, run };
      },
    },
  };
  return env;
}

const req = (method, { body, query = "" } = {}) =>
  new Request(`https://x/api/staff-mailing${query}`, {
    method,
    headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });

/** Every partner_id the handler bound, across all queries. */
function boundPartnerIds(env) {
  const out = new Set();
  for (const c of env.calls) {
    for (const v of c.params || []) {
      if (typeof v === "string" && v.startsWith("p_")) out.add(v);
    }
  }
  return [...out];
}

console.log("staff-mailing — a partner's lists, and the wall around them\n");

/* ------------------------------- isolation ------------------------------- */

await check("a request naming ANOTHER partner is still scoped to the caller's", async () => {
  const env = envWith("staff");
  /* The request tries every way a caller might name somebody else. */
  const res = await handler.fetch(req("POST", {
    body: { partner_id: "p_mira", partnerId: "p_mira", scope: "p_mira",
            name: "Sneaky", from_name: "S", from_email: "s@x.one" },
  }), env);
  assert(res.status < 500, `unexpected ${res.status}`);
  const ids = boundPartnerIds(env);
  assert(!ids.includes("p_mira"),
    `the caller's partner id was taken from the REQUEST — bound ${JSON.stringify(ids)}`);
  assert(ids.includes("p_chase"), `expected p_chase to be the scope, bound ${JSON.stringify(ids)}`);
});

await check("reading a list belonging to somebody else is 404, not 403", async () => {
  /* 403 would confirm the list exists. The absence of a thing and the refusal
     to show it must look identical from outside. */
  const env = envWith("staff");
  env.DB.prepare = (sql) => {
    const run = async () => {
      if (/partner_users/i.test(sql)) return { results: [{ id: "p_chase", display_name: "Chase" }] };
      if (/FROM users/i.test(sql) && /email/i.test(sql)) {
        return { results: [{ user_id: "u_1", email: "chase@thauma.one",
                             user_name: "Chase", status: "active", roles: "staff" }] };
      }
      return { results: [] };            // the list is not theirs -> no row
    };
    return { bind() { return { all: run, run }; }, all: run, run };
  };
  const res = await handler.fetch(req("GET", { query: "?list=ml_belongs_to_mira" }), env);
  eq(res.status, 404, "status");
});

/* --------------------------- the organisation ---------------------------- */

await check("staff cannot reach the organisation's lists", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("GET", { query: "?scope=organisation" }), env);
  eq(res.status, 403, "status");
  assert(/communications/i.test((await res.json()).error), "should name the role needed");
});

await check("communications CAN reach the organisation's lists", async () => {
  const env = envWith("staff,communications");
  const res = await handler.fetch(req("GET", { query: "?scope=organisation" }), env);
  eq(res.status, 200, "status");
  eq((await res.json()).scope, "organisation", "scope");
});

await check("admin can too, and the console is told so", async () => {
  const env = envWith("admin,staff");
  const res = await handler.fetch(req("GET"), env);
  const body = await res.json();
  eq(body.may_send_as_organisation, true, "flag");
});

await check("a partner is NOT told they may send as the organisation", async () => {
  const env = envWith("staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.may_send_as_organisation, false, "flag");
});

/* An ambiguous request must resolve to the smaller scope, never the larger. */
await check("no scope means the caller's own lists, not the organisation's", async () => {
  const env = envWith("admin,staff");
  const body = await (await handler.fetch(req("GET"), env)).json();
  eq(body.scope, "partner", "an unspecified scope must not widen to the organisation");
});

await check("an account with no partner is refused, and told why", async () => {
  const env = envWith("staff", { partners: [] });
  const res = await handler.fetch(req("GET"), env);
  eq(res.status, 403, "status");
  assert(/not attached to a partner/i.test((await res.json()).error), "should explain");
});

/* ------------------------------ validation ------------------------------- */

await check("a list needs a name, a sender name and a sender address", async () => {
  eq(cleanList({}).error, "A list needs a name.", "no name");
  eq(cleanList({ name: "News" }).error,
    "A list needs a sender name — who the email is from.", "no sender name");
  assert(/sender address/.test(cleanList({ name: "News", from_name: "C" }).error),
    "no sender address");
});

await check("an address that cannot be an address is refused", async () => {
  assert(cleanList({ name: "N", from_name: "C", from_email: "not-an-address" }).error,
    "should refuse a bare word");
  assert(!cleanList({ name: "N", from_name: "C", from_email: "a@b.one" }).error,
    "should accept an ordinary address");
});

await check("a slug is derived when absent, and folded not stripped", async () => {
  eq(cleanList({ name: "Prayer Partners", from_name: "C", from_email: "a@b.one" }).value.slug,
    "prayer-partners", "derived");
  eq(slugify("Molitveni Partneri"), "molitveni-partneri", "plain");
  eq(slugify("Мира"), null, "a name with nothing latin in it yields no slug");
});

await check("is_open defaults OFF — a list is not publicly joinable by accident", async () => {
  eq(cleanList({ name: "N", from_name: "C", from_email: "a@b.one" }).value.is_open, 0, "default");
  eq(cleanList({ name: "N", from_name: "C", from_email: "a@b.one", is_open: true }).value.is_open,
    1, "when asked for");
});

await check("a status the console does not offer is refused", async () => {
  const env = envWith("staff");
  const res = await handler.fetch(req("POST", {
    body: { action: "subscriber", id: "s_1", status: "subscribed_secretly" },
  }), env);
  eq(res.status, 400, "status");
});

await check("only GET, POST and DELETE are allowed", async () => {
  for (const m of ["PUT", "PATCH"]) {
    const res = await handler.fetch(req(m, { body: {} }), envWith("staff"));
    eq(res.status, 405, `${m} status`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
