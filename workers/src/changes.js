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
 * Administrators also see what is written and not yet published (waiting).
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

/** Publish: everything not yet in a release becomes one. Returns the new
    release's id, or null when the table is not there yet (before 0062). */
export async function cutRelease(db, { by, content = [] }) {
  try {
    const done = new Set((await db.query("releases_entry_ids", {})).map((r) => r.id));
    const fresh = entries().filter((e) => !done.has(e.id));
    const id = "r_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    await db.query("release_add", { id, now: new Date().toISOString(), by_name: by || null,
      entries: JSON.stringify(fresh), content: JSON.stringify(content || []) });
    return { id, entries: fresh };
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
    const seesSite = (ROLES_OF.get("admin:website") || []).some((r) => roles.includes(r));

    let rows = [];
    try { rows = await db.query("releases_recent", {}); } catch { rows = []; }
    const parse = (s) => { try { return JSON.parse(s || "[]"); } catch { return []; } };
    const releases = rows.map((r) => ({
      id: r.id, at: r.at, by: r.by_name || "",
      sections: sectionsFor(parse(r.entries), roles, lang),
      content: seesSite ? parse(r.content) : [],
    })).filter((r) => r.sections.length || r.content.length);

    const out = { releases };
    if (roles.includes("admin")) {
      let done = new Set();
      try { done = new Set((await db.query("releases_entry_ids", {})).map((r) => r.id)); } catch { /* none yet */ }
      out.waiting = sectionsFor(entries().filter((e) => !done.has(e.id)), roles, lang);
    }
    return json(out);
  },
};
