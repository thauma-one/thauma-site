module.exports = function (eleventyConfig) {
  // Static passthroughs
  eleventyConfig.addPassthroughCopy({ "src/css": "css" });
  eleventyConfig.addPassthroughCopy({ "src/js": "js" });
  eleventyConfig.addPassthroughCopy({ "src/img": "img" });
  eleventyConfig.addPassthroughCopy({ "src/admin": "admin" });
  eleventyConfig.addPassthroughCopy({ "src/staff": "staff" });

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
