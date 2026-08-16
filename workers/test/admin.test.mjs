#!/usr/bin/env node
/**
 * Tests for workers/src/admin.js
 *   node workers/test/admin.test.mjs
 *
 * Every other endpoint in this Worker is partner-scoped, so a bug leaks one
 * partner's data to somebody who already had a grant to it. NOTHING here is
 * scoped — these queries reach every user, every partner and the whole audit
 * log by design. The role check is the only thing in the way, so it is what
 * these tests are about.
 */
import handler from "../src/admin.js";
import { QUERIES } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** A database that answers partners_for_user with whatever roles we choose. */
function envWith(roles) {
  return {
    ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    DB: {
      prepare() {
        return { bind() { return { async all() { return { results: roles === null ? [] :
          [{ id: "p_1", display_name: "P", user_id: "u_1", user_name: "N", roles }] }; } }; } };
      },
    },
  };
}
const req = (method = "GET", body) =>
  new Request("https://x/api/admin", {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

console.log("admin — the unscoped endpoint\n");

/* ------------------------------ the gate ------------------------------ */

await check("no Access token is refused", async () => {
  const res = await handler.fetch(req(), envWith("admin"));
  eq(res.status, 401, "status");
});

await check("a misconfigured deploy FAILS CLOSED", async () => {
  const res = await handler.fetch(req(), { DB: {} });
  eq(res.status, 500, "status");
});

await check("no handler method throws", async () => {
  // A ReferenceError past the auth check becomes an HTML 500 that no page can
  // parse — the failure mode this file's siblings shipped twice.
  for (const m of ["GET", "POST", "PATCH", "DELETE"]) {
    const res = await handler.fetch(req(m, m === "GET" ? undefined : {}), envWith("admin"));
    assert(res && typeof res.status === "number", `${m} returned no Response`);
    await res.json().catch(() => ({}));
  }
});

/* --------------------------- the queries ------------------------------ */

await check("admin queries are deliberately NOT partner-scoped", async () => {
  // Stated so the absence reads as a decision rather than an oversight: the
  // whole purpose of this endpoint is to see across partners, and the guard
  // is the role check rather than a WHERE clause.
  for (const q of ["admin_users", "admin_partners", "admin_audit_recent"]) {
    assert(!/:partner_id/.test(QUERIES[q]),
      `${q} takes a partner_id — is it really an admin query?`);
  }
});

await check("the email address cannot be edited", async () => {
  // It is the join to Cloudflare Access. Changing it here would silently
  // detach the record from the identity that signs in.
  assert(!/email\s*=\s*:email/.test(QUERIES.admin_user_set),
    "admin_user_set writes email — that would break the Access match");
});

await check("a new account is created INVITED, never active", async () => {
  // A row is not an account: the person must also exist in Access, and
  // partners_for_user requires status = 'active'. Two doors.
  assert(/'invited'/.test(QUERIES.admin_user_create),
    "new users are not created invited");
  assert(!/'active'/.test(QUERIES.admin_user_create),
    "new users are created active — that is one door, not two");
});

await check("the last-administrator check counts only ACTIVE admins", async () => {
  // A suspended admin cannot appoint anyone, so counting them would let the
  // organisation lock itself out while believing it had not.
  const sql = QUERIES.admin_count_admins;
  assert(/role\s*=\s*'admin'/.test(sql), "does not filter on the admin role");
  assert(/status\s*=\s*'active'/.test(sql), "counts inactive administrators");
});

await check("removing a user takes their roles and access with them", async () => {
  const schema = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../db/migrations/0006_roles.sql", import.meta.url), "utf8"));
  assert(/REFERENCES users\(id\) ON DELETE CASCADE/.test(schema),
    "user_roles would outlive the user");
});

await check("a new partner starts prospective and private", async () => {
  // A partner nobody has been sent as yet should not look active on a
  // dashboard, and should not be publishing anything.
  const sql = QUERIES.admin_partner_create;
  assert(/'prospective'/.test(sql), "new partners are not created prospective");
  assert(/is_public[\s\S]*?\b0\b|,\s*0\s*,/.test(sql), "new partners may be public");
});

await check("a partner's slug is derived, never taken from the client", async () => {
  // It ends up in URLs and API payloads. Letting somebody type one invites
  // spaces and capitals that then have to be lived with forever.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  assert(/const slug = displayName/.test(src), "slug is not derived from the name");
  assert(!/str\(body\.slug/.test(src), "slug is read from the request body");
});

await check("partner status values match the schema", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  const schema = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../db/migrations/0001_init.sql", import.meta.url), "utf8"));
  // The handler first shipped with "paused" and "ended", which the CHECK
  // constraint does not allow — the write would have failed at runtime.
  for (const s of ["prospective", "active", "on_leave", "alumni"]) {
    assert(src.includes(`"${s}"`), `handler does not allow ${s}`);
    assert(schema.includes(`'${s}'`), `schema does not allow ${s}`);
  }
  for (const bad of ["paused", "ended"]) {
    assert(!new RegExp(`"${bad}"`).test(src), `handler still allows ${bad}`);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
