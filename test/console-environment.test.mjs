#!/usr/bin/env node
/**
 * The console's environment band tells the truth
 *   node test/console-environment.test.mjs
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Three consoles, pixel-identical, each reading a different database. On
 * 2026-08-20 the dev console was asked whether the database was up to date and
 * answered yes — correctly, about ITS database — and production was published
 * past three unapplied migrations on the strength of that answer. The embed
 * endpoint started returning 500. Later the same night, production's admin
 * pages were reported empty while every request in the log had gone to the Pi.
 *
 * The band added to staff.js is the fix, and it hardcodes a hostname ->
 * database mapping. A label that says `thauma-ops` while the Worker is bound
 * to something else is worse than no label, because it would be believed. So
 * the mapping is checked against wrangler.toml rather than trusted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const root = new URL("../", import.meta.url);
const staffJs = readFileSync(fileURLToPath(new URL("src/js/staff.js", root)), "utf8");
const toml = readFileSync(fileURLToPath(new URL("wrangler.toml", root)), "utf8");

/* The mapping as the browser will see it. Parsed out of the source rather than
   imported, because staff.js is an IIFE that needs a DOM to run. */
function mappingFromSource() {
  const block = staffJs.match(/var ENVIRONMENTS = \{([\s\S]*?)\n  \};/);
  if (!block) throw new Error("could not find ENVIRONMENTS in staff.js");
  const out = {};
  for (const m of block[1].matchAll(
    /'([^']+)':\s*\{[^}]*?key:\s*'([^']+)'[^}]*?db:\s*'([^']+)'/g)) {
    out[m[1]] = { key: m[2], db: m[3] };
  }
  return out;
}

/* database_name per wrangler environment: top level is staging, then the named
   [env.*] blocks. Deliberately a dumb scan — a TOML parser would be nicer, and
   would also be a dependency this repo does not have. */
function databasesFromToml() {
  const out = {};
  let env = "staging";
  for (const line of toml.split("\n")) {
    const header = line.match(/^\[+(env\.([a-z]+)\.)?([a-z_]+)\]+/);
    if (header) env = header[2] || (header[3] === "d1_databases" ? env : "staging");
    if (/^\[\[d1_databases\]\]/.test(line)) env = "staging";
    const m = line.match(/^\s*database_name\s*=\s*"([^"]+)"/);
    if (m && !(env in out)) out[env] = m[1];
    else if (m) out[env] = out[env] || m[1];
  }
  return out;
}

const MAP = mappingFromSource();
const DBS = databasesFromToml();

check("every Thauma console hostname is described", () => {
  for (const host of ["thauma.one", "next.thauma.one", "dev.thauma.one"]) {
    assert(MAP[host], `${host} is missing from ENVIRONMENTS — it would show as unknown`);
  }
});

/* The three that matter. Getting these backwards is the exact mistake the band
   exists to prevent, so they are asserted by name rather than by loop. */
check("production points at the production database", () => {
  eq(MAP["thauma.one"].key, "production", "key");
  eq(MAP["thauma.one"].db, "thauma-ops", "database");
});

check("staging and dev point at the DEV database, not production", () => {
  /* The one thing that must never be true: a non-production console reading
     production data. The labels are prose now — they say WHERE the data lives
     rather than only naming a binding — so this checks the substance. */
  for (const host of ["next.thauma.one", "dev.thauma.one"]) {
    assert(MAP[host].db.includes(DBS.dev || "thauma-ops-dev"),
      `${host} should name the dev database, got ${JSON.stringify(MAP[host].db)}`);
    /* The dev name is removed before looking for the production one, because
       "thauma-ops" is a prefix of "thauma-ops-dev" and a word boundary does
       not separate them — `-` is not a word character, so \bthauma-ops\b
       matches inside the longer name and every dev label looked like
       production. */
    const withoutDev = MAP[host].db.split(DBS.dev || "thauma-ops-dev").join("");
    assert(!withoutDev.includes(DBS.production),
      `${host} must not point at production: ${MAP[host].db}`);
  }
});

check("the labels match what wrangler.toml actually binds", () => {
  assert(DBS.production, "no production database found in wrangler.toml");
  eq(MAP["thauma.one"].db, DBS.production,
    "thauma.one's label vs [env.production] binding");
});

check("DEV DOES NOT CLAIM TO BE THE DATABASE IT BINDS", () => {
  /* dev and staging bind the SAME name in wrangler.toml, but the Pi runs
     `wrangler dev --local` — so dev reads a SQLite file on that machine and
     never touches the Cloudflare database of that name. They can be twenty-two
     migrations apart while the console says the same word, which is exactly
     the confusion this label has to prevent.

     So dev must say it is local, and must not read as the remote one. */
  const dev = MAP["dev.thauma.one"].db;
  assert(/local/i.test(dev),
    `dev must say its data is local, got ${JSON.stringify(dev)}`);
  assert(dev !== (DBS.dev || "thauma-ops-dev"),
    "dev naming the binding alone is true and misleading — it is not that database");

  const staging = MAP["next.thauma.one"].db;
  assert(/cloudflare/i.test(staging),
    `staging should say its data is the real one, got ${JSON.stringify(staging)}`);
});

check("the band is rendered from the hostname, not fetched", () => {
  assert(/ENVIRONMENTS\[location\.hostname\]/.test(staffJs),
    "must read location.hostname — a label that needs the API is missing " +
    "exactly when the API is what broke");
  assert(/showEnvironment\(\);/.test(staffJs), "showEnvironment must actually be called");
});

check("an unrecognised host says so rather than staying silent", () => {
  assert(/env-unknown|key: 'unknown'/.test(staffJs),
    "an unknown hostname must be labelled, not left blank");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
