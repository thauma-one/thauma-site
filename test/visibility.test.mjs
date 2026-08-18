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
  return {
    visible: require("../src/_data/visible.js")(),
    navPages: require("../src/_data/navPages.js")(),
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
