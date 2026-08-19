// Ordered list of pageSlug values that get a number in the mobile
// page-location strip (base.njk) — same order as the nav itself.
//
// A FUNCTION, NOT A STATIC ARRAY. A value computed once at module-require
// time never reflects a later toggle without restarting the process, and
// `eleventy --watch` does not restart. visible.js carries the same note for
// the same reason.
//
// It reads the SAME switches the nav does, so the strip cannot come to
// disagree with the links above it.
const fs = require("node:fs");
const path = require("node:path");
const SITE_PATH = path.join(__dirname, "site.json");

module.exports = () => {
  // readFileSync, not require — see the note in visible.js. require() caches,
  // and the watch server never restarts to clear it.
  const site = JSON.parse(fs.readFileSync(SITE_PATH, "utf8"));
  const isDevServer =
    process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";
  const column = isDevServer ? "dev" : "live";
  const v = (site.visibility && site.visibility.pages) || {};
  const on = (slug) => {
    const e = v[slug];
    if (e === undefined || e === null) return true;
    return typeof e === "boolean" ? e : !!e[column];
  };

  return ["about", "mission", "values", "team", "resources", "events", "contact", "give"]
    .filter(on);
};
