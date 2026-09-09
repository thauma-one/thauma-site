// Cross product of resources x site languages -> one detail page each.
//
// WHY THERE IS A DETAIL PAGE AT ALL. A resource is a title, a summary and a
// BODY — the guide, the checklist, the glossary. The listing page shows the
// first two, and until this existed the third had nowhere to go: you could
// write the full text in the console and no visitor could ever read it.
//
// A function export, never a static value. resources() reads the folder fresh
// on every call; a plain array export runs once at require time and Eleventy
// has nothing to re-invoke, so an edit stays invisible until the process
// restarts. Same reason team.js and teamPages.js are functions.
module.exports = () => {
  const resources = require("./resources.js")();
  return require("./activeLangs.js")().flatMap((lang) =>
    resources.map((resource) => ({ lang, ...resource }))
  );
};
