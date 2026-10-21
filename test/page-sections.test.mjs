#!/usr/bin/env node
/**
 * Thauma's pages as sections
 *   node test/page-sections.test.mjs
 *
 * Chase, 2026-10-21: the Site Creator works like the staff one, "to make
 * sure NOTHING in the site changes its appearance", and "We'd still want to
 * make sure all animations and arcade entry points stay active." The pages
 * are lists of sections (src/_data/pageSections.json) drawn by one template
 * per kind (src/_includes/sections/). When they were cut from the pages,
 * every public page in every language was built before and after and
 * compared: the same HTML. This keeps what that comparison proved:
 *
 *   · each built page is exactly its sections, in order, as the templates
 *     draw them — and the console's preview draws them with the same
 *     templates and the same filters, so the preview IS the page
 *   · every way into the arcade is still on the pages that had it
 *   · every hook the animations hang on is still there
 *   · the menu follows the order Navigation saves
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nunjucks = require("nunjucks");
const SS = require("../src/js/site-sections.js");
const { richHtml, richPlain } = require("../src/js/site-rich.js");
const { frameStyle } = require("../lib/frame.js");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("Thauma's pages as sections\n");
const build = ["_site", "_site_next"].find((d) => existsSync(`${d}/en/about/index.html`));
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const DOC = JSON.parse(readFileSync("src/_data/pageSections.json", "utf8"));
const SITE = JSON.parse(readFileSync("src/_data/site.json", "utf8"));
const LANGS = readdirSync(build).filter((d) => /^[a-z]{2}$/.test(d) && existsSync(`${build}/${d}/index.html`));
const pathOf = (page, lang) => `${build}/${lang}/${page === "home" ? "" : page + "/"}index.html`;
const dom = (f) => new JSDOM(readFileSync(f, "utf8")).window.document;
const kids = (main) => [...main.children].filter((c) => !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName));
const norm = (h) => h.replace(/\s+/g, " ").replace(/> </g, "><").trim();

/* the preview's renderer, as admin-content.js builds it in the browser */
const env = new nunjucks.Environment(new nunjucks.FileSystemLoader("src/_includes"), { autoescape: true });
env.addFilter("w", SS.wordAt);
env.addFilter("sectionHref", SS.sectionHref);
env.addFilter("rich", (s, key) => new nunjucks.runtime.SafeString(key ? `<span data-k="${String(key).replace(/[^\w.\-]/g, "")}">${richHtml(s)}</span>` : richHtml(s)));
env.addFilter("plain", (s) => richPlain(s));
env.addFilter("frameStyle", frameStyle);

await check("every page is its sections, in order, exactly as the preview draws them, in every language", () => {
  let n = 0;
  for (const lang of LANGS) {
    const t = JSON.parse(readFileSync(`src/_data/i18n/${lang}.json`, "utf8"));
    for (const page of Object.keys(DOC.pages)) {
      const f = pathOf(page, lang);
      if (!existsSync(f)) continue;                    /* a page switched off */
      const els = kids(dom(f).querySelector("main"));
      const list = DOC.pages[page];
      assert(els.length === list.length, `${lang}/${page}: ${els.length} parts on the page, ${list.length} sections`);
      list.forEach((sec, i) => {
        if (SS.KINDS[sec.kind].fixed) return;
        const html = env.render(`sections/${sec.kind}.njk`, { sec, t, lang, site: SITE, env: { isProduction: false } });
        const want = new JSDOM(`<main>${html}</main>`).window.document.querySelector("main").firstElementChild;
        assert(norm(els[i].outerHTML) === norm(want.outerHTML), `${lang}/${page}: section ${sec.id} is not what the preview draws`);
        n++;
      });
    }
  }
  assert(n > 20, `only ${n} sections compared`);
});

await check("every way into the arcade is still there: the logo, the year, the wheel, the 404", () => {
  if (!(SITE.visibility.sections.arcade || {}).dev) return;
  for (const lang of LANGS) {
    const home = dom(pathOf("home", lang));
    assert(home.querySelector("main > header.hero .wordmark svg"), `${lang}: Home's logo door (.wordmark) is gone`);
    for (const page of Object.keys(DOC.pages)) {
      const f = pathOf(page, lang);
      if (!existsSync(f)) continue;
      const d = dom(f);
      assert(/^©\s?\d{4}/.test(d.querySelector(".foot-legal").textContent.trim()), `${lang}/${page}: the footer's year door is gone`);
      assert(d.querySelector(".page-wheel") && d.querySelector("#arc-icon-tpl") && d.querySelector('script[src^="/js/arcade/doors.js"]'),
        `${lang}/${page}: a door or the doors' script is gone`);
    }
  }
  assert(dom(`${build}/404.html`).querySelector('[data-arcade-door="404"]'), "the 404's door is gone");
});

await check("every hook the animations hang on is still there", () => {
  for (const lang of LANGS) {
    for (const page of Object.keys(DOC.pages)) {
      const f = pathOf(page, lang);
      if (!existsSync(f)) continue;
      const d = dom(f), first = kids(d.querySelector("main"))[0];
      /* the header's entrance, which main.js skips after a transition */
      assert(first.tagName === "HEADER" && first.querySelector(".rise"), `${lang}/${page}: the header lost its entrance`);
    }
    const mission = dom(pathOf("mission", lang));
    assert(mission.querySelectorAll(".work .label").length === 3, `${lang}: Mission's label cascade has no labels`);
    for (const page of ["home", "about", "mission"]) {
      const img = dom(pathOf(page, lang)).querySelector(".frame img");
      assert(img && /transform-origin/.test(img.getAttribute("style")), `${lang}/${page}: the photo's parallax style is gone`);
    }
    assert(dom(pathOf("team", lang)).querySelector("[data-vt-person]"), `${lang}: the team's photo morph lost its names`);
  }
});

await check("the menu is in the order Navigation saves, Give last", () => {
  const d = dom(pathOf("home", "en"));
  const on = (slug) => { const v = SITE.visibility.pages[slug]; return v == null || (typeof v === "object" ? v.dev : v); };
  const links = [...d.querySelectorAll("nav .links a")].map((a) => a.getAttribute("href").split("/")[2]);
  assert(links.join() === DOC.nav.filter(on).join(), `menu ${links} — saved ${DOC.nav}`);
  const phone = [...d.querySelectorAll(".mobile-menu a")].map((a) => a.getAttribute("href").split("/")[2]);
  assert(phone.join() === DOC.nav.filter(on).concat("give").join(), `phone menu ${phone}`);
});

await check("a new section draws in the site's own design, in every kind that can be added", () => {
  const t = JSON.parse(readFileSync("src/_data/i18n/en.json", "utf8"));
  for (const kind of SS.ADDABLE) {
    const sec = SS.newSection(kind, "s1test");
    t.blocks = { s1test: {} };
    SS.keysOf(sec).forEach((k) => { t.blocks.s1test[k.split(".")[2]] = SS.lorem(k); });
    const html = env.render(`sections/${kind}.njk`, { sec, t, lang: "en", site: SITE, env: { isProduction: false } });
    const el = new JSDOM(`<main>${html}</main>`).window.document.querySelector("main").firstElementChild;
    assert(el && el.tagName === "SECTION" && el.querySelector(".wrap"), `${kind} is not a section of the site`);
    const keys = [...el.querySelectorAll("[data-k]")].map((x) => x.getAttribute("data-k"));
    assert(SS.keysOf(sec).every((k) => keys.includes(k)), `${kind} does not show every word it has: ${keys}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
