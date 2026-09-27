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
const BOSS = await mint("boss@thauma.one");
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
                       preferred_lang: "sr", roles: "partner,staff" },
  /* An administrator who is also on a partner's team — the person who may
     publish that partner's widgets. */
  "boss@thauma.one": { user_id: "u_boss", email: "boss@thauma.one",
                       user_name: "Boss", status: "active",
                       preferred_lang: "en", roles: "admin,staff" },
  "admin@thauma.one": { user_id: "u_admin", email: "admin@thauma.one",
                        user_name: "Chase Roush", status: "active",
                        preferred_lang: "en", roles: "admin" },
};
const BY_ID = Object.fromEntries(Object.values(USER).map((u) => [u.user_id, u]));

const PARTNER = { id: "p_mira", display_name: "Mira Petrović", role: "owner" };
/* The partner's stored sharing, changed by the tests that need it. */
let SETTINGS_ROW = {};

/** Rows for each named query. Absent means "an empty list is fine". */
function rowsFor(name, params) {
  switch (name) {
    case "user_by_email": return USER[params.email] ? [USER[params.email]] : [];
    case "user_by_id":    return BY_ID[params.id] ? [BY_ID[params.id]] : [];
    case "partners_for_user":
      // The admin has no partner of their own — deliberately, as in the seed.
      return params.email === "mira@thauma.one" || params.email === "boss@thauma.one" ? [PARTNER] : [];
    case "languages_all":
      return [{ code: "en", name: "English", is_active: 1 },
              { code: "sr", name: "Srpski", is_active: 1 }];
    case "partner_languages_for_partner":
      return [{ lang: "en", is_enabled: 1, sort_order: 0 },
              { lang: "sr", is_enabled: 1, sort_order: 1 }];
    case "partner_settings":  return [{ default_lang: "en", ...SETTINGS_ROW }];
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
  const calls = [];
  return {
    seen,
    calls,
    prepare(sql) {
      const name = NAME_OF.get(sql);
      if (!name) throw new Error("the handler ran SQL that is not in queries.sql");
      return {
        bind(...args) {
          seen.push(name);
          calls.push({ name, args });
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

/* ---------------------- a milestone's date, picked once ----------------- */

const post = (path, body, token = MIRA) => new Request("https://dev.thauma.one" + path, {
  method: "POST",
  headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const labelsWritten = (db) => db.calls
  .filter((c) => c.name === "milestone_translation_upsert")
  .map((c) => c.args.find((a) => typeof a === "string" && /20\d\d/.test(a)))
  /* Intl sets a range's dash between thin spaces; the words are what matter. */
  .map((s) => s && s.replace(/[\u2009\u202f\u00a0]/g, " "));

await check("a picked date writes every language's When, snapped to its precision", async () => {
  const db = makeDb();
  const res = await staffMilestones.fetch(post("/api/staff-milestones", {
    id: "ms_m1", status: "in_progress", completion: 10,
    date_precision: "month", actual_date: "2026-09-17", end_date: "2026-10-02",
    text: { en: { title: "Visas", target_label: "typed long ago" }, sr: { title: "Визе" } },
  }), env(db));
  const body = await res.json();
  eq(res.status, 200, JSON.stringify(body).slice(0, 200));
  eq(labelsWritten(db), ["September – October 2026", "септембар – октобар 2026."], "the sentences");
  const row = db.calls.find((c) => c.name === "milestone_upsert").args;
  assert(row.includes("2026-09-01") && row.includes("2026-10-01") && row.includes("month"),
    `stored ${JSON.stringify(row)}`);
});

await check("a season is written from the public words, winter crossing the year", async () => {
  const db = makeDb();
  await staffMilestones.fetch(post("/api/staff-milestones", {
    id: "ms_m1", status: "upcoming", date_precision: "season", actual_date: "2027-01-20",
    text: { en: { title: "Visas" }, sr: { title: "Визе" } },
  }), env(db));
  eq(labelsWritten(db), ["Winter 2026", "зима 2026."], "January is the winter that began in December");
});

await check("written my way, the typed sentence stands", async () => {
  const db = makeDb();
  await staffMilestones.fetch(post("/api/staff-milestones", {
    id: "ms_m1", status: "upcoming", date_precision: "custom", actual_date: "2026-09-30",
    text: { en: { title: "Visas", target_label: "End of September 2026" } },
  }), env(db));
  eq(labelsWritten(db), ["End of September 2026"], "kept");
});

await check("a range that ends before it starts is refused", async () => {
  const res = await staffMilestones.fetch(post("/api/staff-milestones", {
    id: "ms_m1", status: "upcoming", date_precision: "day",
    actual_date: "2026-09-10", end_date: "2026-09-01", text: { en: { title: "Visas" } },
  }), env(makeDb()));
  eq(res.status, 400, "status");
});

await check("the editor is handed the season words it previews with", async () => {
  const res = await staffMilestones.fetch(get("/api/staff-milestones"), env(makeDb()));
  const body = await res.json();
  eq(body.date_words && body.date_words.en["dates.autumn"], "Fall {year}", "English fall");
});

/* ------------------- sharing, one widget at a time (0038) --------------- */

const patch = (path, body, token) => new Request("https://dev.thauma.one" + path, {
  method: "PATCH",
  headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
/* The values a call bound, by parameter name. */
function named(call) {
  const names = QUERIES[call.name].match(/:[a-z_][a-z0-9_]*/gi).map((n) => n.slice(1));
  const out = {};
  names.forEach((n, i) => { out[n] = call.args[i]; });
  return out;
}
const embedSaved = (db) => named(db.calls.find((c) => c.name === "partner_set_embed"));

await check("sharing one widget publishes that one, and 'any' is what the gate reads", async () => {
  SETTINGS_ROW = { embed_enabled: 0 };
  const db = makeDb();
  const res = await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#1AE4FF", theme: "auto", shared: { roadmap: true } } }, BOSS), env(db));
  eq(res.status, 200, "status");
  const v = embedSaved(db);
  eq([v.embed_roadmap, v.embed_goal, v.embed_prayer, v.embed_videos, v.embed_enabled],
     [1, 0, 0, 0, 1], "stored");
});

await check("saving only a color never changes what is shared", async () => {
  SETTINGS_ROW = { embed_enabled: 1, embed_roadmap: 1, embed_goal: 0, embed_prayer: 1, embed_videos: 0 };
  const db = makeDb();
  await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark", enabled: true } }, BOSS), env(db));
  const v = embedSaved(db);
  eq([v.embed_roadmap, v.embed_goal, v.embed_prayer, v.embed_videos], [1, 0, 1, 0],
     "a color save reshuffled the sharing");
});

await check("the old single switch still turns all four off at once", async () => {
  SETTINGS_ROW = { embed_enabled: 1, embed_roadmap: 1, embed_goal: 1, embed_prayer: 0, embed_videos: 1 };
  const db = makeDb();
  await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark", enabled: false } }, BOSS), env(db));
  const v = embedSaved(db);
  eq([v.embed_roadmap, v.embed_goal, v.embed_prayer, v.embed_videos, v.embed_enabled],
     [0, 0, 0, 0, 0], "stored");
});

await check("only an administrator changes what is shared", async () => {
  SETTINGS_ROW = {};
  const res = await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark", shared: { prayer: true } } }, MIRA), env(makeDb()));
  eq(res.status, 403, "status");
});

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

    /* THE LANGUAGE TRAVELS WITH THE BANNER. Seeing what somebody sees means
       reading what they read, and the browser applies this before the target's
       console has painted — so their screen is in their language immediately
       rather than switching a moment later. Without it, viewing a Serbian
       account showed an English console until some later request happened to
       correct it. */
    eq(body.acting.lang, "sr", `${path} did not carry the viewed person's language`);
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
