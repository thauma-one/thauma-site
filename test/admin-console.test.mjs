#!/usr/bin/env node
/**
 * Invariants in the admin console's browser code
 *   node test/admin-console.test.mjs
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * src/js/admin.js runs in a browser and talks to workers/src/admin.js. Nothing
 * in the worker tests can see it, and a mismatch between the two is silent by
 * construction: the console sends a payload the server does not recognise, the
 * server answers "nothing to change", and the control goes on displaying a
 * value nobody saved.
 *
 * That happened. Both the person-status and partner-status pickers carried
 * class="status-pick", the person branch was tested first, and it matched
 * BOTH — so changing a ministry's status sent `user_id: undefined` and was
 * quietly discarded. It had never worked.
 *
 * These are structural assertions on the source rather than a DOM harness.
 * They cannot prove the console works; they catch the specific shapes that
 * broke it before.
 */
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/js/admin.js", import.meta.url), "utf8");
const API = readFileSync(new URL("../workers/src/admin.js", import.meta.url), "utf8");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("admin console — what the browser sends\n");

check("the PARTNER status branch is tested before the shared class", () => {
  const partner = SRC.indexOf("e.target.dataset.partnerStatus");
  const person = SRC.indexOf("e.target.classList.contains('status-pick')");
  assert(partner > -1 && person > -1, "both branches should exist");
  assert(partner < person,
    "class='status-pick' is on BOTH pickers, so testing it first swallows the " +
    "partner one and sends user_id: undefined — which fails silently");
});

check("every payload the console sends is one the worker looks for", () => {
  // The two files are the only pair in this system with no shared type and no
  // shared test, so the field names are checked against each other by hand.
  for (const field of ["for_partner", "partner_status", "default_lang",
                       "sending_domain", "partner_id", "resend_invite"]) {
    assert(SRC.includes(field), `the console never sends ${field}`);
    assert(API.includes(`body.${field}`), `the worker never reads body.${field}`);
  }
});

check("the organisation is an EMPTY id, read with getAttribute", () => {
  /* Null partner_id is the organisation everywhere in this schema. In the DOM
     that is an empty attribute value, and `dataset` cannot tell an empty
     string from a missing attribute — so the row handler must not use it. */
  assert(/getAttribute\('data-partner-card'\)/.test(SRC),
    "the card id must be read with getAttribute, not dataset");
  assert(!/dataset\.partnerCard/.test(SRC),
    "dataset reports the organisation's empty id the same as no card at all");
});

check("both collapsing lists share ONE panel implementation", () => {
  // Two copies of an animation drift, and then two screens meant to feel the
  // same behave differently.
  assert(/function togglePanel\(/.test(SRC), "expected a shared togglePanel");
  const bodies = SRC.match(/await slide\(/g) || [];
  assert(bodies.length <= 4,
    `slide() is called ${bodies.length} times — a second copy of the panel ` +
    `behaviour has probably appeared`);
});

check("a used sending address cannot be deleted without the cascade flag", () => {
  assert(/cascade=yes/.test(SRC),
    "the console must state that it showed the cascade dialog");
  assert(/cascade"\)\s*!==\s*"yes"/.test(API),
    "the worker must refuse without it — a dialog is a suggestion to anything " +
    "that can send its own DELETE");
});

/* ------------------------- run_worker_first ---------------------------
   Workers Static Assets serve matching files from the edge WITHOUT invoking
   the Worker. A path absent from run_worker_first is answered by the asset
   handler, which has no such file and returns the 404 page — so the route
   looks broken while the code behind it is perfectly correct.

   wrangler.toml already carries a paragraph about this, written after it made
   the language redirect and then every API endpoint 404. It happened again on
   2026-08-21 with /unsubscribe and /archive, which is why it is now a test
   rather than a warning somebody has to remember to read. */

const TOML = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const WORKER = readFileSync(new URL("../workers/src/worker.js", import.meta.url), "utf8");

check("every route the Worker claims is in run_worker_first, in all 3 environments", () => {
  /* Split on the ASSIGNMENT, not the word — the file also explains the setting
     in prose above it, and counting those mentions found four environments. */
  const blocks = TOML.split(/run_worker_first\s*=\s*\[/).slice(1);
  assert(blocks.length === 3, `expected 3 environments, found ${blocks.length}`);

  /* Exact paths from the ROUTES table, plus the prefixes matched by hand.
     Only the ones with nothing on disk matter — a path backed by a real file
     is served correctly either way. */
  const needed = ["/", "/api/*", "/staff/*", "/admin/*", "/embed/v1/*",
                  "/media/*", "/confirm", "/unsubscribe", "/archive/*"];
  blocks.forEach((b, i) => {
    const list = b.slice(0, b.indexOf("]"));
    for (const path of needed) {
      assert(list.includes(`"${path}"`),
        `environment ${i + 1} does not list ${path} — it will be answered by the ` +
        `asset handler and 404, while the code behind it stays correct`);
    }
  });
});

check("a route added to the Worker was added to EVERY environment's allow-list", () => {
  /* Derived from the ROUTES table, so it catches the next one rather than only
     the last two.

     ALL THREE ENVIRONMENTS, which it did not do before: it searched the file
     from the first `run_worker_first` onwards and any single match satisfied
     it. /confirm-account was added to the top-level list, this passed, and dev
     and production would both have 404'd the confirmation link — the exact
     failure this test exists to prevent, hidden by the test itself. The two
     one-line lists further down the file are easy to miss by hand, which is
     the whole reason for checking them here. */
  const declared = [...WORKER.matchAll(/^\s*"(\/[a-z0-9/.-]*)":\s*\w/gim)].map((m) => m[1]);
  assert(declared.length > 3, `only found ${declared.length} routes — did ROUTES move?`);

  const blocks = TOML.split(/run_worker_first\s*=\s*\[/).slice(1)
    .map((b) => b.slice(0, b.indexOf("]")));
  assert(blocks.length === 3, `expected 3 environments, found ${blocks.length}`);

  const PREFIXES = ["/api", "/staff", "/admin", "/media", "/embed/v1",
                    "/archive", "/.netlify/functions"];
  blocks.forEach((list, i) => {
    for (const path of declared) {
      const covered = list.includes(`"${path}"`) ||
        PREFIXES.some((pre) => path.startsWith(pre + "/") && list.includes(`"${pre}/*"`));
      assert(covered,
        `environment ${i + 1} routes ${path} in worker.js but does not list it in ` +
        `run_worker_first — it will 404 there while the code behind it is correct`);
    }
  });
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
