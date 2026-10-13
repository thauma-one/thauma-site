#!/usr/bin/env node
/**
 * A build, followed on every console page
 *   node test/build-card.test.mjs
 *
 * Chase, 2026-10-13: "the github checks needs to be persistent between
 * pages. I loaded a different page while it was checking and it
 * disappeared. It would just need a good way to clear itself once complete,
 * either with an X or some time based thing." Runs staff.js on a console page
 * that has no publish bar, with a build handed over by the bar earlier.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/staff/index.html`).find((p) => existsSync(p));
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("a build, followed on every page\n");
if (!PAGE) { console.log("  SKIP  no build found — run eleventy first."); process.exit(1); }

const since = Date.now() - 30000;
const stages = (last) => ["ready", "build", "tests", "database", "deploy", "verify", "live"].map((key, i) => ({ key, state: i < 2 ? "done" : i === 2 ? last : "waiting" }));

async function boot(record, progress) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true, url: "https://dev.thauma.one/staff/" });
  const w = dom.window;
  if (record) w.localStorage.setItem("thauma.build", JSON.stringify(record));
  w.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).includes("progress=") ? progress() : {}) });
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  await wait(80);
  return w;
}
const stored = (w) => JSON.parse(w.localStorage.getItem("thauma.build") || "null");

await check("a build started on Website is shown on another page, stage by stage", async () => {
  let p = { run: { status: "in_progress", started: new Date(since).toISOString(), url: "https://github.com/x" }, stages: stages("running"), tests: { total: 62, passed: 30 } };
  const w = await boot({ action: "publish", since, site: "thauma.one" }, () => p);
  const card = w.document.querySelector(".build-card");
  assert(card && card.classList.contains("is-building"), "no card on another page");
  eq(card.querySelector(".build-word").textContent, "Publishing to thauma.one — usually a minute or two…", "what is building");
  eq([...card.querySelectorAll(".build-stages li")].slice(1, 3).map((li) => [li.className, li.textContent]),
     [["is-done", "Build"], ["is-running", "Tests 30 of 62"]], "the stages, as the bar has them");
  w.close();
});

await check("live: it says so and goes by itself; × closes it at any time", async () => {
  const done = { action: "publish", since, site: "thauma.one", done: { ok: true, at: Date.now() - 25000 } };
  const w = await boot(done, () => ({}));
  eq([w.document.querySelector(".build-card"), stored(w)], [null, null], "a build live more than 20s ago is not shown again");
  const w2 = await boot({ ...done, done: { ok: true, at: Date.now() } }, () => ({}));
  const card = w2.document.querySelector(".build-card");
  assert(card && card.classList.contains("is-done") && /Live on thauma\.one/.test(card.textContent), "a build just gone live is not shown as live");
  card.querySelector(".build-x").dispatchEvent(new w2.MouseEvent("click", { bubbles: true }));
  eq([w2.document.querySelector(".build-card"), stored(w2)], [null, null], "× closes it and forgets it");
  w.close(); w2.close();
});

await check("failed: it stays, with where it stopped and what happened", async () => {
  const p = { run: { status: "completed", conclusion: "failure", started: new Date(since).toISOString(), url: "https://github.com/run/9" }, stages: stages("failed"), tests: { total: 62, passed: 12 } };
  const w = await boot({ action: "publish", since, site: "thauma.one" }, () => p);
  const card = w.document.querySelector(".build-card");
  assert(card && card.classList.contains("is-failed"), "no failed card");
  assert(card.querySelector('a[href="https://github.com/run/9"]'), "no link to what happened");
  eq(card.querySelector(".is-failed").textContent, "Tests 12 of 62", "where it stopped");
  eq([stored(w).done.ok, stored(w).done.url], [false, "https://github.com/run/9"], "kept for the next page");
  w.close();
});

await check("an older run is not mistaken for this build, and the bar's own page keeps the card away", async () => {
  const p = { run: { status: "completed", conclusion: "success", started: new Date(since - 10 * 60000).toISOString() }, stages: stages("done") };
  const w = await boot({ action: "preview", since, site: "next.thauma.one" }, () => p);
  const card = w.document.querySelector(".build-card");
  assert(card && card.classList.contains("is-building") && /Waiting for GitHub to start/.test(card.textContent), "the previous run read as this one");
  w.document.documentElement.classList.add("build-in-bar");
  const css = readFileSync("src/css/staff.css", "utf8");
  assert(/html\.build-in-bar \.build-card\{display:none\}/.test(css), "the card shows on top of the bar");
  const pub = readFileSync("src/js/admin-publish.js", "utf8");
  assert(/function startFollowing[\s\S]{0,700}StaffBuild\.start\(/.test(pub), "the bar does not hand its build over");
  w.close();
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
