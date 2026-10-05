/**
 * media-cleanup.js — uploads nothing uses any more, removed without anybody
 * managing storage
 *
 * Chase: "I didn't want R2 to be managed by the person … when a picture gets
 * replaced, it deletes the old photo … just make sure you don't code it where
 * it deletes it too early, like if someone uploads a photo but doesn't submit
 * the changes … We can still run the 30 day checkup in case the system didn't
 * follow the storage properly."
 *
 * TWO WAYS A FILE GOES:
 *
 *   1. RELEASED when the editing that replaced it is over (releaseMedia).
 *      Not at the save: the Site Creator saves every change as it is made and
 *      has Undo, and an email being written has the editor's own undo, so a
 *      replaced photo is still one keystroke from coming back until the page
 *      or the composer closes. The editor then sends what it saw and no
 *      longer uses (POST /api/staff-media-release); a deleted draft email
 *      releases its own pictures and attachments on the server.
 *   2. SWEPT once a day (cleanUnusedMedia): anything unused and older than
 *      30 days, for what a closed laptop or a killed phone tab never sent.
 *
 * Either way the SERVER decides: a key is deleted only if it sits in a folder
 * the caller may tidy AND nothing names it — no site (draft or published, so
 * originals behind edits and share cards count), no mailing (drafts and sent:
 * a sent newsletter's pictures live as long as its archive), no attachment,
 * no resource. That check spans EVERY owner (queries.sql, STORAGE): Thauma's
 * own mail can keep its pictures in a partner's folder.
 *
 * FOLDERS: each partner's partnersite/, newsletter/ and attachments/, and
 * Thauma's newsletter/thauma/ and attachments/org/. Never team/, library/ or
 * site/: those are named from the repository and the collections.
 */
import { createDb } from "./lib/db.js";

import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
const ORG_PREFIXES = ["newsletter/thauma/", "attachments/org/"];
const partnerPrefixes = (p) => [`partnersite/${p.slug}/`, `newsletter/${p.slug}/`, `attachments/${p.id}/`];

/* Every owner and its folders. */
async function owners(db) {
  const partners = await db.query("admin_partners", {});
  return [
    ...partners.map((p) => ({ id: p.id, slug: p.slug, prefixes: partnerPrefixes(p) })),
    { id: null, slug: "thauma", prefixes: ORG_PREFIXES },
  ];
}

/* Everything that names a file, from every owner. */
async function references(db) {
  const sites = await db.query("media_refs_sites", {});
  const mails = await db.query("media_refs_mailings", {});
  const res = await db.query("media_refs_resources", {});
  const atts = new Set((await db.query("media_refs_attachments", {})).map((r) => r.object_key));
  const text = [...sites.flatMap((r) => [r.draft, r.published]), ...mails.flatMap((m) => [m.body_html, m.body_md]),
                ...res.map((r) => r.photo)].filter(Boolean).join("\n");
  return { used: (key) => atts.has(key) || text.includes(key) };
}

/* "/media/x/y.webp", "https://host/media/x/y.webp" or "x/y.webp" → "x/y.webp". */
export function keyOf(v) {
  const s = String(v || "").trim().split(/[?#]/)[0];
  const i = s.indexOf("/media/");
  const k = i >= 0 ? s.slice(i + 7) : s.replace(/^\/+/, "");
  return /^[a-z]+\/[A-Za-z0-9._\/-]+$/.test(k) && !k.includes("..") ? k : "";
}

/* Delete what the caller handed over, if it is in their folders and nothing
   uses it. Returns how many went. */
export async function releaseMedia(env, db, keys, prefixes) {
  const asked = [...new Set((keys || []).map(keyOf).filter(Boolean))]
    .filter((k) => prefixes.some((p) => k.startsWith(p)));
  if (!asked.length || !env.MEDIA) return 0;
  const refs = await references(db);
  let removed = 0;
  for (const k of asked) {
    if (refs.used(k)) continue;
    await env.MEDIA.delete(k);
    removed++;
  }
  return removed;
}

async function unused(env, refs, o) {
  const now = Date.now(), out = [];
  for (const prefix of o.prefixes) {
    let cursor;
    do {
      const page = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
      for (const f of page.objects) {
        if (refs.used(f.key)) continue;
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
  const refs = await references(db);
  const report = [];
  for (const o of await owners(db)) {
    try {
      const gone = await unused(env, refs, o);
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

/* POST /api/staff-media-release {keys}: an editor closing. Answers quietly;
   it is sent as a page goes away and nobody reads the reply. */
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
    if (!env.DB || !env.MEDIA) return json({ ok: true, removed: 0 });
    const { user, denied } = await requireAccess(request, env);
    if (denied) return denied;
    const db = createDb(env.DB);
    const me = await db.queryOne("user_by_email", { email: user.email });
    if (!me) return json({ error: "No account for that address" }, 403);
    const roles = String(me.roles || "").split(",");
    const partners = await db.query("partners_for_user", { email: user.email });
    const prefixes = [...(partners.length ? partnerPrefixes(partners[0]) : []),
                      ...(roles.includes("admin") || roles.includes("communications") ? ORG_PREFIXES : [])];
    const body = await readJson(request);
    const removed = await releaseMedia(env, db, Array.isArray(body && body.keys) ? body.keys.slice(0, 500) : [], prefixes);
    return json({ ok: true, removed });
  },
};
