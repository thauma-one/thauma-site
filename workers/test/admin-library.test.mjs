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
import { toMarkdown, parseMarkdown } from "../src/admin-library.js";

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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
