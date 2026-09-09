#!/usr/bin/env node
/**
 * The support-raising presentation
 *   node test/presentation.test.mjs
 *
 * WHAT IS WORTH ASSERTING HERE. Not that an animation looks right — no test
 * can see that. What can be held is the spec's structural claims, which are
 * the things that would quietly rot:
 *
 *   · the motifs are ONE component each, reused — the spec's biggest build
 *     note, and the single largest risk to the restrained direction
 *   · content lives apart from animation code, because the founder has to
 *     edit figures without reading a timing curve
 *   · offline is a FIRST-CLASS path, not a degraded one
 *   · the file really is self-contained — no network, from a memory stick
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the support-raising presentation\n");

/* BUILT FRESH — a stale dist would test yesterday's deck. And the build is
   itself an assertion: it refuses when two files define the same name, which
   is how a section quietly shadowing a shared motif gets caught. A refusal has
   to read as a failed test rather than a crashed process. */
const OUT = "presentation/dist/index.html";
let html = "";
let buildError = null;
try {
  execFileSync("node", ["presentation/build.mjs"], { stdio: ["ignore", "pipe", "pipe"] });
  html = readFileSync(OUT, "utf8");
} catch (e) {
  buildError = String(e.stdout || e.message).trim();
}

await check("the deck builds", async () => {
  assert(!buildError, buildError || "");
});
if (buildError) { console.log(`\n  ${pass} passed, ${fail} failed`); process.exit(1); }

/** The deck, running, with reduced motion so animations resolve instantly. */
async function boot({ online = false, reduced = true, fetchImpl } = {}) {
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/present/",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: reduced, addListener() {}, removeListener() {} });
      w.fetch = fetchImpl || (async () => { throw new Error("no network"); });
      w.addEventListener("error", (e) => errors.push(e.message));
      w.addEventListener("unhandledrejection", (e) =>
        errors.push("rejected: " + (e.reason && e.reason.message)));
    },
  });
  const w = dom.window;
  await new Promise((r) => setTimeout(r, 200));
  if (online && w.Deck) w.Deck.state.presenter.online = true;
  return { w, d: w.document, errors };
}

/* ------------------------------------------------ it is genuinely one file */

await check("the deck is a single self-contained file", async () => {
  /* The assumption is a meeting in somebody's front room with bad wifi, or a
     memory stick. Anything fetched at runtime is a thing that can fail there. */
  assert(existsSync(OUT), "nothing was built");
  const external = [...html.matchAll(/<(?:script|link)[^>]*\s(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !u.startsWith("data:"));
  assert(external.length === 0,
    `the deck loads ${external.length} external file(s): ${external.join(", ")}`);
  assert(!/@import\s+url/.test(html), "the CSS imports something at runtime");
});

await check("it is not indexed, since the link is meant to be sent directly", async () => {
  assert(/name="robots"[^>]*noindex/.test(html), "no noindex directive");
});

await check("it runs with no network at all", async () => {
  const { w, errors } = await boot();
  assert(w.Deck, "the deck did not start");
  assert(errors.length === 0, `errors on load: ${errors.join(" | ")}`);
});

/* --------------------------------------------- content apart from animation */

await check("every figure lives in the config, not in animation code", async () => {
  /* Several figures are explicitly unverified and WILL move. Editing one must
     never mean opening a file that contains an easing curve. */
  const files = readdirSync("presentation/src", { recursive: true })
    .filter((f) => String(f).endsWith(".js"))
    .map((f) => `presentation/src/${f}`);
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    /* The specific numbers from the spec. A viewBox or a duration is fine; a
       statistic is not. */
    for (const n of ["300000", "7000", "6000", "65000", "71400"]) {
      assert(!new RegExp(`\\b${n}\\b`).test(src),
        `${f} hardcodes ${n} — it belongs in config.js`);
    }
  }
});

await check("the config reports which figures are unverified", async () => {
  const cfg = await import("../presentation/config.js");
  const soft = cfg.unverified();
  assert(soft.length >= 5, `only ${soft.length} figures flagged; the spec marks more`);
  const paths = soft.map((s) => s.path);
  assert(paths.some((p) => /orthodox/i.test(p) || /religion\.1/.test(p)),
    "the Orthodox share is not flagged, and the spec says it is unsourced");
  assert(paths.some((p) => /timeline/.test(p)),
    "the placeholder date is not flagged");
});

await check("the presenter is shown the soft figures before beginning", async () => {
  /* This is the last moment before somebody says an unverified number out
     loud in front of a family. */
  const { d } = await boot();
  const prep = d.getElementById("deck");
  assert(/not verified/i.test(prep.textContent),
    "the prep screen does not mention unverified figures");
});

/* ------------------------------------------------------------ the motifs */

await check("each motif is ONE component, not repeated per section", async () => {
  /* The spec's most important build note: implemented as one-off effects the
     deck feels busy and incoherent, which is the opposite of the direction. */
  const motifs = readFileSync("presentation/src/motifs.js", "utf8");
  for (const fn of ["handwrite", "correct", "scaleCollapse", "focusPoint", "rushThenArrive"]) {
    assert(new RegExp(`export (async )?function ${fn}\\b`).test(motifs),
      `${fn} is not exported from the motif library`);
  }
  /* No section may define its own version of any of them. */
  for (const f of readdirSync("presentation/src/sections")) {
    const src = readFileSync(`presentation/src/sections/${f}`, "utf8");
    for (const fn of ["function handwrite", "function rushThenArrive", "function focusPoint"]) {
      assert(!src.includes(fn), `${f} defines its own ${fn} instead of using the shared one`);
    }
  }
});

await check("the two zooms are deliberately different components", async () => {
  /* The spec is firm that geographic and temporal zoom must not read as the
     same device repeated. They share easing and nothing else. */
  const motifs = readFileSync("presentation/src/motifs.js", "utf8");
  assert(/export async function scaleCollapse/.test(motifs), "no geographic zoom");
  assert(/export async function focusPoint/.test(motifs), "no temporal zoom");
  const collapse = motifs.slice(motifs.indexOf("function scaleCollapse"),
                                motifs.indexOf("function focusPoint"));
  assert(!/focusPoint/.test(collapse), "the geographic zoom delegates to the temporal one");
});

await check("fast motion appears in exactly one section", async () => {
  /* Used decoratively elsewhere it would spend the meaning of the one place
     it carries any. */
  const users = readdirSync("presentation/src/sections")
    .filter((f) => readFileSync(`presentation/src/sections/${f}`, "utf8").includes("rushThenArrive"));
  assert(users.length === 1 && users[0] === "patience.js",
    `fast motion is used in: ${users.join(", ") || "nowhere"}`);
});

await check("the handwriting motif is used by both sections that need it", async () => {
  const heart = readFileSync("presentation/src/sections/heart.js", "utf8");
  const patience = readFileSync("presentation/src/sections/patience.js", "utf8");
  assert(/correct\(/.test(heart), "Section 2 does not run the correction");
  assert(/hand:/.test(patience), "Section 4 does not write its fulfillments by hand");
});

/* ------------------------------------------------------- structure & order */

await check("the deck reaches every section, in the order the spec sets", async () => {
  const { w, d, errors } = await boot();
  const deck = d.getElementById("deck");
  const order = [];
  for (let i = 0; i < 30; i++) {
    const key = deck.dataset.section;
    if (order[order.length - 1] !== key) order.push(key);
    if (key === "closing") break;
    await w.Deck.next();
    await new Promise((r) => setTimeout(r, 60));
  }
  const want = ["prep", "title", "opening", "heart", "methods",
                "patience", "schedule", "ask", "closing"];
  assert(order.join(",") === want.join(","),
    `order was ${order.join(" > ")}`);
  assert(errors.length === 0, `errors while advancing: ${errors.join(" | ")}`);
});

await check("a shared link opens at the title, never at the prep screen", async () => {
  /* The prep screen is one person's checklist. Somebody following a link
     landing on it would be looking at a configuration that is not theirs. */
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/present/?view=1",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
      w.fetch = async () => { throw new Error("no network"); };
    },
  });
  await new Promise((r) => setTimeout(r, 200));
  const d = dom.window.document;
  assert(d.getElementById("deck").dataset.section === "title",
    `a shared link opened on "${d.getElementById("deck").dataset.section}"`);
  assert(!d.querySelector(".deck-hint"), "a viewer is being shown presenter chrome");
});

/* -------------------------------------------------------------- the ask */

await check("offline is a complete path, not a degraded one", async () => {
  /* The spec's words: live data is an enhancement, never a dependency. */
  const { w, d, errors } = await boot();
  await w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  const text = d.getElementById("deck").textContent;
  assert(/\$6,000/.test(text), "the monthly figure is missing offline");
  for (const tier of ["Production Manager", "Stage Hand", "A2"]) {
    assert(text.includes(tier), `the ${tier} tier is missing offline`);
  }
  assert(errors.length === 0, `offline threw: ${errors.join(" | ")}`);
});

await check("it never claims to be current when it is not", async () => {
  const { w, d } = await boot();
  await w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  const note = d.querySelector("[data-live-note]").textContent;
  assert(/last known/i.test(note), `the note says "${note}"`);
});

await check("a failed live fetch falls back rather than breaking the section", async () => {
  /* Bad wifi in somebody's front room is the assumption, not the edge case. */
  const { w, d, errors } = await boot({
    online: true,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  await w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  assert(/\$6,000/.test(d.getElementById("deck").textContent),
    "a refused fetch took the ask down with it");
  assert(errors.length === 0, `a refused fetch threw: ${errors.join(" | ")}`);
  /* THE FALLBACK, not merely survival. The step runner catches anything a
     step throws, so the section would render either way — which means
     "it did not crash" proves nothing about loadLive. The note only says
     "last known" if the fallback was actually returned. */
  assert(/last known/i.test(d.querySelector("[data-live-note]").textContent),
    "the section survived, but loadLive threw instead of falling back — the " +
    "step runner caught it, which is not the same as handling it");
  assert(w.Deck.state.live.counts, "no counts were recorded after the failure");
});

await check("the corner toggles do not move the deck", async () => {
  /* They are view state. Opening the budget must not advance a section. */
  const { w, d } = await boot();
  await w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  const before = w.Deck.state.nav.section;
  const btn = d.querySelector('[data-toggle="budget"]');
  assert(btn, "there is no budget toggle");
  btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 120));
  assert(w.Deck.state.nav.section === before, "opening the budget advanced the deck");
  assert(!d.querySelector('[data-panel="budget"]').hidden, "the budget did not open");
});

await check("the budget explains WHY, not just what", async () => {
  /* "$X for housing" without the philosophy reads as either padding or
     austerity. Bylaws Article VII §5 explains why it is neither. */
  const { w, d } = await boot();
  await w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  const panel = d.querySelector('[data-panel="budget"]').textContent;
  assert(/neither poverty nor wealth/i.test(panel),
    "the stewardship philosophy is missing from the budget breakdown");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
