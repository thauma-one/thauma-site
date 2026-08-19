/**
 * admin-profile — the public half of a person, edited from the People page
 *
 * WHERE THE TRUTH LIVES, AND WHY IT IS IN TWO PLACES
 * ---------------------------------------------------------------------------
 * staff_profiles is the source of truth for EDITING. The console reads and
 * sorts from it, which is what makes "sort by region" a query instead of
 * fetching and parsing every markdown file in the repository.
 *
 * src/content/team/<slug>.md is what the SITE builds from, written here on
 * every save. Three things come free from keeping it that way:
 *
 *   · the build stays hermetic — no credential, no database, no network
 *   · `git log src/content/team/` still answers "who changed this bio"
 *   · a saved profile does NOT reach the live site until somebody presses
 *     Publish, because the commit carries [skip ci]
 *
 * That last one is the reason, and it is worth being blunt about: serving the
 * team page from a live read of the database would have been less code and
 * would have silently deleted the publish gate this whole system is built on.
 *
 * THE FILE EXISTS IF AND ONLY IF is_public IS 1. Switching the toggle off
 * deletes the file and keeps the row, so a board member's half-written bio
 * survives being taken off the site.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { getFile, putFile, deleteFile } from "./lib/github.js";

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const MAX = { region: 120, email: 200, role_title: 120, bio: 4000, slug: 80 };

/** Trim, clamp, and strip control characters. Empty string becomes null so
    "not set" is one value in the database rather than two. */
function clean(v, max) {
  if (typeof v !== "string") return null;
  const out = v.replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
  return out === "" ? null : out;
}

/* A slug is a public URL. Latin letters, digits and single hyphens — and
   accented characters are FOLDED rather than dropped, so "Mira Petrović"
   becomes mira-petrovic and not mira-petrovi. */
export function slugify(name) {
  return String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")            // not decomposable, and common here
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX.slug) || null;
}

/* YAML, written by hand rather than with a library, because the only values
   that reach it are ours and every one of them is quoted. Quoting everything
   and escaping the two characters YAML cares about inside double quotes means
   a bio containing a colon, a hash or a leading dash cannot break the file —
   which is exactly what an unquoted scalar would do. */
function yamlString(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

export function toMarkdown(profile, translations) {
  const lines = ["---"];
  lines.push(`user_id: ${yamlString(profile.user_id)}`);
  lines.push(`name: ${yamlString(profile.name)}`);
  lines.push(`order: ${Number(profile.sort_order) || 0}`);
  if (profile.photo) lines.push(`photo: ${yamlString(profile.photo)}`);
  if (profile.bio_photo) lines.push(`bio_photo: ${yamlString(profile.bio_photo)}`);
  if (profile.region) lines.push(`base: ${yamlString(profile.region)}`);
  if (profile.public_email) lines.push(`email: ${yamlString(profile.public_email)}`);

  const langs = Object.keys(translations).sort();
  const withRole = langs.filter((l) => translations[l].role_title);
  const withBio = langs.filter((l) => translations[l].bio);

  if (withRole.length) {
    lines.push("role:");
    for (const l of withRole) lines.push(`  ${l}: ${yamlString(translations[l].role_title)}`);
  }
  if (withBio.length) {
    lines.push("bio:");
    for (const l of withBio) lines.push(`  ${l}: ${yamlString(translations[l].bio)}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}

const pathFor = (slug) => `src/content/team/${slug}.md`;

/* staff_profiles_all packs every language into one string to save a round trip
   per person — unit separator between fields, record separator between
   languages. Chosen because neither can occur in the text: clean() strips all
   control characters on the way in. */
export function parseTranslations(packed) {
  const out = {};
  if (!packed) return out;
  for (const rec of String(packed).split("\u001e")) {
    const [lang, role_title, bio] = rec.split("\u001f");
    if (lang) out[lang] = { role_title: role_title || null, bio: bio || null };
  }
  return out;
}

/** Admin only. The People page is an administration screen. */
async function requireAdmin(request, env) {
  const gate = await requireAccess(request, env);
  if (gate.denied) return { denied: gate.denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: gate.user.email });
  if (!me) return { denied: json({ error: "No account for that address" }, 403) };

  const roles = String(me.roles || "").split(",");
  if (!roles.includes("admin")) {
    return { denied: json({ error: "Administrator access is required" }, 403) };
  }
  return { db, user: gate.user, me };
}

export default {
  async fetch(request, env) {
    const gate = await requireAdmin(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;
    const now = new Date().toISOString();

    if (request.method !== "POST" && request.method !== "DELETE") {
      return json({ error: "Method not allowed" }, 405, { Allow: "POST, DELETE" });
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: "The request body was not valid JSON." }, 400); }

    /* REWRITE EVERY PUBLISHED PROFILE'S FILE.
       The database write and the repository write are two operations and the
       second one can fail on its own — a token expiring mid-save leaves a
       profile that is correct here and stale in the repository. Saving that
       person again fixes it, but only if somebody knows which person. This
       fixes all of them without needing to know. */
    if (request.method === "POST" && body.action === "export-all") {
      const published = await db.query("staff_profiles_public", {});
      const all = await db.query("staff_profiles_all", {});
      const written = [], failed = [];

      for (const p of published) {
        const row = all.find((r) => r.user_id === p.user_id) || {};
        const translations = parseTranslations(row.translations);
        try {
          const res = await writeFile(env, { ...p, name: p.name }, translations, user, me);
          (res.ok ? written : failed).push(res.ok ? p.slug : { slug: p.slug, error: res.error });
        } catch (e) {
          failed.push({ slug: p.slug, error: e.message });
        }
      }
      return json({ ok: failed.length === 0, written, failed });
    }

    const userId = String(body.user_id || "").trim();
    if (!userId) return json({ error: "user_id is required" }, 400);

    const person = await db.queryOne("user_by_id", { id: userId });
    if (!person) return json({ error: "No such person" }, 404);

    /* ------------------------------------------------------------ DELETE */
    if (request.method === "DELETE") {
      const rows = await db.query("staff_profiles_all", {});
      const existing = rows.find((r) => r.user_id === userId);

      await db.query("staff_profile_delete", { user_id: userId });
      let removed = null;
      if (existing && existing.slug) removed = await removeFile(env, existing.slug, user, me);

      return json({ ok: true, user_id: userId, file: removed });
    }

    /* -------------------------------------------------------------- POST */
    const isPublic = body.is_public ? 1 : 0;
    const slug = clean(body.slug, MAX.slug) || slugify(person.user_name || person.name);
    if (!slug) {
      return json({ error: "This person needs a name before they can have a public page." }, 400);
    }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return json({ error: `"${slug}" is not a usable web address.` }, 400);
    }

    const taken = await db.queryOne("staff_profile_slug_taken", { slug, user_id: userId });
    if (taken) {
      return json({
        error: `The address /team/${slug}/ is already used by somebody else.`,
      }, 409);
    }

    const profile = {
      user_id: userId,
      is_public: isPublic,
      slug,
      region: clean(body.region, MAX.region),
      public_email: clean(body.public_email, MAX.email),
      photo: clean(body.photo, 300),
      bio_photo: clean(body.bio_photo, 300),
      sort_order: Number.isFinite(+body.sort_order) ? Math.trunc(+body.sort_order) : 0,
      now,
    };
    await db.query("staff_profile_upsert", profile);

    /* One row per language, and an emptied language loses its row rather than
       storing two empty strings — "is this translated" stays a question about
       rows, the way it is for milestones and prayer. */
    const text = body.text && typeof body.text === "object" ? body.text : {};
    const translations = {};
    const known = await db.query("languages_all", {});
    for (const l of known) {
      const t = text[l.code] || {};
      const role_title = clean(t.role_title, MAX.role_title);
      const bio = clean(t.bio, MAX.bio);
      if (role_title || bio) {
        await db.query("staff_profile_translation_upsert", {
          user_id: userId, lang: l.code, role_title, bio, now,
        });
        translations[l.code] = { role_title, bio };
      } else {
        await db.query("staff_profile_translation_delete", { user_id: userId, lang: l.code });
      }
    }

    /* ---- the repository half ---- */
    const named = { ...profile, name: person.user_name || person.name };
    let file = null;
    try {
      file = isPublic
        ? await writeFile(env, named, translations, user, me)
        : await removeFile(env, slug, user, me);
    } catch (e) {
      file = { ok: false, error: e.message };
    }

    await db.query("audit_write", {
      id: crypto.randomUUID(),
      now,
      user_id: me.user_id,
      partner_id: null,
      action: isPublic ? "profile.publish" : "profile.unpublish",
      entity: "staff_profile",
      entity_id: userId,
      detail: JSON.stringify({ slug, file: file && file.ok ? "written" : file }),
    });

    return json({
      ok: true,
      user_id: userId,
      slug,
      is_public: !!isPublic,
      /* Said out loud rather than swallowed. The profile IS saved either way;
         if the repository write failed the site simply has not caught up, and
         saving again repairs it. A silent failure here would mean pressing
         Publish and wondering why nothing changed. */
      file: file && file.ok ? true : false,
      fileError: file && file.ok ? undefined : (file && file.error) || null,
    });
  },
};

async function writeFile(env, profile, translations, user, me) {
  const path = pathFor(profile.slug);
  const existing = await getFile(env, path);
  const res = await putFile(env, {
    path,
    text: toMarkdown(profile, translations),
    sha: existing.error ? undefined : existing.sha,
    message: `Update ${profile.name}'s team profile`,
    // Saving must not deploy. The tripwire in workers/test/github.test.mjs
    // fails the build if any write here forgets this.
    quiet: true,
    authorName: me.user_name || user.email,
    authorEmail: user.email,
  });
  return res.error ? { ok: false, error: res.error } : { ok: true, commit: res.commit };
}

async function removeFile(env, slug, user, me) {
  const path = pathFor(slug);
  const existing = await getFile(env, path);
  if (existing.error) return { ok: true, absent: true };   // already gone
  const res = await deleteFile(env, {
    path,
    sha: existing.sha,
    message: `Remove ${slug} from the team page`,
    quiet: true,
    authorName: me.user_name || user.email,
    authorEmail: user.email,
  });
  return res.error ? { ok: false, error: res.error } : { ok: true, commit: res.commit };
}
