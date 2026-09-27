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
 * The file is built and read on the server, in workers/src/lib/
 * translation-file.js (the Content page's translation file); this
 * tests the functions it uses, and the real content they have to carry.
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

import { csvCell, parseCsv, wrapCell, unwrapCell, buildFile, readFile }
  from "../workers/src/lib/translation-file.js";

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

/* ----------------------------- wrapping -------------------------------- */

check("wrapping and unwrapping is lossless for every real string", () => {
  /* A CSV cannot carry column widths or styles — the only formatting a
     spreadsheet honors is a newline inside a quoted cell. So the text columns
     are soft-wrapped, and the import must undo it EXACTLY. The longest string
     on the site is 388 characters; as one line it makes the column wider than
     the screen. */
  const en = JSON.parse(readFileSync(
    fileURLToPath(new URL("../src/_data/i18n/en.json", import.meta.url)), "utf8"));
  const leaves = [];
  (function walk(o, p) {
    if (o && typeof o === "object") {
      for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
    } else leaves.push([p, String(o)]);
  })(en, "");

  const lossy = leaves.filter(([, v]) => unwrapCell(wrapCell(v)) !== v).map(([k]) => k);
  eq(lossy, [], "these strings do not survive the wrap");
});

check("NO SOURCE STRING CONTAINS A NEWLINE — the wrap depends on it", () => {
  /* The whole scheme rests on this. Unwrapping collapses every newline back to
     a space, so a string that legitimately contained one would come back
     changed. It is true of all three languages today; if it ever stops being
     true, wrapping has to go rather than quietly eating a line break in
     somebody's copy. */
  for (const code of ["en", "hr", "sr"]) {
    const doc = JSON.parse(readFileSync(
      fileURLToPath(new URL(`../src/_data/i18n/${code}.json`, import.meta.url)), "utf8"));
    const offenders = [];
    (function walk(o, p) {
      if (o && typeof o === "object") {
        for (const k of Object.keys(o)) walk(o[k], p ? `${p}.${k}` : k);
      } else if (typeof o === "string" && /[\r\n]/.test(o)) offenders.push(p);
    })(doc, "");
    eq(offenders, [], `${code}.json has strings with newlines — the CSV wrap would eat them`);
  }
});

check("a wrapped cell survives the CSV itself", () => {
  // Wrapping puts newlines inside cells, which is the case the parser has to
  // get right — and the one that shifts every following row if it does not.
  const long = "A well-run sound system says nothing about whether the people " +
               "running it know each other, or anyone else doing the same work.";
  const rows = [["values.items.2.text", wrapCell(long), "", wrapCell(long)]];
  const back = roundTrip(rows);
  eq(back, rows, "the wrapped cells did not survive");
  eq(unwrapCell(back[0][3]), long, "and unwrapping returns the original");
});

check("the id column is never wrapped", () => {
  // A line break in an identifier makes the row unmatchable on the way back.
  const long = "x".repeat(200);
  const text = buildFile({ lang: "hr", langName: "Hrvatski", brief: "", lines: [
    { id: "site:notFound.taunts.30", source: "site", key: "notFound.taunts.30", english: long, current: "" }] });
  eq(readFile(text).entries.map((e) => e.id), ["site:notFound.taunts.30"], "the id came back changed");
});

check("the file carries the language's own name, in a row", () => {
  /* Every language file has a `name` row — "English", "Hrvatski", "Српски" —
     so an uploaded file already says what the language is called, in the words
     of whoever translated it. The import reads that row rather than computing
     a name, and the dialogs then say "Add Slovenščina (sl)" instead of
     "Add sl".

     This asserts the row exists and is filled in every language, because the
     moment one is blank the dialogs quietly fall back to a browser guess. */
  for (const code of ["en", "hr", "sr"]) {
    const doc = JSON.parse(readFileSync(
      fileURLToPath(new URL(`../src/_data/i18n/${code}.json`, import.meta.url)), "utf8"));
    assert(typeof doc.name === "string" && doc.name.trim() !== "",
           `${code}.json has no name — the dialogs would show a bare code`);
    assert(doc.code === code,
           `${code}.json says its code is "${doc.code}"`);
  }
});

/* ------------------------- the column layout --------------------------- */

check("the header carries the language CODE in brackets", () => {
  /* Long name for the person, code for the machine, one string. A hand-made
     file with a bare code still works — refusing it would be pedantry. */
  const lang = (h) => readFile(`id,English,${h}\nsite:a,b,c`).lang;
  eq(lang("Slovenščina (sl)"), "sl", "long header");
  eq(lang("Português (pt-br)"), "pt-br", "regional code");
  eq(lang("hr"), "hr", "bare code");
  eq(lang(" SL "), "sl", "bare code, sloppily typed");
});

check("the translation is the LAST column, whatever is added before it", () => {
  /* A spreadsheet invites an extra "notes" or "done?" column. Reading a fixed
     index would then import notes as translations. */
  const text = buildFile({ lang: "sl", langName: "Slovenščina", brief: "", lines: [] });
  const header = parseCsv(text).find((r) => r[0] === "id");
  eq(header[header.length - 1], "Slovenščina (sl)", "last header");
  const back = readFile("id,English,Notes,Done?,sl\nsite:a,Hi,,yes,Živjo");
  eq(back.entries, [{ id: "site:a", value: "Živjo" }], "an inserted column moved the translation");
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
