#!/usr/bin/env node
/**
 * Partner sites (0044): the document, the page, and the language
 *   node workers/test/site.test.mjs
 */
import { subdomainFrom, validSubdomain, cleanDoc, starter, safeUrl, safePhoto, PAGES, SECTIONS, plainOf, cleanLinkTarget } from "../src/site/model.js";
import { renderPage, esc } from "../src/site/render.js";
import { pickLang } from "../src/site/serve.js";
import { removeSiteDns } from "../src/lib/site-dns.js";
import { word } from "../src/site/model.js";
import * as MODEL from "../src/site/model.js";
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
  eq(d.pages[0].sections[0].words.en.heading, "Follow the work of <b>Chase Roush.</b>", "the name in the opening, bold");
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
  assert(/<details class="langmenu"><summary[^>]*><span>HR<\/span>/.test(header), "in the header, showing the language in use");
  assert(header.indexOf("langmenu") > header.indexOf("</nav>"), "outside the page menu, so a phone still shows it");
  assert(html.includes('hreflang="sr" lang="sr">Српски</a>'), "each language by its own name");
  /* Not in the footer (Chase, 2026-10-01: "We also don't need the language
     toggle in the footer"): the header's is on every page. */
  assert(!/langmenu/.test(html.slice(html.indexOf("<footer"), html.indexOf("</footer>"))), "not repeated in the footer");
});

check("the opening fills the screen, with an arrow that bounces until the visitor scrolls", () => {
  const html = page(starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" }));
  assert(/\.hero\{[^}]*min-height:calc\(100svh - 69px\)/.test(html), "the whole first screen");
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
  assert(/\.scrollcue i\{[^}]*width:2px;height:32px;background:var\(--acc\)/.test(html), "the line in the accent");
});

check("the ministry's widgets sit centered unless put left; the newest newsletter as a card, the rest behind a link", () => {
  const mail = [{ subject: "September", sent_at: "2026-09-20", url: "https://thauma.one/archive/chase-roush/news/september/", preheader: "The visa." },
                { subject: "August", sent_at: "2026-08-20", url: "https://thauma.one/archive/chase-roush/news/august/" }];
  const d = blankWith([{ type: "newsletters", variant: "latest", words: { en: { bold: "News" } } },
                       { type: "timeline", align: "left", words: { en: { bold: "Road" } } }]);
  const html = page(d, "home", "en", { payload: { ...payload, milestones: [{ id: "m" }], mailings: mail } });
  assert(/<section class="data al-center"[^>]*>/.test(html), "centered, by default");
  assert(/<section class="data al-left"[^>]*>/.test(html), "left, when chosen");
  assert(html.includes('<a class="latest m" href="https://thauma.one/archive/chase-roush/news/september/">'), "the newest");
  assert(!html.includes('href="https://thauma.one/archive/chase-roush/news/august/"'), "only the newest is linked");
  assert(html.includes('<a href="https://thauma.one/archive/chase-roush/news/" target="_blank" rel="noopener">See past newsletters</a>'), "the rest, at the list's archive");
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
  assert(/<a href="https:\/\/www\.youtube\.com\/@chase" target="_blank"[^>]* rel="noopener"/.test(withLinks), "a social link, in a new tab");
  assert(!/<a href="\/[^"]*" target=/.test(withLinks), "the site's own pages stay in the tab");
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
  assert(/<div class="cols">[\s\S]*?<\/div><div class="bar"><p class="small">S<\/p><span class="powered">/.test(html), "columns: the columns, then a bar for the small print and the credit");
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
  assert(/<span class="words"><a href="https:\/\/youtube\.com\/@c" target="_blank" rel="noopener">YouTube<\/a><a href="https:\/\/cal\.example\/"/.test(html), "socials as names, beside the owner's links");
  assert(html.includes('<p class="tagline tagline-plain">All of me for all of Him</p>') && html.includes("Donations are tax-deductible."), "the words");
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

check("a Band is a band, and Raised changes it, on Give and Sign-up, in every look", () => {
  /* Chase's review, 2026-10-03: Raised looked the same as Plain on the band
     layouts (both painted --panel), and Give's Band barely changed the
     background (--panel is a 7% step on a dark custom look). */
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
      const bgs = [false, true].map((raised) => {
        const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
        Object.assign(d.design, design);
        d.pages[0].sections = [{ id: "s1", type, variant: "band", raised,
          words: { en: { heading: "Hi", text: "", button: "" } } }];
        const html = renderPage({ doc: cleanDoc(d, ["en"]), site: { slug: "c", display_name: "C", giving_url: "https://give.example/" },
          payload, theme: payload.theme, lang: "en", pageId: "home", base: "/site/c", origin: "https://thauma.one", draft: false });
        const st = styleOf(html, "main section");
        return { band: resolve(html, st.backgroundColor), page: rootVar(html, "bg") };
      });
      const label = `${design.look} ${type}`;
      assert(bgs[0].band && bgs[1].band, `${label}: no band color (${JSON.stringify(bgs)})`);
      assert(bgs[0].band !== bgs[0].page, `${label}: the band is the page's color`);
      assert(bgs[1].band !== bgs[0].band, `${label}: Raised changed nothing (${bgs[0].band})`);
      assert(bgs[1].band !== bgs[1].page, `${label}: the raised band is the page's color`);
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
  assert(/main section\[id\]\{scroll-margin-top:68px\}/.test(html), "it would land under the sticky header");
  assert(/@media \(prefers-reduced-motion:no-preference\)\{html\{scroll-behavior:smooth\}\}/.test(html),
    "smooth only for those who allow motion");
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
  assert(/behavior:still\?'auto':'smooth'\}\)\},380\)/.test(html), "it ignores reduced motion");
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
    ["left", "center", "center", "left", "center", "left", "center", "left", "right", "indent", "left"], "aligns");
});

check("the page carries each section's alignment, and its buttons follow it", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  d.pages[0].sections = [
    { id: "a1", type: "text", variant: "left", align: "right", link: "https://x.org/", words: { en: { heading: "H", text: "T", button: "Go" } } },
    { id: "a2", type: "hero", variant: "behind", align: "center", words: { en: { heading: "Hi" } }, buttons: ["contact"] },
    { id: "a3", type: "quote", variant: "large", align: "indent", words: { en: { quote: "Q" } } },
  ];
  const html = page(d);
  assert(/<section[^>]*class="al-right"[^>]*><div class="wrap"><h2 class="h m">H<\/h2>[\s\S]*?<div class="btns m"><a class="btn solid" href="https:\/\/x\.org\/"/.test(html), "text section, right, with its button");
  assert(/<section class="hero hero-behind al-center/.test(html), "the opening");
  assert(/<section[^>]*class="quote quote-large al-indent"[^>]*>/.test(html), "the quote");
  for (const rule of [".al-right .btns{justify-content:flex-end}", ".al-center .btns{justify-content:center}",
                      ".al-indent>.wrap", ".al-right .bandrow{flex-direction:row-reverse}"]) {
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
  assert(/<span class="ph-mark" aria-hidden="true">Home<\/span>/.test(sec[0]), "the watermark falls back to the page's name");
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
  assert(/\.pt \.pic img,\.ptw \.pic img\{display:block;width:auto;max-width:100%;height:auto;max-height:640px;object-fit:contain\}/.test(html),
    "the whole photo shows");
});

/* ---- the Navigation tab (2026-10-04) ---- */

check("navigation defaults keep every site as it was; junk falls back to them", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en", "hr"], fallback: "en" });
  delete d.design.nav;
  const c = cleanDoc({ ...d, design: { ...d.design, nav: { current: "dot", tint: "red", line: "x", phone: "y" }, giveTo: "?" } }, ["en", "hr"]);
  eq(c.design.nav, { current: "lit", tint: "white", line: "subtle", phone: "drop" }, "defaults");
  eq(c.design.giveTo, "page", "give");
  const html = page(d);
  assert(/data-navcur="lit" data-navtint="white" data-navline="subtle" data-navphone="drop"/.test(html), "attributes");
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
  assert(/<a class="givebtn" href="https:\/\/give\.example\/chase" target="_blank" rel="noopener">/.test(page(d)), "to the link");
  d.give = "";
  assert(/<a class="givebtn" href="[^"]*give\/?"/.test(page(d)) || !/class="givebtn"[^>]*target=/.test(page(d)), "no link: the Give page");
});

/* ---- card sections (2026-10-04) ---- */

check("Custom Cards: numbered and joined when Attached, side by side when Detached; blank cards are not drawn", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const card = (title, text) => ({ words: { en: { title, text } } });
  d.pages[0].sections = [{ id: "c1", type: "cards", variant: "attached", numbers: true,
    words: { en: { heading: "How we work" } }, items: [card("Reliable", "Always there."), card("", ""), card("Kind", "")] }];
  let html = page(d);
  assert(/<section[^>]*class="cards-attached[^"]*"[\s\S]*<ol class="ccards m numbered"><li><span class="cnum"[^>]*>1<\/span><div><h3>Reliable<\/h3><p>Always there\.<\/p><\/div><\/li><li><span class="cnum"[^>]*>2<\/span><div><h3>Kind<\/h3>/.test(html), "attached, numbered, blank skipped");
  d.pages[0].sections[0].variant = "detached"; d.pages[0].sections[0].numbers = false;
  html = page(d);
  assert(/class="cards-detached[\s\S]*<ol class="ccards m">/.test(html) && !/class="cnum"/.test(html), "detached, no numbers");
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

check("links: Large, then Standard, then Small, each in order; a type label; Small has no picture", () => {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  const it = (title, tier, type) => ({ url: "https://x.org/" + title, photo: "https://thauma.one/media/p.jpg", tier, words: { en: { title, type } } });
  d.pages[0].sections = [{ id: "l1", type: "links", variant: "cards", words: { en: { heading: "R" } },
    items: [it("A", "small"), it("B", "big", "Book"), it("C"), it("D", "big"), it("E", "bogus")] }];
  const html = page(d);
  const order = [...html.matchAll(/<b>([A-E])<\/b>/g)].map((m) => m[1]).join("");
  eq(order, "BDCEA", "order");
  assert(/<ul class="linklist m lt-big"><li><a [^>]*><em class="ltype">Book<\/em><span class="lpic">/.test(html), "label and picture on a large card");
  assert(/<ul class="linklist m lt-small"><li><a [^>]*><b>A<\/b>/.test(html), "small: no picture");
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
  eq(c.links.map((k) => !!k.icon), [false, false, true, false, false], "only a web address can be an icon");
  const foot = page(d).match(/<footer[\s\S]*<\/footer>/)[0];
  const words = [...foot.matchAll(/<a href="[^"]*"[^>]*>(About me|Mission|Blog)<\/a>/g)].map((m) => m[1]);
  eq(words, ["About me", "Mission", "Blog"], "pages first, then the web");
  assert(/class="socials"[^>]*>[\s\S]*aria-label="YouTube"[\s\S]*<a class="favi" href="https:\/\/chaseroush\.com\/"[^>]*aria-label="chaseroush\.com"[^>]*><img src="https:\/\/thauma\.one\/embed\/v1\/icon\?d=chaseroush\.com"/.test(foot), "the icon, through Thauma, beside the socials");
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
