// Cross product of team members x site languages -> one bio page each.
// A function export, not a static value (2026-07-16 fix): team() reads
// content/team/*.md fresh from disk on every call, but a plain array
// export only runs that once, at module-require time — Eleventy has
// nothing to re-invoke on rebuild, so bio edits went stale until the
// whole process restarted. Matches team.js's own function-export pattern.
module.exports = () => {
  const team = require("./team.js")();
  const site = require("./site.json");
  return require("./activeLangs.js")().flatMap((lang) =>
    team.map((person) => ({ lang, ...person }))
  );
};
