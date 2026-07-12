// Cross product of team members x site languages -> one bio page each.
const team = require("./team.js")();
const site = require("./site.json");
module.exports = site.languages.flatMap((lang) =>
  team.map((person) => ({ lang, ...person }))
);
