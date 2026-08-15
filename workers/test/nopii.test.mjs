#!/usr/bin/env node
/**
 * Tests for workers/src/lib/nopii.js — the content gate on the public API.
 *
 *   node workers/test/nopii.test.mjs
 *
 * The other public-boundary tests prove the response SHAPE cannot carry person
 * data. These prove the guard catches it anyway if it ever does — including
 * through the one route the shape rules cannot police, which is free text a
 * human typed into a milestone description.
 */
import { assertNoPersonalData, __ALLOWED_EXACT } from "../src/lib/nopii.js";
import { partnerPublicSite, createDb } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const throws = (fn, needle, m) => {
  let msg = null;
  try { fn(); } catch (e) { msg = e.message; }
  assert(msg, `${m} — expected a throw, got none`);
  assert(msg.toLowerCase().includes(needle.toLowerCase()),
    `${m} — threw, but message did not mention "${needle}": ${msg}`);
};

console.log("nopii.js — nothing personal reaches a public payload\n");

/* ------------------------------ field names ----------------------------- */

await check("a clean public payload passes", async () => {
  assertNoPersonalData({
    version: 1,
    partner: { slug: "chase-roush", display_name: "Chase Roush" },
    goals: [{ id: "g_1", label: "Monthly support", percent: 68, raised_cents: 306000 }],
    milestones: [{ id: "m_1", title: "Move to Croatia", status: "upcoming", completion: 0 }],
  });
});

await check("every forbidden field name is refused", async () => {
  const cases = [
    "email", "phone", "mobile", "first_name", "last_name", "full_name",
    "address", "postal_code", "notes", "note", "contact_email",
    "donor_name", "subscriber_id", "password", "api_token", "ip_address",
    "date_of_birth",
  ];
  for (const key of cases) {
    throws(() => assertNoPersonalData({ [key]: "anything" }), key, `key "${key}"`);
  }
});

await check("forbidden names are caught AT ANY DEPTH", async () => {
  throws(
    () => assertNoPersonalData({ milestones: [{ id: "m_1", meta: { owner: { email: "x@y.z" } } }] }),
    "email", "nested key");
});

await check("the path in the error says where to look", async () => {
  let msg = null;
  try { assertNoPersonalData({ milestones: [{ phone: "555" }] }); } catch (e) { msg = e.message; }
  assert(msg.includes("milestones[0].phone"), `unhelpful path: ${msg}`);
});

await check("matching is case-insensitive", async () => {
  throws(() => assertNoPersonalData({ Email: "a@b.co" }), "email", "capitalised key");
  throws(() => assertNoPersonalData({ PHONE: "555" }), "phone", "upper-case key");
});

await check("display_name is allowed, and ONLY as an exact key", async () => {
  // The partner's own published identity, not a supporter's name.
  assertNoPersonalData({ display_name: "Chase Roush" });
  assert(__ALLOWED_EXACT.has("display_name"), "display_name is not in the allow-list");
  // A near-miss must still be refused rather than slipping through the exception.
  throws(() => assertNoPersonalData({ contact_display_name: "Jane" }),
    "contact", "contact_display_name was allowed");
});

await check("donor_count is allowed but donor IDENTITY is not", async () => {
  // The aggregates-only guarantee, restated at the wire. A count is safe; a
  // name, an address or a list is the thing the schema refuses to hold.
  assertNoPersonalData({ goals: [{ donor_count: 14 }] });
  for (const key of ["donor_name", "donor_email", "donor_list", "donors"]) {
    throws(() => assertNoPersonalData({ goals: [{ [key]: "x" }] }), "donor", `key "${key}"`);
  }
});

await check("the allow-list stays SHORT — every entry is an argued exception", async () => {
  // Not style policing: this list is the only way person data legitimately
  // reaches a public payload, and a long one means the guard has been talked
  // out of its job one commit at a time.
  assert(__ALLOWED_EXACT.size <= 4,
    `ALLOWED_EXACT has grown to ${__ALLOWED_EXACT.size} entries ` +
    `(${[...__ALLOWED_EXACT].join(", ")}) — each needs a reason in nopii.js, ` +
    `and if they are all justified, raise this bound deliberately.`);
});

/* ------------------------------ free text ------------------------------- */

await check("AN EMAIL IN FREE TEXT IS REFUSED", async () => {
  // The accident this exists for: no field name is wrong, the shape is
  // perfect, and a supporter's address is on a public page anyway.
  throws(
    () => assertNoPersonalData({
      milestones: [{
        id: "m_1", title: "Support Raising",
        description: "Ask jordan.reyes@example.com about the September trip",
      }],
    }),
    "email address", "email in a description");
});

await check("the error names the field the address is in", async () => {
  let msg = null;
  try {
    assertNoPersonalData({ milestones: [{ description: "write to a@b.com" }] });
  } catch (e) { msg = e.message; }
  assert(msg.includes("milestones[0].description"), `unhelpful path: ${msg}`);
});

await check("ordinary prose with an @ is NOT a false positive", async () => {
  // A guard that cries wolf gets switched off.
  assertNoPersonalData({
    milestones: [
      { description: "Serving @ the Victory English Camp in September" },
      { description: "Costs are ~$5000 and 100% of it goes to the trip" },
      { description: "Target: 2026-09-24. Contact form is on the site." },
      { description: "Rated 5/5 by the team @ Proclaim" },
    ],
  });
});

await check("real Croatian milestone copy passes unchanged", async () => {
  assertNoPersonalData({
    milestones: [{
      title_hr: "Preseljenje u Hrvatsku",
      description_hr: "Ovo je trenutak kada se nadam da je Bog sve složio na svoje mjesto.",
      target_label_hr: "Kraj rujna 2027.",
    }],
  });
});

/* ------------------------------ robustness ------------------------------ */

await check("a cyclic payload does not hang", async () => {
  const a = { milestones: [] };
  a.self = a;
  assertNoPersonalData(a);
});

await check("nulls, numbers and booleans are fine", async () => {
  assertNoPersonalData({ a: null, b: 0, c: false, d: [null, 1, true], e: undefined });
});

await check("the payload is returned unchanged for inline use", async () => {
  const p = { goals: [] };
  assert(assertNoPersonalData(p) === p, "did not return the payload");
});

/* -------------------- against the real assembled payload ---------------- */

await check("the ACTUAL partner payload passes the guard", async () => {
  const db = createDb(null, async (sql) => {
    if (sql.includes("goal_progress")) {
      return [{ goal_id: "g_1", label: "Monthly support", kind: "monthly",
                target_cents: 450000, currency: "USD", raised_cents: 306000,
                donor_count: 14, percent: 68, captured_at: "2026-08-14T06:00:00Z" }];
    }
    if (sql.includes("milestones")) {
      return [{ id: "m_1", parent_id: null, title: "Move to Croatia",
                title_hr: "Preseljenje u Hrvatsku", description: "A description.",
                description_hr: "Opis.", target_label: "End of September 2027",
                target_label_hr: "Kraj rujna 2027.", actual_date: "2027-09-30",
                status: "upcoming", completion: 0, is_featured: 1, sort_order: 6 }];
    }
    return [];
  });
  const site = await partnerPublicSite(db, "p_chase");
  assertNoPersonalData({
    version: 1,
    partner: { slug: "chase-roush", display_name: "Chase Roush" },
    generated_at: new Date().toISOString(),
    ...site,
  });
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
