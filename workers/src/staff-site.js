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
import { ensureSiteDns, removeSiteDns } from "./lib/site-dns.js";
import { cleanDoc, starter, subdomainFrom, validSubdomain } from "./site/model.js";
import { lookFor } from "./embed-colour.js";
import { changedAnswer } from "./lib/fresh.js";

const MAX_DRAFT = 400000;

/** Where the site is, for this deploy: its own address on the live site, the
    console's /site/<name>/ everywhere else (dev, staging). */
function addressOf(env, sub) {
  return env.SITE_WILDCARD === "1" ? `https://${sub}.${env.SITE_DOMAIN || "thauma.one"}/` : `/site/${sub}/`;
}

/** Every name the site answers to: its own, then the old ones that send
    visitors on (0045). */
async function namesOf(db, partner_id, sub) {
  return [sub, ...(await db.query("partner_site_aliases_for", { partner_id })).map((a) => a.subdomain)];
}

/**
 * THE QUARTER-HOUR CHECK (worker.js scheduled(), live only). Dev and staging
 * share the database but not the DNS key, so a site switched on there is
 * recorded but its name is made here. Also keeps the wildcard record that
 * lets every other name answer at once (site/serve.js closedSite).
 * Returns what it did, for the log.
 */
export async function ensureSiteNames(env) {
  if (env.SITE_WILDCARD !== "1" || !env.DB) return { skipped: true };
  const db = createDb(env.DB);
  const wildcard = (await ensureSiteDns(env, "*")).state;
  const made = [];
  const now = new Date().toISOString();
  for (const s of await db.query("partner_site_needing_dns", {})) {
    await bringUp(env, db, s.partner_id, s.subdomain, now);
    made.push(s.subdomain);
  }
  return { wildcard, made };
}

/** Make every name exist in DNS (live only); the site's own name's answer is kept. */
async function bringUp(env, db, partner_id, sub, now) {
  if (env.SITE_WILDCARD !== "1") return;
  const names = await namesOf(db, partner_id, sub);
  const own = await ensureSiteDns(env, names[0]);
  for (const old of names.slice(1)) await ensureSiteDns(env, old);
  await db.query("partner_site_set_dns", { partner_id, dns_state: own.state, now });
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
        partner: { id: partner.id, display_name: partner.display_name, slug: partner.slug,
                   /* Where Give goes when the site names nowhere of its own. */
                   giving_url: (face && face.giving_url) || null },
        site: {
          subdomain: fresh.subdomain,
          address: addressOf(env, fresh.subdomain),
          preview: `/site/${fresh.subdomain}/?draft`,
          enabled: !!fresh.enabled,
          published_at: fresh.published_at,
          published_by: fresh.published_by_name || null,
          unpublished: fresh.published === null || fresh.published !== fresh.draft,
          dns: fresh.dns_state || null,
          /* An administrator took it down (0045); switching it on brings it back. */
          archived: !!fresh.archived_at,
        },
        draft: cleanDoc(JSON.parse(fresh.draft), catalog.map((l) => l.code)),
        /* What visitors see, so the editor can mark each tab whose part of the
           working copy differs from it (Chase, 2026-09-29: the yellow dot). */
        published: fresh.published ? cleanDoc(JSON.parse(fresh.published), catalog.map((l) => l.code)) : null,
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
      const codes = (await catalogOf(db)).map((l) => l.code);
      /* SAVED BY SOMEONE ELSE since this editor last heard from the server
         (lib/fresh.js). The owner and the editors they grant can all have a
         site open. Compared by the DRAFT, not updated_at: the row's stamp
         also moves when the site is switched on, published, or its name is
         made, none of which is somebody else's edit. `base` is the draft as
         this server last handed it over, cleaned the same way as what is
         stored, so an autosave never trips over its own previous one. */
      if (body.base && body.overwrite !== true) {
        const theirs = cleanDoc(JSON.parse(row.draft), codes);
        if (JSON.stringify(cleanDoc(body.base, codes)) !== JSON.stringify(theirs)) {
          return changedAnswer({ draft: theirs, updated_at: row.updated_at });
        }
      }
      const doc = cleanDoc(body.draft, codes);
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
      doc.design = current.design; doc.links = current.links; doc.footer = current.footer;
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
      /* Switching on also brings back a site an administrator archived:
         archived_at is cleared, and its names are made again. */
      await db.query("partner_site_set_enabled", { partner_id: partner.id, enabled: on, now });
      if (on && row.dns_state !== "ready") await bringUp(env, db, partner.id, row.subdomain, now);
      /* Switched off, the NAME STAYS and answers with Thauma's closed page
         (site/serve.js closedSite). Taking the record away made the site
         truly vanish, but anyone who looked while it was gone then waited
         out a remembered "does not exist" once it came back (Chase,
         2026-09-29). On dev and staging nothing is made here — they hold no
         DNS key; the live Worker's quarter-hour check makes it. */
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
 * /api/admin/site-address — an administrator and a ministry's site
 *   GET                                       every site
 *   POST { partner_id, subdomain }            change its address
 *   POST { partner_id, action: "archive" }    take it down, keep it
 *   POST { partner_id, action: "unalias", subdomain }   let an old name go
 *   POST { partner_id, action: "delete", confirm: <its address> }
 *                                             take it down and delete it
 *
 * THE ADDRESS (Chase, 2026-09-29): the partner does not choose it; an
 * administrator may, when two people share a name. The old name is kept as
 * an alias that sends visitors on to the new one (serve.js), so links
 * already printed or shared keep working, and no other ministry can take it.
 *
 * ARCHIVE AND DELETE (Chase, 2026-09-29: "archive (delete the URL from
 * Cloudflare, but keeps the data) or full delete (deletes the URL from
 * Cloudflare and deletes the data). But the sites can be added again by the
 * owner."). Archive switches the site off and removes its DNS records —
 * every name, old ones too; the owner's switch brings it all back. Delete
 * removes the records, then the site, its old names, who may edit it and the
 * open requests; the owner's next visit to the Website tab starts a new one
 * from the default. Uploaded photos stay in the media library either way.
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
    const action = String((body && body.action) || "address");
    const audit = (what, detail) => db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20), now: new Date().toISOString(),
      user_id: user.email, partner_id, action: what, entity: "partner_site", entity_id: partner_id,
      detail: JSON.stringify(detail),
    });

    if (action === "archive" || action === "delete") {
      const site = await db.queryOne("partner_site_get", { partner_id });
      if (!site) return json({ error: "That ministry has no site." }, 404);
      /* The dialog asks for the address typed out before a delete; a dialog
         is only a suggestion, so the word is checked here too. */
      if (action === "delete" && String(body.confirm || "") !== site.subdomain) {
        return json({ error: "Type the site's address to confirm." }, 400);
      }
      /* The name's record stays: archived or deleted, it answers with
         Thauma's closed page, and a site made again under it is there at
         once rather than after a remembered "does not exist". */
      const now = new Date().toISOString();
      if (action === "archive") {
        await db.query("partner_site_archive", { partner_id, now });
      } else {
        await db.query("partner_site_aliases_clear", { partner_id });
        await db.query("partner_site_editors_clear", { partner_id });
        await db.query("partner_site_requests_clear", { partner_id });
        await db.query("partner_site_delete", { partner_id });
      }
      await audit(action === "archive" ? "update" : "delete", { site: action, subdomain: site.subdomain });
      return json({ ok: true, sites: await db.query("partner_site_all", {}) });
    }
    if (action === "unalias") {
      /* An old name let go of — a mistyped change, or one nobody uses any
         more. Its record comes down, and the name is free again. */
      const old = String((body && body.subdomain) || "");
      const mine = (await db.query("partner_site_aliases_for", { partner_id })).some((a) => a.subdomain === old);
      if (!mine) return json({ error: "That is not one of this site's old addresses." }, 404);
      if (env.SITE_WILDCARD === "1") {
        const r = await removeSiteDns(env, old);
        if (r.state !== "removed" && r.state !== "pending") return json({ error: "Cloudflare did not remove the address: " + r.state }, 502);
      }
      await db.query("partner_site_alias_remove", { subdomain: old });
      await audit("update", { released: old });
      return json({ ok: true, sites: await db.query("partner_site_all", {}) });
    }
    if (action !== "address") return json({ error: "Unknown action" }, 400);

    const sub = String((body && body.subdomain) || "").trim().toLowerCase();
    if (!validSubdomain(sub)) {
      return json({ error: "Two to forty lower-case letters or digits, and not a name Thauma uses itself." }, 400);
    }
    const was = await db.queryOne("partner_site_get", { partner_id });
    if (!was) return json({ error: "That ministry has no site yet." }, 404);
    if (await db.queryOne("partner_site_subdomain_taken", { subdomain: sub, partner_id })) {
      return json({ error: "Another ministry already has that address." }, 409);
    }
    if (sub === was.subdomain) return json({ ok: true, subdomain: sub, sites: await db.query("partner_site_all", {}) });
    const now = new Date().toISOString();
    /* The old name sends visitors on; going back to an old name makes it
       the site's own again. */
    await db.query("partner_site_alias_add", { subdomain: was.subdomain, partner_id, now });
    await db.query("partner_site_alias_remove", { subdomain: sub });
    await db.query("partner_site_set_subdomain", { partner_id, subdomain: sub, now });
    /* A site already open needs its new name to exist, as switching it on
       would have made it. The old one's record stays: it is what brings
       visitors to the redirect. */
    if (was.enabled) await bringUp(env, db, partner_id, sub, now);
    await audit("update", { subdomain: sub, was: was.subdomain });
    return json({ ok: true, subdomain: sub, sites: await db.query("partner_site_all", {}) });
  },
};
