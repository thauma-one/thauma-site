#!/usr/bin/env node
/**
 * The embed previews fit in their box
 *   node test/mailing-preview.test.mjs
 *
 * A contact form is genuinely around 700px tall — six fields and a message box
 * — and at 1:1 the console had to be scrolled to see the end of its own
 * preview. Scrolling to see a preview defeats what a preview is for.
 *
 * So the frame is drawn at full size and the WRAPPER is scaled. That
 * distinction is the whole design and it is what the tests below protect:
 * scaling the iframe itself would shrink the drawing surface with it, and the
 * widget would then answer a different question about how wide its container
 * is. A 480px card in a 640px frame shown at 70% is honest. A card asked to
 * draw itself at 448px is a different card.
 *
 * This runs the real console script against the real built page, because the
 * lesson of this project is that a test which reads a file proves the file
 * exists and nothing else.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = "_site/staff/mailing/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("mailing previews — do they fit\n");

if (!existsSync(PAGE)) {
  console.log(`  SKIP  ${PAGE} is missing — run the build first.`);
  process.exit(0);
}

const LISTS = [{
  id: "ml_1", partner_id: "p_c", slug: "newsletter", name: "Newsletter",
  from_name: "Chase", from_email: "news@x.one", is_open: 1, archive_public: 1,
  subscribed: 128, pending: 0, unsubscribed: 0,
}];

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only",
    url: "https://next.thauma.one/staff/mailing/",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  const body = {
    you: { email: "c@thauma.one", roles: ["staff", "admin"] },
    scope: "partner", may_theme: true,
    partner: { id: "p_c", slug: "chase-roush", display_name: "Chase Roush" },
    lists: LISTS, tags: [], senders: [], mailings: [],
    embed: { accent: "#72A8F8", theme: "auto", enabled: true },
    contact: { partner_id: "p_c", deliver_to: "x@example.invalid",
               from_address: "contact@x.one", heading: "Get in touch",
               blurb: null, button: "Send", thanks: null, is_open: 1 },
    topics: [{ id: "t1", label: "General", deliver_to: null, sort_order: 0 }],
  };
  const people = [];
  for (let i = 0; i < 12; i++) {
    people.push({ id: "s" + i, email: "p" + i + "@example.invalid",
      name: i % 2 ? "Person " + i : null, status: "subscribed",
      subscribed_at: "2026-05-0" + (1 + (i % 9)) + "T10:00:00Z",
      source: "sign-up form", tags: null });
  }
  w.fetch = async (u) => ({
    ok: true, status: 200,
    json: async () => (String(u).includes("list=")
      ? { list: LISTS[0], page: 0, page_size: 100,
          total: people.length, subscribers: people }
      : body),
  });
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffToast = () => {}; w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};

  for (const f of ["staff-i18n.js", "staff.js", "staff-rowpanel.js", "staff-mailing.js"]) {
    w.eval(readFileSync("src/js/" + f, "utf8"));
  }
  await new Promise((r) => setTimeout(r, 350));
  return w;
}

/** Open a tab, then pretend its widget reported `h` pixels of content. */
function reportHeight(w, kind, h) {
  const frame = w.document.querySelector(`[data-${kind}="frame"]`);
  const fake = {};
  Object.defineProperty(frame, "contentWindow", { value: fake, configurable: true });
  w.dispatchEvent(new w.MessageEvent("message",
    { data: { __thaumaHeight: h }, source: fake }));
  return {
    frame,
    wrap: w.document.querySelector(`[data-${kind}="scale"]`),
    stage: w.document.querySelector(`[data-${kind}="stage"]`),
    note: w.document.querySelector(`[data-${kind}="scaleNote"]`),
  };
}

const w = await boot();
const press = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

press(w.document.querySelector('[data-view="contact"]'));
await new Promise((r) => setTimeout(r, 200));

await check("a tall form is scaled down so the whole thing is visible", () => {
  const { frame, wrap, stage, note } = reportHeight(w, "ct", 760);
  eq(stage.style.blockSize, "480px", "the box must not grow past what fits on screen");
  eq(frame.style.blockSize, "760px",
    "the FRAME stays full size — only the wrapper scales, or the widget would " +
    "be drawing itself into a smaller container and answering a different question");
  assert(/scale\(0\.63/.test(wrap.style.transform),
    `expected roughly 63%: ${wrap.style.transform}`);
  assert(/shown at 63%/.test(note.textContent),
    `the scale must be stated, or smaller type reads as the type a visitor gets: ` +
    JSON.stringify(note.textContent));
});

await check("the wrapper is widened by exactly what the scale takes back", () => {
  /* Otherwise the scaled result lands narrower than its box and leaves a
     gutter down the right-hand side. */
  const { wrap } = reportHeight(w, "ct", 760);
  const scale = Number(/scale\(([\d.]+)\)/.exec(wrap.style.transform)[1]);
  const width = Number(/([\d.]+)%/.exec(wrap.style.inlineSize)[1]);
  assert(Math.abs(width * scale - 100) < 0.5,
    `${width}% at ${scale} lands at ${(width * scale).toFixed(1)}%, not 100%`);
});

await check("a short form is left alone at 1:1", () => {
  // Shrinking something that already fits would make it needlessly harder to read.
  const { wrap, stage, note } = reportHeight(w, "ct", 400);
  eq(stage.style.blockSize, "400px", "the box should match the content");
  eq(wrap.style.transform, "scale(1)", "no scaling needed");
  eq(note.textContent, "", "and nothing to announce");
});

await check("a nonsense height cannot blow the box open", () => {
  const { stage } = reportHeight(w, "ct", 99999);
  assert(parseInt(stage.style.blockSize, 10) <= 480,
    `the box grew to ${stage.style.blockSize}`);
});

await check("the sign-up preview fits the same way", () => {
  /* Two screens, one behaviour. A second copy of this logic is a second thing
     to fix when the number changes. */
  press(w.document.querySelector('[data-view="embed"]'));
  const { frame, wrap, stage } = reportHeight(w, "pv", 900);
  eq(stage.style.blockSize, "480px", "the sign-up box should cap too");
  eq(frame.style.blockSize, "900px", "and its frame should stay full size");
  assert(/scale\(0\.5/.test(wrap.style.transform),
    `expected roughly 53%: ${wrap.style.transform}`);
});

await check("the stage clips what the scaled frame overhangs", () => {
  /* The wrapper is deliberately wider than its box, so without overflow
     hidden the console would gain a horizontal scrollbar. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const rule = /\.ct-stage\{([^}]*)\}/.exec(css);
  assert(rule, "no .ct-stage rule");
  assert(/overflow:\s*hidden/.test(rule[1]), `the stage does not clip: ${rule[1]}`);
  assert(/transform-origin:\s*top left/.test(css),
    "the scale origin must be top left — the wrapper's extra width is added on " +
    "the right, and a centred origin would offset it by half");
});

/* ------------------- clicking a person is not a tab ------------------- */

await check("clicking a subscriber does not blank the page", async () => {
  /* The subscriber rows carried data-sub="<id>" and so did the
     Subscribers/Settings tabs (data-sub="people"). One document-level handler
     matched both, so clicking a person asked to show a panel named after them,
     nothing matched, both tabs went dark and the panel emptied — and it stayed
     empty until a tab was clicked, which made it look as though every
     subscriber had been deleted. */
  press(w.document.querySelector('[data-view="' + LISTS[0].id + '"]'));
  await new Promise((r) => setTimeout(r, 250));

  const panel = w.document.querySelector('[data-subpanel="people"]');
  const onTabs = () => [...w.document.querySelectorAll(".ml-subtab")]
    .filter((b) => b.classList.contains("is-on")).map((b) => b.dataset.sub).join(",");

  assert(!panel.hidden, "the people panel should be open to begin with");
  const rowsBefore = w.document.querySelectorAll("#mlSubscribers tbody tr").length;
  assert(rowsBefore > 0, "no rows to click");

  for (const sel of ["#mlSubscribers tbody tr", "#mlSubscribers .subs-email"]) {
    press(w.document.querySelector(sel));
    await new Promise((r) => setTimeout(r, 80));
    eq(onTabs(), "people", `clicking ${sel} changed which tab is selected`);
    assert(!panel.hidden, `clicking ${sel} hid the panel`);
    eq(w.document.querySelectorAll("#mlSubscribers tbody tr").length, rowsBefore,
      `clicking ${sel} emptied the list`);
  }
});

await check("the two attributes are no longer the same one", () => {
  /* Belt and braces: the handler is scoped to the tab strip AND the rows use a
     different attribute, so losing either guard alone does not bring the bug
     back. */
  const js = readFileSync("src/js/staff-mailing.js", "utf8");
  assert(/data-subrow=/.test(js), "the rows should carry their own attribute");
  assert(/\.ml-subtabs \[data-sub\]/.test(js),
    "the sub-tab handler must be scoped to the tab strip, not to any data-sub");
});

/* --------------------- a sticky header must be solid ------------------- */

await check("A STICKY HEADER INSIDE A SCROLL CONTAINER STICKS TO ZERO", () => {
  /* THE ONE THAT ACTUALLY CAUSED THE OVERLAP.

     The offset was var(--header-h) — the page bar's height — on the
     reasonable-sounding theory that the column labels should park just below
     it. They never did. Both tables live inside a wrapper with
     `overflow-x:auto`, and when one overflow axis is not `visible` the other
     computes to `auto`, so that wrapper is a scroll container on both axes.

     position:sticky resolves against the nearest SCROLLING ANCESTOR. That is
     the wrapper, not the page — so the header parked 62px down from the top of
     the table, permanently, at any scroll position, sitting on the first row.

     This is a static check because the bug is static: no scrolling is needed
     to reproduce it, and jsdom has no layout to measure anyway. */
  const css = readFileSync("src/css/staff.css", "utf8");

  const wrappers = [...css.matchAll(/\.([\w-]+)\{[^}]*overflow(-[xy])?:\s*(auto|scroll)/g)]
    .map((m) => m[1]);
  for (const w of ["tw", "subs-wrap"]) {
    assert(wrappers.includes(w), `.${w} should still be the table's scroll wrapper`);
  }

  const rule = /thead th\{([^}]*)\}/.exec(css);
  assert(rule, "no thead th rule");
  const top = /top:\s*([^;]+)/.exec(rule[1]);
  assert(top, "the sticky header has no offset at all");
  assert(/^0(px)?$/.test(top[1].trim()),
    `a header inside a scroll container must stick to 0, not ${top[1].trim()} — ` +
    `anything else parks it that far DOWN the table, on top of the first rows`);
});

await check("STICKY TABLE HEADERS ARE OPAQUE", () => {
  /* This was rgba(255,255,255,.025) — two and a half per cent white, which is
     a tint rather than a background. Every row scrolled straight THROUGH the
     header, so column labels and somebody's name were legible on top of each
     other. It read as a layout bug and was a transparency bug, and because the
     rule is global it affected every table in the console at once. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const rule = /thead th\{([^}]*)\}/.exec(css);
  assert(rule, "no thead th rule");
  const bg = /background:\s*([^;]+)/.exec(rule[1]);
  assert(bg, "the sticky header has no background at all");

  assert(!/rgba\([^)]*,\s*0?\.\d+\s*\)/.test(bg[1]),
    `a sticky header cannot be semi-transparent: ${bg[1].trim()}`);
  assert(!/transparent/i.test(bg[1]), "nor transparent");
  assert(/position:\s*sticky/.test(rule[1]),
    "if it stops being sticky this test is measuring nothing");
  assert(!/box-shadow/.test(rule[1]),
    "the upward shadow was covering a gap that did not exist — it was a fix " +
    "for the wrong diagnosis and should not come back");
});

await check("the subscriber table does not restate the header rule", () => {
  /* Two definitions of one thing is how the transparency bug would have needed
     fixing twice — and how the second copy quietly stops matching the first. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const subs = /\.subs th\{([^}]*)\}/.exec(css);
  assert(subs, "no .subs th rule");
  assert(!/background/.test(subs[1]),
    `.subs th sets its own background: ${subs[1].trim()}`);
  assert(!/position/.test(subs[1]), ".subs th sets its own position");
});

await check("a subscriber row does not pretend to be clickable", () => {
  /* The global tbody rule sets cursor:pointer, because the contacts table
     opens a history panel on click. A subscriber row does nothing — its
     controls are in the last cell — and a hand cursor over it is a promise the
     table does not keep. That promise is what made clicking one feel as though
     it ought to do something. */
  const css = readFileSync("src/css/staff.css", "utf8");
  assert(/\.subs tbody tr\{[^}]*cursor:\s*default/.test(css),
    "subscriber rows still show a pointer cursor");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
