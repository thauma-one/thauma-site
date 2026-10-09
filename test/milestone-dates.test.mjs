#!/usr/bin/env node
/**
 * A milestone's date, picked once — and its status, from its progress
 *   node test/milestone-dates.test.mjs
 *
 * Board 8 (Chase, 2026-09-26). The console previews each language's "When";
 * the Worker (workers/src/lib/when.js) writes it on save. Two copies of one
 * rule, so the first check here is that they say the same thing: this drives
 * the real editor, reads its preview, and compares it with the Worker's
 * sentence for the same date.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { whenLabel } from "../workers/src/lib/when.js";
import { wordsFor } from "../workers/src/lib/mail-i18n.js";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/updates/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/updates/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("a milestone's date and status\n");
if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(1);
}

const LANGS = [
  { code: "en", name: "English", is_enabled: true },
  { code: "hr", name: "Hrvatski", is_enabled: true },
  { code: "sr", name: "Српски", is_enabled: true },
  { code: "sl", name: "Slovenščina", is_enabled: true },
];
const OLD = {
  /* From before dates were picked: a typed sentence, a sort date, and a
     status that does not follow its figure. Opening it must change nothing. */
  id: "m_old", status: "complete", completion: 60, actual_date: "2026-09-30",
  date_precision: null, end_date: null, parent_id: null, is_public: true, is_featured: false,
  text: { en: { title: "File for 501(c)3", description: "", target_label: "End of September – October 2026" } },
};
const PICKED = {
  id: "m_new", status: "upcoming", completion: 40, actual_date: "2026-09-01",
  date_precision: "month", end_date: null, parent_id: null, is_public: true, is_featured: false,
  text: { en: { title: "Board of Directors", description: "", target_label: "September 2026" },
          hr: { title: "Upravni odbor", description: "", target_label: "rujan 2026." } },
};

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/updates/",
  });
  const w = dom.window;
  const sent = [];
  w.fetch = async (url, opts = {}) => {
    url = String(url);
    const method = opts.method || "GET";
    if (method !== "GET") sent.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    const reply = method === "GET" && url.includes("staff-milestones")
      ? { languages: LANGS, preferred_lang: "en", date_words: wordsFor("dates."),
          milestones: JSON.parse(JSON.stringify([OLD, PICKED])) }
      : {};
    return { ok: true, status: 200, json: async () => reply };
  };
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-updates.js", "staff-rowpanel.js", "staff-milestones.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }
  w.StaffToast = () => {};
  w.StaffConfirm = async () => true;
  await settle(150);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const open = async (id) => { click(d.querySelector(`#msList .ms-row[data-id="${id}"]`)); await settle(); };
  const done = async () => {
    d.getElementById("msForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  };
  /* Fill one end of the date the way a person would: the inputs its
     precision shows, then the change event. */
  const fillSlot = (slot, v) => {
    const el = d.getElementById(slot);
    const set = (w_, val) => { const f = el.querySelector(`[data-w="${w_}"]`); f.value = String(val); };
    if (typeof v === "string") set("d", v);
    else { if (v.m) set("m", v.m); if (v.s) set("s", v.s); set("y", v.y); }
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  const prec = (p) => click(d.querySelector(`#msPrec [data-prec="${p}"]`));
  const preview = () => [...d.querySelectorAll("#msGen div")].map((x) =>
    [x.querySelector("b").textContent, x.textContent.slice(x.querySelector("b").textContent.length)]);
  return { w, d, sent, click, open, done, fillSlot, prec, preview };
}

await check("the preview is exactly the sentence the Worker will store, in every language", async () => {
  const { open, prec, fillSlot, preview } = await boot();
  await open("m_new");
  const CASES = [
    ["day", "2026-09-03", "", "2026-09-03", null],
    ["day", "2026-09-03", "2026-09-12", "2026-09-03", "2026-09-12"],
    ["month", { m: 9, y: 2026 }, { m: 10, y: 2026 }, "2026-09-01", "2026-10-01"],
    ["month", { m: 11, y: 2026 }, { m: 2, y: 2027 }, "2026-11-01", "2027-02-01"],
    ["season", { s: "winter", y: 2026 }, "", "2026-12-01", null],
    ["season", { s: "summer", y: 2027 }, { s: "autumn", y: 2027 }, "2027-06-01", "2027-09-01"],
    ["year", { y: 2027 }, { y: 2028 }, "2027-01-01", "2028-01-01"],
  ];
  for (const [p, from, to, start, end] of CASES) {
    prec(p);
    fillSlot("msFrom", from);
    if (to) fillSlot("msTo", to);
    else fillSlot("msTo", p === "day" ? "" : { y: "" });
    const want = LANGS.map((l) => [l.native_name || l.name, whenLabel(l.code, p, start, end)]);
    eq(preview(), want, `${p} ${JSON.stringify(from)}${to ? " – " + JSON.stringify(to) : ""}`);
  }
});

await check("opening a milestone from before and closing it changes nothing", async () => {
  const { d, open, done } = await boot();
  await open("m_old");
  assert(d.getElementById("msForm").classList.contains("is-typed"),
    "its typed sentence should be what the editor shows");
  eq(d.querySelector('#msForm [data-tx="target_label"][data-col="a"]').value,
    "End of September – October 2026", "the typed sentence");
  await done();
  eq(d.getElementById("upBar").hidden, true, "nothing was changed, so nothing waits");
  await open("m_new");
  await done();
  eq(d.getElementById("upBar").hidden, true, "a picked one, untouched, is unchanged too");
});

await check("picking a date writes every language's When and publishes the date, snapped", async () => {
  const { d, sent, open, done, prec, fillSlot } = await boot();
  await open("m_old");
  d.getElementById("msMyWay").click();
  prec("season");
  fillSlot("msFrom", { s: "autumn", y: 2026 });
  await done();
  assert(/Fall 2026/.test(d.querySelector('#msList .ms-row[data-id="m_old"]').textContent),
    "the row should show the new sentence before it is published");
  d.getElementById("upPublish").click();
  await settle(200);
  const post = sent.find((s) => s.method === "POST");
  eq([post.body.date_precision, post.body.actual_date, post.body.end_date],
    ["season", "2026-09-01", null], "what is published");
  eq(post.body.text.en.target_label, "Fall 2026", "English");
});

await check("Write it my way starts from the sentence the date makes", async () => {
  const { d, sent, open, done } = await boot();
  await open("m_new");
  d.getElementById("msMyWay").click();
  const typed = d.querySelector('#msForm [data-tx="target_label"][data-col="a"]');
  eq(typed.value, "September 2026", "starts from the picked sentence");
  typed.value = "Early autumn";
  await done();
  d.getElementById("upPublish").click();
  await settle(200);
  const post = sent.find((s) => s.method === "POST");
  eq([post.body.date_precision, post.body.text.en.target_label], ["custom", "Early autumn"], "typed");
});

await check("progress sets the status; Upcoming and Canceled are decisions beside it", async () => {
  const { w, d, sent, open, done, click } = await boot();
  await open("m_new");
  const out = () => d.getElementById("msProgOut").textContent;
  eq(out(), "Upcoming", "an Upcoming milestone says so, not its figure");
  click(d.getElementById("msUpcoming"));
  eq(out(), "40% · In progress", "switched off, the figure speaks");
  const range = d.getElementById("msCompletion");
  range.value = "100";
  range.dispatchEvent(new w.Event("input", { bubbles: true }));
  eq(out(), "100% · Complete", "100% is complete");
  click(d.getElementById("msCanceled"));
  eq(out(), "Canceled", "canceled");
  click(d.getElementById("msUpcoming"));
  eq(d.getElementById("msCanceled").getAttribute("aria-checked"), "false", "Upcoming ends Canceled");
  click(d.getElementById("msUpcoming"));
  await done();
  d.getElementById("upPublish").click();
  await settle(200);
  const post = sent.find((s) => s.method === "POST");
  eq([post.body.status, post.body.completion], ["complete", 100], "what is published");
});

await check("an Upcoming row shows no progress in the list", async () => {
  const { d } = await boot();
  const row = d.querySelector('#msList .ms-row[data-id="m_new"]');
  assert(!/40%/.test(row.textContent), `the row shows its figure: ${row.textContent}`);
  assert(/60%/.test(d.querySelector('#msList .ms-row[data-id="m_old"]').textContent),
    "a started one still does");
});

await check("a new milestone starts Upcoming, with its date picked by the month", async () => {
  const { d, click } = await boot();
  click(d.getElementById("msAdd"));
  await settle();
  eq(d.getElementById("msUpcoming").getAttribute("aria-checked"), "true", "Upcoming");
  eq(d.querySelector("#msPrec .is-on").dataset.prec, "month", "month");
  eq(d.getElementById("msGen").hidden, true, "no date yet, no preview");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
