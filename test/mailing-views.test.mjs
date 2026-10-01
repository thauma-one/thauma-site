#!/usr/bin/env node
/**
 * One view at a time on the mailing page, and the resource dialog
 *   node test/mailing-views.test.mjs
 *
 * WHAT WENT WRONG.
 *
 * show() and newList() each kept their own hand-written list of the views to
 * hide. mlContactView was added long after both and joined neither, so opening
 * the contact form and then pressing "New list" left the contact form on
 * screen underneath the new list's fields — two forms on one page, and no way
 * to tell which one a Save belonged to.
 *
 * The fix is not a fourth line in each list. It is that the views are found by
 * what the markup says they are, so the next tool cannot be forgotten.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/staff/mail/index.html`));

let pass = 0, fail = 0;
/* Awaits — half these tests boot a page and the rest do not, and a check that
   drops the promise reports PASS before an async one can fail. */
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq2 = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("one view at a time\n");

if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const page = readFileSync(`${build}/staff/mail/index.html`, "utf8");
const js = readFileSync("src/js/staff-mailing.js", "utf8");

await check("every view section declares what it is", () => {
  const dom = new JSDOM(page);
  const views = [...dom.window.document.querySelectorAll(".ml-view")];
  /* A list, and Composer. The two forms moved to Sharing. */
  assert(views.length >= 2, `only ${views.length} .ml-view sections found`);
  const missing = views.filter((v) => !v.getAttribute("data-view"));
  assert(missing.length === 0,
    `${missing.map((v) => v.id).join(", ")} carry no data-view, so onlyView() ` +
    `cannot hide them and they will show through whatever opens next`);
  const names = views.map((v) => v.getAttribute("data-view"));
  assert(new Set(names).size === names.length, `two views share a name: ${names}`);
});

await check("nothing hides views by naming them one at a time", () => {
  /* THE ACTUAL BUG. Two hand-kept lists, each missing the same entry. A view
     hidden by id somewhere is a view that will be forgotten somewhere else. */
  const named = js.match(/\$\('ml\w+View'\)\.hidden\s*=/g) || [];
  assert(named.length === 0,
    `${named.length} place(s) still hide a view by id (${named.join(", ")}) — ` +
    `use onlyView() so a new view cannot be missed`);
});

await check("onlyView hides every view except the one asked for", () => {
  const dom = new JSDOM(page, { url: "https://dev.thauma.one/staff/mail/" });
  const d = dom.window.document;
  /* The real function, lifted out of the module rather than reimplemented —
     a copy here could pass while the shipped one is broken. */
  const src = js.slice(js.indexOf("function onlyView"), js.indexOf("function show(view)"));
  const onlyView = new Function("document", src + "; return onlyView;")(d);

  for (const want of ["list", "embed", "composer", "contact"]) {
    onlyView(want);
    for (const v of d.querySelectorAll(".ml-view")) {
      const is = v.getAttribute("data-view");
      assert(v.hidden === (is !== want),
        `showing "${want}" left "${is}" ${v.hidden ? "hidden" : "VISIBLE"}`);
    }
  }
  /* Nothing selected hides everything, which is what "new list" wanted before
     it fills the form in. */
  onlyView(null);
  assert([...d.querySelectorAll(".ml-view")].every((v) => v.hidden),
    "onlyView(null) left a view on screen");
});

/* ------------------------------------------------------- the resource dialog */

await check("the resource form is a centered dialog, not a panel below the cards", () => {
  const res = readFileSync(`${build}/staff/resources/index.html`, "utf8");
  const d = new JSDOM(res).window.document;
  const form = d.querySelector("#resourceForm");
  assert(form, "no resource form");
  assert(form.closest(".dlg-back"),
    "the form is not inside a .dlg-back — it would still open below the page");
  assert(d.querySelector("#resourceBack").hasAttribute("hidden"),
    "the dialog starts open");
});

await check("a dialog form is actually laid out — .form alone is display:none", () => {
  /* The trap: `.form{display:none}` with `.form.open{display:flex}`. Moving it
     into a dialog and dropping `.open` opens a visible backdrop over an
     invisible form. */
  const css = readFileSync("src/css/staff.css", "utf8");
  assert(/\.dlg-back\s+\.form\{[^}]*display:\s*flex/.test(css),
    "nothing gives .form a display inside .dlg-back");
});

await check("the where-it-goes control exists and starts hidden", () => {
  const res = readFileSync(`${build}/staff/resources/index.html`, "utf8");
  const d = new JSDOM(res).window.document;
  const row = d.querySelector("#resourceWhereRow");
  assert(row, "no shelf control — an admin cannot say where a resource goes");
  assert(row.hasAttribute("hidden"),
    "the shelf control must start hidden; the server decides who may see it");
  const opts = [...d.querySelectorAll("#resourceWhere option")].map((o) => o.value);
  assert(opts.join(",") === "mine,staff,admin", `unexpected options: ${opts}`);
});

await check("the browser asks the SERVER who may publish org-wide", () => {
  const staff = readFileSync("src/js/staff.js", "utf8");
  assert(/state\.canSetVisibility/.test(staff),
    "the shelf control is gated on something other than the server's answer");
  assert(!/whoRoles/.test(staff),
    "roles are being re-derived in the browser; staff-data.js already decided");
});

/* --------------------------------------------------- the resources shelves */

await check("the shelves stack; they are not grid items themselves", () => {
  /* THE BUG IN THE SCREENSHOT. #resourceList kept `class="cards"` from before
     shelves existed — a grid of 260px columns — so the three <section>s became
     the grid items and sat side by side in narrow strips. */
  const res = readFileSync(`${build}/staff/resources/index.html`, "utf8");
  const d = new JSDOM(res).window.document;
  const list = d.querySelector("#resourceList");
  assert(list, "no #resourceList");
  assert(!list.classList.contains("cards"),
    "#resourceList is still .cards — the shelves will lay out as grid columns");
});

await check("a resource card leaves room for THREE actions", () => {
  /* .card h4 reserves 76px for the two a directory card has. A resource card
     also has Share, so the row printed over the title. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const scoped = css.match(/\.res-shelf \.card-actions\{([^}]*)\}/);
  assert(scoped, "nothing repositions the actions on a resource card");
  assert(/position:\s*static/.test(scoped[1]),
    "resource actions are still absolutely positioned over the title");
});

/* ------------------------------------------- which ministry you come back to */

const SCOPE_PAY = { lists: [], tags: [], senders: [], topics: [],
  contact: { partner_id: null, deliver_to: "a@b.invalid", heading: "H", is_open: 1 },
  may_send_as_organisation: true, partners: [],
  you: { email: "me@thauma.one", name: "Me", roles: ["admin", "staff"] },
  partner: { id: "p_1", display_name: "Chase Roush", slug: "chase-roush" } };

async function bootMailing(url) {
  const asked = [];
  const dom = new JSDOM(readFileSync(`${build}/staff/mail/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url,
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin", "staff"] }), setItem: () => {} } });
      w.fetch = async (u) => { asked.push(String(u)); return { ok: true, status: 200, json: async () => SCOPE_PAY }; };
      w.scrollTo = () => {};
    } });
  const w = dom.window;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff-mailing.js", "utf8"));
  await new Promise((r) => setTimeout(r, 220));
  return { w, d: w.document, asked };
}

/* Run the Mail script with a stand-in `location` that records where it was
   sent: jsdom will not let location.replace be watched. */
function forwardOf(url) {
  let went = null;
  const dom = new JSDOM(readFileSync(`${build}/staff/mail/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url,
    beforeParse(w) {
      w.fetch = async () => ({ ok: true, status: 200, json: async () => SCOPE_PAY });
      w.scrollTo = () => {};
    } });
  const w = dom.window;
  w.__loc = { hash: w.location.hash, search: w.location.search, pathname: w.location.pathname,
              href: w.location.href, replace: (u) => { went = u; } };
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval("(function (location) {" + readFileSync("src/js/staff-mailing.js", "utf8") + "\n})(window.__loc);");
  return went;
}

await check("Thauma's mail left the staff page: an old link lands in Website › Mail, view and all", async () => {
  /* Chase, 2026-09-27: staff pages for staff work, admin for admin. */
  eq2(forwardOf("https://dev.thauma.one/staff/mail/?scope=organization#composer"),
    "/admin/website/mail/#composer", "the old address");
  const page = readFileSync(`${build}/staff/mail/index.html`, "utf8");
  assert(!/data-scope=/.test(page), "the staff Mail page still offers Thauma's lists");
});

await check("a partner's mailing is unaffected", async () => {
  const { w, asked } = await bootMailing("https://dev.thauma.one/staff/mail/");
  assert(!/scope=organization/.test(asked[0]), "a plain URL asked for the organization");
  assert(!/scope=/.test(w.location.href),
    `a partner's address grew a scope it does not need: ${w.location.href}`);
});

/* ------------------------------ the forms moved to Sharing (board 9) */

await check("an old link to a form lands where the form lives now", async () => {
  /* The part after # never reaches the server, so the Worker cannot forward
     it; the Mail page does. A ministry's forms are on Sharing; Thauma's in
     Website › Forms. */
  for (const [hash, item] of [["contact", "contact"], ["embed", "signup"]]) {
    eq2(forwardOf("https://dev.thauma.one/staff/mail/#" + hash), "/staff/sharing/#" + item, `#${hash}`);
    eq2(forwardOf("https://dev.thauma.one/staff/mail/?scope=organization#" + hash),
      "/admin/website/forms/", `Thauma's #${hash}`);
  }
});

/* ------------------------------ Mail (board 10) */

const LISTS = [
  { id: "l_news", name: "Newsletter", slug: "newsletter", subscribed: 12, drafts: 0, archive_public: 1,
    sent: [{ id: "m1", slug: "june", subject: "June", finished_at: "2026-06-30T10:00:00Z", sent_count: 11 }] },
  { id: "l_pray", name: "Prayer", slug: "prayer", subscribed: 4, drafts: 2, archive_public: 0,
    sent: [{ id: "m2", slug: "week-1", subject: "Week one", finished_at: "2026-07-02T10:00:00Z", sent_count: 4 }] },
];
async function bootMail(url, pay = {}, file = "staff/mail") {
  const P = { ...SCOPE_PAY, lists: LISTS, ...pay };
  const asked = [], posted = [];
  const dom = new JSDOM(readFileSync(`${build}/${file}/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url,
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin", "staff"] }), setItem: () => {} } });
      w.fetch = async (u, o) => { asked.push(String(u));
        /* A stand-in translator, as in updates-page.test.mjs. */
        if (String(u).includes("/api/translate")) {
          const b = o && o.body ? JSON.parse(o.body) : null;
          const reply = b ? { items: b.items.map((i) => ({ id: i.id, text: "«" + b.to + "» " + i.text })) } : { available: true };
          return { ok: true, status: 200, json: async () => reply };
        }
        if (o && o.method && o.method !== "GET") posted.push(JSON.parse(o.body || "null"));
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(
          { ...P, scope: /scope=organization/.test(String(u)) ? "organization" : "partner" })) }; };
      w.scrollTo = () => {};
    } });
  const w = dom.window;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff-mailing.js", "utf8"));
  w.eval(readFileSync("src/js/console-translate.js", "utf8"));
  await new Promise((r) => setTimeout(r, 220));
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return { w, d: w.document, asked, posted, click };
}

await check("Website › Mail is Thauma's, and tells the composer so", async () => {
  /* THE BUG (2026-09-27). window.StaffMailing went missing when the forms
     moved to Sharing, and the composer — a separate file on the same screen —
     asked it whose lists these were, got nothing, and wrote to the ministry's
     lists while the page showed Thauma's. */
  const { w, asked } = await bootMail("https://dev.thauma.one/admin/website/mail/", {}, "admin/website/mail");
  assert(/scope=organization/.test(asked[0]), `Website › Mail asked for ${asked[0]}`);
  assert(w.StaffMailing && w.StaffMailing.scope() === "organization",
    `the composer would ask for ${w.StaffMailing ? w.StaffMailing.scope() : "nothing"}`);
  const staff = await bootMail("https://dev.thauma.one/staff/mail/");
  assert(!/scope=organization/.test(staff.asked[0]), "the staff page asked for Thauma's lists");
  eq2(staff.w.StaffMailing.scope(), "partner", "the staff page's composer");
});

await check("with no list, the page — not a composer with nothing to send to", async () => {
  const { d } = await bootMail("https://dev.thauma.one/staff/mail/#composer", { lists: [] });
  eq2(d.getElementById("mlComposerView").hidden, true, "opened a composer with no list");
  eq2(d.getElementById("mlNoLists").hidden, false, "no word that there are no lists");
  eq2(d.getElementById("mlWrite").hidden, true, "Write with nothing to write to");
});

await check("Write an update comes first, naming the lists it goes to", async () => {
  const { d } = await bootMail("https://dev.thauma.one/staff/mail/");
  const home = d.getElementById("mlHome");
  assert(home.firstElementChild.classList.contains("ml-hero"), "the first card is not first");
  eq2(d.getElementById("mlHeroTo").textContent, "To Newsletter or Prayer", "the lists");
  eq2(d.getElementById("mlDrafts").hidden, false, "two drafts waiting, and no Drafts");
  assert(/2/.test(d.getElementById("mlDrafts").textContent), d.getElementById("mlDrafts").textContent);
});

await check("no drafts, no Drafts button", async () => {
  const { d } = await bootMail("https://dev.thauma.one/staff/mail/",
    { lists: LISTS.map((l) => ({ ...l, drafts: 0 })) });
  eq2(d.getElementById("mlDrafts").hidden, true, "Drafts with none waiting");
});

await check("Sent is every list together, newest first, linking where the list publishes", async () => {
  const { d } = await bootMail("https://dev.thauma.one/staff/mail/");
  const rows = [...d.querySelectorAll("#mlSentRows .ml-sentall-row")];
  eq2(rows.map((r) => r.querySelector(".ml-sentall-subject").textContent), ["Week one", "June"], "order");
  eq2(rows[0].tagName, "DIV", "a prayer update with no public copy became a link");
  eq2(rows[1].getAttribute("href"), "https://dev.thauma.one/archive/chase-roush/newsletter/june/", "public copy");
  assert(/Newsletter/.test(rows[1].textContent) && /11/.test(rows[1].textContent), rows[1].textContent);
});

await check("Write opens the composer on the list on screen, and the way back returns to it", async () => {
  const { w, d, click } = await bootMail("https://dev.thauma.one/staff/mail/#l_pray");
  let wrote = null;
  w.StaffComposer = { write: (id) => { wrote = id; }, drafts: () => {} };
  click(d.getElementById("mlWrite"));
  eq2(d.getElementById("mlComposerView").hidden, false, "no composer");
  eq2(d.getElementById("mlHome").hidden, true, "the first card and the lists stayed under it");
  eq2(wrote, "l_pray", "written to the wrong list");
  click(d.getElementById("mlBack"));
  eq2(d.getElementById("mlComposerView").hidden, true, "still writing");
  assert(d.querySelector('.ml-tabs [data-view="l_pray"]').classList.contains("is-on"), "not back on Prayer");
});

await check("List settings opens the list's settings, and closes them again", async () => {
  const { d, click } = await bootMail("https://dev.thauma.one/staff/mail/#l_news");
  const btn = d.getElementById("mlListSettings");
  eq2(btn.hidden, false, "no List settings on a list");
  click(btn);
  eq2(d.querySelector('[data-subpanel="settings"]').hidden, false, "settings did not open");
  eq2(btn.getAttribute("aria-pressed"), "true", "pressed");
  eq2(d.getElementById("mlName").value, "Newsletter", "whose settings");
  click(btn);
  eq2(d.querySelector('[data-subpanel="people"]').hidden, false, "back to the people");
  click(d.querySelector('.ml-tabs [data-view="l_pray"]'));
  eq2(d.querySelector('[data-subpanel="people"]').hidden, false, "a list opens on its people");
});

await check("a list's name is written per language, and the form saves the translation", async () => {
  /* Chase, 2026-10-01: "We need to fix that on ... Sign Up" (0047). */
  const { w, d, posted, click } = await bootMail("https://dev.thauma.one/staff/mail/#l_news", {
    default_lang: "en",
    languages: [{ code: "en", name: "English" }, { code: "hr", name: "Hrvatski" }],
  });
  click(d.getElementById("mlListSettings"));
  const pick = d.getElementById("mlLang"), name = d.getElementById("mlName");
  eq2(d.getElementById("mlWriting").hidden, false, "no language picker with two languages");
  eq2(pick.value, "en", "opens in the ministry's own language");
  /* Editing ⇄ Reference, the milestone editor's pair (Chase: "It only shows
     the editing language"). */
  eq2(d.getElementById("mlBesideWrap").hidden, false, "no Reference beside Editing");
  eq2(d.getElementById("mlBeside").value, "hr", "Reference opens on the other language");
  pick.value = "hr"; pick.dispatchEvent(new w.Event("change"));
  eq2(d.getElementById("mlBeside").value, "en", "writing Croatian, the reference is the English");
  eq2(d.getElementById("mlNameRef").getAttribute("lang"), "en", "the reference line says its language");
  eq2(name.value, "", "no Croatian name yet");
  eq2(name.required, false, "a translation is not required");
  assert(/Newsletter/.test(d.getElementById("mlNameRef").textContent), "the list's own name shows above");
  name.value = "Bilten";
  d.getElementById("mlForm").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 50));
  const body = posted[posted.length - 1];
  assert(body, "nothing was saved");
  eq2(body.name, "Newsletter", "the list's own name is unchanged");
  eq2(JSON.stringify(body.texts), JSON.stringify({ hr: { name: "Bilten" } }), "the Croatian name");
});

await check("Translate in List settings fills the Croatian name from the English", async () => {
  /* Chase, 2026-10-01: "Still says Nothing to Translate Here." */
  const { w, d, click } = await bootMail("https://dev.thauma.one/staff/mail/#l_news", {
    default_lang: "en",
    languages: [{ code: "en", name: "English" }, { code: "hr", name: "Hrvatski" }],
  });
  click(d.getElementById("mlListSettings"));
  const pick = d.getElementById("mlLang");
  pick.value = "hr"; pick.dispatchEvent(new w.Event("change"));
  /* jsdom lays nothing out, so "on screen" is taken as given here. */
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", { get() { return this.parentNode; }, configurable: true });
  click(d.querySelector("#mlForm [data-lang-translate]"));
  await new Promise((r) => setTimeout(r, 200));
  eq2(d.getElementById("mlName").value, "«hr» Newsletter", "the name, from English");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
