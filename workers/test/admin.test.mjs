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
import handler, { STANDARD_SENDERS, orgDomain, senderProblem, syncPartnerRole } from "../src/admin.js";
import { readFileSync } from "node:fs";
import { QUERIES } from "../src/lib/db.js";
import { notify, notifyPerson, noticesFor, noticeEmail, noticeWords } from "../src/lib/notify.js";
import { cleanBio as cleanBioLib, outcomes, answerProposal } from "../src/lib/bio.js";
import { cleanBio } from "../src/staff-settings.js";
import { hit, isLive, referrerHost } from "../src/analytics.js";

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
  // organization lock itself out while believing it had not.
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
  // Asserted by behavior, not by variable name — the derivation moved into
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
// branch is built to run. Weak on auth, exact on behavior.
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

/* ---------------------------------------------------------------------------
   REASSIGNING A MINISTRY TO A DIFFERENT PERSON

   The partner card showed `member_count` and nothing else — "1 members", no
   names, nothing to click. So a ministry attached to the wrong account looked
   exactly like one attached to the right account, and the only control was a
   row of chips on the People page that always sent partner_role: 'view'.
   Changing somebody's capacity was therefore impossible: admin_partner_grant
   was INSERT OR IGNORE, so re-granting did nothing at all.
--------------------------------------------------------------------------- */

await check("granting an EXISTING member changes their role rather than doing nothing", async () => {
  /* INSERT OR IGNORE is what made "change who runs this ministry" unreachable:
     the row already existed, so every attempt was silently a no-op. */
  const sql = QUERIES.admin_partner_grant;
  assert(!/INSERT\s+OR\s+IGNORE/i.test(sql),
    "admin_partner_grant still ignores conflicts — changing a role is a no-op");
  assert(/ON CONFLICT\s*\(\s*partner_id\s*,\s*user_id\s*\)\s*DO UPDATE/i.test(sql),
    "no upsert on (partner_id, user_id) — re-granting cannot change the role");
  assert(/SET[\s\S]*role\s*=\s*excluded\.role/i.test(sql),
    "the upsert does not actually update the role");
});

await check("the member list carries names, not just a count", async () => {
  const sql = QUERIES.admin_partner_members;
  assert(sql, "admin_partner_members does not exist");
  assert(/JOIN\s+users\b/i.test(sql), "no join to users — the card cannot show a name");
  for (const col of ["partner_id", "user_id", "role"]) {
    assert(new RegExp(`\\b${col}\\b`).test(sql), `the list omits ${col}`);
  }
  assert(/u\.name/.test(sql) && /u\.email/.test(sql),
    "a member has to be recognisable by name and address, not by id");
});

await check("the partner card is fed members, not just a member_count", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8"));
  assert(/function listPartners/.test(src), "no listPartners helper");
  assert(src.includes("admin_partner_members"),
    "admin.js never runs the member query — the card would still show a bare count");
  /* Every place that returns partners must go through the helper. One raw
     `admin_partners` left behind is a screen whose cards silently lose their
     members after whichever action returns it. */
  const raw = src.split("\n").filter((l) =>
    l.includes('db.query("admin_partners"') && !l.includes("// "));
  assert(raw.length === 1,
    `${raw.length} places still query admin_partners directly — only listPartners should`);
});

await check("the console can pick a capacity, not just hardcode 'view'", async () => {
  const ui = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../src/js/admin.js", import.meta.url), "utf8"));
  assert(/PARTNER_ROLES\s*=\s*\[/.test(ui), "the console offers no list of capacities");
  assert(/data-member-role/.test(ui), "no role picker on the partner card");
  assert(/data-member-add/.test(ui), "no way to attach somebody from the partner card");
  assert(/data-member-off/.test(ui), "no way to detach somebody from the partner card");
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

await check("owning a ministry switches the Partner role on; losing the last switches it off", async () => {
  const run = async (members, wasOwner) => {
    const done = [];
    const db = { query: async (name, p) => {
      if (name === "admin_partner_members") return members;
      done.push(name + ":" + p.role); return [];
    } };
    await syncPartnerRole(db, "u_1", "u_admin", "now", wasOwner);
    return done;
  };
  eq(await run([{ user_id: "u_1", partner_id: "p_1", role: "owner" }], false), ["admin_role_grant:partner"], "made an owner");
  eq(await run([{ user_id: "u_1", partner_id: "p_1", role: "view" }], false), [], "a helper changes nothing");
  eq(await run([], true), ["admin_role_revoke:partner"], "lost the last ministry they owned");
  eq(await run([{ user_id: "u_1", partner_id: "p_2", role: "owner" }], true), ["admin_role_grant:partner"], "still owns another");
  const src = fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert(/role: "owner", granted_by: grantedBy, now,\s*\}\);\s*await syncPartnerRole/.test(src), "a ministry made for somebody makes them a partner");
});

await check("a new ministry holds its site address at once, and a failure there never stops it", async () => {
  const src = fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  assert(/try \{ await siteRow\(db, \{ id: pid, display_name: name, slug \}, now\); \}\s*catch/.test(src),
    "makePartner does not make the site row, or a site failure would undo the partner");
  const { subdomainFrom } = await import("../src/site/model.js");
  eq(subdomainFrom("Chase Roush"), "chaseroush", "firstnamelastname, no hyphen");
});

await check("an address the contact form uses is not called unused", async () => {
  const q = QUERIES.admin_sender_addresses;
  assert(/FROM contact_forms f\s+WHERE lower\(f\.from_address\) = lower\(sa\.address\)\) AS form_sends/.test(q), "the form's sender is not counted");
  assert(/contact_topics t[\s\S]*AS form_receives/.test(q), "where the form delivers is not counted");
  const js = fs.readFileSync(new URL("../../src/js/admin.js", import.meta.url), "utf8");
  assert(/a\.form_sends\) uses\.push/.test(js) && /a\.form_receives\) uses\.push/.test(js), "the card does not show it");
});

await check("an accepted invitation emails each administrator who has not switched it off (0056)", async () => {
  const admins = [
    { user_id: "u_a", name: "A", email: "a@x.org", preferred_lang: "hr" },
    { user_id: "u_b", name: "B", email: "b@x.org", preferred_lang: "en" },
  ];
  const db = (prefs) => ({ query: async (name, p) => {
    if (name === "notify_role_holders") { eq(p.role, "admin", "asked for administrators"); return admins; }
    if (name === "notify_prefs_for_user") {
      if (prefs === null) throw new Error("no such table: notify_prefs");
      return prefs[p.user_id] || [];
    }
    if (name === "notice_add") { bells.push(p); if (prefs === null) throw new Error("no such table: notices"); return []; }
    throw new Error("unexpected " + name);
  } });
  const bells = [];
  const sent = [];
  const send = async (env, m) => { sent.push(m); return { ok: true }; };
  const r = await notify({}, db({ u_b: [{ kind: "invite_accepted", is_on: 0 }] }), "invite_accepted",
    { name: "Ana <x>", email: "ana@x.org" }, { origin: "https://dev.thauma.one", send });
  eq([r.sent, sent.map((m) => m.to)], [1, ["a@x.org"]], "B switched it off");
  assert(/pozivnica prihvaćena/.test(sent[0].subject), "not in A's language: " + sent[0].subject);
  assert(sent[0].html.includes("Ana &lt;x&gt;") && !sent[0].html.includes("Ana <x>"), "the name is not escaped");
  assert(sent[0].html.includes("https://dev.thauma.one/admin/users/"), "no link to People");
  /* the bell (0060): its own switch, starting as the notice does — B's email
     is off, B's bell is not */
  eq(bells.map((b) => [b.user_id, b.kind, b.link]), [["u_a", "invite_accepted", "/admin/users/"], ["u_b", "invite_accepted", "/admin/users/"]], "a bell row each");
  eq(JSON.parse(bells[0].vars), { name: "Ana <x>", email: "ana@x.org" }, "the words' values, kept raw and escaped when shown");
  bells.length = 0;
  await notify({}, db({ u_a: [{ kind: "bell:invite_accepted", is_on: 0 }] }), "invite_accepted", { name: "N", email: "e" }, { send });
  eq(bells.map((b) => b.user_id), ["u_b"], "A switched the bell off");

  sent.length = 0;
  await notify({}, db(null), "invite_accepted", { name: "Ana", email: "ana@x.org" }, { send });
  eq(sent.length, 2, "no table yet: everyone gets the starting value (on)");

  const failing = { query: async () => { throw new Error("down"); } };
  eq((await notify({}, failing, "invite_accepted", {}, { send })).sent, 0, "a failure is swallowed, not thrown");
  assert(/role = :role[\s\S]*status = 'active'[\s\S]*protected/.test(QUERIES.notify_role_holders), "inactive or master accounts could be mailed");
});

await check("a person's own bio changes: cleaned, only known languages, waiting rather than live (0058)", async () => {
  const out = cleanBio({ region: "  KC\u0007 ", text: { en: { role_title: "T".repeat(300), bio: "b" }, xx: { bio: "no" }, hr: "nope" } }, new Set(["en", "hr"]));
  eq(Object.keys(out.text), ["en"], "an unknown language or a bad shape is dropped");
  eq([out.region, out.text.en.role_title.length], ["KC", 120], "trimmed and clamped");
  const set = fs.readFileSync(new URL("../src/staff-settings.js", import.meta.url), "utf8");
  assert(/profile_proposal_set/.test(set) && !/staff_profile_translation_upsert/.test(set), "Settings writes the live bio, not a proposal");
  assert(/notify\(env, db, "profile_proposed"/.test(set), "administrators are not told");
  const prof = fs.readFileSync(new URL("../src/admin-profile.js", import.meta.url), "utf8");
  assert(/if \(body\.clear_proposal\) \{[\s\S]{0,700}answerProposal\(env, db, \{ userId,[\s\S]{0,120}was: current \? liveBio\(current\)/.test(prof),
    "a save does not answer what was waiting against the page as it was before");
  assert(/decline-proposal[\s\S]{0,600}answerProposal\(env, db, \{ userId,[\s\S]{0,120}was, kept: was/.test(prof), "a decline of everything is not answered");
  assert(/action === "decline-proposal"/.test(prof), "no way to decline");
});

await check("a whole bio may be sent: email and photos, but only the person's own pictures (0058)", async () => {
  /* Chase, 2026-10-13: "The partner can edit their whole bio, including the
     photo and email contact. Since it has to be approved." */
  const live = { photo: "/img/team/chase.webp", bio_photo: "", photo_master: "", bio_photo_master: "" };
  const out = cleanBioLib({ public_email: "not an address", photo: "https://evil.example/x.png", bio_photo: "/media/team/me-bio_photo-ab12.webp",
                            bio_photo_aspect: 9, text: {} }, new Set(["en"]), live);
  eq([out.public_email, out.photo, out.bio_photo, out.bio_photo_aspect], ["", "/img/team/chase.webp", "/media/team/me-bio_photo-ab12.webp", 2.5],
     "a bad address dropped, a foreign picture refused (the page's own kept), an upload of theirs kept, the shape clamped");
  eq(cleanBioLib({ photo: "/img/team/chase.webp" }, new Set(), live).photo, "/img/team/chase.webp", "the photo already there may stay");
  /* each part's outcome, read from what was sent, what was there, what was saved */
  const was = { region: "KC", public_email: "a@x.org", photo: "/a", bio_photo: "", text: { en: { role_title: "T", bio: "Five" } } };
  const sentB = { region: "Zagreb", public_email: "b@x.org", photo: "/b", bio_photo: "", text: { en: { role_title: "T ", bio: "Six" } } };
  const keptB = { region: "Zagreb, Croatia", public_email: "a@x.org", photo: "/b", bio_photo: "", text: { en: { role_title: "T", bio: "Six" } } };
  eq(Object.fromEntries(Object.entries(outcomes(sentB, was, keptB)).map(([k, v]) => [k, v.result])),
     { region: "edited", public_email: "declined", photo: "approved", "text.en.bio": "approved" },
     "edited, declined and approved told apart; an unchanged part (the title, but for a space) is not a change");
  eq(Object.keys(outcomes({ region: "X", text: {} }, was, was)), ["region"], "a proposal from before email and photos could be sent has no such parts");
  const media = fs.readFileSync(new URL("../src/media.js", import.meta.url), "utf8");
  assert(/owner !== me\.user_id && !roles\.includes\("admin"\)/.test(media), "anybody may upload a team photo for somebody else");
});

await check("an answer to a bio, part by part, is kept for the person and told to them (0058)", async () => {
  /* "The admin needs the ability to edit though, then it can be published
     and notify the changes back to the staff member. Even a notification if
     it was approved or declined is good." Then: "approve, edit, or decline
     individual aspects of the staff bio edits, all communicating back to the
     staff member." */
  const was = { region: "KC", public_email: "a@x.org", photo: "", bio_photo: "", text: { en: { role_title: "Founder", bio: "Five years." } } };
  const sent = { region: "Zagreb", public_email: "b@x.org", photo: "", bio_photo: "", text: { en: { role_title: "Founder", bio: "Six years here." } } };
  const rows = {};
  const put = () => { rows.u_1 = { user_id: "u_1", payload: JSON.stringify(sent), submitted_at: "2026-10-13T10:00:00Z" }; };
  const bells = [];
  const db = { query: async (name, p) => {
    if (name === "profile_proposal_set") { rows[p.user_id] = { user_id: p.user_id, payload: p.payload, submitted_at: p.now }; return []; }
    if (name === "notify_prefs_for_user") return [];
    if (name === "notice_add") { bells.push(p); return []; }
    throw new Error("unexpected " + name);
  }, queryOne: async (name, p) => {
    if (name === "profile_proposal_get") return rows[p.user_id] || null;
    if (name === "notify_person") return { user_id: p.user_id, email: "ana@x.org", preferred_lang: "en" };
    throw new Error("unexpected " + name);
  } };
  const env = {};   // no mail key: nothing leaves the test
  const by = "Chase Roush", origin = "https://dev.thauma.one";

  put();
  const kept = { ...sent, region: "Zagreb, Croatia", public_email: "a@x.org", text: { en: { role_title: "Founder", bio: "Six years here." } } };
  const r = await answerProposal(env, db, { userId: "u_1", by, note: "Kept your old address", was, kept, origin });
  eq([r.answered, r.status, r.edited], [true, "partly", true], "some approved, one changed, one not");
  const d = JSON.parse(rows.u_1.payload).decision;
  eq(Object.fromEntries(Object.entries(d.parts).map(([k, v]) => [k, v.result])),
     { region: "edited", public_email: "declined", "text.en.bio": "approved" }, "each part's outcome, kept for them");
  eq([d.parts.region.kept, d.by, d.note], ["Zagreb, Croatia", by, "Kept your old address"], "what was saved, by whom, the note");
  eq([bells[0].user_id, bells[0].kind, bells[0].link], ["u_1", "profile_approved", "/staff/settings/#bio"], "told in the bell, linking to Your bio");
  eq(JSON.parse(bells[0].vars), { by, _v: "partly", note: "Kept your old address" }, "worded as partly answered");
  eq((await answerProposal(env, db, { userId: "u_1", by, was, kept, origin })).answered, false, "answered twice");

  put(); bells.length = 0;
  eq((await answerProposal(env, db, { userId: "u_1", by, was, kept: was, origin })).status, "declined", "nothing kept: declined");
  eq(bells[0].kind, "profile_declined", "told it was declined");
  put(); bells.length = 0;
  eq((await answerProposal(env, db, { userId: "u_1", by, was, kept: sent, origin })).status, "approved", "all as sent: approved");
  eq(JSON.parse(bells[0].vars), { by }, "plain approval, no variant");

  const w = noticeWords("profile_approved", "en", { by: "<Chase>", _v: "edited", note: "Tidied it" });
  assert(/&lt;Chase&gt;<\/b> approved[\s\S]*changes of their own/.test(w.body) && w.note === "Tidied it", "words: " + JSON.stringify(w));
  assert(noticeWords("profile_declined", "hr", { by: "C", _v: "nonsense" }).body.startsWith("<b>C</b>: izmjene"), "an unknown wording does not fall back to the plain one");
  const partly = noticeEmail("profile_approved", { lang: "en", by: "C", _v: "partly", origin, link: "/staff/settings/#bio" });
  assert(/answered/.test(partly.subject) && /some are approved, some are not/.test(partly.html), "partly is not worded as partly: " + partly.subject);
  const mail = noticeEmail("profile_declined", { lang: "sr", by: "C", note: "Не сада", origin: "https://thauma.one", link: "/staff/settings/#bio" });
  assert(/нису одобрене/.test(mail.subject) && /Не сада/.test(mail.html) && /Не сада/.test(mail.text), "the email has no note, or not in Serbian");
});

await check("a visit is counted without knowing who: thin, real sites told apart, bots and junk ignored (0059)", async () => {
  const env = { SITE_DOMAIN: "thauma.one" };
  eq([isLive("thauma.one", env), isLive("www.thauma.one", env), isLive("chaseroush.thauma.one", env),
      isLive("dev.thauma.one", env), isLive("next.thauma.one", env), isLive("127.0.0.1", env)],
     [true, true, true, false, false, false], "live or not");
  eq([referrerHost("https://www.google.com/search?q=x", "thauma.one"), referrerHost("https://thauma.one/en/", "thauma.one"), referrerHost("", "thauma.one")],
     ["google.com", null, null], "a referrer is a host, never our own, never the full address");
  const rows = [];
  const DB = { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { rows.push({ sql, a }); return {}; },
    all: async () => { rows.push({ sql, a }); return { results: /partner_sites/.test(sql) ? [{ partner_id: "p_1" }] : [] }; } }) }) };
  const post = (body, ua = "Mozilla/5.0 Safari", host = "thauma.one") => {
    const r = new Request("https://" + host + "/api/hit", { method: "POST", headers: { "User-Agent": ua }, body: JSON.stringify(body) });
    Object.defineProperty(r, "cf", { value: { country: "HR" } });
    return hit.fetch(r, { DB, SITE_DOMAIN: "thauma.one" });
  };
  eq((await post({ p: "/en/?q=secret", s: "abcdef0123456789", r: "https://x.org/a?b", l: "en", w: 390 })).status, 204, "answered with nothing");
  const ins = rows.find((r) => /INSERT INTO page_hits/.test(r.sql));
  assert(ins && ins.a.includes("thauma") && ins.a.includes("/en/") && ins.a.includes("HR") && ins.a.includes("x.org") && ins.a.includes("phone"),
    "what was kept: " + JSON.stringify(ins && ins.a));
  assert(!ins.a.some((v) => /secret|\?b/.test(String(v))), "a query string was kept");
  rows.length = 0;
  await post({ p: "/", s: "abcdef0123456789" }, "Googlebot/2.1");
  await post({ p: "/", s: "short" });
  await post({ p: "nope", s: "abcdef0123456789" });
  assert(!rows.some((r) => /INSERT/.test(r.sql)), "a bot, a bad id or a bad path was counted");
  await post({ p: "/en/", s: "abcdef0123456789", x: "chaseroush" }, undefined, "chaseroush.thauma.one");
  assert(rows.find((r) => /INSERT/.test(r.sql)).a.includes("p_1"), "a partner site's visit is its own");
  const page = fs.readFileSync(new URL("../../src/js/main.js", import.meta.url), "utf8");
  assert(/doNotTrack[\s\S]{0,120}globalPrivacyControl/.test(page) && /sendBeacon\('\/api\/hit'/.test(page), "thauma.one does not count, or does not respect Do Not Track");
});

await check("Settings offers a notice only to the roles that receive it", async () => {
  const db = { query: async () => [{ kind: "invite_accepted", is_on: 0 }] };
  eq(await noticesFor(db, "u_1", ["admin", "staff"]), [{ kind: "invite_accepted", on: false, bell: true }, { kind: "profile_proposed", on: true, bell: true }], "an administrator: one switched off by email, the bell at its start");
  eq(await noticesFor(db, "u_1", ["staff"]), [], "staff do not get administrators' notices");
  eq((await noticesFor(db, "u_1", ["staff"], { self: true })).map((n) => n.kind), ["profile_approved", "profile_declined"], "the answers to your own bio, when you have one");
  const words = noticeEmail("invite_accepted", { lang: "sr", name: "N", email: "e" });
  assert(/Позивница/.test(words.html) && !/notify\./.test(words.html + words.subject), "a key showed instead of words");
  const src = fs.readFileSync(new URL("../src/confirm-account.js", import.meta.url), "utf8");
  assert(/user_confirm[\s\S]{0,400}notify\(env, db, "invite_accepted"[\s\S]{0,200}\.catch\(/.test(src),
    "confirming does not notify, or a failed notice could fail the confirmation");
});

await check("the five roles are exactly what the schema allows, and People can grant each", async () => {
  /* Communications since 0015 in the schema; grantable since 2026-10-13. */
  const src = fs.readFileSync(new URL("../src/admin.js", import.meta.url), "utf8");
  const schema = fs.readFileSync(new URL("../../db/migrations/0015_mailing.sql", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../../src/js/admin.js", import.meta.url), "utf8");
  const roles = (src.match(/const ROLES = new Set\(\[([^\]]*)\]\)/) || [])[1] || "";
  const all = (page.match(/var ALL_ROLES = \[([^\]]*)\]/) || [])[1] || "";
  for (const r of ["admin", "partner", "staff", "board", "communications"]) {
    assert(roles.includes(`"${r}"`), `handler does not allow ${r}`);
    assert(schema.includes(`'${r}'`), `schema does not allow ${r}`);
    assert(all.includes(`'${r}'`), `People has no switch for ${r}`);
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
