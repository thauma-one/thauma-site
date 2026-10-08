#!/usr/bin/env node
/**
 * Stewardship's list — search, "1 personal of 2", cards on a phone (board 11)
 *   node test/stewardship-list.test.mjs
 *
 * Runs the real console script against the built page with a snapshot
 * standing in for /api/staff-snapshot.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/stewardship/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/stewardship/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("Stewardship's list\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(1); }

const SNAP = {
  partner: { display_name: "Chase Roush" }, generated_at: "2026-09-27T00:00:00Z",
  summary: { contacts_total: 3, personal_last_30: 1 }, needs_attention: { stale_count: 1 },
  stale_days: 90, goals: [], audit: [],
  contacts: [
    { id: "c1", first_name: "Ivana", last_name: "Babić", city: "Zagreb", country: "HR",
      days_since_personal: null, personal_count: 0, interaction_count: 0 },
    { id: "c2", first_name: "David", last_name: "Okafor", city: "Overland Park", country: "US",
      days_since_personal: 81, last_personal_contact: "2026-07-08", last_contact_any: "2026-09-01",
      personal_count: 1, interaction_count: 2 },
    { id: "c3", first_name: "Sarah", last_name: "Mitchell", city: "Kansas City", country: "US",
      days_since_personal: 15, personal_count: 2, interaction_count: 2 },
  ],
};

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/stewardship/",
  });
  const w = dom.window;
  w.fetch = async (u) => ({ ok: true, status: 200,
    json: async () => (String(u).includes("staff-snapshot") ? JSON.parse(JSON.stringify(SNAP)) : {}) });
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  await new Promise((r) => setTimeout(r, 200));
  return { w, d: w.document };
}
const names = (d) => [...d.querySelectorAll("#rows tr[data-id] .nm")].map((n) => n.textContent);

await check("contacts read as \"1 personal of 2\", nobody yet as a dash, and \"Not yet\"", async () => {
  const { d } = await boot();
  const cells = [...d.querySelectorAll("#rows tr[data-id] td:last-child")].map((t) => t.textContent);
  eq(cells, ["—", "1 personal of 2", "2 personal of 2"], "the Contacts column");
  assert(/Not yet/.test(d.querySelector('#rows tr[data-id="c1"]').textContent), "Ivana has not been contacted yet");
});

await check("search narrows the list by name, city or country, and says when nobody matches", async () => {
  const { w, d } = await boot();
  const f = d.getElementById("swFind");
  const type = (v) => { f.value = v; f.dispatchEvent(new w.Event("input", { bubbles: true })); };
  type("oka");
  eq(names(d), ["David Okafor"], "by name");
  type("zagreb");
  eq(names(d), ["Ivana Babić"], "by city");
  type("united states");
  eq(names(d), ["David Okafor", "Sarah Mitchell"], "by country, still worst first");
  type("nobody here");
  eq(names(d), [], "a search that finds nobody");
  assert(/Nobody matches/.test(d.getElementById("rows").textContent), "and says so");
  type("");
  eq(names(d).length, 3, "cleared");
});

await check("each cell says what it is, for the phone's cards", async () => {
  const { d } = await boot();
  const labels = [...d.querySelectorAll('#rows tr[data-id="c2"] td[data-label]')].map((t) => t.dataset.label);
  eq(labels, ["Last personal contact", "Last contact of any kind", "Contacts"], "labels");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
