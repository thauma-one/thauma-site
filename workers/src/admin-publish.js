/**
 * admin-publish.js — Save, Preview, Publish
 *
 *   GET  /api/admin/publish    what is saved but not yet on the live site
 *   POST /api/admin/publish    { action: "preview" | "publish" }
 *
 * THE MODEL, IN THREE SENTENCES
 * ---------------------------------------------------------------------------
 * Saving a page commits it to the live branch with `[skip ci]`, which tells
 * GitHub to run no workflow — so the work is safe in git and the site has not
 * moved. Preview asks the staging workflow to build that branch, so you can
 * look at it on next.thauma.one. Publish asks the production workflow to build
 * the same branch, and that is the site changing.
 *
 * There is no merge, and no branch appears anywhere a person can see. That was
 * the previous design and it was wrong for this: branches and merges are how
 * teams ship CODE, and what is being shipped here is sentences. `dev` still
 * exists for code work; it is nobody's business but the developer's.
 *
 * HOW "NOT YET PUBLISHED" IS COMPUTED
 * ---------------------------------------------------------------------------
 * By asking the deploy, not the branch. A branch does not record which of its
 * commits is live, and a deploy is not a commit — the only honest answer is
 * "the last successful production run built commit X", and everything after X
 * is waiting. That also means a FAILED deploy correctly leaves the work still
 * showing as unpublished.
 *
 * WHY BOTH ACTIONS ARE workflow_dispatch
 * ---------------------------------------------------------------------------
 * `[skip ci]` on the save is what makes Save quiet, and it suppresses every
 * workflow for that push. So a build has to be asked for separately.
 * `workflow_dispatch` is not a push event and is unaffected by it. The cost is
 * the App needing Actions: read and write; the benefit is that Save genuinely
 * does nothing visible, which is the entire promise of the word.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { compareBranches, dispatchWorkflow, lastSuccessfulRun, refSha, githubConfig }
  from "./lib/github.js";

const CONFIRM_WORD = "PUBLISH";

const PROD_WORKFLOW = "deploy.yml";
const STAGING_WORKFLOW = "deploy-staging.yml";

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
      denied: json({ error: "Publishing is limited to administrators.", your_roles: roles }, 403),
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
      action, entity: "release", entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/** The branch everything lives on. `dev` is a development detail, not this. */
const siteBranch = (env) => env.LIVE_BRANCH || "main";

/** Changed files that need something done to the database before deploying. */
const migrationsIn = (files) =>
  (files || []).filter((f) => /^db\/migrations\/.*\.sql$/.test(f));

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;

    const cfg = githubConfig(env);
    if (cfg.error) {
      if (request.method === "GET") return json({ configured: false, reason: cfg.error }, 200);
      return json({ error: cfg.error, configured: false }, 500);
    }

    if (request.method === "GET") return status(env);
    if (request.method === "POST") return act(request, env, db, user, me);
    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};

/* -------------------------------- status -------------------------------- */

async function status(env) {
  const branch = siteBranch(env);
  const cfg = githubConfig(env);

  const live = await lastSuccessfulRun(env, PROD_WORKFLOW);
  if (live.error) return json({ error: live.error }, live.status || 502);

  const preview = await lastSuccessfulRun(env, STAGING_WORKFLOW);

  /* Nothing has ever deployed. Real state for a new site, and the page says
     "nothing has been published yet" rather than pretending to compare
     against a commit that does not exist. */
  if (live.never) {
    return json({
      configured: true, repo: cfg.repo, branch,
      neverPublished: true, waiting: 0, commits: [], files: [], migrations: [],
      preview: preview.never ? null : preview,
      confirm_word: CONFIRM_WORD,
    });
  }

  // What is on the branch that the last successful production build did not
  // contain. `compareBranches` takes any two refs, not only branch names.
  const cmp = await compareBranches(env, live.sha, branch);
  if (cmp.error) return json({ error: cmp.error }, cmp.status || 502);

  // What the branch points at right now — so the page can say whether the
  // preview is showing the same thing you would be publishing, or something
  // older. A preview that is quietly out of date is worse than none.
  const head = await refSha(env, branch);

  return json({
    configured: true,
    repo: cfg.repo,
    branch,
    neverPublished: false,
    published: { sha: live.sha.slice(0, 7), at: live.at, url: live.url, run: live.number },
    preview: preview.never ? null : {
      sha: preview.sha.slice(0, 7), at: preview.at, url: preview.url,
      // Whether what is on next.thauma.one is what you would be publishing.
      current: !head.error && preview.sha === head.sha,
    },
    waiting: cmp.ahead_by,
    commits: cmp.commits,
    files: cmp.files,
    migrations: migrationsIn(cmp.files),
    compare_url: cmp.permalink,
    confirm_word: CONFIRM_WORD,
  });
}

/* ------------------------------- actions -------------------------------- */

async function act(request, env, db, user, me) {
  const body = await readJson(request);
  if (!body) return json({ error: "The request body was not valid JSON." }, 400);

  const branch = siteBranch(env);
  // Anything that is not exactly "preview" is treated as the guarded action.
  // Fail toward the confirmation, never away from it.
  const action = body.action === "preview" ? "preview" : "publish";

  if (action === "publish" && body.confirm !== CONFIRM_WORD) {
    return json({ error: `Publishing needs the word ${CONFIRM_WORD} typed to confirm.` }, 400);
  }

  const workflow = action === "publish" ? PROD_WORKFLOW : STAGING_WORKFLOW;
  const res = await dispatchWorkflow(env, workflow, branch);
  if (res.error) return json({ error: res.error, action }, res.status || 502);

  // Recorded even for a preview. "Who looked at what, when" is cheap to keep
  // and is the first question asked when two people disagree about what the
  // site said yesterday.
  await audit(db, {
    user,
    action: action === "publish" ? "release.publish" : "release.preview",
    entity_id: `${workflow}@${branch}`,
    detail: { by: (me && me.user_name) || user.email, branch },
  });

  return json({
    ok: true,
    action,
    branch,
    // The build takes a minute or two and nothing here waits for it. The page
    // says so rather than implying the site has already changed.
    started: true,
    where: action === "publish" ? "thauma.one" : "next.thauma.one",
  });
}
