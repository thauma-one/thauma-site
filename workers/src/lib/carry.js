/**
 * carry.js — dev's data, carried to staging on Preview and to live on Publish
 *
 * WHY THE PI DOES THIS, NOT THE DEPLOY. Preview and Publish start GitHub
 * workflows, and GitHub cannot see dev's database: it is a file on the Pi
 * (`wrangler dev --local`). So the dev site itself, at the moment the button
 * is pressed, does the three things a deploy never did:
 *
 *   1. brings the other database's STRUCTURE up to date — the migration files
 *      on the branch that is about to be built, applied in order and recorded
 *      in its schema_migrations, exactly as its own Apply button would;
 *   2. carries the ROWS — staging replaced (dbsync.planReplace), live added to
 *      and updated (dbsync.planMerge, which never deletes);
 *   3. and only then lets the workflow build the code.
 *
 * Structure before rows, rows before code: rows need the columns, and code
 * needs both.
 *
 * WHERE IT RUNS. Only where the credential is: SYNC_D1_TOKEN and
 * SYNC_ACCOUNT_ID live in the Pi's .dev.vars and are deployed nowhere, so on
 * staging and live this answers "not here" and Preview and Publish carry on as
 * they always did. Staging's database is SYNC_REMOTE_DB, live's SYNC_LIVE_DB.
 *
 * PHOTOS need nothing here: dev writes them straight into the same bucket
 * staging and live read (wrangler.toml, env.dev, `remote = true`).
 */
import { listDir, getFile } from "./github.js";
import { copyableTables, loadOrder, planReplace, planMerge, scripts } from "./dbsync.js";
import { createHash } from "node:crypto";

const API = "https://api.cloudflare.com/client/v4";
const MIGRATIONS = "db/migrations";
const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/i;

/** Where dev can carry to, if anywhere. */
export function carryConfig(env, target) {
  const account = env.SYNC_ACCOUNT_ID, token = env.SYNC_D1_TOKEN;
  const name = target === "live" ? env.SYNC_LIVE_DB : env.SYNC_REMOTE_DB;
  /* ONE DATABASE: dev, staging and live share their records, so Preview and
     Publish carry code only. Skipped, not refused — the buttons still build. */
  if (env.ONE_DATABASE) return { ok: false };
  if (!account || !token || !name || !env.DB) return { ok: false };
  /* Staging is only ever replaced; anything that looks like live's database
     name is refused as a staging target, so a typo in .dev.vars can never
     turn "replace" loose on the real records. */
  if (target !== "live" && (name === env.SYNC_LIVE_DB || /^thauma-ops$|prod/.test(name))) {
    return { ok: false, error: `${name} looks like the live database; it cannot be Preview's target.` };
  }
  return { ok: true, account, token, name };
}

/** A connection to the far database over D1's HTTP API. */
export function farDb(cfg, fetchImpl = fetch) {
  let uuid = null;
  async function run(sql) {
    if (!uuid) {
      const r = await (await fetchImpl(`${API}/accounts/${cfg.account}/d1/database?name=${encodeURIComponent(cfg.name)}`,
        { headers: { Authorization: `Bearer ${cfg.token}` } })).json();
      const hit = (r.result || []).find((d) => d.name === cfg.name);
      if (!hit) throw new Error(`there is no database called ${cfg.name}`);
      uuid = hit.uuid;
    }
    const res = await fetchImpl(`${API}/accounts/${cfg.account}/d1/database/${uuid}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    const body = await res.json();
    if (!body.success) throw new Error((body.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`);
    return body.result || [];
  }
  /* A WHOLE FILE, the way `wrangler d1 execute --remote --file` sends one:
     uploaded, then imported by D1 with SQLite's own parser, all or nothing.
     /query cannot take the repo's triggers — it cuts BEGIN SELECT CASE …
     END; END; at the CASE's END, even sent alone (Publish, 2026-09-29). */
  async function post(path, body) {
    if (!uuid) await run("SELECT 1");
    const res = await fetchImpl(`${API}/accounts/${cfg.account}/d1/database/${uuid}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!out.success) throw new Error((out.errors || []).map((e) => e.message || e).join("; ") || `HTTP ${res.status}`);
    return out.result || {};
  }
  async function importSql(sql) {
    const etag = createHash("md5").update(sql).digest("hex");
    let r = await post("import", { action: "init", etag });
    if (r.upload_url) {
      const put = await fetchImpl(r.upload_url, { method: "PUT", body: sql });
      if (put.status !== 200) throw new Error(`the file could not be uploaded (HTTP ${put.status})`);
      if ((put.headers.get("etag") || "").replace(/^"|"$/g, "") !== etag) throw new Error("the file did not upload intact");
      r = await post("import", { action: "ingest", filename: r.filename, etag });
    }
    for (let i = 0; i < 120; i++) {
      if (r.status === "complete") return r;
      if (r.status === "error" || r.success === false) {
        throw new Error([...(r.errors || []), ...(r.error ? [r.error] : [])].join("; ") || "the import failed");
      }
      await new Promise((ok) => setTimeout(ok, i ? 1000 : 0));
      r = await post("import", { action: "poll", current_bookmark: r.at_bookmark });
    }
    throw new Error("the import did not finish in two minutes");
  }
  return { run, importSql, rows: async (sql) => ((await run(sql))[0] || {}).results || [] };
}

/* Cloudflare's own tables inside a D1 file (_cf_KV) refuse to be described
   ("not authorized"), so they are left out before they are asked about. */
const COLUMNS_SQL = "SELECT m.name AS t, p.name AS c, p.pk AS pk FROM sqlite_master m " +
  "JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND substr(m.name, 1, 1) <> '_' " +
  "AND m.name NOT LIKE 'sqlite%' ORDER BY m.name, p.cid";

/* ------------------------------------------------------------ structure -- */

/**
 * Apply every migration on `branch` that the far database has not recorded.
 * Stops at the first failure, like the console's own Apply.
 */
export async function migrateFar(env, far, branch, who) {
  const e = { ...env, CONTENT_BRANCH: branch };
  const listed = await listDir(e, MIGRATIONS);
  if (listed.error) throw new Error(listed.error);
  const files = listed.files.filter((f) => NAME_RE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  await far.run(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL,
    applied_by TEXT, statements INTEGER, baselined INTEGER NOT NULL DEFAULT 0)`);
  const done = new Set((await far.rows("SELECT name FROM schema_migrations")).map((r) => r.name));
  if (!done.size && (await far.rows("SELECT name FROM sqlite_master WHERE name = 'users'")).length) {
    throw new Error("that database has tables but no record of its migrations — baseline it from its own Publish page first");
  }
  const ran = [];
  for (const f of files.filter((x) => !done.has(x.name))) {
    const file = await getFile(e, `${MIGRATIONS}/${f.name}`);
    if (file.error) throw new Error(file.error);
    try { await far.importSql(file.text); }
    catch (err) { throw new Error(`${f.name} did not apply: ${err.message}` + (ran.length ? ` (after ${ran.join(", ")})` : "")); }
    await far.run(`INSERT INTO schema_migrations (name, applied_at, applied_by, statements, baselined) VALUES (` +
      `'${f.name.replace(/'/g, "''")}', '${new Date().toISOString()}', '${String(who).replace(/'/g, "''")}', NULL, 0)`);
    ran.push(f.name);
  }
  return ran;
}

/* ----------------------------------------------------------------- rows -- */

async function localMeta(db) {
  const cols = {};
  for (const r of (await db.prepare(COLUMNS_SQL).all()).results) {
    (cols[r.t] = cols[r.t] || []).push({ c: r.c, pk: r.pk });
  }
  const tables = copyableTables(Object.keys(cols));
  const known = new Set(tables);
  const meta = {}, deps = new Map();
  for (const t of tables) {
    const fks = (await db.prepare(`PRAGMA foreign_key_list(${t})`).all()).results
      .filter((f) => known.has(f.table)).map((f) => ({ from: f.from, table: f.table, to: f.to }));
    const uniques = [];
    for (const ix of (await db.prepare(`PRAGMA index_list(${t})`).all()).results) {
      /* A partial or expression index is not "the same thing" evidence. */
      if (!ix.unique || ix.origin === "pk" || ix.partial) continue;
      const cols = (await db.prepare(`PRAGMA index_info(${ix.name})`).all()).results.map((x) => x.name);
      if (cols.length && cols.every(Boolean)) uniques.push(cols);
    }
    /* The tables a trigger reads load first too, as in admin-dbsync.js. */
    const trig = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?").bind(t).all()).results;
    const d = new Set(fks.map((f) => f.table).filter((x) => x !== t));
    for (const { sql } of trig) for (const o of known) if (o !== t && new RegExp(`\\b${o}\\b`).test(sql || "")) d.add(o);
    deps.set(t, d);
    meta[t] = {
      cols: cols[t].map((x) => x.c),
      pk: cols[t].filter((x) => x.pk).sort((a, b) => a.pk - b.pk).map((x) => x.c),
      uniques, fks,
    };
  }
  return { meta, order: loadOrder(tables, deps) };
}

/** Only what BOTH sides have: a table live does not have yet is skipped, and
    so is a column (a site published before the branch that adds it). */
async function common(far, meta) {
  const there = {};
  for (const r of await far.rows(COLUMNS_SQL)) (there[r.t] = there[r.t] || new Set()).add(r.c);
  const out = {};
  for (const [t, m] of Object.entries(meta)) {
    if (!there[t]) continue;
    const cols = m.cols.filter((c) => there[t].has(c));
    if (!m.pk.every((c) => cols.includes(c))) continue;
    out[t] = { ...m, cols, uniques: m.uniques.filter((u) => u.every((c) => cols.includes(c))) };
  }
  return out;
}

/**
 * The whole carry. `target` is "staging" or "live"; `branch` is what the
 * workflow is about to build; `dryRun` plans without writing (tests, and a
 * look before the first real publish).
 */
export async function carry(env, { target, branch, who, dryRun = false, migrate = true, fetchImpl = fetch }) {
  const cfg = carryConfig(env, target);
  if (!cfg.ok) return cfg.error ? { error: cfg.error } : { skipped: true };
  const far = farDb(cfg, fetchImpl);

  const migrations = dryRun || !migrate ? [] : await migrateFar(env, far, branch, `${who} (${target === "live" ? "Publish" : "Preview"} from dev)`);

  const { meta: all, order } = await localMeta(env.DB);
  const meta = await common(far, all);
  const rowsByTable = {};
  for (const t of order) if (meta[t]) rowsByTable[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;

  /* The far rows a dev row might be the same thing as. On staging only the
     ones that survive the replace — the master account — can be. */
  const farRows = {};
  const survives = target === "live" ? "" : (meta.users && meta.users.cols.includes("protected") ? " WHERE protected = 1" : null);
  for (const t of order) {
    const m = meta[t];
    if (!m || m.pk.length !== 1 || !m.uniques.length) continue;
    if (target !== "live" && (t !== "users" || survives === null)) continue;
    const cols = [...new Set([m.pk[0], ...m.uniques.flat()])];
    farRows[t] = await far.rows(`SELECT ${cols.join(", ")} FROM ${t}${survives}`);
  }
  const plan = target === "live"
    ? planMerge(order, rowsByTable, meta, farRows)
    : planReplace(order, rowsByTable, meta, farRows);

  const parts = scripts(plan.statements);
  if (!dryRun) for (const sql of parts) await far.run(sql);
  return {
    target, database: cfg.name, migrations, rows: plan.rows, requests: parts.length,
    matched: plan.matched || [], skipped: Object.keys(all).filter((t) => !meta[t]),
    dryRun,
  };
}
