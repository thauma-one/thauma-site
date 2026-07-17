// Reads every resource file. One markdown file per resource in
// src/content/resources/ — created via /admin (Resources collection) or
// by hand. Same pattern as team.js (CLAUDE.md: "Events and Resources
// should be built exactly this way when real content exists").
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

module.exports = () => {
  const dir = path.join(__dirname, "..", "content", "resources");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { slug: f.replace(/\.md$/, ""), ...data };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99));
};
