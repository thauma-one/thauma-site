#!/usr/bin/env node
/**
 * Website (the ministry's own site, 0044) — the editor
 *   node test/partner-site-editor.test.mjs
 *
 * The real page and scripts, with /api/staff-site answered in place: the
 * menu, a page's sections, adding one, the words saved as typed, and the
 * read-only view for somebody the owner has not allowed.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { starter, cleanDoc } from "../workers/src/site/model.js";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/staff/website/index.html`).find((f) => existsSync(f));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

console.log("Website editor\n");
if (!PAGE) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

function answer({ edit = true, owner = true, published = false } = {}) {
  const draft = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }), ["en", "hr"]);
  return {
    published: published ? JSON.parse(JSON.stringify(draft)) : null,
    you: { email: "c@t.one", name: "Chase Roush", roles: ["partner", "staff"] },
    partner: { id: "p", display_name: "Chase Roush", slug: "chase-roush" },
    site: { subdomain: "chaseroush", address: "/site/chaseroush/", preview: "/site/chaseroush/?draft",
            enabled: false, published_at: null, unpublished: true, dns: null },
    draft,
    languages: [{ code: "en", name: "English", native_name: "English" }, { code: "hr", name: "Croatian", native_name: "Hrvatski" }],
    theme: { accent: "#1AE4FF", accent2: "#25FFA1" },
    can: { edit, owner }, owner: { name: "Chase Roush" }, editors: [], requests: [], my_request: null,
  };
}

async function boot(opts) {
  const sent = [];
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/website/" });
  const w = dom.window;
  w.fetch = async (u, o = {}) => {
    if (o.method === "POST") sent.push(JSON.parse(o.body));
    return { ok: true, status: 200, json: async () => answer(opts) };
  };
  w.console.error = () => {};
  w.scrollTo = () => {};
  w.scrollBy = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-site.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffToast = () => {};
  await settle(200);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  /* Design is the first tab (Chase, 2026-09-29); Pages is one click away. */
  const pages = () => click(d.querySelector('[data-ws-tab="pages"]'));
  return { w, d, sent, click, pages };
}

await check("it opens on Design; Pages lists every page, Timeline and Resources off, nothing to type in", async () => {
  const { d, pages } = await boot();
  assert(!d.getElementById("wsDesign").hidden && d.getElementById("wsPages").hidden, "Design first");
  pages();
  const rows = [...d.querySelectorAll(".ws-prow")];
  eq(rows.map((r) => r.querySelector("b").textContent), ["Home", "About", "Mission", "Updates", "Give", "Stay connected", "Contact", "Timeline", "Resources"], "pages");
  assert(rows[7].classList.contains("is-off") && rows[8].classList.contains("is-off"), "Timeline and Resources off");
  eq(d.querySelectorAll("#wsPages input[type=text], #wsPages [data-rt]").length, 0, "no box to type in");
});

await check("a page opens to its sections as rows; All pages and the page menu lead out", async () => {
  const { w, d, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  eq([...d.querySelectorAll(".ws-stile-words b")].map((n) => n.textContent), ["Opening", "Photo and words"], "Home's sections");
  assert(/Follow the work of/.test(d.querySelector(".ws-stile-words span").textContent), "each with one line of its words");
  const pick = d.querySelector("[data-pick-page]");
  pick.value = "give";
  pick.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(d.querySelector("[data-pick-page]").value, "give", "straight to another page");
  click(d.querySelector("[data-all-pages]"));
  assert(d.querySelector(".ws-plist"), "back to all pages");
});

await check("a row unfolds where it is, one at a time; a new section goes where asked and opens", async () => {
  const { d, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="1"]'));
  assert(d.querySelector('.ws-acc[data-si="1"]').classList.contains("is-open"), "the second opened");
  click(d.querySelector('[data-edit-sec="0"]'));
  eq([...d.querySelectorAll(".ws-acc.is-open")].map((a) => a.dataset.si), ["0"], "only one open");
  click(d.querySelector('[data-edit-sec="0"]'));
  eq(d.querySelectorAll(".ws-acc.is-open").length, 0, "pressed again, it folds");
  click(d.querySelector('[data-insert-at="1"]'));
  eq(d.querySelectorAll("[data-add-type]").length, 14, "every kind offered");
  click(d.querySelector('[data-add-type="quote"]'));
  eq([...d.querySelectorAll(".ws-stile-words b")].map((n) => n.textContent), ["Opening", "A verse or a quote", "Photo and words"], "between the two");
  assert(d.querySelector('.ws-acc[data-si="1"]').classList.contains("is-open"), "and open");
});

await check("one section at a time: only its tabs; formatted words saved clean", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="0"]'));
  eq([...d.querySelectorAll("[data-sectab]")].map((b) => b.dataset.sectab), ["words", "photo", "buttons", "look"], "the opening's tabs");
  const heading = d.querySelector('[data-rt="0:heading"]');
  assert(heading && heading.getAttribute("contenteditable") === "true", "one heading box");
  eq(heading.innerHTML, "Follow the work of <b>Chase Roush.</b>", "its bold half shown bold");
  assert(!d.querySelector('[data-rt="0:thin"], [data-sec-word="0:thin"]'), "no second heading box");
  const text = d.querySelector('[data-rt="0:text"]');
  text.innerHTML = '<div>Serving <strong>Croatia</strong></div><div><span style="color:red">churches</span> <i>well</i></div>';
  text.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle(900);
  eq(sent.filter((x) => x.action === "save").pop().draft.pages[0].sections[0].words.en.text,
    "Serving <b>Croatia</b>\nchurches <i>well</i>", "bold, italic and lines kept; the rest gone");
});

await check("where a button goes: nothing, a page, or a web address — three plain choices", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="1"]'));
  click(d.querySelector('[data-sectab="buttons"]'));
  const kind = (k) => d.querySelector(`[data-chip="linkkind:sec:1"][data-value="${k}"]`);
  eq(kind("none").getAttribute("aria-pressed"), "true", "nowhere, to begin with");
  click(kind("page"));
  const pick = d.querySelector('[data-link="sec:1"]');
  assert(pick && ![...pick.options].some((o) => /address/i.test(o.textContent)), "a list of pages, and only pages");
  assert(d.querySelector('[data-sec-word="1:button"]'), "once it goes somewhere, words for its button");
  click(kind("url"));
  const box = d.querySelector('[data-link-url="sec:1"]');
  box.value = "https://blog.example.org/";
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle(900);
  eq(sent.filter((x) => x.action === "save").pop().draft.pages[0].sections[1].link, "https://blog.example.org/", "saved");
});

await check("a Links section: plain rows, one opened at a time", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="resources"]'));
  click(d.querySelector('[data-edit-sec="0"]'));
  click(d.querySelector('[data-sectab="links"]'));
  click(d.querySelector("[data-item-add]"));
  const title = d.querySelector('[data-item$=":title"]');
  assert(title, "the new link opens, ready for its name");
  title.value = "The book";
  title.dispatchEvent(new w.Event("input", { bubbles: true }));
  click(d.querySelector('[data-chip="linkkind:item:0:0"][data-value="page"]'));
  await settle(900);
  const it = sent.filter((x) => x.action === "save").pop().draft.pages.find((p) => p.id === "resources").sections[0].items[0];
  eq([it.words.en.title, it.url.startsWith("page:")], ["The book", true], "saved, pointing at a page");
});

await check("a change marks its tab, its page and its section, and the tab keeps its dot on another tab", async () => {
  const { d, click, pages } = await boot({ published: true });
  const dot = (t) => d.querySelector(`[data-ws-tab="${t}"] .ws-dot`);
  assert(dot("pages").hidden && dot("design").hidden, "nothing changed yet");
  pages();
  click(d.querySelector('[data-page-on="1"]'));
  assert(!dot("pages").hidden, "Pages marked");
  assert(d.querySelector('[data-open-page="about"] .ws-dot'), "and the page");
  click(d.querySelector('[data-ws-tab="links"]'));
  assert(!dot("pages").hidden && dot("links").hidden, "still marked on the Links tab, and only Pages");
});

await check("the footer: a layout picked, a tagline written", async () => {
  const { w, d, sent, click } = await boot();
  click(d.querySelector('[data-ws-tab="footer"]'));
  assert(!d.getElementById("wsFooter").hidden, "the Footer panel");
  assert(!d.getElementById("wsPreviewPane").hidden, "with the site beside it");
  click(d.querySelector('[data-chip="footer:layout"][data-value="center"]'));
  const t = d.querySelector('[data-footer-word="tagline"]');
  t.value = "All of me for all of Him";
  t.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle(900);
  const f = sent.filter((x) => x.action === "save").pop().draft.footer;
  eq([f.layout, f.words.en.tagline], ["center", "All of me for all of Him"], "saved");
});

await check("Links: a tap on an icon opens its box; other links are rows, one opened at a time", async () => {
  const { w, d, sent, click } = await boot();
  click(d.querySelector('[data-ws-tab="links"]'));
  const yt = d.querySelector('[data-social-pick="youtube"]');
  assert(yt && !yt.classList.contains("is-set"), "an icon, not added yet");
  assert(!d.querySelector('[data-social="youtube"]'), "no box until it is wanted");
  click(yt);
  const box = d.querySelector('[data-social="youtube"]');
  box.value = "https://youtube.com/@chaseroush";
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert(d.querySelector('[data-social-pick="youtube"]').classList.contains("is-set"), "filled as it is typed");
  click(d.querySelector("[data-custom-add]"));
  const name = d.querySelector("[data-custom-label]");
  assert(name, "a new link opens, ready for its name");
  name.value = "Schedule a conversation";
  name.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle(900);
  const links = sent.filter((x) => x.action === "save").pop().draft.links;
  eq(links.map((l) => l.kind), ["youtube", "custom"], "both saved");
  eq(links[1].label.en, "Schedule a conversation", "with its name");
});

await check("Design: Custom's colors and what visitors see appear only when Custom is chosen", async () => {
  const { d, sent, click } = await boot();
  assert(!d.querySelector('[data-color="background"]'), "a preset has no color pickers");
  click(d.querySelector('[data-chip="look"][data-value="custom"]'));
  assert(d.querySelector('[data-color="background"]') && d.querySelector('[data-chip="mode"][data-value="auto"]'), "Custom does");
  click(d.querySelector('[data-chip="mode"][data-value="dark"]'));
  await settle(900);
  const design = sent.filter((x) => x.action === "save").pop().draft.design;
  eq([design.look, design.mode], ["custom", "dark"], "saved");
});

await check("somebody not allowed sees it all, changes nothing, and can ask", async () => {
  const { d } = await boot({ edit: false, owner: false });
  assert(!d.getElementById("wsAsk").hidden, "Ask to edit offered");
  assert(d.getElementById("wsOn").hidden, "no on/off switch");
  assert([...d.querySelectorAll(".ws-panel input")].every((i) => i.disabled), "fields switched off");
  assert(d.getElementById("wsBar").hidden, "no Publish bar");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
