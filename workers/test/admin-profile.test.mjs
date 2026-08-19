#!/usr/bin/env node
/**
 * The markdown a profile becomes
 *   node workers/test/admin-profile.test.mjs
 *
 * This file is generated from text a person typed and is then parsed by
 * gray-matter at build time. A bio containing a quotation mark, a colon or a
 * leading dash is ordinary writing and must not be able to break the build —
 * which is exactly what an unquoted YAML scalar would do.
 */
import { slugify, toMarkdown, parseTranslations } from "../src/admin-profile.js";
import matter from "../../node_modules/gray-matter/index.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

check("a name becomes a usable web address", () => {
  eq(slugify("Chase Roush"), "chase-roush", "plain");
  eq(slugify("  Mixed   Spacing "), "mixed-spacing", "collapses runs");
});

/* Dropping the accent rather than the LETTER. An early version stripped
   anything non-ASCII, which turned Petrović into petrovi. */
check("accented names fold rather than lose letters", () => {
  eq(slugify("Mira Petrović"), "mira-petrovic", "ć");
  eq(slugify("Đorđe Šimić"), "dorde-simic", "đ and š");
});

check("a name with nothing usable in it returns null, not an empty address", () => {
  eq(slugify("!!!"), null, "punctuation only");
  eq(slugify(""), null, "empty");
});

const P = {
  user_id: "u_1", name: "Chase Roush", slug: "chase-roush",
  sort_order: 1, photo: "/img/team/u_1.webp", bio_photo: null,
  region: "Kansas City, USA → Croatia", public_email: "chase@thauma.one",
};

check("the frontmatter parses, and carries what the team page reads", () => {
  const md = toMarkdown(P, { en: { role_title: "Founder", bio: "Five years." } });
  const { data } = matter(md);
  eq(data.name, "Chase Roush", "name");
  eq(data.order, 1, "order stays a number, not a string");
  eq(data.base, "Kansas City, USA → Croatia", "region survives the arrow");
  eq(data.email, "chase@thauma.one", "email");
  eq(data.role.en, "Founder", "role");
  eq(data.bio.en, "Five years.", "bio");
  eq(data.user_id, "u_1", "the link back to the account");
});

/* Each of these breaks an unquoted YAML scalar in a different way. */
check("punctuation that would break YAML is survivable", () => {
  const nasty = {
    quotes: 'He said "faders after" and meant it',
    colon: "Role: production, not performance",
    hash: "Serving #1 priority",
    dash: "- not a list item",
    backslash: 'A path C:\\Users\\ and a "quote"',
  };
  for (const [label, bio] of Object.entries(nasty)) {
    const { data } = matter(toMarkdown(P, { en: { bio } }));
    eq(data.bio.en, bio, label);
  }
});

check("Croatian and Serbian survive unchanged", () => {
  const hr = "Najprije jezik, najprije kultura, faderi poslije.";
  const sr = "Прво језик, прво култура, фејдери после.";
  const { data } = matter(toMarkdown(P, { hr: { bio: hr }, sr: { bio: sr } }));
  eq(data.bio.hr, hr, "hr");
  eq(data.bio.sr, sr, "sr");
});

/* An empty language must not appear at all — a key with an empty string reads
   on the team page as a translation that exists and says nothing. */
check("a language with nothing in it is left out entirely", () => {
  const { data } = matter(toMarkdown(P, {
    en: { role_title: "Founder", bio: "Something." },
    hr: { role_title: null, bio: null },
  }));
  eq(Object.keys(data.bio), ["en"], "bio languages");
  eq(Object.keys(data.role), ["en"], "role languages");
});

check("optional fields are omitted rather than written empty", () => {
  const { data } = matter(toMarkdown(
    { ...P, photo: null, bio_photo: null, region: null, public_email: null },
    { en: { bio: "x" } }));
  assert(!("photo" in data), "photo should be absent");
  assert(!("base" in data), "base should be absent");
  assert(!("email" in data), "email should be absent");
});

check("the packed translation string unpacks to what went in", () => {
  const packed = ["en\u001fFounder\u001fFive years.", "hr\u001fOsnivač\u001fPet godina."]
    .join("\u001e");
  eq(parseTranslations(packed), {
    en: { role_title: "Founder", bio: "Five years." },
    hr: { role_title: "Osnivač", bio: "Pet godina." },
  }, "round trip");
  eq(parseTranslations(null), {}, "nobody translated anything");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
