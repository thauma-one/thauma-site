#!/usr/bin/env node
/**
 * Tests for workers/src/contact-form.js
 *   node workers/test/contact-form.test.mjs
 */
import { handle, validate, buildEmail, langFrom } from "../src/contact-form.js";

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

function post(fields, { referer = "https://thauma.one/en/contact/" } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("https://thauma.one/api/contact", {
    method: "POST", body: fd, headers: referer ? { referer } : {},
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

await check("non-POST is 405", async () => {
  const res = await handle(new Request("https://thauma.one/api/contact"), ENV, spy());
  eq(res.status, 405, "status");
});

await check("a non-form body is a 400, not a crash", async () => {
  const bad = new Request("https://thauma.one/api/contact", {
    method: "POST", body: "%%%", headers: { "Content-Type": "application/json" },
  });
  eq((await handle(bad, ENV, spy())).status, 400, "status");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
