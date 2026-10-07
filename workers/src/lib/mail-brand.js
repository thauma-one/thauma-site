/**
 * mail-brand.js — a partner ministry's mail is Thauma's mail, rebranded
 *
 * Chase, 2026-10-04: "Just match their subscribed emails and all those
 * confirmations to what Thauma already does, except branded to the Partner
 * Ministry (like replace the color scheme to match theirs, pulled from either
 * sharing or site creator, and change the name Thauma to their First and Last
 * name). You should still have 'A Thauma Ministry' … to credit Thauma."
 *
 * So the templates are Thauma's (newsletter.js render(), mail.js shell(), the
 * confirm and unsubscribe pages) and this decides only what changes in them:
 *
 *   accent, accent2  the ministry's colors — its published site's own accent
 *                    if it chose one in the Site Creator (Custom look), else
 *                    the pair on Sharing, which Design also edits
 *   mode             light or dark, as Sharing says (its embed background)
 *   name             the ministry's name, where Thauma's would be
 *
 * Thauma's own lists (no partner) get null: Thauma's mail, unchanged. Every
 * read is tolerant, so a missing row never stops a send.
 */
import { lookFor, companion } from "../embed-colour.js";
import { mailPalette } from "../site/render.js";

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function brandForMail(db, partnerId) {
  if (!partnerId) return null;
  const face = await db.queryOne("partner_for_site", { partner_id: partnerId }).catch(() => null);
  if (!face) return null;
  const pair = lookFor(face);
  let accent = pair.accent, accent2 = pair.accent2, palette = null;
  const site = await db.queryOne("partner_site_get", { partner_id: partnerId }).catch(() => null);
  if (site && site.published) {
    try {
      const design = JSON.parse(site.published).design || {};
      const own = (design.colors || {}).accent;
      if (HEX.test(own || "")) { accent = own.toUpperCase(); accent2 = companion(accent, -33); }
      /* the letter's light and dark grounds are the site's (render.js) */
      palette = mailPalette(design, { accent, accent2 });
    } catch { /* no site colors of its own */ }
  }
  return { accent, accent2, palette, mode: face.embed_theme === "dark" ? "dark" : "light", name: face.display_name || "" };
}
