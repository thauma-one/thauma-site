// Same "is this a real deploy" signal already used to gate comingSoon
// in src.11tydata.js — one consistent check, not a second scheme.
const isDevServer =
  process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";

module.exports = { isProduction: !isDevServer };
