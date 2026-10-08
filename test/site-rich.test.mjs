#!/usr/bin/env node
/**
 * The site's formatted words (src/js/site-rich.js)
 *   node test/site-rich.test.mjs
 *
 * What Website › Pages stores — the Site Creator's own markup and typed line
 * breaks — drawn as the page shows it, and nothing else let through. One
 * file serves Eleventy's `rich` filter and the editor's live preview.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { richHtml, richPlain } = require("../src/js/site-rich.js");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

console.log("site words with their formatting\n");

check("a plain word comes out as it always did, escaped once", () => {
  eq(richHtml("Q&A — \"yes\""), "Q&amp;A — &quot;yes&quot;", "typed in a plain box");
  eq(richHtml("Q&amp;A"), "Q&amp;A", "saved from a formatted box");
});
check("a typed line break is where the line breaks", () => {
  eq(richHtml("Three expressions\nof"), "Three expressions<br>of", "a break");
});
check("bold, italic, underline, a size and a color, in the site's own colors", () => {
  eq(richHtml('<b>a</b> <i>b</i> <u>c</u>'), "<b>a</b> <i>b</i> <u>c</u>", "marks");
  eq(richHtml('<span data-sz="lg">big</span>'), '<span class="rt-lg">big</span>', "a named size");
  eq(richHtml('<span data-sz="30px" data-c="accent">x</span>'), '<span style="font-size:30px;color:var(--blue)">x</span>', "a size and the technical blue");
  eq(richHtml('<span data-c="accent2">x</span>'), '<span style="color:var(--foam)">x</span>', "the second color is the ministry seafoam");
  eq(richHtml('<span data-c="#AA3355">x</span>'), '<span style="color:#aa3355">x</span>', "any color");
});
check("a link goes somewhere safe; anything else is text", () => {
  eq(richHtml('<a href="https://x.org/">x</a>'), '<a href="https://x.org/" target="_blank" rel="noopener">x</a>', "away");
  eq(richHtml('<a href="/en/give/">give</a>'), '<a href="/en/give/">give</a>', "the site's own");
  eq(richHtml('<a href="javascript:alert(1)">x</a>'), "x", "no script link");
  eq(richHtml('<script>alert(1)</script>'), "&lt;script&gt;alert(1)&lt;/script&gt;", "a script is text");
  eq(richHtml('<b onclick="x">a</b>'), "<b>a</b>", "no attributes on a mark");
  eq(richHtml('<b>open'), "<b>open</b>", "closed when left open");
});
check("plain: the words alone, for an attribute or a title", () => {
  eq(richPlain("Three <b>ways</b>\nof"), "Three ways of", "plain");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
