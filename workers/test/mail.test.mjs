#!/usr/bin/env node
/**
 * Tests for workers/src/lib/mail.js
 *   node workers/test/mail.test.mjs
 *
 * Email is the one thing here that cannot be checked by looking at it in a
 * browser. It renders in a dozen clients, one of which uses Microsoft Word's
 * layout engine, and the failure mode is silent: the send succeeds, the
 * message arrives, and it looks wrong to somebody you will never hear from.
 *
 * So these assert the structural properties that survive that — tables not
 * divs, inline styles, a plain-text part — plus the one behaviour that matters
 * operationally: a failed send must report rather than throw, because the
 * account it belongs to has already been created.
 */
import { shell, button, p, h1, sendMail, inviteEmail } from "../src/lib/mail.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ENV = { RESEND_API_KEY: "re_test", MAIL_FROM: "Thauma <noreply@thauma.one>" };

console.log("mail — transactional email that survives Outlook\n");

/* ---------------------------- the shell -------------------------------- */

await check("layout is tables, not divs", () => {
  // Outlook on Windows renders with Word's engine: no flexbox, no grid. A div
  // layout looks right in the developer's preview pane and wrong for a third
  // of everyone else.
  const html = shell({ heading: "H", rows: p("body"), footer: "f" });
  assert(/<table[^>]+role="presentation"/.test(html), "no presentation table");
  assert(!/<div[^>]*style="[^"]*display:\s*(flex|grid)/.test(html),
         "a flex or grid div appeared — Outlook ignores both");
});

await check("every style is inline — no stylesheet to strip", () => {
  // Gmail removes <style> blocks in <head>. Anything defined there is simply
  // gone, and the message renders unstyled.
  const html = shell({ heading: "H", rows: p("body") + button("https://x", "Go"), footer: "f" });
  assert(!/<style[\s>]/.test(html), "a <style> block would be stripped by Gmail");
  assert(!/class=/.test(html), "a class has nothing to match without a stylesheet");
});

await check("no webfont, no background image", () => {
  const html = shell({ heading: "H", rows: p("b"), footer: "f" });
  assert(!/fonts\.googleapis|@font-face/.test(html), "a webfont silently falls back and shifts the layout");
  assert(!/background-image/.test(html), "Outlook ignores background images entirely");
  assert(/Helvetica,Arial,sans-serif/.test(html), "should name websafe fonts explicitly");
});

await check("the card is capped at 600px", () => {
  const html = shell({ heading: "H", rows: p("b"), footer: "f" });
  assert(/max-width:600px/.test(html), "600 is the width every client agrees on");
});

await check("a preheader is set, so clients do not invent one", () => {
  // Without it the preview line is whatever text comes first, which is rarely
  // the sentence you would choose.
  const html = shell({ heading: "Your invite is here", rows: p("b"), footer: "f" });
  assert(/display:none;max-height:0/.test(html), "no hidden preheader");
});

await check("the button is a table cell, not a padded link", () => {
  // Outlook drops padding on an inline <a>, so a "button" collapses to a bare
  // link. The bgcolor attribute is there for the same reason.
  const b = button("https://thauma.one/staff/", "Open the console");
  assert(/<table/.test(b), "must be a table");
  assert(/bgcolor=/.test(b), "Outlook needs the bgcolor attribute, not only CSS");
});

await check("content is escaped, including in the button", () => {
  const b = button("https://x?a=1&b=2", '"><script>alert(1)</script>');
  assert(!/<script>/.test(b), "unescaped markup reached the output");
  assert(/&amp;/.test(b), "the href was not escaped");
});

/* ---------------------------- the invite ------------------------------- */

await check("the invite links at the ORIGIN it was sent from", () => {
  /* A hard-coded site URL is how a test invite sent from staging tells
     somebody to sign in to the live site. */
  const m = inviteEmail({ name: "Ana", origin: "https://next.thauma.one",
                          invitedBy: "Chase Roush", invitedByEmail: "admin@thauma.one" });
  assert(m.html.includes("https://next.thauma.one/staff/"), "wrong origin in the HTML");
  assert(m.text.includes("https://next.thauma.one/staff/"), "wrong origin in the text part");
  assert(!m.html.includes("https://thauma.one/staff/"), "leaked the production URL");
});

await check("the invite is honest that signing in is a SEPARATE step", () => {
  /* A row in `users` is not an account — Cloudflare Access must also allow the
     address. An invite that says "you're all set" and then bounces somebody at
     a login page produces a support message every single time. */
  const m = inviteEmail({ name: "Ana", origin: "https://thauma.one",
                          invitedBy: "Chase Roush", invitedByEmail: "admin@thauma.one" });
  assert(/turned away/i.test(m.text), "must say what to do if they are refused");
  assert(/separate step/i.test(m.text), "must say it is a separate step");
  assert(/no password/i.test(m.text), "must say there is no password, or they will hunt for one");
});

await check("the invite carries a plain-text part", () => {
  // HTML-only is a real spam signal, and some people read mail as text.
  const m = inviteEmail({ name: "Ana", origin: "https://thauma.one",
                          invitedBy: "Chase", invitedByEmail: "a@b.c" });
  assert(m.text && m.text.length > 200, "no useful text part");
  /* An actual TAG: a name followed by whitespace, a slash or a close bracket.
     `<a@b.c>` is RFC 5322 angle-address notation and belongs in a plain-text
     signature — the first version of this check flagged it as markup. */
  assert(!/<\/?[a-z][a-z0-9]*(\s|\/?>)/i.test(m.text), "the text part contains markup");
});

await check("a missing name does not produce 'Hi undefined'", () => {
  const m = inviteEmail({ name: null, origin: "https://thauma.one",
                          invitedBy: "Chase", invitedByEmail: "a@b.c" });
  assert(!/undefined|null/.test(m.text), "leaked a placeholder into the greeting");
  assert(/Hello,/.test(m.text), "should fall back to a neutral greeting");
});

await check("a name with markup in it cannot inject", () => {
  /* This asserted that NO <img> appeared anywhere, which worked only while the
     template contained none. The branded header is a real image, so that check
     started failing on correct output — a test measuring the wrong thing, not
     a regression.

     What it should ask is narrower and stronger: the name must not become
     markup, and every image in the message must be one we put there. An
     injected <img> now fails on the second clause rather than on a blanket
     ban that the design outgrew. */
  const payload = '<img src=x onerror=alert(1)>';
  const m = inviteEmail({ name: payload, origin: "https://thauma.one",
                          invitedBy: "Chase", invitedByEmail: "a@b.c" });

  assert(!m.html.includes(payload), "the name reached the HTML unescaped");
  assert(/&lt;img/.test(m.html), "the name should appear escaped, as text");

  const srcs = [...m.html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((x) => x[1]);
  assert(srcs.length >= 1, "the branded header image is missing");
  for (const src of srcs) {
    assert(/^https?:\/\/[^/]+\/img\//.test(src),
      `an image points somewhere unexpected: ${src}`);
  }
});

/* ---------------------------- sending ---------------------------------- */

await check("sendMail posts what Resend expects", async () => {
  let seen = null;
  const fake = async (url, init) => {
    seen = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
  };
  const r = await sendMail(ENV, { to: "ana@x.com", subject: "S", html: "<b>h</b>",
                                  text: "h", replyTo: "admin@thauma.one" }, fake);
  eq(r.ok, true, "ok");
  eq(seen.url, "https://api.resend.com/emails", "endpoint");
  eq(seen.body.to, ["ana@x.com"], "to is an array");
  eq(seen.body.from, "Thauma <noreply@thauma.one>", "from");
  eq(seen.body.reply_to, "admin@thauma.one", "reply_to");
  assert(seen.body.text, "must send a text part");
  eq(seen.headers.Authorization, "Bearer re_test", "auth");
});

await check("a failed send REPORTS, it does not throw", async () => {
  /* The account has already been created by the time this runs. Throwing here
     would fail the request that made a real thing, because a convenience
     failed. */
  const fake = async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 });
  const r = await sendMail(ENV, { to: "a@b.c", subject: "S", html: "h", text: "h" }, fake);
  eq(r.ok, false, "ok");
  assert(/Domain not verified/.test(r.error), `lost Resend's reason: ${r.error}`);
});

await check("a network failure reports too", async () => {
  const fake = async () => { throw new Error("connect ECONNREFUSED"); };
  const r = await sendMail(ENV, { to: "a@b.c", subject: "S", html: "h", text: "h" }, fake);
  eq(r.ok, false, "ok");
  assert(/Could not reach Resend/.test(r.error), "should name what it could not reach");
});

await check("no API key is reported, not silently skipped", async () => {
  // A mail system that quietly sends nothing is worse than one that is broken
  // loudly: nobody finds out until somebody asks why they never got an invite.
  const r = await sendMail({}, { to: "a@b.c", subject: "S", html: "h", text: "h" });
  eq(r.ok, false, "ok");
  assert(/RESEND_API_KEY/.test(r.error), "must name the missing variable");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
