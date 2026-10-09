/**
 * admin-translate.js — /api/admin/translate, every line of every language
 *
 *   GET                            the site's languages
 *   GET  ?summary                  every language's progress: total lines,
 *                                  missing, outdated
 *   GET  ?lang=hr                  every translatable line for Croatian, with
 *                                  its status: missing, outdated or done
 *   POST { action: "file", lang, ids? }
 *                                  the translation file for those lines
 *                                  (default: everything missing or outdated)
 *   POST { action: "review", text }
 *                                  a returned file, read and checked line by
 *                                  line — nothing is saved
 *   POST { action: "apply", lang, items: [{ id, value, was, english_hash }] }
 *                                  the lines a person approved, saved
 *   POST { action: "save", lang, items: [{ id, value, was }] }
 *                                  the Content page's own edits, English
 *                                  included; a translation may be cleared
 *
 * THE CONTENT PAGE IS BUILT ON THIS (part 4 of the language work): every
 * line of a language, English above it, and whether it is missing or
 * outdated, comes from GET ?lang=; its Save is "save".
 *
 * THE ROUTE CLAUDE TRANSLATES THROUGH, for free (Chase, 2026-09-26): download
 * the file, hand it to Claude in a chat or a session, bring it back, approve.
 * Every translation needs a person's approval before it is saved, so "review"
 * and "apply" are separate calls and only the second one writes.
 *
 * WHAT IT COVERS: the site's words (src/_data/i18n/<lang>.json) and the words
 * of the emails, confirm/unsubscribe pages and sign-up and contact forms
 * (src/_data/emailsAndForms.json) — everything Thauma itself writes that a
 * visitor reads. The console's own words may lag behind (Chase, 2026-09-26)
 * and are not here. A partner's own milestones and prayer are written by that
 * partner in the staff console, not here.
 *
 * SAVING IS A COMMIT, like the Content page — one per file, quiet, so nothing
 * goes live until Publish. Same people as the Content page (EDITORS), because
 * it writes the same files.
 *
 * REMOVING A LANGUAGE LEAVES ITS EMAIL WORDS IN emailsAndForms.json. That is
 * deliberate and matches the language catalog: work already done stays
 * attached, so a language that comes back finds it, and the Worker only ever
 * looks a language up — an unused one costs nothing.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { getFile, getFileAt, putFile, compareBranches, githubConfig } from "./lib/github.js";
import { EDITORS } from "./admin-content.js";
import { loadNotes, briefFor } from "./lib/translation-notes.js";
import {
  SOURCES, linesFor, leafMap, withStatus, buildFile, readFile, checkLine, cleanValue, setLine, hashText,
} from "./lib/translation-file.js";

const SITE = "src/_data/site.json";
const EMAILS = "src/_data/emailsAndForms.json";
const langPath = (code) => `src/_data/i18n/${code}.json`;

const MAX_FILE = 2_000_000;
const MAX_ITEMS = 2000;

async function gate(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  }
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.some((r) => EDITORS.includes(r))) {
    return { denied: json({ error: "Translating the site needs the administrator or communications role." }, 403) };
  }
  return { db, user, me };
}

async function audit(db, user, entityId, detail) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: null,
      action: "translate.apply",
      entity: "content",
      entity_id: entityId,
      detail: JSON.stringify(detail),
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

const parse = (file) => {
  try { return { doc: JSON.parse(file.text) }; }
  catch (e) { return { error: e.message }; }
};

/** The site's languages, from site.json on the content branch — the truth,
    not the page's build, which can lag a language added a minute ago. */
async function siteLanguages(env) {
  const file = await getFile(env, SITE);
  if (file.error) return { error: file.error, status: file.status || 502 };
  const p = parse(file);
  if (p.error) return { error: `${SITE} is not valid JSON: ${p.error}`, status: 502 };
  return { languages: Array.isArray(p.doc.languages) ? p.doc.languages : ["en"] };
}

/**
 * Everything about one language's translation work, read fresh.
 *
 * The emails file may be absent on the content branch: it arrived on `dev`
 * and reaches `main` with the next merge. Until then that group is reported
 * as not there yet rather than failing the whole page.
 */
/* Everything a language needs, read in ONE round trip to GitHub: the site's
   language list, English, the language, and the emails. These used to be two
   rounds (the list, then the files) — at about 100–140ms a read, measured, the
   difference is visible on every screen that opens a language. `shared` lets
   a caller that opens several languages read the common files once. */
async function readFiles(env, lang, shared) {
  const isEn = lang === "en";
  const [siteFile, enFile, langFile, emailsFile] = await Promise.all([
    shared ? shared.site : getFile(env, SITE),
    shared ? shared.en : getFile(env, langPath("en")),
    isEn || !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lang) ? null : getFile(env, langPath(lang)),
    shared ? shared.emails : getFile(env, EMAILS),
  ]);
  return { siteFile, enFile, langFile: isEn ? enFile : langFile, emailsFile };
}

async function load(env, db, lang, { english = false, shared = null } = {}) {
  const { siteFile, enFile, langFile, emailsFile } = await readFiles(env, lang, shared);
  if (siteFile.error) return { error: siteFile.error, status: siteFile.status || 502 };
  const sp = parse(siteFile);
  if (sp.error) return { error: `${SITE} is not valid JSON: ${sp.error}`, status: 502 };
  const langs = { languages: Array.isArray(sp.doc.languages) ? sp.doc.languages : ["en"] };
  if ((lang === "en" && !english) || !langs.languages.includes(lang) || !langFile) {
    return { error: `The site has no language "${lang}" to translate into.`, code: "no-language", status: 400 };
  }
  const isEn = lang === "en";
  for (const f of [enFile, langFile]) if (f.error) return { error: f.error, status: f.status || 502 };
  const en = parse(enFile), mine = parse(langFile);
  if (en.error || mine.error) return { error: `A language file is not valid JSON: ${en.error || mine.error}`, status: 502 };

  const nl = (f) => (f.text.endsWith("\n") ? "\n" : "");
  const files = { site: { path: langPath(lang), sha: langFile.sha, doc: mine.doc, trailing: nl(langFile) } };
  const unavailable = [];
  let lines = linesFor("site", en.doc, mine.doc);

  if (emailsFile.error) {
    if (emailsFile.status !== 404) return { error: emailsFile.error, status: emailsFile.status || 502 };
    unavailable.push("emails");
  } else {
    const emails = parse(emailsFile);
    if (emails.error) return { error: `${EMAILS} is not valid JSON: ${emails.error}`, status: 502 };
    files.emails = { path: EMAILS, sha: emailsFile.sha, doc: emails.doc, trailing: nl(emailsFile) };
    lines = lines.concat(linesFor("emails", emails.doc.en, emails.doc[lang]));
  }

  const state = isEn ? [] : await db.query("translation_state_for_lang", { lang });
  const { lines: withS, baseline, refresh } = await withStatus(lines, state);
  const now = new Date().toISOString();
  if (!isEn && baseline.length) {
    await db.query("translation_state_baseline", { lang, rows: JSON.stringify(baseline), now });
  }
  if (!isEn && refresh.length) {
    await db.query("translation_state_confirm", { lang, rows: JSON.stringify(refresh), now, user_id: null });
  }
  const name = typeof mine.doc.name === "string" && mine.doc.name.trim() ? mine.doc.name.trim() : lang;
  return { lang, name, languages: langs.languages, lines: withS, files, unavailable, englishSite: en.doc };
}

/* WORDS CHANGED ON DEV AND NOT PUBLISHED YET (2026-10-08). The words are
   saved on the site's branch, but a code change can alter them on `dev` —
   line breaks measured into the headings did — and dev.thauma.one draws dev's
   copy. Without this the editor showed "Three expressions of one ministry."
   on one line while the page beside it showed two.

   Per line, dev's text when dev changed it since the two branches last
   agreed and it differs from the saved one. Against the merge base, not a
   plain comparison: a word saved a minute ago is on `main` and not yet on
   `dev` (sync-dev.yml runs every ten minutes), and that is not a change
   waiting on dev — the base tells the two apart. Publish carries these
   across; until then the editor shows them and does not edit them, so a save
   cannot collide with them in the merge.

   Quiet on failure: the editor works as before without it. */
export async function waitingOnDev(env, wanted, fetchImpl = fetch) {
  const cfg = githubConfig(env);
  const dev = env.STAGING_BRANCH;
  if (cfg.error || !dev || dev === cfg.branch) return {};
  const cmp = await compareBranches(env, cfg.branch, dev, fetchImpl);
  if (cmp.error || !cmp.merge_base) return {};
  const out = {};
  await Promise.all(wanted.filter((w) => cmp.files.includes(w.path)).map(async (w) => {
    const [d, b] = await Promise.all([getFileAt(env, w.path, dev, fetchImpl), getFileAt(env, w.path, cmp.merge_base, fetchImpl)]);
    if (d.error) return;
    const dp = parse(d), bp = b.error ? { doc: {} } : parse(b);
    if (dp.error || bp.error) return;
    const now = leafMap(w.doc || {}), then = leafMap(bp.doc), next = leafMap(dp.doc);
    const map = {};
    for (const [key, v] of Object.entries(next)) {
      if (typeof v === "string" && v !== then[key] && v !== now[key]) map[key] = v;
    }
    out[w.path] = map;
  }));
  return out;
}

/* English text by key, for the split-heading notes — site words only, where
   the _thin/_bold convention lives. */
const englishByKey = (lines) =>
  Object.fromEntries(lines.filter((l) => l.source === "site").map((l) => [l.key, l.english]));

const fail = (r) => json({ error: r.error, code: r.code }, r.status || 400);

export default {
  async fetch(request, env) {
    const g = await gate(request, env);
    if (g.denied) return g.denied;
    const { db, user, me } = g;

    if (request.method === "GET") {
      /* EVERY LANGUAGE'S PROGRESS AT ONCE, for the languages table on the
         Content page ("189 of 189"). One read of each file rather than one
         request per language from the browser. */
      if (new URL(request.url).searchParams.has("summary")) {
        const [site, en, emails] = await Promise.all([
          getFile(env, SITE), getFile(env, langPath("en")), getFile(env, EMAILS)]);
        if (site.error) return fail({ error: site.error, status: site.status || 502 });
        const sp = parse(site);
        if (sp.error) return fail({ error: `${SITE} is not valid JSON: ${sp.error}`, status: 502 });
        const codes = Array.isArray(sp.doc.languages) ? sp.doc.languages : ["en"];
        /* Every language at once, sharing the three common files. */
        const shared = { site, en, emails };
        const results = await Promise.all(codes.map((code) => load(env, db, code, { english: true, shared })));
        const out = [];
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i], r = results[i];
          if (r.error) { out.push({ code, error: r.error }); continue; }
          const count = (st) => r.lines.filter((l) => l.status === st).length;
          out.push({ code, name: r.name, total: r.lines.length,
                     missing: code === "en" ? 0 : count("missing"),
                     outdated: code === "en" ? 0 : count("outdated") });
        }
        return json({ languages: out });
      }
      const lang = new URL(request.url).searchParams.get("lang");
      if (!lang) {
        const r = await siteLanguages(env);
        return r.error ? fail(r) : json({ languages: r.languages });
      }
      const r = await load(env, db, String(lang).toLowerCase(), { english: true });
      if (r.error) return fail(r);
      const waiting = await waitingOnDev(env, [
        { path: langPath(r.lang), doc: r.files.site.doc },
        ...(r.lang === "en" ? [] : [{ path: langPath("en"), doc: r.englishSite }]),
      ]);
      const mine = waiting[langPath(r.lang)] || {}, eng = waiting[langPath("en")] || {};
      return json({
        lang: r.lang, name: r.name, languages: r.languages, unavailable: r.unavailable,
        lines: r.lines.map(({ id, source, key, english, current, status }) => {
          const line = { id, source, key, english, current, status };
          if (source === "site" && key in mine) line.waiting = mine[key];
          if (source === "site" && key in eng) line.english = r.lang === "en" ? english : eng[key];
          return line;
        }),
      });
    }

    if (request.method !== "POST") return json({ error: `${request.method} is not supported here.` }, 405);
    const body = await readJson(request);
    if (!body) return json({ error: "The request body was not valid JSON." }, 400);

    /* ---- the file ---- */
    if (body.action === "file") {
      const r = await load(env, db, String(body.lang || "").toLowerCase());
      if (r.error) return fail(r);
      const wanted = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
      const lines = r.lines.filter((l) => wanted ? wanted.has(l.id) : l.status !== "done");
      if (!lines.length) return json({ error: "Nothing was chosen to translate.", code: "nothing" }, 400);
      const notes = await loadNotes(db);
      const text = buildFile({
        lang: r.lang, langName: r.name, brief: briefFor(notes, r.lang, r.name),
        lines, englishByKey: englishByKey(r.lines),
      });
      return json({ filename: `thauma-${r.lang}-${new Date().toISOString().slice(0, 10)}.csv`, text, lines: lines.length });
    }

    /* ---- a returned file, checked, nothing saved ---- */
    if (body.action === "review") {
      if (typeof body.text !== "string" || body.text.length > MAX_FILE) {
        return json({ error: "That file could not be read.", code: "not-a-file" }, 400);
      }
      const file = readFile(body.text);
      if (file.error) return json({ error: "That file could not be read.", code: file.error }, 400);
      const r = await load(env, db, file.lang);
      if (r.error) return json({ error: r.error, code: r.code, lang: file.lang }, r.status || 400);
      const notes = await loadNotes(db);
      const byId = new Map(r.lines.map((l) => [l.id, l]));

      let unknown = 0, blank = 0, unchanged = 0;
      const items = [];
      for (const { id, value } of file.entries) {
        const line = byId.get(id);
        if (!line) { unknown++; continue; }
        if (!value) { blank++; continue; }
        // The same words again only mean something when the English moved:
        // then they say "this is still right".
        if (value === line.current && line.status !== "outdated") { unchanged++; continue; }
        items.push({
          id, source: line.source, key: line.key, english: line.english, english_hash: line.english_hash,
          current: line.current, proposed: value, status: line.status,
          ...checkLine({ english: line.english, proposed: value, lang: r.lang, notes }),
        });
      }
      return json({ lang: r.lang, name: r.name, items, skipped: { unknown, blank, unchanged } });
    }

    /* ---- lines saved: approved from a file, or edited on the page ----

       Two doors, one room. "apply" is a returned file's approved lines;
       "save" is the Content page's own edits, where a line may also be
       cleared (an empty translation is an untranslated one, and shows in
       English). Both are checked here again — what the browser sends is a
       request, and the one thing that must never reach the site is a broken
       placeholder — and both commit one file per source, quietly. */
    if (body.action === "apply" || body.action === "save") {
      const editing = body.action === "save";
      const items = Array.isArray(body.items) ? body.items : null;
      if (!items || !items.length) return json({ error: "Nothing to save.", code: "nothing" }, 400);
      if (items.length > MAX_ITEMS) return json({ error: "Too many lines at once." }, 400);

      const r = await load(env, db, String(body.lang || "").toLowerCase(), { english: editing });
      if (r.error) return fail(r);
      const isEn = r.lang === "en";
      const notes = await loadNotes(db);
      const byId = new Map(r.lines.map((l) => [l.id, l]));

      const broken = [];
      const conflicts = [];
      const plan = { site: [], emails: [] };
      for (const it of items) {
        const line = byId.get(String(it && it.id));
        /* not .trim(): cleanValue keeps a heading's closing line break */
        const raw = it && typeof it.value === "string" ? it.value : null;
        /* Cleared: only on the page, and never English — every other language
           falls back to it, so an empty English line is an empty page. */
        const cleared = editing && !isEn && raw !== null && raw.trim() === "";
        const value = cleared ? "" : cleanValue(raw);
        if (!line || value === null) { broken.push(String(it && it.id)); continue; }
        /* English is checked against the English it replaces: the code fills
           in {placeholders} by name, so a lost one breaks every language. */
        const against = isEn ? line.current : line.english;
        if (!cleared && checkLine({ english: against, proposed: value, lang: r.lang, notes }).problems.length) {
          broken.push(line.id); continue;
        }
        /* Changed by somebody else since it was read — theirs stands, and the
           line is reported so it can be looked at again. */
        if (typeof it.was === "string" && it.was !== line.current) { conflicts.push(line.id); continue; }
        const hash = /^[0-9a-f]{16}$/.test(String(it.english_hash)) ? it.english_hash : line.english_hash;
        plan[line.source].push({ line, value, hash, text_hash: await hashText(value), waiting: !!(it && it.waiting === true) });
      }
      if (broken.length) return json({ error: "Some lines cannot be saved as they are.", code: "problems", ids: broken }, 400);

      const who = (me && me.user_name) || user.email;
      const now = new Date().toISOString();
      const verb = editing ? "edited" : "approved";
      const saved = [];
      const devMissed = [];
      for (const source of Object.keys(plan)) {
        const todo = plan[source];
        if (!todo.length) continue;
        const f = r.files[source];
        if (!f) return json({ error: `${SOURCES[source].label} are not available on this branch yet.`, code: "not-yet" }, 409);

        const doc = f.doc;
        const edits = todo.filter((t) => t.value !== t.line.current);
        for (const t of edits) {
          const ok = source === "site"
            ? setLine(doc, r.englishSite, t.line.key, t.value)
            : setLine(doc[r.lang] || (doc[r.lang] = {}), doc.en, t.line.key, t.value);
          if (!ok) return json({ error: `${t.line.id} has no place in ${f.path}.` }, 400);
        }

        if (edits.length) {
          const noun = editing ? (edits.length === 1 ? "line" : "lines")
                               : (edits.length === 1 ? "translation" : "translations");
          const res = await putFile(env, {
            path: f.path, text: JSON.stringify(doc, null, 2) + f.trailing, sha: f.sha,
            message: `${r.name} (${r.lang}): ${edits.length} ${noun} ${verb}\n\n` +
              edits.map((t) => `  ${t.line.key}`).join("\n") +
              `\n\n${verb === "edited" ? "Edited" : "Approved"} by ${who} in the Thauma admin console.`,
            quiet: true, authorName: who, authorEmail: user.email,
          });
          if (res.error) {
            return json({ error: res.error, saved: saved.length, partial: saved.length > 0 }, res.status || 502);
          }
          await audit(db, user, f.path, {
            lang: r.lang, keys: edits.map((t) => t.line.key), commit: res.commit, how: body.action,
          });
        }
        /* A LINE WAITING ON DEV (waitingOnDev) is written to dev as well, so
           the two copies say the same thing: dev.thauma.one shows the edit at
           once, and Publish's merge finds the same change on both sides
           rather than two different ones to choose between. That is what
           lets the editor leave these lines open (2026-10-08, Chase: "why
           can't I edit the values right now"). */
        const toDev = editing && source === "site" ? todo.filter((t) => t.waiting) : [];
        if (toDev.length && env.STAGING_BRANCH) {
          const dev = env.STAGING_BRANCH;
          const df = await getFileAt(env, f.path, dev);
          const dp = df.error ? { error: df.error } : parse(df);
          let dres = dp.error ? { error: dp.error } : null;
          if (!dres) {
            for (const t of toDev) setLine(dp.doc, r.englishSite, t.line.key, t.value);
            dres = await putFile(env, {
              path: f.path, text: JSON.stringify(dp.doc, null, 2) + (df.text.endsWith("\n") ? "\n" : ""), sha: df.sha, branch: dev,
              message: `${r.name} (${r.lang}): ${toDev.length} ${toDev.length === 1 ? "line" : "lines"} edited, kept the same on ${dev}\n\n` +
                toDev.map((t) => `  ${t.line.key}`).join("\n") + `\n\nEdited by ${who} in the Thauma admin console.`,
              quiet: true, authorName: who, authorEmail: user.email,
            });
          }
          if (dres.error) devMissed.push(...toDev.map((t) => t.line.id));
        }
        /* Recorded after the commit, never before: the database must not say
           a translation matches its English while the file does not have it.
           English has nothing to record — it is what the others are measured
           against — and a cleared line is simply missing. */
        const rows = isEn ? [] : todo.filter((t) => t.value)
          .map((t) => ({ source, key: t.line.key, english_hash: t.hash, text_hash: t.text_hash }));
        if (rows.length) {
          await db.query("translation_state_confirm", {
            lang: r.lang, now, user_id: me.user_id, rows: JSON.stringify(rows),
          });
        }
        saved.push(...todo.map((t) => t.line.id));
      }
      return json({ ok: true, saved: saved.length, conflicts, ...(devMissed.length ? { devMissed } : {}) });
    }

    return json({ error: "Unknown action." }, 400);
  },
};
