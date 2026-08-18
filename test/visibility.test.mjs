#!/usr/bin/env node
/**
 * Tests for the page/section visibility switches
 *   node test/visibility.test.mjs
 *
 * These decide WHAT GETS BUILT, so their failure mode is a page that is either
 * public when it should not be, or missing when it should not be. Neither is
 * visible in the console output of a successful build — the build succeeds
 * either way. That is why they are tested rather than eyeballed.
 *
 * The require-cache test at the bottom is a regression test for a bug that
 * shipped silently: flipping a switch rebuilt the whole site and changed
 * nothing, because the data files read site.json with `require`, which caches.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SITE = fileURLToPath(new URL("../src/_data/site.json", import.meta.url));
const ORIGINAL = readFileSync(SITE, "utf8");

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/**
 * Load the data files fresh, under a chosen run mode.
 *
 * The modules are re-required each time with their cache cleared, because the
 * `isDevServer` constant is evaluated once at module load — which is fine in a
 * real build (one process, one mode) and would silently break these tests.
 */
function load(mode) {
  process.env.ELEVENTY_RUN_MODE = mode;
  delete require.cache[require.resolve("../src/_data/visible.js")];
  delete require.cache[require.resolve("../src/_data/navPages.js")];
  delete require.cache[require.resolve("../src/_data/activeLangs.js")];
  return {
    visible: require("../src/_data/visible.js")(),
    navPages: require("../src/_data/navPages.js")(),
    activeLangs: require("../src/_data/activeLangs.js")(),
  };
}

const writeSite = (obj) => writeFileSync(SITE, JSON.stringify(obj, null, 2) + "\n");
const readSite = () => JSON.parse(readFileSync(SITE, "utf8"));

console.log("visibility — which pages get built\n");

try {

/* --------------------------- the two columns --------------------------- */

check("a real build uses the LIVE column", () => {
  const { visible } = load("build");
  eq(visible.column, "live", "column");
  const site = readSite();
  eq(visible.comingSoon, site.visibility.comingSoon.live, "comingSoon");
  eq(visible.pages.events, site.visibility.pages.events.live, "events");
});

check("the watch server uses the DEV column", () => {
  for (const mode of ["watch", "serve"]) {
    const { visible } = load(mode);
    eq(visible.column, "dev", `column under ${mode}`);
  }
});

check("the two columns are genuinely independent", () => {
  // The whole point. If these ever resolve the same way regardless of column,
  // the dev site has stopped being able to simulate the live one.
  const site = readSite();
  site.visibility.pages.about = { live: false, dev: true };
  site.visibility.pages.mission = { live: true, dev: false };
  writeSite(site);

  const live = load("build").visible;
  const dev = load("watch").visible;

  eq(live.pages.about, false, "about is off for visitors");
  eq(dev.pages.about, true, "and still visible while working on it");
  eq(live.pages.mission, true, "mission is on for visitors");
  eq(dev.pages.mission, false, "and simulated as off on dev");
});

check("SWITCHES ARE RE-READ, not cached from the first build", () => {
  /* THE REGRESSION TEST. `require` caches JSON by path, so a switch read that
     way is frozen for the life of the process — and `eleventy --watch` never
     restarts. Measured on 2026-08-16: flipping a toggle rebuilt every page and
     changed nothing at all. A build succeeding is not evidence it read the
     file. */
  const site = readSite();
  site.visibility.pages.give = { live: true, dev: true };
  writeSite(site);
  const before = require("../src/_data/visible.js")();
  eq(before.pages.give, true, "starting state");

  // Change the file WITHOUT clearing any cache — exactly what happens when
  // somebody saves site.json while the watch server is running.
  site.visibility.pages.give = { live: false, dev: false };
  writeSite(site);
  const after = require("../src/_data/visible.js")();
  eq(after.pages.give, false, "the switch was not re-read — require() is caching again");
});

/* ---------------------------- what cannot be off ----------------------- */

check("A MISSING visibility block means GATED, not open", () => {
  /* The pairing you get mid-migration: this code, and a site.json from before
     the visibility block existed. Content lives on the live branch and code
     arrives from the working branch, so the two genuinely can be out of step.

     Measured 2026-08-16 with the real file from `main`: comingSoon resolved to
     FALSE and the entire unreleased site would have been built and published.
     An unreleased site that has been crawled cannot be un-published. */
  writeSite({ name: "Thauma", languages: ["en"], defaultLang: "en" });
  for (const mode of ["build", "watch"]) {
    const { visible } = load(mode);
    eq(visible.comingSoon, true, `${mode}: an unknown gate must mean GATED`);
  }

  // Present but empty, which is the other way to say nothing.
  writeSite({ name: "Thauma", languages: ["en"], visibility: {} });
  eq(load("build").visible.comingSoon, true, "an empty block must mean GATED");

  // Present but only half-filled: no `live` value at all.
  writeSite({ name: "Thauma", languages: ["en"], visibility: { comingSoon: { dev: false } } });
  eq(load("build").visible.comingSoon, true, "a missing live value must mean GATED");
});

check("a page listed but not decided stays VISIBLE", () => {
  // The opposite default, deliberately: forgetting to fill one in must not
  // silently delete a page from the site.
  writeSite({ name: "Thauma", languages: ["en"],
              visibility: { comingSoon: { live: false, dev: false },
                            pages: { about: {} } } });
  eq(load("build").visible.pages.about, true, "an undecided page should show");
});

check("a section listed but not decided stays HIDDEN", () => {
  // And this way round for sections: they gate content being prepared, and a
  // half-finished library appearing because nobody chose is the wrong way to
  // be wrong.
  writeSite({ name: "Thauma", languages: ["en"],
              visibility: { comingSoon: { live: false, dev: false },
                            sections: { resourcesLibrary: {} } } });
  eq(load("build").visible.sections.resourcesLibrary, false, "an undecided section should hide");

  /* The three checks above replace site.json wholesale rather than editing it,
     which is the point — they are about a file that does NOT have the block.
     Put the real one back, or every test after this one is reading a stub. */
  writeFileSync(SITE, ORIGINAL);
});

/* ------------------------------ languages ------------------------------ */

check("a language switched off is not built at all", () => {
  /* Not hidden — absent. An unlinked page is still reachable, still crawlable
     and still in the sitemap; a page that was never built is a 404. Every page
     template paginates over activeLangs for exactly this reason. */
  /* Switch off EVERY language except Croatian, derived from the file rather
     than named here. An earlier version listed hr and sr literally, and when
     Slovenian was added to the site it fell through the "no switch means on"
     rule and appeared in a list this test asserted did not contain it. The
     test was wrong, not the rule — but it went stale silently, which is the
     part worth fixing. */
  const site = readSite();
  site.visibility.languages = Object.fromEntries(
    site.languages.filter((c) => c !== "en").map((c) => [
      c, c === "hr" ? { live: true, dev: true } : { live: false, dev: true },
    ]));
  writeSite(site);

  const others = site.languages.filter((c) => c !== "en" && c !== "hr");
  eq(load("build").activeLangs, ["en", "hr"],
     `live: ${others.join(", ")} must not be built`);
  eq(load("watch").activeLangs, ["en", "hr", ...others],
     "dev: they must still be there to translate in");
});

check("ENGLISH CANNOT BE SWITCHED OFF", () => {
  /* It is the fallback every missing translation resolves to. A site with no
     fallback has nothing to serve when a string is absent — not an empty
     string, nothing. */
  /* ⚠ ANOTHER LANGUAGE STAYS ON, and that is the whole point of the setup.

     The first version of this test switched everything off, and it passed with
     the English rule DELETED — because the empty-list guard at the end of
     activeLangs.js returned ["en"] anyway. It was testing the wrong mechanism
     and would have gone on passing through the exact regression it names.

     Leaving Croatian on means the list is non-empty, so the guard never fires
     and only the English rule can keep English in it. */
  const site = readSite();
  site.visibility.languages = Object.fromEntries(
    site.languages.map((c) => [
      c, c === "hr" ? { live: true, dev: true } : { live: false, dev: false },
    ]));
  writeSite(site);
  eq(load("build").activeLangs, ["en", "hr"], "English must survive being switched off");
});

check("switching everything off still builds one language", () => {
  // A site that builds zero pages is not a site. Belt and braces on the rule
  // above, in case `languages` itself is emptied.
  writeSite({ name: "Thauma", languages: [], visibility: {} });
  eq(load("build").activeLangs, ["en"], "must never return an empty list");
  writeFileSync(SITE, ORIGINAL);
});

check("a language with no switch is still built", () => {
  /* Somebody adds a file by hand and forgets the switch. Dropping it silently
     would delete a third of the site with no error anywhere — the opposite
     default from `comingSoon`, and for the opposite reason: here the damage is
     losing something that exists, not exposing something that should not. */
  const site = readSite();
  site.languages = ["en", "hr", "sr", "sl"];
  site.visibility.languages = { hr: { live: true, dev: true } };
  writeSite(site);
  const langs = load("build").activeLangs;
  assert(langs.includes("sl"), "an unswitched language vanished");
  assert(langs.includes("sr"), "an unswitched language vanished");
  writeFileSync(SITE, ORIGINAL);
});

check("every per-language setting has a slot for every language", () => {
  /* site.json holds objects keyed by language code — `donorbox` today. Adding
     a language has to give each of them a slot, and it did not: a new language
     was registered with no donation form, so its Give page quietly showed the
     "coming soon" placeholder and no setting existed anywhere to explain why.

     This finds those objects by shape rather than by name, so a second one
     added later is covered without anybody remembering this happened. */
  writeFileSync(SITE, ORIGINAL);
  const site = readSite();
  const langs = site.languages;

  const perLanguage = Object.entries(site).filter(([key, v]) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    if (key === "visibility") return false;          // its own shape, checked elsewhere
    const keys = Object.keys(v);
    // Looks per-language if it is keyed ONLY by codes the site has.
    return keys.length > 0 && keys.every((k) => langs.includes(k));
  });

  assert(perLanguage.length > 0,
         "found no per-language settings — donorbox should be one, so this check is broken");

  const gaps = [];
  for (const [key, obj] of perLanguage) {
    for (const code of langs) {
      if (obj[code] === undefined) gaps.push(`${key}.${code}`);
    }
  }
  eq(gaps, [], "these languages have no slot in a per-language setting");
});

check("the language list and the switches agree about what exists", () => {
  // A switch for a language with no file builds pages with no strings in them.
  writeFileSync(SITE, ORIGINAL);
  const site = readSite();
  const { readdirSync } = require("node:fs");
  const dir = fileURLToPath(new URL("../src/_data/i18n/", import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, "")).sort();

  eq([...site.languages].sort(), files,
     "site.json's language list does not match the files in src/_data/i18n");

  for (const code of Object.keys(site.visibility.languages || {})) {
    assert(files.includes(code),
           `there is a switch for "${code}" but no src/_data/i18n/${code}.json`);
  }
});

check("the home page cannot be switched off", () => {
  // A site whose home page can be turned off is not a site.
  const { visible } = load("build");
  eq(visible.page(""), true, "home");
  eq(visible.page(undefined), true, "no slug");
});

check("a page with no switch defaults to visible", () => {
  // Adding a page and forgetting to give it a switch must not make it vanish.
  const { visible } = load("build");
  eq(visible.page("some-new-page"), true, "unknown slug");
});

check("a hand-edited plain boolean still works", () => {
  const site = readSite();
  site.visibility.pages.contact = true;
  site.visibility.comingSoon = false;
  writeSite(site);
  const { visible } = load("build");
  eq(visible.pages.contact, true, "boolean true");
  eq(visible.comingSoon, false, "boolean false");
});

/* ----------------------- the nav agrees with the build ----------------- */

check("the mobile page strip lists exactly the pages that are built", () => {
  // A number in the strip for a page that was not built is a link to a 404.
  writeFileSync(SITE, ORIGINAL);
  for (const mode of ["build", "watch"]) {
    const { visible, navPages } = load(mode);
    for (const slug of Object.keys(visible.pages)) {
      eq(navPages.includes(slug), visible.pages[slug],
         `${mode}: ${slug} — strip and build disagree`);
    }
  }
});

/* -------------------------- against the real site ---------------------- */

check("every page in the site has a switch", () => {
  /* Catches the thing nobody remembers: adding a page and never giving it a
     toggle, so it silently cannot be turned off. Home, 404 and the landing
     page are exempt by design and named here so the exemption is deliberate. */
  writeFileSync(SITE, ORIGINAL);
  const EXEMPT = new Set(["", "404", "coming-soon"]);
  const site = readSite();
  const switched = new Set(Object.keys(site.visibility.pages));

  const dir = fileURLToPath(new URL("../src", import.meta.url));
  const files = require("node:fs").readdirSync(dir).filter((f) => f.endsWith(".njk"));
  const missing = [];
  for (const f of files) {
    const src = readFileSync(`${dir}/${f}`, "utf8");
    const m = /^pageSlug:\s*"([^"]*)"/m.exec(src);
    if (!m) continue;
    if (EXEMPT.has(m[1])) continue;
    if (!switched.has(m[1])) missing.push(`${f} (pageSlug "${m[1]}")`);
  }
  eq(missing, [], "pages with no switch in site.json");
});

check("no placeholder reaches the screen unfilled", () => {
  /* A dialog title read literally "Add {file} and bring this in?" — the body
     below it had the .replace chain and the title did not, and forgetting one
     looks like nothing when the placeholders and their values live in
     different places.

     The rule this checks: a string containing {something} must be reached
     through fill(), which takes every value at once, or through an explicit
     .replace. A bare tr() on such a key is the bug. */
  const root = fileURLToPath(new URL("../src/js/", import.meta.url));
  const i18n = readFileSync(root + "staff-i18n.js", "utf8");

  const start = i18n.search(/\n    en: \{/);
  const end = i18n.indexOf("\n    },", start);
  const en = {};
  for (const m of i18n.slice(start, end)
        .matchAll(/['"]([a-zA-Z][\w.]*)['"]\s*:\s*['"]((?:[^'"\\]|\\.)*)['"]/g)) {
    en[m[1]] = m[2];
  }
  const placeholders = Object.entries(en).filter(([, v]) => /\{[a-z]+\}/i.test(v));
  assert(placeholders.length > 20,
         `only found ${placeholders.length} keys with placeholders — the parse is broken`);

  const { readdirSync } = require("node:fs");
  const offenders = [];
  let scanned = 0;
  for (const f of readdirSync(root).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(root + f, "utf8");
    // tr('key') NOT followed by .replace — fine unless the key has a placeholder.
    /* [\w.] and not [a-z.] — every key here is camelCase. The first version
       used a lowercase-only class, matched NOTHING, and reported success while
       the bug it was written for sat in the file three lines away. The floor
       below exists because of that: a regex check that stops matching looks
       exactly like a passing one. */
    for (const m of src.matchAll(/tr\('([\w.]+)'\)(?!\s*\.replace)/g)) {
      scanned++;
      if (en[m[1]] && /\{[a-z]+\}/i.test(en[m[1]])) {
        offenders.push(`${f}: tr('${m[1]}') — "${en[m[1]].slice(0, 45)}"`);
      }
    }
  }
  /* A FLOOR, because the first version of this scan matched nothing and
     reported success. A regex-driven check that silently stops matching is
     indistinguishable from a passing one. */
  assert(scanned > 100, `only saw ${scanned} tr() calls — the scan regex is broken again`);
  eq(offenders, [], "use fill(key, {…}) — these would print a placeholder on screen");
});

check("the hidden attribute always wins", () => {
  /* `hidden` is display:none from the browser's stylesheet, and ANY rule
     setting `display` overrides it. So an element marked hidden stays visible,
     silently, and only in the states nobody looks at twice.

     It shipped: the type-to-confirm box appeared in EVERY confirmation dialog
     from the day the partner-delete flow was built, because `.dlg-type` sets
     display:block and nothing said otherwise. Chase found it weeks later. Four
     more elements had the same problem — the page roots that are hidden until
     their data loads, and the reference picker.

     SPEC §8a already warned about this. Knowing about a trap is not protection
     from it; the global rule is. */
  const css = readFileSync(fileURLToPath(new URL("../src/css/staff.css", import.meta.url)), "utf8");
  const rule = /\.is-staff \[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/;
  assert(rule.test(css),
    "the global [hidden] rule is gone — every element that sets display can " +
    "now ignore the hidden attribute, and will, silently");
});

check("nothing in the SAVE flow claims to publish", () => {
  /* THE THIRD TIME. When Save/Preview/Publish shipped, saving stopped
     publishing — and the copy did not follow:

       · the note on both pages said "there is no separate publish step"
       · the button said "Save & publish" for three weeks after that
       · the toast said "the deploy is running" when no deploy runs
       · two source comments still said a commit is a deploy

     Each was found by Chase using the page, which is the expensive way. Copy
     describing old behaviour is worse than no copy: somebody reads it and
     believes it.

     So: every string the save flow reaches, and the markup fallbacks that
     show before translation runs, are checked for the words that would only
     be true under the old model. */
  const root = fileURLToPath(new URL("../src/", import.meta.url));

  const i18n = readFileSync(root + "js/staff-i18n.js", "utf8");
  const SAVE_KEYS = ["con.save", "con.saveTitle", "con.saveBody", "con.saveSiteBody",
                     "con.saveNote", "con.saved", "con.saveBarNote", "con.saveBarNoteSite"];
  /* SPECIFIC FALSE CLAIMS, not the word "publish".

     The first version of this banned the word outright and flagged three
     CORRECT strings — "Nothing is live yet", "it does not go live until you
     publish" — because a regex cannot see a negation. Detecting a lie in
     general is not something this test can do.

     What it CAN do is refuse the exact claims that have actually shipped.
     Each of these was live in the product and wrong:  */
  const LIES = [
    [/no separate publish/i,        'said publishing was not a separate step'],
    [/save\s*(&(amp;)?|and)\s*publish/i, 'said saving publishes'],
    [/the deploy/i,                 'mentioned a deploy — saving starts none'],
    [/deploy (is |will )?run/i,     'said a deploy runs'],
    [/live (in )?a minute/i,        'said it goes live shortly'],
  ];
  const lies = (text) => LIES.filter(([re]) => re.test(text)).map(([, why]) => why);

  const offenders = [];
  for (const key of SAVE_KEYS) {
    // Every language's copy of the key, not just English.
    const re = new RegExp(`"${key.replace(".", "\\.")}":\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    let m, seen = 0;
    while ((m = re.exec(i18n))) {
      seen++;
      /* "Use Publish when you want this to go live" is the one correct use of
         the word: it points AT the other action rather than claiming to be it.
         Capitalised, because it names the button. */
      const found = lies(m[1]);
      if (found.length) offenders.push(`${key} ${found[0]}: "${m[1].slice(0, 60)}"`);
    }
    assert(seen >= 3, `${key} is missing from at least one language (found ${seen})`);
  }

  /* The markup fallback is real copy: it is what shows before the translation
     sweep runs, and what shows for good if a key ever goes missing. The button
     said "Save & publish" in the HTML long after the key was corrected. */
  for (const f of ["adminarea/content.njk", "adminarea/site.njk"]) {
    const src = readFileSync(root + f, "utf8");
    for (const m of src.matchAll(/data-i18n="(con\.save[A-Za-z]*)">([^<]*)</g)) {
      const found = lies(m[2]);
      if (found.length) offenders.push(`${f} fallback for ${m[1]} ${found[0]}: "${m[2]}"`);
    }
  }

  eq(offenders, [], "saving does not publish — this copy says it does");

  /* And the source comments, which is where two of them survived longest.
     A comment nobody has to look at is a comment nobody corrects. */
  for (const f of ["js/admin-content.js", "js/admin-site.js",
                   "adminarea/content.njk", "adminarea/site.njk"]) {
    const src = readFileSync(root + f, "utf8");
    /* Only lines that ASSERT it, not lines RECORDING that it used to be said.

       The first version excluded "used to say" and then failed on a comment
       beginning "This header used to end ..." — a test tripping over the prose
       that documents the fix it is checking. That has now happened twice in
       this repo (see the seed-file test in db/test_schema.py), so the
       exclusion is deliberately broad: any line that is clearly talking about
       the past is not making a claim about the present. */
    for (const line of src.split("\n")) {
      if (/used to|no longer|stopped being|was true when|previously|since corrected/i.test(line)) continue;
      if (/a commit is a deploy|commit, and a commit is a deploy/i.test(line)) {
        offenders.push(`${f}: a comment still says a commit is a deploy`);
      }
    }
  }
  eq(offenders, [], "a source comment still describes the old model");
});

check("secrets cannot be committed", () => {
  /* .dev.vars holds the GitHub App private key on a development machine — a
     credential that can commit to this repository and deploy the live site.

     It was NOT gitignored, and was about to be created. A key in git history
     is permanent: deleting the file later does not remove it from the objects,
     and any clone taken in between still has it. Rotating is the only remedy.

     Checked here rather than trusted, because .gitignore is a file anybody can
     tidy up without knowing what a line was for. */
  const { execFileSync } = require("node:child_process");
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const path of [".dev.vars", ".dev.vars.production", "key.pem",
                      "some/nested/key-pkcs8.pem"]) {
    let ignored = true;
    try {
      execFileSync("git", ["check-ignore", "-q", path], { cwd: root });
    } catch {
      ignored = false;   // non-zero exit means NOT ignored
    }
    assert(ignored, `${path} would be committed — add it to .gitignore`);
  }
});

check("no asset is served with a hand-written cache version", () => {
  /* Every ?v= must come from the content hash filter, never a number.

     A hand-written version is a number somebody has to remember to increase,
     and on 2026-08-16 one was not: a browser kept an older staff-i18n.js, a
     function added that day was missing from it, and the Stop button in the
     acting banner silently did nothing. The way out of somebody else's account
     was unusable because of a digit in a template. */
  /* EVERY .njk, not just the layouts. The first version of this check looked
     only at src/_includes/layouts/ and passed while three page templates still
     carried `adminScript: /js/admin-site.js?v=2` in their front matter — a
     hand-written number in exactly the place the hash was meant to remove. */
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const { readdirSync } = require("node:fs");
  const offenders = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { walk(`${dir}${e.name}/`); continue; }
      if (!e.name.endsWith(".njk")) continue;
      const src = readFileSync(dir + e.name, "utf8");
      for (const m of src.matchAll(/(\S*\.(?:js|css))\?v=(\d+)/g)) {
        offenders.push(`${dir.replace(root, "")}${e.name}: ${m[0]}`);
      }

      /* NO version at all is the same bug wearing different clothes, and the
         check above cannot see it — it only matches a ?v= that is already
         there. tokens.css was served unversioned underneath a passing test:
         it holds the colour variables the whole console is drawn from, so a
         cached copy repaints every page from an old palette, with nothing to
         clear it but a hard refresh nobody thinks to do. */
      for (const m of src.matchAll(/(?:src|href)="(\/(?:js|css)\/[^"?]+\.(?:js|css))"/g)) {
        offenders.push(`${dir.replace(root, "")}${e.name}: ${m[1]} has no ?v= at all`);
      }
    }
  })(root);
  eq(offenders, [], "use ?v={{ \"/path\" | v }} — a content hash cannot be forgotten");
});

check("site.json still round-trips byte for byte", () => {
  // The content editor writes it back with JSON.stringify(…, null, 2). If the
  // file drifts from that shape, every save becomes a whole-file diff.
  writeFileSync(SITE, ORIGINAL);
  const raw = readFileSync(SITE, "utf8");
  const trailing = raw.endsWith("\n") ? "\n" : "";
  eq(JSON.stringify(JSON.parse(raw), null, 2) + trailing, raw, "would be reformatted on save");
});

} finally {
  // Always. A test run that leaves the site's own settings modified would be
  // worse than a failing test.
  writeFileSync(SITE, ORIGINAL);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
