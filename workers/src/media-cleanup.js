/**
 * media-cleanup.js — uploads that nothing uses any more, removed on a timer
 *
 * BACKLOG §3 "R2 hygiene" (Chase): "delete unused uploads, including those in
 * drafts never published; keep the original for re-editing, but never pile up
 * edits". And then: "I didn't want R2 to be managed by the person. That should
 * all be automatically managed." So there is no button and no route: the
 * Worker's scheduled handler calls cleanUnusedMedia once a day.
 *
 * What is left behind to clean: a photo replaced in a draft, a picture deleted
 * from an email, an edited copy superseded by a later edit, a share card
 * remade. The photo editor keeps originals and stores only choices.
 *
 * WHAT COUNTS AS USED: the key appears anywhere in the owner's site (the
 * DRAFT and the PUBLISHED copy), or in any of its mailings (drafts and sent:
 * a sent newsletter's pictures live as long as its archive), or is one of its
 * mailings' attachments. Originals behind edits are in there too (a section's
 * photo, data-orig, shareOrig), so re-editing keeps working.
 *
 * WHOSE FOLDERS: each partner's three (partnersite/, newsletter/, attachments/)
 * and Thauma's own mail folders (newsletter/thauma/, attachments/org/), whose
 * only users are Thauma's mailings. Never team/, library/ or site/: those are
 * named from the repository and the collections, which this cannot see.
 *
 * WHAT IS NEVER TOUCHED: anything uploaded in the last 30 days. Nobody looks
 * at a list first any more, so the wait is long: a page somebody is still
 * building, unsaved, keeps its pictures for a month.
 */
import { createDb } from "./lib/db.js";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

/* Every owner and its folders. Thauma is partner_id NULL in mailings. */
async function owners(db) {
  const partners = await db.query("admin_partners", {});
  return [
    ...partners.map((p) => ({ id: p.id, slug: p.slug, prefixes: [`partnersite/${p.slug}/`, `newsletter/${p.slug}/`, `attachments/${p.id}/`] })),
    { id: null, slug: "thauma", prefixes: ["newsletter/thauma/", "attachments/org/"] },
  ];
}

async function unused(env, db, o) {
  const site = o.id ? await db.queryOne("partner_site_get", { partner_id: o.id }) : null;
  const mails = await db.query("media_refs_mailings", { partner_id: o.id });
  const atts = new Set((await db.query("media_refs_attachments", { partner_id: o.id })).map((r) => r.object_key));
  const text = [site && site.draft, site && site.published, ...mails.map((m) => m.body_html)].filter(Boolean).join("\n");
  const now = Date.now(), out = [];
  for (const prefix of o.prefixes) {
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
      for (const f of page.objects) {
        if (atts.has(f.key) || text.includes(f.key)) continue;
        const at = f.uploaded ? new Date(f.uploaded).getTime() : now;
        if (now - at < GRACE_MS) continue;
        out.push({ key: f.key, bytes: f.size || 0 });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return out;
}

/* One pass over every owner. One owner's failure is logged and the rest go
   on; the activity log gets a line only when something was removed. */
export async function cleanUnusedMedia(env) {
  if (!env.DB || !env.MEDIA) return { skipped: true };
  const db = createDb(env.DB);
  const report = [];
  for (const o of await owners(db)) {
    try {
      const gone = await unused(env, db, o);
      for (const f of gone) await env.MEDIA.delete(f.key);
      const bytes = gone.reduce((a, f) => a + f.bytes, 0);
      report.push({ owner: o.slug, removed: gone.length, bytes });
      if (gone.length) {
        await db.query("audit_write", {
          id: crypto.randomUUID(), now: new Date().toISOString(), user_id: "system", partner_id: o.id,
          action: "media.cleanup", entity: "media", entity_id: o.slug,
          detail: JSON.stringify({ removed: gone.length, bytes }),
        }).catch(() => {});
      }
    } catch (err) {
      report.push({ owner: o.slug, error: String(err && err.message || err) });
    }
  }
  return { report };
}

/* Once a day, on the quarter-hour cron: the run that starts in 03:00–03:14 UTC. */
export const isCleanupHour = (time) => {
  const d = new Date(time);
  return d.getUTCHours() === 3 && d.getUTCMinutes() < 15;
};
