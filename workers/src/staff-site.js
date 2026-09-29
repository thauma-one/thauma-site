/**
 * staff-site.js — the ministry's own website, from the console's Website tab
 *
 *   GET  /api/staff-site               the site, the working copy, who may edit
 *   GET  /api/staff-site?brief         only whether it is on and where (header)
 *   POST /api/staff-site  { action, … }
 *     save     { draft }            the working copy, cleaned and stored
 *     publish                       the working copy becomes what visitors see
 *     discard                       back to what visitors see
 *     enable   { on }               open or close the site (owner)
 *     start    { kind }             "full" | "basic" | "blank" — replace the
 *                                   working copy with a starting point
 *     request  { note }             ask the owner to let me edit
 *     grant | decline | revoke { user_id }   the owner answering (owner)
 *
 * WHO MAY DO WHAT (Chase, 2026-09-28): the ministry's OWNER edits and
 * switches the site on. Anyone else on the team sees everything here and may
 * ask to edit; the owner allows or declines, and may take it back. Someone
 * allowed edits and publishes, but does not switch the site on or off and
 * does not answer requests.
 *
 * THE ADDRESS is made from the ministry's name when the site is first
 * opened — "Chase Roush" → chaseroush — and only an administrator changes it
 * (/api/admin/site-address, below), for two people with one name.
 *
 * NOTHING HERE IS PUBLIC UNTIL PUBLISH, like Updates: the working copy is
 * saved as it is edited so nothing is lost between visits, and Publish is
 * the one act that changes what a visitor sees.
 */
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { createDb } from "./lib/db.js";
import { json, readJson } from "./lib/store.js";
import { partnerFor } from "./staff-milestones.js";
import { ensureSiteDns } from "./lib/site-dns.js";
import { cleanDoc, starter, subdomainFrom, validSubdomain } from "./site/model.js";
import { lookFor } from "./embed-colour.js";

const MAX_DRAFT = 400000;

/** Where the site is, for this deploy: its own address on the live site, the
    console's /site/<name>/ everywhere else (dev, staging). */
function addressOf(env, sub) {
  return env.SITE_WILDCARD === "1" ? `https://${sub}.${env.SITE_DOMAIN || "thauma.one"}/` : `/site/${sub}/`;
}

async function catalogOf(db) {
  return (await db.query("languages_all", {})).filter((l) => l.is_active);
}

/** The row, made the first time: an address from the name, the full default site. */
async function siteRow(db, partner, now) {
  let row = await db.queryOne("partner_site_get", { partner_id: partner.id });
  if (row) return row;
  const owner = await db.queryOne("partner_site_owner", { partner_id: partner.id });
  const baseName = subdomainFrom((owner && owner.name) || partner.display_name) || subdomainFrom(partner.slug) || "site";
  let sub = validSubdomain(baseName) ? baseName : (baseName + "site").slice(0, 40);
  for (let n = 2; await db.queryOne("partner_site_subdomain_taken", { subdomain: sub, partner_id: partner.id }); n++) {
    sub = (baseName.slice(0, 38) + n);
  }
  const langs = (await db.query("partner_languages_for_partner", { partner_id: partner.id }))
    .filter((l) => l.is_enabled).map((l) => l.code);
  const settings = await db.queryOne("partner_settings", { partner_id: partner.id });
  const fallback = (settings && settings.default_lang) || "en";
  const face = await db.queryOne("partner_for_site", { partner_id: partner.id });
  const doc = starter("full", {
    name: partner.display_name, langs: langs.length ? langs : [fallback], fallback,
    give: (face && face.giving_url) || "",
  });
  await db.query("partner_site_create", { partner_id: partner.id, subdomain: sub, draft: JSON.stringify(doc), now });
  return db.queryOne("partner_site_get", { partner_id: partner.id });
}

export default {
  async fetch(request, env) {
    const { db, partner, me, actor, user, denied } = await partnerFor(request, env);
    if (denied) return denied;
    await auditActingWrite(request, db, actor);
    const now = new Date().toISOString();
    const url = new URL(request.url);
    const isOwner = partner.access_role === "owner";
    const isEditor = isOwner || !!(await db.queryOne("partner_site_is_editor", { partner_id: partner.id, user_id: me.user_id }));

    /* The header's question only reads: opening the console must not make a
       site for a ministry that never opened its Website tab. */
    if (request.method === "GET" && url.searchParams.has("brief")) {
      const have = await db.queryOne("partner_site_get", { partner_id: partner.id });
      return json(have ? { enabled: !!have.enabled, published: !!have.published, address: addressOf(env, have.subdomain) }
                       : { enabled: false });
    }

    const row = await siteRow(db, partner, now);

    const answer = async (extra = {}) => {
      const fresh = await db.queryOne("partner_site_get", { partner_id: partner.id });
      const [editors, requests, catalog] = await Promise.all([
        db.query("partner_site_editors_for", { partner_id: partner.id }),
        db.query("partner_site_requests_for", { partner_id: partner.id }),
        catalogOf(db),
      ]);
      const owner = await db.queryOne("partner_site_owner", { partner_id: partner.id });
      const face = await db.queryOne("partner_for_site", { partner_id: partner.id });
      const theme = lookFor(face, null, "#1AE4FF");
      return json(withActing({
        you: { email: user.email, name: me.user_name || null, roles: String(me.roles || "staff").split(",") },
        partner: { id: partner.id, display_name: partner.display_name, slug: partner.slug },
        site: {
          subdomain: fresh.subdomain,
          address: addressOf(env, fresh.subdomain),
          preview: `/site/${fresh.subdomain}/?draft`,
          enabled: !!fresh.enabled,
          published_at: fresh.published_at,
          published_by: fresh.published_by_name || null,
          unpublished: fresh.published === null || fresh.published !== fresh.draft,
          dns: fresh.dns_state || null,
        },
        draft: cleanDoc(JSON.parse(fresh.draft), catalog.map((l) => l.code)),
        languages: catalog.map((l) => ({ code: l.code, name: l.name, native_name: l.native_name })),
        /* The ministry's colors (Sharing), which the site wears. */
        theme: { accent: theme.accent, accent2: theme.accent2 },
        can: { edit: isEditor, owner: isOwner },
        owner: owner ? { name: owner.name } : null,
        editors: isOwner ? editors : editors.map((e) => ({ user_id: e.user_id, name: e.name })),
        requests: isOwner ? requests : [],
        my_request: requests.find((r) => r.user_id === me.user_id) || null,
        ...extra,
      }, actor));
    };

    if (request.method === "GET") return answer();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });

    const body = await readJson(request);
    if (!body) return json({ error: "Invalid JSON" }, 400);
    const action = String(body.action || "");
    const onlyEditors = () => json({ error: "Only the owner, and people the owner allows, can change this site." }, 403);
    const onlyOwner = () => json({ error: "Only the ministry's owner can do this." }, 403);

    if (action === "save") {
      if (!isEditor) return onlyEditors();
      const raw = JSON.stringify(body.draft || {});
      if (raw.length > MAX_DRAFT) return json({ error: "This site has grown too large to save." }, 400);
      const doc = cleanDoc(body.draft, (await catalogOf(db)).map((l) => l.code));
      await db.query("partner_site_save_draft", { partner_id: partner.id, draft: JSON.stringify(doc), now });
      return answer();
    }
    if (action === "publish") {
      if (!isEditor) return onlyEditors();
      await db.query("partner_site_publish", { partner_id: partner.id, user_id: me.user_id, now });
      return answer();
    }
    if (action === "discard") {
      if (!isEditor) return onlyEditors();
      await db.query("partner_site_discard", { partner_id: partner.id, now });
      return answer();
    }
    if (action === "start") {
      if (!isEditor) return onlyEditors();
      const kind = ["full", "basic", "blank"].includes(body.kind) ? body.kind : null;
      if (!kind) return json({ error: 'kind must be "full", "basic" or "blank"' }, 400);
      const current = cleanDoc(JSON.parse(row.draft), (await catalogOf(db)).map((l) => l.code));
      /* A fresh start keeps what is the SITE's rather than its pages: its
         languages, look, motion, links and where Give goes. */
      const doc = starter(kind, { name: partner.display_name, langs: current.languages, fallback: current.fallback, give: current.give });
      doc.design = current.design; doc.links = current.links;
      await db.query("partner_site_save_draft", { partner_id: partner.id, draft: JSON.stringify(doc), now });
      return answer();
    }
    if (action === "enable") {
      if (!isOwner) return onlyOwner();
      const on = body.on ? 1 : 0;
      /* Switching on a site nobody has published publishes it: "Enable
         activates the site" (Chase), and an open site showing nothing would
         be the one outcome nobody wants. */
      if (on && !row.published) await db.query("partner_site_publish", { partner_id: partner.id, user_id: me.user_id, now });
      await db.query("partner_site_set_enabled", { partner_id: partner.id, enabled: on, now });
      if (on && env.SITE_WILDCARD === "1" && row.dns_state !== "ready") {
        const dns = await ensureSiteDns(env, row.subdomain);
        await db.query("partner_site_set_dns", { partner_id: partner.id, dns_state: dns.state, now });
      }
      return answer();
    }
    if (action === "request") {
      if (isEditor) return json({ error: "You can already edit this site." }, 400);
      await db.query("partner_site_request_add", { partner_id: partner.id, user_id: me.user_id,
        note: String(body.note || "").slice(0, 300) || null, now });
      return answer();
    }
    if (action === "grant" || action === "decline" || action === "revoke") {
      if (!isOwner) return onlyOwner();
      const who = String(body.user_id || "");
      if (!who) return json({ error: "A person is required" }, 400);
      await db.query("partner_site_request_remove", { partner_id: partner.id, user_id: who });
      if (action === "grant") await db.query("partner_site_editor_add", { partner_id: partner.id, user_id: who, granted_by: me.user_id, now });
      if (action === "revoke") await db.query("partner_site_editor_remove", { partner_id: partner.id, user_id: who });
      return answer();
    }
    return json({ error: "Unknown action" }, 400);
  },
};

/**
 * /api/admin/site-address — an administrator changing a site's address
 * (Chase, 2026-09-29: the partner does not choose it; an administrator may,
 * when two people share a name).
 *   GET                         every site's address
 *   POST { partner_id, subdomain }
 */
export const siteAddress = {
  async fetch(request, env) {
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    const db = createDb(env.DB);
    const actor = await resolveActor(request, env, db, user);
    const roles = String((actor.real || actor.me || {}).roles || "").split(",");
    if (!roles.includes("admin")) return json({ error: "Administrators only." }, 403);
    if (request.method === "GET") return json({ sites: await db.query("partner_site_all", {}) });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
    const body = await readJson(request);
    const partner_id = String((body && body.partner_id) || "");
    const sub = String((body && body.subdomain) || "").trim().toLowerCase();
    if (!validSubdomain(sub)) {
      return json({ error: "Two to forty lower-case letters or digits, and not a name Thauma uses itself." }, 400);
    }
    const was = await db.queryOne("partner_site_get", { partner_id });
    if (!was) return json({ error: "That ministry has no site yet." }, 404);
    if (await db.queryOne("partner_site_subdomain_taken", { subdomain: sub, partner_id })) {
      return json({ error: "Another ministry already has that address." }, 409);
    }
    const now = new Date().toISOString();
    await db.query("partner_site_set_subdomain", { partner_id, subdomain: sub, now });
    /* A site already open needs its new name to exist, as switching it on
       would have made it. */
    if (was.enabled && env.SITE_WILDCARD === "1") {
      const dns = await ensureSiteDns(env, sub);
      await db.query("partner_site_set_dns", { partner_id, dns_state: dns.state, now });
    }
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), now,
      user_id: user.email, partner_id, action: "update", entity: "partner_site", entity_id: partner_id,
      detail: JSON.stringify({ subdomain: sub }),
    });
    return json({ ok: true, subdomain: sub, sites: await db.query("partner_site_all", {}) });
  },
};
