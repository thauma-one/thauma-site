#!/usr/bin/env node
/**
 * Website › Pages — every word, every language, and the languages
 *   node test/content-page.test.mjs
 *
 * The browser half against canned server answers: what each line is called,
 * that a two-part heading is one line and still saves as two, that the file
 * for a translator is exactly what is on screen, that nothing is saved until
 * Save or Approve (and only what was changed or approved), and that the
 * languages table saves each setting as it changes.
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

console.log("Website › Pages\n");
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
const L = (id, english, current, status = "done") => {
  const [source, key] = id.split(/:(.*)/);
  return { id, source, key, english, current, status };
};
const EN_LINES = [
  L("site:nav.about", "About", "About"),
  L("site:home.title", "Home", "Home"),
  L("site:home.cue", "θαῦμα · Greek for wonder", "θαῦμα · Greek for wonder"),
  L("site:home.h1_thin", "On-site,", "On-site,"),
  L("site:home.h1_bold", "behind the scenes.", "behind the scenes."),
  L("site:home.who_cue", "The need", "The need"),
  L("site:home.who_h2_thin", "Real churches,", "Real churches,"),
  L("site:home.who_h2_bold", "real technical need.", "real technical need."),
  L("site:home.who_img_tag", "A stage", "A stage"),
  L("emails:confirm.helloAnon", "Hello,", "Hello,"),
];
const HR_LINES = [
  L("site:nav.about", "About", "O nama"),
  L("site:home.title", "Home", "Početna", "outdated"),
  L("site:home.cue", "θαῦμα · Greek for wonder", "θαῦμα · grčki: čudo"),
  L("site:home.h1_thin", "On-site,", "Na terenu,"),
  L("site:home.h1_bold", "behind the scenes.", "iza pozornice."),
  L("site:home.who_cue", "The need", "Potreba"),
  L("site:home.who_h2_thin", "Real churches,", "Prave crkve,"),
  L("site:home.who_h2_bold", "real technical need.", "stvarna potreba."),
  L("site:home.who_img_tag", "A stage", "Pozornica"),
  L("emails:confirm.helloAnon", "Hello,", "", "missing"),
];
const REVIEW = {
  lang: "hr", name: "Hrvatski", skipped: { unknown: 0, blank: 0, unchanged: 0 },
  items: [
    { id: "emails:confirm.helloAnon", source: "emails", key: "confirm.helloAnon", english: "Hello,", english_hash: "h1",
      current: "", proposed: "Pozdrav,", status: "missing", problems: [], warnings: [] },
    { id: "site:home.title", source: "site", key: "home.title", english: "Home", english_hash: "h2",
      current: "Početna", proposed: "Home", status: "outdated", problems: [], warnings: [{ code: "same" }] },
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
        if (u.includes("/api/admin/publish")) return ok({ configured: true, waiting: 0 });
        if (u.includes("/api/admin/content")) {
          if (o.method === "PUT") return ok({ ok: true, sha: "s2", changed: Object.keys(body.changes) });
          return ok({ configured: true, data: JSON.parse(JSON.stringify(SITE)), sha: "s1" });
        }
        if (u.includes("/translate")) {
          if (u.includes("summary")) return ok({ languages: [
            { code: "en", name: "English", total: 10, missing: 0, outdated: 0 },
            { code: "hr", name: "Hrvatski", total: 10, missing: 1, outdated: 1 },
            { code: "sr", name: "Српски", total: 10, missing: 10, outdated: 0 }] });
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
  w.eval(readFileSync("src/js/rich-text.js", "utf8"));
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
const rows = (d) => [...d.querySelectorAll("#cRows .c-row")].map((r) => r.dataset.row);
const names = (d) => Object.fromEntries([...d.querySelectorAll("#cRows .c-row")]
  .map((r) => [r.dataset.row, r.querySelector(".c-name").textContent]));
const count = (d) => Number((d.getElementById("cDown").textContent.match(/\d+/) || [0])[0]);
const view = (d, v) => { d.querySelector(`[data-view="${v}"]`).click(); };

/* ------------------------------------------------------------- the lines */

await check("each line is named for what it is, its block named by its own heading", async () => {
  const { d } = await boot();
  view(d, "section:home");
  const n = names(d);
  assert(n["site:home.title"] === "Page name", n["site:home.title"]);
  assert(n["site:home.cue"] === "Small line above the headline", n["site:home.cue"]);
  assert(n["split:site:home.h1"] === "Headline", n["split:site:home.h1"]);
  assert(n["split:site:home.who_h2"] === "The need · Heading", n["split:site:home.who_h2"]);
  assert(n["site:home.who_img_tag"] === "The need · Photo description", n["site:home.who_img_tag"]);
  view(d, "section:emails");
  assert(names(d)["emails:confirm.helloAnon"] === "Confirmation email · Greeting, without a name",
    names(d)["emails:confirm.helloAnon"]);
});

await check("the menu and the footer are one page, as on the board", async () => {
  const { d } = await boot();
  assert(d.querySelector('[data-view="section:menu"]'), "no Menu & footer");
  assert(!d.querySelector('[data-view="section:nav"]'), "nav listed on its own");
});

await check("a two-part heading is one line, shown as it reads", async () => {
  const { d } = await boot();
  view(d, "section:home");
  const box = d.querySelector('[data-row="split:site:home.h1"] .c-splitbox');
  assert(box && box.innerHTML === "On-site, <b>behind the scenes.</b>", box && box.innerHTML);
  assert(!d.querySelector('[data-row="site:home.h1_thin"]'), "the halves are listed separately too");
});

await check("editing it saves the two halves, split where the bold begins", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "hr");
  view(d, "section:home");
  const box = d.querySelector('[data-row="split:site:home.h1"] .c-splitbox');
  box.innerHTML = "Na licu mjesta, <b>iza kulisa.</b>";
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("cSave").click();
  await tick(150);
  const save = sent.find((s) => s.body && s.body.action === "save");
  const items = Object.fromEntries(save.body.items.map((i) => [i.id, i.value]));
  assert(items["site:home.h1_thin"] === "Na licu mjesta," && items["site:home.h1_bold"] === "iza kulisa.",
    JSON.stringify(items));
});

await check("a heading keeps the line break typed into it; a page's words take formatting, an email's stay plain", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "hr");
  view(d, "section:home");
  const box = d.querySelector('[data-row="split:site:home.h1"] .c-splitbox');
  assert(box.hasAttribute("data-rt"), "the heading has no formatting bar");
  box.innerHTML = "Na licu<br>mjesta,<br><b>iza <i>kulisa.</i></b>";
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
  view(d, "needs");
  const mail = d.querySelector('[data-row="emails:confirm.helloAnon"]');
  assert(mail && mail.querySelector("textarea") && !mail.querySelector("[data-rt]"), "an email's words are offered formatting");
  d.getElementById("cSave").click();
  await tick(150);
  const save = sent.find((s) => s.body && s.body.action === "save");
  const items = Object.fromEntries(save.body.items.map((i) => [i.id, i.value]));
  assert(JSON.stringify([items["site:home.h1_thin"], items["site:home.h1_bold"]]) === JSON.stringify(["Na licu\nmjesta,\n", "iza <i>kulisa.</i>"]),
    "saved with its breaks and its italic: " + JSON.stringify(items));
});

await check("another language opens on what needs work, beside English", async () => {
  const { w, d } = await boot();
  await pick(w, d, "hr");
  assert(d.querySelector('[data-view="needs"]').classList.contains("is-on"), "did not open on Needs work");
  assert(rows(d).join() === "site:home.title,emails:confirm.helloAnon", `shown: ${rows(d)}`);
  assert(d.querySelector("#cRows .c-ref").textContent === "Home", "the English is not above the line");
  assert(!d.getElementById("cBesideWrap").hidden, "no beside choice");
});

await check("English has a Reference too, and nothing to send out", async () => {
  /* Chase, 2026-09-28: editing English, the reference language used to
     disappear. Writing the source, it helps to see what a translation says. */
  const { d } = await boot();
  assert(d.getElementById("cLang").value === "en", "did not start on English");
  assert(!d.getElementById("cBesideWrap").hidden, "English has no Reference");
  assert(d.getElementById("cBeside").value !== "en", "English offered as its own reference");
  assert(d.getElementById("cDown").hidden && d.getElementById("cUp").hidden, "a translation file offered for English");
});

/* ------------------------------------------------------------------ file */

await check("the file holds exactly what is on screen, and More says how many", async () => {
  const { w, d, sent } = await boot();
  await pick(w, d, "hr");
  assert(count(d) === 2, `Needs work offers ${count(d)}`);
  view(d, "section:home");
  assert(count(d) === 8, `Home offers ${count(d)} (two-part headings count as two lines)`);
  view(d, "section:menu");
  assert(/1 line\b/.test(d.getElementById("cDown").textContent), d.getElementById("cDown").textContent);
  d.getElementById("cMoreBtn").click();
  assert(d.querySelector(".c-more").classList.contains("is-open"), "More did not open");
  d.getElementById("cDown").click();
  await tick();
  const file = sent.find((s) => s.body && s.body.action === "file");
  assert(file && file.body.ids.join() === "site:nav.about", `downloaded ${JSON.stringify(file && file.body.ids)}`);
});

/* ---------------------------------------------------------------- saving */

async function type(w, d, id, value) {
  /* a page's words are a formatted box; an email's a plain one */
  const el = d.querySelector(`#cRows [data-id="${id}"]`);
  if (el.tagName === "TEXTAREA") el.value = value; else el.textContent = value;
  el.dispatchEvent(new w.Event("input", { bubbles: true }));
}

await check("an edit is held until Save, which sends only it and asks nothing", async () => {
  const { w, d, sent, asked } = await boot();
  await pick(w, d, "hr");
  await type(w, d, "site:home.title", "Naslovnica");
  assert(!d.getElementById("cSaveBar").hidden, "no save bar");
  assert(!sent.length, "saved before Save");
  d.getElementById("cSave").click();
  await tick(150);
  const save = sent.find((s) => s.body && s.body.action === "save");
  assert(JSON.stringify(save.body.items) === JSON.stringify([{ id: "site:home.title", value: "Naslovnica", was: "Početna" }]),
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
  assert(d.querySelector('.c-row[data-row="site:home.title"]').classList.contains("is-blocked"), "not marked");
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
  assert(box("emails:confirm.helloAnon").checked && !box("site:home.title").checked, "ticks wrong");
  assert(d.querySelector('[data-item="site:home.title"] .tl-key').textContent === "Page name", "not named");
  d.getElementById("tlApprove").click();
  await tick(150);
  const apply = sent.find((s) => s.body && s.body.action === "apply");
  assert(apply && apply.body.items.map((i) => i.id).join() === "emails:confirm.helloAnon", JSON.stringify(apply && apply.body));
  assert(!d.getElementById("cRoot").hidden, "the editor did not come back");
});

/* ------------------------------------------------------------- languages */

async function table(d) { d.getElementById("cLangs").click(); await tick(100); return d.getElementById("cSetBody"); }

await check("the languages table: progress, both switches, remove — no donation form", async () => {
  const { d } = await boot();
  const body = await table(d);
  assert(!d.getElementById("cSet").hidden, "did not open");
  const hr = body.querySelector('[data-lang="hr"]');
  assert(/9 of 10/.test(hr.textContent), `progress: ${hr.textContent}`);
  assert(hr.querySelector('[data-set="visibility.languages.hr.dev"]') && hr.querySelector('[data-set="visibility.languages.hr.live"]'), "switches");
  assert(!body.querySelector('[data-set^="donorbox"]'), "the donation form is a Give-page setting, not a language's");
  assert(body.querySelector('[data-remove="hr"]'), "cannot be removed");
  const en = body.querySelector('[data-lang="en"]');
  assert(!en.querySelector(".switch") && !en.querySelector("[data-remove]"), "English can be switched off or removed");
  assert(/not public yet/.test(body.querySelector('[data-lang="sr"]').textContent), "a hidden language not marked");
});

await check("how a language is written opens under its row", async () => {
  const { d } = await boot();
  const body = await table(d);
  body.querySelector('[data-notes="hr"]').click();
  assert(body.querySelector('[data-notes-for="hr"] [data-guide="hr"] textarea').value === "Standard Croatian.", "not its guide");
  assert(body.querySelector('[data-notes-for="hr"] [data-gloss-row="tg_1"]'), "not its phrases");
  body.querySelector('[data-notes="en"]').click();
  assert(!body.querySelector('[data-notes-for="hr"]'), "two open at once");
  assert(body.querySelector('[data-notes-for="en"] [data-keep]'), "English's words never translated");
  assert(body.querySelector('[data-guide="*"] textarea').value === "Warm, plain.", "the every-language guide");
});

await check("a switch saves at once, against the file it was read from", async () => {
  const { d, sent } = await boot();
  const body = await table(d);
  body.querySelector('[data-set="visibility.languages.sr.live"]').click();
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  assert(put && put.body.sha === "s1" && put.body.changes["visibility.languages.sr.live"] === true,
    JSON.stringify(put && put.body));
});

await check("the default language is chosen from the site's languages and saved", async () => {
  const { w, d, sent } = await boot();
  const body = await table(d);
  const sel = body.querySelector("[data-default]");
  sel.value = "hr";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  assert(put && put.body.changes.defaultLang === "hr", JSON.stringify(put && put.body));
});

await check("a language is added by name, or by its code for one the list lacks", async () => {
  const { w, d, sent, asked } = await boot();
  const body = await table(d);
  const opts = [...body.querySelectorAll("#ltAdd option")].map((o) => o.value);
  assert(opts.includes("de") && !opts.includes("hr"), "the list offers a language the site has, or lacks German");
  const sel = body.querySelector("#ltAdd");
  sel.value = "de";
  sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  body.querySelector("#ltAddBtn").click();
  await tick(150);
  const post = sent.find((s) => s.method === "POST" && s.url.includes("/api/admin/content"));
  assert(post && post.body.code === "de", JSON.stringify(post && post.body));
  await pick(w, d, "__add");
  assert(asked.some((a) => a.placeholder === "sl"), "Add a language… in the picker did not ask for a code");
});

await check("a line changed on dev and not published shows dev's text, marked and not editable", async () => {
  /* Chase, 2026-10-08: the editor showed the Mission heading on one line while
     dev.thauma.one drew two — the break was on dev, waiting for Publish. */
  const was = EN_LINES[6];
  EN_LINES[6] = { ...was, waiting: "Real\nchurches," };
  try {
    const { d } = await boot();
    const box = d.querySelector('[data-thin="site:home.who_h2_thin"]');
    assert(box, "the heading's box is missing");
    assert(/Real<br>churches,/.test(box.innerHTML), `the box shows ${box.innerHTML}, not dev's two lines`);
    assert(box.getAttribute("contenteditable") === "false", "a waiting line can be edited, and its save would collide on Publish");
    assert(box.closest(".c-row").querySelector(".badge.waiting"), "nothing says the line is waiting to publish");
    assert(!box.closest(".c-row").classList.contains("is-dirty"), "a waiting line counts as an unsaved change");
  } finally { EN_LINES[6] = was; }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
