#!/usr/bin/env node
// Dev-only tool (GAME-SPEC.md §7.8): renders one collage-wall panel to
// collage-debug.png in the project root, for judging density/packing/
// contrast on a still image before eyeballing it in motion.
//
// Reads the SAME curated wordlist the real game reads
// (src/_data/collageWords.json — NOT i18n; runtime i18n scraping was
// removed 2026-07-15, see GAME-SPEC.md §5.5 point 5), then mirrors
// buildCollagePanel()'s skyline packer from src/404.njk (2026-07-16
// rewrite — grid-jitter allowed overlapping words; skyline packing
// guarantees zero overlap by construction). Keep the constants below
// (slot size/size range/weight/opacity ranges) in sync with
// src/404.njk's buildCollagePanel() if that function changes.
//
// Rendered via SVG + rsvg-convert rather than a real <canvas>, because
// node-canvas's prebuilt binary doesn't load on this Pi (16K page size).
// Requires `rsvg-convert` on PATH (already installed on the dev Pi via
// librsvg2-bin; not an npm dependency, so this script is dev-machine-only).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT_PNG = path.join(ROOT, "collage-debug.png");
const OUT_SVG = path.join(ROOT, "collage-debug.svg"); // kept alongside for inspection, gitignored

const collageWords = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/collageWords.json"), "utf8"));

const COLLAGE_WORDS = [];
Object.keys(collageWords.words).forEach((key) => {
  const entry = collageWords.words[key];
  collageWords.languages.forEach((lang) => COLLAGE_WORDS.push(entry[lang]));
});

const W = 700, H = 600;

// No real <canvas> here to call measureText() on, so approximate a
// proportional sans-serif's average advance width — good enough for a
// debug packing preview, not pixel-exact (the real game measures for real).
function approxTextWidth(word, size) {
  return word.length * size * 0.56;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Skyline packer (2026-07-16, kept in sync with buildCollagePanel()): every
// word is placed at the currently-lowest gap and that strip is marked
// filled, so no two words can ever occupy the same pixels.
const SLOT = 4;
const slotCount = Math.max(1, Math.ceil(W / SLOT));
const skyline = new Array(slotCount).fill(0);
const maxSpan = W * 0.28;

function fitSkyline(blockW) {
  let need = Math.max(1, Math.ceil(blockW / SLOT));
  if (need > slotCount) need = slotCount;
  let bestSlot = 0, bestY = Infinity;
  for (let s = 0; s <= slotCount - need; s++) {
    let maxY = 0;
    for (let k = 0; k < need; k++) if (skyline[s + k] > maxY) maxY = skyline[s + k];
    if (maxY < bestY) { bestY = maxY; bestSlot = s; }
  }
  return { slot: bestSlot, need, x: bestSlot * SLOT, y: bestY };
}
function commitSkyline(slot, need, y) {
  for (let k = 0; k < need; k++) skyline[slot + k] = y;
}

let lastWasAccent = false;
const elements = [];
let count = 0;
let attempts = 0;
const maxAttempts = 3000;

while (attempts < maxAttempts) {
  attempts++;
  if (Math.min(...skyline) >= H) break;

  const word = COLLAGE_WORDS[Math.floor(Math.random() * COLLAGE_WORDS.length)];
  const vertical = Math.random() < 0.25;
  let size = 14 + Math.random() * 70;
  const isAccent = !lastWasAccent && Math.random() < 0.035;
  lastWasAccent = isAccent;

  let weight, fill;
  if (isAccent) {
    weight = 100 + Math.floor(Math.random() * 200);
    fill = `rgba(92,242,196,${(0.85 + Math.random() * 0.15).toFixed(3)})`;
  } else {
    weight = Math.random() < 0.45 ? 700 : 200;
    const opacity = 0.06 + Math.random() * 0.06;
    fill = `rgba(140,175,205,${opacity.toFixed(3)})`;
  }

  let textW = approxTextWidth(word, size);
  if (textW > maxSpan) {
    size *= maxSpan / textW;
    textW = approxTextWidth(word, size);
  }
  const textH = size * 1.15;
  const blockW = vertical ? textH : textW;
  const blockH = vertical ? textW : textH;
  const fit = fitSkyline(blockW);

  if (fit.y + blockH > H + 40) {
    commitSkyline(fit.slot, fit.need, H);
    continue;
  }

  count++;
  const rotate = vertical ? 90 : 0;
  // Horizontal: top-left anchor at (fit.x, fit.y). Vertical: same
  // translate+rotate derivation as buildCollagePanel() — pivot at
  // (fit.x+blockW, fit.y) so the rotated box lands at [x,x+blockW]x[y,y+blockH].
  const tx = vertical ? fit.x + blockW : fit.x;
  const ty = fit.y;

  elements.push(
    `<text x="0" y="0" text-anchor="start" transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) rotate(${rotate})" ` +
    `font-family="Sora, sans-serif" font-weight="${weight}" font-size="${size.toFixed(1)}" ` +
    `fill="${fill}" dominant-baseline="hanging">${esc(word)}</text>`
  );

  commitSkyline(fit.slot, fit.need, fit.y + blockH);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0B0F15"/>
  ${elements.join("\n  ")}
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#2FD8FF" stroke-opacity="0.15"/>
  <text x="10" y="${H - 12}" font-family="monospace" font-size="11" fill="rgba(255,255,255,0.35)">debug panel — ${count} words, ${W}x${H}, pool size ${COLLAGE_WORDS.length}</text>
</svg>`;

fs.writeFileSync(OUT_SVG, svg);
try {
  execFileSync("rsvg-convert", ["-w", String(W), "-h", String(H), OUT_SVG, "-o", OUT_PNG]);
  console.log(`Wrote ${OUT_PNG} (${count} words, pool of ${COLLAGE_WORDS.length})`);
} catch (e) {
  console.error("rsvg-convert failed — is librsvg2-bin installed? SVG was still written to", OUT_SVG);
  process.exit(1);
}
