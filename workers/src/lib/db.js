/**
 * db.js — run the named queries from db/queries.sql against D1
 *
 * D1 binds positionally (`?`), but db/queries.sql uses NAMED parameters
 * (`:partner_id`) because they are readable and because a query that mentions
 * the same parameter three times should not require passing it three times.
 * `toPositional` bridges the two.
 *
 * WHY NAMED PARAMETERS ARE WORTH THE CONVERSION: with positional binding,
 * adding a WHERE clause in the middle of a query silently shifts every
 * argument after it. The failure is a wrong answer, not an error. Named
 * parameters cannot drift that way.
 *
 * EVERY tenant query takes :partner_id, and `query()` throws if it is missing.
 * A forgotten scope must be a crash, not a cross-tenant read.
 */
import { QUERIES, SOURCE_DIGEST } from "./queries.generated.js";

export { QUERIES, SOURCE_DIGEST };

// :name — but not ::cast, and not inside a string literal.
const PARAM_RE = /(?<!:):([a-z_][a-z0-9_]*)/gi;

/** Queries that read tenant-owned data and must always be scoped. */
const TENANT_SCOPED = new Set([
  "dashboard_partner_summary",
  "dashboard_needs_attention",
  "contacts_stewardship",
  "contact_timeline",
  "goals_for_partner",
  "goal_history",
  "audit_recent_for_partner",
]);

/**
 * Rewrite `:name` placeholders to `?` and build the matching argument list.
 * Repeated names are expanded once per occurrence, in order.
 */
export function toPositional(sql, params = {}) {
  const args = [];
  const missing = new Set();

  const out = sql.replace(PARAM_RE, (_m, name) => {
    if (!(name in params)) {
      missing.add(name);
      return "?";
    }
    args.push(params[name]);
    return "?";
  });

  if (missing.size) {
    throw new Error(`missing query parameter(s): ${[...missing].sort().join(", ")}`);
  }
  return { sql: out, args };
}

/**
 * Wrap a D1 binding.
 *
 * `exec` is injectable so the whole layer can be tested without D1 — see
 * workers/test/db.test.mjs. In production it is D1's prepare/bind/all.
 */
export function createDb(binding, exec) {
  const run = exec || (async (sql, args) => {
    const stmt = binding.prepare(sql).bind(...args);
    const { results } = await stmt.all();
    return results || [];
  });

  async function query(name, params = {}) {
    const sql = QUERIES[name];
    if (!sql) {
      throw new Error(`unknown query: ${name} (have: ${Object.keys(QUERIES).sort().join(", ")})`);
    }
    // The guard that matters. A tenant query without a partner is a bug that
    // would otherwise return somebody else's rows.
    if (TENANT_SCOPED.has(name) && !params.partner_id) {
      throw new Error(`query "${name}" is tenant-scoped and requires partner_id`);
    }
    const { sql: positional, args } = toPositional(sql, params);
    return await run(positional, args);
  }

  return {
    query,
    /** First row or null — for queries that return exactly one. */
    async queryOne(name, params) {
      const rows = await query(name, params);
      return rows.length ? rows[0] : null;
    },
    /** Today as YYYY-MM-DD, the shape :today expects. */
    today() {
      return new Date().toISOString().slice(0, 10);
    },
  };
}

/**
 * Everything the staff console's prototype sections need, in one call.
 * Mirrors the shape db/build_snapshot.py produces, so the UI can switch from
 * the snapshot to live data by changing where it fetches — nothing else.
 */
export async function partnerSnapshot(db, partnerId, { staleDays = 120 } = {}) {
  if (!partnerId) throw new Error("partnerSnapshot requires a partnerId");
  const today = db.today();
  const base = { partner_id: partnerId, today };

  const [summary, attention, contacts, goals, audit] = await Promise.all([
    db.queryOne("dashboard_partner_summary", base),
    db.queryOne("dashboard_needs_attention", { ...base, stale_days: staleDays }),
    db.query("contacts_stewardship", base),
    db.query("goals_for_partner", { partner_id: partnerId }),
    db.query("audit_recent_for_partner", { partner_id: partnerId, limit: 10 }),
  ]);

  return {
    as_of: today,
    stale_days: staleDays,
    summary: summary || {},
    needs_attention: attention || { stale_count: 0 },
    contacts,
    goals,
    audit,
  };
}
