#!/usr/bin/env node
/**
 * The consoles explain themselves through their controls, not beside them
 *   node test/console-wording.test.mjs
 *
 * Chase, 2026-09-25: "If you feel a description is needed to know how to
 * operate it, it needs worked on a simplified or reworded on the interface."
 * Words ON a control — a label, a button, an option — are the interface.
 * Words ABOUT a control — a hint under it, a note above it, a subtitle
 * saying what the page is for — are a design bug somebody has to read past.
 *
 * The sweep that removed them (every /staff/ and /admin/ page) found that
 * they had also been hiding things: an English note contradicting the form
 * beneath it, a Serbian sentence sitting in the English dictionary, a save
 * confirmation that vanished on reload and went unnoticed because the line
 * it lived in already held a sentence. So this guards the sweep, not the
 * wording of any one string.
 */
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const dir = (d) => readdirSync(new URL("../" + d, import.meta.url))
  .filter((f) => f.endsWith(".njk")).map((f) => `${d}/${f}`);

const TEMPLATES = [...dir("src/staff"), ...dir("src/adminarea"),
                   "src/_includes/embed-panel.njk",
                   "src/_includes/layouts/staff.njk", "src/_includes/layouts/admin.njk"];
const I18N = read("src/js/staff-i18n.js");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("console wording\n");

check("no page carries a subtitle explaining what it is for", () => {
  const found = TEMPLATES.filter((f) => /^(staff|admin)Hint:/m.test(read(f)) ||
                                        /\b(staff|admin)Hint\b/.test(read(f)));
  assert(!found.length, `a page subtitle is back: ${found.join(", ")}`);
});

check("no helper text sits beside a control in the markup", () => {
  /* The classes the removed prose used. An EMPTY one is a status slot that
     the script fills when something happens, and is fine. */
  const HELPER = /<(\w+)[^>]*class="[^"]*\b(fld-hint|switch-note|note-inline|emb-lede|emb-shared|emb-guide-sub|res-shelf-note|v-note|s-hint|p-sync-why|p-manual-why|p-sync-warn)\b[^"]*"[^>]*>([^<]*)</g;
  const found = [];
  for (const f of TEMPLATES) {
    for (const m of read(f).matchAll(HELPER)) {
      if (m[3].trim()) found.push(`${f}: .${m[2]} "${m[3].trim().slice(0, 50)}"`);
    }
    /* The italic aside after a label — "optional", "free text", "newest first". */
    for (const m of read(f).matchAll(/<em data-i18n="([\w.]+)">([^<]*)<\/em>/g)) {
      found.push(`${f}: <em> "${m[2]}"`);
    }
    /* A paragraph of explanation above a section. */
    for (const m of read(f).matchAll(/<p class="note[^"]*"[^>]*>([\s\S]*?)<\/p>/g)) {
      const text = m[1].replace(/<span[^>]*id="[^"]+"[^>]*><\/span>/g, "").replace(/<[^>]+>/g, "").trim();
      if (text) found.push(`${f}: note "${text.slice(0, 50)}"`);
    }
  }
  assert(!found.length, found.join("\n          "));
});

check("the library editor's fields carry no hints", () => {
  const js = read("src/js/admin-library.js");
  const fields = js.slice(js.indexOf("var FIELDS = {"), js.indexOf("\n  };", js.indexOf("var FIELDS = {")));
  assert(fields.length > 100, "could not find the field list");
  assert(!/\bhint\s*:/.test(fields), "a field spec has a hint again");
});

check("no label or placeholder carries a parenthetical, in any language", () => {
  /* "Country (two letters, e.g. US, HR)", "Role (optional)". A field that is
     optional is one you can leave empty; a format that needs an example
     needs a better control. Error messages may still show an example — they
     answer something that already went wrong. */
  const PAREN = /\((optional|neobavezno|nije obavezno|необавезно|није обавезно|two letters|dva slova|два слова)[^)]*\)/i;
  const found = [];
  for (const m of I18N.matchAll(/(['"])([a-zA-Z][\w.]*)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3/g)) {
    if (/^(err|emb\.bad)/.test(m[2])) continue;
    if (PAREN.test(m[4]) || /\b(e\.g\.|npr\.)|нпр\./.test(m[4])) found.push(`${m[2]}: ${m[4].slice(0, 50)}`);
  }
  for (const f of TEMPLATES) {
    for (const m of read(f).matchAll(/(placeholder|aria-label)="([^"]*)"/g)) {
      if (PAREN.test(m[2]) || /\be\.g\./.test(m[2])) found.push(`${f}: ${m[2]}`);
    }
  }
  assert(!found.length, found.join("\n          "));
});

check("the dictionary holds no hint, description or lede strings", () => {
  /* By name, because that is how they were added: every one of the removed
     strings was called *Hint, *Desc, *Why, *.hint or a lede. The two
     composer placeholders sit INSIDE their boxes and vanish when typed over;
     notOnSiteWhy is the reason in an error, not help. */
  const ALLOWED = new Set(["ml.cpSubjectHint", "ml.cpPreheaderHint2", "adm.pf.notOnSiteWhy"]);
  const found = new Set();
  for (const m of I18N.matchAll(/^\s*(['"])([a-zA-Z][\w.]*)\1\s*:/gm)) {
    const k = m[2];
    if (ALLOWED.has(k)) continue;
    if (/(Hint\d*|Desc|Why|[Ll]ede\w*|[Ee]xplain)$|\.hint$/.test(k)) found.add(k);
  }
  assert(!found.size, [...found].join(", "));
});

check("country is chosen from a list, not typed as a code", () => {
  const njk = read("src/staff/stewardship.njk");
  assert(/<select id="swPCountry">/.test(njk), "the country field is not a picker");
  assert(!/id="swPCountry"[^>]*maxlength/.test(njk), "the two-letter text box is back");
  const js = read("src/js/staff-stewardship.js");
  assert(/Intl\.DisplayNames/.test(js), "country names are not shown in the console's language");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
