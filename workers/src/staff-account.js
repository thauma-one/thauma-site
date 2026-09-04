/**
 * staff-account.js — a person changing their own sign-in address
 *
 *   POST /api/staff-account  { email: "new@example.org" }
 *
 * WHY THIS EXISTS AT ALL. Email is the identity here: there is no password,
 * and Access sends a one-time code to whatever address it holds. So "change my
 * email" is the only self-service account management that means anything, and
 * without it a typo at setup time needs an administrator and a Cloudflare
 * dashboard to correct.
 *
 * NOTHING CHANGES HERE. This sends a link to the NEW address and returns. The
 * change happens in confirm-email.js when somebody proves they can read that
 * inbox — because the only evidence an address works is that mail arrived in
 * it. Anything else takes somebody's word for where to send their sign-in
 * codes, which is the whole account.
 *
 * IT IGNORES "ACTING AS". Every other staff endpoint resolves the acting
 * identity so an administrator can work inside somebody's console. Not this
 * one: it uses the REAL signed-in caller, so an administrator viewing another
 * person cannot start moving that person's sign-in address around. Changing
 * who you are is not a thing you do on somebody's behalf.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { linkParams } from "./lib/signed-link.js";
import { sendMail, emailChangeEmail } from "./lib/mail.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return json({ error: `${request.method} is not supported here.` }, 405, { Allow: "POST" });
    }
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);

    /* The REAL caller. See the note above about acting-as. */
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;

    const db = createDb(env.DB);
    const me = await db.queryOne("user_by_email", { email: user.email });
    if (!me) return json({ error: "This address is not an active account." }, 403);

    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);

    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return json({ error: "That does not look like an email address." }, 400);
    }
    if (email === String(user.email).toLowerCase()) {
      return json({ error: "That is already your address." }, 400);
    }

    /* users.email is UNIQUE COLLATE NOCASE so the database would refuse this
       anyway — but only at the very end, after a message had been sent to an
       address that can never be adopted. Said here instead. */
    const taken = await db.queryOne("user_email_taken", { email, id: me.user_id });
    if (taken) {
      return json({ error: "Another account already uses that address." }, 409);
    }

    /* THE ADDRESS IS INSIDE THE SIGNATURE. Without it the token would say
       "this person may change their address" and the destination could be
       swapped in the URL afterwards. */
    let url;
    try {
      url = `${new URL(request.url).origin}/confirm-email?` +
            await linkParams(env, "email-change", `${me.user_id}|${email}`);
    } catch (err) {
      return json({
        error: "This site cannot sign confirmation links at the moment, so the " +
               "change cannot be started. Tell an administrator.",
      }, 500);
    }

    const mail = emailChangeEmail({
      name: me.user_name, origin: new URL(request.url).origin,
      oldEmail: user.email, newEmail: email, confirmUrl: url,
    });
    /* TO THE NEW ADDRESS ONLY. Sending to the old one would confirm nothing
       about the new. */
    const sent = await sendMail(env, {
      to: email, subject: mail.subject, html: mail.html, text: mail.text,
    });
    if (!sent.ok) return json({ error: sent.error }, 502);

    /* Deliberately no audit row naming the new address: nothing has changed
       yet, and recording an address somebody merely typed would put an
       unverified one in an append-only log. confirm-email.js writes the audit
       entry when the change actually happens. */
    return json({
      sent: true,
      to: email,
      note: "Check that inbox. Nothing changes until the link in it is opened, " +
            "and it is good for seven days.",
    });
  },
};
