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
import { serveApp } from "./app.js";
import { splitLogo, sheenLogo } from "./logo.js";
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
/* THE FOOTER LINE IN EVERY PUBLISHED LANGUAGE, from the deploy's own files
   (src/closed-lines.njk). The build decides what is published, so a
   language switched on joins by itself; nothing here names a language. */
async function closedLines(env) {
  if (!env || !env.ASSETS) return [];
  try {
    const r = await env.ASSETS.fetch(new Request("https://thauma.one/js/closed-lines.json"));
    const list = r.ok ? await r.json() : [];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.line === "string" && x.line.trim() && /^[a-z]{2,3}$/.test(x.lang)) : [];
  } catch { return []; }
}
export async function closedSite(request, env) {
  const lang = pickLang(request.headers.get("Accept-Language"), builtInLangs(), "en");
  const home = `https://${(env && env.SITE_DOMAIN) || "thauma.one"}`;
  const [door, lines] = await Promise.all([arcadeIsOut(env), closedLines(env)]);
  /* the visitor's own language first, then the rest in the site's order */
  const first = Math.max(0, lines.findIndex((x) => x.lang === lang));
  const order = lines.slice(first).concat(lines.slice(0, first));
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
/* THE TWO GLOWS keep to the corners, so the middle stays easy to read
   (Chase, 2026-10-15) — blue top left, seafoam bottom right, drifting */
.glow{position:fixed;inset:-25%;pointer-events:none}
.glow::before,.glow::after{content:"";position:absolute;inset:0}
.glow::before{background:radial-gradient(34% 30% at 22% 20%,rgba(47,216,255,.30),transparent 70%);animation:a 24s ease-in-out infinite alternate}
.glow::after{background:radial-gradient(32% 30% at 80% 82%,rgba(92,242,196,.22),transparent 70%);animation:b 31s ease-in-out infinite alternate}
@keyframes a{0%{transform:translate(0,0)}50%{transform:translate(-4%,5%) scale(1.08)}100%{transform:translate(5%,-3%)}}
@keyframes b{0%{transform:scale(1.06)}50%{transform:translate(4%,-4%)}100%{transform:translate(-5%,3%) scale(1)}}
main{position:relative;display:flex;flex-direction:column;align-items:center}
/* THE LOGO IN PIECES (brand/logo-split.njk via site/logo.js), at the old
   wordmark's size, assembling; the arcade's door is still .wordmark */
.wordmark{position:relative;width:min(92vw,1180px);line-height:0;color:var(--text);-webkit-user-select:none;user-select:none;touch-action:manipulation}
.brand-logo-split,.brand-logo-sheen{display:block;width:100%;height:auto;overflow:visible}
.brand-logo-split .lg-ch,.brand-logo-split .lg-line{transform-box:fill-box}
.brand-logo-split .lg-line{transform-origin:left center}
.brand-logo-sheen{position:absolute;inset:0;pointer-events:none;filter:drop-shadow(0 0 10px rgba(143,235,255,.55))}
.arc-breaking .brand-logo-sheen{display:none}
@keyframes ch-in{from{opacity:0;transform:translateY(18%)}to{opacity:1;transform:none}}
@keyframes line-in{from{transform:scaleX(0)}to{transform:scaleX(1)}}
/* THE LINE: white, thin, one language after another — each change
   cascading DOWN a character at a time, slowly (Chase, 2026-10-15) */
.line{display:grid;margin-top:40px;height:34px;overflow:hidden;font:100 22px/34px 'Sora',sans-serif;letter-spacing:.06em;color:var(--text)}
.line>span{grid-area:1/1;display:flex;justify-content:center}
.ch{display:inline-block;white-space:pre;font-kerning:none;animation-duration:1.1s;animation-timing-function:cubic-bezier(.55,.05,.45,.95);animation-fill-mode:both}
.in .ch{animation-name:c-in}.out .ch{animation-name:c-out}
@keyframes c-in{from{transform:translateY(-105%);opacity:0}to{transform:none;opacity:1}}
@keyframes c-out{from{transform:none;opacity:1}to{transform:translateY(105%);opacity:0}}
p{margin:48px 0 0}
.btn{display:inline-flex;align-items:center;gap:14px;color:var(--blue);text-decoration:none;border:1px solid var(--blue);padding:14px 22px;
  font:600 12px/1 'Sora',sans-serif;letter-spacing:.16em;text-transform:uppercase;transition:background-color .2s,color .2s}
.btn::after{content:"";width:30px;height:7px;background:linear-gradient(currentColor,currentColor) left top/30px 1.8px no-repeat,linear-gradient(currentColor,currentColor) left bottom/15px 1.2px no-repeat}
.btn:hover{color:var(--blue-hi);background:var(--blue-dim)}
.btn:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
@media (prefers-reduced-motion:no-preference){
  .lg-ch{animation:ch-in .75s cubic-bezier(.55,.05,.45,.95) both;animation-delay:calc(var(--i) * 90ms + 250ms)}
  .lg-arrive{animation:line-in 1.1s cubic-bezier(.16,1,.3,1) 1.05s both}.lg-bar{animation:line-in .5s cubic-bezier(.55,.05,.45,.95) 1.75s both}
  .lg-close1{animation:line-in .7s cubic-bezier(.16,1,.3,1) 2.15s both}.lg-close2{animation:line-in .7s cubic-bezier(.16,1,.3,1) 2.3s both}
}
@media (prefers-reduced-motion:reduce){.glow::before,.glow::after{animation:none}.btn{transition:none}.brand-logo-sheen{display:none}.ch{animation:none!important}}
</style></head>
<body><div class="glow"></div><main><div class="wordmark">${splitLogo("cl")}${sheenLogo("cl")}</div>
${order.length ? `<div class="line" aria-label="${escHtml(order[0].line)}"><span class="out" aria-hidden="true"></span><span class="in" aria-hidden="true"></span></div>
<script>
(function () {
  var L = ${JSON.stringify(order.map((x) => x.line)).replace(/</g, "\\u003c")}, i = 0;
  var box = document.querySelector('.line'), out = box.querySelector('.out'), inn = box.querySelector('.in');
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function chars(el, s) {
    el.textContent = '';
    var a = Array.from(s), step = Math.min(90, 1600 / a.length);
    a.forEach(function (c, k) { var x = document.createElement('span'); x.className = 'ch'; x.textContent = c; x.style.animationDelay = Math.round(k * step) + 'ms'; el.appendChild(x); });
  }
  function show(k) {
    chars(out, i === k ? '' : L[i]); chars(inn, L[k]); i = k; box.setAttribute('aria-label', L[k]);
  }
  show(0);
  if (still || L.length < 2) return;
  setInterval(function () { show((i + 1) % L.length); }, 7500);
})();
</script>` : ""}
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
  /* THE MINISTRY'S APP (site/app.js): <site>/app and what it asks for —
     before the language parsing, which would read "app" as a page. */
  if (rest === "/app" || rest.startsWith("/app/")) {
    const app = await serveApp(request, env, { db, row, doc, base, rest });
    if (app) return app;
  }
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
