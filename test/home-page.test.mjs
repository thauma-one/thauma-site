#!/usr/bin/env node
/**
 * Home — what needs you (mockup board "Home", step 7)
 *   node test/home-page.test.mjs
 *
 * Runs the real console script against the built page, with
 * /api/staff-snapshot and /api/staff-home answered in place.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const built = (p) => ["_site", "_site_next", "_site_prod"].map((d) => `${d}/${p}`).find((f) => existsSync(f));
const PAGE = built("staff/index.html");
const STEW = built("staff/stewardship/index.html");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

console.log("Home\n");
if (!PAGE || !STEW) { console.log("  SKIP  the built console is missing — run the build first."); process.exit(1); }

const person = (id, first, days, city) => ({ id, first_name: first, last_name: "Test", city,
  country: "HR", days_since_personal: days });

function snapshot(over = {}) {
  return {
    you: { email: "mira@thauma.one", name: "Mira", roles: ["partner", "staff"] },
    partner: { id: "p_m", display_name: "Mira" },
    stale_days: 120,
    summary: { contacts_total: 9, personal_last_30: 1 },
    needs_attention: { stale_count: 7 },
    goals: [{ kind: "monthly", percent: 68, label: "Monthly" }],
    audit: [],
    contacts: [
      person("c_never", "Ivana", null, "Zagreb"),
      person("c_195", "Marko", 195, "Osijek"),
      person("c_150", "Petra", 150), person("c_140", "Luka", 140),
      person("c_130", "Ana", 130), person("c_121", "Josip", 121),
      person("c_30", "Recent", 30),
    ],
    stewardship_withheld: false,
    ...over,
  };
}
function home(over = {}) {
  return {
    languages: [{ code: "en", name: "English" }, { code: "hr", name: "Croatian", native_name: "Hrvatski" },
                { code: "sr", name: "Serbian", native_name: "Српски" }],
    published: 8,
    unfinished: [
      { kind: "milestone", id: "ms_1", title: { en: "Get Fingerprinted", hr: "Otisci" } },
      { kind: "prayer", id: "pr_1", title: { hr: "Vize" } },
      { kind: "drafts", id: "l_1", name: "Newsletter", n: 2 },
      { kind: "list", id: "l_1", name: "Newsletter" },
    ],
    missing: { milestones: { sr: 2, hr: 1 }, prayer: {} },
    ...over,
  };
}

async function boot({ snap = snapshot(), hm = home() } = {}) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://next.thauma.one/staff/",
  });
  const w = dom.window;
  w.fetch = async (u) => {
    const body = String(u).includes("staff-snapshot") ? snap : String(u).includes("staff-home") ? hm : {};
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  const opened = [];
  w.StaffSupporterDialog = { open: (...a) => opened.push(a) };
  await settle(200);
  const d = w.document;
  const text = (sel) => [...d.querySelectorAll(sel)].map((n) => n.textContent.trim());
  return { w, d, opened, text };
}

await check("the page is Home, and so is its link", async () => {
  const d = new JSDOM(readFileSync(PAGE, "utf8")).window.document;
  assert(/^Home ·/.test(d.title), `title ${d.title}`);
  const link = d.querySelector('a[aria-current="page"][data-i18n="nav.home"]');
  assert(link && link.textContent.trim() === "Home", "the nav names it Home");
  assert(!d.getElementById("tiles") && !d.querySelector(".quick"), "the old dashboard is gone");
});

await check("four numbers, each a link to where it lives", async () => {
  const { d, text } = await boot();
  eq(text(".hm-stat b"), ["9", "1", "68%", "8"], "values");
  eq([...d.querySelectorAll(".hm-stat")].map((a) => a.getAttribute("href")),
    ["/staff/stewardship/", "/staff/stewardship/", "/staff/updates/#goals", "/staff/updates/#milestones"], "links");
});

await check("gone quiet: never contacted and 120+ days, worst first, five at most", async () => {
  const { d, text } = await boot();
  assert(!d.getElementById("hmQuiet").hidden, "shown");
  eq(text("#hmQuietRows .hm-nm"), ["Ivana Test", "Marko Test", "Petra Test", "Luka Test", "Ana Test"], "rows");
  eq(text("#hmQuietRows .hm-sev")[0], "No personal contact yet", "never");
  assert(/195/.test(text("#hmQuietRows .hm-sev")[1]), "days");
  assert(/120\+/.test(d.getElementById("hmQuietH").textContent), "the heading says the threshold");
});

await check("Log a contact opens that person's dialog, straight to logging", async () => {
  const { w, d, opened } = await boot();
  const b = d.querySelectorAll("#hmQuietRows [data-log]")[1];
  b.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  eq(opened.length, 1, "opened once");
  eq(opened[0][0], "c_195", "whose");
  eq(opened[0][2], true, "to logging");
});

await check("not finished: each with the button that does it", async () => {
  const { d, text } = await boot();
  eq(text("#hmTodoRows .hm-nm"), ["Get Fingerprinted", "Vize", "Newsletter", "Newsletter"], "titles, any language when not English");
  eq([...d.querySelectorAll("#hmTodoRows a")].map((a) => a.getAttribute("href")), [
    "/staff/updates/?open=ms_1#milestones", "/staff/updates/?open=pr_1#prayer",
    "/staff/mail/#drafts", "/staff/sharing/#signup"], "where each goes");
  eq(text("#hmTodoRows .hm-sub")[2], "Mail · 2 drafts, not sent", "drafts counted");
});

await check("waiting for translation: a chip per language, in the ministry's order", async () => {
  const { d, text } = await boot();
  eq(text("#hmLangRows .hm-nm"), ["Timeline"], "only sections with gaps");
  eq(text("#hmLangRows .hm-chip"), ["HR 1", "SR 2"], "chips");
  assert(d.querySelector("#hmLangRows .hm-chip").title.includes("Hrvatski"), "the chip's title names the language");
  eq(d.querySelector("#hmLangRows a").getAttribute("href"), "/staff/updates/#milestones", "Translate goes there");
});

await check("names withheld (not the owner): no people, numbers still there", async () => {
  const { d, text } = await boot({ snap: snapshot({ contacts: [], stewardship_withheld: true }) });
  assert(d.getElementById("hmQuiet").hidden, "no Gone quiet");
  eq(text(".hm-stat b").length, 4, "numbers");
});

await check("a role without Stewardship sees no supporter numbers or people", async () => {
  const { d, text } = await boot({ snap: snapshot({ you: { roles: ["communications"] } }) });
  eq(text(".hm-stat b"), ["68%", "8"], "numbers");
  assert(d.getElementById("hmQuiet").hidden, "no people");
});

await check("nothing waiting: one calm line, and no empty sections", async () => {
  const { d } = await boot({
    snap: snapshot({ contacts: [person("c_30", "Recent", 30)] }),
    hm: home({ unfinished: [], missing: { milestones: {}, prayer: {} } }),
  });
  assert(!d.getElementById("hmCalm").hidden, "calm line");
  for (const id of ["hmQuiet", "hmTodo", "hmLang"]) assert(d.getElementById(id).hidden, `${id} hidden`);
});

await check("the supporter dialog is one include, on both pages", async () => {
  for (const f of [PAGE, STEW]) {
    const d = new JSDOM(readFileSync(f, "utf8")).window.document;
    assert(d.getElementById("swBack") && d.getElementById("swTouchForm"), `${f} has the dialog`);
    assert([...d.scripts].some((s) => /staff-stewardship\.js/.test(s.src)), `${f} loads its script`);
  }
});

await check("the dialog's own tabs are not page tabs (no #undefined)", async () => {
  const { w } = await boot();
  assert(!/undefined/.test(w.location.hash), `hash ${w.location.hash}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
