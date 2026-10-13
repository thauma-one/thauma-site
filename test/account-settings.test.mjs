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
const labels = (d, panel) => [...d.querySelectorAll(`[data-panel="${panel}"] .set-lbl`)]
  .filter((l) => !l.closest("[hidden]")).map((l) => l.textContent.trim());

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

await check("Notifications: its own tab, the bell and email, a switch per notice each, kept by PATCH (0056, 0060)", async () => {
  /* Its own tab (2026-10-13, Chase: "I wanted a separate notifications tab,
     not for it to be built into account"); Account keeps the board's lines.
     The bell ("Add the in app notifications bell") switches on its own. */
  const none = await boot();
  assert(none.d.getElementById("setNotifyTab").hidden, "a tab for somebody who receives nothing");
  ANSWER.you.notices = [{ kind: "invite_accepted", on: true, bell: false }];
  try {
    const { w, d } = await boot();
    eq(labels(d, "account"), ["Email", "Console language", "What you can do", "Activity", "Sign out"], "Account unchanged");
    assert(!d.getElementById("setNotifyTab").hidden, "no Notifications tab");
    eq([...d.querySelectorAll('[data-panel="notifications"] .set-group')].map((h) => h.textContent), ["In the console", "By email"], "groups");
    eq([...d.querySelectorAll('#setNotifyBell .set-lbl, #setNotify .set-lbl')].map((l) => l.textContent),
       ["Someone accepts their invitation", "Someone accepts their invitation"], "a row in each");
    const bell = d.querySelector('#setNotifyBell [data-notice="invite_accepted"]');
    const mail = d.querySelector('#setNotify [data-notice="invite_accepted"]');
    eq([bell.getAttribute("aria-checked"), mail.getAttribute("aria-checked")], ["false", "true"], "each its own state");
    let sent = [];
    w.fetch = async (u, o) => { if (o && o.method === "PATCH") sent.push(JSON.parse(o.body));
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(ANSWER)) }; };
    mail.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await settle(100);
    d.querySelector('#setNotifyBell [data-notice="invite_accepted"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await settle(100);
    eq(sent, [{ notify: { kind: "invite_accepted", channel: "email", on: false } },
              { notify: { kind: "invite_accepted", channel: "bell", on: true } }], "switching each");
  } finally { delete ANSWER.you.notices; }
});

await check("Your bio: the whole page but where it is shown, and the answer change by change (0058)", async () => {
  /* Chase, 2026-10-13: "The partner can edit their whole bio, including the
     photo and email contact … notify the changes back to the staff member." */
  const live = { region: "KC", public_email: "c@thauma.one", photo: "/media/team/a.webp", bio_photo: "", text: { en: { role_title: "Founder", bio: "Five years." } } };
  ANSWER.you.bio = { is_public: true, slug: "chase", live, proposal: null,
    answer: { ...live, region: "Zagreb", public_email: "x@thauma.one", text: { en: { role_title: "Founder", bio: "Six years here." } },
              decision: { status: "partly", at: "2026-10-13T12:00:00Z", by: "Ana Admin", note: "Tidied it", edited: true, parts: {
                "text.en.bio": { result: "edited", was: "Five years.", kept: "Six years." },
                region: { result: "approved", was: "KC", kept: "Zagreb" },
                public_email: { result: "declined", was: "c@thauma.one", kept: "c@thauma.one" } } } } };
  try {
    const { w, d } = await boot();
    const ans = d.getElementById("setBioAnswer");
    assert(!ans.hidden && /Answered by Ana Admin/.test(ans.textContent) && /Tidied it/.test(ans.textContent), "no answer: " + ans.textContent);
    eq([...ans.querySelectorAll(".pf-chg")].map((x) => [x.className, x.querySelector(".pf-outcome").textContent, x.querySelector(".pf-diff").innerHTML]),
       [["pf-chg is-edited", "Changed by Ana Admin", "Six <del>years here.</del><ins>years.</ins>"],
        ["pf-chg is-approved", "Approved", "<del>KC</del><ins>Zagreb</ins>"],
        ["pf-chg is-declined", "Not approved", "<del>c@thauma.one</del><ins>x@thauma.one</ins>"]],
       "each change and what became of it: theirs to what was kept when edited, otherwise what was asked");
    const f = d.getElementById("setBioForm");
    eq(f.querySelector('[data-bio="public_email"]').value, "c@thauma.one", "the email is editable");
    eq(f.querySelectorAll("[data-slot]").length, 2, "both photos");
    f.querySelector('[data-bio="public_email"]').value = "chase@thauma.one";
    f.querySelector('[data-bio-clear="photo"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    let sent = null;
    w.fetch = async (u, o) => { if (o && o.method === "PATCH") sent = JSON.parse(o.body);
      return { ok: true, status: 200, json: async () => ({ bio: ANSWER.you.bio }) }; };
    d.getElementById("setBioSend").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    await settle(100);
    eq([sent.bio_proposal.public_email, sent.bio_proposal.photo, sent.bio_proposal.text.en.bio], ["chase@thauma.one", "", "Five years."],
       "sent: the email typed, the photo removed (and kept across the redraw), the words");
  } finally { delete ANSWER.you.bio; }
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
