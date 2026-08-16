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
 *
 * WHO THIS AUTHENTICATES AS — and why it is not a person
 * ---------------------------------------------------------------------------
 * Preferred: a GITHUB APP owned by the `thauma-one` organisation.
 *
 * A fine-grained personal access token is always owned by a HUMAN and acts as
 * them. If that person is removed from the organisation the editor stops
 * working; if they leave and keep the account, it goes on working, which is
 * worse. Either way the site's content pipeline hangs off one individual —
 * which SPEC §2 rules out in as many words: "Thauma resources belong to Thauma
 * accounts. This is a hard requirement, not tidiness."
 *
 * An App belongs to the organisation. Nobody's departure touches it, and its
 * installation tokens last an hour and are minted on demand, so there is no
 * expiry date on which the editor quietly stops working.
 *
 * A PAT is still accepted, because a machine account holding one is a
 * legitimate simpler answer and because it makes this module testable without
 * an App. The App wins when both are configured.
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

  const hasApp = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
  const hasPat = !!env.GITHUB_TOKEN;

  if (!hasApp && !hasPat) {
    return { error: "This deploy has no GitHub credential. Install the Thauma " +
      "content App on the repository and set GITHUB_APP_ID, GITHUB_INSTALLATION_ID " +
      "and GITHUB_APP_PRIVATE_KEY — see docs/MIGRATION-RUNBOOK.md, Phase 3." };
  }
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { error: `GITHUB_REPO must look like "owner/name" (got ${repo || "nothing"}).` };
  }
  if (!branch) return { error: "CONTENT_BRANCH is not set on this deploy." };

  // The App wins. A PAT left behind from an earlier setup must not quietly
  // take precedence over the credential the organisation actually owns.
  return { repo, branch, auth: hasApp ? "app" : "pat" };
}

/* ---------------------------------------------------------------------------
   GitHub App authentication

   Two steps, and the first one is not a request:

     1. Sign a short-lived JWT with the App's private key. This proves we are
        the App. It is NOT usable against the repository.
     2. Exchange it for an INSTALLATION token, which is what actually reaches
        the repository, scoped to what the App was granted when it was
        installed.

   The installation token lasts an hour, so it is cached per isolate and
   re-minted a few minutes before it lapses. Minting on every request would be
   two extra round trips on every keystroke-batch save.
   --------------------------------------------------------------------------- */

let tokenCache = { token: null, expiresAt: 0, installationId: null };

/** Test seam — the module-level cache would otherwise leak between tests. */
export function __resetTokenCache() {
  tokenCache = { token: null, expiresAt: 0, installationId: null };
}

/**
 * PEM -> ArrayBuffer, with the one error worth catching by hand.
 *
 * GitHub hands you a PKCS#1 key ("BEGIN RSA PRIVATE KEY"). WebCrypto imports
 * PKCS#8 and nothing else, and its failure for the wrong format is an opaque
 * DOMException that names neither format. So the shape is checked here, where
 * the message can say what to run.
 */
function pemToArrayBuffer(pem) {
  const text = String(pem).trim();
  if (/BEGIN RSA PRIVATE KEY/.test(text)) {
    throw new Error(
      "GITHUB_APP_PRIVATE_KEY is in PKCS#1 format, which WebCrypto cannot import. " +
      "Convert it once: openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt " +
      "-in downloaded.pem -out key-pkcs8.pem — then set the converted file as the secret."
    );
  }
  if (!/BEGIN PRIVATE KEY/.test(text)) {
    throw new Error("GITHUB_APP_PRIVATE_KEY does not look like a PEM private key.");
  }
  const body = text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

const b64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** A JWT proving we are the App. Valid for nine minutes; GitHub's cap is ten. */
async function appJwt(env) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlJson({ alg: "RS256", typ: "JWT" });
  // iat is backdated 60s. GitHub rejects a token whose iat is in ITS future,
  // and a Worker's clock and GitHub's need not agree to the second.
  const payload = b64urlJson({ iat: now - 60, exp: now + 540, iss: String(env.GITHUB_APP_ID) });
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${payload}`)
  );
  return `${head}.${payload}.${b64url(sig)}`;
}

/** The bearer token every repository request carries. */
async function authToken(env, fetchImpl) {
  if (!env.GITHUB_APP_ID) return { token: env.GITHUB_TOKEN };

  const installationId = String(env.GITHUB_INSTALLATION_ID);
  if (tokenCache.token &&
      tokenCache.installationId === installationId &&
      Date.now() < tokenCache.expiresAt) {
    return { token: tokenCache.token };
  }

  let jwt;
  try {
    jwt = await appJwt(env);
  } catch (e) {
    return { error: e.message };
  }

  const res = await fetchImpl(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    },
  });
  if (!res.ok) {
    return { error: "Could not get an installation token — " + (await githubError(res)) +
      ". Check GITHUB_APP_ID and GITHUB_INSTALLATION_ID, and that the App is still installed." };
  }
  const body = await res.json();
  if (!body || !body.token) return { error: "GitHub returned no installation token." };

  // Five minutes of margin, so a token cannot lapse between this check and the
  // request that uses it.
  const expiresAt = body.expires_at
    ? Date.parse(body.expires_at) - 5 * 60 * 1000
    : Date.now() + 55 * 60 * 1000;
  tokenCache = { token: body.token, expiresAt, installationId };
  return { token: body.token };
}

async function headers(env, fetchImpl) {
  const { token, error } = await authToken(env, fetchImpl);
  if (error) return { error };
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    },
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

  const h = await headers(env, fetchImpl);
  if (h.error) return { error: h.error, status: 500 };

  const url = `${API}/repos/${cfg.repo}/contents/${encodeURI(path)}` +
              `?ref=${encodeURIComponent(cfg.branch)}`;

  const res = await fetchImpl(url, { headers: h.headers });

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

  const h = await headers(env, fetchImpl);
  if (h.error) return { error: h.error, status: 500 };

  const url = `${API}/repos/${cfg.repo}/contents/${encodeURI(path)}`;
  const res = await fetchImpl(url, {
    method: "PUT",
    headers: { ...h.headers, "Content-Type": "application/json" },
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

/* ---------------------------------------------------------------------------
   Branches — what is waiting to go live, and putting it there

   Content editing writes files. Publishing moves a BRANCH, which is a
   different kind of act with a different blast radius: a promote carries
   every code change on `dev` as well as the words, and the person pressing
   the button should be able to see that before they press it.
   --------------------------------------------------------------------------- */

/**
 * How far `head` is ahead of `base`, and what is in the gap.
 *
 * Returns commits and changed files as well as the count, because "35 commits
 * ahead" is not informed consent and a list of subjects is.
 */
export async function compareBranches(env, base, head, fetchImpl = fetch) {
  const cfg = githubConfig(env);
  if (cfg.error) return { error: cfg.error, status: 500 };

  const h = await headers(env, fetchImpl);
  if (h.error) return { error: h.error, status: 500 };

  const url = `${API}/repos/${cfg.repo}/compare/` +
              `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  const res = await fetchImpl(url, { headers: h.headers });

  if (res.status === 404) {
    return { error: `One of the branches ${base} or ${head} does not exist in ${cfg.repo}.`, status: 404 };
  }
  if (!res.ok) return { error: await githubError(res), status: 502 };

  const body = await res.json();
  return {
    /* GitHub's own word for the relationship: "ahead", "behind", "identical"
       or "diverged". Passed through rather than re-derived, because "diverged"
       is the case a naive ahead_by > 0 check would render as an ordinary
       promote when it is in fact a merge that can conflict. */
    status_: body.status,
    ahead_by: body.ahead_by || 0,
    behind_by: body.behind_by || 0,
    commits: (body.commits || []).map((c) => ({
      sha: c.sha ? c.sha.slice(0, 7) : "",
      message: (c.commit && c.commit.message ? c.commit.message : "").split("\n")[0],
      author: (c.commit && c.commit.author && c.commit.author.name) || "",
      date: (c.commit && c.commit.author && c.commit.author.date) || "",
    })).reverse(), // newest first, as everything else in this console is
    files: (body.files || []).map((f) => f.filename),
    permalink: body.permalink_url || body.html_url || null,
  };
}

/**
 * Merge `head` into `base`. This is the publish.
 *
 * POST /merges rather than a fast-forward ref update, deliberately. A ref
 * update is tidier while the branches are strictly ahead — but production's
 * own content editor commits to `main`, so `main` WILL eventually hold commits
 * `dev` does not, and a fast-forward would simply start failing on the day
 * somebody fixed a typo on the live site. /merges handles both, and its merge
 * commits double as a record of when each release went out.
 */
export async function mergeBranches(env, { base, head, message }, fetchImpl = fetch) {
  const cfg = githubConfig(env);
  if (cfg.error) return { error: cfg.error, status: 500 };

  const h = await headers(env, fetchImpl);
  if (h.error) return { error: h.error, status: 500 };

  const res = await fetchImpl(`${API}/repos/${cfg.repo}/merges`, {
    method: "POST",
    headers: { ...h.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ base, head, commit_message: message }),
  });

  // 204: nothing to do. Not an error, and saying "failed" here would send
  // somebody looking for a problem that is actually the desired end state.
  if (res.status === 204) return { alreadyUpToDate: true };

  if (res.status === 409) {
    return {
      error: `${head} and ${base} have both changed and git cannot reconcile them ` +
             `automatically. This needs a person with a terminal: merge the two ` +
             `branches locally, resolve the conflict, and push. Nothing was changed.`,
      status: 409,
    };
  }
  if (res.status === 404) {
    return { error: `${base} or ${head} does not exist in ${cfg.repo}.`, status: 404 };
  }
  if (!res.ok) return { error: await githubError(res), status: 502 };

  const body = await res.json();
  return { commit: body.sha, url: body.html_url };
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
