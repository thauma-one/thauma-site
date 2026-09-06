#!/usr/bin/env node
/**
 * The photo cropper — what the frame gets
 *   node test/photo-crop.test.mjs
 *
 * WHY THIS EXISTS. Every photo on the site lands in a frame with a shape of
 * its own: the team card is square, the home band is 21:9, a bio photo is
 * whatever the picture wants to be. Before the cropper an upload was scaled
 * whole and `object-fit: cover` cropped to the center — so a portrait taken
 * with headroom lost the top of the head and nobody was asked.
 *
 * jsdom has no canvas and no layout, so this cannot check what an image looks
 * like. What it CAN check is the arithmetic that decides which pixels survive,
 * and the wiring that carries the chosen shape all the way to the page — which
 * is where the old behavior silently squared everything.
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

check("canceling the crop uploads nothing", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/if \(window\.PhotoCrop && !shot\) \{[^}]*return;/.test(admin),
    "a canceled crop falls through and uploads something anyway");
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

/* ------------------------------------------------- editing an existing crop */

check("a photo slot offers Edit, not just Replace and Remove", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/data-pf-edit/.test(admin),
    "no Edit control — moving a face two centimetres means finding the original file again");
  assert(/data-pf-pick/.test(admin) && /data-pf-clear/.test(admin),
    "Edit replaced Replace or Remove rather than joining them");
});

check("the uncropped original is kept, so a crop can be widened", () => {
  /* THE POINT. Re-cropping a crop can only ever take more away: a square taken
     too tight could never be widened, and Square -> Wide would cut the top and
     bottom off what was left instead of revealing what was there. */
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/kind \+ '_master'/.test(admin), "nothing uploads an uncropped master");
  assert(/shrinkImage\(file, 2400\)/.test(admin),
    "the master is not kept at a larger size than the crop, so it buys nothing");
  const q = readFileSync("db/queries.sql", "utf8");
  assert(/photo_master/.test(q) && /bio_photo_master/.test(q),
    "the master URLs are never stored, so Edit forgets them on reload");
});

check("editing does NOT overwrite the master", () => {
  /* Writing the new crop back over the original would quietly make the NEXT
     edit one-way again — the exact thing the master exists to prevent. */
  const admin = readFileSync("src/js/admin.js", "utf8");
  const fn = admin.slice(admin.indexOf("async function editPhoto"),
                         admin.indexOf("function profileSection"));
  assert(fn.length > 200, "editPhoto not found");
  /* The line it must not contain looks like
       slot.querySelector('[data-pf-master="' + kind + '"]').value = body.url;
     The first version of this assertion tried to spell that punctuation out
     and matched none of it, so it passed against the very mutation it was
     written to catch. Anchored on the two things that matter instead. */
  assert(!/data-pf-master[\s\S]{0,80}\.value\s*=/.test(fn),
    "editPhoto writes to the master field — the next edit would be one-way");
});

check("a photo with no master still opens, and says why it is limited", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  const fn = admin.slice(admin.indexOf("async function editPhoto"),
                         admin.indexOf("function profileSection"));
  assert(/master \|\| framed/.test(fn),
    "no fallback — every photo uploaded before the master existed would refuse to edit");
  assert(/loadingCropped/.test(fn),
    "the limitation is silent; somebody widening a portrait deserves to know why it will not");
});

check("removing a photo removes its master and its Edit button", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  const at = admin.indexOf("data-pf-clear]");
  const fn = admin.slice(at, at + 1200);
  assert(/data-pf-master[\s\S]{0,120}value = ''/.test(fn),
    "the master survives removal, so Edit would offer a deleted photograph");
});

/* ------------------------------------------------------- the pending save */

check("Save sits with Remove person, not at the foot of the photos", () => {
  const admin = readFileSync("src/js/admin.js", "utf8");
  /* WITHIN personPanel, not the whole file. The first `data-pf-save` in the
     file is a querySelector inside the dirty-state helpers, so comparing raw
     indexOf across the file compares two things that are not the markup and
     passes for the wrong reason. */
  const at = admin.indexOf("function personPanel");
  assert(at !== -1, "personPanel not found");
  const panel = admin.slice(at, admin.indexOf("\n  function ", at + 40));
  const save = panel.indexOf('data-pf-save="');
  const remove = panel.indexOf("data-remove=");
  assert(save !== -1, "personPanel does not render a Save button at all");
  assert(remove !== -1, "personPanel does not render Remove person");
  assert(save > remove,
    "Save is still rendered before the danger row — it reads as belonging to the photos");
  assert(/pf-commit/.test(panel), "no commit row in the panel");
});

check("unsaved work looks different from saved work", () => {
  /* Everything else in the panel writes on touch; the profile waits. That was
     invisible, so a cropped photo looked right and was lost on the next click. */
  const admin = readFileSync("src/js/admin.js", "utf8");
  assert(/function markProfileDirty/.test(admin), "nothing marks the section dirty");
  assert(/function markProfileClean/.test(admin), "nothing clears it after a save");
  /* A CALL, not the definition. `markProfileClean(userId)` appears in
     `function markProfileClean(userId) {` too, so the obvious regex is
     satisfied by the declaration alone and a never-called function passes. */
  const cleanUses = (admin.match(/markProfileClean\s*\(/g) || []).length;
  assert(cleanUses >= 2,
    "markProfileClean is defined but never called — the button would nag forever");
  const css = readFileSync("src/css/admin.css", "utf8");
  assert(/\.pf-save\.is-dirty\{/.test(css), "the dirty state has no appearance");
});

check("every path that changes a photo marks the profile dirty", () => {
  /* A hidden field fires no input event, so each photo path has to say so
     itself. One that forgets is a lost edit that looked saved. */
  const admin = readFileSync("src/js/admin.js", "utf8");
  const calls = (admin.match(/markProfileDirty\(/g) || []).length;
  assert(calls >= 4,
    `only ${calls} markProfileDirty calls — upload, edit, remove and typing all need one`);
});

check("the nudge can be turned off", () => {
  const css = readFileSync("src/css/admin.css", "utf8");
  const at = css.indexOf("prefers-reduced-motion");
  assert(at !== -1 && /animation:\s*none/.test(css.slice(at, at + 400)),
    "a pulse with no way to stop it is a pulse that becomes noise");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
