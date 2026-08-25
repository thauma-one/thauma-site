#!/usr/bin/env node
/**
 * The public widgets actually RUN
 *   node workers/test/widgets-run.test.mjs
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-23 the contact widget did not parse. A single apostrophe inside
 * an SVG data URI — three levels of nesting down, in a string built inside a
 * string inside a template literal — ended the emitted JavaScript early. The
 * form drew NOTHING on any page it was on.
 *
 * Everything else said it was fine. `node --check` passed, because contact.js
 * itself is valid. The endpoint returned 200, because the broken script was
 * served perfectly. Twenty-eight tests passed, because every one of them
 * asserted on the script AS TEXT and none ever executed it.
 *
 * That is the same failure as the first composer, in a new place: a test that
 * reads a string proves the string exists, not that it works. So this file
 * evaluates both widgets in a DOM and looks at what they drew.
 */
import { JSDOM } from "jsdom";
import { formScript } from "../src/signup.js";
import { contactScript } from "../src/contact.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const LIST = { id: "ml_1", partner_id: "p_c", name: "Newsletter", slug: "newsletter",
  from_name: "Chase", from_email: "news@x.one", reply_to: null,
  form_heading: null, form_blurb: null, form_button: null, form_thanks_url: null };

const FORM = { deliver_to: "x@example.invalid", from_address: "contact@x.one",
  heading: "Get in touch", blurb: "The saved blurb.", button: "Send", thanks: null,
  display_name: "Chase Roush",
  embed_accent: "#72A8F8", embed_accent2: null, embed_theme: "auto" };

const TOPICS = [{ id: "ct_gen", label: "General" },
                { id: "ct_pray", label: "Prayer request" }];

/**
 * Run a widget against a host node and hand back what it drew.
 *
 * `width` fakes the container's measured width, because jsdom lays nothing out
 * and getBoundingClientRect returns zeroes — so the widget could never decide
 * it was narrow without being told.
 */
function draw(js, attr, extra = "", width = 640) {
  /* `runScripts` is what gives window.eval a real `document` to close over.
     Without it the widget throws "document is not defined" on its first line
     — a property of the harness, not of the widget. */
  const dom = new JSDOM(`<div ${attr} ${extra}></div>`,
    { runScripts: "outside-only", pretendToBeVisual: true });
  const errors = [];
  dom.window.addEventListener("error", (e) => errors.push(e.message));
  const node0 = dom.window.document.querySelector(`[${attr.split("=")[0]}]`);
  node0.getBoundingClientRect = () => ({ width, height: 0, top: 0, left: 0,
                                         right: width, bottom: 0 });

  /* A parent to receive the height report. On a real page there is none, and
     the widget is simply as tall as its content — this is the console's
     preview case, where the frame has to be told. */
  const posted = [];
  dom.window.parent = { postMessage: (m) => posted.push(m) };
  dom.window.document.body.getBoundingClientRect = () => ({ height: 512 });

  dom.window.eval(js);              // throws outright if the script cannot parse
  const node = dom.window.document.querySelector(`[${attr.split("=")[0]}]`);
  return { root: node.shadowRoot, errors, posted, window: dom.window };
}

console.log("widgets — do they actually run\n");

/* --------------------------- they parse at all -------------------------- */

check("both widgets are valid JavaScript", () => {
  /* `new Function` is the cheapest possible version of this check, and it is
     the one that was missing. A script served with a 200 that cannot parse is
     indistinguishable from a working one at every layer above the browser. */
  for (const [what, js] of [
    ["sign-up", formScript([LIST], "chase-roush", "https://thauma.one")],
    ["contact", contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS)],
  ]) {
    try { new Function(js); }
    catch (e) { throw new Error(`the ${what} widget does not parse: ${e.message}`); }
  }
});

/* ------------------------- the sign-up form draws ----------------------- */

check("the sign-up form draws its card, fields and checkboxes", () => {
  const { root } = draw(formScript([LIST, { ...LIST, id: "ml_2", slug: "prayer", name: "Prayer" }],
    "chase-roush", "https://thauma.one"), "data-thauma-form");
  assert(root, "no shadow root — nothing was drawn");
  assert(root.querySelector(".card"), "no card");
  eq(root.querySelectorAll("input[name=list]").length, 2, "one checkbox per list");
  assert(root.querySelector("input[name=email]"), "no email field");
  assert(root.querySelector("input[name=website]"), "no honeypot");
});

/* -------------------------- the contact form draws ---------------------- */

check("the contact form draws every field it promises", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  assert(root, "no shadow root — nothing was drawn");
  const names = [...root.querySelectorAll("[name]")].map((i) => i.name);
  for (const n of ["name", "email", "topic", "subject", "message", "website"]) {
    assert(names.includes(n), `the ${n} field is missing — drew: ${names.join(", ")}`);
  }
});

check("the reason dropdown carries the ministry's own options", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  const opts = [...root.querySelectorAll("select[name=topic] option")];
  eq(opts.length, 3, "a prompt plus two reasons");
  eq(opts[1].value, "ct_gen", "options carry ids, not labels");
  eq(opts[1].textContent, "General", "the label is what a visitor reads");
});

check("no reasons means no dropdown, and the form still draws", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, []),
    "data-thauma-contact");
  assert(!root.querySelector("select[name=topic]"), "an empty dropdown was drawn");
  assert(root.querySelector("[name=message]"), "the rest of the form should be fine");
});

check("THE SELECT'S ARROW SURVIVES ITS OWN QUOTES", () => {
  /* The bug this file was written for. The arrow is an inline SVG data URI,
     built three levels of string nesting down; a literal apostrophe in it
     ended the emitted script and the whole widget drew nothing. */
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  const css = root.querySelector("style").textContent;
  assert(/background-image:\s*url\(/.test(css), "the arrow rule is missing entirely");
  assert(!/xmlns='http/.test(css),
    "a raw apostrophe is back in the data URI — this is exactly what broke it");
});

/* ---------------------- what the console's preview needs ---------------- */

check("the wording can be overridden by attribute, for the visualiser", () => {
  const js = contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS);
  const { root } = draw(js, "data-thauma-contact",
    'data-heading="Reach out" data-blurb="" data-button="Send it" data-thanks="Got it."');
  eq(root.querySelector(".ttl").textContent, "Reach out", "heading");
  eq(root.querySelector(".go").textContent, "Send it", "button");
  eq(root.querySelector(".done .big").textContent, "Got it.", "thanks");
  assert(root.querySelector(".blurb").hidden, "an emptied blurb should hide, not sit blank");
});

check("without overrides it shows what the ministry saved", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  eq(root.querySelector(".ttl").textContent, "Get in touch", "the saved heading");
  eq(root.querySelector(".blurb").textContent, "The saved blurb.", "the saved blurb");
});

check("an override cannot become markup", () => {
  /* These come from a host page's own attributes, and the one thing a widget
     must never do is turn a host's string into elements. */
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact", 'data-heading="<b>bold</b>"');
  assert(!root.querySelector(".ttl b"), "an element was injected through an attribute");
  eq(root.querySelector(".ttl").textContent, "<b>bold</b>", "it should read as text");
});

check("the ministry's accent reaches the drawn form", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  assert(/--acc:\s*#72A8F8/i.test(root.querySelector("style").textContent),
    "the saved accent did not reach the stylesheet");
});

check("a host page may override the colours", () => {
  const { root } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact", 'data-accent="#E4572E"');
  const css = root.querySelector("style").textContent;
  assert(/--acc:\s*#E4572E/i.test(css), "the override was ignored");
  assert(!/--acc2:\s*#72A8F8/i.test(css),
    "given a new accent, the second colour must be derived from it rather than " +
    "left as the ministry's — a chosen colour beside somebody else's companion " +
    "is the one pairing nobody wants");
});

/* ------------------- how it behaves in its container -------------------- */

check("the widget reports its height, for the console's preview", () => {
  /* ON A REAL PAGE THIS IS UNUSED. The widget is a div in the host's document
     and is exactly as tall as its content. It matters only in the console,
     where the preview lives in an iframe — and an iframe has a fixed height it
     does not learn from its contents. */
  const { posted } = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  const heights = posted.filter((m) => m && m.__thaumaHeight);
  assert(heights.length, "no height was posted — the preview frame would scroll");
  eq(heights[0].__thaumaHeight, 512, "it should report the BODY's measured height");
});

check("a narrow container tightens the card; a wide one does not", () => {
  /* A CONTAINER QUESTION, NOT A WINDOW ONE. A 380px column on a large monitor
     needs this exactly as much as a phone does, and a media query would never
     fire there. */
  const js = contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS);
  const wide = draw(js, "data-thauma-contact", "", 640);
  const narrow = draw(js, "data-thauma-contact", "", 360);
  assert(!wide.root.querySelector(".card").classList.contains("tight"),
    "a wide container should not get the tightened layout");
  assert(narrow.root.querySelector(".card").classList.contains("tight"),
    "a narrow container should — otherwise the text feels squeezed");
});

check("the tightened layout actually makes the type smaller", () => {
  // A class that nothing styles is a class that does nothing.
  const css = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact").root.querySelector("style").textContent;
  assert(/\.card\.tight\s*\{/.test(css), "no rules for the tight card at all");
  assert(/\.card\.tight\s+\.ttl\s*\{[^}]*font-size/.test(css),
    "the heading should shrink");
  assert(/\.card\.tight[^{]*(input|textarea)[^{]*\{[^}]*font-size/.test(css),
    "the fields should shrink");
});

check("the card centres in whatever space it is given", () => {
  /* A form is capped at a readable width, but the host decides how wide the
     column is — and a 480px card hugging the left of a 900px container reads
     as a mistake rather than a decision. */
  const css = draw(contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact").root.querySelector("style").textContent;
  const card = /\.card\{([^}]*)\}/.exec(css);
  assert(card, "no .card rule");
  assert(/margin-inline:\s*auto/.test(card[1]), `the card does not centre: ${card[1]}`);
  assert(/max-width/.test(card[1]), "and it should still cap its width for readability");
});

check("the message box grows instead of scrolling", () => {
  /* A fixed box that scrolls internally hides the beginning of somebody's own
     sentence from them while they are still writing it. */
  const { root, posted } = draw(
    contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS),
    "data-thauma-contact");
  const box = root.querySelector("textarea");
  assert(box, "no message box");
  Object.defineProperty(box, "scrollHeight", { value: 300, configurable: true });
  const before = posted.length;
  box.dispatchEvent(new root.ownerDocument.defaultView.Event("input", { bubbles: true }));
  eq(box.style.height, "302px", "it should resize to its content plus the border");
  assert(posted.length > before,
    "and re-report its height, or the preview frame would clip the grown box");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
