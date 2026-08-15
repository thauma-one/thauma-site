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
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  // /staff/ pages are Eleventy templates now (they share layouts/staff.njk),
  // so only their DATA is copied verbatim. Their CSS and JS live in src/css
  // and src/js, which are already passed through above.
  eleventyConfig.addPassthroughCopy({ "src/staff/data": "staff/data" });

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
