#!/usr/bin/env node
/**
 * The colour maths, and the copy of it that ships to browsers
 *   node workers/test/embed-colour.test.mjs
 *
 * The widgets are strings served to other people's websites, so they cannot
 * import a module — the maths has to travel with them. COLOUR_JS is that
 * travelling copy, and this file evaluates it and compares every answer with
 * the functions it was copied from. A duplicate checked against its original
 * on every run is a duplicate that cannot quietly drift.
 */
import { hexToHsl, hslToHex, companion, alpha, COLOUR_JS } from "../src/embed-colour.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${a}, want ${b}`);

const browser = new Function(COLOUR_JS +
  "; return { hexToHsl: hexToHsl, hslToHex: hslToHex, companion: companion, alpha: alpha };")();

/* Real accents somebody might choose, plus the awkward ones: pure black and
   white have no hue, grey has no saturation to rotate, and nonsense must not
   throw in the middle of drawing somebody's page. */
const CASES = ["#00D4FF", "#6D4AFF", "#E4572E", "#22C55E", "#888888",
               "#000000", "#FFFFFF", "#FF0000", "#0A0A0A", "nonsense", ""];

console.log("embed colour — one set of maths, two runtimes\n");

check("companion agrees, character for character", () => {
  for (const c of CASES) {
    eq(String(browser.companion(c)).toLowerCase(), String(companion(c)).toLowerCase(),
      `companion(${JSON.stringify(c)})`);
  }
});

check("alpha agrees", () => {
  for (const c of CASES) {
    for (const a of [0.16, 0.22, 0.45, 1]) {
      eq(browser.alpha(c, a), alpha(c, a), `alpha(${JSON.stringify(c)}, ${a})`);
    }
  }
});

check("the travelling copy carries no backtick or dollar-brace", () => {
  /* It is inlined into template literals that build widget source. Either
     character would end the literal early and produce a script that does not
     parse — on somebody else's website, where nobody would see the error. */
  assert(!COLOUR_JS.includes("`"), "a backtick would end the template literal");
  assert(!COLOUR_JS.includes("${"), "a dollar-brace would interpolate mid-widget");
});

check("the travelling copy is valid on its own", () => {
  // new Function above would already have thrown, but saying so is the point.
  assert(typeof browser.companion === "function", "companion did not survive");
  assert(typeof browser.alpha === "function", "alpha did not survive");
});

check("a colour and its companion are always distinguishable", () => {
  // Rotating the hue of something unsaturated returns the same colour, which
  // is why grey is handled by lightness instead. A partner choosing grey must
  // not silently lose the pair.
  for (const c of ["#00D4FF", "#6D4AFF", "#888888", "#333333", "#EEEEEE"]) {
    assert(companion(c).toLowerCase() !== c.toLowerCase(),
      `${c} is its own companion — the pair collapsed`);
  }
});

check("hexToHsl and hslToHex round-trip", () => {
  for (const c of ["#00D4FF", "#6D4AFF", "#E4572E", "#22C55E"]) {
    const back = hslToHex(hexToHsl(c));
    eq(back.toLowerCase(), c.toLowerCase(), `round trip of ${c}`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
