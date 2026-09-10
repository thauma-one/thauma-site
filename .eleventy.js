module.exports = function (eleventyConfig) {
  eleventyConfig.setServerOptions({ host: "0.0.0.0" });

  // Content collections (team, future events/resources) are read by data
  // files, not rendered as standalone pages.
  eleventyConfig.ignores.add("src/content/**");

  // Render markdown strings from front matter (e.g. team bios)
  const md = require("markdown-it")({ html: false, linkify: true });
  eleventyConfig.addFilter("md", (s) => (s ? md.render(String(s)) : ""));

  /* A DATE, OR A SPAN OF THEM, IN THE READER'S LANGUAGE.
   *
   * "2027-03-14 – 2027-03-15" is a database value shown to a person. On an
   * invitation the date is one of three things somebody is actually looking
   * for, and it has to read like one: "14–15 March 2027".
   *
   * Intl does the language, so Croatian gets "ožujka" without a month table
   * living here. A same-month span says the month once — "14–15 March" — the
   * way an invitation would; a span across months spells both ends out.
   *
   * Anything unparseable is handed back exactly as written. A gathering whose
   * date is "spring 2027" is a real thing somebody may type before a date is
   * fixed, and turning that into "Invalid Date" would be worse than leaving
   * their words alone.
   */
  eleventyConfig.addFilter("when", function (start, end, lang) {
    const locale = { en: "en-GB", hr: "hr-HR", sr: "sr-RS", sl: "sl-SI" }[lang] || "en-GB";
    const parse = (v) => {
      if (!v) return null;
      const d = new Date(String(v) + "T00:00:00");
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const a = parse(start), b = parse(end);
    if (!a) return start || "";

    const fmt = (d, opts) => new Intl.DateTimeFormat(locale, opts).format(d);
    const full = { day: "numeric", month: "long", year: "numeric" };

    if (!b || b.getTime() === a.getTime()) return fmt(a, full);
    if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
      return `${fmt(a, { day: "numeric" })}–${fmt(b, full)}`;
    }
    return `${fmt(a, { day: "numeric", month: "long" })} – ${fmt(b, full)}`;
  });

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

  /* THE PRESENTATION, built into the site as one self-contained file.
   *
   * It is not an Eleventy template and deliberately not one: the spec requires
   * a single artifact that works from a memory stick with no network, and
   * Eleventy links its CSS, JS and fonts as separate requests. So it is built
   * by its own script and dropped into the output, which also means the same
   * file that gets emailed to somebody is the file the site serves.
   *
   * Non-indexed by its own meta tag — shareable by link, absent from search.
   */
  eleventyConfig.on("eleventy.after", async ({ dir }) => {
    const { execFileSync } = await import("node:child_process");
    /* THE DIRECTORY THIS RUN IS ACTUALLY WRITING TO. `dir.output` is the
       CONFIGURED value and does not follow a --output flag, so a build aimed
       at a temporary directory still dropped the deck into _site — surprising,
       and the sort of thing that has a test asserting against a file the build
       never touched. The flag wins where it was given. */
    const argv = process.argv;
    const flag = argv.indexOf("--output");
    const inline = argv.find((a) => a.startsWith("--output="));
    const root = flag !== -1 ? argv[flag + 1]
               : inline ? inline.slice("--output=".length)
               : dir.output;
    /* PER PARTNER, not per site. The deck is one partner's support-raising
       presentation that Thauma happens to host, so it publishes under that
       partner's own segment. The slug comes from the deck's own config, which
       is what a second partner's deck would change. */
    const { config: deckConfig } = await import("./presentation/config.js");
    const slug = deckConfig.meta.partnerSlug;
    if (!slug) { console.warn("[present] no partnerSlug in presentation config; skipped"); return; }
    const out = require("path").join(root, slug, "present", "index.html");
    try {
      execFileSync("node", ["presentation/build.mjs", "--out", out],
                   { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      /* A broken deck must not fail the website's build. It is one page, and
         the failure is loud here rather than silent in the output. */
      console.warn("[present] build failed:", String(err.stdout || err.message).slice(-300));
    }
  });
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
