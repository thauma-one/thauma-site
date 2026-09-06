#!/usr/bin/env node
/**
 * Thauma's data and a partner's are completely separate
 *   node workers/test/org-separation.test.mjs
 *
 * WHY THIS MATTERS MORE THAN MOST THINGS HERE. A partner's supporters, goals,
 * prayer requests and mailing lists are their ministry's, and Thauma's are the
 * organization's. Serving one under the other's address is not an untidy page;
 * it is one ministry's data shown to another's audience.
 *
 * HOW THE SEPARATION IS BUILT
 *
 *   in the database   the organization is `partner_id IS NULL`; a partner is
 *                     its own id. There is no partners row for Thauma — it is
 *                     the thing partners belong to.
 *   in a URL          the organization is the reserved slug `thauma`; every
 *                     other slug is a partner.
 *
 * That makes the slug a SHARED NAMESPACE, which is where it can go wrong, and
 * this file is the fence around it.
 */
import { readFileSync } from "node:fs";
import { QUERIES } from "../src/lib/db.js";
import { ORG_SLUG, isOrgSlug, isReservedSlug } from "../src/lib/org.js";
import { partnerPublicSite } from "../src/lib/db.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("Thauma and a partner are separate\n");

/* ---------------------------------------------- the slug namespace holds */

await check("a partner cannot be created with the organization's slug", async () => {
  /* THE HOLE THIS CLOSES. Nothing reserved it. A partner named "Thauma" would
     take the slug, and /embed/v1/thauma/contact.js would go on meaning the
     ORGANIZATION — so that ministry's own form became unreachable and every
     page embedding it served Thauma's instead. Created by typing a name. */
  assert(isReservedSlug(ORG_SLUG), "the organization's own slug is not reserved");
  assert(isReservedSlug("Thauma"), "the check is case-sensitive; a name is typed by a person");
  assert(!isReservedSlug("chase-roush"), "an ordinary partner slug is being refused");
});

await check("the admin refuses it, and says why", async () => {
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert(/isReservedSlug\(slug\)/.test(src),
    "partner creation does not consult the reserved list");
  assert(/is how the organization itself is/.test(src),
    "the refusal is lumped in with 'the name may already be in use', which " +
    "sends somebody looking for a partner that does not exist");
});

await check("both sides read ONE definition of the word", async () => {
  /* Spelled twice they drift, the drift is silent, and it only shows once
     somebody has already created the partner. */
  const contact = readFileSync(new URL("../src/contact.js", import.meta.url), "utf8");
  assert(/isOrgSlug\(partnerSlug\)/.test(contact),
    "contact.js still compares the slug to its own string literal");
  assert(!/partnerSlug === "thauma"/.test(contact),
    "a hard-coded 'thauma' remains in contact.js");
});

/* ------------------------------------- the org and a partner never share a query */

await check("the organization's queries are separate statements, not a NULL", async () => {
  /* Reusing the partner query with partner_id = NULL is the tempting version
     and the dangerous one: every `partner_id IS :partner_id` then matches the
     organization's rows the moment a lookup fails. Separate statements cannot
     be reached by accident. */
  for (const name of ["public_contact_form_org", "public_contact_topics_org"]) {
    const sql = QUERIES[name];
    assert(sql, `${name} does not exist`);
    assert(/partner_id\s+IS\s+NULL/i.test(sql),
      `${name} does not pin itself to the organization`);
    assert(!/:partner_slug/.test(sql) && !/:partner_id/.test(sql),
      `${name} takes a partner parameter — it should need none`);
  }
});

await check("a partner query can never fall through to the organization", async () => {
  /* THE LEAK THAT ALREADY HAPPENED ONCE, in public_lists_for_signup:
     `partner_id IS (SELECT id FROM partners WHERE slug = :slug)` reads as
     "belonging to this partner" until the slug matches nobody — then the
     subquery is NULL, `partner_id IS NULL` is true, and it returns THAUMA's
     rows to whoever invented a slug. Every slug-driven public query must join
     `partners` so no row means no answer. */
  const offenders = [];
  for (const [name, sql] of Object.entries(QUERIES)) {
    if (!name.startsWith("public_")) continue;
    if (!/:partner_slug/.test(sql)) continue;
    const joined = /JOIN\s+partners\s+\w+\s+ON[^\n]*slug\s*=\s*:partner_slug/i.test(sql)
                || /FROM\s+partners\s+\w+[\s\S]*WHERE[\s\S]*\bslug\s*=\s*:partner_slug/i.test(sql);
    const nullMatch = /IS\s*\(\s*SELECT\s+id\s+FROM\s+partners/i.test(sql);
    if (nullMatch || !joined) offenders.push(name);
  }
  assert(offenders.length === 0,
    `these resolve a partner slug without joining partners, so an unknown slug ` +
    `returns the ORGANIZATION's rows: ${offenders.join(", ")}`);
});

await check("the partner payload refuses to be built for 'no partner'", async () => {
  /* The last line of defense. Everything partnerPublicSite runs is scoped by
     `partner_id IS :partner_id`, so a null partner would return the whole of
     Thauma's own content under a partner's API key. */
  let threw = null;
  try {
    await partnerPublicSite({ publicQuery: async () => [] }, null, "whoever");
  } catch (e) { threw = e; }
  assert(threw, "partnerPublicSite accepted a null partner id");
  assert(/requires a partnerId/i.test(threw.message), `unexpected error: ${threw.message}`);
});

await check("and for an empty string, which is not the same as null", async () => {
  let threw = null;
  try { await partnerPublicSite({ publicQuery: async () => [] }, "", "whoever"); }
  catch (e) { threw = e; }
  assert(threw, "an empty partner id was accepted — SQLite would treat it as no match, " +
                "but nothing here should be relying on that");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
