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
  "interactions_for_partner",
  "goals_for_partner",
  "goal_history",
  "audit_recent_for_partner",
  "public_goals_for_partner",
  "public_milestones_for_partner",
  "public_milestone_translations",
  "public_languages_for_partner",
  "milestones_for_staff",
  "milestone_translations_for_staff",
  "partner_languages_for_partner",
  "partner_settings",
  "api_keys_for_partner",
  "directory_for_user",
  "resources_visible",
]);

/**
 * The ONLY queries the partner API may run.
 *
 * An allow-list, not a deny-list, and that asymmetry is the whole point: a
 * new query is private until somebody deliberately adds it here. A deny-list
 * would silently expose every query written after it.
 *
 * Everything in this set is filtered on is_public = 1 and returns no person
 * data. `assertPublicSafe()` re-checks the second half against the actual SQL
 * rather than trusting this list to stay honest.
 */
export const PUBLIC_QUERIES = new Set([
  "public_goals_for_partner",
  "public_milestones_for_partner",
  "public_milestone_translations",
  "public_languages_for_partner",
]);

/** Tables a query in PUBLIC_QUERIES must never mention. */
const PRIVATE_TABLES = ["contacts", "interactions", "users", "audit_log", "api_keys"];

/**
 * Static check that the public query set cannot reach private data.
 *
 * Run by the tests, and again at Worker startup — cheap, and it means a bad
 * deploy fails loudly at boot instead of quietly serving supporter records to
 * a public website.
 */
export function assertPublicSafe(queries = QUERIES) {
  for (const name of PUBLIC_QUERIES) {
    const sql = queries[name];
    if (!sql) throw new Error(`PUBLIC_QUERIES names a query that does not exist: ${name}`);

    // Word-boundary match: `contacts` must fail, `contacts_total` need not,
    // but no public query has any business with either.
    for (const table of PRIVATE_TABLES) {
      if (new RegExp(`\\b${table}\\b`, "i").test(sql)) {
        throw new Error(
          `public query "${name}" references the private table "${table}" — ` +
          `it would publish it. See the PARTNER API section of db/queries.sql.`);
      }
    }
    // EVERY public query must filter on an explicit publication decision.
    // Which flag depends on what is being published: content is gated by
    // is_public, and a partner's language list by is_enabled. Both mean the
    // same thing — somebody chose this — and neither defaults to on.
    //
    // Checked as "at least one of them", not "is_public specifically",
    // because a rule that only fits today's queries gets deleted by the first
    // person it inconveniences.
    if (!/\bis_public\s*=\s*1\b/i.test(sql) && !/\bis_enabled\s*=\s*1\b/i.test(sql)) {
      throw new Error(
        `public query "${name}" filters neither is_public = 1 nor ` +
        `is_enabled = 1 — it would publish rows nobody chose to publish.`);
    }
    if (!/:partner_id\b/.test(sql)) {
      throw new Error(`public query "${name}" is not scoped by :partner_id`);
    }
  }
  return true;
}

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

  async function query(name, params = {}, { publicOnly = false } = {}) {
    // Second gate for the partner API. The endpoint only asks for public
    // queries, but "only asks" is a property of today's code; this is a
    // property of the layer underneath it.
    if (publicOnly && !PUBLIC_QUERIES.has(name)) {
      throw new Error(
        `query "${name}" is not in PUBLIC_QUERIES and must not be served to a partner site`);
    }
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
    /** Restricted view of the same layer, for the partner API. */
    publicQuery(name, params) {
      return query(name, params, { publicOnly: true });
    },
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
 * Everything a PARTNER SITE'S BUILD may render, in one call.
 *
 * The counterpart to partnerSnapshot(), and deliberately not built the same
 * way. partnerSnapshot spreads query rows straight into its response, which is
 * fine for a console behind Access — it is how `email` and `phone` reached a
 * browser that never drew them.
 *
 * Here every field is named explicitly. Adding a column to `milestones` does
 * NOT publish it; somebody has to come here and write it down. That asymmetry
 * is intentional: the private endpoint fails toward showing too much, the
 * public one fails toward showing too little.
 *
 * Uses publicQuery(), so the layer refuses anything outside PUBLIC_QUERIES
 * even if this function asks for it.
 */
export async function partnerPublicSite(db, partnerId) {
  if (!partnerId) throw new Error("partnerPublicSite requires a partnerId");

  const [goals, milestones, translations, languages] = await Promise.all([
    db.publicQuery("public_goals_for_partner", { partner_id: partnerId }),
    db.publicQuery("public_milestones_for_partner", { partner_id: partnerId }),
    db.publicQuery("public_milestone_translations", { partner_id: partnerId }),
    db.publicQuery("public_languages_for_partner", { partner_id: partnerId }),
  ]);

  // Group text by milestone, then by language code. Nothing here names a
  // language: adding one is a row in `languages` and a switch on
  // partner_languages, and this code does not change.
  const byMilestone = {};
  for (const tx of translations) {
    (byMilestone[tx.milestone_id] ||= {})[tx.lang] = {
      title: tx.title,
      description: tx.description,
      target_label: tx.target_label,
    };
  }

  return {
    // What a consumer should offer in its own language switcher, rather than
    // inferring it from whichever translations happen to exist.
    languages: languages.map((l) => ({
      code: l.code, name: l.name, native_name: l.native_name,
    })),
    goals: goals.map((g) => ({
      id: g.goal_id,
      label: g.label,
      kind: g.kind,
      target_cents: g.target_cents,
      currency: g.currency,
      raised_cents: g.raised_cents,
      donor_count: g.donor_count,
      percent: g.percent,
      captured_at: g.captured_at,
    })),
    // The PUBLIC ROADMAP. Not stewardship history — see
    // db/migrations/0002_milestones.sql before adding anything here.
    milestones: milestones
      // A milestone with no publishable translation is not renderable, and
      // shipping an entry with no text at all would leave a partner site
      // drawing an empty row.
      .filter((m) => byMilestone[m.id])
      .map((m) => ({
        id: m.id,
        parent_id: m.parent_id,
        actual_date: m.actual_date,
        status: m.status,
        completion: m.completion,
        is_featured: !!m.is_featured,
        text: byMilestone[m.id],
      })),
  };
}

/**
 * Everything the staff console's snapshot-backed sections need, in one call.
 *
 * Mirrors the shape db/build_snapshot.py produces, key for key, so the console
 * switches from the generated file to live data by changing where it fetches
 * and nothing else. That equivalence is asserted in workers/test/db.test.mjs
 * against the committed snapshot.json — if this drifts from the generator, the
 * tests fail rather than the dashboard rendering blanks.
 *
 * `timelines` is keyed by contact_id because that is how the stewardship table
 * reads it: `d.timelines[c.id]`. It was missing here originally, and the page
 * threw on first render against live data.
 *
 * Five queries, fixed — not five plus one per contact. See
 * interactions_for_partner in db/queries.sql.
 */
export async function partnerSnapshot(db, partnerId, { staleDays = 120 } = {}) {
  if (!partnerId) throw new Error("partnerSnapshot requires a partnerId");
  const today = db.today();
  const base = { partner_id: partnerId, today };

  const [summary, attention, contacts, interactions, goals, audit] = await Promise.all([
    db.queryOne("dashboard_partner_summary", base),
    db.queryOne("dashboard_needs_attention", { ...base, stale_days: staleDays }),
    db.query("contacts_stewardship", base),
    db.query("interactions_for_partner", { partner_id: partnerId }),
    db.query("goals_for_partner", { partner_id: partnerId }),
    db.query("audit_recent_for_partner", { partner_id: partnerId, limit: 10 }),
  ]);

  // Every contact gets a key, including those with no interactions — the
  // drawer renders "No interactions logged." for an empty list but would
  // break on undefined.
  const timelines = {};
  for (const c of contacts) timelines[c.id] = [];
  for (const i of interactions) {
    // A contact_id with no matching row above belongs to an inactive contact;
    // the query already excludes those, so this is belt and braces.
    if (!timelines[i.contact_id]) continue;
    const { contact_id, ...event } = i;
    timelines[contact_id].push(event);
  }

  return {
    as_of: today,
    stale_days: staleDays,
    summary: summary || {},
    needs_attention: attention || { stale_count: 0 },
    contacts,
    timelines,
    goals,
    audit,
  };
}
