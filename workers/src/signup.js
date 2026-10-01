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
import { detectLang } from "./contact-form.js";
import { COLOUR_JS, rowLook } from "./embed-colour.js";
import { escapeHtml, palette, formStyles, LIGHT, DARK, BEHAVIOUR_JS, WORDS_JS, LOOK_JS } from "./lib/embed-form.js";
import { t, wordsFor } from "./lib/mail-i18n.js";
import { siteOrigin } from "./lib/origin.js";
import { isOrgSlug } from "./lib/org.js";
import { readTexts, textIn } from "./lib/texts.js";

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

/* IMPORTED for use here and RE-EXPORTED for the tests, which is two separate
   things: `export ... from` alone re-exports without creating a local binding,
   so every call inside this file threw "escapeHtml is not defined" — caught
   immediately by the tests, which is the whole reason they assert on the
   emitted markup rather than on the source. */
export { escapeHtml };

/**
 * The widget. Plain HTML and inline styles injected into the host page — no
 * framework, no stylesheet to load, nothing that can be blocked separately.
 *
 * The heading and button come from the FIRST list's wording, since one form
 * covers them all; a partner who wants different words sets them on whichever
 * list they think of as the main one.
 */
/* ---------------------------------------------------------------- THE FORM
 * A CARD, not four naked inputs.
 *
 * The first version emitted bare fields with a little inline styling and
 * inherited whatever the host page did to them. On a dark site the inputs came
 * out dark-on-dark; on a page with no form styling at all it read as a
 * fragment somebody forgot to finish. The other embeds — goals, the roadmap,
 * prayer — have all been a bordered card with the ministry's colors since the
 * beginning, and a sign-up form sitting beside one looked like it belonged to
 * a different website.
 *
 * So it is built the same way they are: a shadow root, `all:initial`, its own
 * light and dark palettes, and the partner's accent. Shadow DOM matters more
 * here than anywhere else — this is a FORM, and a host page's `input {}` rule
 * would otherwise reach in and reshape controls somebody has to type into.
 *
 * The shape is chaseroush.com's, which had it right: uppercase field labels,
 * generous padding, a full-width accent button, "I want to receive" over a
 * checkbox per list, and a confirmation panel that replaces the form rather
 * than appearing under it.
 *
 * A CHECKBOX SHOWS ITS LIST'S NAME AND NOTHING ELSE. It used to carry the
 * list's description underneath, which turned four words of choice into a
 * paragraph of reading at the moment somebody had already decided. The names
 * are the choice.
 */

/**
 * `own` is the form's own words, per language (0039, form_words):
 * { hr: { heading, blurb, button }, ... }. In the visitor's language they
 * replace the defaults; a language with none shows the defaults TRANSLATED —
 * never another language's own words.
 */
export function formScript(lists, partnerSlug, origin, theme, own = {}) {
  const action = `${origin}/embed/v1/${partnerSlug}/signup`;

  const { a: accent, b: accent2 } = palette(
    theme && theme.accent, theme && theme.accent2);
  const mode = ["light", "dark"].includes(String(theme && theme.mode))
    ? theme.mode : "auto";

  /* One checkbox per open list, ticked by default — somebody who opened the
     form generally wants what it offers, and unticking is easier than hunting
     for what to tick. The NAME only: see the note above formStyles. */
  /* The name in the ministry's own language, with its other languages
     (0047) on the span for the visitor's language to pick below. */
  const boxes = lists.map((l) => {
    const names = Object.fromEntries(Object.entries(readTexts(l.texts))
      .filter(([, t]) => t.name).map(([code, t]) => [code, t.name]));
    return '<label class="pick">' +
      `<input type="checkbox" name="list" value="${escapeHtml(l.slug)}" checked>` +
      `<span data-names="${escapeHtml(JSON.stringify(names))}">${escapeHtml(l.name)}</span>` +
    '</label>';
  }).join("");

  /* A legend over ONE box is a question nobody asked — there is nothing to
     choose between, and the box is really "yes, the thing you just read". */
  const picks = lists.length > 1
    ? `<fieldset class="picks"><legend data-w="form.receive">${escapeHtml(t("en", "form.receive"))}</legend>` + boxes + '</fieldset>'
    : '<fieldset class="picks">' + boxes + '</fieldset>';

  const inner =
    '<div class="card">' +
      `<h3 class="ttl" data-w="form.heading">${escapeHtml(t("en", "form.heading"))}</h3>` +
      '<p class="blurb" hidden></p>' +
      '<form class="form">' +
        '<label class="fld"><span data-w="form.name">Your name</span>' +
          '<input name="name" autocomplete="name" data-wp="form.name" placeholder="Your name"></label>' +
        '<label class="fld"><span data-w="form.email">Email address</span>' +
          '<input name="email" type="email" required autocomplete="email" ' +
            'placeholder="you@example.com"></label>' +
        picks +
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
        `<button type="submit" class="go" data-w="form.button">${escapeHtml(t("en", "form.button"))}</button>` +
        '<p class="fine" data-w="form.fine">You can unsubscribe at any time.</p>' +
        '<p class="msg"></p>' +
      '</form>' +
      '<div class="done" hidden>' +
        '<p class="mark">✉</p>' +
        '<p class="big" data-w="form.checkEmail">Check your email</p>' +
        '<p class="sub" data-w="form.linkSent">We sent you a confirmation link. Click it and you are on the list.</p>' +
      '</div>' +
    '</div>';

  return `/* Thauma sign-up form. ${origin} */
(function () {
  var nodes = document.querySelectorAll('[data-thauma-form]');
  if (!nodes.length) return;

${COLOUR_JS}
${BEHAVIOUR_JS}

  var WORDS = ${JSON.stringify(wordsFor("form."))};
${WORDS_JS}
${LOOK_JS}
  /* The ministry's own words, per language. < is escaped: this is text in a
     script served to strangers' pages. */
  var OWN = ${JSON.stringify(own || {}).replace(/</g, "\\u003c")};

  var STYLES = ${JSON.stringify(formStyles())};
  var LIGHT = ${JSON.stringify(LIGHT)};
  var DARK  = ${JSON.stringify(DARK)};

  nodes.forEach(function (node) {
    if (node.getAttribute('data-ready')) return;
    node.setAttribute('data-ready', '1');

    /* The host page may override the ministry's colors, the same way every
       other Thauma widget allows. Given an accent and no second color, the
       second is DERIVED rather than left at the ministry's — a chosen accent
       beside somebody else's companion is the one pairing nobody wants. */
    var accent = node.getAttribute('data-accent') || ${JSON.stringify(accent)};
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = ${JSON.stringify(accent)};
    var second = node.getAttribute('data-accent2') ||
      (node.getAttribute('data-accent') ? companion(accent) : ${JSON.stringify(accent2)});
    if (!/^#[0-9a-fA-F]{6}$/.test(second)) second = companion(accent);

    var mode = node.getAttribute('data-theme') || ${JSON.stringify(mode)};
    /* Text in the colors, nudged just far enough to read on the card in
       each scheme (readable, embed-colour.js); the button's words are white
       or near-black, whichever reads on the color. */
    var tones = function (card) {
      return ':host{--acc-t:' + readable(accent, card) + ';--acc2-t:' + readable(second, card) + '}';
    };
    var light = LIGHT + tones('#f7f8fb'), dark = DARK + tones('#1c1c25');
    var scheme = mode === 'light' ? light
               : mode === 'dark'  ? dark
               : light + '@media(prefers-color-scheme:dark){' + dark + '}';

    /* SHADOW DOM, and here it earns its keep more than on any other widget:
       this is a form, and a host page's own rule for input elements would
       otherwise reach in and reshape controls somebody has to type into. */
    var root = node.attachShadow ? node.attachShadow({ mode: 'open' }) : node;
    var style = document.createElement('style');
    style.textContent = STYLES.replace('SCHEME', scheme) + siteLook(node, accent, second) +
      ':host{--acc:' + accent + ';--acc2:' + second + ';--on-acc:' + onColor(accent) + ';' +
      '--faint:' + alpha(accent, 0.22) + '}';
    root.appendChild(style);

    var host = document.createElement('div');
    host.innerHTML = ${JSON.stringify(inner)};
    root.appendChild(host);

    /* The visitor's language, then every fixed word in it — BEFORE the
       data-heading/-button overrides below, which are the partner's own words
       in the console's preview and must win. */
    var lang = chooseLang(node);
    applyWords(host, lang);
    /* Each list's name in that language, where the ministry wrote one. */
    Array.prototype.forEach.call(host.querySelectorAll('[data-names]'), function (el) {
      try { var n = JSON.parse(el.getAttribute('data-names'))[lang]; if (n) el.textContent = n; }
      catch (e) { /* keep the ministry's own wording */ }
    });
    /* Then the ministry's own words in that language, where it wrote them. */
    var mine = OWN[lang] || {};
    if (mine.heading) host.querySelector('.ttl').textContent = mine.heading;
    if (mine.button) host.querySelector('.go').textContent = mine.button;
    var bl = host.querySelector('.blurb');
    bl.textContent = mine.blurb || '';
    bl.hidden = !mine.blurb;

    /* WATCHES ITS OWN CONTAINER. The width decides whether the card tightens,
       the message box grows with what is typed, and the height is reported to
       a parent frame if there is one — which there only is in the console's
       preview. On a real page this widget is a div in the host's document,
       flowing at whatever width their column gives it and exactly as tall as
       its content, with nothing to scroll. */
    watch(node, host.querySelector('.card'));

    /* THE THREE WORDS, overridable by attribute.
       They exist for the console's preview, which has to show what somebody
       is typing before they save it — the alternative was the preview poking
       at the form's internals, which stopped working the moment the form
       moved into a shadow root, and would have gone on "working" silently
       against a stale copy of the markup.

       Set with textContent, never innerHTML: these come from a host page's
       own attributes, and the one thing a widget must never do is turn a
       host's string into markup. */
    var words = { heading: '.ttl', blurb: '.blurb', button: '.go' };
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

      var picked = [].slice.call(form.querySelectorAll('input[name=list]:checked'))
        .map(function (i) { return i.value; });
      if (!picked.length) {
        msg.className = 'msg bad';
        msg.textContent = word(lang, 'form.chooseOne');
        return;
      }

      btn.disabled = true;
      msg.className = 'msg';
      msg.textContent = word(lang, 'form.sending');

      fetch(${JSON.stringify(action)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.value,
          name: form.name.value,
          lists: picked,
          website: form.website.value,
          elapsed: Date.now() - started,
          /* So the confirmation email arrives in the language the form was
             read in. The Referer only helped on thauma.one's own /hr/ pages;
             on a partner's site it named nothing. */
          lang: lang
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; });
      }).then(function (b) {
        if (b && b.ok) {
          /* REPLACED, not appended. A filled-in form still on screen under a
             success message is an invitation to submit it again. */
          form.hidden = true;
          done.hidden = false;
          return;
        }
        msg.className = 'msg bad';
        msg.textContent = (b && b.error) || word(lang, 'form.failed');
      }).catch(function () {
        msg.className = 'msg bad';
        msg.textContent = word(lang, 'form.failed');
      }).then(function () { btn.disabled = false; });
    });
  });
})();`;
}

/** form_words rows -> { lang: { heading, blurb, button, thanks } }. */
export function byLang(rows) {
  const out = {};
  for (const r of rows || []) {
    out[r.lang] = { heading: r.heading || "", blurb: r.blurb || "", button: r.button || "", thanks: r.thanks || "" };
  }
  return out;
}

export default {
  async fetch(request, env, partnerSlug, action) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500, CORS);
    if (!SLUG_RE.test(partnerSlug || "")) return json({ error: "Not found" }, 404, CORS);

    const db = createDb(env.DB);
    /* THAUMA'S OWN FORM by its own query, never the partner one with a miss
       (see public_lists_for_signup_org). */
    const isOrg = isOrgSlug(partnerSlug);
    const lists = await (isOrg
      ? db.query("public_lists_for_signup_org", {})
      : db.query("public_lists_for_signup", { partner_slug: partnerSlug }));
    /* No open lists is the same as no such partner: both mean "there is no form
       here", and telling them apart reports the ministry's internal state. */
    if (!lists.length) return json({ error: "Not found" }, 404, CORS);

    if (action === "form.js") {
      const origin = siteOrigin(env, request);
      /* The form's own colors if it has them, the ministry's if not — both
         carried on every row by the join (0040). */
      const theme = rowLook(lists[0]);
      const own = byLang(await (isOrg
        ? db.query("public_form_words_org", { form: "signup" })
        : db.query("public_form_words", { partner_slug: partnerSlug, form: "signup" })));
      return new Response(formScript(lists, partnerSlug, origin, theme, own), {
        headers: {
          ...CORS,
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        },
      });
    }

    /* THE LISTS A FORM OFFERS, as data — for a sign-up form built by hand on
       the API rather than pasted from the embed (thauma.one's own Stay
       connected, Chase 2026-09-28: "I like custom coding it"). Only what the
       embed already shows a stranger: each open list's slug, name and
       description. The form's words are the page's own. */
    if (request.method === "GET" && action === "signup") {
      return json({
        /* `texts`: the name and description in the ministry's other
           languages (0047), { lang: { name, description } }; name and
           description are its own language and the fallback. */
        lists: lists.map((l) => ({ slug: l.slug, name: l.name, description: l.description || null,
                                   texts: readTexts(l.texts) })),
      }, 200, { ...CORS, "Cache-Control": "public, max-age=300" });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, { ...CORS, Allow: "GET, POST, OPTIONS" });
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

    /* WHICH LANGUAGE THEY WERE READING. Taken from the form's own hidden field
       first, then the Referer path — the same order contact-form.js uses to
       decide where to send somebody back to, and the same helper, so the two
       cannot drift apart. Never asked for: the page they are on already said
       it, and a picker would be a question with an obvious answer.

       null when it cannot be told, deliberately. Defaulting to English would
       record a guess as a decision. */
    const lang = detectLang(body, request.headers.get("referer"));

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
          email, name, token, source: "sign-up form", lang, now,
        });
      }
      joined.push(list);
      await record("accepted", list.id);
    }

    /* Everything they asked for, they already had. No email — there is nothing
       to confirm — and the same answer as always. */
    if (!joined.length) return json(SAME_ANSWER, 200, CORS);

    const origin = siteOrigin(env, request);
    const mail = listConfirmEmail({
      name,
      listName: joined.length === 1
        ? textIn(joined[0], "name", lang, joined[0].name)
        /* "the Newsletter and Prayer Partners" reads as one thing being
           confirmed, which is what one click is about to do. */
        : joined.slice(0, -1).map((l) => textIn(l, "name", lang, l.name)).join(", ") + " and " +
          textIn(joined[joined.length - 1], "name", lang, joined[joined.length - 1].name),
      fromName: joined[0].from_name, origin, lang,
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
