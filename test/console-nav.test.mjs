#!/usr/bin/env node
/**
 * The nav each account gets, and that it does not move once painted
 *   node test/console-nav.test.mjs
 *
 * MEASURED THROUGH REAL CSS. The first version of this asserted on the
 * `hidden` attribute, which was fine while JavaScript decided visibility — and
 * became a lie the moment CSS did. So the stylesheet is injected and the
 * assertions read getComputedStyle, which is the only thing that matches what
 * somebody actually sees.
 *
 * Inline scripts are RUN, because console-roles-head.njk is one of the things
 * under test: it is what decides the header before the first paint, and a
 * harness that skips it would be testing a page nobody loads.
 *
 * NOT A SECURITY TEST. Every endpoint checks roles itself. A wrong answer here
 * is an untidy header, not an open door.
 */
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

/* THE COUNTS COME FROM consoleNav.js, not from numbers written here. They were
   restated as 7 and 8, so adding a page to the console failed this test for
   the wrong reason — it reported a nav bug where there was a nav change. What
   is worth asserting is that every page an ADMIN may see is rendered, which is
   a question only the matrix can answer. */
const NAV = createRequire(import.meta.url)("../src/_data/consoleNav.js");
/* Row pages only: a page marked `menu` lives under the name instead. */
const forRole = (list, role) => list.filter((p) => !p.menu && p.roles.includes(role)).length;
import { readFileSync, existsSync, readdirSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/staff/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the nav each account gets\n");

if (!build) {
  console.log("  SKIP  no build found — run eleventy first.");
  process.exit(1);                       // NOT 0: a skip here is a gap.
}
const STAFF_PAGE = `${build}/staff/index.html`;
const ADMIN_PAGE = `${build}/admin/website/index.html`;

/** A page as a browser would have it: inline scripts run, stylesheet applied. */
function boot(page, cached) {
  const dom = new JSDOM(readFileSync(page, "utf8"), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "https://dev.thauma.one/",
    beforeParse(w) {
      const store = {};
      if (cached) store["thauma.staff.who"] = JSON.stringify(cached);
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = v; },
      } });
      w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    },
  });
  const w = dom.window;
  /* ALL THREE STYLESHEETS. Measuring an admin page with only staff.css was how
     the badge bug survived: .is-admin in admin.css redefines --voice-tech, and
     a harness that never loaded it could not see the label change color. */
  for (const f of ["tokens.css", "staff.css", "admin.css"]) {
    const st = w.document.createElement("style");
    st.textContent = readFileSync("src/css/" + f, "utf8");
    w.document.head.appendChild(st);
  }
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  return w;
}

const visible = (w, sel) =>
  [...w.document.querySelectorAll(sel)]
    .filter((el) => w.getComputedStyle(el).display !== "none");

const rows = (w) => visible(w, ".console-row").map((r) => r.getAttribute("data-row"));
const links = (w, area) =>
  visible(w, `.console-row[data-row="${area}"] nav a`).map((a) => a.textContent.trim());

/* ------------------------- one row, or two ------------------------------ */

await check("a ministry account gets ONE row, the staff one", async () => {
  const w = boot(STAFF_PAGE, { roles: ["staff"] });
  eq(rows(w), ["staff"], "rows");
  eq(links(w, "staff").length, forRole(NAV.staff, "staff"), "every staff page");
});

await check("an administrator gets ONE row, the admin one", async () => {
  const w = boot(STAFF_PAGE, { roles: ["admin"] });
  eq(rows(w), ["admin"], "rows");
  eq(links(w, "admin").length, forRole(NAV.admin, "admin"), "every admin page");
});

await check("being BOTH is what produces two rows — not a special case", async () => {
  const w = boot(STAFF_PAGE, { roles: ["admin", "partner"] });
  eq(rows(w), ["staff", "admin"], "rows");
  eq(links(w, "staff").length, forRole(NAV.staff, "staff"), "staff pages");
  eq(links(w, "admin").length, forRole(NAV.admin, "admin"), "admin pages");
});

/* --------------------------- narrower roles ----------------------------- */

await check("the board sees oversight only, and no way to change accounts", async () => {
  const w = boot(STAFF_PAGE, { roles: ["board"] });
  eq(rows(w), ["admin"], "rows");
  eq(links(w, "admin"), ["Overview", "Partners", "Activity"], "pages");
});

await check("a site editor spans both rows, without the private pages", async () => {
  const w = boot(STAFF_PAGE, { roles: ["communications"] });
  eq(rows(w), ["staff", "admin"], "rows");
  assert(!links(w, "staff").includes("Stewardship"), "reached supporter records");
  assert(!links(w, "admin").includes("People"), "reached account management");
  for (const p of ["Updates", "Mail", "Sharing", "Site Creator"]) {
    assert(links(w, "admin").includes(p), `missing ${p}`);
  }
});

await check("an account with no useful role is given no rows at all", async () => {
  eq(rows(boot(STAFF_PAGE, { roles: ["nothing-real"] })), [], "rows");
});

/* ------------------------- under your name ----------------------------- */

const menu = (w) => visible(w, ".console-me-menu a").map((a) => a.textContent.trim());

await check("Settings and Activity are under your name, not in the row", async () => {
  const w = boot(STAFF_PAGE, { roles: ["staff"] });
  eq(menu(w), ["Public Site ↗", "Activity", "Settings", "What's New", "Sign Out"], "the name menu");
  for (const p of ["Settings", "Activity"]) assert(!links(w, "staff").includes(p), `${p} still in the row`);
});

await check("an administrator has What's new and Sign out there — their Activity is in their row", async () => {
  const w = boot(STAFF_PAGE, { roles: ["admin"] });
  eq(menu(w), ["Public Site ↗", "What's New", "Sign Out"], "the name menu");
  assert(links(w, "admin").includes("Activity"), "admin Activity left the row");
});

await check("the sites are the first lines under your name, and the header holds only the rows, the bell and you (2026-10-13)", async () => {
  /* "The nav doesn't fit anymore in the header … the header needs a redesign
     again so that everything fits well." */
  const staff = boot(STAFF_PAGE, { roles: ["staff"] });
  const mine = staff.document.getElementById("consoleMySite");
  assert(mine && mine.closest("#consoleMe"), "Your site is not under your name");
  assert(!staff.document.querySelector(".console-actions > a"), "a link still sits in the header beside your name");
  mine.hidden = false; mine.href = "https://chase.thauma.one/";
  mine.parentNode.classList.add("has-mysite");
  eq(menu(staff).slice(0, 2), ["Your Site ↗", "Activity"], "staff with a site of their own: their site, not Thauma's");
  const admin = boot(STAFF_PAGE, { roles: ["admin"] });
  const a = admin.document.getElementById("consoleMySite");
  a.hidden = false; a.parentNode.classList.add("has-mysite");
  eq(menu(admin).slice(0, 2), ["Your Site ↗", "Public Site ↗"], "an administrator keeps both");
});

await check("the name opens its menu, and Escape or a click elsewhere closes it", async () => {
  const w = boot(STAFF_PAGE, { roles: ["staff"] });
  const d = w.document, btn = d.getElementById("consoleMeBtn"), header = d.getElementById("console");
  assert(w.getComputedStyle(d.getElementById("consoleMe")).display === "none", "open before it was asked");
  btn.click();
  assert(btn.getAttribute("aria-expanded") === "true" && header.classList.contains("me-open"), "did not open");
  assert(w.getComputedStyle(d.getElementById("consoleMe")).display !== "none", "open but not shown");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  assert(btn.getAttribute("aria-expanded") === "false", "Escape did not close it");
  assert(d.activeElement === btn, "focus did not go back to the name");
  btn.click();
  d.querySelector("main").click();
  assert(!header.classList.contains("me-open"), "a click elsewhere did not close it");
});

await check("on a phone, Menu opens the whole list and says Close", async () => {
  const w = boot(STAFF_PAGE, { roles: ["staff"] });
  const d = w.document, btn = d.getElementById("consoleMenuBtn"), header = d.getElementById("console");
  btn.click();
  assert(btn.getAttribute("aria-expanded") === "true" && header.classList.contains("menu-open"), "did not open");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape" }));
  assert(!header.classList.contains("menu-open") && d.activeElement === btn, "Escape did not close it");
});

await check("nothing behind a popup scrolls, and closing it lets the page scroll again", async () => {
  const w = boot(STAFF_PAGE, { roles: ["staff"] });
  const html = w.document.documentElement;
  const locked = () => w.getComputedStyle(html).overflow === "hidden";
  assert(!locked(), "the page is locked before anything opened");
  const answer = w.StaffConfirm({ title: "?", confirm: "Yes", cancel: "No" });
  assert(locked(), "the page scrolls behind a confirmation");
  w.document.querySelector(".dlg-no").click();
  await answer;
  await new Promise((r) => setTimeout(r, 260));
  assert(!locked(), "the page stayed locked after it closed");
  w.document.getElementById("consoleMenuBtn").click();
  assert(locked(), "the page scrolls behind the phone menu");
});

await check("the page's label has no number", async () => {
  for (const page of [STAFF_PAGE, ADMIN_PAGE]) {
    const cue = boot(page, { roles: ["admin", "staff"] }).document.querySelector(".page-head .cue").textContent.trim();
    assert(!/\d/.test(cue), `${page}: "${cue}"`);
  }
});

/* --------------------- and it does not move afterwards ------------------ */

await check("THE HEADER IS RIGHT IN THE FIRST PAINT, from cache", async () => {
  /* The bug this replaced: rows were revealed by script after the page drew,
     so a two-row account watched the nav appear and then grow, on every page.
     Nothing here has fetched anything — this is the state as parsed. */
  const w = boot(STAFF_PAGE, { roles: ["admin", "partner"] });
  eq(rows(w), ["staff", "admin"], "before any request");
});

await check("the identity arriving changes nothing when the cache was right", async () => {
  const w = boot(STAFF_PAGE, { roles: ["board"] });
  const before = rows(w).concat(links(w, "admin"));
  w.StaffIdentity({ email: "b@thauma.one", name: "B", roles: ["board"] });
  await new Promise((r) => setTimeout(r, 40));
  eq(rows(w).concat(links(w, "admin")), before, "the nav moved after it painted");
});

await check("a STALE cache is corrected when the real roles arrive", async () => {
  const w = boot(STAFF_PAGE, { roles: ["board"] });
  eq(rows(w), ["admin"], "starts from the cache");
  w.StaffIdentity({ email: "c@thauma.one", name: "C", roles: ["staff"] });
  await new Promise((r) => setTimeout(r, 40));
  eq(rows(w), ["staff"], "corrected");
});

/* ----------------------- nothing cached at all -------------------------- */

await check("a first visit shows the console the page belongs to", async () => {
  eq(rows(boot(STAFF_PAGE, null)), ["staff"], "on a staff page");
  eq(rows(boot(ADMIN_PAGE, null)), ["admin"], "on an admin page");
});

await check("the wordmark leads somewhere the account can actually go", async () => {
  /* It was hardcoded to /staff/, which sent a board member to a page that
     refused them the moment they clicked their own logo. */
  const w = boot(STAFF_PAGE, { roles: ["board"] });
  w.StaffIdentity({ email: "b@thauma.one", name: "B", roles: ["board"] });
  await new Promise((r) => setTimeout(r, 40));
  eq(w.document.getElementById("consoleHome").getAttribute("href"), "/admin/", "board");
});

/* ------------------- EVERY page, not a sample of two -------------------- */

function consolePages() {
  const out = [];
  for (const area of ["staff", "admin"]) {
    const dir = `${build}/${area}`;
    if (!existsSync(dir)) continue;
    if (existsSync(`${dir}/index.html`)) out.push(`${dir}/index.html`);
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory() && existsSync(`${dir}/${d.name}/index.html`)) {
        out.push(`${dir}/${d.name}/index.html`);
      }
    }
  }
  return [...new Set(out)].sort();
}

await check("NO console page moves after it paints", async () => {
  /* The reported bug, and the reason this is a sweep rather than a sample: it
     was fixed on the staff pages and checked on the staff pages, which is not
     the same as fixed. Every page, every role shape. */
  const pages = consolePages();
  assert(pages.length >= 10, `only found ${pages.length} console pages`);

  const moved = [];
  for (const page of pages) {
    for (const roles of [["admin", "partner"], ["staff"], ["board"], ["communications"]]) {
      const w = boot(page, { roles });
      const before = rows(w).join("+");
      w.StaffIdentity({ email: "x@thauma.one", name: "X", roles });
      await new Promise((r) => setTimeout(r, 20));
      if (rows(w).join("+") !== before) {
        moved.push(`${page} as ${roles.join("+")}: ${before} -> ${rows(w).join("+")}`);
      }
    }
  }
  eq(moved, [], "pages whose nav changed after the first paint");
});

await check("the badge colors do not change between the two areas", async () => {
  /* .is-admin redefines --voice-tech to amber for the admin console, so a
     badge built on the voice pair was blue on staff pages and amber on admin
     ones — the same label, two colors, depending where you were. */
  const css = readFileSync("src/css/admin.css", "utf8") +
              readFileSync("src/css/staff.css", "utf8");
  const areaScoped = css.match(/\.is-(admin|staff)[^{]*\{[^}]*--console-(staff|admin)\s*:/);
  assert(!areaScoped, `an area override redefines a console color: ${areaScoped}`);

  const tokens = readFileSync("src/css/tokens.css", "utf8");
  for (const v of ["--console-staff", "--console-admin"]) {
    assert(tokens.includes(v), `${v} is not defined in tokens.css`);
  }
  /* And the header must use those rather than the voice pair. */
  const header = readFileSync("src/css/staff.css", "utf8");
  const badge = header.slice(header.indexOf(".console-badge{"),
                             header.indexOf(".console-row nav{"));
  assert(!/voice-(tech|human)/.test(badge),
    "the badge still reaches for a token the admin area overrides");
});

await check("no style reaches for the role classes on <html>", async () => {
  /* The console marks <html> with role-admin, role-partner… so the nav can be
     filtered before it paints. A rule named after one of them styles the
     whole page: .role-partner b un-bolded every <b> for partners until
     2026-09-28. Only html.role-… may name them, as the nav does. */
  const css = ["staff.css", "tokens.css"].map((f) => readFileSync("src/css/" + f, "utf8"))
    .join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  /* html.role-… is how the nav is shown, and says what it is for. A bare
     .role-… is the collision. */
  const hit = css.match(/(?<!html)\.role-(admin|partner|staff|board|communications)(?![\w-])/g);
  assert(!hit, `rules named after a role class: ${hit}`);
});

await check("the bell: a number since you last opened it, one line each that opens where it happened, Clear moves to Past (0060, 0061)", async () => {
  /* Chase, 2026-10-13: "Add the in app notifications bell." Then: "a way
     for bell notifications to be cleared from the dropdown, but … they can
     still find past notifications … And I want to make sure the bell icon
     shows a number for how many notifications there has been since they
     last opened the bell icon and isn't just a dot." */
  const calls = [];
  const items = [
    { id: "n_1", kind: "profile_proposed", summary: "<b>Ana &lt;A&gt;</b> sent bio changes to approve",
      link: "/admin/users/#u_ana/team", at: new Date().toISOString(), read: false },
    { id: "n_2", kind: "site_published", summary: "<b>Chase</b> published the site — see what's new",
      link: "/staff/changes/#r_1", at: new Date().toISOString(), read: false },
    { id: "n_3", kind: "invite_accepted", summary: "<b>Mia</b> accepted their invitation",
      link: null, at: "2026-10-01T10:00:00Z", read: true },
  ];
  const pastItems = [{ id: "n_0", kind: "invite_accepted", summary: "Older", link: null, at: "2026-09-01T10:00:00Z", read: true }];
  const dom = new JSDOM(readFileSync(STAFF_PAGE, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "https://dev.thauma.one/staff/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: { getItem: () => null, setItem: () => {} } });
      w.fetch = async (u, o) => {
        const body = o && o.body ? JSON.parse(o.body) : null;
        calls.push([String(u), (o && o.method) || "GET", body]);
        const out = String(u).startsWith("/api/notices?count") ? { unread: 12 }
          : String(u) === "/api/notices?past" ? { unread: 0, items: pastItems }
          : String(u) === "/api/notices" && o && o.method === "POST" ? { unread: 0 }
          : String(u) === "/api/notices" ? { unread: 2, items } : {};
        return { ok: true, status: 200, json: async () => out };
      };
    },
  });
  const w = dom.window, d = w.document;
  const wait = () => new Promise((r) => setTimeout(r, 60));
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  await wait();
  const n = d.getElementById("consoleBellN");
  eq([n.hidden, n.textContent], [false, "12"], "a number, not a dot");
  d.getElementById("consoleBellBtn").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait();
  const lis = () => [...d.querySelectorAll("#consoleBellItems > li")];
  eq(lis().map((li) => li.className), ["is-new", "is-new", ""], "the unread ones are marked while the list is open");
  eq(lis()[0].querySelector(".console-bell-s").innerHTML, "<b>Ana &lt;A&gt;</b> sent bio changes to approve", "one line, as the server built it");
  eq([lis()[0].querySelector("a").getAttribute("href"), lis()[1].querySelector("a").getAttribute("href"), !!lis()[2].querySelector("a")],
     ["/admin/users/#u_ana/team", "/staff/changes/#r_1", false], "each opens where it happened");
  assert(calls.some(([u, m, b]) => u === "/api/notices" && m === "POST" && b.read === "all"), "opening it did not mark it read");
  assert(n.hidden, "the number stayed after opening");

  lis()[0].querySelector("[data-bell-clear]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait();
  eq(calls.at(-1)[2], { clear: "n_1" }, "Clear one");
  eq(lis().length, 2, "cleared from the list");
  d.getElementById("consoleBellClearAll").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait();
  eq([calls.at(-1)[2], lis().length, lis()[0].className], [{ clear: "all" }, 1, "console-bell-empty"], "Clear All");
  d.getElementById("consoleBellPast").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait();
  eq([d.getElementById("consoleBellTitle").textContent, lis().map((li) => li.querySelector(".console-bell-s").textContent),
      !!d.querySelector("[data-bell-clear]"), d.getElementById("consoleBellBack").hidden],
     ["Past Notifications", ["Older"], false, false], "Past: still there to find");
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  eq(d.getElementById("consoleBellBtn").getAttribute("aria-expanded"), "false", "Escape closes it");
  w.close();
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
