/**
 * staff-prayer.js — prayer requests, and the answers when they come
 *
 *   GET    /api/staff-prayer          every request, with text per language
 *   POST   /api/staff-prayer          create or update one
 *   DELETE /api/staff-prayer?id=…     remove one
 *
 * Modelled on the milestone editor because it is the same shape: a
 * language-neutral row carrying the state, and one translation row per
 * language. Nothing here is novel except what a prayer IS.
 *
 * ANSWERED IS NOT A STATUS
 * ---------------------------------------------------------------------------
 * Milestones have a status because work moves through stages. A prayer does
 * not: it is being asked, or it has been answered. Modelling that as an enum
 * would invite "in progress", which is not a thing anybody means about prayer.
 *
 * What an answer DOES deserve is its own words. `answer_text` is per language
 * alongside the request itself, because "answered" with no account of how is
 * a badge rather than a testimony — and the account is usually the reason a
 * ministry publishes the list at all.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

const MAX_TITLE = 160;
const MAX_BODY = 2000;

function newId() {
  return "pr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

async function partnerFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) return { denied: json({ error: "This address is not an active account." }, 403) };

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet.",
    }, 403) };
  }
  return { db, user, me, partner: partners[0], actor };
}

/** The language-neutral half. */
export function cleanPrayer(body) {
  const is_answered = body.is_answered ? 1 : 0;

  let answered_on = null;
  if (is_answered && body.answered_on) {
    const d = String(body.answered_on).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      return { error: "The date answered must look like 2026-08-18." };
    }
    answered_on = d;
  }

  const sort_order = Number.isFinite(Number(body.sort_order)) ? Math.round(Number(body.sort_order)) : 0;

  return {
    value: {
      is_public: body.is_public ? 1 : 0,
      is_answered,
      /* Cleared when un-answering, so a request that was marked answered by
         mistake does not keep a date that now means nothing. */
      answered_on,
      sort_order,
    },
  };
}

/** Text per language. Same contract as the milestone editor's. */
export function cleanPrayerText(text, validCodes) {
  if (text == null) return { value: {} };
  if (typeof text !== "object" || Array.isArray(text)) {
    return { error: "Text must be an object keyed by language." };
  }

  const out = {};
  for (const [lang, v] of Object.entries(text)) {
    if (!validCodes.has(lang)) return { error: `Unknown language: ${lang}` };
    if (v == null || typeof v !== "object") return { error: `Text for ${lang} is not an object.` };

    const title = String(v.title || "").trim();
    const description = v.description == null ? null : String(v.description).trim() || null;
    const answer_text = v.answer_text == null ? null : String(v.answer_text).trim() || null;

    if (title.length > MAX_TITLE) return { error: `The ${lang} title is too long.` };
    for (const [name, s] of [["description", description], ["answer", answer_text]]) {
      if (s && s.length > MAX_BODY) return { error: `The ${lang} ${name} is too long.` };
    }

    out[lang] = { title, description, answer_text };
  }
  return { value: out };
}

async function listWithText(db, partner_id) {
  const [rows, tx] = await Promise.all([
    db.query("prayer_for_staff", { partner_id }),
    db.query("prayer_translations_for_staff", { partner_id }),
  ]);

  const byId = {};
  for (const t of tx) {
    (byId[t.prayer_id] ||= {})[t.lang] = {
      title: t.title, description: t.description, answer_text: t.answer_text,
    };
  }

  return rows.map((p) => ({
    id: p.id,
    is_public: !!p.is_public,
    is_answered: !!p.is_answered,
    answered_on: p.answered_on,
    sort_order: p.sort_order,
    text: byId[p.id] || {},
  }));
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, actor, denied } = await partnerFor(request, env);
    if (denied) return denied;

    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const now = new Date().toISOString();

    if (request.method === "GET") {
      const [prayer, languages] = await Promise.all([
        listWithText(db, partner_id),
        db.query("partner_languages_for_partner", { partner_id }),
      ]);
      return json(withActing({
        you: {
          email: user.email,
          name: me.user_name || null,
          roles: String(me.roles || "staff").split(","),
        },
        partner: { id: partner.id, display_name: partner.display_name },
        preferred_lang: me.preferred_lang || "en",
        languages: languages.map((l) => ({ ...l, is_enabled: !!l.is_enabled })),
        prayer,
      }, actor));
    }

    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const [existing, langs] = await Promise.all([
        db.query("prayer_for_staff", { partner_id }),
        db.query("languages_all", {}),
      ]);
      const ids = new Set(existing.map((p) => p.id));
      const codes = new Set(langs.filter((l) => l.is_active).map((l) => l.code));

      const isNew = !body.id || !ids.has(body.id);
      const id = isNew ? newId() : body.id;

      const { value, error } = cleanPrayer(body);
      if (error) return json({ error }, 400);

      const { value: text, error: textError } = cleanPrayerText(body.text, codes);
      if (textError) return json({ error: textError }, 400);

      const titled = Object.values(text).filter((v) => v.title);
      if (isNew && !titled.length) {
        return json({ error: "A prayer request needs a title in at least one language." }, 400);
      }

      await db.query("prayer_upsert", { id, partner_id, now, ...value });

      /* The row must exist before its translations: the trigger checks that a
         translation's partner matches its prayer's, and there is no prayer to
         match against until the upsert above has run. */
      for (const [lang, v] of Object.entries(text)) {
        if (!v.title) {
          await db.query("prayer_translation_delete", { prayer_id: id, lang, partner_id });
          continue;
        }
        await db.query("prayer_translation_upsert", {
          prayer_id: id, lang, partner_id, now,
          title: v.title, description: v.description, answer_text: v.answer_text,
        });
      }

      return json(withActing({
        id, created: isNew, prayer: await listWithText(db, partner_id),
      }, actor));
    }

    if (request.method === "DELETE") {
      const id = new URL(request.url).searchParams.get("id");
      if (!id) return json({ error: "No prayer named." }, 400);

      await db.query("prayer_delete", { id, partner_id });
      return json(withActing({
        deleted: id, prayer: await listWithText(db, partner_id),
      }, actor));
    }

    return json({ error: `${request.method} is not supported here.` }, 405);
  },
};
