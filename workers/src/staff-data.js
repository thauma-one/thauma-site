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
import { json, readJson } from "./lib/store.js";

const VISIBILITY = new Set(["staff", "admin", "board"]);

/** Resolve the caller to a user, a partner, and what they may see. */
async function context(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const partners = await db.query("partners_for_user", { email: user.email });
  if (!partners.length) {
    return { denied: json({ error: "No partner access for this account", email: user.email }, 403) };
  }
  const partner = partners[0];
  const roles = String(partner.roles || "staff").split(",");
  const isAdmin = roles.includes("admin");

  // Which resource levels this person may read. Everyone sees staff material;
  // admins also see admin material. 'board' has no role behind it yet, so
  // nobody gets it — deliberately, rather than falling open to admins on the
  // assumption that admin implies everything.
  const levels = isAdmin ? "staff,admin" : "staff";

  return { db, user, partner, isAdmin, levels };
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
    const { db, user, partner, isAdmin, levels, denied } = await context(request, env);
    if (denied) return denied;

    const partner_id = partner.id;
    const user_id = partner.user_id;
    const now = new Date().toISOString();
    const url = new URL(request.url);

    /* ---------------------------------------------------------------- GET */
    if (request.method === "GET") {
      const [contacts, resources] = await Promise.all([
        db.query("directory_for_user", { user_id, partner_id }),
        db.query("resources_visible", { partner_id, levels }),
      ]);
      return json({
        // The same identity block every staff endpoint returns, so the header
        // can be filled from whatever request a page was already making.
        you: {
          email: user.email,
          name: partner.user_name || null,
          roles: String(partner.roles || "staff").split(","),
        },
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
      });
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

        const id = body.id || newId("rs");
        await db.query("resource_upsert", {
          id, partner_id, title,
          description: str(body.description, 4000),
          link: safeLink(body.link),
          photo: safeLink(body.photo),
          visibility,
          created_by: user_id,
          now,
        });
        const resources = await db.query("resources_visible", { partner_id, levels });
        return json({ resources });
      }

      return json({ error: 'kind must be "contact" or "resource"' }, 400);
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
        await db.query("resource_delete", { id, partner_id });
        const resources = await db.query("resources_visible", { partner_id, levels });
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
