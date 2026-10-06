/**
 * unsubscribe.js — /unsubscribe?s=<id>&t=<token>
 *
 * The link at the bottom of every newsletter, and the target of Gmail's and
 * Outlook's one-click unsubscribe button.
 *
 * IT MUST BE EASIER THAN REPORTING SPAM. That is the entire design brief. A
 * reader who cannot find the way out presses "report spam" instead, and a spam
 * report damages the sending domain's reputation for everybody else on it —
 * which, given one domain per partner, means everybody that ministry writes
 * to. So: no sign-in, no confirmation step, no "tell us why". One request,
 * done, with a sentence saying what happened.
 *
 * GET UNSUBSCRIBES. That breaks the usual rule about GET not changing
 * anything, and it is the right call here: the alternative is a page with a
 * button, which is one more thing between somebody and the exit. The risk a
 * safe-GET rule protects against — a link prefetched or crawled into
 * performing an action — is real, and the damage is bounded and self-repairing
 * in exactly this one case: the worst outcome is that somebody stops receiving
 * mail they can sign up for again in ten seconds.
 *
 * POST is honored too, because List-Unsubscribe-Post sends one.
 *
 * THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS WAS ON THE LIST. A
 * different page for "not found" would turn this into a way to ask whether
 * somebody subscribes to a ministry — a question about their religion,
 * answerable by anyone who can guess an id.
 */
import { createDb } from "./lib/db.js";
import { verify } from "./lib/unsub.js";
import { t } from "./lib/mail-i18n.js";
import { brandForMail } from "./lib/mail-brand.js";
import { page } from "./lib/public-page.js";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // Nothing here should ever be indexed or previewed by a crawler.
  "X-Robots-Tag": "noindex, nofollow",
};

/* Built per request, never as a module constant. A Response body can be read
   once, so a shared one serves the first visitor and an empty page to everyone
   after — and constructing a Response at module scope stops the Worker
   starting at all, which takes every route down with it. */
/* THE UNDO IS ALWAYS OFFERED, on every version of this page, including the one
   shown for a link that was never valid.

   That is deliberate. This page is identical whatever happened precisely so it
   cannot be used to ask whether an address is on a list — and an undo shown
   only after a real unsubscribe would answer exactly that question. Clicking
   it with a bad token does nothing and returns the same page again.

   One click out, one click back. A person who unsubscribed by accident should
   not have to find the ministry's website and sign up again — which also means
   confirming by email a second time to fix a mis-click. */
/* A partner's list: the same page in its color and name (lib/mail-brand.js),
   only once the link has been verified and the person found — before that,
   every answer is Thauma's plain page, so an invented link learns nothing
   about whose list it names. */
const shown = (title, body, lang, brand) => new Response(page(title, body, undefined, lang, brand), { headers: HEADERS });

const DONE = (id = "", token = "", lang = null, brand = null) => shown(t(lang, "unsub.title"),
  `<h1>${t(lang, "unsub.heading")}</h1>` +
  `<p>${t(lang, "unsub.body")}</p>` +
  `<p><a class="undo" href="/unsubscribe?s=${encodeURIComponent(id)}` +
  `&t=${encodeURIComponent(token)}&undo=1">${t(lang, "unsub.undo")}</a></p>`, lang, brand);

/* After an undo. It offers the way out again, because somebody who has just
   pressed two buttons in a row may well have meant the first one. */
const BACK = (id = "", token = "", lang = null, brand = null) => shown(t(lang, "back.title"),
  `<h1>${t(lang, "back.heading")}</h1>` +
  `<p>${t(lang, "back.body")}</p>` +
  `<p><a class="undo" href="/unsubscribe?s=${encodeURIComponent(id)}` +
  `&t=${encodeURIComponent(token)}">${t(lang, "back.undo")}</a></p>`, lang, brand);

export default {
  async fetch(request, env) {
    if (!["GET", "POST"].includes(request.method)) {
      return new Response(page("Unsubscribe", "<h1>Unsubscribe</h1>"),
        { status: 405, headers: { ...HEADERS, Allow: "GET, POST" } });
    }
    if (!env.DB) {
      return new Response(page("Unsubscribe",
        "<h1>Something went wrong</h1><p>Please reply to the email instead and " +
        "we will take you off by hand.</p>"), { status: 500, headers: HEADERS });
    }

    const url = new URL(request.url);
    const id = String(url.searchParams.get("s") || "").slice(0, 60);
    const token = String(url.searchParams.get("t") || "").slice(0, 64);

    /* Verified BEFORE the database is touched. Without this the endpoint would
       answer differently for a real id than an invented one purely by timing,
       and that difference is the leak the identical page above exists to
       avoid. */
    const undo = url.searchParams.get("undo") === "1";

    if (!id || !token || !(await verify(env, id, token))) {
      return undo ? BACK(id, token) : DONE(id, token);
    }

    const db = createDb(env.DB);
    const sub = await db.queryOne("subscriber_by_id_public", { id });
    if (!sub) return undo ? BACK(id, token) : DONE(id, token);

    /* THE LANGUAGE THEY SIGNED UP IN. Null for anybody who joined before it
       was recorded, and for them t() answers in English — which is what this
       page did for everybody until now. */
    const lang = sub.lang || null;
    const brand = sub.partner_id ? await brandForMail(db, sub.partner_id).catch(() => null) : null;

    if (undo) {
      /* The statement itself only matches 'unsubscribed', so an old link
         cannot revive somebody who has since bounced or promote a sign-up
         that was never confirmed. */
      await db.query("subscriber_resubscribe_by_id", { id });
      return BACK(id, token, lang, brand);
    }

    // Already gone is a success. Saying "you were not subscribed" would be
    // both unhelpful and an answer to a question nobody should be able to ask.
    if (sub.status !== "unsubscribed") {
      await db.query("subscriber_unsubscribe_by_id",
        { id, now: new Date().toISOString() });
    }
    return DONE(id, token, lang, brand);
  },
};
