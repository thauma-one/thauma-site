#!/usr/bin/env node
/**
 * Administration › Content — every word, every language, and the languages
 *   node test/content-page.test.mjs
 *
 * The browser half against canned server answers: what each language shows,
 * that the file for a translator is exactly what is on screen, that nothing
 * is saved until Save or Approve (and only what was changed or approved),
 * and that each language's settings are its own.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/website/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("the Content page\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const SITE = {
  languages: ["en", "hr", "sr"], defaultLang: "en",
  donorbox: { en: "", hr: "hr-form", sr: "" },
  visibility: { languages: { hr: { dev: true, live: true }, sr: { dev: true, live: false } } },
};
const NOTES = {
  keep: [{ id: "tk_1", term: "Thauma" }],
  glossary: [{ id: "tg_1", lang: "hr", source: "All of Me For All of Him", target: "Sve od mene Darujem Njega" }],
  guides: { "*": "Warm, plain.", hr: "Standard Croatian." },
  can_write: true,
};
const EN_LINES = [
  { id: "site:nav.home", source: "site", key: "nav.home", english: "Home", current: "Home", status: "done" },
  { id: "site:home.title", source: "site", key: "home.title", english: "Serve", current: "Serve", status: "done" },
  { id: "emails:form.name", source: "emails", key: "form.name", english: "Your name", current: "Your name", status: "done" },
];
const HR_LINES = [
  { id: "site:nav.home", source: "site", key: "nav.home", english: "Home", current: "Početna", status: "done" },
  { id: "site:home.title", source: "site", key: "home.title", english: "Serve", current: "Služiti", status: "outdated" },
  { id: "emails:form.name", source: "emails", key: "form.name", english: "Your name", current: "", status: "missing" },
];
const REVIEW = {
  lang: "hr", name: "Hrvatski", skipped: { unknown: 0, blank: 0, unchanged: 0 },
  items: [
    { id: "emails:form.name", source: "emails", key: "form.name", english: "Your name", english_hash: "h1",
      current: "", proposed: "Vaše ime", status: "missing", problems: [], warnings: [] },
    { id: "site:home.title", source: "site", key: "home.title", english: "Serve", english_hash: "h2",
      current: "Služiti", proposed: "Serve", status: "outdated", problems: [], warnings: [{ code: "same" }] },
  ],
};

async function boot({ answers = {} } = {}) {
  const sent = [];
  const asked = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/website/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/website/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        u = String(u);
        const body = o.body ? JSON.parse(o.body) : null;
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: u, body });
        const ok = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
        if (u.includes("/translation-notes")) return ok(NOTES);
        if (u.includes("/api/admin/content")) {
          if (o.method === "PUT") return ok({ ok: true, sha: "s2", changed: Object.keys(body.changes) });
          return ok({ configured: true, data: JSON.parse(JSON.stringify(SITE)), sha: "s1" });
        }
        if (u.includes("/translate")) {
          if (!body) return ok(u.includes("lang=hr")
            ? { lang: "hr", name: "Hrvatski", lines: HR_LINES }
            : { lang: "en", name: "English", lines: EN_LINES });
          if (answers[body.action]) return answers[body.action](body);
          if (body.action === "file") return ok({ filename: "thauma-hr.csv", text: "id\n", lines: body.ids.length });
          if (body.action === "review") return ok(REVIEW);
          return ok({ ok: true, saved: body.items.length, conflicts: [] });
        }
        return ok({ error: "?" }, 404);
      };
      w.URL.createObjectURL = () => "blob:x";
      w.URL.revokeObjectURL = () => {};
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  // Every question is answered yes, and recorded, so a test can say whether one was asked.
  w.StaffConfirm = async (o) => { asked.push(o); return true; };
  w.StaffPrompt = async (o) => { asked.push(o); return null; };
  w.eval(readFileSync("src/js/admin-content.js", "utf8"));
  await tick(150);
  return { w, d, sent, asked };
}

async function pick(w, d, lang) {
  const sel = d.getElementById("cLang");
  sel.value = lang;
  sel.dispatchEvent(new w.Event("change"));
  await tick(100);
}
const shown = (d) => [...d.querySelectorAll("#cRows [data-id].c-row")].map((r) => r.dataset.id);
const count = (d) => Number((d.getElementById("cDown").textContent.match(/\d+/) || [0])[0]);
const view = (w, d, v) => { d.querySelector(`[data-view="${v}"]`).click(); };

/* ------------------------------------------------------------- languages */

await check("the picker lists the site's languages, then adding one", async () => {
  const { d } = await boot();
  const opts = [...d.querySelectorAll("#cLang option")].map((o) => o.value);
  assert(opts.join() === "en,hr,sr,__add", `offered: ${opts}`);
});

await check("English is edited in place, with nothing to send out", async () => {
  const { d } = await boot();
  assert(d.getElementById("cLang").value === "en", "did not start on English");
  assert(d.getElementById("cDown").hidden && d.getElementById("cUp").hidden, "a translation file offered for English");
  assert(!d.querySelector("#cRows .c-en"), "English shown above English");
});

await check("another language opens on what needs work, English above each line", async () => {
  const { w, d } = await boot();
  await pick(w, d, "hr");
  assert(d.querySelector('[data-view="needs"]').classList.contains("is-on"), "did not open on Needs work");
  assert(shown(d).join() === "site:home.title,emails:form.name", `shown: ${shown(d)}`);
  assert(d.querySelector("#cRows .c-en").textContent === "Serve", "the English is not above the line");
  assert(d.querySelector(".c-row.is-outdated") && d.querySelector(".c-row.is-missing"), "not marked");
});

await check("the emails and forms are a section like any page", async () => {
  const { w, d } = await boot();
  await pick(w, d, "hr");
  view(w, d, "section:emails");
  assert(shown(d).join() === "emails:form.name", `shown: ${shown(d)}`);
});

/* ------------------------------------------------------------------ file */

await check("the file holds exactly what is on screen, and says how many", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "hr");
  assert(count(d) === 2, `Needs work offers ${count(d)}`);
  view(w, d, "all");
  assert(count(d) === 3, `All offers ${count(d)}`);
  view(w, d, "section:nav");
  assert(count(d) === 1 && /line\b/.test(d.getElementById("cDown").textContent), d.getElementById("cDown").textContent);
  d.getElementById("cDown").click();
  await tick();
  const file = sent.find((s) => s.body && s.body.action === "file");
  assert(file && file.body.ids.join() === "site:nav.home", `downloaded ${JSON.stringify(file && file.body.ids)}`);
});

/* ---------------------------------------------------------------- saving */

async function type(w, d, id, value) {
  const ta = d.querySelector(`#cRows textarea[data-id="${id}"]`);
  ta.value = value;
  ta.dispatchEvent(new w.Event("input", { bubbles: true }));
}

await check("an edit is held until Save, which sends only it and asks nothing", async () => {
  const { w, d, sent, asked } = await boot();
  await pick(w, d, "hr");
  await type(w, d, "site:home.title", "Služimo");
  assert(!d.getElementById("cSaveBar").hidden, "no save bar");
  assert(!sent.length, "saved before Save");
  d.getElementById("cSave").click();
  await tick(150);
  const save = sent.find((s) => s.body && s.body.action === "save");
  assert(save, "nothing saved");
  assert(JSON.stringify(save.body.items) === JSON.stringify([{ id: "site:home.title", value: "Služimo", was: "Služiti" }]),
    JSON.stringify(save.body.items));
  assert(!asked.length, "Save asked a question");
});

await check("a line the server refuses is marked, and stays unsaved", async () => {
  const { w, d } = await boot({ answers: { save: () => ({ ok: false, status: 400,
    json: async () => ({ error: "x", code: "problems", ids: ["site:home.title"] }) }) } });
  await pick(w, d, "hr");
  await type(w, d, "site:home.title", "broken");
  d.getElementById("cSave").click();
  await tick(150);
  assert(d.querySelector('.c-row[data-id="site:home.title"]').classList.contains("is-blocked"), "not marked");
  assert(!d.getElementById("cSaveBar").hidden, "the edit was dropped");
});

/* ------------------------------------------------------------- approving */

async function upload(w, d) {
  const input = d.getElementById("cFile");
  const file = new w.File(["id,English,hr\n"], "thauma-hr.csv", { type: "text/csv" });
  file.text = async () => "id,English,hr\n";
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await tick(150);
}

await check("a returned file replaces the editor for approval, flagged lines unticked", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "hr");
  await upload(w, d);
  assert(d.getElementById("cRoot").hidden && !d.getElementById("tlReview").hidden, "no review shown");
  const box = (id) => d.querySelector(`[data-item="${id}"] [data-approve]`);
  assert(box("emails:form.name").checked && !box("site:home.title").checked, "ticks wrong");
  d.getElementById("tlApprove").click();
  await tick(150);
  const apply = sent.find((s) => s.body && s.body.action === "apply");
  assert(apply && apply.body.items.map((i) => i.id).join() === "emails:form.name", JSON.stringify(apply && apply.body));
  assert(!d.getElementById("cRoot").hidden, "the editor did not come back");
});

/* -------------------------------------------------------------- settings */

await check("a language's settings: its switches, the default, its donation form, its notes", async () => {
  const { w, d } = await boot();
  await pick(w, d, "hr");
  d.getElementById("cLangSet").click();
  const body = d.getElementById("cSetBody");
  assert(!d.getElementById("cSet").hidden, "did not open");
  assert(body.querySelector('[data-set="visibility.languages.hr.live"]'), "no live switch");
  assert(body.querySelector('[data-set="donorbox.hr"]').value === "hr-form", "not its donation form");
  assert(body.querySelector('[data-guide="hr"] textarea').value === "Standard Croatian.", "not its guide");
  assert(body.querySelector('[data-gloss-row="tg_1"]'), "not its phrases");
  assert(body.querySelector("[data-remove]"), "cannot be removed");
});

await check("English's settings hold the rules for every translation, and no switches", async () => {
  const { d } = await boot();
  d.getElementById("cLangSet").click();
  const body = d.getElementById("cSetBody");
  assert(!body.querySelector('[data-set^="visibility"]'), "English can be switched off");
  assert(!body.querySelector("[data-remove]"), "English can be removed");
  assert(body.querySelector("[data-keep]"), "no never-translated words");
  assert(body.querySelector('[data-guide="*"] textarea').value === "Warm, plain.", "no every-language guide");
  assert(body.querySelector("[data-default]").disabled, "the default can be switched off");
});

await check("a switch saves at once, against the file it was read from", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "sr");
  d.getElementById("cLangSet").click();
  d.querySelector('[data-set="visibility.languages.sr.live"]').click();
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  assert(put && put.body.sha === "s1" && put.body.changes["visibility.languages.sr.live"] === true,
    JSON.stringify(put && put.body));
});

await check("choosing Add a language asks for its code and stays where it was", async () => {
  const { w, d, asked } = await boot();
  await pick(w, d, "__add");
  assert(asked.some((a) => a.placeholder === "sl"), "no prompt");
  assert(d.getElementById("cLang").value === "en", "the picker was left on Add");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
