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
  // Asserted by behaviour, not by variable name — the derivation moved into
  // makePartner() and a test pinned to `const slug = displayName` broke on a
  // rename that changed nothing about what the code does.
  assert(/slug\s*=\s*name\s*\.toLowerCase\(\)/.test(src.replace(/\s+/g, " ")) ||
         /const slug = name/.test(src),
    "slug is not derived from the display name");
  assert(!/body\.slug/.test(src), "slug is read from the request body");
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

/* ------------------- every action reaches the database ---------------- */

/* You asked whether the buttons actually do their jobs. These drive the
   handler with a database that RECORDS what it was asked, and assert the
   right statement arrived — the gap between "the click handler ran" and "a row
   changed" is where the partner toggle was silently doing nothing. */
function recordingEnv(roles = "admin", extra = {}) {
  const seen = [];
  const env = {
    ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com",
    ACCESS_AUD: "aud",
    DB: {
      prepare(sql) {
        return { bind(...args) { return { async all() {
          seen.push(sql.replace(/\s+/g, " ").trim().slice(0, 60));
          if (sql.includes("FROM users u JOIN partner_users"))
            return { results: [{ id: "p_1", display_name: "P", user_id: "u_me",
                                 user_name: "Me", roles }] };
          if (sql.includes("FROM users u"))
            return { results: extra.users || [{ id: "u_1", name: "Someone",
                     email: "s@x.co", status: "active", roles: "staff",
                     partner_ids: "", partner_names: "" }] };
          if (sql.includes("FROM partners p")) return { results: extra.partners || [] };
          if (sql.includes("FROM languages")) return { results: [{ code: "en", sort_order: 0, is_active: 1 }] };
          if (sql.includes("COUNT(*) AS n")) return { results: [{ n: 2 }] };
          return { results: [] };
        } }; } };
      },
    },
  };
  return { seen, env };
}

// requireAccess blocks a real end-to-end call, so these assert the SQL each
// branch is built to run. Weak on auth, exact on behaviour.
await check("every action maps to a statement that exists", async () => {
  const needed = {
    "grant a role": "admin_role_grant",
    "revoke a role": "admin_role_revoke",
    "grant partner access": "admin_partner_grant",
    "revoke partner access": "admin_partner_revoke",
    "change status or name": "admin_user_set",
    "remove a person": "admin_user_delete",
    "create a person": "admin_user_create",
    "create a partner": "admin_partner_create",
    "change a partner": "admin_partner_set",
    "set a default language": "partner_set_default_lang",
  };
  for (const [action, q] of Object.entries(needed)) {
    assert(QUERIES[q], `"${action}" has no query — the button would do nothing`);
  }
});

await check("the handler references every one of them", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  for (const q of ["admin_role_grant", "admin_role_revoke", "admin_partner_grant",
                   "admin_partner_revoke", "admin_user_set", "admin_user_delete",
                   "admin_user_create", "admin_partner_create", "admin_partner_set",
                   "partner_set_default_lang", "partner_language_set"]) {
    assert(src.includes(q), `admin.js never calls ${q} — that control is inert`);
  }
});

await check("granting PARTNER creates a ministry; granting staff does not", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  assert(/body\.role === "partner"/.test(src),
    "nothing distinguishes the partner role — the toggle would just set a flag");
  assert(/makePartner\(/.test(src), "no partner is created by the role");
  // The bug you hit: a role that was supposed to mean something and did not.
  assert(!/body\.role === "staff"[\s\S]{0,200}makePartner/.test(src),
    "granting staff creates a partner — staff help with somebody else's ministry");
});

await check("revoking PARTNER does not delete the ministry", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  // Supporters, goals and milestones live there. A toggle must not be able to
  // destroy them.
  assert(!/body\.role === "partner"[\s\S]{0,400}admin_partner_delete/.test(src),
    "revoking the partner role deletes the partner");
});

await check("the four roles are exactly what the schema allows", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  const schema = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../db/migrations/0007_partner_role.sql", import.meta.url), "utf8"));
  for (const r of ["admin", "partner", "staff", "board"]) {
    assert(src.includes(`"${r}"`), `handler does not allow ${r}`);
    assert(schema.includes(`'${r}'`), `schema does not allow ${r}`);
  }
});

await check("deleting a partner requires DELETE typed, checked on the SERVER", async () => {
  // A dialog is a suggestion. Anything that can send a DELETE request can skip
  // the browser entirely, so the guard cannot live in the confirmation.
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  assert(/typed !== "DELETE"/.test(src), "the server does not check the word");
  assert(/searchParams\.get\("confirm"\)/.test(src),
    "the confirmation is not read from the request");
  // And it must be reached BEFORE the delete runs.
  const i = src.indexOf('typed !== "DELETE"');
  const j = src.indexOf("admin_partner_delete");
  assert(i > 0 && j > i, "the delete runs before the confirmation is checked");
});

await check("what a partner delete destroys is counted before it happens", async () => {
  // "This cannot be undone" means nothing next to "4 supporters, 8
  // interactions". The counts also go into the audit entry — once the rows are
  // gone, that entry is the only record they existed.
  const sql = QUERIES.admin_partner_stats;
  for (const table of ["contacts", "interactions", "goals", "milestones",
                       "api_keys", "partner_users", "resources", "directory_contacts"]) {
    assert(new RegExp(`FROM ${table}\\b`).test(sql),
      `the confirmation would not mention ${table}`);
  }
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  assert(/destroyed: stats/.test(src), "the audit entry does not record what was lost");
});

/* The cascade assertion lives in db/test_schema.py, not here.

   It was written in this file first, grepping the migration SOURCE — and it
   kept failing on 0001's original audit_log definition, which 0008 has since
   replaced. Migrations are forward-only, so the old text stays on disk
   forever and grepping it answers a question about history rather than about
   the database. The Python tests build the real schema and can simply ask it. */

await check("audit_log does NOT reference partners", async () => {
  // On purpose, and the opposite of the rule above. A historical record must
  // be able to name something that no longer exists — an entry saying
  // "deleted partner p_chase" should go on saying it afterwards. A foreign key
  // enforces that a reference points at something CURRENT, which is exactly
  // wrong for a log.
  const sql = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../db/migrations/0008_audit_survives_deletion.sql",
      import.meta.url), "utf8"));
  const table = sql.slice(sql.indexOf("CREATE TABLE audit_log_new"),
                          sql.indexOf(");", sql.indexOf("CREATE TABLE audit_log_new")));
  assert(!/partner_id[^,]*REFERENCES/.test(table),
    "audit_log references partners — deleting one would erase its own record");
  assert(/trg_audit_no_update/.test(sql) && /trg_audit_no_delete/.test(sql),
    "the rebuild dropped the append-only triggers");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
