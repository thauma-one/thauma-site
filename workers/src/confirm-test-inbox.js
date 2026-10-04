/**
 * confirm-test-inbox.js — proving the inbox a person's tests go to (0048)
 *
 *   GET /confirm-test-inbox?u=<user id>|<address>&e=<expiry>&t=<signature>
 *
 * PUBLIC, like confirm-email.js and for the same reason: the person is proving
 * they can read THAT inbox, likely on a phone that has never signed in.
 *
 * Why the inbox exists: a test to the sign-in address (chase.roush@thauma.one)
 * is forwarded by Cloudflare Email Routing into Gmail, which put every test in
 * spam on 2026-10-03 while the same mailing, really sent, reached the inbox.
 *
 * The account and the address are signed together (lib/signed-link.js), and
 * the UPDATE names the address too: a link for an address the person has
 * since replaced confirms nothing.
 */
import { createDb } from "./lib/db.js";
import { verify } from "./lib/signed-link.js";

export const PURPOSE = "test-inbox";

function page(title, body, { ok = false } = {}) {
  return new Response(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title} &middot; Thauma</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;
       justify-content:center;background:#0B0F15;color:#EDF2F8;
       font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px}
  .card{max-width:460px;width:100%}
  h1{font-size:22px;font-weight:600;margin:0 0 12px;
     color:${ok ? "#5CF2C4" : "#EDF2F8"}}
  p{margin:0 0 14px;line-height:1.6;color:#9AA6B6;font-size:15px}
  code{color:#EDF2F8;font-size:14px}
</style></head>
<body><div class="card">${body}</div></body></html>`, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const safe = (s) => String(s || "").replace(/[<>&"]/g, "");

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const subject = url.searchParams.get("u") || "";
    const bad = (why) => page("Link not valid", `<h1>This link did not work</h1><p>${why}</p>`);
    if (!env.DB) return bad("The site is not fully set up yet. Tell an administrator.");

    const check = await verify(env, PURPOSE, subject, {
      token: url.searchParams.get("t") || "", expires: url.searchParams.get("e") || "",
    });
    if (!check.ok) {
      if (check.reason === "expired") {
        return bad("It has expired. Ask for a new one from the Mail page.");
      }
      if (check.reason === "unconfigured") {
        return bad("The site cannot check this link at the moment. Tell an administrator.");
      }
      return bad("It may have been copied incompletely. Open it straight from the email.");
    }

    const at = subject.indexOf("|");
    const id = subject.slice(0, at);
    const email = subject.slice(at + 1).toLowerCase();
    if (!id || !email) return bad("It is missing part of its address.");

    const db = createDb(env.DB);
    const row = await db.queryOne("test_inbox_for_user", { user_id: id });
    if (!row || String(row.email).toLowerCase() !== email) {
      return bad("A different test inbox has been chosen since this link was sent.");
    }
    if (!row.confirmed_at) {
      await db.query("test_inbox_confirm", { user_id: id, email, now: new Date().toISOString() });
    }
    return page("Confirmed", `
      <h1>Tests will come here</h1>
      <p>Every "Send me a test" from the Mail page now goes to
         <code>${safe(email)}</code>.</p>`, { ok: true });
  },
};
