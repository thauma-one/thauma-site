/**
 * confirm-email.js — finishing a change of sign-in address
 *
 *   GET /confirm-email?u=<id>|<new address>&e=<expiry>&t=<signature>
 *
 * PUBLIC, like confirm-account.js and for a sharper reason: the person is
 * being asked to prove they can read the NEW inbox, and they may well open the
 * link on a device that has never signed in. Requiring a session would test
 * the wrong thing.
 *
 * THE ADDRESS IS INSIDE THE SIGNATURE, not merely alongside it. A token that
 * said only "this account may change address" could be reused with a different
 * destination typed into the URL. Both halves are signed together, so a link
 * confirms exactly one address for exactly one account.
 *
 * THE ORDER OF THE THREE WRITES IS THE WHOLE DESIGN
 * ---------------------------------------------------------------------------
 *   1. add the NEW address to Cloudflare Access
 *   2. change it in Thauma
 *   3. remove the OLD address from Access
 *
 * At no point between those steps can somebody sign in and be refused: after
 * (1) both addresses work, after (2) the new one is the account's, and only
 * then is the old one taken away. Done in any other order there is a window
 * where the account exists and nobody can reach it — and the person it happens
 * to is the one who just changed their address and has no way back in.
 *
 * Step 3 failing is untidy, not dangerous: an extra address in Access that
 * Thauma no longer answers to. It is reported rather than retried.
 */
import { createDb } from "./lib/db.js";
import { verify } from "./lib/signed-link.js";
import { addEmail, removeEmail } from "./lib/access-group.js";

const PURPOSE = "email-change";

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
  a.go{display:inline-block;margin-top:8px;padding:11px 20px;border-radius:5px;
       background:#2FD8FF;color:#06110c;font-weight:600;text-decoration:none}
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
    const token = url.searchParams.get("t") || "";
    const expires = url.searchParams.get("e") || "";

    const bad = (why) => page("Link not valid", `<h1>This link did not work</h1><p>${why}</p>`);
    if (!env.DB) return bad("The site is not fully set up yet. Tell an administrator.");

    const check = await verify(env, PURPOSE, subject, { token, expires });
    if (!check.ok) {
      if (check.reason === "expired") {
        return bad("It has expired. Requests are good for seven days — start the " +
                   "change again from your settings.");
      }
      if (check.reason === "unconfigured") {
        return bad("The site cannot check this link at the moment. This is a " +
                   "problem at our end — please tell an administrator.");
      }
      return bad("It may have been copied incompletely. Try opening it straight " +
                 "from the email rather than pasting it.");
    }

    const at = subject.indexOf("|");
    const id = subject.slice(0, at);
    const email = subject.slice(at + 1).toLowerCase();
    if (!id || !email) return bad("It is missing part of its address.");

    const db = createDb(env.DB);
    const me = await db.queryOne("user_for_confirm", { id });
    if (!me) return bad("That account no longer exists.");

    if (String(me.email).toLowerCase() === email) {
      /* Already done — clicking twice, or a mail client prefetching. */
      return page("Already changed", `
        <h1>That is already your address</h1>
        <p>Nothing more to do. You sign in with <code>${safe(email)}</code>.</p>
        <a class="go" href="/staff/">Open the console</a>`, { ok: true });
    }

    /* Somebody else may have taken it in the days since the link was sent. */
    const taken = await db.queryOne("user_email_taken", { email, id });
    if (taken) {
      return bad("Another account has taken that address since this link was sent.");
    }

    const oldEmail = String(me.email);

    /* 1. NEW ADDRESS INTO ACCESS FIRST. If this fails nothing has changed and
          they can try again; if it were done last there would be a moment
          where Thauma answers to an address the front door does not know. */
    const added = await addEmail(env, email).catch((e) => ({ ok: false, reason: e.message }));
    const wired = !(added.reason || "").includes("not wired up");
    if (!added.ok && wired) {
      return bad("Your new address could not be added to the sign-in system, so " +
                 "nothing has been changed — you would have been locked out. " +
                 safe(added.reason));
    }

    // 2. The account itself.
    await db.query("user_set_email", { id, email });

    /* 3. The old address out. Recomputed AFTER the change, so a protected
          account that has just moved is judged on its new address and the old
          one is no longer treated as the one that must stay. */
    let removedNote = "";
    if (wired) {
      const keep = (await db.query("admin_users", {}))
        .filter((u) => u.protected).map((u) => u.email);
      const gone = await removeEmail(env, oldEmail, { keep })
        .catch((e) => ({ ok: false, reason: e.message }));
      if (!gone.ok) {
        removedNote = `<p>Your old address is still listed in the sign-in system. ` +
                      `That is untidy rather than a problem — an administrator can ` +
                      `tidy it up.</p>`;
      }
    }

    await db.query("audit_write", {
      id: crypto.randomUUID(), now: new Date().toISOString(),
      user_id: id, partner_id: null,
      action: "update", entity: "user", entity_id: id,
      detail: JSON.stringify({ field: "email", from: oldEmail, to: email }),
    }).catch(() => {});

    return page("Address changed", `
      <h1>Your address has been changed</h1>
      <p>You now sign in with <code>${safe(email)}</code>. The one-time code
         comes here from now on.</p>
      ${removedNote}
      <a class="go" href="/staff/">Open the console</a>`, { ok: true });
  },
};
