#!/usr/bin/env node
/**
 * The way out of a mailing list
 *   node workers/test/unsubscribe.test.mjs
 *
 * This has to be easier than reporting spam. That is the whole brief: a reader
 * who cannot find the exit presses "report spam", and a spam report damages
 * the sending domain's reputation for everybody else on it — which, given one
 * domain per partner, means everybody that ministry writes to.
 */
import handler from "../src/unsubscribe.js";
import { sign, verify, unsubscribeUrl } from "../src/lib/unsub.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SALT = { SIGNUP_SALT: "0".repeat(48) };

function envWith(sub) {
  const calls = [];
  return {
    ...SALT, calls,
    DB: {
      prepare(sql) {
        const run = async () => {
          calls.push({ sql, params: this._p });
          if (/FROM subscribers WHERE id/i.test(sql)) return { results: sub ? [sub] : [] };
          return { results: [] };
        };
        const stmt = { _p: null, bind(...a) { stmt._p = a; return stmt; }, all: run, run };
        return stmt;
      },
    },
  };
}
const get = (env, qs, method = "GET") =>
  handler.fetch(new Request("https://thauma.one/unsubscribe" + qs, { method }), env);
const wrote = (env) => env.calls.some((c) => /UPDATE subscribers/i.test(c.sql));

console.log("unsubscribe — the way out\n");

/* ---------------------------- the signature ---------------------------- */

await check("a signature is stable, and specific to one subscriber", async () => {
  eq(await sign(SALT, "sub_1"), await sign(SALT, "sub_1"), "must be stable");
  assert(await sign(SALT, "sub_1") !== await sign(SALT, "sub_2"),
    "one link must not work for somebody else");
});

await check("NO SECRET MEANS NO SIGNATURE — it does not fall back", async () => {
  /* It began as `SIGNUP_SALT || MAIL_FROM || "thauma-dev-salt"`. MAIL_FROM is
     in wrangler.toml, in the repository, in the open — a signing key anybody
     can read is not one, and the failure is invisible because the links go on
     working perfectly for the forger too. */
  let threw = false;
  try { await sign({}, "sub_1"); } catch { threw = true; }
  assert(threw, "a missing secret must stop the send, not sign with a public value");
  try { await sign({ SIGNUP_SALT: "short" }, "sub_1"); threw = false; } catch { threw = true; }
  assert(threw, "a too-short secret is not a secret");
});

await check("verify refuses rather than throwing when the secret is gone", async () => {
  // A visitor who followed a link should get the ordinary page, not a stack
  // trace — and a deploy that cannot verify must not unsubscribe on trust.
  eq(await verify({}, "sub_1", "anything"), false, "should be false, not an exception");
});

await check("a forged or truncated token verifies as false", async () => {
  const real = await sign(SALT, "sub_1");
  eq(await verify(SALT, "sub_1", real), true, "the real one must work");
  eq(await verify(SALT, "sub_1", real.slice(0, -1)), false, "truncated");
  eq(await verify(SALT, "sub_1", real.slice(0, -1) + "0"), false, "one character changed");
  eq(await verify(SALT, "sub_2", real), false, "another subscriber's");
  eq(await verify(SALT, "sub_1", ""), false, "empty");
});

/* ----------------------------- the endpoint ---------------------------- */

await check("a real link unsubscribes", async () => {
  const env = envWith({ id: "sub_1", status: "subscribed" });
  const res = await get(env, `?s=sub_1&t=${await sign(SALT, "sub_1")}`);
  eq(res.status, 200, "status");
  assert(wrote(env), "nobody was unsubscribed");
});

await check("a forged link changes nothing, and says the same thing", async () => {
  /* IDENTICAL PAGES. A different answer for "not found" turns this into a way
     to ask whether somebody subscribes to a ministry — a question about their
     religion, answerable by anyone who can guess an id. */
  const good = envWith({ id: "sub_1", status: "subscribed" });
  const goodRes = await get(good, `?s=sub_1&t=${await sign(SALT, "sub_1")}`);

  const bad = envWith({ id: "sub_1", status: "subscribed" });
  const badRes = await get(bad, "?s=sub_1&t=" + "f".repeat(32));

  const missing = envWith(null);
  const missingRes = await get(missing, `?s=sub_9&t=${await sign(SALT, "sub_9")}`);

  assert(!wrote(bad), "a forged token unsubscribed somebody");
  const bodies = await Promise.all([goodRes.text(), badRes.text(), missingRes.text()]);
  eq(new Set(bodies).size, 1,
    "three different pages — this reports who is on a list");
});

await check("pressing it twice is not an error", async () => {
  const env = envWith({ id: "sub_1", status: "unsubscribed" });
  const res = await get(env, `?s=sub_1&t=${await sign(SALT, "sub_1")}`);
  eq(res.status, 200, "status");
  assert(!wrote(env), "already gone needs no second write");
});

await check("POST works, because List-Unsubscribe-Post sends one", async () => {
  const env = envWith({ id: "sub_1", status: "subscribed" });
  const res = await get(env, `?s=sub_1&t=${await sign(SALT, "sub_1")}`, "POST");
  eq(res.status, 200, "status");
  assert(wrote(env), "Gmail's one-click button would do nothing");
});

await check("no parameters at all is still a page, not a crash", async () => {
  const res = await get(envWith(null), "");
  eq(res.status, 200, "status");
});

await check("the page is never indexed", async () => {
  const res = await get(envWith(null), "");
  assert(/noindex/.test(res.headers.get("X-Robots-Tag") || ""), "missing X-Robots-Tag");
  assert(/no-store/.test(res.headers.get("Cache-Control") || ""), "must not be cached");
});

await check("the link is built with both parts", async () => {
  const u = await unsubscribeUrl(SALT, "https://thauma.one", "sub_1");
  assert(u.includes("/unsubscribe?s=sub_1&t="), `wrong shape: ${u}`);
  assert(u.length > "https://thauma.one/unsubscribe?s=sub_1&t=".length + 30, "no token");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
