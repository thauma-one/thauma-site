/**
 * contact-form — replacement for Netlify Forms
 *
 * The contact page currently posts to Netlify with `data-netlify="true"` and
 * `netlify-honeypot="bot-field"`. Netlify captures the submission, runs its
 * own spam filtering, and stores it in the dashboard. None of that exists on
 * Workers, so this reimplements the parts that matter: validate, reject bots,
 * email it on, and redirect back with `?sent=true` so the existing success
 * message in contact.njk keeps working unchanged.
 *
 * DELIBERATELY DOES NOT STORE SUBMISSIONS. Netlify kept them in a dashboard;
 * this forwards by email and keeps nothing. A contact form is the easiest way
 * to accumulate personal data nobody remembers holding — under GDPR that is a
 * record you are responsible for. Email it to a human and let the mailbox be
 * the system of record.
 *
 * Bindings/vars expected on `env`:
 *   RESEND_API_KEY   Resend API key
 *   CONTACT_TO       where submissions are delivered
 *   CONTACT_FROM     verified sender, e.g. "Thauma <hello@thauma.one>"
 *
 * Without them the form fails CLOSED with a 500 rather than silently binning
 * the message — a contact form that quietly loses mail is worse than one that
 * is visibly broken.
 */

import { SUPPORTED as SUPPORTED_LANGS } from "./lang-redirect.js";
const MAX = { name: 100, email: 200, message: 5000 };
/* Imported, not repeated. This was a second copy of lang-redirect's list and it
   had drifted: Slovenian was live on the site, absent here, so a visitor on
   /sl/contact/ was redirected back to the English page after sending. */

/** Trim, clamp, and strip control characters (including header-injection newlines). */
function clean(v, max) {
  return typeof v === "string"
    ? v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max)
    : "";
}

function validEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Which language to send the visitor back to. Taken from the form's own
 * hidden field, then the Referer path, then English.
 */
export function langFrom(fields, referer) {
  const f = String(fields.lang || "").toLowerCase();
  if (SUPPORTED_LANGS.includes(f)) return f;
  try {
    const m = /^\/([a-z]{2})\//.exec(new URL(referer).pathname);
    if (m && SUPPORTED_LANGS.includes(m[1])) return m[1];
  } catch { /* no or malformed referer */ }
  return "en";
}

/**
 * Validate a submission. Returns { ok, fields } or { ok:false, reason }.
 * `bot` means "silently accept and discard" — never tell a bot it was caught.
 */
export function validate(raw) {
  // Honeypot: a real browser leaves this hidden field empty.
  if (clean(raw["bot-field"], 200)) return { ok: false, reason: "bot" };

  const fields = {
    name: clean(raw.name, MAX.name),
    email: clean(raw.email, MAX.email),
    message: clean(raw.message, MAX.message),
  };

  if (!fields.name) return { ok: false, reason: "missing name" };
  if (!validEmail(fields.email)) return { ok: false, reason: "invalid email" };
  if (!fields.message) return { ok: false, reason: "missing message" };
  // A "message" of two characters is a bot warming up, not a person.
  if (fields.message.length < 4) return { ok: false, reason: "bot" };

  return { ok: true, fields };
}

/** Build the Resend payload. Kept separate so it can be asserted in tests. */
export function buildEmail(fields, env, meta = {}) {
  const lines = [
    `Name:    ${fields.name}`,
    `Email:   ${fields.email}`,
    meta.country ? `Country: ${meta.country}` : null,
    meta.lang ? `Language: ${meta.lang}` : null,
    "",
    fields.message,
  ].filter((l) => l !== null);

  return {
    from: env.CONTACT_FROM,
    to: [env.CONTACT_TO],
    // reply_to, not from: sending AS the visitor would fail SPF/DKIM and land
    // the whole domain in spam. Hitting reply still reaches them.
    reply_to: fields.email,
    subject: `Contact form — ${fields.name}`,
    text: lines.join("\n"),
  };
}

function seeOther(url) {
  // 303 so the browser re-issues as GET; a 302 after POST can be re-POSTed
  // on refresh.
  return new Response(null, { status: 303, headers: { Location: url } });
}

/** Exported for tests: the handler with its mailer injected. */
export async function handle(request, env, send) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  let raw = {};
  try {
    const form = await request.formData();
    raw = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return new Response(JSON.stringify({ error: "Invalid form data" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const lang = langFrom(raw, request.headers.get("referer"));
  const back = new URL(`/${lang}/contact/`, request.url);

  const result = validate(raw);

  if (!result.ok) {
    // A bot gets the same success page as a human — telling it that the
    // honeypot caught it just teaches it to fill the field next time.
    if (result.reason === "bot") {
      back.searchParams.set("sent", "true");
      return seeOther(back.toString());
    }
    back.searchParams.set("error", "1");
    return seeOther(back.toString());
  }

  /* THE DATABASE FIRST, THE DEPLOY VARIABLES SECOND.
     CONTACT_TO and CONTACT_FROM live in wrangler.toml, which means changing
     where Thauma's own messages go is a deploy — and it means this form and a
     partner's form had two unrelated ways of being configured. The
     organisation now has a row in contact_forms like everybody else, and the
     variables are what answers before anybody has filled that row in.

     Falling back rather than requiring the row matters: this endpoint is
     already live on the public site, and a migration that had not been run
     yet must not start losing mail. */
  let to = env?.CONTACT_TO;
  let from = env?.CONTACT_FROM;
  if (env?.DB) {
    try {
      const { createDb } = await import("./lib/db.js");
      const row = await createDb(env.DB).queryOne("public_contact_form_org", {});
      if (row && row.deliver_to) to = row.deliver_to;
      if (row && row.from_address) from = row.from_address;
    } catch {
      /* A database that is unreachable must not take the contact form with
         it. The variables still work, and a message getting through on the
         old settings beats a 500. */
    }
  }

  if (!env?.RESEND_API_KEY || !to || !from) {
    // Fail loudly. Silently discarding somebody's message is the worst
    // possible outcome for a contact form.
    return new Response(JSON.stringify({ error: "Contact form is not configured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const payload = buildEmail(result.fields, { ...env, CONTACT_TO: to, CONTACT_FROM: from }, {
    country: request.cf?.country,
    lang,
  });

  try {
    const ok = await send(payload, env);
    if (!ok) throw new Error("send failed");
  } catch {
    back.searchParams.set("error", "1");
    return seeOther(back.toString());
  }

  back.searchParams.set("sent", "true");
  return seeOther(back.toString());
}

/** Default mailer: Resend's REST API via plain fetch — no SDK needed. */
async function sendViaResend(payload, env) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

export default {
  async fetch(request, env) {
    return handle(request, env, sendViaResend);
  },
};
