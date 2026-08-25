module.exports = function (eleventyConfig) {
  eleventyConfig.setServerOptions({ host: "0.0.0.0" });

  // Content collections (team, future events/resources) are read by data
  // files, not rendered as standalone pages.
  eleventyConfig.ignores.add("src/content/**");

  // Render markdown strings from front matter (e.g. team bios)
  const md = require("markdown-it")({ html: false, linkify: true });
  eleventyConfig.addFilter("md", (s) => (s ? md.render(String(s)) : ""));

  // Static passthroughs
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/img": "img" });
  eleventyConfig.addPassthroughCopy({ "src/fonts": "fonts" });
  // src/admin was Decap CMS. Git Gateway is a Netlify Identity service, so it
  // stopped working at the cutover and the directory only served to occupy the
  // /admin path that the administration area now uses. Removed 2026-08-15;
  // Phase 3 of the runbook replaces what it did.
  // /staff/ pages are Eleventy templates now (they share layouts/staff.njk),
  // so only their DATA is copied verbatim. Their CSS and JS live in src/css
  // and src/js, which are already passed through above.
  eleventyConfig.addPassthroughCopy({ "src/staff/data": "staff/data" });

  /* CACHE BUSTING FROM THE FILE'S CONTENT, not from a number somebody
     remembers to increase.

     Every script and stylesheet carried a hand-written ?v=N. On 2026-08-16 one
     of them was not bumped, a browser kept an older staff-i18n.js, a function
     added that day was missing from it, and the Stop button in the acting
     banner silently did nothing — a TypeError in a callback with no visible
     error. The way out of somebody else's account was unusable because of a
     number in a template.

     A content hash cannot be forgotten. Same file, same URL, cached forever;
     changed file, new URL, fetched immediately. It also stops the opposite
     waste, where bumping one version re-downloads assets that did not change.

     CACHED PER BUILD, AND CLEARED BETWEEN BUILDS.

     Read once per file per build rather than once per page. Cleared on
     eleventy.before so the cache can never outlive the build it belongs to —
     correctness by construction rather than by trusting when eleventy chooses
     to re-run this config in watch mode.

     Whether a stale hash can actually reach the output is checked, not
     assumed: test/asset-hashes.test.mjs walks the built HTML and fails if any
     ?v= does not match the file it points at. That check exists because on
     2026-08-19 three edited scripts were measured being served with the
     previous build's hashes, so browsers went on running code that had been
     replaced hours earlier — and the mechanism was never identified. An
     invariant that is asserted does not need to be explained. */
  /* ============================================================
     THE ONE BUNDLED SCRIPT
     ============================================================
     Everything else in src/js is a plain script tag, and that is deliberate —
     no build step means nothing between the file on disk and the file in the
     browser. The composer is the exception, because it runs TipTap, and TipTap
     is a package tree rather than a file.

     WHY IT EARNS THE EXCEPTION. The composer was twice built without a
     library: first on document.execCommand, then on a Markdown textarea. The
     first could not be tested at all — execCommand does not exist outside a
     real browser — and neither gave the editing experience this screen needed.
     A proven editor is worth one build step; it is not worth adopting a
     framework, which is why this is the only bundle and why the rest of the
     console is untouched.

     BUILT INSIDE THE ELEVENTY BUILD rather than as a separate npm script, so
     it cannot be forgotten. `npx @11ty/eleventy` is what CI runs and what the
     Pi's watcher runs, and both now produce the bundle without knowing it
     exists. The output lands in src/js so the existing passthrough copy and
     the `v` cache-busting filter treat it like any other script.

     esbuild is used through its API rather than its CLI because this has to
     run on every rebuild in watch mode, and starting a process per keystroke
     would be felt.
     ============================================================ */
  const esbuild = require("esbuild");
  const { writeFileSync, readFileSync: readIfThere, existsSync } = require("node:fs");
  const BUNDLES = [
    { in: "src/editor/composer.js", out: "src/js/composer.bundle.js" },
  ];

  /* ⚠ THE OUTPUT IS INSIDE A WATCHED DIRECTORY, AND THAT IS A LOOP.
     src/js is passthrough-copied, so Eleventy watches it. Writing the bundle
     there during a build looks to the watcher like somebody edited a file,
     which starts another build, which writes the bundle again. On 2026-08-22
     that rebuilt the dev site about once a second until it was stopped, and
     from the outside it looked like the site would not load at all.

     TWO GUARDS, because one of them is easy to lose in a refactor:
       1. the output path is excluded from watching, below;
       2. the file is only written when its BYTES CHANGE — so even if the
          ignore is dropped, a rebuild that produces identical output touches
          nothing and the loop cannot start. */
  for (const b of BUNDLES) eleventyConfig.watchIgnores.add(b.out);

  eleventyConfig.on("eleventy.before", async () => {
    for (const b of BUNDLES) {
      try {
        const result = await esbuild.build({
          entryPoints: [b.in],
          bundle: true,
          minify: true,
          format: "iife",
          /* The console is served to staff on current browsers, so this is not
             the place to ship half a megabyte of polyfill. */
          target: ["es2020"],
          legalComments: "none",
          logLevel: "silent",
          // Written by hand below, so identical output can skip the write.
          write: false,
        });
        const next = result.outputFiles[0].text;
        const current = existsSync(b.out) ? readIfThere(b.out, "utf8") : null;
        if (next !== current) writeFileSync(b.out, next);
      } catch (err) {
        /* A broken bundle must not take the whole site build down — the other
           eleven scripts and every page are fine. It fails loudly here, and
           the one screen that needs it says so in the browser. */
        console.error(`[bundle] ${b.in} failed: ${err.message}`);
      }
    }
  });
  /* Editing the composer SOURCE has to trigger a rebuild. Its output is in
     src/js, which is watched already; its input is not. */
  eleventyConfig.addWatchTarget("src/editor");

  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const hashes = new Map();
  eleventyConfig.on("eleventy.before", () => hashes.clear());
  eleventyConfig.addFilter("v", function (assetPath) {
    if (hashes.has(assetPath)) return hashes.get(assetPath);
    let h = "0";
    try {
      // "/js/staff.js" lives at "src/js/staff.js" — the passthrough mapping.
      const file = "src" + assetPath;
      h = createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 8);
    } catch (e) {
      // A missing file is a broken link, not a broken build. It will 404
      // loudly in the browser, which is the right place to notice it.
      console.warn(`[v] could not hash ${assetPath}: ${e.message}`);
    }
    hashes.set(assetPath, h);
    return h;
  });

  // Swap the language segment of a URL: /en/about/ -> /hr/about/
  // (Pages skipped by the comingSoon flag have no URL; return a safe value.)
  eleventyConfig.addFilter("langSwap", function (url, targetLang) {
    if (typeof url !== "string") return "/" + targetLang + "/";
    return url.replace(/^\/[a-z]{2}\//, `/${targetLang}/`);
  });

  return {
    dir: { input: "src", includes: "_includes", data: "_data", output: "_site" },
    templateFormats: ["njk", "md", "html"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk",
  };
};
