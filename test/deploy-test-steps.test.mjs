#!/usr/bin/env node
/**
 * The deploys run every test file, one step each
 *   node test/deploy-test-steps.test.mjs
 *
 * The workflows' test steps are written by deploy/test-steps.mjs so the
 * Publish bar can count them live. Before, `cd workers && npm test` ran the
 * worker tests by glob and a new file could not be forgotten. This keeps that
 * promise: it fails while either workflow differs from what the generator
 * would write — a new test file included — and it runs as one of the steps.
 */
import { readFileSync, existsSync } from "node:fs";
import { WORKFLOWS, PAGE_TESTS, steps, block, apply } from "../deploy/test-steps.mjs";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
console.log("the deploys run every test file, one step each\n");

const want = block(steps());
for (const wf of WORKFLOWS) {
  check(`${wf} has exactly the generated test steps`, () => {
    const text = readFileSync(wf, "utf8");
    const next = apply(text, want);
    assert(next !== null, "no TEST STEPS markers");
    assert(next === text, "out of date — run: node deploy/test-steps.mjs");
  });
  check(`${wf} still checks the database and deploys only after the tests`, () => {
    const text = readFileSync(wf, "utf8");
    const lastTest = text.lastIndexOf("name: Test · ");
    const db = text.search(/name: Check (production schema is ready|the database)/);
    const deploy = text.indexOf("name: Deploy\n");
    assert(lastTest > 0 && db > lastTest && deploy > db, "the order is tests, database, deploy");
    assert(!/if:\s*always\(\)/.test(text), "a step that runs after a failure would let a failed test deploy");
  });
}

check("every worker test file is a step", () => {
  const names = steps().map((s) => s.run);
  const all = steps().filter((s) => s.dir === "workers").length;
  assert(all >= 40, `only ${all} worker tests found`);
  assert(names.includes("python3 db/test_schema.py"), "the schema test is missing");
});

check("every listed page test exists", () => {
  for (const t of PAGE_TESTS) assert(existsSync(`test/${t}.test.mjs`), `test/${t}.test.mjs is listed but missing`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
