#!/usr/bin/env node
/**
 * What's new — every Publish, by page, opened from the bell
 *   node test/changes-page.test.mjs
 *
 * Chase, 2026-10-13: "Make sure the changelog is understandable to an end
 * user. And separate into different sections by the different pages of the
 * site filtered to each user by their role and what they can see." The
 * filtering is the server's (workers/test/admin.test.mjs); this runs the
 * real page script against the built page: the sections carry the header's
 * own names, the release the bell names is opened, and nothing is markup.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/staff/changes/index.html`).find((p) => existsSync(p));
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("What's new\n");
if (!PAGE) { console.log("  SKIP  no build found — run eleventy first."); process.exit(1); }

const ANSWER = {
  releases: [
    { id: "r_new", at: "2026-10-13T12:00:00Z", by: "Chase Roush",
      sections: [{ page: "console", lines: ["The bell <b>tells</b> you"] }, { page: "staff:mail", lines: ["Signatures"] }, { page: "admin:users", lines: ["Bio changes"] }],
      content: ["events", "resources"] },
    { id: "r_old", at: "2026-10-01T12:00:00Z", by: "", sections: [{ page: "staff:index", lines: ["Home"] }], content: [] },
  ],
  waiting: [{ page: "admin:index", lines: ["Visits"] }],
};

async function boot(hash) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://dev.thauma.one/staff/changes/" + (hash || "") });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(ANSWER)) });
  w.Element.prototype.scrollIntoView = function () { w.__scrolled = this.id; };
  w.StaffProblem = () => {};
  for (const f of ["staff-i18n.js", "staff-changes.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  await new Promise((r) => setTimeout(r, 80));
  return w;
}

await check("each Publish by page, under the header's own names, with the public site's content", async () => {
  const w = await boot();
  const rel = w.document.getElementById("r_new");
  eq([...rel.querySelectorAll(".chg-sec h3")].map((h) => h.textContent),
     ["Everywhere in the console", "Mail", "People", "Website content"], "sections");
  eq(rel.querySelector(".chg-sec li").innerHTML, "The bell &lt;b&gt;tells&lt;/b&gt; you", "a line is text, not markup");
  eq(rel.querySelector(".chg-sec:last-child li").textContent, "Updated: Events, Resources", "what changed on the public site");
  eq([rel.open, w.document.getElementById("r_old").open], [true, false], "the newest open, the rest folded");
  eq(w.document.getElementById("r_old").querySelector("h3").textContent, "Home", "staff:index is Home");
  assert(/Published by Chase Roush/.test(rel.querySelector("summary").textContent), "who published");
  const wait = w.document.querySelector(".chg-rel.is-waiting");
  assert(wait && /Not published yet/.test(wait.textContent) && wait.querySelector("h3").textContent === "Overview", "an administrator's waiting entries");
});

await check("the bell's link opens its release and brings it into view, also while the page is open", async () => {
  const w = await boot("#r_old");
  eq([w.document.getElementById("r_old").open, w.__scrolled], [true, "r_old"], "the named release");
  assert(w.document.getElementById("r_old").classList.contains("is-target"), "not marked");
  w.location.hash = "#r_new";
  await new Promise((r) => setTimeout(r, 60));
  eq([w.document.getElementById("r_new").open, w.__scrolled], [true, "r_new"], "a second notice pressed on this page");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
