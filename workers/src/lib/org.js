/**
 * org.js — where Thauma ends and a partner begins
 *
 * THE ORGANIZATION IS NOT A PARTNER. It is the thing partners belong to, and
 * it deliberately has no row in `partners`: a row would appear in every
 * partner list, every scope check and every count, and each of those would
 * then need a special case to leave it out. So the organization is spelled
 * `partner_id IS NULL` in the database and `thauma` in a URL.
 *
 * THAT MAKES THE SLUG A SHARED NAMESPACE, which is the whole reason this file
 * exists. `/embed/v1/<slug>/contact.js` reads `thauma` as the organization and
 * anything else as a partner. Nothing stopped a partner called "Thauma" being
 * created and taking that slug — after which its own contact form would be
 * permanently unreachable and every page embedding it would quietly serve the
 * ORGANIZATION's form instead. Two ministries' data behind one address is the
 * exact thing the partner scoping exists to prevent.
 *
 * ONE CONSTANT, READ BY BOTH SIDES. The endpoint that treats the slug as the
 * organization and the endpoint that hands out slugs must agree about the
 * word. Spelled twice, they drift; the drift is silent, and it is only visible
 * once somebody has already created the partner.
 */

/** The organization's address in slug space. */
export const ORG_SLUG = "thauma";

/**
 * Every slug a partner may not have.
 *
 * A list rather than one string because a second reserved word is a question
 * of when, not whether — `api`, `admin` and `staff` are all live paths — and
 * the second one is where a hard-coded comparison gets forgotten.
 */
export const RESERVED_SLUGS = new Set([ORG_SLUG]);

/** Does this slug mean the organization rather than a partner? */
export function isOrgSlug(slug) {
  return String(slug || "").toLowerCase() === ORG_SLUG;
}

/** May a partner be given this slug? */
export function isReservedSlug(slug) {
  return RESERVED_SLUGS.has(String(slug || "").toLowerCase());
}
