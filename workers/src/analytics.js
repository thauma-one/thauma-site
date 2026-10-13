/**
 * analytics.js — visits to the sites, counted without knowing who (0059)
 *
 *   POST /api/hit                 a page saying it was seen (public, no auth)
 *   GET  /api/admin/analytics     the Overview's numbers (admin, board,
 *        ?days=30&site=&live=1    communications)
 *
 * Chase, 2026-10-13: "On the admin homepage, can we add an analytics section
 * for the site as well? Complete with visit numbers graph and a map that
 * shows where they visited from."
 *
 * WHAT IS KEPT, AND WHAT IS NOT (the migration says it at length): no IP
 * address, no cookie, no account. A "visit" is a browser tab — the page
 * makes a random id and forgets it when the tab closes — so these are counts
 * of tabs and pages, and nothing can follow a person from one day to the
 * next. A browser asking not to be tracked sends nothing (the page checks).
 *
 * The counter never answers with an error a visitor would see, and never
 * slows a page: the page sends it with sendBeacon after it has loaded, and
 * this answers 204 whatever happened.
 */
import { requireAccess } from "./lib/access.js";
import { resolveActor } from "./lib/actas.js";
import { createDb } from "./lib/db.js";
import { RESERVED } from "./site/model.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const none = () => new Response(null, { status: 204 });

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|monitor|curl|wget|python|httpclient/i;
const DIMS = ["country", "path", "referrer", "device", "lang", "site"];

/** Is this the real site, rather than dev, staging or a preview? */
export function isLive(host, env) {
  const domain = (env && env.SITE_DOMAIN) || "thauma.one";
  const h = String(host || "").toLowerCase();
  if (h === domain || h === "www." + domain) return true;
  const sub = h.endsWith("." + domain) ? h.slice(0, -domain.length - 1) : null;
  return !!sub && !sub.includes(".") && !RESERVED.has(sub);
}

/** A referrer's host, or null for none or our own. */
export function referrerHost(ref, host) {
  try {
    const h = new URL(String(ref || "")).hostname.replace(/^www\./, "");
    return h && h !== String(host || "").replace(/^www\./, "") ? h.slice(0, 100) : null;
  } catch { return null; }
}

export const hit = {
  async fetch(request, env) {
    if (request.method !== "POST" || !env.DB) return none();
    if (BOT.test(request.headers.get("User-Agent") || "")) return none();
    let b;
    try { b = JSON.parse((await request.text()).slice(0, 2000)); } catch { return none(); }
    const session = String(b.s || "");
    const path = String(b.p || "");
    if (!/^[a-z0-9]{8,32}$/.test(session) || !path.startsWith("/") || path.length > 300) return none();
    const db = createDb(env.DB);
    const host = new URL(request.url).hostname;
    let site = "thauma";
    /* a partner site's page names itself; believed only if it is one */
    if (b.x && /^[a-z0-9]{2,40}$/.test(String(b.x))) {
      const row = await db.queryOne("partner_site_by_subdomain", { subdomain: String(b.x) }).catch(() => null);
      if (!row) return none();
      site = row.partner_id;
    }
    const w = Number(b.w) || 0;
    const now = new Date();
    try {
      await db.query("hit_add", {
        now: now.toISOString(), day: now.toISOString().slice(0, 10), site,
        live: isLive(host, env) && !/^\/site\//.test(path) ? 1 : 0,
        path: path.split(/[?#]/)[0].slice(0, 200),
        lang: /^[a-z]{2}$/.test(String(b.l || "")) ? b.l : null,
        country: (request.cf && /^[A-Z]{2}$/.test(request.cf.country || "") && request.cf.country !== "XX") ? request.cf.country : null,
        referrer: referrerHost(b.r, host),
        device: w ? (w < 700 ? "phone" : w < 1100 ? "tablet" : "computer") : null,
        session,
      });
    } catch { /* before 0059, or a bad moment: a visitor never sees it */ }
    return none();
  },
};

export const adminAnalytics = {
  async fetch(request, env) {
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    const db = createDb(env.DB);
    const actor = await resolveActor(request, env, db, user);
    const roles = String((actor.real || actor.me || {}).roles || "").split(",");
    if (!roles.some((r) => r === "admin" || r === "board" || r === "communications")) {
      return json({ error: "The Overview is for administrators, the board and communications." }, 403);
    }
    const url = new URL(request.url);
    const days = Math.max(1, Math.min(400, parseInt(url.searchParams.get("days") || "30", 10) || 30));
    const since = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
    const prevSince = new Date(Date.now() - (2 * days - 1) * 864e5).toISOString().slice(0, 10);
    const site = String(url.searchParams.get("site") || "").slice(0, 60);
    const live = url.searchParams.get("live") === "0" ? 0 : 1;
    const q = { since, site, live };
    try {
      const byDay = await db.query("hits_by_day", q);
      const lists = {};
      for (const dim of DIMS) lists[dim] = await db.query("hits_breakdown", { ...q, dim, limit: dim === "country" ? 250 : 12 });
      /* the period before, for "up / down from last time" */
      const before = (await db.query("hits_by_day", { ...q, since: prevSince })).filter((d) => d.day < since);
      const total = (rows, k) => rows.reduce((n, r) => n + (r[k] || 0), 0);
      const names = new Map((await db.query("admin_partners", {}).catch(() => [])).map((p) => [p.id, p.display_name]));
      const sites = (await db.query("partner_site_all", {}).catch(() => []))
        .map((s) => ({ id: s.partner_id, name: names.get(s.partner_id) || s.subdomain, sub: s.subdomain }));
      return json({
        days, since, site, live,
        totals: { visits: total(byDay, "visits"), views: total(byDay, "views"),
                  prev_visits: total(before, "visits"), prev_views: total(before, "views") },
        by_day: byDay, ...lists, sites,
      });
    } catch {
      return json({ missing: true, days, since, site, live });
    }
  },
};
