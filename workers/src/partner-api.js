/**
 * partner-api.js — the versioned, key-authenticated API a partner site builds against
 *
 * GET /api/partner/v1/site
 *   Authorization: Bearer <key>
 *
 * Everything this returns is intended to be rendered on a PUBLIC WEBSITE. It
 * is the only endpoint in this Worker with that property, and the only one a
 * credential outside Thauma can reach.
 *
 * DESIGNED TO BE BORING. One endpoint, one round trip, everything a partner
 * site's build needs. chaseroush.com fetches this once at build time and
 * writes static HTML — so Thauma being down delays a deploy rather than
 * breaking a live site, and the key never reaches a browser.
 *
 * WHAT IT CANNOT RETURN
 * ---------------------------------------------------------------------------
 * Contacts. Interactions. Users. Audit entries. Donor identity of any kind.
 *
 * Not by policy — by construction. It may only run queries in PUBLIC_QUERIES,
 * `assertPublicSafe()` proves at startup that none of those queries can even
 * name a private table, and the response is assembled field by field below
 * rather than spread from a database row. A column added to `milestones`
 * tomorrow does not appear here until somebody writes it in.
 *
 * "Timeline" appears nowhere in this file on purpose. The public roadmap is
 * `milestones`; the private stewardship history is `interactions`; they share
 * a word in conversation and must not share one in code. See the warning at
 * the top of db/migrations/0002_milestones.sql.
 */
import { createDb, partnerPublicSite } from "./lib/db.js";
import { requirePartnerKey } from "./lib/apikey.js";
import { assertNoPersonalData } from "./lib/nopii.js";
import { json } from "./lib/store.js";

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    }
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);

    const db = createDb(env.DB);

    const { partner, denied } = await requirePartnerKey(request, db);
    if (denied) return denied;

    const site = await partnerPublicSite(db, partner.id, partner.slug);

    // Best-effort usage record. A failure here must not fail the request —
    // the build asked a legitimate question and deserves its answer.
    try {
      await db.query("api_key_touch", { key_id: partner.key_id, now: new Date().toISOString() });
    } catch {
      /* not worth failing a build over */
    }

    const body = {
      // Versioned in the payload as well as the path, so a consumer can
      // assert on it without parsing a URL.
      version: 1,
      partner: { slug: partner.slug, display_name: partner.display_name },
      generated_at: new Date().toISOString(),
      ...site,
    };

    // LAST GATE. The three guarantees upstream all constrain the response's
    // SHAPE; this one reads its CONTENT, because milestone descriptions are
    // free text and nothing else stops a supporter's address being pasted into
    // one. Refuses the whole response rather than publishing a suspect field.
    try {
      assertNoPersonalData(body, { where: "partner API" });
    } catch (err) {
      // Log the detail, return a generic message. The reason names a field and
      // sometimes quotes a value, and this response goes to a partner site.
      console.error("partner API blocked a response:", err.message);
      return json({
        error: "Response withheld: it contained data that must not be published. " +
               "An administrator needs to check the milestone and goal records.",
      }, 500);
    }

    return json(body, 200, {
      // A build fetches this; a browser must not be able to. No CORS headers
      // are sent, deliberately — a partner site's BUILD is same-process, and
      // no Access-Control-Allow-Origin means a page cannot fetch this with a
      // key someone pasted into client-side JavaScript.
      "Cache-Control": "no-store",
    });
  },
};
