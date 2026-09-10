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
  /* The deck waits for the presenter between beats. Nothing here is pressing a
     bar, so these runs play straight through — the gating itself is covered by
     its own test rather than being paid for by every other one. */
  if (w.Deck) w.Deck.state.presenter.gated = false;
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

/* ------------------------------------------- the ask as a live control

   Section 6 is the one section the spec refuses to call a slide: "a live tool
   operated in real time, shaped by however the actual conversation unfolds."
   Everything below is that claim, held as behavior. */

/** The ask, advanced to the point where the tiers are up and one is chosen —
    which is step 1, not the section's first step. */
async function onAsk(opts) {
  const ctx = await boot(opts);
  await ctx.w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 300));
  await ctx.w.Deck.next();
  await new Promise((r) => setTimeout(r, 400));
  return ctx;
}
const currentTier = (d) => d.querySelector(".tier.is-current")?.dataset.tier;
const askLine = (d) => d.querySelector("[data-tier-ask]").textContent.trim();
const press = (w, d, key) =>
  d.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
const clickTier = (w, d, key) =>
  d.querySelector(`.tier[data-tier="${key}"]`)
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const serving = (counts) => async () =>
  ({ ok: true, status: 200, json: async () => ({ counts }) });

await check("the ask opens on the tier chosen before the meeting", async () => {
  /* The prep screen picks a starting point for this particular family. Opening
     on the same figure for everyone is the thing that setting exists to stop. */
  const { w, d } = await onAsk();
  assert(w.Deck.state.presenter.defaultTier === "sys",
    "this test assumes the configured default is sys");
  assert(currentTier(d) === "sys", `the ask opened on "${currentTier(d)}"`);
  assert(/System Tech/.test(askLine(d)), `the sentence reads "${askLine(d)}"`);
});

await check("the presenter moves the ask without moving the deck", async () => {
  /* If pointing at a row also advanced a step, using the tool would cost the
     presenter their place in it. */
  const { w, d } = await onAsk();
  const at = { ...w.Deck.state.nav };

  press(w, d, "ArrowDown");
  await new Promise((r) => setTimeout(r, 60));
  assert(currentTier(d) === "tech", `ArrowDown landed on "${currentTier(d)}"`);

  clickTier(w, d, "a2");
  await new Promise((r) => setTimeout(r, 100));
  assert(currentTier(d) === "a2", `clicking a row landed on "${currentTier(d)}"`);
  assert(/A2/.test(askLine(d)), `the sentence did not follow the row: "${askLine(d)}"`);

  assert(w.Deck.state.nav.section === at.section && w.Deck.state.nav.step === at.step,
    "moving the ask moved the deck underneath the presenter");
});

await check("the ask stops at both ends of the table", async () => {
  const { w, d } = await onAsk();
  for (let i = 0; i < 10; i++) press(w, d, "ArrowUp");
  await new Promise((r) => setTimeout(r, 60));
  assert(currentTier(d) === "pm", `pushed off the top onto "${currentTier(d)}"`);
  for (let i = 0; i < 10; i++) press(w, d, "ArrowDown");
  await new Promise((r) => setTimeout(r, 60));
  assert(currentTier(d) === "stage", `pushed off the bottom onto "${currentTier(d)}"`);
});

await check("the ask never takes navigation away from the presenter", async () => {
  /* The section borrows the axis the deck is not using. Left and right have to
     keep working, or the presenter is stranded in the section that matters
     most and cannot get out of it in front of somebody. */
  const { w, d } = await onAsk();
  const before = { ...w.Deck.state.nav };
  press(w, d, "ArrowRight");
  await new Promise((r) => setTimeout(r, 350));
  assert(w.Deck.state.nav.step !== before.step || w.Deck.state.nav.section !== before.section,
    "ArrowRight stopped advancing the deck once the ask was on screen");
});

await check("a tier with no seats left is not offered as one", async () => {
  /* Being asked to join something already complete is worse than being told it
     filled up. */
  const { w, d } = await onAsk({
    online: true, fetchImpl: serving({ pm: 1, lead: 0, sys: 1, tech: 0, a2: 7, stage: 0 }),
  });
  clickTier(w, d, "pm");
  await new Promise((r) => setTimeout(r, 100));
  assert(/full/i.test(askLine(d)), `a full tier still reads "${askLine(d)}"`);
  assert(!/would you be one/i.test(askLine(d)),
    "a seat that does not exist is still being offered");
});

await check("the figures, the open count and the sentence tell one story", async () => {
  /* THE GAP THIS EXISTS FOR. render() draws the rows from whatever counts exist
     when the section mounts, and the live fetch only answers a step later — so
     the chart sat at zero filled while the sentence under it said "1 A2 spot
     left". Both were reading real data; one of them was reading it too early,
     and the section's whole job is that those two never disagree. */
  const counts = { pm: 1, lead: 0, sys: 1, tech: 0, a2: 7, stage: 0 };
  const { w, d } = await onAsk({ online: true, fetchImpl: serving(counts) });

  for (const tier of w.Deck.config.ask.tiers) {
    const row = d.querySelector(`.tier[data-tier="${tier.key}"]`);
    const filled = row.querySelectorAll(".crew.is-filled").length;
    const open = Number(row.querySelector("[data-open-count]").textContent);
    assert(filled === counts[tier.key],
      `${tier.key}: ${filled} figures are filled, live data says ${counts[tier.key]}`);
    assert(open === tier.target - counts[tier.key],
      `${tier.key}: the open column says ${open}, live data leaves ` +
      `${tier.target - counts[tier.key]}`);
  }

  clickTier(w, d, "a2");
  await new Promise((r) => setTimeout(r, 100));
  assert(/\b1 A2 spot\b/.test(askLine(d)),
    `the chart shows one open A2 seat and the sentence says "${askLine(d)}"`);
});

await check("the ask's words come from the config, not from the animation code", async () => {
  /* The spec's rule for the whole deck: the founder edits copy and figures
     without opening a file that knows about timing curves. This sentence is
     the one that matters most, so it is the one worth holding — including its
     grammar, which travels with the words rather than being welded into
     ask.js. Rewriting the template has to change what is on screen. */
  const { w, d } = await onAsk();
  assert(w.Deck.config.ask.askLine?.open, "the ask sentence is not in the config");

  w.Deck.config.ask.askLine.open = "{n} {tier} {spot/spots}, and nothing else";
  clickTier(w, d, "a2");
  await new Promise((r) => setTimeout(r, 100));
  assert(askLine(d) === "8 A2 spots, and nothing else",
    `rewording the config did not reword the deck: "${askLine(d)}"`);

  clickTier(w, d, "pm");
  await new Promise((r) => setTimeout(r, 100));
  assert(askLine(d) === "1 Production Manager spot, and nothing else",
    `the singular did not follow the words: "${askLine(d)}"`);
});

await check("one press is one thing happening", async () => {
  /* The change the founder asked for after the first run-through: the deck was
     firing a whole passage per press, so a section played itself out while he
     was still on the first sentence. Every reveal now waits for the bar. */
  const { w, d } = await boot();
  w.Deck.state.presenter.gated = true;          // presenting, not sharing
  w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 400));

  const shown = () => d.querySelectorAll(".tier.is-in").length;
  let guard = 0;
  while (shown() === 0 && guard++ < 6) {        // press into the tier step
    w.Deck.next();
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(shown() === 1, `the first press revealed ${shown()} tiers, not 1`);

  w.Deck.next();
  await new Promise((r) => setTimeout(r, 150));
  assert(shown() === 2, `the second press revealed ${shown()} tiers, not 2`);
});

await check("a shared link plays through, because nobody is there to press", async () => {
  /* The gate is the presenter's. A link sent to a supporter has no presenter,
     and a deck that waits forever for a bar nobody presses is a broken page. */
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/chaseroush/present/?view=1",
    beforeParse(w) {
      w.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
      w.fetch = async () => { throw new Error("no network"); };
    },
  });
  const w = dom.window;
  await new Promise((r) => setTimeout(r, 250));
  w.Deck.goTo(7);
  await new Promise((r) => setTimeout(r, 400));
  w.Deck.next();
  await new Promise((r) => setTimeout(r, 900));
  const shown = w.document.querySelectorAll(".tier.is-in").length;
  assert(shown === 6, `a shared link stalled at ${shown} of 6 tiers`);
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

await check("every class the sections render is actually styled", async () => {
  /* THE GAP THIS EXISTS FOR. The deck built, every structural test here passed,
     and five of the nine sections still rendered as unstyled markup — because a
     missing class fails only visibly, and nothing in this file can see. So the
     styling contract is checked as data: if a section names a class, deck.css
     has to define it.

     Deliberately about class NAMES, not about whether the rules are any good.
     It catches the failure that actually happened — markup written, stylesheet
     never followed up — and nothing subtler. */
  const css = readFileSync("presentation/src/deck.css", "utf8");
  const styled = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

  const dir = "presentation/src/sections";
  const files = [...readdirSync(dir).map((f) => `${dir}/${f}`), "presentation/src/motifs.js"];
  const missing = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const used = new Set();
    /* Only literal class lists — a template expression is not a name. */
    for (const m of src.matchAll(/class="([^"$]*)"/g)) {
      for (const w of m[1].split(/\s+/)) if (w) used.add(w);
    }
    for (const m of src.matchAll(/classList\.(?:add|toggle)\("([\w-]+)"/g)) used.add(m[1]);
    for (const c of used) if (!styled.has(c)) missing.push(`${f.split("/").pop()}:.${c}`);
  }
  assert(missing.length === 0,
    `${missing.length} class(es) rendered but never styled: ${missing.join(", ")}`);
});

await check("the closing QR code is a real scannable code", async () => {
  /* A placeholder that LOOKS like a code is the worst outcome available: a
     phone gets pointed at it in a living room and it fails in front of
     everyone. So the built file has to carry encoded modules, not a frame. */
  const m = html.match(/const QR_CODES = (\{.*?\});/s);
  assert(m, "QR_CODES is not in the built deck at all");
  const codes = JSON.parse(m[1]);
  const urls = Object.keys(codes);
  assert(urls.length > 0, "no QR code was generated for any URL");
  for (const url of urls) {
    const svg = codes[url];
    assert(/^<svg/.test(svg), `the code for ${url} is not an svg`);
    /* A real code is a dense grid of drawn runs. A frame would have almost none. */
    const runs = (svg.match(/[Mm]\d/g) || []).length;
    assert(runs > 20,
      `the code for ${url} has only ${runs} drawn runs — that is a placeholder, not a code`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
