#!/usr/bin/env node
/**
 * Activity — the record, in sentences (mockup board "Activity")
 *   node test/activity-page.test.mjs
 *
 * Runs the real console scripts against the built staff Activity page, with
 * the snapshot answered in place, and checks the admin page loads the same
 * renderer.
 */
import { JSDOM } from "jsdom";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const built = (p) => ["_site", "_site_next", "_site_prod"].map((d) => `${d}/${p}`).find((f) => existsSync(f));
const PAGE = built("staff/activity/index.html");
const ADMIN = built("admin/activity/index.html");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

console.log("Activity\n");
if (!PAGE || !ADMIN) { console.log("  SKIP  the built console is missing — run the build first."); process.exit(1); }

const row = (at, action, entity, extra = {}) => ({ at, action, entity, entity_id: "x_1", actor: "Mira Petrović", ...extra });
const AUDIT = [
  row("2026-09-24T15:28:00", "stewardship.open", "contact", { contact_name: "Ivana Babić" }),
  row("2026-09-24T15:27:00", "stewardship.open", "contact", { contact_name: "Ivana Babić" }),
  row("2026-09-24T15:26:00", "stewardship.event.edit", "life_event", { contact_name: null }),
  row("2026-09-06T11:12:00", "enable", "partner_language", { entity_id: "hr", actor: "Chase Roush" }),
  row("2026-09-06T10:00:00", "release.publish", "release", { actor: "Chase Roush" }),
  row("2026-09-05T09:00:00", "something.new", "thing"),
];

async function boot(audit = AUDIT, { url = "https://next.thauma.one/staff/activity/" } = {}) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", pretendToBeVisual: true, url });
  const w = dom.window;
  const asked = [];
  w.fetch = async (u) => {
    asked.push(String(u));
    const body = String(u).includes("staff-snapshot")
      ? { you: { roles: ["partner"] }, partner: { display_name: "Mira" }, summary: {}, needs_attention: {},
          goals: [], contacts: [], audit, stale_days: 120 }
      : {};
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "activity.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  await settle(200);
  const d = w.document;
  const lines = () => [...d.querySelectorAll("#auditList .act-s")].map((s) => s.textContent.trim());
  const pick = (name, v) => {
    const sel = d.querySelector(`.act-bar [data-act="${name}"]`);
    sel.value = v;
    sel.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  return { w, d, lines, pick, asked };
}

await check("each row is a sentence, the person bold, the code kept small beside it", async () => {
  const { d, lines } = await boot();
  eq(lines()[0], "Mira Petrović opened Ivana Babić's record · twice", "first line, folded");
  eq(d.querySelector("#auditList .act-who").textContent, "Mira Petrović", "who is bold");
  eq(d.querySelector("#auditList .act-code").textContent, "stewardship.open · x_1", "the code");
});

await check("a name the server withheld reads as a supporter", async () => {
  const { lines } = await boot();
  eq(lines()[1], "Mira Petrović edited a life event on a supporter's record", "anonymous");
});

await check("languages by name, publishing, and an unknown action still a sentence", async () => {
  const { lines } = await boot();
  eq(lines().slice(2), ["Chase Roush switched Croatian on", "Chase Roush published the site",
    "Mira Petrović made a change"], "the rest");
});

await check("grouped under their day, with the time", async () => {
  const { d } = await boot();
  eq(d.querySelectorAll("#auditList .act-day").length, 3, "three days");
  eq(d.querySelector("#auditList .act-t").textContent, "15:28", "time");
});

await check("the two filters sit beside the heading and narrow the list", async () => {
  const { d, lines, pick } = await boot();
  assert(d.querySelector(".page-head .act-bar"), "in the page head");
  pick("who", "Chase Roush");
  eq(lines().length, 2, "Chase's two");
  pick("who", "");
  pick("kind", "open");
  eq(lines(), ["Mira Petrović opened Ivana Babić's record · twice"], "opened a record");
  pick("kind", "publish");
  eq(lines(), ["Chase Roush published the site"], "published");
});

await check("Activity reads further back than the other pages", async () => {
  const { asked } = await boot();
  assert(asked.some((u) => /staff-snapshot\?audit=300/.test(u)), asked.join(", "));
});

await check("nothing yet: one line, and no filters", async () => {
  const { d } = await boot([]);
  assert(d.querySelector("#auditList .empty"), "empty line");
  assert(d.querySelector(".act-bar").hidden, "filters hidden");
});

await check("the administrators' Activity uses the same sentences", async () => {
  const html = readFileSync(ADMIN, "utf8");
  assert(/\/js\/activity\.js/.test(html), "admin Activity does not load activity.js");
  assert(/ConsoleActivity\.render\(\$\('admAudit'\), state\.audit, \{ where: true \}\)/
    .test(readFileSync("src/js/admin.js", "utf8")), "admin.js does not render with it");
});

await check("every named action the server records has its own sentence", async () => {
  /* The dotted actions ("stewardship.open", "profile.publish") each mean one
     thing, so each gets a sentence. A new one written without one would read
     "made a change" — this says so when it is added, not when it is read. */
  const src = ["workers/src", "workers/src/lib"].flatMap((dir) => readdirSync(dir)
    .filter((f) => f.endsWith(".js")).map((f) => readFileSync(`${dir}/${f}`, "utf8"))).join("\n");
  const named = new Set([...src.matchAll(/(?:action:\s*|note\()"([a-z]+\.[a-z_.]+)"/g)].map((m) => m[1]));
  named.add("stewardship.person.add"); named.add("stewardship.person.edit");
  named.add("stewardship.event.add"); named.add("stewardship.event.edit");
  named.add("profile.publish"); named.add("profile.unpublish");
  assert(named.has("actas.change") && named.size > 15, `the scan found only ${[...named]}`);
  const { w } = await boot([]);
  const say = (a) => w.ConsoleActivity.sentence({ action: a, entity: "x", actor: "A" });
  const fallback = say("no.such.action");
  const missing = [...named].filter((a) => say(a) === fallback);
  eq(missing, [], "actions with no sentence");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
