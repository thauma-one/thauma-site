/**
 * notices — the console's bell (0060)
 *
 *   GET  /api/notices            { unread, items: [{ id, kind, heading, body, note, link, at, read }] }
 *   GET  /api/notices?count      { unread } — what the header asks every few minutes
 *   POST /api/notices            { read: "all" } marks everything read
 *
 * Chase, 2026-10-13: "Add the in app notifications bell." The notices are the
 * same list email uses (lib/notify.js); a row is written for each person who
 * keeps that notice's bell switched on. The words are rendered HERE, when the
 * bell is opened, in the reader's console language at that moment — so a
 * notice reads in the language you read the console in, not the one you had
 * when it happened.
 *
 * ALWAYS THE PERSON SIGNED IN. An administrator acting as somebody else still
 * sees their own bell: notices are about what reached YOU, and showing
 * somebody else's would be reading their post.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { json, readJson } from "./lib/store.js";
import { noticeWords } from "./lib/notify.js";

export default {
  async fetch(request, env) {
    const gate = await requireAccess(request, env);
    if (gate.denied) return gate.denied;
    if (!env.DB) return json({ error: "No database bound to this deploy" }, 500);
    const db = createDb(env.DB);
    const me = await db.queryOne("user_by_email", { email: gate.user.email });
    if (!me) return json({ error: "No account for that address" }, 403);

    /* No table yet (0060 not applied): an empty bell, not an error. */
    const unread = async () => {
      try { return Number((await db.queryOne("notices_unread_count", { user_id: me.user_id })).n) || 0; }
      catch { return 0; }
    };

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body || body.read !== "all") return json({ error: "Nothing to do" }, 400);
      await db.query("notices_read_all", { user_id: me.user_id, now: new Date().toISOString() }).catch(() => {});
      return json({ unread: await unread() });
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });

    const url = new URL(request.url);
    if (url.searchParams.has("count")) return json({ unread: await unread() });

    let rows = [];
    try { rows = await db.query("notices_for_user", { user_id: me.user_id }); } catch { rows = []; }
    const lang = me.preferred_lang || "en";
    const items = rows.map((r) => {
      let vars = {};
      try { vars = JSON.parse(r.vars || "{}") || {}; } catch { vars = {}; }
      const w = noticeWords(r.kind, lang, vars);
      return { id: r.id, kind: r.kind, heading: w.heading, body: w.body, note: w.note,
               link: /^\/[^/]/.test(r.link || "") ? r.link : null, at: r.created_at, read: !!r.read_at };
    });
    return json({ unread: await unread(), items });
  },
};
