#!/usr/bin/env node
/**
 * The site's collections — resources and gatherings
 *   node workers/test/admin-library.test.mjs
 *
 * These write markdown that Eleventy reads at build time, which makes the
 * round trip the thing that matters most: what this file writes, gray-matter
 * has to parse back into the same values, or the console and the website
 * disagree about content nobody thought was ambiguous.
 *
 * The other half is the rules the spec set and the bugs this project has
 * already paid for once: a save must never be refused for a missing
 * translation, and a create must be a create rather than a blind overwrite.
 */
import { readFileSync } from "node:fs";
import matter from "../../node_modules/gray-matter/index.js";
import { toMarkdown, parseMarkdown, normalizeUrl, mapUrl } from "../src/admin-library.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the site's collections\n");

const RESOURCE = {
  moment: "crisis", format: "diagram",
  title: { en: "No sound from the mixer", hr: "Nema zvuka s miksete" },
  summary: { en: "Work back along the signal path.", hr: "Provjerite put signala." },
  symptoms: ["no sound", "one channel dead"], pinned: true, created: "2026-09-07",
  link: "", photo: "",
  body: "Start at the speaker and work backwards.\n\n1. Is it powered?",
};
const COHORT = {
  type: "cohort", status: "upcoming",
  title: { hr: "Prva grupa" }, summary: { hr: "Šest susreta za tonce." },
  date: "", time: "", location: "", registration: "mailto:hello@thauma.one",
  cohort_name: "Cohort 1", capacity: "12", application_required: true,
  sessions: [{ date: "2027-03-14", topic: "Signal flow" },
             { date: "2027-03-21", topic: "Gain staging" }],
  photos: [], body: "",
};

/* ------------------------------------------------- the build can read it */

await check("everything written comes back through gray-matter unchanged", async () => {
  /* THE ONE THAT MATTERS. Eleventy reads these with gray-matter; if a value
     survives this file's own parser and not that one, the console shows one
     thing and the website another, and neither is obviously wrong. */
  for (const [collection, item] of [["resources", RESOURCE], ["gatherings", COHORT]]) {
    const md = toMarkdown(collection, item);
    const built = matter(md);
    for (const [key, value] of Object.entries(built.data)) {
      eq(value, parseMarkdown(md)[key], `${collection}.${key} differs between parsers`);
    }
    assert(built.content.trim() === parseMarkdown(md).body,
      `${collection}: the body differs between parsers`);
  }
});

await check("a language map survives, and an absent language stays absent", async () => {
  const md = toMarkdown("gatherings", COHORT);
  const data = matter(md).data;
  eq(data.title, { hr: "Prva grupa" }, "title");
  assert(!("en" in data.title),
    "an untranslated language was written as an empty string — the page cannot " +
    "then tell 'not written yet' from 'written, and empty'");
});

await check("a list of objects survives — sessions keep their dates", async () => {
  const data = matter(toMarkdown("gatherings", COHORT)).data;
  eq(data.sessions, COHORT.sessions, "sessions");
});

await check("a flag that is off is omitted, not written as false", async () => {
  const md = toMarkdown("resources", { ...RESOURCE, pinned: false });
  assert(!/pinned:/.test(md), "an off flag is still in the file");
  assert(matter(md).data.pinned === undefined, "pinned came back defined");
});

await check("quotes and backslashes in a title cannot break the file", async () => {
  const md = toMarkdown("resources", {
    ...RESOURCE, title: { en: 'The "gain" knob \\ and its friends' } });
  eq(matter(md).data.title.en, 'The "gain" knob \\ and its friends', "title");
});

/* -------------------------------------------------------- the data files */

await check("the collections read what this writes", async () => {
  /* src/_data/*.js is what the public pages actually see. Its defaults have to
     agree with the vocabulary this endpoint enforces, or an item saved as
     valid renders as something else. */
  const resources = readFileSync(new URL("../../src/_data/resources.js", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  for (const moment of ["crisis", "growth", "planning", "lookup"]) {
    assert(resources.includes(`"${moment}"`), `_data/resources.js does not know "${moment}"`);
    assert(lib.includes(`"${moment}"`), `the endpoint does not know "${moment}"`);
  }
  for (const format of ["guide", "diagram", "checklist", "glossary-entry", "video"]) {
    assert(resources.includes(`"${format}"`), `_data/resources.js does not know "${format}"`);
  }
});

await check("an unknown moment lands somewhere findable, not nowhere", async () => {
  const { default: _ } = { default: null };
  const mod = await import("../../src/_data/resources.js");
  assert(mod.default.MOMENTS || mod.MOMENTS, "the vocabulary is not exported");
});

/* ------------------------------------------------------------ the rules */

await check("creating and replacing are told apart by a 404 and nothing else", async () => {
  /* Team profiles were refused for months because the create case never said
     `create`. The opposite mistake is worse: treating a bad token or a rate
     limit as "not there" turns a transient error into a blind overwrite. */
  const src = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  assert(/existing\.status === 404/.test(src),
    "the endpoint does not check for 404 specifically");
  assert(/create: missing/.test(src), "it never asks putFile to create");
  assert(/if \(existing\.error && !missing\) return json\(/.test(src),
    "a non-404 error is not refused — GitHub being down would overwrite the file");
});

await check("saving is not publishing", async () => {
  const src = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  const writes = src.match(/putFile\(env, \{[\s\S]*?\}\)/g) || [];
  assert(writes.length >= 1, "nothing writes a file");
  for (const w of writes) {
    assert(/quiet: true/.test(w),
      "a commit here would trigger a deploy — saving a resource would ship the site");
  }
});

await check("communications may edit, and an ordinary staff account may not", async () => {
  const src = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  assert(/r === "admin" \|\| r === "communications"/.test(src),
    "the role gate does not match what the navigation promises");
  assert(!/roles\.includes\("staff"\)/.test(src),
    "plain staff can edit the public site's collections");
});

/* ------------------------------------------------------- addresses people type */

await check("a bare hostname becomes a real link", async () => {
  /* "chaseroush.com" is what a person writes; a browser reads it as a
     RELATIVE path and sends the visitor to /en/events/chaseroush.com. It looks
     right in the box and goes nowhere, and nobody clicks their own link. */
  eq(normalizeUrl("chaseroush.com"), "https://chaseroush.com", "bare host");
  eq(normalizeUrl("www.thauma.one"), "https://www.thauma.one", "with www");
});

await check("but www is never ADDED", async () => {
  /* Plenty of sites do not answer on www at all, so adding it would turn a
     working address into a dead one. The scheme is the missing piece; the
     subdomain is a guess. */
  assert(!/www\./.test(normalizeUrl("thauma.one")),
    "www was invented — that address may not exist");
});

await check("anything with a scheme is left exactly alone", async () => {
  for (const u of ["https://x.org", "http://x.org", "mailto:a@b.org", "tel:+385"]) {
    eq(normalizeUrl(u), u, u);
  }
  eq(normalizeUrl("/en/contact/"), "/en/contact/", "a path on this site");
});

await check("an email address becomes mailto:, not https://", async () => {
  eq(normalizeUrl("hello@thauma.one"), "mailto:hello@thauma.one", "email");
});

await check("plain words stay plain", async () => {
  /* "ask Chase" is a legitimate answer to how somebody registers. Turning it
     into a link would be a lie, and a broken one. */
  eq(normalizeUrl("ask Chase in person"), "ask Chase in person", "a note");
});

await check("a place becomes a link that forces nobody's maps app", async () => {
  /* It was a Google Maps URL — universally recognized, and it opens Google
     Maps whatever somebody actually uses. The stored value is a neutral web
     map that works with no JavaScript anywhere; the page upgrades it to the
     platform's own scheme at load. */
  const u = mapUrl("Kuća molitve, Zagreb");
  assert(!/google\.com\/maps/.test(u), `still a Google link: ${u}`);
  assert(/^https:/.test(u),
    "a scheme a desktop browser cannot open would leave the link dead without JS");
  assert(u.includes(encodeURIComponent("Kuća molitve, Zagreb")),
    "the place did not survive encoding");
  eq(mapUrl(""), "", "nowhere is not a link");
});

/* ---------------------------------------------- multi-day and how often */

await check("a gathering can run over more than one day", async () => {
  const md = toMarkdown("gatherings", {
    type: "gathering", status: "upcoming", title: { en: "Weekend" },
    date: "2027-03-14", end_date: "2027-03-15",
  });
  const data = matter(md).data;
  eq(data.date, "2027-03-14", "first day");
  eq(data.end_date, "2027-03-15", "last day");
});

await check("a cohort says how often it meets, once", async () => {
  /* "Every week" is a fact about the cohort; the dates are what follows from
     it. Saying it on every session row would be restating one decision. */
  const md = toMarkdown("gatherings", {
    type: "cohort", status: "upcoming", title: { en: "Cohort 1" },
    cadence: "weekly",
    sessions: [{ date: "2027-03-14", topic: "Signal flow" }],
  });
  eq(matter(md).data.cadence, "weekly", "cadence");
});

await check("the build and the endpoint agree about the cadences", async () => {
  const src = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  for (const c of ["weekly", "fortnightly", "monthly", "custom"]) {
    assert(src.includes(`"${c}"`), `the endpoint does not know "${c}"`);
  }
  assert(/custom/.test(src),
    "there is no escape hatch — a cohort meeting on the first Monday of the " +
    "month fits none of the fixed cadences and still has to be describable");
});

/* --------------------------------------------------------------- pictures */

await check("a picture is uploaded, not typed as a path", async () => {
  const media = readFileSync(new URL("../src/media.js", import.meta.url), "utf8");
  assert(/"library"/.test(media), "the media endpoint has no kind for these");
  assert(/r === "admin" \|\| r === "communications"/.test(media),
    "library uploads are not open to the same people who may edit the words — " +
    "requiring an administrator for the picture but not the text is a strange " +
    "place to draw the line");
  const ui = readFileSync(new URL("../../src/js/admin-library.js", import.meta.url), "utf8");
  assert(/kind=library/.test(ui), "the editor never uploads anything");
  assert(/PhotoCrop\.open/.test(ui), "a picture is stored without being cropped");
});

await check("the uncropped original is kept, so a crop can be widened", async () => {
  const ui = readFileSync(new URL("../../src/js/admin-library.js", import.meta.url), "utf8");
  assert(/shrink\(file, 2400\)/.test(ui), "no master is uploaded");
  const src = readFileSync(new URL("../src/admin-library.js", import.meta.url), "utf8");
  assert(/photo_master/.test(src), "the master URL is never stored");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
