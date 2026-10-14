/**
 * sw.js — the service worker every installed app runs (docs/APP-PLAN.md)
 *
 *   GET /sw.js   on thauma.one (the Thauma app and the console app) and on
 *                every ministry's own address (its app)
 *
 * ONE SCRIPT, ALL SITES: it knows nothing about which site it is on. What it
 * does —
 *
 *   PUSH: shows the notification it is sent ({ title, body, link, tag,
 *   icon }) and, when pressed, opens the app at `link` — bringing an open
 *   window forward rather than starting another.
 *
 *   FAST AND OFFLINE: stylesheets, scripts, fonts and pictures come from the
 *   phone's copy at once and are refreshed behind it; a page comes from the
 *   network, and from the last copy when there is none, so an app opened on
 *   a train still opens. The console's own pages and everything under /api
 *   are never kept — they are somebody's, and a stale copy of them is wrong.
 *
 * Served by the Worker (worker.js, site/serve.js) rather than built, so one
 * copy serves every address. VERSION changes when this file does, and the
 * old caches go.
 */
export const SW_VERSION = "2026-10-13.1";

export const SW_JS = `/* Thauma — service worker ${SW_VERSION} */
const STATIC = "static-${SW_VERSION}", PAGES = "pages-${SW_VERSION}";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== STATIC && k !== PAGES) await caches.delete(k);
  await self.clients.claim();
})()));

const PRIVATE = /^\\/(api|staff|admin|cdn-cgi|site)(\\/|$)/;
const STATIC_FILE = /\\.(css|js|mjs|woff2?|ttf|png|jpe?g|webp|gif|svg|ico|webmanifest)$/i;

function offline() {
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0F15;color:#EDF2F8;font:300 16px/1.6 system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><p style="font-size:20px;margin:0 0 8px">You\\u2019re offline</p><p style="margin:0;color:#8A96A6">This opens again as soon as there is a connection.</p></div>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
async function fresh(req) {
  try {
    const res = await fetch(req);
    if (res.ok && res.type === "basic") (await caches.open(PAGES)).put(req, res.clone());
    return res;
  } catch (e) {
    return (await caches.match(req)) || (req.mode === "navigate" ? offline() : Response.error());
  }
}
async function quick(req) {
  const cache = await caches.open(STATIC);
  const kept = await cache.match(req);
  const update = fetch(req).then((res) => { if (res.ok && res.type === "basic") cache.put(req, res.clone()); return res; }).catch(() => null);
  return kept || (await update) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname === "/sw.js") return;
  if (PRIVATE.test(url.pathname)) {
    if (req.mode === "navigate") e.respondWith(fetch(req).catch(offline));
    return;
  }
  if (STATIC_FILE.test(url.pathname) || url.pathname.startsWith("/media/")) { e.respondWith(quick(req)); return; }
  if (req.mode === "navigate" || url.pathname.endsWith("/data.json")) e.respondWith(fresh(req));
});

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { title: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Thauma", {
    body: m.body || "",
    tag: m.tag || undefined,
    renotify: !!m.tag,
    icon: m.icon || "/icon-192.png",
    badge: m.badge || "/badge-96.png",
    data: { link: m.link || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = new URL((e.notification.data && e.notification.data.link) || "/", location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of open) {
      if (new URL(c.url).origin !== location.origin) continue;
      await c.focus();
      if ("navigate" in c) { try { await c.navigate(link); } catch (err) { c.postMessage({ open: link }); } }
      return;
    }
    await self.clients.openWindow(link);
  })());
});
`;

export function serveSw() {
  return new Response(SW_JS, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      /* never kept: a new version must be found on the next visit */
      "Cache-Control": "no-cache",
      "Service-Worker-Allowed": "/",
    },
  });
}
