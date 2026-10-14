/**
 * push-api.js — a phone turning notifications on or off (0063)
 *
 *   GET    /api/push                  { ready, key }   — is push set up, and the
 *                                     public key a browser subscribes with
 *   POST   /api/push  { subscription, lang }          the console app, signed in
 *   POST   /api/push  { subscription, audience: "public", lang }   thauma.one's app
 *   POST   /api/push  { test: true }  a notice to this person's phones, to see it work
 *   DELETE /api/push  { endpoint }    this phone, off
 *
 * The console's subscription belongs to the person signed in (Cloudflare
 * Access, the real person — never somebody being viewed with act-as: a
 * phone is the administrator's own). thauma.one's app has no account, so a
 * phone there is anonymous ('public'). A ministry's app saves its phones on
 * the ministry's own address (site/app.js), not here.
 *
 * Only a real push service's address is kept (webpush.validSubscription),
 * so this cannot be used to make the Worker send to an address of anyone's
 * choosing.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { json, readJson } from "./lib/store.js";
import { pushReady, validSubscription } from "./lib/webpush.js";
import { pushToUser } from "./lib/push.js";

export async function subId(endpoint) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return "ps_" + [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const lang2 = (v) => (/^[a-z]{2,3}$/.test(String(v || "")) ? String(v) : null);
const OFF = "Notifications are not switched on for this site yet.";
const NOT_YET = "This cannot be kept until the database is updated (Review and publish › Apply changes).";

export default {
  async fetch(request, env) {
    if (request.method === "GET") {
      return json({ ready: pushReady(env), key: env.VAPID_PUBLIC_KEY || null }, 200, { "Cache-Control": "no-store" });
    }
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const db = createDb(env.DB);
    const now = new Date().toISOString();

    /* thauma.one's own app: nobody's account. */
    if (request.method === "POST" && body.audience === "public") {
      if (!pushReady(env)) return json({ error: OFF }, 409);
      const sub = validSubscription(body.subscription);
      if (!sub) return json({ error: "That is not a push subscription." }, 400);
      try {
        await db.query("push_sub_save", { id: await subId(sub.endpoint), ...sub, audience: "public", user_id: null,
          partner_id: null, lang: lang2(body.lang), topics: "[]", now });
      } catch { return json({ error: NOT_YET }, 409); }
      return json({ ok: true });
    }

    const gate = await requireAccess(request, env);
    if (gate.denied) return gate.denied;
    const me = await db.queryOne("user_by_email", { email: gate.user.email });
    if (!me) return json({ error: "No account for that address" }, 403);

    if (request.method === "DELETE") {
      const endpoint = String(body.endpoint || "");
      const row = await db.queryOne("push_sub_by_endpoint", { endpoint }).catch(() => null);
      /* only your own phone, or one nobody owns */
      if (row && row.user_id && row.user_id !== me.user_id) return json({ error: "Not your phone." }, 403);
      await db.query("push_sub_forget", { endpoint }).catch(() => {});
      return json({ ok: true });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, DELETE" });
    if (!pushReady(env)) return json({ error: OFF }, 409);

    if (body.test) {
      const sent = await pushToUser(env, db, me.user_id, {
        title: body.title && String(body.title).slice(0, 120) || "Notifications are on",
        body: "", link: "/staff/settings/#notifications", tag: "test",
      });
      return json({ ok: true, sent });
    }

    const sub = validSubscription(body.subscription);
    if (!sub) return json({ error: "That is not a push subscription." }, 400);
    try {
      await db.query("push_sub_save", { id: await subId(sub.endpoint), ...sub, audience: "staff", user_id: me.user_id,
        partner_id: null, lang: lang2(body.lang) || me.preferred_lang || null, topics: "[]", now });
    } catch { return json({ error: NOT_YET }, 409); }
    return json({ ok: true });
  },
};
