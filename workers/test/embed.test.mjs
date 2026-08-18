#!/usr/bin/env node
/**
 * Tests for workers/src/embed.js
 *   node workers/test/embed.test.mjs
 *
 * This is the only route in the Worker that anybody on the internet can reach
 * with no credential at all. Everything else refuses strangers; this one
 * serves them by design. So the tests are about what it will NOT do:
 *
 *   · serve a partner who has not opted in
 *   · admit that such a partner exists
 *   · serve a partner who is not public
 *   · let an attribute reach a stylesheet or a query
 *   · accept credentials alongside its wildcard CORS
 */
import handler from "../src/embed.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- a binding that answers the real queries by name ------------------- */

function bindingFor(rows) {
  /* Keyed by the SQL the query maps to. The point of matching on the query
     text rather than stubbing queryOne is that the WHERE clause is what
     carries the authorisation — a test that stubs it away proves nothing. */
  return {
    prepare(sql) {
      const respond = () => {
        if (/FROM partners/i.test(sql)) return { results: rows.partner ? [rows.partner] : [] };
        if (/FROM goal_progress/i.test(sql)) return { results: rows.goals || [] };
        if (/FROM milestones/i.test(sql)) return { results: rows.milestones || [] };
        if (/milestone_translations|FROM milestone_text/i.test(sql)) {
          return { results: rows.translations || [] };
        }
        if (/partner_languages/i.test(sql)) return { results: rows.languages || [] };
        return { results: [] };
      };
      return {
        bind: () => ({ all: async () => respond(), run: async () => ({}) }),
        all: async () => respond(),
        run: async () => ({}),
      };
    },
  };
}

const ENABLED = {
  id: "p_1", slug: "chase-roush", display_name: "Chase Roush",
  embed_accent: "#FF0066", embed_theme: "dark",
};

const req = (path, init) => new Request("https://thauma.one" + path, init);
const env = (rows) => ({ DB: bindingFor(rows) });

/* ------------------------------ the script ------------------------------ */

await check("the widget script is served as JavaScript", async () => {
  const res = await handler.fetch(req("/embed/v1/widget.js"), env({}));
  eq(res.status, 200, "status");
  assert(/javascript/.test(res.headers.get("Content-Type")), "content type");
  const body = await res.text();
  assert(body.length > 2000, `suspiciously short: ${body.length} bytes`);
  assert(body.includes("attachShadow"), "must use a shadow root");
});

await check("the widget script is cacheable on the live host", async () => {
  const res = await handler.fetch(req("/embed/v1/widget.js"), env({}));
  assert(/max-age=\d{3,}/.test(res.headers.get("Cache-Control") || ""),
         `not cacheable: ${res.headers.get("Cache-Control")}`);
});

await check("the widget script is NOT cached on dev or next", async () => {
  /* A cached widget on a preview host reads exactly like a change that did
     not work — measured, after an edit stayed invisible for the max-age. */
  for (const host of ["dev.thauma.one", "next.thauma.one"]) {
    const res = await handler.fetch(
      new Request(`https://${host}/embed/v1/widget.js`), env({}));
    eq(res.headers.get("Cache-Control"), "no-store", `${host} cache header`);
  }
});

await check("the widget script is valid JavaScript", async () => {
  /* It is never imported, only served as text, so nothing else here would
     notice a syntax error until it reached a stranger's browser. */
  const { WIDGET_JS } = await import("../src/embed-widget.js");
  new Function(WIDGET_JS);
});

await check("the widget builds DOM without innerHTML, eval or document.write", async () => {
  /* Milestone titles and goal labels are free text written by staff, and they
     are rendered on sites Thauma does not control. Building with textContent
     and createElement makes injection impossible by construction rather than
     by remembering to escape — so the absence of these is worth asserting. */
  const { WIDGET_JS } = await import("../src/embed-widget.js");
  for (const bad of ["innerHTML", "outerHTML", "document.write", "eval(", "insertAdjacentHTML"]) {
    assert(!WIDGET_JS.includes(bad), `the widget uses ${bad}`);
  }
});

await check("the widget sends nothing back and sets no cookie", async () => {
  /* A partner embedding this is not handing us their visitors. */
  const { WIDGET_JS } = await import("../src/embed-widget.js");
  for (const bad of ["sendBeacon", "document.cookie", "localStorage", "XMLHttpRequest"]) {
    assert(!WIDGET_JS.includes(bad), `the widget uses ${bad}`);
  }
  assert(WIDGET_JS.includes("credentials: 'omit'"),
         "the fetch must explicitly omit credentials");
});

/* -------------------------------- refusals ------------------------------ */

await check("a partner who has NOT opted in is 404", async () => {
  /* The query returns nothing because of its own WHERE clause. This is the
     single most important test here: embeds are off for everybody until
     somebody turns them on, and that is what makes an unauthenticated
     endpoint acceptable at all. */
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({ partner: null }));
  eq(res.status, 404, "status");
});

await check("a partner who has not opted in looks EXACTLY like one who does not exist", async () => {
  /* Different messages here would turn this into a directory of who is in
     the system — including partners who are deliberately not public. */
  const a = await handler.fetch(req("/embed/v1/chase-roush.json"), env({ partner: null }));
  const b = await handler.fetch(req("/embed/v1/no-such-person.json"), env({ partner: null }));
  eq(a.status, b.status, "status must match");
  eq(await a.json(), await b.json(), "body must match");
});

await check("the authorisation is in the SQL, not in the handler", async () => {
  /* If someone later rewrites the query without embed_enabled, this fails.
     The handler cannot check it — it never sees the column. */
  const { QUERIES } = await import("../src/lib/db.js");
  const sql = QUERIES.public_partner_for_embed;
  assert(sql, "public_partner_for_embed is missing");
  assert(/embed_enabled\s*=\s*1/.test(sql), "must filter on embed_enabled = 1");
  assert(/is_public\s*=\s*1/.test(sql), "must filter on is_public = 1");
});

await check("the embed query is in the public-safe set and cannot read private tables", async () => {
  const { PUBLIC_QUERIES, assertPublicSafe } = await import("../src/lib/db.js");
  assert(PUBLIC_QUERIES.has("public_partner_for_embed"), "not in PUBLIC_QUERIES");
  assertPublicSafe();   // throws if it names contacts/interactions/users/...
});

await check("a slug that is not a slug never reaches the database", async () => {
  let touched = false;
  const spy = { prepare() { touched = true; return { bind: () => ({ all: async () => ({ results: [] }) }) }; } };
  for (const bad of ["../admin", "a b", "'; DROP TABLE partners;--", "x".repeat(80)]) {
    const res = await handler.fetch(
      req("/embed/v1/" + encodeURIComponent(bad) + ".json"), { DB: spy });
    eq(res.status, 404, `${bad} should be 404`);
  }
  assert(!touched, "a malformed slug reached the database");
});

await check("POST is refused", async () => {
  const res = await handler.fetch(req("/embed/v1/chase-roush.json", { method: "POST" }), env({}));
  eq(res.status, 405, "status");
});

/* --------------------------------- CORS --------------------------------- */

await check("CORS is open, and credentials are NOT allowed", async () => {
  /* The wildcard is deliberate — we do not know which sites embed this. It
     is only safe because no credential is accepted: allowing both would let
     any page read this with a visitor's cookies attached. */
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({ partner: ENABLED }));
  eq(res.headers.get("Access-Control-Allow-Origin"), "*", "origin");
  eq(res.headers.get("Access-Control-Allow-Credentials"), null,
     "credentials must never be allowed alongside a wildcard origin");
});

await check("a preflight is answered without touching the database", async () => {
  let touched = false;
  const spy = { prepare() { touched = true; return {}; } };
  const res = await handler.fetch(req("/embed/v1/x.json", { method: "OPTIONS" }), { DB: spy });
  eq(res.status, 204, "status");
  assert(!touched, "a preflight hit the database");
});

/* -------------------------------- payload ------------------------------- */

await check("an opted-in partner gets their numbers and their colours", async () => {
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({
    partner: ENABLED,
    goals: [{ goal_id: "g1", label: "Monthly support", kind: "monthly",
              target_cents: 500000, currency: "USD", raised_cents: 325000,
              donor_count: 41, percent: 65, captured_at: "2026-08-01" }],
  }));
  eq(res.status, 200, "status");
  const body = await res.json();
  eq(body.partner.slug, "chase-roush", "slug");
  eq(body.theme.accent, "#FF0066", "the partner's stored accent");
  eq(body.theme.mode, "dark", "the partner's stored theme");
  eq(body.goals[0].percent, 65, "percent");
  eq(body.goals[0].donor_count, 41, "donor count");
});

await check("a junk accent in the database falls back rather than reaching CSS", async () => {
  /* SQLite cannot regex, so the column can hold anything. This value ends up
     inside a stylesheet in a stranger's browser. */
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({
    partner: { ...ENABLED, embed_accent: "red;}body{display:none}" },
  }));
  const body = await res.json();
  eq(body.theme.accent, "#6D4AFF", "must fall back to the house colour");
});

await check("a junk theme mode falls back too", async () => {
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({
    partner: { ...ENABLED, embed_theme: "neon" },
  }));
  eq((await res.json()).theme.mode, "auto", "mode");
});

await check("no contact, interaction or user field can appear in the payload", async () => {
  /* The shape is assembled field by field upstream; this asserts the RESULT,
     which is what a partner site actually receives. */
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({ partner: ENABLED }));
  const text = JSON.stringify(await res.json()).toLowerCase();
  for (const word of ["email", "phone", "address", "contact", "interaction", "note"]) {
    assert(!text.includes(word), `payload mentions "${word}"`);
  }
});

await check("the response is cached, but briefly", async () => {
  const res = await handler.fetch(req("/embed/v1/chase-roush.json"), env({ partner: ENABLED }));
  const cc = res.headers.get("Cache-Control") || "";
  const m = cc.match(/max-age=(\d+)/);
  assert(m, `no max-age: ${cc}`);
  assert(+m[1] >= 60 && +m[1] <= 900,
    `${m[1]}s is the wrong order of magnitude for progress that moves daily`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
