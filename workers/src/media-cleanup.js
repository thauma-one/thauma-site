/**
 * media-cleanup.js — a ministry's uploads that nothing uses any more
 *
 *   GET  /api/staff-media-cleanup           what could go (nothing is deleted)
 *   POST /api/staff-media-cleanup {keys}    remove those, if still unused
 *
 * BACKLOG §3 "R2 hygiene" (Chase): "delete unused uploads, including those in
 * drafts never published; keep the original for re-editing, but never pile up
 * edits". The photo editor already keeps originals and stores only choices;
 * what is left behind is a photo replaced in a draft, a picture deleted from
 * an email, an edited copy superseded by a later edit, a share card remade.
 *
 * WHAT COUNTS AS USED: the key appears anywhere in the ministry's site — the
 * DRAFT and the PUBLISHED copy — or in any of its mailings (drafts and sent:
 * a sent newsletter's pictures live as long as its archive), or is one of its
 * mailings' attachments. Originals behind edits are in there too (a section's
 * photo, data-orig, shareOrig), so re-editing keeps working.
 *
 * WHAT IS NEVER TOUCHED: anything uploaded in the last seven days (it may be
 * in a page somebody has not saved yet), and every folder but the ministry's
 * own three — Thauma's team, library and site photos are referenced from the
 * repository, which this cannot see.
 *
 * The POST works out the unused set again and deletes only keys that are in
 * it — a list sent by the browser is a request, never the authority.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function scope(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) return { denied: json({ error: "No account for that address" }, 403) };
  const partners = await db.query("partners_for_user", { email: user.email });
  if (!partners.length) return { denied: json({ error: "This account is not attached to a partner." }, 403) };
  const p = partners[0];
  return { db, user, partner: p, prefixes: [`partnersite/${p.slug}/`, `newsletter/${p.slug}/`, `attachments/${p.id}/`] };
}

async function unused(env, s) {
  const site = await s.db.queryOne("partner_site_get", { partner_id: s.partner.id });
  const mails = await s.db.query("media_refs_mailings", { partner_id: s.partner.id });
  const atts = new Set((await s.db.query("media_refs_attachments", { partner_id: s.partner.id })).map((r) => r.object_key));
  const text = [site && site.draft, site && site.published, ...mails.map((m) => m.body_html)].filter(Boolean).join("\n");
  const now = Date.now(), out = [];
  for (const prefix of s.prefixes) {
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) {
        if (atts.has(o.key) || text.includes(o.key)) continue;
        const at = o.uploaded ? new Date(o.uploaded).getTime() : now;
        if (now - at < GRACE_MS) continue;
        out.push({ key: o.key, bytes: o.size, uploaded: o.uploaded });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (!env.DB || !env.MEDIA) return json({ error: "Storage is not set up on this deploy." }, 500);
    const s = await scope(request, env);
    if (s.denied) return s.denied;

    if (request.method === "GET") {
      const files = await unused(env, s);
      return json({ files, bytes: files.reduce((a, f) => a + (f.bytes || 0), 0) });
    }
    if (request.method === "POST") {
      const body = await readJson(request);
      const asked = new Set(Array.isArray(body && body.keys) ? body.keys.map(String) : []);
      const gone = (await unused(env, s)).filter((f) => asked.has(f.key));
      for (const f of gone) await env.MEDIA.delete(f.key);
      await s.db.query("audit_write", {
        id: crypto.randomUUID(), now: new Date().toISOString(), user_id: s.user.email, partner_id: s.partner.id,
        action: "media.cleanup", entity: "partner_site", entity_id: s.partner.slug,
        detail: JSON.stringify({ removed: gone.length, bytes: gone.reduce((a, f) => a + (f.bytes || 0), 0) }),
      }).catch(() => {});
      return json({ ok: true, removed: gone.length, bytes: gone.reduce((a, f) => a + (f.bytes || 0), 0) });
    }
    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  },
};
