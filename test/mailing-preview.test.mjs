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

/* CI DOES NOT BUILD INTO _site. Staging builds to _site_next and production to
   _site_prod, so looking only in _site meant both of these printed SKIP and
   exited 0 in the one place they most needed to run — silently no coverage,
   which is the exact failure this file was written to stop happening to
   somebody else. */
const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/mail/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/mail/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("mailing — the subscriber screens\n");

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
    url: "https://next.thauma.one/staff/mail/",
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

/* The form previews moved to Sharing with the forms themselves; their
   fitting is tested in sharing-page.test.mjs. */

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
  const settings = w.document.getElementById("mlListSettings");

  assert(!panel.hidden, "the people panel should be open to begin with");
  const rowsBefore = w.document.querySelectorAll("#mlSubscribers tbody tr").length;
  assert(rowsBefore > 0, "no rows to click");

  for (const sel of ["#mlSubscribers tbody tr", "#mlSubscribers .subs-email"]) {
    press(w.document.querySelector(sel));
    await new Promise((r) => setTimeout(r, 80));
    eq(settings.getAttribute("aria-pressed"), "false", `clicking ${sel} opened the list's settings`);
    assert(!panel.hidden, `clicking ${sel} hid the panel`);
    eq(w.document.querySelectorAll("#mlSubscribers tbody tr").length, rowsBefore,
      `clicking ${sel} emptied the list`);
  }
});

await check("the two attributes are no longer the same one", () => {
  /* Belt and braces: the rows carry their own attribute, and nothing on the
     page is found by a data-sub or data-view that a row could also carry. */
  const js = readFileSync("src/js/staff-mailing.js", "utf8");
  assert(/data-subrow=/.test(js), "the rows should carry their own attribute");
  assert(!/\.closest\('\[data-(sub|view)\]'\)/.test(js),
    "a handler finds tabs by an attribute a row could carry");
  assert(/\.ml-tabs \[data-view\]/.test(js), "the list tabs must be found inside the tab strip");
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
