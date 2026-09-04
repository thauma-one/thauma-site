/**
 * confirm-account.js — an invited person turning their own account on
 *
 *   GET /confirm-account?u=<user id>&e=<expiry>&t=<signature>
 *
 * WHAT IT REPLACES. Adding somebody created the row as `invited`, and an
 * administrator then had to remember to set it active — a step nobody can see
 * is outstanding, on a screen they have already left. Now the person who owns
 * the address does it by clicking the link, which removes the chore AND proves
 * the address reaches them. Two jobs, one click.
 *
 * PUBLIC, AND IT HAS TO BE. Cloudflare Access guards the console, but this is
 * the page somebody visits BEFORE they can get in — gating it would mean
 * needing an account to confirm your account. The signature is the credential:
 * it names one user id, expires, and cannot be edited without breaking. See
 * lib/signed-link.js.
 *
 * IT ONLY EVER PROMOTES `invited` TO `active`. A suspended account is not
 * reactivated by an old invitation still sitting in an inbox — the
 * administrator who suspended them meant it, and a link does not overrule a
 * person. That guard is in the SQL, not here, so no future caller can miss it.
 *
 * STILL NOT THE FRONT DOOR. Confirming makes Thauma answer them; Cloudflare
 * Access still decides whether they reach the site at all. Adding somebody now
 * puts them in the Access group, so both halves usually happen together — but
 * the page says so rather than promising more than it can.
 */
import { createDb } from "./lib/db.js";
import { verify } from "./lib/signed-link.js";

const PURPOSE = "confirm";

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
  a.go{display:inline-block;margin-top:8px;padding:11px 20px;border-radius:5px;
       background:#2FD8FF;color:#06110c;font-weight:600;text-decoration:none}
</style></head>
<body><div class="card">${body}</div></body></html>`, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get("u") || "";
    const token = url.searchParams.get("t") || "";
    const expires = url.searchParams.get("e") || "";

    const bad = (why) => page("Link not valid", `<h1>This link did not work</h1><p>${why}</p>`);

    if (!env.DB) return bad("The site is not fully set up yet. Tell an administrator.");

    const check = await verify(env, PURPOSE, id, { token, expires });
    if (!check.ok) {
      if (check.reason === "expired") {
        return bad("It has expired. Invitations are good for seven days — ask an " +
                   "administrator to send you another, which takes them a moment.");
      }
      /* "unconfigured" is OUR fault, not theirs, and saying "invalid" would
         send somebody hunting for a problem they do not have. */
      if (check.reason === "unconfigured") {
        return bad("The site cannot check this link at the moment. This is a " +
                   "problem at our end — please tell an administrator.");
      }
      return bad("It may have been copied incompletely. Try opening it straight " +
                 "from the email rather than pasting it.");
    }

    const db = createDb(env.DB);
    const me = await db.queryOne("user_for_confirm", { id });
    if (!me) return bad("That account no longer exists.");

    if (me.status === "suspended") {
      return bad("This account has been turned off. An administrator would need " +
                 "to turn it back on — confirming cannot do that.");
    }

    if (me.status === "active") {
      /* Not an error. Clicking twice, or a mail client prefetching the link,
         should read as "you are done", not as a failure. */
      return page("Already confirmed", `
        <h1>You are already confirmed</h1>
        <p>Nothing more to do — your account is active.</p>
        <a class="go" href="/staff/">Open the console</a>`, { ok: true });
    }

    await db.query("user_confirm", { id });

    return page("Confirmed", `
      <h1>Your account is confirmed</h1>
      <p>Thank you${me.name ? ", " + me.name.replace(/[<>&]/g, "") : ""} — Thauma now
         recognises <strong>${String(me.email).replace(/[<>&]/g, "")}</strong>.</p>
      <p>Signing in sends a one-time code to that address. There is no password
         to set.</p>
      <a class="go" href="/staff/">Open the console</a>
      <p style="margin-top:18px;font-size:13.5px">If the console turns you away,
         your address still needs adding to the sign-in system — reply to the
         invitation and whoever sent it can finish that.</p>`, { ok: true });
  },
};
