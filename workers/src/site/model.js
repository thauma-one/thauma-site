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

/* The site's own words, for the languages Thauma already speaks. A language
   added later starts from English and the owner writes its words. */
const W = {
  en: {
    home: "Home", about: "About", mission: "Mission", timeline: "Timeline", updates: "Updates",
    give: "Give", stay: "Stay connected", resources: "Resources", contact: "Contact",
    giveBtn: "Give", stayBtn: "Stay connected", heroThin: "Follow the work of", heroText:
      "News, prayer and the road ahead — all in one place.",
    aboutThin: "Who", aboutBold: "we are", missionThin: "Why", missionBold: "we go",
    timelineThin: "The road", timelineBold: "so far", goalsThin: "Where giving", goalsBold: "stands",
    videosThin: "Watch", videosBold: "the latest", signupThin: "Stay", signupBold: "in touch",
    giveThin: "Stand with", giveBold: "the work", giveText: "Every gift, monthly or once, keeps this work going.",
    prayerThin: "Pray", prayerBold: "with us", newsThin: "Past", newsBold: "updates",
    contactThin: "Say", contactBold: "hello", resourcesThin: "Worth", resourcesBold: "reading",
    lang: "Language", menu: "Menu", poweredBy: "A Thauma site", scroll: "Scroll", more: "Read more",
  },
  hr: {
    home: "Početna", about: "O nama", mission: "Misija", timeline: "Vremenska crta", updates: "Novosti",
    give: "Darujte", stay: "Ostanimo povezani", resources: "Resursi", contact: "Kontakt",
    giveBtn: "Daruj", stayBtn: "Ostanimo povezani", heroThin: "Pratite rad —",
    heroText: "Novosti, molitva i put pred nama — sve na jednom mjestu.",
    aboutThin: "Tko", aboutBold: "smo", missionThin: "Zašto", missionBold: "idemo",
    timelineThin: "Put", timelineBold: "do sada", goalsThin: "Gdje stoji", goalsBold: "darivanje",
    videosThin: "Pogledajte", videosBold: "najnovije", signupThin: "Ostanimo", signupBold: "u kontaktu",
    giveThin: "Stanite uz", giveBold: "ovaj rad", giveText: "Svaki dar, mjesečni ili jednokratni, drži ovaj rad živim.",
    prayerThin: "Molite", prayerBold: "s nama", newsThin: "Prošle", newsBold: "novosti",
    contactThin: "Javite", contactBold: "se", resourcesThin: "Vrijedi", resourcesBold: "pročitati",
    lang: "Jezik", menu: "Izbornik", poweredBy: "Stranica Thaume", scroll: "Dolje", more: "Pročitajte više",
  },
  sr: {
    home: "Почетна", about: "О нама", mission: "Мисија", timeline: "Временска линија", updates: "Новости",
    give: "Дарујте", stay: "Останимо повезани", resources: "Ресурси", contact: "Контакт",
    giveBtn: "Даруј", stayBtn: "Останимо повезани", heroThin: "Пратите рад —",
    heroText: "Новости, молитва и пут пред нама — све на једном месту.",
    aboutThin: "Ко", aboutBold: "смо", missionThin: "Зашто", missionBold: "идемо",
    timelineThin: "Пут", timelineBold: "до сада", goalsThin: "Где стоји", goalsBold: "даривање",
    videosThin: "Погледајте", videosBold: "најновије", signupThin: "Останимо", signupBold: "у контакту",
    giveThin: "Станите уз", giveBold: "овај рад", giveText: "Сваки дар, месечни или једнократни, држи овај рад живим.",
    prayerThin: "Молите", prayerBold: "са нама", newsThin: "Претходне", newsBold: "новости",
    contactThin: "Јавите", contactBold: "се", resourcesThin: "Вреди", resourcesBold: "прочитати",
    lang: "Језик", menu: "Мени", poweredBy: "Сајт Thauma", scroll: "Доле", more: "Прочитајте више",
  },
  sl: {
    home: "Domov", about: "O nas", mission: "Poslanstvo", timeline: "Časovnica", updates: "Novice",
    give: "Podarite", stay: "Ostanimo povezani", resources: "Viri", contact: "Kontakt",
    giveBtn: "Podari", stayBtn: "Ostanimo povezani", heroThin: "Spremljajte delo —",
    heroText: "Novice, molitev in pot pred nami — vse na enem mestu.",
    aboutThin: "Kdo", aboutBold: "smo", missionThin: "Zakaj", missionBold: "gremo",
    timelineThin: "Pot", timelineBold: "do zdaj", goalsThin: "Kje je", goalsBold: "darovanje",
    videosThin: "Poglejte", videosBold: "najnovejše", signupThin: "Ostanimo", signupBold: "v stiku",
    giveThin: "Stojte ob", giveBold: "tem delu", giveText: "Vsak dar, mesečni ali enkratni, ohranja to delo živo.",
    prayerThin: "Molite", prayerBold: "z nami", newsThin: "Pretekle", newsBold: "novice",
    contactThin: "Oglasite", contactBold: "se", resourcesThin: "Vredno", resourcesBold: "branja",
    lang: "Jezik", menu: "Meni", poweredBy: "Stran Thauma", scroll: "Navzdol", more: "Preberite več",
  },
};

/** A built-in word in a language, English where that language has none. */
export function word(lang, key) {
  return (W[lang] && W[lang][key]) || W.en[key] || "";
}
export const BUILT_IN_LANGS = Object.keys(W);

/* ---------------------------------------------------------------- pages -- */

/* Every page a site can have, in the default menu order. `id` is its address
   (/en/<id>/; home is /en/). */
export const PAGES = ["home", "about", "mission", "timeline", "updates", "give", "stay", "resources", "contact"];

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
  hero:      { variants: ["behind", "beside", "words", "monogram"], words: ["kicker", "thin", "bold", "text", "button"], photo: true, buttons: true, link: "button" },
  text:      { variants: ["left", "center"], words: ["thin", "bold", "text", "button"], link: "button" },
  photoText: { variants: ["left", "right", "above"], words: ["thin", "bold", "text", "button"], photo: true, link: "both" },
  photo:     { variants: ["drift", "still", "zoom"], words: ["caption"], photo: true, link: "photo" },
  quote:     { variants: ["large", "quiet"], words: ["quote", "who"] },
  timeline:  { variants: ["condensed", "full"], words: ["thin", "bold", "text"] },
  goals:     { variants: ["cards"], words: ["thin", "bold", "text"] },
  prayer:    { variants: ["list"], words: ["thin", "bold", "text"] },
  videos:    { variants: ["stage"], words: ["thin", "bold", "text"] },
  newsletters: { variants: ["list"], words: ["thin", "bold", "text"] },
  signup:    { variants: ["band", "card"], words: ["thin", "bold", "text"] },
  contact:   { variants: ["form"], words: ["thin", "bold", "text"] },
  give:      { variants: ["band", "card"], words: ["thin", "bold", "text", "button"] },
  links:     { variants: ["list", "cards"], words: ["thin", "bold", "text"], items: true },
};
const NOT_RAISED = new Set(["hero", "photo"]);

/* ------------------------------------------------------- design, motion -- */

/* Three looks, each with its own type and shape; the colors are the
   owner's to change (design.colors). A fourth look, Classic — chaseroush.com
   in particular — was built and taken back out the same day (Chase,
   2026-09-29: "we don't need a classic design. Maybe just give options for
   more customization … background and accent colors. But the other elements
   would need to match"). A site saved with it opens as Night. */
export const LOOKS = ["night", "paper", "bold"];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MENUS = ["top", "center", "button"];
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

/* ------------------------------------------------------------ addresses -- */

/* "Chase Roush" → "chaseroush": first and last name, letters and digits only,
   accents folded (Petrović → petrovic). The owner does not choose it; an
   administrator may change it (Chase, 2026-09-29). */
export const RESERVED = new Set(["www", "dev", "next", "staff", "admin", "api", "mail", "embed",
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
  return { id: sid(), type, variant: variant || SECTIONS[type].variants[0], words: wordsFor(langs, map), ...extra };
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
  const hero = (variant) => section("hero", variant, L, heroMap, { photo: null, buttons: ["give", "stay"] });
  const pages = {};
  PAGES.forEach((p) => { pages[p] = { id: p, on: false, label: {}, sections: [] }; });

  if (kind === "blank") {
    pages.home.on = true;
  } else if (kind === "basic") {
    pages.home.on = true; pages.home.sections = [hero("words"), section("text", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "=" })];
    pages.about.on = true; pages.about.sections = [section("photoText", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "=" }, { photo: null })];
    pages.give.on = true; pages.give.sections = [section("give", "card", L, { thin: "giveThin", bold: "giveBold", text: "giveText", button: "giveBtn" })];
    pages.contact.on = true; pages.contact.sections = [section("contact", "form", L, { thin: "contactThin", bold: "contactBold", text: "=" })];
  } else {
    PAGES.forEach((p) => { pages[p].on = p !== "resources"; });
    pages.home.sections = [
      hero("behind"),
      section("photoText", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "=", button: "more" }, { photo: null, link: "page:about" }),
      section("timeline", "condensed", L, { thin: "timelineThin", bold: "timelineBold" }),
      section("goals", "cards", L, { thin: "goalsThin", bold: "goalsBold" }),
      section("videos", "stage", L, { thin: "videosThin", bold: "videosBold" }),
      section("signup", "band", L, { thin: "signupThin", bold: "signupBold", text: "=" }),
    ];
    pages.about.sections = [
      section("photoText", "left", L, { thin: "aboutThin", bold: "aboutBold", text: "=" }, { photo: null }),
      section("quote", "large", L, { quote: "=", who: "=" }),
    ];
    pages.mission.sections = [
      section("text", "left", L, { thin: "missionThin", bold: "missionBold", text: "=" }),
      section("photo", "drift", L, { caption: "=" }, { photo: null }),
    ];
    pages.timeline.sections = [section("timeline", "full", L, { thin: "timelineThin", bold: "timelineBold" })];
    pages.updates.sections = [
      section("videos", "stage", L, { thin: "videosThin", bold: "videosBold" }),
      section("prayer", "list", L, { thin: "prayerThin", bold: "prayerBold" }),
      section("newsletters", "list", L, { thin: "newsThin", bold: "newsBold" }),
    ];
    pages.give.sections = [
      section("give", "band", L, { thin: "giveThin", bold: "giveBold", text: "giveText", button: "giveBtn" }),
      section("goals", "cards", L, { thin: "goalsThin", bold: "goalsBold" }),
    ];
    pages.stay.sections = [section("signup", "card", L, { thin: "signupThin", bold: "signupBold", text: "=" })];
    pages.resources.sections = [section("links", "list", L, { thin: "resourcesThin", bold: "resourcesBold" }, { items: [] })];
    pages.contact.sections = [section("contact", "form", L, { thin: "contactThin", bold: "contactBold", text: "=" })];
  }

  return {
    v: 1,
    languages: L,
    fallback: L.includes(fallback) ? fallback : L[0],
    give: give || "",
    design: { look: "night", menu: "top", brand: "name", logo: null, headerLinks: false,
              colors: { background: null, accent: null },
              motion: { entrance: "rise", photos: "drift", headings: "letters", buttons: "lift", pages: "fade", progress: "on" } },
    links: [],
    footer: { layout: "split", menu: false, socials: "icons", words: {} },
    pages: PAGES.map((p) => pages[p]),
  };
}

/* ------------------------------------------------------------- cleaning -- */

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;
const str = (v, max) => String(v == null ? "" : v).replace(/\r\n?/g, "\n").slice(0, max).trim();
const pick = (v, allowed) => (allowed.includes(v) ? v : allowed[0]);

export function safeUrl(u) {
  const s = str(u, 500);
  if (!s) return "";
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

const WORD_MAX = { kicker: 80, thin: 120, bold: 120, text: 4000, quote: 600, who: 120, caption: 200, button: 40,
  tagline: 120, small: 400 };

function cleanWords(raw, fields, langs) {
  const out = {};
  for (const l of langs) {
    const src = (raw && raw[l]) || {};
    const w = {};
    for (const f of fields) w[f] = str(src[f], WORD_MAX[f] || 200);
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
    variant: pick(raw.variant, spec.variants),
    words: cleanWords(raw.words, spec.words, langs),
  };
  if (spec.photo) s.photo = safePhoto(raw.photo);
  if (spec.link) s.link = safeLink(raw.link);
  if (spec.link === "both") s.photoLink = !!raw.photoLink;
  if (!NOT_RAISED.has(raw.type)) s.raised = !!raw.raised;
  if (spec.buttons) {
    s.buttons = (Array.isArray(raw.buttons) ? raw.buttons : []).filter((b) => ["give", "stay", "contact"].includes(b)).slice(0, 2);
  }
  if (spec.items) {
    /* A card may carry a picture, and may point at one of the site's own
       pages as well as anywhere else. */
    s.items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 40).map((it) => ({
      url: safeLink(it && it.url),
      photo: safePhoto(it && it.photo),
      words: cleanWords(it && it.words, ["title", "text"], langs),
    })).filter((it) => it.url);
  }
  return s;
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
      label,
      sections: (Array.isArray(p.sections) ? p.sections : []).slice(0, 30).map((s) => cleanSection(s, langs)).filter(Boolean),
    };
  });

  const links = (Array.isArray(d.links) ? d.links : []).slice(0, 20).map((k) => {
    const kind = SOCIALS.includes(k && k.kind) ? k.kind : "custom";
    let url = kind === "custom" ? safeLink(k && k.url) : safeUrl(k && k.url);
    /* An address typed as it is said, without "mailto:", is still one. */
    if (kind === "email") {
      const raw = str(k.url, 200).replace(/^mailto:/i, "");
      url = /^[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+$/.test(raw) ? "mailto:" + raw : "";
    }
    const label = {};
    if (kind === "custom") for (const l of langs) { const v = str(k.label && k.label[l], 40); if (v) label[l] = v; }
    return { kind, url, label };
  }).filter((k) => k.url);

  const f = d.footer && typeof d.footer === "object" ? d.footer : {};
  const footer = {
    layout: pick(f.layout, FOOTERS),
    menu: !!f.menu,
    socials: pick(f.socials, SOCIAL_STYLES),
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
      headerLinks: !!design.headerLinks,
      /* The owner's own colors, or null for the look's background and the
         ministry's accent. Everything else is worked out from these two. */
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
