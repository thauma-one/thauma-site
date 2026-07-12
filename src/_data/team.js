// Reads every team member file. One markdown file per person in
// src/content/team/ — created via /admin (Team collection) or by hand.
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

module.exports = () => {
  const dir = path.join(__dirname, "..", "content", "team");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      return { slug: f.replace(/\.md$/, ""), ...data };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99));
};
