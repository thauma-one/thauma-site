/**
 * translation-file.js — the translation work as lines, as a file, and back
 *
 * Everything the Content page's translation work does that is not
 * talking to GitHub or the database, so all of it can be tested in Node:
 *
 *   linesFor     the translatable lines of one source, English beside the
 *                language's current text
 *   withStatus   missing / outdated / done, from translation_state (0036)
 *   buildFile    the CSV handed to Claude or a person
 *   readFile     that CSV coming back, however it was edited on the way
 *   checkLine    what can be said about a returned line without reading the
 *                language: placeholders, markup, kept words, fixed phrases,
 *                the language's alphabet
 *   setLine      writing an approved line into a language document
 *
 * THE FILE'S OWN TEXT IS ENGLISH, whatever the console is set to. It goes to a
 * translator, who translates FROM English and is reading English in every
 * other column; its instructions are part of the work, not console chrome.
 */

/* The two places a visitor's words are kept (see 0036 for the names).
   `label` is what the FILE calls them; the console has its own words. */
export const SOURCES = {
  site: { label: "Site words" },
  emails: { label: "Emails and forms" },
};

/* Site-word keys that are not words: the language's code is written by the
   system when the language is added, and translating it would break the
   file's link to its own language. */
const NOT_WORDS = { site: new Set(["code"]) };

const MAX_VALUE = 5000;

/** Every leaf of a document as dotted path → value, arrays by index. */
export function leafMap(obj, prefix = "", out = {}) {
  if (obj === null || typeof obj !== "object") { out[prefix] = obj; return out; }
  const keys = Array.isArray(obj) ? obj.map((_, i) => String(i)) : Object.keys(obj);
  for (const k of keys) leafMap(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/**
 * The lines of one source for one language, in the English document's order —
 * which is the order the pages and the emails come in.
 *
 * Only English STRINGS are lines. A line the language's document lacks
 * entirely (a key added in English since) is simply missing, the same as an
 * empty one: to a translator there is no difference.
 */
export function linesFor(source, enDoc, langDoc) {
  const en = leafMap(enDoc || {});
  const have = leafMap(langDoc || {});
  const skip = NOT_WORDS[source] || new Set();
  const out = [];
  for (const [key, english] of Object.entries(en)) {
    if (typeof english !== "string" || skip.has(key)) continue;
    const current = typeof have[key] === "string" ? have[key] : "";
    out.push({ id: `${source}:${key}`, source, key, english, current });
  }
  return out;
}

/** A short, stable fingerprint of one English string. */
export async function hashText(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Status for each line, from what translation_state remembers.
 *
 *   missing   nothing written in this language
 *   outdated  the English changed since the translation was recorded, and
 *             the translation did not
 *   done      everything else
 *
 * Two lists come back for the caller to record:
 *   baseline  translated lines the database has never seen, taken as current
 *             (see 0036)
 *   refresh   lines whose English AND translation both changed since the
 *             record — rewritten together, so current, and recorded as such
 *             so the next change to the English alone still shows
 */
export async function withStatus(lines, stateRows) {
  const known = new Map((stateRows || []).map((r) => [`${r.source}:${r.key}`, r]));
  const baseline = [];
  const refresh = [];
  const out = [];
  for (const line of lines) {
    const english_hash = await hashText(line.english);
    const text_hash = await hashText(line.current);
    const row = { source: line.source, key: line.key, english_hash, text_hash };
    const was = known.get(line.id);
    let status = "done";
    if (!line.current.trim()) status = "missing";
    else if (!was) baseline.push(row);
    else if (was.english_hash !== english_hash) {
      if (was.text_hash === text_hash) status = "outdated";
      else refresh.push(row);
    }
    out.push({ ...line, english_hash, status });
  }
  return { lines: out, baseline, refresh };
}

/* ------------------------------------------------------------------ notes */

const PLACEHOLDER_RE = /\{[a-z_]+\}/gi;
const TAG_RE = /<\/?[a-z][^>]*>/gi;

/**
 * The per-line note in the file: only what differs from line to line. The
 * rules every line shares are said once, at the top.
 *
 * SPLIT HEADINGS. Fifteen headings are one phrase stored as two strings for
 * typography ("On-site," + "behind the scenes."). Translated separately they
 * come back as two dangling halves in any language that inflects, so each
 * half carries the whole phrase and which part it is.
 */
export function noteFor(line, englishByKey) {
  const notes = [];
  if (line.source === "site" && line.key === "name") {
    notes.push("This language's name for itself (for example Hrvatski, Deutsch).");
  }
  const split = line.key.match(/^(.*)_(thin|bold)$/);
  if (split) {
    const other = `${split[1]}_${split[2] === "thin" ? "bold" : "thin"}`;
    const otherText = englishByKey[other];
    if (typeof otherText === "string") {
      const whole = split[2] === "thin" ? `${line.english} ${otherText}` : `${otherText} ${line.english}`;
      notes.push(`Part ${split[2] === "thin" ? 1 : 2} of 2 of the heading "${whole}". ` +
        "The second part is shown in bold; divide the translated heading wherever reads naturally.");
    }
  }
  const tokens = line.english.match(PLACEHOLDER_RE);
  if (tokens) notes.push(`Keep ${[...new Set(tokens)].join(" ")} exactly as written.`);
  if (line.english.match(TAG_RE)) notes.push("Keep the <b> </b> tags around the matching words.");
  return notes.join("\n");
}

/* ------------------------------------------------------------------- CSV */

/* Spreadsheets honor exactly one kind of formatting from a CSV: a newline
   inside a quoted cell. So long reference text is soft-wrapped for reading,
   and the returned translation is unwrapped — no line on the site contains a
   newline of its own (asserted in the tests), so nothing real is lost. */
const WRAP_AT = 60;

export function wrapCell(text) {
  const s = String(text == null ? "" : text);
  if (s.length <= WRAP_AT) return s;
  const out = [];
  let line = "";
  for (const word of s.split(" ")) {
    if (line && (line + " " + word).length > WRAP_AT) { out.push(line); line = word; }
    else line = line ? line + " " + word : word;
  }
  if (line) out.push(line);
  return out.join("\n");
}

export function unwrapCell(text) {
  return String(text == null ? "" : text).replace(/\s*\r?\n\s*/g, " ").trim();
}

export function csvCell(v) {
  v = String(v == null ? "" : v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/* A quoted field may hold commas, newlines and doubled quotes; splitting on
   commas works until the first translator writes a sentence with one. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = "", inQuotes = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * The file handed to a translator — Claude in a chat, or a person with a
 * spreadsheet. It has to stand entirely on its own: the reader has never seen
 * this site, and whatever they need to know is in it.
 *
 *   # lines     the brief (the language notes) and how to fill the file in
 *   id          which line this is; how the import finds where it belongs
 *   English     what to translate
 *   Notes       what differs for this line (see noteFor)
 *   Current     what the language says now, when it says anything — the
 *               starting point for a line whose English changed
 *   <language>  EMPTY. The one column that is read back. Starting empty
 *               means an untouched row is plainly untouched, and bringing
 *               the file back can never re-save old text as if it were new.
 *
 * The language's code sits in brackets in the last header, which is how the
 * file says what language it is for when it comes back.
 */
export function buildFile({ lang, langName, brief, lines, englishByKey }) {
  const name = langName || lang;
  /* The brief opens with "Translate from English into …", which is the
     file's title as much as its first instruction. */
  const rules = [
    ...String(brief || `Translate from English into ${name} (${lang}).`).split("\n"),
    "",
    "How to fill this in:",
    `- Write each translation in the last column, "${name} (${lang})". Leave every other column exactly as it is.`,
    `- Translate the meaning for people who read ${name}, not word for word, in the same warm and plain tone.`,
    "- Keep anything in {curly braces} and any <b> </b> tags exactly as written.",
    "- If you are unsure of a line, leave its last column empty. Empty lines are skipped, never erased.",
    "- Return the whole file as CSV, in the same order, with the id column unchanged.",
  ];
  const rows = rules.map((r) => [r ? `# ${r}` : "#"]);
  rows.push(["id", "English", "Notes", `Current ${name} (may be out of date)`, `${name} (${lang})`]);
  for (const line of lines) {
    rows.push([line.id, wrapCell(line.english), noteFor(line, englishByKey || {}),
      wrapCell(line.current), ""]);
  }
  /* The BOM is not optional: without it Excel opens UTF-8 as the local code
     page, and Croatian and Serbian come back as mojibake a translator "fixes". */
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/;

/**
 * A returned file, read as generously as it can be.
 *
 * Instruction rows, blank rows and anything before the header are ignored —
 * a translator (or a model) may drop, reword or add them. The header is the
 * row whose first cell is "id"; the translation column is the header's LAST,
 * so a column added in between (a spreadsheet invites it) does not shift it.
 * A header without the bracketed code is accepted when it is a bare code.
 */
export function readFile(text) {
  const rows = parseCsv(String(text || ""));
  const at = rows.findIndex((r) => String(r[0] || "").trim().toLowerCase() === "id");
  if (at === -1) return { error: "not-a-file" };
  const header = rows[at];
  const col = header.length - 1;
  const last = String(header[col] || "").trim();
  const bracket = last.match(/\(([a-z]{2,3}(?:-[a-z0-9]{2,8})*)\)\s*$/i);
  const lang = (bracket ? bracket[1] : last).toLowerCase();
  if (!CODE_RE.test(lang)) return { error: "no-language" };

  const entries = new Map();
  for (const r of rows.slice(at + 1)) {
    const id = String(r[0] || "").trim();
    if (!id || id.startsWith("#")) continue;
    // Last one wins, the way a person re-reading their own file would expect.
    entries.set(id, unwrapCell(r[col]));
  }
  return { lang, entries: [...entries].map(([id, value]) => ({ id, value })) };
}

/* ----------------------------------------------------------------- checks */

const sorted = (a) => [...(a || [])].sort().join(" ");
const lower = (s) => String(s).toLocaleLowerCase();

/** The alphabet a language is normally written in, from the browser's data. */
export function scriptOf(lang) {
  try { return new Intl.Locale(lang).maximize().script || null; }
  catch { return null; }
}

/**
 * What can be checked about a translated line by somebody who does not read
 * the language — which is the person approving most of them.
 *
 *   problems  it would break on the site: a {placeholder} lost or invented.
 *             Cannot be approved until fixed.
 *   warnings  worth a second look before approving:
 *               markup    <b> tags not the same as the English
 *               kept      a never-translated word went missing
 *               fixed     a fixed phrase was not used
 *               same      identical to the English
 *               script    mostly not in the language's own alphabet
 */
export function checkLine({ english, proposed, lang, notes }) {
  const problems = [];
  const warnings = [];
  const text = String(proposed || "");

  if (sorted(english.match(PLACEHOLDER_RE)) !== sorted(text.match(PLACEHOLDER_RE))) {
    problems.push({ code: "placeholders", detail: [...new Set(english.match(PLACEHOLDER_RE) || [])].join(" ") });
  }
  if (sorted(english.match(TAG_RE)) !== sorted(text.match(TAG_RE))) warnings.push({ code: "markup" });

  const kept = (notes && notes.keep || []).map((k) => k.term).filter(Boolean);
  for (const term of kept) {
    if (lower(english).includes(lower(term)) && !lower(text).includes(lower(term))) {
      warnings.push({ code: "kept", detail: term });
    }
  }
  for (const g of (notes && notes.glossary || []).filter((x) => x.lang === lang)) {
    if (lower(english).includes(lower(g.source)) && !lower(text).includes(lower(g.target))) {
      warnings.push({ code: "fixed", detail: g.target });
    }
  }

  if (text.trim() === english.trim() && /\p{L}{3}/u.test(english)) warnings.push({ code: "same" });

  /* The failure the translation test found: Serbian coming back in Latin
     letters. Kept words, placeholders and tags are removed first — "Thauma"
     in a Cyrillic sentence is correct. */
  const script = scriptOf(lang);
  if (script) {
    let bare = text.replace(PLACEHOLDER_RE, " ").replace(TAG_RE, " ");
    for (const term of kept) bare = bare.split(term).join(" ");
    const letters = bare.match(/\p{L}/gu) || [];
    if (letters.length >= 4) {
      let own = 0;
      try { own = (bare.match(new RegExp(`\\p{Script=${script}}`, "gu")) || []).length; }
      catch { own = letters.length; }                  // a script name this engine lacks
      if (own / letters.length < 0.5) warnings.push({ code: "script", detail: script });
    }
  }
  return { problems, warnings };
}

/** A value fit to store: a string, not blank, not a novel. */
export function cleanValue(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= MAX_VALUE ? s : null;
}

/**
 * Write one approved line into a language document.
 *
 * A path the language's document lacks is created in the English document's
 * shape — object where English has an object, array where it has an array —
 * and ONLY along a path that is a string in English. That is the whole
 * allowance: it gives a new language (or a line added in English since) a
 * place to go, and it cannot invent structure the site does not already have.
 */
export function setLine(doc, enDoc, key, value) {
  const parts = key.split(".");
  let node = doc;
  let en = enDoc;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const enParent = en;
    en = en == null ? undefined : en[k];
    if (en === null || typeof en !== "object") return false;
    fillGaps(node, enParent, k);
    if (node[k] === undefined) node[k] = Array.isArray(en) ? [] : {};
    if (node[k] === null || typeof node[k] !== "object") return false;
    node = node[k];
  }
  const last = parts[parts.length - 1];
  if (!en || typeof en[last] !== "string") return false;
  if (node[last] !== undefined && typeof node[last] !== "string") return false;
  fillGaps(node, en, last);
  node[last] = value;
  return true;
}

/* An array must never get a hole. Writing item 3 of a list whose language
   copy stops at item 1 would leave `null` at item 2, and a template reading
   item 2's title fails the build. The gap is filled with blank copies of the
   English items — untranslated, and shown in English, like any blank line. */
function fillGaps(node, en, k) {
  if (!Array.isArray(node) || !Array.isArray(en)) return;
  for (let j = node.length; j < Number(k); j++) node[j] = blankOf(en[j]);
}

function blankOf(v) {
  if (Array.isArray(v)) return v.map(blankOf);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blankOf(x)]));
  return typeof v === "string" ? "" : v;
}
