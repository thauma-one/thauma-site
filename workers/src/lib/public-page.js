/**
 * public-page.js — Thauma's small public pages: a sign-up confirmed, an
 * unsubscribe, an account or address confirmed, a test inbox proved.
 *
 * DESIGN N, "the program" (Chase, 2026-10-14: "Let's go with N for the
 * design … I do want it to animate in in parts. Maybe make the colored bar
 * slowly breathe as well? Or maybe a shimmer?"). The same center line as the
 * emails that lead here (lib/mail.js shell): the name in wide thin capitals
 * with two short lines under it, a cue, the heading thin with its last word
 * bold, the words, an outlined button, then the hairline with its colored
 * segment — which arrives last, then breathes, with a light passing along it
 * now and then. Each part rises in after the one before. All of it still for
 * a visitor who asked for less motion.
 *
 * A partner ministry's list gets the same page in its own color and name,
 * with Thauma credited at the foot (lib/mail-brand.js) — only once its link
 * has been verified, so an invented link still gets Thauma's plain page.
 *
 *   page(title, body, accent?, lang?, brand?, { cue })
 *   body: the page's <h1> and <p>s, and an optional <a class="go">.
 */
import { t } from "./mail-i18n.js";
import { readable } from "../embed-colour.js";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GROUND = "#0B0F15";
/* a color lifted toward white, for the far end of the colored segment */
function lift(hex, k = 0.45) {
  const n = parseInt(hex.slice(1), 16);
  return "#" + [16, 8, 0].map((s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k)
    .toString(16).padStart(2, "0")).join("");
}

/* THE HEADING'S LAST WORD BOLD, as every heading on the site is thin text
   and bold text. Only when the heading has no bold of its own. */
function headed(body) {
  return String(body).replace(/<h1>([^<]*)<\/h1>/, (m0, text) => {
    const words = text.trim().split(/\s+/);
    if (words.length < 2) return `<h1><b>${text.trim()}</b></h1>`;
    const last = words.pop();
    return `<h1>${words.join(" ")} <b>${last}</b></h1>`;
  });
}

export function page(title, body, accent = "#2FD8FF", lang = null, brand = null, { cue = "" } = {}) {
  if (brand) accent = brand.accent;
  const acc = readable(/^#[0-9a-f]{6}$/i.test(String(accent || "")) ? accent : "#2FD8FF", GROUND, 4.5);
  const hi = lift(acc);
  const name = (brand && brand.name) || "Thauma";
  /* The lang attribute matters here beyond politeness: it is what tells a
     screen reader which voice to use, and a browser whether to offer a
     translation it does not need. */
  return `<!doctype html><html lang="${esc(lang || "en")}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${GROUND}">
<title>${title}</title>
<style>
  @font-face{font-family:Sora;src:url(/fonts/Sora-latin-v2.woff2) format("woff2");font-weight:100 800;font-display:swap}
  @font-face{font-family:Inter;src:url(/fonts/Inter-latin-v2.woff2) format("woff2");font-weight:100 900;font-display:swap}
  :root{color-scheme:dark;--acc:${acc};--hi:${hi}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;align-items:center;text-align:center;
    background:radial-gradient(900px 420px at 50% -6%,rgba(255,255,255,.05),transparent 70%),${GROUND};
    color:#8A96A6;font:300 16px/1.65 Inter,'Helvetica Neue',Helvetica,Arial,sans-serif}
  header{display:flex;flex-direction:column;align-items:center;gap:14px;padding:48px 6% 0;color:var(--acc)}
  .name{font:100 16px/1.2 Sora,'Helvetica Neue',Helvetica,sans-serif;letter-spacing:.42em;margin-right:-.42em;
    text-transform:uppercase;color:#EDF2F8}
  .two{display:block;width:64px;height:8px}
  main{flex:1;width:100%;display:flex;flex-direction:column;align-items:center;padding:clamp(72px,14vh,128px) 6% 0}
  .cue{display:flex;align-items:center;justify-content:center;gap:14px;margin:0 0 24px;
    font:600 11px/1.4 Sora,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:var(--acc)}
  .cue:before,.cue:after{content:"";width:28px;height:1px;background:var(--acc)}
  h1{margin:0;max-width:16ch;font:100 clamp(2.5rem,6vw,4.75rem)/1.05 Sora,'Helvetica Neue',Helvetica,sans-serif;color:#FFF}
  h1 b{font-weight:600}
  main p{max-width:34rem;margin:22px auto 0;font-size:1.15rem;line-height:1.65;color:#C3CDD9}
  main p+p{margin-top:12px;font-size:1rem;color:#8A96A6}
  a{color:var(--acc)}
  a.go,a.undo{display:inline-flex;align-items:center;gap:14px;margin-top:40px;padding:16px 24px;border:1px solid var(--acc);
    background:transparent;color:var(--acc);font:600 13px/1 Sora,sans-serif;letter-spacing:.16em;text-transform:uppercase;
    text-decoration:none;transition:background-color .2s}
  a.go:after,a.undo:after{content:"";width:30px;height:7px;
    background:linear-gradient(currentColor,currentColor) left top/30px 1.8px no-repeat,
               linear-gradient(currentColor,currentColor) left bottom/15px 1.2px no-repeat}
  a.go:hover,a.undo:hover{background:color-mix(in srgb,var(--acc) 12%,transparent)}
  .meter{position:relative;align-self:stretch;height:1px;margin-top:88px;background:#1A222D}
  .meter span{position:absolute;left:39%;top:-1px;width:22%;height:3px;overflow:hidden;
    background:linear-gradient(90deg,var(--acc),var(--hi));box-shadow:0 0 18px color-mix(in srgb,var(--acc) 40%,transparent)}
  .meter span:after{content:"";position:absolute;inset:0;transform:translateX(-100%);
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent)}
  footer{align-self:stretch;display:flex;flex-wrap:wrap;justify-content:center;gap:8px 28px;margin-top:72px;
    padding:24px 6% 32px;border-top:1px solid #141B24;font-size:12px}
  footer a{color:#8A96A6;text-decoration:none}
  @media (prefers-reduced-motion:no-preference){
    header,main>*,footer{opacity:0;animation:rise .8s cubic-bezier(.16,1,.3,1) forwards}
    header{animation-delay:.05s}
    main>:nth-child(1){animation-delay:.2s}main>:nth-child(2){animation-delay:.35s}main>:nth-child(3){animation-delay:.5s}
    main>:nth-child(4){animation-delay:.62s}main>:nth-child(5){animation-delay:.74s}main>:nth-child(n+6){animation-delay:.86s}
    main>.meter{opacity:1;animation:none}
    .meter span{transform:scaleX(0);animation:grow 1.1s cubic-bezier(.16,1,.3,1) 1s forwards,breathe 4.8s cubic-bezier(.55,.05,.45,.95) 2.2s infinite}
    .meter span:after{animation:shimmer 6s cubic-bezier(.55,.05,.45,.95) 3s infinite}
    footer{animation-delay:1.2s}
  }
  @keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes breathe{0%,100%{transform:scaleX(1);opacity:1;box-shadow:0 0 18px color-mix(in srgb,var(--acc) 40%,transparent)}
    50%{transform:scaleX(.82);opacity:.7;box-shadow:0 0 6px color-mix(in srgb,var(--acc) 20%,transparent)}}
  @keyframes shimmer{0%{transform:translateX(-100%)}30%,100%{transform:translateX(100%)}}
</style></head>
<body>
<header><span class="name">${esc(name)}</span><svg class="two" viewBox="0 0 64 8" aria-hidden="true"><rect y="1" width="64" height="1.4" fill="currentColor"/><rect x="16" y="5.4" width="32" height="1" fill="currentColor"/></svg></header>
<main>${cue ? `<p class="cue">${esc(cue)}</p>` : ""}${headed(body)}<div class="meter" aria-hidden="true"><span></span></div></main>
<footer>${brand ? `<span>${esc(t(lang, "brand.note"))}</span>` : ""}<a href="https://thauma.one">thauma.one</a></footer>
</body></html>`;
}
