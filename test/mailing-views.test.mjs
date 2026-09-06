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
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("one view at a time\n");

if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const page = readFileSync(`${build}/staff/mailing/index.html`, "utf8");
const js = readFileSync("src/js/staff-mailing.js", "utf8");

check("every view section declares what it is", () => {
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

check("nothing hides views by naming them one at a time", () => {
  /* THE ACTUAL BUG. Two hand-kept lists, each missing the same entry. A view
     hidden by id somewhere is a view that will be forgotten somewhere else. */
  const named = js.match(/\$\('ml\w+View'\)\.hidden\s*=/g) || [];
  assert(named.length === 0,
    `${named.length} place(s) still hide a view by id (${named.join(", ")}) — ` +
    `use onlyView() so a new view cannot be missed`);
});

check("onlyView hides every view except the one asked for", () => {
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

check("the resource form is a centred dialog, not a panel below the cards", () => {
  const res = readFileSync(`${build}/staff/resources/index.html`, "utf8");
  const d = new JSDOM(res).window.document;
  const form = d.querySelector("#resourceForm");
  assert(form, "no resource form");
  assert(form.closest(".dlg-back"),
    "the form is not inside a .dlg-back — it would still open below the page");
  assert(d.querySelector("#resourceBack").hasAttribute("hidden"),
    "the dialog starts open");
});

check("a dialog form is actually laid out — .form alone is display:none", () => {
  /* The trap: `.form{display:none}` with `.form.open{display:flex}`. Moving it
     into a dialog and dropping `.open` opens a visible backdrop over an
     invisible form. */
  const css = readFileSync("src/css/staff.css", "utf8");
  assert(/\.dlg-back\s+\.form\{[^}]*display:\s*flex/.test(css),
    "nothing gives .form a display inside .dlg-back");
});

check("the where-it-goes control exists and starts hidden", () => {
  const res = readFileSync(`${build}/staff/resources/index.html`, "utf8");
  const d = new JSDOM(res).window.document;
  const row = d.querySelector("#resourceWhereRow");
  assert(row, "no shelf control — an admin cannot say where a resource goes");
  assert(row.hasAttribute("hidden"),
    "the shelf control must start hidden; the server decides who may see it");
  const opts = [...d.querySelectorAll("#resourceWhere option")].map((o) => o.value);
  assert(opts.join(",") === "mine,staff,admin", `unexpected options: ${opts}`);
});

check("the browser asks the SERVER who may publish org-wide", () => {
  const staff = readFileSync("src/js/staff.js", "utf8");
  assert(/state\.canSetVisibility/.test(staff),
    "the shelf control is gated on something other than the server's answer");
  assert(!/whoRoles/.test(staff),
    "roles are being re-derived in the browser; staff-data.js already decided");
});

/* --------------------------------------------------- the resources shelves */

check("the shelves stack; they are not grid items themselves", () => {
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

check("a resource card leaves room for THREE actions", () => {
  /* .card h4 reserves 76px for the two a directory card has. A resource card
     also has Share, so the row printed over the title. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const scoped = css.match(/\.res-shelf \.card-actions\{([^}]*)\}/);
  assert(scoped, "nothing repositions the actions on a resource card");
  assert(/position:\s*static/.test(scoped[1]),
    "resource actions are still absolutely positioned over the title");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
