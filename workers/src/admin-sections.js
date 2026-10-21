/**
 * admin-sections.js — Website › Site Creator: the site's pages as sections
 *
 *   GET  /api/admin/sections                 the pages' sections and the menu's
 *                                            order (src/_data/pageSections.json)
 *   POST /api/admin/sections { action: "save", sha, doc, words, photos }
 *                                            a new arrangement, committed
 *
 * Chase, 2026-10-21: the administrators' Site Creator works like the staff
 * one — sections added, moved and taken away, the menu in its own order —
 * without anything on the site looking different. The pages are lists of the
 * site's own designs (src/js/site-sections.js KINDS); this is the one place
 * a list is written.
 *
 * WHAT A SAVE MAY DO, checked here whatever the browser sent:
 *   · put the menu's pages in another order (never add or drop one)
 *   · add, move and take away sections of the kinds that can be added
 *   · move a fixed section (the team, the form…), never take it away
 *   · leave every page's head where it is
 *   · name words only under the section's own `blocks.<id>.…`, or the keys it
 *     already had — a section cannot be pointed at another page's words
 * Anything else is refused, and nothing is written.
 *
 * ONE COMMIT, the page and its words together (lib/github.js commitFiles): a
 * new section's words are created in every language file — the words typed
 * for the language being written, stand-in words in the rest (as the staff
 * Site Creator does) — and the words of a section taken away go with it. A
 * section's own photo slot in site.json is created and removed the same way.
 * Words a section had from before (`home.who_cue`) are never deleted: the
 * live site's code may still read them until the next Publish.
 *
 * ON `dev` FIRST. The file arrives on dev with the code that reads it. Until
 * that is merged, the site's branch does not have it, and the first save
 * writes it there from dev's copy.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { getFileAt, refSha, commitFiles, githubConfig } from "./lib/github.js";
import { cleanValue, leafMap } from "./lib/translation-file.js";
import { EDITORS } from "./admin-content.js";
import SECTIONS from "../../src/js/site-sections.js";

const { KINDS, PAGES, VOICES, GROUNDS, STYLES, keysOf } = SECTIONS;

export const SECTIONS_PATH = "src/_data/pageSections.json";
const SITE = "src/_data/site.json";
const langPath = (code) => `src/_data/i18n/${code}.json`;

const ID_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
const PART_RE = /^[a-z][a-z0-9_]{0,30}$/;
const SRC_RE = /^\/media\/site\/[A-Za-z0-9._-]{1,200}$/;
const LINK_RE = /^(https:\/\/[^\s"<>]{3,300}|mailto:[^\s"<>@]+@[^\s"<>]+)$/;
const MAX_SECTIONS = 30;

async function gate(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.some((r) => EDITORS.includes(r))) {
    return { denied: json({ error: "Changing the site's pages needs the administrator or communications role." }, 403) };
  }
  return { db, user, me };
}

const parse = (f) => { try { return { doc: JSON.parse(f.text) }; } catch (e) { return { error: e.message }; } };

/** A git blob's SHA for a text — what the Contents API reports for a file,
    so the answer to a save is the SHA the next save is checked against. */
async function blobSha(text) {
  const bytes = new TextEncoder().encode(text);
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const d = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The sections as the site's branch has them at `head`, or dev's copy
    before it ever got there. */
async function readSections(env, head) {
  const f = await getFileAt(env, SECTIONS_PATH, head);
  if (!f.error) return { file: f, seeded: false };
  if (f.status !== 404 || !env.STAGING_BRANCH) return { error: f.error, status: f.status || 502 };
  const d = await getFileAt(env, SECTIONS_PATH, env.STAGING_BRANCH);
  if (d.error) return { error: d.error, status: d.status || 502 };
  return { file: d, seeded: true };
}

/* ---------------------------------------------------------------- checking */

/** Every key a section is allowed to name: its own `blocks.<id>.…`, or one
    it named before this save. */
function keyAllowed(key, sec, before) {
  if (typeof key !== "string") return false;
  const m = key.match(/^blocks\.([a-z0-9-]+)\.([a-z0-9_]+)$/);
  if (m) return m[1] === sec.id && PART_RE.test(m[2]);
  return !!before && before.indexOf(key) !== -1;
}

/**
 * The arrangement a save asks for, checked against the one it replaces.
 * Returns { doc } — rebuilt from what was checked, nothing else carried — or
 * { error }.
 */
export function checkSections(next, before) {
  if (!next || typeof next !== "object" || !next.pages || typeof next.pages !== "object") return { error: "That is not a site's pages." };
  const out = { nav: [], pages: {} };

  /* the menu: the same pages, in any order */
  const nav = Array.isArray(next.nav) ? next.nav.map(String) : [];
  const was = before.nav || [];
  if (nav.length !== was.length || new Set(nav).size !== nav.length || nav.some((p) => was.indexOf(p) === -1)) {
    return { error: "The menu can be put in another order, not given other pages." };
  }
  out.nav = nav;

  const oldById = {};
  Object.keys(before.pages || {}).forEach((p) => (before.pages[p] || []).forEach((s) => { oldById[s.id] = { page: p, sec: s }; }));
  const seen = new Set();
  const pages = Object.keys(before.pages || {});
  if (Object.keys(next.pages).length !== pages.length || pages.some((p) => !Array.isArray(next.pages[p]))) {
    return { error: "Pages can be arranged here, not added or taken away." };
  }

  for (const p of pages) {
    const list = next.pages[p], old = before.pages[p] || [];
    if (!list.length || list.length > MAX_SECTIONS) return { error: `${p} has too many or too few sections.` };
    const fixedBefore = old.filter((s) => KINDS[s.kind] && KINDS[s.kind].fixed).map((s) => s.id).sort().join();
    const fixedNow = [];
    const rows = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i] || {};
      const id = String(s.id || ""), kind = String(s.kind || ""), k = KINDS[kind];
      if (!ID_RE.test(id) || seen.has(id)) return { error: `A section on ${p} has no usable name of its own.` };
      seen.add(id);
      if (!k) return { error: `${kind} is not a kind of section.` };
      if (k.only && k.only !== p) return { error: `That section belongs on another page.` };
      const prior = oldById[id];
      if (prior && prior.page !== p) return { error: "A section cannot be moved to another page." };
      /* the head of the page: first, and the one it always had */
      if (i === 0 || k.top) {
        if (!(i === 0 && k.top && old[0] && old[0].id === id)) return { error: `The top of ${p} stays where it is.` };
      }
      /* fixed sections are what they were — only their place can change */
      if (k.fixed) {
        if (!prior) return { error: "That section cannot be added." };
        fixedNow.push(id);
        rows.push(JSON.parse(JSON.stringify(prior.sec)));
        continue;
      }
      if (!prior && SECTIONS.ADDABLE.indexOf(kind) === -1 && !k.top) return { error: `A ${kind} cannot be added.` };
      if (prior && prior.sec.kind !== kind) return { error: "A section cannot change its kind." };
      const priorKeys = prior ? keysOf(prior.sec) : null;
      const sec = { id, kind };

      /* its words: the fields its kind has, each a key it may name */
      const wd = s.words && typeof s.words === "object" ? s.words : {};
      const words = {};
      for (const f of k.words || []) {
        if (wd[f] == null) {
          if ((k.optional || []).indexOf(f) === -1) return { error: `A ${kind} needs its ${f}.` };
          continue;
        }
        if (f === "heading") {
          if (!keyAllowed(wd[f] + "_thin", sec, priorKeys) || !keyAllowed(wd[f] + "_bold", sec, priorKeys)) return { error: "A heading names words it may not." };
        } else if (!keyAllowed(wd[f], sec, priorKeys)) return { error: `A ${f} names words it may not.` };
        words[f] = wd[f];
      }
      if (k.list) {
        const l = Array.isArray(wd[k.list]) ? wd[k.list] : [];
        if (l.length > (k.listMax || 8) || l.some((x) => !keyAllowed(x, sec, priorKeys))) return { error: "Those paragraphs name words they may not." };
        if (l.length || kind === "dictionary") words[k.list] = l.slice();
      }
      if (k.photo && s.photo != null) {
        const slot = String(s.photo);
        if (!(slot === id || (prior && prior.sec.photo === slot))) return { error: "That photo belongs to another section." };
        sec.photo = slot;
        for (const f of ["alt", "placeholder"]) {
          if (wd[f] == null) continue;
          if (!keyAllowed(wd[f], sec, priorKeys)) return { error: "A photo's words name words they may not." };
          words[f] = wd[f];
        }
      }
      if (Object.keys(words).length || (k.words && k.words.length)) sec.words = words;

      if (k.items) {
        const items = Array.isArray(s.items) ? s.items : [];
        if (!items.length || items.length > (k.itemsMax || 8)) return { error: `A ${kind} has from one to ${k.itemsMax || 8} parts.` };
        sec.items = [];
        for (const it of items) {
          const o = {};
          for (const f of k.items) {
            if (!keyAllowed(it && it[f], sec, priorKeys)) return { error: "A part names words it may not." };
            o[f] = it[f];
          }
          sec.items.push(o);
        }
      }
      if (k.buttons) {
        const bs = Array.isArray(s.buttons) ? s.buttons : [];
        if (bs.length > k.buttons) return { error: `A ${kind} has at most ${k.buttons} button${k.buttons > 1 ? "s" : ""}.` };
        if (bs.length) {
          sec.buttons = [];
          for (const b of bs) {
            const to = String((b && b.to) || "");
            if (!keyAllowed(b && b.label, sec, priorKeys)) return { error: "A button names words it may not." };
            if (PAGES.indexOf(to) === -1 && !LINK_RE.test(to)) return { error: "A button goes to one of the site's pages, or a web address." };
            sec.buttons.push({ label: b.label, to, style: STYLES.indexOf(b.style) !== -1 ? b.style : "solid" });
          }
        }
      }
      const look = {};
      if (k.ground && s.look && GROUNDS.indexOf(s.look.ground) !== -1 && s.look.ground !== "plain") look.ground = s.look.ground;
      if (k.voice && s.look && VOICES.indexOf(s.look.voice) !== -1 && s.look.voice !== "tech") look.voice = s.look.voice;
      if (Object.keys(look).length) sec.look = look;
      rows.push(sec);
    }
    if (fixedNow.sort().join() !== fixedBefore) return { error: `The fixed parts of ${p} stay on it.` };
    out.pages[p] = rows;
  }
  return { doc: out };
}

/* ---------------------------------------------------------------- planning */

/** Every key the arrangement names. */
export function namedKeys(doc) {
  const out = new Set();
  Object.values(doc.pages).forEach((list) => list.forEach((s) => keysOf(s).forEach((k) => out.add(k))));
  return out;
}

/** One language file with the words a save creates and the ones it lets go:
    returns the new text, or null when nothing changed. */
export function planLanguage(text, named, given) {
  const doc = JSON.parse(text);
  const before = JSON.stringify(doc);
  const have = leafMap(doc);
  /* let go: `blocks` words no section names any more */
  if (doc.blocks && typeof doc.blocks === "object") {
    for (const key of Object.keys(have)) {
      if (key.indexOf("blocks.") !== 0 || named.has(key)) continue;
      const [, id, part] = key.split(".");
      if (doc.blocks[id]) delete doc.blocks[id][part];
      if (doc.blocks[id] && !Object.keys(doc.blocks[id]).length) delete doc.blocks[id];
    }
    if (!Object.keys(doc.blocks).length) delete doc.blocks;
  }
  /* created: words a section names and the file does not have */
  for (const key of named) {
    if (key.indexOf("blocks.") !== 0 || typeof have[key] === "string") continue;
    const [, id, part] = key.split(".");
    /* what was typed or stood in for it; a value that cannot be stored is
       an empty line, which Needs Work shows as missing */
    const v = (given && typeof given[key] === "string" && cleanValue(given[key])) || "";
    doc.blocks = doc.blocks || {};
    doc.blocks[id] = doc.blocks[id] || {};
    doc.blocks[id][part] = v;
  }
  if (JSON.stringify(doc) === before) return null;
  return JSON.stringify(doc, null, 2) + (text.endsWith("\n") ? "\n" : "");
}

/** site.json with each section's own photo slot made or taken away. */
export function planPhotos(text, doc, before, photos) {
  const site = JSON.parse(text);
  const was = JSON.stringify(site);
  site.images = site.images || {};
  const own = (d) => {
    const ids = new Set();
    Object.values(d.pages || {}).forEach((list) => list.forEach((s) => { if (s.photo && s.photo === s.id) ids.add(s.id); }));
    return ids;
  };
  const now = own(doc), then = own(before);
  for (const id of then) if (!now.has(id)) delete site.images[id];
  for (const id of now) {
    const src = photos && photos[id];
    if (typeof src === "string" && SRC_RE.test(src)) {
      if (!site.images[id] || site.images[id].src !== src) site.images[id] = { src, focal_x: 50, focal_y: 50, zoom: 100 };
    }
  }
  /* a section of its own with no picture yet has no slot, and draws none */
  Object.values(doc.pages).forEach((list) => list.forEach((s) => {
    if (s.photo && s.photo === s.id && !site.images[s.id]) delete s.photo;
  }));
  if (JSON.stringify(site) === was) return null;
  return JSON.stringify(site, null, 2) + (text.endsWith("\n") ? "\n" : "");
}

/* ---------------------------------------------------------------- the door */

export default {
  async fetch(request, env) {
    const g = await gate(request, env);
    if (g.denied) return g.denied;
    const { db, user, me } = g;
    const cfg = githubConfig(env);
    if (cfg.error) return json({ configured: false, reason: cfg.error });

    if (request.method === "GET") {
      const r = await readSections(env, cfg.branch);
      if (r.error) return json({ error: r.error }, r.status);
      const p = parse(r.file);
      if (p.error) return json({ error: `${SECTIONS_PATH} is not valid JSON: ${p.error}` }, 502);
      return json({ doc: p.doc, sha: r.file.sha, seeded: r.seeded });
    }
    if (request.method !== "POST") return json({ error: `${request.method} is not supported here.` }, 405);
    const body = await readJson(request);
    if (!body || body.action !== "save") return json({ error: "Nothing to do." }, 400);

    /* everything read at ONE commit, so the commit made on top of it holds
       exactly what was checked */
    const head = await refSha(env, cfg.branch);
    if (head.error) return json({ error: head.error }, 502);
    const [cur, siteFile] = await Promise.all([readSections(env, head.sha), getFileAt(env, SITE, head.sha)]);
    if (cur.error) return json({ error: cur.error }, cur.status);
    if (siteFile.error) return json({ error: siteFile.error }, 502);
    if (body.sha !== cur.file.sha) {
      return json({ error: "Somebody else changed the site's pages while you were working. Reload to see their changes; yours are kept until you do.",
                    code: "changed" }, 409);
    }
    const before = parse(cur.file), site = parse(siteFile);
    if (before.error || site.error) return json({ error: "A site file is not valid JSON." }, 502);

    const checked = checkSections(body.doc, before.doc);
    if (checked.error) return json({ error: checked.error, code: "refused" }, 400);
    const doc = checked.doc;

    const files = [];
    const siteText = planPhotos(siteFile.text, doc, before.doc, body.photos);
    if (siteText) files.push({ path: SITE, text: siteText });

    const langs = Array.isArray(site.doc.languages) ? site.doc.languages : ["en"];
    const named = namedKeys(doc);
    const given = body.words && typeof body.words === "object" ? body.words : {};
    const langFiles = await Promise.all(langs.map((l) => getFileAt(env, langPath(l), head.sha)));
    for (let i = 0; i < langs.length; i++) {
      if (langFiles[i].error) return json({ error: langFiles[i].error }, 502);
      const text = planLanguage(langFiles[i].text, named, given[langs[i]]);
      if (text) files.push({ path: langPath(langs[i]), text });
    }

    const text = JSON.stringify(doc, null, 2) + "\n";
    if (cur.seeded || text !== cur.file.text) files.unshift({ path: SECTIONS_PATH, text });
    if (!files.length) return json({ ok: true, sha: cur.file.sha, doc, unchanged: true });

    const who = (me && me.user_name) || user.email;
    const made = await commitFiles(env, {
      head: head.sha, files, quiet: true, authorName: who, authorEmail: user.email,
      message: `Site Creator: the pages' sections${files.length > 1 ? ` (${files.length} files)` : ""}`,
    });
    if (made.error) return json({ error: made.error, code: made.status === 409 ? "changed" : undefined }, made.status || 502);

    try {
      await db.query("audit_write", {
        id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), now: new Date().toISOString(),
        user_id: user.email, partner_id: null, action: "sections.save", entity: "content", entity_id: SECTIONS_PATH,
        detail: JSON.stringify({ commit: made.commit, files: files.map((f) => f.path) }),
      });
    } catch (err) { console.error("audit_write failed:", err.message); }

    return json({ ok: true, commit: made.commit, sha: await blobSha(text), doc, files: files.map((f) => f.path) });
  },
};

