#!/usr/bin/env node
/**
 * Tests for the partner API — the ONLY endpoint reachable by a credential
 * outside Thauma, and therefore the one worth over-testing.
 *
 *   node workers/test/partner-api.test.mjs
 *
 * The question every test here answers is the same one: can a partner site's
 * build, or someone who has stolen its key, obtain a single byte of person
 * data? The answer has to be no for structural reasons, not because the
 * current handler happens not to ask for it.
 */
import { createDb, partnerPublicSite, assertPublicSafe, PUBLIC_QUERIES, QUERIES }
  from "../src/lib/db.js";
import { hashKey, extractKey, requirePartnerKey } from "../src/lib/apikey.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("partner API — the public boundary\n");

/* ----------------------- the boundary, statically ----------------------- */

await check("the public query set cannot name a private table", async () => {
  assertPublicSafe();
});

await check("assertPublicSafe CATCHES a query that joins onto contacts", async () => {
  // The check has to fail when it should, or it is decoration.
  let threw = null;
  try {
    assertPublicSafe({
      ...QUERIES,
      public_goals_for_partner:
        "SELECT c.email FROM goal_progress g JOIN contacts c ON c.partner_id = g.partner_id " +
        "WHERE g.partner_id = :partner_id AND is_public = 1",
    });
  } catch (e) { threw = e.message; }
  assert(threw && /contacts/.test(threw), `expected a throw naming contacts, got ${threw}`);
});

await check("assertPublicSafe CATCHES a query that forgets is_public", async () => {
  let threw = null;
  try {
    assertPublicSafe({
      ...QUERIES,
      public_milestones_for_partner: "SELECT id, title FROM milestones WHERE partner_id = :partner_id",
    });
  } catch (e) { threw = e.message; }
  assert(threw && /is_public/.test(threw), `expected a throw naming is_public, got ${threw}`);
});

await check("assertPublicSafe CATCHES an unscoped query", async () => {
  let threw = null;
  try {
    assertPublicSafe({
      ...QUERIES,
      public_goals_for_partner: "SELECT goal_id FROM goal_progress WHERE is_public = 1",
    });
  } catch (e) { threw = e.message; }
  assert(threw && /partner_id/.test(threw), `expected a throw naming partner_id, got ${threw}`);
});

await check("PUBLIC_QUERIES is an allow-list of exactly the two intended queries", async () => {
  // If this fails because someone added a query, that is the test working:
  // adding to this set is a decision to publish, and should be deliberate.
  eq([...PUBLIC_QUERIES].sort(),
     ["public_goals_for_partner", "public_milestones_for_partner"], "public set");
});

await check("publicQuery REFUSES a private query even when asked directly", async () => {
  const db = createDb(null, async () => []);
  for (const q of ["contacts_stewardship", "interactions_for_partner",
                   "audit_recent_for_partner", "partners_for_user", "api_key_lookup"]) {
    let threw = null;
    try { await db.publicQuery(q, { partner_id: "p_chase", today: "2026-08-15" }); }
    catch (e) { threw = e.message; }
    assert(threw && /PUBLIC_QUERIES/.test(threw), `publicQuery ran ${q}`);
  }
});

/* --------------------------- the payload shape -------------------------- */

const SENSITIVE = ["email", "phone", "first_name", "last_name", "note", "notes",
                   "address", "postal", "actor", "user_id", "key_hash", "auth_subject"];

function fakePublicDb(overrides = {}) {
  return createDb(null, async (sql) => {
    if (sql.includes("goal_progress")) {
      return overrides.goals ?? [{
        goal_id: "g_1", label: "Monthly support", kind: "monthly",
        target_cents: 1800000, currency: "USD", raised_cents: 1224000,
        donor_count: 31, percent: 68, captured_at: "2026-08-14T06:00:00Z",
      }];
    }
    if (sql.includes("milestones")) {
      return overrides.milestones ?? [{
        id: "m_1", parent_id: null, title: "Proclaim! 1st Missions Trip",
        title_hr: "Proclaim! 1. misijsko putovanje",
        description: "A missions trip.", description_hr: "Misionarsko putovanje.",
        target_label: "End of September 2026", target_label_hr: "Kraj rujna 2026.",
        actual_date: null, status: "upcoming", completion: 0,
        is_featured: 1, sort_order: 1,
      }];
    }
    return [];
  });
}

await check("the payload carries goals and milestones and nothing else", async () => {
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  eq(Object.keys(site).sort(), ["goals", "milestones"], "top-level keys");
});

await check("NO SENSITIVE FIELD APPEARS ANYWHERE IN THE PAYLOAD", async () => {
  const body = JSON.stringify(await partnerPublicSite(fakePublicDb(), "p_chase")).toLowerCase();
  for (const f of SENSITIVE) {
    assert(!body.includes(`"${f}"`), `payload contains a "${f}" field`);
  }
});

await check("a column added to the query does NOT reach the payload", async () => {
  // The reason partnerPublicSite names every field instead of spreading rows.
  // This simulates somebody adding a private column to `milestones` later.
  const db = fakePublicDb({
    milestones: [{
      id: "m_1", title: "Trip", status: "upcoming", completion: 0,
      internal_note: "donor Jane paid for this",
      contact_email: "jane@example.com",
    }],
  });
  const body = JSON.stringify(await partnerPublicSite(db, "p_chase"));
  assert(!body.includes("internal_note"), "an unlisted column leaked into the payload");
  assert(!body.includes("jane@example.com"), "an unlisted column's VALUE leaked");
});

await check("partnerPublicSite refuses to run without a partner", async () => {
  let threw = null;
  try { await partnerPublicSite(fakePublicDb(), null); } catch (e) { threw = e.message; }
  assert(threw, "ran unscoped");
});

await check("is_featured comes back as a boolean, not SQLite's 1/0", async () => {
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  eq(site.milestones[0].is_featured, true, "is_featured");
});

/* ------------------------------ key auth -------------------------------- */

const KEY = "a".repeat(43); // token_urlsafe(32) is 43 chars
const req = (headers = {}) => new Request("https://next.thauma.one/api/partner/v1/site", { headers });

function keyDb(row) {
  return createDb(null, async (sql) => (sql.includes("api_keys") && row ? [row] : []));
}
const GOOD = { key_id: "k_1", partner_id: "p_chase", scopes: "read:public",
               slug: "chase-roush", display_name: "Chase Roush" };

await check("hashKey is stable SHA-256 hex", async () => {
  const h = await hashKey("hello");
  eq(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", "sha256('hello')");
});

await check("the key is read from Authorization: Bearer", async () => {
  eq(extractKey(req({ authorization: `Bearer ${KEY}` })), KEY, "bearer");
});

await check("a ?key= QUERY PARAMETER IS NOT ACCEPTED", async () => {
  // Query strings land in access logs, history and Referer headers.
  const r = new Request(`https://next.thauma.one/api/partner/v1/site?key=${KEY}`);
  eq(extractKey(r), null, "a key in the query string was accepted");
  const { denied } = await requirePartnerKey(r, keyDb(GOOD));
  eq(denied?.status, 401, "query-string key authenticated");
});

await check("no key is 401 with a WWW-Authenticate header", async () => {
  const { denied } = await requirePartnerKey(req(), keyDb(GOOD));
  eq(denied?.status, 401, "status");
  assert(denied.headers.get("www-authenticate"), "missing WWW-Authenticate");
});

await check("an unknown key is refused", async () => {
  const { denied, partner } = await requirePartnerKey(
    req({ authorization: `Bearer ${KEY}` }), keyDb(null));
  eq(denied?.status, 401, "status");
  assert(!partner, "returned a partner for an unknown key");
});

await check("unknown and revoked are INDISTINGUISHABLE to the caller", async () => {
  // api_key_lookup filters revoked_at IS NULL, so both arrive here as "no
  // row". Different messages would confirm which keys once existed.
  const a = await requirePartnerKey(req({ authorization: `Bearer ${KEY}` }), keyDb(null));
  const b = await requirePartnerKey(req({ authorization: `Bearer ${"b".repeat(43)}` }), keyDb(null));
  eq(await a.denied.json(), await b.denied.json(), "messages differ");
});

await check("a short key is rejected before hashing", async () => {
  const { denied } = await requirePartnerKey(req({ authorization: "Bearer short" }), keyDb(GOOD));
  eq(denied?.status, 401, "status");
});

await check("a key without the scope is 403, not 401", async () => {
  const { denied } = await requirePartnerKey(
    req({ authorization: `Bearer ${KEY}` }), keyDb({ ...GOOD, scopes: "read:something-else" }));
  eq(denied?.status, 403, "status");
});

await check("a good key resolves to exactly one partner", async () => {
  const { partner, denied } = await requirePartnerKey(
    req({ authorization: `Bearer ${KEY}` }), keyDb(GOOD));
  assert(!denied, "unexpected denial");
  eq(partner.id, "p_chase", "partner id");
  eq(partner.slug, "chase-roush", "slug");
});

await check("the partner id comes from the KEY, never from the request", async () => {
  // The attack this prevents: ?partner_id=p_demo on a valid key.
  const r = new Request("https://next.thauma.one/api/partner/v1/site?partner_id=p_demo",
    { headers: { authorization: `Bearer ${KEY}` } });
  const { partner } = await requirePartnerKey(r, keyDb(GOOD));
  eq(partner.id, "p_chase", "a query parameter influenced the partner");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
