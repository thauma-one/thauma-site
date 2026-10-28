/**
 * changes — What's new: what each Publish put live, by page (0062)
 *
 *   GET /api/changes   { releases: [{ id, at, by, sections, content }], waiting? }
 *
 * Chase, 2026-10-13: "add a notification to users when the site was updated
 * with a changelog. Essentially when the publish button is pressed." Then:
 * "Make sure the changelog is understandable to an end user. And separate
 * into different sections by the different pages of the site filtered to
 * each user by their role and what they can see."
 *
 * THE WORDS are src/_data/changelog.json: one entry per change somebody
 * would notice, written with the change in every console language, each
 * naming the page it belongs to. Commit messages are not used — they are
 * written for whoever reads the code.
 *
 * A RELEASE is cut when Publish is pressed (cutRelease, from admin-publish):
 * every entry no earlier release has, copied with its words, plus the
 * Website tabs whose content changed. The page's bell notice links here.
 *
 * WHO SEES WHAT. An entry's page is a console page (staff:<slug> or
 * admin:<slug>, as in src/_data/consoleNav.js), "console" (everyone in it)
 * or "site" (the public site, everyone). A person sees an entry only if one
 * of their roles may open its page — the same list the header is drawn from,
 * so What's new never tells somebody about a page they do not have.
 *
 * NOT EVERYONE IS TOLD EVERYTHING (Chase, 2026-10-13: "not every update to
 * the site needs to be told to all team members, there may be pages that get
 * updated that certain roles don't even see. So some of those changes may
 * just need to be noted as 'other site changes'"). What a person cannot see
 * is one line — how many other changes there were — never what they were.
 * And the bell's "site published" notice goes only to somebody with
 * something of their own in that release (tells, used by admin-publish).
 *
 * Administrators also see everything written and not yet published
 * (waiting) — all pages, since they are the one publishing it.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { json } from "./lib/store.js";
import NAV from "../../src/_data/consoleNav.js";
import LOG from "../../src/_data/changelog.json" with { type: "json" };

const EVERYONE = ["admin", "staff", "partner", "board", "communications"];

/* Every page an entry may name, in the order What's new shows them, with
   who may open it. */
export const PAGES = [
  ["console", EVERYONE],
  ["site", EVERYONE],
  ...NAV.staff.map((p) => ["staff:" + p.slug, p.roles && p.roles.length ? p.roles : EVERYONE]),
  ...NAV.admin.map((p) => ["admin:" + p.slug, p.roles && p.roles.length ? p.roles : EVERYONE]),
];
const ROLES_OF = new Map(PAGES);

export const entries = () => LOG.entries || [];

/** The entries this person may see, grouped by page in the pages' order,
    each line in their language (English where one is missing). */
export function sectionsFor(list, roles, lang) {
  const mine = new Set(roles || []);
  const by = new Map();
  for (const e of list || []) {
    const may = ROLES_OF.get(e.page);
    if (!may || !may.some((r) => mine.has(r))) continue;
    const text = (e.text && (e.text[lang] || e.text.en)) || "";
    if (!text) continue;
    if (!by.has(e.page)) by.set(e.page, []);
    by.get(e.page).push(text);
  }
  return PAGES.filter(([p]) => by.has(p)).map(([page]) => ({ page, lines: by.get(page) }));
}

/** How many entries this person cannot see — "other site changes". */
export function othersFor(list, roles) {
  const mine = new Set(roles || []);
  return (list || []).filter((e) => !(ROLES_OF.get(e.page) || []).some((r) => mine.has(r))).length;
}
export const seesWebsite = (roles) => (ROLES_OF.get("admin:website") || []).some((r) => (roles || []).includes(r));

/** Whether a release has anything of this person's own: an entry on a page
    they have, or the public site's content for whoever looks after it. */
export function tells(release, roles) {
  return sectionsFor(release.entries, roles, "en").length > 0 || (seesWebsite(roles) && (release.content || []).length > 0);
}

/** Publish: everything not yet in a release becomes one. Returns the new
    release's id, or null when the table is not there yet (before 0062). */
export async function cutRelease(db, { by, content = [] }) {
  try {
    const done = new Set((await db.query("releases_entry_ids", {})).map((r) => r.id));
    const fresh = entries().filter((e) => !done.has(e.id));
    const id = "r_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    await db.query("release_add", { id, now: new Date().toISOString(), by_name: by || null,
      entries: JSON.stringify(fresh), content: JSON.stringify(content || []) });
    return { id, by_name: by || null, entries: fresh, content: content || [] };
  } catch (err) {
    console.error("release:", err.message);
    return null;
  }
}

export default {
  async fetch(request, env) {
    const gate = await requireAccess(request, env);
    if (gate.denied) return gate.denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    const db = createDb(env.DB);
    const me = await db.queryOne("user_by_email", { email: gate.user.email });
    if (!me) return json({ error: "No account for that address" }, 403);
    const roles = String(me.roles || "").split(",").filter(Boolean);
    const lang = me.preferred_lang || "en";
    /* the public site's content: shown to whoever may open Website */
    const seesSite = seesWebsite(roles);

    let rows = [];
    try { rows = await db.query("releases_recent", {}); } catch { rows = []; }
    const parse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
    const releases = rows.map((r) => {
      const list = parse(r.entries), content = parse(r.content);
      return {
        id: r.id, at: r.at, by: r.by_name || "",
        sections: sectionsFor(list, roles, lang),
        content: seesSite ? content : [],
        /* counted, never described: the entries on pages they do not have,
           and the site's content for somebody who does not look after it */
        others: othersFor(list, roles) + (!seesSite && content.length ? 1 : 0),
      };
    }).filter((r) => r.sections.length || r.content.length || r.others);

    const out = { releases };
    if (roles.includes("admin")) {
      let done = new Set();
      try { done = new Set((await db.query("releases_entry_ids", {})).map((r) => r.id)); } catch { /* none yet */ }
      /* everything, whatever their own roles: they are the one publishing it */
      out.waiting = sectionsFor(entries().filter((e) => !done.has(e.id)), EVERYONE, lang);
    }
    return json(out);
  },
};
