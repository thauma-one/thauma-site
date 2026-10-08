// socialIcons.js — the social links' icons and names for Thauma's footer.
//
// The same file the partner sites draw theirs from
// (workers/src/lib/social-icons.js), so the two cannot drift. Node loads an
// ES module through require() since 22.12; a function export, as every data
// file here is, so a change is read on the next build.
module.exports = () => {
  const { ICON, SOCIAL_NAME } = require("../../workers/src/lib/social-icons.js");
  return { icon: ICON, name: SOCIAL_NAME, kinds: Object.keys(ICON) };
};
