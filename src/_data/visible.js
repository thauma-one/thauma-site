// visible.js — resolves site.json's TWO COLUMNS down to plain booleans
//
// Every switch in site.json's `visibility` block has two values:
//
//   live   what the public site does
//   dev    what dev.thauma.one does
//
// WHY TWO AND NOT ONE
// ---------------------------------------------------------------------------
// A single flag makes the two jobs fight. Turning Events off has to hide it
// from visitors — and has to NOT hide it from the person building the Events
// page, or they cannot see what they are working on. That was previously
// handled by scattering `or not env.isProduction` through the templates, which
// meant the dev site could never be made to look like the live one. You could
// hide a page from the public and then had no way to check what the site
// looked like without it.
//
// So the dev column is a SIMULATOR. It defaults to showing everything — that
// is the whole point of a dev site — but each switch can be flipped
// independently to answer "what does this look like when Events is off?"
// without touching what visitors see.
//
// WHICH COLUMN A BUILD USES
// ---------------------------------------------------------------------------
//   _site        the Pi's watch output, dev.thauma.one       -> dev
//   _site_next   the preview build, next.thauma.one          -> live
//   _site_prod   the real thing, thauma.one                  -> live
//
// next.thauma.one uses the LIVE column deliberately. It exists to show what is
// about to be published; a preview that used the dev column would be showing
// something no visitor will ever see, which is worse than no preview at all.
//
// The signal is Eleventy's own ELEVENTY_RUN_MODE. It is `serve` or `watch`
// under the dev server and `build` for a real build, and Eleventy sets it
// itself — it cannot be faked by exporting a variable, which is why every gate
// in this project keys off it rather than off NODE_ENV.
//
// A FUNCTION, NOT AN OBJECT. A static value is computed once when the module
// is first required and never reflects a later edit to site.json without
// restarting the process. `eleventy --watch` does not restart. See
// navPages.js, which learned this the same way.

const fs = require("node:fs");
const path = require("node:path");
const SITE_PATH = path.join(__dirname, "site.json");

const isDevServer =
  process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";

/**
 * Read one switch. Tolerates a plain boolean so a hand-edit cannot break the
 * build, and takes an explicit fallback for when the setting is absent
 * entirely.
 *
 * ⚠ THE FALLBACK IS NOT A DETAIL. Measured 2026-08-16: with this code and a
 * site.json predating the `visibility` block — which is exactly the pair you
 * get mid-migration, since content lives on `main` and code arrives from
 * `dev` — `comingSoon` resolved to FALSE and the whole unreleased site would
 * have been built and published.
 *
 * An absent setting means "we do not know", and the answer to "should the
 * public see this?" when we do not know is NO.
 */
function resolve(entry, column, fallback) {
  if (entry === null || entry === undefined) return fallback;
  if (typeof entry === "boolean") return entry;
  if (typeof entry !== "object") return fallback;
  return entry[column] === undefined ? fallback : !!entry[column];
}

// readFileSync, NOT require. `require` caches by path, so a JSON file read
// that way is frozen at the first read for the life of the process — and
// `eleventy --watch` never restarts. Measured 2026-08-16: flipping a switch
// rebuilt the site and changed nothing, because every rebuild re-invoked this
// function and got the same cached object back. The comment on navPages.js
// said a function was enough to fix this. It was not; this is.
module.exports = () => {
  const site = JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
  const v = site.visibility || {};
  const column = isDevServer ? "dev" : "live";

  // A page listed but not decided: show it. Forgetting to fill one in must
  // not silently delete a page from the site.
  const pages = {};
  for (const [slug, entry] of Object.entries(v.pages || {})) {
    pages[slug] = resolve(entry, column, true);
  }

  // A section listed but not decided: HIDE it. Sections gate content that is
  // being prepared — a half-finished library appearing because nobody chose
  // is the wrong way to be wrong.
  const sections = {};
  for (const [id, entry] of Object.entries(v.sections || {})) {
    sections[id] = resolve(entry, column, false);
  }

  return {
    column,
    isDev: !!isDevServer,
    /* GATED unless the file says otherwise, in so many words. This is the
       one switch whose failure is unrecoverable — an unreleased site that has
       been crawled and cached cannot be un-published. */
    comingSoon: resolve(v.comingSoon, column, true),
    pages,
    sections,

    /* Home, 404 and the coming-soon page itself are deliberately absent from
       `pages` and this is what says so. A site whose home page can be switched
       off is not a site, and a 404 that can be switched off is a 500. */
    page(slug) {
      if (slug === "" || slug === undefined) return true;
      return Object.prototype.hasOwnProperty.call(pages, slug) ? pages[slug] : true;
    },
  };
};
