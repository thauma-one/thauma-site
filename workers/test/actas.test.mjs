#!/usr/bin/env node
/**
 * Tests for workers/src/lib/actas.js and admin-actas.js
 *   node workers/test/actas.test.mjs
 *
 * ONE INVARIANT MATTERS MORE THAN EVERYTHING ELSE HERE:
 *
 *     the cookie is a REQUEST, not a credential
 *
 * A staff member who sets `thauma_act_as` by hand must get exactly their own
 * data. Authority comes from the Cloudflare Access token, is re-derived on
 * every request, and the cookie is only ever consulted AFTER the real caller
 * has been confirmed to be an administrator.
 *
 * If that invariant breaks, any signed-in person can read any partner's
 * supporters by editing a cookie in their browser. Most of this file is that
 * one sentence, tested from several directions.
 */
import handler from "../src/admin-actas.js";
import { requestedTarget, resolveActor, setCookie, clearCookie, withActing }
  from "../src/lib/actas.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------- harness ------------------------------- */

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1"; jwk.alg = "RS256";

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function mint(email) {
  const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
  const p = enc({ iss: `https://${TEAM}`, aud: AUD, email, sub: "u",
                  exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}
const ADMIN_TOKEN = await mint("admin@thauma.one");
const STAFF_TOKEN = await mint("ana@thauma.one");

globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};

/** The real column shape user_by_email and user_by_id return. */
const ROWS = {
  "admin@thauma.one": { user_id: "u_admin", email: "admin@thauma.one",
                        user_name: "Chase Roush", status: "active",
                        preferred_lang: "en", roles: "admin" },
  "ana@thauma.one":   { user_id: "u_ana", email: "ana@thauma.one",
                        user_name: "Ana Marić", status: "active",
                        preferred_lang: "hr", roles: "partner,staff" },
  "sus@thauma.one":   { user_id: "u_sus", email: "sus@thauma.one",
                        user_name: "Suspended Person", status: "suspended",
                        preferred_lang: "en", roles: "staff" },
};
const BY_ID = Object.fromEntries(Object.values(ROWS).map((r) => [r.user_id, r]));

/** A database that answers user_by_email / user_by_id and records writes. */
function fakeDb() {
  const writes = [];
  const db = {
    async queryOne(name, params) {
      if (name === "user_by_email") return ROWS[params.email] || null;
      if (name === "user_by_id") {
        const r = BY_ID[params.id];
        // The real query gates on status = 'active'; the fake must too, or the
        // suspended-person test would pass for the wrong reason.
        return r && r.status === "active" ? r : null;
      }
      return null;
    },
    async query(name, params) {
      if (name === "audit_write") { writes.push(params); return []; }
      return [];
    },
  };
  db.writes = writes;
  return db;
}

const envAdmin = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DB: {} };

const req = (method, { token = ADMIN_TOKEN, cookie, body } = {}) => {
  const headers = { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": token };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://x/api/admin/act-as", {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
};

console.log("acting-as — the cookie is a request, not a credential\n");

/* ------------------------- reading the cookie -------------------------- */

await check("the cookie is read when it looks like a user id", () => {
  eq(requestedTarget(new Request("https://x", { headers: { Cookie: "thauma_act_as=u_ana" } })),
     "u_ana", "target");
});

await check("junk in the cookie is ignored without a database round trip", () => {
  for (const v of ["../../etc/passwd", "'; DROP TABLE users;--", "u_" + "x".repeat(200),
                   "admin", "", "u_ana; extra", "<script>"]) {
    const r = new Request("https://x", { headers: { Cookie: `thauma_act_as=${encodeURIComponent(v)}` } });
    eq(requestedTarget(r), null, `${JSON.stringify(v)} must not resolve`);
  }
});

await check("no cookie is not acting", () => {
  eq(requestedTarget(new Request("https://x")), null, "no cookie");
  eq(requestedTarget(new Request("https://x", { headers: { Cookie: "other=1" } })), null, "other cookies");
});

/* ------------------ THE INVARIANT: authority is the token -------------- */

await check("A NON-ADMIN SETTING THE COOKIE GETS THEIR OWN DATA", () => {
  /* The whole point. If this ever fails, any signed-in person can read any
     partner's supporters by editing a cookie in their browser. */
  return (async () => {
    const db = fakeDb();
    const request = new Request("https://x/api/staff-data", {
      headers: { Cookie: "thauma_act_as=u_admin" },
    });
    const actor = await resolveActor(request, envAdmin, db, { email: "ana@thauma.one" });

    eq(actor.email, "ana@thauma.one", "must resolve to their OWN address");
    eq(actor.acting, null, "must not be acting");
    eq(actor.me.user_id, "u_ana", "identity is their own");
  })();
});

await check("an admin setting the cookie DOES act", async () => {
  const db = fakeDb();
  const request = new Request("https://x/api/staff-data", {
    headers: { Cookie: "thauma_act_as=u_ana" },
  });
  const actor = await resolveActor(request, envAdmin, db, { email: "admin@thauma.one" });

  eq(actor.email, "ana@thauma.one", "queries run as the target");
  eq(actor.acting.id, "u_ana", "acting id");
  eq(actor.acting.name, "Ana Marić", "acting name");
  eq(actor.real.user_id, "u_admin", "the real caller is kept");
});

await check("an admin acting as a SUSPENDED account falls back to themselves", async () => {
  // Suspending somebody has to stop an administrator standing inside their
  // account too, or the suspension is only half a suspension.
  const db = fakeDb();
  const request = new Request("https://x/", { headers: { Cookie: "thauma_act_as=u_sus" } });
  const actor = await resolveActor(request, envAdmin, db, { email: "admin@thauma.one" });
  eq(actor.email, "admin@thauma.one", "fell back");
  eq(actor.acting, null, "not acting");
});

await check("an admin acting as a NON-EXISTENT account falls back to themselves", async () => {
  const db = fakeDb();
  const request = new Request("https://x/", { headers: { Cookie: "thauma_act_as=u_nobody" } });
  const actor = await resolveActor(request, envAdmin, db, { email: "admin@thauma.one" });
  eq(actor.email, "admin@thauma.one", "fell back");
  eq(actor.acting, null, "not acting");
});

await check("acting as yourself is just being yourself", async () => {
  const db = fakeDb();
  const request = new Request("https://x/", { headers: { Cookie: "thauma_act_as=u_admin" } });
  const actor = await resolveActor(request, envAdmin, db, { email: "admin@thauma.one" });
  eq(actor.acting, null, "no banner for standing in your own account");
});

/* ------------------------------ the cookie ----------------------------- */

await check("the cookie is Secure and scoped to the whole site", () => {
  const c = setCookie("u_ana");
  assert(/Secure/.test(c), "must be Secure");
  assert(/Path=\/;/.test(c), "must cover every page, not just /staff");
  assert(/SameSite=Lax/.test(c), "must be SameSite");
  assert(!/Max-Age|Expires/.test(c), "must be a session cookie — closing the browser ends it");
});

await check("clearing really clears", () => {
  assert(/Max-Age=0/.test(clearCookie()), "must expire it");
});

/* ------------------------------ the endpoint --------------------------- */

await check("a non-admin cannot start viewing anyone", async () => {
  const env = { ...envAdmin, DB: {} };
  const db = fakeDb();
  // Swap in the fake db by stubbing createDb's input: the handler builds its
  // own, so this asserts through the real path instead.
  const res = await handler.fetch(req("POST", { token: STAFF_TOKEN, body: { user_id: "u_admin" } }), {
    ...env,
    DB: { prepare: () => ({ bind: () => ({ async all() {
      return { results: [ROWS["ana@thauma.one"]] };
    } }) }) },
  });
  eq(res.status, 403, "status");
  assert(!(res.headers.get("set-cookie") || "").includes("thauma_act_as=u_"),
         "it set the cookie anyway");
});

await check("no Access token is refused", async () => {
  const res = await handler.fetch(new Request("https://x/api/admin/act-as"), envAdmin);
  eq(res.status, 401, "status");
});

await check("no handler method throws", async () => {
  const env = { ...envAdmin, DB: { prepare: () => ({ bind: () => ({ async all() {
    return { results: [ROWS["admin@thauma.one"]] };
  } }) }) } };
  for (const m of ["GET", "POST", "DELETE", "PUT"]) {
    const res = await handler.fetch(req(m, { body: m === "GET" ? undefined : {} }), env);
    assert(res && typeof res.status === "number", `${m} returned no Response`);
    await res.json().catch(() => ({}));
  }
});

await check("stopping always works, even with no cookie", async () => {
  // It is the way out. It must never be the thing that fails.
  const env = { ...envAdmin, DB: { prepare: () => ({ bind: () => ({ async all() {
    return { results: [ROWS["admin@thauma.one"]] };
  } }) }) } };
  const res = await handler.fetch(req("DELETE"), env);
  eq(res.status, 200, "status");
  assert(/Max-Age=0/.test(res.headers.get("set-cookie") || ""), "must clear the cookie");
});

/* ------------------------------- the payload --------------------------- */

await check("withActing adds the banner data, and only when acting", () => {
  const notActing = { acting: null, real: null };
  eq(withActing({ a: 1 }, notActing), { a: 1 }, "untouched when not acting");

  const acting = { acting: { id: "u_ana", name: "Ana Marić" },
                   real: { user_name: "Chase Roush", email: "admin@thauma.one" } };
  const out = withActing({ a: 1 }, acting);
  eq(out.acting.name, "Ana Marić", "whose account");
  eq(out.acting.by, "Chase Roush", "who is looking");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
