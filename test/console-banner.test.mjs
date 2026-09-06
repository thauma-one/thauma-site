#!/usr/bin/env node
/**
 * The error banner must not cover the navigation
 *   node test/console-banner.test.mjs
 *
 * WHAT WENT WRONG.
 *
 * The persistent problem toast is pinned below the header at
 * `top: calc(var(--header-h) + 16px)`. `--header-h` was a hard-coded 62px
 * describing `.top` — a header replaced by the console redesign and no longer
 * rendered anywhere. For a one-row account the stale number was close enough
 * that nothing showed. For an admin+staff account the real header is about
 * 94px, so the banner sat across the second nav row; and because the toast
 * carried only "Try again", an account whose problem needed an administrator
 * could not clear it. The banner reporting that you cannot reach the console
 * was itself blocking the link to the page that fixes it.
 *
 * jsdom has no layout engine, so none of this can be caught by measuring
 * pixels. What CAN be checked is the three things that made it possible: that
 * the header's height is measured rather than assumed, that the banner is
 * painted UNDER the header rather than over it, and that it can be dismissed.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/staff/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the error banner must not cover the navigation\n");

if (!build) {
  console.log("  SKIP  no build found — run eleventy first.");
  process.exit(1);                       // NOT 0: a skip here is a gap.
}

/** A console page with the inline head scripts run, as a browser has it. */
function boot(page, cached, headerHeight) {
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

      /* THE HEADER'S HEIGHT, which jsdom would otherwise report as 0 for
         everything. Only `.console` is given one, so a measurer that read the
         wrong element would get 0 and be caught rather than quietly passing. */
      w.Element.prototype.getBoundingClientRect = function () {
        const h = this.classList && this.classList.contains("console") ? headerHeight : 0;
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: h, width: 1200, height: h };
      };
      /* jsdom has no ResizeObserver. The stub fires once on observe, which is
         the behaviour the measurer depends on for the late role change. */
      w.ResizeObserver = class {
        constructor(cb) { this.cb = cb; }
        observe() { this.cb([], this); }
        disconnect() {}
      };
    },
  });
  const w = dom.window;
  for (const f of ["tokens.css", "staff.css", "admin.css"]) {
    const st = w.document.createElement("style");
    st.textContent = readFileSync("src/css/" + f, "utf8");
    w.document.head.appendChild(st);
  }
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  /* The measurer binds during parse, when readyState is 'loading'. Firing the
     event again is how a test re-runs it after the stubs are in place. */
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return w;
}

const STAFF = `${build}/staff/index.html`;

/* ------------------------------------------- the height is measured, not guessed */

await check("a two-row account gets the header's REAL height, not the default", async () => {
  /* THE BUG. admin+staff is the account that shows both rows, and the one the
     stale 62px was wrong for. */
  const w = boot(STAFF, { roles: ["admin", "staff"] }, 94);
  const h = w.document.documentElement.style.getPropertyValue("--header-h");
  assert(h === "94px", `--header-h is ${h || "(unset)"}, want 94px`);
});

await check("a one-row account gets its own height too", async () => {
  const w = boot(STAFF, { roles: ["staff"] }, 47);
  const h = w.document.documentElement.style.getPropertyValue("--header-h");
  assert(h === "47px", `--header-h is ${h || "(unset)"}, want 47px`);
});

await check("the stylesheet default assumes ONE row, never two", async () => {
  /* Until the measurer runs, the default is what positions the banner. Erring
     small leaves a gap; erring large hides the nav, which is the failure this
     file exists for. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const m = css.match(/--header-h:\s*(\d+)px/);
  assert(m, "--header-h has no default at all");
  /* One row is .console-row's min-height plus the header's bottom border.
     Read from the stylesheet rather than written here, so changing the row
     height cannot leave this assertion quietly measuring the old one. */
  const row = css.match(/\.console-row\{[^}]*min-height:\s*(\d+)px/);
  assert(row, "could not find .console-row's min-height");
  const oneRow = Number(row[1]) + 1;
  assert(Number(m[1]) <= oneRow,
    `default --header-h is ${m[1]}px but one row is ${oneRow}px — the banner ` +
    `would start below the top of the nav on every account until JS runs`);
});

/* ------------------------------------ it lives in the one stack, at the bottom */

await check("the banner joins the normal toast stack, not a host of its own", async () => {
  const w = boot(STAFF, { roles: ["admin", "staff"] }, 94);
  w.StaffProblem("This account is not attached to a partner yet.", null);
  /* A transient one too, or the banner's own host would be the ONLY host and
     the count below would pass against exactly the arrangement it forbids. */
  w.StaffToast("Saved", "ok");

  const hosts = w.document.querySelectorAll(".toasts");
  assert(hosts.length === 1,
    `${hosts.length} toast hosts — the banner used to make a second one pinned ` +
    `under the header, which is what covered the nav`);
  const toast = w.document.querySelector(".problem-toast");
  assert(toast && toast.parentNode === hosts[0], "the banner is not in the toast host");
});

await check("the banner is pinned to the BOTTOM of the stack, under later toasts", async () => {
  /* It does not time out. Appended last it would sit below — and therefore on
     top of — every transient toast that arrives after it. */
  const w = boot(STAFF, { roles: ["admin", "staff"] }, 94);
  w.StaffProblem("This account is not attached to a partner yet.", null);
  w.StaffToast("Saved", "ok");

  const host = w.document.querySelector(".toasts");
  const order = (el) => Number(w.getComputedStyle(el).order || 0);
  const banner = host.querySelector(".problem-toast");
  const transient = [...host.querySelectorAll(".toast:not(.problem-toast)")];

  assert(transient.length === 1, "the transient toast was not added");
  assert(order(banner) > order(transient[0]),
    `banner order ${order(banner)} is not after the transient toast's ` +
    `${order(transient[0])} — a later toast would be hidden behind it`);
});

await check("dismissing the banner leaves the other toasts alone", async () => {
  /* The host is shared now. The first version of problemClear hid the HOST,
     which would have taken every transient toast down with it. */
  const w = boot(STAFF, { roles: ["staff"] }, 47);
  w.StaffProblem("No partner yet.", null);
  w.StaffToast("Saved", "ok");
  const host = w.document.querySelector(".toasts");

  w.document.querySelector(".problem-toast .toast-x").click();
  assert(host.hidden !== true, "dismissing the banner hid the whole toast host");
  const still = host.querySelector(".toast:not(.problem-toast)");
  assert(still && w.getComputedStyle(still).display !== "none",
    "the transient toast disappeared with the banner");
});

/* ------------------------------------------------------- and it can be dismissed */

await check("the banner can be dismissed", async () => {
  const w = boot(STAFF, { roles: ["admin", "staff"] }, 94);
  assert(w.StaffProblem, "staff.js exposes no StaffProblem");
  w.StaffProblem("This account is not attached to a partner yet.", null);

  const toast = w.document.querySelector(".problem-toast");
  assert(toast, "no problem toast was created");
  const close = toast.querySelector(".toast-x");
  assert(close, "the banner has no dismiss button — 'Try again' is not a way out " +
                "of a condition that needs an administrator");

  assert(toast.hidden === false, "banner should be showing first");
  close.click();
  assert(!toast.classList.contains("in"), "dismiss did not start hiding the banner");
});

await check("'Try again' is still there for the problems that are worth retrying", async () => {
  const w = boot(STAFF, { roles: ["staff"] }, 47);
  let retried = 0;
  w.StaffProblem("The database did not answer.", () => { retried++; });
  const toast = w.document.querySelector(".problem-toast");
  const act = toast.querySelector(".toast-act");
  assert(act && !act.hidden, "no retry button on a retryable problem");
  act.click();
  assert(retried === 1, "retry did not run");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
