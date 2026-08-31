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
const ADMIN_PAGE = `${build}/admin/publish/index.html`;

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
     a harness that never loaded it could not see the label change colour. */
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
  eq(links(w, "staff").length, 8, "every staff page");
});

await check("an administrator gets ONE row, the admin one", async () => {
  const w = boot(STAFF_PAGE, { roles: ["admin"] });
  eq(rows(w), ["admin"], "rows");
  eq(links(w, "admin").length, 7, "every admin page");
});

await check("being BOTH is what produces two rows — not a special case", async () => {
  const w = boot(STAFF_PAGE, { roles: ["admin", "partner"] });
  eq(rows(w), ["staff", "admin"], "rows");
  eq(links(w, "staff").length, 8, "staff pages");
  eq(links(w, "admin").length, 7, "admin pages");
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
  for (const p of ["Content", "Site", "Publish"]) {
    assert(links(w, "admin").includes(p), `missing ${p}`);
  }
});

await check("an account with no useful role is given no rows at all", async () => {
  eq(rows(boot(STAFF_PAGE, { roles: ["nothing-real"] })), [], "rows");
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

await check("the badge colours do not change between the two areas", async () => {
  /* .is-admin redefines --voice-tech to amber for the admin console, so a
     badge built on the voice pair was blue on staff pages and amber on admin
     ones — the same label, two colours, depending where you were. */
  const css = readFileSync("src/css/admin.css", "utf8") +
              readFileSync("src/css/staff.css", "utf8");
  const areaScoped = css.match(/\.is-(admin|staff)[^{]*\{[^}]*--console-(staff|admin)\s*:/);
  assert(!areaScoped, `an area override redefines a console colour: ${areaScoped}`);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
