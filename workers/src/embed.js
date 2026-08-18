/**
 * embed.js — the widgets a partner puts on somebody else's website
 *
 *   GET /embed/v1/widget.js        the script, one file, no dependencies
 *   GET /embed/v1/{slug}.json      that partner's public numbers
 *
 * HOW THIS DIFFERS FROM THE PARTNER API, AND WHY IT HAD TO
 * ---------------------------------------------------------------------------
 * partner-api.js needs a Bearer key and deliberately sends NO CORS headers. It
 * is fetched by a BUILD: the key stays on a server, and a browser cannot read
 * the endpoint even if somebody pasted a key into client-side JavaScript.
 *
 * An embed is the opposite shape. It runs in a visitor's browser, on a site
 * Thauma does not control, so it cannot hold a secret — anything shipped to
 * the page is public the moment it is shipped. Pretending otherwise by
 * embedding a key would be worse than having none, because it would look
 * authenticated.
 *
 * So this endpoint is unauthenticated by design, and the safety is elsewhere:
 *
 *   1. OPT-IN PER PARTNER. `embed_enabled` is off for everyone until somebody
 *      turns it on. A partner who has not is 404 — not 403, which would
 *      confirm they exist.
 *   2. THE SAME PUBLIC QUERIES the partner API uses, which cannot name a
 *      private table (assertPublicSafe proves it at boot).
 *   3. THE SAME LAST GATE. assertNoPersonalData reads the response CONTENT,
 *      because milestone text is free text and nothing else stops an address
 *      being pasted into one.
 *
 * WHY THE SCRIPT IS SERVED FROM HERE RATHER THAN AS A STATIC FILE
 * ---------------------------------------------------------------------------
 * So there is one origin, one cache policy, and one version. A static asset
 * would be cached by whatever the site's rules happen to say, and a widget on
 * a stranger's page is the last thing that should be pinned to an old copy by
 * a caching rule nobody remembers writing.
 */
import { createDb, partnerPublicSite } from "./lib/db.js";
import { assertNoPersonalData } from "./lib/nopii.js";
import { json } from "./lib/store.js";
import { WIDGET_JS } from "./embed-widget.js";

/** A slug is lowercase letters, digits and hyphens. Nothing else reaches SQL. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Six-digit hex, with the hash. Validated here because SQLite cannot. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** The house colour, used when a partner has not chosen one. */
const DEFAULT_ACCENT = "#6D4AFF";

/**
 * CORS, and it has to be `*`.
 *
 * The whole point is that any site can embed this, and we do not know their
 * hostnames — a partner's supporter puts it on their own church's page
 * without telling anybody. There is nothing to protect: every field in the
 * response is already intended for a public website, and no credential is
 * accepted, so there is no session for another origin to ride.
 *
 * Credentials are explicitly NOT allowed, which is what keeps that true.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { ...CORS, Allow: "GET, OPTIONS" });
    }

    const path = url.pathname.replace(/^\/embed\/v1\/?/, "");

    if (path === "widget.js") return widgetScript(url.hostname);

    const m = path.match(/^([^/]+)\.json$/);
    if (!m) return json({ error: "Not found" }, 404, CORS);

    return partnerJson(decodeURIComponent(m[1]), env);
  },
};

function widgetScript(hostname) {
  /* NOT CACHED ON THE PREVIEW HOSTS.
     Measured 2026-08-18: a change to the widget was invisible on dev for the
     length of the max-age, because the edge was still serving the previous
     copy — which reads exactly like the change not working. On dev and next
     the script is being iterated on; on the live site it is being served to
     strangers, and the two want opposite headers. */
  const ephemeral = /^(dev|next)\./.test(String(hostname || ""));

  return new Response(WIDGET_JS, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": "application/javascript; charset=utf-8",
      /* An hour at the edge, a day in browsers that cannot revalidate. Short
         enough that a fix reaches every embedding site the same day, long
         enough that a popular partner's page is not fetching this on every
         view. */
      "Cache-Control": ephemeral
        ? "no-store"
        : "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

/**
 * The embed payload for one partner.
 *
 * Exported because the console previews widgets through /api/staff-embed, and
 * a preview assembled from a DIFFERENT builder is not a preview — it is a
 * second implementation that drifts, and the drift only shows up on somebody
 * else's website. One builder, two callers, no way for them to disagree.
 *
 * The `partner` row is passed in rather than looked up, because the two
 * callers find it differently: the public route by slug among partners who
 * have opted in, the console by who is signed in.
 */
export async function embedPayload(db, partner) {
  const site = await partnerPublicSite(db, partner.id);
  return {
    version: 1,
    partner: { slug: partner.slug, display_name: partner.display_name },
    /* The partner's stored appearance, so a page embedded years ago picks up
       a rebrand without being edited. The snippet can still override it. */
    theme: {
      accent: HEX_RE.test(partner.embed_accent || "") ? partner.embed_accent : DEFAULT_ACCENT,
      mode: ["auto", "light", "dark"].includes(partner.embed_theme) ? partner.embed_theme : "auto",
    },
    generated_at: new Date().toISOString(),
    ...site,
  };
}

async function partnerJson(slug, env) {
  if (!env.DB) return json({ error: "No database bound to this deploy" }, 500, CORS);
  if (!SLUG_RE.test(slug)) return json({ error: "Not found" }, 404, CORS);

  const db = createDb(env.DB);

  const partner = await db.queryOne("public_partner_for_embed", { slug });
  /* 404 rather than 403, and the same 404 as a slug that does not exist.
     Distinguishing "no such partner" from "that partner has embeds off"
     would turn this into a directory of who is in the system. */
  if (!partner) return json({ error: "Not found" }, 404, CORS);

  const body = await embedPayload(db, partner);

  // LAST GATE, same as the partner API. Milestone text is free text.
  try {
    assertNoPersonalData(body, { where: "embed" });
  } catch (err) {
    console.error("embed blocked a response:", err.message);
    return json({ error: "Response withheld." }, 500, CORS);
  }

  return json(body, 200, {
    ...CORS,
    /* Five minutes. Goal progress is a snapshot that moves a few times a day
       at most, and a widget on a busy page must not become a query per view.
       stale-while-revalidate means the visitor never waits for the refresh. */
    "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
  });
}
