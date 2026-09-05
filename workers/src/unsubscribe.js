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
 * POST is honoured too, because List-Unsubscribe-Post sends one.
 *
 * THE ANSWER IS THE SAME WHETHER OR NOT THE ADDRESS WAS ON THE LIST. A
 * different page for "not found" would turn this into a way to ask whether
 * somebody subscribes to a ministry — a question about their religion,
 * answerable by anyone who can guess an id.
 */
import { createDb } from "./lib/db.js";
import { verify } from "./lib/unsub.js";

const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  // Nothing here should ever be indexed or previewed by a crawler.
  "X-Robots-Tag": "noindex, nofollow",
};

/* THE ACCENT WAS #6D4AFF — a purple that belongs to nothing here. It is the
   fallback an EMBED uses when a partner has never chosen a colour (see
   DEFAULT_ACCENT in embed.js), and it arrived here as a default nobody
   revisited. This page is Thauma's own, not a partner's, so it wears Thauma's
   cyan and Thauma's near-black rather than a stranger's placeholder. */
function page(title, body, accent = "#2FD8FF") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  /* The site's own ground, not a generic dark. Light mode stays light — this
     page is often opened from a mail client on a phone in either. */
  :root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#12121a;--dim:#5c5c6b;--line:#e6e6ee}
  @media(prefers-color-scheme:dark){
    :root{--bg:#070A10;--card:#10161F;--ink:#EDF2F8;--dim:#9AA6B6;--line:#1c2531}}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);
    color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,
    Helvetica,Arial,sans-serif;padding:24px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;
    padding:34px 38px;max-width:30rem;text-align:center}
  .bar{height:4px;background:${accent};border-radius:2px;margin:-34px -38px 26px}
  h1{margin:0 0 12px;font:700 23px/1.3 Georgia,Cambria,'Times New Roman',serif}
  p{margin:0 0 10px;color:var(--dim);font-size:15px}
  p:last-child{margin-bottom:0}
  .undo{display:inline-block;margin-top:6px;color:var(--ink);font-size:14px;
    text-decoration:none;border-bottom:1px solid ${accent};padding-bottom:1px}
</style></head>
<body><div class="card"><div class="bar"></div>${body}</div></body></html>`;
}

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
const DONE = (id = "", token = "") => new Response(page("Unsubscribed",
  "<h1>You are unsubscribed</h1>" +
  "<p>You will not receive any more of these.</p>" +
  `<p><a class="undo" href="/unsubscribe?s=${encodeURIComponent(id)}` +
  `&t=${encodeURIComponent(token)}&undo=1">That was a mistake — put me back on</a></p>`),
  { headers: HEADERS });

/* After an undo. It offers the way out again, because somebody who has just
   pressed two buttons in a row may well have meant the first one. */
const BACK = (id = "", token = "") => new Response(page("Subscribed again",
  "<h1>You are back on the list</h1>" +
  "<p>Nothing was lost — you will receive the next one as usual.</p>" +
  `<p><a class="undo" href="/unsubscribe?s=${encodeURIComponent(id)}` +
  `&t=${encodeURIComponent(token)}">Actually, unsubscribe me</a></p>`),
  { headers: HEADERS });

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

    if (undo) {
      /* The statement itself only matches 'unsubscribed', so an old link
         cannot revive somebody who has since bounced or promote a sign-up
         that was never confirmed. */
      await db.query("subscriber_resubscribe_by_id", { id });
      return BACK(id, token);
    }

    // Already gone is a success. Saying "you were not subscribed" would be
    // both unhelpful and an answer to a question nobody should be able to ask.
    if (sub.status !== "unsubscribed") {
      await db.query("subscriber_unsubscribe_by_id",
        { id, now: new Date().toISOString() });
    }
    return DONE(id, token);
  },
};
