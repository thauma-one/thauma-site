/**
 * build-progress.js — a deploy run, as the stages the Publish bar shows
 *
 * Chase, 2026-10-03: after Preview or Publish "it says 'Should go live in a
 * minute or so' … can we add where the checks are so it doesn't feel like 3
 * minutes where nothing is happening? Or at least how many of the tests
 * passed?"
 *
 * GitHub reports a running job's steps one by one, every step listed from
 * the start (not-yet-reached ones as "pending" or "queued"). The workflows
 * run ONE STEP PER TEST FILE, named "Test · <file>" (deploy/test-steps.mjs
 * writes them), so counting those steps is counting test files: live, exact,
 * and a failed step's name IS the failed file. Nothing else gives a live
 * count — a job's log is unreadable until the job ends.
 *
 * Pure: takes GitHub's run and jobs, returns what the page draws.
 */

export const TEST_PREFIX = "Test · ";

/** Stages in order. Steps are filed under one by name; unknown steps join
    the stage before them, so a renamed or added step never vanishes. */
export const STAGES = ["ready", "build", "tests", "database", "deploy", "verify", "live"];

function stageOf(name) {
  if (name.startsWith(TEST_PREFIX)) return "tests";
  if (/^Build$|^Verify the build/.test(name)) return "build";
  if (/^Check (production schema|the database)/.test(name)) return "database";
  if (/^Deploy$/.test(name)) return "deploy";
  if (/^Verify (the live site|staging)$/.test(name)) return "verify";
  if (/^Post |^Complete job$/.test(name)) return "ignore";
  if (/^Set up job$|^Run actions\/|^Run npm ci$/.test(name)) return "ready";
  return null;
}

const failedStep = (s) => s.status === "completed" &&
  s.conclusion && !["success", "skipped", "neutral"].includes(s.conclusion);

/**
 * @param run   latestRun()'s answer: { status, conclusion, started, url }
 * @param jobs  runJobs()'s answer .jobs (may be empty while the run is queued)
 */
export function summarize(run, jobs) {
  const job = (jobs || [])[0] || null;
  const by = Object.fromEntries(STAGES.map((k) => [k, []]));
  let current = "ready";
  for (const s of (job && job.steps) || []) {
    const k = stageOf(s.name);
    if (k === "ignore") continue;
    if (k) current = k;
    by[current].push(s);
  }

  const stateOf = (steps) => {
    if (!steps.length) return "waiting";
    if (steps.some(failedStep)) return "failed";
    /* GitHub marks the steps after a failure "completed, skipped": not reached,
       which is not the same as done. */
    if (steps.every((s) => s.status === "completed" && s.conclusion === "skipped")) return "skipped";
    if (steps.every((s) => s.status === "completed")) return "done";
    if (steps.some((s) => s.status === "in_progress" || s.status === "completed")) return "running";
    return "waiting";
  };

  const finished = run.status === "completed";
  const ok = finished && run.conclusion === "success";
  const stages = STAGES.map((key) => {
    if (key === "live") return { key, state: ok ? "done" : "waiting" };
    let state = stateOf(by[key]);
    /* A finished run whose remaining stages never ran (canceled, or stopped
       by an earlier failure) shows them as not reached, not as waiting. */
    if (finished && state === "waiting") state = "skipped";
    return { key, state };
  });

  const tests = by.tests;
  const first = ((job && job.steps) || []).find(failedStep);
  const name = (s) => s && (s.name.startsWith(TEST_PREFIX) ? s.name.slice(TEST_PREFIX.length) : s.name);
  return {
    run: { status: run.status, conclusion: run.conclusion, started: run.started, url: run.url },
    queued: !job || job.status === "queued",
    stages,
    tests: {
      total: tests.length,
      passed: tests.filter((s) => s.status === "completed" && s.conclusion === "success").length,
      running: name(tests.find((s) => s.status === "in_progress")) || null,
    },
    failed: first ? { stage: STAGES.find((k) => by[k].includes(first)) || null, step: name(first),
                      test: first.name.startsWith(TEST_PREFIX) } : null,
  };
}
