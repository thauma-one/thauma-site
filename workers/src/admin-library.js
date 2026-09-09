/**
 * admin-library — the site's collections: resources and gatherings
 *
 *   GET    /api/admin/library                 both collections, as items
 *   POST   /api/admin/library  {…}            create or replace one item
 *   POST   /api/admin/library  {action:"delete", …}
 *
 * WHY MARKDOWN AND NOT THE DATABASE
 * ---------------------------------------------------------------------------
 * A resource and a gathering are content, not accounts. Nothing signs in as
 * one, nothing is granted to one, and nothing else in the schema needs to join
 * against one. Put them in D1 and the site would need a second mechanism to
 * read them at build time, `git log` would stop answering "who changed this
 * and when", and Thauma's own content would sit in the same tables the partner
 * API scopes over — which is the one place it must never be.
 *
 * So: one item, one file, the same shape team profiles already use.
 * src/_data/resources.js and gatherings.js read the folder; this writes it.
 *
 * LANGUAGE IS OPTIONAL PER ITEM, and that is a deliberate departure from how
 * the site's chrome works. Chrome carries every language always because it is
 * written once, at a desk, with time. These are written in the field, in a
 * hurry, in whichever language the person has — so a save is never refused for
 * a missing translation. The public page shows the item with an honest marker
 * instead of hiding it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: decide how any of it looks. The visual
 * pass — the invitation layout, the zigzag record, the four-door navigation —
 * is a separate piece of work, and none of it is blocked by these bones.
 */
import { requireAccess } from "./lib/access.js";
import { createDb } from "./lib/db.js";
import { getFile, putFile, deleteFile, listDir } from "./lib/github.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });

/* THE TWO COLLECTIONS, described rather than coded twice. Adding a third is an
   entry here and a data file; it is not another endpoint. */
const COLLECTIONS = {
  resources: {
    dir: "src/content/resources",
    /* One moment-tag and one format-tag, both required, both closed. The
       vocabulary is small on purpose: a tag list that grows whenever somebody
       wants a new word becomes a maintenance chore run from another country. */
    enums: {
      moment: ["crisis", "growth", "planning", "lookup"],
      format: ["guide", "diagram", "checklist", "glossary-entry", "video"],
    },
    flags: ["pinned"],
    lists: ["symptoms"],
    plain: ["link", "photo", "created"],
    /* Where an uploaded picture is kept, so the editor can offer it back for
       re-cropping rather than only ever replacing it. Same idea as a staff
       photo's master. */
    hidden: ["photo_master"],
  },
  gatherings: {
    dir: "src/content/gatherings",
    enums: {
      type: ["gathering", "cohort"],
      /* STORED, NEVER DERIVED FROM THE DATE. A canceled gathering is not
         "upcoming" because its date has not arrived, and a postponed one must
         not become "past" because nobody edited it. */
      status: ["upcoming", "past", "canceled"],
      /* HOW OFTEN A COHORT MEETS, said once instead of restated on every
         session. "Every week" is a fact about the cohort; the dates are what
         follows from it. `custom` is the escape hatch for the ones that do not
         fit a rule — first Monday of the month, or nothing regular at all —
         and it is why the session list still exists. */
      cadence: ["weekly", "fortnightly", "monthly", "custom"],
    },
    flags: ["application_required"],
    lists: ["photos", "sessions"],
    /* end_date IS OPTIONAL AND MEANS MULTI-DAY. A gathering is often a
       weekend, and one date with a start time cannot say so — leaving people
       to work it out from a sentence somebody wrote in prose. */
    plain: ["date", "end_date", "time", "location", "map_url", "registration",
            "cohort_name", "capacity", "photo"],
    hidden: ["photo_master"],
  },
};

/* Every language a title may be written in. Read from the item rather than
   fixed here, so adding a language to the site does not need this file. */
const LANG_RE = /^[a-z]{2}(-[a-z]{2})?$/;

const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);

/**
 * A web address as somebody actually types it.
 *
 * "thauma.one" and "www.thauma.one" are what a person writes; a browser treats
 * both as a RELATIVE path and sends them to /admin/library/thauma.one. The
 * link looks right in the box and goes nowhere, which is the worst kind of
 * broken because nobody checks their own link.
 *
 * WHAT IT DOES NOT TOUCH: anything that already carries a scheme, and anything
 * that is plainly not a web address. `mailto:` and `tel:` are ordinary answers
 * to "how do I register", and prefixing those would break the one case they
 * exist for. A bare email address gets mailto: for the same reason — it is
 * unambiguous, and https://chase@thauma.one is not a thing.
 */
export function normalizeUrl(raw) {
  const v = str(raw, 300);
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;      // already has a scheme
  if (/^\//.test(v)) return v;                        // a path on this site
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return `mailto:${v}`;
  /* Something with a dot and no space is a hostname somebody typed. Anything
     else is left exactly as written — a note like "ask Chase" is a legitimate
     answer to how to register, and turning it into a link would be a lie. */
  if (/^[^\s/]+\.[^\s/]{2,}/.test(v)) return `https://${v}`;
  return v;
}

/**
 * A place, as a link that opens the reader's own map.
 *
 * geo: and maps: schemes each work on one platform and fail on the others. A
 * Google Maps SEARCH url is the one thing every platform recognises: iOS
 * offers to open Apple Maps, Android opens Google Maps, a desktop opens the
 * web. Built from the text rather than asked for separately, because nobody
 * wants to paste a map link as well as type where they are meeting.
 */
export function mapUrl(location) {
  const v = str(location, 200);
  if (!v) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
}

/** Derived from the English title, or whatever title exists. Never typed: it
    lands in a URL and a filename, and a hand-entered one has to be lived
    with. */
function slugify(title) {
  return str(title, 120).toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function yamlString(v) {
  return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** A per-language map, with empty languages left out entirely rather than
    written as "". An absent key is how the page knows a translation does not
    exist yet; an empty string looks like one that does. */
function langMap(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!LANG_RE.test(k)) continue;
    const text = str(v, 4000);
    if (text) out[k] = text;
  }
  return out;
}

function yamlLangMap(name, map, lines) {
  const keys = Object.keys(map);
  if (!keys.length) return;
  lines.push(`${name}:`);
  for (const k of keys) lines.push(`  ${k}: ${yamlString(map[k])}`);
}

/**
 * One item as a markdown file.
 *
 * The BODY goes below the front matter, where prose belongs — and where a
 * retrieval assistant would one day read it as one clean topic rather than
 * digging it out of YAML.
 */
export function toMarkdown(collection, item) {
  const spec = COLLECTIONS[collection];
  const lines = ["---"];

  for (const [field, allowed] of Object.entries(spec.enums || {})) {
    if (item[field]) lines.push(`${field}: ${yamlString(item[field])}`);
  }
  yamlLangMap("title", item.title || {}, lines);
  yamlLangMap("summary", item.summary || {}, lines);
  yamlLangMap("description", item.description || {}, lines);

  for (const field of (spec.plain || []).concat(spec.hidden || [])) {
    if (item[field]) lines.push(`${field}: ${yamlString(item[field])}`);
  }
  for (const field of spec.flags || []) {
    if (item[field]) lines.push(`${field}: true`);
  }
  for (const field of spec.lists || []) {
    const values = Array.isArray(item[field]) ? item[field].filter(Boolean) : [];
    if (!values.length) continue;
    lines.push(`${field}:`);
    for (const v of values) {
      /* A session is an object; a symptom or a photo is a string. Both are
         lists, and neither is worth a second code path. */
      if (v && typeof v === "object") {
        const parts = Object.entries(v)
          .filter(([, x]) => x)
          .map(([k, x]) => `${k}: ${yamlString(x)}`);
        lines.push(`  - { ${parts.join(", ")} }`);
      } else {
        lines.push(`  - ${yamlString(v)}`);
      }
    }
  }
  lines.push("---", "");
  const body = str(item.body, 20000);
  return lines.join("\n") + (body ? body + "\n" : "");
}

/**
 * Who may edit the site's collections.
 *
 * `communications` as well as `admin`, matching what the navigation already
 * promises for the site editor's pages — somebody who writes for the site
 * needs these and none of the account management.
 */
async function requireEditor(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };

  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) {
    return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  }
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.some((r) => r === "admin" || r === "communications")) {
    return {
      denied: json({
        error: "Editing the site's resources and gatherings needs the " +
               "administrator or communications role.",
        your_roles: roles,
      }, 403),
    };
  }
  return { db, user, me, roles };
}

async function audit(db, { me, user, action, collection, slug, detail }) {
  try {
    await db.query("audit_write", {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      user_id: me.user_id,
      partner_id: null,
      action,
      entity: `site_${collection}`,
      entity_id: slug,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("library audit failed:", err && err.message);
  }
}

/* A CEILING ON THE READ. Listing an item means fetching its file, and a Worker
   gets a bounded number of subrequests per request. Dozens is the expected
   scale for years; if a collection ever outgrows this the answer is a cached
   index, not a bigger number here — and the console says so rather than
   silently showing a partial list. */
const MAX_ITEMS = 40;

async function readCollection(env, collection) {
  const spec = COLLECTIONS[collection];
  const listing = await listDir(env, spec.dir);
  /* An absent folder is an empty collection, not an error: nothing has been
     published yet, which is where both of these start. */
  if (listing.error) {
    return listing.status === 404
      ? { items: [], truncated: false }
      : { items: [], error: listing.error };
  }

  const files = listing.files.filter((f) => f.name.endsWith(".md")).sort((a, b) =>
    a.name.localeCompare(b.name));
  const truncated = files.length > MAX_ITEMS;

  const items = [];
  for (const file of files.slice(0, MAX_ITEMS)) {
    const got = await getFile(env, file.path);
    if (got.error) continue;
    items.push({ slug: file.name.replace(/\.md$/, ""), sha: got.sha, ...parseMarkdown(got.text) });
  }
  return { items, truncated };
}

/**
 * Front matter back out again.
 *
 * Deliberately small: it reads what this file writes, which is a flat map of
 * scalars, one level of nesting for the language maps, and simple lists. A
 * general YAML parser would be a dependency and a much larger surface to be
 * wrong about, for a format nobody else writes.
 */
export function parseMarkdown(text) {
  const m = String(text || "").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: String(text || "").trim() };

  const data = {};
  let currentMap = null, currentList = null;
  for (const raw of m[1].split("\n")) {
    if (!raw.trim()) continue;
    const unquote = (v) => {
      const t = v.trim();
      if (t === "true") return true;
      if (t === "false") return false;
      return t.replace(/^"|"$/g, "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    };

    const nestedList = raw.match(/^ {2}- (.*)$/);
    if (nestedList && currentList) {
      /* The key opened as an object because a bare `key:` could still turn out
         to be a map. The first `- ` settles it, so the shell becomes an array
         here rather than being guessed at when the key was read. */
      if (!Array.isArray(data[currentList])) data[currentList] = [];
      currentMap = null;
      const inner = nestedList[1].trim();
      if (inner.startsWith("{")) {
        const obj = {};
        for (const pair of inner.slice(1, -1).split(",")) {
          const kv = pair.match(/^\s*(\w+):\s*(.*)$/);
          if (kv) obj[kv[1]] = unquote(kv[2]);
        }
        data[currentList].push(obj);
      } else {
        data[currentList].push(unquote(inner));
      }
      continue;
    }

    const nested = raw.match(/^ {2}([\w-]+):\s*(.*)$/);
    if (nested && currentMap) { data[currentMap][nested[1]] = unquote(nested[2]); continue; }

    const top = raw.match(/^([\w-]+):\s*(.*)$/);
    if (!top) continue;
    currentMap = null; currentList = null;
    if (top[2] === "") {
      /* A key with nothing after it opens either a map or a list; which one is
         settled by the next line, so both are prepared. */
      data[top[1]] = {};
      currentMap = top[1];
      currentList = top[1];
      continue;
    }
    data[top[1]] = unquote(top[2]);
  }

  /* A key that opened but never took a nested entry is neither; drop it rather
     than leave {} where a template expects a string. */
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length) delete data[k];
  }
  return { ...data, body: (m[2] || "").trim() };
}

export default {
  async fetch(request, env) {
    const gate = await requireEditor(request, env);
    if (gate.denied) return gate.denied;
    const { db, user, me } = gate;

    if (request.method === "GET") {
      const [resources, gatherings] = await Promise.all([
        readCollection(env, "resources"),
        readCollection(env, "gatherings"),
      ]);
      return json({
        you: { email: user.email, name: me.user_name || null },
        resources, gatherings,
        vocabulary: {
          moment: COLLECTIONS.resources.enums.moment,
          format: COLLECTIONS.resources.enums.format,
          type: COLLECTIONS.gatherings.enums.type,
          status: COLLECTIONS.gatherings.enums.status,
        },
        limit: MAX_ITEMS,
      });
    }

    if (request.method !== "POST") {
      return json({ error: `${request.method} is not supported here.` }, 405,
                  { Allow: "GET, POST" });
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

    const collection = str(body.collection, 20);
    const spec = COLLECTIONS[collection];
    if (!spec) return json({ error: "Unknown collection" }, 400);

    /* ---------------------------------------------------------- removing */
    if (body.action === "delete") {
      const slug = slugify(body.slug);
      if (!slug) return json({ error: "Which one?" }, 400);
      const path = `${spec.dir}/${slug}.md`;
      const existing = await getFile(env, path);
      if (existing.error) {
        return existing.status === 404
          ? json({ ok: true, absent: true })
          : json({ error: existing.error }, 502);
      }
      const res = await deleteFile(env, {
        path, sha: existing.sha,
        message: `Remove ${slug} from ${collection}`,
        quiet: true,
        authorName: me.user_name || user.email, authorEmail: user.email,
      });
      if (res.error) return json({ error: res.error }, 502);
      await audit(db, { me, user, action: "delete", collection, slug });
      return json({ ok: true, slug });
    }

    /* ----------------------------------------------------------- writing */
    const title = langMap(body.title);
    if (!Object.keys(title).length) {
      return json({ error: "A title in at least one language is needed." }, 400);
    }

    /* The slug follows the English title where there is one, and otherwise the
       first title that exists — a Croatian-only resource still gets a stable,
       readable filename. An existing item keeps the slug it was created with,
       so renaming the title never orphans the file or breaks a link. */
    const slug = slugify(body.slug) || slugify(title.en || Object.values(title)[0]);
    if (!slug) return json({ error: "That title has no letters or digits in it." }, 400);

    const item = { title, summary: langMap(body.summary), body: str(body.body, 20000) };
    for (const [field, allowed] of Object.entries(spec.enums)) {
      const v = str(body[field], 40);
      if (v && !allowed.includes(v)) {
        return json({ error: `"${v}" is not one of: ${allowed.join(", ")}` }, 400);
      }
      item[field] = v || allowed[0];
    }
    for (const field of spec.plain.concat(spec.hidden || [])) item[field] = str(body[field], 300);
    /* Addresses, tidied once on the way in rather than at every place that
       renders one. A stored value that is already correct cannot be rendered
       wrongly later by something that forgot to call a helper. */
    if (item.link) item.link = normalizeUrl(item.link);
    if (item.registration) item.registration = normalizeUrl(item.registration);
    /* The map link follows the place, so moving the venue moves the link and
       nobody has to remember to update two fields. An explicitly supplied one
       wins — some venues are worth pointing somewhere better than a search. */
    if (collection === "gatherings") {
      item.map_url = item.map_url ? normalizeUrl(item.map_url) : mapUrl(item.location);
    }
    for (const field of spec.flags) item[field] = !!body[field];
    for (const field of spec.lists) {
      item[field] = Array.isArray(body[field])
        ? body[field].slice(0, 60).map((v) =>
            v && typeof v === "object"
              ? Object.fromEntries(Object.entries(v).map(([k, x]) => [str(k, 20), str(x, 300)]))
              : str(v, 200))
          .filter((v) => (typeof v === "object" ? Object.values(v).some(Boolean) : v))
        : [];
    }

    const path = `${spec.dir}/${slug}.md`;
    const existing = await getFile(env, path);
    /* A 404 IS THE ONLY THING THAT MEANS "NOT THERE". putFile refuses to write
       without a SHA unless the caller says `create`, because an absent SHA is
       read as "create" and on an existing path that is a blind overwrite. Any
       other error — a bad token, a rate limit, GitHub down — must not become a
       create. Team profiles were refused for a year for the opposite mistake:
       never saying `create` at all. */
    const missing = !!existing.error && existing.status === 404;
    if (existing.error && !missing) return json({ error: existing.error }, 502);

    const res = await putFile(env, {
      path,
      text: toMarkdown(collection, item),
      sha: missing ? undefined : existing.sha,
      create: missing,
      message: `${missing ? "Add" : "Update"} ${slug} in ${collection}`,
      /* Saving is not publishing. The site changes when somebody presses
         Publish, and a content commit must not deploy on its own. */
      quiet: true,
      authorName: me.user_name || user.email,
      authorEmail: user.email,
    });
    if (res.error) return json({ error: res.error }, 502);

    await audit(db, {
      me, user, action: missing ? "create" : "update", collection, slug,
      detail: { languages: Object.keys(title) },
    });
    return json({ ok: true, slug, created: missing });
  },
};
