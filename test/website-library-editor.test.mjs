#!/usr/bin/env node
/**
 * Website › Resources and Events: the words, one language at a time
 *   node test/website-library-editor.test.mjs
 *
 * Chase, 2026-09-28: every editor uses the same "Editing: language ⇄
 * Reference: language" pair. The Library editor used to show every language
 * at once in a grid; now it shows the one being edited with the reference
 * words small above each box — and saving still reads every language.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/admin/website/resources/index.html`)
  .find((f) => existsSync(f));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

console.log("Website › Resources: Editing and Reference\n");
if (!PAGE) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const ITEM = { slug: "test", title: { en: "Field guide" }, summary: { en: "How to start" },
               format: "guide", moment: "growth", body: "" };

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://dev.thauma.one/admin/website/resources/",
  });
  const w = dom.window;
  w.fetch = async (u) => ({ ok: true, status: 200, json: async () => (/library/.test(String(u))
    ? { resources: { items: [JSON.parse(JSON.stringify(ITEM))] }, gatherings: { items: [] }, vocabulary: {} } : {}) });
  w.console.error = () => {};
  w.scrollTo = () => {};
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.eval(readFileSync("src/js/admin-library.js", "utf8"));
  await settle(200);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  click(d.querySelector('[data-lib-item="resources/test"] .adm-row'));
  await settle();
  const panel = () => d.querySelector('[data-lib-item="resources/test"] .adm-panel');
  const shown = () => [...panel().querySelectorAll(".lib-lang-block")].filter((b) => !b.hidden).map((b) => b.dataset.lang);
  return { w, d, click, panel, shown };
}

await check("one language at a time, with Editing, swap and Reference", async () => {
  const { panel, shown } = await boot();
  const langs = JSON.parse(readFileSync(PAGE, "utf8").match(/id="libLangs"[^>]*>([^<]*)</)[1]);
  eq(shown(), [langs[0]], "only the language being edited");
  assert(panel().querySelector("[data-lang-edit]") && panel().querySelector("[data-lang-swap]") &&
    panel().querySelector("[data-lang-ref]"), "the pair");
  eq(panel().querySelectorAll(".lib-lang-block").length, langs.length, "every language still has its boxes");
});

await check("editing another language shows the reference words above its boxes", async () => {
  const { w, panel, shown } = await boot();
  const edit = panel().querySelector("[data-lang-edit]");
  edit.value = "hr";
  edit.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(shown(), ["hr"], "Croatian is being edited");
  const ref = panel().querySelector('.lib-lang-block[data-lang="hr"] [data-lib-ref="title"]');
  eq([ref.hidden, ref.textContent], [false, "Field guide"], "the English shows above");
});

await check("swap trades them", async () => {
  const { panel, click, shown } = await boot();
  click(panel().querySelector("[data-lang-swap]"));
  await settle(200);
  const ref = panel().querySelector("[data-lang-ref]").value;
  eq([shown()[0] !== "en", ref], [true, "en"], "English became the reference");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
