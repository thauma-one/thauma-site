#!/usr/bin/env node
/**
 * Administration › Languages — how each language is written
 *   node test/admin-languages.test.mjs
 *
 * The page every translator's notes are kept on (0035). What matters here is
 * what the browser half does with the server's answer: who gets controls,
 * which languages are offered, and that the notes for one language never show
 * under another.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/languages/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the Languages page\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const NOTES = {
  keep: [{ id: "tk_1", term: "Thauma" }, { id: "tk_2", term: "501(c)3" }],
  glossary: [
    { id: "tg_1", lang: "hr", source: "All of Me For All of Him", target: "Sve od mene Darujem Njega" },
    { id: "tg_2", lang: "sr", source: "Serve", target: "Служити" },
  ],
  guides: { "*": "Warm, plain, direct.", hr: "Standard Croatian, Latin script." },
};

async function boot({ canWrite = true } = {}) {
  const sent = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/languages/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/languages/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: String(u), body: o.body ? JSON.parse(o.body) : null });
        return { ok: true, status: 200, json: async () => ({ ...NOTES, can_write: canWrite }) };
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.eval(readFileSync("src/js/admin-languages.js", "utf8"));
  await new Promise((r) => setTimeout(r, 150));
  return { w, d, sent };
}

function pick(w, d, lang) {
  const sel = d.getElementById("lnLang");
  sel.value = lang;
  sel.dispatchEvent(new w.Event("change"));
}

await check("the words never translated are shown, each removable", async () => {
  const { d } = await boot();
  const chips = [...d.querySelectorAll("#lnKeep .ln-chip")].map((c) => c.firstChild.textContent);
  assert(chips.join(",") === "Thauma,501(c)3", `chips: ${chips}`);
  assert(d.querySelectorAll("#lnKeep [data-keep]").length === 2, "no remove buttons");
});

await check("every language is offered except English, which is the source", async () => {
  const { d } = await boot();
  const opts = [...d.querySelectorAll("#lnLang option")].map((o) => o.value);
  assert(opts[0] === "*", `the every-language guide comes first: ${opts}`);
  assert(!opts.includes("en"), "English offered as a translation target");
  assert(opts.includes("hr") && opts.includes("sr"), `site languages missing: ${opts}`);
});

await check("the every-language guide has no fixed phrases", async () => {
  const { d } = await boot();
  assert(d.getElementById("lnGuide").value === NOTES.guides["*"], "wrong guide");
  assert(d.getElementById("lnGlossWrap").hidden, "fixed phrases shown for every language");
});

await check("one language's phrases never show under another", async () => {
  const { w, d } = await boot();
  pick(w, d, "hr");
  const rows = [...d.querySelectorAll("#lnGlossary tr[data-id]")].map((r) => r.dataset.id);
  assert(rows.join(",") === "tg_1", `Croatian shows ${rows}`);
  assert(d.getElementById("lnGuide").value === NOTES.guides.hr, "the Croatian guide");
  pick(w, d, "sr");
  const sr = [...d.querySelectorAll("#lnGlossary tr[data-id]")].map((r) => r.dataset.id);
  assert(sr.join(",") === "tg_2", `Serbian shows ${sr}`);
});

await check("the guide's Save wakes only when something changed", async () => {
  const { w, d } = await boot();
  const save = d.getElementById("lnGuideSave");
  assert(save.disabled, "Save is live with nothing to save");
  const box = d.getElementById("lnGuide");
  box.value = "Warm, plain, direct. Short sentences.";
  box.dispatchEvent(new w.Event("input"));
  assert(!save.disabled, "Save stays asleep after an edit");
});

await check("adding a phrase sends it for the language on screen", async () => {
  const { w, d, sent } = await boot();
  pick(w, d, "hr");
  d.getElementById("lnSource").value = "Serve";
  d.getElementById("lnTarget").value = "Služiti";
  d.getElementById("lnGlossAdd").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
  const post = sent.find((s) => s.method === "POST");
  assert(post, "nothing was sent");
  assert(post.body.kind === "glossary" && post.body.lang === "hr" && post.body.target === "Služiti",
    `sent ${JSON.stringify(post.body)}`);
});

await check("somebody who may only read gets no controls at all", async () => {
  const { w, d } = await boot({ canWrite: false });
  const writable = [...d.querySelectorAll("#lnRoot [data-write]")].filter((el) => !el.hidden);
  assert(!writable.length, `${writable.length} controls offered that would be refused`);
  assert(!d.querySelector("#lnKeep [data-keep]"), "remove buttons on the chips");
  assert(d.getElementById("lnGuide").readOnly, "the guide is editable");
  pick(w, d, "hr");
  assert([...d.querySelectorAll("#lnGlossary input")].every((i) => i.readOnly), "phrases are editable");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
