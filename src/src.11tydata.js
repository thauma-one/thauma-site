// Directory data file: computes every page's output path, and decides which
// pages are built at all.
//
// TURNING A PAGE OFF MEANS NOT BUILDING IT, not hiding it with CSS. A page
// that exists but is unlinked is still reachable by anyone with the URL, still
// crawlable, and still in the sitemap. `permalink: false` means the file is
// never written, so the site returns a real 404.
//
// Two switches decide this, and both come from site.json via _data/visible.js:
//
//   visible.comingSoon    the whole site collapses to the landing page
//   visible.pages[slug]   one page is on or off
//
// visible.js has already picked the right COLUMN — `dev` for the Pi's watch
// output, `live` for real builds — so nothing here needs to know which kind of
// build it is in. That check used to be repeated in every branch below and in
// three templates, which is how the dev site ended up unable to simulate the
// live one.
//
// The coming-soon page itself is the exception that has to stay: under the dev
// server it is built at its own URL so it can be worked on, and in a real
// build it either REPLACES the home page or is not built at all.
const isDevServer =
  process.env.ELEVENTY_RUN_MODE && process.env.ELEVENTY_RUN_MODE !== "build";

module.exports = {
  eleventyComputed: {
    lang: (data) => (data.member ? data.member.lang : data.lang),
    title: (data) => (data.member ? data.member.name : undefined),
    permalink: (data) => {
      const v = data.visible;

      // Team bio pages (paginated over teamPages; alias "member"). They belong
      // to the team page, so they follow its switch as well as the site's.
      if (data.member && data.member.slug) {
        if (v.comingSoon) return false;
        if (!v.page("team")) return false;
        return `/${data.member.lang}/team/${data.member.slug}/index.html`;
      }

      if (data.pageSlug === undefined && !data.isComingSoonPage) return data.permalink;

      const lang = data.lang;
      const home = `/${lang}/index.html`;

      if (data.isComingSoonPage) {
        /* When the gate is on it REPLACES the home page — in either column, so
           switching it on for dev reproduces exactly what a visitor gets
           rather than an approximation of it. That is the point of the dev
           column: mimic, not merely hide. */
        if (v.comingSoon) return home;
        // Off, but still previewable at its own URL under the dev server, so
        // the landing page can be designed without switching the site off.
        if (isDevServer) return `/${lang}/coming-soon/index.html`;
        return false;
      }

      if (v.comingSoon) return false;
      if (!v.page(data.pageSlug)) return false;

      return data.pageSlug === "" ? home : `/${lang}/${data.pageSlug}/index.html`;
    },
  },
};
