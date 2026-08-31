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
import fs from "node:fs";
import handler, { STANDARD_SENDERS, orgDomain, senderProblem } from "../src/admin.js";
import { readFileSync } from "node:fs";
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

/* -------------------------- sending addresses -------------------------
   Resend verifies DOMAINS, not addresses. Once a domain is verified EVERY
   address at it sends, including one with a typo — which leaves successfully,
   reads as correct in the log, and drops every reply into nothing. These rules
   are the only thing standing between an administrator and that outcome, so
   they are tested as logic rather than through the gate. */

await check("an address at an unverified domain is refused, and told why", () => {
  const p = senderProblem("news@somewhere-else.org", "chase-roush.thauma.one");
  assert(p, "an address at another domain was accepted");
  assert(/chase-roush\.thauma\.one/.test(p),
    `the message must name the domain that IS allowed — got: ${p}`);
});

await check("no domain yet refuses everything, rather than accepting anything", () => {
  assert(senderProblem("news@chase-roush.thauma.one", null),
    "with no verified domain, no address can work — accepting one only " +
    "defers the failure to a newsletter going to real people");
});

await check("the domain comparison is case-insensitive", () => {
  eq(senderProblem("News@Chase-Roush.Thauma.One", "chase-roush.thauma.one"), null,
    "domains are not case-sensitive and a guard must not invent a rule");
});

await check("something that is not an address is refused", () => {
  assert(senderProblem("news", "chase-roush.thauma.one"), "bare word");
  assert(senderProblem("news@", "chase-roush.thauma.one"), "no domain");
  eq(senderProblem("news@chase-roush.thauma.one", "chase-roush.thauma.one"), null, "valid");
});

await check("the org domain is read from MAIL_FROM, not stated twice", () => {
  // Two places to state it is one place to forget when it moves — which it
  // just did, from mail.thauma.one to thauma.one.
  eq(orgDomain({ MAIL_FROM: "Thauma <noreply@thauma.one>" }), "thauma.one", "angle form");
  eq(orgDomain({ MAIL_FROM: "noreply@example.org" }), "example.org", "bare form");
  eq(orgDomain({}), "thauma.one", "a missing MAIL_FROM must not yield undefined@");
});

await check("the standard set is generic locals, so the DOMAIN carries identity", () => {
  // If a local part named the ministry there would be a second naming scheme
  // to keep in step with the domain, and reputation isolation comes from the
  // domain alone.
  for (const d of STANDARD_SENDERS) {
    assert(/^[a-z]+$/.test(d.local), `"${d.local}" is not a plain local part`);
    assert(d.label, `${d.local} has no label — the picker would show a bare address`);
  }
  const receiving = STANDARD_SENDERS.filter((d) => d.can_receive).map((d) => d.local);
  assert(receiving.length, "at least one address must be able to receive replies");
  assert(STANDARD_SENDERS.some((d) => !d.can_receive),
    "bulk senders should default to not receiving — an alias nobody made loses replies");
});

/* ------------------------- the cascade ---------------------------------
   The first version of this screen refused a rename while any address existed,
   refused an address delete while any list used it, and offered no way to
   repoint a list at an address that could not be created yet. Each guard read
   as prudent; together they formed a loop with no exit, and one wrong
   character in a domain could not be corrected. These tests are about the
   shape that replaced it. */

await check("the two dependencies are NOT treated the same", () => {
  /* A list that loses its SENDER cannot send and is archived. A list that
     loses its REPLY-TO carries on, because an empty reply_to already means
     "replies go to the sender". Conflating them would archive a list over a
     setting that has a working default — and archiving is the one action here
     that puts subscribers out of reach. */
  const archive = QUERIES.admin_lists_archive_by_sender;
  assert(/from_email\s*=\s*:address/.test(archive), "archive must key on from_email");
  assert(!/reply_to/.test(archive),
    "archiving must NOT consider reply_to — that would destroy a list to fix a default");

  const drop = QUERIES.admin_lists_drop_reply_to;
  assert(/reply_to\s*=\s*NULL/i.test(drop), "should clear reply_to");
  assert(!/archived_at/.test(drop), "clearing a reply-to must not archive anything");
});

await check("archiving never deletes a list or its subscribers", () => {
  // Subscribers are the one thing here that cannot be recreated: each is a
  // person who agreed to be written to, and a double opt-in cannot be
  // replayed. Archiving must stay reversible.
  const q = QUERIES.admin_lists_archive_by_sender;
  assert(/^\s*UPDATE/im.test(q.trim()), "must be an UPDATE, never a DELETE");
  assert(!/DELETE/i.test(q), "a sender going away must not delete a list");
  assert(!/subscribers/i.test(q), "must not touch the subscriber table at all");
});

await check("a rename moves BOTH columns, in one statement", () => {
  // Two passes could half-succeed and leave a list sending from a domain that
  // no longer exists — which looks correct and sends nothing.
  const q = QUERIES.admin_lists_repoint;
  assert(/from_email\s*=\s*CASE/i.test(q), "from_email must be guarded by its own CASE");
  assert(/reply_to\s*=\s*CASE/i.test(q), "reply_to must be guarded by its own CASE");
  assert(!/archived_at IS NULL/.test(q),
    "archived lists must move too — one restored later would otherwise point nowhere");
});

await check("the address keeps its id when it moves", () => {
  // Same address, same job, new domain. Delete-and-recreate would break the
  // audit trail across exactly the change somebody most wants to trace.
  assert(/^\s*UPDATE sender_addresses SET address/im.test(
    QUERIES.admin_sender_readdress.trim()),
    "a move must be an UPDATE of the address, not a new row");
});

await check("deleting a used address needs cascade=yes, checked on the SERVER", async () => {
  // A dialog is a suggestion — anything that can send a DELETE can skip the
  // browser entirely, which is where the explanation lives.
  const src = readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert(/cascade"\)\s*!==\s*"yes"/.test(src),
    "the handler must refuse a used address unless the console confirms the cascade");
  assert(src.indexOf("admin_lists_archive_by_sender") <
         src.indexOf("admin_sender_address_delete"),
    "lists must be archived BEFORE the address row goes — afterwards there is " +
    "no way to find which lists pointed at it");
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

await check("BOTH CONSOLES DESCRIBE A PERSON THE SAME WAY", async () => {
  /* admin.js returned a literal `roles: ["admin"]`. True for authorisation —
     requireAdmin has already established it — but this is an IDENTITY payload
     and the console header reads it to decide which navigation rows you get.
     So an administrator who is also a partner had the staff row painted from
     cache and then removed the moment this landed: it flashed on every admin
     page they opened, and stayed only on the pages that never called it.

     Asserted across the two files rather than through a request, because this
     endpoint has no signed-token harness and the bug is not in either file
     alone — it is the two of them disagreeing. */
  const read = (f) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
  const identityRoles = (src, where) => {
    const at = src.indexOf("you: {");
    assert(at !== -1, `${where}: no identity payload found`);
    const block = src.slice(at, at + 400);
    const m = block.match(/roles:\s*([^,\n]+(?:\n[^,\n]+)?)/);
    assert(m, `${where}: identity payload has no roles`);
    return m[1].replace(/\s+/g, " ").trim();
  };

  const mine = identityRoles(read("../src/admin.js"), "admin.js");
  const theirs = identityRoles(read("../src/staff-data.js"), "staff-data.js");

  assert(!/^\[/.test(mine),
    `admin.js hardcodes its identity roles as ${mine} — the console header ` +
    `reads this and will drop every other row the account has`);
  assert(mine.includes("me.roles") && theirs.includes("me.roles"),
    `both should derive roles from me.roles — admin.js: ${mine}, staff-data.js: ${theirs}`);
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
