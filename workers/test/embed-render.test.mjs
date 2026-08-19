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
      contains(cls) { return (self.className || "").split(" ").includes(cls); },
    };
  }

  /* WIDE by default, so the shim exercises the horizontal rail. The vertical
     column is built in the same pass regardless — only CSS hides one — so
     both layouts are asserted against whichever width is set here. */
  getBoundingClientRect() { return { width: this._width ?? 900, height: 0, top: 0, left: 0 }; }

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
async function run(payload, attrs, { status = 200 } = {}) {
  const node = new Node("div");
  node.attributes = attrs;

  const doc = makeDocument([node]);
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
    fetch: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status === 200,
        status,
        json: async () => payload,
      };
    },
  };
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
    target_cents: 450000, currency: "USD", raised_cents: 306000,
    donor_count: 14, percent: 68, captured_at: "2026-08-14T06:00:00Z",
  }],
  milestones: [],
  languages: [],
};

const ROADMAP = {
  version: 1,
  partner: { slug: "mira-petrovic", display_name: "Mira Petrović" },
  theme: { accent: "#6D4AFF", mode: "auto" },
  goals: [],
  milestones: [
    { id: "m1", status: "complete", actual_date: "2026-03-01", is_featured: false,
      text: { en: { title: "Commissioned in Beograd", description: "Sent by the church." },
              sr: { title: "Послат у Београд", description: "Послала црква." } } },
    { id: "m2", status: "in_progress", actual_date: null, is_featured: true,
      text: { en: { title: "Monthly support" } } },
  ],
  languages: [],
};

/* --------------------------------- tests -------------------------------- */

await check("a goal card renders with the real numbers in it", async () => {
  const { root } = await run(GOALS, { "data-thauma": "chase-roush" });
  assert(root, "nothing was rendered into a shadow root");
  const text = root.allText;
  assert(/Monthly support/.test(text), `label missing: ${text}`);
  assert(/68%/.test(text), `percent missing: ${text}`);
  assert(/14 partners/.test(text), `donor count missing: ${text}`);
  /* Cents to currency, not a raw integer. 306000 cents is $3,060. */
  assert(/3,060/.test(text), `raised amount not formatted: ${text}`);
  assert(/4,500/.test(text), `target amount not formatted: ${text}`);
  assert(!/306000/.test(text), "raw cents leaked into the page");
});

await check("the progress bar is filled to the percentage", async () => {
  const { root } = await run(GOALS, { "data-thauma": "chase-roush" });
  const fill = root.byClass("fill")[0];
  assert(fill, "no progress bar");
  eq(fill.style.width, "68%", "bar width");
});

await check("an over-funded goal shows the real percentage, clamped bar", async () => {
  /* Over 100% is worth showing; a bar wider than its track is not. */
  const over = JSON.parse(JSON.stringify(GOALS));
  over.goals[0].percent = 143;
  const { root } = await run(over, { "data-thauma": "chase-roush" });
  assert(/143%/.test(root.allText), "should say 143%");
  eq(root.byClass("fill")[0].style.width, "100%", "bar must clamp");
});

await check("the partner's accent reaches the stylesheet", async () => {
  const { root } = await run(GOALS, { "data-thauma": "chase-roush" });
  const style = root.children.find((c) => c.tagName === "STYLE");
  assert(style, "no stylesheet");
  assert(style.textContent.includes("#E4572E"), "the partner's accent is missing");
});

await check("data-accent on the div overrides the stored colour", async () => {
  const { root } = await run(GOALS, {
    "data-thauma": "chase-roush", "data-accent": "#00AAFF",
  });
  const style = root.children.find((c) => c.tagName === "STYLE");
  assert(style.textContent.includes("#00AAFF"), "override ignored");
});

await check("a junk data-accent cannot reach the stylesheet", async () => {
  /* The one attribute value that ends up inside CSS, and it comes from
     markup on a site we do not control. */
  const { root } = await run(GOALS, {
    "data-thauma": "chase-roush", "data-accent": "red;}body{display:none}",
  });
  const style = root.children.find((c) => c.tagName === "STYLE");
  assert(!style.textContent.includes("red;}body"), "CSS injection got through");
  assert(style.textContent.includes("#6D4AFF"), "should fall back to the house colour");
});

await check("the roadmap renders milestones in order with their status", async () => {
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap",
  });
  const steps = root.byClass("step");
  eq(steps.length, 2, "milestone count");
  assert(steps[0].className.includes("complete"), `first status: ${steps[0].className}`);
  assert(steps[1].className.includes("in_progress"), `second status: ${steps[1].className}`);
  assert(/Commissioned in Beograd/.test(root.allText), "first title missing");
});

await check("an undated milestone sorts LAST, not to 1970", async () => {
  /* new Date(null) is the epoch, not an invalid date. Without an explicit
     null guard, a milestone with no actual_date sorts before every real one
     and the roadmap opens with the thing that has not been scheduled yet. */
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap",
  });
  const steps = root.byClass("step");
  assert(steps[0].allText.includes("Commissioned"),
    `the dated milestone must come first, got: ${steps[0].allText.slice(0, 40)}`);
});

await check("data-lang picks that language's text", async () => {
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-lang": "sr",
  });
  assert(/Послат у Београд/.test(root.allText), "Serbian title missing");
  assert(!/Commissioned in Beograd/.test(root.allText), "showed English instead");
});

await check("a milestone with no translation in that language falls back to English", async () => {
  /* m2 has only English. A blank row would look broken; the English is
     honest and useful. */
  const { root } = await run(ROADMAP, {
    "data-thauma": "mira-petrovic", "data-widget": "roadmap", "data-lang": "sr",
  });
  assert(/Monthly support/.test(root.allText), "the English-only milestone vanished");
});

await check("a partner with nothing to show says so rather than drawing an empty box", async () => {
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

await check("two placements for one partner share a single fetch", async () => {
  /* A page showing goals and roadmap side by side must not ask twice. */
  const a = new Node("div"); a.attributes = { "data-thauma": "chase-roush" };
  const b = new Node("div"); b.attributes = { "data-thauma": "chase-roush", "data-widget": "roadmap" };
  const doc = makeDocument([a, b]);
  const calls = [];
  const sandbox = {
    document: doc, URL, Intl, console, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: true }),
    addEventListener: () => {},
    fetch: async (url, init) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => GOALS };
    },
  };
  sandbox.window = sandbox;
  sandbox.parent = sandbox;
  new Function("window", "document", "fetch", "URL", "Intl", "requestAnimationFrame",
               "MutationObserver", "setTimeout", "clearTimeout", "console", WIDGET_JS)(
    sandbox, doc, sandbox.fetch, URL, Intl, sandbox.requestAnimationFrame,
    sandbox.MutationObserver, setTimeout, clearTimeout, console);
  await new Promise((r) => setTimeout(r, 0));
  eq(calls.length, 1, "one fetch for two placements");
});

await check("injected preview data is used INSTEAD of fetching", async () => {
  /* How the console previews a widget that is not published yet. The public
     endpoint 404s until embedding is switched on, so a preview that fetched
     could only ever show what had already been published. */
  const node = new Node("div");
  node.attributes = { "data-thauma": "chase-roush" };
  const doc = makeDocument([node]);
  let fetched = false;

  const sandbox = {
    document: doc, URL, Intl, console, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: true }),
    addEventListener: () => {},
    fetch: async () => { fetched = true; throw new Error("must not fetch"); },
    __thaumaPreview: GOALS,
  };
  sandbox.window = sandbox;
  sandbox.parent = sandbox;

  new Function("window", "document", "fetch", "URL", "Intl", "requestAnimationFrame",
               "MutationObserver", "setTimeout", "clearTimeout", "console", WIDGET_JS)(
    sandbox, doc, sandbox.fetch, URL, Intl, sandbox.requestAnimationFrame,
    sandbox.MutationObserver, setTimeout, clearTimeout, console);
  await new Promise((r) => setTimeout(r, 0));

  assert(!fetched, "it fetched even though preview data was injected");
  assert(/Monthly support/.test(node.shadowRoot.allText), "did not render the injected data");
});

await check("injected data for a DIFFERENT partner is ignored", async () => {
  /* The guard that keeps the injection from being a way to put one partner's
     numbers under another partner's name. */
  const node = new Node("div");
  node.attributes = { "data-thauma": "someone-else" };
  const doc = makeDocument([node]);
  let fetched = false;

  const sandbox = {
    document: doc, URL, Intl, console, setTimeout, clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    MutationObserver: class { observe() {} },
    ResizeObserver: class { observe() {} },
    matchMedia: () => ({ matches: true }),
    addEventListener: () => {},
    fetch: async () => { fetched = true; return { ok: false, status: 404, json: async () => ({}) }; },
    __thaumaPreview: GOALS,          // says chase-roush
  };
  sandbox.window = sandbox;
  sandbox.parent = sandbox;

  new Function("window", "document", "fetch", "URL", "Intl", "requestAnimationFrame",
               "MutationObserver", "setTimeout", "clearTimeout", "console", WIDGET_JS)(
    sandbox, doc, sandbox.fetch, URL, Intl, sandbox.requestAnimationFrame,
    sandbox.MutationObserver, setTimeout, clearTimeout, console);
  await new Promise((r) => setTimeout(r, 0));

  assert(fetched, "it used another partner's injected data instead of fetching");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
