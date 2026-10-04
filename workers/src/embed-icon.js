/**
 * embed-icon.js — a website's little icon, fetched by Thauma
 *
 *   GET /embed/v1/icon?d=<domain>
 *
 * A Site Creator link shown "as its site's icon" (2026-10-04) needs that
 * site's favicon. Asking for it from the visitor's browser would tell a third
 * party who visits a ministry's site, so the Worker asks instead and the
 * answer is cached for a week.
 *
 * ONLY A DOMAIN NAME is accepted, and it only ever becomes a parameter to one
 * fixed icon service — never an address the Worker fetches directly — so this
 * cannot be pointed at anything inside a network. Only raster image types are
 * passed on: an SVG can carry script.
 */
const TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp)\b/;

export default {
  async fetch(request, env, ctx) {
    const d = String(new URL(request.url).searchParams.get("d") || "").toLowerCase();
    if (!/^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return new Response("", { status: 400 });

    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request("https://thauma-icon.cache/" + d);
    const hit = cache && await cache.match(key);
    if (hit) return hit;

    let res;
    try {
      res = await fetch("https://www.google.com/s2/favicons?sz=64&domain=" + encodeURIComponent(d));
    } catch {
      return new Response("", { status: 502 });
    }
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !TYPES.test(type)) {
      return new Response("", { status: 404, headers: { "Cache-Control": "public, max-age=86400" } });
    }
    const out = new Response(res.body, { headers: {
      "Content-Type": type, "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff",
    } });
    if (cache && ctx && ctx.waitUntil) ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  },
};
