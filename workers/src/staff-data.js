/**
 * staff-data.js — the directory and the resource library
 *
 *   GET    /api/staff-data                      both lists, scoped to you
 *   POST   /api/staff-data                      create or update one item
 *   DELETE /api/staff-data?kind=…&id=…          remove one item
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------------------------------------------------
 * This read and wrote a single KV entry under the key "data" — one document
 * for the entire installation. Every staff member of every partner shared it.
 * Two problems, both structural:
 *
 *   NO OWNERSHIP   a directory is somebody's own address book, and everyone
 *                  was looking at the same one.
 *
 *   LOST WRITES    the editor saved the WHOLE document, so two people editing
 *                  on the same afternoon meant the second silently erased the
 *                  first. Nothing warned anyone; the data was simply gone.
 *
 * Both are fixed by the storage rather than by care. Contacts belong to a
 * user, resources belong to a partner or the organisation, and every operation
 * touches ONE row — so concurrent editing costs you a conflict at worst
 * instead of somebody else's afternoon.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

const VISIBILITY = new Set(["staff", "admin", "board"]);

/** Resolve the caller to a user, a partner, and what they may see. */
async function context(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);

  /* Two questions, asked separately.

     WHO: an account can exist with no partner — an administrator, a board
     member, somebody invited and not yet placed. Resolving identity through
     partner access meant none of them had a name.

     WHICH PARTNER: these screens are partner-scoped, so they do still need
     one. The difference is that the refusal can now say which of the two is
     missing instead of "no access". */
  /* WHO THIS REQUEST COUNTS AS. Normally the signed-in person; when an
     administrator is viewing somebody else's console, that person instead.
     resolveActor re-checks the admin role on the REAL caller every time and
     falls back to the caller's own identity if anything is off — see
     lib/actas.js. Everything downstream uses actor.email, so no query in this
     file needs to know acting-as exists. */
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) {
    return { denied: json({
      error: "This address is not an active account.", email: user.email }, 403) };
  }

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet, so there is " +
             "nothing here to show. An administrator can grant access.",
      email: user.email,
      you: { email: user.email, name: me.user_name,
             roles: String(me.roles || "").split(",").filter(Boolean) },
    }, 403) };
  }
  const partner = partners[0];

  const roles = String(me.roles || "staff").split(",");
  const isAdmin = roles.includes("admin");

  // Which resource levels this person may read. Everyone sees staff material;
  // admins also see admin material. 'board' has no role behind it yet, so
  // nobody gets it — deliberately, rather than falling open to admins on the
  // assumption that admin implies everything.
  const levels = isAdmin ? "staff,admin" : "staff";

  return { db, user, me, partner, isAdmin, levels, actor };
}

/** JSON array of trimmed strings, capped. Never trusts what the form sent. */
function stringList(v, max = 20, keep = null) {
  if (!Array.isArray(v)) return [];
  return v.map((s) => String(s == null ? "" : s).trim())
          .filter(Boolean)
          .filter((s) => (keep ? keep(s) : true))
          .slice(0, max)
          .map((s) => s.slice(0, 200));
}

/**
 * A link that is safe to put in an href.
 *
 * RESTORED after being dropped in the 0005 rewrite — the previous KV version
 * had it and the old tests caught its absence. Resources render as clickable
 * anchors, so `javascript:alert(1)` in a link field is stored XSS against
 * every colleague who opens the page. Escaping the text does not help: the
 * browser executes the scheme, not the markup.
 *
 * An ALLOW-LIST of schemes, not a block-list of bad ones. Blocking
 * "javascript:" invites `java\nscript:`, `JaVaScRiPt:` and data: URLs;
 * allowing http, https and mailto cannot be talked around.
 */
export function safeLink(v) {
  const s = str(v, 500);
  if (!s) return null;
  // Relative paths stay — /img/... and /staff/... are ours.
  if (s.startsWith("/")) return s;
  let url;
  try { url = new URL(s); } catch { return null; }
  return ["http:", "https:", "mailto:"].includes(url.protocol) ? s : null;
}

/** Shape only — the real check is that mail to it bounces, not a regex. */
export function isEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, max);
};

const newId = (p) => p + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export default {
  async fetch(request, env) {
    const { db, user, me, partner, isAdmin, levels, actor, denied } = await context(request, env);
    if (denied) return denied;

    /* Recorded before the handler runs, so a change is logged even if the
       handler then fails. One call, at the one place every method passes
       through — a per-write approach has to be remembered by whoever adds the
       next write, and eventually is not. */
    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const user_id = me.user_id;
    const now = new Date().toISOString();
    const url = new URL(request.url);

    /* ---------------------------------------------------------------- GET */
    if (request.method === "GET") {
      const [contacts, resources] = await Promise.all([
        db.query("directory_for_user", { user_id, partner_id }),
        db.query("resources_visible", { partner_id, levels, user_id, is_admin: isAdmin ? 1 : 0 }),
      ]);
      return json(withActing({
        // The same identity block every staff endpoint returns, so the header
        // can be filled from whatever request a page was already making.
        you: {
          email: user.email,
          name: me.user_name || null,
          roles: String(me.roles || "staff").split(","),
        },
        partner: { id: partner.id, display_name: partner.display_name },
        // Named so the screen can say whose these are, rather than implying
        // they are everyone's.
        owner: { email: user.email },
        contacts: contacts.map((c) => ({
          ...c,
          // Stored as JSON text; a malformed row must not take the page down.
          emails: safeList(c.emails),
          phones: safeList(c.phones),
        })),
        resources,
        can: { set_visibility: isAdmin },
        levels: levels.split(","),
      }, actor));
    }

    /* --------------------------------------------------------------- POST */
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      // ---- a directory contact ----
      if (body.kind === "contact") {
        const name = str(body.name, 200);
        if (!name) return json({ error: "A name is required" }, 400);

        const id = body.id || newId("dc");
        await db.query("directory_upsert", {
          id, user_id, partner_id, name,
          role: str(body.role, 120),
          // Anything that is not an address is dropped rather than stored:
          // a directory full of typos is a directory nobody trusts.
          emails: JSON.stringify(stringList(body.emails, 20, isEmail)),
          phones: JSON.stringify(stringList(body.phones)),
          now,
        });
        const contacts = await db.query("directory_for_user", { user_id, partner_id });
        return json({ contacts: contacts.map((c) => ({
          ...c, emails: safeList(c.emails), phones: safeList(c.phones) })) });
      }

      // ---- a resource ----
      if (body.kind === "resource") {
        const title = str(body.title, 200);
        if (!title) return json({ error: "A title is required" }, 400);

        // Only an admin may narrow visibility. Staff can add material, but
        // deciding who else may see it is not theirs to make — and a client
        // that sends 'admin' anyway is refused rather than obeyed.
        let visibility = String(body.visibility || "staff");
        if (!VISIBILITY.has(visibility)) visibility = "staff";
        if (!isAdmin && visibility !== "staff") {
          return json({
            error: "Only an administrator can restrict who sees a resource.",
          }, 403);
        }

        /* WHOSE SHELF THIS GOES ON. Staff make their OWN resources; only an
           administrator makes the organisation's. Chase's rule, and the right
           one — staff creating institutional material would be making
           something they immediately cannot edit, which reads as a bug rather
           than as a rule.

           `shared` is not a shelf anybody writes to: it is the view from the
           other end of somebody else's share. */
        const wantsInstitutional = body.shelf === "institutional";
        if (wantsInstitutional && !isAdmin) {
          return json({
            error: "Only an administrator can add a resource for everyone. " +
                   "Anything you add here is yours, and you can share it.",
          }, 403);
        }
        const owner_user_id = wantsInstitutional ? null : user_id;

        /* EDITING IS CHECKED AGAINST THE STORED ROW, never against what the
           browser said the resource was. An id that already exists must
           belong to whoever is editing it — or to the organisation, with an
           administrator asking. */
        if (body.id) {
          const existing = await db.queryOne("resource_owner", { id: body.id });
          if (!existing) return json({ error: "No such resource." }, 404);
          const mine = existing.owner_user_id === user_id;
          const institutional = existing.owner_user_id === null;
          if (!(mine || (institutional && isAdmin))) {
            return json({
              error: institutional
                ? "That resource belongs to the organisation. Only an " +
                  "administrator can change it."
                : "That resource belongs to somebody else. You can only change " +
                  "your own.",
            }, 403);
          }
        }

        const id = body.id || newId("rs");
        await db.query("resource_upsert", {
          id, partner_id: owner_user_id ? null : partner_id,
          owner_user_id, title,
          description: str(body.description, 4000),
          link: safeLink(body.link),
          photo: safeLink(body.photo),
          visibility,
          created_by: user_id,
          now,
        });
        const resources = await db.query("resources_visible", { partner_id, levels, user_id, is_admin: isAdmin ? 1 : 0 });
        return json({ resources });
      }

      /* ---- passing a resource to a colleague ---- */
      if (body.kind === "share") {
        const rid = str(body.resource_id, 60);
        if (!rid) return json({ error: "A resource is required" }, 400);

        /* BY ADDRESS, resolved here. The page asks for an email because that
           is what somebody knows about a colleague; the database wants an id.
           user_by_email only matches ACTIVE accounts, so an invited person who
           has not confirmed cannot be shared with — they would see nothing
           anyway, and the refusal says so rather than silently doing nothing. */
        let who = str(body.user_id, 60);
        if (!who) {
          const email = str(body.email, 200).toLowerCase();
          if (!email) return json({ error: "A person is required" }, 400);
          const found = await db.queryOne("user_by_email", { email });
          if (!found) {
            return json({
              error: "No active account has that address. They need to be added " +
                     "and to have confirmed before you can share with them.",
            }, 404);
          }
          who = found.user_id;
        }
        if (who === user_id) {
          return json({ error: "That is you — it is already on your shelf." }, 400);
        }

        /* RESHARING IS ALLOWED — Chase's call, and these are internal Thauma
           documents among colleagues rather than material where onward
           sharing betrays the owner. So the test is "can you see it", not "do
           you own it". It is still a test: a resource nobody showed you is
           not yours to forward. */
        const seen = await db.queryOne("resource_can_see", { id: rid, user_id });
        if (!seen) {
          return json({ error: "You cannot share a resource you cannot see." }, 403);
        }

        if (body.remove) {
          await db.query("resource_share_remove", { resource_id: rid, user_id: who });
        } else {
          /* The trigger refuses sharing with the owner, so a slip there is a
             500 rather than a silent duplicate. Checked here so it is a
             sentence instead. */
          const owner = await db.queryOne("resource_owner", { id: rid });
          if (owner && owner.owner_user_id === who) {
            return json({ error: "That is already their own resource." }, 400);
          }
          await db.query("resource_share_add", {
            resource_id: rid, user_id: who, shared_by: user_id, now,
          });
        }

        return json({
          shared_with: await db.query("resource_shared_with", { resource_id: rid }),
          resources: await db.query("resources_visible",
            { partner_id, levels, user_id, is_admin: isAdmin ? 1 : 0 }),
        });
      }

      return json({ error: 'kind must be "contact", "resource" or "share"' }, 400);
    }

    /* ------------------------------------------------------------- DELETE */
    if (request.method === "DELETE") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id is required" }, 400);

      if (kind === "contact") {
        // Scoped by owner as well as id: your id cannot delete my contact.
        await db.query("directory_delete", { id, user_id, partner_id });
        const contacts = await db.query("directory_for_user", { user_id, partner_id });
        return json({ contacts: contacts.map((c) => ({
          ...c, emails: safeList(c.emails), phones: safeList(c.phones) })) });
      }
      if (kind === "resource") {
        /* Same rule as editing, and checked the same way. */
        const existing = await db.queryOne("resource_owner", { id });
        if (!existing) return json({ error: "No such resource." }, 404);
        const mine = existing.owner_user_id === user_id;
        const institutional = existing.owner_user_id === null;
        if (!(mine || (institutional && isAdmin))) {
          return json({
            error: institutional
              ? "That resource belongs to the organisation. Only an " +
                "administrator can remove it."
              : "That resource belongs to somebody else.",
          }, 403);
        }
        await db.query("resource_delete", { id, partner_id });
        const resources = await db.query("resources_visible", { partner_id, levels, user_id, is_admin: isAdmin ? 1 : 0 });
        return json({ resources });
      }
      return json({ error: 'kind must be "contact" or "resource"' }, 400);
    }

    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, DELETE" });
  },
};

/** Stored JSON, decoded defensively — one bad row must not blank the page. */
function safeList(v) {
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
