/**
 * confirm — the link in a mailing list confirmation email
 *
 *   GET /confirm?t=<token>
 *
 * THIS IS A PUBLIC ENDPOINT WITH NO ACCOUNT BEHIND IT. The person clicking is
 * a member of the public who may never sign in to anything, and the token is
 * the only thing identifying them. So:
 *
 *   · it is 32 random bytes, not a sequence or a hash of the address
 *   · it is single-use — cleared as it is spent, because a live link sitting
 *     in an inbox is a way to re-subscribe somebody who later unsubscribed
 *   · a bad token says the same thing as an expired one. Distinguishing them
 *     would turn this into an oracle for guessing tokens
 *
 * IT ONLY EVER MOVES pending -> subscribed. There is no token that can delete,
 * unsubscribe or edit anybody, so the worst a stolen link can do is confirm a
 * subscription its owner asked for.
 *
 * GET, DESPITE WRITING. Mail clients and scanners follow links, so this will
 * be hit by machines as well as people — but the alternative is a page with a
 * button, and a confirmation nobody completes is worse than one a spam filter
 * completes early. The write is idempotent: the second visit finds no pending
 * row and says the same thing as the first.
 */
import { createDb } from "./lib/db.js";

const page = (title, body, status = 200) =>
  new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex">` +
    `<title>${title}</title><style>` +
    `body{margin:0;min-height:100vh;display:flex;align-items:center;` +
    `justify-content:center;background:#0b1119;color:#e8ecf1;` +
    `font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}` +
    `main{max-width:32rem;text-align:center}` +
    `h1{font-size:1.5rem;margin:0 0 .75rem;font-weight:700}` +
    `p{margin:0 0 .5rem;color:#9aa4b2}` +
    `</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8",
                         "Cache-Control": "no-store" } });

/* One message for every failure. A token that never existed, one already spent
   and one belonging to somebody unsubscribed must be indistinguishable — the
   difference is only useful to somebody guessing.

   A FUNCTION, NOT A CONSTANT, for two reasons and both of them bit:

   1. Workers refuse asynchronous I/O, timers and random values in global
      scope, and constructing a Response there tripped that rule. The whole
      Worker failed to start — every route on dev.thauma.one answered 502, from
      one eagerly-built error page.
   2. A Response body can be read ONCE. Even had it started, the first visitor
      would have consumed it and the second would have received an empty page —
      a bug that only appears with two people, which is the worst kind. */
const notValid = () => page("Link not valid",
  `<h1>That link is not valid</h1>
   <p>It may already have been used, or it may have been mistyped.</p>
   <p>If you are waiting to confirm a subscription, ask whoever added you to
      send it again.</p>`, 404);

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return page("Not allowed", "<h1>Not allowed</h1>", 405);
    }
    if (!env.DB) return page("Unavailable", "<h1>Temporarily unavailable</h1>", 500);

    const token = new URL(request.url).searchParams.get("t") || "";
    /* Shape-checked before it reaches the database. The token this issues is
       64 hex characters and nothing else can be valid, so anything else is
       refused without a query. */
    if (!/^[0-9a-f]{64}$/.test(token)) return notValid();

    const db = createDb(env.DB);
    /* SEVERAL ROWS WHEN SEVERAL BOXES WERE TICKED. One submission shares one
       token across every list chosen, so one click confirms all of them —
       which is what somebody thought they were doing when they ticked two. */
    const subs = await db.query("subscriber_by_token", { token });
    if (!subs.length) return notValid();

    await db.query("subscriber_confirm", { token, now: new Date().toISOString() });

    const esc = (v) => String(v == null ? "" : v)
      .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
                                     '"': "&quot;", "'": "&#39;" }[c]));
    const names = subs.map((s) => esc(s.list_name));
    const listed = names.length === 1
      ? names[0]
      : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];

    return page("Subscribed",
      `<h1>You are subscribed</h1>
       <p>You will now receive <b>${listed}</b>.</p>
       <p>Every message includes a link to stop, and it works without signing
          in to anything.</p>`);
  },
};
