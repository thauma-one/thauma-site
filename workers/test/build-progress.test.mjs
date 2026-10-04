#!/usr/bin/env node
/**
 * A deploy run, as the stages the Publish bar ticks off
 *   node workers/test/build-progress.test.mjs
 *
 * The step names are GitHub's own, from the production run of 2026-10-01,
 * with its single Test step replaced by the per-file steps it now has.
 */
import { summarize, STAGES } from "../src/lib/build-progress.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
console.log("a deploy run, as the stages the Publish bar ticks off\n");

const NAMES = ["Set up job", "Run actions/checkout@v4", "Run actions/setup-node@v4", "Run npm ci",
  "Build", "Verify the build matches the comingSoon setting",
  "Test · visibility", "Test · csv", "Test · database schema", "Test · workers/access",
  "Check production schema is ready", "Deploy", "Verify the live site",
  "Post Run actions/setup-node@v4", "Post Run actions/checkout@v4", "Complete job"];

/* The job with the first `done` steps finished, the next one running, and,
   optionally, step `failAt` failed. */
function job(done, { failAt = -1 } = {}) {
  return [{ name: "deploy", status: "in_progress", conclusion: null, steps: NAMES.map((name, i) => {
    if (i === failAt) return { name, status: "completed", conclusion: "failure" };
    if (failAt >= 0 && i > failAt) return { name, status: "completed", conclusion: "skipped" };
    if (i < done) return { name, status: "completed", conclusion: "success" };
    if (i === done) return { name, status: "in_progress", conclusion: null };
    return { name, status: "pending", conclusion: null };
  }) }];
}
const running = { status: "in_progress", conclusion: null, started: "2026-10-03T23:00:00Z", url: "https://x/run/9" };
const states = (p) => Object.fromEntries(p.stages.map((s) => [s.key, s.state]));

check("halfway through the tests: what is done, what runs, and the count", () => {
  const p = summarize(running, job(8));
  eq(states(p), { ready: "done", build: "done", tests: "running", database: "waiting",
                  deploy: "waiting", verify: "waiting", live: "waiting" }, "stages");
  eq(p.tests, { total: 4, passed: 2, running: "database schema" }, "tests");
  eq(p.failed, null, "nothing failed");
  eq(p.queued, false, "started");
});

check("queued before a runner picks it up: every stage waiting", () => {
  const p = summarize({ ...running, status: "queued" }, []);
  eq(p.queued, true, "queued");
  eq(p.stages.every((s) => s.state === "waiting"), true, "all waiting");
  eq(p.tests.total, 0, "no count yet");
});

check("a failed test names the file and the later stages show as not reached", () => {
  const p = summarize({ ...running, status: "completed", conclusion: "failure" }, job(7, { failAt: 7 }));
  eq(p.failed, { stage: "tests", step: "csv", test: true }, "failed");
  eq(states(p).tests, "failed", "tests failed");
  eq(states(p).database, "skipped", "database not reached");
  eq(states(p).live, "waiting", "never live");
  eq(p.tests.passed, 1, "one passed before it");
});

check("finished and successful: every stage done, live included", () => {
  const done = summarize({ ...running, status: "completed", conclusion: "success" },
    [{ name: "deploy", status: "completed", conclusion: "success",
       steps: NAMES.map((name) => ({ name, status: "completed", conclusion: "success" })) }]);
  eq(done.stages.map((s) => s.state), STAGES.map(() => "done"), "all done");
  eq(done.tests, { total: 4, passed: 4, running: null }, "count");
});

check("a step nobody named here joins the stage before it, never vanishes", () => {
  const steps = job(5)[0].steps;
  steps.splice(5, 0, { name: "Warm the cache", status: "completed", conclusion: "failure" });
  const p = summarize({ ...running, status: "completed", conclusion: "failure" }, [{ name: "deploy", status: "completed", steps }]);
  eq(p.failed, { stage: "build", step: "Warm the cache", test: false }, "filed under build");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
