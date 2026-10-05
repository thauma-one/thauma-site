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
import { starter, cleanDoc, word, PAGES, placeholders } from "../workers/src/site/model.js";

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

function answer(opts = {}) {
  const { edit = true, owner = true, published = false } = opts;
  const draft = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }), ["en", "hr"]);
  if (opts.ownAccent) { draft.design.look = "custom"; draft.design.colors = { background: "#0D0D0D", accent: opts.ownAccent }; }
  if (opts.paras) { const t = draft.pages.find((p) => p.id === "home").sections[1]; t.words = { en: { ...(t.words.en || {}), text: opts.paras, verse: "Draw near to God" } }; }
  if (opts.photo) draft.pages.find((p) => p.id === "home").sections[1].photo = opts.photo;
  return {
    published: published ? JSON.parse(JSON.stringify(draft)) : null,
    you: { email: "c@t.one", name: "Chase Roush", roles: ["partner", "staff"] },
    partner: { id: "p", display_name: "Chase Roush", slug: "chase-roush" },
    site: { subdomain: "chaseroush", address: "/site/chaseroush/", preview: "/site/chaseroush/?draft",
            enabled: false, published_at: null, unpublished: true, dns: null },
    draft,
    languages: [{ code: "en", name: "English", native_name: "English" }, { code: "hr", name: "Croatian", native_name: "Hrvatski" }],
    /* As staff-site.js builds it: the site's own page names per language. */
    page_names: Object.fromEntries(["en", "hr"].map((l) => [l, Object.fromEntries(PAGES.map((id) => [id, word(l, id)]))])),
    placeholders: placeholders ? Object.fromEntries(["en", "hr"].map((l) => [l, placeholders(l, "Chase Roush")])) : undefined,
    theme: { accent: "#1AE4FF", accent2: "#25FFA1" },
    saves: opts.saves,
    can: { edit, owner }, owner: { name: "Chase Roush" }, editors: [], requests: [], my_request: null,
  };
}

async function boot(opts = {}) {
  const sent = [];
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/website/" });
  const w = dom.window;
  w.fetch = async (u, o = {}) => {
    if (o.method === "POST") sent.push(JSON.parse(o.body));
    return { ok: true, status: 200, json: async () => answer(opts) };
  };
  w.console.error = () => {};
  /* What this browser tab kept from before, and whether this load is a
     reload, for the "reload" tests: only a reload goes back to the place. */
  if (opts.place) w.sessionStorage.setItem("thauma.ws.place", opts.place);
  w.performance.getEntriesByType = () => [{ type: opts.reload ? "reload" : "navigate" }];
  w.scrollTo = () => {};
  w.scrollBy = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "color-pair.js", "staff-site.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
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
  eq([...d.querySelectorAll(".ws-stile-words b")].map((n) => n.textContent), ["Hero", "Photo and words"], "Home's sections");
  assert(/Follow the work of/.test(d.querySelector(".ws-stile-words span").textContent), "each with one line of its words");
  const pick = d.querySelector("[data-pick-page]");
  pick.value = "give";
  pick.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(d.querySelector("[data-pick-page]").value, "give", "straight to another page");
  click(d.querySelector("[data-all-pages]"));
  assert(d.querySelector(".ws-plist"), "back to all pages");
});

await check("page names follow Editing, and Reference shows that language's name (Chase, 2026-10-03)", async () => {
  /* They showed the CONSOLE's word whatever was being edited, and nothing
     under Reference unless a page had been renamed. */
  const { w, d, click, pages } = await boot();
  pages();
  const pick = d.getElementById("wsLangA");
  pick.value = "hr";
  pick.dispatchEvent(new w.Event("change", { bubbles: true }));
  const rows = [...d.querySelectorAll(".ws-prow b")].map((b) => b.textContent);
  eq(rows.slice(0, 2), [word("hr", "home"), word("hr", "about")], "the list, editing Croatian");
  click(d.querySelector('[data-open-page="about"]'));
  eq(d.querySelector("[data-page-label]").placeholder, word("hr", "about"), "the name box, editing Croatian");
  const refLine = d.querySelector(".ws-pagename .ms-ref");
  assert(refLine, "no Reference line for a page that was never renamed");
  eq([refLine.textContent, refLine.lang], [word("en", "about"), "en"], "Reference");
  const opt = [...d.querySelectorAll("[data-pick-page] option")].find((o) => o.value === "about");
  eq(opt.textContent, word("hr", "about"), "the page menu");
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
  eq(d.querySelectorAll("[data-add-type]").length, 16, "every kind offered");
  click(d.querySelector('[data-add-type="quote"]'));
  eq([...d.querySelectorAll(".ws-stile-words b")].map((n) => n.textContent), ["Hero", "A verse or a quote", "Photo and words"], "between the two");
  assert(d.querySelector('.ws-acc[data-si="1"]').classList.contains("is-open"), "and open");
});

await check("a new section suggests words in the language being written, and saves none of them", async () => {
  /* Chase, 2026-10-03: placeholder words in every language whenever a
     section is added, for those unsure how to phrase things. */
  const { w, d, sent, click, pages } = await boot();
  pages();
  const pick = d.getElementById("wsLangA");
  pick.value = "hr";
  pick.dispatchEvent(new w.Event("change", { bubbles: true }));
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-insert-at="1"]'));
  click(d.querySelector('[data-add-type="text"]'));
  const heading = d.querySelector('[data-rt="1:heading"]');
  assert(heading, "the new section is not open");
  eq(heading.getAttribute("data-ph"), word("hr", "aboutThin") + " " + word("hr", "aboutBold"), "its heading, in Croatian");
  eq(d.querySelector('[data-rt="1:text"]').getAttribute("data-ph"), word("hr", "aboutFill"), "its words, in Croatian");
  await settle(900);
  const saved = sent.filter((x) => x.action === "save").pop().draft.pages[0].sections[1];
  eq([saved.words.hr.heading, saved.words.hr.text], ["", ""], "nothing suggested was saved");
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

await check("words can take a size and a color, a quick pick or any color; a word inside a colored phrase can change alone", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="1"]'));
  const box = d.querySelector('[data-rt="1:text"]');
  box.innerHTML = "one two three";
  const select = (node, a, b) => {
    const r = d.createRange(); r.setStart(node, a); r.setEnd(node, b);
    const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  const bar = (q) => d.querySelector(".ws-fmt " + q);
  const saved = async () => { await settle(900); return sent.filter((x) => x.action === "save").pop().draft.pages[0].sections[1].words.en.text; };

  select(box.firstChild, 4, 7);                       // "two"
  click(bar('[data-fmt="color"]'));
  assert(!bar('[data-fmt-row="color"]').hidden, "the color row opens");
  click(bar('[data-fmt-c="red"]'));
  eq(await saved(), 'one <span data-c="red">two</span> three', "a quick pick");

  select(box.querySelector('[data-c="red"]').firstChild, 1, 2);   // the "w"
  click(bar('[data-fmt-c="blue"]'));
  eq(await saved(), 'one <span data-c="red">t</span><span data-c="blue">w</span><span data-c="red">o</span> three', "split out of the red");

  select(box.lastChild, 1, 6);                        // "three"
  click(bar('[data-fmt-sz="lg"]'));
  eq(await saved(), 'one <span data-c="red">t</span><span data-c="blue">w</span><span data-c="red">o</span> <span data-sz="lg">three</span>', "a size");

  select(box.firstChild, 0, 3);                       // "one"
  const pick = bar("[data-fmt-any]");
  pick.dispatchEvent(new w.MouseEvent("mousedown", { bubbles: true }));
  pick.value = "#ff00aa";
  pick.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert(/^<span data-c="#ff00aa">one<\/span>/.test(await saved()), "any color");
  assert(box.querySelector('[data-c="#ff00aa"]').style.color, "a picked color shows in the box");
});

await check("every section lines up: left, centered, right or indented; a Words section has no second layout control", async () => {
  const { d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="mission"]'));
  click(d.querySelector('[data-edit-sec="0"]'));            // the Mission page's Words section
  click(d.querySelector('[data-sectab="look"]'));
  eq([...d.querySelectorAll('[data-chip="align:0"]')].map((b) => b.dataset.value), ["left", "center", "right", "indent"], "choices");
  eq(d.querySelector('[data-chip="align:0"][aria-pressed="true"]').dataset.value, "left", "as it was");
  assert(!d.querySelector('[data-chip="variant:0"]'), "the old Left/Centered layout chips are gone for Words");
  click(d.querySelector('[data-chip="align:0"][data-value="right"]'));
  await settle(900);
  eq(sent.filter((x) => x.action === "save").pop().draft.pages.filter((p) => p.id === "mission")[0].sections[0].align, "right", "saved");
});

await check("a header can be added; its Look has background, top line and title line; a verse has its own look", async () => {
  const { d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="mission"]'));
  click(d.querySelector('[data-insert-at="0"]'));
  click(d.querySelector('[data-add-type="header"]'));
  assert(d.querySelector('[data-rt="0:heading"]'), "the new header is not open");
  click(d.querySelector('[data-sectab="look"]'));
  eq([...d.querySelectorAll('[data-chip="hbg:0"]')].map((b) => b.dataset.value), ["plain", "raised", "tint", "accent"], "backgrounds");
  assert(!d.querySelector('[data-chip="raised:0"]'), "no second background control");
  click(d.querySelector('[data-chip="hbg:0"][data-value="tint"]'));
  click(d.querySelector('[data-chip="topline:0"][data-value="off"]'));
  await settle(900);
  const s = sent.filter((x) => x.action === "save").pop().draft.pages.filter((p) => p.id === "mission")[0].sections;
  eq([s[0].type, s[0].bg, s[0].topline], ["header", "tint", false], "saved");

  click(d.querySelector('[data-edit-sec="1"]'));            // the Words section, now second
  click(d.querySelector('[data-sectab="look"]'));
  eq([...d.querySelectorAll('[data-chip="verse:1"]')].map((b) => b.dataset.value), ["quote", "line", "mark"], "verse looks");
});

await check("the opening's Look has this page's scroll indicator switch; off saves on the page", async () => {
  const { d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="0"]'));            // Home's opening
  click(d.querySelector('[data-sectab="look"]'));
  const cue = d.querySelector('[data-page-cue]');
  assert(cue && cue.getAttribute("aria-checked") === "true", "a switch, on");
  click(cue);
  await settle(900);
  eq(sent.filter((x) => x.action === "save").pop().draft.pages[0].cue, false, "saved off on Home");
  assert(d.querySelector('[data-page-cue]').getAttribute("aria-checked") === "false", "shown off");
  click(d.querySelector('[data-edit-sec="1"]'));
  click(d.querySelector('[data-sectab="look"]'));
  assert(!d.querySelector('[data-page-cue]'), "not on a section that has no indicator");
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

await check("a button can jump to another section of the same page, picked by its name", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="0"]'));
  click(d.querySelector('[data-sectab="buttons"]'));
  const kind = d.querySelector('[data-chip="linkkind:sec:0"][data-value="section"]');
  assert(kind, "no way to pick a section");
  click(kind);
  const pick = d.querySelector('[data-link="sec:0"]');
  const names = [...pick.options].map((o) => o.textContent);
  eq(names.length, 1, "only the OTHER sections of this page");
  assert(/^Photo and words · /.test(names[0]), `named by kind and heading: ${names[0]}`);
  await settle(900);
  const saved = sent.filter((x) => x.action === "save").pop().draft.pages[0].sections;
  eq(saved[0].link, "section:" + saved[1].id, "saved as a jump to it");
});

await check("a footer link is on every page, so it offers no section to jump to", async () => {
  const { d, click } = await boot();
  click(d.querySelector('[data-ws-tab="links"]'));
  click(d.querySelector("[data-custom-add]"));
  const chips = [...d.querySelectorAll('[data-chip^="linkkind:custom"]')].map((c) => c.dataset.value);
  assert(chips.includes("page") && chips.includes("url"), `the new link has no destination choices: ${chips}`);
  assert(!chips.includes("section"), "a page-less link offered a section");
});

await check("a Links section: plain rows, one opened at a time", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="resources"]'));
  click(d.querySelector('[data-edit-sec="0"]'));
  click(d.querySelector('[data-sectab="links"]'));
  const before = d.querySelectorAll(".ws-linkrow").length;
  assert(before === 2, "two sample links to begin with");
  click(d.querySelector("[data-item-add]"));
  const title = d.querySelector('[data-item$=":title"]');
  assert(title, "the new link opens, ready for its name");
  title.value = "The book";
  title.dispatchEvent(new w.Event("input", { bubbles: true }));
  click(d.querySelector('[data-chip="linkkind:item:0:2"][data-value="page"]'));
  await settle(900);
  const it = sent.filter((x) => x.action === "save").pop().draft.pages.find((p) => p.id === "resources").sections[0].items[2];
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

await check("Navigation: the page-you-are-on look, its color, the line and the phone menu are saved", async () => {
  const { d, sent, click } = await boot();
  click(d.querySelector('[data-ws-tab="nav"]'));
  assert(!d.getElementById("wsNav").hidden, "the Navigation panel");
  assert(!d.getElementById("wsPreviewPane").hidden, "with the site beside it");
  assert(d.querySelectorAll('#wsNav .ws-look[data-chip="nav:current"]').length === 4, "four looks");
  click(d.querySelector('[data-chip="nav:current"][data-value="under"]'));
  click(d.querySelector('[data-chip="nav:tint"][data-value="accent"]'));
  click(d.querySelector('[data-chip="nav:line"][data-value="accent"]'));
  click(d.querySelector('[data-chip="nav:phone"][data-value="drawer"]'));
  await settle(900);
  const draft = sent.filter((x) => x.action === "save").pop().draft;
  eq(draft.design.nav, { current: "under", tint: "accent", line: "accent", phone: "drawer" }, "saved");
  /* The menu's social icons live here now (were "Also show them at the top"). */
  const was = !!draft.design.headerLinks;
  click(d.querySelector('#wsNav [data-header-links]'));
  await settle(900);
  eq(!!sent.filter((x) => x.action === "save").pop().draft.design.headerLinks, !was, "icons in the menu");
});

await check("Advanced: search and share previews, a title written over the automatic one, the picture choice", async () => {
  const { w, d, sent, click } = await boot();
  click(d.querySelector('[data-ws-tab="advanced"]'));
  assert(!d.getElementById("wsAdvanced").hidden, "the Advanced panel");
  assert(d.querySelector(".ws-serp-title") && d.querySelector(".ws-sc"), "both previews");
  const t = d.querySelector("[data-adv-title]");
  assert(t.placeholder.length > 0, "the automatic title as the placeholder");
  t.value = "Chase Roush — production for churches";
  t.dispatchEvent(new w.Event("input", { bubbles: true }));
  click(d.querySelector('[data-chip="advpic"][data-value="photo"]'));
  await settle(900);
  const home = sent.filter((x) => x.action === "save").pop().draft.pages.find((p) => p.id === "home");
  eq([home.seo.title.en, home.seo.image], ["Chase Roush — production for churches", "photo"], "saved");
  assert(d.querySelector(".ws-serp-title").textContent.startsWith("Chase Roush — production"), "the preview follows");
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

await check("Undo steps back through changes; a reload opens where you left off", async () => {
  const { w, d, sent, click, pages } = await boot();
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  const order = () => [...d.querySelectorAll(".ws-stile-words b")].map((b) => b.textContent);
  eq(order(), ["Hero", "Photo and words"], "as it starts");
  click(d.querySelector('[data-sec-down="0"]'));
  eq(order(), ["Photo and words", "Hero"], "moved");
  assert(!d.getElementById("wsUndo").disabled, "Undo is offered");
  click(d.getElementById("wsUndo"));
  eq(order(), ["Hero", "Photo and words"], "and back again");
  await settle(900);
  eq(sent.filter((x) => x.action === "save").pop().draft.pages[0].sections[0].type, "hero", "and saved that way");
  click(d.querySelector('[data-edit-sec="1"]'));
  const place = w.sessionStorage.getItem("thauma.ws.place");
  const kept = JSON.parse(place);
  eq([kept.tab, kept.page, kept.edit], ["pages", "home", 1], "the place is kept");
  const again = await boot({ place, reload: true });
  eq([again.d.querySelector('[data-ws-tab="pages"]').getAttribute("aria-current"), again.d.querySelector('.ws-acc.is-open') && again.d.querySelector('.ws-acc.is-open').dataset.si],
     ["page", "1"], "and a reload opens there");
  /* Chase, 2026-10-01: "basic navigation should take us to the home page of
     each tab". Arriving from elsewhere starts at the list of pages... */
  const fresh = await boot({ place });
  assert(!fresh.d.querySelector('.ws-acc.is-open'), "arriving, not reloading, does not reopen the section");
  assert(fresh.d.querySelector('[data-ws-tab="pages"]').getAttribute("aria-current") !== "page" || fresh.d.querySelector('[data-open-page="home"]'),
    "and starts at a tab's beginning");
  /* ...and pressing Pages, even on Pages, goes back to that list. */
  click(d.querySelector('[data-ws-tab="pages"]'));
  assert(d.querySelector('[data-open-page="home"]'), "the Pages button goes back to the list of pages");
  eq(JSON.parse(w.sessionStorage.getItem("thauma.ws.place")).page, null, "and that is the place kept");
});

await check("somebody not allowed sees it all, changes nothing, and can ask", async () => {
  const { d } = await boot({ edit: false, owner: false });
  assert(!d.getElementById("wsAsk").hidden, "Ask to edit offered");
  assert(d.getElementById("wsOn").hidden, "no on/off switch");
  assert([...d.querySelectorAll(".ws-panel input")].every((i) => i.disabled), "fields switched off");
  assert(d.getElementById("wsBar").hidden, "no Publish bar");
});

await check("Design: the ministry's colors with the Sharing page's picker; a change saves them at once, not in the draft", async () => {
  const { w, d, sent, click } = await boot({ ownAccent: "#FD5812" });
  const box = d.querySelector("#wsDesign .ws-colors");
  assert(box, "the colors box is on Design");
  assert(box.querySelector(".sh-hexes").textContent.startsWith("#FD5812"), "a site's own accent is what it shows until changed");
  click(box.querySelector("[data-colors-toggle]"));
  const hex = box.querySelector('.sh-picker [data-hex="1"]');
  assert(hex, "the wheel opened, with its hex box");
  hex.value = "#2266DD";
  hex.dispatchEvent(new w.Event("input", { bubbles: true }));
  await settle(700);
  const saved = sent.filter((b) => b.action === "colors");
  eq(saved.length, 1, "one colors save");
  eq(saved[0].colors.accent, "#2266DD", "the new first color");
  assert(!sent.some((b) => b.action === "save"), "not a draft save");
});

await check("the verse's place is chosen under the verse, by the words it follows (Chase: a verse in the middle)", async () => {
  const { d, sent, click, pages } = await boot({ paras: "I grew up surrounded by ministry, always.\n\nGod has been faithful to me.\n\nThe end." });
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="1"]'));
  const place = d.querySelector(".ws-verseplace");
  assert(place, "on the Words tab, with the verse");
  const labels = [...place.querySelectorAll("[data-chip]")].map((b) => b.textContent);
  eq(labels, ["Before the words", "After “I grew up surrounded…”", "After “God has been faithful…”", "After the words"], "named by the words they follow");
  click(place.querySelectorAll("[data-chip]")[1]);
  await settle(900);
  const saved = sent.filter((b) => b.action === "save").pop();
  eq(saved.draft.pages.find((p) => p.id === "home").sections[1].versePos, "p1", "saved as after the first paragraph");
});

await check("Advanced: a version is saved by name, and bringing one back puts it in the working copy", async () => {
  const { w, d, sent, click } = await boot({ saves: [
    { id: "sv_1", name: "Before the new colors", kind: "manual", created_at: "2026-10-04T10:00:00Z", created_by: "Chase Roush" },
    { id: "sv_2", name: "Published", kind: "published", created_at: "2026-10-03T10:00:00Z", created_by: "Chase Roush" }] });
  w.StaffConfirm = async () => true;
  click(d.querySelector('[data-ws-tab="advanced"]'));
  const rows = [...d.querySelectorAll(".ws-vrow b")].map((b) => b.textContent);
  eq(rows, ["Before the new colors", "Published"], "the list");
  const f = d.querySelector("[data-vsave]");
  f.querySelector("[data-vname]").value = "Summer look";
  f.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await settle(50);
  eq(sent.filter((b) => b.action === "version-save").map((b) => b.name), ["Summer look"], "saved by name");
  click(d.querySelector('[data-vopen="sv_1"]'));
  await settle(900);
  assert(sent.some((b) => b.action === "version-open" && b.id === "sv_1"), "asked for it");
  assert(sent.some((b) => b.action === "save"), "then saved as the working copy, through the ordinary save");
  assert(!d.getElementById("wsUndo").disabled, "and Undo can step back from it");
});

await check("Advanced: no Saved versions until the database has them", async () => {
  const { d, click } = await boot({});
  click(d.querySelector('[data-ws-tab="advanced"]'));
  assert(!d.querySelector("[data-vsave]"), "hidden while saves is missing");
});

await check("a replaced photo is handed back when the page closes, not when it is saved (Undo can still bring it back)", async () => {
  const OLDPIC = "/media/partnersite/chase-roush/old-photo-aaaa.webp";
  const { w, d, sent, click, pages } = await boot({ photo: OLDPIC });
  pages();
  click(d.querySelector('[data-open-page="home"]'));
  click(d.querySelector('[data-edit-sec="1"]'));
  click(d.querySelector('[data-sectab="photo"]'));
  click(d.querySelector('[data-sec-unphoto="1"]'));
  await settle(900);
  assert(sent.some((b) => b.action === "save"), "the change saved");
  assert(!sent.some((b) => b.keys), "nothing handed back while the page is open");
  w.dispatchEvent(new w.Event("pagehide"));
  await settle(50);
  eq(sent.filter((b) => b.keys).map((b) => b.keys), [["partnersite/chase-roush/old-photo-aaaa.webp"]], "handed back on close");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
