#!/usr/bin/env node
/**
 * Settings › Account — you, one line each (mockup board "Settings, just you")
 *   node test/account-settings.test.mjs
 *
 * The heading is your name; Account holds your address, your console
 * language, what you can do, Activity and Sign out; the ministry's languages
 * and keys are on their own tabs, and your own language is not among them.
 * Runs the real Settings script against the built page.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/settings/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/settings/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

console.log("Settings › Account\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(1); }

const ANSWER = {
  you: { email: "chase@thauma.one", name: "Chase Van Roush", is_admin: true, preferred_lang: "en",
         roles: ["staff", "admin", "partner"] },
  partner: { id: "p_c", display_name: "Chase Roush", slug: "chase", access_role: "owner", default_lang: "en" },
  languages: [{ code: "en", name: "English", is_enabled: true }, { code: "hr", name: "Croatian", native_name: "Hrvatski", is_enabled: false }],
  embed: {}, timeline: {}, api_keys: [],
};

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://next.thauma.one/staff/settings/",
  });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(ANSWER)) });
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-settings.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffToast = () => {};
  await settle(150);
  return { w, d: w.document };
}
const labels = (d, panel) => [...d.querySelectorAll(`[data-panel="${panel}"] .set-lbl`)].map((l) => l.textContent.trim());

await check("the heading is your name: first thin, the rest bold", async () => {
  const { d } = await boot();
  eq(d.querySelector(".page-head h1").innerHTML, "Chase <b>Van Roush</b>", "heading");
});

await check("Account is the board's five lines, in its order", async () => {
  const { d } = await boot();
  eq(labels(d, "account"), ["Email", "Console language", "What you can do", "Activity", "Sign out"], "rows");
  eq(d.getElementById("setEmail").textContent, "chase@thauma.one", "the address");
  assert(d.querySelector('[data-panel="account"] a[href="/staff/activity/"]'), "Activity links to the page");
  assert(d.querySelector('[data-panel="account"] a[href*="access/logout"]'), "Sign out signs out");
});

await check("what you can do: your roles in order, then the ministry and how you are on it", async () => {
  const { d } = await boot();
  eq([...d.querySelectorAll("#setRoles .role-tag")].map((t) => t.textContent),
    ["Administration", "Partner", "Staff", "Chase Roush · owner"], "tags");
});

await check("your language is on Account, not among the ministry's", async () => {
  const { d } = await boot();
  assert(d.querySelector('[data-panel="account"] #setPrefLang'), "on Account");
  assert(!d.querySelector('[data-panel="languages"] select'), "no personal picker on Languages");
  eq(d.getElementById("setPrefLang").value, "en", "yours selected");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
