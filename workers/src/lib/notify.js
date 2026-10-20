/**
 * Notices: something happened that somebody asked to be told about — by
 * email, and in the console's bell (0060).
 *
 * Chase, 2026-10-12: "Can we add email notifications for some things and the
 * ability to toggle certain ones on and off? I'm mainly thinking for admins
 * and getting email notifications when someone accepts an invitation."
 *
 * THE LIST IS HERE. Each notice says who may receive it. EVERY NOTICE STARTS
 * ON, by email and in the bell (Chase, 2026-10-13: "All notifications should
 * be on by default. Even for current users … If they turn them off, they are
 * remembered, but, if we add new notification settings, they are on by
 * default"). A person's choice is a row in notify_prefs (0056), set on
 * Settings › Notifications; no row means on — so a notice added later is on
 * for everybody, and only a switch somebody turned off stays off. A new notice is one entry below, its words in
 * src/_data/emailsAndForms.json ("notify" › "<kind>_subject" …) and its switch label in
 * staff-i18n.js ("set.notify.<kind>"), then a call to notify() where it
 * happens.
 *
 * NEVER IN THE WAY. A notice that cannot be sent is logged, not thrown: the
 * thing that happened (somebody confirming their account) must not fail
 * because a notice about it did. And the table may not exist yet — dev runs
 * against the shared database before a migration is applied — in which case
 * every notice is on.
 *
 * TWO WAYS IT ARRIVES, ONE LIST (Chase, 2026-10-13: "Add the in app
 * notifications bell"). Every notice goes to the bell as well as by email,
 * each switched on Settings › Notifications on its own; the bell's switch is
 * a notify_prefs row named 'bell:<kind>', starting as the notice does. The
 * bell keeps kind and vars and renders the same words when it is opened.
 *
 * TO A ROLE, TO EVERYONE, OR TO ONE PERSON. Most notices go to whoever holds
 * a role; `to: "all"` goes to every active account; `to: "self"` is about
 * something of that person's own (an answer to the bio they sent) and goes
 * only to them, through notifyPerson. A self notice is offered on Settings
 * only to somebody it can concern.
 *
 * THE BELL SAYS ONE LINE (Chase, 2026-10-13: "they need to be summaries of
 * what happened, not all info … When you press the notification, it opens
 * the notification to where it needs to"): notify.<kind>_summary, and the
 * notice's `link` is the exact place — the person on People, their Team
 * page, Your bio, the release on What's new. The email keeps the whole.
 */
import { sendMail, shell, h1, p, button } from "./mail.js";
import { t } from "./mail-i18n.js";
import { pushToUser, plain } from "./push.js";

export const NOTICES = [
  { kind: "invite_accepted", role: "admin" },
  /* somebody sent changes to their own bio for approval (0058) */
  { kind: "profile_proposed", role: "admin" },
  /* an administrator answered the bio you sent (0058; Chase 2026-10-13:
     "Even a notification if it was approved or declined is good") */
  { kind: "profile_approved", to: "self" },
  { kind: "profile_declined", to: "self" },
  /* the site was published; the notice opens that release on What's new
     (Chase, 2026-10-13: "a notification to users when the site was updated
     with a changelog. Essentially when the publish button is pressed"). To
     everybody. */
  { kind: "site_published", to: "all" },
  /* an administrator stopped working inside your console (Chase,
     2026-10-19: "After Sharing the Console of someone, a notification
     should be sent to the web notification icon once stopping the share.
     That notification should always occur, so no need to be able to
     disable it. And it should take you to the activity page"). The bell
     only, always: no switch in Settings, no email. */
  { kind: "console_shared", to: "self", always: true, bellOnly: true },
];

const BELL = "bell:";

const esc = (s) => String(s == null ? "" : s)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The notices a person with these roles may receive, with their choice by
    email (`on`) and in the bell (`bell`). `self`: offer the notices about
    their own things (they have a team page). */
export async function noticesFor(db, userId, roles, { self = false } = {}) {
  const mine = new Set((roles || []).map(String));
  const chosen = await choices(db, userId);
  return NOTICES.filter((n) => !n.always && (n.to === "self" ? self : n.to === "all" ? true : mine.has(n.role)))
    .map((n) => ({ kind: n.kind, on: wants(chosen, n), bell: wants(chosen, n, BELL) }));
}

/** The pref row's name for a channel: 'kind' (email) or 'bell:kind'. */
export function prefKind(kind, channel) { return channel === "bell" ? BELL + kind : kind; }

/* on unless this person turned it off */
const wants = (chosen, n, pre = "") => chosen.has(pre + n.kind) ? chosen.get(pre + n.kind) : true;

async function choices(db, userId) {
  const out = new Map();
  try {
    for (const r of await db.query("notify_prefs_for_user", { user_id: userId })) out.set(r.kind, !!r.is_on);
  } catch { /* no table yet: every notice is on */ }
  return out;
}

/** Tell everyone who wants to know. vars: the notice's words' {placeholders}. */
export async function notify(env, db, kind, vars = {}, opts = {}) {
  const notice = NOTICES.find((n) => n.kind === kind);
  if (!notice || notice.to === "self") return { sent: 0 };
  let sent = 0;
  try {
    const people = notice.to === "all" ? await db.query("notify_everyone", {})
      : await db.query("notify_role_holders", { role: notice.role });
    for (const who of people) {
      /* opts.only(who): a notice that concerns some of them (a release with
         nothing on their pages tells them nothing) */
      if (typeof opts.only === "function" && !opts.only(who)) continue;
      /* opts.varsFor(who): words that differ by person (a release names
         each person's own pages) */
      const mine = typeof opts.varsFor === "function" ? { ...vars, ...opts.varsFor(who) } : vars;
      sent += await deliver(env, db, who, notice, mine, opts);
    }
  } catch (e) {
    console.error("notice " + kind, e);
  }
  return { sent };
}

/** Tell one person, about something of their own (a `to: "self"` notice). */
export async function notifyPerson(env, db, kind, userId, vars = {}, opts = {}) {
  const notice = NOTICES.find((n) => n.kind === kind);
  if (!notice) return { sent: 0 };
  try {
    const who = await db.queryOne("notify_person", { user_id: userId });
    return { sent: who ? await deliver(env, db, who, notice, vars, opts) : 0 };
  } catch (e) {
    console.error("notice " + kind, e);
    return { sent: 0 };
  }
}

/* One person: the bell, then the email, each as they chose. Returns 1 when
   the email went. */
async function deliver(env, db, who, notice, vars, { origin = "https://thauma.one", link = "/admin/users/", send = sendMail } = {}) {
  const kind = notice.kind;
  const chosen = await choices(db, who.user_id);
  if (notice.always || wants(chosen, notice, BELL)) {
    await db.query("notice_add", {
      id: "n_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      user_id: who.user_id, kind, vars: JSON.stringify(vars), link, now: new Date().toISOString(),
    }).catch(() => { /* no table yet (0060): email still goes */ });
    /* THE SAME SWITCH REACHES THE PHONE (0063): Settings' second column is
       "Web" in a browser and "App" in the installed console — one notice,
       one switch, in the bell and on every phone this person turned
       notifications on. The bell's one line is the message; pressing it
       opens the same place. */
    await pushToUser(env, db, who.user_id, {
      title: plain(noticeWords(kind, who.preferred_lang, vars).summary), body: "", link, tag: kind,
    }).catch(() => {});
  }
  if (notice.bellOnly || !wants(chosen, notice)) return 0;
  const mail = noticeEmail(kind, { ...vars, origin, link, lang: who.preferred_lang });
  const r = await send(env, { to: who.email, ...mail }).catch((e) => ({ ok: false, error: e.message }));
  if (r && r.ok !== false) return 1;
  console.error("notice " + kind + " to " + who.email + ": " + ((r && r.error) || "not sent"));
  return 0;
}

/** A notice's words in one language: the heading, the body and the bell's
    one-line summary as safe HTML (only <b> is markup; every value is
    escaped), and the note, if any —
    something a person wrote to go with it (an administrator's word on a
    declined bio). `_v` in vars picks a second wording of the body, e.g.
    profile_approved_body_edited. Shared by the email and the bell. */
export function noticeWords(kind, lang, vars = {}) {
  const { _v, note, ...rest } = vars;
  const safe = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, esc(v)]));
  return {
    heading: worded(lang, kind, "heading", _v, rest),
    body: worded(lang, kind, "body", _v, safe),
    /* the bell's one line, as safe HTML like the body */
    summary: worded(lang, kind, "summary", _v, safe),
    note: note ? String(note).slice(0, 600) : "",
  };
}

/* notify.<kind>_<part>_<variant> where it exists, else notify.<kind>_<part> */
function worded(lang, kind, part, v, vars) {
  const key = `notify.${kind}_${part}` + (v ? "_" + v : "");
  const got = t(lang, key, vars);
  return got === key ? t(lang, `notify.${kind}_${part}`, vars) : got;
}

/** One notice's email, in the reader's language. */
export function noticeEmail(kind, { lang, origin, link, ...vars }) {
  const w = noticeWords(kind, lang, vars);
  const url = String(origin || "https://thauma.one").replace(/\/+$/, "") + (link || "/");
  const off = t(lang, "notify.off");
  return {
    subject: worded(lang, kind, "subject", vars._v, vars),
    text: [w.heading, "", w.body.replace(/<\/?b>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m, c) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[c])),
           ...(w.note ? ["", "\u201c" + w.note + "\u201d"] : []),
           "", url, "", off].join("\n"),
    html: shell({
      heading: w.heading,
      origin,
      /* a notice is amber, as on the canvas (round 5, N · Notice) */
      accent: "#F5B845",
      cue: t(lang, "notify.cue"),
      footer: esc(off),
      rows: [
        h1(esc(w.heading)),
        p(w.body.replace(/<b>/g, '<b style="color:#FFFFFF;">')),
        ...(w.note ? [p("<i>\u201c" + esc(w.note) + "\u201d</i>")] : []),
        button(url, t(lang, `notify.${kind}_button`, vars)),
      ],
    }),
  };
}
