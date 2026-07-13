// Serves and updates staff-area content for logged-in users with the
// staff or admin role. Data lives in Netlify Blobs (never in git / the
// public repo) — see /staff/ for the edit UI that talks to this.
//
// Uses the V1 handler signature (not the newer fetch-style export default)
// because only V1's context carries clientContext.user — Identity/JWT info
// isn't part of the documented V2 Context type. That's a real tradeoff:
// netlify dev doesn't wire up automatic Blobs context for V1 functions
// locally (a local-dev-only gap — production supports both simultaneously),
// so getStore() calls here can only be exercised end-to-end via a real
// deploy, or locally by temporarily stubbing the auth check.
//
// GET  -> returns { contacts, resources, updatedAt, updatedBy }
// POST -> body { contacts, resources } replaces the stored data
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "staff-directory";
const KEY = "data";

const SEED = {
  contacts: [
    { name: "Thauma General", role: "General inquiries", emails: ["hello@thauma.one"], phones: [] },
  ],
  resources: [
    { title: "Password Vault (Bitwarden)", description: "Shared credentials for every Thauma account.", link: "", photo: "" },
    { title: "GitHub — thauma-site", description: "The site's source code and content history.", link: "https://github.com/thauma-one/thauma-site", photo: "" },
    { title: "Netlify Dashboard", description: "Deploys, forms, Identity, and environment settings.", link: "", photo: "" },
    { title: "Cloudflare Dashboard", description: "DNS, email routing, and the tunnel for dev previews.", link: "", photo: "" },
  ],
};

function json(body, statusCode) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function sanitizeString(v, maxLen) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, maxLen);
}

function sanitizeLink(v) {
  const s = sanitizeString(v, 300);
  if (!s) return "";
  return /^(https?:|mailto:|tel:)/i.test(s) ? s : "";
}

function sanitizeImageSrc(v) {
  const s = sanitizeString(v, 300);
  if (!s) return "";
  return /^https?:\/\//i.test(s) || s.startsWith("/") ? s : "";
}

function sanitizeEmail(v) {
  const s = sanitizeString(v, 200);
  if (!s) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

function sanitizePhone(v) {
  const s = sanitizeString(v, 40);
  if (!s) return "";
  return s.replace(/[^0-9+\-() ]/g, "");
}

function sanitizeStringArray(arr, sanitizeFn, maxItems) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, maxItems).map(sanitizeFn).filter(Boolean);
}

function sanitizeContacts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 50)
    .map((c) => ({
      name: sanitizeString(c && c.name, 100),
      role: sanitizeString(c && c.role, 100),
      emails: sanitizeStringArray((c && c.emails) || [], sanitizeEmail, 5),
      phones: sanitizeStringArray((c && c.phones) || [], sanitizePhone, 5),
    }))
    .filter((c) => c.name);
}

function sanitizeResources(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, 50)
    .map((r) => ({
      title: sanitizeString(r && r.title, 100),
      description: sanitizeString(r && r.description, 300),
      link: sanitizeLink(r && r.link),
      photo: sanitizeImageSrc(r && r.photo),
    }))
    .filter((r) => r.title);
}

// netlify dev doesn't wire up automatic Blobs context for V1 functions
// locally. BLOBS_LOCAL_TOKEN (set only in a local, gitignored .env) makes
// local runs talk to the real Blobs API directly instead of relying on
// that local emulation. Unset in production, where automatic context
// already works — this path never runs there.
function getStaffStore() {
  const token = process.env.BLOBS_LOCAL_TOKEN;
  if (token && process.env.SITE_ID) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token });
  }
  return getStore(STORE_NAME);
}

exports.handler = async (event, context) => {
  const user = context.clientContext && context.clientContext.user;
  const roles = ((user && user.app_metadata && user.app_metadata.roles) || []).map((r) => String(r).toLowerCase());
  // Admin implies staff access — no need to assign both roles to the same person.
  const allowed = roles.includes("staff") || roles.includes("admin");

  if (!user || !allowed) {
    return json({ error: "Not authorized" }, 401);
  }

  const store = getStaffStore();

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json({ error: "Invalid JSON" }, 400);
    }

    const record = {
      contacts: sanitizeContacts(body.contacts),
      resources: sanitizeResources(body.resources),
      updatedAt: new Date().toISOString(),
      updatedBy: user.email || "unknown",
    };

    await store.setJSON(KEY, record);
    return json(record, 200);
  }

  const existing = await store.get(KEY, { type: "json" });
  const record = existing || { ...SEED, updatedAt: null, updatedBy: null };
  return json(record, 200);
};
