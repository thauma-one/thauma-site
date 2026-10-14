/**
 * push.js — who a push goes to, and keeping the list of phones honest
 *
 * lib/webpush.js sends one encrypted message to one phone. This decides which
 * phones: a person's console app on each of their devices (staff), or every
 * phone that asked a ministry for news (supporters, by topic). And it keeps
 * the list clean: a phone the push service says is gone (the app removed,
 * permission withdrawn) is forgotten at once; one that merely fails is
 * counted and dropped at the fifth failure.
 *
 * NEVER IN THE WAY. Like a notice by email, a push that cannot be sent is
 * logged, not thrown — and before 0063 is applied there is nobody to send to.
 */
import { sendPush, pushReady } from "./webpush.js";

async function deliverAll(env, db, subs, message, opts = {}) {
  let sent = 0;
  const now = new Date().toISOString();
  for (const sub of subs) {
    const r = await sendPush(env, sub, message, opts);
    if (r.ok) { sent++; await db.query("push_sub_sent", { id: sub.id, now }).catch(() => {}); }
    else if (r.gone) await db.query("push_sub_gone", { id: sub.id }).catch(() => {});
    else {
      console.error("push " + sub.id + ": " + (r.error || r.status));
      await db.query("push_sub_failed", { id: sub.id }).catch(() => {});
    }
  }
  if (subs.length) await db.query("push_subs_drop_failing", {}).catch(() => {});
  return sent;
}

/** A person's console app, on every phone they turned it on. */
export async function pushToUser(env, db, userId, message) {
  if (!pushReady(env)) return 0;
  let subs = [];
  try { subs = await db.query("push_subs_for_user", { user_id: userId }); } catch { return 0; }
  return deliverAll(env, db, subs, message, { urgency: "normal" });
}

/** Every phone that asked a ministry for news about `topic` (prayer,
    updates, goals); a phone with no topics chosen hears everything. */
export async function pushToPartner(env, db, partnerId, message, topic = null) {
  if (!pushReady(env)) return { sent: 0, phones: 0 };
  let subs = [];
  try { subs = await db.query("push_subs_for_partner", { partner_id: partnerId }); } catch { return { sent: 0, phones: 0 }; }
  const wanted = subs.filter((s) => {
    if (!topic) return true;
    let t = [];
    try { t = JSON.parse(s.topics || "[]"); } catch { t = []; }
    return !t.length || t.includes(topic);
  });
  return { sent: await deliverAll(env, db, wanted, message), phones: wanted.length };
}

/** A push message's text from a notice's one-line summary (safe HTML with
    <b> and escaped values) — plain text, as a phone shows it. */
export function plain(html) {
  return String(html || "").replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[c]));
}
