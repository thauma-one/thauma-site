/**
 * site-sections.js — the kinds of section Thauma's own pages are made of
 *
 * Chase, 2026-10-21: the administrators' Site Creator should work like the
 * staff one — pages made of sections that can be added, moved and taken
 * away, with a header and footer editor — "to make sure NOTHING in the site
 * changes its appearance". So the kinds are the site's own designs, cut from
 * the pages as they were (src/_includes/sections/<kind>.njk), and the pages
 * are lists of them (src/_data/pageSections.json). Drawn from that list, every
 * page is the same HTML it was before (test/page-sections.test.mjs).
 *
 * A SECTION NAMES ITS WORDS BY KEY, it does not hold them: the words stay in
 * the language files, where translating, Needs Work and the translator's
 * file already find them. A section that was always on the site keeps its
 * old keys (`home.who_cue`); anything added since — a new section, a fourth
 * point, a second button — lives under `blocks.<section id>.…` and goes when
 * its section does.
 *
 * ONE FILE, THREE READERS: Eleventy's `w` and `sectionHref` filters, the
 * console's Pages tab and live preview (it is copied to /js/), and the
 * server that checks a page's sections before committing them
 * (workers/src/admin-sections.js).
 */
(function () {

/* WHAT EACH KIND IS MADE OF.
     top       the head of a page: first on it, never moved or taken away
     fixed     made of things edited elsewhere (the people, the gatherings,
               the form); stays on its page, can be moved, not taken away
     only      the one page it belongs to
     words     its single words; `heading` is a headline in two halves (the
               bold one is `_bold`), the rest one line each
     optional  the words it can be without (an Add button brings one back)
     list      a run of paragraphs (or a dictionary's meanings)
     items     repeated parts, each with these words
     buttons   how many buttons it may have
     photo     a framed photo (site.json images, Website › Photos)
     ground    plain or raised (the site's `alt` band)
     voice     the small line above in the technical blue or the ministry's
               seafoam (CLAUDE.md rule 3) */
const KINDS = {
  homeHero: { top: true, fixed: true, only: "home", words: ["cue", "heading", "text"] },
  pageHeader: { top: true, words: ["cue", "heading", "lede"], optional: ["cue", "lede"], voice: true },
  dictionary: { top: true, words: ["word", "ipa"], list: "defs", listMax: 5 },
  story: { words: ["cue", "heading", "lede", "note"], optional: ["cue", "heading", "lede", "note"],
           list: "body", listMax: 8, photo: true, ground: true, voice: true },
  points: { words: ["cue", "heading"], optional: ["cue", "heading"], items: ["title", "text"], itemsMax: 8,
            buttons: 1, ground: true, voice: true },
  invite: { words: ["cue", "heading", "lede"], optional: ["cue", "heading", "lede"], buttons: 3, voice: true },
  rows: { items: ["label", "title", "text"], itemsMax: 8, ground: true },
  /* FROM THE STAFF SITE CREATOR (Chase, 2026-10-27: "I actually wanted all
     Staff site creator sections to be available for Thauma as well"): the
     ones this site had nothing like — a quote, a wide photo, links (each
     going to one of the site's pages or a web address: `itemTo`), and a
     sign-up that opens the site's own Stay Connected window. Its words and
     photos, its Header, Words-and-Photo, Cards and Contact already were. */
  quote: { words: ["quote", "who"], optional: ["who"], ground: true, voice: true },
  photo: { words: ["caption"], optional: ["caption"], photo: true, ground: true },
  links: { words: ["cue", "heading"], optional: ["cue", "heading"], items: ["title", "text"], itemsMax: 12, itemTo: true, ground: true, voice: true },
  signup: { words: ["cue", "heading", "lede", "button"], optional: ["cue", "lede"], ground: true, voice: true },
  convictions: { fixed: true, only: "values" },
  teamGrid: { fixed: true, only: "team" },
  library: { fixed: true, only: "resources" },
  gatherings: { fixed: true, only: "events" },
  contactForm: { fixed: true, only: "contact" },
  giving: { fixed: true, only: "give" },
};
/* What can be added from the console, in the order it offers them. */
const ADDABLE = ["story", "points", "invite", "rows", "quote", "photo", "links", "signup"];
/* The pages that are lists of sections, and the ones in the menu. */
const PAGES = ["home", "about", "mission", "values", "team", "resources", "events", "contact", "give"];
const NAV = ["about", "mission", "values", "team", "resources", "events", "contact"];
const VOICES = ["tech", "ministry"];
const GROUNDS = ["plain", "raised"];
const STYLES = ["solid", "ghost"];

/** One word by its dotted key: `wordAt(t, "home.cue")`. Missing is empty. */
function wordAt(t, key) {
  const v = String(key || "").split(".").reduce((o, k) => (o == null ? o : o[k]), t);
  return v == null ? "" : v;
}

/** Where a button goes: one of the site's pages in this language, or a web
    address as it is. */
function sectionHref(to, lang) {
  const s = String(to || "");
  if (/^(https:\/\/|mailto:)/.test(s)) return s;
  return s === "home" || !s ? `/${lang}/` : `/${lang}/${s}/`;
}

/** Every key a section's words are stored under, in reading order. */
function keysOf(sec) {
  const k = KINDS[sec && sec.kind] || {}, wd = (sec && sec.words) || {}, out = [];
  const add = (key, split) => { if (key) split ? out.push(key + "_thin", key + "_bold") : out.push(key); };
  (k.words || []).forEach((f) => add(wd[f], f === "heading"));
  if (k.list) (wd[k.list] || []).forEach((key) => add(key));
  if (k.photo && sec.photo) { add(wd.alt); add(wd.placeholder); }
  (sec.items || []).forEach((it) => (k.items || []).forEach((f) => add(it[f])));
  (sec.buttons || []).forEach((b) => add(b.label));
  return out;
}

/** A key under a section's own place for words it gained after the fact. */
function blockKey(id, part) { return `blocks.${id}.${part}`; }

/** The next free number for a part (`p3`, `item4_`, `button2`): never one in
    use, so taking one away does not rename the rest. */
function nextPart(sec, prefix) {
  let n = 1;
  const used = keysOf(sec).join(" ");
  while (used.indexOf(`blocks.${sec.id}.${prefix}${n}`) !== -1) n++;
  return `${prefix}${n}`;
}

/** A new section of a kind, with keys for what every look of it shows. */
const START = { story: ["cue", "heading"], points: ["cue", "heading"], invite: ["cue", "heading", "lede"], rows: [],
  quote: ["quote", "who"], photo: ["caption"], links: ["cue", "heading"], signup: ["cue", "heading", "lede", "button"] };
function newSection(kind, id) {
  const k = KINDS[kind], sec = { id, kind, words: {} };
  (START[kind] || k.words || []).forEach((f) => { sec.words[f] = blockKey(id, f); });
  if (kind === "story") sec.words.body = [blockKey(id, "p1")];
  if (k.items) {
    sec.items = [1, 2, 3].map((n) => {
      const it = {};
      k.items.forEach((f) => { it[f] = blockKey(id, `item${n}_${f}`); });
      return it;
    });
  }
  if (kind === "invite") sec.buttons = [{ label: blockKey(id, "button1"), to: "give", style: "solid" }];
  if (k.itemTo) sec.items.forEach((it) => { it.to = "about"; });
  return sec;
}

/* STAND-IN WORDS, as the staff Site Creator's (Chase, 2026-10-07: "every
   section that is added should have basic styling and text added in when
   the section is added to show off what the sections can and remind the
   person to add different languages … since it is gibberish"). A new
   section starts with Latin in every language, and a line made only of
   these words is NOT WRITTEN: Needs Work, the page list and the translator's
   file count it as missing. The vocabulary leaves out short Latin that is
   also a real word somewhere (a, in, et, non, est). */
const LOREM = ("lorem ipsum dolor amet consectetur adipiscing elit eiusmod tempor incididunt labore dolore magna " +
  "aliqua minim veniam quis nostrud exercitation ullamco laboris aliquip commodo consequat duis aute irure " +
  "reprehenderit voluptate velit cillum fugiat nulla pariatur excepteur occaecat cupidatat proident culpa " +
  "officia deserunt mollit laborum").split(" ");
const LOREM_SET = new Set(LOREM);
function isLorem(v) {
  const ws = String(v || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").toLowerCase().match(/[a-zÀ-ɏЀ-ӿ]+/g);
  return !!ws && ws.every((x) => LOREM_SET.has(x));
}
function loremWords(n, rnd) {
  const out = [];
  while (out.length < n) {
    const x = LOREM[Math.floor(rnd() * LOREM.length)];
    if (x !== out[out.length - 1]) out.push(x);
  }
  return out;
}
/** Stand-in words shaped like the part they fill: a heading in Title Case
    (its two halves, `_thin` and `_bold`), a sentence or two for text. */
function lorem(part, rnd) {
  rnd = rnd || Math.random;
  const r = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const title = (ws) => ws.map((x) => x[0].toUpperCase() + x.slice(1)).join(" ");
  const sentence = (n) => { const ws = loremWords(n, rnd); ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1); return ws.join(" ") + "."; };
  const p = String(part).replace(/^.*\./, "");
  if (/_thin$/.test(p)) return title(loremWords(r(1, 2), rnd));
  if (/_bold$/.test(p)) return title(loremWords(r(1, 2), rnd)) + ".";
  if (/^(cue|label)$|_label$/.test(p)) return title(loremWords(r(1, 2), rnd));
  if (/^button\d*$|_title$/.test(p)) return title(loremWords(2, rnd));
  if (/^(lede|note|quote|caption)$/.test(p)) return sentence(r(8, 12));
  if (p === "who") return title(loremWords(2, rnd));
  return sentence(r(10, 14)) + " " + sentence(r(7, 11));
}

const api = { KINDS, ADDABLE, PAGES, NAV, VOICES, GROUNDS, STYLES, wordAt, sectionHref, keysOf, blockKey, nextPart, newSection,
              isLorem, lorem };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else window.SiteSections = api;
})();
