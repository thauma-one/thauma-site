/**
 * github.js — read and write files in the site's own repository
 *
 * The content editor has no database to write to. The site's words live in
 * `src/_data/i18n/*.json` and its settings in `src/_data/site.json`, both
 * consumed by Eleventy at build time, so "saving" means committing — and the
 * deploy that follows is what makes the change real.
 *
 * WHY THE CONTENTS API AND NOT THE GIT DATA API
 * ---------------------------------------------------------------------------
 * The Contents API writes ONE file per commit and demands the SHA of the blob
 * being replaced. That second part is the whole reason to use it: the SHA is
 * optimistic locking for free. Somebody editing Croatian in this console and
 * somebody editing the same file in VS Code cannot silently overwrite each
 * other — the second write arrives with a stale SHA and GitHub returns 409.
 *
 * The Git Data API can commit several files at once, which would be nicer for
 * a structural change touching every language. It is also four round trips and
 * a hand-rolled ref update, and nothing here needs it yet: an edit is made in
 * one language at a time, so one file per commit is the natural unit. If
 * add/remove-a-key ever ships, that is when to reach for it.
 *
 * ⚠ BASE64 IS NOT btoa()
 * ---------------------------------------------------------------------------
 * `btoa` throws on any code point above U+00FF, and `atob` returns one byte per
 * character. The files this module exists to move are Croatian and Serbian —
 * `š`, `ž`, `Ђ`, `Ћ` — so the naive pair is wrong for the exact payload it will
 * always be handed. It does not fail gracefully either: `atob` silently mangles
 * multi-byte characters into mojibake, which would be committed and deployed.
 *
 * Encode through TextEncoder, decode through TextDecoder, always. There are
 * tests for round-tripping Cyrillic and an emoji specifically because this is
 * the kind of bug that passes every English test.
 */

const API = "https://api.github.com";

/* GitHub requires a User-Agent and rejects requests without one. Naming the
   Worker means a rate-limit complaint arrives with something to search for. */
const UA = "thauma-worker-content-editor";

/** UTF-8 text -> base64. */
export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  // A chunked loop, not String.fromCharCode(...bytes): spreading a 25 kB file
  // is 25 000 arguments, and the largest of these files is already 24 kB.
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** base64 -> UTF-8 text. GitHub wraps its base64 at 60 columns, hence the strip. */
export function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Configuration, resolved once and checked.
 *
 * Fails loudly and specifically. "Not configured" and "configured wrongly" are
 * different afternoons, and a content editor that returns a bare 500 sends
 * somebody looking at the database.
 */
export function githubConfig(env) {
  const repo = env.GITHUB_REPO;
  const branch = env.CONTENT_BRANCH;
  const token = env.GITHUB_TOKEN;

  if (!token) {
    return { error: "GITHUB_TOKEN is not set on this deploy. " +
      "Create a fine-grained token scoped to this repository with Contents: " +
      "read and write, then `wrangler secret put GITHUB_TOKEN`." };
  }
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { error: `GITHUB_REPO must look like "owner/name" (got ${repo || "nothing"}).` };
  }
  if (!branch) return { error: "CONTENT_BRANCH is not set on this deploy." };

  return { repo, branch, token };
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": UA,
  };
}

/**
 * Read one file at the configured branch.
 *
 * Returns { text, sha }. The SHA is the blob's, not the commit's, and it is
 * what putFile must be handed back — carry it through the browser untouched.
 */
export async function getFile(env, path, fetchImpl = fetch) {
  const cfg = githubConfig(env);
  if (cfg.error) return { error: cfg.error, status: 500 };

  const url = `${API}/repos/${cfg.repo}/contents/${encodeURI(path)}` +
              `?ref=${encodeURIComponent(cfg.branch)}`;

  const res = await fetchImpl(url, { headers: headers(cfg.token) });

  if (res.status === 404) {
    return { error: `${path} is not in ${cfg.repo} on ${cfg.branch}.`, status: 404 };
  }
  if (!res.ok) {
    return { error: await githubError(res), status: res.status === 401 || res.status === 403 ? 502 : 502 };
  }

  const body = await res.json();
  if (body.type !== "file" || typeof body.content !== "string") {
    return { error: `${path} is not a file.`, status: 502 };
  }
  return { text: fromBase64(body.content), sha: body.sha };
}

/**
 * Replace one file, refusing if it moved underneath us.
 *
 * `sha` is required, deliberately. The Contents API treats an ABSENT sha as
 * "create this file", which for an existing path means "overwrite whatever is
 * there" — the precise accident this whole mechanism is meant to prevent. A
 * caller that has genuinely lost the SHA should re-read the file, not omit it.
 */
export async function putFile(env, { path, text, sha, message, authorName, authorEmail }, fetchImpl = fetch) {
  const cfg = githubConfig(env);
  if (cfg.error) return { error: cfg.error, status: 500 };
  if (!sha) return { error: "Refusing to write without the SHA of the file being replaced.", status: 400 };

  const url = `${API}/repos/${cfg.repo}/contents/${encodeURI(path)}`;
  const res = await fetchImpl(url, {
    method: "PUT",
    headers: { ...headers(cfg.token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: toBase64(text),
      sha,
      branch: cfg.branch,
      // Attribution is the point of an audit trail somebody else can read.
      // `git log` should name the person who typed the words, not the Worker.
      committer: { name: authorName || "Thauma console", email: authorEmail || "admin@thauma.one" },
      author: { name: authorName || "Thauma console", email: authorEmail || "admin@thauma.one" },
    }),
  });

  if (res.status === 409 || res.status === 422) {
    return {
      error: "This file changed after you opened it — your copy is out of date. " +
             "Reload the page to pick up the current version. Nothing was written.",
      status: 409,
    };
  }
  if (!res.ok) return { error: await githubError(res), status: 502 };

  const body = await res.json();
  return {
    sha: body.content && body.content.sha,
    commit: body.commit && body.commit.sha,
    url: body.commit && body.commit.html_url,
  };
}

/** GitHub's own message if it sent one — it is usually the useful part. */
async function githubError(res) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body && body.message ? ` — ${body.message}` : "";
  } catch { /* not JSON; the status is all we have */ }
  return `GitHub returned ${res.status}${detail}`;
}
