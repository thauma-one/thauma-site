// Reads every team member file. One markdown file per person in
// src/content/team/ — created via /admin (Team collection) or by hand.
const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");
const { imageSize } = require("image-size");

const IMG_DIR = path.join(__dirname, "..", "img");

// The bio-page photo frame adapts to the REAL aspect ratio of whichever
// photo ends up showing (bio_photo if set, else the Team-page photo) —
// requested directly: a 16:9 submission shouldn't get force-cropped into
// a square. Computed once at build time by reading the actual file's
// pixel dimensions (image-size, zero-dependency). Clamped to [0.4, 2.5]
// so one pathological upload (a 20:1 panorama) can't break the bio-page
// layout; every normal portrait/landscape/square photo passes through
// untouched. Returns null (template falls back to a plain square frame)
// if the file is missing or unreadable, so a bad reference never fails
// the build.
function resolvePhotoAspect(publicPath) {
  if (!publicPath || !publicPath.startsWith("/img/")) return null;
  const filePath = path.join(IMG_DIR, publicPath.slice("/img/".length));
  try {
    const { width, height } = imageSize(fs.readFileSync(filePath));
    return Math.max(0.4, Math.min(2.5, width / height));
  } catch (e) {
    return null;
  }
}

module.exports = () => {
  const dir = path.join(__dirname, "..", "content", "team");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      const bioPhoto = data.bio_photo || data.photo;
      const bioPhoto2 = data.bio_photo_2 || null; // optional second bio-page photo
      return {
        slug: f.replace(/\.md$/, ""),
        ...data,
        bioPhoto,
        bioPhotoAspect: resolvePhotoAspect(bioPhoto),
        bioPhoto2,
        bioPhoto2Aspect: resolvePhotoAspect(bioPhoto2),
      };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99));
};
