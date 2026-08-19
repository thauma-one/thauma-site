/**
 * staff-goals.js — creating and editing giving goals
 *
 *   GET    /api/staff-goals          every goal, with its latest figures
 *   POST   /api/staff-goals          create or update one
 *   PATCH  /api/staff-goals          record progress by hand
 *   DELETE /api/staff-goals?id=…     remove one
 *
 * The console could show goals and not touch them: they arrived by seed and
 * stayed. This is the milestone editor's shape, deliberately, because it is
 * the same job — a small set of rows a partner owns, edited in place.
 *
 * TWO KINDS OF WRITE, AND THEY ARE NOT THE SAME KIND OF THING
 * ---------------------------------------------------------------------------
 * A goal's DEFINITION — what it is called, what it is for, what it is asking
 * for — is edited. Its PROGRESS is not: progress is a reading taken at a
 * moment, so it is appended as a snapshot and the newest one wins. That is
 * why PATCH exists separately from POST.
 *
 * Appending rather than updating means a mistyped figure is corrected by
 * entering the right one, not by rewriting history, and the series stays
 * available for a sparkline later. It also means a partner whose giving
 * platform gains an API integration tomorrow needs no migration: the importer
 * appends snapshots with its own `source` and the hand-entered ones simply
 * stop being the newest.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

const KINDS = ["monthly", "one_time", "project"];
/* ISO 4217 is three letters. Validated by shape rather than against a list —
   a closed list would refuse a currency the moment a partner moves somewhere
   we did not think of. */
const CURRENCY_RE = /^[A-Z]{3}$/;

const MAX_LABEL = 120;
const MAX_DESC = 600;
/* Ten million in minor units. High enough that no honest goal hits it, low
   enough that a fat-fingered extra zero is refused rather than published. */
const MAX_CENTS = 1_000_000_000;

function newId() {
  return "g_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

async function partnerFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) return { denied: json({ error: "This address is not an active account." }, 403) };

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet, so there are no goals to edit.",
    }, 403) };
  }
  return { db, user, me, partner: partners[0], actor };
}

/** Validate one goal's definition. Returns `{ value }` or `{ error }`. */
export function cleanGoal(body) {
  const label = String(body.label || "").trim();
  if (!label) return { error: "A goal needs a name." };
  if (label.length > MAX_LABEL) return { error: `The name is longer than ${MAX_LABEL} characters.` };

  const description = body.description == null ? null : String(body.description).trim() || null;
  if (description && description.length > MAX_DESC) {
    return { error: `The description is longer than ${MAX_DESC} characters.` };
  }

  const kind = String(body.kind || "");
  if (!KINDS.includes(kind)) {
    return { error: `Kind must be one of ${KINDS.join(", ")}.` };
  }

  const target_cents = Math.round(Number(body.target_cents));
  if (!Number.isFinite(target_cents) || target_cents <= 0) {
    /* The table's own CHECK says target_cents > 0. Refusing here means a
       clear sentence instead of a constraint violation. */
    return { error: "A goal needs a target greater than zero." };
  }
  if (target_cents > MAX_CENTS) return { error: "That target looks like a typo." };

  const currency = String(body.currency || "USD").toUpperCase();
  if (!CURRENCY_RE.test(currency)) {
    return { error: "Currency must be a three-letter code, like USD or EUR." };
  }

  return {
    value: {
      label, description, kind, target_cents, currency,
      is_public: body.is_public ? 1 : 0,
    },
  };
}

/** Validate a hand-entered progress reading. */
export function cleanProgress(body) {
  const raised_cents = Math.round(Number(body.raised_cents));
  if (!Number.isFinite(raised_cents) || raised_cents < 0) {
    return { error: "Raised must be zero or more." };
  }
  if (raised_cents > MAX_CENTS) return { error: "That figure looks like a typo." };

  let donor_count = null;
  if (body.donor_count !== null && body.donor_count !== undefined && body.donor_count !== "") {
    donor_count = Math.round(Number(body.donor_count));
    if (!Number.isFinite(donor_count) || donor_count < 0) {
      return { error: "The number of partners must be zero or more." };
    }
  }
  return { value: { raised_cents, donor_count } };
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, actor, denied } = await partnerFor(request, env);
    if (denied) return denied;

    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const now = new Date().toISOString();

    if (request.method === "GET") {
      const goals = await db.query("goals_for_partner", { partner_id });
      return json(withActing({
        you: {
          email: user.email,
          name: me.user_name || null,
          roles: String(me.roles || "staff").split(","),
        },
        partner: { id: partner.id, display_name: partner.display_name },
        goals: goals.map((g) => ({ ...g, is_public: !!g.is_public })),
      }, actor));
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const existing = await db.query("goals_for_partner", { partner_id });
      const ids = new Set(existing.map((g) => g.goal_id));
      const isNew = !body.id || !ids.has(body.id);
      const id = isNew ? newId() : body.id;

      const { value, error } = cleanGoal(body);
      if (error) return json({ error }, 400);

      await db.query("goal_upsert", { id, partner_id, now, ...value });

      /* A new goal with a starting figure, in one action. Without this a goal
         is created and then immediately reads 0% until somebody remembers a
         second step. */
      if (isNew && body.raised_cents !== undefined && body.raised_cents !== "") {
        const p = cleanProgress(body);
        if (p.error) return json({ error: p.error }, 400);
        await db.query("goal_snapshot_insert", {
          id: "gs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
          goal_id: id, partner_id, now, ...p.value,
        });
      }

      const goals = await db.query("goals_for_partner", { partner_id });
      return json(withActing({
        id, created: isNew,
        goals: goals.map((g) => ({ ...g, is_public: !!g.is_public })),
      }, actor));
    }

    /* Progress only. Separate from POST because it appends rather than edits
       — see the note at the top of this file. */
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const id = String(body.id || "");
      const existing = await db.query("goals_for_partner", { partner_id });
      if (!existing.some((g) => g.goal_id === id)) {
        return json({ error: "That goal does not belong to this partner." }, 404);
      }

      const { value, error } = cleanProgress(body);
      if (error) return json({ error }, 400);

      await db.query("goal_snapshot_insert", {
        id: "gs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
        goal_id: id, partner_id, now, ...value,
      });

      const goals = await db.query("goals_for_partner", { partner_id });
      return json(withActing({
        goals: goals.map((g) => ({ ...g, is_public: !!g.is_public })),
      }, actor));
    }

    if (request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ error: "No goal named." }, 400);

      /* The snapshots go with it — the foreign key is ON DELETE CASCADE, so
         deleting a goal cannot leave orphaned figures behind that a later
         query would find and be unable to explain. */
      await db.query("goal_delete", { id, partner_id });

      const goals = await db.query("goals_for_partner", { partner_id });
      return json(withActing({
        deleted: id,
        goals: goals.map((g) => ({ ...g, is_public: !!g.is_public })),
      }, actor));
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
