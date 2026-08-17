/**
 * staff-milestones.js — the milestone editor's backend
 *
 *   GET    /api/staff-milestones            list every milestone, published or not
 *   POST   /api/staff-milestones            create or update one
 *   DELETE /api/staff-milestones?id=…       delete one
 *   PATCH  /api/staff-milestones            reorder (ids in their new order)
 *
 * Access-gated and partner-scoped, exactly like /api/staff-snapshot: Access
 * says WHO is asking, the database decides WHAT they may touch, and the
 * partner id comes from that lookup rather than from anything the client sent.
 *
 * WHY THIS IS NOT THE PARTNER API. These are the same rows chaseroush.com
 * reads through /api/partner/v1/site, but through a completely separate door:
 * that one is key-authenticated, read-only, and filtered to is_public = 1.
 * This one is session-authenticated, writes, and deliberately returns
 * unpublished drafts. Sharing a handler between them is how a draft ends up
 * on a public website.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { json, readJson } from "./lib/store.js";

const STATUSES = new Set(["upcoming", "in_progress", "complete", "cancelled"]);

/** Resolve the caller to exactly one partner, or a denial. */
async function partnerFor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);

  /* Two questions, asked separately.

     WHO: an account can exist with no partner — an administrator, a board
     member, somebody invited and not yet placed. Resolving identity through
     partner access meant none of them had a name.

     WHICH PARTNER: these screens are partner-scoped, so they do still need
     one. The difference is that the refusal can now say which of the two is
     missing instead of "no access". */
  /* WHO THIS REQUEST COUNTS AS. Normally the signed-in person; when an
     administrator is viewing somebody else's console, that person instead.
     resolveActor re-checks the admin role on the REAL caller every time and
     falls back to the caller's own identity if anything is off — see
     lib/actas.js. Everything downstream uses actor.email, so no query in this
     file needs to know acting-as exists. */
  const actor = await resolveActor(request, env, db, user);
  const me = actor.me;
  if (!me) {
    return { denied: json({
      error: "This address is not an active account.", email: user.email }, 403) };
  }

  const partners = await db.query("partners_for_user", { email: actor.email });
  if (!partners.length) {
    return { denied: json({
      error: "This account is not attached to a partner yet, so there is " +
             "nothing here to show. An administrator can grant access.",
      email: user.email,
      you: { email: user.email, name: me.user_name,
             roles: String(me.roles || "").split(",").filter(Boolean) },
    }, 403) };
  }
  const partner = partners[0];
  return { db, partner, user, me, actor };
}

/**
 * Coerce and check one milestone from the client.
 *
 * Returns { value } or { error }. Everything is validated here rather than
 * trusted from the form, because the form is not the only thing that can post
 * to this endpoint.
 */
function clean(body, existingIds) {
  const str = (v, max = 4000) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s.slice(0, max);
  };

  const status = String(body.status || "upcoming");
  if (!STATUSES.has(status)) {
    return { error: `status must be one of: ${[...STATUSES].join(", ")}` };
  }

  let completion = Number(body.completion);
  if (!Number.isFinite(completion)) completion = 0;
  completion = Math.max(0, Math.min(100, Math.round(completion)));

  // A date the database will accept. Anything else is rejected rather than
  // silently stored, because "2027" and "next spring" both look fine in a
  // text box and neither sorts.
  const actual_date = str(body.actual_date, 10);
  if (actual_date && !/^\d{4}-\d{2}-\d{2}$/.test(actual_date)) {
    return { error: "actual_date must be YYYY-MM-DD, or empty" };
  }

  const parent_id = str(body.parent_id, 64);
  if (parent_id && parent_id === body.id) {
    return { error: "A milestone cannot be its own parent" };
  }
  if (parent_id && existingIds && !existingIds.has(parent_id)) {
    return { error: "That parent milestone does not exist" };
  }

  // TEXT IS NOT HERE. Titles and descriptions live in milestone_translations,
  // one row per language, and are validated by cleanText() below. Keeping the
  // two apart is what lets a language be added without touching this function.
  return {
    value: {
      parent_id,
      actual_date,
      status,
      completion,
      // Publication is explicit. Anything other than a literal true is false —
      // a missing or malformed flag must not publish a draft.
      is_public: body.is_public === true || body.is_public === 1 ? 1 : 0,
      is_featured: body.is_featured === true || body.is_featured === 1 ? 1 : 0,
      sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    },
  };
}

/**
 * Validate the per-language text.
 *
 * `text` arrives as { en: {title, description, target_label}, hr: {...} }.
 * Language codes are checked against the catalogue rather than a list in this
 * file — adding Portuguese is a row in `languages`, and this keeps working.
 *
 * At least one language must have a title. A milestone with no text in any
 * language is not a draft, it is an empty row nothing can render.
 */
function cleanText(text, validCodes) {
  if (text === undefined || text === null) return { value: {} };
  if (typeof text !== "object" || Array.isArray(text)) {
    return { error: "text must be an object keyed by language code" };
  }

  const out = {};
  for (const [lang, fields] of Object.entries(text)) {
    if (!validCodes.has(lang)) {
      return { error: `"${lang}" is not a language this organisation offers` };
    }
    if (!fields || typeof fields !== "object") {
      return { error: `text.${lang} must be an object` };
    }
    const title = fields.title == null ? "" : String(fields.title).trim();
    // An empty title means "remove this translation", handled by the caller.
    // Storing an empty row would make "not translated" and "translated to
    // nothing" indistinguishable, and the editor needs to tell them apart.
    out[lang] = {
      title: title.slice(0, 200),
      description: fields.description == null ? null
        : String(fields.description).trim().slice(0, 4000) || null,
      target_label: fields.target_label == null ? null
        : String(fields.target_label).trim().slice(0, 120) || null,
    };
  }
  return { value: out };
}

/** Ids are generated server-side so a client cannot choose one. */
function newId() {
  return "m_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

/** milestones + their translations, assembled into one list. */
async function listWithText(db, partner_id) {
  const [rows, tx] = await Promise.all([
    db.query("milestones_for_staff", { partner_id }),
    db.query("milestone_translations_for_staff", { partner_id }),
  ]);
  const byId = {};
  for (const r of tx) {
    (byId[r.milestone_id] ||= {})[r.lang] = {
      title: r.title, description: r.description, target_label: r.target_label,
    };
  }
  return rows.map((m) => ({
    ...m,
    is_public: !!m.is_public,
    is_featured: !!m.is_featured,
    text: byId[m.id] || {},
  }));
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, actor, denied } = await partnerFor(request, env);
    if (denied) return denied;

    /* Recorded before the handler runs, so a change is logged even if the
       handler then fails. One call, at the one place every method passes
       through — a per-write approach has to be remembered by whoever adds the
       next write, and eventually is not. */
    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const now = new Date().toISOString();
    const url = new URL(request.url);

    // ---- list ----
    if (request.method === "GET") {
      const [milestones, languages] = await Promise.all([
        listWithText(db, partner_id),
        db.query("partner_languages_for_partner", { partner_id }),
      ]);
      return json(withActing({
        // The same identity block every staff endpoint returns, so the header
        // can be filled from whatever request a page was already making.
        you: {
          email: user.email,
          name: me.user_name || null,
          roles: String(me.roles || "staff").split(","),
        },
        partner: { id: partner.id, display_name: partner.display_name },
        // The editor opens in this person's own language rather than always
        // English. NULL in the database means English, resolved in SQL.
        preferred_lang: me.preferred_lang || "en",
        // The editor renders a column per language from THIS, never from a
        // hard-coded list. Disabled ones are included so text can be prepared
        // before it is switched on.
        languages: languages.map((l) => ({ ...l, is_enabled: !!l.is_enabled })),
        milestones,
      }, actor));
    }

    // ---- create or update ----
    if (request.method === "POST") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const [existing, langs] = await Promise.all([
        db.query("milestones_for_staff", { partner_id }),
        db.query("languages_all", {}),
      ]);
      const ids = new Set(existing.map((m) => m.id));
      const codes = new Set(langs.filter((l) => l.is_active).map((l) => l.code));

      const isNew = !body.id || !ids.has(body.id);
      const id = isNew ? newId() : body.id;

      const { value, error } = clean({ ...body, id }, ids);
      if (error) return json({ error }, 400);

      const { value: text, error: textError } = cleanText(body.text, codes);
      if (textError) return json({ error: textError }, 400);

      // Every milestone needs a title in at least one language, otherwise it
      // is not a draft — it is a row nothing can ever render.
      const titled = Object.values(text).filter((v) => v.title);
      if (isNew && !titled.length) {
        return json({ error: "A title is required in at least one language" }, 400);
      }

      // New rows go to the end rather than position 0, so creating one never
      // silently reshuffles a list somebody just ordered.
      if (isNew && !body.sort_order) {
        value.sort_order = existing.length
          ? Math.max(...existing.map((m) => m.sort_order || 0)) + 1
          : 0;
      }

      await db.query("milestone_upsert", { ...value, id, partner_id, now });

      // Then the text, one language at a time. An emptied title DELETES that
      // translation rather than storing a blank one, so "not translated yet"
      // stays distinguishable from "translated to nothing".
      for (const [lang, fields] of Object.entries(text)) {
        if (fields.title) {
          await db.query("milestone_translation_upsert", {
            milestone_id: id, lang, partner_id, now, ...fields,
          });
        } else {
          await db.query("milestone_translation_delete", {
            milestone_id: id, lang, partner_id,
          });
        }
      }

      const all = await listWithText(db, partner_id);
      return json({ saved: all.find((m) => m.id === id), created: isNew });
    }

    // ---- delete ----
    if (request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "id is required" }, 400);
      // Translations follow via ON DELETE CASCADE.
      await db.query("milestone_delete", { id, partner_id });
      return json({ deleted: id });
    }

    // ---- reorder, or switch a language on/off ----
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      if (Array.isArray(body.order)) {
        // Positions come from this array's order, not from the client's
        // numbers, so duplicate or sparse values cannot corrupt the sequence.
        for (let i = 0; i < body.order.length; i++) {
          await db.query("milestone_reorder", {
            id: String(body.order[i]), partner_id, sort_order: i, now,
          });
        }
        return json({ reordered: body.order.length });
      }

      if (body.language) {
        const langs = await db.query("languages_all", {});
        const known = langs.find((l) => l.code === body.language);
        if (!known) return json({ error: "Unknown language" }, 400);
        // A partner switching THEIR OWN publishing on or off. Adding a
        // language to the catalogue is an admin action and not this endpoint.
        await db.query("partner_language_set", {
          partner_id,
          lang: body.language,
          is_enabled: body.is_enabled ? 1 : 0,
          sort_order: Number.isFinite(Number(body.sort_order))
            ? Number(body.sort_order) : known.sort_order,
        });
        const languages = await db.query("partner_languages_for_partner", { partner_id });
        return json({ languages: languages.map((l) => ({ ...l, is_enabled: !!l.is_enabled })) });
      }

      return json({ error: "Expected { order: [...] } or { language, is_enabled }" }, 400);
    }

    return json({ error: "Method not allowed" }, 405, {
      Allow: "GET, POST, DELETE, PATCH",
    });
  },
};
