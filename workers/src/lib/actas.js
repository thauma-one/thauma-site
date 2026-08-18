/**
 * actas.js — an administrator working inside somebody else's console
 *
 * Thauma is one person supporting several others. When a partner says "the
 * stewardship page is empty and it should not be", the only way to see what
 * they see is to see what they see — and the alternative to building this is
 * asking for their password, which is worse in every way that matters.
 *
 * THE ONE INVARIANT: THE COOKIE IS A REQUEST, NOT A CREDENTIAL
 * ---------------------------------------------------------------------------
 * `thauma_act_as` names a user id. It grants nothing. Every request still
 * arrives with a Cloudflare Access JWT, that JWT is still verified, and the
 * REAL caller is looked up and checked for the admin role before the cookie is
 * so much as read. A staff member who sets the cookie by hand gets exactly
 * their own data, because authority is derived from the token every time and
 * never from the cookie.
 *
 * This is why the cookie needs no signing and no server-side session. There is
 * nothing to forge: the worst a forged cookie achieves is being ignored.
 *
 * WHAT GETS RECORDED
 * ---------------------------------------------------------------------------
 * Starting and stopping are audited by the endpoint. Everything that CHANGES
 * something while acting is audited here, in one place, because a per-handler
 * approach would have to be remembered in every handler written afterwards and
 * eventually would not be.
 *
 * Reads are deliberately not audited per request. A page load is a dozen
 * requests, and an audit log that records every one of them is an audit log
 * nobody reads. "Chase viewed Ana's console from 14:02 to 14:19" plus every
 * write in between is the useful record; "Chase issued GET /api/staff-data" a
 * hundred times is noise that hides it.
 *
 * NOT AVAILABLE TO NON-ADMINS, AND NOT SILENT WHEN IT IS IN EFFECT. The
 * console paints a border round the whole viewport and a banner naming whose
 * account it is. Chase's instinct was a flashing banner; a permanent one plus
 * the border is both harder to miss and not a photosensitivity hazard.
 */
import { json } from "./store.js";

export const COOKIE = "thauma_act_as";

/** The target user id somebody is ASKING to act as. Trusted for nothing. */
export function requestedTarget(request) {
  const raw = request.headers.get("cookie") || "";
  const m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)").exec(raw);
  if (!m) return null;
  const v = decodeURIComponent(m[1]).trim();
  // User ids in this schema are `u_` plus a short slug. Anything else is not a
  // user id, so it is not worth a database round trip.
  return /^u_[a-z0-9_]{1,60}$/i.test(v) ? v : null;
}

export function setCookie(userId) {
  // Session cookie — no Max-Age. Closing the browser ends it, which is the
  // right default for standing inside somebody else's account.
  return `${COOKIE}=${encodeURIComponent(userId)}; Path=/; SameSite=Lax; Secure`;
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; SameSite=Lax; Secure; Max-Age=0`;
}

/**
 * Who this request should be treated as.
 *
 * Returns:
 *   email     the address every downstream query should use
 *   me        that person's user row
 *   real      the signed-in administrator's row, when acting
 *   acting    { id, name } when acting, otherwise null
 *
 * Falls back to the caller's own identity whenever anything is off — not an
 * admin, no such target, target not active. Failing back to yourself is the
 * only safe direction: the failure mode of the opposite is an administrator
 * silently editing the wrong person's ministry.
 */
export async function resolveActor(request, env, db, user) {
  const own = await db.queryOne("user_by_email", { email: user.email });
  const base = { email: user.email, me: own, real: null, acting: null };

  const target = requestedTarget(request);
  if (!target) return base;

  // The admin check is on the REAL caller and happens before the target is
  // looked at. Nothing about the cookie can influence this.
  const roles = String((own && own.roles) || "").split(",").filter(Boolean);
  if (!roles.includes("admin")) return base;

  if (own && own.user_id === target) return base; // acting as yourself is just being yourself

  const targetRow = await db.queryOne("user_by_id", { id: target });
  if (!targetRow || targetRow.status !== "active") return base;

  /* user_by_email/user_by_id return user_id and user_name, NOT id and name.
     Two callers written this week used `me.name` and silently got undefined —
     the tests passed because the stubs returned the wrong shape. Use the
     query's own column names. */
  return {
    email: targetRow.email,
    me: targetRow,
    real: own,
    acting: { id: targetRow.user_id, name: targetRow.user_name || targetRow.email },
  };
}

/**
 * Record a change made from inside somebody else's account.
 *
 * The request is cloned before its body is read, because the handler still
 * needs it. Bodies here are small JSON documents; anything unreasonable is
 * recorded as its size rather than its content, so an audit row cannot become
 * a way to store a megabyte in the database.
 */
export async function auditActingWrite(request, db, actor) {
  if (!actor.acting) return;
  if (request.method === "GET" || request.method === "HEAD") return;

  let detail = null;
  try {
    const text = await request.clone().text();
    detail = text.length > 4000 ? { body_bytes: text.length } : JSON.parse(text || "null");
  } catch {
    detail = { body: "unreadable" };
  }

  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      // The ADMINISTRATOR, never the person being acted as. An audit row that
      // named the target would say the partner did something they did not do,
      // which is the precise thing this record exists to prevent.
      user_id: actor.real ? actor.real.email : "unknown",
      partner_id: null,
      action: "actas.change",
      entity: "acting",
      entity_id: actor.acting.id,
      detail: JSON.stringify({
        as: actor.acting.name,
        method: request.method,
        path: new URL(request.url).pathname,
        change: detail,
      }),
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/** Add the acting banner's data to any response body. */
export function withActing(body, actor) {
  if (!actor.acting) return body;
  return {
    ...body,
    acting: {
      id: actor.acting.id,
      name: actor.acting.name,
      by: actor.real ? (actor.real.user_name || actor.real.email) : null,
      /* THE LANGUAGE THEY READ THE CONSOLE IN, carried on the banner rather
         than dug out of whichever payload happens to include it.

         Seeing what somebody sees means seeing it in their language — a
         support call about a screen they cannot read is not helped by an
         English copy of it. And putting it here means every endpoint that
         reports acting also reports the language, so the browser never has to
         guess which response to trust. */
      lang: (actor.me && actor.me.preferred_lang) || "en",
    },
  };
}

/** Refuse an action outright while acting as somebody else. */
export function refuseWhileActing(actor, what) {
  if (!actor.acting) return null;
  return json({
    error: `${what} is not available while you are viewing ${actor.acting.name}'s account. ` +
           `Stop viewing first.`,
    acting: actor.acting,
  }, 409);
}
