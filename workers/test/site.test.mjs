#!/usr/bin/env node
/**
 * Partner sites (0044): the document, the page, and the language
 *   node workers/test/site.test.mjs
 */
import { subdomainFrom, validSubdomain, cleanDoc, starter, safeUrl, safePhoto, PAGES } from "../src/site/model.js";
import { renderPage, esc } from "../src/site/render.js";
import { pickLang } from "../src/site/serve.js";
import { removeSiteDns } from "../src/lib/site-dns.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const checkAsync = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("partner sites\n");

check("the address is the first and last name, letters only, accents folded", () => {
  eq(subdomainFrom("Chase Roush"), "chaseroush", "Chase");
  eq(subdomainFrom("Mira Petrović"), "mirapetrovic", "Mira");
  eq(subdomainFrom("Đorđe Ćosić"), "dordecosic", "Đorđe");
  assert(!validSubdomain("www") && !validSubdomain("dev") && !validSubdomain("a") && !validSubdomain("Chase"), "reserved and malformed refused");
  assert(validSubdomain("chaseroush2"), "a number is fine");
});

check("a new site: seven pages on in Chase's order; Home is an opening and one photo; Updates, videos and the newest newsletter", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en", give: "" });
  eq(d.pages.map((p) => p.id), PAGES, "pages in order");
  eq(d.pages.filter((p) => p.on).map((p) => p.id), ["home", "about", "mission", "updates", "give", "stay", "contact"], "on, in order");
  eq(d.pages.filter((p) => !p.on).map((p) => p.id), ["timeline", "resources"], "ready, and off");
  eq(d.pages[0].sections.map((x) => x.type), ["hero", "photoText"], "Home");
  assert(/Replace these words/.test(d.pages[0].sections[1].words.en.text), "filler words, to be replaced");
  eq(d.pages.find((p) => p.id === "updates").sections.map((x) => x.type + ":" + x.variant), ["videos:stage", "newsletters:latest"], "Updates");
  eq(d.design.motion, { entrance: "rise", photos: "still", headings: "plain", buttons: "lift", pages: "fade", progress: "off" }, "Chase's motion defaults");
  eq([d.design.menu, d.design.brand], ["top", "name"], "across the top, the name in the corner");
  eq(d.pages[0].sections[0].words.en.bold, "Chase Roush.", "the name in the opening");
  eq(d.pages[0].sections[0].words.hr.thin, "Pratite rad —", "Croatian words for Croatian");
});

check("basic is four pages; blank is Home alone, with nothing on it", () => {
  const b = starter("basic", { name: "X", langs: ["en"], fallback: "en" });
  eq(b.pages.filter((p) => p.on).map((p) => p.id), ["home", "about", "give", "contact"], "basic");
  const z = starter("blank", { name: "X", langs: ["en"], fallback: "en" });
  eq(z.pages.filter((p) => p.on).map((p) => p.id), ["home"], "blank shows Home");
  assert(z.pages.every((p) => !p.sections.length), "blank has no sections");
});

check("what is stored is cleaned: unknown kinds, bad links and foreign pictures go", () => {
  const d = cleanDoc({
    languages: ["en", "xx", "hr"], fallback: "de",
    design: { look: "neon", motion: { entrance: "explode", photos: "zoom" } },
    links: [{ kind: "instagram", url: "javascript:alert(1)" }, { kind: "custom", url: "https://a.org", label: { en: "Blog" } },
            { kind: "email", url: "me@a.org" }],
    pages: [{ id: "home", on: false, sections: [
      { type: "hero", variant: "behind", photo: "http://evil.example/x.jpg", words: { en: { bold: "Hi" } } },
      { type: "script", words: {} },
      { type: "photo", photo: "/media/partnersite/p/abc.webp" },
    ] }],
  }, ["en", "hr", "sr"]);
  eq(d.languages, ["en", "hr"], "only catalog languages");
  eq(d.fallback, "en", "fallback among them");
  eq([d.design.look, d.design.motion.entrance, d.design.motion.photos], ["night", "rise", "zoom"], "choices known or first");
  eq(d.links.map((l) => l.kind + ":" + l.url), ["custom:https://a.org/", "email:mailto:me@a.org"], "unsafe link dropped");
  const home = d.pages[0];
  assert(home.on, "Home cannot be switched off");
  eq(home.sections.map((s) => s.type), ["hero", "photo"], "unknown section dropped");
  eq(home.sections[0].photo, null, "http picture refused");
  eq(home.sections[1].photo, "/media/partnersite/p/abc.webp", "our own picture kept");
  eq(d.pages.length, PAGES.length, "every page present");
});

check("links and pictures: only http(s)/mailto, only our media or https", () => {
  eq(safeUrl("javascript:alert(1)"), "", "javascript");
  eq(safeUrl("mailto:a@b.co"), "mailto:a@b.co", "mailto");
  eq(safePhoto("/media/../../etc"), null, "traversal");
  eq(safePhoto("https://x.org/a.jpg"), "https://x.org/a.jpg", "https");
});

const payload = { milestones: [{ id: "m" }], goals: [], prayer: [], videos: [], video_links: [], mailings: [], theme: { accent: "#1AE4FF", accent2: "#25FFA1" } };
function page(doc, pageId = "home", lang = "en", extra = {}) {
  return renderPage({ doc: cleanDoc(doc, ["en", "hr"]), site: { slug: "chase-roush", display_name: "Chase Roush", giving_url: "" },
    payload, theme: payload.theme, lang, pageId, base: "/site/chaseroush", origin: "https://thauma.one", draft: false, ...extra });
}

check("every word the owner types is escaped", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[0].words.en.text = '<script>alert(1)</script>';
  const html = page(d);
  assert(!html.includes("<script>alert(1)"), "a script got through");
  assert(html.includes(esc("<script>alert(1)</script>")), "the words are shown, escaped");
});

check("the menu lists the shown pages; a hidden page is not in it", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const html = page(d);
  assert(html.includes('href="/site/chaseroush/en/about/"'), "About linked");
  assert(!html.includes("/en/resources/"), "hidden Resources linked");
  assert(html.includes('class="givebtn"'), "Give as the button");
});

check("motion choices reach the page; widgets are the real ones, without their credit line", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.design.motion.entrance = "slide"; d.design.motion.headings = "words";
  const html = page(d, "timeline");
  assert(/data-entrance="slide"/.test(html) && /data-headings="words"/.test(html), "motion attributes");
  assert(/data-widget="roadmap"[^>]*data-foot="off"|data-foot="off"[^>]*data-style/.test(html) || /data-widget="roadmap".*data-foot="off"/.test(html), "timeline widget, no credit line");
  assert(html.includes("prefers-reduced-motion"), "reduced motion respected");
  assert(html.includes('hreflang="hr"'), "the other language offered");
  assert(!html.includes('data-widget="goal"'), "an empty section is left out");
});

check("the visitor's language when the site has it; otherwise the site's own fallback", () => {
  eq(pickLang("hr-HR,hr;q=0.9,en;q=0.8", ["en", "hr"], "en"), "hr", "Croatian");
  eq(pickLang("de-DE,de;q=0.9", ["en", "hr"], "hr"), "hr", "fallback, not English");
  eq(pickLang("", ["en", "sr"], "sr"), "sr", "no header");
  eq(pickLang("bs-BA", ["en", "hr"], "en"), "hr", "Bosnian reads Croatian");
});

/* ---- 0045: links on sections, Classic, the footer, taking an address down */

const blankWith = (sections, tweak = (d) => d) => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.pages[0].sections = sections;
  return tweak(d);
};

check("a section's button goes to a page of the site, or anywhere safe; never to a hidden page", () => {
  const d = blankWith([
    { type: "text", words: { en: { bold: "Mission", text: "Why.", button: "Read the story" } }, link: "page:mission" },
    { type: "text", words: { en: { bold: "Blog", text: "Out." } }, link: "https://blog.example.org/" },
    { type: "text", words: { en: { bold: "Gone", text: "Hidden." } }, link: "page:resources" },
    { type: "text", words: { en: { bold: "Bad", text: "No." } }, link: "javascript:alert(1)" },
  ]);
  const html = page(d);
  assert(html.includes('href="/site/chaseroush/en/mission/">Read the story →'), "to the Mission page, in the owner's words");
  assert(/href="https:\/\/blog\.example\.org\/" rel="noopener">Read more →/.test(html), "outward, with the built-in words");
  assert(!html.includes("/en/resources/"), "a hidden page is not linked");
  assert(!html.includes("javascript:"), "an unsafe link is dropped");
  eq(cleanDoc(d, ["en"]).pages[0].sections[3].link, "", "and not even stored");
});

check("a photo opens the link when asked; link cards carry their own pictures", () => {
  const d = blankWith([
    { type: "photoText", photo: "/media/partnersite/p/a.webp", words: { en: { bold: "Team", text: "Us." } }, link: "page:about", photoLink: true },
    { type: "photo", photo: "/media/partnersite/p/b.webp", words: { en: { caption: "Split" } }, link: "https://x.org/" },
    { type: "links", variant: "cards", words: { en: { bold: "Read", text: "Worth your time" } },
      items: [{ url: "https://r.org/book", photo: "/media/partnersite/p/c.webp", words: { en: { title: "The book" } } },
              { url: "page:give", words: { en: { title: "Give" } } }] },
  ]);
  const html = page(d);
  assert(/<a class="piclink" href="\/site\/chaseroush\/en\/about\/"[^>]*><img src="\/media\/partnersite\/p\/a\.webp"/.test(html), "the photo opens About");
  assert(/<a class="piclink" href="https:\/\/x\.org\/"/.test(html), "a full-width photo opens its link");
  assert(/<span class="lpic"><img src="\/media\/partnersite\/p\/c\.webp"/.test(html), "a card's picture");
  assert(html.includes('href="/site/chaseroush/en/give/"><b>Give</b>'), "a card can open a page of the site");
  assert(html.includes('<p class="lede m">Worth your time</p>'), "a line under the heading");
});

check("the owner's colors: a background decides everything that must be read on it", () => {
  const d = blankWith([{ type: "hero", variant: "monogram", photo: null,
    words: { en: { thin: "All of Me", bold: "for All of Him", text: "Serving churches in Croatia" } }, buttons: [] },
    { type: "timeline", words: { en: { bold: "Journey", text: "Every step" } }, raised: true }],
    (x) => { x.design.colors = { background: "#1a1a1a", accent: "#A63D40" }; return x; });
  const html = page(d, "home", "en", { payload: { ...payload, milestones: [{ id: "m" }] } });
  assert(html.includes("--bg:#1A1A1A"), "the background, as chosen");
  assert(/--fg:#F2F3F5/.test(html), "light words on a dark background");
  assert(/--acc:#b14144/i.test(html), "the chosen accent, only as much lighter as a dark page needs — not the ministry's");
  assert(html.includes('data-accent="#A63D40"'), "the widgets wear it too");
  assert(html.includes('data-theme="dark"'), "and know the page is dark");
  assert(html.includes('<span class="mono-mark" aria-hidden="true">CR</span>'), "the monogram opening stays, in any look");
  const light = page(blankWith([], (x) => { x.design.colors = { background: "#FAF7F0", accent: null }; return x; }));
  assert(/--fg:#15171C/.test(light), "dark words on a light background");
  eq(cleanDoc({ design: { look: "classic", colors: { background: "red", accent: "#12AB34" } } }, ["en"]).design,
    { ...cleanDoc({}, ["en"]).design, colors: { background: null, accent: "#12AB34" } }, "Classic opens as Night; only real colors are kept");
});

check("the language menu is always a dropdown, by each language's own name, on a phone too", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr", "sr"], fallback: "en" });
  const html = renderPage({ doc: cleanDoc(d, ["en", "hr", "sr"]), site: { slug: "c", display_name: "Chase Roush", giving_url: "" },
    payload, theme: payload.theme, lang: "hr", pageId: "home", base: "/site/c", origin: "", draft: false,
    langNames: { en: "English", hr: "Hrvatski", sr: "Српски" } });
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert(/<details class="langmenu"><summary[^>]*><span>HR<\/span>/.test(header), "in the header, showing the language in use");
  assert(header.indexOf("langmenu") > header.indexOf("</nav>"), "outside the page menu, so a phone still shows it");
  assert(html.includes('hreflang="sr" lang="sr">Српски</a>'), "each language by its own name");
  assert(/<details class="langmenu up">/.test(html.slice(html.indexOf("<footer"))), "and in the footer, opening upward");
});

check("the opening fills the screen, with an arrow that bounces until the visitor scrolls", () => {
  const html = page(starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" }));
  assert(/\.hero\{[^}]*min-height:calc\(100svh - 69px\)/.test(html), "the whole first screen");
  assert(/<section class="hero hero-behind[^"]*">[\s\S]*?<button type="button" class="scrollcue"/.test(html), "the arrow");
  assert(/@keyframes cue/.test(html) && /html\.scrolled \.scrollcue\{opacity:0/.test(html), "bouncing, and gone once scrolled");
  assert(/\.scrollcue\{animation:none\}/.test(html), "still, for anyone who asked for less motion");
});

check("the ministry's widgets sit centered unless put left; the newest newsletter as a card, the rest behind a link", () => {
  const mail = [{ subject: "September", sent_at: "2026-09-20", url: "https://thauma.one/archive/chase-roush/news/september/", preheader: "The visa." },
                { subject: "August", sent_at: "2026-08-20", url: "https://thauma.one/archive/chase-roush/news/august/" }];
  const d = blankWith([{ type: "newsletters", variant: "latest", words: { en: { bold: "News" } } },
                       { type: "timeline", align: "left", words: { en: { bold: "Road" } } }]);
  const html = page(d, "home", "en", { payload: { ...payload, milestones: [{ id: "m" }], mailings: mail } });
  assert(/<section class="data al-center">/.test(html), "centered, by default");
  assert(/<section class="data al-left">/.test(html), "left, when chosen");
  assert(html.includes('<a class="latest m" href="https://thauma.one/archive/chase-roush/news/september/">'), "the newest");
  assert(!html.includes('href="https://thauma.one/archive/chase-roush/news/august/"'), "only the newest is linked");
  assert(html.includes('<a href="https://thauma.one/archive/chase-roush/news/">See past newsletters</a>'), "the rest, at the list's archive");
});

check("a site's own tab icon", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.design.favicon = "/media/partnersite/p/icon.webp";
  assert(page(d).includes('<link rel="icon" href="/media/partnersite/p/icon.webp">'), "in the page");
  eq(cleanDoc({ design: { favicon: "javascript:alert(1)" } }, ["en"]).design.favicon, null, "only our own pictures or https");
});

check("the Footer tab's preview can be the footer alone", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const html = page(d, "home", "en", { draft: true, only: "footer" });
  const body = html.slice(html.indexOf("<body"));
  assert(body.includes("<footer") && !body.includes("<header") && !body.includes("<main"), "the footer and nothing else");
});

check("the footer: three layouts, a tagline and small print in each language, the credit always", () => {
  const d = blankWith([], (x) => {
    x.links = [{ kind: "youtube", url: "https://youtube.com/@c" }, { kind: "custom", url: "https://cal.example/", label: { en: "Schedule a conversation" } }];
    x.footer = { layout: "center", menu: true, socials: "words",
      words: { en: { tagline: "All of me for all of Him", small: "Donations are tax-deductible." }, hr: { tagline: "Sve od mene" } } };
    return x;
  });
  const html = page(d);
  assert(html.includes('class="foot foot-center"'), "centered");
  assert(/<span class="words"><a href="https:\/\/youtube\.com\/@c" rel="noopener">YouTube<\/a><a href="https:\/\/cal\.example\/"/.test(html), "socials as names, beside the owner's links");
  assert(html.includes('<p class="tagline">All of me for all of Him</p>') && html.includes("Donations are tax-deductible."), "the words");
  assert(/<nav class="menu"[^>]*><a href="\/site\/chaseroush\/en\/">Home<\/a>/.test(html), "the pages");
  assert(html.includes("A Thauma site"), "the credit");
  const hr = page(d, "home", "hr");
  assert(hr.includes("Sve od mene") && hr.includes("Donations are tax-deductible."), "Croatian where written, the fallback where not");
  eq(cleanDoc({ footer: { layout: "sideways", socials: "smoke" } }, ["en"]).footer.layout, "split", "an unknown layout is the first");
});

await checkAsync("taking an address down removes only the record Thauma made", async () => {
  const seen = [];
  const fake = async (url, init = {}) => {
    seen.push((init.method || "GET") + " " + url.replace(/^.*\/zones\/z/, ""));
    if (!init.method) return new Response(JSON.stringify({ success: true, result: [
      { id: "r1", type: "AAAA", comment: "Thauma partner site" }, { id: "r2", type: "MX", comment: null }] }));
    return new Response(JSON.stringify({ success: true }));
  };
  const r = await removeSiteDns({ SITE_DNS_TOKEN: "t", SITE_ZONE_ID: "z" }, "chaseroush", fake);
  eq(r.state, "removed", "done");
  eq(seen.filter((x) => x.startsWith("DELETE")), ["DELETE /dns_records/r1"], "the mail record stays");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
