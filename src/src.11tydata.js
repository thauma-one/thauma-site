// Directory data file: computes every page's output path, and implements
// the COMING SOON switch (site.json -> "comingSoon").
//
// PRODUCTION build (Netlify):
//   comingSoon: true  -> only the landing page is generated
//   comingSoon: false -> the full site is generated
//
// LOCAL DEV SERVER (netlify dev / eleventy --serve):
//   The full site ALWAYS builds at its normal URLs so you can develop,
//   and the landing page is previewable at /en/coming-soon/ and
//   /hr/coming-soon/. The flag only affects real deploys.
const isDevServer =
  process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";

module.exports = {
  eleventyComputed: {
    permalink: (data) => {
      if (data.pageSlug === undefined && !data.isComingSoonPage) return data.permalink;

      const lang = data.lang;
      const home = `/${lang}/index.html`;

      if (data.isComingSoonPage) {
        if (isDevServer) return `/${lang}/coming-soon/index.html`;
        return data.site.comingSoon ? home : false;
      }
      if (!isDevServer && data.site.comingSoon) return false;
      return data.pageSlug === "" ? home : `/${lang}/${data.pageSlug}/index.html`;
    },
  },
};
