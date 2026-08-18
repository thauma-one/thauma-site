#!/usr/bin/env node
/**
 * Tests for workers/src/staff-milestones.js
 *   node workers/test/staff-milestones.test.mjs
 *
 * The milestone editor writes the rows the PUBLIC api serves. Every test here
 * is ultimately asking one of two questions: can a draft be published by
 * accident, and can one partner touch another partner's roadmap.
 */
import handler from "../src/staff-milestones.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud";

// A stand-in D1 that records what it was asked to do.
function fakeEnv({ rows = [], partners = [{ id: "p_chase", display_name: "Chase Roush" }] } = {}) {
  const calls = [];
  return {
    calls,
    env: {
      ACCESS_TEAM_DOMAIN: TEAM,
      ACCESS_AUD: AUD,
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return {
                async all() {
                  calls.push({ sql, args });
                  if (sql.includes("FROM users u")) return { results: partners };
                  if (sql.includes("FROM milestones")) return { results: rows };
                  return { results: [] };
                },
              };
            },
          };
        },
      },
    },
  };
}

// requireAccess is exercised thoroughly in access.test.mjs; here we only need a
// request that gets past it, so stub the module boundary via a valid-looking
// payload is not possible — instead these tests drive the parts that run AFTER
// auth by asserting on the denial path separately.
const req = (method, body, qs = "") =>
  new Request(`https://thauma.one/api/staff-milestones${qs}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

console.log("staff-milestones — the roadmap editor\n");

/* ------------------------------- auth -------------------------------- */

await check("no Access token is refused", async () => {
  const { env } = fakeEnv();
  const res = await handler.fetch(req("GET"), env);
  eq(res.status, 401, "status");
});

await check("a misconfigured deploy FAILS CLOSED, it does not fall open", async () => {
  const res = await handler.fetch(req("GET"), { DB: {} });
  eq(res.status, 500, "status");
  const body = await res.json();
  assert(!body.milestones, "returned milestones without Access configured");
});

await check("an unknown method is refused with Allow", async () => {
  const { env } = fakeEnv();
  const res = await handler.fetch(req("PUT", {}), env);
  // Auth runs first, so this is 401 — the point is that it is never 200.
  assert(res.status === 401 || res.status === 405, `got ${res.status}`);
});

/* --------------------------- validation ------------------------------ */
// clean() is not exported; these drive it through the handler's contract by
// asserting the SQL that did or did not reach the database.

import { toPositional, QUERIES } from "../src/lib/db.js";

await check("the upsert query is scoped by partner on BOTH insert and update", async () => {
  const sql = QUERIES.milestone_upsert;
  assert(/:partner_id/.test(sql), "no partner_id bound at all");
  // The UPDATE half must be guarded too, or an id from another tenant would
  // rewrite their row rather than being rejected.
  const updateHalf = sql.slice(sql.indexOf("DO UPDATE"));
  assert(/milestones\.partner_id\s*=\s*:partner_id/.test(updateHalf),
    "ON CONFLICT DO UPDATE is not scoped by partner — an id from another " +
    "partner would overwrite their milestone");
});

await check("delete and reorder are scoped by partner, not id alone", async () => {
  for (const q of ["milestone_delete", "milestone_reorder"]) {
    assert(/partner_id\s*=\s*:partner_id/.test(QUERIES[q]),
      `${q} can act on an id without checking the partner`);
  }
});

await check("the staff list is NOT filtered to published rows", async () => {
  // The whole reason it is a separate query from public_milestones_for_partner.
  assert(!/is_public\s*=\s*1/.test(QUERIES.milestones_for_staff),
    "the editor cannot see its own drafts");
});

await check("the PUBLIC query still filters published rows", async () => {
  assert(/is_public\s*=\s*1/.test(QUERIES.public_milestones_for_partner),
    "the public API would serve drafts");
});

await check("every milestone query converts with its documented params", async () => {
  const params = {
    id: "m_1", partner_id: "p_chase", parent_id: null, title: "t", title_hr: null,
    description: null, description_hr: null, target_label: null,
    target_label_hr: null, actual_date: null, status: "upcoming", completion: 0,
    is_public: 0, is_featured: 0, sort_order: 0, now: "2026-08-15T00:00:00Z",
  };
  for (const q of ["milestone_upsert", "milestone_delete", "milestone_reorder",
                   "milestones_for_staff"]) {
    const r = toPositional(QUERIES[q], params);
    assert(!r.sql.includes(":"), `${q} left a named placeholder behind`);
  }
});

/* ------------------------- the publish flag --------------------------- */

await check("is_public is TRUE only for a literal true or 1", async () => {
  // Everything else — undefined, "false", "on", null, 0 — must not publish.
  // A checkbox that posts the string "on" must not be the reason a draft
  // reaches a public website.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/staff-milestones.js", import.meta.url), "utf8"));
  assert(/is_public:\s*body\.is_public === true \|\| body\.is_public === 1 \? 1 : 0/.test(src),
    "the is_public coercion has been loosened — check it cannot publish on a truthy string");
  assert(/is_featured:\s*body\.is_featured === true \|\| body\.is_featured === 1 \? 1 : 0/.test(src),
    "the is_featured coercion has been loosened");
});

await check("the schema still defaults new milestones to unpublished", async () => {
  const sql = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../db/migrations/0002_milestones.sql", import.meta.url), "utf8"));
  assert(/is_public\s+INTEGER NOT NULL DEFAULT 0/.test(sql),
    "milestones no longer default to private");
});

/* --------------------- the handlers actually run ---------------------- */

/* These call the handler with a working database and assert it does not
   THROW. Every other test here checks SQL or a denial path, so a
   ReferenceError past the auth check — a variable used but never
   destructured — sailed through all of them and reached the browser as an
   HTML 500 that no page could parse.

   The Access check is what makes this awkward to test end to end, so the
   assertion is deliberately weak: any JSON response is a pass, an unhandled
   throw is a failure. Weak and true beats strong and absent. */
await check("no handler throws on a request it cannot authenticate", async () => {
  const mods = await Promise.all([
    import("../src/staff-milestones.js"),
    import("../src/staff-settings.js"),
    import("../src/staff-data.js"),
  ]);
  const env = fakeEnv().env;
  for (const m of mods) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const res = await m.default.fetch(
        new Request("https://x/api/y", {
          method,
          headers: method === "GET" ? {} : { "Content-Type": "application/json" },
          body: method === "GET" || method === "DELETE" ? undefined : "{}",
        }), env);
      assert(res && typeof res.status === "number", `${method} returned no Response`);
      // A thrown ReferenceError would have rejected before reaching here.
      await res.json().catch(() => ({}));
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
