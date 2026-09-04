#!/usr/bin/env node
/**
 * Confirming an account from a signed link
 *   node workers/test/confirm-account.test.mjs
 *
 * This page is PUBLIC and it changes an account's status, so the signature is
 * the whole of the security. Most of what follows is about the ways a link can
 * be wrong — edited, expired, replayed for a different purpose, or held by
 * somebody whose account was deliberately turned off since.
 */
import handler from "../src/confirm-account.js";
import { sign, linkParams } from "../src/lib/signed-link.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SALT = "s".repeat(32);

/** A database holding one account, recording any write. */
function envWith(status, { missing = false } = {}) {
  const writes = [];
  return {
    writes,
    SIGNUP_SALT: SALT,
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            if (/^\s*UPDATE users/i.test(sql)) writes.push({ sql, args });
            return {
              async all() {
                if (/FROM users/i.test(sql)) {
                  return { results: missing ? []
                    : [{ id: "u_1", email: "mira@thauma.one", name: "Mira", status }] };
                }
                return { results: [] };
              },
              async first() {
                return missing ? null
                  : { id: "u_1", email: "mira@thauma.one", name: "Mira", status };
              },
            };
          },
        };
      },
    },
  };
}

const get = (qs) => new Request(`https://dev.thauma.one/confirm-account?${qs}`);
const body = async (res) => await res.text();

console.log("confirming an account\n");

await check("a valid link turns an invited account on", async () => {
  const env = envWith("invited");
  const res = await handler.fetch(get(await linkParams(env, "confirm", "u_1")), env);
  eq(res.status, 200, "status");
  const html = await body(res);
  assert(/confirmed/i.test(html), "the page does not say so");
  assert(/mira@thauma\.one/.test(html), "it does not name the address");
  eq(env.writes.length, 1, "it should have written exactly once");
  assert(/UPDATE users/i.test(env.writes[0].sql), "wrong statement");
});

await check("AN OLD LINK CANNOT REVIVE A SUSPENDED ACCOUNT", async () => {
  /* Somebody turned this account off deliberately. An invitation still sitting
     in their inbox must not overrule that. The SQL is the real guard — it only
     matches `invited` — and this is the second one. */
  const env = envWith("suspended");
  const res = await handler.fetch(get(await linkParams(env, "confirm", "u_1")), env);
  eq(res.status, 400, "status");
  assert(/turned off/i.test(await body(res)), "it does not explain");
  eq(env.writes.length, 0, "it wrote to a suspended account");
});

await check("clicking twice reads as done, not as a failure", async () => {
  /* Mail clients prefetch links. The second visit must not look like an
     error to the person who clicked once. */
  const env = envWith("active");
  const res = await handler.fetch(get(await linkParams(env, "confirm", "u_1")), env);
  eq(res.status, 200, "status");
  assert(/already/i.test(await body(res)), "it does not say already");
  eq(env.writes.length, 0, "it wrote again");
});

await check("an EDITED expiry is refused", async () => {
  /* The deadline is signed alongside the subject precisely so it cannot be
     extended by whoever holds the link. */
  const env = envWith("invited");
  const { token, expires } = await sign(env, "confirm", "u_1");
  const res = await handler.fetch(get(`u=u_1&e=${expires + 86400}&t=${token}`), env);
  eq(res.status, 400, "status");
  eq(env.writes.length, 0, "it accepted an edited link");
});

await check("an expired link says so, rather than 'invalid'", async () => {
  /* Different problems, different answers: one needs a new invitation, the
     other means the link was mangled. */
  const env = envWith("invited");
  const { token, expires } = await sign(env, "confirm", "u_1", { ttl: -60 });
  const res = await handler.fetch(get(`u=u_1&e=${expires}&t=${token}`), env);
  assert(/expired/i.test(await body(res)), "it does not say expired");
  eq(env.writes.length, 0, "it confirmed on an expired link");
});

await check("a token minted for ANOTHER PURPOSE does not work here", async () => {
  /* One secret serves several kinds of link. The purpose is mixed into the
     key, which is what stops a change-of-address token confirming an account. */
  const env = envWith("invited");
  const { token, expires } = await sign(env, "email-change", "u_1");
  const res = await handler.fetch(get(`u=u_1&e=${expires}&t=${token}`), env);
  eq(res.status, 400, "status");
  eq(env.writes.length, 0, "a cross-purpose token was accepted");
});

await check("a token for one account cannot confirm another", async () => {
  const env = envWith("invited");
  const { token, expires } = await sign(env, "confirm", "u_2");
  const res = await handler.fetch(get(`u=u_1&e=${expires}&t=${token}`), env);
  eq(res.status, 400, "status");
  eq(env.writes.length, 0, "it confirmed somebody else's account");
});

await check("no signature at all is refused", async () => {
  const env = envWith("invited");
  for (const qs of ["u=u_1", "u=u_1&e=999999999999", "u=u_1&t=abc", ""]) {
    const res = await handler.fetch(get(qs), env);
    eq(res.status, 400, `accepted ${qs || "(nothing)"}`);
  }
  eq(env.writes.length, 0, "it wrote for an unsigned request");
});

await check("a deploy that cannot sign blames itself, not the visitor", async () => {
  const env = envWith("invited");
  const { token, expires } = await sign(env, "confirm", "u_1");
  const broken = { ...envWith("invited"), SIGNUP_SALT: undefined };
  const res = await handler.fetch(get(`u=u_1&e=${expires}&t=${token}`), broken);
  const html = await body(res);
  assert(/our end/i.test(html), `it told the visitor their link was bad: ${html.slice(0, 200)}`);
});

await check("a deleted account says so instead of confirming nothing", async () => {
  const env = envWith("invited", { missing: true });
  const res = await handler.fetch(get(await linkParams(env, "confirm", "u_1")), env);
  eq(res.status, 400, "status");
  assert(/no longer exists/i.test(await body(res)), "it does not explain");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
