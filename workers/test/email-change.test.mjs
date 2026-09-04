#!/usr/bin/env node
/**
 * Changing your own sign-in address
 *   node workers/test/email-change.test.mjs
 *
 * Email IS the identity here — there is no password, and Access sends the
 * one-time code to whatever address it holds. So the failure that matters is
 * not "the change did not happen", it is "the change happened and now nobody
 * can get in". Most of this file is about the order of the three writes.
 */
import confirm from "../src/confirm-email.js";
import { sign, linkParams } from "../src/lib/signed-link.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SALT = "s".repeat(32);
const OLD = "old@thauma.one";
const NEW = "new@thauma.one";

/** A world with one account and a recording Access group. */
function world({ status = "active", email = OLD, taken = false,
                 protectedEmails = [], accessFails = null, wired = true } = {}) {
  const order = [];          // every side effect, in the order it happened
  const env = {
    SIGNUP_SALT: SALT,
    ...(wired ? { ACCESS_API_TOKEN: "t", ACCESS_ACCOUNT_ID: "a",
                  ACCESS_GROUP_NAME: "Thauma console" } : {}),
    DB: {
      prepare(sql) {
        return { bind(...args) { return {
          async all() {
            if (/FROM users WHERE email/i.test(sql)) {
              return { results: taken ? [{ id: "u_other" }] : [] };
            }
            if (/FROM users u/i.test(sql) || /admin_users/i.test(sql)) {
              return { results: [{ id: "u_1", email, name: "Mira", status,
                                   protected: protectedEmails.includes(email) ? 1 : 0 }] };
            }
            if (/FROM users WHERE id/i.test(sql)) {
              return { results: [{ id: "u_1", email, name: "Mira", status }] };
            }
            if (/UPDATE users SET email/i.test(sql)) {
              order.push({ step: "db", email: args[0] });
              return { results: [] };
            }
            if (/INSERT INTO audit_log/i.test(sql)) return { results: [] };
            return { results: [] };
          },
          async first() {
            if (/FROM users WHERE email/i.test(sql)) return taken ? { id: "u_other" } : null;
            return { id: "u_1", email, name: "Mira", status };
          },
        }; } };
      },
    },
  };
  /* The Access group, as HTTP. */
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    if (method === "GET") {
      return { json: async () => ({ success: true, result: [{
        id: "g1", name: "Thauma console",
        include: [{ email: { email: OLD } }, ...protectedEmails.map((e) => ({ email: { email: e } }))],
        exclude: [], require: [] }] }) };
    }
    const emails = (JSON.parse(init.body).include || [])
      .map((r) => r.email && r.email.email).filter(Boolean);
    order.push({ step: "access", emails });
    if (accessFails === order.filter((o) => o.step === "access").length) {
      return { status: 403, json: async () => ({ success: false,
        errors: [{ message: "nope" }] }) };
    }
    return { json: async () => ({ success: true, result: {} }) };
  };
  return { env, order };
}

const link = async (env, id, email) =>
  new Request(`https://dev.thauma.one/confirm-email?` +
              await linkParams(env, "email-change", `${id}|${email}`));

console.log("changing your own address\n");

await check("THE NEW ADDRESS REACHES ACCESS BEFORE THE ACCOUNT MOVES", async () => {
  /* The whole design. Between the writes there must never be a moment where
     Thauma answers to an address the front door does not know — the person it
     would lock out is the one who just changed their address. */
  const { env, order } = world();
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 200, "status");

  const steps = order.map((o) => o.step);
  eq(steps, ["access", "db", "access"], "the order of the writes");
  assert(order[0].emails.includes(NEW), "the first write did not add the new address");
  eq(order[1].email, NEW, "the account did not move");
  assert(!order[2].emails.includes(OLD), "the old address was never removed");
});

await check("if Access refuses the new address, NOTHING is changed", async () => {
  /* Changing the account first and failing here would leave somebody with an
     account they cannot reach. */
  const { env, order } = world({ accessFails: 1 });
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 400, "status");
  assert(/locked out/i.test(await res.text()), "it does not explain");
  eq(order.filter((o) => o.step === "db").length, 0, "it moved the account anyway");
});

await check("a failure REMOVING the old address does not undo the change", async () => {
  /* Untidy, not dangerous: an extra address in Access that Thauma no longer
     answers to. Reported, not rolled back. */
  const { env, order } = world({ accessFails: 2 });
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 200, "status");
  assert(/still listed/i.test(await res.text()), "it does not mention the leftover");
  eq(order.filter((o) => o.step === "db").length, 1, "the change was rolled back");
});

await check("THE ADDRESS IS INSIDE THE SIGNATURE", async () => {
  /* A token saying only "this account may change address" could be reused
     with a different destination typed into the URL. */
  const { env, order } = world();
  const { token, expires } = await sign(env, "email-change", "u_1|" + NEW);
  const res = await confirm.fetch(new Request(
    `https://x/confirm-email?u=${encodeURIComponent("u_1|attacker@evil.example")}` +
    `&e=${expires}&t=${token}`), env);
  eq(res.status, 400, "status");
  eq(order.length, 0, "it changed the address to one that was not signed");
});

await check("a confirmation token cannot be replayed here", async () => {
  const { env, order } = world();
  const { token, expires } = await sign(env, "confirm", `u_1|${NEW}`);
  const res = await confirm.fetch(new Request(
    `https://x/confirm-email?u=${encodeURIComponent("u_1|" + NEW)}&e=${expires}&t=${token}`), env);
  eq(res.status, 400, "status");
  eq(order.length, 0, "a cross-purpose token was accepted");
});

await check("an address taken since the link was sent is refused", async () => {
  const { env, order } = world({ taken: true });
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 400, "status");
  assert(/taken/i.test(await res.text()), "it does not say why");
  eq(order.length, 0, "it wrote anyway");
});

await check("clicking twice reads as done", async () => {
  const { env, order } = world({ email: NEW });
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 200, "status");
  assert(/already/i.test(await res.text()), "it does not say already");
  eq(order.length, 0, "it wrote again");
});

await check("an expired link says expired", async () => {
  const { env } = world();
  const { token, expires } = await sign(env, "email-change", `u_1|${NEW}`, { ttl: -60 });
  const res = await confirm.fetch(new Request(
    `https://x/confirm-email?u=${encodeURIComponent("u_1|" + NEW)}&e=${expires}&t=${token}`), env);
  assert(/expired/i.test(await res.text()), "it does not say expired");
});

await check("a deploy with no Access wiring still changes the address", async () => {
  /* Access sync is optional everywhere. Without it the account still moves and
     an administrator updates the front door by hand — which is what happened
     before any of this existed. */
  const { env, order } = world({ wired: false });
  const res = await confirm.fetch(await link(env, "u_1", NEW), env);
  eq(res.status, 200, "status");
  eq(order.map((o) => o.step), ["db"], "it should touch only the database");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
