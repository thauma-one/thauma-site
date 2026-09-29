#!/usr/bin/env node
/**
 * Updates — edit freely, then Publish
 *   node test/updates-page.test.mjs
 *
 * Chase's option B (2026-09-26): milestones, goals, prayer and videos all
 * work one way. Every change — an edit, a new item, the switch on a row, a
 * delete — waits in the list as "not live yet" until the page's ONE bar says
 * Publish changes. This loads the built page, runs the real scripts, clicks
 * the real rows and buttons, and reads what reaches `fetch`. (Videos has its
 * own file: videos-console.test.mjs.)
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/updates/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/updates/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
/* Compared as JSON, so a pair of values reads as one fact. */
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

console.log("Updates — edit freely, then Publish\n");
if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(1);
}

const LANGS = [{ code: "en", name: "English", is_enabled: true }, { code: "hr", name: "Hrvatski", is_enabled: true }];
const DATA = () => ({
  "staff-milestones": {
    languages: LANGS, preferred_lang: "en",
    milestones: [{
      id: "m1", status: "in_progress", completion: 40, actual_date: "", parent_id: null,
      is_public: true, is_featured: false,
      text: { en: { title: "Build the studio", description: null, target_label: null } },
    }],
  },
  "staff-goals": {
    goals: [{
      goal_id: "g1", label: "Cameras", description: null, kind: "project",
      target_cents: 500000, currency: "USD", is_public: true, raised_cents: 100000, donor_count: 3,
    }],
  },
  "staff-prayer": {
    languages: LANGS, preferred_lang: "en",
    prayer: [{
      id: "p1", is_public: false, is_answered: false, answered_on: null, sort_order: 0,
      text: { en: { title: "Visas", description: null, answer_text: null } },
    }],
  },
  "staff-videos": { channel: null, videos: [], links: [] },
  /* The embed data the preview starts from: what is LIVE. */
  "staff-embed": { version: 1, partner: { slug: "chase-roush", display_name: "Chase Roush" },
    theme: { accent: "#1AE4FF", mode: "auto" }, languages: [{ code: "en" }],
    milestones: [], goals: [{ id: "g1", label: "Cameras" }], prayer: [], videos: [], shared: [] },
});

async function boot({ oneLanguage = false, milestones = null } = {}) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/updates/",
  });
  const w = dom.window;
  const sent = [];
  const toasts = [];
  const data = DATA();
  if (milestones) data["staff-milestones"].milestones = milestones;
  if (oneLanguage) for (const k of Object.keys(data)) if (data[k].languages) data[k].languages = [LANGS[0]];
  w.fetch = async (url, opts = {}) => {
    url = String(url);
    const method = opts.method || "GET";
    if (method !== "GET") sent.push({ url, method, body: opts.body ? JSON.parse(opts.body) : null });
    /* Workers AI stand-in: every piece comes back marked with its language. */
    if (url.includes("/api/translate")) {
      const b = opts.body ? JSON.parse(opts.body) : null;
      const reply = b ? { items: b.items.map((i) => ({ id: i.id, text: "«" + b.to + "» " + i.text })) } : { available: true };
      return { ok: true, status: 200, json: async () => reply };
    }
    const key = Object.keys(data).find((k) => url.includes("/api/" + k));
    const reply = method === "GET" && key ? data[key] : {};
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(reply)) };
  };
  /* The panel's open and close are animated; reduced motion makes them
     immediate, which is all a test needs. */
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "console-translate.js", "staff-updates.js", "staff-rowpanel.js",
                   "staff-milestones.js", "staff-goals.js", "staff-prayer.js", "staff-videos.js",
                   "staff-updates-preview.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }
  w.StaffToast = (msg, kind) => toasts.push({ msg, kind });
  w.StaffConfirm = async () => true;
  await settle(150);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const row = (list, id) => d.querySelector(`#${list} .ms-row[data-id="${id}"]`);
  const bar = () => d.getElementById("upBar");
  const publish = async () => { click(d.getElementById("upPublish")); await settle(200); };
  const done = async (form) => {
    d.getElementById(form).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  };
  return { w, d, sent, toasts, click, row, bar, publish, done };
}

await check("milestones are listed by date, undated last, each sub-milestone under its parent", async () => {
  /* Chase, 2026-09-28: by sort date, not by when each was created. Given
     here in creation order, which is how the list used to show them. */
  const m = (id, date, parent = null) => ({ id, status: "upcoming", completion: 0, actual_date: date,
    parent_id: parent, is_public: true, is_featured: false,
    text: { en: { title: id, description: null, target_label: null } } });
  const { d } = await boot({ milestones: [m("visa", "2027-04-01"), m("undated", ""), m("board", "2026-09-01"),
    m("submit", "2027-06-01", "visa"), m("prints", "2027-04-10", "visa"), m("move", "2027-09-30")] });
  const order = [...d.querySelectorAll("#msList .ms-row")].map((r) => r.dataset.id);
  if (JSON.stringify(order) !== JSON.stringify(["board", "visa", "prints", "submit", "move", "undated"]))
    throw new Error("order " + JSON.stringify(order));
});

await check("currency is chosen from a named list, the common ones first", async () => {
  const { w, d } = await boot();
  d.querySelector('#glList [data-id="g1"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  const sel = d.getElementById("glCurrency");
  if (sel.tagName !== "SELECT") throw new Error("still a text box");
  if (sel.value !== "USD") throw new Error("the goal's own currency is not selected: " + sel.value);
  if (!/^EUR — Euro/.test(sel.options[1].text)) throw new Error("second option " + sel.options[1].text);
  if (sel.options.length < 100) throw new Error("only " + sel.options.length + " currencies");
});

await check("every row carries its own published switch, and nothing is waiting on arrival", async () => {
  const { d, row, bar } = await boot();
  for (const [list, id] of [["msList", "m1"], ["glList", "g1"], ["prList", "p1"]]) {
    assert(row(list, id), `no row ${id}`);
    assert(row(list, id).querySelector(".switch[data-pub]"), `${id} has no switch on the row`);
  }
  eq(row("msList", "m1").querySelector("[data-pub]").getAttribute("aria-checked"), "true", "m1 switch");
  eq(bar().hidden, true, "the bar with nothing to publish");
  eq(d.querySelectorAll(".tabs .tab.is-dirty").length, 0, "no tab marked");
});

await check("the switch on a row waits for Publish, then goes out", async () => {
  const { d, sent, click, row, bar, publish } = await boot();
  click(row("msList", "m1").querySelector("[data-pub]"));
  await settle();
  eq(sent.length, 0, "flipping the switch sent something");
  eq(bar().hidden, false, "the bar should be up");
  assert(/1 milestone/.test(d.getElementById("upCount").textContent), d.getElementById("upCount").textContent);
  assert(row("msList", "m1").classList.contains("is-dirty"), "the row should be marked");
  assert(/Not live yet/.test(row("msList", "m1").textContent), "the row should say it is not live yet");
  assert(d.querySelector('.tab[data-tab="milestones"]').classList.contains("is-dirty"), "the tab should be marked");
  await publish();
  const post = sent.find((s) => s.method === "POST" && s.url.includes("staff-milestones"));
  assert(post, "Publish sent nothing");
  eq(post.body.is_public, false, "it should go out switched off");
  eq(post.body.id, "m1", "and as the same milestone");
});

await check("the whole row opens its editor; Done keeps the edit, Cancel undoes it", async () => {
  const { d, click, row, bar, done } = await boot();
  click(row("prList", "p1"));
  await settle();
  const form = d.getElementById("prForm");
  eq(form.hidden, false, "the editor did not open");
  eq(form.previousElementSibling && form.previousElementSibling.dataset.id, "p1", "it should open under its row");
  const title = form.querySelector('[data-ptx="title"][data-col="a"]');
  eq(title.value, "Visas", "the editor shows the request");
  title.value = "Visas for the team";
  await done("prForm");
  eq(form.hidden, true, "Done should close it");
  assert(/Visas for the team/.test(row("prList", "p1").textContent), "the row should show the edit");
  assert(/1 prayer request/.test(d.getElementById("upCount").textContent), "the bar should count it");

  click(row("prList", "p1"));
  await settle();
  form.querySelector('[data-ptx="title"][data-col="a"]').value = "Something else";
  click(d.getElementById("prCancel"));
  await settle();
  assert(/Visas for the team/.test(row("prList", "p1").textContent), "Cancel should put back what was there");
  eq(bar().hidden, false, "the earlier edit is still waiting");
});

await check("opening any row and pressing Done changes nothing", async () => {
  const { click, row, bar, done } = await boot();
  for (const [list, id, form] of [["msList", "m1", "msForm"], ["glList", "g1", "glForm"], ["prList", "p1", "prForm"]]) {
    click(row(list, id));
    await settle();
    await done(form);
    eq(bar().hidden, true, `${id} reads as changed after merely being opened`);
  }
});

await check("Editing one language with another for reference: typing survives a switch, and the other shows above", async () => {
  const { w, d, sent, click, row, done, publish } = await boot();
  click(row("prList", "p1"));
  await settle();
  const writing = d.getElementById("prLangA"), beside = d.getElementById("prLangB");
  eq(writing.value, "en", "writing opens on the person's language");
  eq(beside.value, "hr", "beside opens on another");
  assert(/missing/i.test(writing.querySelector('option[value="hr"]').textContent),
    "a language with no words should say so in the list");
  const title = () => d.querySelector('#prForm [data-ptx="title"]');
  title().value = "Visas, soon";
  writing.value = "hr";
  writing.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(title().value, "", "Croatian has no words yet");
  const ref = d.querySelector('#prForm [data-pref="title"]');
  eq([ref.hidden, ref.textContent], [false, "Visas, soon"], "the English, typed a moment ago, shows above");
  title().value = "Vize";
  writing.value = "en";
  writing.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(title().value, "Visas, soon", "switching back keeps what was typed");
  await done("prForm");
  await publish();
  const post = sent.find((s) => s.method === "POST" && s.url.includes("staff-prayer"));
  eq([post.body.text.en.title, post.body.text.hr.title], ["Visas, soon", "Vize"], "both languages");
});

await check("the swap button trades Editing and Reference, and keeps what was typed", async () => {
  /* Chase, 2026-09-28: "Editing: Language" and "Reference: Language" with a
     swap button between them. */
  const { w, d, click, row } = await boot();
  click(row("prList", "p1"));
  await settle();
  const edit = d.getElementById("prLangA"), ref = d.getElementById("prLangB");
  eq(d.querySelector("#prForm .ms-pick span").textContent, "Editing", "the label");
  d.querySelector('#prForm [data-ptx="title"]').value = "Visas, soon";
  click(d.querySelector("#prForm [data-lang-swap]"));
  await settle(120);
  eq([edit.value, ref.value], ["hr", "en"], "swapped");
  eq(d.querySelector('#prForm [data-pref="title"]').textContent, "Visas, soon", "the English, typed, is the reference");
  click(d.querySelector("#prForm [data-lang-swap]"));
  await settle(120);
  eq([edit.value, ref.value, d.querySelector('#prForm [data-ptx="title"]').value], ["en", "hr", "Visas, soon"], "and back");
});

await check("Translate fills the empty fields from the reference, as if typed", async () => {
  const { w, d, click, row } = await boot();
  assert(d.documentElement.classList.contains("has-ai"), "the button is not offered where AI is on");
  click(row("prList", "p1"));
  await settle();
  const edit = d.getElementById("prLangA");
  edit.value = "hr";
  edit.dispatchEvent(new w.Event("change", { bubbles: true }));
  /* jsdom lays nothing out, so "on screen" is taken as given here. */
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; }, configurable: true });
  click(d.querySelector("#prForm [data-lang-translate]"));
  await settle(200);
  eq(d.querySelector('#prForm [data-ptx="title"]').value, "«hr» Visas", "the title, from English");
});

await check("the milestone editor writes the same way", async () => {
  const { w, d, click, row, done } = await boot();
  click(row("msList", "m1"));
  await settle();
  const title = () => d.querySelector('#msForm [data-tx="title"]');
  const writing = d.getElementById("msLangA");
  writing.value = "hr";
  writing.dispatchEvent(new w.Event("change", { bubbles: true }));
  const ref = d.querySelector('#msForm [data-ref="title"]');
  eq([ref.hidden, ref.textContent], [false, "Build the studio"], "the English above");
  title().value = "Izgradnja studija";
  writing.value = "en";
  writing.dispatchEvent(new w.Event("change", { bubbles: true }));
  eq(title().value, "Build the studio", "English is still English");
  await done("msForm");
  assert(/1 milestone/.test(d.getElementById("upCount").textContent), "the Croatian title is waiting");
});

await check("with one language there is nothing to write beside", async () => {
  const { d, click, row } = await boot({ oneLanguage: true });
  click(row("msList", "m1"));
  await settle();
  eq(d.getElementById("msBesideWrap").hidden, true, "beside should go away");
});

await check("the preview beside the list draws the working copy, not just what is live", async () => {
  const { w, d, click, row } = await boot();
  click(d.getElementById("upPreviewBtn"));
  await settle(150);
  eq(d.getElementById("upPreview").hidden, false, "the preview did not open");
  const drawn = () => {
    const m = /window\.__thaumaPreview=(.*?)<\/script>/.exec(d.getElementById("upFrame").srcdoc || "");
    return m ? JSON.parse(m[1]) : null;
  };
  eq(drawn().milestones.map((m) => m.id), ["m1"], "the published milestone");
  click(row("msList", "m1").querySelector("[data-pub]"));
  await settle(300);
  eq(drawn().milestones, [], "switched off but not published — the preview already shows it gone");
  assert(/sharing\/#roadmap$/.test(d.getElementById("upShareLink").href), "the link to its settings");
  click(d.querySelector('.tab[data-tab="goals"]'));
  await settle(300);
  assert(/data-widget/.test(d.getElementById("upFrame").srcdoc) === false, "goals is the default widget");
  eq(drawn().goals.map((g) => g.label), ["Cameras"], "the goals tab draws goals");
});

await check("the preview stays open across a reload", async () => {
  const { d, click } = await boot();
  click(d.getElementById("upPreviewBtn"));
  await settle(100);
  eq(d.defaultView.sessionStorage.getItem("thauma.updates.preview"), "1", "remembered");
});

await check("a delete waits for Publish, Keep takes it back, and Publish asks first", async () => {
  const { w, d, sent, click, row, bar, publish } = await boot();
  click(row("glList", "g1"));
  await settle();
  eq(d.getElementById("glDelete").hidden, false, "Delete belongs in the editor");
  click(d.getElementById("glDelete"));
  await settle();
  eq(sent.length, 0, "the delete went out on the press");
  assert(row("glList", "g1").classList.contains("is-removed"), "the row should show it is going");
  const keep = row("glList", "g1").querySelector("[data-keep]");
  assert(keep, "no Keep on a removed row");
  click(keep);
  await settle();
  eq(bar().hidden, true, "kept, so nothing is waiting");

  click(row("glList", "g1"));
  await settle();
  click(d.getElementById("glDelete"));
  await settle();
  let asked = null;
  w.StaffConfirm = async (o) => { asked = o; return false; };
  await publish();
  assert(asked && asked.danger, "Publish should ask before deleting");
  eq(sent.length, 0, "refused, so nothing sent");
  w.StaffConfirm = async () => true;
  await publish();
  const del = sent.find((s) => s.method === "DELETE");
  assert(del && /staff-goals\?id=g1$/.test(del.url), JSON.stringify(sent));
});

await check("one bar counts every section, and Discard puts all of it back", async () => {
  const { d, sent, click, row, bar } = await boot();
  click(row("msList", "m1").querySelector("[data-pub]"));
  click(row("glList", "g1").querySelector("[data-pub]"));
  click(row("prList", "p1").querySelector("[data-pub]"));
  await settle();
  eq(d.getElementById("upCount").textContent,
    "3 changes not live yet — 1 milestone, 1 goal, 1 prayer request", "the bar's count");
  click(d.getElementById("upDiscard"));
  await settle();
  eq(bar().hidden, true, "Discard should empty the bar");
  eq(row("prList", "p1").querySelector("[data-pub]").getAttribute("aria-checked"), "false", "p1 back off");
  eq(row("glList", "g1").querySelector("[data-pub]").getAttribute("aria-checked"), "true", "g1 back on");
  eq(sent.length, 0, "Discard sent something");
});

await check("a new request with no words is not added; with words it waits, switched off", async () => {
  const { d, sent, click, bar, done, publish } = await boot();
  click(d.getElementById("prAdd"));
  await settle();
  await done("prForm");
  eq(d.querySelectorAll("#prList .ms-row").length, 1, "an empty request was added");
  eq(bar().hidden, true, "and counted");

  click(d.getElementById("prAdd"));
  await settle();
  d.querySelector('#prForm [data-ptx="title"][data-col="a"]').value = "Rain";
  await done("prForm");
  eq(d.querySelectorAll("#prList .ms-row").length, 2, "the new request should be listed");
  await publish();
  const post = sent.find((s) => s.method === "POST" && s.url.includes("staff-prayer"));
  assert(post, "nothing published");
  eq(post.body.id, undefined, "a new request has no id yet");
  eq(post.body.is_public, false, "new things start off the site");
  eq(post.body.text.en.title, "Rain", "the words");
});

await check("a new goal's opening figure goes in the same write", async () => {
  const { d, sent, click, done, publish } = await boot();
  click(d.getElementById("glAdd"));
  await settle();
  d.getElementById("glLabel").value = "Lights";
  d.getElementById("glTarget").value = "2000";
  d.getElementById("glRaised").value = "250";
  await done("glForm");
  await publish();
  const posts = sent.filter((s) => s.url.includes("staff-goals"));
  eq(posts.length, 1, "one request");
  eq(posts[0].method, "POST", "a POST");
  eq(posts[0].body.target_cents, 200000, "target");
  eq(posts[0].body.raised_cents, 25000, "opening figure");
});

await check("leaving with changes not live yet asks the browser's question", async () => {
  const { w, click, row } = await boot();
  const quiet = new w.Event("beforeunload", { cancelable: true });
  w.dispatchEvent(quiet);
  eq(quiet.defaultPrevented, false, "nothing waiting, nothing to ask");
  click(row("msList", "m1").querySelector("[data-pub]"));
  const ev = new w.Event("beforeunload", { cancelable: true });
  w.dispatchEvent(ev);
  eq(ev.defaultPrevented, true, "changes waiting should hold the page");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
