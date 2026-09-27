#!/usr/bin/env node
/**
 * Administration › Languages — the site in every language
 *   node test/admin-languages.test.mjs
 *
 * What the browser half does with the server's answers: which languages are
 * offered, what the Translate section offers to download, that nothing is
 * saved until lines are approved (and only the approved ones), and that one
 * language's notes never show under another.
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
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

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

const LINES = [
  { id: "site:home.title", source: "site", key: "home.title", english: "Serve", current: "Služiti", status: "done" },
  { id: "site:home.lede", source: "site", key: "home.lede", english: "Hello", current: "", status: "missing" },
  { id: "site:home.more", source: "site", key: "home.more", english: "More", current: "Više", status: "outdated" },
  { id: "emails:form.name", source: "emails", key: "form.name", english: "Your name", current: "", status: "missing" },
];

const REVIEW = {
  lang: "hr", name: "Hrvatski", skipped: { unknown: 0, blank: 0, unchanged: 0 },
  items: [
    { id: "site:home.lede", source: "site", key: "home.lede", english: "Hello", english_hash: "h1",
      current: "", proposed: "Bok", status: "missing", problems: [], warnings: [] },
    { id: "site:home.more", source: "site", key: "home.more", english: "More", english_hash: "h2",
      current: "Više", proposed: "More", status: "outdated", problems: [], warnings: [{ code: "same" }] },
    { id: "emails:form.name", source: "emails", key: "form.name", english: "{name}", english_hash: "h3",
      current: "", proposed: "ime", status: "missing", problems: [{ code: "placeholders", detail: "{name}" }], warnings: [] },
  ],
};

async function boot({ canWrite = true, languages = ["en", "hr", "sr"] } = {}) {
  const sent = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/languages/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/languages/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        u = String(u);
        const body = o.body ? JSON.parse(o.body) : null;
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: u, body });
        const ok = (j) => ({ ok: true, status: 200, json: async () => j });
        if (u.includes("/translation-notes")) return ok({ ...NOTES, can_write: canWrite });
        if (u.includes("/translate")) {
          if (!body) return ok(u.includes("lang=") ? { lang: "hr", lines: LINES, unavailable: [] } : { languages });
          if (body.action === "file") return ok({ filename: "thauma-hr.csv", text: "id\n", lines: body.ids.length });
          if (body.action === "review") return ok(REVIEW);
          if (body.action === "apply") return ok({ ok: true, saved: body.items.length, conflicts: [] });
        }
        return { ok: false, status: 404, json: async () => ({ error: "?" }) };
      };
      w.URL.createObjectURL = () => "blob:x";
      w.URL.revokeObjectURL = () => {};
      w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.eval(readFileSync("src/js/admin-languages.js", "utf8"));
  await tick(150);
  return { w, d, sent };
}

function pick(w, d, lang) {
  const sel = d.getElementById("lnLang");
  sel.value = lang;
  sel.dispatchEvent(new w.Event("change"));
}
const ownGuide = (d) => d.querySelector('[data-guide]:not([data-guide="*"])');

/* ----------------------------------------------------------------- notes */

await check("the words never translated are shown, each removable", async () => {
  const { d } = await boot();
  const chips = [...d.querySelectorAll("#lnKeep .ln-chip")].map((c) => c.firstChild.textContent);
  assert(chips.join(",") === "Thauma,501(c)3", `chips: ${chips}`);
  assert(d.querySelectorAll("#lnKeep [data-keep]").length === 2, "no remove buttons");
});

await check("the picker offers the server's languages, never English", async () => {
  /* The server reads site.json on the content branch, so a language added
     there a minute ago is offered before this page is rebuilt. */
  const { d } = await boot({ languages: ["en", "hr", "sr", "de"] });
  const opts = [...d.querySelectorAll("#lnLang option")].map((o) => o.value);
  assert(opts.join(",") === "hr,sr,de", `offered: ${opts}`);
});

await check("the shared guide stays put; the picked language's guide and phrases follow the picker", async () => {
  const { w, d } = await boot();
  const shared = d.querySelector('[data-guide="*"] textarea');
  assert(shared.value === NOTES.guides["*"], "the every-language guide");
  assert(ownGuide(d).querySelector("textarea").value === NOTES.guides.hr, "the Croatian guide");
  assert([...d.querySelectorAll("#lnGlossary tr[data-id]")].map((r) => r.dataset.id).join() === "tg_1", "Croatian phrases");
  pick(w, d, "sr");
  await tick();
  assert(ownGuide(d).querySelector("textarea").value === "", "Croatian guide shown under Serbian");
  assert([...d.querySelectorAll("#lnGlossary tr[data-id]")].map((r) => r.dataset.id).join() === "tg_2", "Serbian phrases");
  assert(shared.value === NOTES.guides["*"], "the shared guide moved");
});

await check("a guide's Save wakes only when something changed, and saves that guide", async () => {
  const { w, d, sent } = await boot();
  const box = ownGuide(d);
  const save = box.querySelector("[data-save]");
  assert(save.disabled, "Save is live with nothing to save");
  box.querySelector("textarea").value = "Latin script. Short sentences.";
  box.querySelector("textarea").dispatchEvent(new w.Event("input", { bubbles: true }));
  assert(!save.disabled, "Save stays asleep after an edit");
  save.click();
  await tick();
  const post = sent.find((s) => s.body && s.body.kind === "guide");
  assert(post && post.body.lang === "hr", `saved ${JSON.stringify(post && post.body)}`);
});

await check("adding a phrase sends it for the language on screen", async () => {
  const { w, d, sent } = await boot();
  pick(w, d, "sr");
  await tick();
  d.getElementById("lnSource").value = "Serve";
  d.getElementById("lnTarget").value = "Служити";
  d.getElementById("lnGlossAdd").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await tick();
  const post = sent.find((s) => s.body && s.body.kind === "glossary");
  assert(post && post.body.lang === "sr", `sent ${JSON.stringify(post && post.body)}`);
});

await check("somebody who may only read the notes gets no controls for them", async () => {
  const { d } = await boot({ canWrite: false });
  const writable = [...d.querySelectorAll("#lnRoot [data-write]")].filter((el) => !el.hidden);
  assert(!writable.length, `${writable.length} controls offered that would be refused`);
  assert(!d.querySelector("#lnKeep [data-keep]"), "remove buttons on the chips");
  assert([...d.querySelectorAll("[data-guide] textarea")].every((t) => t.readOnly), "a guide is editable");
});

/* ------------------------------------------------------------- translate */

const downloadCount = (d) => Number((d.getElementById("tlDownload").textContent.match(/\d+/) || [0])[0]);

await check("what is missing or outdated is offered, and nothing finished", async () => {
  const { d } = await boot();
  const text = d.getElementById("tlGroups").textContent;
  assert(/1 missing/.test(text) && /1 outdated/.test(text), `site summary: ${text}`);
  assert(downloadCount(d) === 3, `offered ${downloadCount(d)}`);
});

await check("finished lines can be included, for redoing a language", async () => {
  const { w, d } = await boot();
  const box = d.getElementById("tlFinished");
  box.checked = true;
  box.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(downloadCount(d) === 4, `offered ${downloadCount(d)}`);
  box.checked = false;
  box.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(downloadCount(d) === 3, `taken back out: ${downloadCount(d)}`);
});

await check("a group can be left out, or single lines chosen within it", async () => {
  const { w, d, sent } = await boot();
  const emails = d.querySelector('[data-group="emails"]');
  emails.checked = false;
  emails.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(downloadCount(d) === 2, `after leaving emails out: ${downloadCount(d)}`);
  d.querySelector('[data-open="site"]').click();
  const line = d.querySelector('[data-id="site:home.more"]');
  assert(line, "the site's lines did not open");
  line.checked = false;
  line.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert(d.querySelector('[data-group="site"]').indeterminate, "the group does not show it is partly chosen");
  d.getElementById("tlDownload").click();
  await tick();
  const file = sent.find((s) => s.body && s.body.action === "file");
  assert(file && file.body.ids.join() === "site:home.lede", `downloaded ${JSON.stringify(file && file.body.ids)}`);
});

async function upload(w, d) {
  const input = d.getElementById("tlFile");
  const file = new w.File(["id,English,hr\n"], "thauma-hr.csv", { type: "text/csv" });
  file.text = async () => "id,English,hr\n";
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new w.Event("change"));
  await tick(100);
}

await check("a returned file is shown for approval and nothing is saved yet", async () => {
  const { w, d, sent } = await boot();
  await upload(w, d);
  assert(!d.getElementById("tlReview").hidden, "no review shown");
  assert(d.querySelectorAll("#tlItems [data-item]").length === 3, "not every line shown");
  assert(!sent.some((s) => s.body && s.body.action === "apply"), "saved before approval");
});

await check("flagged lines start unticked, and a broken one cannot be ticked until edited", async () => {
  const { w, d } = await boot();
  await upload(w, d);
  const box = (id) => d.querySelector(`[data-item="${id}"] [data-approve]`);
  assert(box("site:home.lede").checked, "a clean line starts unticked");
  assert(!box("site:home.more").checked, "a flagged line starts ticked");
  assert(box("emails:form.name").disabled, "a broken line can be approved");
  const ta = d.querySelector('[data-item="emails:form.name"] textarea');
  ta.value = "{name}";
  ta.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert(!box("emails:form.name").disabled, "an edited line stays blocked");
});

await check("approving saves only the ticked lines, with any edits made", async () => {
  const { w, d, sent } = await boot();
  await upload(w, d);
  const more = d.querySelector('[data-item="site:home.more"]');
  more.querySelector("textarea").value = "Još";
  more.querySelector("textarea").dispatchEvent(new w.Event("input", { bubbles: true }));
  more.querySelector("[data-approve]").checked = true;
  more.querySelector("[data-approve]").dispatchEvent(new w.Event("change", { bubbles: true }));
  d.getElementById("tlApprove").click();
  await tick(100);
  const apply = sent.find((s) => s.body && s.body.action === "apply");
  assert(apply, "nothing was saved");
  const items = Object.fromEntries(apply.body.items.map((i) => [i.id, i]));
  assert(Object.keys(items).sort().join() === "site:home.lede,site:home.more", `saved ${Object.keys(items)}`);
  assert(items["site:home.more"].value === "Još", "the edit was lost");
  assert(items["site:home.more"].was === "Više" && items["site:home.more"].english_hash === "h2", "the review's context was lost");
  assert(d.getElementById("tlReview").hidden, "the review stayed open");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
