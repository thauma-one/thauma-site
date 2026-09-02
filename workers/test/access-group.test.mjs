#!/usr/bin/env node
/**
 * Keeping Cloudflare Access in step with the People page
 *   node workers/test/access-group.test.mjs
 *
 * This edits a live authorisation list over HTTP, so the interesting cases are
 * the ones where it must NOT write: no configuration, the protected account,
 * and an address that is already there. Every test here stubs fetch — nothing
 * touches Cloudflare.
 */
import { accessConfig, emailsIn, addEmail, removeEmail } from "../src/lib/access-group.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const ENV = { ACCESS_API_TOKEN: "t", ACCESS_ACCOUNT_ID: "acct",
              ACCESS_GROUP_NAME: "Thauma console" };

/** A group as Cloudflare returns it, plus a record of what gets written. */
function stub({ emails = ["keep@thauma.one"], name = "Thauma console",
                extraInclude = [], failPut = false } = {}) {
  const calls = [];
  const group = {
    id: "g1", name,
    include: [...extraInclude, ...emails.map((e) => ({ email: { email: e } }))],
    exclude: [{ email_domain: { domain: "banned.example" } }],
    require: [{ ip: { ip: "1.2.3.4" } }],
  };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET",
                 body: init.body ? JSON.parse(init.body) : null });
    if ((init.method || "GET") === "GET") {
      return { json: async () => ({ success: true, result: [group] }) };
    }
    if (failPut) {
      return { status: 403, json: async () => ({ success: false,
        errors: [{ message: "Authentication error" }] }) };
    }
    return { json: async () => ({ success: true, result: group }) };
  };
  return { calls, put: () => calls.find((c) => c.method === "PUT") };
}

console.log("Access group sync\n");

await check("a deploy with no token does nothing and says so", async () => {
  /* Every environment runs this code; only some are configured for it. A
     deployment that cannot reach Cloudflare must not be one that cannot add a
     person. */
  let touched = false;
  globalThis.fetch = async () => { touched = true; };
  eq(accessConfig({}).ok, false, "configured");
  const r = await addEmail({}, "x@thauma.one");
  eq(r.ok, false, "ok");
  eq(touched, false, "it called Cloudflare anyway");
  for (const partial of [{ ACCESS_API_TOKEN: "t" },
                         { ACCESS_API_TOKEN: "t", ACCESS_ACCOUNT_ID: "a" }]) {
    eq(accessConfig(partial).ok, false, `half-configured: ${JSON.stringify(partial)}`);
  }
});

await check("adding writes the address and NOTHING else", async () => {
  /* PUT replaces the group. Rules this code did not author — require, exclude,
     and any non-email include — have to come back unchanged, or adding one
     person quietly deletes somebody's IP restriction. */
  const s = stub({ extraInclude: [{ everyone: {} }] });
  const r = await addEmail(ENV, "New@Thauma.one");
  eq(r.added, true, "added");
  const sent = s.put().body;
  eq(emailsIn(sent), ["keep@thauma.one", "new@thauma.one"], "emails");
  eq(sent.require, [{ ip: { ip: "1.2.3.4" } }], "require survived");
  eq(sent.exclude.length, 1, "exclude survived");
  assert(sent.include.some((r2) => r2.everyone), "a non-email include rule was dropped");
});

await check("an address already there is a success, not a write", async () => {
  const s = stub({ emails: ["keep@thauma.one", "already@thauma.one"] });
  const r = await addEmail(ENV, "ALREADY@thauma.one");
  eq(r.already, true, "already");
  eq(s.put(), undefined, "it rewrote the group for nothing");
});

await check("THE PROTECTED ACCOUNT IS NEVER TAKEN OUT OF ACCESS", async () => {
  /* The half of 0026_protected_account.sql a database cannot enforce. Removed
     here, the site's own failsafe is locked out with a perfectly good row. */
  const s = stub({ emails: ["keep@thauma.one", "other@thauma.one"] });
  const r = await removeEmail(ENV, "Keep@Thauma.one", { keep: ["keep@thauma.one"] });
  eq(r.ok, false, "ok");
  eq(r.protected, true, "protected");
  eq(s.put(), undefined, "it edited the group anyway");
});

await check("removing takes out one address and leaves the rest", async () => {
  const s = stub({ emails: ["keep@thauma.one", "go@thauma.one"] });
  const r = await removeEmail(ENV, "go@thauma.one", { keep: ["keep@thauma.one"] });
  eq(r.removed, true, "removed");
  eq(emailsIn(s.put().body), ["keep@thauma.one"], "left behind");
});

await check("removing somebody who is not there is not an error", async () => {
  const s = stub({ emails: ["keep@thauma.one"] });
  const r = await removeEmail(ENV, "ghost@thauma.one", { keep: [] });
  eq(r.already, true, "already gone");
  eq(s.put(), undefined, "wrote for nothing");
});

await check("a missing group names itself instead of failing vaguely", async () => {
  stub({ name: "Something else" });
  let threw = null;
  try { await addEmail(ENV, "x@thauma.one"); } catch (e) { threw = e.message; }
  assert(threw && /Thauma console/.test(threw) && /Zero Trust/.test(threw),
    `unhelpful: ${threw}`);
});

await check("Cloudflare refusing the write is an error, not a silent success", async () => {
  stub({ failPut: true });
  let threw = null;
  try { await addEmail(ENV, "x@thauma.one"); } catch (e) { threw = e.message; }
  assert(threw && /Authentication/.test(threw), `swallowed: ${threw}`);
});

await check("addresses are compared without case mattering", async () => {
  /* users.email is COLLATE NOCASE, so the two lists have to agree about what
     "the same person" means or somebody ends up in Access twice. */
  const s = stub({ emails: ["Mixed@Thauma.One"] });
  eq((await addEmail(ENV, "mixed@thauma.one")).already, true, "add");
  eq(s.put(), undefined, "wrote a duplicate");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
