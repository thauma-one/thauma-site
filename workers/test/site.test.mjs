#!/usr/bin/env node
/**
 * Partner sites (0044): the document, the page, and the language
 *   node workers/test/site.test.mjs
 */
import { subdomainFrom, validSubdomain, cleanDoc, starter, safeUrl, safePhoto, PAGES, SECTIONS, plainOf, cleanLinkTarget } from "../src/site/model.js";
import { renderPage, esc } from "../src/site/render.js";
import * as RENDER from "../src/site/render.js";
import { pickLang } from "../src/site/serve.js";
import { appData, serveApp, renderApp } from "../src/site/app.js";
import { newsFor } from "../src/staff-push.js";
import * as LOGO from "../src/site/logo.js";
import { removeSiteDns } from "../src/lib/site-dns.js";
import { word } from "../src/site/model.js";
import * as MODEL from "../src/site/model.js";
import { sized, sizedInline, SIZE_JS, SITE_UNIT } from "../src/site/size.js";
/* the page as written, before its lengths became site units (site/size.js) */
const unsized = (h) => String(h).replace(/calc\(var\(--su,1px\)\*(-?[\d.]+)\)/g, "$1px");
import { readFileSync } from "node:fs";

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
  eq(d.pages[0].sections[0].words.en.heading, "Follow the Work of <b>Chase Roush.</b>", "the name in the opening, bold");
  eq(d.pages[0].sections[0].words.hr.heading, "Pratite rad — <b>Chase Roush.</b>", "Croatian words for Croatian");
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

const luminanceOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).reduce((a, v) => a + v, 0) / 3;
const payload = { milestones: [{ id: "m" }], goals: [], prayer: [], videos: [], video_links: [], mailings: [], theme: { accent: "#1AE4FF", accent2: "#25FFA1" } };
function page(doc, pageId = "home", lang = "en", extra = {}) {
  return renderPage({ doc: cleanDoc(doc, ["en", "hr"]), site: { slug: "chase-roush", display_name: "Chase Roush", giving_url: "" },
    payload, theme: payload.theme, lang, pageId, base: "/site/chaseroush", origin: "https://thauma.one", draft: false, ...extra });
}

check("every word the owner types is made safe: only bold, italic, underline and checked links survive", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[0].words.en.text = 'A & B <script>alert(1)</script><img src=x onerror=alert(1)> <i>really</i> <a href="javascript:alert(1)">no</a>';
  d.pages[0].sections[1].words.en.text = 'Read <a href="page:give">how to give</a> or <a href="https://x.org/">elsewhere</a>.\n\nSecond <u>paragraph</u>.';
  const html = page(d);
  assert(!/<script>alert|onerror|javascript:/.test(html), "nothing that runs got through");
  assert(html.includes("A &amp; B  <i>really</i> no"), "the words kept, the marks kept, the bad link reduced to its words");
  assert(html.includes('<a href="/site/chaseroush/en/give/">how to give</a>'), "a link to one of the site's pages");
  assert(html.includes('<p>Second <u>paragraph</u>.</p>'), "paragraphs");
});

check("a heading is one field; a site saved with the two halves opens with them joined", () => {
  const d = cleanDoc({ pages: [{ id: "home", sections: [{ type: "text", words: { en: { thin: "Who", bold: "we are", text: "x" } } }] }] }, ["en"]);
  eq(d.pages[0].sections[0].words.en.heading, "Who <b>we are</b>", "joined");
  assert(page(d).includes('<h2 class="h m">Who <b>we are</b></h2>'), "and drawn light, then bold");
});

check("a preview shows every section, an empty one as a note; visitors never see the note", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "sLinks1", type: "links", words: { en: { heading: "Read" } }, items: [] }];
  const draft = page(d, "home", "en", { draft: true });
  assert(/<section id="s-sLinks1" class="empty">/.test(draft), "there, with its id");
  assert(!page(d).includes('class="empty"'), "not on the real site");
});

check("the menu lists the shown pages; a hidden page is not in it", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const html = page(d);
  assert(html.includes('href="/site/chaseroush/en/about/"'), "About linked");
  assert(!html.includes("/en/resources/"), "hidden Resources linked");
  /* To the Give page, Give is one of the pages (2026-10-04); a pill only
     when it goes straight to the giving link. */
  assert(/<nav class="nav"[^>]*>[\s\S]*<a href="\/site\/chaseroush\/en\/give\/">/.test(html) && !html.includes('class="givebtn"'), "Give as a page");
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
  assert(/href="\/site\/chaseroush\/Example" target="_blank" rel="noopener">Read More →/.test(html), "outward by its clean address, in a new tab, with the built-in words");
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
  assert(/<a class="piclink" href="\/site\/chaseroush\/X[^"]*"/.test(html), "a full-width photo opens its link, by its clean address");
  assert(/<span class="rc-pic"><img src="\/media\/partnersite\/p\/c\.webp"/.test(html), "a card's picture");
  assert(/href="\/site\/chaseroush\/en\/give\/"><span class="rc-body"><b class="rc-title">Give<\/b>/.test(html), "a card can open a page of the site");
  assert(html.includes('<p class="lede m">Worth your time</p>'), "a line under the heading");
});

check("the owner's colors: a background decides everything that must be read on it", () => {
  const d = blankWith([{ type: "hero", variant: "monogram", photo: null,
    words: { en: { thin: "All of Me", bold: "for All of Him", text: "Serving churches in Croatia" } }, buttons: [] },
    { type: "timeline", words: { en: { bold: "Journey", text: "Every step" } }, raised: true }],
    (x) => { x.design.look = "custom"; x.design.mode = "dark"; x.design.colors = { background: "#1a1a1a", accent: "#A63D40" }; return x; });
  const html = page(d, "home", "en", { payload: { ...payload, milestones: [{ id: "m" }] } });
  assert(html.includes("--bg:#1A1A1A"), "the background, as chosen");
  assert(/--fg:#F2F3F5/.test(html), "light words on a dark background");
  assert(/--acc:#b14144/i.test(html), "the chosen accent, only as much lighter as a dark page needs — not the ministry's");
  assert(html.includes('data-accent="#A63D40"'), "the widgets wear it too");
  assert(html.includes('data-theme="dark"'), "and know the page is dark");
  assert(html.includes('<span class="mono-mark" aria-hidden="true">CR</span>'), "the monogram opening stays, in any look");
  const light = page(blankWith([], (x) => { x.design.look = "custom"; x.design.mode = "light"; x.design.colors = { background: "#FAF7F0", accent: null }; return x; }));
  assert(/--fg:#15171C/.test(light), "dark words on a light background");
  eq(cleanDoc({ design: { look: "classic", colors: { background: "red", accent: "#12AB34" } } }, ["en"]).design,
    { ...cleanDoc({}, ["en"]).design, colors: { background: null, accent: "#12AB34" } }, "Classic opens as Night; only real colors are kept");
});

check("Custom makes a light and a dark version; the device chooses unless the owner does; the presets keep their own colors", () => {
  const custom = (mode) => blankWith([{ type: "timeline", words: { en: { heading: "Road" } } }],
    (x) => { x.design.look = "custom"; x.design.mode = mode; x.design.colors = { background: "#1A1A1A", accent: "#A63D40" }; return x; });
  const pay = { payload: { ...payload, milestones: [{ id: "m" }] } };
  const auto = page(custom("auto"), "home", "en", pay);
  const root = auto.match(/:root\{--bg:(#[0-9A-Fa-f]{6})/)[1];
  assert(luminanceOf(root) > 0.8, "light by default: " + root);
  assert(/@media \(prefers-color-scheme:dark\)\{:root\{--bg:#1A1A1A/.test(auto), "the chosen dark one when the device is dark");
  assert(auto.includes('data-theme="auto"'), "widgets follow the device too");
  assert(page(custom("dark"), "home", "en", pay).includes('data-theme="dark"') && !page(custom("dark")).includes("prefers-color-scheme:dark)"), "always dark, when chosen");
  const night = page(blankWith([], (x) => { x.design.look = "night"; x.design.colors = { background: "#FAF7F0", accent: "#A63D40" }; return x; }));
  assert(night.includes("--bg:#0A0D12") && !night.includes('data-accent="#A63D40"'), "Night stays Night, whatever Custom holds");
});

check("the language menu is always a dropdown, by each language's own name, on a phone too", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr", "sr"], fallback: "en" });
  const html = renderPage({ doc: cleanDoc(d, ["en", "hr", "sr"]), site: { slug: "c", display_name: "Chase Roush", giving_url: "" },
    payload, theme: payload.theme, lang: "hr", pageId: "home", base: "/site/c", origin: "", draft: false,
    langNames: { en: "English", hr: "Hrvatski", sr: "Српски" } });
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert(/<details class="langmenu"><summary[^>]*><span class="lc">HR<\/span>/.test(header), "in the header, showing the language in use");
  assert(header.indexOf("langmenu") > header.indexOf("</nav>"), "outside the page menu, so a phone still shows it");
  assert(html.includes('hreflang="sr" lang="sr">Српски</a>'), "each language by its own name");
  /* Not in the footer (Chase, 2026-10-01: "We also don't need the language
     toggle in the footer"): the header's is on every page. */
  assert(!/langmenu/.test(html.slice(html.indexOf("<footer"), html.indexOf("</footer>"))), "not repeated in the footer");
});

check("the opening fills the screen, with an arrow that bounces until the visitor scrolls", () => {
  const html = page(starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" }));
  assert(/\.hero\{[^}]*min-height:calc\(100svh - 69px\)/.test(unsized(html)), "the whole first screen");
  assert(/<section class="hero hero-behind[^"]*"[^>]*>[\s\S]*?<button type="button" class="scrollcue"/.test(html), "the arrow");
  assert(/@keyframes cue/.test(html) && /html\.scrolled \.scrollcue\{opacity:0/.test(html), "bouncing, and gone once scrolled");
  assert(/\.scrollcue,\.cue-mouse em\{animation:none\}/.test(html), "still, for anyone who asked for less motion");
  /* Design › Motion › Scroll hint picks which (Chase, 2026-10-01). */
  assert(/<html[^>]* data-cue="line"/.test(html), "the line and word unless chosen otherwise");
  const d2 = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d2.design.motion.cue = "mouse";
  assert(/<html[^>]* data-cue="mouse"/.test(page(d2)) && /class="cue-mouse"/.test(page(d2)), "or a mouse");
  d2.design.motion.cue = "sideways";
  assert(/<html[^>]* data-cue="line"/.test(page(d2)), "an unknown one is the line");
  /* chaseroush.com's: a short accent line over the word, bobbing together. */
  assert(/class="scrollcue"[^>]*><i><\/i>[\s\S]*?<span>Scroll<\/span><\/button>/.test(html), "a line over the word");
  assert(/\.scrollcue i\{[^}]*width:2px;height:32px;background:var\(--acc\)/.test(unsized(html)), "the line in the accent");
});

check("the ministry's widgets sit centered unless put left; the newest newsletter as a card, the rest behind a link", () => {
  const mail = [{ subject: "September", sent_at: "2026-09-20", url: "https://thauma.one/archive/chase-roush/news/september/", preheader: "The visa." },
                { subject: "August", sent_at: "2026-08-20", url: "https://thauma.one/archive/chase-roush/news/august/" }];
  const d = blankWith([{ type: "newsletters", variant: "latest", words: { en: { bold: "News" } } },
                       { type: "timeline", align: "left", words: { en: { bold: "Road" } } }]);
  const html = page(d, "home", "en", { payload: { ...payload, milestones: [{ id: "m" }], mailings: mail } });
  assert(/<section class="data al-center"[^>]*>/.test(html), "centered, by default");
  assert(/<section class="data al-left"[^>]*>/.test(html), "left, when chosen");
  assert(html.includes('<a class="latest m" href="https://thauma.one/archive/chase-roush/news/september/" target="_blank" rel="noopener">'), "the newest, in a new tab");
  assert(!html.includes('href="https://thauma.one/archive/chase-roush/news/august/"'), "only the newest is linked");
  assert(html.includes('<a href="https://thauma.one/archive/chase-roush/news/" target="_blank" rel="noopener">See Past Newsletters</a>'), "the rest, at the list's archive");
});

check("a site's own tab icon", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.design.favicon = "/media/partnersite/p/icon.webp";
  assert(page(d).includes('<link rel="icon" href="/media/partnersite/p/icon.webp">'), "in the page");
  eq(cleanDoc({ design: { favicon: "javascript:alert(1)" } }, ["en"]).design.favicon, null, "only our own pictures or https");
});

check("Chase, 2026-10-01: initials for a favicon, forms in the site's colors, a tagline's color, links typed bare", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.design.look = "custom"; d.design.colors = { bg: "#101418", accent: "#E8553A" };
  d.pages.find((p) => p.id === "stay").on = true;
  /* No favicon chosen: the owner's initials, in the site's accent. */
  const html = page(d);
  const icon = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(html);
  assert(icon && decodeURIComponent(icon[1]).includes(">CR</text>"), "the initials as the icon");
  /* The forms wear the site's accent, not their own embed colors. */
  const stay = page(d, "stay");
  assert(/<div data-thauma-form data-lang="en" data-theme="[a-z]+" data-accent="#E8553A" data-accent2="#[0-9A-Fa-f]{6}" data-look="[^"]+"><\/div>/.test(stay), "the sign-up form in the site's colors");
  /* Or the accent letters on the site's own background. */
  d.design.faviconStyle = "letters";
  const lettersIcon = decodeURIComponent(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(page(d))[1]);
  assert(/<rect [^>]*fill="#[0-9A-Fa-f]{6}"\/><text [^>]*fill="#[0-9A-Fa-f]{6}"/.test(lettersIcon) && !lettersIcon.includes('fill="#E8553A"/>'), "accent letters, not an accent tile");
  eq(cleanDoc({ design: { faviconStyle: "neon" } }, ["en"]).design.faviconStyle, "filled", "an unknown style is the filled one");
  /* The forms take the site's card, fields, lines and type too. */
  const lookAttr = /data-thauma-form[^>]*data-look="([^"]+)"/.exec(stay);
  const look = lookAttr && JSON.parse(lookAttr[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  assert(look && look.panel && look.bg && look.font, "the form is told the site's look: " + (lookAttr && lookAttr[1]));
  /* Every link that leaves the site opens a new tab; the site's own do not. */
  d.links = [{ kind: "youtube", url: "@chase" }];
  const withLinks = page(d);
  /* written as the site's own short address (2026-10-12: clean links), and still a new tab */
  assert(/<a href="\/site\/chaseroush\/YouTube" target="_blank"[^>]* rel="noopener"/.test(withLinks), "a social link, clean, in a new tab");
  assert(!/<a href="\/site\/chaseroush\/(en|hr)\/[^"]*" target=/.test(withLinks), "the site's own pages stay in the tab");
  /* The tagline in the accent, when chosen. */
  d.footer = { layout: "split", menu: false, socials: "icons", tagline: "accent", words: { en: { tagline: "All of me" } } };
  assert(page(d).includes('<p class="tagline tagline-accent">All of me</p>'), "the tagline's color");
  eq(cleanDoc({ footer: { tagline: "neon" } }, ["en"]).footer.tagline, "plain", "an unknown color is the plain one");
  /* An address typed as it is said is kept, not dropped. */
  eq(cleanDoc({ links: [{ kind: "youtube", url: "youtube.com/@chase" }] }, ["en"]).links.map((k) => k.url),
     ["https://youtube.com/@chase"], "youtube.com/@chase");
  eq(safeUrl("javascript:alert(1)"), "", "and a script is still not an address");
});

check("Chase, 2026-10-01: a social link may be just the handle; the footers fill the width", () => {
  const url = (kind, u) => cleanDoc({ links: [{ kind, url: u }] }, ["en"]).links.map((k) => k.url)[0];
  eq(url("youtube", "ChaseRoushMissions"), "https://www.youtube.com/@ChaseRoushMissions", "a YouTube name");
  eq(url("youtube", "@ChaseRoushMissions"), "https://www.youtube.com/@ChaseRoushMissions", "a YouTube handle");
  eq(url("instagram", "@chase"), "https://www.instagram.com/chase", "an Instagram handle");
  eq(url("tiktok", "chase"), "https://www.tiktok.com/@chase", "a TikTok name");
  eq(url("linkedin", "chase-roush"), "https://www.linkedin.com/in/chase-roush", "a LinkedIn name");
  eq(url("spotify", "abc"), undefined, "Spotify needs the whole link");
  eq(url("youtube", "<b>x</b>"), undefined, "and markup is not a handle");
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.footer = { layout: "columns", menu: true, socials: "icons", words: { en: { tagline: "T", small: "S" } } };
  const html = page(d);
  /* The small print had max-width:80ch, which kept it beside the columns. */
  assert(/\.foot \.small\{flex:1 0 100%;[^}]*max-width:none/.test(html), "the small print takes its own row");
  /* The small print right under the tagline (Chase, 2026-10-04); the bar keeps the credit. */
  assert(/<div class="cols"><div class="col"><p class="tagline[^"]*">T<\/p><p class="small">S<\/p><\/div>/.test(html), "columns: the small print under the tagline");
  assert(/<div class="bar"><span class="powered">/.test(html), "then a bar for the credit");
  d.footer = { layout: "split", menu: true, socials: "icons", words: { en: { tagline: "T", small: "S" } } };
  assert(/<div class="col"><p class="tagline[^"]*">T<\/p><p class="small">S<\/p>/.test(page(d)), "split: the small print under the tagline too");
  d.footer = { layout: "columns", menu: true, socials: "icons", words: { en: { small: "S" } } };
  assert(/<div class="bar"><p class="small">S<\/p><span class="powered">/.test(page(d)), "no tagline: the small print stays in the bar");
  /* Its ground, line and room (Chase, 2026-10-04: "more options"). */
  d.footer = { layout: "split", ground: "tint", line: false, space: "compact", words: { en: { tagline: "T" } } };
  assert(/<footer class="foot foot-split foot-on-tint foot-noline foot-compact">/.test(page(d)), "tint, no line, compact");
  d.footer = { layout: "split", ground: "nonsense", space: "huge", words: {} };
  assert(/<footer class="foot foot-split">/.test(page(d)), "unknown values fall back to the plain footer");
  assert(/\.foot-columns \.menu\{display:grid;grid-template-columns:repeat\(2,auto\)/.test(html), "the pages in two columns, not a long list");
});

check("Chase, 2026-10-01: widgets and forms wear the site's cards, which stand apart on a raised band", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.design.mode = "dark";
  const lookOf = (html, attr) => {
    const m = new RegExp(attr + '[^>]*data-look="([^"]+)"').exec(html);
    return m && JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"));
  };
  const tl = d.pages.find((p) => p.id === "timeline").sections[0];
  tl.raised = false;
  const plain = lookOf(page(d, "timeline"), 'data-widget="roadmap"');
  tl.raised = true;
  const raised = lookOf(page(d, "timeline"), 'data-widget="roadmap"');
  assert(plain && raised, "the widget is told the site's look");
  assert(plain.bg !== raised.bg && plain.bg === raised.panel, "a raised band swaps the card and the panel: " + JSON.stringify([plain, raised]));
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
  assert(/<span class="words"><a href="\/site\/chaseroush\/YouTube" target="_blank" rel="noopener">YouTube<\/a><a href="\/site\/chaseroush\/[^"]+" target="_blank"/.test(html), "socials as names, beside the owner's links");
  assert(html.includes('<p class="tagline tagline-plain">All of me for all of Him</p>') && html.includes("Donations are tax-deductible."), "the words");
  assert(/<nav class="menu"[^>]*><a href="\/site\/chaseroush\/en\/">Home<\/a>/.test(html), "the pages");
  assert(html.includes("A Thauma Site"), "the credit");
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

check("the site's own words come from the wording file Thauma translates, so a new language needs no code", () => {
  const file = JSON.parse(readFileSync(new URL("../../src/_data/emailsAndForms.json", import.meta.url), "utf8"));
  for (const lang of Object.keys(file)) {
    assert(file[lang].site, `${lang} has no "site" words in emailsAndForms.json`);
    eq(word(lang, "give"), file[lang].site.give, `${lang}: the menu's Give`);
    eq(word(lang, "pastNews"), file[lang].site.pastNews, `${lang}: past newsletters`);
  }
  eq(word("de", "readIt"), file.en.site.readIt, "a language not given a word yet reads English");
});

check("every section of both starting sites has words to replace, in every language — switched-off pages too", () => {
  for (const kind of ["full", "basic"]) {
    const d = starter(kind, { name: "Chase Roush", langs: ["en", "hr", "sr"], fallback: "en" });
    for (const p of d.pages) {
      assert(p.sections.length, `${kind}: ${p.id} has nothing on it`);
      for (const x of p.sections) for (const l of d.languages) for (const f of SECTIONS[x.type].words) {
        /* Optional: a starting site has no verse unless the owner adds one. */
        if (f === "kicker" || f === "verse" || f === "verseRef" || (f === "button" && x.type !== "give")) continue;
        assert(plainOf(x.words[l][f]), `${kind}: ${p.id} › ${x.type} has no ${f} in ${l}`);
      }
    }
    assert(d.footer.words.en.tagline && d.footer.words.hr.small, `${kind}: the footer has its words`);
  }
  eq(starter("blank", { name: "X", langs: ["en"], fallback: "en" }).pages.every((p) => !p.sections.length), true, "blank stays blank");
});

check("a preview shows where a photo will go; visitors see no such thing", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  assert((page(d, "about", "en", { draft: true }).match(/class="wanted"/g) || []).length === 1, "About's photo, waiting");
  assert(page(d, "mission", "en", { draft: true }).includes("Your photo goes here"), "the full-width one too");
  assert(!page(d, "about").includes('class="wanted"') && !page(d, "mission").includes('class="wanted"'), "not on the real site");
});

/* COMPUTED, not grepped: which rule wins is a matter of specificity and
   order, so the page is loaded into a DOM and the browser's answer read. */
const { JSDOM } = await import("jsdom");
const styleOf = (html, sel) => {
  const w = new JSDOM(html).window;
  const el = w.document.querySelector(sel);
  return el ? w.getComputedStyle(el) : null;
};

check("the footer's tagline colors differ in every layout (Standard was Subtle on Center)", () => {
  /* Chase's review, 2026-10-03; his site uses Center. `.foot-center .tagline`
     set var(--dim) with the same specificity as Standard's rule, later in
     the sheet, so Standard rendered exactly like Subtle. */
  for (const layout of ["split", "center", "columns"]) {
    const colors = ["plain", "subtle", "accent"].map((tagline) => {
      const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
      d.footer = { ...d.footer, layout, tagline, words: { en: { tagline: "All of Me", small: "" } } };
      const st = styleOf(page(d), ".foot .tagline");
      assert(st, `${layout}: no tagline rendered`);
      return st.color;
    });
    eq(new Set(colors).size, 3, `${layout}: Standard, Subtle and Accent (${colors.join(" / ")})`);
  }
});

check("a Words section's button follows its alignment", () => {
  /* Chase's review, 2026-10-03: centered words, button left behind. The
     button row is a flex box, and text-align does not move flex items. */
  for (const [variant, want] of [["center", "center"], ["left", "normal"]]) {
    const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
    d.pages[0].sections = [{ id: "s1", type: "text", variant, link: "page:give",
      words: { en: { heading: "Hello", text: "Words.", button: "Give" } } }];
    const st = styleOf(page(d), "main section .btns");
    assert(st, `${variant}: no button rendered`);
    eq(st.justifyContent || "normal", want, `${variant}: the button row`);
  }
});

check("on Give and Sign-up, Plain is the page, and Raised and Tint each set it apart, in every look", () => {
  /* Chase, 2026-10-03: Raised looked the same as Plain on the band layouts.
     2026-10-06: "The Site Creator Sign Up form section still has the accent
     color tinted background instead of the plain look. Also... I actually
     really like that accent tinted look. We should add that as a 3rd option"
     — so the band layout no longer forces the tint; Background decides. */
  const rootVar = (html, name) => {
    const m = html.match(new RegExp(":root\\{[^}]*--" + name + ":(#[0-9A-Fa-f]{6})"));
    return m && m[1].toUpperCase();
  };
  const resolve = (html, v) => {
    const m = /^var\(--([a-z0-9-]+)\)$/.exec(v || "");
    return m ? rootVar(html, m[1]) : v;
  };
  const looks = [{ look: "night" }, { look: "paper" }, { look: "bold" },
    { look: "custom", mode: "dark", colors: { background: "#0D0D0D", accent: "#FD5812" } }];
  for (const design of looks) {
    for (const type of ["give", "signup"]) {
      const [plain, raised, tint] = [{}, { raised: true }, { tint: true }].map((ground) => {
        const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
        Object.assign(d.design, design);
        d.pages[0].sections = [{ id: "s1", type, variant: "band", ...ground,
          words: { en: { heading: "Hi", text: "", button: "" } } }];
        const html = renderPage({ doc: cleanDoc(d, ["en"]), site: { slug: "c", display_name: "C", giving_url: "https://give.example/" },
          payload, theme: payload.theme, lang: "en", pageId: "home", base: "/site/c", origin: "https://thauma.one", draft: false });
        const st = styleOf(html, "main section");
        return { band: resolve(html, st.backgroundColor), page: rootVar(html, "bg") };
      });
      const label = `${design.look} ${type}`;
      assert(!/^#/.test(plain.band || "") || plain.band === plain.page, `${label}: Plain is not the page (${JSON.stringify(plain)})`);
      assert(raised.band && raised.band !== raised.page, `${label}: Raised is the page's color`);
      assert(tint.band && tint.band !== tint.page, `${label}: Tint is the page's color`);
      assert(tint.band !== raised.band, `${label}: Tint and Raised are the same`);
    }
  }
});

/* ------------------------------------------------- the hero's line (2026-10-03) */

check("a new site's hero has the accent line under its title; it can be hidden", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  const hero = () => page(d).match(/<section class="hero[\s\S]*?<\/section>/)[0];
  assert(/<h1[\s\S]*?<\/h1><span class="rule m"/.test(hero()), "no line right under the title");
  d.pages[0].sections[0].divider = false;
  assert(!/class="rule/.test(hero()), "hidden, and still there");
});

check("a hero saved before the option looks as it did: no line, except the monogram's own", () => {
  for (const [variant, want] of [["behind", false], ["words", false], ["beside", false], ["monogram", true]]) {
    const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
    const s = d.pages[0].sections[0];
    delete s.divider; s.variant = variant;
    const html = page(d).match(/<section class="hero[\s\S]*?<\/section>/)[0];
    eq(/class="rule/.test(html), want, `${variant} without a saved choice`);
  }
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.pages[0].sections[0].divider = "yes please";
  eq("divider" in cleanDoc(d, ["en", "hr"]).pages[0].sections[0], false, "only a real yes or no is kept");
});

check("the line is centered on a centered hero, and wears the hero's own ink on a Bold look", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.pages[0].sections[0].variant = "words";
  const html = page(d);
  /* Centering comes from the section's alignment (al-center), which also
     centers the line. */
  assert(/<section[^>]*class="hero hero-words al-center/.test(html) &&
         /\.al-center :is\([^)]*\.rule\)\{margin-left:auto;margin-right:auto\}/.test(html), "not centered");
  d.design.look = "bold";
  assert(/\.hero-words \.rule\{background:/.test(page(d)), "an accent line on an accent background");
});

/* ---------------------------------------- jump to a section (2026-10-03) */

check("a button can jump to a section of the same page, which a visitor's page can land on", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  const [hero, second] = d.pages[0].sections;
  eq(cleanDoc({ ...d, pages: d.pages.map((p, i) => i ? p : { ...p, sections: [{ ...hero, link: "section:" + second.id }, second] }) }, ["en", "hr"])
    .pages[0].sections[0].link, "section:" + second.id, "kept on save");
  eq(cleanDoc({ ...d, pages: d.pages.map((p, i) => i ? p : { ...p, sections: [{ ...hero, link: "section:<x>" }, second] }) }, ["en", "hr"])
    .pages[0].sections[0].link, "", "a malformed one is dropped");
  hero.link = "section:" + second.id; hero.words.en.button = "Read more";
  const html = page(d);
  assert(html.includes(`href="#s-${second.id}"`), "the button does not point at the section");
  assert(new RegExp(`<section[^>]*id="s-${second.id}"`).test(html), "a VISITOR's page has no anchor to land on");
  assert(/main section\[id\]\{scroll-margin-top:68px\}/.test(unsized(html)), "it would land under the sticky header");
  /* an eased glide (2026-10-07, Chase: "a smooth scroll to the section … With
     both ease in and ease out"), a jump for those who ask for less motion */
  assert(/function glide\(y\)\{[^]*?if\(still\)\{scrollTo\(0,y\);return\}/.test(html), "a jump when motion is reduced");
  assert(/function ease\(t\)\{return t<\.5\?4\*t\*t\*t:1-Math\.pow\(-2\*t\+2,3\)\/2\}/.test(html), "eased in and out");
  assert(/closest\('a\[href\*="#"\]'\)/.test(html) && !/scroll-behavior:smooth/.test(html), "in-page links glide, and CSS does not smooth every step");
});

check("a jump to a section that is gone goes nowhere, and a page's sections never point at another page's", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.pages[0].sections[0].link = "section:gone12";
  assert(!/href="#s-gone12"/.test(page(d)), "a dead anchor");
  const about = d.pages.find((p) => p.id === "about");
  d.pages[0].sections[0].link = "section:" + about.sections[0].id;
  assert(!page(d).includes(`#s-${about.sections[0].id}`), "jumped into another page");
});

check("opening a milestone scrolls just enough, never past the timeline's title", () => {
  const html = page(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }));
  assert(/closest\('\[data-widget="roadmap"\]'\)/.test(html), "the timeline is not watched");
  assert(/by=Math\.min\(need,room\)/.test(html), "the scroll is not capped at the title");
  assert(/if\(by>0\)glide\(scrollY\+by\)\},380\)/.test(html), "it glides (a jump when motion is reduced)");
});

/* ---------------------------------------------------------- placeholders */

check("every field of every section suggests words, in every language Thauma has", () => {
  const { placeholders, builtInLangs } = MODEL;
  assert(typeof placeholders === "function", "placeholders() is missing");
  for (const lang of builtInLangs()) {
    const P = placeholders(lang, "Chase Roush");
    for (const [type, spec] of Object.entries(SECTIONS)) {
      for (const f of spec.words) {
        assert(P[type] && P[type][f], `${lang}: ${type}.${f} suggests nothing`);
      }
    }
    assert(P.item.title && P.item.text, `${lang}: a link card suggests nothing`);
  }
});

check("suggestions are in the language written, and the hero names the ministry", () => {
  const { placeholders } = MODEL;
  assert(typeof placeholders === "function", "placeholders() is missing");
  const hr = placeholders("hr", "Chase Roush");
  eq(hr.hero.heading, word("hr", "heroThin") + " Chase Roush", "hero heading, Croatian");
  eq(hr.quote.quote, word("hr", "quoteFill"), "a quote, Croatian");
  eq(hr.text.heading, word("hr", "aboutThin") + " " + word("hr", "aboutBold"), "a heading's two halves as one line");
  assert(hr.prayer.text !== placeholders("en", "x").prayer.text, "prayer's words are not translated");
});

/* ---- sizes and colors within the words (2026-10-03) ---- */

check("a size and a color may sit on any words; only names and #rrggbb are kept, never a style", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[1].words.en.text = 'A <span data-sz="lg" data-c="red">big red</span> <span data-c="#FF00AA"><b>pink</b></span> ' +
    '<span style="color:red" data-c="url(x)">plain</span> <span data-sz="huge">also</span>';
  const t = cleanDoc(d, ["en"]).pages[0].sections[1].words.en.text;
  eq(t, 'A <span data-sz="lg" data-c="red">big red</span> <span data-c="#ff00aa"><b>pink</b></span> plain also', "stored");
});

check("the page draws them: named sizes and tones as classes in the site's shades, a picked color inline", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[1].words.en.text = 'A <span data-sz="lg" data-c="red">big red</span> <span data-c="#ff00aa">pink</span> <span data-c="accent">ours</span>';
  const night = page(d);
  assert(night.includes('<span class="ts-lg tc-red">big red</span>'), "size and tone classes");
  assert(night.includes('<span style="color:#ff00aa">pink</span>'), "picked color inline");
  assert(night.includes('<span class="tc-accent">ours</span>'), "the site's accent");
  assert(!/data-c=|data-sz=/.test(night.replace(/<script[\s\S]*?<\/script>/g, "")), "the stored meaning never reaches the page");
  assert(/--t-red:#FF8A80/.test(night), "a dark site gets the dark-ground shade");
  d.design.look = "paper";
  assert(/--t-red:#B42318/.test(page(d)), "a light site gets the light-ground shade");
  d.design.look = "custom"; d.design.mode = "auto"; d.design.colors = { background: "#FFFFFF", accent: "#1AE4FF" };
  const auto = page(d);
  assert(/--t-red:#B42318/.test(auto) && /prefers-color-scheme:dark[^}]*--t-red:#FF8A80/.test(auto),
    "a site that follows the device has both shades");
});

/* ---- every section lines up (2026-10-03) ---- */

check("a section never lined up keeps the look it had; a chosen one is kept", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const mk = (type, variant, extra = {}) => ({ id: "x" + type + variant, type, variant, words: { en: {} }, ...extra });
  d.pages[0].sections = [mk("text", "left"), mk("text", "center"), mk("signup", "card"), mk("signup", "band"),
    mk("hero", "words"), mk("hero", "behind"), mk("goals", "cards"), mk("quote", "large"), mk("text", "left", { align: "right" }),
    mk("give", "band", { align: "indent" }), mk("text", "left", { align: "sideways" })];
  eq(cleanDoc(d, ["en"]).pages[0].sections.map((x) => x.align),
    ["left", "center", "center", "left", "center", "left", "center", "left", "right", "left", "left"], "aligns");
  eq(cleanDoc(d, ["en"]).pages[0].sections.map((x) => x.indent).filter(Boolean).length, 1, "Indented saved before reads as Left, indented");
});

check("the page carries each section's alignment, and its buttons follow it", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [
    { id: "a1", type: "text", variant: "left", align: "right", link: "https://x.org/", words: { en: { heading: "H", text: "T", button: "Go" } } },
    { id: "a2", type: "hero", variant: "behind", align: "center", words: { en: { heading: "Hi" } }, buttons: ["contact"] },
    { id: "a3", type: "quote", variant: "large", align: "indent", words: { en: { quote: "Q" } } },
  ];
  const html = page(d);
  assert(/<section[^>]*class="al-right"[^>]*><div class="wrap"><h2 class="h m">H<\/h2>[\s\S]*?<div class="btns m"><a class="btn solid" href="\/site\/chaseroush\/X[^"]*"/.test(html), "text section, right, with its button");
  assert(/<section class="hero hero-behind al-center/.test(html), "the opening");
  assert(/<section[^>]*class="quote quote-large al-left indented"[^>]*>/.test(html), "the quote, indented on the left");
  for (const rule of [".al-right .btns{justify-content:flex-end}", ".al-center .btns{justify-content:center}",
                      ".indented:not(.al-right)>.wrap", ".indented.al-right>.wrap", ".al-right .bandrow{flex-direction:row-reverse}"]) {
    assert(html.includes(rule), "missing rule " + rule);
  }
});

check("a page may hide the opening's scroll indicator; every page shows it until told not to", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  eq(cleanDoc(d, ["en"]).pages.map((p) => p.cue), d.pages.map(() => true), "on by default");
  assert(page(d).includes('class="scrollcue"'), "Home shows it");
  d.pages[0].cue = false;
  eq(cleanDoc(d, ["en"]).pages[0].cue, false, "kept off");
  assert(!page(d).includes('class="scrollcue"'), "Home hides it");
});

/* ---- the header, verses, photo and words (2026-10-04) ---- */

check("a header: small print above and below, the page's h1, a watermark that defaults to the page's name", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "h1", type: "header", variant: "watermark",
    words: { en: { label: "About", heading: "About <b>Chase</b>", text: "Serving churches" } } }];
  const html = page(d);
  const sec = html.match(/<section[^>]*class="phead[^"]*"[^>]*>[\s\S]*?<\/section>/);
  assert(sec, "no header section");
  assert(/class="phead phead-watermark ph-plain ph-top al-left"/.test(sec[0]), "default looks: " + sec[0].slice(0, 120));
  assert(/<span class="ph-mark" aria-hidden="true"><span class="m">Home<\/span><\/span>/.test(sec[0]), "the watermark falls back to the page's name");
  assert(/<p class="ph-label m">About<\/p><h1 class="h m">About <b>Chase<\/b><\/h1><span class="rule m"/.test(sec[0]), "label, h1, line");
  assert(/<p class="ph-sub m">Serving churches<\/p>/.test(sec[0]), "the small line below");

  d.pages[0].sections[0] = { ...d.pages[0].sections[0], variant: "plain", bg: "accent", topline: false, divider: false,
    words: { en: { heading: "Give", mark: "Hidden" } } };
  const plain = page(d).match(/<section[^>]*class="phead[^"]*"[^>]*>[\s\S]*?<\/section>/)[0];
  assert(/class="phead phead-plain ph-accent al-left"/.test(plain), "plain, accent, no top line: " + plain.slice(0, 90));
  assert(!/ph-mark|class="rule/.test(plain), "no watermark on Plain, no line when hidden");
  const bad = cleanDoc({ ...d, pages: [{ ...d.pages[0], sections: [{ id: "h2", type: "header", bg: "url(x)" }] }] }, ["en"]);
  eq(bad.pages[0].sections[0].bg, "plain", "an unknown background falls back");
});

check("a verse in three looks, in Words and in Photo and words; formatted like a quote, never unsafe", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const v = { heading: "H", text: "T", verse: "Here am I. <i>Send me!</i><script>x</script>", verseRef: "Isaiah 6:8" };
  d.pages[0].sections = [
    { id: "a", type: "text", words: { en: v } },
    { id: "b", type: "text", verseStyle: "line", words: { en: v } },
    { id: "c", type: "photoText", verseStyle: "mark", words: { en: v } },
  ];
  const html = page(d);
  assert(/<figure class="verse verse-quote m"><blockquote>“Here am I\. <i>Send me!<\/i>”<\/blockquote><figcaption>Isaiah 6:8<\/figcaption><\/figure>/.test(html), "the quote look, by default");
  assert(/<figure class="verse verse-line m"><blockquote>Here am I\./.test(html), "the line look");
  assert(/<figure class="verse verse-mark m"><span class="verse-glyph"/.test(html), "set apart");
  assert(!/<script>x/.test(html), "a script got through");
  /* A section saved before verses existed renders as it did. */
  d.pages[0].sections = [{ id: "z", type: "text", words: { en: { heading: "H", text: "T" } } }];
  assert(!/class="verse/.test(page(d)), "a verse appeared from nowhere");
});

check("photo and words: words can flow around the photo, and a photo is never cropped or backed by a panel", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [
    { id: "w", type: "photoText", variant: "wrapRight", photo: "/media/site/x.jpg", words: { en: { heading: "H", text: "T" } } },
  ];
  const html = page(d);
  assert(/<section[^>]*class="pt-wrap pt-wrapRight al-left"[^>]*><div class="wrap"><h2 class="h m">H<\/h2><div class="ptw"><div class="pic m[^"]*"><img/.test(html),
    "the wrapped layout: heading, then the photo floated in the words");
  assert(/\.pt-wrapRight \.ptw \.pic\{float:right/.test(html), "floats right");
  assert(/\.pt \.pic:has\(img\),\.ptw \.pic:has\(img\)\{aspect-ratio:auto;background:none/.test(html),
    "a chosen photo keeps its own shape and no panel behind it");
  assert(/\.pt \.pic img,\.ptw \.pic img\{display:block;width:auto;max-width:100%;height:auto;max-height:640px;object-fit:contain\}/.test(unsized(html)),
    "the whole photo shows");
});

/* ---- the Navigation tab (2026-10-04) ---- */

check("navigation defaults keep every site as it was; junk falls back to them", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  delete d.design.nav;
  const c = cleanDoc({ ...d, design: { ...d.design, nav: { current: "sparkle", tint: "red", line: "x", phone: "y" }, giveTo: "?" } }, ["en", "hr"]);
  eq(c.design.nav, { current: "lit", tint: "white", line: "subtle", phone: "drop" }, "defaults");
  eq(c.design.giveTo, "page", "give");
  const html = page(d);
  assert(/data-navcur="lit" data-navtint="white" data-navline="subtle" data-navphone="drop"/.test(html), "attributes");
});

check("Bold and Dot below reach the page", () => {
  for (const cur of ["bold", "dot"]) {
    const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
    d.design.nav = { current: cur, tint: "accent", line: "subtle", phone: "drop" };
    const html = page(d);
    assert(html.includes(`data-navcur="${cur}"`), cur + " attribute");
    assert(html.includes(`html[data-navcur="${cur}"] .nav>a[aria-current]`), cur + " has its style");
  }
});

check("the chosen look reaches the page; hover lifts a name; the phone menu holds a language dropdown", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  d.design.nav = { current: "grow", tint: "accent", line: "accent", phone: "full" };
  const html = page(d);
  assert(/data-navcur="grow" data-navtint="accent" data-navline="accent" data-navphone="full"/.test(html), "attributes");
  assert(html.includes(".nav>a:not(.givebtn):hover{color:var(--fg)}"), "hover");
  assert(/<nav class="nav" id="sitenav">[\s\S]*<details class="navlang">[\s\S]*hreflang="hr"[\s\S]*<\/details><\/nav>/.test(html), "language inside the menu");
  assert(/class="menubtn burger"[^>]*aria-label=/.test(html), "a hamburger with a name");
});

check("Give goes straight to the giving link only when there is one", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en", give: "https://give.example/chase" });
  d.design.giveTo = "link";
  assert(/<a class="givebtn" href="\/site\/chaseroush\/(Give|Donate)" target="_blank" rel="noopener">/.test(page(d)), "to the link, by its clean address");
  d.give = "";
  assert(/<a class="givebtn" href="[^"]*give\/?"/.test(page(d)) || !/class="givebtn"[^>]*target=/.test(page(d)), "no link: the Give page");
});

/* ---- card sections (2026-10-04) ---- */

check("Custom Cards: vertical or horizontal, with or without lines between; numbered; blank cards are not drawn; Attached/Detached still read", () => {
  /* Chase, 2026-10-06: "the settings should have horizontal … and vertical
     … and then attached detached as a setting for the lines between the
     cards". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const card = (title, text) => ({ words: { en: { title, text } } });
  d.pages[0].sections = [{ id: "c1", type: "cards", variant: "vertical", lines: true, numbers: true,
    words: { en: { heading: "How we work" } }, items: [card("Reliable", "Always there."), card("", ""), card("Kind", "")] }];
  let html = page(d);
  assert(/<section[^>]*class="cards-vertical cards-lines[^"]*"[\s\S]*<ol class="ccards m numbered"><li><span class="cnum"[^>]*>1<\/span><div><h3>Reliable<\/h3><p>Always there\.<\/p><\/div><\/li><li><span class="cnum"[^>]*>2<\/span><div><h3>Kind<\/h3>/.test(html), "vertical, lines, numbered, blank skipped");
  d.pages[0].sections[0].variant = "horizontal"; d.pages[0].sections[0].lines = false; d.pages[0].sections[0].numbers = false;
  html = page(d);
  assert(/class="cards-horizontal[^"]*"[\s\S]*<ol class="ccards m">/.test(html) && !/class="cards-horizontal cards-lines/.test(html) && !/class="cnum"/.test(html), "horizontal, no lines, no numbers");
  /* a section saved as Attached / Detached */
  d.pages[0].sections[0] = { ...d.pages[0].sections[0], variant: "attached", lines: undefined };
  assert(/class="cards-vertical cards-lines/.test(page(d)), "Attached reads as vertical with lines");
  d.pages[0].sections[0] = { ...d.pages[0].sections[0], variant: "detached", lines: undefined };
  html = page(d);
  assert(/class="cards-horizontal/.test(html) && !/class="cards-horizontal cards-lines/.test(html), "Detached reads as horizontal without");
});

check("Past updates: from one list or all; Newest and the rest shows the newest, then a few, then See All Updates", () => {
  /* Chase, 2026-10-06: "There needs to be a dropdown menu that defines what
     list you can select … a combined look where the newest one can be
     highlighted special, but it lists the last 3-5 updates underneath it …
     'See All Updates' at the bottom in small subtle print" */
  const mail = (n, list) => ({ slug: "m" + n, subject: "Update " + n, preheader: null, sent_at: "2026-0" + (9 - (n % 9)) + "-01T10:00:00Z",
    list: { slug: list, name: list }, url: `https://thauma.one/archive/chase-roush/${list}/m${n}/` });
  const mailings = [mail(1, "news"), mail(2, "prayer"), mail(3, "news"), mail(4, "news"), mail(5, "news"), mail(6, "news")];
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "n1", type: "newsletters", variant: "combined", list: "news", count: 3, words: { en: { heading: "Past" } } }];
  const html = renderPage({ doc: cleanDoc(d, ["en"]), site: { slug: "chase-roush", display_name: "Chase Roush", giving_url: "" },
    payload: { ...payload, mailings }, theme: payload.theme, lang: "en", pageId: "home", base: "/site/c", origin: "https://thauma.one", draft: false });
  assert(/class="latest m" href="[^"]*\/news\/m1\/"/.test(html), "the newest of that list, as the card");
  const rows = [...html.matchAll(/<li><a href="[^"]*\/(m\d)\/"/g)].map((m) => m[1]);
  eq(rows, ["m3", "m4"], "then the next ones of that list, the card included in the count of 3");
  assert(!/prayer\/m2/.test(html), "not another list's");
  assert(/<p class="past m"><a href="https:\/\/thauma.one\/archive\/chase-roush\/news\/"[^>]*>See All Updates<\/a>/.test(html), "and See All Updates, at the list's archive");
  assert(cleanDoc({ pages: [{ id: "home", sections: [{ type: "newsletters", list: "../x", count: 99 }] }] }, ["en"]).pages[0].sections[0].count === 5, "cleaned");
});

check("a page's tabs: the page's own sections, then the bar, then a panel per tab; one tab is no bar", () => {
  /* Chase, 2026-10-06: "an option at the top of each page that acts like tabs
     open on a browser, where + adds a tab to the page with distinct looks" */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const give = d.pages.find((p) => p.id === "give");
  const txt = (id, h) => ({ id, type: "text", variant: "left", words: { en: { heading: h, text: "words" } } });
  give.sections = [txt("top1", "Above")];
  give.tabs = { style: "pills", align: "left", items: [
    { id: "give", label: { en: "Give" }, sections: [txt("g1", "Giving")] },
    { id: "pray", label: {}, sections: [txt("p1", "Praying")] }] };
  const html = page(d, "give");
  assert(html.indexOf(">Above<") > 0 && html.indexOf(">Above<") < html.indexOf('<section class="ptabs-bar'), "the page's own sections first");
  assert(/class="ptabs-bar ptabs-pills al-left"/.test(html), "the bar's look");
  assert(/<button[^>]*aria-selected="true" data-tab="give">Give<\/button><button[^>]*aria-selected="false" data-tab="pray">Tab 2<\/button>/.test(html), "named tabs, and a blank name falls back");
  assert(/<div class="ptab" id="t-give"[^>]*><section/.test(html) && /<div class="ptab" id="t-pray"[^>]*hidden>/.test(html), "the first panel shows, the rest wait");
  /* Chase, 2026-10-08: sections below the tabs too — the bar sits at tabs.at. */
  give.sections = [txt("top1", "Above"), txt("low1", "Below")];
  give.tabs.at = 1;
  const at1 = page(d, "give");
  assert(at1.indexOf(">Above<") < at1.indexOf('<section class="ptabs-bar') && at1.indexOf('id="t-pray"') < at1.indexOf(">Below<"), "the bar where it sits; the rest of the page after the panels");
  /* Chase, 2026-10-12: the bar inside the tab's section, like chaseroush.com's Give. */
  give.tabs.place = "inside"; give.tabs.items[0].sections[0].tint = true;
  const inside = page(d, "give");
  assert(/<section class="ptabs-bar ptabs-pills al-left ptabs-inside band">/.test(inside), "the bar wears the tab section's background");
  assert(/<div class="ptab" id="t-give"[^>]*><section class="[^"]*after-tabs"/.test(inside), "the tab's section starts close under the bar");
  /* 2026-10-13: "the tab, when inside the section, need to be the opposite
     color so it doesn't blend into the background" */
  assert(/\.ptabs-inside\.raised:not\(\.ptabs-underline\) \.ptabs button:not\(\[aria-selected="true"\]\),\.ptabs-inside\.band:not\(\.ptabs-underline\) \.ptabs button:not\(\[aria-selected="true"\]\)\{background:var\(--bg\)\}/.test(inside)
      && /\.ptabs-inside:not\(\.ptabs-underline\) \.ptabs button:not\(\[aria-selected="true"\]\)\{background:var\(--panel\)/.test(inside),
    "tabs inside a section do not take the opposite ground");
  delete give.tabs.place; delete give.tabs.items[0].sections[0].tint;
  delete give.tabs.at; give.sections = [txt("top1", "Above")];
  give.tabs.items.pop();
  const one = page(d, "give");
  assert(!/<section class="ptabs-bar/.test(one) && /Giving/.test(one), "one tab is part of the page, no bar");
  const bad = cleanDoc({ ...d, pages: [{ id: "give", tabs: { style: "nope", items: Array.from({ length: 9 }, () => ({ id: "../x", sections: [] })) } }] }, ["en"]);
  const t = bad.pages.find((p) => p.id === "give").tabs;
  assert(t.style === "joined" && t.items.length === 6 && t.items.every((x) => /^[a-z0-9]+$/i.test(x.id)), "cleaned: a known style, six at most, safe ids");
  const placed = cleanDoc({ ...d, pages: [{ id: "give", tabs: { at: 2, items: [{ id: "a", sections: [] }] } }, { id: "about", tabs: { at: -3, items: [{ id: "b", sections: [] }] } }] }, ["en"]);
  eq([placed.pages.find((p) => p.id === "give").tabs.at, placed.pages.find((p) => p.id === "about").tabs.at], [2, undefined], "where the bar sits is kept; nonsense is dropped");
});

check("the new form and Give styles draw; a site saved before keeps its old one", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en", give: "https://give.example/x" });
  const sec = (type, variant) => ({ id: type + variant, type, variant, words: { en: { heading: "H", text: "T", button: "Give" } } });
  for (const [type, variant, mark] of [["contact", "split", 'class="split"'], ["contact", "wide", "wideform"], ["contact", "open", "openform"],
                                       ["signup", "split", 'class="split"'], ["signup", "open", "openform"],
                                       ["give", "card", "givecard"], ["give", "split", "givepanel"], ["give", "spotlight", 'class="spot m"']]) {
    d.pages[0].sections = [sec(type, variant)];
    assert(page(d).includes(mark), `${type} ${variant}`);
  }
  eq(cleanDoc({ ...d, pages: [{ ...d.pages[0], sections: [sec("contact", "nonsense")] }] }, ["en"]).pages[0].sections[0].variant, "form", "unknown falls back");
});

check("links as resource cards: Large, Wide, then Small, each in order; the label is what it is and who made it; a note set apart", () => {
  /* Chase, 2026-10-12: "I want this to work like CR site's Resources page". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const it = (title, tier, extra = {}) => ({ url: "https://x.org/" + title, photo: "https://thauma.one/media/p.jpg", tier, words: { en: { title, ...extra } } });
  d.pages[0].sections = [{ id: "l1", type: "links", variant: "cards", words: { en: { heading: "R" } },
    items: [it("A", "small", { note: "Short" }), it("B", "big", { type: "Book", by: "Henry Cloud", text: "About it", note: "<b>Mine</b>" }), it("C"), it("D", "big"), it("E", "bogus")] }];
  const html = page(d);
  const order = [...html.matchAll(/<b class="rc-title">([A-E])<\/b>/g)].map((m) => m[1]).join("");
  eq(order, "BDCEA", "order");
  assert(/<ul class="rcards rc-g-big m"><li class="rc rc-big"><a [^>]*><span class="rc-pic"><img/.test(html), "a large card, its picture above");
  assert(/<span class="rc-type">Book · Henry Cloud<\/span><span class="rc-desc">About it<\/span><span class="rc-note"><b>Mine<\/b><\/span>/.test(html), "label, words and a formatted note");
  assert(/<li class="rc rc-small"><a [^>]*><span class="rc-pic"><img[^>]*><\/span><span class="rc-body"><b class="rc-title">A<\/b><span class="rc-note">Short<\/span>/.test(html), "small: a little picture, the title and the note");
  d.pages[0].sections[0].items[0].words.en.title = 'Go <a href="https://y.org">there</a>';
  assert(!/<a[^>]*>[^]*<a href="https:\/\/y\.org"/.test(page(d).match(/<li class="rc rc-small">[^]*?<\/li>/)[0].replace(/^<li[^>]*><a[^>]*>/, "<a>")), "a link inside a link card");
});

check("contact: the site's email and social links beside the form, each with its symbol and handle, and a way to give, when chosen", () => {
  /* Chase, 2026-10-12: "The contact section should have some options for
     different links to show up. Reference CR site". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.links = [{ kind: "email", url: "contact@chaseroush.com" }, { kind: "youtube", url: "https://youtube.com/@ChaseRoushMissions" }];
  const sec = { id: "c1", type: "contact", variant: "split", words: { en: { heading: "Hi" } } };
  d.pages[0].sections = [sec];
  assert(!/class="reach/.test(page(d)), "links shown without being chosen");
  Object.assign(sec, { reachLinks: true, reachGive: true });
  const html = page(d, "home", "en", { site: { slug: "chase-roush", display_name: "Chase Roush", giving_url: "https://give.example/x" } });
  const list = (html.match(/<ul class="reach r-line m">[^]*?<\/ul>/) || [""])[0];
  assert(/href="mailto:contact@chaseroush\.com"><i><svg[^]*?<span>contact@chaseroush\.com<\/span>/.test(list), "the email, with its symbol");
  assert(/<span>@ChaseRoushMissions<\/span>/.test(list), "the channel by its handle");
  assert(/<span>Support this mission<\/span>/.test(list), "a way to give");
});

check("contact links: a line, a tile each, or a row of symbols; resources: tiles, and what each shows switched per section", () => {
  /* Chase, 2026-10-13: "add a couple different styles. Like in Resources…
     the ability to toggle on and off the description and personal note". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.links = [{ kind: "email", url: "contact@chaseroush.com" }];
  const sec = { id: "c1", type: "contact", variant: "form", reachLinks: true, reachStyle: "icons", words: { en: { heading: "Hi" } } };
  d.pages[0].sections = [sec];
  assert(/<ul class="reach r-icons m">/.test(page(d)), "icons");
  sec.reachStyle = "nonsense";
  assert(/<ul class="reach r-line m">/.test(page(d)), "an unknown style is the line");
  const it = { url: "https://x.org/a", photo: "https://thauma.one/media/p.jpg", words: { en: { title: "A", type: "Book", by: "H", text: "About", note: "Mine" } } };
  const links = { id: "l1", type: "links", variant: "tiles", words: { en: {} }, items: [it] };
  d.pages[0].sections = [links];
  let html = page(d);
  assert(/<ul class="rcards rc-tiles m"><li class="rc rc-tile">/.test(html) && /rc-desc/.test(html) && /rc-note/.test(html), "tiles, everything shown");
  Object.assign(links, { showKind: false, showDesc: false, showNote: false });
  html = page(d);
  const card = html.match(/<li class="rc[^]*?<\/li>/)[0];
  assert(!/rc-type|rc-desc|rc-note/.test(card) && /<b class="rc-title">A<\/b>/.test(card), "only the title: " + card);
  links.variant = "list";
  assert(!/class="ltype"|<span>About/.test(page(d)), "the list follows the switches too");
});

check("Indented: a section at its default alignment is indented too, and a merged section takes the indent of the one it is merged with", () => {
  /* Chase, 2026-10-12: "the past updates is merged with Prayer sections, but
     the past updates didn't indent properly". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [
    { id: "p1", type: "text", variant: "left", indent: true, words: { en: { heading: "Pray", text: "Words." } } },
    { id: "n1", type: "text", variant: "left", join: true, words: { en: { heading: "Past", text: "More." } } }];
  const html = page(d);
  assert(/<section class="[^"]*indented[^"]*"[^>]*id="s-n1"/.test(html), "the merged section is not indented");
  assert(html.includes(".indented:not(.al-right)>.wrap"), "a section with no alignment class is never indented");
});

check("clean links on the page: the Give button, socials and own links are written as the site's short addresses, which lead where they should", () => {
  /* Chase, 2026-10-12: "make sure all links on the site creator are clean
     links. I noticed that the Give section button isn't clean." */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.give = "https://donate.example.org/chase?campaign=2027&ref=site";
  d.pages.find((p) => p.id === "give").on = false;
  d.links = [{ kind: "youtube", url: "https://www.youtube.com/@chase" }, { kind: "custom", url: "https://cal.example/x", label: { en: "Schedule a Conversation" } }];
  d.pages[0].sections = [{ id: "g1", type: "give", variant: "band", words: { en: { heading: "Give" } } }];
  const html = page(d);
  assert(/<a class="btn solid[^"]*" href="\/site\/chaseroush\/Give" target="_blank"/.test(html), "the Give button is not clean");
  assert(!/donate\.example\.org/.test(html.replace(/<head>[^]*<\/head>/, "")), "the giving link's own address is still on the page");
  assert(html.includes('href="/site/chaseroush/YouTube"') && html.includes('href="/site/chaseroush/Schedule-a-Conversation"'), "socials or own links are not clean");
  const doc = cleanDoc(d, ["en"]);
  eq([cleanLinkTarget(doc, ["Give"], { base: "/site/chaseroush", giving: doc.give }), cleanLinkTarget(doc, ["Schedule-a-Conversation"], { base: "/site/chaseroush" })],
    [doc.give, "https://cal.example/x"], "the short addresses lead where the links went");
});

check("videos: buttons of the section's own, each its color, in place of the rail from Updates", () => {
  /* Chase, 2026-10-12: "how can we make formatting the buttons and appearance
     easier? It's also the only section … that can't be edited directly". */
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "v1", type: "videos", variant: "stage", align: "center", words: { en: { heading: "Watch" } },
    items: [{ url: "https://youtube.com/@c", color: "accent2", words: { en: { title: "Subscribe" } } }, { url: "page:give", color: "outline", words: { en: { title: "Support" } } }] }];
  const html = page(d, "home", "en", { payload: { ...payload, videos: [{ id: "x", title: "V" }] } });
  assert(/data-widget="videos"[^>]*data-links="none"/.test(html), "the rail from Updates is still drawn");
  assert(/<div class="btns linkbtns vbtns m"><a class="btn solid lb-accent2" href="[^"]+"[^>]*>Subscribe<\/a><a class="btn lb-outline" href="\/site\/chaseroush\/en\/give\/">Support<\/a><\/div>/.test(html), "its own buttons, each its color");
});

check("videos: the buttons' style and alignment reach the widget; the newest video may head the section", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "v1", type: "videos", variant: "stage", align: "center", linkStyle: "subtle", titleFrom: "latest", words: { en: { heading: "Watch" } } }];
  const html = page(d, "home", "en", { payload: { ...payload, videos: [{ video_id: "x", title: "Easter <live>", published_at: "2026-04-05" }] } });
  assert(/data-widget="videos"[^>]*data-links="subtle" data-links-align="center"/.test(html), "options");
  assert(/<p class="kicker m"><time datetime="2026-04-05" data-local>April 5, 2026<\/time><\/p><h2 class="h m">Easter &lt;live&gt;<\/h2>/.test(html), "latest title, escaped, with its date");
  d.pages[0].sections[0].titleFrom = "nonsense"; d.pages[0].sections[0].linkStyle = "x";
  const plain = page(d, "home", "en", { payload: { ...payload, videos: [{ video_id: "x", title: "T", published_at: "2026-04-05" }] } });
  assert(!/data-links=/.test(plain) && />Watch</.test(plain), "defaults");
});

check("a full-width photo: height and the part kept in view; whole is uncropped and never drifts", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const ph = (height, focusY, variant = "drift") => ({ id: "p1", type: "photo", variant, height, focusY, photo: "https://thauma.one/media/p.jpg", words: { en: {} } });
  d.pages[0].sections = [ph("short", 12)];
  assert(/<section class="fullphoto h-short[^"]*" style="--fy:12%"[^>]*>[\s\S]*data-drift/.test(page(d)), "short, aimed high");
  d.pages[0].sections = [ph("whole", 300)];
  const w = page(d).match(/<section class="fullphoto[\s\S]*?<\/section>/)[0];
  assert(/class="fullphoto h-whole[^"]*" style="--fy:100%"/.test(w) && !/data-drift/.test(w), "whole: clamped, no drift");
  d.pages[0].sections = [ph("enormous", "x")];
  assert(/class="fullphoto h-medium[^"]*" style="--fy:50%"/.test(page(d)), "defaults");
});

check("own links: a page of the site first; a web address may be its site's icon, beside the social icons", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.links = [
    { kind: "custom", url: "https://blog.example.org/x", label: { en: "Blog" } },
    { kind: "custom", url: "page:about", label: { en: "About me" } },
    { kind: "custom", url: "https://chaseroush.com/", label: { en: "chaseroush.com" }, icon: true },
    { kind: "custom", url: "page:mission", label: { en: "Mission" }, icon: true },
    { kind: "youtube", url: "https://youtube.com/@x" },
  ];
  const c = cleanDoc(d, ["en"]);
  eq(c.links.map((k) => k.place || "-"), ["apart", "apart", "inline", "apart", "-"], "a link saved as an icon reads as in line; a page of the site cannot have been one");
  /* separated, as words: pages first; in line: an icon beside the socials (2026-10-07) */
  d.links.forEach((k) => { if (k.kind === "custom") { k.place = "apart"; delete k.icon; } });
  const foot = page(d).match(/<footer[\s\S]*<\/footer>/)[0];
  const words = [...foot.matchAll(/<a href="[^"]*"[^>]*>(About me|Mission|Blog|chaseroush\.com)<\/a>/g)].map((m) => m[1]);
  eq(words, ["About me", "Mission", "Blog", "chaseroush.com"], "pages first, then the web");
  d.links[2].place = "inline";
  const foot2 = page(d).match(/<footer[\s\S]*<\/footer>/)[0];
  assert(/class="socials"[^>]*>[\s\S]*aria-label="YouTube"[\s\S]*<a class="favi" href="\/site\/chaseroush\/chaseroush\.com"[^>]*aria-label="chaseroush\.com"[^>]*><img src="https:\/\/thauma\.one\/embed\/v1\/icon\?d=chaseroush\.com"/.test(foot2), "the icon, through Thauma, beside the socials");
});

check("clean links: socials, page names in any language and alphabet, Give, the owner's own links", () => {
  const d = cleanDoc({ ...starter("full", { name: "Chase Roush", langs: ["en", "hr", "sr"], fallback: "en" }),
    links: [{ kind: "youtube", url: "https://youtube.com/@x" }, { kind: "custom", url: "https://blog.example.org/", label: { en: "My Blog" } }] }, ["en", "hr", "sr"]);
  d.pages.forEach((p) => { p.on = true; });
  const go = (path, giving = "") => cleanLinkTarget(d, path.split("/").filter(Boolean), { base: "/s", giving });
  eq(go("/YouTube"), "https://youtube.com/@x", "a social");
  eq(go("/" + word("en", "about")), "/s/en/about/", "an English page name");
  eq(go("/hr/" + word("hr", "give").toUpperCase()), "/s/hr/give/", "Croatian, any case");
  eq(go("/sr/" + encodeURIComponent(word("sr", "give"))), "/s/sr/give/", "Cyrillic");
  eq(go("/sr/" + word("hr", "give")), "/s/sr/give/", "the address's language wins");
  eq(go("/my-blog"), "https://blog.example.org/", "the owner's own link");
  eq(go("/Give", "https://give.example/"), "/s/en/give/", "Give: the page while it is on");
  d.pages.find((p) => p.id === "give").on = false;
  eq(go("/Give", "https://give.example/"), "https://give.example/", "Give: the giving link when there is no page");
  eq(go("/nothing-here"), null, "nothing");
});

check("Give to the Give page sits where the Pages list puts it", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const gi = d.pages.findIndex((p) => p.id === "give");
  const [g] = d.pages.splice(gi, 1); g.on = true; d.pages.splice(2, 0, g);
  const nav = page(d).match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  const ids = [...nav.matchAll(/href="\/site\/chaseroush\/en\/([a-z]*)\/?"/g)].map((m) => m[1] || "home");
  eq(ids.indexOf("give"), d.pages.filter((p) => p.on).findIndex((p) => p.id === "give"), "in its place");
});

check("the second color is a quick pick on a site too", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "t1", type: "text", variant: "left", words: { en: { heading: "H", text: '<span data-c="accent2">two</span>' } } }];
  const html = page(d);
  assert(/<span class="tc-accent2">two<\/span>/.test(html) && html.includes(".tc-accent2{color:var(--acc2)}"), "drawn in --acc2");
});

check("a verse may sit before, between or after the paragraphs; a title may sit above the photo, aligned, with a line", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const sec = (extra) => ({ id: "s1", type: "photoText", variant: "left", photo: "https://thauma.one/media/p.jpg",
    words: { en: { heading: "H", text: "One.\n\nTwo.\n\nThree.", verse: "V" } }, ...extra });
  const body = (extra) => { d.pages[0].sections = [sec(extra)]; return page(d).match(/<section[^>]*id="s-s1"[\s\S]*?<\/section>/)[0]; };
  assert(/<p>One\.<\/p><\/div><figure class="verse[\s\S]*<p>Two\.<\/p><p>Three\.<\/p>/.test(body({ versePos: "p1" })), "after paragraph 1");
  assert(/<figure class="verse[\s\S]*<p>One\./.test(body({ versePos: "start" })), "before");
  assert(/<p>Three\.<\/p><\/div><figure class="verse/.test(body({})), "after, by default");
  const above = body({ titleInline: false, titleAlign: "center", titleLine: true });
  assert(/<div class="wrap"><div class="th th-center"><h2[^>]*>[\s\S]*?<\/h2><span class="rule m"[^>]*><\/span><\/div><div class="pt">/.test(above), "above, centered, lined");
  assert(/<div class="pt">[\s\S]*<div><h2/.test(body({})), "with the words, by default");
});

check("sharing and search: each page's own words and picture, the real public address; none of it on a draft", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  const about = d.pages.find((p) => p.id === "about"); about.on = true;
  about.sections = [{ id: "a1", type: "photoText", variant: "left", photo: "/media/partnersite/x/p.webp", words: { en: { heading: "H", text: "I grew up surrounded by ministry, and it shaped everything." } } }];
  const head = (extra) => page(d, "about", "en", { site: { slug: "chase-roush", display_name: "Chase Roush", subdomain: "chaseroush" }, ...extra }).match(/<head>[\s\S]*<\/head>/)[0];
  const h = head();
  assert(h.includes('<meta name="description" content="I Grew Up Surrounded by Ministry, and It Shaped Everything.">'), "this page's own words, in Title Case (English)");
  about.seo = { desc: { en: "news from the field, once a month", hr: "vijesti s terena, jednom mjesečno" } };
  assert(head().includes('content="News from the Field, Once a Month"'), "a typed description, in Title Case (English)");
  assert(page(d, "about", "hr", { site: { slug: "chase-roush", display_name: "Chase Roush", subdomain: "chaseroush" } }).includes('content="vijesti s terena, jednom mjesečno"'), "Croatian as written");
  delete about.seo;
  assert(h.includes('<link rel="canonical" href="https://chaseroush.thauma.one/en/about/">'), "canonical");
  assert(h.includes('<meta property="og:image" content="https://thauma.one/media/partnersite/x/p.webp">'), "its first photo, as a full address");
  assert(h.includes('hreflang="hr" href="https://chaseroush.thauma.one/hr/about/"') && h.includes('hreflang="x-default"'), "alternates, full");
  about.shareImage = "https://thauma.one/media/partnersite/x/chosen.webp";
  assert(head().includes('og:image" content="https://thauma.one/media/partnersite/x/chosen.webp"'), "the chosen picture wins");
  assert(!/og:|canonical/.test(head({ draft: true })), "not on a draft");
});

check("the photo editor's choices: a crop is a window onto the original; a point is position, zoom and darkening; junk is dropped", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const ph = "https://thauma.one/media/p.jpg";
  d.pages[0].sections = [{ id: "a", type: "photoText", variant: "left", photo: ph, words: { en: { text: "x" } },
    photoEdit: { x: 0.25, y: 0.1, w: 0.5, h: 0.4, ar: 1, corners: "round", border: "accent" } }];
  assert(/<span class="pe-crop pe-round pe-b-accent" style="aspect-ratio:1"><img src="https:\/\/thauma\.one\/media\/p\.jpg"[^>]*style="width:200%;height:auto;left:-50%;top:-25%">/.test(page(d)), "crop window");
  d.pages[0].sections = [{ id: "b", type: "photo", variant: "drift", photo: ph, words: { en: {} }, photoEdit: { fx: 30, fy: 70, zoom: 1.4, darken: 0.35 } }];
  const band = page(d).match(/<section class="fullphoto[\s\S]*?<\/section>/)[0];
  assert(/style="object-position:30% 70%;scale:1\.4;transform-origin:30% 70%"><i class="pe-dark" style="opacity:0\.35">/.test(band), "point, zoom, darken");
  const c = cleanDoc({ ...d, pages: [{ ...d.pages[0], sections: [{ id: "c", type: "photoText", variant: "left", photo: ph, words: { en: {} }, photoEdit: { x: "a", w: 2 } }] }] }, ["en"]);
  assert(!c.pages[0].sections[0].photoEdit, "junk dropped");
});

check("Advanced: a written title and description win; the name card is the default picture once made", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const home = d.pages[0];
  home.sections = [{ id: "h", type: "hero", variant: "beside", photo: "https://thauma.one/media/p.jpg", words: { en: { heading: "Hi", text: "Serving churches with production excellence." } } }];
  const head = () => page(d, "home", "en", { site: { slug: "c", display_name: "Chase Roush", subdomain: "chaseroush" } }).match(/<head>[\s\S]*<\/head>/)[0];
  assert(head().includes('og:image" content="https://thauma.one/media/p.jpg"'), "no card yet: the photo");
  home.shareCards = { en: { url: "https://thauma.one/media/card-en.jpg", sig: "x" } };
  assert(head().includes('og:image" content="https://thauma.one/media/card-en.jpg"'), "the card, once made");
  home.seo = { title: { en: "Production for churches" }, desc: { en: "Written by hand." }, image: "photo" };
  const h = head();
  assert(h.includes("<title>Production for churches</title>") && h.includes('og:description" content="Written by Hand."') && h.includes('og:image" content="https://thauma.one/media/p.jpg"'), "written wins; photo chosen");
});

check("any text size like Word: 4–200px kept and drawn; the first version's multiples still read; anything else dropped", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [{ id: "t1", type: "text", variant: "left", words: { en: { heading: "H",
    text: '<span data-sz="1.35">big</span> <span data-sz="9">huge</span> <span data-sz="lg" data-c="#ff00aa">both</span> <span data-sz="5px">tiny</span> <span data-sz="2px">gone</span>' } } }];
  const html = page(d);
  assert(html.includes('<span style="font-size:1.35em">big</span>'), "a multiple, still");
  assert(unsized(html).includes('<span style="font-size:5px">tiny</span>'), "a size in px");
  assert(!/font-size:2px|data-sz="2px"/.test(html), "below 4px survived");
  assert(!/font-size:9em|data-sz="9"/.test(html), "an out-of-range size survived");
  assert(html.includes('<span class="ts-lg" style="color:#ff00aa">both</span>'), "a preset with a picked color");
});


check("every section has Plain, Raised and Tint — the opening, the header and a full-width photo too", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const home = d.pages.find((p) => p.id === "home");
  home.sections[0].raised = true;
  home.sections.push({ id: "h1", type: "header", variant: "plain", bg: "tint", words: { en: { heading: "Hi", label: "small words" } } });
  home.sections.push({ id: "p1", type: "photo", variant: "still", tint: true, photo: "/media/site/x.webp", words: { en: {} } });
  const html = page(d);
  assert(/<section class="hero hero-behind al-left raised/.test(html), "the opening, raised");
  assert(/class="phead[^"]*ph-tint[^"]*band/.test(html), "a header saved with bg tint reads as Tint");
  assert(/<section class="fullphoto[^"]* band"/.test(html), "a full-width photo, tinted");
  assert(/main section:is\(\.raised,\.band\) :is\(\.card,\.givepanel,\.ccards li,\.news a,\.linklist a,\.latest\)\{background:var\(--bg\)\}/.test(html), "every card swaps on Raised and Tint");
  assert(!/\.kicker\{[^}]*uppercase/.test(html) && !/\.ph-label\{[^}]*uppercase/.test(html), "what a person types keeps its own capitals");
});


check("chaseroush.com's Give page: Open cards with lines between, joined to the band above, bars beside a title", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const g = d.pages.find((p) => p.id === "give");
  g.sections.splice(1, 0, { id: "cc1", type: "cards", variant: "open", lines: true, join: true, align: "center", words: { en: {} },
    items: [{ words: { en: { title: "You Give", text: "with confidence" } } }, { words: { en: { title: "I Go", text: "with excellence" } } }] });
  g.sections[2].titleBars = true;
  d.pages.find((p) => p.id === "mission").sections[0].titleBars = true;
  const doc = cleanDoc(d, ["en"]);
  const c = doc.pages.find((p) => p.id === "give").sections[1];
  eq([c.variant, c.join, doc.pages.find((p) => p.id === "give").sections[2].titleBars], ["open", true, true], "kept");
  const html = page(d, "give", "en", { draft: true });
  assert(/<section class="cards-open cards-lines band al-center" id="s-cc1" data-joined>/.test(html), "open, lined, and wearing the tinted band above it: " + (html.match(/<section[^>]*s-cc1[^>]*>/) || [""])[0]);
  assert(/\nmain section\.cards-open \.ccards li\{background:none;border:0/.test(html), "open cards have no boxes (a rule of its own, not glued to another selector)");
  assert(/main section\[data-joined\]\{padding-top:0;border-top-color:transparent\}/.test(html), "no gap and no line above a joined section");
  assert(/class="[^"]*tbars[^"]*"[^>]*><div class="wrap"><h2 class="h m"><span class="tbw">/.test(page(d, "mission")), "the title held together between its bars");
});

check("Links: a Buttons layout, each button its own color; a lone link or card follows the line-up", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const r = d.pages.find((p) => p.id === "resources"); r.on = true;
  const L = r.sections[0]; L.variant = "buttons"; L.align = "center";
  L.items[0].color = "accent2"; L.items[1].color = "#AA3355";
  const html = page(d, "resources");
  assert(/<a class="btn solid lb-accent2" href="\/site\/chaseroush\/en\/about\/">/.test(html), "the second color");
  assert(/<a class="btn solid lb-own" href="\/site\/chaseroush\/en\/mission\/" style="background:#aa3355;border-color:#aa3355;color:#ffffff">/.test(html), "any color, with readable words");
  assert(/\.al-center \.linklist a\{text-align:center\}/.test(html) && /\.al-center\.links-cards \.linklist:not\(\.lt-small,\.lt-big\)\{[^}]*justify-content:center\}/.test(html), "centering a lone link and a lone card");
  L.items[0].color = "javascript:alert(1)";
  eq(cleanDoc(d, ["en"]).pages.find((p) => p.id === "resources").sections[0].items[0].color, "accent", "nonsense is the accent");
});

check("an open sign-up or contact form's fields are the other color from the ground it sits on", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const st = d.pages.find((p) => p.id === "stay"); st.sections[0].variant = "open";
  const look = (html) => JSON.parse(html.match(/data-thauma-form[^>]*data-look="([^"]*)"/)[1].replace(/&quot;/g, '"'));
  const plain = look(page(d, "stay"));
  assert(plain.field === plain.panel && plain.field !== plain.bg, "on the page's ground, fields are the panel color");
  st.sections[0].raised = true;
  const raised = look(page(d, "stay"));
  assert(raised.field === raised.bg, "on a raised ground, fields are the page color");
  st.sections[0].raised = false; st.sections[0].variant = "card";
  const card = look(page(d, "stay"));
  assert(card.field === card.bg, "inside a card, unchanged: the page color");
});


check("each of the owner's own footer links: in line with the socials, or separated as words or an icon; its own picture, its site's icon, or its initials", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.links = [{ kind: "youtube", url: "@chase" },
    { kind: "custom", url: "page:about", label: { en: "Our Story" }, place: "inline" },
    { kind: "custom", url: "https://github.com", label: { en: "GitHub" }, place: "inline" },
    { kind: "custom", url: "https://blog.example.org/", label: { en: "Blog" }, place: "apart", show: "words" },
    { kind: "custom", url: "https://shop.example.org/", label: { en: "Shop" }, place: "apart", show: "icon", iconImg: "/media/site/shop.png" }];
  const foot = page(d).match(/<footer[\s\S]*<\/footer>/)[0];
  assert(/<span class="socials"><a href="\/site\/chaseroush\/YouTube"[^]*?<a class="favi no-icon" href="\/site\/chaseroush\/en\/about\/"[^>]*><span class="lt" aria-hidden="true">OS<\/span><\/a><a class="favi" href="[^"]+"[^>]*><img src="https:\/\/thauma\.one\/embed\/v1\/icon\?d=github\.com"[^>]*crossorigin="anonymous"><span class="lt" aria-hidden="true">GI<\/span>/.test(foot), "in line: after the socials, a page's initials, a site's icon with initials behind it");
  assert(/<span class="words"><a href="\/site\/chaseroush\/Blog"[^>]*>Blog<\/a><\/span>/.test(foot), "separated, as words, by its clean address");
  assert(/<span class="socials owns"><a class="favi own" href="\/site\/chaseroush\/Shop"[^>]*><img src="\/media\/site\/shop\.png"/.test(foot), "separated, as its own picture");
  d.links[4].iconImg = "javascript:alert(1)";
  assert(!("iconImg" in cleanDoc(d, ["en"]).links[4]), "a picture address that is not one is not kept");
});


check("a page's own description is a title as its language writes one: Title Case in English, as written in Croatian", () => {
  eq(MODEL.titleCase("tell your story here: who you are and why it matters to the people of iPhone land.", "en"),
    "Tell Your Story Here: Who You Are and Why It Matters to the People of iPhone Land.", "English");
  eq(MODEL.titleCase("Recite svoju priču ovdje.", "hr"), "Recite svoju priču ovdje.", "Croatian");
  /* Chase, 2026-10-08: typed in capitals, it still read as capitals. */
  eq(MODEL.titleCase("NEWS, PRAYER AND THE ROAD AHEAD", "en"), "News, Prayer and the Road Ahead", "capitals, English");
  eq(MODEL.titleCase("VIJESTI I MOLITVE S TERENA", "hr"), "Vijesti i molitve s terena", "capitals, Croatian: a sentence");
  eq(MODEL.titleCase("our trip to the USA and back", "en"), "Our Trip to the USA and Back", "an acronym in ordinary words stays");
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  assert(/<meta name="description" content="News, Prayer and the Road Ahead — All in One Place\.">/.test(page(d)), "the page's own, in English");
  d.pages[0].seo = { title: {}, desc: { en: "written by me, as I like it" }, image: null };
  /* Chase, 2026-10-08: what the owner writes reads as the language writes a
     description too — English in Title Case. */
  assert(/<meta name="description" content="Written by Me, as I Like It"/.test(page(d)), "what the owner wrote, in Title Case");
});

/* ------------------------------------------------- the ministry's app -- */

check("every site has an app, offered only to a phone: in the phone's menu and asked once; never in the footer, never on a computer", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  const html = page(d);
  assert(html.includes('<link rel="manifest" href="/site/chaseroush/app/manifest.webmanifest">'), "the manifest");
  assert(!/<footer[\s\S]*Get the App[\s\S]*<\/footer>/.test(html), "not in the footer");
  assert(/<nav class="nav" id="sitenav">[\s\S]*<a class="navapp" href="\/site\/chaseroush\/app">[\s\S]*Get the App<\/a>/.test(html), "in the menu");
  assert(/\.navapp\{display:none\}\s*@media \(hover:none\) and \(pointer:coarse\)\{html\.menu-open \.nav \.navapp\{display:inline-flex/.test(html), "shown only in a phone's open menu");
  assert(/<div class="appask" id="appask" hidden[^>]*>[\s\S]*Add Chase Roush to your phone[\s\S]*<\/div>/.test(html) && html.includes("(hover: none) and (pointer: coarse)") && html.includes("if(n<2)return"), "asked once, on a phone, after a second visit");
  assert(!page(d, "home", "en", { draft: true }).includes('rel="manifest"') && !page(d, "home", "en", { draft: true }).includes('id="appask"'), "not in a preview");
  assert(/Preuzmite aplikaciju<\/a>/.test(page(d, "home", "hr")), "in the page's language");
});

check("the app shows what the site publishes: open prayer, the road so far newest first, letters, goals, the giving link", () => {
  const d = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }), ["en", "hr"]);
  const pay = { languages: [{ code: "en" }, { code: "hr" }],
    prayer: [{ id: "p1", is_answered: false, text: { en: { title: "Visas" } } }, { id: "p2", is_answered: true, answered_on: "2026-09-01", text: { en: { title: "A home" } } }],
    goals: [{ id: "g1", label: "Monthly", target_cents: 100000, raised_cents: 25000, currency: "EUR", percent: 25 }],
    milestones: [{ id: "m1", actual_date: "2026-01-01", status: "complete", text: { en: { title: "Old" } } },
      { id: "m2", actual_date: "2026-08-01", status: "complete", text: { en: { title: "New" } } },
      { id: "m3", actual_date: "2027-01-01", status: "upcoming", text: { en: { title: "Later" } } },
      { id: "m4", actual_date: "2026-05-01", status: "canceled", text: { en: { title: "No" } } }],
    mailings: [{ subject: "October", sent_at: "2026-10-01", url: "https://thauma.one/archive/x/y/z/" }], videos: [] };
  const a = appData(pay, d, { display_name: "Chase Roush", giving_url: "https://give.example.org" }, { p1: 14 });
  eq(a.prayer.map((p) => [p.id, p.answered, p.n]), [["p1", false, 14], ["p2", true, 0]], "prayer with its count");
  eq(a.milestones.map((m) => m.id), ["m2", "m1"], "happened, newest first");
  eq(a.goals[0].percent, 25, "the goal");
  eq(a.give, "https://give.example.org", "the giving link");
  eq(a.langs, ["en", "hr"], "languages");
});

check("the app's page wears the site's colors, is never indexed, and carries no script a request can break", () => {
  const L = { bg: "#0A0D12", panel: "#10161E", fg: "#EDF2F8", dim: "#9AA6B6", line: "rgba(255,255,255,.09)", acc: "#2FD8FF", acc2: "#5CF2C4",
    ink: "#2FD8FF", onAcc: "#000", scheme: "dark", display: "'Sora'", body: "'Inter'", thin: 100, boldW: 600 };
  const html = renderApp({ L, design: { look: "night" }, title: "Chase </script> Roush", apple: "/x.png",
    boot: { base: "", lang: "en", data: { name: "</script><script>alert(1)</script>" }, words: {} } });
  assert(html.includes("--acc:#2FD8FF"), "the accent");
  assert(html.includes('<meta name="robots" content="noindex">'), "not indexed");
  assert(!html.includes("</script><script>alert(1)"), "a name cannot end the script");
  assert(html.includes('<link rel="manifest" href="/app/manifest.webmanifest">'), "installable");
});

await checkAsync("I prayed: once per phone, only this ministry's, and the phone is never stored as sent", async () => {
  const calls = [];
  const db = { query: async (name, p) => { calls.push([name, p]); return name === "prayer_prayed_counts" ? [{ prayer_id: "p1", n: 3 }] : []; },
    queryOne: async () => null };
  const doc = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" }), ["en"]);
  const row = { partner_id: "pa_1", display_name: "Chase Roush", slug: "chase-roush" };
  const post = (body, origin = "https://chaseroush.thauma.one") => serveApp(new Request("https://chaseroush.thauma.one/app/prayed",
    { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }), {}, { db, row, doc, base: "", rest: "/app/prayed" });
  const res = await post({ prayer_id: "p1", device: "abcdefabcdefabcdef12" });
  eq(res.status, 200, "kept");
  eq((await res.json()).n, 3, "the count back");
  const add = calls.find((c) => c[0] === "prayer_prayed_add")[1];
  eq(add.partner_id, "pa_1", "only this ministry's requests");
  assert(add.device !== "abcdefabcdefabcdef12" && /^[0-9a-f]{32}$/.test(add.device), "a hash, not the phone's id");
  eq((await post({ prayer_id: "p1", device: "short" })).status, 400, "not a phone id");
  eq((await post({ prayer_id: "p1", device: "abcdefabcdefabcdef12" }, "https://evil.example")).status, 403, "not from another site");
  eq(await serveApp(new Request("https://chaseroush.thauma.one/app/nothing"), {}, { db, row, doc, base: "", rest: "/app/nothing" }), null, "not the app's");
});

await checkAsync("a supporter's phone keeps only the topics there are, in a language the site speaks; another ministry cannot remove it", async () => {
  const calls = [];
  const db = { query: async (name, p) => { calls.push([name, p]); return []; },
    queryOne: async () => ({ audience: "supporter", partner_id: "pa_2" }) };
  const doc = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }), ["en", "hr"]);
  const row = { partner_id: "pa_1", display_name: "Chase Roush", slug: "chase-roush" };
  const env = { VAPID_PUBLIC_KEY: "B" + "A".repeat(86), VAPID_PRIVATE_KEY: "x".repeat(43) };
  const call = (method, body) => serveApp(new Request("https://chaseroush.thauma.one/app/push", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    env, { db, row, doc, base: "", rest: "/app/push" });
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) } };
  const res = await call("POST", { subscription: sub, topics: ["prayer", "spam"], lang: "xx" });
  eq(res.status, 200, "saved");
  const saved = calls.find((c) => c[0] === "push_sub_save")[1];
  eq([saved.audience, saved.partner_id, saved.user_id, saved.topics, saved.lang], ["supporter", "pa_1", null, '["prayer"]', "en"], "what is kept");
  await call("DELETE", { endpoint: sub.endpoint });
  assert(!calls.some((c) => c[0] === "push_sub_forget"), "another ministry's phone stays");
});

check("Tell your supporters: each phone is told in its own language, and only about what is published", () => {
  const site = { prayer: [{ id: "p1", is_answered: false, text: { en: { title: "Visas" }, hr: { title: "Vize" } } },
    { id: "p2", is_answered: true, text: { en: { title: "A home" } } }],
    milestones: [{ id: "m1", text: { en: { title: "Board formed" } } }], goals: [{ id: "g1", label: "Monthly", percent: 41.6, text: {} }] };
  const p = newsFor(site, "prayer", "p1");
  eq([p.topic, p.tab, p.line("en"), p.line("hr")], ["prayer", "prayer", "New prayer request · Visas", "Nova molitvena potreba · Vize"], "a request");
  eq(newsFor(site, "prayer", "p2").line("sr"), "Молитва услишена · A home", "answered, in English where untranslated");
  eq([newsFor(site, "milestone", "m1").tab, newsFor(site, "milestone", "m1").line("en")], ["updates", "News · Board formed"], "a milestone");
  eq(newsFor(site, "goal", "g1").line("en"), "Monthly · 42%", "a goal");
  eq(newsFor(site, "prayer", "not-public"), undefined, "nothing that is not published");
  eq(newsFor(site, "nonsense", "p1"), null, "nothing of another kind");
});

check("every outside link has a clean address the site also redirects, and adding one never renames another", () => {
  let d = cleanDoc(starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" }), ["en", "hr"]);
  const giving = "https://give.example.org/chase";
  d.pages[0].sections[1].link = "https://www.paypal.com/donate/x";
  d = cleanDoc(d, ["en", "hr"]);   // saved
  eq(d.short, { "https://www.paypal.com/donate/x": "Paypal" }, "the name is saved with the site");
  const opts = { base: "", giving };
  let t = MODEL.linkTable(d, giving);
  eq(t.byUrl.get(giving), "Donate", "the giving link, while the Give page is on");
  eq(t.byUrl.get("https://www.paypal.com/donate/x"), "Paypal", "an address by its site's name");
  eq(cleanLinkTarget(d, ["Donate"], opts), giving, "/Donate redirects to it");
  eq(cleanLinkTarget(d, ["hr", "Doniraj"], opts), giving, "in the site's other language too");
  eq(cleanLinkTarget(d, ["paypal"], opts), "https://www.paypal.com/donate/x", "/Paypal redirects to it");
  d.pages[0].sections[0].link = "https://paypal.com/other";   // added ABOVE the first
  d = cleanDoc(d, ["en", "hr"]);
  t = MODEL.linkTable(d, giving);
  eq(t.byUrl.get("https://www.paypal.com/donate/x"), "Paypal", "the first keeps its name");
  eq(t.byUrl.get("https://paypal.com/other"), "Paypal-other", "a second address on the same site adds its path word");
  const html = page(d, "give", "en", { site: { slug: "chase-roush", display_name: "Chase Roush", giving_url: giving } });
  assert(/href="\/site\/chaseroush\/Donate"/.test(html) && !/give\.example\.org/.test(html), "the Give page's button is clean");
  assert(cleanLinkTarget(d, ["about"], opts) === "/en/about/", "a page keeps its own name");
});

check("the closed page's logo is the site's own, in pieces, with its shimmer parked until it starts", () => {
  const body = (f) => readFileSync(new URL("../../src/_includes/brand/" + f, import.meta.url), "utf8").replace(/\{#-[\s\S]*?-#\}\s*/g, "").trim();
  eq(LOGO.LOGO_SPLIT, body("logo-split.njk"), "logo-split.njk and site/logo.js agree");
  eq(LOGO.LOGO_SHEEN, body("logo-sheen.njk"), "logo-sheen.njk and site/logo.js agree");
  assert(LOGO.sheenLogo("cl").includes('gradientTransform="translate(-9000 0)"'), "the light waits well clear of the logo");
  assert(!LOGO.splitLogo("cl").includes("{{"), "ids filled in");
});

check("Title Case: a word starting a sentence is capitalized, never \". the\"", () => {
  eq(MODEL.titleCase("simple to state. the need is real: a church needs help", "en"), "Simple to State. The Need Is Real: A Church Needs Help", "after . and :");
  eq(MODEL.titleCase("news, prayer and the road ahead", "en"), "News, Prayer and the Road Ahead", "small words inside stay small");
});

check("fonts: the chosen one, then the fallback, then the look's; Google is asked for exactly those; only our own font files", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "sr"], fallback: "en" });
  d.design.fonts = { heading: "bebas", body: "inter", fallback: "montserrat" };
  const c = cleanDoc(d, ["en", "sr"]);
  eq(c.design.fonts.heading, "bebas", "heading kept");
  const html = page(c);
  assert(html.includes("family=Bebas+Neue&") && html.includes("family=Inter:wght@100..900") && html.includes("family=Montserrat:wght@100..900"), "Google asked");
  assert(/--display:'Bebas Neue', 'Montserrat', 'Sora'/.test(html), "heading stack");
  assert(/--body:'Inter', 'Montserrat', 'Inter'/.test(html), "text stack");
  /* the fallback must write Cyrillic; a font without it is not one */
  d.design.fonts = { fallback: "bebas", heading: "nope" };
  eq([cleanDoc(d, ["en"]).design.fonts.fallback, cleanDoc(d, ["en"]).design.fonts.heading], ["look", "look"], "refused");
  /* an uploaded font: only ours, only a font file */
  d.design.fonts = { heading: "own", own: "/media/partnersite/c/display-ab12.woff2", ownName: "Display" };
  const own = cleanDoc(d, ["en"]);
  assert(page(own).includes("@font-face{font-family:'SiteOwn';src:url(/media/partnersite/c/display-ab12.woff2) format('woff2')"), "face");
  for (const bad of ["https://evil.example/f.woff2", "/media/partnersite/c/x.svg", "/media/partnersite/../x.woff2"]) {
    d.design.fonts = { heading: "own", own: bad };
    eq(cleanDoc(d, ["en"]).design.fonts.heading, "look", bad);
  }
  const ids = Object.keys(MODEL.FONT_CHOICES);
  const src = readFileSync(new URL("../../src/js/staff-site.js", import.meta.url), "utf8");
  for (const id of [...MODEL.HEADING_FONTS, ...MODEL.BODY_FONTS]) assert(src.includes("'" + id + "'"), "the console offers " + id);
  assert(ids.every((id) => src.includes("'" + MODEL.FONT_CHOICES[id].family + "'")), "the console knows every family");
});

check("the speed is seconds on a slider; the three old words read as theirs; a section may arrive its own way; Justified", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  for (const [v, want] of [["slow", 1.7], ["medium", 1.25], ["fast", 0.8], [0.05, 0.2], [9, 4], [2.345, 2.35], ["x", 1.25]]) {
    d.design.motion.speed = v;
    eq(cleanDoc(d, ["en"]).design.motion.speed, want, "speed " + v);
  }
  d.design.motion.speed = 2;
  const sec = d.pages.find((p) => p.id === "mission").sections[0];
  sec.enter = "sweep"; sec.align = "justify";
  const c = cleanDoc(d, ["en"]);
  eq([c.pages.find((p) => p.id === "mission").sections[0].enter, c.pages.find((p) => p.id === "mission").sections[0].align], ["sweep", "justify"], "kept");
  sec.enter = "explode";
  assert(!("enter" in cleanDoc(d, ["en"]).pages.find((p) => p.id === "mission").sections[0]), "only a known way");
  sec.enter = "sweep";
  const html = page(cleanDoc(d, ["en"]), "mission");
  assert(/<html [^>]*style="--mt:2s;--mstep:176ms;--cstep:67ms"/.test(html), "the seconds on the page");
  assert(/<section class="[^"]*al-justify[^"]*" id="s-[^"]+" data-enter="sweep">/.test(html), "the section's own way, justified");
  assert(unsized(html).includes(':is(html[data-entrance="sweep"] main section:not([data-enter]),main section[data-enter="sweep"]) .m:not(.in){opacity:0;transform:translateX(40px)}'), "its own way over the site's");
  assert(/\.al-justify :is\([^)]*\.prose p[^)]*\)\{text-align:justify/.test(html), "the words run edge to edge");
  /* arriving from another page: after the cross-fade, as on a refresh */
  assert(html.includes("e.viewTransition.finished.then(go,go)") && html.includes("window.__siteReplay="), "held through the fade; playable from the Site Creator");
});

check("Links: a real List, a Shelf, Buttons in a row or stacked, and how the pictures show", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const r = d.pages.find((p) => p.id === "resources"); r.on = true;
  const L = r.sections[0];
  L.items[0].photo = "/media/partnersite/c/a.webp"; L.items[0].words.en.note = "Mine";
  L.variant = "list";
  let html = page(cleanDoc(d, ["en"]), "resources");
  assert(/<ul class="llist m"><li><a href="[^"]+"><span class="ll-pic"><img src="\/media\/partnersite\/c\/a.webp"/.test(html), "a row with its picture");
  assert(html.includes('<span class="ll-note">Mine</span>'), "the note too, when wanted");
  L.showNote = false; L.pics = "none";
  html = page(cleanDoc(d, ["en"]), "resources");
  assert(!html.includes('<span class="ll-note">') && !html.includes('<span class="ll-pic">'), "switched off");
  L.variant = "shelf"; L.pics = "round"; L.showNote = true;
  html = page(cleanDoc(d, ["en"]), "resources");
  assert(/links-shelf pics-round/.test(html) && /<ul class="sh-row"><li><a class="sh-card"/.test(html) && html.includes('class="sh-next" aria-label="Next"'), "the shelf, round pictures, arrows");
  L.variant = "buttons"; L.stack = true; L.pics = "fill";
  html = page(cleanDoc(d, ["en"]), "resources");
  assert(/<div class="lstack m"><a class="btn solid lb-accent" href="[^"]+"><span class="ls-pic"><img/.test(html), "stacked, each with its picture");
  L.stack = false;
  assert(/<div class="btns linkbtns m"><a class="btn solid lb-accent" href="[^"]+">A Resource/.test(page(cleanDoc(d, ["en"]), "resources")), "a row of buttons, no pictures");
  L.pics = "sparkly";
  eq(cleanDoc(d, ["en"]).pages.find((p) => p.id === "resources").sections[0].pics, "whole", "a known way only");
  /* a description starts at 12px, and a size chosen for a whole box is the box's own, so its lines are spaced for it */
  assert(/\.rc-desc\{color:var\(--dim\);font-size:12px;line-height:1\.7/.test(unsized(html)), "12px");
});

check("a page of the owner's own: its own address, kept apart from every other; no more than twelve; linked to and in the menu", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  const mine = (id, label, slug) => ({ id, custom: true, slug, on: true, label: { en: label }, sections: [{ id: "s" + id, type: "text", words: { en: { heading: "Hello", text: "Words here, plenty of them." } } }] });
  d.pages.push(mine("pabc1", "Our Story", "our-story"), mine("pabc2", "Our Story", "our-story"), mine("pabc3", "About", ""), { id: "zzz", custom: true, label: { en: "x" } });
  const c = cleanDoc(d, ["en", "hr"]);
  const own = c.pages.filter((p) => p.custom);
  eq(own.map((p) => [p.id, p.slug]), [["pabc1", "our-story"], ["pabc2", "our-story-2"], ["pabc3", "about-2"]], "each address once, never a built-in page's");
  assert(!c.pages.some((p) => p.id === "zzz"), "only a page id of the right shape");
  for (let i = 0; i < 15; i++) d.pages.push(mine("pmore" + i, "More " + i, ""));
  eq(cleanDoc(d, ["en", "hr"]).pages.filter((p) => p.custom).length, 12, "twelve at most");
  c.pages.find((p) => p.id === "about").sections[0].link = "page:pabc1";
  c.pages.find((p) => p.id === "about").sections[0].words.en.button = "Read it";
  const html = page(c, "about");
  assert(html.includes('<a href="/site/chaseroush/en/our-story/">Our Story</a>'), "in the menu, by its address");
  assert(html.includes('href="/site/chaseroush/en/our-story/">Read it'), "a button goes to it");
  eq(cleanLinkTarget(c, ["Our-Story"], { base: "/site/chaseroush" }), "/site/chaseroush/en/our-story/", "its clean link");
  eq(page(c, "pabc2").match(/<title>([^<]*)<\/title>/)[1], "Our Story · Chase Roush", "its own page, named");
});

check("from thauma.one: a word and its meanings, labeled rows, and Custom Cards numbered I, II, III", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const m = d.pages.find((p) => p.id === "mission");
  m.sections = [
    { id: "sdef1", type: "define", words: { en: { word: "Thauma", say: "θαῦμα · wonder", text: "A wonder.\n\nWhat makes people <i>stop</i>." } } },
    { id: "srow1", type: "rows", words: { en: { heading: "What <b>We Do</b>", text: "" } }, items: [{ words: { en: { label: "Serve", title: "On Site", text: "Behind the scenes." } } }, { words: { en: { label: "", title: "", text: "" } } }] },
    { id: "scrd1", type: "cards", numStyle: "roman", items: [{ words: { en: { title: "One", text: "a" } } }, { words: { en: { title: "Two", text: "b" } } }] },
  ];
  const c = cleanDoc(d, ["en"]);
  eq(c.pages.find((p) => p.id === "mission").sections.map((x) => x.type), ["define", "rows", "cards"], "kept");
  const html = page(c, "mission");
  assert(/<p class="df-word m">Thauma<\/p><p class="df-say m">θαῦμα · wonder<\/p><ol class="df-means m"><li>A wonder\.<\/li><li>What makes people <i>stop<\/i>\.<\/li><\/ol>/.test(html), "the word, how it is said, its meanings");
  assert(/<div class="lrows m"><div class="lrow"><div class="lr-label">Serve<\/div><div><h3>On Site<\/h3><p>Behind the scenes\.<\/p><\/div><\/div><\/div>/.test(html), "one row; an empty one is not drawn");
  assert(html.includes('<span class="cnum roman" aria-hidden="true">II</span>'), "I, II, III");
});

check("a size chosen for a whole box is the box's: its lines are spaced for it", () => {
  const { hoistSizes } = RENDER;
  eq(hoistSizes('<p class="lede m"><span style="font-size:13px">a <b>b</b> <span style="color:#fff">c</span></span></p>'),
    '<p class="lede m" style="font-size:13px">a <b>b</b> <span style="color:#fff">c</span></p>', "lifted");
  eq(hoistSizes('<p><span style="font-size:9px">a</span> b</p>'), '<p><span style="font-size:9px">a</span> b</p>', "a part of a box stays a part");
  eq(hoistSizes('<span class="rc-desc"><span class="ts-lg">x</span></span>'), '<span class="rc-desc" style="font-size:1.25em">x</span>', "a named size");
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[1].words.en.text = '<span data-sz="13px">one\n\ntwo</span>';
  assert(/<div class="prose m" style="font-size:13px"><p>one<\/p><p>two<\/p><\/div>/.test(unsized(page(cleanDoc(d, ["en"])))), "paragraphs and all");
});

check("a photo's size is kept with the site, so the page holds its place; the opened timeline card wears the card color", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections[1].photo = "/media/partnersite/c/b.webp";
  d.dims = { "/media/partnersite/c/b.webp": [1600, 1200], "https://evil.example/x.png": [1, 1], "/media/partnersite/c/z.webp": [0, 5], "/media/partnersite/c/q.webp": "big" };
  const c = cleanDoc(d, ["en"]);
  eq(c.dims, { "/media/partnersite/c/b.webp": [1600, 1200], "https://evil.example/x.png": [1, 1] }, "only sizes of photos");
  assert(/<img src="\/media\/partnersite\/c\/b.webp" alt="[^"]*" loading="eager" fetchpriority="high" decoding="async" width="1600" height="1200">/.test(page(c)), "width and height on the photo");
  const W = readFileSync(new URL("../src/embed-widget.js", import.meta.url), "utf8");
  assert(W.includes("'.detail{background:var(--bg)}.ddesc{background:var(--panel)}'"), "the opened card, a card");
});

check("smaller on a computer: every length in site units, 80% on a wide screen as the browser would draw it; the screen's sizes and hairlines left alone", () => {
  eq(sized("@media (max-width:760px){.a{padding:clamp(36px,5vw,72px) 0;border:1px solid;margin:-5px;max-width:30rem}}"),
    "@media (max-width:760px){.a{padding:clamp(calc(var(--su,1px)*36),5vw,calc(var(--su,1px)*72)) 0;border:1px solid;margin:calc(var(--su,1px)*-5);max-width:calc(var(--su,1px)*480)}}", "lengths, not the screen's");
  eq(sizedInline('<p style="color:#fff;font-size:13px">a</p>'), '<p style="color:#fff;font-size:calc(var(--su,1px)*13)">a</p>', "a size picked in the words");
  eval(SIZE_JS + "; globalThis.__sz = sized");
  eq(globalThis.__sz("@media(max-width:600px){.x{top:-7px}}"), sized("@media(max-width:600px){.x{top:-7px}}"), "the widgets' copy is the same");
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const html = page(cleanDoc(d, ["en"]));
  assert(html.includes(SITE_UNIT) && /\.btn\{[^}]*font:600 calc\(var\(--su,1px\)\*15\)\/1\.25/.test(html), "the page in site units");
  assert(!/style="[^"]*font-size:\d+px/.test(html), "no size left in px");
  const W = readFileSync(new URL("../src/embed-widget.js", import.meta.url), "utf8");
  assert(/getAttribute\('data-look'\) \? sized\(css\) : css/.test(W), "the widgets on a ministry's site only");
  for (const f of ["signup", "contact"]) assert(readFileSync(new URL(`../src/${f}.js`, import.meta.url), "utf8").includes("(node.getAttribute('data-look') ? sized : String)("), `the ${f} form too`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
