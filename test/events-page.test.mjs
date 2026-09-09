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
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { buildDevSite } from "./lib/dev-build.mjs";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the Events page\n");

/* BUILT FROM FIXTURES, into a throwaway directory. Reading whatever happens to
   be in src/content/gatherings would make this test pass or fail on somebody's
   half-written draft. */
const DIR = "src/content/gatherings";
mkdirSync(DIR, { recursive: true });
const written = [];
const put = (name, body) => { const p = `${DIR}/${name}.md`; writeFileSync(p, body); written.push(p); };

put("zz-test-next", `---
type: "gathering"
status: "upcoming"
title:
  en: "Production people, in one room"
summary:
  en: "Two days of hands on desks."
date: "2027-03-14"
end_date: "2027-03-15"
time: "10:00"
location: "Kuća molitve, Zagreb"
registration: "thauma.one/register"
---
`);
put("zz-test-later", `---
type: "cohort"
status: "upcoming"
title:
  hr: "Prva grupa"
cadence: "weekly"
date: "2027-06-01"
---
`);
put("zz-test-past", `---
type: "gathering"
status: "past"
title:
  en: "First visit to Osijek"
summary:
  en: "Three services and a failing desk."
date: "2026-05-29"
location: "Osijek"
---
`);

/* THE UNGATED BUILD. A plain `eleventy` run uses the live column, where
   comingSoon is true, and produces twenty files with no interior pages in them
   at all — so this would have passed on a machine with a dev server running
   and failed in CI, which is the worst way for a test to be wrong. */
let html;
const built = await buildDevSite("/tmp/events-test", "en/events/index.html");
written.forEach((p) => { try { unlinkSync(p); } catch {} });
if (!built.ok) {
  console.log("  FAIL  could not build the site:", built.error);
  process.exit(1);
}
html = readFileSync("/tmp/events-test/en/events/index.html", "utf8");
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
  assert(at("invite-title") > at("invite-cue"), "the name comes before the announcement");
  assert(at("invite-facts") > at("invite-title"), "the date is stated before what it is for");
  assert(at("invite-act") === order.length - 1,
    `the action is not last: ${order.join(" > ")}`);
});

await check("the RSVP is a link, never the loudest thing on the page", async () => {
  /* An invitation does not shout its RSVP. A filled button here would make the
     page about registering rather than about the gathering. */
  const act = d.querySelector(".invite-act a");
  assert(act, "no way to register");
  assert(!/\bbtn\b/.test(act.className),
    "the action is styled as a button — the card is supposed to be the star");
});

await check("the date reads like a date, not like a database value", async () => {
  const when = d.querySelector(".invite-facts dd").textContent;
  assert(/14–15 March 2027/.test(when), `it says "${when.trim()}"`);
  assert(!/2027-03-14/.test(when), "an ISO date reached the page");
});

await check("the place opens the reader's own map", async () => {
  const a = [...d.querySelectorAll(".invite-facts a")]
    .find((x) => /maps/.test(x.getAttribute("href") || ""));
  assert(a, "the location is not a link");
  assert(/Zagreb/.test(decodeURIComponent(a.getAttribute("href"))), "the place did not survive");
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
  assert(d.querySelector(".invite-rule i"), "the moment's element is missing");
  const block = css.slice(css.indexOf("@keyframes invite-pass") - 400,
                          css.indexOf("@keyframes invite-pass") + 200);
  assert(!/infinite/.test(block),
    "the moment loops — a loop is decoration, and the brief asked for one moment");
  assert(/prefers-reduced-motion:no-preference/.test(block),
    "it runs regardless of whether somebody asked for less motion");
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
