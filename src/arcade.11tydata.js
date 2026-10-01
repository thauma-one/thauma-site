// /arcade/ — the hidden arcade's own address, for sharing (Chase, 2026-09-29:
// "Shareable is ok"). Built only while the arcade is switched on
// (site.json › visibility.sections.arcade), and deliberately NOT subject to
// comingSoon: once released it is reachable even while the rest of the site
// is still the landing page, which is where most of its doors are.
module.exports = {
  eleventyComputed: {
    permalink: (data) => (data.visible.sections.arcade ? "/arcade/index.html" : false),
  },
};
