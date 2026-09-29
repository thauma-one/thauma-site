/**
 * site/serve.js — answering a visitor at <name>.thauma.one
 *
 *   /                 → the visitor's language, if the site has it, else the
 *                       site's fallback language (302)
 *   /<lang>/          → Home
 *   /<lang>/<page>/   → that page, if it is switched on
 *
 * The same site is also reachable under /site/<name>/ on the console's own
 * address, which is how the owner previews it: ?draft shows the working copy
 * to anybody on the ministry's team (Access-gated), and without it the
 * published site, before the address exists or on dev and staging.
 *
 * WHICH LANGUAGE, WHEN NOTHING SAYS (Chase, 2026-09-29): the site's own
 * fallback language, chosen in its settings — not Thauma's, not English by
 * default. The visitor's browser is asked first; a language the site does not
 * publish is not offered.
 */
import { createDb } from "../lib/db.js";
import { requireAccess } from "../lib/access.js";
import { resolveActor } from "../lib/actas.js";
import { embedPayload } from "../embed.js";
import { assertNoPersonalData } from "../lib/nopii.js";
import { siteOrigin } from "../lib/origin.js";
import { cleanDoc, PAGES } from "./model.js";
import { renderPage, simplePage } from "./render.js";

/** The visitor's best language among the site's, else the site's fallback. */
export function pickLang(acceptLanguage, langs, fallback) {
  const wanted = String(acceptLanguage || "").split(",").map((part) => {
    const [tag, q] = part.trim().split(";q=");
    return { tag: tag.toLowerCase(), q: q ? parseFloat(q) : 1 };
  }).filter((x) => x.tag && x.tag !== "*" && x.q > 0).sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    if (langs.includes(tag)) return tag;
    const base = tag.split("-")[0];
    if (langs.includes(base)) return base;
    /* Bosnian and Montenegrin readers read Serbian or Croatian comfortably;
       a site with either is better than its fallback. */
    if ((base === "bs" || base === "sh" || base === "cnr") && (langs.includes("hr") || langs.includes("sr"))) {
      return langs.includes("hr") ? "hr" : "sr";
    }
  }
  return langs.includes(fallback) ? fallback : langs[0];
}

/**
 * @param sub    the site's name (<name>.thauma.one)
 * @param rest   the path after the site's root, starting "/"
 * @param base   the path the site sits under ("" or "/site/<name>")
 * @param draft  the working copy (console preview)
 */
export async function serveSite(request, env, { sub, rest, base, draft = false }) {
  if (!env.DB) return simplePage("Not available", "This site is not available right now.", 503);
  const db = createDb(env.DB);
  const row = await db.queryOne("partner_site_by_subdomain", { subdomain: sub });
  if (!row || row.status === "archived") return null;

  if (draft) {
    /* The working copy is the team's to look at, nobody else's. */
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    const actor = await resolveActor(request, env, db, user);
    const mine = await db.query("partners_for_user", { email: actor.email });
    const isAdmin = String((actor.me && actor.me.roles) || "").split(",").includes("admin");
    if (!mine.some((p) => p.id === row.partner_id) && !isAdmin) {
      return simplePage("Not yours to preview", "Only the ministry's team can see its unpublished site.", 403);
    }
  } else if (!row.enabled) {
    return simplePage("Coming soon", "This site is not open yet.", 404);
  }

  const full = draft
    ? (await db.queryOne("partner_site_get", { partner_id: row.partner_id })).draft
    : row.published;
  if (!full) return simplePage("Coming soon", "This site is not open yet.", 404);
  const catalog = (await db.query("languages_all", {})).filter((l) => l.is_active).map((l) => l.code);
  const doc = cleanDoc(JSON.parse(full), catalog);

  const url = new URL(request.url);
  const q = draft ? "?draft" : "";
  const parts = rest.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!parts.length) {
    const lang = pickLang(request.headers.get("Accept-Language"), doc.languages, doc.fallback);
    return new Response(null, { status: 302, headers: { Location: `${base}/${lang}/${q}`, "Vary": "Accept-Language" } });
  }
  const lang = parts[0];
  if (!doc.languages.includes(lang)) {
    /* An address in a language the site does not publish: the same page in
       the fallback language, rather than nothing. */
    const page = parts[1] && PAGES.includes(parts[1]) ? parts[1] + "/" : "";
    return new Response(null, { status: 302, headers: { Location: `${base}/${doc.fallback}/${page}${q}` } });
  }
  const pageId = parts[1] || "home";
  const page = doc.pages.find((p) => p.id === pageId);
  if (parts.length > 2 || !page || (!page.on && !draft)) {
    return simplePage("Not found", "There is no page at this address.", 404);
  }

  const partner = await db.queryOne("partner_for_site", { partner_id: row.partner_id });
  const payload = await embedPayload(db, partner, { onlyShared: false });
  try { assertNoPersonalData(payload, { where: "partner site" }); }
  catch (err) {
    console.error("partner site withheld:", err.message);
    return simplePage("Not available", "This page could not be shown.", 500);
  }

  const html = renderPage({
    doc, payload, lang, pageId, base, draft,
    theme: payload.theme,
    site: { slug: row.slug, display_name: row.display_name, giving_url: row.giving_url, subdomain: row.subdomain },
    origin: siteOrigin(env, request) || url.origin,
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": draft ? "no-store" : "public, max-age=60, stale-while-revalidate=600",
      "Content-Language": lang,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}
