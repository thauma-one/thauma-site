// Ordered list of pageSlug values that get a number in the mobile
// page-location strip (base.njk) — same order as the nav itself. A
// function export, not a static array (see teamPages.js's own fix
// earlier for why: a static value computed once at module-require time
// never reflects a later showEvents toggle without a full process
// restart; a function gets re-invoked, and re-reads site.json, on every
// build).
module.exports = () => {
  const site = require("./site.json");
  const pages = ["about", "mission", "values", "team", "resources", "contact"];
  if (site.showEvents) pages.push("events");
  pages.push("give");
  return pages;
};
