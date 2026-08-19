/**
 * admin-content.js — editing the site's own words
 *
 *   GET /api/admin/content?file=en    read one content file + its SHA
 *   PUT /api/admin/content            apply changes to one file, as a commit
 *
 * Every other endpoint in this Worker writes to D1. This one writes to the
 * REPOSITORY, because that is where the site's words actually live:
 * `src/_data/i18n/*.json` and `src/_data/site.json` are read by Eleventy at
 * build time, so a change is not real until it is committed and deployed.
 * Saving here pushes a commit, the Action builds, and the site changes.
 *
 * THAT MAKES THIS THE MOST DANGEROUS ENDPOINT IN THE WORKER.
 * ---------------------------------------------------------------------------
 * It holds a token that can write to the repository that deploys the site.
 * Everything below exists because of that one sentence.
 *
 *   1. ADMIN ROLE, checked first, failing closed. Same gate as admin.js.
 *   2. THE PATH IS NEVER TAKEN FROM THE REQUEST. The client sends a short key
 *      ("en", "site"); this file derives the path. There is no input that
 *      reaches a path, so there is no traversal to defend against — a request
 *      for `../../.github/workflows/deploy.yml` does not resolve to a key and
 *      is refused before anything is read.
 *   3. THE CLIENT NEVER SENDS A DOCUMENT, ONLY LEAF EDITS. A save is a map of
 *      `home.title` -> new value. The server re-reads the file, applies each
 *      one in place, and writes the result. So:
 *        · keys cannot be added, removed or reordered through this endpoint
 *        · the diff is one line per edited string, not a rewritten file
 *        · a type cannot change — a boolean stays a boolean
 *      Structural change is a git operation, deliberately. A CMS that can
 *      restructure the data its own build depends on can break the build.
 *   4. EVERY COMMIT IS AUDITED, with the paths that changed.
 *
 * WHY THE THREE LANGUAGE FILES ARE SAVED SEPARATELY
 * ---------------------------------------------------------------------------
 * Copy is written one language at a time, so one file per commit is the honest
 * unit and `git log` reads as "Croatian: 4 strings". The Contents API's
 * required SHA then gives conflict detection for nothing: an edit made here and
 * an edit made in VS Code cannot silently overwrite each other.
 *
 * The cost is that a structural change touching all three files atomically is
 * not possible here — which point 3 has already ruled out anyway.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { getFile, putFile, deleteFile, githubConfig } from "./lib/github.js";

/**
 * Which files this endpoint may touch, as a derivation rather than a list.
 *
 * `site` is the settings file. Anything else must be a bare language code, so
 * adding Slovenian is a new JSON file and nothing here changes — while `../`,
 * `foo/bar` and `en.json.bak` all simply fail to be a language code.
 */
export function pathFor(fileKey) {
  const k = String(fileKey || "");
  if (k === "site") return "src/_data/site.json";
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(k)) return `src/_data/i18n/${k}.json`;
  return null;
}

/**
 * Leaves of site.json that this endpoint will not write, whatever is asked.
 *
 * `languages` is the list Eleventy iterates to generate /en/, /hr/ and /sr/.
 * Editing one of its entries through a text box renames a whole section of the
 * site and orphans a translation file — a build failure at best. Adding a
 * language is a code change (a new JSON file has to exist), so it belongs in
 * git with the rest of the change.
 */
const FROZEN = ["languages"];

/**
 * Objects in site.json keyed by language code.
 *
 * Adding a language has to give each of these a slot, and removing one has to
 * take it away — otherwise a new language is registered with no donation form
 * and the Give page quietly shows its placeholder instead, with no setting
 * anywhere to explain why.
 *
 * Named rather than detected. A rule like "any object whose keys look like
 * language codes" would eventually catch something that merely resembles one.
 */
const PER_LANGUAGE_SETTINGS = ["donorbox"];

/** One string is capped so a paste accident cannot commit a novel. */
const MAX_VALUE = 5000;
const MAX_CHANGES = 300;

const isLeaf = (v) => v === null || (typeof v !== "object");

/** Every leaf path in a document, as dotted strings. Array indices are numbers. */
export function leafPaths(obj, prefix = "", out = {}) {
  if (isLeaf(obj)) { out[prefix] = obj; return out; }
  const keys = Array.isArray(obj) ? obj.map((_, i) => String(i)) : Object.keys(obj);
  for (const k of keys) leafPaths(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/**
 * Write one leaf, refusing anything that would change the document's shape.
 *
 * Returns null on success or a sentence explaining the refusal. The refusals
 * matter more than the write: this is the only thing standing between a text
 * box and the data structure the site is built from.
 */
export function setLeaf(doc, path, value, creatable) {
  const parts = String(path).split(".");
  let node = doc;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (node === null || typeof node !== "object") return `${path} is not a path in this file.`;
    if (!Object.prototype.hasOwnProperty.call(node, key)) return `${path} is not a path in this file.`;
    node = node[key];
  }

  const last = parts[parts.length - 1];
  if (node === null || typeof node !== "object") return `${path} is not a path in this file.`;

  if (!Object.prototype.hasOwnProperty.call(node, last)) {
    /* THE ONE ALLOWANCE, and it is narrow on purpose.

       This endpoint refuses to add keys — that is what stops a text box
       restructuring the data the build depends on. But a language added before
       a per-language setting existed has no slot in it, and without this there
       is no way to give it one: the field cannot appear, and if it did the
       save would be refused.

       `creatable` is computed by the caller from the file's OWN language list,
       so the only keys this can invent are `donorbox.<a language the site
       already has>`. Everything else is still refused. */
    if (!creatable || !creatable.has(path)) {
      return `${path} is not a path in this file.`;
    }
    node[last] = typeof value === "string" ? "" : value;   // create it, then set below
  }

  const before = node[last];
  if (!isLeaf(before)) return `${path} is a section, not a value.`;

  // Type-preserving, and the message says which type — "expected a boolean" is
  // actionable in a way that "invalid value" is not.
  const want = before === null ? "null" : typeof before;
  const got = value === null ? "null" : typeof value;
  if (want !== got) return `${path} is a ${want}; got a ${got}.`;
  if (typeof value === "string" && value.length > MAX_VALUE) {
    return `${path} is longer than ${MAX_VALUE} characters.`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return `${path} must be a real number.`;

  node[last] = value;
  return null;
}

/** Resolve the caller and refuse anyone who is not an administrator. */
async function requireAdmin(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  }
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.includes("admin")) {
    return {
      denied: json({
        error: "Editing the site's content is limited to administrators.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me, roles };
}

/** Append to the record. A failed note must not fail the commit it describes. */
async function audit(db, { user, action, entity_id, detail }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: null,
      action,
      entity: "content",
      entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}


/* ---------------------------------------------------------------------------
   Adding a language

   THE ONLY OPERATION HERE THAT CREATES A FILE, and the only one allowed to
   touch `languages` — which the leaf editor refuses on principle, because
   renaming an entry through a text box orphans a translation file. Adding one
   is the opposite: the file is created first, so the list never names something
   that is not there.

   ENGLISH IS THE TEMPLATE, not a separate template file. A fourth copy of the
   key list is a fourth thing that drifts; en.json is guaranteed complete
   because the site is built from it, and it is what a translator reads anyway.

   VALUES ARE BLANK, NOT COPIED. An untranslated string that says the English
   is indistinguishable from a finished one, so it ships as English and nobody
   ever finds it. An empty one is visibly not done, and the Content page
   already counts empties per section, so the work has a progress bar for free.

   TWO COMMITS, IN THIS ORDER, deliberately:

     1. create src/_data/i18n/<code>.json
     2. register it in site.json

   The Contents API writes one file per commit. If the second fails you have an
   unused file — harmless, and retrying fixes it. Reversed, site.json would
   name a file that does not exist and the next build would break. One of those
   is recoverable by pressing the button again.
   --------------------------------------------------------------------------- */

/** Every key of `doc`, with string values emptied. Structure and order kept. */
export function blankLike(doc, code) {
  if (Array.isArray(doc)) return doc.map((v) => blankLike(v, code));
  if (doc && typeof doc === "object") {
    const out = {};
    for (const [k, v] of Object.entries(doc)) out[k] = blankLike(v, code);
    return out;
  }
  // Non-strings are structural (a count, a flag) and are carried across as-is:
  // blanking one would change a type the build depends on.
  return typeof doc === "string" ? "" : doc;
}

/* The catalogue row wants a name and a native name; the request only carries a
   code, because that is genuinely all the person adding it knows. Intl has the
   answer for every code anyone will type — "sl" gives "Slovenian" and
   "slovenščina" — and falls back to the code rather than throwing on something
   exotic, which keeps a valid-but-unusual code addable. */
function languageNames(code) {
  const nameIn = (locale) => {
    try {
      const n = new Intl.DisplayNames([locale], { type: "language" }).of(code);
      return n && n !== code ? n : null;
    } catch { return null; }
  };
  return { name: nameIn("en") || code, native_name: nameIn(code) || nameIn("en") || code };
}

/* THE CATALOGUE IS THE OTHER HALF OF ADDING A LANGUAGE, and for a long time it
   was simply missing. See the note on language_upsert in db/queries.sql: a
   language could be live on the public site and invisible to every screen that
   reads the database, which is the state Slovenian was found in.

   Deliberately NOT fatal. The two git commits are what put the language on the
   site; this is what lets partners publish content in it. If the database is
   unreachable the language is still really added, and reporting failure would
   invite somebody to press the button again — which now fails on "the site
   already has sl". Re-adding repairs it, because the upsert is idempotent. */
async function registerLanguage(db, code) {
  try {
    const next = await db.queryOne("language_next_sort_order", {});
    const { name, native_name } = languageNames(code);
    await db.query("language_upsert", {
      code, name, native_name,
      sort_order: (next && next.sort_order) || 0,
      now: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function addLanguage(request, env, db, user, me, cfg) {
  const body = await readJson(request);
  if (!body) return json({ error: "The request body was not valid JSON." }, 400);

  const code = String(body.code || "").trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(code)) {
    return json({
      error: `"${body.code}" is not a language code. Use two letters — sl, de, it — ` +
             `or a regional code like pt-br.`,
    }, 400);
  }

  // Read the site file and English together: one round trip's worth of waiting
  // for two things we need before deciding anything.
  const [siteFile, enFile] = await Promise.all([
    getFile(env, pathFor("site")),
    getFile(env, pathFor("en")),
  ]);
  if (siteFile.error) return json({ error: siteFile.error }, siteFile.status || 502);
  if (enFile.error) {
    return json({ error: `Cannot read the English file to copy from: ${enFile.error}` }, 502);
  }

  let site, en;
  try {
    site = JSON.parse(siteFile.text);
    en = JSON.parse(enFile.text);
  } catch (e) {
    return json({ error: `A content file is not valid JSON: ${e.message}` }, 502);
  }

  const existing = Array.isArray(site.languages) ? site.languages : [];
  if (existing.includes(code)) {
    return json({ error: `The site already has ${code}.` }, 409);
  }

  // And check the FILE, not just the list — a language can exist as a file
  // that nobody registered, and overwriting it would destroy real work.
  const already = await getFile(env, pathFor(code));
  if (!already.error) {
    return json({
      error: `src/_data/i18n/${code}.json already exists. It is not in the ` +
             `site's language list, so somebody added it by hand — add "${code}" ` +
             `to that list rather than creating the file again.`,
    }, 409);
  }

  const who = (me && me.user_name) || user.email;

  /* ---- 1. the language file ---- */
  const blank = blankLike(en, code);
  if (typeof blank.code === "string") blank.code = code;   // the one value we know
  const trailing = enFile.text.endsWith("\n") ? "\n" : "";

  const made = await putFile(env, {
    path: pathFor(code),
    text: JSON.stringify(blank, null, 2) + trailing,
    // No SHA: this file does not exist yet, and the Contents API treats an
    // absent SHA as "create". The check above is what makes that safe — it is
    // the one place in this endpoint where omitting it is correct.
    sha: undefined,
    create: true,
    message: `Add ${code}: ${Object.keys(en).length} sections, ready to translate`,
    authorName: who,
    authorEmail: user.email,
    quiet: true,
  });
  if (made.error) return json({ error: made.error }, made.status || 502);

  /* ---- 2. register it ---- */
  site.languages = [...existing, code];
  site.visibility = site.visibility || {};
  site.visibility.languages = site.visibility.languages || {};
  /* ON for dev, OFF for live. The whole point: translate it and see it in
     place on dev.thauma.one for as long as it takes, while no visitor can
     reach a page of empty strings. */
  site.visibility.languages[code] = { live: false, dev: true };

  /* PER-LANGUAGE SETTINGS GET A SLOT TOO, or the new language is registered
     and then silently has no donation form — the Give page falls back to its
     placeholder and nobody can see why, because the setting it is looking for
     does not exist to be filled in.
     
     `donorbox` is the only one today. If another per-language object is ever
     added to site.json it needs adding here, and a test asserts that every one
     of them has a key for every language so the omission fails loudly. */
  for (const key of PER_LANGUAGE_SETTINGS) {
    if (site[key] && typeof site[key] === "object" && !Array.isArray(site[key])) {
      if (site[key][code] === undefined) site[key][code] = "";
    }
  }

  const siteTrailing = siteFile.text.endsWith("\n") ? "\n" : "";
  const registered = await putFile(env, {
    path: pathFor("site"),
    text: JSON.stringify(site, null, 2) + siteTrailing,
    sha: siteFile.sha,
    message: `Add ${code} to the site's languages, switched off for visitors`,
    authorName: who,
    authorEmail: user.email,
    quiet: true,
  });
  if (registered.error) {
    // The file exists and is not registered. Say exactly that — the state is
    // recoverable and the next attempt will find the file and explain itself.
    return json({
      error: `Created src/_data/i18n/${code}.json, but could not add it to the ` +
             `site's language list: ${registered.error}`,
      partial: true,
    }, registered.status || 502);
  }

  const catalogue = await registerLanguage(db, code);

  await audit(db, {
    user,
    action: "content.add_language",
    entity_id: code,
    detail: {
      code, strings: Object.keys(leafPaths(en)).length, by: who,
      catalogue: catalogue.ok ? "registered" : `failed: ${catalogue.error}`,
    },
  });

  return json({
    ok: true,
    code,
    strings: Object.keys(leafPaths(en)).length,
    commit: registered.commit,
    /* Said out loud rather than swallowed: the language IS on the site, but
       until this succeeds no partner can write content in it. */
    catalogue: catalogue.ok ? true : false,
    catalogueError: catalogue.ok ? undefined : catalogue.error,
  });
}


/* ---------------------------------------------------------------------------
   Removing a language

   THE MIRROR OF ADDING, INCLUDING THE ORDER — which runs the other way round
   and for the same reason. Adding creates the file first so the list never
   names something absent. Removing DEREGISTERS first, so the list stops naming
   it before it disappears.

   Get that backwards and a failed second step leaves site.json pointing at a
   file that is gone, and the next build fails. This way round the bad case is
   an unreferenced file sitting in the repository, which breaks nothing.

   TYPED CONFIRMATION, CHECKED HERE. Same as deleting a partner: a dialog is a
   suggestion, and this destroys work that exists nowhere else. The count of
   what is being destroyed is computed and returned first, so the person
   confirming is told "47 translated strings" rather than "this cannot be
   undone".
   --------------------------------------------------------------------------- */

const DELETE_WORD = "DELETE";

async function removeLanguage(request, env, db, user, me, cfg) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").trim().toLowerCase();

  if (!/^[a-z]{2}(-[a-z]{2})?$/.test(code)) {
    return json({ error: `"${code}" is not a language code.` }, 400);
  }
  if (code === "en") {
    /* Not a permission problem — a structural one. Every missing translation
       resolves to English; a site without it has nothing to fall back to. */
    return json({
      error: "English cannot be removed. Every missing translation falls back " +
             "to it, so the site needs it to have something to show.",
    }, 400);
  }

  const [siteFile, langFile] = await Promise.all([
    getFile(env, pathFor("site")),
    getFile(env, pathFor(code)),
  ]);
  if (siteFile.error) return json({ error: siteFile.error }, siteFile.status || 502);
  if (langFile.error) {
    return json({ error: `The site has no ${code} file to remove.` }, langFile.status || 404);
  }

  let site, doc;
  try {
    site = JSON.parse(siteFile.text);
    doc = JSON.parse(langFile.text);
  } catch (e) {
    return json({ error: `A content file is not valid JSON: ${e.message}` }, 502);
  }

  /* `code` is excluded: it holds the language code, which this endpoint fills
     in when the file is created. Counting it would report one string of work
     that nobody did. The number exists to answer "how much am I destroying?",
     so it should only count things a person typed. */
  const translated = Object.entries(leafPaths(doc))
    .filter(([path, v]) => path !== "code" && typeof v === "string" && v.trim() !== "")
    .length;

  /* WHAT IS ABOUT TO BE LOST, before it is lost. The browser asks for this
     first, shows the number in the confirmation, and only then sends the word.
     "47 translated strings" is a sentence somebody can weigh; "are you sure"
     is not. */
  if (url.searchParams.get("confirm") !== DELETE_WORD) {
    return json({
      error: `Removing a language needs the word ${DELETE_WORD} typed to confirm.`,
      code,
      translated,
      total: Object.keys(leafPaths(doc)).length,
    }, 400);
  }

  const who = (me && me.user_name) || user.email;

  /* ---- 1. deregister ---- */
  site.languages = (site.languages || []).filter((c) => c !== code);
  if (site.visibility && site.visibility.languages) delete site.visibility.languages[code];

  // The mirror of adding: leave no orphaned per-language settings behind.
  for (const key of PER_LANGUAGE_SETTINGS) {
    if (site[key] && typeof site[key] === "object") delete site[key][code];
  }

  const trailing = siteFile.text.endsWith("\n") ? "\n" : "";
  const dereg = await putFile(env, {
    path: pathFor("site"),
    text: JSON.stringify(site, null, 2) + trailing,
    sha: siteFile.sha,
    message: `Remove ${code} from the site's languages`,
    authorName: who, authorEmail: user.email, quiet: true,
  });
  if (dereg.error) return json({ error: dereg.error }, dereg.status || 502);

  /* ---- 2. delete the file ---- */
  const gone = await deleteFile(env, {
    path: pathFor(code),
    sha: langFile.sha,
    message: `Delete ${code}: ${translated} translated strings`,
    authorName: who, authorEmail: user.email, quiet: true,
  });
  if (gone.error) {
    // Deregistered but the file survives. Harmless to the build, and worth
    // saying precisely, because the next attempt will find no registration.
    return json({
      error: `Removed ${code} from the site, but its file could not be ` +
             `deleted: ${gone.error} The site will not build it either way.`,
      partial: true,
    }, gone.status || 502);
  }

  /* SWITCHED OFF IN THE CATALOGUE, NOT DELETED FROM IT — see
     language_deactivate. Translations already written stay attached, so a
     language that comes back finds its work rather than a blank slate. Like
     the registration on the way in, a database failure here does not fail the
     removal: the language is off the site either way. */
  let deactivated = false;
  try {
    await db.query("language_deactivate", { code });
    deactivated = true;
  } catch (e) { /* reported in the audit detail below */ }

  await audit(db, {
    user,
    action: "content.remove_language",
    entity_id: code,
    detail: { code, translated, by: who, catalogue: deactivated ? "deactivated" : "unchanged" },
  });

  return json({ ok: true, code, translated, commit: gone.commit });
}

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;

    const url = new URL(request.url);
    const cfg = githubConfig(env);

    /* Configuration is reported rather than thrown. The page can then say
       "the editor is not connected yet" and stay usable, instead of showing a
       500 that looks like the site is broken. */
    if (cfg.error && request.method === "GET" && url.searchParams.get("file") === null) {
      return json({ configured: false, reason: cfg.error }, 200);
    }
    if (cfg.error) return json({ error: cfg.error, configured: false }, 500);

    if (request.method === "GET") return read(env, url);
    if (request.method === "PUT") return write(request, env, db, user, me, cfg);
    if (request.method === "POST") return addLanguage(request, env, db, user, me, cfg);
    if (request.method === "DELETE") return removeLanguage(request, env, db, user, me, cfg);

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};

/* --------------------------------- read --------------------------------- */

async function read(env, url) {
  const fileKey = url.searchParams.get("file");
  const path = pathFor(fileKey);
  if (!path) {
    return json({ error: `"${fileKey}" is not an editable file.` }, 400);
  }

  const res = await getFile(env, path);
  if (res.error) return json({ error: res.error, path }, res.status || 502);

  let data;
  try {
    data = JSON.parse(res.text);
  } catch (e) {
    // The file is in the repository and does not parse. Saying so precisely
    // beats "could not load": somebody hand-edited it and the build is broken
    // too, which is a different job from anything this page can do.
    return json({ error: `${path} is in the repository but is not valid JSON: ${e.message}`, path }, 502);
  }

  const cfg = githubConfig(env);
  return json({
    configured: true,
    file: fileKey,
    path,
    sha: res.sha,
    data,
    repo: cfg.repo,
    branch: cfg.branch,
    frozen: fileKey === "site" ? FROZEN : [],
  });
}

/* --------------------------------- write -------------------------------- */

async function write(request, env, db, user, me, cfg) {
  const body = await readJson(request);
  if (!body) return json({ error: "The request body was not valid JSON." }, 400);

  const path = pathFor(body.file);
  if (!path) return json({ error: `"${body.file}" is not an editable file.` }, 400);
  if (!body.sha) return json({ error: "Missing the SHA of the file being edited. Reload the page." }, 400);

  const changes = body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    return json({ error: "`changes` must be an object of path -> value." }, 400);
  }
  const paths = Object.keys(changes);
  if (!paths.length) return json({ error: "There is nothing to save." }, 400);
  if (paths.length > MAX_CHANGES) {
    return json({ error: `That is ${paths.length} changes at once; the limit is ${MAX_CHANGES}.` }, 400);
  }

  if (body.file === "site") {
    const frozen = paths.filter((p) => FROZEN.some((f) => p === f || p.startsWith(f + ".")));
    if (frozen.length) {
      return json({
        error: `${frozen.join(", ")} cannot be changed here. The site's language list ` +
               `decides which pages exist, so it changes in git alongside the files it names.`,
      }, 400);
    }
  }

  /* Re-read rather than trusting the browser's copy. The document written is
     built from what is in the repository RIGHT NOW plus the specific leaves
     being changed, so nothing the client forgot to send can be lost. */
  const current = await getFile(env, path);
  if (current.error) return json({ error: current.error, path }, current.status || 502);

  if (current.sha !== body.sha) {
    return json({
      error: "This file changed after you opened it. Reload the page to pick up " +
             "the current version — nothing was written.",
      path, sha: current.sha,
    }, 409);
  }

  let doc;
  try {
    doc = JSON.parse(current.text);
  } catch (e) {
    return json({ error: `${path} is not valid JSON in the repository: ${e.message}` }, 502);
  }

  /* Slots a per-language setting is missing for a language the site HAS.
     Computed from the file itself, not from the request — so this can only
     ever fill a gap the file already implies, never invent a language. */
  const creatable = new Set();
  if (body.file === "site" && Array.isArray(doc.languages)) {
    for (const key of PER_LANGUAGE_SETTINGS) {
      const obj = doc[key];
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
      for (const code of doc.languages) {
        if (obj[code] === undefined) creatable.add(`${key}.${code}`);
      }
    }
  }

  const applied = [];
  for (const p of paths) {
    const before = leafPaths(doc)[p];
    const problem = setLeaf(doc, p, changes[p], creatable);
    if (problem) return json({ error: problem, path: p }, 400);
    if (before !== changes[p]) applied.push(p);
  }

  if (!applied.length) {
    // Everything submitted already held the submitted value. Saying so is more
    // honest than an empty commit, and stops a stuck save button looking like
    // a success.
    return json({ ok: true, unchanged: true, sha: current.sha, path });
  }

  // Byte-identical to how these files are already formatted — verified against
  // all four. The trailing newline is preserved per file rather than imposed,
  // so saving never produces a diff nobody asked for.
  const trailing = current.text.endsWith("\n") ? "\n" : "";
  const text = JSON.stringify(doc, null, 2) + trailing;

  const who = (me && me.user_name) || user.email;
  const label = body.file === "site" ? "site settings" : `${body.file} content`;
  const message =
    `Update ${label}: ${applied.length} ${applied.length === 1 ? "value" : "values"}\n\n` +
    applied.map((p) => `  ${p}`).join("\n") +
    `\n\nEdited by ${who} in the Thauma admin console.`;

  const res = await putFile(env, {
    path, text, sha: current.sha, message,
    /* QUIET. Saving is not publishing — the commit lands and nothing deploys
       until somebody presses Publish. This one word is the difference between
       an editor you can think in and one where every keystroke batch is live. */
    quiet: true,
    authorName: who,
    // The commit is attributed to the person, but the address is the one Access
    // authenticated — not a name typed into a field.
    authorEmail: user.email,
  });
  if (res.error) return json({ error: res.error, path }, res.status || 502);

  await audit(db, {
    user,
    action: "content.commit",
    entity_id: path,
    detail: { file: body.file, paths: applied, commit: res.commit, branch: cfg.branch },
  });

  return json({
    ok: true,
    path,
    sha: res.sha,
    commit: res.commit,
    commit_url: res.url,
    changed: applied,
    branch: cfg.branch,
  });
}
