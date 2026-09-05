#!/usr/bin/env node
/**
 * Tests for workers/src/lib/origin.js and the config it depends on
 *   node workers/test/origin.test.mjs
 *
 * WHAT WENT WRONG, so that these stay pointed at it.
 *
 * Every emailed link was built from `new URL(request.url).origin`. That is
 * correct on a deployed Worker and a lie under `wrangler dev`, where both
 * url.hostname and the Host header return the route in wrangler.toml whatever
 * address the browser asked for. The Pi serves dev.thauma.one through a
 * tunnel, so invitations sent from the dev console told people to confirm
 * their account on STAGING — a different database and a different signing
 * salt, so the link could not work even in principle. The band image in the
 * header was fetched from staging too, where the file does not exist, so the
 * header arrived empty. Two unrelated-looking symptoms, one wrong hostname.
 *
 * The trap was already documented in worker.js and embed.js, and the mail path
 * was written using the broken technique anyway. A comment cannot fail a
 * build. These can.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { siteOrigin } from "../src/lib/origin.js";

/* PATHS FROM THIS FILE, NOT FROM THE WORKING DIRECTORY. `workers/package.json`
   runs the suite as `for f in test/*.test.mjs` with the cwd at `workers/`,
   while a person debugging one test runs it from the repository root. Reading
   `wrangler.toml` relative to cwd works in exactly one of those. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("origin — which site does an emailed link point at\n");

const req = (u) => ({ url: u });

check("the configured origin wins over the address the request arrived on", () => {
  /* THE WHOLE BUG IN ONE ASSERTION. This is the dev Worker: the request
     appears to come from staging because wrangler says so, and the answer
     must still be dev. */
  const got = siteOrigin({ SITE_ORIGIN: "https://dev.thauma.one" },
                         req("https://next.thauma.one/api/admin"));
  assert(got === "https://dev.thauma.one", `got ${got}`);
});

check("a trailing slash never doubles up in a built link", () => {
  const got = siteOrigin({ SITE_ORIGIN: "https://dev.thauma.one/" }, req("https://x.invalid/"));
  assert(got === "https://dev.thauma.one", `got ${got}`);
  assert(!`${got}/confirm-account`.includes("//confirm"), "double slash in path");
});

check("with nothing configured it falls back to the request, NOT to the live site", () => {
  /* Deliberate. An unconfigured deployment that guessed thauma.one would send
     test invitations to the real site — the worst of the three outcomes. */
  const got = siteOrigin({}, req("http://127.0.0.1:8991/api/admin"));
  assert(got === "http://127.0.0.1:8991", `got ${got}`);
});

check("an empty or whitespace SITE_ORIGIN counts as unset", () => {
  assert(siteOrigin({ SITE_ORIGIN: "   " }, req("https://a.invalid/x")) === "https://a.invalid",
         "whitespace should not become the origin");
});

/* ------------------------------------------------------------------ config */

const toml = readFileSync(join(ROOT, "wrangler.toml"), "utf8");

check("every environment states its own SITE_ORIGIN", () => {
  /* THE run_worker_first LESSON. That setting is an allow-list repeated in
     three separate blocks, and a test that checked only the top-level one
     passed while dev and production 404'd. Same shape here: three vars blocks,
     and one missing means that environment silently emails the wrong host. */
  for (const block of ["[vars]", "[env.dev.vars]", "[env.production.vars]"]) {
    const at = toml.indexOf(block);
    assert(at !== -1, `${block} is missing from wrangler.toml`);
    const next = toml.indexOf("\n[", at + 1);
    const body = toml.slice(at, next === -1 ? undefined : next);
    assert(/^SITE_ORIGIN\s*=/m.test(body), `${block} does not set SITE_ORIGIN`);
  }
});

check("the three environments name three different sites", () => {
  const found = [...toml.matchAll(/^SITE_ORIGIN\s*=\s*"([^"]+)"/gm)].map((m) => m[1]);
  assert(found.length === 3, `expected 3 SITE_ORIGIN values, found ${found.length}`);
  assert(new Set(found).size === 3, `two environments share an origin: ${found.join(", ")}`);
  assert(found.every((u) => u.startsWith("https://")),
         `an emailed link must be https: ${found.join(", ")}`);
});

check("production points at the live site and nothing else does", () => {
  const at = toml.indexOf("[env.production.vars]");
  const body = toml.slice(at, toml.indexOf("\n[", at + 1));
  assert(/SITE_ORIGIN\s*=\s*"https:\/\/thauma\.one"/.test(body),
         "production must send links to thauma.one");
  const dev = toml.indexOf("[env.dev.vars]");
  const devBody = toml.slice(dev, toml.indexOf("\n[", dev + 1));
  assert(!/SITE_ORIGIN\s*=\s*"https:\/\/thauma\.one"/.test(devBody),
         "dev must NOT send links to the live site");
});

/* ------------------------------------------------------- the regression net */

check("no module that sends mail derives its origin from the request", () => {
  /* The bug was not one call site, it was twelve, added one at a time over
     weeks — each one copying the line above it. Catching the pattern is worth
     more than catching any single instance of it. */
  const dir = join(ROOT, "workers", "src");
  const offenders = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const path = `${d}/${e.name}`;
      if (e.isDirectory()) { walk(path); continue; }
      if (!e.name.endsWith(".js")) continue;
      const src = readFileSync(path, "utf8");
      /* Only files that actually build mail. A request origin is perfectly
         correct elsewhere — CORS, redirects, same-host links. */
      if (!/sendMail|Email\(|unsubscribeUrl|linkParams/.test(src)) continue;
      if (/new URL\(request\.url\)\.origin/.test(src)) offenders.push(path.slice(ROOT.length + 1));
    }
  };
  walk(dir);
  assert(offenders.length === 0,
         `these build emailed links from the request host, which lies under ` +
         `wrangler dev — use siteOrigin(env, request):\n          ` +
         offenders.join("\n          "));
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
