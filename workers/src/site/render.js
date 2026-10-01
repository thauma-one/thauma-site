/**
 * site/render.js — a partner site's page, as HTML
 *
 * Server-side, from two things: the site document (site/model.js, cleaned
 * when it was saved) and the ministry's published data (the same embed
 * payload every widget reads). The data-driven sections — timeline, goals,
 * prayer, videos — are the real widgets, handed that payload in the page so
 * they draw without a second request; the forms are the real sign-up and
 * contact embeds. A partner site is therefore Thauma's widgets arranged,
 * not a second copy of them.
 *
 * EVERY WORD IS ESCAPED HERE (esc), every link was checked when it was saved
 * (model.safeUrl) and is escaped again as an attribute. Nothing the owner
 * types becomes markup.
 *
 * THE LOOKS are three sets of CSS variables and fonts; the MOTION settings
 * are attributes on <html> that the CSS and the small script below read, all
 * of it switched off for anyone whose device asks for less motion.
 */
import { word, SECTIONS, plainOf } from "./model.js";
import { readable, onColor, alpha, luminance, companion, hexToHsl, hslToHex } from "../embed-colour.js";

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ----------------------------------------------------------------- looks -- */

const FONTS = {
  night: "family=Sora:wght@100;300;600&family=Inter:wght@300;400;600",
  paper: "family=Fraunces:opsz,wght@9..144,300;9..144,600&family=Manrope:wght@400;600;700",
  bold: "family=Manrope:wght@400;600;800",
  custom: "family=Sora:wght@100;300;600&family=Inter:wght@300;400;600",
};

/* Each look: surfaces, ink, fonts. `acc` fills (buttons, rules, the
   progress line); `ink` is the accent as TEXT, lightened where needed so it
   stays readable on the background. */
/** Two colors mixed: `t` of the way from a to b. */
function mix(a, b, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [n(a), n(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * ONE PALETTE FROM A BACKGROUND AND AN ACCENT: the background decides light
 * or dark, and the text, the quieter text, the raised bands and the lines
 * are mixed from it so they stay readable on it; the accent fills buttons
 * as chosen, only as much lighter or darker as it needs, and more so where
 * it is used as text.
 */
function paletteFrom(bg, accent, accent2) {
  const dark = luminance(bg) < 0.25;
  const fg = dark ? "#F2F3F5" : "#15171C";
  const acc = readable(accent, bg, 3), acc2 = readable(accent2, bg, 3);
  return {
    bg, fg,
    panel: mix(bg, fg, dark ? 0.07 : 0.04),
    dim: mix(fg, bg, 0.38),
    line: alpha(fg, dark ? 0.1 : 0.12),
    acc, acc2, ink: readable(accent, bg, 4.5), onAcc: onColor(acc),
    scheme: dark ? "dark" : "light",
    heroBg: `radial-gradient(120% 90% at 20% 10%, ${alpha(acc, .3)}, transparent 60%), radial-gradient(90% 80% at 90% 90%, ${alpha(acc2, .22)}, transparent 60%), ${bg}`,
  };
}

/**
 * THE LOOK A PAGE WEARS. The three presets keep their own colors (and the
 * ministry's accent); Custom is made from the owner's two colors, as both
 * a dark and a light version — the chosen background is one of them, the
 * other the same hue at the opposite end. `alt` carries the dark one when
 * visitors see whatever their device prefers.
 */
function looks(lookName, theme, colors = {}, mode = "auto") {
  if (lookName !== "custom") return baseLook(lookName, theme);
  const accent = colors.accent || theme.accent;
  const accent2 = colors.accent ? companion(colors.accent, -33) : theme.accent2;
  const base = colors.background || "#15171C";
  const hsl = hexToHsl(base) || { h: 220, s: 0.1, l: 0.1 };
  const baseDark = luminance(base) < 0.25;
  const other = baseDark ? hslToHex({ h: hsl.h, s: Math.min(hsl.s, 0.3), l: 0.96 })
                         : hslToHex({ h: hsl.h, s: Math.min(hsl.s, 0.25), l: 0.09 });
  const dark = paletteFrom(baseDark ? base : other, accent, accent2);
  const light = paletteFrom(baseDark ? other : base, accent, accent2);
  const type = baseLook("night", theme);
  if (mode === "dark") return { ...type, ...dark };
  if (mode === "light") return { ...type, ...light };
  return { ...type, ...light, alt: dark };
}

function baseLook(look, theme) {
  const acc = theme.accent, acc2 = theme.accent2;
  if (look === "paper") {
    const bg = "#F6F2EA";
    return { bg, panel: "#FFFDF8", fg: "#1A1C22", dim: "#5B5F68", line: "rgba(26,28,34,.12)",
      acc: readable(acc, bg, 4.5), acc2: readable(acc2, bg, 4.5), ink: readable(acc, bg, 4.5), onAcc: onColor(readable(acc, bg, 4.5)),
      display: "'Fraunces', Georgia, serif", body: "'Manrope', system-ui, sans-serif", thin: 300, boldW: 600, scheme: "light",
      heroBg: `linear-gradient(135deg, ${alpha(acc, .22)}, ${alpha(acc2, .18)})` };
  }
  if (look === "bold") {
    const bg = "#F4F4F1";
    return { bg, panel: "#FFFFFF", fg: "#0D0F12", dim: "#4F545C", line: "rgba(13,15,18,.12)",
      acc: readable(acc, bg, 4.5), acc2: readable(acc2, bg, 4.5), ink: readable(acc, bg, 4.5), onAcc: onColor(readable(acc, bg, 4.5)),
      display: "'Manrope', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif", thin: 800, boldW: 800, scheme: "light",
      heroBg: acc, heroFg: onColor(acc) };
  }
  const bg = "#0A0D12";
  return { bg, panel: "#10161E", fg: "#EDF2F8", dim: "#9AA6B6", line: "rgba(255,255,255,.09)",
    acc, acc2, ink: readable(acc, bg, 4.5), onAcc: onColor(acc),
    display: "'Sora', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", thin: 100, boldW: 600, scheme: "dark",
    heroBg: `radial-gradient(120% 90% at 20% 10%, ${alpha(acc, .35)}, transparent 60%), radial-gradient(90% 80% at 90% 90%, ${alpha(acc2, .28)}, transparent 60%), #0A0D12` };
}

function css(L, design) {
  return `
:root{--bg:${L.bg};--panel:${L.panel};--fg:${L.fg};--dim:${L.dim};--line:${L.line};--acc:${L.acc};--acc2:${L.acc2};--ink:${L.ink};--on-acc:${L.onAcc};--herobg:${L.heroBg};
--display:${L.display};--body:${L.body};--thin:${L.thin};--boldw:${L.boldW};color-scheme:${L.scheme}}
${L.alt ? `@media (prefers-color-scheme:dark){:root{--bg:${L.alt.bg};--panel:${L.alt.panel};--fg:${L.alt.fg};--dim:${L.alt.dim};--line:${L.alt.line};` +
  `--acc:${L.alt.acc};--acc2:${L.alt.acc2};--ink:${L.alt.ink};--on-acc:${L.alt.onAcc};--herobg:${L.alt.heroBg};color-scheme:dark}}` : ""}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 17px/1.65 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--ink)}img{max-width:100%;display:block}
.wrap{width:min(1120px,calc(100% - 48px));margin:0 auto}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;z-index:99;background:var(--panel);padding:8px 12px}
/* header */
.top{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:28px;min-height:68px}
.brand{font:var(--thin) 19px/1 var(--display);color:var(--fg);text-decoration:none;letter-spacing:.02em;white-space:nowrap}
.brand b{font-weight:var(--boldw)}.brand img{height:36px;width:auto}
.nav{display:flex;gap:22px;flex-wrap:wrap;margin-left:auto;align-items:center}
.nav a{color:var(--dim);text-decoration:none;font-size:15px}.nav a:hover,.nav a[aria-current]{color:var(--fg)}
.nav .givebtn{color:var(--on-acc);background:var(--acc);padding:8px 16px;border-radius:999px;font-weight:600}
html[data-menu="center"] .top .wrap{flex-direction:column;gap:10px;padding:16px 0}
html[data-menu="center"] .nav{margin:0 auto;justify-content:center}
.menubtn{display:none;margin-left:auto;background:none;border:1px solid var(--line);color:var(--fg);padding:9px 14px;border-radius:999px;font:600 14px var(--body)}
html[data-menu="button"] .menubtn{display:inline-block}
html[data-menu="button"] .nav{display:none}
html.menu-open .nav{display:flex;position:absolute;left:0;right:0;top:100%;flex-direction:column;align-items:flex-start;gap:14px;padding:22px 24px;background:var(--bg);border-bottom:1px solid var(--line)}
.langmenu{position:relative;flex:none}
.langmenu summary{list-style:none;display:inline-flex;align-items:center;gap:7px;cursor:pointer;font:600 13px var(--body);letter-spacing:.06em;
  color:var(--fg);padding:7px 12px;border:1px solid var(--line);border-radius:999px}
.langmenu summary::-webkit-details-marker{display:none}
.langmenu summary svg{width:10px;height:6px;transition:transform .2s ease}.langmenu[open] summary svg{transform:rotate(180deg)}
.langmenu summary:hover,.langmenu[open] summary{border-color:var(--acc)}
.langmenu ul{position:absolute;right:0;top:calc(100% + 8px);z-index:50;list-style:none;margin:0;padding:6px;min-width:170px;
  background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 40px -18px rgba(0,0,0,.45)}
.langmenu.up ul{top:auto;bottom:calc(100% + 8px)}
.langmenu a{display:block;padding:8px 12px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:15px}
.langmenu a:hover{background:color-mix(in srgb,var(--fg) 7%,transparent)}
.langmenu a[aria-current]{color:var(--ink);font-weight:600}
.foot-center .langmenu ul{right:auto;left:50%;transform:translateX(-50%)}
.headlinks{display:flex;gap:10px}
@media (max-width:820px){.menubtn{display:inline-block}.nav{display:none}.top .wrap{flex-direction:row!important;padding:0!important}}
html[data-menu="center"] .top .wrap{position:relative}
html[data-menu="center"] .top .langmenu{position:absolute;right:0;top:16px}
@media (max-width:820px){html[data-menu="center"] .top .langmenu{position:static}}
/* sections */
main section{padding:88px 0}
main section + section{border-top:1px solid var(--line)}
.h{font:var(--thin) clamp(30px,4.4vw,52px)/1.1 var(--display);margin:0 0 20px;letter-spacing:-.01em}
.h b{font-weight:var(--boldw)}
.kicker{font:600 12px var(--body);letter-spacing:.28em;text-transform:uppercase;color:var(--ink);margin:0 0 16px}
.lede{font-size:clamp(17px,1.6vw,20px);color:var(--dim);max-width:60ch;margin:0}
.prose p{margin:0 0 1em;max-width:68ch}.prose p:last-child{margin-bottom:0}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 24px;border-radius:999px;font:600 15px var(--body);text-decoration:none;border:1.5px solid var(--acc);color:var(--fg);transition:transform .25s ease,box-shadow .25s ease,background .25s ease}
.btn.solid{background:var(--acc);color:var(--on-acc)}
html[data-buttons="lift"] .btn:hover{transform:translateY(-2px)}
html[data-buttons="glow"] .btn:hover{box-shadow:0 0 0 6px color-mix(in srgb,var(--acc) 22%,transparent),0 10px 30px -8px var(--acc)}
/* hero */
/* The opening fills the first screen, under the header (Chase, 2026-09-29). */
.hero{position:relative;overflow:hidden;padding:0!important;min-height:calc(100svh - 69px);display:flex;align-items:center}
.hero .wrap{position:relative;padding:96px 0 120px}
.hero .h{font-size:clamp(40px,6.6vw,86px)}
.hero-media{position:absolute;inset:0;background:var(--herobg)}
.hero-media img{width:100%;height:112%;object-fit:cover;position:absolute;top:-6%}
.hero-behind .hero-media:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 20%,color-mix(in srgb,var(--bg) 88%,transparent) 88%)}
.hero-behind.has-photo{color:#fff}.hero-behind.has-photo .lede{color:rgba(255,255,255,.86)}.hero-behind.has-photo .btn:not(.solid){color:#fff}
${L.heroFg ? `.hero-behind:not(.has-photo),.hero-words{color:${L.heroFg}}.hero-behind:not(.has-photo) .lede,.hero-words .lede{color:${L.heroFg};opacity:.85}.hero-behind:not(.has-photo) .kicker,.hero-words .kicker{color:${L.heroFg}}
.hero-behind:not(.has-photo) .btn.solid,.hero-words .btn.solid{background:${L.heroFg};color:${L.heroBg}}.hero-behind:not(.has-photo) .btn,.hero-words .btn{border-color:${L.heroFg};color:${L.heroFg}}` : ""}
.hero-beside{align-items:center}.hero-beside .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:110px 0}
.hero-beside .hero-media{display:none}.hero-beside .pic{aspect-ratio:4/5;border-radius:18px;overflow:hidden}.hero-beside .pic img{width:100%;height:100%;object-fit:cover}
.hero-words{align-items:center;text-align:center;background:var(--herobg)}.hero-words .wrap{padding:130px 0 110px}.hero-words .lede{margin:0 auto}.hero-words .btns{justify-content:center}
/* the monogram opening — chaseroush.com's: initials behind the title, a short
   rule, a spaced line, a picture beside it, a cue to scroll */
.hero-monogram{align-items:center;background:var(--herobg)}
.hero-monogram .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:120px 0 150px}
.mono-words{position:relative}
.mono-mark{position:absolute;left:-.06em;top:50%;transform:translateY(-58%);font:700 clamp(150px,19vw,280px)/1 var(--display);color:var(--fg);opacity:.05;pointer-events:none;user-select:none;letter-spacing:-.04em;white-space:nowrap}
.hero-monogram .h{position:relative;font-size:clamp(44px,6vw,80px);line-height:1.08}
.rule{display:block;width:90px;height:2px;background:var(--acc);margin:30px 0 26px}
.spaced{font:400 13px/1.7 var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin:0;max-width:60ch}
.mono-pic img{width:100%;max-height:460px;object-fit:contain}
/* A slowly bouncing arrow, on every opening, until the visitor scrolls. */
.scrollcue{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;
  background:none;border:0;padding:0;color:var(--fg);opacity:.75;cursor:pointer;transition:opacity .5s ease;font:600 11px var(--body);letter-spacing:.22em;text-transform:uppercase}
.scrollcue span{padding-left:.22em}
.scrollcue svg{width:16px;height:44px;animation:cue 2.4s cubic-bezier(.55,.05,.45,.95) infinite}
.hero-behind.has-photo .scrollcue{color:#fff}
@keyframes cue{0%,100%{transform:translateY(0)}50%{transform:translateY(7px)}}
html.scrolled .scrollcue{opacity:0;pointer-events:none}
/* a section on a raised band */
main section.raised{background:var(--panel);border-top-color:transparent}
main section.raised + section{border-top-color:transparent}
/* a photo that opens something */
.piclink{display:block;height:100%;color:inherit}.piclink img{transition:transform .6s cubic-bezier(.16,1,.3,1)}
.piclink:hover img{transform:scale(1.03)}.piclink:focus-visible{outline:2px solid var(--acc);outline-offset:4px}
/* text, photo and words */
.text-center{text-align:center}.text-center .prose p{margin-left:auto;margin-right:auto}
.pt{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.pt-right .pt .pic{order:2}.pt-above .pt{grid-template-columns:1fr}
.pic{border-radius:16px;overflow:hidden;position:relative;background:var(--panel)}.pt .pic{aspect-ratio:4/3}
.pic img{width:100%;height:100%;object-fit:cover}
.fullphoto{padding:0!important}.fullphoto .frame{height:min(70vh,620px);overflow:hidden;position:relative}
.fullphoto img{position:absolute;left:0;width:100%;height:118%;top:-9%;object-fit:cover}
.fullphoto figcaption{font-size:13px;color:var(--dim);padding:10px 24px}
.quote blockquote{margin:0;font:var(--thin) clamp(26px,3.4vw,44px)/1.25 var(--display);max-width:26ch}
.quote-quiet blockquote{font-size:clamp(20px,2.2vw,28px);max-width:40ch}
.quote cite{display:block;margin-top:18px;font:600 13px var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--ink);font-style:normal}
/* bands */
.band{background:var(--panel)}
.bandrow{display:flex;gap:40px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:40px}
.news{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.news a{display:flex;justify-content:space-between;gap:20px;padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--fg);text-decoration:none}
.news a:hover{border-color:var(--acc)}.news small{color:var(--dim)}
.linklist{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.links-cards .linklist{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.linklist a{display:block;padding:20px 22px;background:var(--panel);border:1px solid var(--line);border-radius:14px;text-decoration:none;color:var(--fg)}
.linklist a:hover{border-color:var(--acc)}.linklist b{display:block}.linklist span{color:var(--dim);font-size:15px}
.linklist .lpic{display:block;aspect-ratio:16/10;margin:-20px -22px 16px;overflow:hidden;border-radius:13px 13px 0 0;background:var(--bg)}
.linklist .lpic img{width:100%;height:100%;object-fit:cover;transition:transform .6s cubic-bezier(.16,1,.3,1)}.linklist a:hover .lpic img{transform:scale(1.04)}
.data .lede{margin-bottom:28px}
.wanted{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;
  border:1.5px dashed var(--line);border-radius:inherit;color:var(--dim);font-size:14px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.pic:has(> .wanted){min-height:220px}.fullphoto .frame:has(> .wanted){height:min(50vh,420px)}
.fullphoto .caption{font-size:13px;color:var(--dim);padding:10px 24px;margin:0}
main section.empty{padding:40px 0}.empty p{margin:0;padding:22px;border:1px dashed var(--line);border-radius:12px;color:var(--dim);text-align:center;font-size:14px}
main section.is-editing{outline:2px solid var(--acc);outline-offset:-2px}
/* The ministry's widgets and lists, centered unless the owner puts them left. */
.al-center .h,.al-center .lede{text-align:center;margin-left:auto;margin-right:auto}
.al-center [data-thauma],.al-center .news,.al-center .linklist,.al-center .formbox,.al-center .latest{margin-left:auto;margin-right:auto}
.al-center .past{text-align:center}
.latest{display:block;max-width:720px;padding:28px 30px;background:var(--panel);border:1px solid var(--line);border-radius:16px;color:var(--fg);text-decoration:none}
.latest:hover{border-color:var(--acc)}.latest small{color:var(--dim);font-size:13px}
.latest b{display:block;font:var(--boldw) clamp(20px,2vw,26px)/1.25 var(--display);margin:6px 0 8px}.latest span{color:var(--dim)}
.latest em{display:inline-block;margin-top:14px;font-style:normal;font-weight:600;color:var(--ink)}
.past{margin:16px 0 0;font-size:14px}.past a{color:var(--dim)}.past a:hover{color:var(--fg)}
/* footer */
.foot{border-top:1px solid var(--line);padding:48px 0 60px;color:var(--dim);font-size:14px}
.foot .wrap{display:flex;gap:28px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start}
.foot .col{display:flex;flex-direction:column;gap:14px}.foot .col.end{align-items:flex-end}
.foot .tagline{margin:0;color:var(--fg)}
.foot .tagline.tagline-subtle{color:var(--dim)}.foot .tagline.tagline-accent{color:var(--ink)}
/* Its own row, the whole width. It had max-width:80ch, which capped the
   100% basis below the row's width, so it never wrapped: the small print sat
   beside the columns and squeezed them together (Chase, 2026-10-01). */
.foot .small{flex:1 0 100%;margin:0;font-size:12px;opacity:.75;max-width:none;text-wrap:pretty}
.foot .menu{display:flex;gap:10px 20px;flex-wrap:wrap}.foot .menu a,.foot .words a{color:var(--dim);text-decoration:none}
.foot .menu a:hover,.foot .words a:hover{color:var(--fg)}
.foot .words{display:flex;gap:10px 32px;flex-wrap:wrap}
.foot-center .wrap{flex-direction:column;align-items:center;text-align:center;gap:22px}
.foot-center .words,.foot-center .menu,.foot-center .socials{justify-content:center}
.foot-center .tagline{font:600 13px var(--body);letter-spacing:.2em;text-transform:uppercase;color:var(--dim)}
.foot-center .small{margin:0 auto}
/* Columns: only the columns that have something, spread across; the pages
   as a two-column grid rather than a long list; then a bar under a rule for
   the small print and the credit (Chase, 2026-10-01: with Pages on "It
   doesn't look good at all"). */
.foot-columns .wrap{display:block}
.foot-columns .cols{display:flex;gap:32px 64px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start}
.foot-columns .col:first-child{flex:1 1 220px;max-width:360px}
.foot-columns .menu{display:grid;grid-template-columns:repeat(2,auto);gap:10px 36px}
.foot-columns .words{flex-direction:column;gap:10px}
.foot-columns .bar{display:flex;gap:12px 24px;flex-wrap:wrap;justify-content:space-between;align-items:baseline;margin-top:40px;padding-top:20px;border-top:1px solid var(--line)}
.foot-columns .bar .small{flex:1 1 320px}
@media (max-width:820px){.foot .col.end{align-items:flex-start}}
.socials{display:flex;gap:12px;flex-wrap:wrap}.socials a{display:inline-flex;width:40px;height:40px;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:50%;color:var(--fg)}
.socials a:hover{border-color:var(--acc);color:var(--ink)}.socials svg{width:18px;height:18px}
.customlinks{display:flex;gap:16px;flex-wrap:wrap}.customlinks a{color:var(--fg)}
.powered{font-size:12px;opacity:.7}
body.only-foot .foot{border-top:0}
/* motion */
.progress{position:fixed;left:0;top:0;height:2px;width:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--acc),var(--acc2));z-index:40}
html[data-progress="off"] .progress{display:none}
.m{transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}
html[data-entrance="fade"] .m:not(.in){opacity:0}
html[data-entrance="rise"] .m:not(.in){opacity:0;transform:translateY(36px)}
html[data-entrance="slide"] .m:not(.in){opacity:0;transform:translateX(-40px)}
html[data-entrance="zoom"] .m:not(.in){opacity:0;transform:scale(.94)}
html[data-photos="zoom"] .kb img{animation:kb 18s ease-in-out infinite alternate}
@keyframes kb{from{transform:scale(1)}to{transform:scale(1.12)}}
.h .ch{display:inline-block;opacity:0;transform:translateY(.4em);transition:opacity .5s ease,transform .5s cubic-bezier(.16,1,.3,1)}
.h.in .ch{opacity:1;transform:none}
html[data-pages="fade"]{view-transition-name:root}
@view-transition{navigation:auto}
@media (prefers-reduced-motion:reduce){.m,.h .ch{opacity:1!important;transform:none!important;transition:none!important}
 .scrollcue svg{animation:none}
 .kb img{animation:none!important}.progress{display:none}.btn{transition:none}}
@media (max-width:820px){main section{padding:64px 0}.pt,.hero-beside .wrap,.hero-monogram .wrap{grid-template-columns:1fr;gap:28px}.pt-right .pt .pic{order:0}
 .hero .wrap{padding:110px 0 64px}.hero-monogram .wrap{padding:100px 0 130px}.mono-pic img{max-height:240px}.card{padding:26px}}
`;
}

/* ---------------------------------------------------------------- icons -- */

const ICON = {
  youtube: '<path d="M22 8.2s-.2-1.5-.8-2.1c-.8-.8-1.6-.8-2-.9C16.4 5 12 5 12 5s-4.4 0-7.2.2c-.4.1-1.2.1-2 .9-.6.6-.8 2.1-.8 2.1S2 9.9 2 11.6v1.6c0 1.7.2 3.4.2 3.4s.2 1.5.8 2.1c.8.8 1.8.8 2.2.9 1.6.2 6.8.2 6.8.2s4.4 0 7.2-.2c.4-.1 1.2-.1 2-.9.6-.6.8-2.1.8-2.1s.2-1.7.2-3.4v-1.6c0-1.7-.2-3.4-.2-3.4zM10 15V9l5.2 3L10 15z" fill="currentColor"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>',
  facebook: '<path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.3H7.6V13h2.7v8h3.2z" fill="currentColor"/>',
  x: '<path d="M17.7 3h3l-6.6 7.5L22 21h-6.1l-4.8-6.2L5.6 21h-3l7-8L2.5 3h6.2l4.3 5.7L17.7 3zm-1 16.2h1.7L7.8 4.7H6l10.7 14.5z" fill="currentColor"/>',
  tiktok: '<path d="M16.5 3c.4 2.2 1.8 3.6 4 3.8v3c-1.5 0-2.9-.4-4-1.2v6.2c0 3.4-2.6 5.7-5.7 5.7S5 18.2 5 15.1c0-3.3 2.8-5.8 6.2-5.6v3.1c-1.6-.3-3.1.8-3.1 2.5 0 1.4 1.1 2.6 2.6 2.6 1.6 0 2.7-1.1 2.7-3V3h3.1z" fill="currentColor"/>',
  linkedin: '<path d="M4.5 9h3v11h-3V9zm1.5-5a1.8 1.8 0 110 3.6A1.8 1.8 0 016 4zm4 5h2.9v1.5c.4-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.1 3.9 4.9V20h-3v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V20h-3V9z" fill="currentColor"/>',
  spotify: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9.6c3-1 6.6-.7 9.2.8M8 12.6c2.5-.7 5.3-.4 7.4.8M8.6 15.4c2-.5 4-.3 5.6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};
const SOCIAL_NAME = { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok",
  linkedin: "LinkedIn", spotify: "Spotify", email: "Email" };

/* -------------------------------------------------------------- helpers -- */

/** A field in this language, else the site's fallback language, else "". */
function wf(sec, lang, fallback, field) {
  const w = sec.words || {};
  return (w[lang] && w[lang][field]) || (w[fallback] && w[fallback][field]) || "";
}
/* Headings and words arrive already made safe (model.richClean: only <b>,
   <i>, <u> and checked <a href>, the rest escaped), so they are written as
   they are; `rich` only turns line breaks into <br> and a link to one of
   the site's own pages into its address. */
/**
 * A name's initials in any alphabet (Chase, 2026-10-01: "first and last
 * initial from any alphabet ... the Cyrillic works and even the croatian
 * alphabet"). Whole letters, not code units: a letter written with a
 * combining mark stays one letter, and Croatian's Dž, Lj and Nj are each one
 * letter of its alphabet, so Ljiljana Njegoš is "LjNj", not "LN". The first
 * and last word, or the one word there is.
 */
export function initialsOf(name) {
  const words = String(name || "").normalize("NFC").trim().split(/\s+/).filter(Boolean);
  const pick = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  const seg = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  return pick.map((w) => {
    const di = /^(d\u017e|lj|nj)/i.exec(w);
    if (di) return di[1][0].toLocaleUpperCase() + di[1].slice(1).toLocaleLowerCase();
    const first = seg ? (seg.segment(w)[Symbol.iterator]().next().value || {}).segment : Array.from(w)[0];
    return String(first || "").toLocaleUpperCase();
  }).join("");
}

/* The favicon when the owner has not chosen one: their initials in the
   site's own accent, as an SVG the browser draws at any size. */
function initialsIcon(name, L) {
  const ini = initialsOf(name);
  if (!ini) return "";
  const size = Array.from(ini).length > 2 ? 26 : 34;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${L.acc}"/>` +
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" fill="${L.onAcc}" ` +
    `font-family="${String(L.display).replace(/"/g, "'")}" font-weight="${L.boldW || 700}" font-size="${size}">${esc(ini)}</text></svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function heading(h, tag = "h2") {
  return h ? `<${tag} class="h m">${h}</${tag}>` : "";
}
function prose(html) {
  if (!html) return "";
  return `<div class="prose m">${html.split(/\n{2,}/).map((p) => `<p>${p}</p>`).join("")}</div>`;
}
function img(src, alt = "") {
  return src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : "";
}
/* Leaving the site opens nothing new, but tells the other site nothing. */
const rel = (href) => (/^https?:/.test(href) ? ' rel="noopener"' : "");

/* ------------------------------------------------------------- sections -- */

function renderSection(sec, ctx) {
  const { lang, fallback } = ctx;
  const raw = (f) => wf(sec, lang, fallback, f);
  const rich = (x) => String(x || "").replace(/href="page:([a-z]+)"/g, (m0, id) => `href="${esc(ctx.linkHref("page:" + id) || "#")}"`);
  /* Formatted fields come out ready for the page; plain ones are escaped where used. */
  const w = (f) => (f === "heading" || f === "quote") ? rich(raw(f)).replace(/\n/g, "<br>") : f === "text" ? rich(raw(f)) : raw(f);
  const inline = (x) => String(x || "").replace(/\n/g, "<br>");
  const photoMotion = ctx.design.motion.photos;
  /* Where this section sends a visitor: "" when nowhere, or when the page it
     names is switched off. */
  const to = ctx.linkHref(sec.link);
  const btnWords = w("button") || word(lang, "more");
  const button = (solid = true) => to ? `<a class="btn${solid ? " solid" : ""}" href="${esc(to)}"${rel(to)}>${esc(btnWords)} →</a>` : "";
  const pictured = (html, label) => to && html ? `<a class="piclink" href="${esc(to)}"${rel(to)} aria-label="${esc(label)}">${html}</a>` : html;
  const sub = w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : "";
  /* Where a photo is wanted and none is chosen yet, a preview shows the
     place for it, so the owner sees the page as it will be. Visitors never do. */
  const wanted = () => ctx.draft ? `<span class="wanted">${esc(word(lang, "photoWanted"))}</span>` : "";
  const cls = (...c) => {
    const k = [...c, sec.raised ? "raised" : "", sec.align ? "al-" + sec.align : ""].filter(Boolean).join(" ");
    return k ? ` class="${k}"` : "";
  };
  const widget = (kind, extra = "") =>
    `<div class="m" data-thauma="${esc(ctx.slug)}" data-widget="${kind}" data-lang="${esc(lang)}" data-theme="${ctx.widgetTheme}" data-foot="off"` +
    `${ctx.widgetAccent ? ` data-accent="${esc(ctx.widgetAccent)}"` : ""}${extra}></div>`;

  switch (sec.type) {
    case "hero": {
      const builtIn = (sec.buttons || []).map((b, i) => {
        /* Give goes to the giving page if the site has one — it says why —
           else straight to the giving link. */
        if (b === "give" && (ctx.pageOn("give") || ctx.giveUrl)) {
          return `<a class="btn${i === 0 ? " solid" : ""}" href="${esc(ctx.pageOn("give") ? ctx.href("give") : ctx.giveUrl)}">${esc(word(lang, "giveBtn"))}</a>`;
        }
        if (b === "stay" && ctx.pageOn("stay")) return `<a class="btn${i === 0 ? " solid" : ""}" href="${esc(ctx.href("stay"))}">${esc(ctx.label("stay"))}</a>`;
        if (b === "contact" && ctx.pageOn("contact")) return `<a class="btn${i === 0 ? " solid" : ""}" href="${esc(ctx.href("contact"))}">${esc(ctx.label("contact"))}</a>`;
        return "";
      }).join("");
      /* The owner's own button: solid only when it is the only one. */
      const btns = builtIn + button(!builtIn);
      /* "Scroll", over a line that ends in an arrow, pointing down (Chase,
         2026-10-01). */
      const cue = `<button type="button" class="scrollcue" aria-hidden="true" tabindex="-1"><span>${esc(word(lang, "scroll"))}</span>` +
        `<svg viewBox="0 0 16 44"><path d="M8 1v40M2.5 35.5L8 41l5.5-5.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
      if (sec.variant === "monogram") {
        const initials = initialsOf(ctx.name);
        const h = heading(w("heading"), "h1");
        return `<section class="hero hero-monogram"><div class="wrap"><div class="mono-words"><span class="mono-mark" aria-hidden="true">${esc(initials)}</span>` +
          `${w("kicker") ? `<p class="kicker m">${esc(w("kicker"))}</p>` : ""}${h}<span class="rule m" aria-hidden="true"></span>` +
          `${w("text") ? `<p class="spaced m">${inline(w("text"))}</p>` : ""}${btns ? `<div class="btns m">${btns}</div>` : ""}</div>` +
          `${sec.photo ? `<div class="mono-pic m">${img(sec.photo)}</div>` : ctx.draft ? `<div class="pic m">${wanted()}</div>` : ""}</div>` +
          `${cue}</section>`;
      }
      const words = `${w("kicker") ? `<p class="kicker m">${esc(w("kicker"))}</p>` : ""}${heading(w("heading"), "h1")}` +
        `${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}${btns ? `<div class="btns m">${btns}</div>` : ""}`;
      if (sec.variant === "beside") {
        return `<section class="hero hero-beside"><div class="wrap"><div>${words}</div>${sec.photo ? `<div class="pic m ${photoMotion === "zoom" ? "kb" : ""}">${img(sec.photo)}</div>` : ctx.draft ? `<div class="pic m">${wanted()}</div>` : ""}</div>${cue}</section>`;
      }
      if (sec.variant === "words") return `<section class="hero hero-words"><div class="wrap">${words}</div>${cue}</section>`;
      return `<section class="hero hero-behind${sec.photo ? " has-photo" : ""}"><div class="hero-media ${photoMotion === "zoom" ? "kb" : ""}"${photoMotion === "drift" ? " data-drift" : ""}>${img(sec.photo)}</div><div class="wrap">${words}</div>${cue}</section>`;
    }
    case "text":
      if (!w("heading") && !w("text")) return "";
      return `<section${cls(sec.variant === "center" ? "text-center" : "")}><div class="wrap">${heading(w("heading"))}${prose(w("text"))}${to ? `<div class="btns m">${button()}</div>` : ""}</div></section>`;
    case "photoText": {
      if (!sec.photo && !w("text") && !ctx.draft) return "";
      const pic = sec.photo ? img(sec.photo, plainOf(raw("heading"))) : wanted();
      return `<section${cls("pt-" + sec.variant)}><div class="wrap pt">${sec.photo || ctx.draft ? `<div class="pic m ${photoMotion === "zoom" && sec.photo ? "kb" : ""}">${sec.photo && sec.photoLink ? pictured(pic, btnWords) : pic}</div>` : ""}<div>${heading(w("heading"))}${prose(w("text"))}${to ? `<div class="btns m">${button()}</div>` : ""}</div></div></section>`;
    }
    case "photo":
      if (!sec.photo) {
        return ctx.draft ? `<section class="fullphoto"><div class="frame">${wanted()}</div>${w("caption") ? `<p class="wrap caption">${esc(w("caption"))}</p>` : ""}</section>` : "";
      }
      return `<section class="fullphoto"><figure style="margin:0"><div class="frame ${sec.variant === "zoom" ? "kb" : ""}"${sec.variant === "drift" ? " data-drift" : ""}>${pictured(img(sec.photo, w("caption")), w("caption") || word(lang, "more"))}</div>${w("caption") ? `<figcaption class="wrap">${esc(w("caption"))}</figcaption>` : ""}</figure></section>`;
    case "quote":
      if (!w("quote")) return "";
      return `<section${cls("quote", "quote-" + sec.variant)}><div class="wrap m"><blockquote>“${w("quote")}”</blockquote>${w("who") ? `<cite>${esc(w("who"))}</cite>` : ""}</div></section>`;
    case "timeline":
      if (!(ctx.payload.milestones || []).length) return "";
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${widget("roadmap", sec.variant === "condensed" ? ' data-style="condensed"' : "")}</div></section>`;
    case "goals":
      if (!(ctx.payload.goals || []).length) return "";
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${widget("goal")}</div></section>`;
    case "prayer":
      if (!(ctx.payload.prayer || []).length) return "";
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${widget("prayer")}</div></section>`;
    case "videos":
      if (!(ctx.payload.videos || []).length && !(ctx.payload.video_links || []).length) return "";
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${widget("videos")}</div></section>`;
    case "newsletters": {
      const list = (ctx.payload.mailings || []).filter((m) => m.url).slice(0, 12);
      if (!list.length) return "";
      const date = (d) => { try { return new Date(d).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" }); } catch { return String(d || "").slice(0, 10); } };
      if (sec.variant === "latest") {
        /* The newest, as a card; below it, quietly, the list's own archive. */
        const m = list[0];
        const archive = m.url.replace(/[^/]+\/?$/, "");
        return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}` +
          `<a class="latest m" href="${esc(m.url)}"><small>${esc(date(m.sent_at))}</small><b>${esc(m.subject)}</b>` +
          `${m.preheader ? `<span>${esc(m.preheader)}</span>` : ""}<em>${esc(word(lang, "readIt"))} →</em></a>` +
          `<p class="past m"><a href="${esc(archive)}">${esc(word(lang, "pastNews"))}</a></p></div></section>`;
      }
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}<ul class="news m">${list.map((m) =>
        `<li><a href="${esc(m.url)}"><span>${esc(m.subject)}</span><small>${esc(date(m.sent_at))}</small></a></li>`).join("")}</ul></div></section>`;
    }
    case "signup":
      ctx.needs.signup = true;
      return `<section${cls(sec.variant === "band" ? "band" : "")}><div class="wrap">${sec.variant === "card" ? '<div class="card">' : '<div class="bandrow">'}<div>${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}</div><div class="m" style="flex:1 1 360px;max-width:520px"><div data-thauma-form data-lang="${esc(lang)}"${ctx.formLook}></div></div></div></div></section>`;
    case "contact":
      ctx.needs.contact = true;
      return `<section${cls()}><div class="wrap">${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}<div class="m formbox" style="max-width:640px;margin-top:24px"><div data-thauma-contact data-lang="${esc(lang)}"${ctx.formLook}></div></div></div></section>`;
    case "give":
      if (!ctx.giveUrl) return "";
      return `<section${cls(sec.variant === "band" ? "band" : "")}><div class="wrap">${sec.variant === "card" ? '<div class="card">' : '<div class="bandrow">'}<div>${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}</div><div class="btns m" style="margin:0"><a class="btn solid" href="${esc(ctx.giveUrl)}">${esc(w("button") || word(lang, "giveBtn"))} →</a></div></div></div></section>`;
    case "links": {
      const items = (sec.items || []).map((it) => ({ ...it, href: ctx.linkHref(it.url) })).filter((it) => it.href);
      if (!items.length) return "";
      const t = (it, f) => (it.words[lang] && it.words[lang][f]) || (it.words[fallback] && it.words[fallback][f]) || "";
      return `<section${cls("links-" + sec.variant)}><div class="wrap">${heading(w("heading"))}${sub}<ul class="linklist m">${items.map((it) =>
        `<li><a href="${esc(it.href)}"${rel(it.href)}>${it.photo ? `<span class="lpic">${img(it.photo)}</span>` : ""}<b>${esc(t(it, "title") || it.href)}</b>${t(it, "text") ? `<span>${esc(t(it, "text"))}</span>` : ""}</a></li>`).join("")}</ul></div></section>`;
    }
    default:
      return "";
  }
}

/* ------------------------------------------------------------------ page -- */

/**
 * One page.
 *   doc      the site document (published, or the draft for a preview)
 *   site     { slug, display_name, giving_url, subdomain }
 *   payload  the ministry's embed payload (every part, not only the shared)
 *   theme    { accent, accent2 }
 *   lang, pageId
 *   base     the path the site sits under: "" at <name>.thauma.one,
 *            "/site/<name>" when opened from the console
 *   origin   where the widget and form scripts come from
 *   draft    true: a preview of what is not published yet
 */
export function renderPage({ doc, site, payload, theme, lang, pageId, base, origin, draft, only = null, langNames = {} }) {
  const fallback = doc.fallback;
  const design = doc.design;
  const L = looks(design.look, theme, design.colors || {}, design.mode);
  const pages = doc.pages.filter((p) => p.on);
  const page = doc.pages.find((p) => p.id === pageId);
  const label = (id) => {
    const p = doc.pages.find((x) => x.id === id) || {};
    return (p.label && (p.label[lang] || p.label[fallback])) || word(lang, id);
  };
  /* A preview stays a preview as it is clicked through. */
  const href = (id, l = lang) => `${base}/${l}/${id === "home" ? "" : id + "/"}${draft ? "?draft" : ""}`;
  const ctx = {
    lang, fallback, design, slug: site.slug, payload, needs: {}, draft,
    /* Widgets follow the page: light, dark, or — a Custom site that follows
       the visitor's device — the device too. */
    widgetTheme: L.alt ? "auto" : L.scheme === "dark" ? "dark" : "light",
    /* A Custom site's accent reaches the widgets; the ministry's otherwise. */
    widgetAccent: design.look === "custom" ? (design.colors || {}).accent || null : null,
    /* The sign-up and contact forms wear the SITE's colors, not the form's
       own embed colors (Chase, 2026-10-01: they "don't follow the color
       scheme of the designer"): its accent pair and its light or dark. */
    formLook: (() => {
      const own = design.look === "custom" && (design.colors || {}).accent;
      const a = own ? design.colors.accent : theme.accent, a2 = own ? companion(own, -33) : theme.accent2;
      return ` data-theme="${L.alt ? "auto" : L.scheme === "dark" ? "dark" : "light"}"` +
        (a ? ` data-accent="${esc(a)}"` : "") + (a2 ? ` data-accent2="${esc(a2)}"` : "");
    })(),
    giveUrl: doc.give || site.giving_url || "",
    pageOn: (id) => pages.some((p) => p.id === id),
    href, label, name: site.display_name || "",
    linkHref: (link) => {
      if (!link) return "";
      const m = /^page:([a-z]+)$/.exec(link);
      if (!m) return link;
      return pages.some((p) => p.id === m[1]) ? href(m[1]) : "";
    },
  };

  /* In a preview every section is there, even one with nothing to show yet
     — a Links section with no links, goals before any are published — so
     the owner can see it was added (Chase, 2026-09-29: the Links section
     "doesn't get added properly"). Each carries its id, for the editor to
     scroll to the one being edited. Visitors see neither. */
  const body = page.sections.map((s) => {
    const html = renderSection(s, ctx);
    if (!draft) return html;
    if (!html) {
      return `<section id="s-${esc(s.id)}" class="empty"><div class="wrap"><p>${esc(word(lang, "emptyPreview"))}</p></div></section>`;
    }
    return html.replace(/^<section/, `<section id="s-${esc(s.id)}"`);
  }).join("\n");
  const name = String(site.display_name || "").trim();
  const parts = name.split(/\s+/);
  const brand = design.brand === "logo" && design.logo
    ? `<img src="${esc(design.logo)}" alt="${esc(name)}">`
    : `${esc(parts[0] || "")}${parts.length > 1 ? " <b>" + esc(parts.slice(1).join(" ")) + "</b>" : ""}`;

  const nav = pages.filter((p) => p.id !== "give").map((p) =>
    `<a href="${esc(href(p.id))}"${p.id === pageId ? ' aria-current="page"' : ""}>${esc(label(p.id))}</a>`).join("");
  const give = ctx.pageOn("give") ? `<a class="givebtn" href="${esc(href("give"))}"${pageId === "give" ? ' aria-current="page"' : ""}>${esc(label("give"))}</a>` : "";
  /* THE LANGUAGE MENU IS ALWAYS A DROPDOWN (Chase, 2026-09-29: "Language
     selection should maintain the dropdown menu regardless"): the current
     language's code, opening to every language by its own name. Outside the
     page menu, so it stays on screen on a phone. <details>, so it opens
     without a script; the script only closes it on a click elsewhere. */
  const langMenu = (up) => doc.languages.length > 1
    ? `<details class="langmenu${up ? " up" : ""}"><summary aria-label="${esc(word(lang, "lang"))}">` +
      `<span>${esc(lang.toUpperCase())}</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary>` +
      `<ul>${doc.languages.map((l) =>
        `<li><a href="${esc(href(pageId, l))}" hreflang="${esc(l)}" lang="${esc(l)}"${l === lang ? ' aria-current="true"' : ""}>${esc(langNames[l] || l.toUpperCase())}</a></li>`).join("")}</ul></details>`
    : "";
  const socials = doc.links.filter((k) => k.kind !== "custom").map((k) =>
    `<a href="${esc(k.url)}" aria-label="${esc(SOCIAL_NAME[k.kind])}" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k.kind]}</svg></a>`).join("");
  /* The owner's own links may point at a page of the site, as a section's can. */
  const custom = doc.links.filter((k) => k.kind === "custom").map((k) => ({ ...k, href: ctx.linkHref(k.url) })).filter((k) => k.href).map((k) =>
    `<a href="${esc(k.href)}"${rel(k.href)}>${esc(k.label[lang] || k.label[fallback] || k.href)}</a>`).join("");
  const foot = footer({ doc, lang, fallback, name, pages, href, label, socials, custom });

  const title = pageId === "home" ? name : `${label(pageId)} · ${name}`;
  const desc = (() => {
    const hero = doc.pages[0].sections.find((s) => s.type === "hero");
    return hero ? plainOf(wf(hero, lang, fallback, "text")) : "";
  })();
  const alternates = doc.languages.map((l) => `<link rel="alternate" hreflang="${esc(l)}" href="${esc(href(pageId, l))}">`).join("");
  const m = design.motion;
  const widgets = /data-thauma="/.test(body);
  /* WHEN THE MENU FOLDS INTO ITS BUTTON: when this site's own menu would no
     longer fit on one line — worked out from its real labels, so a site with
     four short pages keeps its menu on a laptop and one with nine long ones
     folds before it wraps onto a second row. Estimated generously from the
     characters; a fold a little early beats a menu on two lines. */
  const chars = (t) => String(t).length * 8.2;
  const inMenu = pages.filter((p) => p.id !== "give");
  const menuW = (design.brand === "logo" ? 160 : chars(name) * 1.35) + 28 +
    inMenu.reduce((n, p) => n + chars(label(p.id)) + 22, 0) +
    (ctx.pageOn("give") ? chars(label("give")) + 60 : 0) +
    (doc.languages.length > 1 ? 96 : 0) +
    (design.headerLinks ? doc.links.filter((k) => k.kind !== "custom").length * 52 : 0) + 72;
  const fold = design.menu === "center" ? 820 : Math.max(820, Math.ceil(menuW / 10) * 10);

  return `<!doctype html>
<html lang="${esc(lang)}" data-menu="${esc(design.menu)}" data-entrance="${esc(m.entrance)}" data-photos="${esc(m.photos)}" data-headings="${esc(m.headings)}" data-buttons="${esc(m.buttons)}" data-pages="${esc(m.pages)}" data-progress="${esc(m.progress)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${design.favicon ? `<link rel="icon" href="${esc(design.favicon)}">` : initialsIcon(name, L) ? `<link rel="icon" type="image/svg+xml" href="${esc(initialsIcon(name, L))}">` : ""}
${desc ? `<meta name="description" content="${esc(desc)}">` : ""}
${draft ? '<meta name="robots" content="noindex">' : ""}
${alternates}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONTS[design.look]}&display=swap">
<style>${css(L, design)}
@media (max-width:${fold}px){.menubtn{display:inline-block}.nav{display:none}.top .wrap{flex-direction:row!important;padding:0!important}}</style>
</head>
<body${only ? ' class="only-foot"' : ""}>
${only === "footer" ? foot : `<a class="skip" href="#main">${esc(label(pageId))}</a>
<div class="progress" aria-hidden="true"></div>
${draft ? `<div style="background:#F5B845;color:#1a1200;font:600 13px system-ui;padding:8px 16px;text-align:center">Preview — not published yet</div>` : ""}
<header class="top"><div class="wrap">
<a class="brand" href="${esc(href("home"))}">${brand}</a>
<button class="menubtn" type="button" aria-expanded="false" aria-controls="sitenav">${esc(word(lang, "menu"))}</button>
<nav class="nav" id="sitenav">${nav}${give}${design.headerLinks && socials ? `<span class="socials headlinks">${socials}</span>` : ""}</nav>
${langMenu(false)}
</div></header>
<main id="main">
${body}
</main>
${foot}`}
${widgets ? `<script>window.__thaumaPreview=${JSON.stringify(payload).replace(/</g, "\\u003c")};</script><script src="${esc(origin)}/embed/v1/widget.js" async></script>` : ""}
${ctx.needs.signup ? `<script src="${esc(origin)}/embed/v1/${esc(site.slug)}/form.js" defer></script>` : ""}
${ctx.needs.contact ? `<script src="${esc(origin)}/embed/v1/${esc(site.slug)}/contact.js" defer></script>` : ""}
<script>${MOTION_JS}</script>
</body>
</html>`;
}

/**
 * The foot of the page, in the owner's chosen layout (model.FOOTERS). The
 * credit line is in every one of them.
 */
function footer({ doc, lang, fallback, name, pages, href, label, socials, custom }) {
  const F = doc.footer || { layout: "split", menu: false, socials: "icons", words: {} };
  const fw = (f) => (F.words[lang] && F.words[lang][f]) || (F.words[fallback] && F.words[fallback][f]) || "";
  const tagline = fw("tagline") ? `<p class="tagline tagline-${esc(F.tagline || "plain")}">${esc(fw("tagline"))}</p>` : "";
  const small = fw("small") ? `<p class="small">${esc(fw("small")).replace(/\n/g, "<br>")}</p>` : "";
  const menu = F.menu ? `<nav class="menu" aria-label="${esc(word(lang, "menu"))}">${pages.map((p) =>
    `<a href="${esc(href(p.id))}">${esc(label(p.id))}</a>`).join("")}</nav>` : "";
  /* Socials as names ("YouTube") sit in one line with the owner's own links,
     as chaseroush.com's do; as icons they are a row of their own. */
  const socialWords = doc.links.filter((k) => k.kind !== "custom").map((k) =>
    `<a href="${esc(k.url)}" rel="noopener">${esc(SOCIAL_NAME[k.kind])}</a>`).join("");
  const asWords = F.socials === "words";
  const linkRow = (asWords ? socialWords : "") + custom;
  const words = linkRow ? `<span class="words">${linkRow}</span>` : "";
  const icons = !asWords && socials ? `<span class="socials">${socials}</span>` : "";
  const credit = `<span class="powered">© ${new Date().getFullYear()} ${esc(name)} · ${esc(word(lang, "poweredBy"))}</span>`;
  /* NOT IN THE FOOTER (Chase, 2026-10-01): the name as a brand, and the
     language menu — both are already in the header. */
  let inner;
  if (F.layout === "center") {
    inner = `${menu}${words}${icons}${tagline}${small}${credit}`;
  } else if (F.layout === "columns") {
    const cols = [tagline, menu, words].filter(Boolean).map((x) => `<div class="col">${x}</div>`).join("") +
      (icons ? `<div class="col end">${icons}</div>` : "");
    inner = `<div class="cols">${cols}</div><div class="bar">${small}${credit}</div>`;
  } else {
    inner = `<div class="col">${tagline}${menu}${words}</div><div class="col end">${icons}${credit}</div>${small}`;
  }
  return `<footer class="foot foot-${esc(F.layout)}"><div class="wrap">${inner}</div></footer>`;
}

/* The motion script: menu, entrances, headings, drift, progress. Small, no
   dependencies, and it does nothing at all for reduced motion. */
const MOTION_JS = `(function(){
var d=document.documentElement,b=document.querySelector('.menubtn');
if(b)b.addEventListener('click',function(){var o=d.classList.toggle('menu-open');b.setAttribute('aria-expanded',o)});
var still=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
var hs=d.getAttribute('data-headings');
if(!still&&hs!=='plain'){[].forEach.call(document.querySelectorAll('.h'),function(h){
 var n=0;[].forEach.call(h.childNodes,function(c){var el=c.nodeType===3?null:c;var t=c.textContent;var parts=hs==='words'?t.split(/(\\s+)/):t.split('');
  var f=document.createDocumentFragment();parts.forEach(function(p){if(/^\\s+$/.test(p)||p===' '){f.appendChild(document.createTextNode(p));return}
   var s=document.createElement('span');s.className='ch';s.textContent=p;s.style.transitionDelay=(n++*(hs==='words'?60:22))+'ms';f.appendChild(s)});
  if(el){el.textContent='';el.appendChild(f)}else{h.replaceChild(f,c)}});
 h.classList.remove('m')})}
var io=('IntersectionObserver' in window)&&!still?new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'}):null;
[].forEach.call(document.querySelectorAll('.m,.h'),function(el){if(io)io.observe(el);else el.classList.add('in')});
var drift=!still&&d.getAttribute('data-photos')==='drift'?[].slice.call(document.querySelectorAll('[data-drift] img')):[];
var bar=document.querySelector('.progress'),tick=false;
function frame(){tick=false;var vh=innerHeight;
 drift.forEach(function(i){var r=i.parentNode.getBoundingClientRect();var p=((r.top+r.height/2)-vh/2)/(vh/2+r.height/2);p=Math.max(-1,Math.min(1,p));i.style.transform='translate3d(0,'+(-p*0.05*r.height).toFixed(1)+'px,0)'});
 if(bar&&!still){var m=document.documentElement.scrollHeight-vh;bar.style.transform='scaleX('+(m>0?scrollY/m:0)+')'}}
addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(frame)}d.classList.toggle('scrolled',scrollY>40)},{passive:true});frame();
document.addEventListener('click',function(e){[].forEach.call(document.querySelectorAll('details.langmenu[open]'),function(m){if(!m.contains(e.target))m.removeAttribute('open')})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')[].forEach.call(document.querySelectorAll('details.langmenu[open]'),function(m){m.removeAttribute('open')})});
var cue=document.querySelector('.scrollcue');if(cue)cue.addEventListener('click',function(){var n=cue.closest('section').nextElementSibling;if(n)n.scrollIntoView({behavior:still?'auto':'smooth'})});
})();`;

/** The two pages a visitor can hit that are not a page: not there, and not yet. */
export function simplePage(title, text, status = 404) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0D12;color:#EDF2F8;font:16px/1.6 system-ui;padding:24px;text-align:center}h1{font-weight:300;font-size:30px;margin:0 0 10px}p{color:#9AA6B6;margin:0}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export { SECTIONS };
