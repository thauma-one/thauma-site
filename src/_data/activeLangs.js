// activeLangs.js — the languages this build actually publishes
//
// `site.languages` lists every language that EXISTS: one entry per file in
// src/_data/i18n. This is the subset that is switched ON, resolved against the
// same dev/live columns as everything else in `visibility`.
//
// WHY THE TWO ARE SEPARATE
// ---------------------------------------------------------------------------
// A language is written before it is published. Somebody adds Slovenian, the
// file appears with 210 empty rows, and they work through it over a fortnight
// — during which /sl/ must not exist for visitors, and must exist on
// dev.thauma.one so the work can be seen in place.
//
// One list cannot express that. Two can: `languages` is what the console can
// edit, `visibility.languages` is what the world gets.
//
// EVERY PAGE TEMPLATE PAGINATES OVER THIS, not over site.languages. That is
// the whole mechanism — a language that is off produces no pages at all,
// rather than pages that are hidden. An unlinked page is still reachable,
// still crawlable, and still in the sitemap; a page that was never built is
// a 404.
//
// English is not switchable. It is the fallback every missing translation
// resolves to, and a site with no fallback language has nothing to serve when
// a string is absent. Same rule as the home page in visible.js: some things
// are not decisions.
//
// A FUNCTION, and readFileSync rather than require — see visible.js. `require`
// caches JSON for the life of the process and `eleventy --watch` never
// restarts, so a switch flipped in the console would rebuild everything and
// change nothing.

const fs = require("node:fs");
const path = require("node:path");
const SITE_PATH = path.join(__dirname, "site.json");

const FALLBACK = "en";

const isDevServer =
  process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";

module.exports = () => {
  const site = JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
  const all = Array.isArray(site.languages) ? site.languages : [FALLBACK];
  const column = isDevServer ? "dev" : "live";
  const table = (site.visibility && site.visibility.languages) || {};

  const active = all.filter((code) => {
    if (code === FALLBACK) return true;
    const entry = table[code];
    // Not listed at all: ON. A language file that exists and has never been
    // given a switch is one somebody added by hand, and dropping it silently
    // would delete a third of the site with no error anywhere.
    if (entry === undefined || entry === null) return true;
    if (typeof entry === "boolean") return entry;
    return entry[column] !== false;
  });

  // Cannot be empty. If somebody manages to switch everything off, the site
  // still needs one language to build, and it is the fallback by definition.
  return active.length ? active : [FALLBACK];
};
