/**
 * staff-milestones.js — the milestone editor's backend
 *
 *   GET    /api/staff-milestones            list every milestone, published or not
 *   POST   /api/staff-milestones            create or update one
 *   DELETE /api/staff-milestones?id=…       delete one
 *   PATCH  /api/staff-milestones            reorder (ids in their new order)
 *
 * Access-gated and partner-scoped, exactly like /api/staff-snapshot: Access
 * says WHO is asking, the database decides WHAT they may touch, and the
 * partner id comes from that lookup rather than from anything the client sent.
 *
 * WHY THIS IS NOT THE PARTNER API. These are the same rows chaseroush.com
 * reads through /api/partner/v1/site, but through a completely separate door:
 * that one is key-authenticated, read-only, and filtered to is_public = 1.
 * This one is session-authenticated, writes, and deliberately returns
 * unpublished drafts. Sharing a handler between them is how a draft ends up
 * on a public website.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";

const STATUSES = new Set(["upcoming", "in_progress", "complete", "cancelled"]);

/** Resolve the caller to exactly one partner, or a denial. */
async function partnerFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const partners = await db.query("partners_for_user", { email: user.email });
  if (!partners.length) {
    return {
      denied: json({
        error: "No partner access for this account",
        email: user.email,
      }, 403),
    };
  }
  return { db, partner: partners[0], user };
}

/**
 * Coerce and check one milestone from the client.
 *
 * Returns { value } or { error }. Everything is validated here rather than
 * trusted from the form, because the form is not the only thing that can post
 * to this endpoint.
 */
function clean(body, existingIds) {
  const str = (v, max = 4000) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s.slice(0, max);
  };

  const title = str(body.title, 200);
  if (!title) return { error: "A title is required" };

  const status = String(body.status || "upcoming");
  if (!STATUSES.has(status)) {
    return { error: `status must be one of: ${[...STATUSES].join(", ")}` };
  }

  let completion = Number(body.completion);
  if (!Number.isFinite(completion)) completion = 0;
  completion = Math.max(0, Math.min(100, Math.round(completion)));

  // A date the database will accept. Anything else is rejected rather than
  // silently stored, because "2027" and "next spring" both look fine in a
  // text box and neither sorts.
  const actual_date = str(body.actual_date, 10);
  if (actual_date && !/^\d{4}-\d{2}-\d{2}$/.test(actual_date)) {
    return { error: "actual_date must be YYYY-MM-DD, or empty" };
  }

  // A milestone cannot be its own parent, and cannot point at something that
  // does not exist. The schema stops CROSS-PARTNER nesting; this stops the
  // two mistakes an editor can actually make.
  const parent_id = str(body.parent_id, 64);
  if (parent_id && parent_id === body.id) {
    return { error: "A milestone cannot be its own parent" };
  }
  if (parent_id && existingIds && !existingIds.has(parent_id)) {
    return { error: "That parent milestone does not exist" };
  }

  return {
    value: {
      parent_id,
      title,
      title_hr: str(body.title_hr, 200),
      description: str(body.description),
      description_hr: str(body.description_hr),
      target_label: str(body.target_label, 120),
      target_label_hr: str(body.target_label_hr, 120),
      actual_date,
      status,
      completion,
      // Publication is explicit. Anything other than a literal true is false —
      // a missing or malformed flag must not publish a draft.
      is_public: body.is_public === true || body.is_public === 1 ? 1 : 0,
      is_featured: body.is_featured === true || body.is_featured === 1 ? 1 : 0,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    },
  };
}

/** Ids are generated server-side so a client cannot choose one. */
function newId() {
  return "m_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

export default {
  async fetch(request, env) {
    const { db, partner, denied } = await partnerFor(request, env);
    if (denied) return denied;

    const partner_id = partner.id;
    const now = new Date().toISOString();
    const url = new URL(request.url);

    // ---- list ----
    if (request.method === "GET") {
      const rows = await db.query("milestones_for_staff", { partner_id });
      return json({
        partner: { id: partner.id, display_name: partner.display_name },
        milestones: rows.map((m) => ({
          ...m,
          is_public: !!m.is_public,
          is_featured: !!m.is_featured,
        })),
      });
    }

    // ---- create or update ----
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const existing = await db.query("milestones_for_staff", { partner_id });
      const ids = new Set(existing.map((m) => m.id));

      const isNew = !body.id || !ids.has(body.id);
      const id = isNew ? newId() : body.id;

      const { value, error } = clean({ ...body, id }, ids);
      if (error) return json({ error }, 400);

      // New rows go to the end rather than to position 0, so creating one
      // never silently reshuffles the list somebody just ordered.
      if (isNew && !body.sort_order) {
        value.sort_order = existing.length
          ? Math.max(...existing.map((m) => m.sort_order || 0)) + 1
          : 0;
      }

      await db.query("milestone_upsert", { ...value, id, partner_id, now });

      const rows = await db.query("milestones_for_staff", { partner_id });
      const saved = rows.find((m) => m.id === id);
      return json({
        saved: { ...saved, is_public: !!saved.is_public, is_featured: !!saved.is_featured },
        created: isNew,
      });
    }

    // ---- delete ----
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id is required" }, 400);
      await db.query("milestone_delete", { id, partner_id });
      return json({ deleted: id });
    }

    // ---- reorder ----
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body || !Array.isArray(body.order)) {
        return json({ error: "Expected { order: [id, id, …] }" }, 400);
      }
      // Positions come from this array's order, not from the client's numbers.
      // A client that sends duplicate or sparse sort_orders cannot corrupt the
      // sequence, because it never supplies one.
      for (let i = 0; i < body.order.length; i++) {
        await db.query("milestone_reorder", {
          id: String(body.order[i]), partner_id, sort_order: i, now,
        });
      }
      return json({ reordered: body.order.length });
    }

    return json({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST, DELETE, PATCH",
    });
  },
};
