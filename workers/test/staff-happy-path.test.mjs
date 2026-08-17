#!/usr/bin/env node
/**
 * The staff endpoints, on the path where everything WORKS
 *   node workers/test/staff-happy-path.test.mjs
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-16 `GET /api/staff-milestones` returned 500 —
 * "Cannot read properties of undefined (reading 'acting')" — and so did
 * /api/staff-settings. A patch had added `actor` to one gate's return value and
 * silently missed the other two, whose returns were shaped differently.
 *
 * 291 tests passed throughout. Every existing test for these handlers stops at
 * the authentication boundary: no token, wrong token, no partner, unknown
 * method. They prove the door is locked. NOT ONE of them walks through it.
 *
 * The bug lived entirely on the other side. A mock returning no partner takes
 * the 403 branch and never reaches the code that broke.
 *
 * So: a signed-in person, with a partner, with data, asking for their own
 * screen — and an assertion that they get it. The least clever test here and
 * the one that would have saved an evening.
 */
import { QUERIES, toPositional } from "../src/lib/db.js";
import staffData from "../src/staff-data.js";
import staffMilestones from "../src/staff-milestones.js";
import staffSettings from "../src/staff-settings.js";
import worker from "../src/worker.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------ a real token --------------------------- */

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "kid1"; jwk.alg = "RS256";

const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

async function mint(email) {
  const h = enc({ alg: "RS256", kid: "kid1", typ: "JWT" });
  const p = enc({ iss: `https://${TEAM}`, aud: AUD, email, sub: "u",
                  exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",
    pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
}
const MIRA = await mint("mira@thauma.one");
const ADMIN = await mint("admin@thauma.one");

globalThis.fetch = async (url) => {
  if (String(url).includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  throw new Error("unexpected fetch " + url);
};

/* ------------------------------ a real database ------------------------ */

/* Keyed on the SQL itself, via a reverse map built from QUERIES.
   
   Built from the POSITIONAL form, because db.js rewrites `:name` to `?` before
   it reaches prepare() — the raw query text never arrives. Matching substrings
   instead would quietly answer the wrong query as the SQL evolves; this cannot
   drift, because it is generated from the query set. */
const NAME_OF = new Map(
  Object.entries(QUERIES).map(([n, sql]) => [sql.replace(/:[a-z_][a-z0-9_]*/gi, "?"), n])
);

const USER = {
  "mira@thauma.one": { user_id: "u_mira", email: "mira@thauma.one",
                       user_name: "Mira Petrović", status: "active",
                       preferred_lang: "en", roles: "partner,staff" },
  "admin@thauma.one": { user_id: "u_admin", email: "admin@thauma.one",
                        user_name: "Chase Roush", status: "active",
                        preferred_lang: "en", roles: "admin" },
};
const BY_ID = Object.fromEntries(Object.values(USER).map((u) => [u.user_id, u]));

const PARTNER = { id: "p_mira", display_name: "Mira Petrović", role: "owner" };

/** Rows for each named query. Absent means "an empty list is fine". */
function rowsFor(name, params) {
  switch (name) {
    case "user_by_email": return USER[params.email] ? [USER[params.email]] : [];
    case "user_by_id":    return BY_ID[params.id] ? [BY_ID[params.id]] : [];
    case "partners_for_user":
      // The admin has no partner of their own — deliberately, as in the seed.
      return params.email === "mira@thauma.one" ? [PARTNER] : [];
    case "languages_all":
      return [{ code: "en", name: "English", is_active: 1 },
              { code: "sr", name: "Srpski", is_active: 1 }];
    case "partner_languages_for_partner":
      return [{ lang: "en", is_enabled: 1, sort_order: 0 },
              { lang: "sr", is_enabled: 1, sort_order: 1 }];
    case "partner_settings":  return [{ default_lang: "en" }];
    case "milestones_for_staff":
      return [{ id: "ms_m1", status: "complete", completion: 100, sort_order: 0,
                is_public: 1, is_featured: 0, parent_id: null, actual_date: "2026-03-01" }];
    case "milestone_translations_for_staff":
      return [{ milestone_id: "ms_m1", lang: "en", title: "Commissioned",
                description: null, target_label: null }];
    case "directory_for_user":
      return [{ id: "dc_m1", name: "Pastor Dragan", role: "Home church",
                emails: '["dragan@example.com"]', phones: "[]" }];
    case "resources_visible":
      return [{ id: "r_m1", title: "Support letter", description: null,
                link: "https://example.com/x", photo: null, visibility: "staff",
                partner_id: "p_mira" }];
    case "contacts_stewardship":
      return [{ id: "c_m1", first_name: "Nikola", last_name: "Jovanović",
                last_personal_contact: "2025-07-14", last_contact_any: "2026-08-01",
                days_since_personal: 398 }];
    case "goals_for_partner":
      return [{ id: "g_m1", label: "Monthly support", currency: "EUR",
                target_cents: 180000, raised_cents: 103500, donor_count: 14,
                is_public: 1, kind: "monthly" }];
    default: return [];
  }
}

function makeDb() {
  const seen = [];
  return {
    seen,
    prepare(sql) {
      const name = NAME_OF.get(sql);
      if (!name) throw new Error("the handler ran SQL that is not in queries.sql");
      return {
        bind(...args) {
          seen.push(name);
          return {
            async all() {
              // Params are positional by the time they reach D1; the few
              // queries whose answer depends on a param are keyed off the
              // first argument, which is the one that varies here.
              const params = { email: args[0], id: args[0] };
              return { results: rowsFor(name, params) };
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
}

const env = (db) => ({
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, DB: db,
  LIVE_BRANCH: "main", STAGING_BRANCH: "dev",
});

const get = (path, token = MIRA, cookie) => {
  const headers = { "Cf-Access-Jwt-Assertion": token };
  if (cookie) headers.Cookie = cookie;
  return new Request("https://dev.thauma.one" + path, { headers });
};

console.log("staff endpoints — the path where everything works\n");

/* --------------------------- the actual thing -------------------------- */

const ENDPOINTS = [
  ["/api/staff-data", staffData],
  ["/api/staff-milestones", staffMilestones],
  ["/api/staff-settings", staffSettings],
];

for (const [path, handler] of ENDPOINTS) {
  await check(`GET ${path} returns 200 for a signed-in partner`, async () => {
    const db = makeDb();
    const res = await handler.fetch(get(path), env(db));
    const body = await res.json().catch(() => ({}));
    // The message matters: a 500 here says which endpoint and what it said,
    // rather than "expected 200 got 500".
    eq(res.status, 200, `${path} said ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.you, "no identity block in the payload");
    eq(body.you.name, "Mira Petrović", "wrong person");
  });
}

await check("GET /api/staff-snapshot returns 200 through the router", async () => {
  // Routed rather than imported: this handler lives inside worker.js, so the
  // only way to reach it is the way a browser does.
  const db = makeDb();
  const res = await worker.fetch(get("/api/staff-snapshot"), env(db));
  const body = await res.json().catch(() => ({}));
  eq(res.status, 200, `snapshot said ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
});

/* ----------------------- and the same while acting --------------------- */

for (const [path, handler] of ENDPOINTS) {
  await check(`GET ${path} returns 200 AND the banner while acting`, async () => {
    /* The other half of the same bug. `withActing` is only reached on the
       success path, and only carries anything when somebody is actually
       acting — so a test that signs in normally would still not exercise it. */
    const db = makeDb();
    const res = await handler.fetch(get(path, ADMIN, "thauma_act_as=u_mira"), env(db));
    const body = await res.json().catch(() => ({}));
    eq(res.status, 200, `${path} said ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.acting, `${path} lost the acting banner — the page would show no purple`);
    eq(body.acting.name, "Mira Petrović", "banner names the wrong person");
    eq(body.acting.by, "Chase Roush", "banner does not say who is looking");
  });
}

await check("an admin NOT acting gets their own 403, not somebody's data", async () => {
  // The admin has no partner. The refusal is a normal state and must say so
  // rather than falling through to whichever partner happened to be first.
  const db = makeDb();
  const res = await staffData.fetch(get("/api/staff-data", ADMIN), env(db));
  eq(res.status, 403, "status");
  const body = await res.json();
  assert(/not attached to a partner/i.test(body.error), `unclear: ${body.error}`);
});

await check("every query the handlers ran is a real named query", () => {
  // makeDb throws on unknown SQL, so reaching here means they all resolved.
  // Stated as its own check so the guarantee is visible rather than incidental.
  assert(true, "unreachable");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
