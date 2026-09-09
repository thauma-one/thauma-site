// gatherings.js — the Events page's collection
//
// ONE COLLECTION, TWO TYPES. A one-off gathering and a multi-session cohort
// are the same kind of thing to everybody who has to create, edit or cancel
// one, and splitting them would mean two admin screens, two data files and two
// page templates to answer a question the item can answer about itself. `type`
// governs which fields apply and, later, which visual treatment renders. The
// enum is meant to grow — a third kind is a value, not a new collection.
//
// STATUS IS STORED, NEVER DERIVED. It would be easy to call anything before
// today "past" and anything after it "upcoming", and that is wrong twice: a
// gathering that was canceled is not "upcoming" because its date has not
// arrived, and one that was postponed should not silently become "past"
// because nobody edited it. Postponing and canceling are decisions somebody
// makes, so they are edits somebody makes.
//
// LANGUAGE IS OPTIONAL PER ITEM. Site chrome carries every language always,
// because it is written once by somebody at a keyboard with time. These are
// created in the field, in a hurry, in whichever language the person has. A
// missing translation is not a reason to refuse to publish, and the page shows
// the item with an honest marker rather than hiding it — visible and not yet
// in your language is true; invisible is not.
//
// ALWAYS A FUNCTION EXPORT. A static value is computed once when the module is
// first required and never reflects a later edit; `eleventy --watch` does not
// restart. Same rule as team.js and resources.js.
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

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


/* The order the page tells its story in: what is coming, then what happened,
   most recent first. Canceled items keep their place rather than vanishing —
   the record is more honest with them in it. */
const STATUS_ORDER = { upcoming: 0, canceled: 1, past: 2 };

module.exports = () => {
  const dir = path.join(__dirname, "..", "content", "gatherings");
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return {
        slug: f.replace(/\.md$/, ""),
        type: data.type === "cohort" ? "cohort" : "gathering",
        status: STATUS_ORDER[data.status] !== undefined ? data.status : "upcoming",
        ...data,
        /* Prose below the front matter, for anything longer than a description
           wants to be. Empty is the ordinary case. */
        body: (content || "").trim(),
        /* WHICH LANGUAGES THIS ONE ACTUALLY HAS, worked out here so no template
           has to guess. The page uses it to decide between showing the item and
           showing the item with a marker — never between showing and hiding. */
        langs: Object.keys(data.title || {}).filter((k) => (data.title || {})[k]),
        registration: webUrl(data.registration),
        /* An explicit map link wins — some venues deserve better than a search
           — and otherwise it follows the place, so moving the venue moves the
           link and nobody has to remember two fields. */
        map_url: data.map_url ? webUrl(data.map_url) : mapUrl(data.location),
      };
    })
    .sort((a, b) => {
      const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (s !== 0) return s;

      /* SOMETHING WITH NO USABLE DATE IS NEVER "NEXT".
       *
       * The events page features the first upcoming gathering as THE
       * invitation, so whatever sorts first is what a visitor is invited to.
       * An entry with no date, or with a date somebody typed as prose —
       * "13 March - 27 March 2027" is a real thing to write before a date is
       * fixed — cannot be compared to anything, and string comparison put it
       * first purely because "1" sorts before "2". A half-finished draft was
       * being presented as the next gathering.
       *
       * So: datable things sort by their date, and everything else falls to
       * the end of its own group. It is still listed; it is just not held up
       * as the thing coming next, which is a claim only a date can support. */
      /* ISO ONLY, on purpose. Date.parse is lenient enough to make a number
         out of "13 March - 27 March 2027" — it reads the front of it and
         ignores the rest — so asking whether it parsed is not the same as
         asking whether it is a date. The console writes YYYY-MM-DD from a real
         date control; anything else is prose and is treated as prose. */
      const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? Date.parse(v) : NaN);
      const at = iso(a.date), bt = iso(b.date);
      const aOk = !Number.isNaN(at), bOk = !Number.isNaN(bt);
      if (aOk !== bOk) return aOk ? -1 : 1;
      if (!aOk) return 0;

      /* Upcoming reads soonest-first; everything else newest-first. A past
         gathering from last month is more interesting than one from 2027. */
      return a.status === "upcoming" ? at - bt : bt - at;
    });
};
