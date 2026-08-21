#!/usr/bin/env node
/**
 * The public sign-up form — the one place a stranger can write
 *   node workers/test/signup.test.mjs
 *
 * Everything else public in this system is read-only. So the tests that matter
 * here are not "does it work" but "what can somebody learn, and what can they
 * make it do". Each of these corresponds to a rule stated at the top of
 * src/signup.js.
 */
import handler, { formScript, escapeHtml } from "../src/signup.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const LIST = {
  id: "ml_1", partner_id: "p_chase", name: "Newsletter", slug: "newsletter",
  from_name: "Chase Roush", from_email: "connect@thauma.one", reply_to: null,
  form_heading: null, form_blurb: null, form_button: null, form_thanks_url: null,
};

/** A database that records what was asked of it, and can be told what to find. */
function envWith({ list = LIST, existing = null, attempts = 0 } = {}) {
  const calls = [];
  const env = {
    calls, RESEND_API_KEY: null, SIGNUP_SALT: "test-salt",
    DB: {
      prepare(sql) {
        const run = async () => {
          calls.push({ sql, params: env._p });
          if (/FROM mailing_lists/i.test(sql)) return { results: list ? [list] : [] };
          if (/COUNT\(\*\) AS n FROM signup_attempts/i.test(sql)) {
            return { results: [{ n: attempts }] };
          }
          if (/FROM subscribers WHERE list_id/i.test(sql)) {
            return { results: existing ? [existing] : [] };
          }
          return { results: [] };
        };
        return { bind(...a) { env._p = a; return { all: run, run }; }, all: run, run };
      },
    },
  };
  return env;
}

const post = (body, env, headers = {}) => handler.fetch(
  new Request("https://thauma.one/embed/v1/chase-roush/newsletter/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: JSON.stringify(body),
  }), env, "chase-roush", "newsletter", "signup");

const ranQuery = (env, needle) => env.calls.some((c) => new RegExp(needle, "i").test(c.sql));

console.log("signup — the public write endpoint\n");

/* -------------------- rule 1: one answer for everything ------------------- */

await check("every outcome returns the identical body", async () => {
  const bodies = [];
  for (const [label, opts, payload] of [
    ["new person",        {},                                        { email: "a@b.invalid" }],
    ["already subscribed", { existing: { id: "s1", status: "subscribed" } }, { email: "a@b.invalid" }],
    ["already pending",    { existing: { id: "s1", status: "pending" } },    { email: "a@b.invalid" }],
    ["previously left",    { existing: { id: "s1", status: "unsubscribed" } }, { email: "a@b.invalid" }],
    ["honeypot filled",    {},                                        { email: "a@b.invalid", website: "x" }],
    ["not an address",     {},                                        { email: "nonsense" }],
    ["rate limited",       { attempts: 99 },                          { email: "a@b.invalid" }],
  ]) {
    const res = await post(payload, envWith(opts));
    eq(res.status, 200, `${label} status`);
    bodies.push(await res.text());
  }
  const distinct = new Set(bodies);
  assert(distinct.size === 1,
    `${distinct.size} different answers — this endpoint would report who is on a list:\n` +
    [...distinct].map((b) => "            " + b).join("\n"));
});

/* ------------------------- rule 2: the honeypot --------------------------- */

await check("a filled honeypot writes NOTHING", async () => {
  const env = envWith();
  await post({ email: "bot@b.invalid", website: "http://spam" }, env);
  assert(!ranQuery(env, "INSERT INTO subscribers"), "a subscriber was created");
  assert(ranQuery(env, "signup_attempts"), "the attempt should still be recorded");
});

/* ----------------------- rule 3: the rate limit --------------------------- */

await check("too many attempts stops writing, without saying so", async () => {
  const env = envWith({ attempts: 12 });
  await post({ email: "a@b.invalid" }, env);
  assert(!ranQuery(env, "INSERT INTO subscribers"), "should not have written");
});

await check("an ordinary number of attempts is not stopped", async () => {
  const env = envWith({ attempts: 3 });
  await post({ email: "a@b.invalid" }, env);
  assert(ranQuery(env, "INSERT INTO subscribers"), "a real person was refused");
});

/* ---------------------- rule 4: the IP is not kept ------------------------ */

await check("the raw IP never reaches the database", async () => {
  const env = envWith();
  await post({ email: "a@b.invalid" }, env, { "CF-Connecting-IP": "198.51.100.42" });
  const bound = env.calls.flatMap((c) => c.params || []).map(String);
  assert(!bound.includes("198.51.100.42"),
    `the address was stored as itself: ${JSON.stringify(bound)}`);
  assert(bound.some((v) => /^[0-9a-f]{32}$/.test(v)), "expected a hash to be stored");
});

await check("the same IP hashes the same way twice, and differently per address", async () => {
  const hashOf = async (ip) => {
    const env = envWith();
    await post({ email: "a@b.invalid" }, env, { "CF-Connecting-IP": ip });
    return env.calls.flatMap((c) => c.params || []).map(String)
      .find((v) => /^[0-9a-f]{32}$/.test(v));
  };
  const a1 = await hashOf("203.0.113.1");
  const a2 = await hashOf("203.0.113.1");
  const b1 = await hashOf("203.0.113.2");
  eq(a1, a2, "the same address must count as the same machine");
  assert(a1 !== b1, "two addresses must not collide");
});

/* --------------------------- what it may create --------------------------- */

await check("a form can only ever create a PENDING row", async () => {
  const env = envWith();
  await post({ email: "a@b.invalid", name: "A" }, env);
  const add = env.calls.find((c) => /INSERT INTO subscribers/i.test(c.sql));
  assert(add, "nothing was inserted");
  assert(/'pending'/.test(add.sql),
    "the insert must hard-code pending — a form must not be able to subscribe anybody");
});

await check("somebody who unsubscribed comes back as pending, not subscribed", async () => {
  const env = envWith({ existing: { id: "s1", status: "unsubscribed" } });
  await post({ email: "a@b.invalid" }, env);
  const q = env.calls.find((c) => /subscribers[\s\S]*status = 'pending'/i.test(c.sql));
  assert(q, "expected the row to be reopened as pending");
  assert(!ranQuery(env, "status = 'subscribed'"),
    "a form post must never resurrect somebody straight to subscribed");
});

await check("an address already subscribed is left completely alone", async () => {
  const env = envWith({ existing: { id: "s1", status: "subscribed" } });
  await post({ email: "a@b.invalid" }, env);
  assert(!ranQuery(env, "INSERT INTO subscribers"), "should not insert");
  assert(!ranQuery(env, "UPDATE subscribers"), "should not touch their row");
});

/* ------------------------------ the widget -------------------------------- */

await check("a closed or unknown list has no form at all", async () => {
  const env = envWith({ list: null });
  const res = await handler.fetch(
    new Request("https://thauma.one/embed/v1/chase-roush/newsletter/form.js"),
    env, "chase-roush", "newsletter", "form.js");
  eq(res.status, 404, "status");
});

await check("a partner's own words cannot inject script into the form", async () => {
  /* The heading and blurb are typed by a partner and rendered into a page on
     somebody else's website. An unescaped `</script>` there would be theirs to
     exploit and the host site's to suffer. */
  const nasty = { ...LIST,
    form_heading: '</script><img src=x onerror=alert(1)>',
    form_blurb: '"><script>alert(2)</script>' };
  const js = formScript(nasty, "chase-roush", "https://thauma.one");
  assert(!/<img src=x onerror/.test(js), "raw HTML survived into the script");
  assert(!/<script>alert\(2\)/.test(js), "a script tag survived into the script");
  assert(/&lt;/.test(js) || /\\u003c/.test(js), "expected the markup to be escaped");
});

await check("the form posts to its own list, and carries a honeypot", async () => {
  const js = formScript(LIST, "chase-roush", "https://thauma.one");
  assert(js.includes("/embed/v1/chase-roush/newsletter/signup"), "wrong action");
  assert(js.includes("website"), "no honeypot field");
  assert(js.includes("aria-hidden"), "the honeypot must be hidden from assistive tech");
  assert(js.includes('tabindex="-1"'), "the honeypot must not be reachable by keyboard");
});

await check("escapeHtml covers the characters that matter", () => {
  eq(escapeHtml("<"), "&lt;", "less-than");
  eq(escapeHtml(">"), "&gt;", "greater-than");
  eq(escapeHtml("&"), "&amp;", "ampersand");
  eq(escapeHtml('"'), "&quot;", "double quote");
  eq(escapeHtml("'"), "&#39;", "single quote");
  eq(escapeHtml("plain text"), "plain text", "ordinary text is untouched");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
