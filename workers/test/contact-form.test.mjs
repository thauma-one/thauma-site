#!/usr/bin/env node
/**
 * Tests for workers/src/contact-form.js
 *   node workers/test/contact-form.test.mjs
 */
import { handle, validate, buildEmail, langFrom } from "../src/contact-form.js";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ENV = {
  RESEND_API_KEY: "re_test",
  CONTACT_TO: "hello@thauma.one",
  CONTACT_FROM: "Thauma <noreply@thauma.one>",
};

function post(fields, { referer = "https://thauma.one/en/contact/", accept } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const headers = {};
  if (referer) headers.referer = referer;
  /* Opt in to the JSON answer, the way the page does when it submits with
     fetch instead of letting the browser navigate. */
  if (accept) headers.accept = accept;
  return new Request("https://thauma.one/api/contact", {
    method: "POST", body: fd, headers,
  });
}
const GOOD = { name: "Jordan Reyes", email: "jordan@example.com", message: "Hello, I'd like to help." };

// mailer spy
function spy(ok = true) {
  const calls = [];
  const fn = async (payload) => { calls.push(payload); return ok; };
  fn.calls = calls;
  return fn;
}
const loc = (res) => new URL(res.headers.get("location"));

console.log("contact-form — Netlify Forms replacement\n");

await check("a good submission sends and redirects with ?sent=true", async () => {
  const send = spy();
  const res = await handle(post(GOOD), ENV, send);
  eq(res.status, 303, "status");
  eq(loc(res).pathname, "/en/contact/", "path");
  eq(loc(res).searchParams.get("sent"), "true", "sent flag");
  eq(send.calls.length, 1, "mailer not called");
});

await check("303 not 302, so a refresh does not re-post", async () => {
  eq((await handle(post(GOOD), ENV, spy())).status, 303, "status");
});

await check("the visitor's address is reply_to, never from", async () => {
  // Sending AS the visitor fails SPF/DKIM and poisons the domain's reputation.
  const p = buildEmail(GOOD, ENV, {});
  eq(p.from, ENV.CONTACT_FROM, "from");
  eq(p.reply_to, GOOD.email, "reply_to");
  assert(!String(p.from).includes(GOOD.email), "visitor address leaked into From");
});

await check("the message body carries the details", async () => {
  const p = buildEmail(GOOD, ENV, { country: "HR", lang: "hr" });
  for (const bit of [GOOD.name, GOOD.email, GOOD.message, "HR", "hr"]) {
    assert(p.text.includes(bit), `missing ${bit}`);
  }
});

await check("honeypot submissions are discarded but look successful", async () => {
  const send = spy();
  const res = await handle(post({ ...GOOD, "bot-field": "gotcha" }), ENV, send);
  eq(send.calls.length, 0, "a bot submission was emailed");
  // Same page a human sees — never confirm the trap worked.
  eq(loc(res).searchParams.get("sent"), "true", "bot saw a different result");
});

await check("required fields are enforced", async () => {
  eq(validate({ ...GOOD, name: "" }).ok, false, "empty name accepted");
  eq(validate({ ...GOOD, message: "" }).ok, false, "empty message accepted");
  eq(validate({ ...GOOD, email: "nope" }).ok, false, "bad email accepted");
  eq(validate(GOOD).ok, true, "good submission rejected");
});

await check("a two-character message is treated as a bot", async () => {
  eq(validate({ ...GOOD, message: "hi" }).reason, "bot", "not treated as bot");
});

await check("control characters are stripped (header injection)", async () => {
  const r = validate({ ...GOOD, name: "Evil\r\nBcc: victim@example.com" });
  assert(r.ok, "rejected outright");
  assert(!/[\r\n]/.test(r.fields.name), "newlines survived into the name");
});

await check("oversized input is clamped, not rejected", async () => {
  const r = validate({ ...GOOD, message: "x".repeat(99999), name: "y".repeat(999) });
  assert(r.ok, "rejected");
  eq(r.fields.message.length, 5000, "message not clamped");
  eq(r.fields.name.length, 100, "name not clamped");
});

await check("language comes from the field, then the referer, then en", async () => {
  eq(langFrom({ lang: "hr" }, "https://thauma.one/en/contact/"), "hr", "field wins");
  eq(langFrom({}, "https://thauma.one/sr/contact/"), "sr", "referer used");
  eq(langFrom({}, undefined), "en", "default");
  eq(langFrom({ lang: "de" }, "https://thauma.one/hr/contact/"), "hr", "unsupported field ignored");
  eq(langFrom({}, "not a url"), "en", "malformed referer");
});

await check("the redirect returns to the right language", async () => {
  const res = await handle(post(GOOD, { referer: "https://thauma.one/hr/contact/" }), ENV, spy());
  eq(loc(res).pathname, "/hr/contact/", "path");
});

await check("a misconfigured deploy fails LOUDLY, never silently", async () => {
  // Silently binning somebody's message is the worst outcome here.
  const res = await handle(post(GOOD), { CONTACT_TO: "x@y.z" }, spy());
  eq(res.status, 500, "status");
});

await check("a send failure redirects with ?error, not a false success", async () => {
  const res = await handle(post(GOOD), ENV, spy(false));
  eq(loc(res).searchParams.get("error"), "1", "error flag");
  assert(!loc(res).searchParams.get("sent"), "claimed success after a failed send");
});

await check("validation failure redirects with ?error", async () => {
  const res = await handle(post({ ...GOOD, email: "bad" }), ENV, spy());
  eq(loc(res).searchParams.get("error"), "1", "error flag");
});

await check("GET offers the reasons, and never fails the page", async () => {
  /* The site's contact page is static and the reasons live in D1, so the
     dropdown cannot be rendered at build time — CI has no database. It asks
     for them here.

     With no database bound it answers with an empty list rather than an error:
     no dropdown is a far smaller loss than no contact page. */
  const res = await handle(new Request("https://thauma.one/api/contact"), ENV, spy());
  eq(res.status, 200, "status");
  const body = await res.json();
  assert(Array.isArray(body.topics), `expected a topics array, got ${JSON.stringify(body)}`);
});

await check("anything other than GET or POST is 405", async () => {
  const res = await handle(
    new Request("https://thauma.one/api/contact", { method: "DELETE" }), ENV, spy());
  eq(res.status, 405, "status");
  assert(/GET/.test(res.headers.get("Allow") || ""), "Allow should list GET now");
});

await check("a non-form body is a 400, not a crash", async () => {
  const bad = new Request("https://thauma.one/api/contact", {
    method: "POST", body: "%%%", headers: { "Content-Type": "application/json" },
  });
  eq((await handle(bad, ENV, spy())).status, 400, "status");
});

/* ------------------------------------------------- the message, as a letter */

const LETTER = () => buildEmail(
  { name: "Jordan Reyes", email: "jordan@example.org", subject: "Volunteering",
    message: "Hello,\n\nI would love to help." },
  { CONTACT_TO: "admin@thauma.one", CONTACT_FROM: "Thauma <noreply@thauma.one>" },
  { country: "US", lang: "en", topic: { label: "Partnership", deliver_to: null },
    origin: "https://thauma.one" });

await check("the notification is a letter, not a field dump", async () => {
  /* It built "Name:", "Email:", "Subject:" aligned with spaces — every fact
     and nothing that reads like something a person sent you. */
  const m = LETTER();
  assert(m.html, "there is no HTML part at all");
  assert(!/^Name: /m.test(m.html), "the aligned field dump is still in the HTML");
  assert(/border-left:3px solid #2FD8FF/.test(m.html),
    "the message is not set apart — it should read as their words, not ours");
  assert(/email-band\.png/.test(m.html), "not using the branded shell");
});

await check("replying is one tap", async () => {
  const m = LETTER();
  assert(/mailto:jordan@example\.org/.test(m.html),
    "no reply button — the reply-to header exists but the common act should " +
    "not need a menu on a phone");
  assert(m.reply_to === "jordan@example.org", "reply-to no longer reaches the sender");
});

await check("and it still has a plain-text part", async () => {
  /* Some people read mail in a terminal. A message from a stranger should not
     require HTML to be legible. */
  const m = LETTER();
  assert(m.text && m.text.includes("I would love to help."),
    "the text part lost the message");
  assert(m.text.includes("jordan@example.org"), "the text part lost the sender");
});

await check("the subject still leads with the reason", async () => {
  /* How somebody with fifty of these decides what to open. */
  assert(LETTER().subject === "Partnership — Volunteering",
    `subject is "${LETTER().subject}"`);
});

await check("HTML in a message cannot become markup", async () => {
  /* The one thing that must survive prettifying: this text came from a
     stranger on the internet. */
  const m = buildEmail(
    { name: "<script>x</script>", email: "a@b.invalid", subject: "<b>hi</b>",
      message: "<img src=x onerror=alert(1)>" },
    { CONTACT_TO: "t@thauma.one", CONTACT_FROM: "T <n@thauma.one>" }, {});
  assert(!/<script>x<\/script>/.test(m.html), "a script tag survived into the HTML");
  assert(!/<img src=x/.test(m.html), "an img tag survived into the HTML");
  assert(/&lt;img/.test(m.html), "the message was not escaped at all");
});

/* --------------------------------------------- answering without a reload */

await check("it answers with JSON when the page asks for it", async () => {
  const res = await handle(post(GOOD, { accept: "application/json" }), ENV, spy());
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body.ok === true, `expected ok:true, got ${JSON.stringify(body)}`);
});

await check("and still redirects when it does not", async () => {
  /* The form works with no JavaScript at all. That path stays the default; the
     JSON is opt-in, so turning JavaScript off cannot break sending a message. */
  const res = await handle(post(GOOD), ENV, spy());
  assert(res.status === 303, `expected 303, got ${res.status}`);
  assert(/\?sent=true/.test(res.headers.get("location") || ""),
    `redirected to ${res.headers.get("location")}`);
});

await check("a refusal is JSON too, not a redirect the page cannot read", async () => {
  const res = await handle(post({ ...GOOD, message: "" }, { accept: "application/json" }),
                           ENV, spy());
  const body = await res.json();
  assert(body.ok === false, "a refused submission reported success");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
