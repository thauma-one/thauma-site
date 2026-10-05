#!/usr/bin/env node
/**
 * What happened to each copy of a newsletter, as Resend reports it
 *   node workers/test/resend-webhook.test.mjs
 *
 * Anyone can reach this address, so the signature is the whole gate: a call
 * not signed with the webhook's secret, signed for another body, or too old
 * changes nothing. Then each event does exactly its one thing: a bounce marks
 * the copy (and, only when permanent, the subscriber); a spam complaint
 * unsubscribes; an open and a click are recorded once and counted.
 */
import handler, { verifySvix } from "../src/resend-webhook.js";
import { QUERIES } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const RAW = crypto.getRandomValues(new Uint8Array(24));
const SECRET = "whsec_" + btoa(String.fromCharCode(...RAW));
async function sign(body, { id = "msg_1", ts = Math.floor(Date.now() / 1000), secret = RAW } = {}) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)))));
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

function world({ known = true } = {}) {
  const ran = [];
  const sqlOf = (n) => QUERIES[n].replace(/:[a-z_][a-z0-9_]*/gi, "?");
  const name = (sql) => Object.keys(QUERIES).find((n) => sqlOf(n) === sql) || sql.slice(0, 40);
  const env = {
    RESEND_WEBHOOK_SECRET: SECRET,
    DB: { prepare(sql) {
      let args = [];
      const run = async () => {
        ran.push([name(sql), args]);
        if (sql === sqlOf("recipient_by_provider")) return { results: known ? [{ mailing_id: "mg_1", subscriber_id: "sb_1", status: "sent" }] : [] };
        return { results: [] };
      };
      const st = { bind(...a) { args = a; return st; }, all: run, run, first: async () => (await run()).results[0] || null };
      return st;
    } },
  };
  return { env, ran, names: () => ran.map((r) => r[0]) };
}
async function deliver(env, event, headers) {
  const body = JSON.stringify(event);
  return handler.fetch(new Request("https://thauma.one/api/resend-webhook", { method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || await sign(body)) }, body }), env);
}

console.log("resend-webhook — bounces, complaints, opens and clicks\n");

await check("unsigned, wrongly signed, re-used for another body, or stale: refused, nothing touched", async () => {
  const ev = { type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Permanent" } } };
  for (const [why, headers] of [
    ["unsigned", {}],
    ["another secret", await sign(JSON.stringify(ev), { secret: crypto.getRandomValues(new Uint8Array(24)) })],
    ["another body", await sign("{}")],
    ["ten minutes old", await sign(JSON.stringify(ev), { ts: Math.floor(Date.now() / 1000) - 600 })],
  ]) {
    const { env, ran } = world();
    const res = await deliver(env, ev, headers);
    eq(res.status, 401, why);
    eq(ran.length, 0, why + ": no query");
  }
  const { env } = world();
  delete env.RESEND_WEBHOOK_SECRET;
  eq((await deliver(env, ev)).status, 401, "no secret configured: nothing accepted");
});

await check("a permanent bounce marks the copy AND stops sending to the address", async () => {
  const { env, names } = world();
  eq((await deliver(env, { type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Permanent", message: "No such user" } } })).status, 200, "status");
  eq(names(), ["recipient_by_provider", "recipient_bounced", "subscriber_bounced"], "queries");
});

await check("a temporary bounce marks only the copy", async () => {
  const { env, names } = world();
  await deliver(env, { type: "email.bounced", data: { email_id: "re_1", bounce: { type: "Transient", message: "Mailbox full" } } });
  eq(names(), ["recipient_by_provider", "recipient_bounced"], "queries");
});

await check("a spam complaint unsubscribes the person", async () => {
  const { env, names } = world();
  await deliver(env, { type: "email.complained", data: { email_id: "re_1" } });
  eq(names(), ["recipient_by_provider", "recipient_complained", "subscriber_unsubscribe_by_id"], "queries");
});

await check("an open is recorded; a click is recorded and its link counted", async () => {
  const a = world();
  await deliver(a.env, { type: "email.opened", data: { email_id: "re_1" } });
  eq(a.names(), ["recipient_by_provider", "recipient_opened"], "open");
  const b = world();
  await deliver(b.env, { type: "email.clicked", data: { email_id: "re_1", click: { link: "https://chaseroush.com/give" } } });
  eq(b.names(), ["recipient_by_provider", "recipient_clicked", "mailing_link_find", "mailing_link_add"], "click, a new link");
});

await check("a message this database never sent (a test, a confirmation) is acknowledged and ignored", async () => {
  const { env, names } = world({ known: false });
  const res = await deliver(env, { type: "email.bounced", data: { email_id: "re_x", bounce: { type: "Permanent" } } });
  eq(res.status, 200, "200, so Resend does not retry");
  eq(names(), ["recipient_by_provider"], "nothing changed");
});

await check("verifySvix accepts any of several signatures (Resend rotates secrets)", async () => {
  const body = "{}";
  const good = await sign(body);
  const h = new Headers({ ...good, "svix-signature": "v1,AAAA " + good["svix-signature"] });
  eq(await verifySvix(SECRET, h, body), true, "second entry matches");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
