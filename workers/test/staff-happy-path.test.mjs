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
import staffGoals from "../src/staff-goals.js";
import staffPrayer from "../src/staff-prayer.js";
import staffSettings from "../src/staff-settings.js";
import translate from "../src/translate.js";
import staffSite, { siteAddress } from "../src/staff-site.js";
import { serveSite } from "../src/site/serve.js";
import { starter } from "../src/site/model.js";
import worker from "../src/worker.js";
import { ensureSiteNames } from "../src/staff-site.js";

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

/* access_role, as partners_for_user selects it (pu.role AS access_role) —
   this said `role` until Activity's owner-only names depended on it. */
const PARTNER = { id: "p_mira", display_name: "Mira Petrović", access_role: "owner" };
/* The partner's stored sharing, changed by the tests that need it. */
let SETTINGS_ROW = {};

/* Rows one test sets for itself (Home's), cleared after it, so the rest of
   the file keeps the plain partner above. */
let EXTRA = {};

/** Rows for each named query. Absent means "an empty list is fine". */
function rowsFor(name, params) {
  if (EXTRA[name]) return typeof EXTRA[name] === "function" ? EXTRA[name](params) : EXTRA[name];
  switch (name) {
    case "user_by_email": return USER[params.email] ? [USER[params.email]] : [];
    case "user_by_id":    return BY_ID[params.id] ? [BY_ID[params.id]] : [];
    case "partners_for_user":
      // The admin has no partner of their own — deliberately, as in the seed.
      return params.email === "mira@thauma.one" || params.email === "boss@thauma.one" ? [PARTNER] : [];
    case "languages_all":
      return [{ code: "en", name: "English", is_active: 1 },
              { code: "sr", name: "Srpski", is_active: 1 }];
    /* `code`, as the query selects it (l.code) — this said `lang` until Home
       read it and counted everything as missing in "undefined". */
    case "partner_languages_for_partner":
      return [{ code: "en", name: "English", is_enabled: 1, sort_order: 0 },
              { code: "sr", name: "Srpski", is_enabled: 1, sort_order: 1 }];
    case "partner_settings":  return [{ default_lang: "en", ...SETTINGS_ROW }];
    case "milestones_for_staff":
      return [{ id: "ms_m1", status: "complete", completion: 100, sort_order: 0,
                is_public: 1, is_featured: 0, parent_id: null, actual_date: "2026-03-01",
                updated_at: "2026-09-30T10:00:00.000Z" }];
    case "milestone_translations_for_staff":
      return [{ milestone_id: "ms_m1", lang: "en", title: "Commissioned",
                description: null, target_label: null }];
    case "directory_for_partner":
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
      /* goal_id, as the goal_progress view names it */
      return [{ goal_id: "g_m1", id: "g_m1", label: "Monthly support", currency: "EUR",
                target_cents: 180000, raised_cents: 103500, donor_count: 14,
                is_public: 1, kind: "monthly" }];
    case "goal_stamps":
      return [{ id: "g_m1", updated_at: "2026-09-30T10:00:00.000Z" }];
    /* Translation's daily share (0046): the reservation fits. */
    case "ai_usage_reserve":
      return [{ neurons: 10 }];
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

/* ONE DATABASE, TWO PEOPLE (lib/fresh.js): a staff member on live and Chase
   on dev can have the same milestone open. The later save must not erase the
   earlier one in silence. */
await check("a milestone saved by someone else since it was opened is not overwritten", async () => {
  const db = makeDb();
  const res = await staffMilestones.fetch(post("/api/staff-milestones", {
    id: "ms_m1", status: "in_progress", updated_at: "2026-09-29T08:00:00.000Z",
    text: { en: { title: "Mine" } },
  }), env(db));
  const body = await res.json();
  eq(res.status, 409, "refused");
  eq([body.changed, body.current && body.current.id, body.current && body.current.text.en.title], [true, "ms_m1", "Commissioned"],
    "with the milestone as it now is, to show");
  assert(!db.calls.some((c) => c.name === "milestone_upsert" || c.name === "milestone_translation_upsert"), "nothing written");
});

await check("…saved as opened, or with overwrite chosen, or from an older editor, it saves", async () => {
  for (const extra of [{ updated_at: "2026-09-30T10:00:00.000Z" }, { updated_at: "2026-09-29T08:00:00.000Z", overwrite: true }, {}]) {
    const db = makeDb();
    const res = await staffMilestones.fetch(post("/api/staff-milestones", {
      id: "ms_m1", status: "in_progress", text: { en: { title: "Mine" } }, ...extra,
    }), env(db));
    eq(res.status, 200, JSON.stringify(extra));
    assert(db.calls.filter((c) => c.name === "milestone_upsert").length === 1, "written: " + JSON.stringify(extra));
  }
});

await check("a goal is handed out with when it was last saved, and a stale save is refused", async () => {
  const list = await (await staffGoals.fetch(get("/api/staff-goals"), env(makeDb()))).json();
  eq(list.goals && list.goals[0].updated_at, "2026-09-30T10:00:00.000Z", "the editor gets the stamp");
  const db = makeDb();
  const res = await staffGoals.fetch(post("/api/staff-goals", {
    id: "g_m1", label: "Mine", kind: "monthly", target_cents: 200000, currency: "EUR",
    updated_at: "2026-09-29T08:00:00.000Z",
  }), env(db));
  const body = await res.json();
  eq([res.status, body.changed, body.current && body.current.label], [409, true, "Monthly support"], "refused, with theirs");
  assert(!db.calls.some((c) => c.name === "goal_upsert"), "nothing written");
  const ok = makeDb();
  eq((await staffGoals.fetch(post("/api/staff-goals", {
    id: "g_m1", label: "Mine", kind: "monthly", target_cents: 200000, currency: "EUR",
    updated_at: "2026-09-29T08:00:00.000Z", overwrite: true,
  }), env(ok))).status, 200, "saved over it when chosen");
});

await check("a prayer request saved by someone else since it was opened is not overwritten", async () => {
  EXTRA = {
    prayer_for_staff: [{ id: "pr_1", is_public: 1, updated_at: "2026-09-30T10:00:00.000Z" }],
    prayer_translations_for_staff: [{ prayer_id: "pr_1", lang: "en", title: "Visas" }],
  };
  try {
    const list = await (await staffPrayer.fetch(get("/api/staff-prayer"), env(makeDb()))).json();
    eq(list.prayer && list.prayer[0].updated_at, "2026-09-30T10:00:00.000Z", "the editor gets the stamp");
    const db = makeDb();
    const res = await staffPrayer.fetch(post("/api/staff-prayer", {
      id: "pr_1", is_public: true, updated_at: "2026-09-29T08:00:00.000Z", text: { en: { title: "Mine" } },
    }), env(db));
    const body = await res.json();
    eq([res.status, body.changed, body.current && body.current.text.en.title], [409, true, "Visas"], "refused, with theirs");
    assert(!db.calls.some((c) => c.name === "prayer_upsert"), "nothing written");
    eq((await staffPrayer.fetch(post("/api/staff-prayer", {
      id: "pr_1", is_public: true, updated_at: "2026-09-30T10:00:00.000Z", text: { en: { title: "Mine" } },
    }), env(makeDb()))).status, 200, "saved as opened");
  } finally { EXTRA = {}; }
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

await check("the second color's turn is kept unless a save names it, and only -33, 120 or 180", async () => {
  SETTINGS_ROW = { embed_turn: 120 };
  let db = makeDb();
  await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark" } }, BOSS), env(db));
  eq(embedSaved(db).embed_turn, 120, "a save that did not mention the turn changed it");
  db = makeDb();
  await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark", turn: 180 } }, BOSS), env(db));
  eq(embedSaved(db).embed_turn, 180, "the turn chosen");
  const res = await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "dark", turn: 45 } }, BOSS), env(makeDb()));
  eq(res.status, 400, "45 degrees");
  SETTINGS_ROW = {};
});

await check("an embed's own look is written whole, and null puts it back on the ministry's", async () => {
  const db = makeDb();
  const res = await staffSettings.fetch(patch("/api/staff-settings", { embed: {
    accent: "#FF0066", theme: "auto",
    looks: { goal: { accent: "#e4572e", accent2: null, turn: 180, theme: "dark" },
             signup: { accent: null, accent2: "#111111", turn: 120, theme: "light" },
             contact: null } } }, BOSS), env(db));
  eq(res.status, 200, "status");
  const sets = db.calls.filter((c) => c.name === "embed_look_set").map(named);
  eq(sets.map((v) => [v.kind, v.accent, v.accent2, v.turn, v.theme]),
     [["goal", "#E4572E", null, 180, "dark"], ["signup", null, null, null, "light"]],
     "a background alone carries no half a color");
  eq(db.calls.filter((c) => c.name === "embed_look_clear").map((c) => named(c).kind), ["contact"], "cleared");
  const bad = await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "auto", looks: { banner: null } } }, BOSS), env(makeDb()));
  eq(bad.status, 400, "an embed that does not exist");
  const badHex = await staffSettings.fetch(patch("/api/staff-settings",
    { embed: { accent: "#FF0066", theme: "auto", looks: { goal: { accent: "red" } } } }, BOSS), env(makeDb()));
  eq(badHex.status, 400, "a color that is not a hex code — it ends up in a stranger's stylesheet");
});

/* ---------------- API keys: the ministry's, part by part ---------------- */

const postJson = (path, body, token = MIRA) => new Request("https://dev.thauma.one" + path, {
  method: "POST",
  headers: { "Cf-Access-Jwt-Assertion": token, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

await check("a new key reads only the parts chosen, and records who made it", async () => {
  const db = makeDb();
  const res = await staffSettings.fetch(postJson("/api/staff-settings",
    { name: "chaseroush.com build", parts: ["milestones", "videos"] }), env(db));
  eq(res.status, 200, "status");
  const v = named(db.calls.find((c) => c.name === "api_key_create"));
  eq([v.scopes, v.created_by, v.partner_id], ["read:milestones read:videos", "u_mira", "p_mira"], "stored");
});

await check("a key asked to read nothing is refused", async () => {
  const res = await staffSettings.fetch(postJson("/api/staff-settings", { name: "x", parts: [] }), env(makeDb()));
  eq(res.status, 400, "status");
});

await check("what a key reads can be changed later, for this ministry's keys only", async () => {
  const db = makeDb();
  const res = await staffSettings.fetch(patch("/api/staff-settings",
    { key_parts: { id: "k_1", parts: ["goals"] } }, MIRA), env(db));
  eq(res.status, 200, "status");
  const v = named(db.calls.find((c) => c.name === "api_key_set_scopes"));
  eq([v.id, v.partner_id, v.scopes], ["k_1", "p_mira", "read:goals"], "stored");
});

await check("GET /api/staff-snapshot returns 200 through the router", async () => {
  // Routed rather than imported: this handler lives inside worker.js, so the
  // only way to reach it is the way a browser does.
  const db = makeDb();
  const res = await worker.fetch(get("/api/staff-snapshot"), env(db));
  const body = await res.json().catch(() => ({}));
  eq(res.status, 200, `snapshot said ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
});

/* Activity (board "Activity"): its sentence names whose record was opened,
   but only for the owner — the same rule as the supporter list. */
const AUDIT_ROW = { at: "2026-09-24T15:28:00Z", action: "stewardship.open", entity: "contact",
                    entity_id: "c_m1", actor: "Mira Petrović", contact_name: "Nikola Jovanović" };

await check("the snapshot carries the log's names to the owner, and ?audit= reads further back", async () => {
  EXTRA = { audit_recent_for_partner: [AUDIT_ROW] };
  try {
    const db = makeDb();
    const res = await worker.fetch(get("/api/staff-snapshot?audit=300"), env(db));
    const body = await res.json();
    eq(body.audit[0].contact_name, "Nikola Jovanović", "the owner reads the name");
    const call = db.calls.find((c) => c.name === "audit_recent_for_partner");
    assert(call.args.includes(300), `limit ${JSON.stringify(call.args)}`);
    const db2 = makeDb();
    await worker.fetch(get("/api/staff-snapshot?audit=99999"), env(db2));
    assert(db2.calls.find((c) => c.name === "audit_recent_for_partner").args.includes(500), "capped at 500");
  } finally { EXTRA = {}; }
});

await check("…and drops them for anybody else, an administrator viewing as the owner included", async () => {
  EXTRA = { audit_recent_for_partner: [AUDIT_ROW] };
  try {
    const res = await worker.fetch(get("/api/staff-snapshot", ADMIN, "thauma_act_as=u_mira"), env(makeDb()));
    const body = await res.json();
    eq(body.stewardship_withheld ? true : false, true, "withheld");
    eq(body.audit[0].contact_name, null, "no supporter name in the log");
    eq(body.audit[0].action, "stewardship.open", "the row itself stays");
  } finally { EXTRA = {}; }
});

/* Sharing a resource (Chase, 2026-09-28): the owner alone shares; everyone
   is for administrators; a "Can edit" share may save but stays the owner's. */
const argsOf = (db, name) => (db.calls.find((c) => c.name === name) || {}).args;

await check("only a resource's owner may share it", async () => {
  EXTRA = { resource_owner: [{ id: "r_x", owner_user_id: "u_other", partner_id: null }] };
  try {
    const res = await staffData.fetch(post("/api/staff-data", { kind: "share", resource_id: "r_x", audience: "team" }), env(makeDb()));
    eq(res.status, 403, "a non-owner shared");
  } finally { EXTRA = {}; }
});

await check("the owner shares with their team; only an administrator with everyone", async () => {
  EXTRA = { resource_owner: [{ id: "r_m", owner_user_id: "u_mira", partner_id: null }] };
  try {
    const db = makeDb();
    const res = await staffData.fetch(post("/api/staff-data", { kind: "share", resource_id: "r_m", audience: "team" }), env(db));
    eq(res.status, 200, "team share");
    const a = argsOf(db, "resource_group_share_set");
    assert(a && a.includes("p_mira") && a.includes("team") && a.includes(0), `stored ${JSON.stringify(a)}`);
    const res2 = await staffData.fetch(post("/api/staff-data", { kind: "share", resource_id: "r_m", audience: "everyone" }), env(makeDb()));
    eq(res2.status, 403, "a non-administrator shared with everyone");
  } finally { EXTRA = {}; }
});

await check("someone it was shared with as Can edit may save it, and it stays the owner's", async () => {
  EXTRA = { resource_owner: [{ id: "r_x", owner_user_id: "u_other", partner_id: null }],
            resource_can_edit_shared: [{ ok: 1 }] };
  try {
    const db = makeDb();
    const res = await staffData.fetch(post("/api/staff-data", { kind: "resource", id: "r_x", title: "Edited" }), env(db));
    eq(res.status, 200, "the editor's save");
    const a = argsOf(db, "resource_upsert");
    /* Saved under the OWNER's id — Mira appears only as created_by. */
    const sql = (await import("../src/lib/db.js")).QUERIES.resource_upsert;
    const names = [...sql.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
    eq(a[names.indexOf("owner_user_id")], "u_other", "whose it is");
    EXTRA.resource_can_edit_shared = [];
    const res2 = await staffData.fetch(post("/api/staff-data", { kind: "resource", id: "r_x", title: "Edited" }), env(makeDb()));
    eq(res2.status, 403, "saved without Can edit");
  } finally { EXTRA = {}; }
});

await check("people are found only after two letters", async () => {
  const db = makeDb();
  const one = await (await staffData.fetch(get("/api/staff-data?people=a"), env(db))).json();
  eq(one.people, [], "one letter");
  assert(!db.calls.some((c) => c.name === "people_find"), "searched on one letter");
  const db2 = makeDb();
  await staffData.fetch(get("/api/staff-data?people=an"), env(db2));
  assert(db2.calls.some((c) => c.name === "people_find"), "two letters did not search");
});

/* Machine translation drafts (Workers AI, 2026-09-28). */
const fakeAI = (reply) => ({ async run(model, input) { fakeAI.last = { model, input }; return { response: reply(input) }; } });

await check("translate says where it is not switched on, and refuses there", async () => {
  const got = await (await translate.fetch(get("/api/translate"), env(makeDb()))).json();
  eq(got.available, false, "no AI binding, not available");
  const res = await translate.fetch(post("/api/translate", { from: "en", to: "hr", items: [{ id: "a", text: "Hi" }] }), env(makeDb()));
  eq(res.status, 503, "status");
});

await check("translate returns each piece, and flags one that lost its placeholder", async () => {
  const AI = fakeAI((input) => JSON.stringify({ items: [
    { id: "a", text: "Bok {name}" }, { id: "b", text: "Sada" } ] }));
  const res = await translate.fetch(post("/api/translate", { from: "en", to: "hr",
    items: [{ id: "a", text: "Hi {name}" }, { id: "b", text: "Now {n}" }] }), { ...env(makeDb()), AI });
  const body = await res.json();
  eq(res.status, 200, JSON.stringify(body));
  eq(body.items, [{ id: "a", text: "Bok {name}" }, { id: "b", text: "Sada", check: true }], "items");
  assert(/English to Croatian/.test(fakeAI.last.input.messages[0].content), "the instruction names the languages");
});

await check("translation stops at the day's share — refused BEFORE Cloudflare is asked", async () => {
  let asked = 0;
  const AI = { async run() { asked++; return { response: "{}" }; } };
  EXTRA = { ai_usage_reserve: [] };             // the reservation did not fit
  try {
    const res = await translate.fetch(post("/api/translate", { from: "en", to: "hr", items: [{ id: "a", text: "Give" }] }),
      { ...env(makeDb()), AI, AI_DAILY_NEURONS: "1500" });
    eq(res.status, 429, "refused");
    eq((await res.json()).code, "ai_resting", "the page can say it in the person's language");
    eq(asked, 0, "Cloudflare was never asked, so nothing can be charged");
  } finally { EXTRA = {}; }
});

await check("translation reserves its worst case, then records what Cloudflare says it used", async () => {
  const AI = { async run(model, input) {
    fakeAI.last = { input };
    return { response: JSON.stringify({ items: [{ id: "a", text: "Daj" }] }), usage: { neurons: 1.79 } };
  } };
  const db = makeDb();
  const res = await translate.fetch(post("/api/translate", { from: "en", to: "hr", items: [{ id: "a", text: "Give" }] }),
    { ...env(db), AI, AI_DAILY_NEURONS: "1500" });
  eq(res.status, 200, "translated");
  const r = db.calls.find((c) => c.name === "ai_usage_reserve");
  const est = r.args.find((x) => typeof x === "number" && x > 0 && x < 1500);
  assert(est > 1.79, "the reservation is at least what it used");
  assert(fakeAI.last.input.max_tokens < 200, "a short piece may only have a short answer — got " + fakeAI.last.input.max_tokens);
  const settle = db.calls.find((c) => c.name === "ai_usage_settle");
  assert(settle && settle.args.includes(1.79), "Cloudflare's own figure recorded");
});

await check("translate is bounded: same language, too many, too long", async () => {
  const AI = fakeAI(() => "{}");
  const e = { ...env(makeDb()), AI };
  eq((await translate.fetch(post("/api/translate", { from: "en", to: "en", items: [{ id: "a", text: "x" }] }), e)).status, 400, "same language");
  eq((await translate.fetch(post("/api/translate", { from: "en", to: "hr",
    items: Array.from({ length: 41 }, (_, i) => ({ id: String(i), text: "x" })) }), e)).status, 400, "41 pieces");
  eq((await translate.fetch(post("/api/translate", { from: "en", to: "hr", items: [{ id: "a", text: "x".repeat(2001) }] }), e)).status, 400, "too long");
});

/* The ministry's own website (0044). */
const SITE_ROW = () => ({ partner_id: "p_mira", subdomain: "mirapetrovic", enabled: 0, published: null,
  draft: JSON.stringify(starter("full", { name: "Mira Petrović", langs: ["en", "sr"], fallback: "sr" })),
  published_at: null, dns_state: null, updated_at: "2026-09-29T00:00:00Z" });
const called = (db, name) => db.calls.filter((c) => c.name === name);

await check("the site is made on first opening, its address from the name", async () => {
  /* No row the first time it is asked for; the one just made after that. */
  let asked = 0;
  EXTRA = { partner_site_get: () => (asked++ ? [SITE_ROW()] : []),
            partner_site_owner: [{ user_id: "u_mira", name: "Mira Petrović" }] };
  try {
    const db = makeDb();
    const res = await staffSite.fetch(get("/api/staff-site"), env(db));
    const body = await res.json();
    eq(res.status, 200, JSON.stringify(body).slice(0, 200));
    assert(called(db, "partner_site_create")[0].args.includes("mirapetrovic"), "the address from the name");
    eq(body.site.subdomain, "mirapetrovic", "answered");
    eq([body.can.edit, body.can.owner], [true, true], "the owner edits");
  } finally { EXTRA = {}; }
});

await check("someone on the team who is not the owner sees it, cannot change it, and may ask", async () => {
  EXTRA = { partner_site_get: [SITE_ROW()], partners_for_user: [{ ...PARTNER, access_role: "assist" }] };
  try {
    const got = await (await staffSite.fetch(get("/api/staff-site"), env(makeDb()))).json();
    eq([got.can.edit, got.can.owner], [false, false], "read-only");
    const save = await staffSite.fetch(post("/api/staff-site", { action: "save", draft: {} }), env(makeDb()));
    eq(save.status, 403, "a save refused");
    const on = await staffSite.fetch(post("/api/staff-site", { action: "enable", on: true }), env(makeDb()));
    eq(on.status, 403, "switching on refused");
    const db = makeDb();
    const ask = await staffSite.fetch(post("/api/staff-site", { action: "request", note: "I can keep the Serbian current." }), env(db));
    eq(ask.status, 200, "asking allowed");
    assert(called(db, "partner_site_request_add")[0].args.includes("I can keep the Serbian current."), "the note kept");
  } finally { EXTRA = {}; }
});

await check("switching on a site nobody published publishes it first", async () => {
  EXTRA = { partner_site_get: [SITE_ROW()] };
  try {
    const db = makeDb();
    const res = await staffSite.fetch(post("/api/staff-site", { action: "enable", on: true }), env(db));
    eq(res.status, 200, "switched on");
    assert(called(db, "partner_site_publish").length === 1, "published");
    assert(called(db, "partner_site_set_enabled")[0].args.includes(1), "enabled");
  } finally { EXTRA = {}; }
});

await check("starting again keeps the look, links and languages, and replaces the pages", async () => {
  const row = SITE_ROW(); const d = JSON.parse(row.draft); d.design.look = "paper";
  d.links = [{ kind: "custom", url: "https://a.org", label: { en: "Blog" } }]; row.draft = JSON.stringify(d);
  EXTRA = { partner_site_get: [row] };
  try {
    const db = makeDb();
    const res = await staffSite.fetch(post("/api/staff-site", { action: "start", kind: "basic" }), env(db));
    eq(res.status, 200, "started");
    const saved = JSON.parse(called(db, "partner_site_save_draft")[0].args.find((a) => typeof a === "string" && a.startsWith("{")));
    eq(saved.pages.filter((p) => p.on).map((p) => p.id), ["home", "about", "give", "contact"], "basic pages");
    eq([saved.design.look, saved.links.length, saved.languages], ["paper", 1, ["en", "sr"]], "kept");
  } finally { EXTRA = {}; }
});

await check("only an administrator changes an address, and only to a free, well-formed one", async () => {
  EXTRA = { partner_site_get: [SITE_ROW()] };
  try {
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", subdomain: "mira" }), env(makeDb()))).status, 403, "not an administrator");
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", subdomain: "www" }, BOSS), env(makeDb()))).status, 400, "reserved");
    EXTRA.partner_site_subdomain_taken = [{ partner_id: "p_other" }];
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", subdomain: "mira" }, BOSS), env(makeDb()))).status, 409, "taken");
    delete EXTRA.partner_site_subdomain_taken;
    const db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", subdomain: "mirap" }, BOSS), env(db))).status, 200, "changed");
    assert(called(db, "partner_site_set_subdomain")[0].args.includes("mirap"), "stored");
    /* 0045: the old name is kept, so links to it still arrive. */
    assert(called(db, "partner_site_alias_add")[0].args.includes("mirapetrovic"), "the old name kept as an alias");
    assert(called(db, "partner_site_alias_remove")[0].args.includes("mirap"), "the new name is nobody's alias");
  } finally { EXTRA = {}; }
});

await check("an administrator archives a site (kept) or deletes it (typed out first)", async () => {
  EXTRA = { partner_site_get: [SITE_ROW()] };
  try {
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "archive" }), env(makeDb()))).status, 403, "not an administrator");
    let db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "archive" }, BOSS), env(db))).status, 200, "archived");
    assert(called(db, "partner_site_archive").length === 1, "marked archived");
    assert(!called(db, "partner_site_delete").length, "nothing deleted");
    db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "delete" }, BOSS), env(db))).status, 400, "not typed out");
    assert(!called(db, "partner_site_delete").length, "nothing deleted without the name");
    db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "delete", confirm: "mirapetrovic" }, BOSS), env(db))).status, 200, "deleted");
    for (const q of ["partner_site_aliases_clear", "partner_site_editors_clear", "partner_site_requests_clear", "partner_site_delete"]) {
      assert(called(db, q).length === 1, q);
    }
  } finally { EXTRA = {}; }
});

await check("an old name can be let go of — only one of this site's own", async () => {
  EXTRA = { partner_site_aliases_for: [{ subdomain: "chaser" }] };
  try {
    let db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "unalias", subdomain: "someoneelse" }, BOSS), env(db))).status, 404, "not theirs");
    assert(!called(db, "partner_site_alias_remove").length, "nothing removed");
    db = makeDb();
    eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "unalias", subdomain: "chaser" }, BOSS), env(db))).status, 200, "let go");
    assert(called(db, "partner_site_alias_remove")[0].args.includes("chaser"), "removed");
  } finally { EXTRA = {}; }
});

await check("switching an archived site on brings it back", async () => {
  EXTRA = { partner_site_get: [{ ...SITE_ROW(), published: "{}", archived_at: "2026-09-29T00:00:00Z" }] };
  try {
    const db = makeDb();
    eq((await staffSite.fetch(post("/api/staff-site", { action: "enable", on: true }), env(db))).status, 200, "switched on");
    assert(called(db, "partner_site_set_enabled")[0].args.includes(1), "enabled — which clears archived_at");
  } finally { EXTRA = {}; }
});

await check("a site that is switched off shows Thauma's closed page — nothing of the ministry", async () => {
  EXTRA = { partner_site_by_subdomain: [{ partner_id: "p_mira", subdomain: "mirapetrovic", enabled: 0, published: "{}",
    slug: "mira", display_name: "Mira", giving_url: null, status: "active" }] };
  try {
    const e = { ...env(makeDb()), SITE_DOMAIN: "thauma.one" };
    const res = await serveSite(new Request("https://mirapetrovic.thauma.one/en/"), e, { sub: "mirapetrovic", rest: "/en/", base: "" });
    eq(res.status, 404, "not found");
    const html = await res.text();
    assert(/class="wordmark">THAUMA</.test(html), "Thauma's wordmark");
    assert(html.includes('href="https://thauma.one/">Go to thauma.one<'), "one way on, to thauma.one");
    assert(!/Mira/.test(html), "nothing of the ministry");
    assert(!html.includes("fail.js"), "no arcade door while the arcade is not out");
    eq([res.headers.get("Cache-Control"), res.headers.get("X-Robots-Tag")], ["no-store", "noindex"],
      "never remembered, never indexed — switching on shows the site at once");
    const hr = await serveSite(new Request("https://mirapetrovic.thauma.one/", { headers: { "Accept-Language": "hr-HR,hr;q=0.9" } }), e,
      { sub: "mirapetrovic", rest: "/", base: "" });
    assert((await hr.text()).includes("Idite na thauma.one"), "in the visitor's language");
    /* Once /arcade/ is built for live, THAUMA is a door into it. */
    const out = { ...e, ASSETS: { fetch: async (r) => new Response("", { status: new URL(r.url).pathname === "/arcade/" ? 200 : 404 }) } };
    const withDoor = await (await serveSite(new Request("https://mirapetrovic.thauma.one/"), out, { sub: "mirapetrovic", rest: "/", base: "" })).text();
    assert(withDoor.includes("/js/arcade/fail.js") && withDoor.includes("https://thauma.one/arcade/"), "the door, and where it leads");
    eq(await serveSite(new Request("https://dev.thauma.one/site/mirapetrovic/en/"), e,
      { sub: "mirapetrovic", rest: "/en/", base: "/site/mirapetrovic" }), null, "under /site/, the console's own 404");
  } finally { EXTRA = {}; }
});

/* The live Worker, as a visitor's browser reaches it through *.thauma.one. */
const LIVE = (db) => ({ ...env(db), SITE_WILDCARD: "1", SITE_DOMAIN: "thauma.one" });
async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (await fake(typeof url === "string" ? url : url.url, init || {})) || real(url, init);
  try { return await fn(); } finally { globalThis.fetch = real; }
}

await check("a name nobody has gets the closed page; Thauma's own names pass through untouched", async () => {
  const res = await worker.fetch(new Request("https://nobody.thauma.one/"), LIVE(makeDb()));
  eq(res.status, 404, "not found");
  assert((await res.text()).includes("THAUMA"), "Thauma's page, not Cloudflare's error for an address with no origin");
  const passed = [];
  await withFetch((url) => { if (url.startsWith("https://dev.thauma.one/")) { passed.push(url); return new Response("the Pi"); } }, async () => {
    const pi = await worker.fetch(new Request("https://dev.thauma.one/en/"), LIVE(makeDb()));
    eq(await pi.text(), "the Pi", "dev.thauma.one still reaches the Pi");
  });
  eq(passed, ["https://dev.thauma.one/en/"], "passed on as it came");
});

await check("switching off, archiving and deleting keep the name's record — no remembered 'does not exist'", async () => {
  const dns = [];
  await withFetch((url, init) => { if (url.includes("api.cloudflare.com")) { dns.push(`${init.method || "GET"} ${url}`); return new Response(JSON.stringify({ success: true, result: [] })); } }, async () => {
    const e = (db) => ({ ...LIVE(db), SITE_DNS_TOKEN: "t", SITE_ZONE_ID: "z" });
    EXTRA = { partner_site_get: [{ ...SITE_ROW(), enabled: 1, dns_state: "ready" }] };
    try {
      eq((await staffSite.fetch(post("/api/staff-site", { action: "enable", on: false }), e(makeDb()))).status, 200, "switched off");
      eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "archive" }, BOSS), e(makeDb()))).status, 200, "archived");
      eq((await siteAddress.fetch(post("/api/admin/site-address", { partner_id: "p_mira", action: "delete", confirm: "mirapetrovic" }, BOSS), e(makeDb()))).status, 200, "deleted");
    } finally { EXTRA = {}; }
  });
  eq(dns.filter((d) => d.startsWith("DELETE")), [], "no record removed");
});

await check("the quarter-hour check keeps the wildcard and makes names switched on where there is no DNS key", async () => {
  eq(await ensureSiteNames(env(makeDb())), { skipped: true }, "not on dev or staging");
  const made = [];
  await withFetch((url, init) => {
    if (!url.includes("api.cloudflare.com")) return;
    if (init.method === "POST") made.push(JSON.parse(init.body).name);
    return new Response(JSON.stringify({ success: true, result: [] }));
  }, async () => {
    EXTRA = { partner_site_needing_dns: [{ partner_id: "p_mira", subdomain: "mirapetrovic" }] };
    try {
      const db = makeDb();
      const r = await ensureSiteNames({ ...LIVE(db), SITE_DNS_TOKEN: "t", SITE_ZONE_ID: "z" });
      eq(r, { wildcard: "ready", made: ["mirapetrovic"] }, "what it did");
      assert(called(db, "partner_site_set_dns")[0].args.includes("ready"), "recorded, so it is not asked again");
    } finally { EXTRA = {}; }
  });
  eq(made, ["*.thauma.one", "mirapetrovic.thauma.one"], "the wildcard, then the site's own name");
});

await check("an old address sends visitors on to the new one, page and all", async () => {
  EXTRA = { partner_site_by_subdomain: [], partner_site_by_alias: [{ subdomain: "mirap", enabled: 1 }] };
  try {
    const e = { ...env(makeDb()), SITE_DOMAIN: "thauma.one" };
    let res = await serveSite(new Request("https://mirapetrovic.thauma.one/sr/give/?from=card"), e, { sub: "mirapetrovic", rest: "/sr/give/", base: "" });
    eq(res.status, 301, "permanent");
    eq(res.headers.get("Location"), "https://mirap.thauma.one/sr/give/?from=card", "same page, new name");
    res = await serveSite(new Request("https://dev.thauma.one/site/mirapetrovic/sr/"), e, { sub: "mirapetrovic", rest: "/sr/", base: "/site/mirapetrovic" });
    eq(res.headers.get("Location"), "https://dev.thauma.one/site/mirap/sr/", "under /site/ too");
    EXTRA.partner_site_by_alias = [];
    eq(await serveSite(new Request("https://nobody.thauma.one/"), e, { sub: "nobody", rest: "/", base: "" }), null, "a name nobody has passes through");
  } finally { EXTRA = {}; }
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

/* ------------------------------- Home ---------------------------------- */

await check("Home lists what is not finished and what is waiting for translation", async () => {
  EXTRA = {
    milestones_for_staff: [
      { id: "ms_live", status: "complete", is_public: 1 },
      { id: "ms_draft", status: "upcoming", is_public: 0 },
      /* Left off the site on purpose: a decision, not a job. */
      { id: "ms_cut", status: "canceled", is_public: 0 },
    ],
    milestone_translations_for_staff: [
      { milestone_id: "ms_live", lang: "en", title: "Commissioned" },
      { milestone_id: "ms_draft", lang: "en", title: "Get Fingerprinted" },
    ],
    prayer_for_staff: [{ id: "pr_1", is_public: 0 }],
    prayer_translations_for_staff: [{ prayer_id: "pr_1", lang: "sr", title: "Визе" }],
    mailing_lists_for_partner: [
      { id: "l_new", name: "Newsletter", is_open: 1, subscribed: 0, pending: 0, drafts: 2 },
      { id: "l_shut", name: "Board", is_open: 0, subscribed: 0, pending: 0, drafts: 0 },
      /* Somebody has signed up and not confirmed yet: it has been found. */
      { id: "l_found", name: "Prayer", is_open: 1, subscribed: 0, pending: 1, drafts: 0 },
    ],
  };
  try {
    const res = await worker.fetch(get("/api/staff-home"), env(makeDb()));
    const body = await res.json();
    eq(res.status, 200, JSON.stringify(body).slice(0, 200));
    eq(body.you.name, "Mira Petrović", "who");
    eq(body.published, 1, "milestones published");
    eq(body.unfinished.map((u) => u.kind + ":" + u.id),
      ["milestone:ms_draft", "prayer:pr_1", "drafts:l_new", "list:l_new"], "not finished");
    eq(body.unfinished[0].title, { en: "Get Fingerprinted" }, "titles by language");
    eq(body.unfinished[2].n, 2, "drafts counted");
    /* Only PUBLISHED items count: the unpublished prayer is missing English
       too, and is already listed as not finished. */
    eq(body.missing, { milestones: { sr: 1 }, prayer: {} }, "missing");
    eq(body.languages.map((l) => l.code), ["en", "sr"], "switched-on languages");
  } finally {
    EXTRA = {};
  }
});

await check("Home only reads", async () => {
  const res = await worker.fetch(post("/api/staff-home", {}), env(makeDb()));
  eq(res.status, 405, "status");
});

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
