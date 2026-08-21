/**
 * signup — one public sign-up form per partner
 *
 *   GET  /embed/v1/<partner>/form.js   the widget that draws the form
 *   POST /embed/v1/<partner>/signup    what it submits to
 *
 * ONE FORM, A CHECKBOX PER LIST. The first version served a form per list,
 * which meant a partner running a newsletter and a prayer list pasted two
 * forms onto one page and a visitor typed their address twice. chaseroush.com
 * already had this right — one form, "I want to receive", a box each — and
 * this now matches it.
 *
 * ONE CONFIRMATION EMAIL COVERS EVERY BOX TICKED. All the rows a submission
 * creates share one token, so somebody who asked for two lists gets one
 * message and confirms both with one click. Two emails for one form is a way
 * to be ignored twice.
 *
 * THIS IS THE ONLY PLACE A STRANGER CAN WRITE TO THIS DATABASE. Everything
 * else public is read-only, so the rules are stricter here than anywhere else
 * and each is stated where it is enforced.
 *
 * 1. THE ANSWER IS ALWAYS THE SAME. Accepted, already subscribed, refused as a
 *    duplicate, rate limited — identical body. Any difference turns this into a
 *    way to ask "is this person on your list", which is a question about
 *    somebody's religious affiliation, answerable by anyone who can type an
 *    address. The console shows the truth; the internet does not get it.
 *
 * 2. A HONEYPOT, NOT A CAPTCHA. A field a person cannot see and a bot fills in
 *    anyway. No puzzle, no third-party script, no tracking.
 *
 * 3. PER-IP RATE LIMITING, AND NOT PER LIST. Capping a list per hour would make
 *    a genuine surge look exactly like an attack and turn away the people it
 *    worked on. The abuse worth stopping is one machine submitting repeatedly.
 *
 * 4. THE IP IS HASHED AND KEPT FOR MINUTES. It is a record of who visited a
 *    page, with no purpose past the rate window.
 *
 * NOTHING IS EVER SUBSCRIBED FROM HERE. A form can only create `pending` rows
 * and send a confirmation. That is what makes it safe to leave open.
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

/* Salted, so the stored value cannot be reversed by hashing every address in a
   range — which is trivial for IPv4 without one. */
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
 * The widget. Plain HTML and inline styles injected into the host page — no
 * framework, no stylesheet to load, nothing that can be blocked separately.
 *
 * The heading and button come from the FIRST list's wording, since one form
 * covers them all; a partner who wants different words sets them on whichever
 * list they think of as the main one.
 */
export function formScript(lists, partnerSlug, origin) {
  const first = lists[0] || {};
  const heading = first.form_heading || "Stay in touch";
  const blurb = first.form_blurb || "";
  const button = first.form_button || "Subscribe";
  const action = `${origin}/embed/v1/${partnerSlug}/signup`;

  /* One checkbox per open list, ticked by default — somebody who opened the
     form generally wants what it offers, and unticking is easier than hunting
     for what to tick. The description, where there is one, says what each is. */
  const boxes = lists.map((l) => (
    '<label style="display:flex;align-items:flex-start;gap:.6rem;margin-bottom:.55rem;cursor:pointer">' +
      `<input type="checkbox" name="list" value="${escapeHtml(l.slug)}" checked style="margin-top:.25rem">` +
      '<span>' +
        `<span style="display:block">${escapeHtml(l.name)}</span>` +
        (l.description
          ? `<span style="display:block;font-size:.85em;opacity:.7">${escapeHtml(l.description)}</span>`
          : "") +
      '</span>' +
    '</label>'
  )).join("");

  return `/* Thauma sign-up form. ${origin} */
(function () {
  var nodes = document.querySelectorAll('[data-thauma-form]');
  if (!nodes.length) return;

  nodes.forEach(function (node) {
    if (node.getAttribute('data-ready')) return;
    node.setAttribute('data-ready', '1');

    var started = Date.now();
    var wrap = document.createElement('form');
    wrap.style.cssText = 'max-width:26rem;font:inherit';
    wrap.innerHTML =
      ${JSON.stringify(`<h3 style="margin:0 0 .4rem;font-size:1.15rem">${escapeHtml(heading)}</h3>`)} +
      ${JSON.stringify(blurb ? `<p style="margin:0 0 .8rem;opacity:.8">${escapeHtml(blurb)}</p>` : "")} +
      '<label style="display:block;margin-bottom:.5rem">' +
        '<span style="display:block;font-size:.85rem;margin-bottom:.2rem">Your name</span>' +
        '<input name="name" autocomplete="name" style="width:100%;padding:.5rem;box-sizing:border-box">' +
      '</label>' +
      '<label style="display:block;margin-bottom:.7rem">' +
        '<span style="display:block;font-size:.85rem;margin-bottom:.2rem">Email address</span>' +
        '<input name="email" type="email" required autocomplete="email" style="width:100%;padding:.5rem;box-sizing:border-box">' +
      '</label>' +
      ${JSON.stringify(
        lists.length > 1
          ? '<fieldset style="border:0;padding:0;margin:0 0 .8rem"><legend style="padding:0;font-size:.85rem;margin-bottom:.35rem">I want to receive</legend>' + boxes + '</fieldset>'
          : boxes.replace('margin-bottom:.55rem', 'margin-bottom:.8rem'))} +
      /* THE HONEYPOT. Hidden from people three ways — off-screen, zero opacity
         and aria-hidden — because a bot reading only one of them still fills it
         in. tabindex -1 and autocomplete off keep it away from keyboard users
         and password managers, which would otherwise fill it and lock a real
         person out. */
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

      var picked = [].slice.call(wrap.querySelectorAll('input[name=list]:checked'))
        .map(function (i) { return i.value; });
      if (!picked.length) {
        msg.textContent = 'Choose at least one thing to receive.';
        return;
      }

      btn.disabled = true;
      msg.textContent = 'Sending…';

      fetch(${JSON.stringify(action)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: wrap.email.value,
          name: wrap.name.value,
          lists: picked,
          website: wrap.website.value,
          elapsed: Date.now() - started
        })
      }).then(function (r) { return r.json(); }).then(function (b) {
        msg.textContent = b.message || 'Thank you.';
        if (b.ok) wrap.reset();
      }).catch(function () {
        msg.textContent = 'Something went wrong. Please try again.';
      }).then(function () { btn.disabled = false; });
    });
  });
})();`;
}

export default {
  async fetch(request, env, partnerSlug, action) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500, CORS);
    if (!SLUG_RE.test(partnerSlug || "")) return json({ error: "Not found" }, 404, CORS);

    const db = createDb(env.DB);
    const lists = await db.query("public_lists_for_signup", { partner_slug: partnerSlug });
    /* No open lists is the same as no such partner: both mean "there is no form
       here", and telling them apart reports the ministry's internal state. */
    if (!lists.length) return json({ error: "Not found" }, 404, CORS);

    if (action === "form.js") {
      const origin = new URL(request.url).origin;
      return new Response(formScript(lists, partnerSlug, origin), {
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
    const record = (outcome, listId) => db.query("signup_attempt_record", {
      ip_hash: ipHash, list_id: listId || lists[0].id, at: now, outcome,
    });

    if (clean(body.website, 200)) {
      await record("honeypot");
      /* The same answer a real signup gets. A bot told it failed adapts; one
         told it succeeded goes away. */
      return json(SAME_ANSWER, 200, CORS);
    }

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

    /* Only lists this partner actually has open. A submission naming something
       else is not an error to report — it is a request that mentions a list
       that does not exist, and the honest response is to ignore that part. */
    const asked = Array.isArray(body.lists) ? body.lists.map(String) : [];
    const chosen = lists.filter((l) => asked.includes(l.slug));
    if (!chosen.length) {
      await record("rejected");
      return json(SAME_ANSWER, 200, CORS);
    }

    /* ONE TOKEN ACROSS EVERY ROW THIS CREATES. Ticking two boxes is one
       decision and deserves one email; the confirm page then subscribes both. */
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    const joined = [];
    for (const list of chosen) {
      const existing = await db.queryOne("subscriber_existing_for_signup", {
        list_id: list.id, email,
      });

      if (existing && existing.status === "subscribed") {
        /* Already on it. Nothing to do and nothing to send — and crucially, no
           different answer, or this endpoint reports who is a subscriber. */
        await record("duplicate", list.id);
        continue;
      }

      if (existing) {
        /* Pending again, or previously unsubscribed or bounced. Back to pending
           with the new token, never straight to subscribed: they said stop, or
           the address failed, and a form post is not enough to overturn either
           since anybody who knows the address could send one. */
        await db.query(
          existing.status === "pending" ? "subscriber_resend_token" : "subscriber_reopen_pending",
          { list_id: list.id, email, token, name, now });
      } else {
        await db.query("subscriber_add", {
          id: "sub_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
          list_id: list.id, partner_id: list.partner_id,
          email, name, token, source: "sign-up form", now,
        });
      }
      joined.push(list);
      await record("accepted", list.id);
    }

    /* Everything they asked for, they already had. No email — there is nothing
       to confirm — and the same answer as always. */
    if (!joined.length) return json(SAME_ANSWER, 200, CORS);

    const origin = new URL(request.url).origin;
    const mail = listConfirmEmail({
      name,
      listName: joined.length === 1
        ? joined[0].name
        /* "the Newsletter and Prayer Partners" reads as one thing being
           confirmed, which is what one click is about to do. */
        : joined.slice(0, -1).map((l) => l.name).join(", ") + " and " + joined[joined.length - 1].name,
      fromName: joined[0].from_name,
      confirmUrl: `${origin}/confirm?t=${token}`,
    });
    await sendMail(env, {
      to: email, subject: mail.subject, html: mail.html, text: mail.text,
      from: `${joined[0].from_name} <${joined[0].from_email}>`,
      replyTo: joined[0].reply_to || undefined,
    });

    return json(SAME_ANSWER, 200, CORS);
  },
};
