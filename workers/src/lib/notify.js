/**
 * Notices by email: something happened that somebody asked to be told about.
 *
 * Chase, 2026-10-12: "Can we add email notifications for some things and the
 * ability to toggle certain ones on and off? I'm mainly thinking for admins
 * and getting email notifications when someone accepts an invitation."
 *
 * THE LIST IS HERE. Each notice says who may receive it (a role) and whether
 * it starts on. A person's own choice is a row in notify_prefs (0056), set on
 * Settings › Account › "Email me when"; a notice with no row keeps its
 * starting value. A new notice is one entry below, its words in
 * src/_data/emailsAndForms.json ("notify" › "<kind>_subject" …) and its switch label in
 * staff-i18n.js ("set.notify.<kind>"), then a call to notify() where it
 * happens.
 *
 * NEVER IN THE WAY. A notice that cannot be sent is logged, not thrown: the
 * thing that happened (somebody confirming their account) must not fail
 * because a notice about it did. And the table may not exist yet — dev runs
 * against the shared database before a migration is applied — in which case
 * every notice keeps its starting value.
 */
import { sendMail, shell, h1, p, button } from "./mail.js";
import { t } from "./mail-i18n.js";

export const NOTICES = [
  { kind: "invite_accepted", role: "admin", on: true },
];

const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The notices a person with these roles may receive, with their choice. */
export async function noticesFor(db, userId, roles) {
  const mine = new Set((roles || []).map(String));
  const chosen = await choices(db, userId);
  return NOTICES.filter((n) => mine.has(n.role))
    .map((n) => ({ kind: n.kind, on: chosen.has(n.kind) ? chosen.get(n.kind) : n.on }));
}

async function choices(db, userId) {
  const out = new Map();
  try {
    for (const r of await db.query("notify_prefs_for_user", { user_id: userId })) out.set(r.kind, !!r.is_on);
  } catch { /* no table yet: every notice keeps its starting value */ }
  return out;
}

/** Tell everyone who wants to know. vars: the notice's words' {placeholders}. */
export async function notify(env, db, kind, vars = {}, { origin = "https://thauma.one", link = "/admin/users/", send = sendMail } = {}) {
  const notice = NOTICES.find((n) => n.kind === kind);
  if (!notice) return { sent: 0 };
  let sent = 0;
  try {
    const people = await db.query("notify_role_holders", { role: notice.role });
    for (const who of people) {
      const chosen = await choices(db, who.user_id);
      if (!(chosen.has(kind) ? chosen.get(kind) : notice.on)) continue;
      const mail = noticeEmail(kind, { ...vars, origin, link, lang: who.preferred_lang });
      const r = await send(env, { to: who.email, ...mail }).catch((e) => ({ ok: false, error: e.message }));
      if (r && r.ok !== false) sent++;
      else console.error("notice " + kind + " to " + who.email + ": " + ((r && r.error) || "not sent"));
    }
  } catch (e) {
    console.error("notice " + kind, e);
  }
  return { sent };
}

/** One notice's email, in the reader's language. */
export function noticeEmail(kind, { lang, origin, link, ...vars }) {
  const T = (k) => t(lang, `notify.${kind}_${k}`, vars);
  const safe = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, esc(v)]));
  const body = t(lang, `notify.${kind}_body`, safe);
  const url = String(origin || "https://thauma.one").replace(/\/+$/, "") + (link || "/");
  const off = t(lang, "notify.off");
  return {
    subject: T("subject"),
    text: [T("heading"), "", body.replace(/<\/?b>/g, ""), "", url, "", off].join("\n"),
    html: shell({
      heading: T("heading"),
      origin,
      footer: esc(off),
      rows: [
        h1(esc(T("heading"))),
        p(body.replace(/<b>/g, '<b style="color:#FFFFFF;">')),
        button(url, T("button")),
      ],
    }),
  };
}
