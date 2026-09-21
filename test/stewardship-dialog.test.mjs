#!/usr/bin/env node
/**
 * The supporter dialog on /staff/stewardship/
 *   node test/stewardship-dialog.test.mjs
 *
 * WHY THESE THINGS AND NOT OTHERS
 * ---------------------------------------------------------------------------
 * The dialog's behavior is exercised by workers/test/staff-stewardship.test.mjs
 * on the server side. What no server test can see is whether the browser half
 * agrees with it — and this console has been bitten by exactly that twice:
 *
 *   · a picker whose payload the server did not recognize, discarded in
 *     silence (see test/admin-console.test.mjs)
 *   · `data-i18n` keys referenced by a template and absent from the
 *     dictionary, so those sections stayed English in Croatian and Serbian —
 *     found by reading, not by any test, and recorded in commit 32849c9
 *
 * So: every key the page asks for exists in all three console languages,
 * every id the script reaches for exists in the markup, and the dropdowns
 * offer exactly what the database will accept.
 */
import { readFileSync } from "node:fs";

const NJK = readFileSync(new URL("../src/staff/stewardship.njk", import.meta.url), "utf8");
const JS = readFileSync(new URL("../src/js/staff-stewardship.js", import.meta.url), "utf8");
const STAFF = readFileSync(new URL("../src/js/staff.js", import.meta.url), "utf8");
const I18N = readFileSync(new URL("../src/js/staff-i18n.js", import.meta.url), "utf8");
const MIG = readFileSync(new URL("../db/migrations/0034_life_events.sql", import.meta.url), "utf8");
const INIT = readFileSync(new URL("../db/migrations/0001_init.sql", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the supporter dialog\n");

/* ------------------------------------------------------------ dictionary -- */

/** Every key defined inside one language's block of STRINGS. */
function keysFor(lang) {
  const start = I18N.indexOf(`\n    ${lang}: {`);
  assert(start > -1, `no ${lang} block in staff-i18n.js`);
  /* The next language block, or the close of STRINGS. Languages are declared
     in order, so the following one bounds this one. */
  const after = ["en", "hr", "sr"]
    .map((l) => I18N.indexOf(`\n    ${l}: {`))
    .filter((i) => i > start)
    .sort((a, b) => a - b)[0];
  const slice = I18N.slice(start, after === undefined ? I18N.indexOf("\n  };", start) : after);
  const keys = new Set();
  for (const m of slice.matchAll(/^\s*['"]([a-zA-Z][\w.]*)['"]\s*:/gm)) keys.add(m[1]);
  return keys;
}

const DICT = { en: keysFor("en"), hr: keysFor("hr"), sr: keysFor("sr") };

check("the three console languages are the same size", () => {
  /* Not a style point. A key present in English and missing elsewhere renders
     as English inside an otherwise translated page, which reads as a bug in
     the translation rather than as a missing string. */
  const missing = [];
  for (const k of DICT.en) {
    for (const lang of ["hr", "sr"]) {
      if (!DICT[lang].has(k)) missing.push(`${lang} is missing ${k}`);
    }
  }
  assert(!missing.length, missing.slice(0, 12).join("; "));
});

/** Keys the page asks for: markup attributes and tr()/fill() calls. */
function keysAsked() {
  const asked = new Set();
  for (const m of NJK.matchAll(/data-i18n(?:-html)?="([\w.]+)"/g)) asked.add(m[1]);
  for (const m of NJK.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(",")) {
      const key = pair.split(":")[1];
      if (key) asked.add(key.trim());
    }
  }
  for (const m of JS.matchAll(/\btr\('([\w.]+)'\)/g)) asked.add(m[1]);
  for (const m of JS.matchAll(/\bfill\('([\w.]+)'/g)) asked.add(m[1]);
  return asked;
}

check("every string the dialog asks for exists, in all three languages", () => {
  const missing = [];
  for (const key of keysAsked()) {
    /* Built at runtime from a row's own value — checked separately below,
       against the schema, which is the stronger test. */
    if (key === "stew.kind." || key === "stew.type.") continue;
    for (const lang of ["en", "hr", "sr"]) {
      if (!DICT[lang].has(key)) missing.push(`${lang}:${key}`);
    }
  }
  assert(!missing.length, `absent from the dictionary: ${missing.join(", ")}`);
});

/* ------------------------------------------------- the schema's own lists -- */

function checkListFrom(sql, column) {
  const re = new RegExp(`${column}\\s+TEXT NOT NULL CHECK \\(${column} IN \\(([^)]*)\\)`, "m");
  const m = sql.match(re);
  assert(m, `no CHECK list for ${column}`);
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}

const KINDS = checkListFrom(MIG, "kind");
const TYPES = checkListFrom(INIT, "type");

check("the life-event dropdown offers exactly what the database accepts", () => {
  const offered = [...NJK.matchAll(/<option value="([\w]+)" data-i18n="stew\.kind\.[\w]+"/g)]
    .map((m) => m[1]);
  assert(offered.length, "no kind options found in the markup");
  const extra = offered.filter((k) => !KINDS.includes(k));
  const absent = KINDS.filter((k) => !offered.includes(k));
  assert(!extra.length, `offered but the database refuses: ${extra.join(", ")}`);
  assert(!absent.length, `the database allows but the form hides: ${absent.join(", ")}`);
});

check("the contact dropdown offers every type EXCEPT newsletter", () => {
  const offered = [...NJK.matchAll(/<option value="([\w]+)" data-i18n="stew\.type\.[\w]+"/g)]
    .map((m) => m[1]);
  assert(offered.length, "no type options found in the markup");
  assert(!offered.includes("newsletter"),
    "a newsletter can be logged by hand — it would be written by the mailing " +
    "run, and logging one here invites somebody to wonder why it does not " +
    "count as personal contact");
  const absent = TYPES.filter((t) => t !== "newsletter" && !offered.includes(t));
  assert(!absent.length, `the database allows but the form hides: ${absent.join(", ")}`);
});

check("every kind and type has a word in all three languages", () => {
  const missing = [];
  for (const k of KINDS) {
    for (const lang of ["en", "hr", "sr"]) {
      if (!DICT[lang].has(`stew.kind.${k}`)) missing.push(`${lang}:stew.kind.${k}`);
    }
  }
  for (const t of TYPES) {
    /* Including newsletter: the form will not offer it, but the TIMELINE
       renders whatever is in the log, and bulk sends are in the log. */
    for (const lang of ["en", "hr", "sr"]) {
      if (!DICT[lang].has(`stew.type.${t}`)) missing.push(`${lang}:stew.type.${t}`);
    }
  }
  assert(!missing.length, missing.join(", "));
});

/* --------------------------------------------------- markup meets script -- */

check("every id the script reaches for exists in the markup", () => {
  const wanted = new Set([...JS.matchAll(/\$\('([\w]+)'\)/g)].map((m) => m[1]));
  const present = new Set([...NJK.matchAll(/\bid="([\w]+)"/g)].map((m) => m[1]));
  const missing = [...wanted].filter((id) => !present.has(id));
  assert(!missing.length, `the script looks up ids that are not on the page: ${missing.join(", ")}`);
});

check("the dialog is loaded on the stewardship page and nowhere else", () => {
  const layout = readFileSync(
    new URL("../src/_includes/layouts/staff.njk", import.meta.url), "utf8");
  const line = layout.split("\n").find((l) => l.includes("staff-stewardship.js"));
  assert(line, "the layout never loads staff-stewardship.js");
  assert(line.includes('staffPage == "stewardship"'),
    "it is loaded unconditionally — this script is the only client of an " +
    "endpoint that returns supporters' contact details, and it has no " +
    "business on pages that do not show them");
});

/* ------------------------------------------------------------- the seam -- */

check("logging a contact refreshes the table behind the dialog", () => {
  assert(STAFF.includes("window.StaffSnapshotReload = loadSnapshot"),
    "staff.js does not expose the snapshot reload");
  assert(JS.includes("window.StaffSnapshotReload"),
    "the dialog never calls it, so the row would go on showing the figure " +
    "that logging the call just invalidated");
  /* On the interaction path specifically. A life event does not change what
     the table says, and reloading after one would be a wasted round trip.
     Searched FROM the handler rather than from the top of the file, because
     the function's own declaration also reads `refreshRowsBehind()` and
     matching that proves nothing about where it is called. */
  const touch = JS.indexOf("swTouchForm').addEventListener('submit'");
  assert(touch > -1, "could not find the log-a-contact handler");
  const calledAt = JS.indexOf("refreshRowsBehind();", touch);
  assert(calledAt > -1, "the refresh is not on the log-a-contact path");
});

check("the old drawer is gone from the row renderer", () => {
  assert(!STAFF.includes("tl-row"),
    "staff.js still renders the timeline drawer the dialog replaced");
  assert(!STAFF.includes("function timelineHTML"),
    "two renderers for one timeline — this is how the console's copies drifted before");
});

/* ------------------------------------------------------------- privacy -- */

check("the dialog is emptied before it is filled", () => {
  /* Opening a second person while the first is still on screen would show
     one person's address under another person's name for as long as the
     request takes. A privacy bug, not a cosmetic one. */
  const open = JS.indexOf("function open(contactId");
  const clear = JS.indexOf("$('swFacts').innerHTML = ''", open);
  const fetchAt = JS.indexOf("call({ url: API + '?contact='", open);
  assert(clear > -1 && fetchAt > -1, "could not find the open path");
  assert(clear < fetchAt, "the previous person's details survive into the new dialog");
});

check("a reply for somebody else is discarded", () => {
  assert(JS.includes("state.contactId !== contactId"),
    "a slow answer for a person the user has already navigated away from " +
    "would be rendered into whoever is on screen now");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
