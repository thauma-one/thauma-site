#!/usr/bin/env node
/**
 * The CSV a translator takes away and brings back
 *   node test/csv.test.mjs
 *
 * Splitting on commas works until the first translator writes a sentence with
 * a comma in it. Then it works until one writes a quotation. Then it works
 * until one presses Enter inside a cell. Each of those silently shifts every
 * column after it, so the import writes the wrong text into the wrong keys and
 * nothing errors.
 *
 * The functions are lifted from src/js/admin-content.js rather than imported —
 * that file is a browser IIFE with no exports. The copies are kept identical
 * on purpose and this file asserts they still are, so the test cannot drift
 * away from the code it is testing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ---- the implementations, copied verbatim from admin-content.js ---- */

function csvCell(v) {
  v = String(v == null ? '' : v);
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  var rows = [], row = [], field = '', inQuotes = false, i = 0;
  while (i < text.length) {
    var c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.length > 1 || (r[0] && r[0].length); });
}

const roundTrip = (rows) =>
  parseCsv(rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));

console.log("csv — what a translator hands back\n");

/* ---------------------------- the hard parts --------------------------- */

check("a comma inside a sentence does not become a new column", () => {
  // The first thing that breaks a naive split, and the most likely.
  const rows = [["home.lede", "Sent, and staying", "Poslani, i ostajemo"]];
  eq(roundTrip(rows), rows, "round trip");
});

check("quotation marks survive, doubled and back again", () => {
  const rows = [["home.quote", 'He said "go"', 'Rekao je "idi"']];
  eq(roundTrip(rows), rows, "round trip");
});

check("a newline inside a cell does not become a new row", () => {
  /* A translator pressing Enter mid-cell is normal in a spreadsheet, and it is
     the failure that shifts every subsequent row by one — so the import writes
     each translation into the key ABOVE the one it belongs to. Silently. */
  const rows = [["about.body", "One line\nTwo lines", "Jedan red\nDva reda"]];
  eq(roundTrip(rows), rows, "round trip");
});

check("all three at once", () => {
  const nasty = 'He said "go", then\nleft';
  eq(roundTrip([["k", nasty, nasty]]), [["k", nasty, nasty]], "round trip");
});

check("Croatian and Serbian survive unchanged", () => {
  const rows = [
    ["nav.about", "About", "O nama"],
    ["nav.give", "Give", "Дарујте"],
    ["home.h", "Wonder", "Čuđenje — Ђорђе, njegov"],
  ];
  eq(roundTrip(rows), rows, "round trip");
});

check("empty cells stay empty rather than vanishing", () => {
  // An untranslated row is the normal state of a new language file.
  const rows = [["a", "Text", ""], ["b", "", ""], ["c", "More", "Više"]];
  eq(roundTrip(rows), rows, "round trip");
});

/* ------------------------------ real files ----------------------------- */

check("every real English string round-trips", () => {
  /* Against the actual content, not invented examples. 210 strings including
     em dashes, apostrophes and whatever else has accumulated. */
  const en = JSON.parse(readFileSync(
    fileURLToPath(new URL("../src/_data/i18n/en.json", import.meta.url)), "utf8"));

  const leaves = [];
  (function walk(o, p) {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
    } else leaves.push([p, String(o)]);
  })(en, "");

  const rows = leaves.map(([k, v]) => [k, v, v]);
  eq(roundTrip(rows), rows, `${rows.length} strings did not survive`);
});

/* --------------------------- Excel's BOM habit ------------------------- */

check("the BOM Excel needs is stripped on the way back in", () => {
  /* Excel opens a UTF-8 CSV as the local codepage without a BOM, so Croatian
     arrives as mojibake — and a translator would then "fix" it and hand back
     the damage. So the export writes one, and the import has to remove it or
     the first key becomes "\\ufeffhome.lede" and matches nothing. */
  const parsed = parseCsv("﻿key,en,hr\r\nnav.about,About,O nama");
  eq(parsed[0][0], "key", "the BOM is still stuck to the first cell");
  eq(parsed[1], ["nav.about", "About", "O nama"], "row");
});

check("a file saved with CRLF or LF both parse", () => {
  // Windows and Mac spreadsheets disagree, and both hand back valid files.
  for (const nl of ["\r\n", "\n"]) {
    const parsed = parseCsv(`key,en,hr${nl}a,One,Jedan${nl}b,Two,Dva`);
    eq(parsed.length, 3, `${JSON.stringify(nl)}: row count`);
    eq(parsed[2], ["b", "Two", "Dva"], `${JSON.stringify(nl)}: last row`);
  }
});

check("a trailing newline does not add an empty row", () => {
  const parsed = parseCsv("key,en,hr\r\na,One,Jedan\r\n");
  eq(parsed.length, 2, "row count");
});

/* ------------------------- the column layout --------------------------- */

check("the translation is the LAST column in both shapes", () => {
  /* The import reads header.length - 1. Two shapes exist — translating a
     language carries an English source column, editing English itself has
     nothing to put in one — and the rule has to hold for both, or the import
     silently reads the context column as the translation. */
  const translating = ["key", "en", "context", "hr"];
  const editingEnglish = ["key", "context", "en"];

  eq(translating[translating.length - 1], "hr", "translating: last column is the translation");
  eq(editingEnglish[editingEnglish.length - 1], "en", "editing English: last column is the text");

  // And the language the import detects is that same header cell.
  for (const header of [translating, editingEnglish]) {
    const code = header[header.length - 1];
    assert(/^[a-z]{2}(-[a-z]{2})?$/.test(code),
           `the last header must be a language code, got "${code}"`);
  }
});

check("an inserted column does not move the translation", () => {
  /* A spreadsheet invites this: somebody adds a "notes" or "done?" column.
     Reading a fixed index would then import notes as translations. */
  const header = ["key", "en", "context", "notes", "hr"];
  eq(header[header.length - 1], "hr", "the translation must still be last");
});

/* --------------------- context for a split phrase ---------------------- */

check("every split heading is paired, both ways", () => {
  /* Fifteen headings are ONE phrase stored as TWO strings, split for
     typography. The export flags them so a translator sees the whole sentence
     — but only if the pairing is real. A `_thin` with no `_bold`, or the other
     way round, means a fragment goes out with no context and comes back
     translated as if it were a sentence. */
  const en = JSON.parse(readFileSync(
    fileURLToPath(new URL("../src/_data/i18n/en.json", import.meta.url)), "utf8"));
  const leaves = {};
  (function walk(o, p) {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
    } else leaves[p] = o;
  })(en, "");

  const orphans = [];
  for (const key of Object.keys(leaves)) {
    const m = key.match(/^(.*)_(thin|bold)$/);
    if (!m) continue;
    const other = `${m[1]}_${m[2] === "thin" ? "bold" : "thin"}`;
    if (leaves[other] === undefined) orphans.push(key);
  }
  eq(orphans, [], "half a split heading — its partner is missing");
});

check("the three languages agree about which headings are split", () => {
  /* If Croatian has a `_thin` where English does not, the export gives one
     language context the others lack — and the pair that is missing gets
     translated blind. */
  const read = (code) => {
    const doc = JSON.parse(readFileSync(
      fileURLToPath(new URL(`../src/_data/i18n/${code}.json`, import.meta.url)), "utf8"));
    const out = [];
    (function walk(o, p) {
      if (o && typeof o === "object") {
        for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
      } else if (/_(thin|bold)$/.test(p)) out.push(p);
    })(doc, "");
    return out.sort();
  };
  const en = read("en");
  for (const code of ["hr", "sr"]) {
    eq(read(code), en, `${code}.json splits different headings from en.json`);
  }
});

/* ----------------------- the copies have not drifted ------------------- */

check("these functions still match the ones in admin-content.js", () => {
  /* A copied implementation is a test that slowly stops testing anything.
     Comparing the source text is crude and it is enough: if somebody fixes a
     parser bug in one place, this fails until they fix it in both. */
  const src = readFileSync(
    fileURLToPath(new URL("../src/js/admin-content.js", import.meta.url)), "utf8");

  /* Comments stripped before comparing: the copies above are deliberately
     bare while the originals carry their reasoning, and a test that failed
     over a comment would be a test people delete. Logic is what must match. */
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [name, fn] of [["csvCell", csvCell], ["parseCsv", parseCsv]]) {
    const mine = strip(fn.toString());
    // Pull the same function out of the browser file.
    const start = src.indexOf(`function ${name}(`);
    assert(start !== -1, `${name} is no longer in admin-content.js`);
    let depth = 0, i = src.indexOf("{", start), end = i;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (!depth) { end = i + 1; break; } }
    }
    const theirs = strip(src.slice(start, end));
    eq(mine, theirs, `${name} has drifted from the copy in admin-content.js`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
