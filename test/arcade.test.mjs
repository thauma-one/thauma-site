#!/usr/bin/env node
/**
 * The hidden arcade: its doors, its failure engine, its words, its switch
 *   node test/arcade.test.mjs
 *
 * WHY THESE
 * ---------------------------------------------------------------------------
 * The failure engine takes the visitor's page apart for real — its own
 * letters, links and tokens (ARCADE-SPEC.md §2). The one thing it must never
 * do is leave the page different from how it found it, because a visitor who
 * never finishes a door (most of them) just keeps reading. So the heal is the
 * test that matters most: every stage, then heal, and the page's HTML is
 * byte-for-byte what it was.
 *
 * The rest guard the seams: every language has every word the arcade asks
 * for, and nothing about the arcade reaches a page while it is switched off.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the hidden arcade\n");

/* A page like the site's, in a DOM that can measure: jsdom lays nothing out,
   so every element answers as if it were on screen, and element.animate is
   a recording stub. */
function page() {
  const html = `<!doctype html><html lang="en"><head></head><body>
    <nav><div class="wrap nav-in"><a class="logo" href="/en/">THAUMA</a>
      <div class="links"><a href="/en/about/">About</a><a href="/en/mission/">Mission</a></div>
      <div class="nav-actions"><a class="give-btn" href="/en/give/">Give</a></div></div></nav>
    <main><header class="hero"><div class="cue">Θαῦμα · Greek for wonder</div>
      <div class="wordmark">THAUMA</div>
      <p class="hero-line">On-site, <b>behind the scenes.</b></p>
      <p class="lede">Churches across Croatia carry a real technical need.</p>
      <p class="btn-row"><a class="btn solid" href="/en/give/">Give</a></p></header></main>
    <footer><div class="foot-col"><div class="foot-tag">All of me for all of Him.</div>
      <div class="foot-legal">© 2026 Thauma · A Missouri nonprofit in formation</div></div></footer>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.Element.prototype.getBoundingClientRect = function () {
    return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10 };
  };
  w.Element.prototype.animate = function () {
    const a = { onfinish: null, cancel() {}, reverse() {}, playbackRate: 1 };
    setTimeout(() => a.onfinish && a.onfinish(), 0);
    return a;
  };
  w.Element.prototype.getAnimations = function () { return []; };
  w.matchMedia = () => ({ matches: false });
  w.eval(read("src/js/arcade/fail.js"));
  return w;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await check("every stage, then heal: the page is exactly what it was", async () => {
  const w = page();
  const before = w.document.body.innerHTML;
  const e = w.ThaumaFail.create();
  for (let n = 1; n <= 4; n++) e.progress("test", n);
  assert(w.document.querySelectorAll(".arc-ch").length > 0, "stage 1 split no letters — the test would prove nothing");
  assert(w.document.querySelectorAll(".arc-moved").length > 0, "stage 2 moved nothing");
  let healed = false;
  e.progress("test", 4, () => { healed = true; });
  e.heal();
  await wait(250);
  assert(healed, "the door was not told it healed, so its count would never reset");
  eq(e.level, 0, "level after healing");
  const after = w.document.body.innerHTML;
  assert(after === before, "the page's HTML changed:\n" + before.slice(0, 200) + "\n---\n" + after.slice(0, 200));
  eq(w.document.documentElement.getAttribute("style"), null, "the voice swap left tokens on <html>");
});

await check("taking a word apart never changes what it says, or lets it wrap mid-word", async () => {
  const w = page();
  const e = w.ThaumaFail.create();
  const lede = w.document.querySelector(".lede");
  const text = lede.textContent;
  e.split(lede);
  eq(lede.textContent, text, "text after splitting");
  const words = lede.querySelectorAll(".arc-w");
  assert(words.length === text.trim().split(/\s+/).length, `each word is one unbreakable run (${words.length})`);
  eq(lede.querySelectorAll(".arc-ch").length, text.replace(/\s/g, "").length, "one span per letter");
});

await check("typing lights the page's own letters, and healing puts them out", async () => {
  const w = page();
  const e = w.ThaumaFail.create();
  e.light("t");
  const lit = w.document.querySelectorAll(".arc-lit");
  assert(lit.length > 0 && Array.from(lit).every((c) => c.textContent.toLowerCase() === "t"), "only t's are lit");
  e.heal(); await wait(250);
  eq(w.document.querySelectorAll(".arc-lit,.arc-ch").length, 0, "left lit");
});

/* ------------------------------------------------------------- words -- */
const LANGS = ["en", "hr", "sr", "sl"];
const I18N = Object.fromEntries(LANGS.map((l) => [l, JSON.parse(read(`src/_data/i18n/${l}.json`))]));
const cabinets = [...read("src/js/arcade/arcade.js").matchAll(/\{ id: '([a-z]+)',/g)].map((m) => m[1]);

await check("every language has every word the arcade asks for", () => {
  const src = read("src/js/arcade/arcade.js");
  const asked = new Set([...src.matchAll(/w\('([a-z_]+)'\)/g)].map((m) => m[1]));
  for (const c of cabinets) { asked.add(c + "_title"); asked.add(c + "_line"); }
  for (const h of ["tap_hint", "toggle_hint", "dpad_hint"]) asked.add(h);
  assert(cabinets.length >= 7, `found ${cabinets.length} cabinets`);
  for (const l of LANGS) {
    const have = I18N[l].arcade || {};
    const missing = [...asked].filter((k) => !have[k]);
    eq(missing, [], `${l} is missing`);
    eq(Object.keys(have).sort(), Object.keys(I18N.en.arcade).sort(), `${l} has the same keys as English`);
  }
});

await check("the Serbian is Cyrillic, apart from the names", () => {
  const KEEP = /Thaum\w*|Load Out|Soundcheck|Panel Fixer|Cable Run|Follow Spot|Strike|Cue Stack|WASD|LED|\bA D\b/g;
  for (const [k, v] of Object.entries(I18N.sr.arcade)) {
    assert(!/[A-Za-zČĆŠŽĐčćšžđ]/.test(v.replace(KEEP, "")), `sr arcade.${k} still has Latin: ${v}`);
  }
});

await check("the old game's words are gone from every language", () => {
  for (const l of LANGS) eq(Object.keys(I18N[l].notFound).sort(), ["cta", "cue", "dict_def", "dict_ipa", "dict_word", "lede"], l);
});

/* ------------------------------------------------------------ switch -- */
await check("nothing of the arcade reaches a page unless its switch is on", () => {
  const inc = read("src/_includes/arcade-doors.njk");
  const body = inc.replace(/\{#[\s\S]*?#\}/g, "").trim();
  assert(/^\{%-? if visible\.sections\.arcade %\}[\s\S]*\{%-? endif %\}$/.test(body), "the include is not wholly inside the switch");
  for (const f of ["src/_includes/layouts/base.njk", "src/coming-soon.njk", "src/404.njk", "src/arcade.njk"]) {
    assert(read(f).includes('{% include "arcade-doors.njk" %}'), `${f} does not include the doors`);
    assert(!/arcade\/(doors|fail|arcade)\.js/.test(read(f)), `${f} loads an arcade script outside the switch`);
  }
  assert(!/arcade|THAUMA_TAUNTS|thauma-game/.test(read("src/js/main.js").replace(/\/\/.*$/gm, "")), "main.js still carries a door");
});

await check("/arcade/ and its words are built only while the switch is on", async () => {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  for (const [file, url] of [["../src/arcade.11tydata.js", "/arcade/index.html"], ["../src/arcade-words.11tydata.js", "/arcade/words.json"]]) {
    const f = req(file).eleventyComputed.permalink;
    eq(f({ visible: { sections: { arcade: false } } }), false, `${file} off`);
    eq(f({ visible: { sections: { arcade: true } } }), url, `${file} on`);
  }
  const site = JSON.parse(read("src/_data/site.json"));
  assert(site.visibility.sections.arcade && "live" in site.visibility.sections.arcade, "site.json has no arcade switch");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
