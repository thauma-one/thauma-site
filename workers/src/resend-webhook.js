/**
 * resend-webhook.js — what happened to each copy of a newsletter
 *
 *   POST /api/resend-webhook      called by Resend, never by a person
 *
 * BACKLOG §1 "Opens and bounces, with good UX". The send stores Resend's
 * message id on each recipient's row (mailing_recipients.provider_id); Resend
 * then reports what became of that message here:
 *
 *   email.bounced     the copy is marked bounced; a PERMANENT bounce (the
 *                     address does not exist) also stops the subscriber
 *                     being sent to, as the list's "bounced" status already
 *                     means. A temporary one (a full mailbox) changes only
 *                     the copy.
 *   email.complained  the person pressed "Report spam": they are
 *                     unsubscribed. Sending again to somebody who said so is
 *                     what gets a domain's mail sent to spam for everyone.
 *   email.opened      opened_at, the first time (0016 says why opens are a
 *   email.clicked     soft signal); clicked_at, last_click_at, click_count,
 *                     and the link's own count in mailing_links.
 *
 * Opens and clicks arrive only while the sending domain has tracking on in
 * Resend; bounces and complaints always do.
 *
 * WHO IS ASKING: anyone can reach this address, so every call must carry
 * Resend's signature (Svix: svix-id, svix-timestamp, svix-signature, an
 * HMAC-SHA256 with the webhook's whsec_ secret, RESEND_WEBHOOK_SECRET). No
 * secret set means nothing is accepted. A message id this database never
 * stored (a test send, a confirmation, another deployment's mail) is
 * answered 200 and ignored, so Resend does not retry it forever.
 */
import { createDb } from "./lib/db.js";
import { json } from "./lib/store.js";

const TOLERANCE_S = 5 * 60;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

/* Svix's scheme: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)),
   any of the space-separated "v1,<sig>" entries may match. */
export async function verifySvix(secret, headers, body, now = Date.now()) {
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), sigs = headers.get("svix-signature");
  if (!secret || !id || !ts || !sigs) return false;
  if (!/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > TOLERANCE_S) return false;
  let key;
  try {
    key = await crypto.subtle.importKey("raw", b64ToBytes(String(secret).replace(/^whsec_/, "")),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  } catch { return false; }
  const want = bytesToB64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  return sigs.split(" ").some((part) => {
    const [ver, sig] = part.split(",");
    if (ver !== "v1" || !sig || sig.length !== want.length) return false;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
    return diff === 0;
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    const body = await request.text();
    if (!(await verifySvix(env.RESEND_WEBHOOK_SECRET, request.headers, body))) {
      return json({ error: "Not signed by Resend" }, 401);
    }
    let event;
    try { event = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
    const type = String(event && event.type || "");
    const data = (event && event.data) || {};
    const provider_id = String(data.email_id || "");
    if (!provider_id || !env.DB) return json({ ok: true, ignored: true });

    const db = createDb(env.DB);
    const copy = await db.queryOne("recipient_by_provider", { provider_id });
    if (!copy) return json({ ok: true, ignored: true });
    const now = new Date().toISOString();

    if (type === "email.bounced") {
      const b = data.bounce || {};
      await db.query("recipient_bounced", { provider_id, now,
        error: String(b.message || b.subType || "Bounced").slice(0, 500) });
      if (/permanent/i.test(String(b.type || ""))) await db.query("subscriber_bounced", { id: copy.subscriber_id, now });
    } else if (type === "email.complained") {
      await db.query("recipient_complained", { provider_id, now });
      await db.query("subscriber_unsubscribe_by_id", { id: copy.subscriber_id, now });
    } else if (type === "email.opened") {
      await db.query("recipient_opened", { provider_id, now });
    } else if (type === "email.clicked") {
      await db.query("recipient_clicked", { provider_id, now });
      const url = String((data.click && data.click.link) || "").slice(0, 2000);
      if (url) {
        const link = await db.queryOne("mailing_link_find", { mailing_id: copy.mailing_id, url });
        if (link) await db.query("mailing_link_count", { id: link.id });
        else await db.query("mailing_link_add", { id: "lk_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), mailing_id: copy.mailing_id, url, now });
      }
    }
    return json({ ok: true });
  },
};
