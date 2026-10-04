#!/usr/bin/env node
/**
 * Partner sites (0044): the document, the page, and the language
 *   node workers/test/site.test.mjs
 */
import { subdomainFrom, validSubdomain, cleanDoc, starter, safeUrl, safePhoto, PAGES, SECTIONS, plainOf } from "../src/site/model.js";
import { renderPage, esc } from "../src/site/render.js";
import { pickLang } from "../src/site/serve.js";
import { removeSiteDns } from "../src/lib/site-dns.js";
import { word } from "../src/site/model.js";
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
  assert(/<section class="hero hero-behind[^"]*">[\s\S]*?<button type="button" class="scrollcue"/.test(html), "the arrow");
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
  assert(/<section class="data al-center">/.test(html), "centered, by default");
  assert(/<section class="data al-left">/.test(html), "left, when chosen");
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
        if (f === "kicker" || (f === "button" && x.type !== "give")) continue;
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
