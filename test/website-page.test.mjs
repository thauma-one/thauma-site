#!/usr/bin/env node
/**
 * An area of the public site's work as one page — tabs without reloads
 *   node test/website-page.test.mjs
 *
 * Chase, 2026-09-27: every tab loads at once and moving between them is
 * instant; a reload opens the tab you were on; after a save the values
 * hold. 2026-10-20: Website became four areas in the header — Updates,
 * Mail, Sharing, Site Creator. These drive the shell (admin-website.js) and
 * the one thing the tabs share, site.json, across two tabs' real scripts.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/website/photos/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("the Website page\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const SITE = {
  name: "Thauma", url: "https://thauma.one", languages: ["en"],
  images: { home_who: { src: "/img/a.webp", focal_x: 50, focal_y: 28, zoom: 110 } },
  socials: { youtube: "" },
};

/* where each tab lives */
const NAV = createRequire(import.meta.url)("../src/_data/consoleNav.js");
const AT = Object.fromEntries(NAV.areaTabs.map((t) => [t.tab, t.url]));
async function boot(tab = "photos", hash = "", scripts = ["admin-website"]) {
  const sent = [];
  let sha = 1;
  const dom = new JSDOM(readFileSync(`${build}${AT[tab]}index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: `https://dev.thauma.one${AT[tab]}${hash}`,
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        u = String(u);
        const body = o.body ? JSON.parse(o.body) : null;
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: u, body });
        const ok = (j) => ({ ok: true, status: 200, json: async () => j });
        if (u.includes("/api/admin/content")) {
          if (o.method === "PUT") return ok({ ok: true, sha: "s" + (++sha), changed: Object.keys(body.changes) });
          return ok({ configured: true, data: JSON.parse(JSON.stringify(SITE)), sha: "s1", frozen: [] });
        }
        return ok({ configured: true, waiting: 0 });
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.StaffConfirm = async () => true;
  for (const f of scripts) w.eval(readFileSync(`src/js/${f}.js`, "utf8"));
  await tick(150);
  return { w, d, sent };
}
const on = (d) => [...d.querySelectorAll("[data-web-panel]")].filter((p) => !p.hidden).map((p) => p.dataset.webPanel);
const click = (w, d, tab) => d.querySelector(`[data-web-tab="${tab}"]`).dispatchEvent(
  new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

await check("every tab of an area is on its page, and the address decides which is showing", async () => {
  for (const [area, a] of Object.entries(NAV.areas)) {
    for (const t of a.tabs) {
      const { d } = await boot(t.tab);
      assert(d.querySelectorAll("[data-web-panel]").length === a.tabs.length, `${area} does not hold its ${a.tabs.length} tabs`);
      assert(on(d).join() === t.tab, `${t.tab}'s address shows ${on(d)}`);
    }
  }
});

await check("an area has only its own tabs, and Site Creator lists its own down the side", async () => {
  const { d } = await boot("pages");
  eq(on(d).join(), "pages", "Pages");
  assert(!d.querySelector('[data-web-panel="events"], [data-web-panel="forms"], [data-web-panel="mail"]'), "another area's tab is here");
  assert(d.getElementById("webArea").classList.contains("is-side"), "Site Creator's tabs are not down the side");
  const mail = await boot("mail");
  assert(!mail.d.querySelector(".web-side"), "an area of one tab shows a tab list");
  assert(!mail.d.getElementById("pBar"), "Mail has the publish bar, with nothing to publish");
});

await check("a link to another area's tab is an ordinary link — Sharing to the contact page's words", async () => {
  const { w, d } = await boot("forms");
  const a = d.querySelector('#wfRoot a[href="/admin/website/?page=contact"]');
  assert(a, "no way to the contact page's words");
  const e = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  a.dispatchEvent(e);
  assert(!e.defaultPrevented || on(d).join() === "forms", "the shell kept the link from opening");
});

await check("a tab opens without leaving the page, and the address follows it", async () => {
  const { w, d } = await boot("photos");
  click(w, d, "settings");
  assert(on(d).join() === "settings", `showing ${on(d)}`);
  assert(w.location.pathname === "/admin/website/settings/", `address ${w.location.pathname}`);
  assert(d.getElementById("pageHeading").innerHTML === "Site <b>Creator</b>", "the area's heading changed with the tab");
  assert(/^Settings ·/.test(d.title), d.title);
  assert(d.querySelector('[data-web-tab="settings"]').getAttribute("aria-current") === "page", "not marked current");
});

await check("Back goes to the tab before", async () => {
  const { w, d } = await boot("photos");
  click(w, d, "links");
  w.history.back();
  await tick(80);
  assert(on(d).join() === "photos", `after Back: ${on(d)}`);
});

await check("an old link to the Library's Gatherings opens Events", async () => {
  const { w, d } = await boot("resources", "#gatherings");
  assert(on(d).join() === "events" && w.location.pathname === "/admin/website/updates/", `${on(d)} at ${w.location.pathname}`);
});

await check("a tab with unsaved changes is marked while you look at another", async () => {
  const { w, d } = await boot("photos");
  d.getElementById("sSaveBar").hidden = false;
  await tick();
  assert(d.querySelector('[data-web-tab="settings"]').classList.contains("is-dirty"), "Settings not marked");
  assert(!d.querySelector('[data-web-tab="photos"]').classList.contains("is-dirty"), "Photos marked");
});

await check("a save on one tab moves the others on, so their next save is not refused", async () => {
  const { w, d, sent } = await boot("photos", "", ["admin-photos", "admin-site", "admin-website"]);
  d.getElementById("phWin").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  // The picture has no size in the test browser, so move the zoom instead.
  const z = d.getElementById("phZoom");
  z.value = 120; z.dispatchEvent(new w.Event("input"));
  d.getElementById("phSave").click();
  await tick(100);
  const name = d.querySelector('[data-path="name"]');
  name.value = "Thauma.";
  name.dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("sSave").click();
  await tick(100);
  const puts = sent.filter((s) => s.method === "PUT");
  assert(puts.length === 2, `${puts.length} saves`);
  assert(puts[0].body.sha === "s1" && puts[1].body.sha === "s2",
    `Settings saved against ${puts[1].body.sha}, not the version Photos made`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
