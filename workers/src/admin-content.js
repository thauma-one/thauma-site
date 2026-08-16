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
import { getFile, putFile, githubConfig } from "./lib/github.js";

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
export function setLeaf(doc, path, value) {
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
  if (!Object.prototype.hasOwnProperty.call(node, last)) return `${path} is not a path in this file.`;

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

  const applied = [];
  for (const p of paths) {
    const before = leafPaths(doc)[p];
    const problem = setLeaf(doc, p, changes[p]);
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

  const who = (me && me.name) || user.email;
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
