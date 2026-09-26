#!/usr/bin/env node
/**
 * The Resources page — four doors, a search, and formats
 *   node test/library-page.test.mjs
 *
 * WHAT THIS PAGE IS FOR. src/_data/resources.js files every resource by the
 * MOMENT somebody is in when they need it — crisis, growth, planning, lookup —
 * rather than by subject, and says why: a visitor with a dead mixer does not
 * know which category their problem belongs to, they know what just happened.
 *
 * The page ignored that for months and printed `format` instead, which is the
 * one thing a person in that state does not care about. So the first test
 * below is that the doors are on the page at all, and the rest run the real
 * filtering in a real DOM rather than asserting that some markup exists.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { buildDevSite } from "./lib/dev-build.mjs";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the Resources page\n");

const html = await (async () => {
  const built = await buildDevSite("/tmp/library-test", "en/resources/index.html",
    { contentDir: new URL("./fixtures/", import.meta.url).pathname });
  if (!built.ok) {
    console.log("  FAIL  could not build the site:", built.error);
    process.exit(1);
  }
  return readFileSync("/tmp/library-test/en/resources/index.html", "utf8");
})();
const MAIN = readFileSync("src/js/main.js", "utf8");
const d = new JSDOM(html).window.document;

/* A page with the script running, so the filtering can actually be driven.
   `url` matters: the library reads and rewrites the query string. */
function live(search = "") {
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/en/resources/" + search,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    },
  });
  const tag = dom.window.document.createElement("script");
  tag.textContent = MAIN;
  dom.window.document.body.appendChild(tag);
  return dom;
}
const shown = (doc) => [...doc.querySelectorAll(".resource-card")]
  .filter((c) => !c.hidden)
  .map((c) => c.querySelector("h3").textContent.trim());

/* ------------------------------------------------------------- the doors */

await check("the four doors are on the page, in the data's own order", async () => {
  const doors = [...d.querySelectorAll(".door")].map((b) => b.dataset.door);
  assert(doors.join(",") === "crisis,growth,planning,lookup",
    `the doors are ${doors.join(", ") || "missing"}`);
});

await check("every card carries what the filters read", async () => {
  const cards = [...d.querySelectorAll(".resource-card")];
  assert(cards.length === 3, `${cards.length} cards built from the fixtures`);
  for (const c of cards) {
    assert(c.dataset.moment, "a card has no moment");
    assert(c.dataset.format, "a card has no format");
    assert(c.dataset.text, "a card has nothing to search");
  }
});

await check("the search corpus includes what is NOT on the card", async () => {
  /* Somebody types what just happened — "no sound" — and that is a symptom,
     which the card never displays. Scraping the rendered text would miss it. */
  const crisis = [...d.querySelectorAll(".resource-card")]
    .find((c) => c.dataset.moment === "crisis");
  assert(/no sound/.test(crisis.dataset.text), `symptoms are missing: ${crisis.dataset.text}`);
});

/* -------------------------------------------------------- the filtering */

await check("a door shows its own resources and hides the rest", async () => {
  const dom = live();
  const doc = dom.window.document;
  assert(shown(doc).length === 3, "everything should show before a door is chosen");
  doc.querySelector('.door[data-door="crisis"]').click();
  const left = shown(doc);
  assert(left.length === 1 && /No sound/.test(left[0]), `crisis showed ${left.join(", ")}`);
});

await check("pressing the door you are inside returns you to everything", async () => {
  /* The same control both ways, so there is no separate "clear" to hunt for. */
  const dom = live();
  const doc = dom.window.document;
  const crisis = doc.querySelector('.door[data-door="crisis"]');
  crisis.click();
  crisis.click();
  assert(shown(doc).length === 3, "the door did not let go");
  assert(crisis.getAttribute("aria-pressed") === "false", "it still reads as pressed");
});

await check("a door's count is what pressing it would GIVE you", async () => {
  /* A door reading 6 that shows nothing once pressed is a lie the first time
     and ignored after. Counts are computed against the other filters. */
  const dom = live();
  const doc = dom.window.document;
  const n = (door) => doc.querySelector(`.door[data-door="${door}"] .door-n`).textContent;
  assert(n("crisis") === "1", `crisis counted ${n("crisis")}`);
  assert(n("planning") === "", `a door with nothing behind it printed "${n("planning")}"`);

  doc.querySelector('.fmt[data-fmt="guide"]').click();
  assert(n("crisis") === "",
    "the crisis count ignored the format filter — it would promise a guide it does not have");
  assert(n("growth") === "1", `growth counted ${n("growth")} once guides only`);
});

await check("an empty door is dimmed, never removed", async () => {
  /* A control that vanishes under the hand is worse than a quiet one. */
  const dom = live();
  const doc = dom.window.document;
  const planning = doc.querySelector('.door[data-door="planning"]');
  assert(planning.classList.contains("is-empty"), "an empty door is not marked");
  assert(!planning.hidden, "the door was removed from the page");
});

await check("search reads symptoms, not just the words on the card", async () => {
  const dom = live();
  const doc = dom.window.document;
  const q = doc.getElementById("libQ");
  q.value = "no sound";
  q.dispatchEvent(new dom.window.Event("input"));
  const left = shown(doc);
  assert(left.length === 1 && /No sound/.test(left[0]), `got ${left.join(", ")}`);
});

await check("when nothing matches, the way out is a button", async () => {
  /* Not a sentence telling somebody to clear their filters. */
  const dom = live();
  const doc = dom.window.document;
  const q = doc.getElementById("libQ");
  q.value = "xylophone";
  q.dispatchEvent(new dom.window.Event("input"));
  assert(!doc.getElementById("libNone").hidden, "nothing said the grid was empty");
  doc.getElementById("libClear").click();
  assert(shown(doc).length === 3, "the way out did not work");
  assert(doc.getElementById("libNone").hidden, "the empty notice stayed up");
});

/* ------------------------------------------------------------ the sharing */

await check("the door is in the address, so the page can be sent to somebody", async () => {
  const dom = live();
  const doc = dom.window.document;
  doc.querySelector('.door[data-door="growth"]').click();
  assert(/door=growth/.test(dom.window.location.search),
    `the address says "${dom.window.location.search}"`);
});

await check("and arriving with one already chosen opens it", async () => {
  const dom = live("?door=crisis");
  const doc = dom.window.document;
  const left = shown(doc);
  assert(left.length === 1 && /No sound/.test(left[0]), `got ${left.join(", ")}`);
  assert(doc.querySelector('.door[data-door="crisis"]').getAttribute("aria-pressed") === "true",
    "the door does not show as the one you are inside");
});

await check("a made-up door in the address is ignored, not obeyed", async () => {
  const dom = live("?door=nonsense");
  assert(shown(dom.window.document).length === 3, "a bad address emptied the page");
});

/* ------------------------------------------------------- the scroll reveal */

/* A page WITH an IntersectionObserver, so main.js takes its reveal path.
   JSDOM has none, which is why every test above ran with the reveal switched
   off — and why none of them could have caught the bug below. The stub
   reports everything as intersecting the moment it is observed, which is what
   a tall desktop viewport does. */
function revealing(search = "") {
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/en/resources/" + search,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
      w.IntersectionObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(el) {
          /* DEFERRED, because that is the order a browser uses and the order
             the bug lives in. The reveal is queued behind the page settling,
             so the library's own first pass — which runs while the script is
             parsed — has already hidden the filtered-out cards by the time
             anything is observed. Firing synchronously here made the test
             pass against code that was plainly broken on screen.

             And only displayed elements intersect: a hidden card has no box. */
          queueMicrotask(() => {
            if (el.hidden) return;
            this.cb([{ isIntersecting: true, target: el }], this);
          });
        }
        unobserve() {} disconnect() {}
      };
    },
  });
  const tag = dom.window.document.createElement("script");
  tag.textContent = MAIN;
  dom.window.document.body.appendChild(tag);
  return dom;
}

await check("a card the filter brings back is VISIBLE, not an empty box", async () => {
  /* The scroll-reveal hides every card behind `sr` until its observer adds
     `in`. A card that was display:none when that observer ran never got
     revealed — so arriving at ?door=crisis and then clearing the door showed
     the right cards as blank rectangles. Found by screenshotting the filtered
     page, not by any assertion about `hidden`. */
  const dom = revealing("?door=crisis");
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 0));   // let the deferred reveal run
  const hiddenAtLoad = [...doc.querySelectorAll(".resource-card")].filter((c) => c.hidden);
  assert(hiddenAtLoad.length === 2, `${hiddenAtLoad.length} cards were filtered out at load`);

  doc.getElementById("libClear").click();
  const invisible = [...doc.querySelectorAll(".resource-card")]
    .filter((c) => !c.hidden && c.classList.contains("sr") && !c.classList.contains("in"))
    .map((c) => c.querySelector("h3").textContent.trim());
  assert(!invisible.length,
    `back in the grid but still invisible: ${invisible.join(", ")}`);
});

await check("and the load-time fade is not skipped for the whole grid", async () => {
  /* The fix must not reveal everything the moment the script runs, or the
     page stops fading in and simply appears. */
  const dom = revealing();
  const doc = dom.window.document;
  await new Promise((r) => setTimeout(r, 0));
  const cards = [...doc.querySelectorAll(".resource-card")];
  assert(cards.every((c) => c.classList.contains("in")),
    "the observer never revealed the grid at all");
  /* The reveal has to have come from the observer, which is what the stub
     stands in for — not from the filter forcing it. */
  assert(/settledOnce/.test(MAIN), "there is no guard against revealing on the first pass");
});

/* ------------------------------------------------- it works without words */

await check("nothing on the page explains how to use it", async () => {
  /* Chase, 2026-09-25: if an interface needs a sentence to explain how to
     operate it, the interface needs work — not the sentence. The four door
     phrases, a magnifier and the format chips are the whole instruction. */
  const lib = d.getElementById("lib");
  const prose = [...lib.querySelectorAll("p")]
    .filter((p) => !p.closest(".resource-card") && p.id !== "libNone")
    .map((p) => p.textContent.trim())
    .filter(Boolean);
  assert(!prose.length, `the library explains itself: ${prose.join(" / ")}`);
});

await check("the controls stay out of the page when the script cannot run", async () => {
  /* They filter in the browser, so without it they would be four dead
     buttons over a grid that never changes. */
  const css = readFileSync("src/css/main.css", "utf8");
  assert(/\.doors,\.lib-bar,\.lib-none\{display:none\}/.test(css),
    "the filter controls show before anything can make them work");
  assert(/lib\.classList\.add\('lib-js'\)/.test(MAIN), "nothing ever turns them on");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
