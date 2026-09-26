/**
 * translation-notes.js — what every translator reads, AI or human (0035)
 *
 * ONE PLACE THAT TURNS THE NOTES INTO WORDS. The console shows them, the
 * translation file carries them, auto-translate sends them — and all three
 * have to say the same thing, or a phrase fixed in one route comes back
 * mistranslated through another. So the brief is built here and only here.
 *
 * Nothing in these notes is public, and nothing in them is about a person.
 */

/** All three kinds, shaped for the console and for briefFor(). */
export async function loadNotes(db) {
  const [keep, glossary, guides] = await Promise.all([
    db.query("translation_keep_all", {}),
    db.query("translation_glossary_all", {}),
    db.query("translation_guides_all", {}),
  ]);
  return {
    keep: keep.map((r) => ({ id: r.id, term: r.term })),
    glossary: glossary.map((r) => ({ id: r.id, lang: r.lang, source: r.source, target: r.target })),
    guides: Object.fromEntries(guides.map((r) => [r.lang, r.guidance])),
  };
}

/**
 * The brief for translating English into `lang`, as plain text a person or a
 * model can read at the top of the work. `langName` is how the language calls
 * itself ("Hrvatski"), so the brief names it the way its translator would.
 *
 * Empty parts are left out rather than printed as headings over nothing — a
 * "Fixed phrases:" line with no phrases under it reads as a list somebody
 * forgot to finish.
 */
export function briefFor(notes, lang, langName) {
  const lines = [];
  const name = langName || lang;
  lines.push(`Translate from English into ${name} (${lang}).`);

  const all = (notes.guides && notes.guides["*"] || "").trim();
  if (all) lines.push("", all);

  const own = (notes.guides && notes.guides[lang] || "").trim();
  if (own) lines.push("", `${name}: ${own}`);

  const keep = (notes.keep || []).map((k) => k.term).filter(Boolean);
  if (keep.length) {
    lines.push("", "Never translate these; keep them exactly as written:",
      keep.map((t) => `"${t}"`).join(", "));
  }

  const fixed = (notes.glossary || []).filter((g) => g.lang === lang);
  if (fixed.length) {
    lines.push("", "Always render these phrases this way:");
    for (const g of fixed) lines.push(`"${g.source}" → "${g.target}"`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------ validation */

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/** A language code worth storing a note under. '*' only where allowed. */
export function cleanLang(value, { allowAll = false } = {}) {
  const v = String(value || "").trim().toLowerCase();
  if (allowAll && v === "*") return v;
  return LANG_RE.test(v) ? v : null;
}

/** Trimmed, bounded text, or null when it is empty or too long. */
export function cleanText(value, max) {
  const v = String(value == null ? "" : value).trim();
  return v && v.length <= max ? v : null;
}
