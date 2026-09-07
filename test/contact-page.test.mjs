#!/usr/bin/env node
/**
 * The public contact page actually submits somewhere
 *   node test/contact-page.test.mjs
 *
 * WHAT WAS WRONG. The form carried `data-netlify="true"` and posted back to
 * its own page path, which is how Netlify Forms worked on the old host —
 * Netlify intercepted that POST before it reached the site. Cloudflare does
 * not, so it reached the static asset handler and came back 405. The form
 * looked complete, and every submission was lost.
 *
 * workers/src/contact-form.js was written to replace it — same field names,
 * same honeypot, redirecting back with ?sent=true so the success message kept
 * working. It was finished and the form was never pointed at it. Two halves of
 * one feature, each correct, never connected.
 *
 * That is the failure a contact form must never have, so it is asserted here
 * rather than left to somebody noticing the silence.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/en/contact/index.html`));

let pass = 0, fail = 0;
/* AWAITS. It did not, and the moment an async test was added to this file it
   reported PASS the instant it was called: fn() returned a promise, nothing
   threw, the counter went up, and the rejection was swallowed. That is the
   third time this session — admin-profile.test.mjs and mailing-views.test.mjs
   had the same shape — so it is a property of writing these harnesses by hand,
   not an accident that happened once. */
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the contact page submits somewhere\n");
if (!build) { console.log("  SKIP  no build with /en/contact/ — run eleventy first."); process.exit(1); }

const doc = (lang) =>
  new JSDOM(readFileSync(`${build}/${lang}/contact/index.html`, "utf8")).window.document;

await check("the form posts to the Worker, not to its own page", () => {
  const form = doc("en").querySelector("form.contact");
  assert(form, "no contact form on the page");
  assert(form.getAttribute("action") === "/api/contact",
    `the form posts to "${form.getAttribute("action")}" — anything but ` +
    `/api/contact reaches the asset handler and 405s, losing the message`);
  assert((form.getAttribute("method") || "").toUpperCase() === "POST", "not a POST");
});

await check("nothing still expects Netlify to be listening", () => {
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(!/data-netlify/.test(html),
    "data-netlify is still on the form — it does nothing here and reads as " +
    "though submissions are handled when they are not");
  assert(!/name="form-name"/.test(html), "the Netlify form-name field is still present");
});

await check("the honeypot the handler checks is the one the page renders", () => {
  /* The handler reads `bot-field`. A page rendering a differently named
     honeypot would let every bot through while looking protected. */
  const form = doc("en").querySelector("form.contact");
  assert(form.querySelector('[name="bot-field"]'), "no bot-field honeypot");
  const handler = readFileSync("workers/src/contact-form.js", "utf8");
  assert(/raw\["bot-field"\]/.test(handler),
    "the handler no longer checks bot-field; the page and the handler disagree");
});

await check("every field the page sends is one the handler reads", () => {
  const form = doc("en").querySelector("form.contact");
  const sent = [...form.querySelectorAll("[name]")].map((el) => el.getAttribute("name"));
  const handler = readFileSync("workers/src/contact-form.js", "utf8");
  for (const f of sent) {
    if (f === "bot-field") continue;
    assert(new RegExp(`raw\\.${f}\\b`).test(handler),
      `the form sends "${f}" and the handler never reads it`);
  }
});

await check("BOTH outcomes are shown to the visitor", () => {
  /* ?sent=true was handled and ?error=1 was not, so a refused submission
     landed on an ordinary-looking page with the message gone. */
  const d = doc("en");
  assert(d.querySelector("#sent-note"), "no success note");
  assert(d.querySelector("#error-note"),
    "nothing shows when a submission is refused — the visitor's message is " +
    "gone and the page looks normal");
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(/get\('error'\)|get\("error"\)/.test(html), "the error note is never revealed");
});

await check("the refusal message exists in every language the site builds", () => {
  const langs = readdirSync("src/_data/i18n").filter((f) => f.endsWith(".json"));
  for (const f of langs) {
    const d = JSON.parse(readFileSync(`src/_data/i18n/${f}`, "utf8"));
    assert(d.contact && d.contact.form_error,
      `${f} has no contact.form_error, so that language shows an empty error`);
    assert(d.contact.form_error !== d.contact.form_success,
      `${f} shows the SUCCESS text after a failure`);
  }
});

await check("the topics still come from the API, not baked in", () => {
  /* The half that already worked, and must keep working: the page keeps its
     own design and takes only the data. */
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(/fetch\('\/api\/contact'|fetch\("\/api\/contact"/.test(html),
    "the reasons are no longer fetched from the API");
  const sel = doc("en").querySelector("#contact-reason");
  assert(sel && sel.hasAttribute("hidden"),
    "the dropdown is not hidden by default — a page whose API call fails " +
    "would show an empty select");
});

await check("the redirect is built from the configured origin", () => {
  /* new URL(path, request.url) inherits whatever wrangler claims the host is,
     which sent a visitor who submitted over https back over http. */
  const handler = readFileSync("workers/src/contact-form.js", "utf8");
  assert(/siteOrigin\(env, request\)/.test(handler),
    "the redirect is still built from request.url");
});

/* ------------------------------------------------- the reason dropdown looks right */

await check("the reason dropdown is styled like the fields around it", () => {
  /* It was the one field nothing styled. The rule named input and textarea,
     the select arrived later, and it drew the platform's own control: white on
     a dark form, in the system font, at a different height to everything above
     it. A single light box in the middle of the form. */
  const css = readFileSync("src/css/main.css", "utf8");
  const rule = css.match(/form\.contact input,\s*form\.contact textarea,\s*form\.contact select\{/);
  assert(rule,
    "select is not in the shared field rule, so it keeps the browser's own " +
    "background, font and padding");
});

await check("and it surrenders the platform chrome, arrow included", () => {
  const css = readFileSync("src/css/main.css", "utf8");
  /* The STANDALONE rule. `css.indexOf("form.contact select{")` also matches
     the tail of the shared "input, textarea, select{" rule, which has none of
     these declarations in it — so the first version of this assertion read the
     wrong block and failed against correct CSS. Anchored on the line start. */
  const at = css.indexOf("\nform.contact select{");
  assert(at !== -1, "there is no rule targeting the select on its own");
  const decl = css.slice(at, css.indexOf("}", at));
  assert(/appearance:\s*none/.test(decl), "the native dropdown chrome is still drawn");
  assert(/background-image:url\("data:image\/svg/.test(decl),
    "appearance:none removes the arrow too — nothing draws a replacement");
  assert(/color-scheme:\s*dark/.test(decl),
    "the OPEN list is drawn by the platform and cannot be styled; color-scheme " +
    "is the one lever that stops it flashing white over a dark form");
  assert(/padding-right:\s*\d+px/.test(decl),
    "no room reserved for the arrow, so a long reason runs underneath it");
});

await check("the styled select matches the inputs property for property", () => {
  /* Asserted by computing both, not by reading the rule — the point is that
     they LOOK the same, and a later override anywhere could break that while
     the rule above still reads correctly. */
  const d = doc("en");
  const w = d.defaultView;
  const st = d.createElement("style");
  st.textContent = readFileSync("src/css/main.css", "utf8");
  d.head.appendChild(st);
  const input = w.getComputedStyle(d.querySelector('form.contact input[name="email"]'));
  const select = w.getComputedStyle(d.querySelector("form.contact select"));
  for (const prop of ["color", "font-family", "font-size", "padding-top",
                      "padding-bottom", "border-radius"]) {
    assert(input.getPropertyValue(prop) === select.getPropertyValue(prop),
      `${prop}: the input says "${input.getPropertyValue(prop)}" and the ` +
      `dropdown says "${select.getPropertyValue(prop)}"`);
  }
});

/* ---------------------------------------------- sent, without going anywhere */

await check("the page submits in place when it can", async () => {
  /* DRIVEN, not read. The first version of this asserted that the string
     "addEventListener('submit'" appears in the page — which it still does when
     the handler returns immediately, so it passed against a page that had gone
     back to reloading. Submitting the form is the only thing that shows which
     of the two happens. */
  const posted = [];
  const dom = new JSDOM(readFileSync(`${build}/en/contact/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://thauma.one/en/contact/",
    beforeParse(w) {
      w.fetch = async (u, o = {}) => {
        /* POSTs only. The page also GETs /api/contact on load to fill the
           reasons dropdown, and counting that made this fail for its own
           reason rather than for the page's. */
        if ((o.method || "GET").toUpperCase() === "POST") {
          posted.push({ url: String(u), accept: (o.headers || {}).Accept });
          return { ok: true, status: 200, json: async () => ({ ok: true, outcome: "sent" }) };
        }
        return { ok: true, status: 200, json: async () => ({ topics: [] }) };
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  const form = d.querySelector("form.contact");
  form.reportValidity = () => true;             // jsdom does not implement it
  d.querySelector('[name="name"]').value = "Jordan";
  d.querySelector('[name="email"]').value = "jordan@example.invalid";
  d.querySelector('[name="message"]').value = "Hello there.";

  const ev = new w.Event("submit", { bubbles: true, cancelable: true });
  form.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 80));

  assert(ev.defaultPrevented,
    "the submit was not intercepted — the browser navigates away and the page " +
    "reloads, losing where the visitor was");
  assert(posted.length === 1, `${posted.length} fetches; expected one`);
  assert(/\/api\/contact/.test(posted[0].url), `posted to ${posted[0].url}`);
  assert(/application\/json/.test(posted[0].accept || ""),
    "it did not ask for the JSON answer, so it would be handed a redirect");

  assert(form.hidden, "the form is still on screen after sending");
  const note = d.getElementById("sent-note");
  assert(note.className === "contact-sent" && note.style.display === "block",
    "the confirmation was not shown");
});

await check("and the no-JavaScript path is untouched", () => {
  /* The interception is an improvement to the form, never a dependency of it.
     A visitor with scripts blocked must still be able to send a message. */
  const d = doc("en");
  const form = d.querySelector("form.contact");
  assert(form.getAttribute("action") === "/api/contact",
    "the form has lost its action, so it only works when the script runs");
  assert((form.getAttribute("method") || "").toUpperCase() === "POST", "no method");
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(/if \(!form \|\| !window\.fetch\) return/.test(html),
    "nothing bails out when fetch is missing — an old browser would submit nothing");
});

await check("the form is taken away and something obvious replaces it", () => {
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(/form\.hidden = true/.test(html),
    "the form stays on screen after sending, inviting a second copy of the " +
    "same message");
  assert(/contact-sent/.test(html), "no confirmation element");
  const css = readFileSync("src/css/main.css", "utf8");
  assert(/\.contact-sent\{/.test(css), "the confirmation has no styling at all");
  /* It used .legal-note — the same small gray type as the privacy wording
     below it, which is the wrong weight for the one thing you are waiting to
     read. */
  const block = css.slice(css.indexOf(".contact-sent{"), css.indexOf("}", css.indexOf(".contact-sent{")));
  const size = block.match(/font-size:(\d+(?:\.\d+)?)px/);
  assert(size && Number(size[1]) >= 17,
    `the confirmation is ${size ? size[1] + "px" : "unsized"} — a footnote, not an answer`);
});

await check("a failed send still says so", () => {
  const html = readFileSync(`${build}/en/contact/index.html`, "utf8");
  assert(/catch\(function \(\) \{[\s\S]{0,200}error-note/.test(html),
    "a rejected fetch leaves the visitor with a disabled button and no reason");
  assert(/btn\.disabled = false/.test(html),
    "the send button stays disabled after a failure, so they cannot retry");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
