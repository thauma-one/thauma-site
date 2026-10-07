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
import { word, SECTIONS, plainOf, allSections } from "./model.js";
import { TONES, HEX_COLOR, SIZE_NAMES } from "../lib/tones.js";
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

/**
 * THE SITE'S GROUNDS, FOR ITS EMAIL (2026-10-07, Chase: "In dark mode, the
 * text body is using the wrong color background. It needs to change
 * depending on the color scheme"). A newsletter's dark letter is the site's
 * dark ground and panel, its light letter the site's light ones — Night,
 * Paper and Bold as they are, Custom from the owner's background — as plain
 * hexes, because a mail client cannot mix colors. A look with no dark (or no
 * light) version gets Night (or a plain light one).
 */
export function mailPalette(design, theme) {
  const d = design || {}, colors = d.colors || {};
  const L = looks(d.look || "night", theme, colors, "auto");
  /* a light letter's card is lighter than its ground, as paper on a desk;
     a dark one's is the site's raised panel */
  const one = (P) => ({ bg: P.bg, card: P.scheme === "dark" ? P.panel : mix(P.bg, "#FFFFFF", 0.75), ink: P.fg, dim: /^#/.test(P.dim) ? P.dim : mix(P.bg, P.fg, 0.62),
    line: mix(P.panel, P.fg, P.scheme === "dark" ? 0.12 : 0.1) });
  const night = baseLook("night", theme);
  if (d.look === "custom") return { light: one(L), dark: one(L.alt || L) };
  if (L.scheme === "light") return { light: one(L), dark: one(night) };
  return { light: null, dark: one(L) };
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

/* A BAND'S TWO COLORS (Chase, 2026-10-03). A Give or Sign-up band painted
   --panel, a 4-7% step that barely showed, and Raised painted the same
   --panel, so it changed nothing. A band is the page tinted with the
   ministry's accent; raised, the panel tinted more. */
const HEX = /^#[0-9A-Fa-f]{6}$/;
function bands(P) {
  if (!HEX.test(P.acc || "") || !HEX.test(P.bg || "") || !HEX.test(P.panel || "")) {
    return `--band:${P.panel};--band2:${P.panel};`;
  }
  return `--band:${mix(P.bg, P.acc, 0.1)};--band2:${mix(P.panel, P.acc, 0.18)};`;
}

/* The quick-pick text colors (lib/tones.js) as variables: each in the shade
   made for this ground, light or dark. */
function toneVars(scheme) {
  return Object.entries(TONES).map(([k, v]) => `--t-${k}:${v[scheme === "dark" ? 1 : 0]};`).join("");
}

/**
 * A formatted field's size and color spans (stored as meaning by
 * model.richClean) as the page draws them: a named size or tone as a class,
 * a picked #rrggbb inline. Nothing else of the attribute survives.
 */
export function styledSpans(html) {
  return String(html || "").replace(/<span\b([^>]*)>/g, (m0, attrs) => {
    const sz = /data-sz="([a-z]+|\d(?:\.\d{1,2})?|\d{1,3}(?:\.5)?px)"/.exec(attrs), c = /data-c="([^"]+)"/.exec(attrs);
    const cls = [], inl = [];
    if (sz && SIZE_NAMES.includes(sz[1])) cls.push("ts-" + sz[1]);
    else if (sz && /px$/.test(sz[1]) && +sz[1].slice(0, -2) >= 4 && +sz[1].slice(0, -2) <= 200) inl.push(`font-size:${+sz[1].slice(0, -2)}px`);
    else if (sz && +sz[1] >= 0.5 && +sz[1] <= 3) inl.push(`font-size:${+sz[1]}em`);
    if (c && HEX_COLOR.test(c[1])) inl.push(`color:${c[1].toLowerCase()}`);
    else if (c && (c[1] === "accent" || c[1] === "accent2" || c[1] === "dim" || TONES[c[1]])) cls.push("tc-" + c[1]);
    const style = inl.length ? ` style="${inl.join(";")}"` : "";
    return `<span${cls.length ? ` class="${cls.join(" ")}"` : ""}${style}>`;
  });
}

function css(L, design) {
  return `
:root{--bg:${L.bg};--panel:${L.panel};--fg:${L.fg};--dim:${L.dim};--line:${L.line};--acc:${L.acc};--acc2:${L.acc2};--ink:${L.ink};--on-acc:${L.onAcc};--herobg:${L.heroBg};${bands(L)}
--display:${L.display};--body:${L.body};--thin:${L.thin};--boldw:${L.boldW};${toneVars(L.scheme)}color-scheme:${L.scheme}}
${L.alt ? `@media (prefers-color-scheme:dark){:root{--bg:${L.alt.bg};--panel:${L.alt.panel};--fg:${L.alt.fg};--dim:${L.alt.dim};--line:${L.alt.line};` +
  `--acc:${L.alt.acc};--acc2:${L.alt.acc2};--ink:${L.alt.ink};--on-acc:${L.alt.onAcc};--herobg:${L.alt.heroBg};${bands(L.alt)}${toneVars("dark")}color-scheme:dark}}` : ""}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:400 17px/1.65 var(--body);-webkit-font-smoothing:antialiased}
a{color:var(--ink)}img{max-width:100%;display:block}
.wrap{width:min(1120px,calc(100% - 48px));margin:0 auto}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:16px;z-index:99;background:var(--panel);padding:8px 12px}
/* header */
.top{position:sticky;top:0;z-index:30;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;gap:28px;min-height:68px}
/* A button that jumps to a section lands it under the sticky header,
   gliding there only for a visitor who has not asked for less motion. */
main section[id]{scroll-margin-top:68px}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
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
/* THE NAVIGATION TAB (2026-10-04). The page you are on, its color, the line
   under the bar, the phone menu. Hover always lifts a name to the text color. */
html{--navtint:var(--fg)}html[data-navtint="accent"]{--navtint:var(--acc)}
.nav>a[aria-current]:not(.givebtn){color:var(--navtint)}
html[data-navcur="under"] .nav>a[aria-current]:not(.givebtn){border-bottom:2px solid var(--navtint);padding-bottom:2px}
html[data-navcur="grow"] .nav>a[aria-current]:not(.givebtn){color:var(--fg);position:relative}
/* "Growing underline" is thauma.one's: the current page's line pings (grows
   from the left, holds, shrinks to the right, rests) with a soft glow, and
   any other name draws a thin line in from the left on hover. */
html[data-navcur="grow"] .nav>a:not(.givebtn){position:relative}
html[data-navcur="grow"] .nav>a[aria-current]:not(.givebtn)::after{content:"";position:absolute;left:0;right:0;bottom:-7px;height:2px;background:var(--navtint);box-shadow:0 0 8px color-mix(in srgb,var(--navtint) 70%,transparent);transform-origin:left}
html[data-navcur="grow"] .nav>a:not(.givebtn):not([aria-current])::before{content:"";position:absolute;left:0;right:0;bottom:-7px;height:2px;background:var(--navtint);transform:scaleX(0);transform-origin:left;transition:transform .3s cubic-bezier(.16,1,.3,1)}
html[data-navcur="grow"] .nav>a:not(.givebtn):not([aria-current]):hover::before{transform:scaleX(1)}
html[data-navcur="pill"] .nav>a[aria-current]:not(.givebtn){color:var(--fg);background:color-mix(in srgb,var(--navtint) 18%,transparent);padding:6px 12px;margin:-6px -12px;border-radius:999px}
/* "Bold": the current name in heavier type, in the tint. "Dot below": a small
   lit dot under the current name, centered, with a soft glow. */
html[data-navcur="bold"] .nav>a[aria-current]:not(.givebtn){color:var(--navtint);font-weight:700}
html[data-navcur="dot"] .nav>a[aria-current]:not(.givebtn){color:var(--fg);position:relative}
html[data-navcur="dot"] .nav>a[aria-current]:not(.givebtn)::after{content:"";position:absolute;left:50%;bottom:-10px;width:5px;height:5px;margin-left:-2.5px;border-radius:50%;background:var(--navtint);box-shadow:0 0 8px color-mix(in srgb,var(--navtint) 70%,transparent)}
.nav>a:not(.givebtn):hover{color:var(--fg)}
html[data-navline="none"] .top{border-bottom-color:transparent}
html[data-navline="accent"] .top{border-bottom:2px solid var(--acc)}
.menubtn.burger{border:0;padding:10px;border-radius:8px;line-height:0}
.burger i{display:block;width:20px;height:2px;background:currentColor;border-radius:2px;transition:transform .25s,opacity .2s}
.burger i+i{margin-top:5px}
html.menu-open .burger i:nth-child(1){transform:translateY(7px) rotate(45deg)}
html.menu-open .burger i:nth-child(2){opacity:0}
html.menu-open .burger i:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
html[data-navphone="full"].menu-open .nav{height:calc(100dvh - 100%);box-sizing:border-box;justify-content:safe center;align-items:center;gap:16px;border:0;flex-wrap:nowrap;overflow-y:auto}

html[data-navphone="full"].menu-open .nav a{font-size:22px}
html[data-navphone="drawer"].menu-open .nav{left:auto;width:min(80vw,320px);height:calc(100dvh - 100%);box-sizing:border-box;border-bottom:0;border-left:1px solid var(--line);flex-wrap:nowrap;overflow-y:auto}
html[data-navphone="drawer"].menu-open .top::after{content:"";position:absolute;top:100%;left:0;right:0;height:calc(100dvh - 100%);background:rgba(0,0,0,.5);z-index:-1}
/* The language inside the phone menu looks like the desktop one — a small
   code-and-arrow pill opening a card — set apart below a line, so it never
   reads as one more page (Chase, 2026-10-04). */
.navlang{display:none;margin-top:8px;padding-top:18px;border-top:1px solid var(--line)}
.navlang summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:7px;font:600 13px var(--body);letter-spacing:.06em;color:var(--fg);padding:7px 12px;border:1px solid var(--line);border-radius:999px}
.navlang summary::-webkit-details-marker{display:none}
.navlang[open] summary{border-color:var(--acc)}
.navlang summary svg{width:10px;height:6px;transition:transform .2s}.navlang[open] summary svg{transform:rotate(180deg)}
.navlang ul{list-style:none;margin:10px 0 0;padding:6px;min-width:170px;width:max-content;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:12px}
.navlang a{display:block;padding:8px 12px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:15px}
.navlang a:hover{background:color-mix(in srgb,var(--fg) 7%,transparent)}.navlang a[aria-current]{color:var(--acc);font-weight:600}
html[data-navphone="full"] .navlang{text-align:center;width:min(100%,260px)}html[data-navphone="full"] .navlang ul{margin:10px auto 0}
@media (prefers-reduced-motion:no-preference){
 html[data-navcur="grow"] .nav>a[aria-current]:not(.givebtn)::after{animation:navping 3.318s cubic-bezier(.55,.05,.45,.95) infinite}
 html.menu-open:not([data-navphone="drawer"]) .nav{animation:navunfurl .45s cubic-bezier(.16,1,.3,1) both}
 html[data-navphone="drawer"].menu-open .nav{animation:navslide .4s cubic-bezier(.16,1,.3,1) both}
 .navlang[open] ul{animation:navunfurl .35s cubic-bezier(.16,1,.3,1) both}}
@keyframes navping{0%{transform:scaleX(0);transform-origin:left}37.97%{transform:scaleX(1);transform-origin:left}53.16%{transform:scaleX(1);transform-origin:left}54.43%{transform:scaleX(1);transform-origin:right}91.14%{transform:scaleX(0);transform-origin:right}100%{transform:scaleX(0);transform-origin:right}}
@keyframes navunfurl{from{clip-path:inset(0 0 100% 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes navslide{from{transform:translateX(100%)}to{transform:translateX(0)}}
/* sections */
main section{padding:88px 0}
main section + section{border-top:1px solid var(--line)}
.h{font:var(--thin) clamp(30px,4.4vw,52px)/1.1 var(--display);margin:0 0 20px;letter-spacing:-.01em}
.h b{font-weight:var(--boldw)}
/* Sizes and colors within formatted words (Chase, 2026-10-03), relative to
   the words around them, so a large word in a heading is larger still. */
.ts-sm{font-size:.82em}.ts-lg{font-size:1.25em}.ts-xl{font-size:1.6em}
.tc-accent{color:var(--ink)}.tc-accent2{color:var(--acc2)}.tc-dim{color:var(--dim)}
${Object.keys(TONES).map((k) => `.tc-${k}{color:var(--t-${k})}`).join("")}
/* NO FORCED CAPITALS on anything a person types (2026-10-07, Chase: "all editable text lines need to support lower case text. If they want it to be full capitalized or title case, it needs to be done manually"). Only built-in words (the scroll cue, a link's type) keep theirs. */
.kicker{font:600 12px var(--body);letter-spacing:.28em;color:var(--ink);margin:0 0 16px}
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
.hero-behind:not(.has-photo) .btn.solid,.hero-words .btn.solid{background:${L.heroFg};color:${L.heroBg}}.hero-behind:not(.has-photo) .rule,.hero-words .rule{background:${L.heroFg}}.hero-behind:not(.has-photo) .btn,.hero-words .btn{border-color:${L.heroFg};color:${L.heroFg}}` : ""}
.hero-beside{align-items:center}.hero-beside .wrap{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:110px 0}
.hero-beside .hero-media{display:none}.hero-beside .pic{aspect-ratio:4/5;border-radius:18px;overflow:hidden}.hero-beside .pic img{width:100%;height:100%;object-fit:cover}
.hero-words{align-items:center;background:var(--herobg)}.hero-words .wrap{padding:130px 0 110px}
/* the monogram opening — chaseroush.com's: initials behind the title, a short
   rule, a spaced line, a picture beside it, a cue to scroll */
.hero-monogram{align-items:center;background:var(--herobg)}
main section.hero.raised,main section.hero.raised .hero-media{background:var(--panel)}main section.hero.band,main section.hero.band .hero-media{background:var(--band)}
main section.fullphoto.raised{background:var(--panel)}main section.fullphoto.band{background:var(--band)}
.hero-monogram .wrap{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:120px 0 150px}
.mono-words{position:relative}
.mono-mark{position:absolute;left:-.06em;top:50%;transform:translateY(-58%);font:700 clamp(150px,19vw,280px)/1 var(--display);color:var(--fg);opacity:.05;pointer-events:none;user-select:none;letter-spacing:-.04em;white-space:nowrap}
.hero-monogram .h{position:relative;font-size:clamp(44px,6vw,80px);line-height:1.08}
.rule{display:block;width:90px;height:2px;background:var(--acc);margin:30px 0 26px}
.spaced{font:400 13px/1.7 var(--body);letter-spacing:.2em;color:var(--dim);margin:0;max-width:60ch}
.mono-pic img{width:100%;max-height:460px;object-fit:contain}
/* A slowly bouncing arrow, on every opening, until the visitor scrolls. */
.scrollcue{position:absolute;left:50%;bottom:2rem;margin-left:-40px;width:80px;display:flex;flex-direction:column;align-items:center;gap:6px;
  background:none;border:0;padding:0;color:var(--fg);cursor:pointer;transition:opacity .6s ease;font:600 11px var(--body);letter-spacing:.15em;text-transform:uppercase;
  animation:cue 2s ease-in-out infinite}
.scrollcue i{display:block;width:2px;height:32px;background:var(--acc);opacity:.9}
.scrollcue span{padding-left:.15em;opacity:.8}
/* Design › Motion › Scroll hint: the line and word (above), an arrow, a mouse, or none. */
.scrollcue .cue-arrow,.scrollcue .cue-mouse{display:none}
html[data-cue="none"] .scrollcue{display:none}
html[data-cue="arrow"] .scrollcue i,html[data-cue="arrow"] .scrollcue span,html[data-cue="mouse"] .scrollcue i,html[data-cue="mouse"] .scrollcue span{display:none}
html[data-cue="arrow"] .scrollcue .cue-arrow{display:block;width:30px;height:30px;opacity:.8}
html[data-cue="arrow"] .scrollcue{animation-name:cuedown}
html[data-cue="mouse"] .scrollcue{animation-name:none}
html[data-cue="mouse"] .scrollcue .cue-mouse{display:block;position:relative;width:22px;height:34px;border:1.6px solid currentColor;border-radius:12px;opacity:.75}
.cue-mouse em{position:absolute;left:50%;top:7px;width:3px;height:7px;margin-left:-1.5px;border-radius:2px;background:var(--acc);animation:wheel 1.8s ease-in-out infinite}
@keyframes cuedown{0%,100%{transform:translateY(0)}50%{transform:translateY(9px)}}
@keyframes wheel{0%{transform:translateY(0);opacity:1}70%{transform:translateY(10px);opacity:0}100%{transform:translateY(0);opacity:0}}
.hero-behind.has-photo .scrollcue{color:#fff}
@keyframes cue{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
html.scrolled .scrollcue{opacity:0;pointer-events:none}
/* a section on a raised band */
main section.raised{background:var(--panel);border-top-color:transparent}
main section.raised + section{border-top-color:transparent}
/* a photo that opens something */
.piclink{display:block;height:100%;color:inherit}.piclink img{transition:transform .6s cubic-bezier(.16,1,.3,1)}
.piclink:hover img{transform:scale(1.03)}.piclink:focus-visible{outline:2px solid var(--acc);outline-offset:4px}
/* text, photo and words */
.text-center{text-align:center}.text-center .prose p{margin-left:auto;margin-right:auto}
/* The button row is a flex box; text-align does not move it (Chase,
   2026-10-03: the button stayed left under centered words). */
.text-center .btns{justify-content:center}
.pt{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
/* A photo beside LONG words starts at their top and stays in view while they
   scroll past, rather than floating in the middle of a tall gap. */
.pt:has(.pic img){align-items:start}.pt .pic:has(img){position:sticky;top:96px}
.pt-right .pt .pic{order:2}.pt-above .pt{grid-template-columns:1fr}
.pic{border-radius:16px;overflow:hidden;position:relative;background:var(--panel)}.pt .pic{aspect-ratio:4/3}
.pic img{width:100%;height:100%;object-fit:cover}
/* PHOTO AND WORDS SHOWS THE WHOLE PHOTO (BACKLOG §3: "portrait photos must
   not be cut off; transparent photos must work"). The frame fits the photo
   rather than cropping it to 4:3, and drops its panel color, so a PNG's
   clear parts show the page. Until a photo is chosen the 4:3 placeholder stays. */
.pt .pic:has(img),.ptw .pic:has(img){aspect-ratio:auto;background:none;width:fit-content;max-width:100%;margin:0 auto}
.pt .pic img,.ptw .pic img{display:block;width:auto;max-width:100%;height:auto;max-height:640px;object-fit:contain}
/* wrapped: the words flow around the photo (chaseroush.com's About) */
.ptw{display:flow-root}
.ptw .pic{float:left;width:38%;max-width:380px;margin:6px 40px 18px 0}
.pt-wrapRight .ptw .pic{float:right;margin:6px 0 18px 40px}
.ptw .pic:has(img){width:38%;max-width:380px;margin:6px 40px 18px 0}
.pt-wrapRight .ptw .pic:has(img){margin:6px 0 18px 40px}
.ptw .pic:not(:has(img)){aspect-ratio:4/5}
.ptw .pic img{width:100%;max-height:none}
.ptw .prose p{max-width:none}
@media (max-width:760px){.ptw .pic,.ptw .pic:has(img),.pt-wrapRight .ptw .pic,.pt-wrapRight .ptw .pic:has(img){float:none;width:100%;max-width:none;margin:0 0 24px}}
.fullphoto{padding:0!important}.fullphoto .frame{height:min(70vh,620px);overflow:hidden;position:relative}
.fullphoto img{position:absolute;left:0;width:100%;height:118%;top:-9%;object-fit:cover}
.fullphoto figcaption{font-size:13px;color:var(--dim);padding:10px 24px}
.quote blockquote{margin:0;font:var(--thin) clamp(26px,3.4vw,44px)/1.25 var(--display);max-width:26ch}
.quote-quiet blockquote{font-size:clamp(20px,2.2vw,28px);max-width:40ch}
.quote cite{display:block;margin-top:18px;font:600 13px var(--body);letter-spacing:.2em;color:var(--ink);font-style:normal}
/* a verse inside Words or Photo and words, in three looks */
.verse{margin:28px 0}
/* The photo editor's crop window, corners, border and darkening. */
.pe-crop{position:relative;display:block;overflow:hidden;width:100%}
.pe-crop img{position:absolute;max-width:none;object-fit:fill}
.pe-soft{border-radius:12px}.pe-round{border-radius:28px}.pe-square{border-radius:0}
.pe-b-thin{box-shadow:0 0 0 1px var(--line)}.pe-b-accent{box-shadow:0 0 0 3px var(--acc)}
.pic:has(> .pe-crop),.pic:has(> .piclink > .pe-crop){aspect-ratio:auto;border-radius:0;overflow:visible;background:none}
.pe-dark{position:absolute;inset:0;background:#000;pointer-events:none}
/* A cropped photo fills its column; the uncropped-photo rules above (fit to
   the photo, capped at its width) would collapse it or undo the crop. */
.pt .pic:has(> .pe-crop),.ptw .pic:has(> .pe-crop),.pt .pic:has(> .piclink > .pe-crop){width:100%;max-width:560px}
.pic .pe-crop img,.pe-crop img{max-width:none!important;max-height:none!important}
/* A title's own alignment and its line (2026-10-04). */
.th-left{text-align:left}.th-left .h{margin-left:0;margin-right:auto}.th-left .rule{margin:14px auto 26px 0}
.th-center{text-align:center}.th-center .h{margin-left:auto;margin-right:auto}.th-center .rule{margin:14px auto 26px}
.th-right{text-align:right}.th-right .h{margin-left:auto;margin-right:0}.th-right .rule{margin:14px 0 26px auto}
.wrap>.th,.wrap>.h+.rule{margin-bottom:8px}
.verse blockquote{margin:0}
.verse figcaption{margin-top:12px;font:600 12px var(--body);letter-spacing:.2em;color:var(--ink)}
.verse-quote blockquote{font:var(--thin) clamp(22px,2.6vw,32px)/1.3 var(--display);max-width:32ch}
.verse-line{border-left:3px solid var(--acc);padding:4px 0 4px 22px}
.verse-line blockquote{font-size:clamp(17px,1.5vw,19px);line-height:1.7;max-width:60ch}
.verse-mark{text-align:center;max-width:46ch;margin-left:auto;margin-right:auto}
.verse-glyph{display:block;font:600 64px/0.6 var(--display);color:var(--acc);height:30px}
.verse-mark blockquote{font:italic var(--thin) clamp(19px,1.9vw,24px)/1.5 var(--display)}
.verse-mark figcaption::before{content:"";display:block;width:36px;height:1px;background:var(--acc);margin:0 auto 12px}
.al-right .verse-line{border-left:0;border-right:3px solid var(--acc);padding:4px 22px 4px 0}
.al-center .verse-quote blockquote,.al-center .verse-line blockquote{margin-left:auto;margin-right:auto}
/* THE HEADER: a page's title area, as chaseroush.com's page headers */
main section.phead{position:relative;overflow:hidden;padding:clamp(56px,8vw,112px) 0 clamp(40px,6vw,76px)}
.phead .wrap{position:relative;z-index:1}
.phead .h{margin:0}
/* nearer the title than the small print (2026-10-06): a title already leaves room under its letters */
.phead .rule{margin:14px 0 24px}
.phead.al-center .rule{margin-left:auto;margin-right:auto}.phead.al-right .rule{margin-left:auto}
.phead.al-center :is(.ph-label,.ph-sub,.h){text-align:center;margin-left:auto;margin-right:auto}
.phead.al-right :is(.ph-label,.ph-sub,.h){text-align:right;margin-left:auto}
.ph-label{font:600 13px var(--body);letter-spacing:.18em;color:var(--ink);margin:0 0 14px}
.ph-sub{font:400 14px/1.7 var(--body);letter-spacing:.08em;color:var(--dim);margin:0;max-width:60ch}
.phead:not(:has(.rule)) .ph-sub{margin-top:18px}
.ph-top::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--acc)}
.ph-mark{position:absolute;left:max(24px,calc((100% - 1120px) / 2));margin-left:-.055em;top:50%;transform:translateY(-46%);font:700 clamp(110px,17vw,250px)/1 var(--display);color:var(--fg);opacity:.05;white-space:nowrap;pointer-events:none;user-select:none;letter-spacing:-.03em;z-index:0}
/* the watermark's left side on the text's (2026-10-06, Chase: "needs to
   align with the text of the header so both left sides are aligned"): the
   column's own edge, less the letters' side bearing */
.phead.al-center .ph-mark{left:50%;margin-left:0;transform:translate(-50%,-46%)}.phead.al-right .ph-mark{left:auto;margin-left:0;right:max(24px,calc((100% - 1120px) / 2));margin-right:-.055em}

main section.ph-raised{background:var(--panel)}
main section.ph-tint{background:var(--band)}
main section.ph-accent{background:var(--acc);color:var(--on-acc)}
.ph-accent .ph-label,.ph-accent .ph-sub,.ph-accent .h{color:var(--on-acc)}
.ph-accent .rule,.ph-accent.ph-top::before{background:var(--on-acc)}
.ph-accent .ph-mark{color:var(--on-acc);opacity:.1}
main section.phead + section{border-top-color:transparent}
@media (max-width:760px){.ph-mark{font-size:clamp(80px,24vw,140px)}}
/* bands */
.band{background-color:var(--band)}main section.raised.band{background-color:var(--band2)}
.bandrow{display:flex;gap:40px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:40px}
/* On a raised band (the card color) a card takes the page color instead, so
   it never melts into the band (Chase, 2026-10-01). */
/* CARDS ON A RAISED OR TINTED GROUND, ALL OF THEM (2026-10-07, Chase: "check every section carefully and make sure that won't happen anymore anywhere. Same for Tint"): on Plain a card is the panel color; on Raised or Tint — both a ground of their own — it is the page color, so it never melts into the band. One rule for every card the sections draw; a picture slot inside a link card swaps the other way. */
main section:is(.raised,.band) :is(.card,.givepanel,.ccards li,.news a,.linklist a,.latest){background:var(--bg)}
main section:is(.raised,.band) .lpic{background:var(--panel)}
/* The sign-up card: as wide as a form wants, centered, not the whole column
   with the boxes pushed left (Chase, 2026-10-01: "extra wide with left
   alignment of the boxes"). */
.signcard{max-width:600px;margin:0 auto}
/* Side by side: the words take a third, the form the rest (chaseroush.com's
   contact page); the line under the words is the site's color. */
.split{display:grid;grid-template-columns:1fr 1.6fr;gap:64px;align-items:start}
.split .rule{margin:26px 0 0}
.al-right .split{direction:rtl}.al-right .split>*{direction:ltr}
.openform{max-width:720px;margin-top:28px}
.wideform{max-width:820px;margin-top:28px}
/* Give, as a card: the site's color along its top, the button beneath. */
.givecard{max-width:760px;padding:52px 56px;border-top:3px solid var(--acc)}
.givecard .lede{max-width:none}.givecard .btns{margin-top:28px}
.al-center .givecard{margin:0 auto}.al-right .givecard{margin-left:auto}
.gsplit{grid-template-columns:1.4fr 1fr;align-items:center}
.givepanel{display:flex;flex-direction:column;align-items:center;gap:22px;padding:44px 32px;border-radius:18px;background:var(--panel);border:1px solid var(--line)}
.givepanel .rule{margin:0}
.btn.big{padding:16px 34px;font-size:17px}
/* Spotlight: a block in the site's own color. */
.spot{padding:64px 56px;border-radius:22px;background:var(--acc);color:var(--on-acc)}
.spot .h,.spot .h b,.spot .lede{color:var(--on-acc)}
.spot .btns{margin-top:28px}
.spot .btn.solid{background:var(--on-acc);color:var(--acc);border-color:var(--on-acc)}
/* Custom Cards (chaseroush.com's Mission). */
.ccards{list-style:none;margin:36px 0 0;padding:0}
.ccards li{display:flex;gap:20px;align-items:flex-start;text-align:left;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:22px 24px}
.ccards h3{margin:2px 0 6px;font:600 19px var(--display);color:var(--fg)}
.ccards p{margin:0;color:var(--dim);line-height:1.65}
.cnum{flex:none;width:44px;height:44px;border-radius:50%;background:var(--acc);color:var(--on-acc);display:flex;align-items:center;justify-content:center;font:700 17px var(--body)}
/* A PAGE'S TABS (2026-10-06): joined (chaseroush.com's Give | Pray), pills,
   or an underline; the chosen one in the accent. */
main section.ptabs-bar{padding:28px 0 0}
.ptabs{display:flex;flex-wrap:wrap;gap:0}
.ptabs-bar.al-center .ptabs{justify-content:center}
.ptabs button{font:600 13px/1 var(--body);letter-spacing:.12em;padding:12px 30px;background:transparent;color:var(--dim);border:1px solid var(--line);cursor:pointer;transition:color .2s,border-color .2s,background .2s}
.ptabs button:hover{color:var(--fg);border-color:var(--acc)}
.ptabs button[aria-selected="true"]{background:var(--acc);border-color:var(--acc);color:var(--on-acc)}
.ptabs-joined .ptabs button+button{border-left:0}
.ptabs-joined .ptabs button:first-child{border-radius:8px 0 0 8px}.ptabs-joined .ptabs button:last-child{border-radius:0 8px 8px 0}
.ptabs-pills .ptabs{gap:10px}.ptabs-pills .ptabs button{border-radius:999px}
.ptabs-underline .ptabs{gap:28px;border-bottom:1px solid var(--line)}
.ptabs-underline .ptabs button{border:0;padding:12px 2px;margin-bottom:-1px;border-bottom:2px solid transparent}
.ptabs-underline .ptabs button[aria-selected="true"]{background:none;color:var(--fg);border-bottom-color:var(--acc)}
.ptab[hidden]{display:none}
/* CHASEROUSH.COM'S MISSION, closely (2026-10-06): each card a shade apart
   from its section (on a raised band, the page's color), lifting and
   lighting its border under the pointer — or, on a phone, the card nearest
   the middle of the screen (MOTION_JS, .is-near). Vertical stacks them,
   Horizontal sets them side by side; Lines draws a faint line between them
   that stops short of both. */
.ccards{color:var(--fg)}
.ccards li{position:relative;transition:transform .3s cubic-bezier(.16,1,.3,1),border-color .3s,box-shadow .3s}

.ccards li:hover,.ccards li.is-near{transform:translateY(-5px);border-color:var(--acc);box-shadow:0 10px 30px color-mix(in srgb,var(--acc) 20%,transparent)}
@media (prefers-reduced-motion:reduce){.ccards li{transition:none}.ccards li:hover,.ccards li.is-near{transform:none}}
.cards-vertical .ccards{max-width:800px;display:flex;flex-direction:column;gap:16px}
.cards-vertical.cards-lines .ccards{gap:40px}
.cards-vertical.cards-lines .ccards li+li::before{content:"";position:absolute;left:50%;top:-32px;width:2px;height:24px;margin-left:-1px;background:color-mix(in srgb,currentColor 22%,transparent)}
.cards-vertical.cards-lines .ccards.numbered li+li::before{left:45px}
.cards-horizontal .ccards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px}
.cards-horizontal .ccards li{flex-direction:column;gap:14px}
.cards-horizontal.cards-lines .ccards{gap:22px 40px}
.cards-horizontal.cards-lines .ccards li+li::before{content:"";position:absolute;left:-32px;top:50%;width:24px;height:2px;margin-top:-1px;background:color-mix(in srgb,currentColor 22%,transparent)}
@media (max-width:760px){.cards-horizontal.cards-lines .ccards{gap:40px}.cards-horizontal.cards-lines .ccards li+li::before{left:50%;top:-32px;width:2px;height:24px;margin:0 0 0 -1px}}
.al-center .cards-vertical .ccards,.cards-vertical.al-center .ccards{margin-left:auto;margin-right:auto}
.al-right .cards-vertical .ccards,.cards-vertical.al-right .ccards{margin-left:auto}
.signcard .signform{margin:22px auto 0;text-align:left}
.news{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.news a{display:flex;justify-content:space-between;gap:20px;padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--fg);text-decoration:none}
.news a:hover{border-color:var(--acc)}.news small{color:var(--dim)}
.linklist{list-style:none;margin:0;padding:0;display:grid;gap:12px}
.links-cards .linklist{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.linklist a{display:block;padding:20px 22px;background:var(--panel);border:1px solid var(--line);border-radius:14px;text-decoration:none;color:var(--fg)}
.linklist a:hover{border-color:var(--acc)}.linklist b{display:block}.linklist span{color:var(--dim);font-size:15px}
/* PICTURES KEPT QUIET (Chase: the photo "isn't subtle and distracts"): shown
   whole on a plain panel, never cropped edge to edge or zoomed on hover. */
.linklist .lpic{display:flex;align-items:center;justify-content:center;height:120px;margin:-20px -22px 16px;border-radius:13px 13px 0 0;background:var(--bg);border-bottom:1px solid var(--line)}
.linklist .lpic img{max-width:100%;max-height:100%;object-fit:contain;padding:18px;box-sizing:border-box}
/* Tiers and the type label (chaseroush.com Resources). */
.linklist a{position:relative}
/* The label sits level with the title, under any picture, and the title
   leaves room for it. */
.linklist a{--pich:0px}.linklist a:has(.lpic){--pich:136px}.lt-big a:has(.lpic){--pich:180px}
.linklist a:has(.ltype) b{padding-right:88px}
.ltype{position:absolute;top:calc(var(--pich) + 22px);right:20px;z-index:1;font:600 11px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--acc);font-style:normal}
.linklist.lt-big{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:20px;margin-bottom:20px}
.lt-big a{padding:24px 26px}.lt-big .lpic{height:160px;margin:-24px -26px 20px}.lt-big b{font-size:20px}
.linklist.lt-small{grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:20px}
.lt-small a{padding:14px 16px}.lt-small b{font-size:15px}.lt-small span{font-size:13px}
.data .lede{margin-bottom:28px}
.wanted{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;
  border:1.5px dashed var(--line);border-radius:inherit;color:var(--dim);font-size:14px;background:color-mix(in srgb,var(--fg) 4%,transparent)}
.pic:has(> .wanted){min-height:220px}.fullphoto .frame:has(> .wanted){height:min(50vh,420px)}
/* Height and the part kept in view (BACKLOG §3, 2026-10-04). */
.fullphoto img{object-position:50% var(--fy,50%)}
.fullphoto.h-short .frame{height:min(42vh,380px)}.fullphoto.h-tall .frame{height:min(92vh,880px)}
.fullphoto.h-whole .frame{height:auto}.fullphoto.h-whole img{position:static;height:auto;top:0}
/* A cropped band takes the crop's shape, edge to edge. */
.fullphoto .frame:has(> .pe-crop),.fullphoto .frame:has(> a > .pe-crop){height:auto}
.fullphoto .pe-crop img{top:auto}
.fullphoto .caption{font-size:13px;color:var(--dim);padding:10px 24px;margin:0}
main section.empty{padding:40px 0}.empty p{margin:0;padding:22px;border:1px dashed var(--line);border-radius:12px;color:var(--dim);text-align:center;font-size:14px}
main section.is-editing{outline:2px solid var(--acc);outline-offset:-2px}
/* The ministry's widgets and lists, centered unless the owner puts them left. */
.al-center .h,.al-center .lede{text-align:center;margin-left:auto;margin-right:auto}
.al-center [data-thauma],.al-center .news,.al-center .linklist,.al-center .formbox,.al-center .latest{margin-left:auto;margin-right:auto}
.al-center .past{text-align:center}
/* EVERY SECTION LINES UP (2026-10-03): left (as written), centered, right,
   or indented. The WORDS follow, and so do the buttons, a flex row that
   text-align alone never moves; a widget, list or form keeps its own inside
   and only moves as a block. */
.al-center :is(.kicker,.h,.lede,.prose,.spaced,.quote blockquote,cite,.caption,figcaption,.past){text-align:center}
.al-center :is(.h,.lede,.prose p,.spaced,.quote blockquote,.rule){margin-left:auto;margin-right:auto}
.al-center .btns{justify-content:center}
.al-center .bandrow{flex-direction:column;text-align:center}
.al-center .bandrow>*{width:100%}
.al-right :is(.kicker,.h,.lede,.prose,.spaced,.quote blockquote,cite,.caption,figcaption,.past){text-align:right}
.al-right :is(.h,.lede,.prose p,.spaced,.quote blockquote,.rule){margin-left:auto;margin-right:0}
.al-right .btns{justify-content:flex-end}
.al-right .bandrow{flex-direction:row-reverse}
.al-right :is([data-thauma],.news,.linklist,.formbox,.latest){margin-left:auto;margin-right:0}
.al-left .signcard{margin-left:0}.al-right .signcard{margin-right:0}
.al-indent>.wrap,.al-indent>figure>figcaption{padding-left:clamp(20px,9vw,140px)}
.al-indent .signcard{margin-left:0}
.latest{display:block;max-width:720px;padding:28px 30px;background:var(--panel);border:1px solid var(--line);border-radius:16px;color:var(--fg);text-decoration:none}
.latest:hover{border-color:var(--acc)}.latest small{color:var(--dim);font-size:13px}
.latest b{display:block;font:var(--boldw) clamp(20px,2vw,26px)/1.25 var(--display);margin:6px 0 8px}.latest span{color:var(--dim)}
.latest em{display:inline-block;margin-top:14px;font-style:normal;font-weight:600;color:var(--ink)}
.past{margin:16px 0 0;font-size:14px}.past a{color:var(--dim)}.past a:hover{color:var(--fg)}
.news-combined .latest{max-width:none;border-color:color-mix(in srgb,var(--acc) 45%,var(--line));box-shadow:inset 3px 0 0 var(--acc)}
.news-combined .news{margin-top:12px}
.news-combined .past{font-size:12.5px;letter-spacing:.06em;margin-top:18px}
/* footer */
.foot{border-top:1px solid var(--line);padding:48px 0 60px;color:var(--dim);font-size:14px}
.foot .wrap{display:flex;gap:28px;flex-wrap:wrap;justify-content:space-between;align-items:flex-start}
.foot .col{display:flex;flex-direction:column;gap:14px}.foot .col.end{align-items:flex-end}
.foot-on-raised{background:var(--panel)}
.foot-on-tint{background:linear-gradient(180deg,color-mix(in srgb,var(--acc) 10%,var(--bg)),color-mix(in srgb,var(--acc2) 7%,var(--bg)))}
.foot-noline{border-top:0}
.foot-compact{padding:28px 0 34px}.foot-roomy{padding:80px 0 96px}
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
/* No color here: the tagline's own choice (Standard / Subtle / Accent) sets
   it. This rule's var(--dim), equal in weight and later, made Standard look
   exactly like Subtle on Center (Chase, 2026-10-03). */
.foot-center .tagline{font:600 13px var(--body);letter-spacing:.2em;}
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
/* Under the tagline: a line of its own in the column, close to it. */
.foot .col .small{flex:none;margin-top:-6px}
@media (max-width:820px){.foot .col.end{align-items:flex-start}}
.socials{display:flex;gap:12px;flex-wrap:wrap}.socials a{display:inline-flex;width:40px;height:40px;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:50%;color:var(--fg)}
.socials a:hover{border-color:var(--acc);color:var(--ink)}.socials svg{width:18px;height:18px}
/* A site's own icon, quieted to sit with the line icons; full color on hover. */
.socials .favi img{width:18px;height:18px;border-radius:4px;filter:grayscale(1);opacity:.8;transition:filter .2s,opacity .2s}
.socials .favi:hover img{filter:none;opacity:1}
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
 .scrollcue,.cue-mouse em{animation:none}
 .kb img{animation:none!important}.progress{display:none}.btn{transition:none}}
@media (max-width:820px){.split,.gsplit{grid-template-columns:1fr;gap:28px}.al-right .split{direction:ltr}.givecard,.spot{padding:36px 26px}}
@media (max-width:820px){main section{padding:64px 0}.pt,.hero-beside .wrap,.hero-monogram .wrap{grid-template-columns:1fr;gap:28px}.pt .pic:has(img){position:static}.pt-right .pt .pic{order:0}
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
function initialsIcon(name, L, style = "filled") {
  const ini = initialsOf(name);
  if (!ini) return "";
  const size = Array.from(ini).length > 2 ? 26 : 34;
  /* "filled": the letters on an accent tile; "letters": accent letters on the
     site's own background (Chase, 2026-10-01). */
  const letters = style === "letters";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${letters ? L.bg : L.acc}"/>` +
    `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" fill="${letters ? L.acc : L.onAcc}" ` +
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
/* A photo as the photo editor left it (src/js/photo-editor.js). A crop is an
   exact window onto the ORIGINAL: a box of the crop's shape with the photo
   placed inside it, scaled and offset — no new image file. A point is
   object-position and zoom, for frames whose shape changes with the screen,
   with any darkening laid over it. `scale` (not transform) so the page's
   drift motion, which sets transform, still works. */
function edited(src, e, alt = "") {
  if (!src) return "";
  if (e && e.w) {
    const b = e.border && typeof e.border === "object" ? e.border : null;
    const cls = `pe-crop${e.corners ? " pe-" + e.corners : ""}${typeof e.border === "string" ? " pe-b-" + e.border : ""}`;
    const ring = b ? `;box-shadow:0 0 0 ${+b.w}px ${b.c === "subtle" ? "var(--line)" : b.c === "accent" ? "var(--acc)" : b.c === "accent2" ? "var(--acc2)" : esc(b.c)}` : "";
    return `<span class="${cls}" style="aspect-ratio:${+e.ar}${ring}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" ` +
      `style="width:${+(100 / e.w).toFixed(3)}%;height:auto;left:${+(-e.x / e.w * 100).toFixed(3)}%;top:${+(-e.y / e.h * 100).toFixed(3)}%">` +
      (e.darken ? `<i class="pe-dark" style="opacity:${+e.darken}"></i>` : "") + `</span>`;
  }
  if (e && e.fx != null) {
    return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" style="object-position:${+e.fx}% ${+e.fy}%;scale:${+e.zoom};transform-origin:${+e.fx}% ${+e.fy}%">` +
      (e.darken ? `<i class="pe-dark" style="opacity:${+e.darken}"></i>` : "");
  }
  return img(src, alt);
}
/* Leaving the site opens nothing new, but tells the other site nothing. */
const rel = (href) => (/^https?:/.test(href) ? ' rel="noopener"' : "");

/* ------------------------------------------------------------- sections -- */

function renderSection(sec, ctx) {
  const { lang, fallback } = ctx;
  const raw = (f) => wf(sec, lang, fallback, f);
  const rich = (x) => styledSpans(String(x || "").replace(/href="page:([a-z]+)"/g, (m0, id) => `href="${esc(ctx.linkHref("page:" + id) || "#")}"`));
  /* Formatted fields come out ready for the page; plain ones are escaped where used. */
  const w = (f) => (f === "heading" || f === "quote" || f === "verse") ? rich(raw(f)).replace(/\n/g, "<br>") : f === "text" ? rich(raw(f)) : raw(f);
  /* A VERSE inside Words or Photo and words (BACKLOG §3), in one of three
     looks: the Quote section's own (large, thin, quotation marks), plain
     words beside a line in the accent, or set apart with a large accent
     quotation mark above and the reference in small capitals. */
  const verse = () => {
    if (!w("verse")) return "";
    const st = sec.verseStyle || "quote";
    const text = st === "quote" ? `“${w("verse")}”` : w("verse");
    return `<figure class="verse verse-${st} m">${st === "mark" ? `<span class="verse-glyph" aria-hidden="true">“</span>` : ""}` +
      `<blockquote>${text}</blockquote>${raw("verseRef") ? `<figcaption>${esc(w("verseRef"))}</figcaption>` : ""}</figure>`;
  };
  /* The words with the verse among them (Chase, 2026-10-04: "how do we
     implement a verse that is in the middle of the section"): before them,
     after paragraph n, or after them all (the default). */
  const words = (text) => {
    const v = verse();
    if (!v) return prose(text);
    const paras = text ? text.split(/\n{2,}/) : [];
    const at = sec.versePos === "start" ? 0 : /^p\d+$/.test(sec.versePos || "") ? Math.min(+sec.versePos.slice(1), paras.length) : paras.length;
    const part = (a) => (a.length ? `<div class="prose m">${a.map((p) => `<p>${p}</p>`).join("")}</div>` : "");
    return part(paras.slice(0, at)) + v + part(paras.slice(at));
  };
  /* The title of a Words or Words-and-Photo section: its own alignment and,
     if asked, a short line in the site's color beneath it. */
  const head = () => {
    const h = heading(w("heading"));
    if (!h) return "";
    const line = sec.titleLine ? `<span class="rule m" aria-hidden="true"></span>` : "";
    return sec.titleAlign ? `<div class="th th-${sec.titleAlign}">${h}${line}</div>` : h + line;
  };
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
  /* Plain, Raised or Tint, for the sections that write their own class list
     (the opening, the header, a full-width photo): every section has the
     three now (2026-10-07, Chase: "All sections need those same options"). */
  const ground = (sec.raised ? " raised" : "") + (sec.tint ? " band" : "");
  const cls = (...c) => {
    const k = [...c, sec.raised ? "raised" : "", sec.tint ? "band" : "", sec.align ? "al-" + sec.align : ""].filter(Boolean).join(" ");
    return k ? ` class="${k}"` : "";
  };
  const widget = (kind, extra = "") =>
    `<div class="m" data-thauma="${esc(ctx.slug)}" data-widget="${kind}" data-lang="${esc(lang)}" data-theme="${ctx.widgetTheme}" data-foot="off"` +
    `${ctx.widgetAccent ? ` data-accent="${esc(ctx.widgetAccent)}"` : ""}${ctx.widgetLook(!!(sec.raised || sec.tint))}${extra}></div>`;

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
      /* As chaseroush.com's (Chase, 2026-10-01: "look at chaseroush.com home
         page to get a feel for what I'm actually wanting"): a short line in
         the accent over the word "Scroll", the two bobbing together. */
      /* Every kind is in the markup; html[data-cue] (Design › Motion) shows one. */
      const cue = !ctx.cueOn ? "" : `<button type="button" class="scrollcue" aria-hidden="true" tabindex="-1"><i></i>` +
        `<svg class="cue-arrow" viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
        `<b class="cue-mouse"><em></em></b><span>${esc(word(lang, "scroll"))}</span></button>`;
      /* THE LINE UNDER THE TITLE (Chase, 2026-10-03: "a splash of color",
         chaseroush.com's .hero-divider): a short rule in the accent. The
         monogram always had one, so it keeps it unless switched off; the
         other layouts show it only when switched on — a site saved before
         the option looks exactly as it did. New heroes start with it on. */
      const lined = sec.variant === "monogram" ? sec.divider !== false : sec.divider === true;
      const line = lined ? `<span class="rule m" aria-hidden="true"></span>` : "";
      if (sec.variant === "monogram") {
        const initials = initialsOf(ctx.name);
        const h = heading(w("heading"), "h1");
        return `<section class="hero hero-monogram al-${sec.align || "left"}${ground}"><div class="wrap"><div class="mono-words"><span class="mono-mark" aria-hidden="true">${esc(initials)}</span>` +
          `${w("kicker") ? `<p class="kicker m">${esc(w("kicker"))}</p>` : ""}${h}${line}` +
          `${w("text") ? `<p class="spaced m">${inline(w("text"))}</p>` : ""}${btns ? `<div class="btns m">${btns}</div>` : ""}</div>` +
          `${sec.photo ? `<div class="mono-pic m">${edited(sec.photo, sec.photoEdit)}</div>` : ctx.draft ? `<div class="pic m">${wanted()}</div>` : ""}</div>` +
          `${cue}</section>`;
      }
      const words = `${w("kicker") ? `<p class="kicker m">${esc(w("kicker"))}</p>` : ""}${heading(w("heading"), "h1")}${line}` +
        `${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}${btns ? `<div class="btns m">${btns}</div>` : ""}`;
      if (sec.variant === "beside") {
        return `<section class="hero hero-beside al-${sec.align || "left"}${ground}"><div class="wrap"><div>${words}</div>${sec.photo ? `<div class="pic m ${photoMotion === "zoom" ? "kb" : ""}">${edited(sec.photo, sec.photoEdit)}</div>` : ctx.draft ? `<div class="pic m">${wanted()}</div>` : ""}</div>${cue}</section>`;
      }
      if (sec.variant === "words") return `<section class="hero hero-words al-${sec.align || "center"}${ground}"><div class="wrap">${words}</div>${cue}</section>`;
      return `<section class="hero hero-behind al-${sec.align || "left"}${ground}${sec.photo ? " has-photo" : ""}"><div class="hero-media ${photoMotion === "zoom" ? "kb" : ""}"${photoMotion === "drift" ? " data-drift" : ""}>${edited(sec.photo, sec.photoEdit)}</div><div class="wrap">${words}</div>${cue}</section>`;
    }
    case "header": {
      /* A page's title area, chaseroush.com's page header made adjustable:
         small print above (label) and below (text), the line under the
         title, an accent line along the top, and a watermark behind whose
         words default to the page's own name. The page's h1. */
      if (!w("heading") && !w("label") && !ctx.draft) return "";
      const mark = sec.variant === "watermark"
        ? `<span class="ph-mark" aria-hidden="true">${esc(raw("mark") || ctx.label(ctx.pageId) || "")}</span>` : "";
      /* Its ground is the same Plain / Raised / Tint as every section's, plus
         the header's own Accent (bg); a header saved with bg raised or tint
         reads as that (model.js). */
      const hb = sec.bg === "accent" ? "accent" : sec.tint ? "tint" : sec.raised ? "raised" : "plain";
      const k = ["phead", "phead-" + sec.variant, "ph-" + hb, sec.topline !== false ? "ph-top" : "",
        hb === "raised" ? "raised" : "", hb === "tint" ? "band" : "", "al-" + (sec.align || "left")].filter(Boolean).join(" ");
      return `<section class="${k}">${mark}<div class="wrap">` +
        `${w("label") ? `<p class="ph-label m">${esc(w("label"))}</p>` : ""}${heading(w("heading"), "h1")}` +
        `${sec.divider !== false ? `<span class="rule m" aria-hidden="true"></span>` : ""}` +
        `${w("text") ? `<p class="ph-sub m">${inline(w("text"))}</p>` : ""}</div></section>`;
    }
    case "text":
      if (!w("heading") && !w("text") && !w("verse")) return "";
      return `<section${cls()}><div class="wrap">${head()}${words(w("text"))}${to ? `<div class="btns m">${button()}</div>` : ""}</div></section>`;
    case "photoText": {
      if (!sec.photo && !w("text") && !ctx.draft) return "";
      const pic = sec.photo ? edited(sec.photo, sec.photoEdit, plainOf(raw("heading"))) : wanted();
      const frame = sec.photo || ctx.draft ? `<div class="pic m ${photoMotion === "zoom" && sec.photo ? "kb" : ""}">${sec.photo && sec.photoLink ? pictured(pic, btnWords) : pic}</div>` : "";
      /* WRAPPED (chaseroush.com's About): the photo floats and the words
         flow around it; on a phone it sits above them, full width. */
      /* The title WITH the words (beside the photo, chaseroush.com's About)
         or ABOVE everything; wrapped layouts have always had it above. */
      const wrapped = sec.variant === "wrapLeft" || sec.variant === "wrapRight";
      const withWords = typeof sec.titleInline === "boolean" ? sec.titleInline : !wrapped;
      if (wrapped) {
        return `<section${cls("pt-wrap", "pt-" + sec.variant)}><div class="wrap">${withWords ? "" : head()}<div class="ptw">${frame}${withWords ? head() : ""}${words(w("text"))}</div>${to ? `<div class="btns m">${button()}</div>` : ""}</div></section>`;
      }
      return `<section${cls("pt-" + sec.variant)}><div class="wrap">${withWords ? "" : head()}<div class="pt">${frame}<div>${withWords ? head() : ""}${words(w("text"))}${to ? `<div class="btns m">${button()}</div>` : ""}</div></div></div></section>`;
    }
    case "photo":
      if (!sec.photo) {
        return ctx.draft ? `<section class="fullphoto al-${sec.align || "left"}${ground}"><div class="frame">${wanted()}</div>${w("caption") ? `<p class="wrap caption">${esc(w("caption"))}</p>` : ""}</section>` : "";
      }
      return `<section class="fullphoto h-${esc(sec.height || "medium")} al-${sec.align || "left"}${ground}" style="--fy:${Number.isFinite(sec.focusY) ? sec.focusY : 50}%"><figure style="margin:0"><div class="frame ${sec.variant === "zoom" ? "kb" : ""}"${sec.variant === "drift" && sec.height !== "whole" && !(sec.photoEdit && sec.photoEdit.w) ? " data-drift" : ""}>${pictured(edited(sec.photo, sec.photoEdit, w("caption")), w("caption") || word(lang, "more"))}</div>${w("caption") ? `<figcaption class="wrap">${esc(w("caption"))}</figcaption>` : ""}</figure></section>`;
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
    {
      /* The buttons follow the section's alignment and chosen style; the
         heading may be the newest video's title, its date above it. */
      const al = sec.align === "center" || sec.align === "right" ? sec.align : "";
      const extra = `${sec.linkStyle && sec.linkStyle !== "buttons" ? ` data-links="${esc(sec.linkStyle)}"` : ""}${al ? ` data-links-align="${al}"` : ""}`;
      const v = (ctx.payload.videos || [])[0];
      let head = heading(w("heading"));
      if (sec.titleFrom === "latest" && v && v.title) {
        let when = "";
        try { when = new Date(v.published_at).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); } catch { /* no date */ }
        /* The visitor's own day, as the video card below shows it: written
           in UTC here, then re-read in the browser's time zone. */
        head = `${when ? `<p class="kicker m"><time datetime="${esc(v.published_at)}" data-local>${esc(when)}</time></p>` : ""}<h2 class="h m">${esc(v.title)}</h2>`;
      }
      return `<section${cls("data")}><div class="wrap">${head}${sub}${widget("videos", extra)}</div></section>`;
    }
    case "newsletters": {
      const count = sec.count >= 3 && sec.count <= 12 ? sec.count : 5;
      const list = (ctx.payload.mailings || []).filter((m) => m.url && (!sec.list || (m.list && m.list.slug === sec.list))).slice(0, 12);
      if (!list.length) return "";
      const date = (d) => { try { return new Date(d).toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric" }); } catch { return String(d || "").slice(0, 10); } };
      /* the list's own archive, where every one of them is */
      const archive = list[0].url.replace(/[^/]+\/?$/, "");
      const card = (m) => `<a class="latest m" href="${esc(m.url)}"><small>${esc(date(m.sent_at))}</small><b>${esc(m.subject)}</b>` +
        `${m.preheader ? `<span>${esc(m.preheader)}</span>` : ""}<em>${esc(word(lang, "readIt"))} →</em></a>`;
      const rows = (ms) => `<ul class="news m">${ms.map((m) =>
        `<li><a href="${esc(m.url)}"><span>${esc(m.subject)}</span><small>${esc(date(m.sent_at))}</small></a></li>`).join("")}</ul>`;
      if (sec.variant === "latest") {
        /* The newest, as a card; below it, quietly, the list's own archive. */
        return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${card(list[0])}` +
          `<p class="past m"><a href="${esc(archive)}">${esc(word(lang, "pastNews"))}</a></p></div></section>`;
      }
      if (sec.variant === "combined") {
        /* NEWEST AND THE REST (2026-10-06, Chase: "a combined look where the
           newest one can be highlighted special, but it lists the last 3-5
           updates underneath it … with an option to 'See All Updates' at the
           bottom in small subtle print") */
        return `<section${cls("data", "news-combined")}><div class="wrap">${heading(w("heading"))}${sub}${card(list[0])}` +
          `${list.length > 1 ? rows(list.slice(1, count)) : ""}` +
          `<p class="past m"><a href="${esc(archive)}">${esc(word(lang, "allUpdates"))}</a></p></div></section>`;
      }
      return `<section${cls("data")}><div class="wrap">${heading(w("heading"))}${sub}${rows(list.slice(0, count))}` +
        `${list.length > count ? `<p class="past m"><a href="${esc(archive)}">${esc(word(lang, "allUpdates"))}</a></p>` : ""}</div></section>`;
    }
    case "signup":
      ctx.needs.signup = true;
      /* Words beside the form (chaseroush.com's contact page), or the form
         straight on the page with no card of its own. */
      if (sec.variant === "split") {
        return `<section${cls("fsplit")}><div class="wrap"><div class="split"><div>${heading(w("heading"))}${sub}<span class="rule m" aria-hidden="true"></span></div>` +
          `<div class="m"><div data-thauma-form data-lang="${esc(lang)}"${ctx.formLook(false, !!(sec.raised || sec.tint))}></div></div></div></div></section>`;
      }
      if (sec.variant === "open") {
        return `<section${cls()}><div class="wrap">${heading(w("heading"))}${sub}<div class="m formbox openform"><div data-thauma-form data-lang="${esc(lang)}"${ctx.formLook(true, !!(sec.raised || sec.tint))}></div></div></div></section>`;
      }
      return `<section${cls()}><div class="wrap">${sec.variant === "card" ? '<div class="card signcard">' : '<div class="bandrow">'}<div>${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}</div><div class="m${sec.variant === "card" ? " signform" : ""}" style="flex:1 1 360px;max-width:${sec.variant === "card" ? "100%" : "460px"}"><div data-thauma-form data-lang="${esc(lang)}"${ctx.formLook(sec.variant === "card", !!(sec.raised || sec.tint))}></div></div></div></div></section>`;
    case "contact":
      ctx.needs.contact = true;
      /* "The card is really skinny on a desktop" (Chase, 2026-10-03): Side
         by side gives the form most of the width, as chaseroush.com does;
         Wide widens the card; Open drops the card. Form stays the original. */
      if (sec.variant === "split") {
        return `<section${cls("fsplit csplit")}><div class="wrap"><div class="split"><div>${heading(w("heading"))}${sub}<span class="rule m" aria-hidden="true"></span></div>` +
          `<div class="m"><div data-thauma-contact data-lang="${esc(lang)}"${ctx.formLook(false, !!(sec.raised || sec.tint))}></div></div></div></div></section>`;
      }
      if (sec.variant === "wide" || sec.variant === "open") {
        return `<section${cls()}><div class="wrap">${heading(w("heading"))}${sub}<div class="m formbox ${sec.variant === "wide" ? "wideform" : "openform"}"><div data-thauma-contact data-lang="${esc(lang)}"${ctx.formLook(sec.variant === "open", !!(sec.raised || sec.tint))}></div></div></div></section>`;
      }
      return `<section${cls()}><div class="wrap">${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}<div class="m formbox" style="max-width:560px;margin-top:24px"><div data-thauma-contact data-lang="${esc(lang)}"${ctx.formLook(false, !!(sec.raised || sec.tint))}></div></div></div></section>`;
    case "give": {
      if (!ctx.giveUrl) return "";
      const giveBtn = (big) => `<a class="btn solid${big ? " big" : ""}" href="${esc(ctx.giveUrl)}">${esc(w("button") || word(lang, "giveBtn"))} →</a>`;
      /* The card, redone (Chase, 2026-10-03: it "just doesn't look good"):
         a panel with a line of the site's color along its top, the words
         and then the button beneath them, not squeezed beside them. */
      if (sec.variant === "card") {
        return `<section${cls()}><div class="wrap"><div class="card givecard m">${heading(w("heading"))}${sub}<div class="btns">${giveBtn(true)}</div></div></div></section>`;
      }
      if (sec.variant === "split") {
        return `<section${cls("fsplit")}><div class="wrap"><div class="split gsplit"><div>${heading(w("heading"))}${sub}</div>` +
          `<div class="m givepanel"><span class="rule" aria-hidden="true"></span>${giveBtn(true)}</div></div></div></section>`;
      }
      if (sec.variant === "spotlight") {
        return `<section${cls()}><div class="wrap"><div class="spot m">${heading(w("heading"))}${sub}<div class="btns">${giveBtn(true)}</div></div></div></section>`;
      }
      return `<section${cls()}><div class="wrap">${sec.variant === "card" ? '<div class="card">' : '<div class="bandrow">'}<div>${heading(w("heading"))}${w("text") ? `<p class="lede m">${inline(w("text"))}</p>` : ""}</div><div class="btns m" style="margin:0"><a class="btn solid" href="${esc(ctx.giveUrl)}">${esc(w("button") || word(lang, "giveBtn"))} →</a></div></div></div></section>`;
    }
    case "cards": {
      /* chaseroush.com's Mission: numbered cards joined by a line between
         the numbers (Attached), or side by side as separate cards. */
      const t = (it, f) => (it.words[lang] && it.words[lang][f]) || (it.words[fallback] && it.words[fallback][f]) || "";
      const items = (sec.items || []).filter((it) => t(it, "title") || t(it, "text"));
      if (!items.length) return "";
      const num = sec.numbers !== false;
      /* direction and lines; a section saved before them reads as it looked */
      const dir = sec.variant === "detached" || sec.variant === "horizontal" ? "horizontal" : "vertical";
      const lines = typeof sec.lines === "boolean" ? sec.lines : dir === "vertical";
      return `<section${cls("cards-" + dir, lines ? "cards-lines" : "")}><div class="wrap">${heading(w("heading"))}${sub}<ol class="ccards m${num ? " numbered" : ""}">${items.map((it, i) =>
        `<li>${num ? `<span class="cnum" aria-hidden="true">${i + 1}</span>` : ""}<div>${t(it, "title") ? `<h3>${esc(t(it, "title"))}</h3>` : ""}${t(it, "text") ? `<p>${inline(esc(t(it, "text")))}</p>` : ""}</div></li>`).join("")}</ol></div></section>`;
    }
    case "links": {
      const items = (sec.items || []).map((it) => ({ ...it, href: ctx.linkHref(it.url) })).filter((it) => it.href);
      if (!items.length) return "";
      const t = (it, f) => (it.words[lang] && it.words[lang][f]) || (it.words[fallback] && it.words[fallback][f]) || "";
      /* Large first, then the section's own style, then Small; each keeps
         the owner's order. Small cards carry no picture. */
      const card = (it, pic) => `<li><a href="${esc(it.href)}"${rel(it.href)}>${t(it, "type") ? `<em class="ltype">${esc(t(it, "type"))}</em>` : ""}` +
        `${pic && it.photo ? `<span class="lpic">${img(it.photo)}</span>` : ""}<b>${esc(t(it, "title") || it.href)}</b>${t(it, "text") ? `<span>${esc(t(it, "text"))}</span>` : ""}</a></li>`;
      const group = (tier, cls2, pic) => {
        const g = items.filter((it) => (it.tier || "std") === tier);
        return g.length ? `<ul class="linklist m${cls2}">${g.map((it) => card(it, pic)).join("")}</ul>` : "";
      };
      return `<section${cls("links-" + sec.variant)}><div class="wrap">${heading(w("heading"))}${sub}` +
        `${group("big", " lt-big", true)}${group("std", "", true)}${group("small", " lt-small", false)}</div></section>`;
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
  const navOpt = design.nav || {};
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
    lang, fallback, design, slug: site.slug, payload, needs: {}, draft, pageId,
    /* This page's own say over the opening's scroll indicator. */
    cueOn: !page || page.cue !== false,
    /* Widgets follow the page: light, dark, or — a Custom site that follows
       the visitor's device — the device too. */
    widgetTheme: L.alt ? "auto" : L.scheme === "dark" ? "dark" : "light",
    /* A Custom site's accent reaches the widgets; the ministry's otherwise. */
    widgetAccent: design.look === "custom" ? (design.colors || {}).accent || null : null,
    /* The widgets' cards, dropdowns and panels in the site's colors (Chase,
       2026-10-01): bg is the CARD — the site's card color on a plain band,
       the page color on a raised one (which is the card color), so cards
       never melt into the band they sit on. */
    widgetLook: (raised) => {
      const w = (P) => ({ bg: raised ? P.bg : P.panel, panel: raised ? P.panel : P.bg, fg: P.fg, dim: P.dim,
        line: P.line, track: P.line, font: P.body });
      return ` data-look="${esc(JSON.stringify({ ...(L.alt ? { ...w(L), dark: w(L.alt) } : w(L)), display: L.display }))}"`;
    },
    /* The sign-up and contact forms wear the SITE's colors, not the form's
       own embed colors (Chase, 2026-10-01: they "don't follow the color
       scheme of the designer"): its accent pair and its light or dark. */
    formLook: (() => {
      const own = design.look === "custom" && (design.colors || {}).accent;
      const a = own ? design.colors.accent : theme.accent, a2 = own ? companion(own, -33) : theme.accent2;
      /* And the site's own card, fields, lines and type (data-look,
         lib/embed-form.js LOOK_JS), so the form looks like part of the page
         rather than a box dropped onto it — for both schemes when the site
         follows the visitor's device. On a RAISED band (which is the site's
         card color) the card and its fields swap, so it stands apart. */
      const look = (P, raised) => ({ bg: P.bg, fg: P.fg, dim: P.dim, line: P.line,
        panel: raised ? P.bg : P.panel, field: raised ? P.panel : P.bg, font: P.body });
      return (flat, raised) => {
        /* The section's heading already names the form, so it has no title
           of its own here; its words are in the site's display face. */
        const both = { ...(L.alt ? { ...look(L, raised), dark: look(L.alt, raised) } : look(L, raised)),
          display: L.display, notitle: true, ...(flat ? { flat: true } : {}) };
        return ` data-theme="${L.alt ? "auto" : L.scheme === "dark" ? "dark" : "light"}"` +
          (a ? ` data-accent="${esc(a)}"` : "") + (a2 ? ` data-accent2="${esc(a2)}"` : "") +
          ` data-look="${esc(JSON.stringify(both))}"`;
      };
    })(),
    giveUrl: doc.give || site.giving_url || "",
    pageOn: (id) => pages.some((p) => p.id === id),
    href, label, name: site.display_name || "",
    linkHref: (link) => {
      if (!link) return "";
      /* A section of THIS page: its anchor, or nowhere once it is gone. */
      const sec = /^section:([a-z0-9]{2,24})$/i.exec(link);
      if (sec) return allSections(page).some((s) => s.id === sec[1]) ? "#s-" + sec[1] : "";
      const m = /^page:([a-z]+)$/.exec(link);
      if (!m) return link;
      return pages.some((p) => p.id === m[1]) ? href(m[1]) : "";
    },
  };

  /* In a preview every section is there, even one with nothing to show yet
     — a Links section with no links, goals before any are published — so
     the owner can see it was added (Chase, 2026-09-29: the Links section
     "doesn't get added properly"). Visitors never see an empty one. Every
     section carries its id: the editor scrolls to the one being edited, and
     a button can jump to it (section:<id>). */
  const drawn = (list) => list.map((s) => {
    const html = renderSection(s, ctx);
    if (!html) {
      return draft ? `<section id="s-${esc(s.id)}" class="empty"><div class="wrap"><p>${esc(word(lang, "emptyPreview"))}</p></div></section>` : "";
    }
    return html.replace(/^<section([^>]*)>/, `<section$1 id="s-${esc(s.id)}">`);
  }).join("\n");
  /* THE PAGE'S TABS: its own sections, then the bar, then a panel per tab,
     the first one showing (a #tab address opens another; MOTION_JS). One tab
     alone is no choice, so it is drawn as part of the page. */
  const tabs = page.tabs && page.tabs.items && page.tabs.items.length ? page.tabs : null;
  const tabName = (t, i) => (t.label && (t.label[lang] || t.label[fallback])) || word(lang, "tabFill") + " " + (i + 1);
  const body = drawn(page.sections) + (!tabs ? "" : tabs.items.length === 1 ? "\n" + drawn(tabs.items[0].sections) :
    `\n<section class="ptabs-bar ptabs-${esc(tabs.style)} al-${tabs.align === "left" ? "left" : "center"}"><div class="wrap"><div class="ptabs" role="tablist">` +
    tabs.items.map((t, i) => `<button type="button" role="tab" id="tb-${esc(t.id)}" aria-controls="t-${esc(t.id)}" aria-selected="${i === 0}" data-tab="${esc(t.id)}">${esc(tabName(t, i))}</button>`).join("") +
    `</div></div></section>\n` +
    tabs.items.map((t, i) => `<div class="ptab" id="t-${esc(t.id)}" role="tabpanel" aria-labelledby="tb-${esc(t.id)}"${i ? " hidden" : ""}>${drawn(t.sections)}</div>`).join("\n"));
  const name = String(site.display_name || "").trim();
  const parts = name.split(/\s+/);
  const brand = design.brand === "logo" && design.logo
    ? `<img src="${esc(design.logo)}" alt="${esc(name)}">`
    : `${esc(parts[0] || "")}${parts.length > 1 ? " <b>" + esc(parts.slice(1).join(" ")) + "</b>" : ""}`;

  /* Give opens the Give page — then it is one of the pages, in its place in
     the Pages list and drawn like them (Chase, 2026-10-04) — or (Navigation
     tab) goes straight to the giving link in a new tab, as the one pill at
     the end, only when there is a link. */
  const giveOut = design.giveTo === "link" && doc.give;
  const nav = pages.filter((p) => !(giveOut && p.id === "give")).map((p) =>
    `<a href="${esc(href(p.id))}"${p.id === pageId ? ' aria-current="page"' : ""}>${esc(label(p.id))}</a>`).join("");
  const give = giveOut ? `<a class="givebtn" href="${esc(doc.give)}" target="_blank" rel="noopener">${esc(label("give"))}</a>` : "";
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
  /* On a phone the language is a dropdown INSIDE the menu (Chase,
     2026-10-04); the header's own language menu hides there. */
  const navLang = doc.languages.length > 1
    ? `<details class="navlang"><summary aria-label="${esc(word(lang, "lang"))}"><span>${esc(lang.toUpperCase())}</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></summary>` +
      `<ul>${doc.languages.map((l) =>
        `<li><a href="${esc(href(pageId, l))}" hreflang="${esc(l)}" lang="${esc(l)}"${l === lang ? ' aria-current="true"' : ""}>${esc(langNames[l] || l.toUpperCase())}</a></li>`).join("")}</ul></details>`
    : "";
  const socialIcons = doc.links.filter((k) => k.kind !== "custom").map((k) =>
    `<a href="${esc(k.url)}" aria-label="${esc(SOCIAL_NAME[k.kind])}" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k.kind]}</svg></a>`).join("");
  /* The owner's own links may point at a page of the site, as a section's can. */
  /* SMART ORDER: a page of the site first, then the web; a web address shown
     as its site's icon joins the social icons. The icon comes through
     Thauma (embed/v1/icon), so a visitor never calls a third party. */
  const own = doc.links.filter((k) => k.kind === "custom").map((k) => ({ ...k, href: ctx.linkHref(k.url) })).filter((k) => k.href);
  const nameOf = (k) => k.label[lang] || k.label[fallback] || k.href;
  const custom = [...own.filter((k) => k.url.startsWith("page:")), ...own.filter((k) => !k.url.startsWith("page:") && !k.icon)].map((k) =>
    `<a href="${esc(k.href)}"${rel(k.href)}>${esc(nameOf(k))}</a>`).join("");
  const favicons = own.filter((k) => k.icon).map((k) => {
    let host = ""; try { host = new URL(k.href).hostname; } catch { /* not a web address */ }
    return host ? `<a class="favi" href="${esc(k.href)}"${rel(k.href)} aria-label="${esc(nameOf(k))}" title="${esc(nameOf(k))}"><img src="${esc(origin)}/embed/v1/icon?d=${esc(encodeURIComponent(host))}" alt="" width="18" height="18" loading="lazy"></a>` : "";
  }).join("");
  const socials = socialIcons + favicons;
  const foot = footer({ doc, lang, fallback, name, pages, href, label, socials, custom });

  const thePage = doc.pages.find((p) => p.id === pageId) || doc.pages[0];
  const seo = thePage.seo || {};
  /* What the owner wrote on the Advanced tab wins; otherwise automatic. */
  const title = (seo.title && seo.title[lang]) || (pageId === "home" ? name : `${label(pageId)} · ${name}`);
  /* WHAT A SEARCH ENGINE OR A SHARED LINK SHOWS (BACKLOG §3, 2026-10-04):
     this page's own first words, else Home's; its own first photo (or the one
     chosen for sharing), else Home's, else the logo. Addresses are the
     site's real public ones, whichever host is drawing the page. */
  const thisPage = doc.pages.find((p) => p.id === pageId) || doc.pages[0];
  const firstWords = (pg) => {
    for (const s of allSections(pg)) {
      for (const f of ["text", "kicker", "sub"]) {
        const t = plainOf(wf(s, lang, fallback, f) || "").replace(/\s+/g, " ").trim();
        if (t.length > 20) return t;
      }
    }
    return "";
  };
  const clip = (t) => (t.length > 160 ? t.slice(0, 157).replace(/\s+\S*$/, "") + "…" : t);
  const desc = (seo.desc && seo.desc[lang]) || clip(firstWords(thisPage) || firstWords(doc.pages[0]));
  const firstPhoto = (pg) => allSections(pg).map((s) => s.photo).find(Boolean) || null;
  const absolute = (u) => (!u ? null : /^https?:/.test(u) ? u : "https://thauma.one" + (u.startsWith("/") ? u : "/" + u));
  /* The picture: the owner's own; the page's photo; or (the default) the
     page's name card in this language — until one is made, the photo. */
  const mode = seo.image || (thisPage.shareImage ? "custom" : "card");
  const card = thisPage.shareCards && thisPage.shareCards[lang] && thisPage.shareCards[lang].url;
  const fallbackPic = firstPhoto(thisPage) || firstPhoto(doc.pages[0]) || (design.brand === "logo" && design.logo) || null;
  const shareImage = mode === "none" ? null : absolute(mode === "custom" && thisPage.shareImage ? thisPage.shareImage
    : mode === "card" && card ? card : fallbackPic);
  const publicBase = site.subdomain ? `https://${site.subdomain}.thauma.one` : origin + base;
  const publicUrl = (id, l) => `${publicBase}/${l}/${id === "home" ? "" : id + "/"}`;
  const LOCALE = { en: "en_US", hr: "hr_HR", sr: "sr_RS", sl: "sl_SI", de: "de_DE", es: "es_ES" };
  const social = draft ? "" : [
    `<link rel="canonical" href="${esc(publicUrl(pageId, lang))}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(name)}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : "",
    `<meta property="og:url" content="${esc(publicUrl(pageId, lang))}">`,
    `<meta property="og:locale" content="${esc(LOCALE[lang] || lang)}">`,
    shareImage ? `<meta property="og:image" content="${esc(shareImage)}">` : "",
    `<meta name="twitter:card" content="${shareImage ? "summary_large_image" : "summary"}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    desc ? `<meta name="twitter:description" content="${esc(desc)}">` : "",
    shareImage ? `<meta name="twitter:image" content="${esc(shareImage)}">` : "",
  ].filter(Boolean).join("\n");
  /* Full public addresses, as search engines require; drafts keep their own. */
  const altHref = (l) => (draft ? href(pageId, l) : `${site.subdomain ? `https://${site.subdomain}.thauma.one` : origin + base}/${l}/${pageId === "home" ? "" : pageId + "/"}`);
  const alternates = doc.languages.map((l) => `<link rel="alternate" hreflang="${esc(l)}" href="${esc(altHref(l))}">`).join("") +
    (draft ? "" : `<link rel="alternate" hreflang="x-default" href="${esc(altHref(doc.fallback))}">`);
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
    (design.headerLinks ? doc.links.filter((k) => k.kind !== "custom" || k.icon).length * 52 : 0) + 72;
  const fold = design.menu === "center" ? 820 : Math.max(820, Math.ceil(menuW / 10) * 10);

  const out = `<!doctype html>
<html lang="${esc(lang)}" data-menu="${esc(design.menu)}" data-navcur="${esc(navOpt.current || "lit")}" data-navtint="${esc(navOpt.tint || "white")}" data-navline="${esc(navOpt.line || "subtle")}" data-navphone="${esc(navOpt.phone || "drop")}" data-entrance="${esc(m.entrance)}" data-photos="${esc(m.photos)}" data-headings="${esc(m.headings)}" data-buttons="${esc(m.buttons)}" data-pages="${esc(m.pages)}" data-progress="${esc(m.progress)}" data-cue="${esc(m.cue)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${design.faviconStyle === "photo" && design.favicon ? `<link rel="icon" href="${esc(design.favicon)}">` : initialsIcon(name, L, design.faviconStyle) ? `<link rel="icon" type="image/svg+xml" href="${esc(initialsIcon(name, L, design.faviconStyle))}">` : ""}
${desc ? `<meta name="description" content="${esc(desc)}">` : ""}
${draft ? '<meta name="robots" content="noindex">' : ""}
${alternates}
${social}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONTS[design.look]}&display=swap">
<style>${css(L, design)}
@media (max-width:${fold}px){.menubtn{display:inline-block}.nav{display:none}.top .wrap{flex-direction:row!important;padding:0!important}.top .wrap>.langmenu{display:none}html.menu-open .nav .navlang{display:block;width:100%}}</style>
</head>
<body${only ? ' class="only-foot"' : ""}>
${only === "footer" ? foot : `<a class="skip" href="#main">${esc(label(pageId))}</a>
<div class="progress" aria-hidden="true"></div>
${draft ? `<div style="background:#F5B845;color:#1a1200;font:600 13px system-ui;padding:8px 16px;text-align:center">Preview — not published yet</div>` : ""}
<header class="top"><div class="wrap">
<a class="brand" href="${esc(href("home"))}">${brand}</a>
<button class="menubtn burger" type="button" aria-expanded="false" aria-controls="sitenav" aria-label="${esc(word(lang, "menu"))}"><i></i><i></i><i></i></button>
<nav class="nav" id="sitenav">${nav}${give}${design.headerLinks && socials ? `<span class="socials headlinks">${socials}</span>` : ""}${navLang}</nav>
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
  return newTabs(out);
}

/* EVERY LINK THAT LEAVES THE SITE OPENS A NEW TAB (Chase, 2026-10-01:
   "Clicking a link anywhere should open a new tab, not load in the same
   tab") — socials, buttons, the owner's own links, links written into the
   words. The site's own pages are relative ("/en/about/") and stay in the
   tab; mailto opens the mail program. Done once over the finished page, so
   a link added to any section later is covered without remembering to. */
export function newTabs(html) {
  return html.replace(/<a href="(https?:\/\/[^"]*)"(?![^>]*\btarget=)([^>]*)>/g, (m, href, rest) =>
    `<a href="${href}" target="_blank"${/\brel=/.test(rest) ? "" : ' rel="noopener"'}${rest}>`);
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
    /* The small print right under the tagline, as on Center (Chase,
       2026-10-04); in the bar only when there is no tagline to sit under. */
    const cols = [tagline && tagline + small, menu, words].filter(Boolean).map((x) => `<div class="col">${x}</div>`).join("") +
      (icons ? `<div class="col end">${icons}</div>` : "");
    inner = `<div class="cols">${cols}</div><div class="bar">${tagline ? "" : small}${credit}</div>`;
  } else {
    inner = `<div class="col">${tagline}${tagline ? small : ""}${menu}${words}</div><div class="col end">${icons}${credit}</div>${tagline ? "" : small}`;
  }
  const dress = [F.ground && F.ground !== "page" ? `foot-on-${F.ground}` : "", F.line === false ? "foot-noline" : "",
    F.space && F.space !== "regular" ? `foot-${F.space}` : ""].filter(Boolean).map((c) => " " + esc(c)).join("");
  return `<footer class="foot foot-${esc(F.layout)}${dress}"><div class="wrap">${inner}</div></footer>`;
}

/* The motion script: menu, entrances, headings, drift, progress. Small, no
   dependencies, and it does nothing at all for reduced motion. */
const MOTION_JS = `(function(){
var d=document.documentElement,b=document.querySelector('.menubtn');
[].forEach.call(document.querySelectorAll('time[data-local]'),function(t){try{var x=new Date(t.dateTime);if(!isNaN(x))t.textContent=x.toLocaleDateString(d.lang,{day:'numeric',month:'long',year:'numeric'})}catch(e){}});
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
var near=window.matchMedia&&matchMedia('(hover: none)').matches?[].slice.call(document.querySelectorAll('.ccards li')):[];
function frame(){tick=false;var vh=innerHeight;
 drift.forEach(function(i){var r=i.parentNode.getBoundingClientRect();var p=((r.top+r.height/2)-vh/2)/(vh/2+r.height/2);p=Math.max(-1,Math.min(1,p));i.style.transform='translate3d(0,'+(-p*0.05*r.height).toFixed(1)+'px,0)'});
 if(bar&&!still){var m=document.documentElement.scrollHeight-vh;bar.style.transform='scaleX('+(m>0?scrollY/m:0)+')'}
 if(near.length){var best=null,bd=1e9;near.forEach(function(c){var r=c.getBoundingClientRect();if(r.top<0||r.bottom>vh)return;var dd=Math.abs(r.top+r.height/2-vh/2);if(dd<bd){bd=dd;best=c}});near.forEach(function(c){c.classList.toggle('is-near',c===best)})}}
addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(frame)}d.classList.toggle('scrolled',scrollY>40)},{passive:true});frame();
document.addEventListener('click',function(e){[].forEach.call(document.querySelectorAll('details.langmenu[open]'),function(m){if(!m.contains(e.target))m.removeAttribute('open')})});
document.addEventListener('keydown',function(e){if(e.key==='Escape')[].forEach.call(document.querySelectorAll('details.langmenu[open]'),function(m){m.removeAttribute('open')})});
[].forEach.call(document.querySelectorAll('.ptabs'),function(bar){var bs=[].slice.call(bar.querySelectorAll('[data-tab]'));
 function show(id,keep){bs.forEach(function(b){var on=b.getAttribute('data-tab')===id;b.setAttribute('aria-selected',on);var p=document.getElementById('t-'+b.getAttribute('data-tab'));if(p)p.hidden=!on});
  if(!keep)try{history.replaceState(null,'','#'+id)}catch(e){}frame()}
 bs.forEach(function(b){b.addEventListener('click',function(){show(b.getAttribute('data-tab'))})});
 var h=(location.hash||'').slice(1);if(h&&bs.some(function(b){return b.getAttribute('data-tab')===h}))show(h,true)});
var cue=document.querySelector('.scrollcue');if(cue)cue.addEventListener('click',function(){var n=cue.closest('section').nextElementSibling;if(n)n.scrollIntoView({behavior:still?'auto':'smooth'})});
document.addEventListener('click',function(e){var h=e.target.closest&&e.target.closest('[data-widget="roadmap"]');if(!h)return;
 setTimeout(function(){var p=h.shadowRoot&&h.shadowRoot.querySelector('.detail:not(.leaving)'),s=h.closest('section'),t=s&&(s.querySelector('.h')||s);if(!p||!t)return;
  var top=document.querySelector('.top'),off=(top?top.getBoundingClientRect().height:0)+12,need=p.getBoundingClientRect().bottom-(innerHeight-16),room=t.getBoundingClientRect().top-off;
  var by=Math.min(need,room);if(by>0)scrollBy({top:by,behavior:still?'auto':'smooth'})},380)});
})();`;

/** The two pages a visitor can hit that are not a page: not there, and not yet. */
export function simplePage(title, text, status = 404) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0A0D12;color:#EDF2F8;font:16px/1.6 system-ui;padding:24px;text-align:center}h1{font-weight:300;font-size:30px;margin:0 0 10px}p{color:#9AA6B6;margin:0}</style></head>
<body><div><h1>${esc(title)}</h1><p>${esc(text)}</p></div></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export { SECTIONS };
