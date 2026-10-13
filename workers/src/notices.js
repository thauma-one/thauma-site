/**
 * notices — the console's bell (0060, 0061)
 *
 *   GET  /api/notices            { unread, items }  the bell's list
 *   GET  /api/notices?past       { unread, items }  Past notifications
 *   GET  /api/notices?count      { unread } — what the header asks every few minutes
 *   POST /api/notices            { read: "all" } | { clear: "all" } | { clear: "<id>" }
 *   items: [{ id, kind, summary, link, at, read }] — one line each, and where it opens
 *
 * Chase, 2026-10-13: "Add the in app notifications bell." The notices are the
 * same list email uses (lib/notify.js); a row is written for each person who
 * keeps that notice's bell switched on. The words are rendered HERE, when the
 * bell is opened, in the reader's console language at that moment — so a
 * notice reads in the language you read the console in, not the one you had
 * when it happened.
 *
 * CLEARED, NOT GONE (0061; "a way for bell notifications to be cleared from
 * the dropdown, but … they can still find past notifications … it clears
 * automatically, but not immediately … a 6 hour timer"). The list holds what
 * is unread and what was read in the last SIX HOURS and not cleared; the
 * rest — cleared by hand, or read longer ago — is Past, for a year. Before
 * 0061 the list is everything, as under 0060, and clearing says so.
 *
 * ALWAYS THE PERSON SIGNED IN. An administrator acting as somebody else still
 * sees their own bell: notices are about what reached YOU, and showing
 * somebody else's would be reading their post.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { json, readJson } from "./lib/store.js";
import { noticeWords } from "./lib/notify.js";

/* a notice read this long ago leaves the list for Past by itself */
export const KEEP_READ_MS = 6 * 3600 * 1000;

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

    const now = new Date().toISOString();
    const since = new Date(Date.now() - KEEP_READ_MS).toISOString();

    if (request.method === "POST") {
      const body = await readJson(request);
      if (body && body.read === "all") {
        await db.query("notices_read_all", { user_id: me.user_id, now }).catch(() => {});
        return json({ unread: await unread() });
      }
      if (body && typeof body.clear === "string" && body.clear) {
        try {
          if (body.clear === "all") await db.query("notices_clear_all", { user_id: me.user_id, now });
          else await db.query("notice_clear", { id: body.clear, user_id: me.user_id, now });
        } catch {
          return json({ error: "This cannot be kept until the database is updated (Review and publish › Apply changes)." }, 409);
        }
        return json({ unread: await unread() });
      }
      return json({ error: "Nothing to do" }, 400);
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });

    const url = new URL(request.url);
    if (url.searchParams.has("count")) return json({ unread: await unread() });

    const past = url.searchParams.has("past");
    let rows = [];
    try { rows = await db.query(past ? "notices_past" : "notices_current", { user_id: me.user_id, since }); }
    catch {
      /* before 0061: the list is everything, and nothing is past */
      try { rows = past ? [] : await db.query("notices_for_user", { user_id: me.user_id }); } catch { rows = []; }
    }
    const lang = me.preferred_lang || "en";
    const items = rows.map((r) => {
      let vars = {};
      try { vars = JSON.parse(r.vars || "{}") || {}; } catch { vars = {}; }
      const w = noticeWords(r.kind, lang, vars);
      return { id: r.id, kind: r.kind, summary: w.summary,
               link: /^\/(?!\/)/.test(r.link || "") ? r.link : null, at: r.created_at, read: !!r.read_at };
    });
    return json({ unread: await unread(), items });
  },
};
