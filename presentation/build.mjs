#!/usr/bin/env node
/**
 * build.mjs — one HTML file that works from a memory stick
 *
 *   node presentation/build.mjs                  -> presentation/dist/index.html
 *   node presentation/build.mjs --out _site/present/index.html
 *
 * WHY A SEPARATE BUILD RATHER THAN AN ELEVENTY PAGE. The spec requires a
 * single file that is fully presentable with no network whatsoever — a meeting
 * in somebody's front room with bad wifi is the assumption, not the edge case.
 * Eleventy's output links its CSS, JS and fonts as separate requests, which is
 * right for a website and wrong for an artifact that has to survive being
 * emailed to somebody.
 *
 * So everything is inlined: styles, modules, fonts as data URIs. The cost is
 * file size, which is watched below and reported on every build.
 *
 * THE BRAND COMES FROM THE REAL FILE. tokens.css is read from src/css at build
 * time rather than copied, so the deck cannot drift from the site. If somebody
 * changes the palette on the website, the next build of this picks it up.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const OUT = outArg === -1
  ? join(here, "dist", "index.html")
  : resolve(repo, args[outArg + 1]);

const read = (p) => readFileSync(resolve(repo, p), "utf8");

/* ------------------------------------------------------------------ fonts

   Only the faces actually used, and only the latin subsets. Sora carries every
   heading exactly as it does on the site; Inter carries body copy. The
   handwriting face is the one addition the spec allows, and it is loaded from
   a local file if one has been added — otherwise the motif falls back to the
   platform's own script faces, which is honest rather than broken. */
function fontFace(family, weight, file, style = "normal") {
  const path = join(repo, "src", "fonts", file);
  if (!existsSync(path)) return { css: "", bytes: 0 };
  const b64 = readFileSync(path).toString("base64");
  return {
    css: `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
         `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`,
    bytes: b64.length,
  };
}

const faces = [
  fontFace("Sora", "100 700", "Sora-latin-v2.woff2"),
  fontFace("Inter", "300 600", "Inter-latin-v2.woff2"),
  /* Drop a woff2 here and the handwriting motif uses it. Named DeckHand so the
     stylesheet does not have to change when the real face is chosen. */
  fontFace("DeckHand", "400", "DeckHand.woff2"),
];

/* ------------------------------------------------------------------ styles */
const tokens = read("src/css/tokens.css");
const deckCss = read("presentation/src/deck.css");
const css = faces.map((f) => f.css).join("\n") + "\n" + tokens + "\n" + deckCss;

/* ------------------------------------------------------------------ modules

   A tiny bundler rather than a dependency: the module graph here is nine files
   with no external packages, and adding a build toolchain to inline nine files
   would be more moving parts than the thing it builds. Imports are resolved
   depth-first and each file is emitted once.
 */
const seen = new Set();
const chunks = [];

function bundle(entry) {
  const path = resolve(repo, entry);
  if (seen.has(path)) return;
  seen.add(path);

  let src = readFileSync(path, "utf8");
  const dir = dirname(path);

  /* Pull in what this file imports, before this file itself. */
  for (const m of src.matchAll(/^\s*import\s+[^'"]*from\s+["'](\.[^"']+)["'];?/gm)) {
    bundle(resolve(dir, m[1]));
  }

  /* Strip the module syntax. Everything ends up in one scope, which is safe
     here because every export name across these files is unique — asserted
     below rather than assumed. */
  src = src
    .replace(/^\s*import\s+[^'"]*from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^\s*export\s+(const|let|function|async function|class)\s/gm, "$1 ")
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "");

  chunks.push(`/* ${entry.replace(/^.*presentation\//, "")} */\n${src}`);
}

bundle("presentation/config.js");
bundle("presentation/src/motifs.js");
bundle("presentation/src/deck.js");
bundle("presentation/src/sections/bookends.js");
bundle("presentation/src/sections/opening.js");
bundle("presentation/src/sections/heart.js");
bundle("presentation/src/sections/methods.js");
bundle("presentation/src/sections/patience.js");
bundle("presentation/src/sections/schedule.js");
bundle("presentation/src/sections/ask.js");
bundle("presentation/src/main.js");

const js = chunks.join("\n\n");

/* A name defined twice would silently shadow rather than fail, and the symptom
   would be a section quietly using another's helper. Checked, not trusted. */
const names = {};
for (const chunk of chunks) {
  const file = chunk.match(/^\/\* (.+?) \*\//)[1];
  for (const m of chunk.matchAll(/^(?:const|let|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (names[m[1]] && names[m[1]] !== file) {
      console.error(`  COLLISION: ${m[1]} is defined in both ${names[m[1]]} and ${file}`);
      process.exitCode = 1;
    }
    names[m[1]] = file;
  }
}

/* ------------------------------------------------------------------- write */
const html = read("presentation/src/shell.html")
  .replace("/*__CSS__*/", () => css)
  .replace("/*__JS__*/", () => js);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);

const kb = (n) => (n / 1024).toFixed(0) + "kB";
const fontBytes = faces.reduce((n, f) => n + f.bytes, 0);
console.log(`  ${OUT.replace(repo + "/", "")}`);
console.log(`    total   ${kb(Buffer.byteLength(html))}`);
console.log(`    fonts   ${kb(fontBytes)}${fontBytes ? "" : "  (none embedded)"}`);
console.log(`    code    ${kb(Buffer.byteLength(js))}`);
console.log(`    styles  ${kb(Buffer.byteLength(css) - fontBytes)}`);
if (!faces[2].bytes) {
  console.log(`    note    no DeckHand.woff2 — handwriting falls back to a system script face`);
}
