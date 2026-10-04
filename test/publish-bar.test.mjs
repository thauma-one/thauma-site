#!/usr/bin/env node
/**
 * Publishing says what happened (Admin › Website, the bar along the foot)
 *   node test/publish-bar.test.mjs
 *
 * Chase, 2026-09-29: "when I did publish, the side bar that comes out did
 * not disappear, so it seems as though the changes didn't take effect."
 * The review now closes on Publish, and the bar follows the build — building,
 * then live or failed — from the newest run the server reports.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/admin/website/index.html`).find((f) => existsSync(f));
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
console.log("publishing says what happened\n");
if (!PAGE) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

async function boot(runs, extra = {}, progress = []) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true, url: "https://dev.thauma.one/admin/website/" });
  const w = dom.window;
  let n = 0, pn = 0;
  w.fetch = async (url, opts = {}) => {
    url = String(url);
    /* The build's steps (GET ?progress), scripted one answer per call. */
    if (url.includes("/api/admin/publish?progress=")) {
      const p = progress[Math.min(pn++, progress.length - 1)] || { run: null };
      return { ok: true, status: 200, text: async () => JSON.stringify(p), json: async () => p };
    }
    if (url.includes("/api/admin/publish")) {
      if (opts.method === "POST") return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, action: "publish", started: true }), json: async () => ({ ok: true }) };
      const latest = runs[Math.min(n++, runs.length - 1)];
      const body = { configured: true, branch: "main", neverPublished: false, published: { sha: "7bee186", at: "2026-09-29T23:30:41Z" },
        head: "7bee186", waiting: 2, commits: [], files: [], migrations: [], confirm_word: "PUBLISH",
        latest: { live: latest, preview: null }, carries: { live: true, preview: true }, ...extra };
      return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body };
    }
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({}) };
  };
  w.console.error = () => {}; w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  for (const f of ["staff-i18n.js", "staff.js", "admin-publish.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffConfirm = async () => true;
  const toasts = []; w.StaffToast = (m, k) => toasts.push({ m, k });
  await settle(200);
  return { w, d: w.document, toasts };
}
const now = () => new Date(Date.now() + 1000).toISOString();

await check("Publish closes the review, then the bar follows the build until it is live", async () => {
  const { d, toasts } = await boot([
    { status: "completed", conclusion: "success", started: "2026-09-29T23:30:41Z" },       // before
    { status: "in_progress", conclusion: null, started: now(), url: "https://x/run/1" },    // just started
    { status: "completed", conclusion: "success", started: now(), url: "https://x/run/1" }, // done
  ]);
  d.getElementById("pReview").click();
  await settle();
  assert(!d.getElementById("pReviewPanel").hidden, "the review opens");
  d.getElementById("pPublish").click();
  await settle(300);
  assert(d.getElementById("pReviewPanel").hidden, "the review closes on Publish");
  assert(d.getElementById("pBar").classList.contains("is-building"), "the bar says it is building");
  assert(/Publishing to/.test(d.getElementById("pBarCount").textContent), "in words");
  d.getElementById("pRefresh").click();          // the 15-second check, now
  await settle(300);
  assert(d.getElementById("pBar").classList.contains("is-done"), "then that it is live");
  assert(/Live on/.test(d.getElementById("pBarCount").textContent) && d.querySelector("#pBarCount a"), "with a way to open it");
  assert(toasts.some((t) => /Live on/.test(t.m) && t.k === "ok"), "and says so once");
});

await check("a build that fails says so, with where to look", async () => {
  const { d } = await boot([
    { status: "completed", conclusion: "success", started: "2026-09-29T23:30:41Z" },
    { status: "completed", conclusion: "failure", started: now(), url: "https://x/run/2" },
  ]);
  d.getElementById("pReview").click(); await settle();
  d.getElementById("pPublish").click(); await settle(300);
  d.getElementById("pRefresh").click(); await settle(300);
  assert(d.getElementById("pBar").classList.contains("is-failed"), "failed");
  assert(d.querySelector('#pBarCount a[href="https://x/run/2"]'), "linked to the run");
});

await check("when live's edits could not reach dev, the page says so, with where to look", async () => {
  const done = { status: "completed", conclusion: "success", started: "2026-09-29T23:30:41Z" };
  const stuck = await boot([done], { sync: { failed: true, at: "2026-09-30T10:00:00Z", url: "https://x/sync/9" } });
  const box = stuck.d.querySelector("#pState .p-sync-stuck");
  assert(box && /couldn't be brought into dev/.test(box.textContent), "the warning is on the page");
  assert(box.querySelector('a[href="https://x/sync/9"]'), "linked to the run");
  const fine = await boot([done], { sync: { failed: false, at: "2026-09-30T10:00:00Z", url: "https://x/sync/9" } });
  assert(!fine.d.querySelector("#pState .p-sync-stuck"), "no warning when the sync is healthy");
});

/* ---- the build, stage by stage (Chase, 2026-10-03) ---- */
const KEYS = ["ready", "build", "tests", "database", "deploy", "verify", "live"];
const prog = (states, tests, more = {}) => ({
  run: { status: "in_progress", conclusion: null, started: now(), url: "https://x/run/3" },
  queued: false, stages: KEYS.map((key, i) => ({ key, state: states[i] })), tests, failed: null, ...more });
const items = (d) => [...d.querySelectorAll("#pStages li")].map((li) => [li.className, li.textContent]);

await check("while a build runs, the bar ticks off its stages and counts the tests", async () => {
  const { d } = await boot([
    { status: "completed", conclusion: "success", started: "2026-09-29T23:30:41Z" },
    { status: "in_progress", conclusion: null, started: now(), url: "https://x/run/3" },
  ], {}, [prog(["done", "done", "running", "waiting", "waiting", "waiting", "waiting"],
               { total: 71, passed: 12, running: "csv" })]);
  d.getElementById("pReview").click(); await settle();
  d.getElementById("pPublish").click(); await settle(300);
  assert(!d.getElementById("pStages").hidden, "the stages show");
  const li = items(d);
  assert(li.length === 7, `seven stages, got ${li.length}`);
  assert(li[1][0] === "is-done" && li[1][1] === "Build", "build ticked off");
  assert(li[2][0] === "is-running" && li[2][1] === "Tests 12 of 71", `the test count, got ${JSON.stringify(li[2])}`);
  assert(li[6][0] === "is-waiting" && li[6][1] === "Live", "live is last, not reached");
});

await check("a failed test file is named, and the stages stay to show where it stopped", async () => {
  const failed = prog(["done", "done", "failed", "skipped", "skipped", "skipped", "waiting"],
    { total: 71, passed: 30, running: null },
    { run: { status: "completed", conclusion: "failure", started: now(), url: "https://x/run/4" },
      failed: { stage: "tests", step: "csv", test: true } });
  /* The page loads, the review re-reads (still the old run), and only after
     Publish does the newest run become this one, failed. */
  const old = { status: "completed", conclusion: "success", started: "2026-09-29T23:30:41Z" };
  const { d } = await boot([old, old,
    { status: "completed", conclusion: "failure", started: now(), url: "https://x/run/4" },
  ], {}, [failed]);
  d.getElementById("pReview").click(); await settle();
  d.getElementById("pPublish").click(); await settle(400);
  assert(d.getElementById("pBar").classList.contains("is-failed"), "failed");
  assert(/Stopped at csv/.test(d.getElementById("pBarCount").textContent), "names the file: " + d.getElementById("pBarCount").textContent);
  assert(!d.getElementById("pStages").hidden && items(d)[2][0] === "is-failed", "the stages stay, tests red");
});

await check("a reload in the middle of a deploy picks the build up", async () => {
  const { d } = await boot([{ status: "in_progress", conclusion: null, started: now(), url: "https://x/run/5" }],
    {}, [prog(["done", "running", "waiting", "waiting", "waiting", "waiting", "waiting"],
              { total: 71, passed: 0, running: null })]);
  await settle(300);
  assert(d.getElementById("pBar").classList.contains("is-building"), "the bar says it is building");
  assert(!d.getElementById("pStages").hidden && items(d)[1][0] === "is-running", "and shows where");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
