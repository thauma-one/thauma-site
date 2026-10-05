/**
 * public-page.js — Thauma's small public pages (confirm, unsubscribe)
 *
 * One look for both, moved here from unsubscribe.js. A partner ministry's
 * list gets the same page rebranded (lib/mail-brand.js): its color, its name
 * above the heading, and a line crediting Thauma — and only once its link has
 * been verified, so an invented link still gets Thauma's plain page.
 */
import { t } from "./mail-i18n.js";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* THE ACCENT WAS #6D4AFF — a purple that belongs to nothing here. It is the
   fallback an EMBED uses when a partner has never chosen a color (see
   DEFAULT_ACCENT in embed.js), and it arrived here as a default nobody
   revisited. This page is Thauma's own, not a partner's, so it wears Thauma's
   cyan and Thauma's near-black rather than a stranger's placeholder. */
export function page(title, body, accent = "#2FD8FF", lang = null, brand = null) {
  if (brand) accent = brand.accent;
  /* The lang attribute matters here beyond politeness: it is what tells a
     screen reader which voice to use, and a browser whether to offer a
     translation it does not need. */
  return `<!doctype html><html lang="${lang || "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  /* The site's own ground, not a generic dark. Light mode stays light — this
     page is often opened from a mail client on a phone in either. */
  :root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#12121a;--dim:#5c5c6b;--line:#e6e6ee}
  @media(prefers-color-scheme:dark){
    :root{--bg:#070A10;--card:#10161F;--ink:#EDF2F8;--dim:#9AA6B6;--line:#1c2531}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);
    color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
    Helvetica,Arial,sans-serif;padding:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:34px 38px;max-width:30rem;text-align:center}
  .bar{height:4px;background:${accent};border-radius:2px;margin:-34px -38px 26px}
  h1{margin:0 0 12px;font:700 23px/1.3 Georgia,Cambria,'Times New Roman',serif}
  p{margin:0 0 10px;color:var(--dim);font-size:15px}
  p:last-child{margin-bottom:0}
  .who{margin:0 0 14px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600}
  .credit{margin:22px 0 0;padding-top:14px;border-top:1px solid var(--line);font-size:12px}
  .undo{display:inline-block;margin-top:6px;color:var(--ink);font-size:14px;
    text-decoration:none;border-bottom:1px solid ${accent};padding-bottom:1px}
</style></head>
<body><div class="card"><div class="bar"></div>${brand && brand.name ? `<p class="who">${esc(brand.name)}</p>` : ""}${body}${brand ? `<p class="credit">${esc(t(lang, "brand.note"))}</p>` : ""}</div></body></html>`;
}

