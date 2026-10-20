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
    at: payload.generated_at || new Date().toISOString(),
  };
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
<header class="bar"><a class="brand" id="brand" href="#home"></a><button class="gear" id="gear" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg></button></header>
<div class="invite" id="invite" hidden></div>
<div class="pull" id="pull" aria-hidden="true"><i></i></div>
<main id="view" tabindex="-1"></main>
<nav class="tabs" id="tabs"></nav>
<div class="sheet" id="sheet" hidden></div>
<div class="tour" id="tour" hidden></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script>window.__app=${JSON.stringify(boot).replace(/</g, "\\u003c")};</script>
<script>${APP_JS}</script>
</body>
</html>`;
}

/* The F route (round 4): no cards — sections divided by a hairline with a
   short accent segment; cue lines; thin + bold headings; buttons outlined in
   the accent with the two-line motif. Tabs: design D, the current one lit
   with a short accent line on top. */
const APP_CSS = `
*{box-sizing:border-box}[hidden]{display:none!important}html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100vh;min-height:100dvh;background:var(--bg);color:var(--dim);font:300 16px/1.6 var(--body);overscroll-behavior-y:contain}
a{color:var(--ink)}button{font:inherit;color:inherit}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(env(safe-area-inset-top) + 12px) 20px 12px;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{font:var(--thin) 15px/1.2 var(--display);letter-spacing:.24em;text-transform:uppercase;color:var(--fg);text-decoration:none;min-height:44px;display:flex;align-items:center}
.brand b{font-weight:var(--bold)}.brand img{max-height:28px;max-width:160px;display:block}
.gear{width:44px;height:44px;display:grid;place-items:center;background:none;border:0;cursor:pointer;color:var(--fg)}
.gear svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round}
main{padding:0 0 calc(84px + env(safe-area-inset-bottom));outline:0}
.sec{padding:28px 20px}
.cue{display:flex;align-items:center;gap:12px;font:var(--bold) 11px/1 var(--display);letter-spacing:.28em;text-transform:uppercase;color:var(--ink)}
.cue:before{content:"";width:24px;height:1px;background:var(--acc)}
.h{margin:14px 0 0;font:var(--thin) clamp(30px,9vw,44px)/1.08 var(--display);color:var(--fg)}.h b{font-weight:var(--bold)}
.lead{margin:14px 0 0;font-size:17px;color:var(--fg);opacity:.86}
.meter{position:relative;height:1px;background:var(--line);margin:0}
.meter:after{content:"";position:absolute;left:0;top:-1px;height:3px;width:22%;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.k{font:var(--bold) 10px/1 var(--display);letter-spacing:.24em;text-transform:uppercase;color:var(--ink)}
.item{display:block;padding:18px 0;border-top:1px solid var(--line);text-decoration:none;color:inherit}
.cue+.item,.cue+.goal{border-top:0}
.item h3{margin:8px 0 0;font:var(--bold) 19px/1.3 var(--display);color:var(--fg)}
.item p{margin:6px 0 0}.item .when{font-size:13px;margin-top:6px}
.go{display:inline-flex;align-items:center;gap:12px;min-height:48px;padding:0 20px;border:1px solid var(--acc);background:transparent;color:var(--ink);font:var(--bold) 12px/1 var(--display);letter-spacing:.16em;text-transform:uppercase;text-decoration:none;cursor:pointer;border-radius:0}
.go svg{width:26px;height:9px;fill:currentColor}
.go:active{background:color-mix(in srgb,var(--acc) 14%,transparent)}
.pray{margin-top:14px;position:relative;overflow:hidden}
.pray .n{font-weight:300;letter-spacing:.08em;opacity:.8}
.pray[aria-pressed="true"]{border-color:var(--acc2);color:var(--fg)}
.pray .ok{display:none;width:14px;height:14px;fill:none;stroke:var(--acc2);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.pray[aria-pressed="true"] .ok{display:block}
.pray i{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--x,50%) var(--y,50%),color-mix(in srgb,var(--acc2) 45%,transparent) 0,transparent 60%);opacity:0}
.answer{margin-top:10px;padding-left:12px;border-left:2px solid var(--acc2);color:var(--fg)}
.goal{padding:18px 0;border-top:1px solid var(--line)}
.goal h3{margin:8px 0 0;font:var(--bold) 19px/1.3 var(--display);color:var(--fg)}
.bar2{position:relative;height:3px;margin-top:14px;background:var(--line)}
.bar2 span{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,var(--acc),var(--acc2));transform-origin:left;width:var(--p)}
.sum{display:flex;justify-content:space-between;gap:12px;margin-top:10px;font-size:14px}.sum b{color:var(--fg);font-weight:500}
.vid{display:grid;grid-template-columns:120px 1fr;gap:14px;align-items:center}.vid img{width:120px;aspect-ratio:16/9;object-fit:cover;display:block;background:var(--panel)}
.empty{padding:40px 0;text-align:center}
.tabs{position:fixed;left:0;right:0;bottom:0;z-index:6;display:flex;background:var(--bg);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
.tabs button{flex:1;position:relative;display:flex;flex-direction:column;align-items:center;gap:5px;min-height:60px;padding:10px 4px 8px;background:none;border:0;cursor:pointer;color:var(--dim);font:var(--bold) 10px/1 var(--display);letter-spacing:.14em;text-transform:uppercase}
.tabs svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.tabs button[aria-current="page"]{color:var(--fg)}
.tabs button[aria-current="page"]:before{content:"";position:absolute;top:-1px;left:50%;width:28px;height:2px;margin-left:-14px;background:var(--acc)}
.tabs button[aria-current="page"]:after{content:"";position:absolute;top:4px;left:50%;width:14px;height:1px;margin-left:-14px;background:var(--acc2)}
.pull{position:fixed;left:0;right:0;top:calc(env(safe-area-inset-top) + 60px);height:2px;z-index:4;pointer-events:none}
.pull i{display:block;height:2px;width:100%;background:linear-gradient(90deg,var(--acc),var(--acc2));transform:scaleX(var(--pull,0));transform-origin:left}
.pull.go-on i{animation:sweep 1s cubic-bezier(.55,.05,.45,.95) infinite}
.invite{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);font-size:14px;color:var(--fg)}
.invite .go{min-height:40px;padding:0 14px;font-size:11px}
.invite .x{background:none;border:0;color:var(--dim);font-size:22px;width:40px;height:40px;cursor:pointer}
.sheet,.tour{position:fixed;inset:0;z-index:20;background:var(--bg);overflow:auto;padding:calc(env(safe-area-inset-top) + 16px) 20px calc(env(safe-area-inset-bottom) + 24px)}
.sheet .top{display:flex;justify-content:space-between;align-items:center}
.close{width:44px;height:44px;background:none;border:0;color:var(--fg);font-size:26px;cursor:pointer}
.seg{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.seg button{min-height:44px;padding:0 16px;background:none;border:1px solid var(--line);color:var(--fg);cursor:pointer;font:var(--bold) 12px/1 var(--display);letter-spacing:.14em;text-transform:uppercase}
.seg button[aria-pressed="true"]{border-color:var(--acc);color:var(--ink)}
.row{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:52px;border-top:1px solid var(--line);color:var(--fg)}
.row:first-of-type{border-top:0}
.sw{appearance:none;-webkit-appearance:none;width:46px;height:28px;border:1px solid var(--line);background:var(--panel);position:relative;cursor:pointer;flex:none;margin:0}
.sw:after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;background:var(--dim);transition:transform .2s cubic-bezier(.55,.05,.45,.95),background .2s}
.sw:checked{border-color:var(--acc)}.sw:checked:after{transform:translateX(18px);background:var(--acc)}
.note{font-size:14px;margin:10px 0 0}
.tour{display:flex;flex-direction:column;justify-content:space-between}
.tour .slide{flex:1;display:flex;flex-direction:column;justify-content:center}
.tour .dots{display:flex;gap:8px;margin:24px 0}.tour .dots i{width:18px;height:2px;background:var(--line)}.tour .dots i.on{background:var(--acc);width:36px}
.tour .act{display:flex;justify-content:space-between;align-items:center;gap:12px}
.tour .skip{background:none;border:0;min-height:44px;color:var(--dim);cursor:pointer;font:var(--bold) 12px/1 var(--display);letter-spacing:.16em;text-transform:uppercase}
.toast{position:fixed;left:50%;bottom:calc(76px + env(safe-area-inset-bottom));z-index:30;transform:translate(-50%,12px);opacity:0;pointer-events:none;padding:10px 16px;background:var(--panel);border:1px solid var(--line);color:var(--fg);font-size:14px;white-space:nowrap;transition:opacity .25s,transform .25s}
.toast.on{opacity:1;transform:translate(-50%,0)}
@keyframes sweep{0%{transform:scaleX(0);transform-origin:left}50%{transform:scaleX(1);transform-origin:left}50.01%{transform-origin:right}100%{transform:scaleX(0);transform-origin:right}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ring{from{opacity:1}to{opacity:0}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes bump{0%{transform:translateY(60%);opacity:0}100%{transform:none;opacity:.8}}
@media (prefers-reduced-motion:no-preference){
  .in>*{animation:rise .5s cubic-bezier(.16,1,.3,1) both}
  .in>*:nth-child(2){animation-delay:.06s}.in>*:nth-child(3){animation-delay:.12s}.in>*:nth-child(n+4){animation-delay:.18s}
  .bar2 span{animation:grow 1.1s cubic-bezier(.16,1,.3,1) .2s both}
  .pray.did i{animation:ring .7s ease-out}
  .pray .n.bump{display:inline-block;animation:bump .4s cubic-bezier(.16,1,.3,1)}
  .tabs button{transition:color .2s}
}
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
function nav(){var c=cur();$('tabs').innerHTML=tabs().length<2?'':tabs().map(function(t){return'<button type="button" data-tab="'+t+'"'+(t===c?' aria-current="page"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS[t]+'</svg>'+esc(w(NAMES[t]))+'</button>'}).join('');$('tabs').hidden=tabs().length<2}

function prayerItem(p){var on=!!mine[p.id];var n=p.n||0;
  return'<div class="item"><h3 style="margin:0">'+esc(pick(p.text,'title'))+'</h3>'+
  (pick(p.text,'description')?'<p>'+para(pick(p.text,'description'))+'</p>':'')+(p.answered&&pick(p.text,'answer_text')?'<p class="answer">'+para(pick(p.text,'answer_text'))+'</p>':'')+
  (p.answered?'':'<button type="button" class="go pray" data-pray="'+esc(p.id)+'" aria-pressed="'+on+'"><i></i><svg class="ok" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg><span>'+esc(w(on?'prayedDone':'prayed'))+'</span>'+(n?'<span class="n">· '+esc(w('praying',{n:n}))+'</span>':'')+'</button>')+'</div>'}
function goalItem(g){var label=pick(g.text,'label')||g.label;var d=pick(g.text,'description');
  return'<div class="goal"><span class="k">'+esc(g.percent+'%')+'</span><h3>'+esc(label)+'</h3>'+(d?'<p>'+para(d)+'</p>':'')+
  '<div class="bar2"><span style="--p:'+g.percent+'%"></span></div><div class="sum"><span>'+esc(w('raised')).split('{raised}').join('<b>'+esc(money(g.raised,g.currency))+'</b>').split('{target}').join(esc(money(g.target,g.currency)))+'</span></div></div>'}
function msItem(m){var d=pick(m.text,'description');return'<div class="item"><span class="k">'+esc(day(m.on)||w('latest'))+'</span><h3>'+esc(pick(m.text,'title'))+'</h3>'+(d?'<p>'+para(d)+'</p>':'')+'</div>'}
function letterItem(l){return'<a class="item" href="'+esc(l.url||'#')+'" target="_blank" rel="noopener"><span class="k">'+esc(day(l.on))+'</span><h3>'+esc(l.subject)+'</h3></a>'}
function videoItem(v){return'<a class="item vid" href="'+esc(v.url)+'" target="_blank" rel="noopener"><img src="'+esc(v.thumb)+'" alt="" loading="lazy"><span><span class="k">'+esc(day(v.on))+'</span><h3>'+esc(v.title)+'</h3></span></a>'}
function sec(cue,inner){return'<section class="sec in">'+(cue?'<div class="cue">'+esc(cue)+'</div>':'')+inner+'</section>'}
var M='<div class="meter"></div>';
function giveBtn(){return D.give?'<p style="margin:22px 0 0"><a class="go" href="'+esc(D.give)+'" target="_blank" rel="noopener"><span>'+esc(w('giveTo',{name:D.name}))+'</span>'+LINES+'</a></p><p class="note">'+esc(w('giveNote'))+'</p>':''}

function view(){var c=cur(),h='';
  if(c==='home'){var p=D.name.split(/\\s+/);
    h=sec(w('latest'),'<h1 class="h">'+esc(p[0]||'')+(p.length>1?' <b>'+esc(p.slice(1).join(' '))+'</b>':'')+'</h1>'+'<p class="lead">'+esc(w('tour1',{name:D.name}))+'</p>');
    var open=D.prayer.filter(function(x){return!x.answered});
    if(open[0])h+=M+sec(w('tabPrayer'),prayerItem(open[0])+(D.prayer.length>1?'<p style="margin:6px 0 0"><a href="#prayer">'+esc(w('seeAll'))+'</a></p>':''));
    if(D.milestones[0]||D.letters[0])h+=M+sec(w('tabUpdates'),(D.milestones[0]?msItem(D.milestones[0]):'')+(D.letters[0]?letterItem(D.letters[0]):''));
    if(D.goals[0])h+=M+sec(w('tabGive'),goalItem(D.goals[0])+giveBtn());
    else if(D.give)h+=M+sec(w('tabGive'),giveBtn());
  } else if(c==='prayer'){var o=D.prayer.filter(function(x){return!x.answered}),a=D.prayer.filter(function(x){return x.answered});
    h=sec(w('tabPrayer'),o.map(prayerItem).join('')||'<p class="empty">'+esc(w('empty'))+'</p>');if(a.length)h+=M+sec(w('answered'),a.map(prayerItem).join(''));
  } else if(c==='updates'){
    if(D.milestones.length)h+=sec(w('timeline'),D.milestones.map(msItem).join(''));
    if(D.letters.length)h+=(h?M:'')+sec(w('letters'),D.letters.map(letterItem).join(''));
    if(D.videos.length)h+=(h?M:'')+sec(w('watch'),D.videos.map(videoItem).join(''));
  } else if(c==='give'){h=sec(w('tabGive'),D.goals.map(goalItem).join('')+giveBtn())}
  $('view').innerHTML=h||sec('','<p class="empty">'+esc(w('empty'))+'</p>');
}
function draw(){document.documentElement.lang=lang;brand();nav();view()}

document.addEventListener('click',function(e){
  var t=e.target.closest('[data-tab]');if(t){buzz();if(cur()!==t.dataset.tab){history.pushState(null,'','#'+t.dataset.tab);draw();scrollTo(0,0)}else scrollTo({top:0,behavior:'smooth'});return}
  var b=e.target.closest('[data-pray]');if(b)pray(b,e);
});
window.addEventListener('popstate',draw);window.addEventListener('hashchange',draw);

function pray(b,e){var id=b.dataset.pray;if(mine[id])return;buzz();
  var r=b.getBoundingClientRect();b.style.setProperty('--x',((e.clientX||r.left+r.width/2)-r.left)+'px');b.style.setProperty('--y',((e.clientY||r.top+r.height/2)-r.top)+'px');
  b.classList.remove('did');void b.offsetWidth;b.classList.add('did');
  mine[id]=1;ls.set(K+'prayed',JSON.stringify(mine));
  var p=D.prayer.filter(function(x){return x.id===id})[0];if(p)p.n=(p.n||0)+1;
  b.setAttribute('aria-pressed','true');b.querySelector('span').textContent=w('prayedDone');
  var n=b.querySelector('.n');if(!n){n=document.createElement('span');n.className='n';b.appendChild(n)}n.textContent='· '+w('praying',{n:p?p.n:1});n.classList.remove('bump');void n.offsetWidth;n.classList.add('bump');
  toast(w('thanks'));
  fetch(base+'/app/prayed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prayer_id:id,device:device})}).then(function(r){return r.ok?r.json():null}).then(function(j){
    if(j&&j.n&&p&&j.n!==p.n){p.n=j.n;n.textContent='· '+w('praying',{n:j.n})}}).catch(function(){});
}

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
  s.innerHTML='<div class="top"><span class="cue">'+esc(w('settings'))+'</span><button type="button" class="close" data-close aria-label="'+esc(w('close'))+'">×</button></div>'+
  (D.langs.length>1?'<section class="sec" style="padding-left:0;padding-right:0"><span class="k">'+esc(w('language'))+'</span><div class="seg">'+D.langs.map(function(l){return'<button type="button" data-lang="'+l+'" aria-pressed="'+(l===lang)+'">'+l.toUpperCase()+'</button>'}).join('')+'</div></section>'+M:'')+
  (canPush||askHome?'<section class="sec" style="padding-left:0;padding-right:0"><span class="k">'+esc(w('notify'))+'</span>'+
  (canPush?'<label class="row"><span>'+esc(w(on?'notifyOff':'notifyOn'))+'</span><input class="sw" type="checkbox" id="pushSw"'+(on?' checked':'')+'></label>'+
    (on?['prayer','updates','goals'].map(function(t){var k={prayer:'topicPrayer',updates:'topicUpdates',goals:'topicGoals'}[t];return'<label class="row"><span>'+esc(w(k))+'</span><input class="sw" type="checkbox" data-topic="'+t+'"'+(tp.indexOf(t)>-1?' checked':'')+'></label>'}).join(''):'')
    :'<p class="note">'+esc(w('iosPush'))+'</p>')+
  '</section>'+M:'')+'<section class="sec" style="padding-left:0;padding-right:0"><a class="go" href="'+esc(base+'/'+lang+'/')+'" target="_blank" rel="noopener"><span>'+esc(w('site'))+'</span>'+LINES+'</a></section>';
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
    el.innerHTML='<div class="slide in"><div class="cue">'+esc(D.name)+'</div><h1 class="h">'+esc(w(t[0]))+'</h1><p class="lead">'+esc(w(t[1],{name:D.name}))+'</p><div class="dots">'+[0,1,2].map(function(k){return'<i'+(k===i?' class="on"':'')+'></i>'}).join('')+'</div></div>'+
    '<div class="act"><button type="button" class="skip" data-skip>'+esc(w('skip'))+'</button><button type="button" class="go" data-next><span>'+esc(w(i<2?'next':'start'))+'</span>'+LINES+'</button></div>';el.hidden=false;lock(true)}
  el.addEventListener('click',function(e){if(e.target.closest('[data-skip]')||(e.target.closest('[data-next]')&&i===2)){ls.set(K+'tour','1');el.hidden=true;lock(false);buzz();return}if(e.target.closest('[data-next]')){i++;buzz();show()}});show()}

/* in the browser: an invitation to install */
var deferred=null;function invite(){if(standalone||ls.get(K+'invite')>Date.now())return;var v=$('invite');
  if(!deferred&&!ios)return;
  v.innerHTML='<span>'+esc(w('getApp'))+'</span><span><button type="button" class="go" data-install><span>'+esc(w('getApp'))+'</span></button><button type="button" class="x" data-later aria-label="'+esc(w('close'))+'">×</button></span>';v.hidden=false}
addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;invite()});
$('invite').addEventListener('click',function(e){var v=$('invite');
  if(e.target.closest('[data-later]')){ls.set(K+'invite',String(Date.now()+7*864e5));v.hidden=true;return}
  if(e.target.closest('[data-install]')){if(deferred){deferred.prompt();deferred.userChoice.then(function(){v.hidden=true;deferred=null})}
    else{var s=$('sheet');s.innerHTML='<div class="top"><span class="cue">'+esc(w('getApp'))+'</span><button type="button" class="close" data-close aria-label="'+esc(w('close'))+'">×</button></div><h1 class="h">'+esc(w('iosTitle',{name:D.name}))+'</h1><div class="sec" style="padding-left:0;padding-right:0"><div class="row"><span>1 · '+esc(w('ios1'))+'</span></div><div class="row"><span>2 · '+esc(w('ios2'))+'</span></div><p class="note">'+esc(w('iosPush'))+'</p></div>';s.hidden=false;lock(true)}}});

if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(function(){});
draw();tour();if(ios)invite();
if(pushOn())save();
})();`;
