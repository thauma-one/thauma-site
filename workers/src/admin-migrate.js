/**
 * admin-migrate.js — applying database migrations from the console
 *
 *   GET  /api/admin/migrate    which migrations are applied, which are waiting
 *   POST /api/admin/migrate    { action: "apply" | "baseline", ... }
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Everything else about running this site was moved into the browser, and this
 * was the one thing left that needed a terminal, a wrangler install, and a
 * Cloudflare API token on somebody's laptop. On 2026-08-17 production had been
 * running for weeks with migrations 0009 and 0010 unapplied — the schema said
 * one thing, the code assumed another, and removing a person returned a 500
 * with no clue as to why. Nothing surfaced the gap, because nothing was
 * looking.
 *
 * The Publish page already lists migrations in the release it is about to
 * ship. This makes that list actionable instead of a note saying "ask a
 * developer".
 *
 * THE MODEL
 * ---------------------------------------------------------------------------
 * A migration is applied ONCE, in order, and recorded. The record lives in
 * `schema_migrations` in the same database, so the answer to "has this run"
 * comes from the database itself rather than from anybody's memory.
 *
 * The migration FILES are read from the repository at the live branch — the
 * same source of truth Publish builds from. So the sequence for a schema
 * change is: merge the migration to the live branch, apply it here, then
 * publish the code that depends on it. Schema first, code second, which is
 * the order that survives a half-finished deploy.
 *
 * WHY THERE IS A BASELINE ACTION
 * ---------------------------------------------------------------------------
 * A database that was migrated by hand before this page existed has the schema
 * but no record of it. Running 0001 against it would fail on the first CREATE
 * TABLE. `baseline` writes the records without executing anything, which is
 * the only honest way to adopt an existing database — and it is guarded by its
 * own typed confirmation because claiming a migration ran when it did not is
 * how you end up with a schema nobody can reason about.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 * No down migrations, no editing applied records, no arbitrary SQL box. The
 * only SQL this will execute is a file that is committed to the repository on
 * the live branch, which means every statement it can run has been through
 * git and is visible in a diff. An admin console with a SQL prompt in it is a
 * different and much larger thing to trust.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { getFile, listDir, githubConfig } from "./lib/github.js";
import { splitStatements } from "./lib/sqlsplit.js";

const DIR = "db/migrations";
const APPLY_WORD = "MIGRATE";
const BASELINE_WORD = "BASELINE";

/** A migration filename: four digits, an underscore, a name, .sql */
const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/i;

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
    return { denied: json({ error: "Migrations are limited to administrators.", your_roles: roles }, 403) };
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
      action, entity: "migration", entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/**
 * Make sure the tracking table exists.
 *
 * This is runner infrastructure, not schema, so it is created here rather than
 * being migration 0001 — a migration that records migrations cannot record
 * itself before it has run, and the circularity is not worth the tidiness.
 */
async function ensureTable(binding) {
  await binding.prepare(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL,
       applied_by TEXT,
       statements INTEGER,
       baselined  INTEGER NOT NULL DEFAULT 0
     )`
  ).run();
}

async function appliedRows(binding) {
  const res = await binding.prepare(
    "SELECT name, applied_at, applied_by, baselined FROM schema_migrations ORDER BY name"
  ).all();
  return res.results || [];
}

/**
 * The migration files on the live branch, in order.
 *
 * Sorted by the four-digit prefix rather than by string, so a hypothetical
 * 0100 lands after 0099 instead of between 0009 and 0010.
 */
export async function pendingMigrations(env) {
  const repo = await repoMigrations(env);
  if (repo.error) return { error: repo.error };
  await ensureTable(env.DB);
  const applied = new Set((await appliedRows(env.DB)).map((r) => r.name));
  return { pending: repo.files.filter((f) => !applied.has(f.name)).map((f) => f.name) };
}

async function repoMigrations(env) {
  const listed = await listDir(env, DIR);
  if (listed.error) return listed;

  const files = listed.files
    .filter((f) => NAME_RE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));

  const skipped = listed.files.filter((f) => !NAME_RE.test(f.name)).map((f) => f.name);
  return { files, skipped };
}

/* -------------------------------- status -------------------------------- */

async function status(env) {
  const repo = await repoMigrations(env);
  if (repo.error) return json({ error: repo.error }, repo.status || 502);

  await ensureTable(env.DB);
  const rows = await appliedRows(env.DB);
  const applied = new Map(rows.map((r) => [r.name, r]));

  const pending = repo.files.filter((f) => !applied.has(f.name)).map((f) => f.name);

  /* Recorded as applied but no longer in the repository. Not an error — a file
     can be renamed — but it is the sort of thing that should never be a
     surprise, so it is reported rather than filtered out. */
  const inRepo = new Set(repo.files.map((f) => f.name));
  const orphaned = rows.filter((r) => !inRepo.has(r.name)).map((r) => r.name);

  return json({
    configured: true,
    dir: DIR,
    branch: githubConfig(env).branch,
    applied: rows.map((r) => ({
      name: r.name, at: r.applied_at, by: r.applied_by, baselined: !!r.baselined,
    })),
    pending,
    orphaned,
    skipped: repo.skipped,
    /* A database with schema but no records. Running 0001 against it would
       fail on the first CREATE TABLE, so the page offers baseline instead of
       apply — and says why. */
    needsBaseline: rows.length === 0 && pending.length > 0,
    apply_word: APPLY_WORD,
    baseline_word: BASELINE_WORD,
  });
}

/* -------------------------------- apply --------------------------------- */

/**
 * Run one migration, statement by statement, recording it only if every
 * statement succeeded.
 *
 * NOT A TRANSACTION, and it is worth being honest about why. D1's `batch`
 * wraps its statements in one, but several of these migrations rename tables
 * and rebuild them, and a rollback part-way through a rebuild leaves a
 * database in a state no amount of retrying fixes. Running them in sequence
 * and stopping at the first failure means a partial application is possible —
 * so the failure message names the statement and the line it started on, which
 * is what somebody needs to finish the job by hand.
 */
async function runOne(env, name) {
  const file = await getFile(env, `${DIR}/${name}`);
  if (file.error) return { error: file.error, status: file.status || 502 };

  const statements = splitStatements(file.text);
  if (!statements.length) return { error: `${name} contains no statements.`, status: 400 };

  for (let i = 0; i < statements.length; i++) {
    const { sql, line } = statements[i];
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      return {
        error: `${name} failed at statement ${i + 1} of ${statements.length} ` +
               `(line ${line}): ${err.message}`,
        status: 500,
        failedAt: i + 1,
        of: statements.length,
        line,
        /* The first line of the statement, so the message is recognisable
           without dumping a whole CREATE TABLE into a toast. */
        statement: sql.split("\n")[0].slice(0, 120),
        /* Everything before this one DID run. Saying so is the difference
           between "retry it" and "look at the database first". */
        partial: i > 0,
      };
    }
  }

  return { ok: true, statements: statements.length };
}

async function apply(env, db, user, me) {
  const repo = await repoMigrations(env);
  if (repo.error) return json({ error: repo.error }, repo.status || 502);

  await ensureTable(env.DB);
  const rows = await appliedRows(env.DB);
  const done = new Set(rows.map((r) => r.name));
  const pending = repo.files.filter((f) => !done.has(f.name));

  if (!pending.length) {
    return json({ ok: true, ran: [], message: "Every migration has already been applied." });
  }

  const who = (me && me.user_name) || user.email;
  const ran = [];

  for (const f of pending) {
    const res = await runOne(env, f.name);

    if (res.error) {
      /* Stop at the first failure. The ones before it are recorded and real;
         the ones after it have not been touched. Carrying on would apply a
         migration whose predecessor did not finish. */
      await audit(db, {
        user, action: "migration.failed", entity_id: f.name,
        detail: { by: who, error: res.error, ran, partial: !!res.partial },
      });
      return json({
        error: res.error,
        ran,
        stoppedAt: f.name,
        partial: !!res.partial,
        line: res.line,
        statement: res.statement,
        remaining: pending.slice(pending.indexOf(f) + 1).map((x) => x.name),
      }, res.status || 500);
    }

    await env.DB.prepare(
      `INSERT INTO schema_migrations (name, applied_at, applied_by, statements, baselined)
       VALUES (?, ?, ?, ?, 0)`
    ).bind(f.name, new Date().toISOString(), who, res.statements).run();

    ran.push({ name: f.name, statements: res.statements });
    await audit(db, {
      user, action: "migration.apply", entity_id: f.name,
      detail: { by: who, statements: res.statements },
    });
  }

  return json({ ok: true, ran });
}

/* ------------------------------- baseline ------------------------------- */

/**
 * Record migrations as applied WITHOUT running them.
 *
 * For a database that was migrated by hand before this page existed. `through`
 * names the last migration the database already has, and everything up to and
 * including it is recorded. Anything after it stays pending and will run
 * normally on the next apply.
 */
async function baseline(env, db, user, me, through) {
  const repo = await repoMigrations(env);
  if (repo.error) return json({ error: repo.error }, repo.status || 502);

  const names = repo.files.map((f) => f.name);
  const idx = names.indexOf(through);
  if (idx === -1) {
    return json({
      error: `${through} is not a migration in ${DIR} on the live branch.`,
      available: names,
    }, 400);
  }

  await ensureTable(env.DB);
  const rows = await appliedRows(env.DB);
  const done = new Set(rows.map((r) => r.name));

  const who = (me && me.user_name) || user.email;
  const now = new Date().toISOString();
  const marked = [];

  for (const name of names.slice(0, idx + 1)) {
    if (done.has(name)) continue;
    await env.DB.prepare(
      `INSERT INTO schema_migrations (name, applied_at, applied_by, statements, baselined)
       VALUES (?, ?, ?, NULL, 1)`
    ).bind(name, now, who).run();
    marked.push(name);
  }

  await audit(db, {
    user, action: "migration.baseline", entity_id: through,
    detail: { by: who, marked },
  });

  return json({ ok: true, marked, through });
}

/* ------------------------------- dispatch ------------------------------- */

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

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "The request body was not valid JSON." }, 400);

      if (body.action === "baseline") {
        if (body.confirm !== BASELINE_WORD) {
          return json({ error: `Baselining needs the word ${BASELINE_WORD} typed to confirm.` }, 400);
        }
        if (!body.through || !NAME_RE.test(String(body.through))) {
          return json({ error: "Name the last migration this database already has." }, 400);
        }
        return baseline(env, db, user, me, String(body.through));
      }

      // Anything that is not explicitly baseline is treated as the guarded
      // action. Fail toward the confirmation, never away from it.
      if (body.confirm !== APPLY_WORD) {
        return json({ error: `Applying migrations needs the word ${APPLY_WORD} typed to confirm.` }, 400);
      }
      return apply(env, db, user, me);
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
