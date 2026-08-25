#!/usr/bin/env node
/**
 * The contact form — the second place a stranger can write
 *   node workers/test/contact.test.mjs
 *
 * The sign-up form's sibling, and the differences are the point. A sign-up
 * creates a lasting relationship, so it hides every outcome behind one answer
 * and confirms by email before anything is real. A message creates no record
 * and grants no permission — so it may say plainly when an address is
 * mistyped, and it must never pretend to have delivered something it did not.
 *
 * What it shares: a honeypot, a per-IP rate limit, a hashed IP, and the rule
 * that a partner's own words cannot become markup on somebody else's website.
 */
import handler, { contactScript, messageFor } from "../src/contact.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const FORM = {
  deliver_to: "chase@example.org",
  from_address: "contact@chaseroush.thauma.one",
  heading: null, blurb: null, button: null, thanks: null,
  display_name: "Chase Roush",
  embed_accent: "#E4572E", embed_accent2: null, embed_theme: "auto",
};

/** A database that records what was asked of it, and a mailer that records sends. */
const TOPICS = [
  { id: "tp_1", label: "General", deliver_to: null, sort_order: 0 },
  { id: "tp_2", label: "Prayer Request", deliver_to: "prayer@example.org", sort_order: 1 },
];

function envWith({ form = FORM, attempts = 0, sendOk = true, topics = TOPICS } = {}) {
  const calls = [];
  const sent = [];
  const env = {
    calls, sent, RESEND_API_KEY: "re_test", SIGNUP_SALT: "0".repeat(48),
    MAIL_FROM: "Thauma <noreply@thauma.one>",
    DB: {
      prepare(sql) {
        const run = async () => {
          calls.push({ sql, params: env._p });
          if (/FROM contact_forms/i.test(sql)) return { results: form ? [form] : [] };
          if (/FROM contact_topics/i.test(sql)) return { results: topics };
          if (/COUNT\(\*\) AS n FROM signup_attempts/i.test(sql)) return { results: [{ n: attempts }] };
          return { results: [] };
        };
        return { bind(...a) { env._p = a; return { all: run, run }; }, all: run, run };
      },
    },
  };
  /* Resend, stubbed at the fetch boundary so the real sendMail runs — the
     payload it builds is what this is checking. */
  env._fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    return { ok: sendOk, status: sendOk ? 200 : 500,
      json: async () => (sendOk ? { id: "re_1" } : { message: "nope" }),
      text: async () => "nope" };
  };
  return env;
}

const post = (body, env, headers = {}) => {
  globalThis.fetch = env._fetch;
  return handler.fetch(
    new Request("https://thauma.one/embed/v1/chase-roush/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 "CF-Connecting-IP": "203.0.113.7", ...headers },
      body: JSON.stringify(body),
    }), env, "chase-roush", "contact");
};
const ran = (env, needle) => env.calls.some((c) => new RegExp(needle, "i").test(c.sql));
const GOOD = { name: "Ann", email: "ann@example.invalid", message: "Hello there." };

console.log("contact — the second public write endpoint\n");

/* ------------------------------ delivery ------------------------------- */

await check("a real message is delivered, once", async () => {
  const env = envWith();
  const res = await post(GOOD, env);
  eq(res.status, 200, "status");
  eq(env.sent.length, 1, "exactly one email");
  eq(env.sent[0].to, ["chase@example.org"], "to the address the partner set");
});

await check("THE VISITOR'S ADDRESS IS Reply-To, NEVER From", async () => {
  /* Sending as somebody else fails SPF and DKIM, which lands the message in
     junk — the one place a contact form must not put mail. */
  const env = envWith();
  await post(GOOD, env);
  const mail = env.sent[0];
  eq(mail.reply_to, "ann@example.invalid", "reply must reach the sender");
  assert(!String(mail.from).includes("example.invalid"),
    `the visitor's address was used as the sender: ${mail.from}`);
  assert(String(mail.from).includes("contact@chaseroush.thauma.one"),
    `expected the partner's verified address: ${mail.from}`);
});

await check("NOTHING IS STORED", async () => {
  /* The original decision, and the right one: a contact form is the easiest
     way to accumulate personal data nobody remembers holding, and under GDPR
     that is a record somebody is responsible for. */
  const env = envWith();
  await post(GOOD, env);
  assert(!ran(env, "INSERT INTO contact"), "a message was written to the database");
  const stored = env.calls.flatMap((c) => c.params || []).map(String);
  assert(!stored.some((v) => v.includes("Hello there")),
    `the message body reached the database: ${JSON.stringify(stored)}`);
  assert(!stored.some((v) => v.includes("ann@example.invalid")),
    "the sender's address reached the database");
});

await check("a delivery failure is reported, never thanked", async () => {
  // Silently thanking somebody for a message that went nowhere is the worst
  // possible behaviour for a contact form.
  const env = envWith({ sendOk: false });
  const res = await post(GOOD, env);
  eq(res.status, 502, "status");
  const body = await res.json();
  assert(!body.ok, "it must not claim success");
  assert(/again/i.test(body.error), `should say what to do: ${body.error}`);
});

await check("an unfinished form refuses loudly rather than losing mail", async () => {
  const env = envWith({ form: { ...FORM, from_address: null } });
  const res = await post(GOOD, env);
  eq(res.status, 503, "status");
  eq(env.sent.length, 0, "nothing should have been sent");
});

/* ---------------------------- what it refuses --------------------------- */

await check("a mistyped address is said out loud", async () => {
  /* Unlike the sign-up form, which hides every outcome. The difference is
     whose business it is: who is on a list is private, a typo in your own
     address is yours to fix. */
  const env = envWith();
  const res = await post({ ...GOOD, email: "not-an-address" }, env);
  eq(res.status, 400, "status");
  assert(/email/i.test((await res.json()).error), "should name the problem");
  eq(env.sent.length, 0, "nothing sent");
});

await check("an empty name or message is refused", async () => {
  for (const [field, value] of [["name", ""], ["message", "hi"]]) {
    const env = envWith();
    const res = await post({ ...GOOD, [field]: value }, env);
    eq(res.status, 400, `${field} should be refused`);
    eq(env.sent.length, 0, "nothing sent");
  }
});

await check("a filled honeypot is thanked and sends NOTHING", async () => {
  // A bot told it failed adapts; one told it succeeded goes away.
  const env = envWith();
  const res = await post({ ...GOOD, website: "http://spam" }, env);
  eq(res.status, 200, "status");
  eq(await res.json(), { ok: true }, "the ordinary thank-you");
  eq(env.sent.length, 0, "nothing sent");
  assert(ran(env, "signup_attempts"), "the attempt should still be recorded");
});

await check("too many attempts stops sending, without saying so", async () => {
  const env = envWith({ attempts: 20 });
  const res = await post(GOOD, env);
  eq(res.status, 200, "status");
  eq(env.sent.length, 0, "nothing sent");
});

await check("an ordinary number of attempts is not stopped", async () => {
  const env = envWith({ attempts: 2 });
  await post(GOOD, env);
  eq(env.sent.length, 1, "a real person was refused");
});

await check("the raw IP never reaches the database", async () => {
  const env = envWith();
  await post(GOOD, env, { "CF-Connecting-IP": "198.51.100.42" });
  const bound = env.calls.flatMap((c) => c.params || []).map(String);
  assert(!bound.includes("198.51.100.42"), "the address was stored as itself");
  assert(bound.some((v) => /^[0-9a-f]{32}$/.test(v)), "expected a hash");
});

await check("a closed form and an unknown partner are the same 404", async () => {
  // Telling them apart reports whether a ministry exists but has switched
  // its form off.
  const env = envWith({ form: null });
  const res = await post(GOOD, env);
  eq(res.status, 404, "status");
});

/* ------------------------------- the widget ----------------------------- */

await check("a partner's own words cannot inject script into the form", async () => {
  const nasty = { ...FORM,
    heading: '</script><img src=x onerror=alert(1)>',
    thanks: '"><script>alert(2)</script>' };
  const js = contactScript(nasty, "chase-roush", "https://thauma.one");
  assert(!/<img src=x onerror/.test(js), "raw HTML survived into the script");
  assert(!/<script>alert\(2\)/.test(js), "a script tag survived into the script");
});

await check("the form is a card in a shadow root, with the ministry's colour", async () => {
  const js = contactScript(FORM, "chase-roush", "https://thauma.one");
  assert(js.includes("attachShadow"),
    "a host page's own input rule must not reshape controls somebody types into");
  assert(js.replace(/\\"/g, '"').includes('class="card"'), "no surrounding box");
  assert(js.includes("#E4572E"), "the ministry's accent never reached the form");
});

await check("it posts to its own partner, and carries a honeypot", async () => {
  const js = contactScript(FORM, "chase-roush", "https://thauma.one");
  const m = js.replace(/\\"/g, '"');
  assert(js.includes("/embed/v1/chase-roush/contact"), "wrong action");
  assert(m.includes('name="website"'), "no honeypot field");
  assert(m.includes("aria-hidden"), "the honeypot must be hidden from assistive tech");
  assert(m.includes('tabindex="-1"'), "and unreachable by keyboard");
});

await check("the widget looks for its OWN attribute, not the sign-up form's", async () => {
  // Both scripts can be on one page. Sharing a hook would have each drawing
  // into the other's slot.
  const js = contactScript(FORM, "chase-roush", "https://thauma.one");
  assert(js.includes("data-thauma-contact"), "wrong mount attribute");
  assert(!js.includes("data-thauma-form"), "it would collide with the sign-up form");
});

/* ------------------------------- the email ------------------------------ */

await check("the email names the sender and keeps the message readable", () => {
  const mail = messageFor(FORM, GOOD, "Chase Roush");
  assert(mail.subject.includes("Ann"), `the subject should name them: ${mail.subject}`);
  assert(mail.text.includes("Hello there."), "the message must be in the text part");
  assert(mail.html.includes("Hello there."), "and in the HTML part");
  assert(/white-space:\s*pre-wrap/.test(mail.html),
    "line breaks somebody typed must survive — prose arriving as one block is unreadable");
});

await check("a message cannot become markup in the recipient's inbox", () => {
  const mail = messageFor(FORM, { ...GOOD, message: "<script>alert(1)</script>" }, "X");
  assert(!/<script>alert/.test(mail.html), `a script tag survived: ${mail.html}`);
  assert(mail.html.includes("&lt;script&gt;"), "it should read literally");
});

await check("header injection through the name is neutralised", async () => {
  /* A newline in a header value is how somebody adds a Bcc to a message they
     do not own. */
  const env = envWith();
  await post({ ...GOOD, name: "Ann\r\nBcc: evil@example.invalid" }, env);
  const mail = env.sent[0];
  assert(!/\r|\n/.test(mail.subject), `the subject carries a newline: ${JSON.stringify(mail.subject)}`);
  assert(!/evil@example.invalid/.test(JSON.stringify(mail.to)), "an address was injected");
});

/* --------------------------- what it is about --------------------------- */

await check("the dropdown offers the ministry's own reasons", () => {
  /* Configurable rather than fixed: a church planter and a project office
     field completely different things, and CR's five would be slightly wrong
     for everybody else. */
  const m = contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS)
    .replace(/\\"/g, '"');
  assert(m.includes('name="topic"'), "no reason field");
  assert(m.includes(">General<"), "a configured reason is missing");
  assert(m.includes(">Prayer Request<"), "a configured reason is missing");
  assert(m.includes('value="tp_1"'), "options should carry ids, not labels");
});

await check("no reasons means no dropdown at all", () => {
  // A dropdown with one option is a question with no answer to give.
  const m = contactScript(FORM, "chase-roush", "https://thauma.one", null, [])
    .replace(/\\"/g, '"');
  assert(!m.includes('name="topic"'), "an empty dropdown was rendered");
});

await check("a reason routes the message where it belongs", async () => {
  /* Prayer requests to prayer@, everything else to the form's own address.
     The difference between a form that sorts itself and an inbox somebody
     sorts by hand every morning. */
  const env = envWith();
  await post({ ...GOOD, topic: "tp_2" }, env);
  eq(env.sent[0].to, ["prayer@example.org"], "the topic's own address should win");

  const plain = envWith();
  await post({ ...GOOD, topic: "tp_1" }, plain);
  eq(plain.sent[0].to, ["chase@example.org"],
    "a topic with no address of its own falls back to the form's");
});

await check("THE LABEL IS LOOKED UP, NEVER TAKEN FROM THE REQUEST", async () => {
  /* Trusting a submitted label would let anybody put words of their choosing
     in the subject line of an email the ministry receives. Trusting a
     submitted address would make this an open relay. */
  const env = envWith();
  await post({ ...GOOD, topic: "tp_2", label: "URGENT INVOICE",
               deliver_to: "attacker@example.invalid" }, env);
  const mail = env.sent[0];
  assert(!/URGENT INVOICE/.test(mail.subject), `a submitted label reached the subject: ${mail.subject}`);
  assert(mail.subject.includes("Prayer Request"), `expected the real label: ${mail.subject}`);
  assert(!JSON.stringify(mail.to).includes("attacker"), "a submitted address was used");
});

await check("an invented topic id is ignored, not an error", async () => {
  const env = envWith();
  const res = await post({ ...GOOD, topic: "tp_does_not_exist" }, env);
  eq(res.status, 200, "status");
  eq(env.sent[0].to, ["chase@example.org"], "falls back to the form's address");
});

await check("the subject line leads with what it is about", () => {
  /* What somebody sees in a list of fifty. The reason first, because it is how
     they decide what to open; the sender second. */
  const mail = messageFor(FORM, { ...GOOD, subject: "My mother is unwell" },
                          "Chase Roush", TOPICS[1]);
  eq(mail.subject, "Prayer Request — My mother is unwell", "subject line");
  assert(mail.text.includes("About:   Prayer Request"), "the reason should be in the text part");
  assert(mail.html.includes("Prayer Request"), "and visible in the HTML part");
});

await check("no subject falls back to the sender's name", () => {
  const mail = messageFor(FORM, GOOD, "Chase Roush", TOPICS[0]);
  eq(mail.subject, "General — Ann", "should still be identifiable");
});

await check("a subject cannot inject a header either", async () => {
  const env = envWith();
  await post({ ...GOOD, subject: "Hi\r\nBcc: evil@example.invalid" }, env);
  const mail = env.sent[0];
  assert(!/\r|\n/.test(mail.subject), `newline in the subject: ${JSON.stringify(mail.subject)}`);
  assert(!/evil@example/.test(JSON.stringify(mail.to)), "an address was injected");
});

await check('"thauma" is the organisation, and it can embed its own form', async () => {
  /* Thauma has no row in `partners` — it is the thing partners belong to — so
     a slug join could never find it, and without a reserved word its own
     contact form would be the one form that could not be embedded anywhere. */
  const env = envWith();
  const res = await handler.fetch(
    new Request("https://thauma.one/embed/v1/thauma/contact.js"),
    env, "thauma", "contact.js");
  eq(res.status, 200, "status");
  const ran = env.calls.map((c) => c.sql).join(" ");
  assert(/partner_id IS NULL/i.test(ran),
    "the organisation's form must be found by its NULL partner, not by a slug");
  assert(!/p\.slug = /i.test(ran),
    "it must not try to join `partners` — there is no row to join to");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
