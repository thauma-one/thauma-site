#!/usr/bin/env node
/**
 * A draft is never lost by leaving it
 *   node test/mail-drafts.test.mjs
 *
 * Chase, 2026-10-03: "Back deletes the draft." It did not call delete — Back
 * only hid the composer, and nothing saved what was written, so the words
 * lived in a hidden page until the next reload. Wanted: autosave; drafts
 * deleted only by hand or once sent; a list of drafts to reopen.
 *
 * Drives the REAL bundle and the built Mail page in jsdom, with a fake API
 * that keeps drafts the way the Worker does.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const BUNDLE = "src/js/composer.bundle.js";
const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/mail/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/mail/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("mail drafts — leaving never loses words\n");

if (!existsSync(BUNDLE) || !existsSync(PAGE)) {
  console.log(`  SKIP  ${!existsSync(BUNDLE) ? BUNDLE : PAGE} is missing — run the build first.`);
  process.exit(0);
}

const LISTS = [
  { id: "ml_1", partner_id: "p_chase", slug: "newsletter", name: "Newsletter",
    from_name: "Chase", from_email: "news@chaseroush.thauma.one", is_open: 1,
    archive_public: 0, subscribed: 3, pending: 0, unsubscribed: 0 },
  { id: "ml_2", partner_id: "p_chase", slug: "prayer", name: "Prayer",
    from_name: "Chase", from_email: "prayer@chaseroush.thauma.one", is_open: 1,
    archive_public: 0, subscribed: 2, pending: 0, unsubscribed: 0 },
];

/**
 * A Mail page with a fake API. `store` holds drafts as the Worker would;
 * `calls` records every POST. `saveDelay` holds a save open, to type into.
 */
async function boot({ drafts = [] } = {}) {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only",
    url: "https://next.thauma.one/staff/mail/",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => (
    { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  w.Element.prototype.scrollIntoView = () => {};

  const api = { store: drafts.map((d) => ({ status: "draft", attachments: [], ...d })),
                calls: [], saveDelay: 0, n: 0 };
  const lists = () => LISTS.map((l) => {
    const mine = api.store.filter((m) => m.list_id === l.id && m.status === "draft");
    return { ...l, drafts: mine.length, sent: [],
             draft_rows: mine.map((m) => ({ id: m.id, subject: m.subject, created_at: m.created_at })) };
  });
  const reply = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });

  w.fetch = async (u, o = {}) => {
    const url = String(u);
    const sent = o.body && typeof o.body === "string" ? JSON.parse(o.body) : null;
    if (url.includes("measure=")) return reply({ bytes: 6100, tooBig: null });
    if (sent) api.calls.push(sent);
    if (sent && sent.action === "mailing-save") {
      if (api.saveDelay) await wait(api.saveDelay);
      let m = sent.id && api.store.find((x) => x.id === sent.id);
      if (!m) {
        m = { id: "mg_" + (++api.n), status: "draft", created_at: new Date().toISOString() };
        api.store.unshift(m);
      }
      Object.assign(m, { list_id: sent.list_id, subject: sent.subject, preheader: sent.preheader,
                         body_html: sent.body_html, attachments: sent.attachments || [] });
      return reply({ ok: true, mailing: { ...m } });
    }
    if (sent && sent.action === "mailing-delete") {
      api.store = api.store.filter((x) => x.id !== sent.id);
      return reply({ ok: true });
    }
    const q = /mailings=([^&]+)/.exec(url);
    const mailings = q ? api.store.filter((m) => m.list_id === decodeURIComponent(q[1])) : [];
    return reply({
      you: { email: "c@thauma.one", roles: ["staff", "admin"] },
      scope: "partner", may_theme: true,
      partner: { id: "p_chase", slug: "chase-roush", display_name: "Chase Roush" },
      lists: lists(), tags: [], senders: [], mailings,
      embed: { accent: "#E4572E", theme: "auto", enabled: true },
    });
  };
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffToast = () => {}; w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.StaffConfirm = async () => true;
  w.console.error = () => {};

  for (const f of ["staff-i18n.js", "staff.js", "staff-rowpanel.js", "staff-mailing.js"]) {
    try { w.eval(readFileSync("src/js/" + f, "utf8")); } catch { /* not under test */ }
  }
  w.eval(readFileSync(BUNDLE, "utf8"));
  await wait(400);

  const D = w.document;
  const click = (id) => D.getElementById(id)
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  const type = (text) => w.StaffComposer.editor.commands.insertContent(text);
  const subject = (v) => {
    const el = D.getElementById("cpSubject");
    el.value = v;
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  };
  const saves = () => api.calls.filter((c) => c.action === "mailing-save");
  const composerOpen = () => !D.getElementById("mlComposerView").hidden;
  return { w, D, api, click, type, subject, saves, composerOpen };
}

/* ------------------------------- Back ----------------------------------- */

await check("Back saves what was written, then leaves", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Hello friends");
  t.type("Words that must not vanish");
  t.click("mlBack"); await wait(300);
  eq(t.saves().length, 1, "saves on Back");
  assert(t.saves()[0].body_html.includes("must not vanish"), "the body was not in the save");
  assert(!t.composerOpen(), "Back did not leave the composer");
  eq(t.api.store.length, 1, "drafts kept");
});

await check("Back never deletes", async () => {
  const t = await boot({ drafts: [{ id: "mg_9", list_id: "ml_1", subject: "Kept",
    body_html: "<p>Old</p>", created_at: "2026-10-01T00:00:00Z" }] });
  t.click("mlDrafts"); await wait(300);
  t.click("mlBack"); await wait(200);
  eq(t.api.calls.filter((c) => c.action === "mailing-delete").length, 0, "deletes");
  eq(t.api.store.map((m) => m.id), ["mg_9"], "drafts after Back");
});

await check("a draft with words but no subject is still saved on Back", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.type("No subject yet, but these words matter");
  t.click("mlBack"); await wait(300);
  eq(t.saves().length, 1, "saves");
  eq(t.saves()[0].subject, "", "subject");
});

await check("an untouched composer leaves without making an empty draft", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.click("mlBack"); await wait(200);
  eq(t.saves().length, 0, "saves");
  assert(!t.composerOpen(), "Back did not leave");
});

/* ------------------------------ autosave -------------------------------- */

await check("typing autosaves after a pause, with nothing pressed", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Autosaved");
  t.type("Pause here");
  await wait(3600);
  eq(t.saves().length, 1, "autosaves");
  eq(t.saves()[0].subject, "Autosaved", "subject");
});

await check("words typed while a save is out stay unsaved, and are saved next", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Race");
  t.type("First part. ");
  t.api.saveDelay = 400;
  t.D.getElementById("cpSave").dispatchEvent(new t.w.MouseEvent("click", { bubbles: true }));
  await wait(100);
  t.type("Typed during the save.");
  await wait(500);
  t.api.saveDelay = 0;
  t.click("mlBack"); await wait(400);
  const last = t.saves()[t.saves().length - 1];
  assert(last.body_html.includes("Typed during the save"),
    `the words typed during the save were never saved — last save: ${last.body_html}`);
});

await check("a new draft saved twice at once is still ONE draft", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Only one");
  t.type("Body");
  t.api.saveDelay = 300;
  t.D.getElementById("cpSave").dispatchEvent(new t.w.MouseEvent("click", { bubbles: true }));
  t.click("mlBack");
  await wait(900);
  eq(t.api.store.length, 1, "drafts created");
  eq(t.saves().filter((s) => !s.id).length, 1, "saves without an id");
});

/* ------------------------------ moving on ------------------------------- */

await check("New saves the open draft before clearing the page", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Before New");
  t.type("Keep me");
  t.click("cpNew"); await wait(300);
  eq(t.saves().length, 1, "saves");
  eq(t.D.getElementById("cpSubject").value, "", "the page is fresh");
  eq(t.api.store.length, 1, "drafts kept");
});

await check("changing Sending to moves the draft, words and all", async () => {
  const t = await boot();
  t.click("mlWrite"); await wait(200);
  t.subject("Moving");
  t.type("These words go with it");
  const sel = t.D.getElementById("cpList");
  sel.value = "ml_2";
  sel.dispatchEvent(new t.w.Event("change", { bubbles: true }));
  await wait(400);
  const last = t.saves()[t.saves().length - 1];
  eq(last && last.list_id, "ml_2", "saved to the new list");
  eq(t.D.getElementById("cpSubject").value, "Moving", "subject kept on screen");
  assert(t.w.StaffComposer.editor.getHTML().includes("go with it"), "body kept on screen");
});

/* ---------------------------- the Drafts card --------------------------- */

await check("the Drafts card lists every list's drafts, and a row reopens one", async () => {
  const t = await boot({ drafts: [
    { id: "mg_a", list_id: "ml_1", subject: "News draft", body_html: "<p>A</p>", created_at: "2026-10-01T00:00:00Z" },
    { id: "mg_b", list_id: "ml_2", subject: "", body_html: "<p>Prayer words</p>", created_at: "2026-10-02T00:00:00Z" },
  ] });
  const card = t.D.getElementById("mlDraftsAll");
  assert(card && !card.hidden, "no Drafts card on the Mail page");
  const rows = [...card.querySelectorAll("[data-open-draft]")];
  eq(rows.map((r) => r.dataset.openDraft), ["mg_b", "mg_a"], "rows, newest first");
  assert(rows[0].textContent.trim().length > 0, "an untitled draft shows nothing to click");
  rows[0].dispatchEvent(new t.w.MouseEvent("click", { bubbles: true }));
  await wait(400);
  assert(t.composerOpen(), "the row did not open the composer");
  eq(t.D.getElementById("cpList").value, "ml_2", "opened on its own list");
  assert(t.w.StaffComposer.editor.getHTML().includes("Prayer words"), "the draft's words are not on screen");
});

await check("a sent mailing is not in the Drafts card", async () => {
  const t = await boot({ drafts: [
    { id: "mg_s", list_id: "ml_1", subject: "Gone out", status: "sent", created_at: "2026-10-01T00:00:00Z" },
  ] });
  const card = t.D.getElementById("mlDraftsAll");
  assert(card.hidden, "the Drafts card shows with no drafts");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
