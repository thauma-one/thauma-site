#!/usr/bin/env node
// Dev-only tool (GAME-SPEC.md §7.8): renders one collage-wall panel to
// collage-debug.png in the project root, for judging density/packing/
// contrast on a still image before eyeballing it in motion.
//
// Reads the SAME site data the real game reads (src/_data/site.json's
// languages + src/_data/i18n/*.json), tokenizes it exactly like
// buildCollagePanel()'s COLLAGE_WORDS/COLLAGE_RAW_PHRASES logic in
// src/404.njk, then mirrors that function's random layout algorithm.
// Keep the constants below (count/size/weight/opacity ranges) in sync
// with src/404.njk's buildCollagePanel() if that function changes.
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

const site = JSON.parse(fs.readFileSync(path.join(ROOT, "src/_data/site.json"), "utf8"));

function loadRawPhrases() {
  const phrases = [];
  site.languages.forEach((lang) => {
    const t = JSON.parse(fs.readFileSync(path.join(ROOT, `src/_data/i18n/${lang}.json`), "utf8"));
    phrases.push(
      t.nav.about, t.nav.mission, t.nav.values, t.nav.team, t.nav.resources,
      t.nav.contact, t.nav.give, t.nav.events,
      t.mission.work1_label, t.mission.work2_label, t.mission.work3_label,
      ...t.values.items.map((i) => i.title),
      ...t.notFound.taunts
    );
  });
  return phrases;
}

// Mirrors src/404.njk's post-Nunjucks tokenization exactly.
function tokenize(phrases) {
  const words = [];
  phrases.forEach((phrase) => {
    phrase.split(/\s+/).forEach((raw) => {
      const word = raw.replace(/[.,!?;:'"()—–]/g, "");
      if (word.length > 0) words.push(word);
    });
  });
  return words;
}

const COLLAGE_WORDS = tokenize(loadRawPhrases());

const W = 700, H = 600;
const count = 50 + Math.floor(Math.random() * 31); // keep in sync with buildCollagePanel()
let lastWasAccent = false;

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const elements = [];
for (let i = 0; i < count; i++) {
  const word = COLLAGE_WORDS[Math.floor(Math.random() * COLLAGE_WORDS.length)];
  const size = 10 + Math.random() * 80; // ~9x contrast, keep in sync
  const vertical = Math.random() < 0.25;
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

  const x = Math.random() * W, y = Math.random() * H;
  const rotate = vertical ? 90 : 0;
  elements.push(
    `<text x="0" y="0" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rotate})" ` +
    `font-family="Sora, sans-serif" font-weight="${weight}" font-size="${size.toFixed(1)}" ` +
    `fill="${fill}" dominant-baseline="middle">${esc(word)}</text>`
  );
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
