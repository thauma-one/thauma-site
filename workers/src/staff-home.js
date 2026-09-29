/**
 * staff-home.js — what Home needs you for (mockup board "Home", step 7)
 *
 *   GET /api/staff-home
 *
 * The dashboard said where things stood — the same "2" twice, nothing to act
 * on. Home says what is waiting on YOU, each with the button that does it.
 * The supporters who have gone quiet come from /api/staff-snapshot, which
 * already carries them (and already withholds them from anyone but the
 * owner). This carries the rest, in one request rather than four editors'
 * worth of GETs:
 *
 *   unfinished   milestones and prayer requests written but not published;
 *                lists open for sign-ups that nobody has joined yet; lists
 *                with drafts not sent.
 *   missing      for each PUBLISHED item, which of the ministry's switched-on
 *                languages it has no title in — counted per section and
 *                language, the same test the editors' "Missing" warnings use.
 *
 * READ-ONLY and partner-scoped through the same gate as the milestone editor:
 * Access says who is asking, the database decides which ministry. It reuses
 * the editors' own queries, so Home can never count something the editor it
 * links to would not show.
 */
import { withActing } from "./lib/actas.js";
import { json } from "./lib/store.js";
import { partnerFor } from "./staff-milestones.js";

/** Every title an item has, by language — Home shows it in the reader's. */
function titles(rows, idKey) {
  const out = {};
  for (const r of rows) if (r.title) (out[r[idKey]] ||= {})[r.lang] = r.title;
  return out;
}

/** How many published items lack a title in each switched-on language. */
function gaps(items, text, langs) {
  const count = {};
  for (const it of items) {
    if (!it.is_public) continue;
    const t = text[it.id] || {};
    for (const l of langs) if (!t[l]) count[l] = (count[l] || 0) + 1;
  }
  return count;
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, actor, denied } = await partnerFor(request, env);
    if (denied) return denied;
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    }
    const partner_id = partner.id;

    const [milestones, msText, prayer, prText, lists, languages] = await Promise.all([
      db.query("milestones_for_staff", { partner_id }),
      db.query("milestone_translations_for_staff", { partner_id }),
      db.query("prayer_for_staff", { partner_id }),
      db.query("prayer_translations_for_staff", { partner_id }),
      db.query("mailing_lists_for_partner", { partner_id }),
      db.query("partner_languages_for_partner", { partner_id }),
    ]);

    const on = languages.filter((l) => l.is_enabled);
    const codes = on.map((l) => l.code);
    const msTitles = titles(msText, "milestone_id");
    const prTitles = titles(prText, "prayer_id");

    const unfinished = [];
    /* A canceled milestone left off the site is a decision, not a job. */
    for (const m of milestones) {
      if (!m.is_public && m.status !== "canceled") {
        unfinished.push({ kind: "milestone", id: m.id, title: msTitles[m.id] || {} });
      }
    }
    for (const p of prayer) {
      if (!p.is_public) unfinished.push({ kind: "prayer", id: p.id, title: prTitles[p.id] || {} });
    }
    for (const l of lists) {
      if (Number(l.drafts) > 0) {
        unfinished.push({ kind: "drafts", id: l.id, name: l.name, n: Number(l.drafts) });
      }
      if (l.is_open && !Number(l.subscribed) && !Number(l.pending)) {
        unfinished.push({ kind: "list", id: l.id, name: l.name });
      }
    }

    return json(withActing({
      you: { email: user.email, name: me.user_name || null,
             roles: String(me.roles || "staff").split(",") },
      partner: { id: partner.id, display_name: partner.display_name },
      languages: on.map((l) => ({ code: l.code, name: l.name, native_name: l.native_name })),
      published: milestones.filter((m) => m.is_public).length,
      unfinished,
      missing: {
        milestones: gaps(milestones, msTitles, codes),
        prayer: gaps(prayer, prTitles, codes),
      },
    }, actor));
  },
};
