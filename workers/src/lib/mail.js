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
/**
 * The frame every Thauma message shares.
 *
 * DARK, LIKE THE SITE. The earlier version was a white card on grey because
 * that is the safe default — and it looked like every other service. This is
 * the site's own palette: the near-black ground, the two washes, the wordmark
 * in real Sora.
 *
 * THE HEADER IS AN IMAGE, and it has to be. Gmail strips @font-face, so Sora
 * cannot be set as live text in an email by any means. A PNG is the only way
 * the actual wordmark appears — and because images are blocked by default in
 * a good share of inboxes, the cell behind it is the same near-black and the
 * alt text is styled to read as the wordmark when the picture never arrives.
 * Blocked, it degrades to THAUMA in wide letters on the right colour.
 *
 * THE WASHES ARE IN THE IMAGE rather than in CSS. Outlook renders through
 * Word, which ignores gradients entirely, and Gmail strips most of them. Baked
 * into the PNG they either arrive or they do not, and what is behind them is
 * the flat colour they fade into.
 *
 * bgcolor IS AN ATTRIBUTE EVERYWHERE below, not only a style. Word drops
 * background declarations on divs and honours them on table cells; on a dark
 * design that is the difference between white-on-dark and white-on-white.
 *
 * BOTH SCHEMES ARE DECLARED. Saying "light" on a dark email invites clients to
 * invert it; saying "dark light" tells them it is deliberate and to leave it
 * be. Every text colour is set explicitly for the ones that ignore that.
 */
export function shell({ heading, rows, footer, origin }) {
  /* WHERE THE BAND IMAGE IS FETCHED FROM. The sending deployment's own origin,
     so a message from staging shows staging's copy and one from production
     shows production's. Falling back to the live site means an environment
     that has not deployed the asset yet still renders something rather than
     alt text — and /img is a static asset, not behind Access, on all three. */
  const base = String(origin || "https://thauma.one").replace(/\/+$/, "");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#070A10;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(heading)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       bgcolor="#070A10" style="background:#070A10;padding:32px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;">

      <tr><td bgcolor="#070A10" align="left"
              style="background:#070A10;font-size:0;line-height:0;">
        <img src="${base}/img/email-band.png" width="600" alt="THAUMA"
             style="display:block;width:100%;max-width:600px;height:auto;border:0;
                    font-family:Helvetica,Arial,sans-serif;font-size:22px;
                    letter-spacing:10px;color:#EDF2F8;">
      </td></tr>

      <tr><td bgcolor="#10161F"
              style="background:#10161F;padding:30px 32px;
                     font-family:Helvetica,Arial,sans-serif;color:#DCE3EC;
                     border-left:1px solid #1c2531;border-right:1px solid #1c2531;
                     border-bottom:1px solid #1c2531;">
        ${Array.isArray(rows) ? rows.join("") : rows}
      </td></tr>
    </table>

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           style="width:100%;max-width:600px;">
      <tr><td style="padding:20px 32px 18px 32px;font-family:Helvetica,Arial,sans-serif;
                     font-size:12px;line-height:1.6;color:#6f7c8c;">
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
    <td align="center" bgcolor="#2FD8FF" style="background:#2FD8FF;border-radius:6px;">
      <a href="${esc(href)}" style="display:inline-block;padding:14px 28px;
         font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:bold;
         color:#06110c;text-decoration:none;border-radius:6px;">${esc(label)}</a>
    </td></tr></table>`;
}

export const p = (text) =>
  `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#DCE3EC;">${text}</p>`;

export const h1 = (text) =>
  `<h1 style="margin:0 0 18px 0;font-size:22px;line-height:1.3;color:#FFFFFF;
              font-weight:normal;">${esc(text)}</h1>`;

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
  if (replyTo) payload.reply_to = replyTo;
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
    html: shell({ heading: "Confirm your new address", rows, footer, origin }),
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
    h1("You have been added to the Thauma console") +
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
    html: shell({ heading: "You have been added to the Thauma console", rows, footer, origin }),
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
export function listConfirmEmail({ name, listName, confirmUrl, fromName, origin }) {
  const hello = name ? `Hi ${name},` : "Hello,";
  return {
    subject: `Confirm your ${listName} subscription`,
    text: [
      hello, "",
      `Please confirm you would like to receive ${listName} from ${fromName}.`,
      "", confirmUrl, "",
      "If you did not ask for this, ignore this message — nothing will be sent",
      "to you unless you confirm.",
    ].join("\n"),
    html: shell({
      heading: `Confirm your ${listName} subscription`,
      origin,
      /* p() rather than a bare <p>, so the colour is stated. On a dark ground
         an inherited colour is one client's reset away from black on black,
         and #666 — which the refusal line used to set — is unreadable on it. */
      rows: [
        p(esc(hello)),
        p(`Please confirm you would like to receive <b style="color:#FFFFFF;">` +
          `${esc(listName)}</b> from ${esc(fromName)}.`),
        button(confirmUrl, "Yes, subscribe me"),
        /* The refusal path stated plainly. Somebody who did not ask for this
           should not have to do anything, and should be told so — an email
           that only offers a "yes" reads as a trick. */
        `<p style="margin:0;font-size:14px;line-height:1.6;color:#93a1b2;">If you ` +
        `did not ask for this, ignore this message. Nothing will be sent to you ` +
        `unless you confirm.</p>`,
      ],
    }),
  };
}
