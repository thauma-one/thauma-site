/**
 * admin-publish.js — moving what is on the working branch to the live one
 *
 *   GET  /api/admin/publish    what is waiting, and what is in it
 *   POST /api/admin/publish    merge it, in either direction
 *
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * Content edited on staging commits to `dev`. Nothing on `dev` is live until
 * it reaches `main`, where the deploy Action publishes it. That merge was a
 * terminal command, which meant the review step only existed for whoever had
 * the Raspberry Pi in front of them.
 *
 * IT IS NOT A CONTENT OPERATION, AND THE PAGE MUST NOT PRETEND IT IS
 * ---------------------------------------------------------------------------
 * Promoting a branch carries EVERYTHING on it — every code change, every
 * migration, every half-finished experiment — not only the words somebody
 * edited. That is the whole hazard, and it is why this endpoint returns the
 * commit list and the changed files rather than a count.
 *
 * `dev` was 35 commits and 58 files ahead of `main` the day this was written.
 * A button saying "Publish" with no list behind it would have been a button
 * that shipped two consoles, a roles model and seven migrations because
 * somebody wanted to fix a typo.
 *
 * THE MIGRATION CHECK IS THE ONE THAT MATTERS
 * ---------------------------------------------------------------------------
 * Code that expects a table the production database does not have fails AFTER
 * deploying, on a live site, and the fix is a migration somebody has to run by
 * hand. So the changed-file list is scanned for `db/migrations/`, and the page
 * says so before the button rather than after the outage.
 *
 * SYNCING BACK IS NOT AN AFTERTHOUGHT
 * ---------------------------------------------------------------------------
 * Production's own content editor commits to `main`. So `main` accumulates
 * commits `dev` does not have, and the branches drift. The reverse merge is
 * offered on the same page, because a drift nobody can fix from the console is
 * a drift that grows until it becomes a conflict.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { compareBranches, mergeBranches, githubConfig } from "./lib/github.js";

/* Typed out in full by the person doing it, and checked HERE as well as in the
   browser, because a dialog is only a suggestion. Same reasoning as the
   partner delete, and the same shape so the two feel like one system. */
const CONFIRM_WORD = "PUBLISH";

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
        error: "Publishing is limited to administrators.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me, roles };
}

async function audit(db, { user, action, entity_id, detail }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: null,
      action,
      entity: "release",
      entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

const branches = (env) => ({
  live: env.LIVE_BRANCH || "main",
  staging: env.STAGING_BRANCH || "dev",
});

/** Changed files that need something done to the database before deploying. */
function migrationsIn(files) {
  return (files || []).filter((f) => /^db\/migrations\/.*\.sql$/.test(f));
}

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;

    const cfg = githubConfig(env);
    if (cfg.error) {
      // Same shape the content editor uses, so one "not connected yet" state
      // covers both pages rather than each inventing its own.
      if (request.method === "GET") return json({ configured: false, reason: cfg.error }, 200);
      return json({ error: cfg.error, configured: false }, 500);
    }

    if (request.method === "GET") return status(env);
    if (request.method === "POST") return publish(request, env, db, user, me);
    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};

/* -------------------------------- status -------------------------------- */

async function status(env) {
  const { live, staging } = branches(env);
  const cfg = githubConfig(env);

  const cmp = await compareBranches(env, live, staging);
  if (cmp.error) return json({ error: cmp.error }, cmp.status || 502);

  const migrations = migrationsIn(cmp.files);

  return json({
    configured: true,
    repo: cfg.repo,
    live, staging,
    relationship: cmp.status_,
    waiting: cmp.ahead_by,      // on staging, not yet live
    drifted: cmp.behind_by,     // live-only commits staging does not have
    commits: cmp.commits,
    files: cmp.files,
    /* Named separately rather than left in the file list. A migration in a
       release is not one more changed file; it is a thing somebody has to run
       against thauma-ops BEFORE this deploys, or the live site breaks. */
    migrations,
    compare_url: cmp.permalink,
    confirm_word: CONFIRM_WORD,
  });
}

/* ------------------------------- publish -------------------------------- */

async function publish(request, env, db, user, me) {
  const body = await readJson(request);
  if (!body) return json({ error: "The request body was not valid JSON." }, 400);

  const { live, staging } = branches(env);
  const direction = body.direction === "sync" ? "sync" : "publish";

  // publish: staging -> live, and the site changes.
  // sync:    live -> staging, so edits made on the live site come back.
  const base = direction === "publish" ? live : staging;
  const head = direction === "publish" ? staging : live;

  /* Only the direction that changes the public site is typed out. Asking for a
     confirmation word to pull commits INTO the working branch would be
     ceremony around something with no consequence, and ceremony people
     perform by reflex stops being a check. */
  if (direction === "publish" && body.confirm !== CONFIRM_WORD) {
    return json({
      error: `Publishing needs the word ${CONFIRM_WORD} typed to confirm.`,
    }, 400);
  }

  // Read the gap again, on the server, at the moment of the merge. What the
  // browser was showing may be minutes old, and it is what gets recorded.
  const cmp = await compareBranches(env, base, head);
  if (cmp.error) return json({ error: cmp.error }, cmp.status || 502);

  if (!cmp.ahead_by) {
    return json({
      ok: true, alreadyUpToDate: true, direction,
      message: direction === "publish"
        ? `${live} already has everything on ${staging}. Nothing to publish.`
        : `${staging} already has everything on ${live}. Nothing to bring back.`,
    });
  }

  const who = (me && me.name) || user.email;
  const message = direction === "publish"
    ? `Publish ${staging} to ${live}: ${cmp.ahead_by} ${cmp.ahead_by === 1 ? "commit" : "commits"}\n\n` +
      cmp.commits.slice(0, 20).map((c) => `  ${c.sha} ${c.message}`).join("\n") +
      (cmp.commits.length > 20 ? `\n  …and ${cmp.commits.length - 20} more` : "") +
      `\n\nPublished by ${who} from the Thauma admin console.`
    : `Bring ${live} back into ${staging}: ${cmp.ahead_by} ` +
      `${cmp.ahead_by === 1 ? "commit" : "commits"}\n\n` +
      `Content edited on the live site, merged back by ${who}.`;

  const res = await mergeBranches(env, { base, head, message });
  if (res.error) return json({ error: res.error, direction }, res.status || 502);

  await audit(db, {
    user,
    action: direction === "publish" ? "release.publish" : "release.sync",
    entity_id: `${head}->${base}`,
    detail: {
      commits: cmp.ahead_by,
      merge: res.commit,
      migrations: migrationsIn(cmp.files),
      subjects: cmp.commits.slice(0, 20).map((c) => c.message),
    },
  });

  return json({
    ok: true,
    direction,
    merged: cmp.ahead_by,
    commit: res.commit,
    commit_url: res.url,
    alreadyUpToDate: !!res.alreadyUpToDate,
    // Only the publish direction triggers a deploy; saying so on a sync would
    // have somebody watching for a build that is never going to start.
    deploying: direction === "publish",
  });
}
