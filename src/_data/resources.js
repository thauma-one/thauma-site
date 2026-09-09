// Reads every resource file. One markdown file per resource in
// src/content/resources/ — created via /admin (Resources collection) or
// by hand. Same pattern as team.js (CLAUDE.md: "Events and Resources
// should be built exactly this way when real content exists").
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

/* WHERE THE CONTENT LIVES, overridable for tests.
 *
 * This read src/content/<collection> and nothing else, so a test that needed
 * an item to assert against had to WRITE ONE INTO THE REAL FOLDER and delete
 * it afterwards. That is a bad bargain twice over: the live site briefly grows
 * content nobody wrote, and anything that inspects the site mid-run — a person
 * looking at dev, another test, the watcher — sees invented gatherings appear
 * and vanish. It cost hours of "where did those events go".
 *
 * Tests point this at test/fixtures/, which is committed and permanent. The
 * real content directory is never written to by anything except the console.
 */
const CONTENT_ROOT = process.env.THAUMA_CONTENT_DIR ||
  path.join(__dirname, "..", "content");


/* A WEB ADDRESS AS SOMEBODY TYPED IT.
 *
 * "chaseroush.com" is what a person writes; a browser reads it as a RELATIVE
 * path and sends the visitor to /en/events/chaseroush.com. The link looks
 * right in the box and goes nowhere — the worst kind of broken, because
 * nobody clicks their own link to check it.
 *
 * ALSO DONE ON SAVE, in workers/src/admin-library.js, so the stored file is
 * clean. This is the second half of the same rule and not a duplicate of it:
 * content written before that existed, or by hand in an editor, has never been
 * through it. Normalising on the way OUT means the page cannot render a broken
 * link whatever is in the file.
 *
 * NOT www. A bare hostname gets https:// and nothing else — plenty of sites do
 * not answer on www at all, so adding it would turn a working address into a
 * dead one.
 *
 * Plain words are left exactly alone. "ask Chase" is a legitimate answer to
 * how to register, and turning it into a link would be a lie.
 */
function webUrl(raw) {
  const v = String(raw == null ? "" : raw).trim();
  if (!v) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;
  if (/^\//.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return `mailto:${v}`;
  if (/^[^\s/]+\.[^\s/]{2,}/.test(v)) return `https://${v}`;
  return v;
}

/* A PLACE, WITHOUT PICKING SOMEBODY'S MAPS APP FOR THEM.
 *
 * This was a Google Maps search URL, chosen because every platform recognizes
 * it. It also opens Google Maps whatever the reader actually uses, which is
 * exactly the thing that makes map links irritating.
 *
 * THERE IS NO SINGLE URL THAT MEANS "THE MAPS APP YOU USE". `geo:` is the real
 * standard for a place and Android honors it with the default handler; iOS
 * has no geo: handler at all; a desktop browser has no maps app to open. So
 * the honest arrangement is a neutral web map in the markup — which works
 * everywhere, with no JavaScript, and forces nothing — upgraded per platform
 * at load. See enhanceMapLinks in src/js/main.js.
 *
 * OpenStreetMap for the base because it is a map rather than a product: no
 * account, no app prompt, and a nonprofit pointing at open data is the right
 * default when it has to pick one.
 */
function mapUrl(place) {
  const v = String(place == null ? "" : place).trim();
  return v ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(v)}` : "";
}


/* THE FOUR DOORS. A visitor with a broken mixer does not know which CATEGORY
   their problem is in — they know what just happened. So a resource is filed
   by the moment somebody is in when they need it, not by subject:

     crisis    something is broken now, and there is no patience for a tutorial
     growth    handed the booth with no training, and calm enough to learn
     planning  deciding what to buy, with real money and a real ceiling
     lookup    what does this word mean — the glossary and reference

   Unknown values fall to `lookup` rather than disappearing: a resource with a
   typo in its front matter should be findable and wrong, not absent. */
const MOMENTS = ["crisis", "growth", "planning", "lookup"];

/* Deliberately short and deliberately closed. A tag vocabulary that grows
   whenever somebody wants a new word becomes a maintenance chore run from a
   phone in another country. */
const FORMATS = ["guide", "diagram", "checklist", "glossary-entry", "video"];

module.exports = () => {
  const dir = path.join(CONTENT_ROOT, "resources");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      const summary = data.summary || data.description || {};
      return {
        slug: f.replace(/\.md$/, ""),
        ...data,
        moment: MOMENTS.includes(data.moment) ? data.moment : "lookup",
        format: FORMATS.includes(data.format) ? data.format : "guide",
        /* Free-form, and only meaningful on the crisis door — the one place an
           open vocabulary earns its flexibility, because a symptom is whatever
           the person in the room would say out loud. */
        symptoms: Array.isArray(data.symptoms) ? data.symptoms : [],
        pinned: !!data.pinned,
        summary,
        /* AN ALIAS, so the page that already renders `description` keeps
           working untouched while the front matter moves to `summary`. The
           visual pass will read `summary` directly and this can go. */
        description: summary,
        /* THE BODY, kept out of the front matter where prose belongs. This is
           also the corpus a retrieval assistant would search one day — a
           resource that is one clean topic with a title, a summary and a body
           is a deposit into that whether or not it is ever built. */
        body: (content || "").trim(),
        langs: Object.keys(data.title || {}).filter((k) => (data.title || {})[k]),
        link: webUrl(data.link),
      };
    })
    /* PINNED FIRST, then newest. The glossary is the thing everything else
       refers to; sorting purely by date would bury it under whatever was
       written last week. `order` still wins where somebody has set it. */
    .sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      const ao = a.order ?? 99, bo = b.order ?? 99;
      if (ao !== bo) return ao - bo;
      return String(b.created || "").localeCompare(String(a.created || ""));
    });
};

module.exports.MOMENTS = MOMENTS;
module.exports.FORMATS = FORMATS;
