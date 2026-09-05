/**
 * contact.js — a contact form on somebody else's website
 *
 *   GET  /embed/v1/<partner>/contact.js   the widget that draws the form
 *   POST /embed/v1/<partner>/contact      what it submits to
 *
 * The sibling of signup.js, sharing its card, its palette and its defences.
 * Where they differ is what they are FOR, and that difference decides almost
 * everything below.
 *
 * A SIGN-UP IS A COMMITMENT; A MESSAGE IS A MESSAGE.
 * ---------------------------------------------------------------------------
 * Signing up creates a lasting relationship, so it is deliberately hard to do
 * by accident: nothing is ever subscribed from the form, a confirmation has to
 * be clicked, and the answer is identical whatever happened so nobody can use
 * it to ask who is on a list.
 *
 * Sending a message is none of those things. It creates no record, grants no
 * permission, and asking somebody to confirm an email before their message is
 * read would lose most of them. So this is simpler — and correspondingly it
 * must be careful in a different place: the message is delivered to a human
 * and kept NOWHERE.
 *
 * NOTHING IS STORED. That was the original contact form's decision and it is
 * the right one. A contact form is the easiest way in the world to accumulate
 * personal data nobody remembers holding, and under GDPR that is a record
 * somebody is responsible for — for as long as it sits there. The mailbox is
 * the system of record; this Worker is a courier.
 *
 * THE VISITOR'S ADDRESS GOES IN Reply-To, NEVER IN From. Sending as somebody
 * else fails SPF and DKIM, which lands the message in junk — the one place a
 * contact form must not put mail. The partner's own verified address sends it;
 * pressing reply reaches the person who wrote.
 *
 * SPAM DEFENCES, same as the sign-up form and for the same reasons:
 *   - a honeypot rather than a puzzle. No third-party script, no tracking, and
 *     nothing for a person to fail.
 *   - a per-IP rate limit, because the abuse worth stopping is one machine
 *     submitting repeatedly rather than a busy afternoon.
 *   - the IP is hashed and kept for minutes. It is a record of who visited a
 *     page, with no purpose past the rate window.
 */
import { createDb } from "./lib/db.js";
import { json } from "./lib/store.js";
import { sendMail, contactReceiptEmail } from "./lib/mail.js";
import { detectLang } from "./contact-form.js";
import { COLOUR_JS } from "./embed-colour.js";
import { escapeHtml, palette, formStyles, LIGHT, DARK, BEHAVIOUR_JS } from "./lib/embed-form.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const SLUG_RE = /^[a-z0-9-]{1,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { name: 100, email: 200, subject: 160, message: 5000 };

/* One answer for every outcome that is not a validation error the sender can
   fix. A delivery failure is NOT hidden — see the handler. */
const THANKS = { ok: true };

/**
 * Trim, clamp, and strip EVERY control character — carriage return and line
 * feed included.
 *
 * THE NEWLINES ARE THE WHOLE POINT. The name reaches an email header, in the
 * subject line, and a newline in a header value is how somebody adds a `Bcc:`
 * to a message they do not own. The first version of this function carved out
 * 0x09–0x0d so the MESSAGE could keep its line breaks, and then used the same
 * helper for the name — so "Ann\r\nBcc: someone@else" arrived intact. Caught
 * by the test below it, which is why that test exists.
 */
function clean(v, max) {
  return typeof v === "string"
    ? v.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

/**
 * The message alone keeps its newlines. It is prose and it goes in the BODY,
 * never a header — flattening it would deliver a wall of text, and nothing
 * downstream reads it as a header value.
 */
function cleanMessage(v, max) {
  return typeof v === "string"
    ? v.replace(/\r\n?/g, "\n")
        .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, " ")
        .trim().slice(0, max)
    : "";
}

async function hashIp(ip, env) {
  const salt = env.SIGNUP_SALT || env.ACCESS_AUD || "thauma";
  const bytes = new TextEncoder().encode("contact|" + salt + "|" + ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The widget, as a script the host page loads. */
export function contactScript(form, partnerSlug, origin, theme, topics) {
  /* The row already carries the ministry's colours, so an omitted `theme` reads
     them rather than falling back to the default purple. A second source of the
     same fact is a second thing to forget to pass. */
  theme = theme || {
    accent: form.embed_accent, accent2: form.embed_accent2, mode: form.embed_theme,
  };
  const heading = form.heading || "Get in touch";
  const blurb = form.blurb || "";
  const button = form.button || "Send";
  const thanks = form.thanks || "Thank you — your message is on its way.";
  const action = `${origin}/embed/v1/${partnerSlug}/contact`;

  const { a: accent, b: accent2 } = palette(
    theme && theme.accent, theme && theme.accent2);
  const mode = ["light", "dark"].includes(String(theme && theme.mode))
    ? theme.mode : "auto";

  /* WHAT IS THIS ABOUT. chaseroush.com asks before the message, and it does
     more work than its size suggests: somebody deciding whether to write at
     all is helped by seeing that their kind of message is expected, and the
     person reading knows what they are opening.

     Rendered only when the ministry has defined some. A dropdown with one
     option is a question with no answer to give. */
  const reason = (topics && topics.length)
    ? '<label class="fld"><span>What is this about</span>' +
        '<select name="topic">' +
          '<option value="">Choose one…</option>' +
          topics.map((t) => `<option value="${escapeHtml(t.id)}">` +
                            `${escapeHtml(t.label)}</option>`).join("") +
        '</select></label>'
    : "";

  const inner =
    '<div class="card">' +
      `<h3 class="ttl">${escapeHtml(heading)}</h3>` +
      `<p class="blurb"${blurb ? "" : " hidden"}>${escapeHtml(blurb)}</p>` +
      '<form class="form">' +
        '<label class="fld"><span>Your name</span>' +
          '<input name="name" autocomplete="name" required placeholder="Your name"></label>' +
        '<label class="fld"><span>Email address</span>' +
          '<input name="email" type="email" required autocomplete="email" ' +
            'placeholder="you@example.com"></label>' +
        reason +
        /* A SUBJECT, because CR has one and it earns its place: "Prayer
           Request" tells you the category, "My mother is in hospital" tells
           you whether to open it now. Optional — somebody who has nothing to
           add to the dropdown should not be made to invent something. */
        '<label class="fld"><span>Subject</span>' +
          '<input name="subject" maxlength="160" ' +
            'placeholder="A few words about it"></label>' +
        '<label class="fld"><span>Message</span>' +
          '<textarea name="message" rows="5" required ' +
            'placeholder="What would you like to say?"></textarea></label>' +
        /* THE HONEYPOT. Hidden from people three ways — off-screen, zero
           opacity and aria-hidden — because a bot reading only one of them
           still fills it in. tabindex -1 and autocomplete off keep it away
           from keyboard users and password managers, which would otherwise
           fill it and lock a real person out. */
        '<div aria-hidden="true" style="position:absolute;left:-9999px;opacity:0;' +
          'height:0;overflow:hidden">' +
          '<label>Leave this field empty' +
            '<input name="website" tabindex="-1" autocomplete="off">' +
          '</label>' +
        '</div>' +
        `<button type="submit" class="go">${escapeHtml(button)}</button>` +
        '<p class="msg"></p>' +
      '</form>' +
      '<div class="done" hidden>' +
        '<p class="mark">✉</p>' +
        `<p class="big">${escapeHtml(thanks)}</p>` +
      '</div>' +
    '</div>';

  return `/* Thauma contact form. ${origin} */
(function () {
  var nodes = document.querySelectorAll('[data-thauma-contact]');
  if (!nodes.length) return;

${COLOUR_JS}
${BEHAVIOUR_JS}

  var STYLES = ${JSON.stringify(formStyles())};
  var LIGHT = ${JSON.stringify(LIGHT)};
  var DARK  = ${JSON.stringify(DARK)};

  nodes.forEach(function (node) {
    if (node.getAttribute('data-ready')) return;
    node.setAttribute('data-ready', '1');

    var accent = node.getAttribute('data-accent') || ${JSON.stringify(accent)};
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = ${JSON.stringify(accent)};
    var second = node.getAttribute('data-accent2') ||
      (node.getAttribute('data-accent') ? companion(accent) : ${JSON.stringify(accent2)});
    if (!/^#[0-9a-fA-F]{6}$/.test(second)) second = companion(accent);

    var mode = node.getAttribute('data-theme') || ${JSON.stringify(mode)};
    var scheme = mode === 'light' ? LIGHT
               : mode === 'dark'  ? DARK
               : LIGHT + '@media(prefers-color-scheme:dark){' + DARK + '}';

    var root = node.attachShadow ? node.attachShadow({ mode: 'open' }) : node;
    var style = document.createElement('style');
    style.textContent = STYLES.replace('SCHEME', scheme) +
      ':host{--acc:' + accent + ';--acc2:' + second + ';' +
      '--faint:' + alpha(accent, 0.22) + '}' +
      /* The message box is the one control the sign-up form does not have, so
         its styling lives here rather than in the shared shell. */
      '.fld textarea{width:100%;padding:13px 15px;background:var(--field);' +
        'font:inherit;font-size:15px;color:var(--fg);border:1px solid var(--line);' +
        'border-radius:7px;resize:vertical;min-height:120px;line-height:1.55}' +
      '.fld textarea:focus{outline:0;border-color:var(--acc);' +
        'box-shadow:0 0 0 3px var(--faint)}' +
      '.fld textarea::placeholder{color:var(--dim);opacity:.65}' +
      '.fld select{width:100%;padding:13px 15px;background:var(--field);font:inherit;' +
        'font-size:15px;color:var(--fg);border:1px solid var(--line);border-radius:7px;' +
        'appearance:none;cursor:pointer;' +
        /* The arrow is drawn rather than left to the platform: a native select
           on a dark card renders its own light chrome in several browsers and
           reads as a hole in the design. */
        'background-image:url(%22data:image/svg+xml;charset=utf-8,' +
          '%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%278%27%3E' +
          '%3Cpath d=%27M1 1l5 5 5-5%27 stroke=%27%23888%27 stroke-width=%272%27 fill=%27none%27/%3E%3C/svg%3E%22);' +
        'background-repeat:no-repeat;background-position:right 14px center}' +
      '.fld select:focus{outline:0;border-color:var(--acc);box-shadow:0 0 0 3px var(--faint)}';
    root.appendChild(style);

    var host = document.createElement('div');
    host.innerHTML = ${JSON.stringify(inner)};
    root.appendChild(host);

    /* WATCHES ITS OWN CONTAINER. The width decides whether the card tightens,
       the message box grows with what is typed, and the height is reported to
       a parent frame if there is one — which there only is in the console's
       preview. On a real page this widget is a div in the host's document,
       flowing at whatever width their column gives it and exactly as tall as
       its content, with nothing to scroll. */
    watch(node, host.querySelector('.card'));

    /* THE FOUR WORDS, overridable by attribute. They exist for the console's
       visualiser, which has to show what somebody is typing before they save
       it — and the alternative is a preview that pokes at the form's
       internals, which a shadow root makes impossible and which would go on
       "working" against a stale copy of the markup if it did not.

       Set with textContent, never innerHTML: these come from a host page's
       own attributes, and the one thing a widget must never do is turn a
       host's string into markup. */
    var words = { heading: '.ttl', blurb: '.blurb', button: '.go', thanks: '.done .big' };
    Object.keys(words).forEach(function (k) {
      var v = node.getAttribute('data-' + k);
      if (v === null) return;
      var el = host.querySelector(words[k]);
      if (!el) return;
      el.textContent = v;
      if (k === 'blurb') el.hidden = !v;
    });

    var started = Date.now();
    var form = host.querySelector('form');
    var msg  = host.querySelector('.msg');
    var btn  = host.querySelector('.go');
    var done = host.querySelector('.done');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      msg.className = 'msg';
      msg.textContent = 'Sending\\u2026';

      fetch(${JSON.stringify(action)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.value,
          email: form.email.value,
          topic: form.topic ? form.topic.value : '',
          subject: form.subject.value,
          message: form.message.value,
          website: form.website.value,
          elapsed: Date.now() - started
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; });
      }).then(function (b) {
        if (b && b.ok) {
          /* REPLACED, not appended. A filled-in form still on screen under a
             success message is an invitation to send it twice — and a second
             copy of somebody's message is a second thing for a person to
             read. */
          form.hidden = true;
          done.hidden = false;
          return;
        }
        msg.className = 'msg bad';
        msg.textContent = (b && b.error) ||
          'Your message could not be sent. Please try again.';
      }).catch(function () {
        msg.className = 'msg bad';
        msg.textContent = 'Your message could not be sent. Please try again.';
      }).then(function () { btn.disabled = false; });
    });
  });
})();`;
}

/**
 * The email a partner receives. Exported so a test can assert its shape.
 *
 * THE TOPIC CAN REDIRECT IT. A prayer request going to prayer@ and a
 * partnership enquiry going to whoever handles support is the difference
 * between a form that sorts itself and an inbox somebody sorts by hand every
 * morning. A topic with no address of its own falls back to the form's.
 */
export function messageFor(form, fields, partnerName, topic) {
  const lines = [
    `From:    ${fields.name}`,
    `Email:   ${fields.email}`,
    topic ? `About:   ${topic.label}` : null,
    fields.subject ? `Subject: ${fields.subject}` : null,
    "",
    fields.message,
  ].filter((l) => l !== null);
  const badge = topic
    ? `<span style="display:inline-block;background:#eef0f6;color:#3b4252;` +
      `border-radius:20px;padding:3px 11px;font-size:12.5px;margin-bottom:14px">` +
      `${escapeHtml(topic.label)}</span>`
    : "";

  const html =
    '<div style="font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,' +
      'Helvetica,Arial,sans-serif;color:#1a1a22">' +
    badge +
    `<p style="margin:0 0 4px"><b>${escapeHtml(fields.name)}</b></p>` +
    `<p style="margin:0 0 18px;color:#5c5c6b">${escapeHtml(fields.email)}</p>` +
    (fields.subject
      ? `<p style="margin:0 0 14px;font-size:16px"><b>${escapeHtml(fields.subject)}</b></p>`
      : "") +
    `<div style="white-space:pre-wrap;border-left:3px solid #e6e6ee;padding-left:14px">` +
      escapeHtml(fields.message) + "</div></div>";

  /* The topic's own address wins, then the form's. A topic routed nowhere is
     the normal case, not a mistake. */
  const to = (topic && topic.deliver_to) || form.deliver_to;

  /* THE SUBJECT LINE IS WHAT SOMEBODY SEES IN A LIST OF FIFTY. The reason
     first, because it is how they decide what to open; the sender's name
     second, because it is how they decide whether they know them. */
  const subject = [
    topic ? topic.label : null,
    fields.subject || fields.name,
  ].filter(Boolean).join(" — ");

  return {
    to,
    from: form.from_address,
    /* THE VISITOR'S ADDRESS, NEVER AS THE SENDER. Sending as them fails SPF
       and DKIM and lands the message in junk — the one place a contact form
       must not put mail. Reply reaches them; the envelope stays honest. */
    replyTo: fields.email,
    subject,
    text: lines.join("\n"),
    html,
  };
}

export default {
  async fetch(request, env, partnerSlug, action) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500, CORS);
    if (!SLUG_RE.test(partnerSlug || "")) return json({ error: "Not found" }, 404, CORS);

    const db = createDb(env.DB);

    /* "thauma" IS THE ORGANISATION, and it is a reserved word rather than a
       row. Thauma has no entry in `partners` — it is the thing partners belong
       to — so a slug join can never find it, and without this its own contact
       form would be the one form in the system that could not be embedded
       anywhere.

       Reserved rather than created: a partner row for the organisation would
       show up in every partner list, every scope check and every count, and
       each of those would then need a special case to exclude it. One special
       case here is cheaper than a dozen everywhere else. */
    const isOrg = partnerSlug === "thauma";
    const [form, topics] = await Promise.all([
      isOrg
        ? db.queryOne("public_contact_form_org", {})
        : db.queryOne("public_contact_form", { partner_slug: partnerSlug }),
      isOrg
        ? db.query("public_contact_topics_org", {})
        : db.query("public_contact_topics", { partner_slug: partnerSlug }),
    ]);
    /* A closed form and an unknown partner are the same answer: both mean
       "there is no form here", and telling them apart reports whether a
       ministry exists but has switched theirs off. */
    if (!form) return json({ error: "Not found" }, 404, CORS);

    if (action === "contact.js") {
      const origin = new URL(request.url).origin;
      /* The organisation's row carries no palette — there is no partner to
         read one from — so the widget's own default stands, which is Thauma's
         purple. */
      return new Response(contactScript(form, partnerSlug, origin, {
        accent: form.embed_accent, accent2: form.embed_accent2, mode: form.embed_theme,
      }, topics), {
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
    catch { return json({ error: "Please fill the form in and try again." }, 400, CORS); }

    const now = new Date().toISOString();
    const ipHash = await hashIp(request.headers.get("CF-Connecting-IP") || "0.0.0.0", env);
    /* SHARED WITH THE SIGN-UP FORM'S COUNTER, on purpose. Somebody hammering
       a partner's forms would otherwise get a fresh allowance simply by
       switching between the two. `list_id` is not a foreign key, so a synthetic
       value belongs here — and prefixing it keeps contact attempts legible
       beside real list ids in the same table. */
    const record = (outcome) => db.query("signup_attempt_record", {
      ip_hash: ipHash, list_id: "contact:" + partnerSlug, at: now, outcome,
    }).catch(() => {});

    /* A FILLED HONEYPOT GETS THE THANK-YOU PAGE. A bot told it failed adapts;
       one told it succeeded goes away. Nothing is sent. */
    if (clean(body.website, 200)) {
      await record("honeypot");
      return json(THANKS, 200, CORS);
    }

    const fields = {
      name: clean(body.name, MAX.name),
      email: clean(body.email, MAX.email),
      subject: clean(body.subject, MAX.subject),
      message: cleanMessage(body.message, MAX.message),
    };

    /* THE TOPIC IS LOOKED UP, NEVER TAKEN FROM THE REQUEST. The form posts an
       id; the label and the delivery address come from the database. Trusting
       the submitted label would let anybody put words of their choosing in the
       subject line of an email the ministry receives — and trusting a
       submitted address would turn this form into an open relay. */
    const topic = topics.find((t) => t.id === clean(body.topic, 60)) || null;

    /* THESE ARE TOLD PLAINLY, unlike the sign-up form's single answer. A
       sign-up hides its outcome because the outcome is somebody's private
       business; a mistyped address here is the sender's own problem and they
       can fix it. Silently thanking somebody for a message that went nowhere
       is the worst possible behaviour. */
    if (!fields.name) return json({ error: "Please add your name." }, 400, CORS);
    if (!EMAIL_RE.test(fields.email)) {
      return json({ error: "That does not look like an email address." }, 400, CORS);
    }
    if (fields.message.length < 4) {
      return json({ error: "Please write a message." }, 400, CORS);
    }

    /* Per IP, not per form. Capping a form per hour would make a genuine
       surge — a newsletter going out, a talk being given — look exactly like
       an attack, and turn away the people it worked on. */
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const seen = await db.queryOne("signup_attempts_recent",
      { ip_hash: ipHash, since }).catch(() => null);
    if (seen && seen.n >= 8) {
      /* 'rejected', not a new outcome word: signup_attempts has a CHECK
         constraint listing what an outcome may be, and inventing a fifth would
         make every rate-limited attempt throw instead of being recorded — so
         the log of the abuse would be the first casualty of the abuse. */
      await record("rejected");
      return json(THANKS, 200, CORS);
    }

    if (!form.deliver_to || !form.from_address) {
      /* Fails LOUDLY. A contact form that quietly loses mail is worse than one
         that is visibly broken, because nobody finds out for months. */
      return json({
        error: "This form is not finished being set up, so your message was " +
               "not sent. Please try another way of getting in touch.",
      }, 503, CORS);
    }

    await record("accepted");
    const sent = await sendMail(env,
      messageFor(form, fields, form.display_name, topic));
    if (!sent.ok) {
      return json({
        error: "Your message could not be sent just now. Please try again in " +
               "a few minutes.",
      }, 502, CORS);
    }

    /* A RECEIPT TO THE SENDER, after the ministry's copy has gone and never
       instead of it. Without one a message goes into the dark: no record in
       their sent items, no way to tell a form that silently failed from a
       ministry that has not replied yet — and the usual response to that is
       sending the same message again.

       ITS FAILURE IS NOT THEIR PROBLEM. The message reached the ministry,
       which is what they asked for; answering "your message could not be
       sent" because a courtesy copy bounced would be a lie, and would invite
       them to send it twice. Logged, not surfaced.

       NO Reply-To, DELIBERATELY. The obvious thing is to point it at the
       ministry's delivery address so a reply reaches them — and that would
       publish the address this whole form exists to keep unpublished, to
       everybody who ever writes in, including the ones writing in bad faith.
       The ministry's own reply will disclose it soon enough if they choose to
       send one; that is their decision to make, not this receipt's. So the
       message tells people to use the form again instead. */
    try {
      const receipt = contactReceiptEmail({
        name: fields.name, ministry: form.display_name,
        topic: topic ? topic.label : null, subject: fields.subject,
        message: fields.message, origin: new URL(request.url).origin,
        /* The page they wrote from. The widget posts its own language, and the
           Referer covers the case where it did not. */
        lang: detectLang(fields, request.headers.get("referer")),
      });
      await sendMail(env, {
        to: fields.email, subject: receipt.subject,
        html: receipt.html, text: receipt.text,
      });
    } catch (err) {
      console.error("contact receipt failed:", err && err.message);
    }

    return json(THANKS, 200, CORS);
  },
};
