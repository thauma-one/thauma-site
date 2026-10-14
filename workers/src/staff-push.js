/**
 * staff-push.js — "Tell your supporters" (docs/APP-PLAN.md, commit C)
 *
 *   GET  /api/staff-push            { ready, phones, topics: { prayer, updates, goals } }
 *   POST /api/staff-push            { kind: prayer|milestone|goal, id } → { sent, phones }
 *
 * After Publish on Updates, the console offers to tell the phones that
 * installed the ministry's app (site/app.js) — only when there are phones to
 * tell, and only about something that is now public. One press: the message
 * is written here, not typed, so it is the same in every phone's own
 * language ("New prayer request · Visas", in Croatian on a Croatian phone)
 * and opens the app on the right tab.
 *
 * WHAT CAN BE ANNOUNCED is looked up in the ministry's PUBLIC data
 * (partnerPublicSite) — so a request that is not published, or another
 * ministry's, is simply not found.
 */
import { partnerFor } from "./staff-milestones.js";
import { partnerPublicSite } from "./lib/db.js";
import { json, readJson } from "./lib/store.js";
import { pushReady } from "./lib/webpush.js";
import { pushToPartner } from "./lib/push.js";
import { t } from "./lib/mail-i18n.js";
import { TOPICS } from "./site/app.js";

const textIn = (text, lang) => (text && (text[lang] || text.en || Object.values(text)[0])) || {};

/** What a phone in `lang` is told about one public item, or null. */
export function newsFor(site, kind, id) {
  if (kind === "prayer") {
    const p = (site.prayer || []).find((x) => x.id === id);
    return p && { topic: "prayer", tab: "prayer",
      line: (l) => t(l, p.is_answered ? "app.pushAnswered" : "app.pushPrayer", { title: textIn(p.text, l).title || "" }) };
  }
  if (kind === "milestone") {
    const m = (site.milestones || []).find((x) => x.id === id);
    return m && { topic: "updates", tab: "updates",
      line: (l) => t(l, "app.pushUpdate", { title: textIn(m.text, l).title || "" }) };
  }
  if (kind === "goal") {
    const g = (site.goals || []).find((x) => x.id === id);
    return g && { topic: "goals", tab: "give",
      line: (l) => t(l, "app.pushGoal", { label: textIn(g.text, l).label || g.label || "", percent: Math.round(g.percent || 0) }) };
  }
  return null;
}

export default {
  async fetch(request, env) {
    const { db, partner, denied } = await partnerFor(request, env);
    if (denied) return denied;

    if (request.method === "GET") {
      let subs = [];
      try { subs = await db.query("push_subs_for_partner", { partner_id: partner.id }); } catch { subs = []; }
      const topics = Object.fromEntries(TOPICS.map((k) => [k, subs.filter((s) => {
        let tp = [];
        try { tp = JSON.parse(s.topics || "[]"); } catch { tp = []; }
        return !tp.length || tp.includes(k);
      }).length]));
      return json({ ready: pushReady(env), phones: subs.length, topics, name: partner.display_name || "" }, 200, { "Cache-Control": "no-store" });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });

    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    if (!pushReady(env)) return json({ error: "Notifications are not switched on for this site yet." }, 409);
    const site = await partnerPublicSite(db, partner.id, partner.slug);
    const news = newsFor(site, String(body.kind || ""), String(body.id || ""));
    if (!news) return json({ error: "That is not published." }, 404);

    const name = String(partner.display_name || partner.name || "").trim();
    const r = await pushToPartner(env, db, partner.id, (lang) => ({
      title: name, body: news.line(lang || "en"), link: "/app#" + news.tab, tag: news.topic,
      icon: "/app/icon-192.png",
    }), news.topic);
    return json(r);
  },
};
