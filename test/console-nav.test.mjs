#!/usr/bin/env node
/**
 * The nav each account actually gets
 *   node test/console-nav.test.mjs
 *
 * Both consoles are rendered into every page and the wrong rows are removed in
 * the browser, so what a board member sees is decided by JavaScript running
 * against real markup. That is exactly the kind of thing a source-reading test
 * cannot check, so this loads the built page and drives it.
 *
 * WHAT IT IS NOT CHECKING: access. Every endpoint checks roles itself. If one
 * of these assertions were wrong the worst outcome is a link that answers
 * "limited to administrators" — untidy, not unsafe.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/index.html`).find((p) => existsSync(p)) || "_site/staff/index.html";
const ADMIN_PAGE = PAGE.replace("/staff/", "/admin/");

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the nav each account actually gets\n");

if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(1);                       // NOT 0: a skip here is a gap.
}

async function boot(roles, page = PAGE) {
  const dom = new JSDOM(readFileSync(page, "utf8"), {
    runScripts: "outside-only", url: "https://dev.thauma.one/staff/", pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  w.console.error = () => {};
  for (const f of ["staff-i18n.js", "staff.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }
  if (roles) w.StaffIdentity({ email: "x@thauma.one", name: "X", roles });
  await new Promise((r) => setTimeout(r, 60));
  return w;
}

const shown = (w, area) => {
  const row = w.document.querySelector(`.console-row[data-row="${area}"]`);
  if (!row || row.hidden) return null;
  return [...row.querySelectorAll("nav a")].filter((a) => !a.hidden)
    .map((a) => a.textContent.trim());
};
const rows = (w) => ["staff", "admin"].filter((a) => shown(w, a));

/* ------------------------- one row, or two ------------------------------ */

await check("a ministry account gets ONE row, the staff one", async () => {
  const w = await boot(["staff"]);
  eq(rows(w), ["staff"], "rows");
  eq(shown(w, "staff").length, 8, "every staff page");
});

await check("an administrator gets ONE row, the admin one", async () => {
  const w = await boot(["admin"]);
  eq(rows(w), ["admin"], "rows");
  eq(shown(w, "admin").length, 7, "every admin page");
});

await check("being BOTH is what produces two rows — not a special case", async () => {
  const w = await boot(["admin", "partner"]);
  eq(rows(w), ["staff", "admin"], "rows");
  eq(shown(w, "staff").length, 8, "staff pages");
  eq(shown(w, "admin").length, 7, "admin pages");
});

/* --------------------------- narrower roles ----------------------------- */

await check("the board sees oversight only, and no way to change accounts", async () => {
  const w = await boot(["board"]);
  eq(rows(w), ["admin"], "rows");
  eq(shown(w, "admin"), ["Overview", "Partners", "Activity"], "pages");
  assert(!shown(w, "admin").includes("People"), "the board can reach account management");
});

await check("a site editor spans both rows, without the private pages", async () => {
  /* The shape asked for: some staff pages and most admin ones. Stewardship is
     the line — supporter names and giving history are not a writing job. */
  const w = await boot(["communications"]);
  eq(rows(w), ["staff", "admin"], "rows");
  assert(!shown(w, "staff").includes("Stewardship"), "reached supporter records");
  assert(!shown(w, "admin").includes("People"), "reached account management");
  for (const p of ["Content", "Site", "Publish"]) {
    assert(shown(w, "admin").includes(p), `missing ${p}`);
  }
});

/* ---------------------------- the details ------------------------------- */

await check("the wordmark leads somewhere the account can actually go", async () => {
  /* It was hardcoded to /staff/, which sent a board member to a page that
     refused them the moment they clicked their own logo. */
  eq((await boot(["board"])).document.getElementById("consoleHome").getAttribute("href"),
     "/admin/", "board");
  eq((await boot(["staff"])).document.getElementById("consoleHome").getAttribute("href"),
     "/staff/", "staff");
});

await check("before the identity arrives the header is not blank", async () => {
  /* Rows render hidden, so doing nothing here would leave a bare header until
     the first fetch returned. */
  const w = await boot(null);
  eq(rows(w), ["staff"], "the row for the page you are on");
});

await check("on an ADMIN page with no identity yet, the admin row shows", async () => {
  if (!existsSync(ADMIN_PAGE)) throw new Error(`${ADMIN_PAGE} missing`);
  const w = await boot(null, ADMIN_PAGE);
  eq(rows(w), ["admin"], "rows");
});

await check("an account with no useful role is given no rows at all", async () => {
  const w = await boot(["nothing-real"]);
  eq(rows(w), [], "rows");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
