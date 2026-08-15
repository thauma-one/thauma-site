/**
 * staff-data — network directory and internal resources for the staff console
 *
 * Port of netlify/functions/staff-data.js. All sanitisation is carried over
 * UNCHANGED; a port is the wrong moment to redesign input validation.
 *
 * Changed from the original:
 *   - Netlify Blobs        -> KV binding (see lib/store.js)
 *   - exports.handler      -> export default { fetch }
 *   - node:crypto Access   -> WebCrypto Access (see lib/access.js)
 *
 * AUTH is Cloudflare Access, verified HERE rather than relying on an Access
 * application being in front of this route. Measured on Netlify 2026-08-14:
 * /staff/ was gated while /.netlify/functions/staff-data was not, because the
 * application was scoped to /staff*. The same mistake is available on Workers.
 *
 * ROLES: Access has no equivalent of the old Netlify Identity staff/admin
 * roles, so for now the Access policy IS the gate. When users / partner_users
 * go live (db/README.md), look the email up there. Do NOT reintroduce a role
 * list in an env var — the schema already models that properly.
 *
 * GET  -> { contacts, resources, updatedAt, updatedBy }
 * POST -> body { contacts, resources } replaces the stored document
 */
import { kvStore, json, readJson } from "./lib/store.js";
import { requireAccess } from "./lib/access.js";

const KEY = "data";

const SEED = {
  contacts: [
    { name: "Thauma General", role: "General inquiries", emails: ["hello@thauma.one"], phones: [] },
  ],
  resources: [
    { title: "Password Vault (Bitwarden)", description: "Shared credentials for every Thauma account.", link: "", photo: "" },
    { title: "GitHub — thauma-site", description: "The site's source code and content history.", link: "https://github.com/thauma-one/thauma-site", photo: "" },
    { title: "Netlify Dashboard", description: "Deploys, forms, and environment settings.", link: "", photo: "" },
    { title: "Cloudflare Dashboard", description: "DNS, email routing, Access, and the dev tunnel.", link: "", photo: "" },
  ],
};

function sanitizeString(v, maxLen) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}
function sanitizeLink(v) {
  const s = sanitizeString(v, 300);
  // Allow-list the scheme: this value ends up in an href, so javascript: and
  // data: must never survive.
  return s && /^(https?:|mailto:|tel:)/i.test(s) ? s : "";
}
function sanitizeImageSrc(v) {
  const s = sanitizeString(v, 300);
  return s && (/^https?:\/\//i.test(s) || s.startsWith("/")) ? s : "";
}
function sanitizeEmail(v) {
  const s = sanitizeString(v, 200);
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}
function sanitizePhone(v) {
  const s = sanitizeString(v, 40);
  return s ? s.replace(/[^0-9+\-() ]/g, "") : "";
}
function sanitizeStringArray(arr, fn, maxItems) {
  return Array.isArray(arr) ? arr.slice(0, maxItems).map(fn).filter(Boolean) : [];
}

export function sanitizeContacts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).map((c) => ({
    name: sanitizeString(c && c.name, 100),
    role: sanitizeString(c && c.role, 100),
    emails: sanitizeStringArray((c && c.emails) || [], sanitizeEmail, 5),
    phones: sanitizeStringArray((c && c.phones) || [], sanitizePhone, 5),
  })).filter((c) => c.name);
}

export function sanitizeResources(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).map((r) => ({
    title: sanitizeString(r && r.title, 100),
    description: sanitizeString(r && r.description, 300),
    link: sanitizeLink(r && r.link),
    photo: sanitizeImageSrc(r && r.photo),
  })).filter((r) => r.title);
}

/** Exported for tests: the handler with its store injected. */
export async function handle(request, env, store) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return denied;

  if (request.method === "POST") {
    const body = await readJson(request);
    if (body === null) return json({ error: "Invalid JSON" }, 400);

    const record = {
      contacts: sanitizeContacts(body.contacts),
      resources: sanitizeResources(body.resources),
      updatedAt: new Date().toISOString(),
      updatedBy: user.email || "unknown",
    };
    await store.put(KEY, record);
    return json(record);
  }

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  const existing = await store.get(KEY);
  return json(existing || { ...SEED, updatedAt: null, updatedBy: null });
}

export default {
  async fetch(request, env) {
    return handle(request, env, kvStore(env.STAFF_DATA));
  },
};
