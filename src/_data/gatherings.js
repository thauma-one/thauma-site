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
      };
    })
    .sort((a, b) => {
      const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (s !== 0) return s;
      /* Upcoming reads soonest-first; everything else newest-first. A past
         gathering from last month is more interesting than one from 2027. */
      const da = String(a.date || ""), db = String(b.date || "");
      return a.status === "upcoming" ? da.localeCompare(db) : db.localeCompare(da);
    });
};
