/**
 * admin-actas.js — start and stop viewing somebody else's console
 *
 *   GET    /api/admin/act-as    who, if anyone, you are currently viewing as
 *   POST   /api/admin/act-as    { user_id } — start
 *   DELETE /api/admin/act-as    stop
 *
 * All this does is set and clear a cookie. The cookie names a user id and
 * grants nothing: every request is still authenticated by Cloudflare Access,
 * and lib/actas.js re-checks the REAL caller's admin role before honouring it.
 * See the header there — the invariant matters more than this file does.
 *
 * STARTING AND STOPPING ARE BOTH AUDITED, and the pair is the useful record:
 * "Chase viewed Ana's console from 14:02 to 14:19" is a sentence somebody can
 * act on. Every change made in between is audited separately by
 * auditActingWrite, so the log answers both "who looked" and "what did they
 * touch" without recording every page load in between.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { requestedTarget, setCookie, clearCookie } from "./lib/actas.js";

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
        error: "Viewing another account is limited to administrators.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me };
}

async function audit(db, { actorEmail, action, targetId, detail }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: actorEmail,
      partner_id: null,
      action,
      entity: "acting",
      entity_id: targetId,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;

    if (request.method === "GET") {
      const id = requestedTarget(request);
      if (!id) return json({ acting: null });
      const row = await db.queryOne("user_by_id", { id });
      return json({
        acting: row ? { id: row.user_id, name: row.user_name || row.email, email: row.email } : null,
      });
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body || !body.user_id) return json({ error: "Which account?" }, 400);

      const row = await db.queryOne("user_by_id", { id: String(body.user_id) });
      if (!row) {
        // Covers "no such person" and "suspended" alike, deliberately: a
        // suspended account is one nobody should be standing inside either.
        return json({ error: "That is not an active account." }, 404);
      }
      if (row.user_id === me.user_id) {
        return json({ error: "You are already yourself." }, 400);
      }

      await audit(db, {
        actorEmail: user.email,
        action: "actas.start",
        targetId: row.user_id,
        detail: { as: row.user_name || row.email, as_email: row.email },
      });

      return json({
        ok: true,
        acting: { id: row.user_id, name: row.user_name || row.email, email: row.email },
      }, 200, { "Set-Cookie": setCookie(row.user_id) });
    }

    if (request.method === "DELETE") {
      const id = requestedTarget(request);
      if (id) {
        await audit(db, { actorEmail: user.email, action: "actas.stop", targetId: id, detail: null });
      }
      // Cleared whatever the cookie said, including nothing. Stopping must
      // never fail — it is the way out.
      return json({ ok: true, acting: null }, 200, { "Set-Cookie": clearCookie() });
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
