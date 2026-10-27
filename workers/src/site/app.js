/**
 * site/app.js — a ministry's own app (docs/APP-PLAN.md, commit B)
 *
 *   GET    <site>/app                    the app: Home, Prayer, Updates, Give
 *   GET    <site>/app/data.json          what it shows, for pull to refresh
 *   GET    <site>/app/manifest.webmanifest
 *   GET    <site>/app/icon.svg           the ministry's initials, in its colors
 *   GET    <site>/app/icon-192.png …     Thauma's mark, where a phone needs a PNG
 *   POST   <site>/app/prayed             { prayer_id, device } → { n }
 *   POST   <site>/app/push               { subscription, topics, lang }
 *   DELETE <site>/app/push               { endpoint }
 *
 * EVERY MINISTRY WITH A SITE HAS AN APP (Chase, 2026-10-13: "every ministry
 * with a site"). It is the site's address with /app after it, installed
 * from the browser — no store, no review, nothing for the ministry to set
 * up. It wears the site's own look (render.js: the same palette and fonts)
 * so a supporter sees the ministry, not Thauma.
 *
 * WHAT IT SHOWS is exactly what the site already publishes (embedPayload,
 * the same payload and the same personal-data guard the pages pass): the
 * published prayer requests, goals, milestones, letters and videos. Nothing
 * here can show what the site would not.
 *
 * "I PRAYED" IS A COUNT, NEVER WHO (Chase's decision, 2026-10-13). The phone
 * makes a random id once; the database keeps a hash of it with this ministry
 * mixed in, so one phone is one press per request and the same phone is a
 * different number at every ministry.
 *
 * ONE PAGE, DRAWN ON THE PHONE: the server sends the shell and the data; the
 * script draws the tab asked for (#prayer, #updates, #give) and draws it
 * again from /app/data.json on pull to refresh — so a notification's link
 * opens straight onto its tab, and the app works offline from the service
 * worker's copy (sw.js keeps pages and every data.json).
 */
import { esc, siteLook, siteFonts, initialsIcon } from "./render.js";
import { wordsFor } from "../lib/mail-i18n.js";
import { validSubscription, pushReady } from "../lib/webpush.js";
import { subId } from "../push-api.js";
import { json, readJson } from "../lib/store.js";
import { embedPayload } from "../embed.js";
import { pickLang } from "./serve.js";
import { assertNoPersonalData } from "../lib/nopii.js";

export const TOPICS = ["prayer", "updates", "goals"];
const DEVICE = /^[A-Za-z0-9_-]{16,64}$/;

/** The app's words, every language the site speaks plus English. */
function appWords(langs) {
  const want = new Set(["en", ...langs]);
  const out = {};
  for (const [lang, table] of Object.entries(wordsFor("app."))) {
    if (!want.has(lang)) continue;
    out[lang] = {};
    for (const [k, v] of Object.entries(table)) out[lang][k.slice(4)] = v;
  }
  return out;
}

async function deviceKey(device, partnerId) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(partnerId + ":" + device));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function prayedCounts(db, partnerId) {
  const out = {};
  try {
    for (const r of await db.query("prayer_prayed_counts", { partner_id: partnerId })) if (r.n) out[r.prayer_id] = r.n;
  } catch { /* 0063 not applied: no counts yet */ }
  return out;
}

/**
 * WHAT THE APP SHOWS — the published payload, cut to what a phone draws.
 * Text stays keyed by language so the app can switch language without
 * asking the server again (and offline).
 */
export function appData(payload, doc, row, counts = {}) {
  const byDate = (a, b) => String(b || "").localeCompare(String(a || ""));
  const offered = new Set((payload.languages || []).map((l) => l.code));
  const langs = doc.languages.filter((l) => !offered.size || offered.has(l));
  return {
    name: String(row.display_name || "").trim(),
    langs: langs.length ? langs : doc.languages,
    fallback: doc.fallback,
    give: doc.give || row.giving_url || null,
    prayer: (payload.prayer || []).map((p) => ({
      id: p.id, answered: !!p.is_answered, on: p.answered_on || null, text: p.text || {}, n: counts[p.id] || 0,
    })),
    goals: (payload.goals || []).map((g) => ({
      id: g.id, label: g.label || "", text: g.text || {}, target: g.target_cents || 0, raised: g.raised_cents || 0,
      currency: g.currency || "EUR", percent: Math.max(0, Math.min(100, Math.round(g.percent || 0))),
    })),
    /* the road so far: what has happened or is happening, newest first */
    milestones: (payload.milestones || []).filter((m) => (m.status === "complete" || m.status === "in_progress") && !m.parent_id)
      .slice().sort((a, b) => byDate(a.actual_date, b.actual_date)).slice(0, 20)
      .map((m) => ({ id: m.id, on: m.actual_date || null, status: m.status, text: m.text || {} })),
    letters: (payload.mailings || []).slice(0, 12).map((m) => ({ subject: m.subject, on: m.sent_at, url: m.url })),
    videos: (payload.videos || []).slice(0, 6).map((v) => ({ title: v.title, url: v.url, thumb: v.thumbnail_url, on: v.published_at })),
    /* THE SITE'S OWN PHOTOS, the opening's first (Chase, 2026-10-15: the
       app was "almost all words … It should be more visual"): what the app
       leads with. Only ours or https, as the site shows them. */
    photos: photosOf(doc),
    at: payload.generated_at || new Date().toISOString(),
  };
}

function photosOf(doc) {
  const out = [];
  const pages = [...(doc.pages || [])].sort((a, b) => (a.id === "home" ? -1 : b.id === "home" ? 1 : 0));
  for (const p of pages) {
    if (!p.on) continue;
    const secs = [...(p.sections || []), ...((p.tabs && p.tabs.items) || []).flatMap((t) => t.sections || [])];
    for (const sec of secs) if (sec.photo && /^(\/media\/|https:\/\/)/.test(sec.photo) && !out.includes(sec.photo)) out.push(sec.photo);
  }
  return out.slice(0, 8);
}

const sameOrigin = (request, url) => {
  const o = request.headers.get("Origin");
  return !o || o === url.origin;
};

/**
 * Everything under <site>/app. `rest` is the path after the site's root.
 * Returns null for an address that is not the app's.
 */
export async function serveApp(request, env, { db, row, doc, base, rest }) {
  const url = new URL(request.url);
  const path = rest.replace(/\/+$/, "") || "/";
  const design = doc.design || {};

  const partnerAndData = async () => {
    const partner = await db.queryOne("partner_for_site", { partner_id: row.partner_id });
    const payload = await embedPayload(db, partner, { onlyShared: false });
    assertNoPersonalData(payload, { where: "ministry app" });
    return { payload, data: appData(payload, doc, row, await prayedCounts(db, row.partner_id)) };
  };

  if (path === "/app/icon.svg") {
    const { payload } = await partnerAndData();
    const L = siteLook(design.look, payload.theme, design.colors || {}, design.mode);
    const svg = decodeURIComponent(initialsIcon(row.display_name, L, design.faviconStyle === "letters" ? "letters" : "filled").replace(/^data:image\/svg\+xml,/, ""));
    return new Response(svg || "", { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" } });
  }
  /* A phone that will only take a PNG (an iPhone's Home Screen, some
     Android launchers) gets Thauma's mark rather than nothing. */
  const png = { "/app/icon-192.png": "/icon-192.png", "/app/icon-512.png": "/icon-512.png", "/app/apple-touch-icon.png": "/apple-touch-icon.png" }[path];
  if (png) {
    if (!env.ASSETS) return new Response("", { status: 404 });
    const res = await env.ASSETS.fetch(new Request(new URL(png, url.origin)));
    return new Response(res.body, { status: res.status, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
  }

  if (path === "/app/manifest.webmanifest") {
    const { payload } = await partnerAndData();
    const L = siteLook(design.look, payload.theme, design.colors || {}, design.mode);
    const name = String(row.display_name || "").trim() || "App";
    const icons = [
      { src: `${base}/app/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: `${base}/app/icon-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${base}/app/icon-512.png`, sizes: "512x512", type: "image/png" },
    ];
    return new Response(JSON.stringify({
      id: `${base}/app`, name, short_name: name.length > 12 ? name.split(/\s+/)[0].slice(0, 12) : name,
      start_url: `${base}/app`, scope: `${base}/app`, display: "standalone", orientation: "portrait",
      background_color: L.bg, theme_color: L.bg, icons,
    }), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
  }

  if (path === "/app/data.json") {
    const { data } = await partnerAndData();
    return json(data, 200, { "Cache-Control": "no-store" });
  }

  if (path === "/app/prayed") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    if (!sameOrigin(request, url)) return json({ error: "Not from this app" }, 403);
    const body = await readJson(request);
    const prayerId = String((body && body.prayer_id) || "");
    if (!prayerId || prayerId.length > 64 || !DEVICE.test(String((body && body.device) || ""))) return json({ error: "Not a request" }, 400);
    try {
      await db.query("prayer_prayed_add", { prayer_id: prayerId, partner_id: row.partner_id,
        device: await deviceKey(body.device, row.partner_id), now: new Date().toISOString() });
    } catch { return json({ error: "not kept" }, 409); }
    const counts = await prayedCounts(db, row.partner_id);
    return json({ n: counts[prayerId] || 0 }, 200, { "Cache-Control": "no-store" });
  }

  if (path === "/app/push") {
    if (!sameOrigin(request, url)) return json({ error: "Not from this app" }, 403);
    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    if (request.method === "DELETE") {
      const endpoint = String(body.endpoint || "");
      const had = await db.queryOne("push_sub_by_endpoint", { endpoint }).catch(() => null);
      if (had && had.audience === "supporter" && had.partner_id === row.partner_id) await db.query("push_sub_forget", { endpoint }).catch(() => {});
      return json({ ok: true });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST, DELETE" });
    if (!pushReady(env)) return json({ error: "off" }, 409);
    const sub = validSubscription(body.subscription);
    if (!sub) return json({ error: "That is not a push subscription." }, 400);
    const topics = TOPICS.filter((t) => Array.isArray(body.topics) && body.topics.includes(t));
    const lang = doc.languages.includes(body.lang) ? body.lang : doc.fallback;
    try {
      await db.query("push_sub_save", { id: await subId(sub.endpoint), ...sub, audience: "supporter", user_id: null,
        partner_id: row.partner_id, lang, topics: JSON.stringify(topics), now: new Date().toISOString() });
    } catch { return json({ error: "not kept" }, 409); }
    return json({ ok: true, topics });
  }

  if (path !== "/app") return null;

  const { payload, data } = await partnerAndData();
  const L = siteLook(design.look, payload.theme, design.colors || {}, design.mode);
  const lang = pickLang(request.headers.get("Accept-Language"), data.langs, doc.fallback);
  const boot = {
    base, lang, data, words: appWords(data.langs), key: pushReady(env) ? env.VAPID_PUBLIC_KEY : null,
    slug: row.slug, site: `${base}/${lang}/`,
    logo: design.brand === "logo" && design.logo ? design.logo : null,
  };
  const apple = design.faviconStyle === "photo" && design.favicon ? design.favicon : `${base}/app/apple-touch-icon.png`;
  const html = renderApp({ L, design, boot, title: data.name, apple });
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
    "Content-Language": lang, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
  } });
}

/* --------------------------------------------------------------- the page -- */

function vars(P) {
  return `--bg:${P.bg};--panel:${P.panel};--fg:${P.fg};--dim:${P.dim};--line:${P.line};--acc:${P.acc};--acc2:${P.acc2 || P.acc};--ink:${P.ink};--on:${P.onAcc};color-scheme:${P.scheme}`;
}

export function renderApp({ L, design, boot, title, apple }) {
  const F = siteFonts(design, L);
  const dark = L.alt ? `@media (prefers-color-scheme:dark){:root{${vars(L.alt)}}}` : "";
  return `<!doctype html>
<html lang="${esc(boot.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="manifest" href="${esc(boot.base)}/app/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="${esc(boot.base)}/app/icon.svg">
<link rel="apple-touch-icon" href="${esc(apple)}">
<meta name="theme-color" content="${esc(L.bg)}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="${L.scheme === "dark" ? "black" : "default"}">
<meta name="apple-mobile-web-app-title" content="${esc(title)}">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${F.query}&display=swap">
<style>${F.face}:root{${vars(L)};--display:${F.display};--body:${F.body};--thin:${L.thin};--bold:${L.boldW}}${dark}${APP_CSS}</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="appg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--acc2)"/></linearGradient></defs></svg>
<div class="splash" id="splash" hidden><div class="mk" id="splashMark"></div><i class="ln"></i></div>
<div class="app">
<header class="bar"><a class="brand" id="brand" href="#home"></a><button class="gear" id="gear" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button></header>
<div class="invite" id="invite" hidden></div>
<div class="pull" id="pull" aria-hidden="true"><i></i></div>
<main id="view" tabindex="-1"></main>
</div>
<nav class="tabs" id="tabs"></nav>
<div class="sheet" id="sheet" hidden></div>
<div class="tour" id="tour" hidden></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.__app=${JSON.stringify(boot).replace(/</g, "\\u003c")};</script>
<script>${APP_JS}</script>
</body>
</html>`;
}

/* THE APP, VISUAL FIRST (Chase, 2026-10-15: "almost all words and that isn't
   good for a phone app. It should be more visual and interactive";
   2026-10-27: "let's just do it"). Pictures lead, numbers are rings, a
   prayer is held rather than pressed, and words are kept to labels. In the
   site's own colors and fonts (render.js), so a supporter sees the ministry.
     Home     the site's own photo, full width, the name over it; the newest
              prayer to hold; the giving ring; the latest as cards to swipe
     Prayer   one request at a time, swiped; hold to pray — the ring fills,
              the phone buzzes, the count ticks; answered ones below, glowing
     Updates  a line of what happened, pictures and video first
     Give     one big ring, one button, each goal a small ring
   The opening: the ministry's initials arriving and its line drawn, once a
   visit. Every motion stays still for a visitor who asked for less. */
const APP_CSS = `
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--bg);color:var(--dim);font:300 16px/1.55 var(--body);overscroll-behavior-y:contain}
a{color:var(--ink)}button{font:inherit;color:inherit}
.app{max-width:560px;margin:0 auto;position:relative}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top) + 10px) 18px 10px;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.brand{font:var(--thin) 15px/1.2 var(--display);letter-spacing:.2em;text-transform:uppercase;color:var(--fg);text-decoration:none;min-height:44px;display:flex;align-items:center}
.brand b{font-weight:var(--bold)}.brand img{max-height:28px;max-width:160px;display:block}
.gear{width:44px;height:44px;display:grid;place-items:center;background:none;border:0;cursor:pointer;color:var(--fg);border-radius:50%}
.gear svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
main{padding:0 0 calc(96px + env(safe-area-inset-bottom));outline:0}
.pad{padding:0 18px}
.lbl{display:flex;align-items:center;gap:10px;margin:30px 18px 12px;font:var(--bold) 11px/1 var(--display);letter-spacing:.24em;text-transform:uppercase;color:var(--ink)}
.lbl:before{content:"";width:22px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.lbl a{margin-left:auto;font:500 12px/1 var(--body);letter-spacing:.02em;text-transform:none;color:var(--dim);text-decoration:none;padding:8px 0}
/* the opening picture */
.hero{position:relative;margin:0 0 6px;aspect-ratio:4/5;max-height:72vh;width:100%;overflow:hidden;background:radial-gradient(120% 90% at 20% 10%,color-mix(in srgb,var(--acc) 40%,transparent),transparent 60%),radial-gradient(90% 80% at 90% 90%,color-mix(in srgb,var(--acc2) 30%,transparent),transparent 60%),var(--panel)}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 35%,color-mix(in srgb,var(--bg) 92%,transparent) 96%)}
.hero-in{position:absolute;left:18px;right:18px;bottom:20px;z-index:1}
.hero h1{margin:0;font:var(--thin) clamp(36px,11vw,54px)/1.02 var(--display);color:var(--fg)}.hero h1 b{font-weight:var(--bold)}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.chip{display:inline-flex;align-items:center;gap:8px;min-height:34px;padding:0 14px;border-radius:999px;background:color-mix(in srgb,var(--bg) 70%,transparent);border:1px solid var(--line);color:var(--fg);font-size:13px;text-decoration:none;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.chip i{width:8px;height:8px;border-radius:50%;background:var(--acc2);box-shadow:0 0 10px var(--acc2)}
/* a card */
.card{position:relative;margin:0 18px;padding:20px;border-radius:22px;background:var(--panel);border:1px solid var(--line);color:var(--fg);overflow:hidden}
.card h3{margin:0;font:var(--bold) 21px/1.25 var(--display);color:var(--fg)}
.card p{margin:8px 0 0;color:var(--dim)}
.clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* hold to pray */
.hold{display:flex;align-items:center;gap:14px;margin-top:18px;padding:0;background:none;border:0;cursor:pointer;color:var(--fg);text-align:left;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
.hring{position:relative;flex:none;width:64px;height:64px}
.hring svg{width:64px;height:64px;transform:rotate(-90deg);display:block}
.hring .ht{fill:none;stroke:var(--line);stroke-width:4}
.hring .hv{fill:none;stroke:url(#appg);stroke-width:4;stroke-linecap:round;stroke-dasharray:176;stroke-dashoffset:176;transition:stroke-dashoffset .25s ease}
.hold.holding .hv{transition:stroke-dashoffset .9s linear;stroke-dashoffset:0}
.hold[aria-pressed="true"] .hv{stroke-dashoffset:0;transition:none}
.hring .hi{position:absolute;inset:0;display:grid;place-items:center}
.hring .hi svg{width:26px;height:26px;transform:none;fill:none;stroke:var(--fg);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.hold[aria-pressed="true"] .hi svg{stroke:var(--acc2)}
.hl{display:flex;flex-direction:column;gap:2px}.hl b{font:var(--bold) 15px/1.2 var(--display);color:var(--fg)}.hl span{font-size:13px;color:var(--dim)}
.hl .n.bump{display:inline-block;animation:bump .45s cubic-bezier(.16,1,.3,1)}
.burst{position:absolute;left:32px;top:32px;width:0;height:0;pointer-events:none}
.burst i{position:absolute;width:6px;height:6px;margin:-3px;border-radius:50%;background:var(--acc2);animation:burst .7s cubic-bezier(.16,1,.3,1) forwards}
/* the giving ring */
.ringcard{display:flex;align-items:center;gap:18px;text-decoration:none}
.ring{display:block;transform:rotate(-90deg)}
.ring .rt{fill:none;stroke:var(--line)}.ring .rv{fill:none;stroke:url(#appg);stroke-linecap:round;transition:stroke-dashoffset 1.6s cubic-bezier(.16,1,.3,1)}
.rwrap{position:relative;flex:none}.rnum{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--fg)}
.rnum b{font:var(--thin) 26px/1 var(--display)}.rnum small{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-top:4px}
.big .rnum small{font-size:12px}
/* cards to swipe */
.swipe{display:grid;grid-auto-flow:column;grid-auto-columns:78%;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 18px 10px;scroll-padding:0 18px;scrollbar-width:none;overscroll-behavior-x:contain}
.swipe::-webkit-scrollbar{display:none}
.swipe>*{scroll-snap-align:start}
.tile{position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:220px;padding:18px;border-radius:20px;background:var(--panel);border:1px solid var(--line);color:var(--fg);text-decoration:none;overflow:hidden}
.tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.tile.pic:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 40%,rgba(0,0,0,.86))}
.tile.pic{color:#fff}.tile.pic .k{color:rgba(255,255,255,.8)}
.tile>*{position:relative;z-index:1}
.tile h3{margin:6px 0 0;font:var(--bold) 18px/1.25 var(--display)}
.tile .play{position:absolute;z-index:1;top:38%;left:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border-radius:50%;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.5);display:grid;place-items:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.tile .play svg{width:20px;height:20px;fill:#fff;margin-left:3px}
.tile .glyph{position:absolute;top:18px;left:18px;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--acc) 16%,transparent);color:var(--ink)}
.tile .glyph svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.k{font:var(--bold) 10px/1 var(--display);letter-spacing:.2em;text-transform:uppercase;color:var(--ink)}
/* prayer, one at a time */
.pager{display:grid;grid-auto-flow:column;grid-auto-columns:calc(100% - 36px);gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 18px 6px;scroll-padding:0 18px;scrollbar-width:none;overscroll-behavior-x:contain}
.pager::-webkit-scrollbar{display:none}
.pslide{scroll-snap-align:start;min-height:52vh;display:flex;flex-direction:column;justify-content:space-between;padding:26px 22px;border-radius:26px;background:radial-gradient(120% 70% at 0% 0%,color-mix(in srgb,var(--acc) 18%,transparent),transparent 60%),var(--panel);border:1px solid var(--line);color:var(--fg)}
.pslide h3{margin:0;font:var(--bold) 26px/1.2 var(--display);color:var(--fg)}
.pslide p{margin:12px 0 0;color:var(--dim);font-size:16.5px}
.dots{display:flex;justify-content:center;gap:6px;margin:14px 0 0}.dots i{width:6px;height:6px;border-radius:3px;background:var(--line);transition:width .3s,background .3s}.dots i.on{width:22px;background:var(--acc)}
.answered{margin:0 18px;display:flex;flex-direction:column;gap:10px}
.ans{display:flex;gap:14px;align-items:flex-start;padding:16px;border-radius:18px;background:var(--panel);border:1px solid var(--line);color:var(--fg)}
.ans .ck{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--acc2) 18%,transparent);box-shadow:0 0 18px color-mix(in srgb,var(--acc2) 35%,transparent)}
.ans .ck svg{width:16px;height:16px;fill:none;stroke:var(--acc2);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.ans h4{margin:2px 0 0;font:var(--bold) 16px/1.3 var(--display)}.ans p{margin:6px 0 0;font-size:14.5px;color:var(--dim)}
/* the line of what happened */
.tl{position:relative;margin:0 18px;padding-left:26px}
.tl:before{content:"";position:absolute;left:7px;top:6px;bottom:6px;width:2px;border-radius:2px;background:linear-gradient(180deg,var(--acc),var(--acc2) 60%,var(--line))}
.tli{position:relative;margin-bottom:16px}
.tli:before{content:"";position:absolute;left:-24px;top:16px;width:12px;height:12px;border-radius:50%;background:var(--bg);border:2px solid var(--acc)}
.tli.done:before{background:var(--acc2);border-color:var(--acc2);box-shadow:0 0 10px var(--acc2)}
.tli.now:before{background:var(--acc);box-shadow:0 0 0 0 var(--acc);animation:pulse 2s infinite}
.tli .tile{min-height:0}.tli .tile.pic{min-height:240px}.tli .tile:not(.pic){padding:16px 16px 16px 72px;min-height:74px;justify-content:center}
.tli .tile:not(.pic) .glyph{top:50%;margin-top:-21px;left:16px}
/* giving */
.givehead{display:flex;flex-direction:column;align-items:center;text-align:center;padding:34px 18px 10px}
.givehead .sum{margin-top:14px;font-size:15px}.givehead .sum b{color:var(--fg);font-weight:500}
.go{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:56px;padding:0 22px;border:0;border-radius:16px;background:linear-gradient(90deg,var(--acc),var(--acc2));color:var(--on);font:var(--bold) 16px/1 var(--display);text-decoration:none;cursor:pointer;box-shadow:0 10px 30px -10px var(--acc)}
.go.ghost{background:none;border:1px solid var(--line);color:var(--fg);box-shadow:none}
.go:active{transform:scale(.98)}
.goals{margin:0 18px;display:flex;flex-direction:column;gap:10px}
.goal{display:flex;align-items:center;gap:14px;padding:14px;border-radius:18px;background:var(--panel);border:1px solid var(--line);color:var(--fg)}
.goal h4{margin:0;font:var(--bold) 16px/1.3 var(--display)}.goal p{margin:4px 0 0;font-size:13.5px;color:var(--dim)}
.note{font-size:13px;margin:10px 18px 0;text-align:center}
.empty{padding:60px 18px;text-align:center}
.empty svg{width:56px;height:56px;fill:none;stroke:var(--line);stroke-width:1.4;margin-bottom:10px}
/* tabs */
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;justify-content:center;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.tabs>div{display:flex;width:100%;max-width:560px}
.tabs button{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-height:62px;padding:10px 4px 8px;background:none;border:0;cursor:pointer;color:var(--dim);font:var(--bold) 10px/1 var(--display);letter-spacing:.12em;text-transform:uppercase}
.tabs svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;transition:transform .3s cubic-bezier(.16,1,.3,1)}
.tabs button[aria-current="page"]{color:var(--fg)}
.tabs button[aria-current="page"] svg{transform:translateY(-2px);stroke:var(--ink)}
.tabs button[aria-current="page"]:before{content:"";position:absolute;top:-1px;left:50%;width:28px;height:2px;margin-left:-14px;border-radius:2px;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.pull{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top) + 60px);height:2px;z-index:4;pointer-events:none}
.pull i{display:block;height:2px;width:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));transform:scaleX(var(--pull,0));transform-origin:left}
.pull.go-on i{animation:sweep 1s cubic-bezier(.55,.05,.45,.95) infinite}
.invite{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 18px 0;padding:10px 10px 10px 16px;border-radius:16px;background:var(--panel);border:1px solid var(--line);font-size:14px;color:var(--fg)}
.invite .go{width:auto;min-height:40px;padding:0 16px;font-size:13px;border-radius:12px}
.invite .x{background:none;border:0;color:var(--dim);font-size:22px;width:40px;height:40px;cursor:pointer}
.sheet,.tour{position:fixed;inset:0;z-index:20;background:var(--bg);overflow:auto;padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 24px)}
.sheet>*,.tour>*{max-width:520px;margin-left:auto;margin-right:auto;width:100%}
.sheet .top{display:flex;justify-content:space-between;align-items:center}
.close{width:44px;height:44px;background:none;border:0;color:var(--fg);font-size:26px;cursor:pointer}
.seg{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.seg button{min-height:44px;padding:0 18px;border-radius:12px;background:none;border:1px solid var(--line);color:var(--fg);cursor:pointer;font:var(--bold) 13px/1 var(--display);letter-spacing:.1em}
.seg button[aria-pressed="true"]{border-color:var(--acc);color:var(--ink);background:color-mix(in srgb,var(--acc) 12%,transparent)}
.row{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:56px;border-top:1px solid var(--line);color:var(--fg)}
.row:first-of-type{border-top:0}
.sw{appearance:none;-webkit-appearance:none;width:50px;height:30px;border-radius:15px;border:1px solid var(--line);background:var(--panel);position:relative;cursor:pointer;flex:none;margin:0;transition:background .2s}
.sw:after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--dim);transition:transform .2s cubic-bezier(.55,.05,.45,.95),background .2s}
.sw:checked{background:color-mix(in srgb,var(--acc) 30%,transparent);border-color:var(--acc)}.sw:checked:after{transform:translateX(20px);background:var(--acc)}
.ssec{padding:22px 0;border-bottom:1px solid var(--line)}
.tour{display:flex;flex-direction:column;justify-content:space-between}
.tour .slide{flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
.tour .art{width:140px;height:140px;border-radius:50%;display:grid;place-items:center;margin-bottom:34px;background:radial-gradient(circle,color-mix(in srgb,var(--acc) 24%,transparent),transparent 70%)}
.tour .art svg{width:64px;height:64px;fill:none;stroke:var(--ink);stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.tour h1{margin:0;font:var(--thin) 38px/1.1 var(--display);color:var(--fg)}
.tour p{margin:14px 0 0;font-size:17px;color:var(--dim);max-width:30ch}
.tour .dots{margin:24px 0}
.tour .act{display:flex;justify-content:space-between;align-items:center;gap:12px}.tour .act .go{width:auto;flex:1}
.tour .skip{background:none;border:0;min-height:44px;padding:0 10px;color:var(--dim);cursor:pointer;font:var(--bold) 13px/1 var(--display);letter-spacing:.1em}
.toast{position:fixed;left:50%;bottom:calc(80px + env(safe-area-inset-bottom));z-index:30;transform:translate(-50%,12px);opacity:0;pointer-events:none;padding:11px 18px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--fg);font-size:14px;white-space:nowrap;transition:opacity .25s,transform .25s;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.toast.on{opacity:1;transform:translate(-50%,0)}
/* the opening */
.splash{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:var(--bg);transition:opacity .45s ease}
.splash.gone{opacity:0;pointer-events:none}
.splash .mk{display:flex;font:var(--thin) 64px/1 var(--display);color:var(--fg);letter-spacing:.06em}
.splash .mk span{display:inline-block;opacity:0;transform:translateY(18px);animation:rise .6s cubic-bezier(.16,1,.3,1) forwards}
.splash .mk img{max-width:180px;max-height:90px;opacity:0;animation:rise .6s cubic-bezier(.16,1,.3,1) forwards}
.splash .ln{width:120px;height:2px;border-radius:2px;background:linear-gradient(90deg,var(--acc),var(--acc2));transform:scaleX(0);transform-origin:left;animation:grow .7s cubic-bezier(.55,.05,.45,.95) .35s forwards}
@keyframes sweep{0%{transform:scaleX(0);transform-origin:left}50%{transform:scaleX(1);transform-origin:left}50.01%{transform-origin:right}100%{transform:scaleX(0);transform-origin:right}}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes bump{0%{transform:translateY(60%);opacity:0}100%{transform:none;opacity:1}}
@keyframes burst{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--bx),var(--by)) scale(.3);opacity:0}}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 60%,transparent)}70%{box-shadow:0 0 0 10px transparent}100%{box-shadow:0 0 0 0 transparent}}
@media (prefers-reduced-motion:no-preference){
  .in>*{animation:rise .55s cubic-bezier(.16,1,.3,1) both}
  .in>*:nth-child(2){animation-delay:.06s}.in>*:nth-child(3){animation-delay:.12s}.in>*:nth-child(4){animation-delay:.18s}.in>*:nth-child(n+5){animation-delay:.24s}
  .hero img{animation:kb 16s ease-out both}
}
@keyframes kb{from{transform:scale(1.08)}to{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.splash{display:none}.ring .rv,.hring .hv{transition:none!important}.tli.now:before{animation:none}}
`;

/* The client. Plain ES5-ish so an older phone still runs it. */
const APP_JS = `(function(){
var A=window.__app,D=A.data,W=A.words,base=A.base,ls={get:function(k){try{return localStorage.getItem(k)}catch(e){return null}},set:function(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
var K='app.'+A.slug+'.';
var lang=(function(){var s=ls.get(K+'lang');return s&&D.langs.indexOf(s)>-1?s:A.lang})();
var mine={};try{mine=JSON.parse(ls.get(K+'prayed')||'{}')||{}}catch(e){}
var device=ls.get('app.device');if(!device){device=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now()).replace(/[^A-Za-z0-9]/g,'');ls.set('app.device',device)}
var standalone=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function w(k,v){var t=(W[lang]&&W[lang][k])||(W.en&&W.en[k])||'';for(var x in (v||{}))t=t.split('{'+x+'}').join(v[x]);return t}
function pick(t,f){t=t||{};var o=t[lang]||t[D.fallback]||t.en||t[Object.keys(t)[0]]||{};return (o&&o[f])||''}
function para(s){return esc(s).replace(/\\n/g,'<br>')}
function day(d){if(!d)return'';try{return new Intl.DateTimeFormat(lang,{day:'numeric',month:'short',year:'numeric'}).format(new Date(d))}catch(e){return String(d).slice(0,10)}}
function money(c,cur){try{return new Intl.NumberFormat(lang,{style:'currency',currency:cur||'EUR',maximumFractionDigits:0}).format((c||0)/100)}catch(e){return Math.round((c||0)/100)+' '+(cur||'')}}
var LINES='<svg viewBox="0 0 30 10" aria-hidden="true"><rect y="2" width="30" height="1.8"/><rect y="6.6" width="15" height="1.2"/></svg>';
function buzz(){try{navigator.vibrate&&navigator.vibrate(12)}catch(e){}}
var tt;function toast(s){var t=$('toast');t.textContent=s;t.classList.add('on');clearTimeout(tt);tt=setTimeout(function(){t.classList.remove('on')},2200)}

var ICONS={home:'<path d="M4 11l8-6 8 6v8H4z"/><path d="M10 19v-5h4v5"/>',prayer:'<path d="M12 4v16M5 10h14"/>',updates:'<path d="M4 6h16M4 12h16M4 18h10"/>',give:'<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'};
function tabs(){var t=['home'];if(D.prayer.length)t.push('prayer');if(D.milestones.length||D.letters.length||D.videos.length)t.push('updates');if(D.give||D.goals.length)t.push('give');return t}
function cur(){var h=location.hash.slice(1);return tabs().indexOf(h)>-1?h:'home'}
var NAMES={home:'tabHome',prayer:'tabPrayer',updates:'tabUpdates',give:'tabGive'};

function brand(){var b=$('brand');if(A.logo){b.innerHTML='<img src="'+esc(A.logo)+'" alt="'+esc(D.name)+'">';return}
  var p=D.name.split(/\\s+/);b.innerHTML=esc(p[0]||'')+(p.length>1?' <b>'+esc(p.slice(1).join(' '))+'</b>':'');$('gear').setAttribute('aria-label',w('settings'))}
function nav(){var c=cur();$('tabs').innerHTML=tabs().length<2?'':'<div>'+tabs().map(function(t){return'<button type="button" data-tab="'+t+'"'+(t===c?' aria-current="page"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[t]+'</svg>'+esc(w(NAMES[t]))+'</button>'}).join('')+'</div>';$('tabs').hidden=tabs().length<2}

var HANDS='<path d="M12 21s-6-4-6-9.5V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 21s6-4 6-9.5V6.5a1.5 1.5 0 0 0-3 0V11"/><path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V12m0-7.5a1.5 1.5 0 0 1 3 0V11"/>';
var PLAY='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
var GLYPH={letter:'<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>',step:'<path d="M5 19V5"/><path d="M5 5h11l-2 4 2 4H5"/>',empty:'<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/>'};
var CHECK='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>';
function g(k){return'<svg viewBox="0 0 24 24" aria-hidden="true">'+GLYPH[k]+'</svg>'}
function lbl(t,more){return'<div class="lbl">'+esc(t)+(more||'')+'</div>'}
function empty(){return'<div class="empty in"><div>'+g('empty').replace('<svg','<svg style="width:56px;height:56px"')+'</div><p>'+esc(w('empty'))+'</p></div>'}
/* a ring that fills to p (0-100) once it is drawn */
function ring(p,size,stroke){var r=(size-stroke)/2,c=2*Math.PI*r;
  return'<svg class="ring" width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'" aria-hidden="true"><circle class="rt" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke-width="'+stroke+'"/><circle class="rv" cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" stroke-width="'+stroke+'" stroke-dasharray="'+c.toFixed(1)+'" stroke-dashoffset="'+c.toFixed(1)+'" data-to="'+(c*(1-Math.max(0,Math.min(100,p))/100)).toFixed(1)+'"/></svg>'}
function rwrap(p,size,stroke,small){return'<div class="rwrap" style="width:'+size+'px;height:'+size+'px">'+ring(p,size,stroke)+'<div class="rnum"><b style="font-size:'+Math.round(size*(size<80?.24:.26))+'px">'+esc(Math.round(p)+'%')+'</b>'+(small?'<small>'+esc(small)+'</small>':'')+'</div></div>'}
/* every goal together, when they count in one currency; the first otherwise */
function overall(){if(!D.goals.length)return null;var cur0=D.goals[0].currency,same=D.goals.every(function(x){return x.currency===cur0});
  if(!same)return{p:D.goals[0].percent,raised:D.goals[0].raised,target:D.goals[0].target,cur:cur0};
  var r=0,t=0;D.goals.forEach(function(x){r+=x.raised||0;t+=x.target||0});return{p:t?Math.min(100,Math.round(r/t*100)):0,raised:r,target:t,cur:cur0}}
function raisedLine(o){return esc(w('raised')).split('{raised}').join('<b>'+esc(money(o.raised,o.cur))+'</b>').split('{target}').join(esc(money(o.target,o.cur)))}
/* hold to pray: the ring fills while held; let go early and it empties */
function holdBtn(p){var on=!!mine[p.id],n=p.n||0;
  return'<button type="button" class="hold" data-hold="'+esc(p.id)+'" aria-pressed="'+on+'"><span class="hring"><svg viewBox="0 0 64 64"><circle class="ht" cx="32" cy="32" r="28"/><circle class="hv" cx="32" cy="32" r="28"/></svg><span class="hi"><svg viewBox="0 0 24 24">'+HANDS+'</svg></span></span>'+
  '<span class="hl"><b>'+esc(w(on?'prayedDone':'hold'))+'</b><span class="n">'+(n?esc(w('praying',{n:n})):'')+'</span></span></button>'}
function tileFor(x){
  if(x.kind==='video')return'<a class="tile pic" href="'+esc(x.url)+'" target="_blank" rel="noopener">'+(x.thumb?'<img src="'+esc(x.thumb)+'" alt="" loading="lazy">':'')+'<span class="play">'+PLAY+'</span><span class="k">'+esc(day(x.on))+'</span><h3>'+esc(x.title)+'</h3></a>';
  if(x.kind==='letter')return'<a class="tile" href="'+esc(x.url||'#')+'" target="_blank" rel="noopener"><span class="glyph">'+g('letter')+'</span><span class="k">'+esc(day(x.on))+'</span><h3>'+esc(x.subject)+'</h3></a>';
  return'<div class="tile"><span class="glyph">'+g('step')+'</span><span class="k">'+esc(day(x.on)||w(x.status==='complete'?'done':'now'))+'</span><h3>'+esc(pick(x.text,'title'))+'</h3></div>'}
/* everything that happened, newest first, as one line */
function happenings(){var all=[];
  D.videos.forEach(function(v){all.push({kind:'video',on:v.on,title:v.title,url:v.url,thumb:v.thumb})});
  D.letters.forEach(function(l){all.push({kind:'letter',on:l.on,subject:l.subject,url:l.url})});
  D.milestones.forEach(function(m){all.push({kind:'step',on:m.on,status:m.status,text:m.text})});
  return all.sort(function(a,b){return String(b.on||'').localeCompare(String(a.on||''))})}

function view(){var c=cur(),h='',open=D.prayer.filter(function(x){return!x.answered}),done=D.prayer.filter(function(x){return x.answered});
  if(c==='home'){var p=D.name.split(/\\s+/),o=overall(),praying=0;D.prayer.forEach(function(x){praying+=x.n||0});var news=happenings();
    h='<section class="hero in">'+(D.photos&&D.photos[0]?'<img src="'+esc(D.photos[0])+'" alt="">':'')+'<div class="hero-in"><h1>'+esc(p[0]||'')+(p.length>1?' <b>'+esc(p.slice(1).join(' '))+'</b>':'')+'</h1>'+
      '<div class="chips">'+(open.length?'<a class="chip" href="#prayer"><i></i>'+esc(praying?w('praying',{n:praying}):w('tabPrayer'))+'</a>':'')+(o?'<a class="chip" href="#give">'+esc(o.p+'%')+'</a>':'')+(news.length?'<a class="chip" href="#updates">'+esc(w('latest'))+'</a>':'')+'</div></div></section>';
    if(open[0])h+='<div class="in">'+lbl(w('tabPrayer'),D.prayer.length>1?'<a href="#prayer">'+esc(w('seeAll'))+' →</a>':'')+'<article class="card"><h3>'+esc(pick(open[0].text,'title'))+'</h3>'+(pick(open[0].text,'description')?'<p class="clamp">'+para(pick(open[0].text,'description'))+'</p>':'')+holdBtn(open[0])+'</article></div>';
    if(o)h+='<div class="in">'+lbl(w('tabGive'))+'<a class="card ringcard" href="#give">'+rwrap(o.p,96,8)+'<span><h3>'+esc(w('soFar'))+'</h3><p>'+raisedLine(o)+'</p></span></a></div>';
    if(news.length)h+='<div class="in">'+lbl(w('latest'),'<a href="#updates">'+esc(w('seeAll'))+' →</a>')+'<div class="swipe">'+news.slice(0,6).map(tileFor).join('')+'</div></div>';
  } else if(c==='prayer'){
    if(open.length)h+='<div class="in">'+lbl(w('tabPrayer'))+'<div class="pager" id="pager">'+open.map(function(x){return'<article class="pslide"><div><h3>'+esc(pick(x.text,'title'))+'</h3>'+(pick(x.text,'description')?'<p>'+para(pick(x.text,'description'))+'</p>':'')+'</div>'+holdBtn(x)+'</article>'}).join('')+'</div>'+
      (open.length>1?'<div class="dots" id="pdots">'+open.map(function(x,i){return'<i'+(i?'':' class="on"')+'></i>'}).join('')+'</div>':'')+'</div>';
    if(done.length)h+='<div class="in">'+lbl(w('answered'))+'<div class="answered">'+done.map(function(x){return'<div class="ans"><span class="ck">'+CHECK+'</span><div><h4>'+esc(pick(x.text,'title'))+'</h4>'+(pick(x.text,'answer_text')?'<p>'+para(pick(x.text,'answer_text'))+'</p>':'')+'</div></div>'}).join('')+'</div></div>';
  } else if(c==='updates'){var all=happenings();
    if(all.length)h='<div class="in">'+lbl(w('timeline'))+'<div class="tl">'+all.map(function(x){return'<div class="tli'+(x.kind==='step'?(x.status==='complete'?' done':' now'):'')+'">'+tileFor(x)+'</div>'}).join('')+'</div></div>';
  } else if(c==='give'){var o2=overall();
    h='<div class="in"><div class="givehead">'+(o2?'<div class="big">'+rwrap(o2.p,210,12,w('soFar'))+'</div><p class="sum">'+raisedLine(o2)+'</p>':'')+'</div>'+
      (D.give?'<div class="pad"><a class="go" href="'+esc(D.give)+'" target="_blank" rel="noopener">'+esc(w('giveTo',{name:D.name}))+' →</a></div><p class="note">'+esc(w('giveNote'))+'</p>':'')+'</div>';
    if(D.goals.length>1||(D.goals.length&&!o2))h+='<div class="in">'+lbl(w('tabGive'))+'<div class="goals">'+D.goals.map(function(x){var label=pick(x.text,'label')||x.label;return'<div class="goal">'+rwrap(x.percent,58,5)+'<div><h4>'+esc(label)+'</h4><p>'+raisedLine({raised:x.raised,target:x.target,cur:x.currency})+'</p></div></div>'}).join('')+'</div></div>';
  }
  $('view').innerHTML=h||empty();
  /* the rings fill once they are on screen */
  requestAnimationFrame(function(){requestAnimationFrame(function(){[].forEach.call(document.querySelectorAll('.ring .rv'),function(r){r.style.strokeDashoffset=r.getAttribute('data-to')})})});
  var pg=$('pager'),pd=$('pdots');if(pg&&pd)pg.addEventListener('scroll',function(){var i=Math.round(pg.scrollLeft/(pg.firstElementChild.getBoundingClientRect().width+12));[].forEach.call(pd.children,function(d,k){d.classList.toggle('on',k===i)})},{passive:true});
}
function draw(){document.documentElement.lang=lang;brand();nav();view()}

document.addEventListener('click',function(e){
  var t=e.target.closest('[data-tab]');if(t){buzz();if(cur()!==t.dataset.tab){history.pushState(null,'','#'+t.dataset.tab);draw();scrollTo(0,0)}else scrollTo({top:0,behavior:'smooth'});return}
  var h=e.target.closest('[data-hold]');if(h&&e.detail===0)prayed(h);
});
window.addEventListener('popstate',draw);window.addEventListener('hashchange',function(){draw();scrollTo(0,0)});

/* HOLD TO PRAY: held for nine tenths of a second it counts — the ring has
   filled, the phone buzzes, a few sparks, the count ticks up. Let go early
   and the ring empties again. A keyboard's Enter, or a visitor who asked
   for less motion, counts at once. */
var calm=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches,held=null,heldT=0;
document.addEventListener('pointerdown',function(e){var b=e.target.closest('[data-hold]');if(!b||mine[b.dataset.hold])return;
  if(calm){prayed(b);return}held=b;b.classList.add('holding');try{navigator.vibrate&&navigator.vibrate(8)}catch(x){}
  clearTimeout(heldT);heldT=setTimeout(function(){if(held===b){held=null;b.classList.remove('holding');prayed(b)}},900)});
function letGo(){if(!held)return;held.classList.remove('holding');held=null;clearTimeout(heldT)}
document.addEventListener('pointerup',letGo);document.addEventListener('pointercancel',letGo);
document.addEventListener('contextmenu',function(e){if(e.target.closest('[data-hold]'))e.preventDefault()});
function prayed(b){var id=b.dataset.hold;if(mine[id])return;
  try{navigator.vibrate&&navigator.vibrate([18,40,18])}catch(x){}
  mine[id]=1;ls.set(K+'prayed',JSON.stringify(mine));
  var p=D.prayer.filter(function(x){return x.id===id})[0];if(p)p.n=(p.n||0)+1;
  b.setAttribute('aria-pressed','true');b.querySelector('.hl b').textContent=w('prayedDone');
  var n=b.querySelector('.hl .n');n.textContent=w('praying',{n:p?p.n:1});n.classList.remove('bump');void n.offsetWidth;n.classList.add('bump');
  if(!calm){var r=b.querySelector('.hring'),s=document.createElement('span');s.className='burst';
    for(var i=0;i<10;i++){var a=i/10*Math.PI*2,d=34+Math.random()*14,dot=document.createElement('i');dot.style.setProperty('--bx',(Math.cos(a)*d).toFixed(1)+'px');dot.style.setProperty('--by',(Math.sin(a)*d).toFixed(1)+'px');dot.style.animationDelay=(Math.random()*.08).toFixed(2)+'s';s.appendChild(dot)}
    r.appendChild(s);setTimeout(function(){s.remove()},900)}
  toast(w('thanks'));
  fetch(base+'/app/prayed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prayer_id:id,device:device})}).then(function(r){return r.ok?r.json():null}).then(function(j){
    if(j&&j.n&&p&&j.n!==p.n){p.n=j.n;n.textContent=w('praying',{n:j.n})}}).catch(function(){});
}

/* THE OPENING, once a visit: the initials (or the logo) arrive and the
   line is drawn under them, then the app. */
(function(){var sp=$('splash');if(calm)return;try{if(sessionStorage.getItem(K+'opened'))return;sessionStorage.setItem(K+'opened','1')}catch(e){}
  var mk=$('splashMark');if(A.logo)mk.innerHTML='<img src="'+esc(A.logo)+'" alt="">';
  else{var ini=D.name.split(/\\s+/).filter(Boolean);ini=(ini.length>1?[ini[0],ini[ini.length-1]]:ini).map(function(x){return x.charAt(0).toUpperCase()}).join('');
    mk.innerHTML=ini.split('').map(function(ch,i){return'<span style="animation-delay:'+(i*.09)+'s">'+esc(ch)+'</span>'}).join('')}
  sp.hidden=false;setTimeout(function(){sp.classList.add('gone');setTimeout(function(){sp.hidden=true},500)},1150)})();

/* pull to refresh */
var y0=null,pulled=0,busy=false,pull=$('pull');
function refresh(){if(busy)return;busy=true;pull.classList.add('go-on');
  fetch(base+'/app/data.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){D=j;draw();toast(w('refreshed'))})
  .catch(function(){toast(w('offline'))}).then(function(){busy=false;pull.classList.remove('go-on');pull.style.setProperty('--pull',0)})}
addEventListener('touchstart',function(e){y0=scrollY<=0&&!document.querySelector('.sheet:not([hidden]),.tour:not([hidden])')?e.touches[0].clientY:null;pulled=0},{passive:true});
addEventListener('touchmove',function(e){if(y0==null||busy)return;pulled=Math.max(0,e.touches[0].clientY-y0);pull.style.setProperty('--pull',Math.min(1,pulled/90))},{passive:true});
addEventListener('touchend',function(){if(y0!=null&&pulled>90){buzz();refresh()}else if(!busy)pull.style.setProperty('--pull',0);y0=null});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&standalone)refresh()});

/* settings */
function b64(s){s=s.replace(/-/g,'+').replace(/_/g,'/');var r=atob(s+'==='.slice((s.length+3)%4)),o=new Uint8Array(r.length);for(var i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function topics(){try{return JSON.parse(ls.get(K+'topics')||'null')||['prayer','updates','goals']}catch(e){return['prayer','updates','goals']}}
function pushOn(){return ls.get(K+'push')==='1'&&window.Notification&&Notification.permission==='granted'}
var ios=/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function sheet(){var s=$('sheet'),on=pushOn(),tp=topics();var canPush=!!(A.key&&'serviceWorker' in navigator&&window.PushManager),askHome=!!(A.key&&ios&&!standalone);
  s.innerHTML='<div class="top"><span class="k">'+esc(w('settings'))+'</span><button type="button" class="close" data-close aria-label="'+esc(w('close'))+'">×</button></div>'+
  (D.langs.length>1?'<section class="ssec"><span class="k">'+esc(w('language'))+'</span><div class="seg">'+D.langs.map(function(l){return'<button type="button" data-lang="'+l+'" aria-pressed="'+(l===lang)+'">'+l.toUpperCase()+'</button>'}).join('')+'</div></section>':'')+
  (canPush||askHome?'<section class="ssec"><span class="k">'+esc(w('notify'))+'</span>'+
  (canPush?'<label class="row"><span>'+esc(w(on?'notifyOff':'notifyOn'))+'</span><input class="sw" type="checkbox" id="pushSw"'+(on?' checked':'')+'></label>'+
    (on?['prayer','updates','goals'].map(function(t){var k={prayer:'topicPrayer',updates:'topicUpdates',goals:'topicGoals'}[t];return'<label class="row"><span>'+esc(w(k))+'</span><input class="sw" type="checkbox" data-topic="'+t+'"'+(tp.indexOf(t)>-1?' checked':'')+'></label>'}).join(''):'')
    :'<p class="note">'+esc(w('iosPush'))+'</p>')+
  '</section>':'')+'<section class="ssec" style="border:0"><a class="go ghost" href="'+esc(base+'/'+lang+'/')+'" target="_blank" rel="noopener">'+esc(w('site'))+' →</a></section>';
  s.hidden=false;lock(true)}
function lock(on){document.documentElement.style.overflow=on?'hidden':''}
$('gear').addEventListener('click',function(){buzz();sheet()});
$('sheet').addEventListener('click',function(e){if(e.target.closest('[data-close]')){$('sheet').hidden=true;lock(false);return}
  var l=e.target.closest('[data-lang]');if(l){lang=l.dataset.lang;ls.set(K+'lang',lang);buzz();draw();sheet()}});
$('sheet').addEventListener('change',function(e){var t=e.target;
  if(t.id==='pushSw'){t.checked?subscribe():unsubscribe()}
  else if(t.dataset.topic){var tp=topics().filter(function(x){return x!==t.dataset.topic});if(t.checked)tp.push(t.dataset.topic);ls.set(K+'topics',JSON.stringify(tp));save()}});
function reg(){return navigator.serviceWorker.ready}
function save(){return reg().then(function(r){return r.pushManager.getSubscription()}).then(function(sub){if(!sub)return;
  return fetch(base+'/app/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),topics:topics(),lang:lang})})})}
function subscribe(){Notification.requestPermission().then(function(p){if(p!=='granted')throw 0;return reg()}).then(function(r){return r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(A.key)})})
  .then(function(){ls.set(K+'push','1');return save()}).then(function(){buzz();sheet()}).catch(function(){ls.set(K+'push','0');sheet()})}
function unsubscribe(){reg().then(function(r){return r.pushManager.getSubscription()}).then(function(sub){if(!sub)return;var ep=sub.endpoint;return sub.unsubscribe().then(function(){
  return fetch(base+'/app/push',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:ep})})})}).catch(function(){}).then(function(){ls.set(K+'push','0');sheet()})}

/* first open: three slides */
function tour(){if(ls.get(K+'tour'))return;var i=0,el=$('tour');
  function show(){var t=[['tour1t','tour1'],['tour2t','tour2'],['tour3t','tour3']][i];
    var art=['<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',HANDS,'<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'][i];
    el.innerHTML='<div class="slide in"><div class="art"><svg viewBox="0 0 24 24" aria-hidden="true">'+art+'</svg></div><h1>'+esc(w(t[0]))+'</h1><p>'+esc(w(t[1],{name:D.name}))+'</p><div class="dots">'+[0,1,2].map(function(k){return'<i'+(k===i?' class="on"':'')+'></i>'}).join('')+'</div></div>'+
    '<div class="act"><button type="button" class="skip" data-skip>'+esc(w('skip'))+'</button><button type="button" class="go" data-next>'+esc(w(i<2?'next':'start'))+' →</button></div>';el.hidden=false;lock(true)}
  el.addEventListener('click',function(e){if(e.target.closest('[data-skip]')||(e.target.closest('[data-next]')&&i===2)){ls.set(K+'tour','1');el.hidden=true;lock(false);buzz();return}if(e.target.closest('[data-next]')){i++;buzz();show()}});show()}

/* in the browser: an invitation to install */
/* ONLY ON A PHONE (Chase, 2026-10-27: "the desktop version should not say
   anything about an app since it isn't a true application, but just
   something for the phone"). */
var phone=(window.matchMedia&&matchMedia('(hover: none) and (pointer: coarse)').matches)||ios;
var deferred=null;function invite(){if(standalone||!phone||ls.get(K+'invite')>Date.now())return;var v=$('invite');
  if(!deferred&&!ios)return;
  v.innerHTML='<span>'+esc(w('addHome',{name:D.name}))+'</span><span style="display:flex;align-items:center"><button type="button" class="go" data-install>'+esc(w('add'))+'</button><button type="button" class="x" data-later aria-label="'+esc(w('close'))+'">×</button></span>';v.hidden=false}
addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;invite()});
$('invite').addEventListener('click',function(e){var v=$('invite');
  if(e.target.closest('[data-later]')){ls.set(K+'invite',String(Date.now()+7*864e5));v.hidden=true;return}
  if(e.target.closest('[data-install]')){if(deferred){deferred.prompt();deferred.userChoice.then(function(){v.hidden=true;deferred=null})}
    else{var s=$('sheet');s.innerHTML='<div class="top"><span class="k">'+esc(w('addHome',{name:D.name}))+'</span><button type="button" class="close" data-close aria-label="'+esc(w('close'))+'">×</button></div><h1 style="font:var(--thin) 30px/1.15 var(--display);color:var(--fg)">'+esc(w('iosTitle',{name:D.name}))+'</h1><div class="ssec" style="border:0"><div class="row"><span>1 · '+esc(w('ios1'))+'</span></div><div class="row"><span>2 · '+esc(w('ios2'))+'</span></div><p class="note">'+esc(w('iosPush'))+'</p></div>';s.hidden=false;lock(true)}}});

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});
draw();tour();if(ios)invite();
if(pushOn())save();
})();`;
