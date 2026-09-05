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

await check("PUBLIC_QUERIES is an allow-list of exactly the intended queries", async () => {
  // If this fails because someone added a query, that is the test working:
  // adding to this set is a decision to publish, and should be deliberate.
  eq([...PUBLIC_QUERIES].sort(), [
    "public_goals_for_partner",
    "public_languages_for_partner",
    "public_milestone_translations",
    "public_milestones_for_partner",
    /* Added 2026-08-18 for the embed widgets. The only query here reached
       with no credential at all — the partner API needs a key and an embed
       cannot hold one. It carries its own authorisation (embed_enabled = 1),
       which is what makes an unauthenticated endpoint acceptable. See
       workers/src/embed.js. */
    "public_partner_for_embed",
    /* Added 2026-08-18. Published prayer requests. The translations query
       JOINs prayer and filters is_public there, which is what keeps an
       unpublished request's words out of a public response. */
    "public_prayer_for_partner",
    "public_prayer_translations",
    /* Added 2026-08-25. A channel's latest videos. Every column is already
       public on YouTube, but the `videos` table has NO partner column — the
       join through video_sources is what scopes it, which is why that join
       has to live in the SQL and not in a caller. */
    /* The list is compared SORTED, and "_" sorts before "s" — so the buttons
       come before the videos here even though they were added after. */
    /* The optional buttons under the shelf. Gated on the CHANNEL's switch,
       not their own — see the query. */
    "public_video_links_for_partner",
    "public_videos_for_partner",
    /* Added 2026-09-04. Past newsletters, so a partner site can list what has
       been sent. Gated on mailing_lists.archive_public — the SAME flag the
       /archive page uses, because a second rule here could disagree with the
       page and the way that failure shows up is a prayer request on somebody's
       public website. */
    "public_mailings_for_partner",
  ].sort(), "public set");
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
    if (sql.includes("FROM milestone_translations")) {
      return overrides.translations ?? [
        { milestone_id: "m_1", lang: "en", title: "Proclaim! 1st Missions Trip",
          description: "A missions trip.", target_label: "End of September 2026" },
        { milestone_id: "m_1", lang: "hr", title: "Proclaim! 1. misijsko putovanje",
          description: "Misionarsko putovanje.", target_label: "Kraj rujna 2026." },
      ];
    }
    if (sql.includes("FROM partner_languages")) {
      return overrides.languages ?? [
        { code: "en", name: "English", native_name: "English", sort_order: 0 },
        { code: "hr", name: "Croatian", native_name: "Hrvatski", sort_order: 1 },
      ];
    }
    if (sql.includes("FROM mailings")) {
      return overrides.mailings ?? [{
        slug: "three-weeks-in-zagreb", subject: "Three weeks in Zagreb",
        preheader: "The radiators work.", sent_at: "2026-02-20T09:00:00Z",
        list_slug: "mission-updates", list_name: "Mission Updates",
      }];
    }
    if (sql.includes("FROM video_links")) {
      return overrides.video_links ?? [
        { label: "All updates on YouTube", url: "https://www.youtube.com/@thauma" },
      ];
    }
    if (sql.includes("FROM videos")) {
      return overrides.videos ?? [
        { video_id: "dQw4w9WgXcQ", title: "Faith & Works",
          published_at: "2026-08-01T10:00:00+00:00" },
      ];
    }
    if (sql.includes("FROM milestones")) {
      return overrides.milestones ?? [{
        id: "m_1", parent_id: null, actual_date: null, status: "upcoming",
        completion: 0, is_featured: 1, sort_order: 1,
      }];
    }
    return [];
  });
}

await check("the payload carries languages, goals, milestones and prayer — and nothing else", async () => {
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  /* `prayer` joined the payload on 2026-08-18. It is public content in the
     same sense the roadmap is, and it goes through the same publication gate
     and the same no-personal-data check. */
  eq(Object.keys(site).sort(),
     ["goals", "languages", "mailings", "milestones", "prayer", "video_links",
      "videos"],
     "top-level keys");
});

await check("a video arrives with its URLs built, and its title undoubled", async () => {
  /* The three URLs are DERIVED here rather than stored, so a partner site
     never has to know how to assemble one. The title check guards the entity
     decoding in lib/youtube.js: a channel called "Faith &amp; Works" must
     reach a partner site as "Faith & Works" and not as the escaped form. */
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  const v = site.videos[0];
  eq(v.title, "Faith & Works", "title");
  eq(v.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "watch url");
  eq(v.embed_url, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "embed url");
  eq(v.thumbnail_url, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "thumbnail");
});

await check("a button reaches a partner site as a label and a URL, nothing else", async () => {
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  eq(site.video_links, [{ label: "All updates on YouTube",
                          url: "https://www.youtube.com/@thauma" }], "the rail");
});

await check("a past newsletter arrives with its address, and no body", async () => {
  /* No body: the archive page renders the words. Shipping them here would put
     a whole newsletter into any build holding a key, and grow the response
     without bound. */
  const site = await partnerPublicSite(fakePublicDb(), "p_chase", "chase-roush");
  const m = site.mailings[0];
  eq(m.subject, "Three weeks in Zagreb", "subject");
  eq(m.url, "https://thauma.one/archive/chase-roush/mission-updates/three-weeks-in-zagreb/",
     "url");
  assert(!("body_html" in m) && !("body_text" in m), `a body was shipped: ${Object.keys(m)}`);
});

await check("the archive URL is absolute and points at the LIVE site", async () => {
  /* A partner site renders this into a page that outlives the build. A staging
     address baked into it would rot, and is Access-gated besides. */
  const site = await partnerPublicSite(fakePublicDb(), "p_chase", "chase-roush");
  assert(site.mailings[0].url.startsWith("https://thauma.one/"),
    `not the live site: ${site.mailings[0].url}`);
  /* Without a slug there is no honest URL to build, and a wrong one is worse
     than none. */
  const noSlug = await partnerPublicSite(fakePublicDb(), "p_chase");
  eq(noSlug.mailings[0].url, null, "it invented a URL with no slug");
});

await check("the videos query cannot be run without a partner", async () => {
  /* The `videos` table has no partner column, so an undefined partner_id
     would become `partner_id IS NULL` and return the ORGANISATION's videos to
     whichever partner asked — the same shape as the slug leak fixed in the
     embed router. TENANT_SCOPED is what stops it. */
  let threw = null;
  try {
    await fakePublicDb().publicQuery("public_videos_for_partner", {});
  } catch (e) { threw = e.message; }
  assert(threw && /tenant-scoped/.test(threw), `expected a refusal, got ${threw}`);
});

await check("milestone text is keyed BY LANGUAGE, with no language named in code", async () => {
  const site = await partnerPublicSite(fakePublicDb(), "p_chase");
  eq(Object.keys(site.milestones[0].text).sort(), ["en", "hr"], "language keys");
  eq(site.milestones[0].text.hr.title, "Proclaim! 1. misijsko putovanje", "Croatian title");
});

await check("a language the partner has switched OFF never reaches the payload", async () => {
  // public_milestone_translations joins partner_languages and filters
  // is_enabled = 1, so a prepared-but-unpublished translation stays in the
  // database. Here the fake returns only English, standing in for Croatian
  // being switched off.
  const site = await partnerPublicSite(fakePublicDb({
    translations: [{ milestone_id: "m_1", lang: "en", title: "Only English" }],
  }), "p_chase");
  eq(Object.keys(site.milestones[0].text), ["en"], "languages present");
});

await check("a milestone with NO publishable text is dropped, not shipped empty", async () => {
  // Otherwise a partner site draws a row with no words in it.
  const site = await partnerPublicSite(fakePublicDb({ translations: [] }), "p_chase");
  eq(site.milestones.length, 0, "an untranslated milestone was published");
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
      id: "m_1", status: "upcoming", completion: 0,
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
