#!/usr/bin/env node
/**
 * The color maths, and the copy of it that ships to browsers
 *   node workers/test/embed-colour.test.mjs
 *
 * The widgets are strings served to other people's websites, so they cannot
 * import a module — the maths has to travel with them. COLOUR_JS is that
 * travelling copy, and this file evaluates it and compares every answer with
 * the functions it was copied from. A duplicate checked against its original
 * on every run is a duplicate that cannot quietly drift.
 */
import { hexToHsl, hslToHex, companion, alpha, readable, onColor, contrast, lookFor, rowLook, COLOUR_JS } from "../src/embed-colour.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${a}, want ${b}`);

const browser = new Function(COLOUR_JS +
  "; return { hexToHsl: hexToHsl, hslToHex: hslToHex, companion: companion, alpha: alpha," +
  " readable: readable, onColor: onColor };")();

/* Real accents somebody might choose, plus the awkward ones: pure black and
   white have no hue, gray has no saturation to rotate, and nonsense must not
   throw in the middle of drawing somebody's page. */
const CASES = ["#00D4FF", "#6D4AFF", "#E4572E", "#22C55E", "#888888",
               "#000000", "#FFFFFF", "#FF0000", "#0A0A0A", "nonsense", ""];

console.log("embed color — one set of maths, two runtimes\n");

check("companion agrees, character for character", () => {
  for (const c of CASES) {
    eq(String(browser.companion(c)).toLowerCase(), String(companion(c)).toLowerCase(),
      `companion(${JSON.stringify(c)})`);
  }
});

check("companion agrees at every turn a ministry can pick", () => {
  for (const c of CASES) {
    for (const t of [-33, 120, 180]) {
      eq(String(browser.companion(c, t)).toLowerCase(), String(companion(c, t)).toLowerCase(),
        `companion(${JSON.stringify(c)}, ${t})`);
    }
  }
});

check("no turn is the -33 every ministry had before there was a choice", () => {
  for (const c of ["#00D4FF", "#6D4AFF", "#888888"]) {
    eq(companion(c), companion(c, -33), `companion(${c})`);
    eq(companion(c, null), companion(c, -33), `companion(${c}, null)`);
  }
});

check("readable and onColor agree", () => {
  for (const c of CASES.filter(Boolean)) {
    for (const bg of ["#ffffff", "#15151c", "#f7f8fb", "#1c1c25"]) {
      eq(String(browser.readable(c, bg)).toLowerCase(), String(readable(c, bg)).toLowerCase(),
        `readable(${JSON.stringify(c)}, ${bg})`);
    }
    eq(browser.onColor(c), onColor(c), `onColor(${JSON.stringify(c)})`);
  }
});

check("colored text always reads, and a color that already reads is left alone", () => {
  for (const c of ["#FFEE58", "#00D4FF", "#1A237E", "#000000", "#FFFFFF", "#6D4AFF"]) {
    for (const bg of ["#ffffff", "#15151c"]) {
      assert(contrast(readable(c, bg), bg) >= 3, `${c} on ${bg} still unreadable`);
    }
  }
  eq(readable("#1A237E", "#ffffff").toLowerCase(), "#1a237e", "navy on white was changed");
  eq(onColor("#FFEE58"), "#12121a", "white words on yellow");
  eq(onColor("#1A237E"), "#ffffff", "dark words on navy");
});

check("an embed wears its own colors, else the ministry's; its own background, else the ministry's", () => {
  const ministry = { embed_accent: "#00D4FF", embed_accent2: null, embed_turn: 180, embed_theme: "light" };
  eq(JSON.stringify(lookFor(ministry, null)),
    JSON.stringify({ accent: "#00D4FF", accent2: companion("#00D4FF", 180), mode: "light" }), "the ministry's");
  eq(JSON.stringify(lookFor(ministry, { accent: null, theme: "dark" })),
    JSON.stringify({ accent: "#00D4FF", accent2: companion("#00D4FF", 180), mode: "dark" }), "background only");
  eq(JSON.stringify(lookFor(ministry, { accent: "#E4572E", accent2: null, turn: null, theme: null })),
    JSON.stringify({ accent: "#E4572E", accent2: companion("#E4572E"), mode: "light" }),
    "its own, turned -33 — the ministry's turn is the ministry's");
  eq(lookFor(ministry, { accent: "#E4572E", accent2: "#111111" }).accent2, "#111111", "its own free choice");
  eq(JSON.stringify(rowLook({ embed_accent: "#00D4FF", look_accent: "#22C55E", look_theme: "dark" })),
    JSON.stringify({ accent: "#22C55E", accent2: companion("#22C55E"), mode: "dark" }), "a form's row");
  eq(lookFor({}, null).accent, "#6D4AFF", "no colors at all is the house purple");
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

check("a color and its companion are always distinguishable", () => {
  // Rotating the hue of something unsaturated returns the same color, which
  // is why gray is handled by lightness instead. A partner choosing gray must
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
