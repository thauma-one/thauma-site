/**
 * admin.js — organisation administration
 *
 *   GET    /api/admin                 users, partners, languages, recent audit
 *   POST   /api/admin                 create a user
 *   PATCH  /api/admin                 change one thing (roles, access, status…)
 *   DELETE /api/admin?id=…            remove a user
 *
 * THE ROLE CHECK IS THE WHOLE SECURITY MODEL HERE
 * ---------------------------------------------------------------------------
 * Every other endpoint in this Worker is partner-scoped: whatever it returns,
 * it returns for ONE partner, and a bug leaks that partner's data to somebody
 * who already had a grant to it. Nothing here is scoped. These queries reach
 * every user, every partner and the whole audit log by design.
 *
 * So the guard is done once, at the very top, before anything is read — and it
 * fails closed. There is no branch that runs before it, and no operation that
 * re-checks in its own way.
 *
 * WHAT AN ADMIN STILL CANNOT DO
 * ---------------------------------------------------------------------------
 * Read a partner's supporters. That needs a partner_users grant, which an
 * admin can give themselves — but doing so is an explicit act that lands in
 * audit_log with their name on it. "I can fix anything" stays true; "I have
 * standing access to everyone's supporters" does not.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";

const ROLES = new Set(["admin", "staff", "board"]);
const STATUSES = new Set(["invited", "active", "suspended"]);
const PARTNER_ROLES = new Set(["owner", "assist", "view"]);

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};

/** Resolve the caller, and refuse anyone who is not an administrator. */
async function requireAdmin(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const rows = await db.query("partners_for_user", { email: user.email });

  // No partner grant at all still means no admin screen. An account has to be
  // a known, active user before its roles mean anything.
  if (!rows.length) {
    return { denied: json({ error: "No access for this account", email: user.email }, 403) };
  }
  const me = rows[0];
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.includes("admin")) {
    return {
      denied: json({
        error: "Administration is limited to administrators.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me, roles };
}

/** Append to the record. A failed note must not fail the action it describes. */
async function audit(db, { user, action, entity, entity_id = null, detail = null, partner_id = null }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id,
      action, entity, entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/** Would this change leave the organisation with no administrator? */
async function wouldStrandOrg(db, { userId, removingRole, removingUser }) {
  if (removingRole && removingRole !== "admin" && !removingUser) return false;
  const row = await db.queryOne("admin_count_admins", {});
  const admins = row ? row.n : 0;
  if (admins > 1) return false;

  // One admin left — is it this person?
  const users = await db.query("admin_users", {});
  const target = users.find((u) => u.id === userId);
  if (!target) return false;
  const targetRoles = String(target.roles || "").split(",").filter(Boolean);
  return targetRoles.includes("admin") && target.status === "active";
}

export default {
  async fetch(request, env) {
    const { db, user, me, denied } = await requireAdmin(request, env);
    if (denied) return denied;

    const now = new Date().toISOString();
    const url = new URL(request.url);

    /* ---------------------------------------------------------------- GET */
    if (request.method === "GET") {
      const [users, partners, languages, recent] = await Promise.all([
        db.query("admin_users", {}),
        db.query("admin_partners", {}),
        db.query("languages_all", {}),
        db.query("admin_audit_recent", { limit: 40 }),
      ]);
      return json({
        you: { email: user.email, name: me.user_name || null, roles: ["admin"] },
        users: users.map((u) => ({
          ...u,
          roles: String(u.roles || "").split(",").filter(Boolean),
          partner_ids: String(u.partner_ids || "").split(",").filter(Boolean),
          partner_names: String(u.partner_names || "").split(" | ").filter(Boolean),
        })),
        partners,
        languages,
        audit: recent,
      });
    }

    /* --------------------------------------------------------------- POST */
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const email = str(body.email, 200);
      const name = str(body.name, 200);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return json({ error: "A valid email address is required" }, 400);
      }
      if (!name) return json({ error: "A name is required" }, 400);

      const id = "u_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      try {
        await db.query("admin_user_create", { id, email, name, now });
      } catch (e) {
        // users.email is UNIQUE COLLATE NOCASE.
        return json({ error: "Somebody already has that email address." }, 409);
      }
      await db.query("admin_role_grant", {
        user_id: id, role: "staff", granted_by: me.user_id, now,
      });
      await audit(db, { user, action: "create", entity: "user", entity_id: id,
                        detail: { email, name } });

      return json({
        created: id,
        // Said here because it is the thing people get wrong: a row in this
        // table is not an account. Access decides who can sign in.
        note: "Invited. They also need adding to Cloudflare Access, and their " +
              "status set to active, before they can sign in.",
        users: await listUsers(db),
      });
    }

    /* -------------------------------------------------------------- PATCH */
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);
      const userId = str(body.user_id, 64);

      // ---- grant or revoke an org role ----
      if (body.role) {
        if (!ROLES.has(body.role)) return json({ error: "Unknown role" }, 400);
        if (!userId) return json({ error: "user_id is required" }, 400);

        if (!body.grant && await wouldStrandOrg(db, { userId, removingRole: body.role })) {
          return json({
            error: "That is the last active administrator. Appoint another " +
                   "before removing this one — the screen that grants roles is " +
                   "itself limited to administrators.",
          }, 409);
        }

        await db.query(body.grant ? "admin_role_grant" : "admin_role_revoke", {
          user_id: userId, role: body.role, granted_by: me.user_id, now,
        });
        await audit(db, { user, action: body.grant ? "grant" : "revoke",
                          entity: "user_role", entity_id: userId,
                          detail: { role: body.role } });
        return json({ users: await listUsers(db) });
      }

      // ---- grant or revoke access to a partner ----
      if (body.partner_id) {
        if (!userId) return json({ error: "user_id is required" }, 400);
        const partnerRole = PARTNER_ROLES.has(body.partner_role) ? body.partner_role : "view";

        await db.query(body.grant ? "admin_partner_grant" : "admin_partner_revoke", {
          partner_id: body.partner_id, user_id: userId,
          role: partnerRole, granted_by: me.user_id, now,
        });
        // Recorded against the PARTNER as well as the org, so it appears on
        // that partner's own Activity page. Somebody being given access to
        // their supporters is their business.
        await audit(db, { user, action: body.grant ? "grant" : "revoke",
                          entity: "partner_access", entity_id: userId,
                          partner_id: body.partner_id,
                          detail: { role: partnerRole } });
        return json({ users: await listUsers(db) });
      }

      // ---- name or status ----
      if (body.status !== undefined || body.name !== undefined) {
        if (!userId) return json({ error: "user_id is required" }, 400);
        const status = STATUSES.has(body.status) ? body.status : null;
        if (body.status !== undefined && !status) {
          return json({ error: "Unknown status" }, 400);
        }
        const users = await db.query("admin_users", {});
        const target = users.find((u) => u.id === userId);
        if (!target) return json({ error: "No such user" }, 404);

        if (status && status !== "active" &&
            await wouldStrandOrg(db, { userId, removingUser: true })) {
          return json({
            error: "That is the last active administrator. Appoint another first.",
          }, 409);
        }

        await db.query("admin_user_set", {
          id: userId,
          name: str(body.name, 200) || target.name,
          status: status || target.status,
        });
        await audit(db, { user, action: "update", entity: "user", entity_id: userId,
                          detail: { name: body.name, status } });
        return json({ users: await listUsers(db) });
      }

      // ---- a partner's default language ----
      if (body.default_lang && body.for_partner) {
        const langs = await db.query("languages_all", {});
        if (!langs.some((l) => l.code === body.default_lang && l.is_active)) {
          return json({ error: "Unknown language" }, 400);
        }
        // The default must be a language that partner actually publishes, or
        // the fallback points at nothing.
        const enabled = await db.query("partner_languages_for_partner",
                                       { partner_id: body.for_partner });
        const target = enabled.find((l) => l.code === body.default_lang);
        if (!target || !target.is_enabled) {
          return json({
            error: `${body.default_lang.toUpperCase()} is not switched on for ` +
                   `that partner. Enable it first.`,
          }, 400);
        }
        await db.query("partner_set_default_lang", {
          partner_id: body.for_partner, lang: body.default_lang, now,
        });
        await audit(db, { user, action: "update", entity: "partner.default_lang",
                          entity_id: body.for_partner, partner_id: body.for_partner,
                          detail: { lang: body.default_lang } });
        return json({ partners: await db.query("admin_partners", {}) });
      }

      return json({ error: "Nothing to change" }, 400);
    }

    /* ------------------------------------------------------------- DELETE */
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id is required" }, 400);

      if (id === me.user_id) {
        return json({ error: "You cannot remove your own account." }, 409);
      }
      if (await wouldStrandOrg(db, { userId: id, removingUser: true })) {
        return json({
          error: "That is the last active administrator. Appoint another first.",
        }, 409);
      }

      await db.query("admin_user_delete", { id });
      // Recorded BEFORE the row is gone would be better, but audit_log keeps
      // the email rather than a foreign key, so the record survives the delete.
      await audit(db, { user, action: "delete", entity: "user", entity_id: id });
      return json({ deleted: id, users: await listUsers(db) });
    }

    return json({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST, PATCH, DELETE",
    });
  },
};

async function listUsers(db) {
  const users = await db.query("admin_users", {});
  return users.map((u) => ({
    ...u,
    roles: String(u.roles || "").split(",").filter(Boolean),
    partner_ids: String(u.partner_ids || "").split(",").filter(Boolean),
    partner_names: String(u.partner_names || "").split(" | ").filter(Boolean),
  }));
}
