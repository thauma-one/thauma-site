/**
 * staff-settings.js — the Settings screen's backend
 *
 *   GET   /api/staff-settings          everything the screen needs, in one call
 *   PATCH /api/staff-settings          change one setting
 *   POST  /api/staff-settings          mint an API key
 *
 * TWO LEVELS OF SETTING, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *   PERSONAL   users.preferred_lang — which language the editor opens in.
 *              Anyone changes their own; nobody changes anyone else's.
 *
 *   PARTNER    partner_languages and API keys — these change what a public
 *              website serves, and belong to whoever holds the partner.
 *
 *   ADMIN      partners.default_lang is deliberately NOT settable here. It
 *              decides what every visitor sees before choosing, there can be
 *              several administrators, and no public setting should move
 *              because somebody changed the language of their own console.
 *              It belongs on an admin screen. Until that exists it stays at
 *              its stored value.
 *
 * Every write is written to audit_log. The log is append-only by trigger, so
 * this endpoint can add to the record of who changed what and cannot edit it.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { resolveActor, auditActingWrite, withActing } from "./lib/actas.js";
import { hashKey, partsOf, scopesFor } from "./lib/apikey.js";
import { TURNS } from "./embed-colour.js";

/* A key as the screen shows it: what it may read, never its hash. */
const keyRows = (keys) => keys.map((k) => ({ ...k, revoked: !!k.revoked_at, parts: partsOf(k.scopes) }));

/* The six things on Sharing, each of which may wear its own look (0040). */
const LOOK_KINDS = ["roadmap", "goal", "prayer", "videos", "signup", "contact"];
/* embed_looks rows as { kind: {accent, accent2, turn, theme} }. */
const lookRows = (rows) => {
  const out = {};
  (rows || []).forEach((r) => {
    out[r.kind] = { accent: r.accent || null, accent2: r.accent2 || null,
                    turn: r.turn != null ? r.turn : null, theme: r.theme || null };
  });
  return out;
};
import { json, readJson } from "./lib/store.js";

/** Resolve the caller to a partner and a role, or a denial. */
async function context(request, env) {
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
             "nothing here to show. An administrator can grant access." +
             " Roles on the People page are org-wide and grant nothing " +
             "here; the partner itself is granted separately, on that " +
             "person's row.",
      email: user.email,
      you: { email: user.email, name: me.user_name,
             roles: String(me.roles || "").split(",").filter(Boolean) },
    }, 403) };
  }
  const partner = partners[0];

  // 0006 moved roles to user_roles; a person may hold more than one.
  const roles = String(me.roles || "staff").split(",");
  return {
    db, user, me, partner, actor,
    // Org authority. NOT partner access — that is what partners_for_user
    // just established. See docs/SPEC.md §4.
    roles, isAdmin: roles.includes("admin"),
  };
}

/** Append to the record. Never throws into the caller: a settings change that
 *  succeeded must not report failure because the note about it failed. */
async function audit(db, { user, partner, action, entity, entity_id = null, detail = null }) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: partner.id,
      action, entity, entity_id,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

export default {
  async fetch(request, env) {
    const { db, user, me, partner, roles, isAdmin, actor, denied } = await context(request, env);
    if (denied) return denied;

    /* Recorded before the handler runs, so a change is logged even if the
       handler then fails. One call, at the one place every method passes
       through — a per-write approach has to be remembered by whoever adds the
       next write, and eventually is not. */
    await auditActingWrite(request, db, actor);

    const partner_id = partner.id;
    const now = new Date().toISOString();

    /* ---------------------------------------------------------------- GET */
    if (request.method === "GET") {
      const [languages, settings, keys, looks] = await Promise.all([
        db.query("partner_languages_for_partner", { partner_id }),
        db.queryOne("partner_settings", { partner_id }),
        db.query("api_keys_for_partner", { partner_id }),
        db.query("embed_looks_for_partner", { partner_id }),
      ]);
      return json(withActing({
        you: {
          email: user.email,
          // From the database, not from Access: the console controls this
          // value, and Access does not always carry a name at all.
          name: me.user_name || null,
          preferred_lang: me.preferred_lang || "en",
          roles,
          is_admin: isAdmin,
          // What this account may do, decided here rather than in the browser.
          // The UI hides what it cannot do; the endpoint refuses it.
          can: { set_default_lang: isAdmin },
        },
        partner: {
          id: partner.id,
          display_name: partner.display_name,
          /* owner / assist / view — how YOU are on it, for "What you can do"
             ("Chase Roush · owner", board "Settings, just you"). */
          access_role: partner.access_role || null,
          default_lang: settings ? settings.default_lang : "en",
          /* The slug is in the embed snippet, so the panel cannot build the
             code to copy without it. Not sensitive — it is already in every
             public URL this partner has. */
          slug: settings ? settings.slug : null,
        },
        embed: {
          enabled: settings ? !!settings.embed_enabled : false,
          accent: (settings && settings.embed_accent) || null,
          /* NULL means "derive it from the first". The panel shows the derived
             value so the pair is never displayed half-chosen. */
          accent2: (settings && settings.embed_accent2) || null,
          /* Degrees round the wheel to the second color; NULL is -33 (0040). */
          turn: settings && settings.embed_turn != null ? settings.embed_turn : null,
          theme: (settings && settings.embed_theme) || "auto",
          /* The embeds that depart from the above, by kind (0040). */
          looks: lookRows(looks),
          /* Each widget on its own (0038). `enabled` is "any of them". */
          shared: {
            roadmap: !!(settings && settings.embed_roadmap),
            goal: !!(settings && settings.embed_goal),
            prayer: !!(settings && settings.embed_prayer),
            videos: !!(settings && settings.embed_videos),
          },
        },
        timeline: {
          start: (settings && settings.timeline_start) || null,
          end: (settings && settings.timeline_end) || null,
        },
        languages: languages.map((l) => ({ ...l, is_enabled: !!l.is_enabled })),
        api_keys: keyRows(keys),
      }, actor));
    }

    /* -------------------------------------------------------------- PATCH */
    if (request.method === "PATCH") {
      const body = await readJson(request);
      if (!body) return json({ error: "Invalid JSON" }, 400);

      const known_languages = await db.query("languages_all", {});
      const codes = new Set(known_languages.filter((l) => l.is_active).map((l) => l.code));

      // --- personal: your own language. NOTHING ELSE. ---
      //
      // This briefly also set the site's default language for admins, on the
      // reasoning that one control was simpler than two. That was wrong and
      // the reason is worth keeping: there can be several administrators, so
      // tying a public setting to a personal one means whichever admin last
      // changed their console decides what visitors see. A site-wide default
      // belongs on an admin screen, set deliberately and once.
      if (body.preferred_lang !== undefined) {
        const lang = body.preferred_lang;
        if (!codes.has(lang)) return json({ error: "Unknown language" }, 400);
        await db.query("user_set_preferred_lang", { email: user.email, lang });
        await audit(db, { user, partner, action: "update", entity: "user.preferred_lang",
                          entity_id: user.email, detail: { lang } });
        return json({ preferred_lang: lang });
      }

      // --- partner: which languages this site publishes ---
      if (body.language !== undefined) {
        if (!codes.has(body.language)) return json({ error: "Unknown language" }, 400);
        const enabled = body.is_enabled ? 1 : 0;

        // Refusing to switch off the language the site falls back to. Doing so
        // would leave a visitor with whatever translation happened to exist,
        // or nothing at all, and the failure would appear on the public site
        // rather than here.
        const settings = await db.queryOne("partner_settings", { partner_id });
        const fallback = settings ? settings.default_lang : "en";
        if (!enabled && body.language === fallback) {
          return json({
            error: `${body.language.toUpperCase()} is the site's default language and cannot ` +
                   `be switched off. Change the default first.`,
          }, 400);
        }

        const current = known_languages.find((l) => l.code === body.language);
        await db.query("partner_language_set", {
          partner_id, lang: body.language, is_enabled: enabled,
          sort_order: current ? current.sort_order : 0,
        });
        await audit(db, { user, partner, action: enabled ? "enable" : "disable",
                          entity: "partner_language", entity_id: body.language });
        const languages = await db.query("partner_languages_for_partner", { partner_id });
        return json({ languages: languages.map((l) => ({ ...l, is_enabled: !!l.is_enabled })) });
      }

      // --- partner, ADMIN ONLY: the site's default language ---
      if (body.default_lang !== undefined) {
        if (!isAdmin) {
          return json({
            error: "Only an administrator can change the site's default language.",
          }, 403);
        }
        if (!codes.has(body.default_lang)) return json({ error: "Unknown language" }, 400);

        // The default has to be a language the site actually publishes, or
        // the fallback points at nothing.
        const langs = await db.query("partner_languages_for_partner", { partner_id });
        const target = langs.find((l) => l.code === body.default_lang);
        if (!target || !target.is_enabled) {
          return json({
            error: `${body.default_lang.toUpperCase()} is not switched on for this site. ` +
                   `Enable it before making it the default.`,
          }, 400);
        }

        await db.query("partner_set_default_lang", { partner_id, lang: body.default_lang, now });
        await audit(db, { user, partner, action: "update", entity: "partner.default_lang",
                          detail: { lang: body.default_lang } });
        return json({ default_lang: body.default_lang });
      }

      /* --- the roadmap's period, ADMIN ONLY ---
         What the timeline is drawn against. Without it a roadmap spans only
         its own milestones, so the last dated entry always sits at the end and
         the whole arc reads as finished the moment it passes. Public-facing,
         so the same gate as everything else that changes what visitors see. */
      if (body.timeline !== undefined) {
        if (!isAdmin) {
          return json({ error: "Only an administrator can change the roadmap's period." }, 403);
        }
        const t = body.timeline || {};
        const day = /^\d{4}-\d{2}-\d{2}$/;

        const start = t.start ? String(t.start).trim() : null;
        const end = t.end ? String(t.end).trim() : null;
        for (const [name, v] of [["start", start], ["end", end]]) {
          if (v && !day.test(v)) {
            return json({ error: `The ${name} date must look like 2026-08-18.` }, 400);
          }
        }
        /* Both or neither, and in order. One bound alone cannot describe a
           period, and a backwards pair would divide by a negative. */
        if ((start && !end) || (end && !start)) {
          return json({ error: "A period needs both a start and an end." }, 400);
        }
        if (start && end && !(start < end)) {
          return json({ error: "The end must come after the start." }, 400);
        }

        await db.query("partner_set_timeline", {
          partner_id, timeline_start: start, timeline_end: end, now,
        });
        await audit(db, { user, partner, action: "update", entity: "partner.timeline",
                          detail: { start, end } });
        return json({ timeline: { start, end } });
      }

      /* --- the embed panel, ADMIN ONLY ---
         Turning embeds on makes this partner readable by anyone on the
         internet with no credential at all. That is a publication decision
         about the whole ministry, not a preference, and it is the same
         reasoning that keeps the site's default language admin-only. */
      if (body.embed !== undefined) {
        if (!isAdmin) {
          return json({ error: "Only an administrator can change embed settings." }, 403);
        }
        const e = body.embed || {};

        /* Validated HERE because SQLite cannot: a CHECK constraint testing
           only the length would pass '#zzzzzz'. This value is written into a
           stylesheet in a stranger's browser. */
        const hex = (v) => {
          if (v === null || v === undefined || v === "") return { ok: true, value: null };
          if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) return { ok: false };
          return { ok: true, value: String(v).toUpperCase() };
        };

        const a1 = hex(e.accent), a2 = hex(e.accent2);
        if (!a1.ok || !a2.ok) {
          return json({ error: "A color must be a six-digit hex code, like #6D4AFF." }, 400);
        }
        const accent = a1.value;
        const accent2 = a2.value;

        const theme = String(e.theme || "auto");
        if (!["auto", "light", "dark"].includes(theme)) {
          return json({ error: "Theme must be auto, light or dark." }, 400);
        }
        const turnOf = (v) => (v === null || v === undefined || v === "" ? { ok: true, value: null }
          : TURNS.includes(Number(v)) ? { ok: true, value: Number(v) } : { ok: false });

        /* AN EMBED'S OWN LOOK (0040): { kind: {accent, accent2, turn, theme} }
           for each embed the save touches; null puts one back on the
           ministry's colors and background. A kind not mentioned is left. */
        const looks = [];
        if (e.looks && typeof e.looks === "object") {
          for (const [kind, v] of Object.entries(e.looks)) {
            if (!LOOK_KINDS.includes(kind)) return json({ error: "Unknown embed: " + kind }, 400);
            if (v === null) { looks.push({ kind, clear: true }); continue; }
            const la = hex(v.accent), lb = hex(v.accent2), lt = turnOf(v.turn);
            if (!la.ok || !lb.ok) return json({ error: "A color must be a six-digit hex code, like #6D4AFF." }, 400);
            if (!lt.ok) return json({ error: "The second color sits -33, 120 or 180 degrees away, or is chosen." }, 400);
            const lm = v.theme === null || v.theme === undefined ? null : String(v.theme);
            if (lm !== null && !["auto", "light", "dark"].includes(lm)) {
              return json({ error: "Theme must be auto, light or dark." }, 400);
            }
            /* A look with neither its own colors nor its own background is no
               look at all. */
            if (!la.value && !lm) { looks.push({ kind, clear: true }); continue; }
            looks.push({ kind, accent: la.value, accent2: la.value ? lb.value : null,
                         turn: la.value ? lt.value : null, theme: lm });
          }
        }

        /* EACH WIDGET ON ITS OWN (0038, the Sharing page). `shared` names
           the four. A save that does not mention them — a screen saving only
           a color — keeps them exactly as they are; one that flips only the
           old single `enabled` switches all four together, as it always did.
           `enabled` is then stored as "any of the four", which is what the
           public route's gate reads. */
        const WIDGETS = ["roadmap", "goal", "prayer", "videos"];
        const now_ = await db.queryOne("partner_settings", { partner_id });
        /* A save that does not mention the turn keeps it. */
        let turn = now_ && now_.embed_turn != null ? now_.embed_turn : null;
        if ("turn" in e) {
          const t = turnOf(e.turn);
          if (!t.ok) return json({ error: "The second color sits -33, 120 or 180 degrees away, or is chosen." }, 400);
          turn = t.value;
        }
        const was = {};
        WIDGETS.forEach((w) => { was[w] = !!(now_ && now_["embed_" + w]); });
        const wasOn = !!(now_ && now_.embed_enabled);
        let shared;
        if (e.shared && typeof e.shared === "object") {
          shared = {};
          WIDGETS.forEach((w) => { shared[w] = w in e.shared ? !!e.shared[w] : was[w]; });
        } else if (e.enabled !== undefined && !!e.enabled !== wasOn) {
          shared = {};
          WIDGETS.forEach((w) => { shared[w] = !!e.enabled; });
        } else {
          shared = was;
        }
        const enabled = WIDGETS.some((w) => shared[w]) ? 1 : 0;

        await db.query("partner_set_embed", {
          partner_id, embed_enabled: enabled, embed_accent: accent,
          embed_accent2: accent2, embed_turn: turn, embed_theme: theme, now,
          embed_roadmap: shared.roadmap ? 1 : 0, embed_goal: shared.goal ? 1 : 0,
          embed_prayer: shared.prayer ? 1 : 0, embed_videos: shared.videos ? 1 : 0,
        });
        /* Audited as a publication decision, with the state it moved TO —
           "who made this readable by the world, and when" is the first
           question anybody asks about an unauthenticated endpoint. */
        for (const l of looks) {
          if (l.clear) await db.query("embed_look_clear", { partner_id, kind: l.kind });
          else await db.query("embed_look_set", { partner_id, kind: l.kind, accent: l.accent,
                                                  accent2: l.accent2, turn: l.turn, theme: l.theme, now });
        }
        const lookNow = lookRows(await db.query("embed_looks_for_partner", { partner_id }));
        await audit(db, { user, partner, action: "update", entity: "partner.embed",
                          detail: { enabled: !!enabled, shared, accent, accent2, turn, theme, looks: lookNow } });
        return json({ embed: { enabled: !!enabled, shared, accent, accent2, turn, theme, looks: lookNow } });
      }

      // --- revoke a key ---
      /* WHAT A KEY MAY READ, changed after it was made. */
      if (body.key_parts && body.key_parts.id) {
        const scopes = scopesFor(body.key_parts.parts);
        if (!scopes) return json({ error: "A key has to be able to read something — revoke it instead." }, 400);
        await db.query("api_key_set_scopes", { id: String(body.key_parts.id), partner_id, scopes });
        await audit(db, { user, partner, action: "update", entity: "api_key",
                          entity_id: String(body.key_parts.id), detail: { scopes } });
        const keys = await db.query("api_keys_for_partner", { partner_id });
        return json({ api_keys: keyRows(keys) });
      }

      if (body.revoke_key) {
        await db.query("api_key_revoke", { id: String(body.revoke_key), partner_id, now });
        await audit(db, { user, partner, action: "revoke", entity: "api_key",
                          entity_id: String(body.revoke_key) });
        const keys = await db.query("api_keys_for_partner", { partner_id });
        return json({ api_keys: keyRows(keys) });
      }

      return json({ error: "Nothing to change" }, 400);
    }

    /* --------------------------------------------------------------- POST */
    // Mint an API key. Generated here, shown once, stored only as a hash —
    // there is no way to retrieve it later, by design. See lib/apikey.js.
    if (request.method === "POST") {
      const body = await readJson(request);
      const name = String((body && body.name) || "").trim().slice(0, 80);
      if (!name) return json({ error: "Give the key a name so it can be recognized later" }, 400);
      /* WHAT IT MAY READ, chosen when it is made. A request that names no
         parts (an older screen) gets everything, as every key did before. */
      const scopes = Array.isArray(body.parts) ? scopesFor(body.parts) : "read:public";
      if (!scopes) return json({ error: "Choose at least one thing the key may read." }, 400);

      const raw = [...crypto.getRandomValues(new Uint8Array(32))]
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const id = "k_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      await db.query("api_key_create", {
        id, partner_id, name, key_hash: await hashKey(raw),
        scopes, created_by: (me && me.user_id) || null, now,
      });
      await audit(db, { user, partner, action: "create", entity: "api_key",
                        entity_id: id, detail: { name } });

      const keys = await db.query("api_keys_for_partner", { partner_id });
      return json({
        // The ONLY time this value exists outside the caller's browser.
        key: raw,
        id,
        api_keys: keyRows(keys),
      });
    }

    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, PATCH" });
  },
};
