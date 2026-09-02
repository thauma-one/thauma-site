/**
 * admin.js — organisation administration
 *
 *   GET    /api/admin                 users, partners, languages, recent audit
 *   POST   /api/admin                 create a user
 *   PATCH  /api/admin                 change one thing (roles, access, status…)
 *   DELETE /api/admin?id=…            remove a user
 *
 * THE ROLE CHECK IS THE WHOLE SECURITY MODEL HERE
 * ---------------------------------------------------------------------------
 * Every other endpoint in this Worker is partner-scoped: whatever it returns,
 * it returns for ONE partner, and a bug leaks that partner's data to somebody
 * who already had a grant to it. Nothing here is scoped. These queries reach
 * every user, every partner and the whole audit log by design.
 *
 * So the guard is done once, at the very top, before anything is read — and it
 * fails closed. There is no branch that runs before it, and no operation that
 * re-checks in its own way.
 *
 * WHAT AN ADMIN STILL CANNOT DO
 * ---------------------------------------------------------------------------
 * Read a partner's supporters. That needs a partner_users grant, which an
 * admin can give themselves — but doing so is an explicit act that lands in
 * audit_log with their name on it. "I can fix anything" stays true; "I have
 * standing access to everyone's supporters" does not.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { sendMail, inviteEmail } from "./lib/mail.js";
import { requestedTarget } from "./lib/actas.js";

const ROLES = new Set(["admin", "partner", "staff", "board"]);
const STATUSES = new Set(["invited", "active", "suspended"]);
const PARTNER_ROLES = new Set(["owner", "assist", "view"]);

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};

/** Resolve the caller, and refuse anyone who is not an administrator. */
async function requireAdmin(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);

  /* Identity, NOT partner access. This used partners_for_user, which requires
     a partner_users row — so an administrator with no partner grant was locked
     out of administration entirely. Deleting a partner could do it, and did.

     Administering the organisation has nothing to do with belonging to one of
     its ministries. */
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return {
      denied: json({
        error: "This address is not an active account.",
        email: user.email,
      }, 403),
    };
  }
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.includes("admin")) {
    return {
      denied: json({
        error: "Administration is limited to administrators.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me, roles };
}

/** Append to the record. A failed note must not fail the action it describes. */
async function audit(db, { user, action, entity, entity_id = null, detail = null, partner_id = null }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id,
      action, entity, entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/**
 * Send somebody their invite.
 *
 * The link is built from the REQUEST's own origin, not from a configured URL,
 * so an invite sent from the staging console points at staging and one sent
 * from production points at production. A hard-coded site URL is how a test
 * invite ends up telling somebody to sign in to the live site.
 */
async function sendInvite(request, env, { to, name, byName, byEmail }) {
  const origin = new URL(request.url).origin;
  const mail = inviteEmail({ name, origin, invitedBy: byName, invitedByEmail: byEmail });
  return await sendMail(env, {
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    // Replies go to the administrator who added them, not into a noreply void.
    // "I cannot get in" is the most likely reply and it needs to reach a human.
    replyTo: byEmail,
  });
}

/**
 * Who this administrator is currently viewing, for the banner only.
 *
 * Display, never authority. `requireAdmin` above resolves the REAL caller and
 * pays no attention to the cookie, which is what makes administration
 * unaffected by acting-as.
 */
async function actingInfo(db, request) {
  const id = requestedTarget(request);
  if (!id) return null;
  const row = await db.queryOne("user_by_id", { id });
  if (!row) return null;
  // Same shape as withActing() and admin-actas — including the language, or
  // the admin area would render in a different language from the console.
  return {
    id: row.user_id,
    name: row.user_name || row.email,
    lang: row.preferred_lang || "en",
  };
}

/**
 * Is this the account that cannot be removed?
 *
 * The DATABASE refuses this too — see 0026_protected_account.sql — and that is
 * the guarantee. This exists so the refusal reads as a sentence rather than
 * arriving as "SQLITE_CONSTRAINT" through an error path written for something
 * else. Two layers, and only the lower one is load-bearing.
 */
async function isProtected(db, userId) {
  const users = await db.query("admin_users", {});
  const u = users.find((x) => x.id === userId);
  return !!(u && u.protected);
}

const PROTECTED_MSG =
  "That account is protected: it is the one that can always get back in. " +
  "Removing or suspending it would need a database migration, on purpose.";

/** Would this change leave the organisation with no administrator? */
async function wouldStrandOrg(db, { userId, removingRole, removingUser }) {
  if (removingRole && removingRole !== "admin" && !removingUser) return false;
  const row = await db.queryOne("admin_count_admins", {});
  const admins = row ? row.n : 0;
  if (admins > 1) return false;

  // One admin left — is it this person?
  const users = await db.query("admin_users", {});
  const target = users.find((u) => u.id === userId);
  if (!target) return false;
  const targetRoles = String(target.roles || "").split(",").filter(Boolean);
  return targetRoles.includes("admin") && target.status === "active";
}

/**
 * Create a partner and, optionally, hand it to somebody.
 *
 * Shared by the Partner role switch and the Partners page, so the two cannot
 * drift into making different things.
 */
async function makePartner(db, { displayName, forUser, grantedBy, now, user }) {
  const name = String(displayName || "").trim().slice(0, 200);
  if (!name) return null;

  // Derived, never typed: it lands in URLs and API payloads, and a slug
  // somebody entered by hand has to be lived with.
  const slug = name.toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (!slug) return null;

  const pid = "p_" + slug.replace(/-/g, "_").slice(0, 40);
  try {
    await db.query("admin_partner_create", { id: pid, slug, display_name: name, now });
  } catch (e) {
    return null; // already exists — the caller decides whether that matters
  }

  // Every language the organisation offers, switched OFF except English. A new
  // partner publishing three languages on day one promises translations nobody
  // has written.
  const langs = await db.query("languages_all", {});
  for (const l of langs) {
    await db.query("partner_language_set", {
      partner_id: pid, lang: l.code,
      is_enabled: l.code === "en" ? 1 : 0,
      sort_order: l.sort_order,
    });
  }

  if (forUser) {
    await db.query("admin_partner_grant", {
      partner_id: pid, user_id: forUser, role: "owner", granted_by: grantedBy, now,
    });
  }
  if (user) {
    await audit(db, { user, action: "create", entity: "partner", entity_id: pid,
                      partner_id: pid, detail: { display_name: name } });
  }
  return { id: pid, display_name: name };
}

/* ---------------------------------------------------------------- SENDERS
 * Which addresses a partner may send from.
 *
 * A typed sender is unsafe in a way that stays invisible until it matters.
 * Resend verifies DOMAINS, not addresses: once a domain is verified, EVERY
 * address at it sends — including one with a typo. `nesw@chase-roush…` leaves
 * successfully, appears correct in the log, and every reply to it falls into
 * nothing. Nobody finds out until somebody says "I wrote back and never heard".
 *
 * So the addresses become a list, maintained here, and chosen from elsewhere.
 * A chosen address cannot be mistyped.
 */

/* What every new partner gets, so nobody has to invent a scheme per ministry.
   The local parts are generic and the DOMAIN carries the identity — that is
   what makes reputation isolation work, and it means `news@` reads the same
   for everybody.

   `can_receive` is what an alias would have to be created for. Left off where
   nobody should be replying, and ON where a reply is the whole point: the
   difference is not cosmetic, because a list pointing its replies at an
   address with no mailbox loses them silently. */
export const STANDARD_SENDERS = [
  { local: "news",    label: "Newsletter",     can_receive: 0 },
  { local: "prayer",  label: "Prayer updates", can_receive: 0 },
  { local: "contact", label: "Contact form",   can_receive: 1 },
  { local: "connect", label: "Connect",        can_receive: 1 },
];

/* The organisation's own domain, read from the address the Worker already
   sends as rather than configured twice. Two places to state it is one place
   to forget when it moves — which it just did, from mail.thauma.one. */
export function orgDomain(env) {
  const m = /@([^\s>]+)/.exec(String(env.MAIL_FROM || ""));
  return m ? m[1].toLowerCase() : "thauma.one";
}

/* NULL partner_id is the organisation, the same convention the mailing tables
   use. Returns null when a partner has no domain yet, which is honest: until
   somebody verifies one, there is no address that could work. */
function domainFor(partner, env) {
  return partner ? (partner.sending_domain || null) : orgDomain(env);
}

/* An address at a domain nobody verified is refused HERE rather than on the
   first send, because the first send is a newsletter going to real people and
   the failure would be discovered by its absence. */
export function senderProblem(address, domain) {
  if (!domain) {
    return "Set this partner's sending domain first — an address at an " +
           "unverified domain looks fine and sends nothing.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) {
    return "That is not a valid email address.";
  }
  if (address.split("@")[1].toLowerCase() !== domain.toLowerCase()) {
    return `Addresses have to be at ${domain}. Anything else is not verified ` +
           `with the mail provider and would not send.`;
  }
  return null;
}

export default {
  async fetch(request, env) {
    const { db, user, me, denied } = await requireAdmin(request, env);
    if (denied) return denied;

    const now = new Date().toISOString();
    const url = new URL(request.url);

    /* ---------------------------------------------------------------- GET */
    if (request.method === "GET") {
      const [users, partners, languages, recent, profiles] = await Promise.all([
        db.query("admin_users", {}),
        db.query("admin_partners", {}),
        db.query("languages_all", {}),
        db.query("admin_audit_recent", { limit: 40 }),
        // Fetched WITH the people rather than per row: the People page sorts
        // by region and role title, and a sort cannot wait on 40 requests.
        db.query("staff_profiles_all", {}),
      ]);
      // Every sender in the system. Org-wide by design, like the partner list
      // itself — maintaining them IS the administrative act.
      const senders = await db.query("admin_sender_addresses", {});
      // What each partner would take with it. Fetched with the list rather
      // than on click, so the confirmation can show real numbers the moment
      // it opens.
      const stats = {};
      for (const p of partners) {
        stats[p.id] = await db.queryOne("admin_partner_stats", { partner_id: p.id });
      }

      return json({
        // id included so the People list can tell which row is YOU and
        // not offer "view as" on your own account.
        /* EVERY role this account holds, not the one that got it in here.
           This said `roles: ["admin"]` — true as far as authorisation goes,
           since requireAdmin has already established it, but this is an
           IDENTITY payload and other things read it. The console header uses
           it to decide which navigation rows you get, so an administrator who
           is also a partner saw the staff row painted from cache, then removed
           the moment this landed: it flashed on every admin page they opened.
           Same expression as staff-data.js, so both consoles agree about who
           somebody is. */
        you: { id: me.user_id, email: user.email, name: me.user_name || null,
               roles: String(me.roles || "").split(",").filter(Boolean) },

        /* The banner belongs on THESE pages too. Administration is always
           performed as yourself — requireAdmin deliberately ignores the
           acting cookie — but the cookie is still set, and every staff screen
           is still showing somebody else's data. An admin page that quietly
           dropped the banner would read as "I have stopped viewing them",
           which is the one thing it must not say while the cookie lives. */
        acting: await actingInfo(db, request),
        partner_stats: stats,
        users: users.map((u) => ({
          ...u,
          roles: String(u.roles || "").split(",").filter(Boolean),
          partner_ids: String(u.partner_ids || "").split(",").filter(Boolean),
          partner_names: String(u.partner_names || "").split(" | ").filter(Boolean),
        })),
        partners,
        senders,
        /* Stated by the server rather than hard-coded in the console, so the
           two cannot disagree about what an address is allowed to look like
           after a domain moves. */
        org_domain: orgDomain(env),
        standard_senders: STANDARD_SENDERS,
        languages,
        /* FETCHED AND THEN NOT RETURNED, until 2026-08-21. The query ran on
           every request, the rows came back, and the destructuring named
           them — and the response never carried them. So the console's
           state.profiles was permanently undefined and every Staff page field
           rendered blank, on top of real data sitting in the table.
           A value that is computed and dropped costs the same as one that is
           used and looks identical in every log. */
        profiles,
        audit: recent,
      });
    }

    /* --------------------------------------------------------------- POST */
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      /* ---- a partner ----
         Asked for because granting somebody the staff role did not make one
         appear, which is correct and was invisible: a ROLE says what a person
         may do, a PARTNER is the ministry whose supporters and goals they
         manage. Sending a new person means creating both and joining them. */
      if (body.kind === "partner") {
        const made = await makePartner(db, {
          displayName: body.display_name,
          forUser: str(body.user_id, 64),
          grantedBy: me.user_id, now, user,
        });
        if (!made) {
          return json({
            error: "Could not create that partner — the name may already be in " +
                   "use, or have no letters or digits in it.",
          }, 409);
        }
        return json({
          created: made.id,
          partners: await db.query("admin_partners", {}),
          users: await listUsers(db),
        });
      }

      /* ---- an address a partner may send from ---- */
      if (body.kind === "sender") {
        const pid = str(body.partner_id, 64) || null;
        const partners = await db.query("admin_partners", {});
        const partner = pid ? partners.find((x) => x.id === pid) : null;
        if (pid && !partner) return json({ error: "No such partner" }, 404);

        const domain = domainFor(partner, env);
        const address = str(body.address, 200).toLowerCase();
        const problem = senderProblem(address, domain);
        if (problem) return json({ error: problem }, 400);

        try {
          await db.query("admin_sender_address_add", {
            id: "sa_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16),
            partner_id: pid, address,
            label: str(body.label, 80) || null,
            can_receive: body.can_receive ? 1 : 0, now,
          });
        } catch (e) {
          return json({ error: "That address is already on the list." }, 409);
        }
        await audit(db, { user, action: "create", entity: "sender_address",
                          entity_id: address, partner_id: pid,
                          detail: { label: str(body.label, 80) || null } });
        return json({ senders: await db.query("admin_sender_addresses", {}),
                      partners: await db.query("admin_partners", {}) });
      }

      /* ---- the standard set, in one go ----
         Four addresses typed by hand is four chances to typo the domain, and
         the scheme is the same for everybody by design. Existing ones are
         skipped rather than refused, so this is safe to press twice and can
         also be used to fill a gap after one was deleted. */
      if (body.kind === "sender_defaults") {
        const pid = str(body.partner_id, 64) || null;
        const partners = await db.query("admin_partners", {});
        const partner = pid ? partners.find((x) => x.id === pid) : null;
        if (pid && !partner) return json({ error: "No such partner" }, 404);

        const domain = domainFor(partner, env);
        if (!domain) {
          return json({ error: senderProblem("x@y.invalid", null) }, 400);
        }

        const added = [];
        for (const d of STANDARD_SENDERS) {
          const address = `${d.local}@${domain}`.toLowerCase();
          try {
            await db.query("admin_sender_address_add", {
              id: "sa_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16),
              partner_id: pid, address, label: d.label,
              can_receive: d.can_receive, now,
            });
            added.push(address);
          } catch (e) { /* already there — the point of pressing this again */ }
        }
        if (added.length) {
          await audit(db, { user, action: "create", entity: "sender_address",
                            entity_id: domain, partner_id: pid,
                            detail: { added } });
        }
        return json({ added, senders: await db.query("admin_sender_addresses", {}),
                      partners: await db.query("admin_partners", {}) });
      }

      const email = str(body.email, 200);
      const name = str(body.name, 200);
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return json({ error: "A valid email address is required" }, 400);
      }
      if (!name) return json({ error: "A name is required" }, 400);

      const id = "u_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      try {
        await db.query("admin_user_create", { id, email, name, now });
      } catch (e) {
        // users.email is UNIQUE COLLATE NOCASE.
        return json({ error: "Somebody already has that email address." }, 409);
      }
      await db.query("admin_role_grant", {
        user_id: id, role: "staff", granted_by: me.user_id, now,
      });
      /* The invite is sent AFTER the account exists and its failure does not
         undo anything. The account is the real thing; the email is a
         convenience, and "created, but the invite could not be sent" is a
         state an administrator can act on. Rolling back a person's account
         because Resend was briefly unhappy would be worse. */
      const invite = await sendInvite(request, env, {
        to: email, name, byName: me.user_name || user.email, byEmail: user.email,
      });

      await audit(db, { user, action: "create", entity: "user", entity_id: id,
                        detail: { email, name, invited: invite.ok,
                                  invite_error: invite.ok ? undefined : invite.error } });

      return json({
        created: id,
        invited: invite.ok,
        invite_error: invite.ok ? undefined : invite.error,
        // Said here because it is the thing people get wrong: a row in this
        // table is not an account. Access decides who can sign in.
        note: "Invited. They also need adding to Cloudflare Access, and their " +
              "status set to active, before they can sign in.",
        users: await listUsers(db),
      });
    }

    /* -------------------------------------------------------------- PATCH */
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);
      const userId = str(body.user_id, 64);

      /* ---- send the invite again ----
         Needed more often than it sounds: the first one fails while Resend is
         being set up, or lands in somebody's junk, or the address was wrong
         and has since been corrected. Without this the only remedy is deleting
         the person and creating them again, which loses their roles and their
         history. */
      /* ---- where this partner's mail comes from ----
         Typed, never derived. The domain has to be one somebody actually
         verified with the mail provider, and only they know which — a domain
         guessed from the slug would look entirely right and send nothing. */
      if (body.sending_domain !== undefined) {
        const pid = str(body.partner_id, 64);
        if (!pid) return json({ error: "partner_id is required" }, 400);
        const partners = await db.query("admin_partners", {});
        const partner = partners.find((x) => x.id === pid);
        if (!partner) return json({ error: "No such partner" }, 404);

        const domain = str(body.sending_domain, 200).toLowerCase()
          .replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim() || null;
        if (domain && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
          return json({ error: "That is not a domain name." }, 400);
        }

        /* THE ADDRESSES FOLLOW THE DOMAIN.
           This used to refuse the rename while any address existed, on the
           reasoning that moving somebody's from-address without telling them
           was worse than making them clear it out first. That was wrong in
           practice, and the way it was wrong is instructive: the only route
           through was to delete the addresses, which was ITSELF refused while
           a mailing list used them, and repointing the lists needed addresses
           at the new domain that could not be created until the rename went
           through. Three guards, each defensible alone, formed a loop with no
           exit. A correct typo — one dash — could not be corrected.

           So it cascades, and the CONSOLE says what will move before asking.
           A guard that only says no is an obstruction; the useful version says
           what will happen and lets somebody agree to it. */
        const moving = (await db.query("admin_sender_addresses", {}))
          .filter((a) => a.partner_id === pid);
        const renaming = partner.sending_domain && domain &&
                         domain !== partner.sending_domain && moving.length > 0;

        await db.query("admin_partner_set_domain", { id: pid, sending_domain: domain, now });

        const moved = [];
        if (renaming) {
          for (const a of moving) {
            const next = a.address.split("@")[0] + "@" + domain;
            if (next === a.address) continue;
            /* The list is repointed BEFORE the address row moves. If the two
               are done the other way round and the second fails, the lists are
               left pointing at an address that no longer exists — which sends
               nothing and shows nothing wrong. This order fails safe: the
               worst case is a list pointing at the new address slightly early,
               and the address arrives a moment later. */
            await db.query("admin_lists_repoint", { old: a.address, new: next, now });
            await db.query("admin_sender_readdress", { id: a.id, address: next });
            moved.push({ from: a.address, to: next });
          }
        }

        await audit(db, { user, action: "update", entity: "partner", entity_id: pid,
                          partner_id: pid,
                          detail: { sending_domain: domain, moved: moved.length || undefined } });
        return json({ moved,
                      partners: await db.query("admin_partners", {}),
                      senders: await db.query("admin_sender_addresses", {}) });
      }

      if (body.resend_invite) {
        if (!userId) return json({ error: "user_id is required" }, 400);
        const target = (await db.query("admin_users", {})).find((u) => u.id === userId);
        if (!target) return json({ error: "No such account." }, 404);

        const invite = await sendInvite(request, env, {
          to: target.email, name: target.name,
          byName: me.user_name || user.email, byEmail: user.email,
        });
        await audit(db, { user, action: "invite", entity: "user", entity_id: userId,
                          detail: { email: target.email, sent: invite.ok,
                                    error: invite.ok ? undefined : invite.error } });
        if (!invite.ok) return json({ error: invite.error }, 502);
        return json({ ok: true, invited: target.email, users: await listUsers(db) });
      }

      // ---- grant or revoke an org role ----
      if (body.role) {
        if (!ROLES.has(body.role)) return json({ error: "Unknown role" }, 400);
        if (!userId) return json({ error: "user_id is required" }, 400);

        if (!body.grant && body.role === "admin" && await isProtected(db, userId)) {
          return json({ error: PROTECTED_MSG }, 409);
        }
        if (!body.grant && await wouldStrandOrg(db, { userId, removingRole: body.role })) {
          return json({
            error: "That is the last active administrator. Appoint another " +
                   "before removing this one — the screen that grants roles is " +
                   "itself limited to administrators.",
          }, 409);
        }

        await db.query(body.grant ? "admin_role_grant" : "admin_role_revoke", {
          user_id: userId, role: body.role, granted_by: me.user_id, now,
        });
        await audit(db, { user, action: body.grant ? "grant" : "revoke",
                          entity: "user_role", entity_id: userId,
                          detail: { role: body.role } });

        /* GRANTING 'partner' CREATES THE MINISTRY.
           This is the piece that was missing: the role and the partner record
           were two separate acts, and nothing said so, so granting a role and
           waiting for a partner to appear did nothing at all. Now the switch
           does what it says — the person becomes a partner, which means they
           have one. */
        let createdPartner = null;
        if (body.grant && body.role === "partner") {
          const target = (await db.query("admin_users", {}))
            .find((u) => u.id === userId);
          const existing = await db.query("admin_partners", {});
          const already = String(target && target.partner_ids || "")
            .split(",").filter(Boolean);

          // Only if they do not already own one. Re-granting the role to
          // somebody who does should not mint a second ministry.
          const ownsOne = existing.some((p) => already.includes(p.id));
          if (target && !ownsOne) {
            createdPartner = await makePartner(db, {
              displayName: target.name, forUser: userId, grantedBy: me.user_id, now, user,
            });
          }
        }

        // Revoking it does NOT delete the partner. Supporters, goals and
        // milestones live there, and a toggle should never be able to destroy
        // them — removing a ministry is a separate, deliberate act.
        return json({
          users: await listUsers(db),
          partners: await db.query("admin_partners", {}),
          created_partner: createdPartner,
        });
      }

      // ---- grant or revoke access to a partner ----
      if (body.partner_id) {
        if (!userId) return json({ error: "user_id is required" }, 400);
        const partnerRole = PARTNER_ROLES.has(body.partner_role) ? body.partner_role : "view";

        await db.query(body.grant ? "admin_partner_grant" : "admin_partner_revoke", {
          partner_id: body.partner_id, user_id: userId,
          role: partnerRole, granted_by: me.user_id, now,
        });
        // Recorded against the PARTNER as well as the org, so it appears on
        // that partner's own Activity page. Somebody being given access to
        // their supporters is their business.
        await audit(db, { user, action: body.grant ? "grant" : "revoke",
                          entity: "partner_access", entity_id: userId,
                          partner_id: body.partner_id,
                          detail: { role: partnerRole } });
        return json({ users: await listUsers(db) });
      }

      // ---- name or status ----
      if (body.status !== undefined || body.name !== undefined) {
        if (!userId) return json({ error: "user_id is required" }, 400);
        const status = STATUSES.has(body.status) ? body.status : null;
        if (body.status !== undefined && !status) {
          return json({ error: "Unknown status" }, 400);
        }
        const users = await db.query("admin_users", {});
        const target = users.find((u) => u.id === userId);
        if (!target) return json({ error: "No such user" }, 404);

        /* Renaming it is fine; deactivating it is not. Checked here as well as
           in the trigger so the answer is a sentence rather than a constraint
           error surfacing through a path written for something else. */
        if (status && status !== "active" && target.protected) {
          return json({ error: PROTECTED_MSG }, 409);
        }

        if (status && status !== "active" &&
            await wouldStrandOrg(db, { userId, removingUser: true })) {
          return json({
            error: "That is the last active administrator. Appoint another first.",
          }, 409);
        }

        await db.query("admin_user_set", {
          id: userId,
          name: str(body.name, 200) || target.name,
          status: status || target.status,
        });
        await audit(db, { user, action: "update", entity: "user", entity_id: userId,
                          detail: { name: body.name, status } });
        return json({ users: await listUsers(db) });
      }

      // ---- a partner's own details ----
      if (body.for_partner && (body.partner_status || body.partner_name)) {
        const partners = await db.query("admin_partners", {});
        const target = partners.find((p) => p.id === body.for_partner);
        if (!target) return json({ error: "No such partner" }, 404);
        // The values the schema actually allows — checked rather than assumed.
        const status = ["prospective", "active", "on_leave", "alumni"]
          .includes(body.partner_status) ? body.partner_status : target.status;
        await db.query("admin_partner_set", {
          id: body.for_partner,
          display_name: str(body.partner_name, 200) || target.display_name,
          status, now,
        });
        await audit(db, { user, action: "update", entity: "partner",
                          entity_id: body.for_partner, partner_id: body.for_partner,
                          detail: { status } });
        return json({ partners: await db.query("admin_partners", {}) });
      }

      // ---- a partner's default language ----
      if (body.default_lang && body.for_partner) {
        const langs = await db.query("languages_all", {});
        if (!langs.some((l) => l.code === body.default_lang && l.is_active)) {
          return json({ error: "Unknown language" }, 400);
        }
        // The default must be a language that partner actually publishes, or
        // the fallback points at nothing.
        const enabled = await db.query("partner_languages_for_partner",
                                       { partner_id: body.for_partner });
        const target = enabled.find((l) => l.code === body.default_lang);
        if (!target || !target.is_enabled) {
          return json({
            error: `${body.default_lang.toUpperCase()} is not switched on for ` +
                   `that partner. Enable it first.`,
          }, 400);
        }
        await db.query("partner_set_default_lang", {
          partner_id: body.for_partner, lang: body.default_lang, now,
        });
        await audit(db, { user, action: "update", entity: "partner.default_lang",
                          entity_id: body.for_partner, partner_id: body.for_partner,
                          detail: { lang: body.default_lang } });
        return json({ partners: await db.query("admin_partners", {}) });
      }

      return json({ error: "Nothing to change" }, 400);
    }

    /* ------------------------------------------------------------- DELETE */
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id is required" }, 400);

      /* ---- an address, and what depended on it ----
         This used to refuse while any live list touched the address, which
         made it impossible to correct a mistyped domain: the lists could only
         be repointed at addresses that could not be created yet. Now it takes
         the dependents with it, and the console names them first.

         THE TWO DEPENDENCIES ARE NOT THE SAME and are not treated the same.
         A list that loses its SENDER cannot send at all, so it is archived —
         hidden and stopped, with its subscribers kept, because a person who
         agreed to be written to cannot be recreated and a double opt-in cannot
         be replayed. A list that loses its REPLY-TO carries on: an empty
         reply_to already means "replies go to the sender", so clearing it is
         the entire repair. Archiving a list over that would be destroying
         something to fix a setting that has a default. */
      if (url.searchParams.get("kind") === "sender") {
        const all = await db.query("admin_sender_addresses", {});
        const target = all.find((a) => a.id === id);
        if (!target) return json({ error: "No such address" }, 404);

        /* Checked on the SERVER, because a dialog is a suggestion — anything
           that can send a DELETE can skip the browser entirely. The console
           passes this only after showing what the cascade will do. */
        if (target.used_by > 0 && url.searchParams.get("cascade") !== "yes") {
          return json({
            error: `${target.address} is still used by ${target.used_by} ` +
                   `mailing list${target.used_by === 1 ? "" : "s"}. Deleting it ` +
                   `has to be confirmed from the Partners screen, which says ` +
                   `what happens to them.`,
          }, 409);
        }

        // Archive first: once the address row is gone there is no way to find
        // the lists that pointed at it.
        await db.query("admin_lists_archive_by_sender", { address: target.address, now });
        await db.query("admin_lists_drop_reply_to", { address: target.address, now });
        await db.query("admin_sender_address_delete", { id });

        // Carrying what it took with it, because those rows are the only
        // remaining record that the dependency existed.
        await audit(db, {
          user, action: "delete", entity: "sender_address",
          entity_id: target.address, partner_id: target.partner_id,
          detail: { archived: target.sends_for || undefined,
                    reply_to_cleared: target.replies_for || undefined },
        });
        return json({ deleted: id,
                      archived: target.sends_for || null,
                      senders: await db.query("admin_sender_addresses", {}),
                      partners: await db.query("admin_partners", {}) });
      }

      // ---- a partner, and everything it holds ----
      if (url.searchParams.get("kind") === "partner") {
        const partners = await db.query("admin_partners", {});
        const target = partners.find((p) => p.id === id);
        if (!target) return json({ error: "No such partner" }, 404);

        /* DELETE has to be typed. Not theatre: this destroys supporters and
           their contact history, and a confirm button sitting next to a delete
           button is one slip away from doing it.

           Checked on the SERVER, because a dialog is a suggestion — anything
           that can send a DELETE can skip the browser entirely.

           Typing the word rather than the partner's name is the weaker of the
           two guards: it proves intent to delete SOMETHING, not that the right
           row was picked. The dialog compensates by putting the name where it
           cannot be missed, and the response says what was destroyed. */
        const typed = (url.searchParams.get("confirm") || "").trim();
        if (typed !== "DELETE") {
          return json({
            error: 'Type DELETE to confirm removing a partner.',
          }, 400);
        }

        const stats = await db.queryOne("admin_partner_stats", { partner_id: id });
        await db.query("admin_partner_delete", { partner_id: id });

        // Written AFTER, and deliberately carrying the counts: the rows are
        // gone, so this entry is the only remaining record that they existed.
        await audit(db, {
          user, action: "delete", entity: "partner", entity_id: id,
          detail: { display_name: target.display_name, destroyed: stats },
        });
        return json({
          deleted: id,
          destroyed: stats,
          partners: await db.query("admin_partners", {}),
          users: await listUsers(db),
        });
      }

      if (id === me.user_id) {
        return json({ error: "You cannot remove your own account." }, 409);
      }
      if (await isProtected(db, id)) return json({ error: PROTECTED_MSG }, 409);

      if (await wouldStrandOrg(db, { userId: id, removingUser: true })) {
        return json({
          error: "That is the last active administrator. Appoint another first.",
        }, 409);
      }

      await db.query("admin_user_delete", { id });
      // Recorded BEFORE the row is gone would be better, but audit_log keeps
      // the email rather than a foreign key, so the record survives the delete.
      await audit(db, { user, action: "delete", entity: "user", entity_id: id });
      return json({ deleted: id, users: await listUsers(db) });
    }

    return json({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST, PATCH, DELETE",
    });
  },
};

async function listUsers(db) {
  const users = await db.query("admin_users", {});
  return users.map((u) => ({
    ...u,
    roles: String(u.roles || "").split(",").filter(Boolean),
    /* SQLite's 1/0 becomes a boolean here, as is_featured does in the partner
       API — the screen asks "is this protected", not "is this one". */
    protected: !!u.protected,
    partner_ids: String(u.partner_ids || "").split(",").filter(Boolean),
    partner_names: String(u.partner_names || "").split(" | ").filter(Boolean),
  }));
}
