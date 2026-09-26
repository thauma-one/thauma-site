/**
 * admin-translation-notes.js — /api/admin/translation-notes
 *
 * The notes every translator reads (see lib/translation-notes.js): words never
 * translated, fixed phrases per language, and a guide per language.
 *
 *   GET                                   every note
 *   POST { kind: "keep", term }           never translate this
 *   POST { kind: "glossary", lang, source, target, id? }
 *                                         a fixed rendering (id: correct one)
 *   POST { kind: "guide", lang, guidance }  how a language is written ('*' = all)
 *   DELETE ?kind=keep|glossary&id=…
 *
 * WHO. Reading is open to any active account: a partner translating their own
 * milestones needs the same notes as the site's editors, and nothing here is
 * private. Changing them is for administrators and communications — the
 * people who already write the site's words.
 *
 * SAVES AT ONCE, like Settings. These are not public, so there is nothing to
 * publish; the answer to every change is the whole set, so the screen always
 * shows what the database holds rather than what it hopes it holds.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson } from "./lib/store.js";
import { loadNotes, cleanLang, cleanText } from "./lib/translation-notes.js";

const WRITERS = ["admin", "communications"];

async function gate(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  }
  const roles = String(me.roles || "").split(",").filter(Boolean);
  return { db, user, me, canWrite: roles.some((r) => WRITERS.includes(r)) };
}

async function audit(db, user, action, entityId, detail) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: null,
      action,
      entity: "translation_notes",
      entity_id: entityId,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

const newId = (prefix) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export default {
  async fetch(request, env) {
    const g = await gate(request, env);
    if (g.denied) return g.denied;
    const { db, user, me, canWrite } = g;

    if (request.method === "GET") {
      return json({ ...(await loadNotes(db)), can_write: canWrite });
    }

    if (!canWrite) {
      return json({ error: "Translation notes are changed by administrators and communications." }, 403);
    }
    const now = new Date().toISOString();

    if (request.method === "POST") {
      const body = await readJson(request);
      const kind = body && body.kind;

      if (kind === "keep") {
        const term = cleanText(body.term, 80);
        if (!term) return json({ error: "A word or name, up to 80 characters." }, 400);
        const id = newId("tk_");
        await db.query("translation_keep_add", { id, term, now, user_id: me.user_id });
        await audit(db, user, "translation.keep.add", id, { term });
      } else if (kind === "glossary") {
        const lang = cleanLang(body.lang);
        if (!lang || lang === "en") return json({ error: "Which language is this phrase for?" }, 400);
        const source = cleanText(body.source, 300);
        const target = cleanText(body.target, 300);
        if (!source || !target) return json({ error: "Both the English and the translation, up to 300 characters each." }, 400);
        if (body.id) {
          const id = String(body.id);
          await db.query("translation_glossary_update", { id, source, target, now, user_id: me.user_id });
          await audit(db, user, "translation.glossary.edit", id, { lang, source, target });
        } else {
          const id = newId("tg_");
          await db.query("translation_glossary_add", { id, lang, source, target, now, user_id: me.user_id });
          await audit(db, user, "translation.glossary.add", id, { lang, source, target });
        }
      } else if (kind === "guide") {
        const lang = cleanLang(body.lang, { allowAll: true });
        if (!lang) return json({ error: "Which language is this guide for?" }, 400);
        /* Empty is allowed: clearing a guide is a real edit. */
        const guidance = String(body.guidance == null ? "" : body.guidance).trim();
        if (guidance.length > 2000) return json({ error: "A guide can be up to 2,000 characters." }, 400);
        await db.query("translation_guide_set", { lang, guidance, now, user_id: me.user_id });
        await audit(db, user, "translation.guide.set", lang, { length: guidance.length });
      } else {
        return json({ error: "Unknown kind of note." }, 400);
      }
      return json({ ok: true, ...(await loadNotes(db)), can_write: true });
    }

    if (request.method === "DELETE") {
      const url = new URL(request.url);
      const kind = url.searchParams.get("kind");
      const id = String(url.searchParams.get("id") || "");
      if (!id) return json({ error: "Which note?" }, 400);
      if (kind === "keep") {
        await db.query("translation_keep_delete", { id });
        await audit(db, user, "translation.keep.remove", id, null);
      } else if (kind === "glossary") {
        await db.query("translation_glossary_delete", { id });
        await audit(db, user, "translation.glossary.remove", id, null);
      } else {
        return json({ error: "Unknown kind of note." }, 400);
      }
      return json({ ok: true, ...(await loadNotes(db)), can_write: true });
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
