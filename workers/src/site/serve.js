/**
 * site/serve.js — answering a visitor at <name>.thauma.one
 *
 *   /                 → the visitor's language, if the site has it, else the
 *                       site's fallback language (302)
 *   /<lang>/          → Home
 *   /<lang>/<page>/   → that page, if it is switched on
 *   an old name       → the same path at the current name (301, 0045)
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
import { cleanDoc, PAGES, word, builtInLangs } from "./model.js";
import { renderPage, simplePage } from "./render.js";

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * A NAME WITH NO OPEN SITE: Thauma's own quiet page, not an empty one.
 *
 * Every *.thauma.one reaches the live Worker now (a wildcard record the
 * Worker's scheduled() keeps in place), so a visitor who opens a site before it is switched on
 * gets an answer at once — and nothing for their device to remember as
 * "does not exist" for half an hour, which is what the per-name records
 * cost (Chase, 2026-09-29: "how do we make sure that someone who wants to
 * check the live site doesn't open it too early and then has to wait?" …
 * "can we have it just be a THAUMA branded page instead?").
 *
 * The same for a site switched off, archived, or never made. It says
 * nothing about whose name it is. 404 and noindex, never cached, so the
 * moment the site is switched on, the site is what answers.
 *
 * Colors are main.css's tokens (--bg, --text, --dim, --blue); the fonts are
 * the site's own, same-origin — /fonts/ is served before the Worker on
 * every host (run_worker_first), partner names included.
 */
export function closedSite(request) {
  const lang = pickLang(request.headers.get("Accept-Language"), builtInLangs(), "en");
  const w = (k) => escHtml(word(lang, k));
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Thauma</title>
<style>
@font-face{font-family:'Sora';font-weight:100 600;font-display:swap;src:url('/fonts/Sora-latin-v2.woff2') format('woff2')}
@font-face{font-family:'Sora';font-weight:100 600;font-display:swap;src:url('/fonts/Sora-latin-ext-v2.woff2') format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F}
@font-face{font-family:'Inter';font-weight:200 300;font-display:swap;src:url('/fonts/Inter-latin-v2.woff2') format('woff2')}
@font-face{font-family:'Inter';font-weight:200 300;font-display:swap;src:url('/fonts/Inter-latin-ext-v2.woff2') format('woff2');unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F}
:root{--bg:#0B0F15;--text:#EDF2F8;--dim:#8A96A6;--blue:#2FD8FF;--blue-hi:#8FEBFF;--blue-dim:rgba(47,216,255,.14)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;
  background:var(--bg);color:var(--text);font:300 16px/1.6 'Inter',system-ui,sans-serif;padding:32px 16px;text-align:center}
main{max-width:520px}
.mark{font-family:'Sora',sans-serif;font-weight:100;letter-spacing:.42em;font-size:18px;margin:0 0 28px;padding-left:.42em}
.rule{width:48px;height:1px;background:var(--blue);margin:0 auto 28px}
h1{font-family:'Sora',sans-serif;font-weight:100;font-size:clamp(26px,6vw,36px);line-height:1.25;margin:0 0 12px}
p{color:var(--dim);margin:0 0 32px}
a{display:inline-block;color:var(--blue);text-decoration:none;border:1px solid var(--blue-dim);padding:10px 20px;
  font-size:13px;letter-spacing:.08em;transition:border-color .2s,color .2s}
a:hover{color:var(--blue-hi);border-color:var(--blue)}
a:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media (prefers-reduced-motion:reduce){a{transition:none}}
</style></head>
<body><main><div class="mark">THAUMA</div><div class="rule"></div>
<h1>${w("closedTitle")}</h1><p>${w("closedText")}</p>
<a href="https://thauma.one/">${w("closedLink")}</a></main></body></html>`;
  return new Response(html, { status: 404, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex", "Vary": "Accept-Language",
  } });
}

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
  if (!row) {
    /* A name the site used to have (0045): an administrator changed the
       address, and every link to the old one still arrives — sent on, page
       and all. Permanent, so search engines move their entry over. */
    const moved = await db.queryOne("partner_site_by_alias", { subdomain: sub });
    if (!moved) return null;
    const url = new URL(request.url);
    const domain = env.SITE_DOMAIN || "thauma.one";
    const to = base ? `${url.origin}/site/${moved.subdomain}${rest}${url.search}`
      : `https://${moved.subdomain}.${domain}${rest}${url.search}`;
    return new Response(null, { status: 301, headers: { Location: to } });
  }
  if (row.status === "archived") return base ? null : closedSite(request);

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
  } else if (!row.enabled || !row.published) {
    /* A SITE THAT IS OFF SHOWS NOTHING OF ITSELF (Chase, 2026-09-29: "I
       don't want the page to load at all … if the subdomain is typed in and
       the site is disabled"). Its name used to vanish from DNS; that made
       anyone who looked too early wait out a remembered "does not exist",
       so now the name stays and answers with Thauma's closed page — no
       ministry name, no "coming soon" (closedSite above). Under
       /site/<name>/ it is the console's own 404, as for any address that is
       not there. */
    return base ? null : closedSite(request);
  }

  const full = draft
    ? (await db.queryOne("partner_site_get", { partner_id: row.partner_id })).draft
    : row.published;
  const active = (await db.query("languages_all", {})).filter((l) => l.is_active);
  const catalog = active.map((l) => l.code);
  /* Each language by its own name, for the site's language menu. */
  const langNames = Object.fromEntries(active.map((l) => [l.code, l.native_name || l.name || l.code]));
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

  /* ?part=footer, for the console's Footer tab (Chase, 2026-09-29: "Can the
     footer preview show ONLY the footer?"). Previews only. */
  const only = draft && url.searchParams.get("part") === "footer" ? "footer" : null;
  const html = renderPage({
    doc, payload, lang, pageId, base, draft, only, langNames,
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
