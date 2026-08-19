#!/usr/bin/env node
/**
 * Every ?v= in the built site points at the file it claims
 *   node test/asset-hashes.test.mjs
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The cache-busting hash is the ONLY thing that tells a browser a script has
 * changed. The assets are served `max-age=0, must-revalidate`, but that only
 * matters for a URL the browser decides to ask about — if the HTML still
 * carries the old ?v=, the browser has no reason to ask at all.
 *
 * The failure mode is silent and looks like nothing is wrong. On 2026-08-19
 * three edited scripts were served with the previous build's hashes. The files
 * on disk were correct, the worker served them correctly, the rebuild was
 * logged — and the browser went on running the old code for hours. It surfaced
 * as "the milestone list still is not loading" long after the fix was live,
 * and the request log was the only place the truth showed: the browser never
 * asked for the script, so it never called the API behind it.
 *
 * The mechanism was never identified, which is exactly why this is a test
 * rather than a comment. It does not care WHY a hash went stale.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const SITE = "_site";
const SRC = "src";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}

let pages = [];
try { pages = walk(SITE); } catch {
  console.log("  SKIP  no _site — run a build first");
  process.exit(0);
}

/* Every distinct (asset, hash) pair the built site asks a browser to fetch. */
const refs = new Map();               // "/js/x.js?v=abc" -> Set(pages)
for (const page of pages) {
  const html = readFileSync(page, "utf8");
  for (const m of html.matchAll(/(?:src|href)="(\/[^"?]+)\?v=([0-9a-f]+)"/g)) {
    const key = `${m[1]}?v=${m[2]}`;
    if (!refs.has(key)) refs.set(key, new Set());
    refs.get(key).add(page);
  }
}

check("the build actually emits cache-busted assets", () => {
  if (refs.size === 0) {
    throw new Error("no ?v= references found at all — the filter may have stopped running");
  }
});

check("every ?v= matches the file it points at", () => {
  const stale = [];
  for (const [key, inPages] of refs) {
    const [path, hash] = key.split("?v=");
    let real;
    try {
      real = createHash("sha1").update(readFileSync(SRC + path)).digest("hex").slice(0, 8);
    } catch {
      stale.push(`${path} — referenced but missing from ${SRC}${path}`);
      continue;
    }
    if (real !== hash) {
      const where = [...inPages][0].replace(SITE, "");
      stale.push(`${path} — HTML says ${hash}, file is ${real} (e.g. ${where})`);
    }
  }
  if (stale.length) {
    throw new Error(
      `${stale.length} stale asset reference(s); browsers will keep running the old file:\n` +
      stale.map((s) => "            " + s).join("\n"));
  }
});

/* One asset referenced under two different hashes means half the site is
   pointing at a version the other half has moved past. */
check("no asset is referenced under two different hashes", () => {
  const byPath = new Map();
  for (const key of refs.keys()) {
    const [path, hash] = key.split("?v=");
    if (!byPath.has(path)) byPath.set(path, new Set());
    byPath.get(path).add(hash);
  }
  const split = [...byPath].filter(([, hs]) => hs.size > 1)
    .map(([p, hs]) => `${p} -> ${[...hs].join(", ")}`);
  if (split.length) throw new Error("split hashes:\n            " + split.join("\n            "));
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
