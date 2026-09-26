#!/usr/bin/env node
/**
 * The Events page — an invitation, a record, and an honest wait
 *   node test/events-page.test.mjs
 *
 * The spec asked for a page whose SHAPE does not change as content
 * accumulates: it never graduates into a calendar or a list, because a
 * calendar is what you look at once you already intend to go, and this page
 * exists to make somebody want to.
 *
 * So what is asserted here is the anatomy, not the styling. A wedding
 * invitation announces, states who and what, sets the date and place apart
 * quietly, and puts the RSVP last and small. Those are structural claims and
 * they survive any amount of later visual work.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { buildDevSite } from "./lib/dev-build.mjs";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the Events page\n");

/* BUILT FROM COMMITTED FIXTURES, in test/fixtures/gatherings.
 *
 * This used to write gatherings into src/content/gatherings, build, assert and
 * delete them. The live dev site grew events nobody wrote and then lost them
 * again, and the rendered output got quoted in conversation as though it were
 * the real page — which cost hours of hunting for content that had deleted
 * itself. The fixtures are permanent files now and the real content folder is
 * never touched.
 */
const html = await (async () => {
  const built = await buildDevSite("/tmp/events-test", "en/events/index.html",
    { contentDir: new URL("./fixtures/", import.meta.url).pathname });
  if (!built.ok) {
    console.log("  FAIL  could not build the site:", built.error);
    process.exit(1);
  }
  return readFileSync("/tmp/events-test/en/events/index.html", "utf8");
})();
const d = new JSDOM(html).window.document;

/* ------------------------------------------------------ the invitation */

await check("exactly ONE gathering is featured, however many are coming", async () => {
  /* Three cards each announcing "You are invited" is a list wearing an
     invitation's clothes, and the announcement stops meaning anything by the
     third time somebody reads it. */
  const featured = d.querySelectorAll("article.invite");
  assert(featured.length === 1, `${featured.length} invitation cards`);
  assert(d.querySelectorAll(".invite-cue").length === 1,
    "the announcement line appears more than once");
});

await check("it has the anatomy of an invitation, in order", async () => {
  const card = d.querySelector(".invite-card");
  assert(card, "no invitation card");
  const order = [...card.children].map((el) => el.className.split(" ")[0]);
  const at = (c) => order.indexOf(c);
  assert(at("invite-cue") === 0, `the announcement is not first: ${order.join(" > ")}`);
  assert(at("invite-head") > at("invite-cue"), "the gathering comes before the announcement");
  assert(at("invite-act") === order.length - 1,
    `the action is not last: ${order.join(" > ")}`);

  /* THE DATE BEFORE THE NAME, inside the head. An invitation prints the date
     large and first because the date is the thing somebody has to decide
     about; the name is what they read once they are already interested. This
     replaced a WHEN/WHERE facts row in which the date was set smaller than
     the summary above it. */
  const head = [...card.querySelector(".invite-head").children]
    .map((el) => el.className.split(" ")[0]);
  assert(head.indexOf("invite-when") === 0,
    `the date is not the first thing in the head: ${head.join(" > ")}`);
  assert(card.querySelector(".invite-lede .invite-title"),
    "the name is not inside the head beside the date");
});

await check("the RSVP is bounded, and never the loudest thing on the page", async () => {
  /* An invitation does not shout its RSVP. A FILLED button would make the page
     about registering rather than about the gathering.
     It is not a bare underline any more either: "small and bounded" had landed
     on a 12px underline in the corner of the card, which is not restraint, it
     is invisible. An outlined target is offered; a filled one is demanded. */
  const css = readFileSync("src/css/main.css", "utf8");
  const act = d.querySelector(".invite-act a");
  assert(act, "no way to register");
  assert(!/\bbtn\b/.test(act.className),
    "it borrowed the site's button classes — the invitation styles its own, " +
    "so that changing the page's buttons cannot quietly make this one solid");
  const rule = css.slice(css.indexOf(".invite-card .invite-act a{"));
  const block = rule.slice(0, rule.indexOf("}"));
  assert(/border:1px solid/.test(block), `the action has no boundary: ${block}`);
  assert(!/background:var\(--foam\)/.test(block),
    "the action is filled with the ministry color — that is a demand, not an offer");
});

await check("the date reads like a date, not like a database value", async () => {
  const when = d.querySelector(".invite-date").textContent;
  assert(/14–15 March 2027/.test(when), `it says "${when.trim()}"`);
  assert(!/2027-03-14/.test(when), "an ISO date reached the page");
});

await check("the date is ONE string, so it stays right in Croatian", async () => {
  /* Croatian, Serbian and Slovenian put the month in the genitive when a day
     precedes it — "14.-15. ozujka 2027." — so splitting the date into a day
     block and a month-year block to stack them would print correct English
     and broken Croatian. The filter knows each locale's whole form; the page
     must not take it apart. */
  const when = d.querySelector(".invite-when");
  const parts = [...when.querySelectorAll("span")]
    .filter((el) => !el.classList.contains("vh"))
    .map((el) => el.className);
  assert(parts.filter((c) => /invite-date/.test(c)).length === 1,
    `the date is split across ${parts.length} elements: ${parts.join(", ")}`);
});

await check("the place is a link, and it forces nobody's maps app", async () => {
  /* This shipped a Google Maps URL, which every platform recognizes and which
     opens Google Maps whatever the reader actually uses. Recognized by
     everything is not the same as right for anybody. */
  /* Moved out of the facts row: the date and the place are the two things an
     invitation states plainly, and a WHERE label in front of a place name is
     the interface explaining itself. The cohort facts keep their labels. */
  const a = d.querySelector(".invite-where a[data-map]");
  assert(a, "the location is not a link, or does not carry the place");
  const href = a.getAttribute("href");
  assert(!/google\.com\/maps/.test(href), `it still forces Google Maps: ${href}`);
  assert(/^https:/.test(href),
    "the markup ships a scheme no desktop browser can open — it has to work " +
    "with no JavaScript, on any platform");
  assert(/Zagreb/.test(decodeURIComponent(href)), "the place did not survive");
});

await check("and on a phone it opens the app that phone actually uses", async () => {
  /* There is no single URL meaning "your maps app": geo: is the standard and
     Android honors it, iOS has no geo: handler, a desktop has no maps app at
     all. So the markup is neutral and the page upgrades it per platform. */
  const cases = {
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15": /^maps:/,
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120": /^geo:/,
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120": /^https:/,
  };
  const main = readFileSync("src/js/main.js", "utf8");
  for (const [ua, want] of Object.entries(cases)) {
    const dom = new JSDOM(html, {
      runScripts: "dangerously", pretendToBeVisual: true,
      url: "https://thauma.one/en/events/",
      beforeParse(w) {
        Object.defineProperty(w.navigator, "userAgent", { value: ua, configurable: true });
        w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      },
    });
    const doc = dom.window.document;
    const tag = doc.createElement("script");
    tag.textContent = main;
    doc.body.appendChild(tag);
    const href = doc.querySelector("a[data-map]").getAttribute("href");
    assert(want.test(href),
      `${ua.slice(0, 28)}… got "${href.slice(0, 40)}", wanted ${want}`);
    /* A native app is not a new tab; target=_blank leaves an empty one behind
       it on iOS. */
    if (!/^https:/.test(href)) {
      assert(!doc.querySelector("a[data-map]").getAttribute("target"),
        "a native scheme kept target=_blank");
    }
  }
});

await check("a typed address is repaired on the way out", async () => {
  /* The fixture says "thauma.one/register" — no scheme. A browser reads that
     as a path and goes nowhere. */
  const href = d.querySelector(".invite-act a").getAttribute("href");
  assert(/^https:\/\//.test(href), `the register link is "${href}"`);
});

/* ------------------------------------------------------ the one moment */

await check("there is ONE interactive moment, and it does not loop", async () => {
  const css = readFileSync("src/css/main.css", "utf8");
  /* THE MOMENT IS THE CARD'S TOP EDGE now — a light drawn along it as the
     card arrives — plus the date rolling in beneath. It used to be a light
     crossing the 1px rule in the middle of the card: that ran, but it crossed
     a divider nobody looks at. Two travelling lights on one card would be
     decoration rather than a moment, so the rule is a plain divider and
     carries no element to light. */
  assert(!d.querySelector(".invite-rule i"),
    "the old travelling light is still in the rule — that is a second moment");
  assert(/@keyframes invite-seam/.test(css), "the seam has no animation");
  const block = css.slice(css.indexOf("@keyframes invite-seam") - 500,
                          css.indexOf("@keyframes invite-seam") + 200);
  assert(!/infinite/.test(block),
    "the moment loops — a loop is decoration, and the brief asked for one moment");
  assert(/prefers-reduced-motion:no-preference/.test(block),
    "it runs regardless of whether somebody asked for less motion");
  /* The edge must still be DRAWN for a reader who asked for less motion —
     animating it from scaleX(0) and stopping there would leave them a card
     with a plainly unfinished border. */
  assert(/prefers-reduced-motion:reduce\)\{\s*\.invite-card::before\{transform:scaleX\(1\)/.test(css),
    "under reduced motion the seam never gets drawn at all");

  /* The date rolls through the SHARED cascade, not a second implementation. */
  const js = readFileSync("src/js/main.js", "utf8");
  assert(/window\.ThaumaRollChars\s*=\s*reveal/.test(js),
    "the character cascade is not lent out; the invitation must be copying it");
  assert(/ThaumaRollChars\(when/.test(js), "the date never rolls");
});

/* --------------------------------------------------------- the record */

await check("past gatherings alternate sides down the page", async () => {
  /* So the record reads as a story being told, not a spreadsheet with
     pictures. */
  const css = readFileSync("src/css/main.css", "utf8");
  assert(d.querySelector(".record-band"), "no record section");
  /* Matched against the file as written, not against a whitespace-stripped
     copy — stripping removed the space between the two selectors and then this
     looked for a pattern containing one, which could never match however
     correct the CSS was. */
  assert(/\.record-band\.is-flipped\s+\.record-photo\s*\{[^}]*order:\s*2/.test(css),
    "nothing swaps the photo's side, so every band reads identically");
});

await check("a gathering with no photograph still holds its shape", async () => {
  /* There will be no photographs at all for a long time, and a record that
     collapses without them is a record nobody can start. */
  assert(d.querySelector(".record-noshot"), "an empty photo slot renders nothing");
});

/* ------------------------------------------------- the wait, and languages */

await check("a Croatian-only gathering is shown to English readers, with a note", async () => {
  const also = d.querySelector(".also");
  assert(also, "nothing lists the other gatherings that are coming");
  assert(/Prva grupa/.test(also.textContent),
    "an item with no English title vanished from the English page");
});

await check("the empty state is a position, not an apology", async () => {
  /* This page may hold nothing for years. "Check back later" would be both
     untrue and a little embarrassed about it. */
  const en = JSON.parse(readFileSync("src/_data/i18n/en.json", "utf8"));
  assert(en.events.empty_text, "there is no empty state text at all");
  assert(!/check back/i.test(en.events.empty_text),
    "the empty state apologizes instead of stating the position");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
