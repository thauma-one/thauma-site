/**
 * site/model.js — what a partner site IS: its pages, its sections, its
 * starting points, and the rules every saved document is held to.
 *
 * ONE JSON DOCUMENT PER SITE (partner_sites.draft / .published, 0044): the
 * languages, the look, the motion, the links, and the pages with their
 * sections. One document because the owner edits it as one thing and
 * publishes it as one thing; a table per section would be a join per page
 * view and a migration per new section type.
 *
 * EVERYTHING THAT COMES IN IS CLEANED HERE (cleanDoc). The editor is not the
 * only thing that can post, and whatever is stored is later written into a
 * page strangers read: text is length-capped plain text (the renderer
 * escapes it), links must be http(s) or mailto, photos must be our own
 * /media/ files or https, and every choice must be one of the known values.
 */

/* ---------------------------------------------------------------- words -- */

/* THE SITE'S OWN WORDS — page names, "Give", "Read more", the starting
   headings — live in src/_data/emailsAndForms.json ("site"), beside the
   widgets' and the emails' words, not in this file (Chase, 2026-09-29: "Are
   all of these controls added to the global language settings as well? Like
   if Thauma was to add another language?"). There they are edited on the
   Content page and translated on the Translate page like every other word
   Thauma writes for a visitor, so a language Thauma adds is a language a
   partner site speaks without anybody changing this code. A word a
   language has not been given yet is its English one. */
import { wordsFor as sharedWords } from "../lib/mail-i18n.js";
import { cleanColor, SIZE_NAMES } from "../lib/tones.js";

let WORDS = null;
function words() {
  if (!WORDS) {
    WORDS = {};
    for (const [lang, table] of Object.entries(sharedWords("site."))) {
      WORDS[lang] = {};
      for (const [k, v] of Object.entries(table)) WORDS[lang][k.slice(5)] = v;
    }
  }
  return WORDS;
}

/** A built-in word in a language, English where that language has none. */
export function word(lang, key) {
  const W = words();
  return (W[lang] && W[lang][key]) || (W.en && W.en[key]) || "";
}
export function builtInLangs() { return Object.keys(words()); }

/* ---------------------------------------------------------------- pages -- */

/* Every page a site can have, in the default menu order. `id` is its address
   (/en/<id>/; home is /en/). The first seven are on in a new site; Timeline
   and Resources wait, off, at the end (Chase, 2026-09-29). */
export const PAGES = ["home", "about", "mission", "updates", "give", "stay", "contact", "timeline", "resources"];
export const PAGES_ON = ["home", "about", "mission", "updates", "give", "stay", "contact"];

/* ------------------------------------------------------------- sections -- */

/* Each section type: its layout variants (the first is the default), which
   words it has, and whether it carries a photo. Data-driven sections
   (timeline, goals, …) draw the ministry's own published content; their
   "text" is a line under the heading.

   `link` (Chase, 2026-09-29: "a photo in a Resource box could also send you
   directly to the resource"): where a section can send a visitor — one of
   the site's own pages or any address.
     "button"  a button, its words in `button`
     "both"    a button, and the photo can be made to open it too
     "photo"   the photo opens it

   Every section but the opening and a full-width photo can sit on a raised
   band (`raised`), the way chaseroush.com sets its Mission apart. */
export const SECTIONS = {
  hero:      { variants: ["behind", "beside", "words", "monogram"], words: ["kicker", "heading", "text", "button"], photo: true, buttons: true, link: "button" },
  /* A page's title area (BACKLOG §3, 2026-10-03: headers "should offer some
     of the most creativity and versatility"): small print above and below
     the title, and a watermark whose words may differ from the page's name,
     as on chaseroush.com's page headers. */
  header:    { variants: ["watermark", "plain"], words: ["label", "heading", "text", "mark"] },
  text:      { variants: ["left", "center"], words: ["heading", "text", "verse", "verseRef", "button"], link: "button" },
  /* wrapLeft / wrapRight: the words flow around the photo, chaseroush.com's About. */
  photoText: { variants: ["left", "right", "above", "wrapLeft", "wrapRight"], words: ["heading", "text", "verse", "verseRef", "button"], photo: true, link: "both" },
  photo:     { variants: ["drift", "still", "zoom"], words: ["caption"], photo: true, link: "photo" },
  quote:     { variants: ["large", "quiet"], words: ["quote", "who"] },
  timeline:  { variants: ["condensed", "full"], words: ["heading", "text"], align: true },
  goals:     { variants: ["cards"], words: ["heading", "text"], align: true },
  prayer:    { variants: ["list"], words: ["heading", "text"], align: true },
  videos:    { variants: ["stage"], words: ["heading", "text"], align: true },
  /* latest: the newest one, and a small way to the rest (Chase, 2026-09-29). */
  newsletters: { variants: ["latest", "list", "combined"], words: ["heading", "text"], align: true },
  /* THE FORM AND GIVE STYLES (BACKLOG §3, 2026-10-04): Floating (a card of
     its own) or Integrated (part of the page), each in a few shapes. The
     first of each list is what a site saved before had, so nothing moves.
       split      words on one side, the form or button on the other
                  (chaseroush.com's contact page)
       open       no card at all: the form sits on the page itself
       wide       the contact card, wide enough for a desktop
       spotlight  a block in the site's own color */
  signup:    { variants: ["band", "card", "split", "open"], words: ["heading", "text"] },
  contact:   { variants: ["form", "split", "wide", "open"], words: ["heading", "text"], align: true },
  give:      { variants: ["band", "card", "split", "spotlight"], words: ["heading", "text", "button"] },
  /* Cards a person writes (chaseroush.com's Mission): Attached, joined by a
     line between their numbers, or Detached, side by side. */
  cards:     { variants: ["vertical", "horizontal", "open"], words: ["heading", "text"], items: "cards" },
  links:     { variants: ["list", "cards", "buttons"], words: ["heading", "text"], items: true, align: true },
};
/* EVERY SECTION LINES UP (BACKLOG §3, 2026-10-03: "Alignment for every
   section: left, right, center, indent. Buttons must follow their section's
   alignment"). What a section gets when it has never been set is what it
   already looked like, so no site moves:
     - `align: true` above: the ministry's widgets and lists, centered
       (Chase, 2026-09-29: "the embed codes seem to be left aligned");
     - a Words section saved with the old Centered layout, the sign-up card,
       and the opening in words alone: centered;
     - everything else: left. */
/* Indented is not a fourth way to line up but a switch on any of the three
   (2026-10-07, Chase: "It should be Left, center, or Right with Indented as
   a on or off style option"); "indent" saved before reads as Left, indented. */
export const ALIGNS = ["left", "center", "right"];
export function defaultAlign(type, variant) {
  const spec = SECTIONS[type] || {};
  if (spec.align) return "center";
  if ((type === "text" && variant === "center") || (type === "signup" && variant === "card") ||
      (type === "hero" && variant === "words")) return "center";
  return "left";
}

/* PLACEHOLDERS (Chase, 2026-10-03: "Placeholder words in every language
   whenever a section is added … It helps those who may not know how to
   phrase some things"). What an empty field suggests in the editor, in the
   language being written; never saved, never shown to a visitor. The same
   site words a new site starts with, so every language Thauma adds (and
   translates on the Translate page) suggests in that language with no code
   change. A pair is a heading's light and bold halves; "@name" is the
   ministry's name. */
const PH = {
  hero:      { kicker: "kickerFill", heading: ["heroThin", "@name"], text: "heroText", button: "more" },
  header:    { label: "headerLabel", heading: ["aboutThin", "aboutBold"], text: "headerSub", mark: "headerMark" },
  text:      { heading: ["aboutThin", "aboutBold"], text: "aboutFill", verse: "quoteFill", verseRef: "quoteWho", button: "more" },
  photoText: { heading: ["missionThin", "missionBold"], text: "missionFill", verse: "quoteFill", verseRef: "quoteWho", button: "more" },
  photo:     { caption: "captionFill" },
  quote:     { quote: "quoteFill", who: "quoteWho" },
  timeline:  { heading: ["timelineThin", "timelineBold"], text: "timelineFill" },
  goals:     { heading: ["goalsThin", "goalsBold"], text: "goalsFill" },
  prayer:    { heading: ["prayerThin", "prayerBold"], text: "prayerFill" },
  videos:    { heading: ["videosThin", "videosBold"], text: "videosFill" },
  newsletters: { heading: ["newsThin", "newsBold"], text: "newsFill" },
  signup:    { heading: ["signupThin", "signupBold"], text: "signupFill" },
  contact:   { heading: ["contactThin", "contactBold"], text: "contactFill" },
  give:      { heading: ["giveThin", "giveBold"], text: "giveText", button: "giveBtn" },
  links:     { heading: ["resourcesThin", "resourcesBold"], text: "resourcesFill" },
  cards:     { heading: ["cardsThin", "cardsBold"], text: "cardsFill" },
  /* One of the Custom Cards. */
  card:      { title: "cardTitle", text: "cardText" },
  /* A link card in a Links section. */
  item:      { title: "link1Title", text: "link1Text" },
};

/** Every section's suggested words in one language, as plain text. */
export function placeholders(lang, name) {
  const out = {};
  for (const [type, fields] of Object.entries(PH)) {
    out[type] = {};
    for (const [f, key] of Object.entries(fields)) {
      const one = (k) => (k === "@name" ? String(name || "").trim() : word(lang, k));
      out[type][f] = Array.isArray(key) ? key.map(one).filter(Boolean).join(" ") : one(key);
    }
  }
  return out;
}

/* ------------------------------------------------------- design, motion -- */

/* Three looks, each with its own type and shape; the colors are the
   owner's to change (design.colors). A fourth look, Classic — chaseroush.com
   in particular — was built and taken back out the same day (Chase,
   2026-09-29: "we don't need a classic design. Maybe just give options for
   more customization … background and accent colors. But the other elements
   would need to match"). A site saved with it opens as Night. */
export const LOOKS = ["night", "paper", "bold", "custom"];
/* Custom (Chase, 2026-09-29: "compile a light/dark mode from those and maybe
   make the 4th box Custom"): the owner's background and accent, and from
   them both a light and a dark version. What a visitor sees: whatever their
   device is set to, or always one of the two. The three preset looks keep
   their own colors, whatever is picked here. */
export const MODES = ["auto", "dark", "light"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MENUS = ["top", "center", "button"];
/* THE NAVIGATION TAB (Chase, 2026-10-04, from the approved mockup). Defaults
   are what every site already looked like: the current page lit in plain
   white, the thin line under the bar, the drop-down on phones, Give to the
   Give page. "Bold" and "Dot below" were tried, set aside, and added back
   (2026-10-05, the last of Chase's list). */
export const NAV = {
  current: ["lit", "under", "grow", "pill", "bold", "dot"],
  tint: ["white", "accent"],
  line: ["subtle", "none", "accent"],
  phone: ["drop", "full", "drawer"],
};
export const GIVE_TO = ["page", "link"];
/* Chase, 2026-09-29: "I'd like a few more animation tools available". Each is
   one choice, each respected only where the visitor has not asked their
   device for less motion. */
export const MOTION = {
  entrance: ["rise", "fade", "slide", "zoom", "none"],   // how sections arrive as you scroll
  photos:   ["drift", "zoom", "still"],                  // how photos move: parallax, slow zoom, still
  headings: ["letters", "words", "plain"],               // how headings appear
  buttons:  ["lift", "glow", "plain"],                   // what buttons do under the pointer
  pages:    ["fade", "cut"],                             // moving between pages
  progress: ["on", "off"],                               // a thin line tracking the scroll
  /* The opening's scroll hint (Chase, 2026-10-01: "give it multiple
     options ... the Arrow and Scroll"): chaseroush.com's line over the word,
     a bouncing arrow, a mouse whose wheel rolls, or nothing. */
  cue:      ["line", "arrow", "mouse", "none"],
};
export const SOCIALS = ["youtube", "instagram", "facebook", "x", "tiktok", "linkedin", "spotify", "email"];

/* The foot of every page (Chase, 2026-09-29: "Should we add a footer
   designer as well?").
     split    the name and links on one side, socials on the other
     center   everything in one centered column — chaseroush.com's footer
     columns  the name, the pages, the links and the socials side by side
   A line of its own (tagline) and small print (a tax note, a registration
   number) in each language. The "A Thauma site" credit always stays. */
export const FOOTERS = ["split", "center", "columns"];
export const SOCIAL_STYLES = ["icons", "words"];
/* The tagline's color (Chase, 2026-10-01): as it was, quieter, or in the
   site's accent. */
export const TAGLINE_STYLES = ["plain", "subtle", "accent"];
/* More ways to dress the footer (Chase, 2026-10-04: "more options for
   customization"): its ground, the line above it, and how much room. */
export const FOOT_GROUNDS = ["page", "raised", "tint"];
export const FOOT_SPACES = ["regular", "compact", "roomy"];
/* The tab icon (Chase, 2026-10-01: "Let the options be Filled, Letters, and
   Photo"): the initials on an accent tile, accent initials on the site's
   background, or the owner's picture. */
export const FAVICON_STYLES = ["filled", "letters", "photo"];

/* ------------------------------------------------------------ addresses -- */

/* "Chase Roush" → "chaseroush": first and last name, letters and digits only,
   accents folded (Petrović → petrovic). The owner does not choose it; an
   administrator may change it (Chase, 2026-09-29). */
/* "send" and "news" carry Thauma's own mail records (send.thauma.one,
   send.news.thauma.one), so no site may take them. */
export const RESERVED = new Set(["www", "dev", "next", "staff", "admin", "api", "mail", "send", "news", "embed",
  "thauma", "app", "preview", "media", "archive", "site", "sites", "help", "status"]);
export function subdomainFrom(name) {
  const s = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d").replace(/[łŁ]/g, "l").replace(/ß/g, "ss")
    .toLowerCase().replace(/[^a-z0-9]+/g, "");
  return s.slice(0, 40);
}
export function validSubdomain(s) {
  return /^[a-z0-9]{2,40}$/.test(String(s || "")) && !RESERVED.has(s);
}

/* ------------------------------------------------------ starting points -- */

let seq = 0;
const sid = () => "s" + Date.now().toString(36) + (seq++).toString(36);

/** Words for a section, in every language the site has, from built-in keys. */
function wordsFor(langs, map) {
  const out = {};
  for (const l of langs) {
    out[l] = {};
    for (const [field, key] of Object.entries(map)) {
      out[l][field] = key.startsWith("=") ? key.slice(1) : word(l, key);
    }
  }
  return out;
}
function section(type, variant, langs, map = {}, extra = {}) {
  /* A starting heading is written as its two halves, the light words and
     the bold ones; stored as one heading with the bold half in <b>. */
  const words = wordsFor(langs, map);
  for (const l of Object.keys(words)) {
    const w = words[l];
    if ("thin" in w || "bold" in w) {
      w.heading = joinHeading(w.thin, w.bold);
      delete w.thin; delete w.bold;
    }
  }
  return { id: sid(), type, variant: variant || SECTIONS[type].variants[0], words, ...extra };
}

const escHtml = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** "Follow the work of" + "Chase Roush." → one heading, the second half bold. */
export function joinHeading(thin, bold) {
  thin = String(thin || "").trim(); bold = String(bold || "").trim();
  return escHtml(thin) + (thin && bold ? " " : "") + (bold ? "<b>" + escHtml(bold) + "</b>" : "");
}

/**
 * THE THREE STARTING POINTS (Chase, 2026-09-29): the full default site, a
 * basic layout, or nothing — and a site begins as the full default.
 *   full   every page, each with sections that draw the ministry's own data
 *   basic  Home, About, Give and Contact, one or two sections each
 *   blank  every page present, only Home shown, and no sections at all
 */
export function starter(kind, { name, langs, fallback, give }) {
  const L = langs && langs.length ? langs : ["en"];
  const heroMap = { kicker: "=", thin: "heroThin", bold: "=" + name + ".", text: "heroText" };
  const hero = (variant) => section("hero", variant, L, heroMap, { photo: null, buttons: ["give", "stay"], divider: true });
  const pages = {};
  PAGES.forEach((p) => { pages[p] = { id: p, on: false, label: {}, sections: [] }; });

  /* EVERY PAGE STARTS WITH SOMETHING ON IT (Chase, 2026-09-29: "I want it
     to start with this placeholder text. Every default layout needs this.
     Even the pages that are turned [off] need placeholder text so the user
     can visualize what is happening"). The words come from the site's own
     words ("…Fill"), in each language, and ask to be replaced. */
  const links = (variant) => section("links", variant, L, { thin: "resourcesThin", bold: "resourcesBold", text: "resourcesFill" }, {
    items: [["page:about", "link1Title", "link1Text"], ["page:mission", "link2Title", "link2Text"]].map(([url, t, x]) => ({
      url, photo: null, words: Object.fromEntries(L.map((l) => [l, { title: word(l, t), text: word(l, x) }])),
    })),
  });
  const every = {
    home: [hero("behind"), section("photoText", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "homeFill" }, { photo: null })],
    about: [
      section("photoText", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "aboutFill" }, { photo: null }),
      section("quote", "large", L, { quote: "quoteFill", who: "quoteWho" }),
    ],
    mission: [
      section("text", "left", L, { thin: "missionThin", bold: "missionBold", text: "missionFill" }),
      section("photo", "still", L, { caption: "captionFill" }, { photo: null }),
    ],
    updates: [
      section("videos", "stage", L, { thin: "videosThin", bold: "videosBold", text: "videosFill" }),
      section("newsletters", "latest", L, { thin: "newsThin", bold: "newsBold", text: "newsFill" }),
    ],
    give: [
      section("give", "band", L, { thin: "giveThin", bold: "giveBold", text: "giveText", button: "giveBtn" }, { tint: true }),
      section("goals", "cards", L, { thin: "goalsThin", bold: "goalsBold", text: "goalsFill" }),
    ],
    stay: [section("signup", "card", L, { thin: "signupThin", bold: "signupBold", text: "signupFill" })],
    contact: [section("contact", "form", L, { thin: "contactThin", bold: "contactBold", text: "contactFill" })],
    timeline: [section("timeline", "full", L, { thin: "timelineThin", bold: "timelineBold", text: "timelineFill" })],
    resources: [links("list")],
  };

  if (kind === "blank") {
    /* Nothing, on purpose: the one start that is a clean page. */
    pages.home.on = true;
  } else {
    /* THE FULL DEFAULT: seven pages on, in this order; Timeline and
       Resources ready, and off. THE BASIC ONE: the same pages, filled the
       same way, with only Home, About, Give and Contact on — and a Home of
       the opening in words alone and one block of text. */
    const on = kind === "basic" ? ["home", "about", "give", "contact"] : PAGES_ON;
    PAGES.forEach((p) => { pages[p].on = on.includes(p); pages[p].sections = every[p]; });
    if (kind === "basic") {
      pages.home.sections = [hero("words"), section("text", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "homeFill" })];
      pages.give.sections = [section("give", "card", L, { thin: "giveThin", bold: "giveBold", text: "giveText", button: "giveBtn" })];
    }
  }

  return {
    v: 1,
    languages: L,
    fallback: L.includes(fallback) ? fallback : L[0],
    give: give || "",
    /* Chase's defaults, 2026-09-29: across the top, the name in the corner,
       sections rise in, photos still, headings all at once, buttons lift,
       pages fade, no scroll line. */
    design: { look: "night", menu: "top", brand: "name", logo: null, favicon: null, headerLinks: false,
              nav: { current: "lit", tint: "white", line: "subtle", phone: "drop" }, giveTo: "page",
              colors: { background: null, accent: null },
              motion: { entrance: "rise", photos: "still", headings: "plain", buttons: "lift", pages: "fade", progress: "off" } },
    links: [],
    footer: { layout: "split", menu: false, socials: "icons",
              words: kind === "blank" ? {} : Object.fromEntries(L.map((l) => [l, { tagline: word(l, "taglineFill"), small: word(l, "smallFill") }])) },
    pages: PAGES.map((p) => pages[p]),
  };
}

/* ------------------------------------------------------------- cleaning -- */

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const str = (v, max) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").slice(0, max).trim();
const pick = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);

/**
 * A social link typed as only what comes after the site's address (Chase,
 * 2026-10-01: "if they only put in the text after youtube.com/ it will still
 * work"): "@name", "name" or "channel/UC…" becomes the full address. A full
 * or bare-domain address passes through to safeUrl unchanged. Spotify's
 * addresses are opaque ids nobody types, so it needs the whole link.
 */
const SOCIAL_HOME = {
  youtube: (h) => "https://www.youtube.com/" + (/^(@|channel\/|c\/|user\/)/i.test(h) ? h : "@" + h),
  instagram: (h) => "https://www.instagram.com/" + h.replace(/^@/, ""),
  facebook: (h) => "https://www.facebook.com/" + h.replace(/^@/, ""),
  x: (h) => "https://x.com/" + h.replace(/^@/, ""),
  tiktok: (h) => "https://www.tiktok.com/" + (h.startsWith("@") ? h : "@" + h),
  linkedin: (h) => "https://www.linkedin.com/" + (/^(in|company|school)\//i.test(h) ? h : "in/" + h),
};
export function socialUrl(kind, u) {
  const s = str(u, 300).replace(/^\/+/, "");
  if (!s || !SOCIAL_HOME[kind]) return u;
  /* Already an address: a scheme, or a domain before the first slash. */
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || /^[^\s/]+\.[a-z]{2,}([/?#]|$)/i.test(s)) return u;
  if (!/^[@\w.\-\/]+$/.test(s)) return "";
  return SOCIAL_HOME[kind](s);
}

export function safeUrl(u) {
  let s = str(u, 500);
  if (!s) return "";
  /* An address typed as it is said — "youtube.com/@name", "www.x.org" — is
     still an address. Without this the save quietly dropped it (Chase,
     2026-10-01: his YouTube link never reached the footer). */
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s/]+\.[a-z]{2,}([/?#]|$)/i.test(s)) s = "https://" + s;
  if (/^mailto:[^\s<>"']+@[^\s<>"']+$/i.test(s)) return s;
  try {
    const x = new URL(s);
    return x.protocol === "https:" || x.protocol === "http:" ? x.toString() : "";
  } catch { return ""; }
}
/**
 * Where a section sends a visitor: "page:<id>" for one of the site's own
 * pages, or an address safeUrl allows. "" for nowhere.
 */
export function safeLink(u) {
  const s = str(u, 500);
  const m = /^page:([a-z]+)$/.exec(s);
  if (m) return PAGES.includes(m[1]) ? s : "";
  /* A section of the same page (Chase, 2026-10-03: "Jump to section" for
     buttons that point at the same page). Its id, as sections store it. */
  if (/^section:[a-z0-9]{2,24}$/i.test(s)) return s;
  return safeUrl(s);
}

/** Our own uploads (/media/...) or an https picture. Nothing else. */
export function safePhoto(u) {
  const s = str(u, 400);
  if (!s) return null;
  if (/^\/media\/[A-Za-z0-9._/-]{1,200}$/.test(s) && !s.includes("..")) return s;
  const x = safeUrl(s);
  return x.startsWith("https://") ? x : null;
}

const WORD_MAX = { kicker: 80, heading: 400, text: 6000, quote: 900, who: 120, caption: 200, button: 40,
  tagline: 120, small: 400, label: 80, mark: 40, verse: 900, verseRef: 120 };

/* ------------------------------------------------------ formatted words -- */

/* Bold, italic, underline and links (Chase, 2026-09-29: "options for text
   bolding, underlining, and italicizing"), and since 2026-10-03 a size and a
   color on any run of words ("different sizes and colors WITHIN one text
   box"): <span data-sz data-c>, the same names the Mail composer stores
   (lib/tones.js). These fields keep them; every other word stays plain. */
export const RICH = new Set(["heading", "text", "quote", "verse"]);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
const decode = (t) => t.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENT[e])
  .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(Math.min(+n, 0x10ffff)));

/**
 * Formatted words as they may be stored: only <b>, <i>, <u>, <a href> (an
 * address safeLink allows) and <span data-sz data-c> (a size and a color
 * lib/tones.js allows), every tag closed, all other text escaped,
 * line breaks as "\n". Whatever a browser's editable box produces — <div>
 * per line, <strong>, <span style>, pasted pages — comes out as that. This
 * is the only way formatting reaches a page strangers read; the renderer
 * writes it as it is, because this has already made it safe.
 */
export function richClean(input, max = 6000) {
  let s = String(input == null ? "" : input).replace(/\r\n?/g, "\n");
  /* Script and style bodies are not words. */
  s = s.replace(/<(script|style|template|noscript)[\s\S]*?<\/\1\s*>/gi, "");
  /* Blocks become line breaks. */
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(div|p|li|h[1-6]|blockquote)\s*>/gi, "\n");
  const MAP = { b: "b", strong: "b", i: "i", em: "i", u: "u", a: "a", span: "span" };
  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let out = "", last = 0, m;
  const open = [];
  const text = (t) => escHtml(decode(t));
  while ((m = TAG.exec(s))) {
    out += text(s.slice(last, m.index));
    last = m.index + m[0].length;
    const t = MAP[m[2].toLowerCase()];
    if (!t) continue;
    if (m[1]) {
      /* A span that carried nothing usable was not written, but its close
         still belongs to it ("~span"), not to the real span outside. */
      let k = open.lastIndexOf(t);
      if (t === "span") k = Math.max(k, open.lastIndexOf("~span"));
      if (k !== -1) { for (let j = open.length - 1; j >= k; j--) if (open[j][0] !== "~") out += "</" + open[j].replace(/ .*/, "") + ">"; open.splice(k); }
      continue;
    }
    if (t === "span") {
      const at = (name) => { const x = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')', "i").exec(m[3]); return x ? decode(x[1] || x[2] || "") : ""; };
      /* A named size, or any size chosen with − / + (Chase, 2026-10-04): a
         multiple of the words around it, 0.5–3, to two places. */
      const rawSz = at("data-sz");
      const px = /^(\d{1,3}(?:\.5)?)px$/.exec(rawSz || "");
      const sz = SIZE_NAMES.includes(rawSz) ? rawSz
        : px && +px[1] >= 4 && +px[1] <= 200 ? +px[1] + "px"
        : /^\d(\.\d{1,2})?$/.test(rawSz || "") && +rawSz >= 0.5 && +rawSz <= 3 ? String(+rawSz) : "";
      const c = cleanColor(at("data-c")) || "";
      if (!sz && !c) { open.push("~span"); continue; }
      out += "<span" + (sz ? ' data-sz="' + sz + '"' : "") + (c ? ' data-c="' + c + '"' : "") + ">";
      open.push("span");
      continue;
    }
    if (t === "a") {
      const h = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
      const href = safeLink(decode((h && (h[1] || h[2])) || ""));
      if (!href) continue;
      out += '<a href="' + escHtml(href) + '">';
    } else {
      if (open.includes(t)) continue;
      out += "<" + t + ">";
    }
    open.push(t);
  }
  out += text(s.slice(last));
  for (let j = open.length - 1; j >= 0; j--) if (open[j][0] !== "~") out += "</" + open[j] + ">";
  /* Empty marks and runs of blank lines go; so does anything too long,
     measured without its tags and cut as plain words. */
  out = out.replace(/<(b|i|u)><\/\1>|<span[^>]*><\/span>/g, "").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
  if (out.replace(/<[^>]+>/g, "").length > max) out = escHtml(decode(out.replace(/<[^>]+>/g, "")).slice(0, max));
  return out;
}

/** The words alone, for a page's description, a photo's alt text, a summary. */
export function plainOf(rich) {
  return decode(String(rich || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function cleanWords(raw, fields, langs) {
  const out = {};
  for (const l of langs) {
    const src = (raw && raw[l]) || {};
    const w = {};
    for (const f of fields) {
      /* A site saved before headings were one field: its two halves joined. */
      const v = f === "heading" && src.heading == null && (src.thin || src.bold) ? joinHeading(src.thin, src.bold) : src[f];
      w[f] = RICH.has(f) ? richClean(v, WORD_MAX[f] || 200) : str(v, WORD_MAX[f] || 200);
    }
    out[l] = w;
  }
  return out;
}

function cleanSection(raw, langs) {
  const spec = SECTIONS[raw && raw.type];
  if (!spec) return null;
  const s = {
    id: /^[a-z0-9]{2,24}$/i.test(String(raw.id || "")) ? String(raw.id) : sid(),
    type: raw.type,
    variant: pick(raw.type === "cards" ? ({ attached: "vertical", detached: "horizontal" }[raw.variant] || raw.variant) : raw.variant, spec.variants),
    words: cleanWords(raw.words, spec.words, langs),
  };
  if (spec.photo) s.photo = safePhoto(raw.photo);
  if (spec.link) s.link = safeLink(raw.link);
  if (spec.link === "both") s.photoLink = !!raw.photoLink;
  /* PLAIN, RAISED OR TINT (2026-10-06, Chase: "I actually really like that
     accent tinted look. We should add that as a 3rd option next to Plain
     and Raised"): one ground at a time */
  /* Every section, the opening, the header and a full-width photo too
     (2026-10-07). A header saved before kept its ground in bg. */
  const oldBg = raw.type === "header" && raw.tint === undefined && raw.raised === undefined ? raw.bg : null;
  s.tint = !!raw.tint || oldBg === "tint"; s.raised = (!!raw.raised || oldBg === "raised") && !s.tint;
  s.align = ALIGNS.includes(raw.align) ? raw.align : raw.align === "indent" ? "left" : defaultAlign(raw.type, s.variant);
  s.indent = raw.indent === true || raw.align === "indent";
  /* bars beside the title, and joined to the section above (render.js) */
  s.titleBars = raw.titleBars === true;
  s.join = raw.join === true;
  if (spec.buttons) {
    s.buttons = (Array.isArray(raw.buttons) ? raw.buttons : []).filter((b) => ["give", "stay", "contact"].includes(b)).slice(0, 2);
  }
  /* The hero's line under the title (render.js): kept only when it was
     chosen, so a hero saved before the option renders as it always did. */
  if (raw.type === "hero" && typeof raw.divider === "boolean") s.divider = raw.divider;
  /* PAST UPDATES (2026-10-06, Chase: "There needs to be a dropdown menu that
     defines what list you can select … maybe we make the quantity of past
     updates definable"): one public list's mailings, or all of them; how
     many (3–12). */
  if (raw.type === "newsletters") {
    s.list = /^[a-z0-9-]{1,60}$/.test(String(raw.list || "")) ? String(raw.list) : "";
    const n = Math.round(Number(raw.count));
    s.count = n >= 3 && n <= 12 ? n : 5;
  }
  /* The header (render.js): its background, the line along its top and the
     line under its title. Absent means the default look. */
  if (raw.type === "header") {
    s.bg = raw.bg === "accent" ? "accent" : "plain";
    if (s.bg === "accent") { s.raised = false; s.tint = false; }
    s.topline = raw.topline !== false;
    s.divider = raw.divider !== false;
  }
  /* A verse inside Words or Photo and words: its look. */
  if (raw.type === "text" || raw.type === "photoText") {
    s.verseStyle = ["quote", "line", "mark"].includes(raw.verseStyle) ? raw.verseStyle : "quote";
    /* Where the verse sits, the title's own alignment and line, and (photo
       sections) whether the title sits with the words or above everything.
       Unset keeps what every section already looked like. */
    s.versePos = /^(start|end|p\d{1,2})$/.test(raw.versePos || "") ? raw.versePos : "end";
    s.titleAlign = ["left", "center", "right"].includes(raw.titleAlign) ? raw.titleAlign : null;
    s.titleLine = raw.titleLine === true;
    if (raw.type === "photoText" && typeof raw.titleInline === "boolean") s.titleInline = raw.titleInline;
  }
  /* Videos (BACKLOG §3): the buttons under them, and whether the newest
     video's own title and date head the section. */
  /* THE PHOTO EDITOR'S CHOICES (src/js/photo-editor.js): never new pixels,
     only how the original is shown — a crop window with its corners and
     border, or a point, zoom and darkening for frames that change shape. */
  if (raw.photoEdit && typeof raw.photoEdit === "object" && s.photo) {
    const e = raw.photoEdit, n = (v, a, b) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, +v)) : null);
    if (e.w != null) {
      const c = { x: n(e.x, 0, 1), y: n(e.y, 0, 1), w: n(e.w, 0.02, 1), h: n(e.h, 0.02, 1), ar: n(e.ar, 0.1, 10) };
      const dk = n(e.darken, 0, 0.8);
      if (Object.values(c).every((v) => v !== null)) {
        if (["square", "soft", "round"].includes(e.corners)) c.corners = e.corners;
        if (dk) c.darken = dk;
        /* A border: a width and a color (the site's two by name, or any). The
           first version's "thin" / "accent" still read. */
        if (["thin", "accent"].includes(e.border)) c.border = e.border;
        else if (e.border && typeof e.border === "object") {
          const bw = n(e.border.w, 0, 40), bc = String(e.border.c || "");
          if (bw && (bc === "subtle" || bc === "accent" || bc === "accent2" || /^#[0-9a-f]{6}$/i.test(bc))) c.border = { w: Math.round(bw * 2) / 2, c: bc.toLowerCase() };
        }
        s.photoEdit = c;
      }
    } else if (e.fx != null) {
      const f = { fx: n(e.fx, 0, 100), fy: n(e.fy, 0, 100), zoom: n(e.zoom, 1, 3), darken: n(e.darken, 0, 0.8) ?? 0 };
      if (f.fx !== null && f.fy !== null && f.zoom !== null) s.photoEdit = f;
    }
  }
  /* A full-width photo's band: how tall, and the part kept in view (0 top,
     100 bottom). "whole" shows the photo uncropped. */
  if (raw.type === "photo") {
    s.height = ["short", "medium", "tall", "whole"].includes(raw.height) ? raw.height : "medium";
    const fy = Number(raw.focusY);
    s.focusY = Number.isFinite(fy) ? Math.max(0, Math.min(100, Math.round(fy))) : 50;
  }
  if (raw.type === "videos") {
    s.linkStyle = ["outline", "subtle"].includes(raw.linkStyle) ? raw.linkStyle : "buttons";
    s.titleFrom = raw.titleFrom === "latest" ? "latest" : "words";
  }
  if (spec.items === "cards") {
    /* Written words only. A blank card is kept (it was just added and is
       being typed into); the page simply does not draw it. */
    s.numbers = raw.numbers !== false;
    /* LINES BETWEEN, apart from the direction (2026-10-06, Chase: "the
       settings should have horizontal … and vertical … and then attached
       detached as a setting for the lines between the cards"). A section
       saved as Attached is vertical with lines; Detached, horizontal without. */
    s.lines = typeof raw.lines === "boolean" ? raw.lines : raw.variant !== "detached" && raw.variant !== "horizontal";
    s.items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((it) => ({
      words: cleanWords(it && it.words, ["title", "text"], langs),
    }));
  } else if (spec.items) {
    /* A card may carry a picture, and may point at one of the site's own
       pages as well as anywhere else. */
    s.items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it) => ({
      url: safeLink(it && it.url),
      photo: safePhoto(it && it.photo),
      /* "type" is the small colored label at the card's corner; tier is how
         big the card is (Chase, BACKLOG §3: "a link's card size shows its
         importance"). Standard, the section's own style, is the default. */
      words: cleanWords(it && it.words, ["title", "text", "type"], langs),
      tier: ["big", "small"].includes(it && it.tier) ? it.tier : "std",
      /* a button's color, in the Buttons layout */
      color: ["accent2", "outline"].includes(it && it.color) ? it.color
        : /^#[0-9a-f]{6}$/i.test(String((it && it.color) || "")) ? it.color.toLowerCase() : "accent",
    })).filter((it) => it.url);
  }
  return s;
}

/**
 * A PAGE'S TABS (2026-10-06, Chase: "Maybe it isn't a section at all, but an
 * option at the top of each page that acts like tabs open on a browser,
 * where + adds a tab to the page with distinct looks"), after chaseroush.com's
 * Give | Pray. The page's own sections come first and are on every tab; then
 * the bar, and each tab's own sections under it. Up to six tabs. How the bar
 * looks: joined (chaseroush.com's), pills or an underline; centered or left.
 */
export const TAB_STYLES = ["joined", "pills", "underline"];
export function cleanTabs(raw, langs) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  const seen = new Set();
  const items = raw.items.slice(0, 6).map((t, i) => {
    let id = /^[a-z0-9]{2,24}$/i.test(String(t && t.id || "")) ? String(t.id) : "t" + i + Math.random().toString(36).slice(2, 7);
    while (seen.has(id)) id += "x";
    seen.add(id);
    const label = {};
    for (const l of langs) { const v = str(t && t.label && t.label[l], 30); if (v) label[l] = v; }
    return { id, label, sections: (Array.isArray(t && t.sections) ? t.sections : []).slice(0, 30).map((x) => cleanSection(x, langs)).filter(Boolean) };
  });
  if (!items.length) return null;
  return { style: TAB_STYLES.includes(raw.style) ? raw.style : "joined", align: raw.align === "left" ? "left" : "center", items };
}
/** Every section of a page, its tabs' too, in order. */
export function allSections(page) {
  return [...((page && page.sections) || []), ...((page && page.tabs && page.tabs.items) || []).flatMap((t) => t.sections || [])];
}

/**
 * The document as it may be stored. `catalog` is the organization's active
 * language codes: a site may only publish in a language Thauma has.
 */
export function cleanDoc(raw, catalog) {
  const d = raw && typeof raw === "object" ? raw : {};
  let langs = (Array.isArray(d.languages) ? d.languages : []).map(String)
    .filter((l) => LANG_RE.test(l) && (!catalog || catalog.includes(l)));
  langs = [...new Set(langs)].slice(0, 30);
  if (!langs.length) langs = ["en"];
  const design = d.design || {};
  const motion = design.motion || {};
  const m = {};
  for (const [k, allowed] of Object.entries(MOTION)) m[k] = pick(motion[k], allowed);

  const byId = {};
  (Array.isArray(d.pages) ? d.pages : []).forEach((p) => { if (p && PAGES.includes(p.id)) byId[p.id] = p; });
  const order = [...new Set((Array.isArray(d.pages) ? d.pages : []).map((p) => p && p.id).filter((id) => PAGES.includes(id)))];
  PAGES.forEach((p) => { if (!order.includes(p)) order.push(p); });
  const pages = order.map((id) => {
    const p = byId[id] || {};
    const label = {};
    for (const l of langs) { const v = str(p.label && p.label[l], 40); if (v) label[l] = v; }
    return {
      id,
      on: id === "home" ? true : !!p.on,
      /* The opening's scroll indicator, per page (2026-10-03: "A 'Show
         scroll indicator' option per page"). Shown unless switched off, so
         every page saved before keeps it. Which kind is still the site's
         one choice (Design › Motion › Scroll hint). */
      cue: p.cue !== false,
      /* The picture a shared link shows; none means the page's first photo. */
      shareImage: safePhoto(p.shareImage),
      /* The upload behind a cropped share picture, so editing starts from it. */
      shareOrig: safePhoto(p.shareOrig),
      /* SEARCH AND SHARING (the Advanced tab, 2026-10-04): a title and a
         description per language when the owner writes them (else the
         automatic ones), which picture a shared link shows — the page's name
         card (made in the console, per language), its first photo, or a
         picture of the owner's — and the made cards with what they were made
         from, so an unchanged card is never made again. */
      seo: (() => {
        const o = p.seo && typeof p.seo === "object" ? p.seo : {};
        const per = (x, n) => { const r = {}; for (const l of langs) { const v = str(x && x[l], n); if (v) r[l] = v; } return r; };
        return { title: per(o.title, 70), desc: per(o.desc, 200),
                 image: ["card", "photo", "custom", "none"].includes(o.image) ? o.image : null };
      })(),
      shareCards: (() => {
        const r = {};
        for (const l of langs) {
          const c = p.shareCards && p.shareCards[l];
          const url = c && safePhoto(c.url);
          if (url) r[l] = { url, sig: str(c.sig, 300) };
        }
        return r;
      })(),
      label,
      sections: (Array.isArray(p.sections) ? p.sections : []).slice(0, 30).map((s) => cleanSection(s, langs)).filter(Boolean),
      ...(cleanTabs(p.tabs, langs) ? { tabs: cleanTabs(p.tabs, langs) } : {}),
    };
  });

  const links = (Array.isArray(d.links) ? d.links : []).slice(0, 20).map((k) => {
    const kind = SOCIALS.includes(k && k.kind) ? k.kind : "custom";
    let url = kind === "custom" ? safeLink(k && k.url) : safeUrl(socialUrl(kind, k && k.url));
    /* An address typed as it is said, without "mailto:", is still one. */
    if (kind === "email") {
      const raw = str(k.url, 200).replace(/^mailto:/i, "");
      url = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(raw) ? "mailto:" + raw : "";
    }
    const label = {};
    if (kind === "custom") for (const l of langs) { const v = str(k.label && k.label[l], 40); if (v) label[l] = v; }
    /* A web address may be shown as its site's own icon, beside the social
       icons (BACKLOG §3 "smart order"). A page of the site is always words. */
    const icon = kind === "custom" && !!(k && k.icon) && /^https?:\/\//.test(url);
    if (kind !== "custom") return { kind, url, label };
    /* EACH LINK ITS OWN PLACE (2026-10-07, Chase: "I wanted those options
       different PER link, not all the same"): in line with the social links,
       or separated — as words or as an icon — and its icon may be a picture
       of the owner's own ("an option for a custom icon, just in case").
       Saved before: a link shown as an icon was in line; a footer-wide
       choice from the one day it existed is each link's. */
    const ff = d.footer && typeof d.footer === "object" ? d.footer : {};
    const place = ["inline", "apart"].includes(k && k.place) ? k.place : icon ? "inline" : ff.linkPlace === "inline" ? "inline" : "apart";
    const show = ["icon", "words"].includes(k && k.show) ? k.show : ff.linkStyle === "icon" ? "icon" : "words";
    const iconImg = safePhoto(k && k.iconImg);
    return { kind, url, label, place, show, ...(iconImg ? { iconImg } : {}) };
  }).filter((k) => k.url);

  const f = d.footer && typeof d.footer === "object" ? d.footer : {};
  const footer = {
    layout: pick(f.layout, FOOTERS),
    menu: !!f.menu,
    socials: pick(f.socials, SOCIAL_STYLES),
    tagline: pick(f.tagline, TAGLINE_STYLES),
    ground: pick(f.ground, FOOT_GROUNDS),
    line: f.line !== false,
    space: pick(f.space, FOOT_SPACES),
    words: cleanWords(f.words, ["tagline", "small"], langs),
  };

  return {
    v: 1,
    languages: langs,
    fallback: langs.includes(d.fallback) ? d.fallback : langs[0],
    give: safeUrl(d.give),
    design: {
      look: pick(design.look, LOOKS),
      menu: pick(design.menu, MENUS),
      brand: design.brand === "logo" && safePhoto(design.logo) ? "logo" : "name",
      logo: safePhoto(design.logo),
      /* The little picture in a browser tab (Chase, 2026-09-29). */
      favicon: safePhoto(design.favicon),
      /* A site that uploaded a picture before there was a choice keeps it. */
      faviconStyle: FAVICON_STYLES.includes(design.faviconStyle) ? design.faviconStyle
        : safePhoto(design.favicon) ? "photo" : "filled",
      headerLinks: !!design.headerLinks,
      nav: Object.fromEntries(Object.entries(NAV).map(([k, opts]) =>
        [k, pick((design.nav || {})[k], opts)])),
      giveTo: pick(design.giveTo, GIVE_TO),
      /* The owner's own colors (the Custom look), or null for a dark ground
         and the ministry's accent. Everything else is worked out from these. */
      mode: pick(design.mode, MODES),
      colors: {
        background: HEX_RE.test((design.colors || {}).background || "") ? design.colors.background.toUpperCase() : null,
        accent: HEX_RE.test((design.colors || {}).accent || "") ? design.colors.accent.toUpperCase() : null,
      },
      motion: m,
    },
    links,
    footer,
    pages,
  };
}

/* ---------------------------------------------------------------------------
   CLEAN LINKS (BACKLOG §3, 2026-10-04): chaseroush.thauma.one/YouTube goes to
   the YouTube channel; /hr/Darivanje to the Croatian Give page; /Give to the
   giving link. Words are compared without capitals, accents or spaces, in any
   alphabet (Cyrillic included). Returns the address to send the visitor to,
   or null for an ordinary "not found".
   --------------------------------------------------------------------------- */
const SOCIAL_WORDS = { youtube: ["youtube"], instagram: ["instagram", "insta"], facebook: ["facebook"], x: ["x", "twitter"],
  tiktok: ["tiktok"], linkedin: ["linkedin"], spotify: ["spotify"], email: ["email", "mail"] };
export const cleanWord = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[đĐ]/g, "d").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function cleanLinkTarget(doc, segs, { base, q = "", giving = "" }) {
  const lang = segs.length === 2 && doc.languages.includes(segs[0]) ? segs[0] : null;
  if (segs.length !== (lang ? 2 : 1)) return null;
  let raw = segs[segs.length - 1];
  try { raw = decodeURIComponent(raw); } catch { /* keep as typed */ }
  const want = cleanWord(raw);
  if (!want) return null;
  const langs = lang ? [lang, ...doc.languages.filter((l) => l !== lang)] : [doc.fallback, ...doc.languages.filter((l) => l !== doc.fallback)];
  const pageUrl = (id, l) => `${base}/${l}/${id === "home" ? "" : id + "/"}${q}`;
  const on = (id) => doc.pages.some((p) => p.id === id && p.on);

  for (const k of doc.links.filter((x) => x.kind !== "custom")) {
    if ((SOCIAL_WORDS[k.kind] || [k.kind]).includes(want)) return k.url;
  }
  const giveTo = giving || null;
  for (const l of langs) {
    for (const p of doc.pages) {
      const name = (p.label && p.label[l]) || word(l, p.id);
      if (cleanWord(name) !== want && cleanWord(p.id) !== want) continue;
      if (p.id === "give" && giveTo && !on("give")) return giveTo;
      /* The language in the address wins over the one whose name matched. */
      if (on(p.id)) return pageUrl(p.id, lang || l);
    }
    if (giveTo && cleanWord(word(l, "giveBtn")) === want) return giveTo;
    for (const k of doc.links.filter((x) => x.kind === "custom")) {
      if (cleanWord(k.label && k.label[l]) !== want) continue;
      if (k.url.startsWith("page:")) { const id = k.url.slice(5); return on(id) ? pageUrl(id, lang || l) : null; }
      if (/^(https?:|mailto:)/.test(k.url)) return k.url;
    }
  }
  if (cleanWord("give") === want && giveTo) return giveTo;
  return null;
}
