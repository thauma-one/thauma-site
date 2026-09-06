#!/usr/bin/env node
/**
 * The photo cropper — what the frame gets
 *   node test/photo-crop.test.mjs
 *
 * WHY THIS EXISTS. Every photo on the site lands in a frame with a shape of
 * its own: the team card is square, the home band is 21:9, a bio photo is
 * whatever the picture wants to be. Before the cropper an upload was scaled
 * whole and `object-fit: cover` cropped to the centre — so a portrait taken
 * with headroom lost the top of the head and nobody was asked.
 *
 * jsdom has no canvas and no layout, so this cannot check what an image looks
 * like. What it CAN check is the arithmetic that decides which pixels survive,
 * and the wiring that carries the chosen shape all the way to the page — which
 * is where the old behaviour silently squared everything.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const near = (a, b, eps, m) => assert(Math.abs(a - b) < eps, `${m} — got ${a}, want ~${b}`);

console.log("the photo cropper\n");

const src = readFileSync("src/js/photo-crop.js", "utf8");
/* A real <script>, not window.eval: jsdom's eval does not bind `window` as the
   global, and the file ends by assigning to it. Running it the way a browser
   does is also the only way to be sure it CAN run there. */
const dom = new JSDOM("<!doctype html><body>", {
  runScripts: "dangerously", pretendToBeVisual: true,
});
const w = dom.window;
const tag = w.document.createElement("script");
tag.textContent = src;
w.document.body.appendChild(tag);
const PC = w.PhotoCrop;

/* ------------------------------------------------------------- the frames */

check("every frame the site has is declared here", () => {
  /* THE LESSON FROM THE MAILING VIEWS. A shape that exists on the site and not
     in this table is a photo nobody can crop correctly. */
  assert(PC, "photo-crop.js exposed nothing");
  for (const k of ["photo", "bio_photo", "home", "wide"]) {
    assert(PC.FRAMES[k], `no frame declared for "${k}"`);
  }
});

check("the team photo is square, and the bio photo is not fixed at all", () => {
  assert(PC.FRAMES.photo.aspect === 1, "the team card frame is 1/1 in main.css");
  assert(PC.FRAMES.bio_photo.aspect === null,
    "the bio frame is variable — fixing it here would square every portrait");
});

check("the home band is 21:9, matching the stylesheet", () => {
  /* Read from main.css rather than restated, so the two cannot drift. */
  const css = readFileSync("src/css/main.css", "utf8");
  const m = css.match(/\.frame\{[^}]*aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);
  assert(m, "could not find .frame's aspect-ratio in main.css");
  near(PC.FRAMES.home.aspect, Number(m[1]) / Number(m[2]), 0.001,
    "the cropper's home frame does not match the page's");
});

check("a wide frame is not capped by its longest edge alone", () => {
  /* 21:9 at a 1600 cap would be 1600x686 — too short for the band on a retina
     display. The cap is per frame for exactly this reason. */
  assert(PC.FRAMES.home.max > PC.FRAMES.photo.max,
    "the home band gets no more pixels than a square team photo");
});

/* -------------------------------------------------------- the choices offered */

check("the offered shapes stay inside the bounds the build enforces", () => {
  /* src/_data/team.js clamps a measured aspect to 0.4–2.5. Offering a shape
     outside that would let somebody pick one the page then refuses. */
  for (const c of PC.CHOICES) {
    if (c.aspect == null) continue;
    assert(c.aspect >= 0.4 && c.aspect <= 2.5,
      `"${c.label}" is ${c.aspect}, outside the 0.4–2.5 the build allows`);
  }
});

check("the shapes are named, not numeric", () => {
  for (const c of PC.CHOICES) {
    assert(c.label && /[a-z]/i.test(c.label), `${c.id} has no readable label`);
  }
});

/* ------------------------------------------------------ carrying the shape */

check("the console records the shape it cropped to", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/data-pf-aspect/.test(admin), "no field holds the chosen shape");
  assert(/bio_photo_aspect:\s*shotAspect\('bio_photo'\)/.test(admin),
    "the shape is not sent when the profile saves");
});

check("the server stores it, clamped", () => {
  const h = readFileSync("workers/src/admin-profile.js", "utf8");
  assert(/bio_photo_aspect:\s*aspect\(body\.bio_photo_aspect\)/.test(h),
    "the handler ignores the shape the console sent");
  assert(/Math\.max\(0\.4,\s*Math\.min\(2\.5/.test(h),
    "the shape is stored unclamped — a 20:1 panorama would reach the page");
});

check("it survives into the page's front matter", () => {
  const h = readFileSync("workers/src/admin-profile.js", "utf8");
  assert(/bio_photo_aspect:\s*\$\{Number\(profile\.bio_photo_aspect\)/.test(h),
    "the markdown does not carry the shape, so the build cannot know it");
});

check("the build believes the stated shape over measuring the file", () => {
  /* THE BUG THIS CLOSES. resolvePhotoAspect reads the file's own dimensions,
     which works for src/img/ and returns null for an object in R2 — so every
     photo uploaded through the console was squared on the bio page. */
  const team = readFileSync("src/_data/team.js", "utf8");
  assert(/clampAspect\(data\.bio_photo_aspect\)\s*\?\?\s*resolvePhotoAspect/.test(team),
    "the build still measures first; an R2 upload will fall back to square");
});

check("a missing shape still falls back to measuring", () => {
  /* Every profile written before this must keep working. */
  const team = readFileSync("src/_data/team.js", "utf8");
  const m = team.match(/function clampAspect\(v\)\{?[\s\S]{0,260}?\n\}/);
  assert(m, "clampAspect not found");
  assert(/return null/.test(m[0]),
    "clampAspect returns a default instead of null, so ?? never falls through");
});

/* ------------------------------------------------------------- the plumbing */

check("the cropper is loaded before the code that calls it", () => {
  const layout = readFileSync("src/_includes/layouts/admin.njk", "utf8");
  const pc = layout.indexOf("photo-crop.js");
  const adm = layout.indexOf("/js/admin.js");
  assert(pc !== -1, "photo-crop.js is never loaded — every upload skips the crop");
  assert(pc < adm, "photo-crop.js loads after admin.js, which calls it");
});

check("cancelling the crop uploads nothing", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/if \(window\.PhotoCrop && !shot\) \{[^}]*return;/.test(admin),
    "a cancelled crop falls through and uploads something anyway");
});

check("a browser without the cropper still gets a photo", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/shot \? shot\.blob : await shrinkImage\(/.test(admin),
    "no fallback — an old browser would upload nothing at all");
});

check("WebP is verified, not assumed", () => {
  /* toBlob returns a PNG without complaint where WebP is unsupported, and a
     PNG of a photograph is megabytes — which the endpoint then refuses. */
  assert(/b\.type === 'image\/webp'/.test(src),
    "the encoder trusts toBlob rather than checking what came back");
  assert(/'image\/jpeg'/.test(src), "no JPEG fallback");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
