/**
 * nopii.js — refuse to put personal data on a public wire
 *
 * The last gate before the partner API answers. Everything upstream already
 * makes person data unreachable:
 *
 *   PUBLIC_QUERIES      an allow-list of two queries
 *   assertPublicSafe()  proves those queries cannot name a private table
 *   partnerPublicSite() names every field it returns, so a new column does
 *                       not publish itself
 *
 * So why a fourth check. Because those three all guard the SHAPE of the
 * response, and the remaining risk is its CONTENT. `milestones.description` is
 * free text a human types. Nothing above stops somebody pasting a supporter's
 * email address into a public milestone — and that is exactly the accident
 * this is here to catch.
 *
 * FAILS CLOSED, LOUDLY. A violation returns 500 and publishes nothing. A
 * partner site's build breaking is a bad afternoon; a supporter's address
 * appearing on a public page is not recoverable — it is scraped, cached and
 * indexed before anyone notices.
 *
 * WHAT IS NOT CHECKED, AND WHY
 * Phone numbers. Every pattern loose enough to catch "+1 816 555 0142" also
 * catches dates, currency amounts and completion percentages, and a guard that
 * cries wolf gets switched off. Field NAMES cover the structured case; free
 * text carrying a phone number is left to review.
 */

/**
 * Field names that must never appear in a public payload, at any depth.
 *
 * Matched on the KEY, not the value, so there are no false positives to
 * argue with. Substring matching on purpose: `contact_email`, `billing_phone`
 * and `home_address` are all caught by their roots.
 */
const FORBIDDEN_KEY_PARTS = [
  "email", "phone", "mobile", "telephone",
  "first_name", "last_name", "full_name", "surname",
  "address", "street", "postal", "postcode", "zip",
  "note", "notes", "comment",
  "contact", "donor", "subscriber", "recipient",
  "password", "secret", "token", "key_hash", "auth_subject",
  "ip_address", "user_agent",
  "dob", "birthday", "date_of_birth",
];

/**
 * Keys that contain a forbidden substring but are known-safe.
 *
 * EXACT matches only, and each one needs a reason. This is where the guard is
 * argued with, and keeping the exceptions few and named is what stops it
 * decaying into a list nobody reads.
 *
 * `display_name` — the PARTNER'S OWN public identity, the name their site is
 *   already published under. Not a supporter's name. Delete this entry and the
 *   API stops returning it; nothing else breaks.
 *
 * `donor_count` — an aggregate, "14 donors", carrying no identity. The whole
 *   schema exists to hold this and not the people behind it: there is no
 *   donations table and no donor name anywhere to leak. `donor` stays in the
 *   forbidden list so `donor_name`, `donor_email` and `donor_list` are still
 *   refused. This entry was added because the guard caught the real payload,
 *   which is the process working.
 */
const ALLOWED_EXACT = new Set(["display_name", "donor_count"]);

// Deliberately conservative: something@something.tld with no spaces.
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/**
 * Walk a payload and throw on anything that looks personal.
 * Returns the payload unchanged so it can be used inline.
 */
export function assertNoPersonalData(payload, { where = "public payload" } = {}) {
  const seen = new WeakSet();

  const walk = (node, path) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }

    if (typeof node === "object") {
      // Cycles would otherwise hang the request rather than answering it.
      if (seen.has(node)) return;
      seen.add(node);

      for (const [key, value] of Object.entries(node)) {
        const lower = key.toLowerCase();
        if (!ALLOWED_EXACT.has(lower)) {
          const hit = FORBIDDEN_KEY_PARTS.find((p) => lower.includes(p));
          if (hit) {
            throw new Error(
              `${where}: field "${path ? path + "." : ""}${key}" looks like personal ` +
              `data (matched "${hit}") and must not be published. If it is genuinely ` +
              `public, add it to ALLOWED_EXACT in workers/src/lib/nopii.js with a ` +
              `reason — do not widen the match.`);
          }
        }
        walk(value, path ? `${path}.${key}` : key);
      }
      return;
    }

    if (typeof node === "string" && EMAIL_RE.test(node)) {
      throw new Error(
        `${where}: the value at "${path}" contains an email address. Free-text ` +
        `fields are published verbatim — remove it from the source record. To ` +
        `offer a way to get in touch, link the site's contact form instead.`);
    }
  };

  walk(payload, "");
  return payload;
}

/** Exported for the tests, so the list itself can be asserted on. */
export const __FORBIDDEN_KEY_PARTS = FORBIDDEN_KEY_PARTS;
export const __ALLOWED_EXACT = ALLOWED_EXACT;
