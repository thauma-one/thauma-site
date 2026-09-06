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
import { slugify, toMarkdown, parseTranslations, writeFile } from "../src/admin-profile.js";
import matter from "../../node_modules/gray-matter/index.js";

let pass = 0, fail = 0;
/* AWAITS. It did not, and every async test in this file therefore reported
   PASS the instant it was called: fn() returned a promise, nothing threw, the
   counter went up, and the rejection was swallowed as unhandled. Four tests
   written against a real bug all passed against the bug. */
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
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

/* ===========================================================================
   PUBLISHING A PROFILE FOR THE FIRST TIME

   THE BUG. putFile refuses to write without a SHA unless the caller says
   `create` in so many words — a good guard, because the Contents API reads an
   absent SHA as "create", which on an existing path silently overwrites
   whatever is there. writeFile passed `sha: undefined` for a file that was not
   there and never said `create`, so the FIRST publish of any profile was
   refused. Every time.

   It hid because unpublishing worked — removeFile always has a SHA. So the
   loop was: publish (refused, into a status line nobody was watching),
   unpublish (worked), publish again (refused again). Five of those are in the
   audit log, and the team page was empty the whole time.
   =========================================================================== */

const ENVX = { CONTENT_BRANCH: "main" };
const PROF = { slug: "chase-roush", name: "Chase Roush", is_public: 1 };
const ME = { user_name: "Chase Roush" };
const USER = { email: "chase@thauma.one" };

function io({ get, put = { commit: "abc" } }) {
  const calls = [];
  return {
    calls,
    getFile: async () => get,
    putFile: async (_env, args) => { calls.push(args); return put; },
  };
}

await check("a profile that has never been published is CREATED", async () => {
  const spy = io({ get: { error: "not in repo", status: 404 } });
  const res = await writeFile(ENVX, PROF, {}, USER, ME, spy);
  assert(res.ok, `refused: ${res.error}`);
  assert(spy.calls.length === 1, "nothing was written");
  assert(spy.calls[0].create === true,
    "the write does not say `create`, so putFile refuses it — this is the bug");
  assert(spy.calls[0].sha === undefined, "a SHA was sent for a file that is not there");
});

await check("a profile that already exists is REPLACED, with its SHA", async () => {
  const spy = io({ get: { text: "old", sha: "deadbeef" } });
  const res = await writeFile(ENVX, PROF, {}, USER, ME, spy);
  assert(res.ok, `refused: ${res.error}`);
  assert(spy.calls[0].sha === "deadbeef", "the SHA was not carried through");
  assert(!spy.calls[0].create,
    "`create` on an existing path is an unconditional overwrite — the accident " +
    "the SHA exists to prevent");
});

await check("a 502 is NOT treated as 'the file is missing'", async () => {
  /* THE DANGEROUS HALF OF THE FIX. A bad token, a rate limit, or GitHub being
     down must never become a create — that is the blind overwrite, arriving on
     the day GitHub is flaky. Only a 404 means "not there". */
  const spy = io({ get: { error: "bad credentials", status: 502 } });
  const res = await writeFile(ENVX, PROF, {}, USER, ME, spy);
  assert(!res.ok, "a failed read was treated as an absent file");
  assert(spy.calls.length === 0,
    "it wrote anyway — a transient GitHub error would overwrite the live file");
  assert(/bad credentials/.test(res.error), `the real reason was lost: ${res.error}`);
});

await check("publishing still must not deploy", async () => {
  /* Saving words is not releasing them. quiet:true is what keeps Publish the
     only thing that ships. */
  const spy = io({ get: { error: "nope", status: 404 } });
  await writeFile(ENVX, PROF, {}, USER, ME, spy);
  assert(spy.calls[0].quiet === true,
    "the commit would trigger a deploy — saving a bio would ship the site");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
