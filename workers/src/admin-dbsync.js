/**
 * admin-dbsync.js — move the DATA between this deployment and staging, from a button
 *
 *   GET  /api/admin/db-sync     what each side holds, and whether this is offered here
 *   POST /api/admin/db-sync     { direction: "push" | "pull", confirm: "..." }
 *
 * WHY THIS EXISTS RATHER THAN THE TWO PYTHON SCRIPTS
 * ---------------------------------------------------------------------------
 * A deploy carries code and schema; it has never carried rows. So a user added
 * on staging is invisible to dev, and a mailing list built on dev never
 * reaches staging. There are shell scripts for both directions and they are
 * the wrong shape — the person who needs them does not write scripts, and a
 * capability that lives only behind a command line exists only for whoever
 * wrote it.
 *
 * OFFERED ON DEV, AND NOWHERE ELSE
 * ---------------------------------------------------------------------------
 * Not by a hostname check, which is a thing to keep in step, but by what the
 * deployment HAS. Reaching another database needs a D1 API credential, and
 * that credential is in .dev.vars on the Pi and is deployed nowhere. Staging
 * and production therefore answer "not available here" without anybody
 * maintaining a list — and cannot be made to answer otherwise by editing a
 * hostname.
 *
 * PRODUCTION IS NOT A DESTINATION. The far side is whatever SYNC_REMOTE_DB
 * names, and a production database name is refused below regardless of what it
 * says. A button that replaces every row must not be able to point at the only
 * records that are real.
 *
 * EACH DIRECTION REPLACES. This is not a merge and cannot be — there is no
 * honest answer to "this partner was edited in both places". The screen says
 * so, and the confirmation names which side is about to lose its rows.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import {
  copyableTables, loadOrder, buildStatements, renderSql, realAddresses,
} from "./lib/dbsync.js";

const API = "https://api.cloudflare.com/client/v4";

/* Any database whose name could be the real one. Checked as a prefix so
   thauma-ops, thauma-ops-prod and thauma-production are all refused, while
   thauma-ops-dev is not. */
export function isProduction(name) {
  const n = String(name || "");
  return n === "thauma-ops" || /^thauma-(ops-)?prod/.test(n) || n.endsWith("-production");
}

async function requireAdmin(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  }
  if (!String(me.roles || "").split(",").includes("admin")) {
    return { denied: json({ error: "Moving data between sites is limited to administrators." }, 403) };
  }
  return { db, user, me };
}

/** Is this deployment configured to reach another database at all? */
export function remoteConfig(env) {
  const account = env.SYNC_ACCOUNT_ID;
  const token = env.SYNC_D1_TOKEN;
  const name = env.SYNC_REMOTE_DB;
  if (!account || !token || !name) {
    return { ok: false, reason:
      "This site is not set up to move data. It is offered on the development " +
      "site only, which is the one holding the credential for it." };
  }
  if (isProduction(name)) {
    return { ok: false, reason:
      `Refusing: ${name} looks like the production database, which is never a ` +
      `destination for this.` };
  }
  return { ok: true, account, token, name };
}

/** One or more statements against the REMOTE database, over D1's HTTP API. */
async function remote(cfg, sql, uuidCache) {
  if (!uuidCache.id) {
    const r = await fetch(
      `${API}/accounts/${cfg.account}/d1/database?name=${encodeURIComponent(cfg.name)}`,
      { headers: { Authorization: `Bearer ${cfg.token}` } });
    const j = await r.json();
    const hit = (j.result || []).find((d) => d.name === cfg.name);
    if (!hit) throw new Error(`no database called ${cfg.name} on that account`);
    uuidCache.id = hit.uuid;
  }
  const res = await fetch(
    `${API}/accounts/${cfg.account}/d1/database/${uuidCache.id}/query`,
    { method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }) });
  const body = await res.json();
  if (!body.success) {
    throw new Error((body.errors || []).map((e) => e.message).join("; ") || `HTTP ${res.status}`);
  }
  return body.result || [];
}

/** The local schema, which is what decides the table set and the load order
    for BOTH directions — the two databases are migrated in step, so asking
    one of them is asking both. */
async function schema(env) {
  const names = (await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  const tables = copyableTables(names);
  const known = new Set(tables);

  const deps = new Map();
  for (const t of tables) {
    const d = new Set();
    for (const fk of (await env.DB.prepare(`PRAGMA foreign_key_list(${t})`).all()).results) {
      if (known.has(fk.table) && fk.table !== t) d.add(fk.table);
    }
    /* AND the tables its triggers read, which are not always its foreign keys.
       directory_contacts has no key to partner_users but a trigger checks the
       owner's access through it. */
    const trig = (await env.DB.prepare(
      "SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name = ?").bind(t).all()).results;
    for (const { sql } of trig) {
      for (const other of known) {
        if (other !== t && new RegExp(`\\b${other}\\b`).test(sql || "")) d.add(other);
      }
    }
    deps.set(t, d);
  }
  return { tables, order: loadOrder(tables, deps) };
}

async function countsLocal(env, tables) {
  const out = {};
  for (const t of tables) {
    out[t] = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n;
  }
  return out;
}

async function countsRemote(cfg, tables, cache) {
  const sql = tables.map((t) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t};`).join("\n");
  const res = await remote(cfg, sql, cache);
  const out = {};
  for (const r of res) for (const row of (r.results || [])) out[row.t] = row.n;
  return out;
}

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;

    const cfg = remoteConfig(env);
    if (!cfg.ok) return json({ available: false, reason: cfg.reason }, 200);

    const cache = {};
    const { tables, order } = await schema(env);

    if (request.method === "GET") {
      const [here, there] = await Promise.all([
        countsLocal(env, tables),
        countsRemote(cfg, tables, cache).catch((e) => ({ error: e.message })),
      ]);
      if (there.error) {
        return json({ available: false, reason: `Could not reach ${cfg.name}: ${there.error}` }, 200);
      }
      return json({
        available: true,
        remote: cfg.name,
        tables: order.map((t) => ({ table: t, here: here[t] ?? 0, there: there[t] ?? 0 }))
          .filter((r) => r.here || r.there),
        totals: {
          here: Object.values(here).reduce((a, b) => a + b, 0),
          there: Object.values(there).reduce((a, b) => a + b, 0),
        },
      });
    }

    if (request.method !== "POST") {
      return json({ error: `${request.method} is not supported here.` }, 405);
    }

    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const direction = body.direction === "pull" ? "pull" : body.direction === "push" ? "push" : null;
    if (!direction) return json({ error: "Say which direction: push or pull." }, 400);

    const WORD = direction === "push" ? "REPLACE STAGING" : "REPLACE DEV";
    if (String(body.confirm || "").trim() !== WORD) {
      return json({ error: `Type ${WORD} to confirm — this replaces every row on that side.` }, 400);
    }

    if (direction === "push") {
      const rowsByTable = {};
      for (const t of order) {
        rowsByTable[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
      }
      /* THE ONE THING THAT STOPS A PUSH. Staging is on the public internet and
         this machine is not, so seed data may go up and real supporters may
         not. Checked before a single statement is built. */
      const leaks = realAddresses(rowsByTable);
      if (leaks.length) {
        return json({
          error: "Refusing: this site's database holds addresses that do not look invented, " +
                 "and staging is reachable from the internet.",
          found: leaks.slice(0, 10).map((l) => ({ table: l.table,
            address: l.address.replace(/^(.).*(@.*)$/, "$1***$2") })),
          more: Math.max(0, leaks.length - 10),
        }, 409);
      }
      const { statements, rows } = buildStatements(order, rowsByTable, { scrub: false });
      /* ONE request, not one per statement. A Worker gets fifty subrequests on
         the free plan and this is comfortably more than fifty statements. */
      await remote(cfg, renderSql(statements), cache);
      return json({ done: "push", rows, remote: cfg.name });
    }

    // pull: read the far side in one request, write here in one batch.
    const res = await remote(cfg, order.map((t) => `SELECT * FROM ${t};`).join("\n"), cache);
    const rowsByTable = {};
    order.forEach((t, i) => { rowsByTable[t] = (res[i] && res[i].results) || []; });

    /* SCRUBBED ON THE WAY DOWN. Staging will not always hold invented people,
       and a copy of real ones on a development machine is a second record
       nobody consented to and everybody forgets. */
    const { statements, rows } = buildStatements(order, rowsByTable, { scrub: true });
    await env.DB.batch(statements.map((s) => env.DB.prepare(s.sql).bind(...s.params)));
    return json({ done: "pull", rows, remote: cfg.name });
  },
};
