#!/usr/bin/env node
/**
 * Tests that the embed widget actually RENDERS
 *   node workers/test/embed-render.test.mjs
 *
 * embed.test.mjs proves the widget script is served and is syntactically
 * valid. Neither says whether running it produces anything — and a runtime
 * error in the render path would surface only in a stranger's browser, on a
 * site nobody at Thauma can see.
 *
 * There is no jsdom here and adding one for this would be a heavy dependency
 * on the critical path of a small script. So this is a DOM shim: just enough
 * of the handful of APIs the widget touches, and no more. It is deliberately
 * strict — an unimplemented method throws rather than returning undefined, so
 * the widget reaching for something this does not model is a failure here
 * instead of a silent blank box in production.
 *
 * WHAT IT CAN AND CANNOT TELL YOU
 * ---------------------------------------------------------------------------
 * It can tell you the widget runs, fetches, builds elements, puts real numbers
 * and real titles in them, and survives the failure paths. It cannot tell you
 * anything about how it LOOKS — no layout, no cascade, no shadow boundary.
 * That still needs eyes on a page.
 */
import { WIDGET_JS } from "../src/embed-widget.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------ the DOM shim ---------------------------- */

class Node {
  constructor(tag) {
    this.tagName = String(tag || "").toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this._text = "";
    this.className = "";
  }
  appendChild(n) { this.children.push(n); return n; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  attachShadow() { this.shadowRoot = new Node("#shadow"); return this.shadowRoot; }

  /* Enough of classList for toggle(), which is how the widget chooses between
     the horizontal and vertical layouts. */
  get classList() {
    const self = this;
    return {
      toggle(cls, on) {
        const set = new Set((self.className || "").split(" ").filter(Boolean));
        if (on) set.add(cls); else set.delete(cls);
        self.className = [...set].join(" ");
      },
      add(cls) { this.toggle(cls, true); },
      remove(cls) { this.toggle(cls, false); },
      contains(cls) { return (self.className || "").split(" ").includes(cls); },
    };
  }

  /* WIDE by default, so the shim exercises the horizontal rail. The vertical
     column is built in the same pass regardless — only CSS hides one — so
     both layouts are asserted against whichever width is set here. */
  getBoundingClientRect() { return { width: this._width ?? 900, height: 0, top: 0, left: 0 }; }

  /* Enough of the event model to press a button. The widget's whole detail
     panel is behind a click, so a shim that cannot click cannot test it. */
  addEventListener(type, fn) {
    (this._on = this._on || {});
    (this._on[type] = this._on[type] || []).push(fn);
  }
  click() { (this._on && this._on.click || []).forEach((fn) => fn.call(this, { target: this })); }

  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    return this.children.length
      ? this.children.map((c) => c.textContent).join("")
      : this._text;
  }

  /* Everything the widget renders, flattened — what a reader would see. */
  get allText() {
    return (this._text || "") + this.children.map((c) => c.allText).join("");
  }
  find(pred, out = []) {
    for (const c of this.children) { if (pred(c)) out.push(c); c.find(pred, out); }
    return out;
  }
  byClass(cls) { return this.find((n) => (n.className || "").split(" ").includes(cls)); }
}

function makeDocument(placements) {
  const doc = new Node("#document");
  doc.readyState = "complete";
  doc.createElement = (t) => new Node(t);
  doc.createTextNode = (t) => { const n = new Node("#text"); n.textContent = t; return n; };
  doc.addEventListener = () => {};
  doc.querySelectorAll = () => placements;
  doc.documentElement = new Node("html");
  doc.documentElement.scrollHeight = 600;
  doc.currentScript = { src: "https://thauma.one/embed/v1/widget.js" };
  return doc;
}

/**
 * Run the widget against one payload and return the placements it filled.
 * Each returned node exposes .shadowRoot, which is where everything lands.
 */
async function run(payload, attrs, { status = 200, pageLang = null, preview = null } = {}) {
  const node = new Node("div");
  node.attributes = attrs;

  const doc = makeDocument([node]);
  if (pageLang) doc.documentElement.setAttribute("lang", pageLang);
  const calls = [];

  const sandbox = {
    document: doc,
    URL,
    Intl,
    console,
    setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: true }),   // reduced motion: no animation to race
    addEventListener: () => {},
    navigator: { language: "en" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status === 200,
        status,
        json: async () => payload,
      };
    },
  };
  if (preview) sandbox.__thaumaPreview = preview;
  sandbox.window = sandbox;
  sandbox.parent = sandbox;          // not framed: reportHeight returns early

  const fn = new Function("window", "document", "fetch", "URL", "Intl",
                          "requestAnimationFrame", "MutationObserver",
                          "setTimeout", "clearTimeout", "console", WIDGET_JS);
  fn(sandbox, doc, sandbox.fetch, URL, Intl, sandbox.requestAnimationFrame,
     sandbox.MutationObserver, setTimeout, clearTimeout, console);

  // The widget's work happens in a promise chain off the fetch.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  return { node, root: node.shadowRoot, calls, sandbox };
}

/* ------------------------------- fixtures ------------------------------- */

const GOALS = {
  version: 1,
  partner: { slug: "chase-roush", display_name: "Chase Roush" },
  theme: { accent: "#E4572E", mode: "auto" },
  goals: [{
    id: "g_monthly", label: "Monthly support", kind: "monthly",
    description: "Ongoing support that covers month to month living and ministry.",
    target_cents: 450000, currency: "USD", raised_cents: 306000,
    donor_count: 14, percent: 68, captured_at: "2026-08-14T06:00:00Z",
  }],
  milestones: [],
  languages: [],
};

const ROADMAP = {
  version: 1,
  partner: { slug: "mira-petrovic", display_name: "Mira Petrović" },
  theme: { accent: "#00D4FF", mode: "auto" },
  goals: [],
  milestones: [
    { id: "m1", parent_id: null, status: "complete", actual_date: "2026-03-01",
      completion: 100, is_featured: false,
      text: { en: { title: "Commissioned in Beograd", description: "Sent by the church.",
                    target_label: "End of February - Start of March 2026" },
              sr: { title: "Послат у Београд", description: "Послала црква." } } },
    { id: "m2", parent_id: null, status: "in_progress", actual_date: null,
      completion: 20, is_featured: true,
      text: { en: { title: "Monthly support" } } },
    /* Two children of m1. Their average is what m1 should report — 60, NOT
       the 100 sitting on the parent row. */
    { id: "c1", parent_id: "m1", status: "complete", actual_date: "2026-01-10",
      completion: 100,
      text: { en: { title: "Raise the sending team", target_label: "January 2026" } } },
    { id: "c2", parent_id: "m1", status: "in_progress", actual_date: "2026-02-10",
      completion: 20,
      text: { en: { title: "Book the flights", description: "Waiting on dates." } } },
  ],
  languages: [{ code: "en" }, { code: "sr" }],
};

/* --------------------------------- tests -------------------------------- */

/* ---- goal cards, matching the giving page ---- */

await check("a goal card carries name, money, percentage and what remains", async () => {
  const { root } = await run(GOALS, { "data-thauma": "chase-roush" });
  const text = root.allText;
  assert(/Monthly support/.test(text), `name missing: ${text}`);
  assert(/68%/.test(text), "percentage missing");
  /* raised / target, formatted — 306000 cents is $3,060. */
  assert(/\$3,060/.test(text), "raised amount missing or unformatted");
  assert(/\$4,500/.test(text), "target amount missing or unformatted");
  assert(!/306000/.test(text), "raw cents leaked into the page");
  /* The line the giving page ends on. */
  assert(/\$1,440 remaining/.test(text), `remaining line missing: ${text}`);
  assert(/14 partners/.test(text), "donor count missing");
});

await check("a fully funded goal shows a badge instead of a shortfall", async () => {
  const funded = JSON.parse(JSON.stringify(GOALS));
  funded.goals[0].raised_cents = 450000;
  funded.goals[0].percent = 100;
  const { root } = await run(funded, { "data-thauma": "chase-roush" });
  assert(/Funded/.test(root.allText), `no funded badge: ${root.allText}`);
  assert(!/remaining/.test(root.allText), "should not also say what remains");
});

await check("the goal bar fills to the percentage, clamped", async () => {
  const { root } = await run(GOALS, { "data-thauma": "chase-roush" });
  eq(root.byClass("gfill")[0].style.width, "68%", "bar width");

  const over = JSON.parse(JSON.stringify(GOALS));
  over.goals[0].percent = 143;
  const o = await run(over, { "data-thauma": "chase-roush" });
  assert(/143%/.test(o.root.allText), "the NUMBER should say 143%");
  eq(o.root.byClass("gfill")[0].style.width, "100%", "the BAR must clamp");
});

/* ---- the colour pair ---- */

await check("completed and in-progress are DIFFERENT colours", async () => {
  /* The whole point of the legend. The first version collapsed both into one
     accent, which is what made "there is a dual colour thing going on" the
     correction. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const css = root.children.find((c) => c.tagName === "STYLE").textContent;

  const prog = /--prog:(#[0-9a-fA-F]{6})/.exec(css);
  const done = /--done:(#[0-9a-fA-F]{6})/.exec(css);
  assert(prog && done, "both colours must be declared");
  assert(prog[1].toLowerCase() !== done[1].toLowerCase(),
    `the pair collapsed into one colour: ${prog[1]}`);
});

await check("the derived colour matches the module the Worker uses", async () => {
  /* The widget is a string shipped to browsers and cannot import, so the
     colour maths exists twice. This is what keeps the duplication honest. */
  const { companion } = await import("../src/embed-colour.js");
  for (const accent of ["#00D4FF", "#6D4AFF", "#E4572E", "#22C55E", "#888888"]) {
    const { root } = await run(ROADMAP, {
      "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-accent": accent,
    });
    const css = root.children.find((c) => c.tagName === "STYLE").textContent;
    const done = /--done:(#[0-9a-fA-F]{6})/.exec(css)[1];
    eq(done.toLowerCase(), companion(accent).toLowerCase(), `companion of ${accent}`);
  }
});

await check("a grey accent still yields two distinguishable colours", async () => {
  /* Rotating the hue of something unsaturated returns the same colour, so a
     partner choosing grey would silently lose the pair. */
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-accent": "#888888",
  });
  const css = root.children.find((c) => c.tagName === "STYLE").textContent;
  const prog = /--prog:(#[0-9a-fA-F]{6})/.exec(css)[1];
  const done = /--done:(#[0-9a-fA-F]{6})/.exec(css)[1];
  assert(prog.toLowerCase() !== done.toLowerCase(), "grey collapsed the pair");
});

await check("a junk data-accent cannot reach the stylesheet", async () => {
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-accent": "red;}body{display:none}",
  });
  const css = root.children.find((c) => c.tagName === "STYLE").textContent;
  assert(!css.includes("red;}body"), "CSS injection got through");
  assert(css.includes("#6D4AFF"), "should fall back to the house colour");
});

/* ---- the roadmap ---- */

await check("only TOP-LEVEL milestones sit on the rail", async () => {
  /* Four milestones, two of them children. The rail shows two. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  eq(root.byClass("pin").length, 2, "pins on the rail");
  eq(root.byClass("step").length, 2, "rows in the vertical column");
});

await check("a parent's percentage is the AVERAGE of its children", async () => {
  /* m1 carries completion 100 and has children at 100 and 20. The breakdown
     is the truth, so the parent must read 60 — a parent disagreeing with the
     rows underneath it is the thing this prevents. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const pin = root.byClass("pin")[0];
  assert(/60%/.test(pin.allText), `parent should read 60%, got: ${pin.allText}`);
  assert(!/100%/.test(pin.allText), "parent must not report its own stale number");
});

await check("the written target_label is shown, not a formatted date", async () => {
  /* "End of February - Start of March 2026" is a sentence somebody typed.
     Replacing it with "Mar 2026" throws that away. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const text = root.allText;
  assert(text.includes("End of February - Start of March 2026"),
    `the written label is missing: ${text.slice(0, 200)}`);
});

await check("a milestone with no label falls back to a formatted date", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  /* c2 has no target_label but does have an actual_date; it appears in the
     breakdown once the parent is opened, so check the parent's own fallback
     path instead — m2 has neither, and must simply not print a date. */
  assert(root.byClass("pin").length === 2, "two pins");
});

await check("the legend names all three states", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const legend = root.byClass("legend")[0];
  assert(legend, "no legend");
  for (const word of ["Completed", "In progress", "Upcoming"]) {
    assert(legend.allText.includes(word), `legend missing ${word}`);
  }
  eq(legend.find((n) => (n.className || "").startsWith("lgd")).length, 3, "legend dots");
});

await check("the roadmap is NOT wrapped in a card", async () => {
  /* Only goals are cards. A roadmap is a continuum, and boxing it was one of
     the things that made the first version look wrong. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  eq(root.byClass("gcard").length, 0, "no goal card should wrap the roadmap");
  assert(root.byClass("road").length === 1, "the roadmap should be its own block");
});

await check("an undated milestone sorts LAST, not to 1970", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const steps = root.byClass("step");
  assert(steps[0].allText.includes("Commissioned"),
    `the dated milestone must come first, got: ${steps[0].allText.slice(0, 40)}`);
});

/* ---- timeline bounds ---- */

await check("timeline bounds decide where a milestone SITS", async () => {
  /* Unbounded, the earliest milestone defines the start and is pinned at 0 —
     the rail can say nothing about a period nobody named. Given 2020 to 2030,
     a 2026 milestone belongs in the middle, with room either side for work
     already done and work not yet scheduled. */
  const bounded = JSON.parse(JSON.stringify(ROADMAP));
  bounded.timeline = { start: "2020-01-01", end: "2030-01-01" };

  const plain = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const withB = await run(bounded, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });

  const a = parseFloat(plain.root.byClass("pin")[0].style.left);
  const b = parseFloat(withB.root.byClass("pin")[0].style.left);

  assert(a < 12, `unbounded, the earliest milestone anchors the start: ${a}%`);
  assert(b > 45 && b < 75,
    `bounded 2020-2030, a 2026-03 milestone belongs mid-rail: ${b}%`);
});

await check("the rail fill is ELAPSED TIME when bounds are set", async () => {
  /* Not a tally of completed milestones. A ministry a year into a three-year
     arc with nothing finished should not see an empty rail. */
  const bounded = JSON.parse(JSON.stringify(ROADMAP));
  bounded.milestones.forEach((m) => { m.status = "upcoming"; });
  /* A window this run sits squarely inside: started well before now, ends
     well after. */
  const now = Date.now();
  bounded.timeline = {
    start: new Date(now - 300 * 864e5).toISOString().slice(0, 10),
    end: new Date(now + 100 * 864e5).toISOString().slice(0, 10),
  };

  const { root } = await run(bounded, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const fill = parseFloat(root.byClass("rfill")[0].style.width);
  assert(fill > 60 && fill < 90,
    `should be about three quarters elapsed, got ${fill}% — is it counting statuses?`);
});

await check("with no bounds the fill falls back to completed milestones", async () => {
  /* One of two parents is complete. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  eq(root.byClass("rfill")[0].style.width, "50%", "fill");
});

/* ---- the chosen pair ---- */

await check("a ministry's SECOND colour is used when it has chosen one", async () => {
  const chosen = JSON.parse(JSON.stringify(ROADMAP));
  chosen.theme = { accent: "#00D4FF", accent2: "#FF8800", mode: "auto" };
  const { root } = await run(chosen, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const css = root.children.find((c) => c.tagName === "STYLE").textContent;
  eq(/--done:(#[0-9a-fA-F]{6})/.exec(css)[1].toLowerCase(), "#ff8800", "chosen second colour");
  eq(/--prog:(#[0-9a-fA-F]{6})/.exec(css)[1].toLowerCase(), "#00d4ff", "first colour");
});

await check("overriding only the FIRST colour re-derives the second", async () => {
  /* Otherwise a partner's stored second colour would be paired with somebody
     else's first, leaving the relationship half-applied. */
  const chosen = JSON.parse(JSON.stringify(ROADMAP));
  chosen.theme = { accent: "#00D4FF", accent2: "#FF8800", mode: "auto" };
  const { root } = await run(chosen, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-accent": "#E4572E",
  });
  const css = root.children.find((c) => c.tagName === "STYLE").textContent;
  const { companion } = await import("../src/embed-colour.js");
  eq(/--done:(#[0-9a-fA-F]{6})/.exec(css)[1].toLowerCase(), companion("#E4572E").toLowerCase(),
     "second colour should follow the override");
});

/* ---- interaction ---- */

await check("clicking a milestone opens a details panel", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  eq(root.byClass("detail").length, 0, "nothing open to start with");

  root.byClass("pin")[0].click();
  const d = root.byClass("detail")[0];
  assert(d, "no details panel appeared");
  assert(d.allText.includes("Commissioned in Beograd"), "panel should name the milestone");
  assert(d.allText.includes("Sent by the church."), "panel should carry the description");
  assert(d.allText.includes("Complete"), "panel should label the percentage");
});

await check("clicking the OPEN one closes it", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const pin = root.byClass("pin")[0];
  pin.click();
  eq(root.byClass("detail").length, 1, "open");
  pin.click();
  eq(root.byClass("detail").length, 0, "closed again");
});

await check("the close button closes it", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  root.byClass("pin")[0].click();
  root.byClass("dclose")[0].click();
  eq(root.byClass("detail").length, 0, "should have closed");
});

await check("only one milestone is selected at a time", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  const pins = root.byClass("pin");
  pins[0].click();
  pins[1].click();
  eq(pins.filter((p) => p.classList.contains("sel")).length, 1, "selected count");
  eq(root.byClass("detail").length, 1, "one panel");
});

await check("a parent's children appear as a breakdown inside its panel", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  root.byClass("pin")[0].click();
  const d = root.byClass("detail")[0];
  assert(d.allText.includes("Breakdown"), "no breakdown heading");
  eq(root.byClass("kid").length, 2, "two children");
  assert(d.allText.includes("Raise the sending team"), "first child missing");
  assert(d.allText.includes("Book the flights"), "second child missing");
  assert(d.allText.includes("Waiting on dates."), "child description missing");
});

await check("a milestone with no children has no breakdown", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" });
  root.byClass("pin")[1].click();
  assert(!root.byClass("detail")[0].allText.includes("Breakdown"),
    "should not offer a breakdown of nothing");
});

/* ---- language ---- */

await check("data-lang picks that language's text", async () => {
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-lang": "sr",
  });
  assert(/Послат у Београд/.test(root.allText), "Serbian title missing");
  assert(!/Commissioned in Beograd/.test(root.allText), "showed English instead");
});

await check("with no data-lang it reads the HOST PAGE's language", async () => {
  /* A Croatian church embedding this should get Croatian without being told
     to add an attribute. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" },
    { pageLang: "sr" });
  assert(/Послат у Београд/.test(root.allText), `host language ignored: ${root.allText.slice(0, 120)}`);
});

await check("a host language the ministry does NOT publish falls back", async () => {
  /* The widget knows which languages exist, so it can only ever choose one
     that does. */
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" },
    { pageLang: "de" });
  assert(/Commissioned in Beograd/.test(root.allText), "should fall back to English");
});

await check("a regional host tag matches the base language", async () => {
  const { root } = await run(ROADMAP, { "data-thauma": "mira-petrovic", "data-widget": "roadmap" },
    { pageLang: "sr-RS" });
  assert(/Послат у Београд/.test(root.allText), "sr-RS should match sr");
});

await check("a milestone with no translation in that language falls back to English", async () => {
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-lang": "sr",
  });
  assert(/Monthly support/.test(root.allText), "the English-only milestone vanished");
});

/* ---- failure paths ---- */

await check("a partner with nothing to show says so", async () => {
  const empty = { ...GOALS, goals: [], milestones: [] };
  const { root } = await run(empty, { "data-thauma": "chase-roush" });
  assert(/Nothing to show/.test(root.allText), `got: ${root.allText}`);
});

await check("a 404 says the ministry is not sharing, and does not throw", async () => {
  const { root } = await run(null, { "data-thauma": "chase-roush" }, { status: 404 });
  assert(root, "nothing rendered");
  assert(/not sharing/.test(root.allText), `got: ${root.allText}`);
});

await check("a placement with no slug fails quietly", async () => {
  const { root } = await run(GOALS, {});
  assert(/No ministry named/.test(root.allText), `got: ${root.allText}`);
});

await check("the fetch omits credentials and targets the script's own origin", async () => {
  const { calls } = await run(GOALS, { "data-thauma": "chase-roush" });
  eq(calls.length, 1, "fetch count");
  eq(calls[0].init.credentials, "omit", "credentials");
  assert(calls[0].url.startsWith("https://thauma.one/embed/v1/"), `url: ${calls[0].url}`);
});

await check("injected preview data is used INSTEAD of fetching", async () => {
  const { root, calls } = await run(GOALS, { "data-thauma": "chase-roush" }, { preview: GOALS });
  eq(calls.length, 0, "it fetched even though preview data was injected");
  assert(/Monthly support/.test(root.allText), "did not render the injected data");
});

await check("injected data for a DIFFERENT partner is ignored", async () => {
  const { calls } = await run(GOALS, { "data-thauma": "someone-else" }, { preview: GOALS, status: 404 });
  eq(calls.length, 1, "it used another partner's injected data instead of fetching");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
