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
  existsSync(`${d}/staff/mailing/index.html`));

let pass = 0, fail = 0;
/* Awaits — half these tests boot a page and the rest do not, and a check that
   drops the promise reports PASS before an async one can fail. */
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("one view at a time\n");

if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const page = readFileSync(`${build}/staff/mailing/index.html`, "utf8");
const js = readFileSync("src/js/staff-mailing.js", "utf8");

await check("every view section declares what it is", () => {
  const dom = new JSDOM(page);
  const views = [...dom.window.document.querySelectorAll(".ml-view")];
  assert(views.length >= 4, `only ${views.length} .ml-view sections found`);
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
  const dom = new JSDOM(page, { url: "https://dev.thauma.one/staff/mailing/" });
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
  const dom = new JSDOM(readFileSync(`${build}/staff/mailing/index.html`, "utf8"), {
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

await check("reloading the organization's mailing comes back to the organization", async () => {
  /* THE BUG. show() wrote '#' + view, which is a whole new URL — the query
     string went with it. The scope was dropped on the first navigation and a
     reload came back as the partner, whatever you had been editing. Landing in
     a ministry's editor when you left Thauma's is an invitation to change the
     wrong thing without noticing. */
  const { w, d, asked } = await bootMailing(
    "https://dev.thauma.one/staff/mailing/?scope=organization#contact");
  assert(/scope=organization/.test(asked[0]),
    `the first request asked for the wrong scope: ${asked[0]}`);
  assert(/scope=organization/.test(w.location.href),
    `the address lost the scope while rendering: ${w.location.href}`);
  const lit = [...d.querySelectorAll("[data-scope]")]
    .filter((b) => b.classList.contains("is-on")).map((b) => b.dataset.scope);
  assert(lit.join(",") === "organization",
    `the switcher shows "${lit.join(",") || "nothing"}" while editing the organization`);
});

await check("and the view comes back with it", async () => {
  const { d } = await bootMailing(
    "https://dev.thauma.one/staff/mailing/?scope=organization#contact");
  assert(!d.getElementById("mlContactView").hidden,
    "the scope was restored but the view was not");
});

await check("a partner's mailing is unaffected", async () => {
  const { w, asked } = await bootMailing("https://dev.thauma.one/staff/mailing/");
  assert(!/scope=organization/.test(asked[0]), "a plain URL asked for the organization");
  assert(!/scope=/.test(w.location.href),
    `a partner's address grew a scope it does not need: ${w.location.href}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
