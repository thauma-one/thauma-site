#!/usr/bin/env node
/**
 * test-steps.mjs — the deploy workflows' tests, ONE STEP PER FILE
 *
 *   node deploy/test-steps.mjs          rewrite both workflows' test steps
 *   node deploy/test-steps.mjs --check  exit 1 if either is out of date
 *
 * WHY STEPS AND NOT ONE "Test" STEP. The Publish bar shows the build as it
 * runs (Chase, 2026-10-03: "so it doesn't feel like 3 minutes where nothing is
 * happening? Or at least how many of the tests passed?"). GitHub reports a
 * running job step by step, every step listed from the start, but a step's
 * LOG is unreadable until the job ends — so the only live, exact count of
 * test files is one step per file, and a failed step's name is the failed
 * file. Measured 2026-10-01: the single Test step was 93 of the deploy's 125
 * seconds, so that is where the bar most needs to move.
 *
 * WHY GENERATED. `cd workers && npm test` ran every workers/test file by
 * glob, so a new test could not be forgotten. A hand-kept YAML list would lose
 * that. This keeps it: the list is built from the folder, and
 * test/deploy-test-steps.test.mjs (itself one of the steps) fails while either
 * workflow differs from what this would write.
 *
 * The gating is unchanged: a failing step fails the job, every later step
 * (the database check, the deploy) is skipped, and nothing ships.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WORKFLOWS = [".github/workflows/deploy.yml", ".github/workflows/deploy-staging.yml"];

/* The page tests CI runs: the ones that need only the build, no services.
   The same list both workflows ran before, in production's order. */
export const PAGE_TESTS = [
  "visibility", "csv", "composer-toolbar", "mailing-preview", "videos-console",
  "console-nav", "console-banner", "mailing-views", "mail-drafts", "photo-crop",
  "us-english", "profile-save", "contact-page", "library", "events-page",
  "presentation", "admin-console", "deploy-test-steps",
];

export const BEGIN = "      # ---- TEST STEPS: written by `node deploy/test-steps.mjs`, do not edit by hand ----";
export const END = "      # ---- END TEST STEPS ----";

/** Every step, as { name, run, dir }. The worker tests are read from the folder. */
export function steps(root = ROOT) {
  const out = PAGE_TESTS.map((t) => ({ name: t, run: `node test/${t}.test.mjs` }));
  out.push({ name: "database schema", run: "python3 db/test_schema.py" });
  for (const f of readdirSync(join(root, "workers/test")).filter((f) => f.endsWith(".test.mjs")).sort()) {
    out.push({ name: "workers/" + f.replace(/\.test\.mjs$/, ""), run: `node test/${f}`, dir: "workers" });
  }
  return out;
}

export function block(list) {
  const lines = [BEGIN];
  for (const s of list) {
    lines.push(`      - name: Test · ${s.name}`);
    if (s.dir) lines.push(`        working-directory: ${s.dir}`);
    lines.push(`        run: ${s.run}`);
  }
  lines.push(END);
  return lines.join("\n");
}

/** The workflow text with its block replaced, or null if it has no markers. */
export function apply(text, blk) {
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return text.slice(0, a) + blk + text.slice(b + END.length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const blk = block(steps());
  let stale = 0;
  for (const wf of WORKFLOWS) {
    const path = join(ROOT, wf);
    const text = readFileSync(path, "utf8");
    const next = apply(text, blk);
    if (next === null) { console.error(`${wf}: no TEST STEPS markers`); process.exit(1); }
    if (next === text) { console.log(`${wf}: up to date`); continue; }
    if (check) { console.error(`${wf}: out of date — run node deploy/test-steps.mjs`); stale = 1; }
    else { writeFileSync(path, next); console.log(`${wf}: written`); }
  }
  process.exit(stale);
}
