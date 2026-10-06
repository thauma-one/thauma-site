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
import { cleanDoc, PAGES, word, builtInLangs, cleanLinkTarget } from "./model.js";
import { renderPage, simplePage } from "./render.js";

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * A NAME WITH NO OPEN SITE: Thauma's own quiet page, not an empty one.
 *
 * Every *.thauma.one reaches the live Worker (a wildcard record the Worker's
 * scheduled() keeps in place), so a visitor who opens a site before it is
 * switched on gets an answer at once — and nothing for their device to
 * remember as "does not exist" for half an hour (Chase, 2026-09-29: "how do
 * we make sure that someone who wants to check the live site doesn't open it
 * too early and then has to wait?").
 *
 * WHAT IT IS (Chase, 2026-09-29: "something simple, like the word THAUMA in
 * big text with the hero gradient we've been using. Maybe with a little
 * movement in the background. And then a link to the main Thauma site"):
 * the site's own wordmark over the partner sites' hero gradient in Thauma's
 * two voices (blue from the top left, seafoam from the bottom right), both
 * drifting slowly; one link on. Nothing of whose name it is.
 *
 * AND A DOOR (ARCADE-SPEC.md §1): once the arcade is out (it is, exactly
 * when /arcade/ was built — the one switch, site.json), five taps on THAUMA
 * fail this page the way every door fails the site's, and it switches off
 * into thauma.one/arcade/. /js/ is served before the Worker on every host, so
 * the engine loads from here.
 *
 * 404 and noindex, never cached: the moment the site is switched on, the
 * site is what answers. Colors are main.css's tokens; the fonts are the
 * site's own, same-origin.
 */
async function arcadeIsOut(env) {
  if (!env || !env.ASSETS) return false;
  try { return (await env.ASSETS.fetch(new Request("https://thauma.one/arcade/"))).ok; } catch { return false; }
}
export async function closedSite(request, env) {
  const lang = pickLang(request.headers.get("Accept-Language"), builtInLangs(), "en");
  const home = `https://${(env && env.SITE_DOMAIN) || "thauma.one"}`;
  const door = await arcadeIsOut(env);
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Thauma</title>
<style>
@font-face{font-family:'Sora';font-weight:100 600;font-display:swap;src:url('/fonts/Sora-latin-v2.woff2') format('woff2')}
@font-face{font-family:'Inter';font-weight:200 600;font-display:swap;src:url('/fonts/Inter-latin-v2.woff2') format('woff2')}
:root{--bg:#0B0F15;--text:#EDF2F8;--dim:#8A96A6;--blue:#2FD8FF;--blue-hi:#8FEBFF;--blue-dim:rgba(47,216,255,.14);
  --blue-glow:0 0 26px rgba(47,216,255,.35);--foam:#5CF2C4;--foam-hi:#B2FFE6;--foam-dim:rgba(92,242,196,.14);--foam-glow:0 0 26px rgba(92,242,196,.35)}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;min-height:100vh;min-height:100svh;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:var(--bg);color:var(--text);font:300 16px/1.6 'Inter',system-ui,sans-serif;padding:32px 16px;text-align:center}
.glow{position:fixed;inset:-25%;pointer-events:none}
.glow::before,.glow::after{content:"";position:absolute;inset:0}
.glow::before{background:radial-gradient(42% 38% at 34% 32%,rgba(47,216,255,.30),transparent 70%);animation:a 24s ease-in-out infinite alternate}
.glow::after{background:radial-gradient(38% 36% at 68% 70%,rgba(92,242,196,.22),transparent 70%);animation:b 31s ease-in-out infinite alternate}
@keyframes a{to{transform:translate(9%,7%) scale(1.18)}}
@keyframes b{from{transform:scale(1.12)}to{transform:translate(-8%,-6%) scale(1)}}
main{position:relative}
.wordmark{font-family:'Sora',sans-serif;font-weight:100;font-size:clamp(52px,13vw,160px);letter-spacing:.14em;padding-left:.14em;
  line-height:1;text-shadow:0 0 60px rgba(47,216,255,.22);margin:0;-webkit-user-select:none;user-select:none;touch-action:manipulation}
p{margin:44px 0 0}
.btn{display:inline-block;color:var(--blue);text-decoration:none;border:1px solid var(--blue-dim);padding:12px 22px;
  font-size:12px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;transition:border-color .2s,color .2s}
.btn:hover{color:var(--blue-hi);border-color:var(--blue)}
.btn:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media (prefers-reduced-motion:reduce){.glow::before,.glow::after{animation:none}.btn{transition:none}}
</style></head>
<body><div class="glow"></div><main><div class="wordmark">THAUMA</div>
<p><a class="btn" href="${home}/">${escHtml(word(lang, "closedLink"))}</a></p></main>${door ? `
<script>
(function () {
  var mark = document.querySelector('.wordmark'), n = 0, going = false, eng = null;
  function fx() {
    return eng || (eng = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/js/arcade/fail.js';
      s.onload = function () { res(window.ThaumaFail.create()); }; s.onerror = rej;
      document.head.appendChild(s);
    }));
  }
  mark.addEventListener('click', function () {
    if (going) return;
    n++;
    if (n >= 5) {
      going = true;
      fx().then(function (e) { return e.collapse({ first: mark }); })
        .then(function () { location.href = '${home}/arcade/'; }, function () { location.href = '${home}/arcade/'; });
      return;
    }
    fx().then(function (e) { e.spare(mark); e.progress('closed', Math.ceil(n * 4 / 5), function () { n = 0; }); });
  });
  /* BACK FROM THE ARCADE with the browser's Back: the page comes out of the
     browser's memory as it was left, in pieces (BACKLOG §4: "returning to
     Thauma remembered the broken look"). It builds itself again instead —
     the fall in reverse — or, if that cannot run, loads fresh. */
  window.addEventListener('pageshow', function (ev) {
    if (!ev.persisted || !going) return;
    going = false; n = 0;
    fx().then(function (e) { return e.restore(); }).catch(function () { location.reload(); });
  });
})();
</script>` : ""}</body></html>`;
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
  if (row.status === "archived") return base ? null : closedSite(request, env);

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
    return base ? null : closedSite(request, env);
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
  /* FOR SEARCH ENGINES (BACKLOG §3, 2026-10-04): every shown page in every
     language, at the site's real public address, and a robots.txt naming it.
     Not for previews. */
  if (!draft && (rest === "/sitemap.xml" || rest === "/robots.txt")) {
    const pub = row.subdomain ? `https://${row.subdomain}.thauma.one` : url.origin + base;
    if (rest === "/robots.txt") {
      return new Response(`User-agent: *\nAllow: /\nSitemap: ${pub}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }
    const at = (id, l) => `${pub}/${l}/${id === "home" ? "" : id + "/"}`;
    const x = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    const urls = doc.pages.filter((p) => p.on).flatMap((p) => doc.languages.map((l) =>
      `<url><loc>${x(at(p.id, l))}</loc>${doc.languages.map((o2) => `<xhtml:link rel="alternate" hreflang="${x(o2)}" href="${x(at(p.id, o2))}"/>`).join("")}</url>`));
    return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`,
      { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  }
  const parts = rest.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!parts.length) {
    const lang = pickLang(request.headers.get("Accept-Language"), doc.languages, doc.fallback);
    return new Response(null, { status: 302, headers: { Location: `${base}/${lang}/${q}`, "Vary": "Accept-Language" } });
  }
  /* A clean link — /YouTube, /hr/Darivanje — before anything is "not found". */
  const clean = (parts.length === 1 && !doc.languages.includes(parts[0])) ||
    (parts.length === 2 && doc.languages.includes(parts[0]) && !doc.pages.some((p) => p.id === parts[1]))
    ? cleanLinkTarget(doc, parts, { base, q, giving: doc.give || row.giving_url || "" }) : null;
  if (clean) return new Response(null, { status: 302, headers: { Location: clean, "Cache-Control": "no-store" } });
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
