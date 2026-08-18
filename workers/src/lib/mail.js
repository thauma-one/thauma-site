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

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/**
 * Wrap body rows in the shell every Thauma email shares.
 *
 * `rows` is already-escaped HTML for the inside of the white card — table rows
 * or block elements, each carrying its own inline styles.
 */
export function shell({ heading, rows, footer }) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f8;">
<!-- Preheader: the grey line clients show beside the subject. Hidden in the
     body, because otherwise the first thing shown is whatever text happens to
     come first, which is usually "View in browser". -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:#f4f6f8;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;
                  border:1px solid #e3e8ee;">
      <tr><td style="padding:28px 32px 8px 32px;
                     font-family:Helvetica,Arial,sans-serif;">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;
                    color:#6b7785;font-weight:bold;">THAUMA</div>
      </td></tr>
      <tr><td style="padding:0 32px 28px 32px;
                     font-family:Helvetica,Arial,sans-serif;color:#1a2028;">
        ${rows}
      </td></tr>
    </table>
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;">
      <tr><td style="padding:18px 32px;font-family:Helvetica,Arial,sans-serif;
                     font-size:12px;line-height:1.6;color:#8a96a6;">
        ${footer}
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/** A primary action. A table, not an <a> with padding — Outlook ignores the padding. */
export function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"
                 style="margin:22px 0;"><tr>
    <td align="center" bgcolor="#0B6E8C" style="border-radius:6px;">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;
         font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;
         color:#ffffff;text-decoration:none;border-radius:6px;">${esc(label)}</a>
    </td></tr></table>`;
}

export const p = (text) =>
  `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#1a2028;">${text}</p>`;

export const h1 = (text) =>
  `<h1 style="margin:0 0 18px 0;font-size:22px;line-height:1.3;color:#0f1720;
              font-weight:normal;">${esc(text)}</h1>`;

/**
 * Send one message. Returns { ok } or { ok:false, error } — never throws.
 *
 * A failed invite must not fail the account creation that triggered it: the
 * account is the real thing, the email is a convenience, and an administrator
 * who sees "created, but the invite could not be sent" can resend it. Rolling
 * the account back because an API was briefly unhappy would be worse.
 */
export async function sendMail(env, { to, subject, html, text, replyTo }, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY is not set on this deploy." };
  const from = env.MAIL_FROM || env.CONTACT_FROM;
  if (!from) return { ok: false, error: "No sender configured (MAIL_FROM)." };

  const payload = { from, to: [to], subject, html, text };
  if (replyTo) payload.reply_to = replyTo;

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

export function inviteEmail({ name, origin, invitedBy, invitedByEmail }) {
  const url = `${origin}/staff/`;
  const greeting = name ? `Hi ${esc(name)},` : "Hello,";

  const rows =
    h1("You have been added to the Thauma console") +
    p(greeting) +
    p(`${esc(invitedBy)} has set up an account for you. The console is where ` +
      `you manage your supporters, your goals and the milestones that appear ` +
      `on your website.`) +
    button(url, "Open the console") +
    p(`<strong style="color:#0f1720;">If you are turned away at the sign-in ` +
      `page</strong>, your address has not been added to the sign-in system ` +
      `yet — that is a separate step. Reply to this message and ${esc(invitedBy)} ` +
      `can finish it.`) +
    p(`<span style="color:#6b7785;font-size:14px;">There is no password to ` +
      `set. Signing in sends a one-time code to this address.</span>`);

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
    `Open the console: ${url}`,
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
    html: shell({ heading: "You have been added to the Thauma console", rows, footer }),
    text,
  };
}
