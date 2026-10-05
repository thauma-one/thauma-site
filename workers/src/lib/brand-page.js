/**
 * brand-page.js — a ministry's small public pages, in its own look
 *
 * BACKLOG §1 (Chase): the subscribe / confirm / unsubscribe pages are "just so
 * plain and boring compared to the rest of the site. Match the brand
 * everywhere." The look is the ministry's EMAIL look (lib/email-look.js),
 * which follows its website unless it chose otherwise, so the confirmation
 * email, the page its button opens and the newsletter that follows are one
 * thing. Thauma's own lists, and every page for a link that is not valid,
 * keep their plain Thauma page: a branded page there would say whose list an
 * invented link belongs to.
 *
 * `body` is HTML the caller has already escaped; links styled `.act`.
 */
import { escapeHtml as esc } from "./newsletter.js";

export function brandPage({ look: L, title, body, lang = "en", name = "", note = "" }) {
  const radius = L.corners === "square" ? 0 : L.corners === "round" ? 22 : 12;
  const mast = L.header === "logo" && L.logo
    ? `<img class="logo" src="${esc(L.logo)}" alt="${esc(name)}">`
    : L.header === "none" ? "" : `<p class="name">${esc(name)}</p>`;
  const site = L.siteUrl ? `<a class="site" href="${esc(L.siteUrl)}">${esc(L.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : "";
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
${L.fontsUrl ? `<link rel="stylesheet" href="${esc(L.fontsUrl)}">` : ""}
<style>
  :root{color-scheme:${L.mode}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:${L.bg};color:${L.ink};
    font:16px/1.6 ${L.bodyFont};padding:24px;-webkit-font-smoothing:antialiased}
  .card{background:${L.card};border:1px solid ${L.line};border-radius:${radius}px;
    padding:34px 38px;max-width:32rem;width:100%;box-sizing:border-box;text-align:center;overflow:hidden}
  .bar{height:4px;background:${L.accent};margin:-34px -38px 26px}
  .name{margin:0 0 14px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${L.dim};font-weight:600}
  .logo{display:block;height:44px;width:auto;max-width:220px;margin:0 auto 16px}
  h1{margin:0 0 12px;font:700 25px/1.25 ${L.headFont};color:${L.ink}}
  p{margin:0 0 10px;color:${L.dim};font-size:15px}
  b{color:${L.ink}}
  .act{display:inline-block;margin-top:8px;color:${L.ink};font-size:14px;text-decoration:none;
    border-bottom:1px solid ${L.accent};padding-bottom:1px}
  .foot{margin-top:22px;padding-top:16px;border-top:1px solid ${L.line};font-size:12.5px;color:${L.dim}}
  .foot a{color:${L.accent}}
  .site{display:inline-block;margin-bottom:6px}
</style></head>
<body><main class="card">${L.bar ? `<div class="bar"></div>` : ""}${mast}${body}
<div class="foot">${site}${note ? `<div>${esc(note)}</div>` : ""}</div></main></body></html>`;
}
