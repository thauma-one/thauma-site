/**
 * mail.js — sending transactional email through Resend
 *
 * TRANSACTIONAL ONLY. Invites, confirmations, alerts: mail somebody is
 * expecting because of something they or an administrator just did. Newsletters
 * are a different problem with different rules and belong on a different
 * sending domain — see SPEC §4a. Do not add a bulk send here; the whole point
 * of keeping them apart is that a newsletter complaint must not damage the
 * reputation that delivers an account invite.
 *
 * ⚠ EMAIL HTML IS NOT WEB HTML
 * ---------------------------------------------------------------------------
 * Outlook on Windows renders mail with Microsoft Word's engine. No flexbox, no
 * grid, no CSS variables, no external stylesheet, and a stylesheet in <head>
 * is stripped by Gmail. Everything here is therefore:
 *
 *   · tables for layout, not divs
 *   · inline styles on every element
 *   · a 600px maximum, which is the width every client agrees on
 *   · websafe fonts only — a webfont silently falls back and the layout shifts
 *   · no background images, which Outlook ignores entirely
 *
 * It looks like 2004 markup because that is what arrives intact. Modern markup
 * renders beautifully in the preview pane of the client the developer happens
 * to use, and breaks for a third of everyone else.
 *
 * A PLAIN-TEXT PART IS NOT OPTIONAL. Sending HTML alone is one of the stronger
 * spam signals there is, and some people genuinely read mail as text. Every
 * send here carries both.
 */

const RESEND = "https://api.resend.com/emails";

import { t } from "./mail-i18n.js";
import { readable } from "../embed-colour.js";

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * THE FRAME EVERY THAUMA MESSAGE SHARES — design N, "the program" (Chase,
 * 2026-10-14: "Let's go with N for the design"; the canvas, round 5).
 *
 * ONE CENTER LINE, like a printed order of service: the name at the top in
 * wide thin capitals with two short lines under it; a cue between two lines;
 * the heading thin with its last word bold, as the site's headings are; the
 * button OUTLINED in the accent (round 4: "the text and box border are the
 * color and the fill is transparent") carrying the same two lines; then a
 * hairline with a short colored segment at its center, the facts in
 * columns, and the small print under a rule.
 *
 * NO PICTURE, NO LOGO (round 4: "remove the photo … remove the logo"). The
 * band image is gone: the name is live text, so it reads with images off,
 * and a ministry's message says its own name in its own color, with Thauma
 * credited at the foot.
 *
 * STILL MAIL, NOT WEB: tables, every style inline, bgcolor as an attribute
 * wherever there is a color (Word drops a background set only in CSS), and
 * websafe faces after Sora — Apple Mail may have it; everywhere else
 * Helvetica keeps the same layout, since nothing depends on the face's width.
 * Dark only, and both schemes declared, so no client "helpfully" inverts it.
 *
 *   accent  the message's color: Thauma's blue, a notice's amber, or the
 *           ministry's own (brand.accent), made readable on the dark
 *   cue     a few words above the heading ("Invitation · The console");
 *           a ministry's `kind` when there is none
 *   facts   [{ label, value }] — up to three, in columns under the line
 */
const GROUND = "#0B0F15";
const RULE = "#1A222D";
const DISPLAY = "Sora,'Helvetica Neue',Helvetica,Arial,sans-serif";
const FACE = "Helvetica,Arial,sans-serif";

/* the two lines: a long one and a short one centered under it */
function twoLines(color, w = 64) {
  const bar = (n) => `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="${color}" width="${n}" height="1" style="width:${n}px;height:1px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
  return `${bar(w)}<div style="height:4px;font-size:0;line-height:0;">&nbsp;</div>${bar(w / 2)}`;
}

export function shell({ heading, rows, footer = "", origin, brand = null, kind = "", cue = "", accent = null, facts = null }) {
  const acc = readable(accent || (brand && brand.accent) || "#2FD8FF", GROUND, 4.5);
  const name = (brand && brand.name) || "Thauma";
  const said = cue || kind || "";
  const site = String(origin || "https://thauma.one").replace(/\/+$/, "").replace(/^https?:\/\//, "");
  const cols = (facts || []).filter((f) => f && f.label && f.value).slice(0, 3);
  const line = (w) => `<td width="${w}" style="width:${w}px;font-size:0;line-height:0;"><div style="height:1px;background:${acc};font-size:0;line-height:0;">&nbsp;</div></td>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       bgcolor="${GROUND}" style="background:${GROUND};">
  <tr><td align="center" style="padding:44px 16px 36px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;">

      <tr><td align="center" bgcolor="${GROUND}" style="background:${GROUND};padding:0 0 88px;">
        <p style="margin:0;font-family:${DISPLAY};font-size:15px;line-height:1.2;font-weight:300;
                  letter-spacing:7px;text-transform:uppercase;color:#EDF2F8;">${esc(name)}</p>
        <div style="padding-top:14px;">${twoLines(acc)}</div>
      </td></tr>

      ${said ? `<tr><td align="center" style="padding:0 0 20px;">
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>
          ${line(28)}
          <td style="padding:0 14px;font-family:${DISPLAY};font-size:10px;line-height:1.4;font-weight:600;
                     letter-spacing:3px;text-transform:uppercase;color:${acc};white-space:nowrap;">${esc(said)}</td>
          ${line(28)}
        </tr></table>
      </td></tr>` : ""}

      <tr><td align="center" bgcolor="${GROUND}"
              style="background:${GROUND};padding:0 36px;text-align:center;font-family:${FACE};color:#C3CDD9;">
        ${(Array.isArray(rows) ? rows.join("") : rows).replace(/\{\{accent\}\}/g, acc)}
      </td></tr>

      <tr><td style="padding:52px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="39%" style="font-size:0;line-height:0;"><div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div></td>
          <td width="22%" bgcolor="${acc}" height="3" style="height:3px;background:${acc};font-size:0;line-height:0;">&nbsp;</td>
          <td width="39%" style="font-size:0;line-height:0;"><div style="height:1px;background:${RULE};font-size:0;line-height:0;">&nbsp;</div></td>
        </tr></table>
      </td></tr>

      ${cols.length ? `<tr><td style="padding:30px 20px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${cols.map((f, i) => `<td align="center" valign="top" width="${Math.floor(100 / cols.length)}%"
              style="padding:0 12px;${i ? `border-left:1px solid ${RULE};` : ""}text-align:center;">
            <p style="margin:0 0 6px;font-family:${DISPLAY};font-size:10px;line-height:1.4;font-weight:600;
                      letter-spacing:2px;text-transform:uppercase;color:${acc};">${esc(f.label)}</p>
            <p style="margin:0;font-family:${FACE};font-size:14px;line-height:1.5;color:#EDF2F8;word-break:break-word;">${esc(f.value)}</p>
          </td>`).join("")}
        </tr></table>
      </td></tr>` : ""}

      <tr><td align="center" style="padding:48px 20px 0;">
        <div style="border-top:1px solid ${RULE};padding-top:20px;font-family:${FACE};font-size:12px;
                    line-height:1.7;color:#7C8898;text-align:center;">
          ${footer ? `${footer}<br>` : ""}<a href="${esc(String(origin || "https://thauma.one").replace(/\/+$/, ""))}" style="color:#7C8898;text-decoration:none;">${esc(site)}</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * A primary action, OUTLINED: the accent is the text and the border, the
 * fill is the page (round 4). A table cell, not a padded link, because
 * Outlook ignores padding on <a>; bgcolor set on the cell all the same, so a
 * client that paints buttons gets the ground and not white. The two lines
 * follow the words, as on the site.
 */
export function button(href, label, color = "{{accent}}") {
  const c = color === "{{accent}}" ? color : readable(color, GROUND, 4.5);
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"
                 style="margin:30px auto 28px;"><tr>
    <td align="center" bgcolor="${GROUND}" style="background:${GROUND};border:1px solid ${c};">
      <a href="${esc(href)}" style="display:inline-block;padding:15px 24px;font-family:${DISPLAY};
         font-size:12px;line-height:1;font-weight:600;letter-spacing:2px;text-transform:uppercase;
         color:${c};text-decoration:none;">${esc(label)}&nbsp;&nbsp;&nbsp;<span style="display:inline-block;width:26px;vertical-align:middle;line-height:0;font-size:0;"><span style="display:block;height:2px;background:${c};"></span><span style="display:block;height:3px;"></span><span style="display:block;width:13px;height:1px;background:${c};"></span></span></a>
    </td></tr></table>`;
}

export const p = (text) =>
  `<p style="margin:0 0 16px 0;font-family:${FACE};font-size:16px;line-height:1.65;color:#C3CDD9;text-align:center;">${text}</p>`;

/** The heading: thin, its last word bold — the site's own pattern. */
export const h1 = (text) => {
  const words = String(text == null ? "" : text).trim().split(/\s+/);
  const last = words.length > 1 ? words.pop() : null;
  return `<h1 style="margin:0 0 22px 0;font-family:${DISPLAY};font-size:34px;line-height:1.15;font-weight:300;
              color:#FFFFFF;text-align:center;">${esc(words.join(" "))}${last ? ` <b style="font-weight:600;">${esc(last)}</b>` : ""}</h1>`;
};

/**
 * Send one message. Returns { ok } or { ok:false, error } — never throws.
 *
 * A failed invite must not fail the account creation that triggered it: the
 * account is the real thing, the email is a convenience, and an administrator
 * who sees "created, but the invite could not be sent" can resend it. Rolling
 * the account back because an API was briefly unhappy would be worse.
 */
export async function sendMail(env, { to, subject, html, text, replyTo, from: fromOverride, headers, attachments }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not set on this deploy." };
  /* `from` MAY BE OVERRIDDEN, and there is exactly one caller that should:
     a mailing list's confirmation, which has to arrive from the address the
     list itself sends from. A confirmation that comes from somewhere the
     person has never heard of is the one most likely to be ignored, and the
     whole point of it is that they act on it.

     STILL TRANSACTIONAL. This is mail somebody triggered seconds ago and is
     waiting for — see the note at the top of this file. The bulk sender stays
     a different domain, and nothing here may be used to send a newsletter. */
  const from = fromOverride || env.MAIL_FROM || env.CONTACT_FROM;
  if (!from) return { ok: false, error: "No sender configured (MAIL_FROM)." };

  const payload = { from, to: [to], subject, html, text };
  /* ONLY IF IT IS ACTUALLY AN ADDRESS. Resend rejects a malformed reply_to
     with a 422 and sends nothing, so one bad value costs the whole message —
     and the value comes from whoever is signed in, which is not always a
     person. A Cloudflare Access SERVICE TOKEN has no email claim, so
     lib/access.js falls back to its common_name ("<id>.access"), and an
     invitation sent by an automation failed outright with a message about a
     reply-to field nobody had chosen.

     Dropping it is the right failure: a reply-to is a courtesy, and losing it
     is a smaller harm than an invitation that never arrives. */
  if (replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(replyTo))) {
    payload.reply_to = replyTo;
  }
  /* EXTRA HEADERS, for exactly one caller: a newsletter's List-Unsubscribe.
     Gmail and Outlook put a one-click unsubscribe button beside the sender
     when they see it, and a reader who presses that is a reader who did NOT
     press "report spam" — which is the outcome that damages the sending
     domain for everybody else on it. */
  if (headers && Object.keys(headers).length) payload.headers = headers;

  /* ATTACHMENTS ARE NOT PART OF THE HTML, and that is the whole distinction
     from an inline picture. A picture is a URL the reader's mail client
     fetches; an attachment travels inside the message. Resend takes them as a
     separate parameter, base64-encoded, and they never touch the body. */
  if (attachments && attachments.length) payload.attachments = attachments;

  let res;
  try {
    res = await fetchImpl(RESEND, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, error: `Could not reach Resend: ${e.message}` };
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body && body.message ? ` — ${body.message}` : "";
    } catch { /* not JSON */ }
    return { ok: false, error: `Resend returned ${res.status}${detail}` };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   The invite

   WHAT IT HAS TO BE HONEST ABOUT: a row in `users` is not an account. Signing
   in also requires Cloudflare Access to allow the address, which is a separate
   act by a separate person in a separate dashboard. An invite that says "your
   account is ready" and then bounces them at a login page they cannot get past
   generates a support message every single time.

   So it says what to do if that happens, and names who to ask.
   --------------------------------------------------------------------------- */

/**
 * Proving a TEST INBOX (0048): the address a person's "Send me a test" goes to
 * instead of their sign-in address. Sent to that address only; the link is
 * the proof they can read it. English, like the other account emails.
 */
export function testInboxEmail({ name, origin, signInEmail, confirmUrl }) {
  const greeting = name ? `Hi ${esc(name)},` : "Hello,";
  const rows =
    h1("Send your tests here?") +
    p(greeting) +
    p(`The Thauma console signed in as ` +
      `<strong style="color:#FFFFFF;">${esc(signInEmail)}</strong> asked to send ` +
      `its newsletter tests to this inbox.`) +
    button(confirmUrl, "Yes, send tests here") +
    p(`<span style="color:#93a1b2;font-size:14px;">This link is good for ` +
      `seven days. If this was not you, ignore this message and nothing will ` +
      `be sent here.</span>`);
  const footer =
    `You are receiving this because this address was entered as a test inbox ` +
    `in the Thauma console.`;
  const text = [
    "Send your tests here?",
    "",
    name ? `Hi ${name},` : "Hello,",
    "",
    `The Thauma console signed in as ${signInEmail} asked to send its`,
    "newsletter tests to this inbox.",
    "",
    `Yes, send tests here: ${confirmUrl}`,
    "",
    "This link is good for seven days. If this was not you, ignore this",
    "message and nothing will be sent here.",
    "",
    "--",
    footer,
  ].join("\n");
  return {
    subject: "Send your Thauma tests here?",
    html: shell({ heading: "Send your tests here?", rows, footer, origin, cue: "Newsletter tests",
                  facts: [{ label: "Asked by", value: signInEmail }, { label: "Link good for", value: "Seven days" }] }),
    text,
  };
}

/**
 * Confirming a NEW address, sent to the new address and nowhere else.
 *
 * That is the whole design: the only proof that somebody can read an inbox is
 * that they received something in it. Sending this to the old address would
 * confirm nothing about the new one.
 */
export function emailChangeEmail({ name, origin, oldEmail, newEmail, confirmUrl }) {
  const greeting = name ? `Hi ${esc(name)},` : "Hello,";

  const rows =
    h1("Confirm your new address") +
    p(greeting) +
    p(`Somebody asked to change the address on your Thauma account from ` +
      `<strong style="color:#FFFFFF;">${esc(oldEmail)}</strong> to this one. ` +
      `Confirming finishes the change; until then nothing has moved.`) +
    button(confirmUrl, "Confirm this address") +
    p(`<span style="color:#93a1b2;font-size:14px;">This link is good for ` +
      `seven days. After it is confirmed you will sign in with this address ` +
      `instead, and the one-time code comes here.</span>`) +
    p(`<strong style="color:#FFFFFF;">If this was not you</strong>, do nothing ` +
      `— the change does not happen on its own — and tell an administrator, ` +
      `because it means somebody was signed in as you.`);

  const footer =
    `You are receiving this because this address was entered as the new ` +
    `sign-in address for a Thauma account. If that was not you, no action is ` +
    `needed: unconfirmed changes expire.`;

  const text = [
    "Confirm your new address",
    "",
    name ? `Hi ${name},` : "Hello,",
    "",
    `Somebody asked to change the address on your Thauma account from`,
    `${oldEmail} to this one. Confirming finishes the change; until then`,
    "nothing has moved.",
    "",
    `Confirm this address: ${confirmUrl}`,
    "",
    "This link is good for seven days. After it is confirmed you will sign in",
    "with this address instead, and the one-time code comes here.",
    "",
    "If this was not you, do nothing — the change does not happen on its own —",
    "and tell an administrator, because it means somebody was signed in as you.",
    "",
    "--",
    footer,
  ].join("\n");

  return {
    subject: "Confirm your new Thauma address",
    html: shell({ heading: "Confirm your new address", rows, footer, origin, cue: "Your account · New address",
                  facts: [{ label: "From", value: oldEmail }, { label: "To", value: newEmail }, { label: "Link good for", value: "Seven days" }] }),
    text,
  };
}

export function inviteEmail({ name, origin, invitedBy, invitedByEmail, confirmUrl }) {
  /* THE CONFIRMATION LINK IS THE BUTTON when there is one. It used to open the
     console directly, which asked somebody to sign in before anything had
     established that the address reaches them — and left an administrator to
     remember to switch the account on afterwards. Clicking the link does both.
     Falls back to the console if a deploy cannot sign links, because an
     invitation with no way in at all is worse than one that needs a hand. */
  const url = confirmUrl || `${origin}/staff/`;
  const greeting = name ? `Hi ${esc(name)},` : "Hello,";

  const rows =
    h1("Welcome behind the scenes.") +
    p(greeting) +
    p(`${esc(invitedBy)} has set up an account for you. The console is where ` +
      `you manage your supporters, your goals and the milestones that appear ` +
      `on your website.`) +
    button(url, confirmUrl ? "Confirm your account" : "Open the console") +
    p(`<strong style="color:#FFFFFF;">If you are turned away at the sign-in ` +
      `page</strong>, your address has not been added to the sign-in system ` +
      `yet — that is a separate step. Reply to this message and ${esc(invitedBy)} ` +
      `can finish it.`) +
    p(`<span style="color:#93a1b2;font-size:14px;">There is no password to ` +
      `set. Signing in sends a one-time code to this address.` +
      (confirmUrl ? ` This link is good for seven days.` : ``) + `</span>`);

  const footer =
    `You are receiving this because an administrator added ` +
    `you to Thauma's staff console. If that was not expected, reply and tell ` +
    `${esc(invitedBy)} &lt;${esc(invitedByEmail)}&gt;.`;

  const text = [
    "You have been added to the Thauma console",
    "",
    name ? `Hi ${name},` : "Hello,",
    "",
    `${invitedBy} has set up an account for you. The console is where you manage`,
    "your supporters, your goals and the milestones that appear on your website.",
    "",
    confirmUrl ? `Confirm your account: ${url}` : `Open the console: ${url}`,
    "",
    "If you are turned away at the sign-in page, your address has not been added",
    "to the sign-in system yet — that is a separate step. Reply to this message",
    `and ${invitedBy} can finish it.`,
    "",
    "There is no password to set. Signing in sends a one-time code to this address.",
    "",
    "--",
    `You are receiving this because an administrator added you to Thauma's staff`,
    `console. If that was not expected, reply and tell ${invitedBy} <${invitedByEmail}>.`,
  ].join("\n");

  return {
    subject: "You have been added to the Thauma console",
    html: shell({ heading: "You have been added to the Thauma console", rows, footer, origin, cue: "Invitation · The console",
                  facts: [{ label: "Invited by", value: invitedBy }, { label: "Signing in", value: "A one-time code, no password" },
                          ...(confirmUrl ? [{ label: "Link good for", value: "Seven days" }] : [])] }),
    text,
  };
}


/**
 * "Did you mean to sign up?" — the confirmation for a mailing list.
 *
 * SENT EVEN WHEN A STAFF MEMBER ADDS SOMEBODY BY HAND. The first instinct was
 * to skip it, on the grounds that a person who asked in front of you has
 * already consented. Chase's argument is better: the confirmation is also the
 * only proof the address WORKS. Adding somebody straight to `subscribed` means
 * discovering a typo weeks later, when a send bounces and nobody remembers
 * what was typed.
 */
/**
 * "We have it" — to the person who used the contact form.
 *
 * WHY SEND ANYTHING. Without it a message goes into the dark: no record in
 * their sent items, no way to tell a form that silently failed from a ministry
 * that has not replied yet. The commonest outcome of that is sending the same
 * message again, which is worse for both sides.
 *
 * IT QUOTES WHAT THEY WROTE, and that is most of the point — it is the only
 * copy they have, since the form kept none and neither did we.
 *
 * IT IS NOT A REPLY, and says so. It also carries NO Reply-To: pointing one at
 * the ministry's delivery address would publish the address this form exists to
 * keep unpublished, to everybody who writes in — including the ones writing in
 * bad faith. Their own reply discloses it if they choose to send one, which is
 * their decision rather than this receipt's.
 *
 * And it promises nothing about when. A ministry of two people should not have
 * an autoresponder implying a service desk.
 */
/**
 * The message itself, to whoever the ministry has it delivered to.
 *
 * IT WAS A PLAIN-TEXT DUMP — "Name:", "Email:", "Subject:", then the message,
 * aligned with spaces. Everything you need and nothing that reads like a
 * letter somebody sent you. This is the one message a ministry gets from a
 * stranger, and it is worth opening properly.
 *
 * THE MESSAGE IS THE CONTENT, so it is what the eye lands on: the sender's own
 * words in a quote block, big enough to read, with the facts about them as a
 * small table beneath rather than a header block above. The reason comes first
 * because it is how somebody with fifty of these decides what to open.
 *
 * REPLY IS A BUTTON. The reply-to header already points at the sender, but the
 * common act deserves to be one tap on a phone rather than a menu.
 *
 * A TEXT PART TOO, always. Some people read mail in a terminal, and a message
 * from a stranger should not require HTML to be legible.
 */
export function contactNotificationEmail({ name, email, topic, subject, message,
                                           country, lang, origin }) {
  /* the facts about them, as the frame's columns (shell facts) */
  const facts = [{ label: "From", value: email }, { label: "Country", value: country }, { label: "Language", value: lang }];
  const detail = (label, value) => value
    ? `<tr>
         <td style="padding:4px 14px 4px 0;font-family:Helvetica,Arial,sans-serif;
                    font-size:13px;color:#7f8c9b;white-space:nowrap;
                    vertical-align:top;">${esc(label)}</td>
         <td style="padding:4px 0;font-family:Helvetica,Arial,sans-serif;
                    font-size:13px;color:#DCE3EC;">${value}</td>
       </tr>`
    : "";

  const rows =
    h1(topic || "A message from the website") +
    p(`<b style="color:#FFFFFF;">${esc(name)}</b> wrote to you` +
      (subject ? ` about <b style="color:#FFFFFF;">${esc(subject)}</b>` : "") + ".") +

    /* Their words, given the room. Same treatment the receipt uses, so the
       sender and the ministry are looking at the same thing. */
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
            style="margin:18px 0 22px 0;"><tr>
       <td style="border:1px solid #1A222D;border-top:2px solid {{accent}};padding:18px 20px;text-align:left;
                  font-family:Helvetica,Arial,sans-serif;font-size:15.5px;
                  line-height:1.7;color:#DCE3EC;white-space:pre-wrap;">${esc(message)}</td>
     </tr></table>` +

    button(`mailto:${email}` +
           (subject ? `?subject=${encodeURIComponent("Re: " + subject)}` : ""),
           `Reply to ${name}`) +

    "";

  const text = [
    topic ? topic : "A message from the website",
    "",
    `${name} <${email}>`,
    subject ? `Subject: ${subject}` : null,
    country ? `Country: ${country}` : null,
    lang ? `Language: ${lang}` : null,
    "",
    message,
    "",
    "— Reply to this email and it goes straight back to them.",
  ].filter((l) => l !== null).join("\n");

  return {
    subject: [topic || "Contact form", subject || name].filter(Boolean).join(" — "),
    html: shell({
      heading: topic || "A message from the website",
      rows,
      footer: "Sent from the contact form on thauma.one. Replying reaches the sender.",
      origin, cue: "Contact form", facts,
    }),
    text,
  };
}

export function contactReceiptEmail({ name, ministry, topic, subject, message,
                                      origin, lang, brand = null }) {
  const T = (k, v) => t(lang, k, v);
  const hello = name ? T("confirm.hello", { name: esc(name) }) : T("confirm.helloAnon");

  const rows =
    h1(T("receipt.heading")) +
    p(hello) +
    p(T("receipt.body", { ministry: esc(ministry) })) +
    /* Their own words back. A blockquote rather than a paragraph so it reads
       as a copy of something rather than as more of our text. */
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
            style="margin:6px 0 20px 0;"><tr>
       <td style="border:1px solid #1A222D;border-top:2px solid {{accent}};padding:16px 20px;text-align:left;
                  font-family:Helvetica,Arial,sans-serif;font-size:14.5px;
                  line-height:1.6;color:#93a1b2;">` +
      (topic ? `<div style="color:#DCE3EC;"><b>${esc(topic)}</b></div>` : "") +
      (subject ? `<div style="color:#DCE3EC;">${esc(subject)}</div>` : "") +
      `<div style="margin-top:${topic || subject ? "8px" : "0"};white-space:pre-wrap;">` +
        `${esc(message)}</div>` +
    `</td></tr></table>` +
    p(`<span style="color:#93a1b2;font-size:14px;">${T("receipt.noReply")}</span>`);

  const footer = T("receipt.footer", { ministry: esc(ministry) });

  const text = [
    T("receipt.heading"), "",
    name ? T("confirm.hello", { name }) : T("confirm.helloAnon"), "",
    T("receipt.body", { ministry }), "",
    "-------------------------",
    topic ? topic : null,
    subject ? subject : null,
    "", message, "",
    "-------------------------", "",
    T("receipt.noReply"), "",
    "--",
    T("receipt.footer", { ministry }),
  ].filter((l) => l !== null).join("\n");

  return {
    subject: T("receipt.subject") + (subject ? ` — ${subject}` : ""),
    /* A partner's receipt wears their band, as their sign-up confirmation
       does; Thauma's own keeps the wordmark. */
    html: shell({ heading: T("receipt.heading"), rows, origin, brand, kind: T("brand.contact"),
                  facts: [{ label: T("receipt.factTo"), value: ministry }, ...(topic ? [{ label: T("receipt.factAbout"), value: topic }] : [])],
                  footer: brand ? `${footer}<br>${esc(T("brand.note"))}` : footer }),
    text,
  };
}

export function listConfirmEmail({ name, listName, confirmUrl, fromName, origin, lang, brand = null }) {
  /* THE SUBSCRIBER'S OWN LANGUAGE, from the page they signed up on. Null when
     nothing said — t() falls back to English one key at a time, so a
     half-finished translation degrades to a mixed message rather than a
     blank. */
  const T = (k, v) => t(lang, k, v);
  const hello = name ? T("confirm.hello", { name }) : T("confirm.helloAnon");
  /* A PARTNER'S LIST: Thauma's confirmation, rebranded (lib/mail-brand.js) —
     their name in the band, their color on the button, and a line at the
     foot crediting Thauma. BACKLOG §1: it came "branded THAUMA for Chase
     Roush's list". */
  return {
    subject: T("confirm.subject", { list: listName }),
    text: [
      hello, "",
      T("confirm.body", { list: listName, from: fromName }).replace(/<\/?b>/g, ""),
      "", confirmUrl, "",
      T("confirm.ignore"),
    ].join("\n"),
    html: shell({
      heading: T("confirm.heading"),
      origin,
      brand,
      kind: T("brand.confirm"),
      facts: [{ label: T("confirm.factList"), value: listName }, { label: T("confirm.factFrom"), value: fromName }],
      footer: brand ? esc(T("brand.note")) : "",
      /* p() rather than a bare <p>, so the color is stated. On a dark ground
         an inherited color is one client's reset away from black on black,
         and #666 — which the refusal line used to set — is unreadable on it. */
      rows: [
        /* The heading in the body, under the band, as every email now has
           it: band says who and what, heading says this one's point. */
        h1(T("confirm.heading")),
        p(esc(hello)),
        /* The string carries <b> deliberately; the VALUES going into it are
           escaped first, which is the only part a person supplied. */
        p(T("confirm.body", { list: esc(listName), from: esc(fromName) })
            .replace("<b>", '<b style="color:#FFFFFF;">')),
        button(confirmUrl, T("confirm.button"), brand ? brand.accent : undefined),
        /* The refusal path stated plainly. Somebody who did not ask for this
           should not have to do anything, and should be told so — an email
           that only offers a "yes" reads as a trick. */
        `<p style="margin:0;font-size:14px;line-height:1.6;color:#93a1b2;text-align:center;">` +
        `${T("confirm.ignore")}</p>`,
      ],
    }),
  };
}
