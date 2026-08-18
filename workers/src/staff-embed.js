/**
 * staff-embed.js — the embed payload for the console's own preview
 *
 *   GET /api/staff-embed
 *
 * WHY THIS EXISTS RATHER THAN THE CONSOLE READING THE PUBLIC ENDPOINT
 * ---------------------------------------------------------------------------
 * The public endpoint returns 404 until a partner has switched embedding on.
 * That is correct for the world and useless for the person deciding whether to
 * switch it on — they would have to publish first and look afterwards, which
 * is exactly backwards for the one control on this site that makes something
 * readable by anyone on the internet.
 *
 * So this returns the SAME payload, for the caller's OWN partner, whether or
 * not embedding is enabled. Look, then decide.
 *
 * It shares one builder with the public route (embedPayload). A preview
 * assembled separately is not a preview — it is a second implementation that
 * drifts, and the drift would only ever show up on somebody else's website.
 *
 * WHAT MAKES IT SAFE TO RETURN DATA THE PUBLIC ROUTE WOULD REFUSE
 * ---------------------------------------------------------------------------
 * Nothing here is private. The payload is built from PUBLIC_QUERIES, which
 * cannot name a private table, and passed through the same assertNoPersonalData
 * gate. `embed_enabled` is a publication decision, not a confidentiality one —
 * it governs whether STRANGERS may read this, and the caller is not a stranger:
 * they are signed in through Access and scoped to their own partner.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, withActing } from "./lib/actas.js";
import { assertNoPersonalData } from "./lib/nopii.js";
import { json } from "./lib/store.js";
import { embedPayload } from "./embed.js";

export default {
  async fetch(request, env) {
    if (request.method !== "GET") {
      return json({ error: `${request.method} is not supported here.` }, 405);
    }

    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);

    const db = createDb(env.DB);

    /* Acting-as is honoured, so an administrator looking at somebody's console
       previews THAT partner's widget rather than their own — the whole point
       of standing in the account. Authority is re-derived from the Access
       token; the cookie is a request, not a credential. See lib/actas.js. */
    const actor = await resolveActor(request, env, db, user);

    const partners = await db.query("partners_for_user", { email: actor.email });
    if (!partners.length) {
      return json({
        error: "This account is not linked to a partner, so there is nothing to preview.",
      }, 403);
    }

    /* The console shows one partner at a time and the first is the one it
       shows. Same rule as every other staff endpoint. */
    const row = partners[0];

    /* partners_for_user answers "what may this person see" and returns `id`,
       not `partner_id` — it does not carry the embed columns. Read the
       settings row for the appearance the preview has to reproduce. */
    const settings = await db.queryOne("partner_settings", { partner_id: row.id });
    if (!settings) return json({ error: "That partner no longer exists." }, 404);

    const body = await embedPayload(db, settings);

    // The same last gate the public route applies. Milestone text is free text
    // wherever it is being drawn.
    try {
      assertNoPersonalData(body, { where: "staff embed preview" });
    } catch (err) {
      console.error("staff embed preview blocked a response:", err.message);
      return json({
        error: "Preview withheld: it contained data that must not be published. " +
               "Check the milestone and goal records.",
      }, 500);
    }

    return json(withActing({
      ...body,
      /* The preview needs to know, because the panel says different things
         about a widget that is live and one that is not yet. */
      enabled: !!settings.embed_enabled,
    }, actor), 200, { "Cache-Control": "no-store" });
  },
};
