#!/usr/bin/env node
/**
 * Website › Forms — Thauma's own forms, in the admin console
 *   node test/website-forms.test.mjs
 *
 * Chase, 2026-09-27: "staff is only for staff functions and admin is for
 * admin". Thauma's contact and sign-up forms left staff Sharing for here.
 * What lives here is what happens to what a visitor sends — never words:
 * thauma.one's forms are part of its pages, so their words are site words
 * in Pages. This runs the real script against the built page.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/admin/website/forms/index.html`)
  .find((p) => existsSync(p)) || "_site/admin/website/forms/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

console.log("Website › Forms\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(1); }

const ANSWER = {
  scope: "organization",
  lists: [
    { id: "l_news", name: "Newsletter", is_open: 1, archive_public: 1, from_name: "Thauma",
      from_email: "news@thauma.one", reply_to: "", description: "", form_thanks_url: "" },
    { id: "l_pray", name: "Prayer", is_open: 0, archive_public: 0, from_name: "Thauma",
      from_email: "prayer@thauma.one", reply_to: "", description: "", form_thanks_url: "" },
  ],
  contact: { deliver_to: "contact@thauma.one", from_address: "contact@thauma.one", is_open: 1,
             heading: "", blurb: "", button: "", thanks: "" },
  topics: [{ label: "General", deliver_to: "" }],
  senders: [{ address: "contact@thauma.one" }, { address: "news@thauma.one" }],
};

async function boot() {
  const sent = [], asked = [];
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/admin/website/forms/",
  });
  const w = dom.window;
  w.fetch = async (url, opts = {}) => {
    asked.push(String(url));
    if ((opts.method || "GET") !== "GET") sent.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(ANSWER)) };
  };
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "admin-forms.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffToast = () => {};
  w.StaffConfirm = async () => true;
  await settle(150);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); };
  return { w, d, sent, asked, click, type };
}

await check("Thauma's forms, read as Thauma's", async () => {
  const { d, asked } = await boot();
  const mail = asked.filter((u) => u.includes("/api/staff-mailing"));
  assert(mail.length && mail.every((u) => /scope=organization/.test(u)), `asked ${mail.join(", ")}`);
  eq(d.getElementById("wfCtTo").value, "contact@thauma.one", "where messages go");
  eq(d.getElementById("wfCtOpen").getAttribute("aria-checked"), "true", "live");
  eq(d.querySelectorAll("#wfTopics .ct-topic").length, 1, "the reasons");
  eq(d.getElementById("wfBar").hidden, true, "nothing waits on arrival");
});

await check("no words here: they are the page's, in Pages", async () => {
  const { d } = await boot();
  eq(d.querySelectorAll("#wfRoot [data-word], #wfRoot textarea").length, 0, "a word field on Forms");
  const link = d.querySelector('#wfRoot [data-web-go="pages"][data-pages-section="contact"]');
  assert(link, "no way to the contact page's words");
});

await check("where messages go waits for Save, and goes whole with the reasons", async () => {
  const { d, sent, click, type } = await boot();
  type(d.getElementById("wfCtTo"), "hello@thauma.one");
  eq(d.getElementById("wfBar").hidden, false, "the bar should be up");
  eq(sent.length, 0, "sent at once");
  click(d.getElementById("wfSave"));
  await settle(150);
  eq(sent.length, 1, "one request");
  assert(/scope=organization/.test(sent[0].url), "saved to a ministry's form");
  eq([sent[0].body.action, sent[0].body.deliver_to, sent[0].body.topics],
     ["contact-form", "hello@thauma.one", [{ label: "General", deliver_to: "", labels: {} }]], "the form");
});

await check("the sign-up form's lists: a list saved whole, its archive switch kept", async () => {
  const { d, sent, click } = await boot();
  click(d.querySelector('[data-wf="signup"]'));
  eq(d.querySelector('[data-wf-panel="signup"]').hidden, false, "the sign-up form");
  click(d.querySelector('#wfLists [data-list="l_pray"]'));
  click(d.getElementById("wfSave"));
  await settle(150);
  eq(sent.length, 1, "only the list that changed");
  eq([sent[0].body.id, sent[0].body.is_open, sent[0].body.archive_public, sent[0].body.name],
     ["l_pray", true, false, "Prayer"], "the list");
});

await check("a reason is written in each of the site's languages, English its fallback", async () => {
  const { w, d, sent, click, type } = await boot();
  eq(d.getElementById("wfWritingRow").hidden, false, "no language picker");
  const pickLang = (v) => { const s = d.getElementById("wfWriting"); s.value = v;
    s.dispatchEvent(new w.Event("change", { bubbles: true })); };
  pickLang("hr");
  const input = d.querySelector("#wfTopics .ct-topic-label");
  eq([input.value, input.placeholder], ["", "General"], "an unwritten language shows the English as its hint");
  eq(d.querySelector("#wfTopics .ms-ref").textContent, "General", "English beside it");
  type(input, "Općenito");
  pickLang("en");
  eq(d.querySelector("#wfTopics .ct-topic-label").value, "General", "English untouched");
  click(d.getElementById("wfSave"));
  await new Promise((r) => setTimeout(r, 150));
  eq(sent[0].body.topics, [{ label: "General", deliver_to: "", labels: { hr: "Općenito" } }], "saved");
});

await check("Discard puts it back", async () => {
  const { d, click, type } = await boot();
  type(d.getElementById("wfCtTo"), "x@thauma.one");
  click(d.getElementById("wfDiscard"));
  await settle(60);
  eq(d.getElementById("wfCtTo").value, "contact@thauma.one", "the address");
  eq(d.getElementById("wfBar").hidden, true, "the bar");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
