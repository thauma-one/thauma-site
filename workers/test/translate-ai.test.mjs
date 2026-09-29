#!/usr/bin/env node
/**
 * translate.js — the machine's draft, and the rules it is given
 *   node workers/test/translate-ai.test.mjs
 */
import { instruction, looksWhole, clean, parseAnswer, MODEL } from "../src/translate.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("translate — Workers AI drafts\n");

check("the instruction carries the organization's translation notes", () => {
  const s = instruction("en", "sr", { keep: ["Thauma", "FOH"], glossary: [{ source: "support raising", target: "прикупљање подршке" }],
                                      guide: "Formal address." });
  assert(/English to Serbian/.test(s), "languages");
  assert(/Cyrillic/.test(s) && /ekavian/.test(s), "Serbian's own rule");
  assert(s.includes("Thauma, FOH"), "never-translated words");
  assert(s.includes('"support raising" → "прикупљање подршке"'), "fixed phrases");
  assert(s.includes("Formal address."), "the language's guide");
  assert(/<b>/.test(s) && /\{placeholder\}/.test(s), "keep markup and placeholders");
});

check("an answer that lost a placeholder or a bold mark is not whole", () => {
  assert(looksWhole("Hi {name}, <b>welcome</b>", "Bok {name}, <b>dobro došli</b>"), "whole");
  assert(!looksWhole("Hi {name}", "Bok"), "lost a placeholder");
  assert(!looksWhole("<b>Now</b>", "Sada"), "lost the bold");
});

check("only text and <b> reach a page", () => {
  assert(clean('Hi <script>x</script><b>there</b> <a href="x">y</a>') === "Hi x<b>there</b> y", clean('Hi <script>x</script><b>there</b> <a href="x">y</a>'));
});

check("the answer is read leniently: prose around the JSON is ignored", () => {
  const a = parseAnswer('Sure! {"items":[{"id":"0","text":"Bok"}]} Hope that helps.');
  assert(a && a.items[0].text === "Bok", JSON.stringify(a));
  assert(parseAnswer("no json here") === null, "garbage");
});

check("one model name, in one place", () => {
  assert(/^@cf\//.test(MODEL), MODEL);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
