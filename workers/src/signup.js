/**
 * signup — the public sign-up form endpoint
 *
 *   GET  /embed/v1/<partner>/<list>/form.js   the widget that draws the form
 *   POST /embed/v1/<partner>/<list>/signup    what it submits to
 *
 * THIS IS THE FIRST PLACE A STRANGER CAN WRITE TO THIS DATABASE. Everything
 * else public is read-only. So the rules are stricter than anywhere else in
 * the system, and each one is here for a stated reason rather than by habit.
 *
 * 1. THE ANSWER IS ALWAYS THE SAME.
 *    Accepted, already subscribed, already pending, or refused as a duplicate —
 *    all return the identical body. Any difference turns this into a way to ask
 *    "is this person on your list", which is a question about somebody else's
 *    religious affiliation and not one this should answer to anyone who can
 *    type an address. The console shows the truth; the internet does not get it.
 *
 * 2. A HONEYPOT, not a CAPTCHA.
 *    A field a person cannot see and a bot fills in anyway. It costs a real
 *    visitor nothing — no puzzle, no third-party script, no tracking — and
 *    stops the automated submissions that make up nearly all of this traffic.
 *
 * 3. PER-IP RATE LIMITING, AND DELIBERATELY NOT PER LIST.
 *    Capping a list per hour would make a genuine surge — a service where the
 *    ministry is spoken about — look exactly like an attack, and turn away the
 *    people it worked on. The abuse worth stopping is one machine submitting
 *    over and over, which is an IP-shaped problem. Counted across all lists, so
 *    rotating between a partner's forms does not reset the allowance.
 *
 * 4. THE IP IS HASHED AND KEPT FOR MINUTES.
 *    It is personal data with no purpose past the rate window. Hashed with a
 *    per-deploy secret so a copy of the database does not become a record of
 *    who visited which page.
 *
 * NOTHING IS EVER SUBSCRIBED FROM HERE. A form can only ever create a `pending`
 * row and send a confirmation. That is what makes it safe to have open: the
 * worst a flood achieves is unconfirmed rows and email nobody asked for going
 * to addresses their owners can ignore.
 */
import { createDb } from "./lib/db.js";
import { json } from "./lib/store.js";
import { sendMail, listConfirmEmail } from "./lib/mail.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/* Generous for a person, restrictive for a script. Somebody correcting a typo
   three times in a minute must not be stopped; a machine posting hundreds is. */
const WINDOW_MINUTES = 10;
const MAX_ATTEMPTS = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The same answer for every outcome. See rule 1. */
const SAME_ANSWER = {
  ok: true,
  message: "Thank you. If that address can receive mail, a confirmation is on its way.",
};

function clean(v, max) {
  if (typeof v !== "string") return null;
  const out = v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
  return out === "" ? null : out;
}

/* Hashed with a deploy secret so the stored value cannot be reversed by
   hashing every address in a range — which is trivial for IPv4 without one. */
async function hashIp(ip, env) {
  const salt = env.SIGNUP_SALT || env.ACCESS_AUD || "thauma";
  const bytes = new TextEncoder().encode(salt + "|" + ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * The form widget. Plain HTML and inline styles injected into the host page —
 * no framework, no stylesheet to load, nothing that can be blocked separately
 * from the script itself.
 */
export function formScript(list, partnerSlug, origin) {
  const heading = list.form_heading || `Subscribe to ${list.name}`;
  const blurb = list.form_blurb || "";
  const button = list.form_button || "Subscribe";
  const action = `${origin}/embed/v1/${partnerSlug}/${list.slug}/signup`;

  return `/* Thauma sign-up form. ${origin} */
(function () {
  var nodes = document.querySelectorAll('[data-thauma-form]');
  if (!nodes.length) return;

  nodes.forEach(function (node) {
    if (node.getAttribute('data-ready')) return;
    node.setAttribute('data-ready', '1');

    var wrap = document.createElement('form');
    wrap.style.cssText = 'max-width:26rem;font:inherit';
    wrap.innerHTML =
      ${JSON.stringify(`<h3 style="margin:0 0 .4rem;font-size:1.15rem">${escapeHtml(heading)}</h3>`)} +
      ${JSON.stringify(blurb ? `<p style="margin:0 0 .8rem;opacity:.8">${escapeHtml(blurb)}</p>` : "")} +
      '<label style="display:block;margin-bottom:.5rem">' +
        '<span style="display:block;font-size:.85rem;margin-bottom:.2rem">Your name</span>' +
        '<input name="name" autocomplete="name" style="width:100%;padding:.5rem;box-sizing:border-box">' +
      '</label>' +
      '<label style="display:block;margin-bottom:.6rem">' +
        '<span style="display:block;font-size:.85rem;margin-bottom:.2rem">Email address</span>' +
        '<input name="email" type="email" required autocomplete="email" style="width:100%;padding:.5rem;box-sizing:border-box">' +
      '</label>' +
      /* THE HONEYPOT. Hidden from people three ways — off-screen, zero opacity
         and aria-hidden — because a bot that reads only one of the three still
         fills it in. tabindex -1 and autocomplete off keep it away from
         keyboard users and password managers, which would otherwise fill it
         and lock a real person out. */
      '<div aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;height:0;overflow:hidden">' +
        '<label>Leave this field empty' +
          '<input name="website" tabindex="-1" autocomplete="off">' +
        '</label>' +
      '</div>' +
      '<button type="submit" style="padding:.55rem 1.1rem;cursor:pointer">' +
        ${JSON.stringify(escapeHtml(button))} + '</button>' +
      '<p data-msg style="margin:.6rem 0 0;font-size:.9rem"></p>';

    node.appendChild(wrap);
    var msg = wrap.querySelector('[data-msg]');
    var btn = wrap.querySelector('button');

    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      msg.textContent = 'Sending…';

      fetch(${JSON.stringify(action)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: wrap.email.value,
          name: wrap.name.value,
          website: wrap.website.value,
          /* How long the form was on screen. A person takes seconds; a script
             posts immediately. Advisory only — a slow bot is not stopped by
             it, and a fast human is not refused. */
          elapsed: Date.now() - started
        })
      }).then(function (r) { return r.json(); }).then(function (b) {
        msg.textContent = b.message || 'Thank you.';
        if (b.ok) wrap.reset();
      }).catch(function () {
        msg.textContent = 'Something went wrong. Please try again.';
      }).then(function () { btn.disabled = false; });
    });

    var started = Date.now();
  });
})();`;
}

export default {
  async fetch(request, env, partnerSlug, listSlug, action) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500, CORS);

    if (!SLUG_RE.test(partnerSlug || "") || !SLUG_RE.test(listSlug || "")) {
      return json({ error: "Not found" }, 404, CORS);
    }

    const db = createDb(env.DB);
    const list = await db.queryOne("public_list_for_signup", {
      slug: listSlug, partner_slug: partnerSlug,
    });
    /* 404 for a list that is closed, archived or absent — all three are "there
       is no form here", and distinguishing them tells a stranger about the
       ministry's internal state. */
    if (!list) return json({ error: "Not found" }, 404, CORS);

    /* ---- the widget ---- */
    if (action === "form.js") {
      const origin = new URL(request.url).origin;
      return new Response(formScript(list, partnerSlug, origin), {
        headers: {
          ...CORS,
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { ...CORS, Allow: "POST, OPTIONS" });
    }

    let body;
    try { body = await request.json(); }
    catch { return json(SAME_ANSWER, 200, CORS); }

    const now = new Date().toISOString();
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const ipHash = await hashIp(ip, env);

    const record = (outcome) => db.query("signup_attempt_record", {
      ip_hash: ipHash, list_id: list.id, at: now, outcome,
    });

    /* ---- the honeypot ---- */
    if (clean(body.website, 200)) {
      await record("honeypot");
      /* The same answer a real signup gets. A bot told it failed will adapt;
         one told it succeeded goes away. */
      return json(SAME_ANSWER, 200, CORS);
    }

    /* ---- rate limit ---- */
    const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
    const recent = await db.queryOne("signup_attempts_recent", { ip_hash: ipHash, since });
    if (recent && recent.n >= MAX_ATTEMPTS) {
      await record("rejected");
      return json(SAME_ANSWER, 200, CORS);
    }

    /* Housekeeping on the way past, rather than a scheduled job that can stop
       running without anybody noticing. */
    await db.query("signup_attempts_prune", {
      before: new Date(Date.now() - 60 * 60_000).toISOString(),
    });

    const email = clean(body.email, 200);
    if (!email || !EMAIL_RE.test(email)) {
      await record("rejected");
      return json(SAME_ANSWER, 200, CORS);
    }
    const name = clean(body.name, 120);

    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const existing = await db.queryOne("subscriber_existing_for_signup", {
      list_id: list.id, email,
    });

    if (existing && existing.status === "subscribed") {
      /* Already on the list. Nothing to do, nothing to send, and the answer is
         identical — otherwise this endpoint reports who is a subscriber. */
      await record("duplicate");
      return json(SAME_ANSWER, 200, CORS);
    }

    if (existing && existing.status === "pending") {
      /* Signed up before and never confirmed. A new token, so the newest email
         is the working one and old links stop. */
      await db.query("subscriber_resend_token", {
        list_id: list.id, email, token, name, now,
      });
    } else if (existing) {
      /* Unsubscribed or bounced, and now asking again. Back to `pending` and
         never straight to `subscribed`: they previously said stop, or the
         address stopped working, and a form post is not enough to overturn
         either — anybody who knows the address could send one. The
         confirmation link is what lets them return, because only they can
         click it. */
      await db.query("subscriber_reopen_pending", {
        list_id: list.id, email, token, name, now,
      });
    } else {
      await db.query("subscriber_add", {
        id: "sub_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
        list_id: list.id, partner_id: list.partner_id,
        email, name, token, source: "sign-up form", now,
      });
    }

    const origin = new URL(request.url).origin;
    const mail = listConfirmEmail({
      name, listName: list.name, fromName: list.from_name,
      confirmUrl: `${origin}/confirm?t=${token}`,
    });
    await sendMail(env, {
      to: email, subject: mail.subject, html: mail.html, text: mail.text,
      from: `${list.from_name} <${list.from_email}>`,
      replyTo: list.reply_to || undefined,
    });

    await record("accepted");
    return json(SAME_ANSWER, 200, CORS);
  },
};
