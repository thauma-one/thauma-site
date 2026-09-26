#!/usr/bin/env node
/**
 * The sign-up and contact forms speak the visitor's language
 *   node workers/test/form-language.test.mjs
 *
 * Their labels, messages and errors were English on every site, whatever the
 * page around them was in — and the contact form's server claimed "the widget
 * posts its own language" when it never did, so a supporter writing from a
 * partner's own site got the receipt in whatever the Referer happened to say.
 *
 * Chase, 2026-09-26: everything a visitor can read must be translatable. These
 * run the real widget scripts in a browser-like document and check what a
 * visitor would actually see and what the form actually sends.
 */
import { JSDOM } from "jsdom";
import { formScript } from "../src/signup.js";
import contactHandler, { contactScript } from "../src/contact.js";
import { t, LANGS, _STRINGS } from "../src/lib/mail-i18n.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("forms in the visitor's language\n");

const LIST = { id: "ml_1", name: "Newsletter", slug: "newsletter",
  form_heading: null, form_blurb: null, form_button: null };
const PRAYER = { ...LIST, id: "ml_2", name: "Prayer", slug: "prayer" };
const FORM = { deliver_to: "chase@example.org", from_address: "contact@chaseroush.thauma.one",
  heading: null, blurb: null, button: null, thanks: null, display_name: "Chase Roush",
  embed_accent: "#E4572E", embed_accent2: null, embed_theme: "auto" };
const TOPICS = [{ id: "tp_1", label: "General", deliver_to: null, sort_order: 0 }];

/** Runs a widget script in a page and hands back its shadow root. */
function mount(script, { pageLang = "en", attrs = "", selector, navLang = "en-US" }) {
  const dom = new JSDOM(`<!doctype html><html lang="${pageLang}"><body>
    <div ${selector} ${attrs}></div></body></html>`, { runScripts: "outside-only" });
  const w = dom.window;
  Object.defineProperty(w.navigator, "language", { value: navLang, configurable: true });
  w.ResizeObserver = w.ResizeObserver || class { observe() {} disconnect() {} };
  const posted = [];
  w.fetch = (url, opts) => {
    posted.push(JSON.parse(opts.body));
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  };
  w.eval(script);
  const node = w.document.querySelector(`[${selector}]`);
  return { root: node.shadowRoot, w, posted };
}
const text = (root, sel) => root.querySelector(sel).textContent.trim();

/* A real browser exposes a form's fields by name (form.email); jsdom does not,
   so give the form what a browser would before submitting it. */
function submit(root, w) {
  const form = root.querySelector("form");
  for (const el of form.querySelectorAll("[name]")) form[el.getAttribute("name")] = el;
  form.dispatchEvent(new w.Event("submit", { cancelable: true }));
}

/* -------------------------------------------------------------- sign-up -- */

const signup = formScript([LIST, PRAYER], "chase-roush", "https://thauma.one");

await check("a Croatian page gets a Croatian sign-up form", async () => {
  const { root } = mount(signup, { pageLang: "hr", selector: "data-thauma-form" });
  eq(text(root, ".ttl"), t("hr", "form.heading"), "the default heading");
  eq(text(root, ".fld span"), t("hr", "form.name"), "the name label");
  eq(root.querySelector("input[name=name]").getAttribute("placeholder"), t("hr", "form.name"), "the placeholder");
  eq(text(root, "legend"), t("hr", "form.receive"), "the chooser");
  eq(text(root, ".go"), t("hr", "form.button"), "the button");
  eq(text(root, ".fine"), t("hr", "form.fine"), "the fine print");
  eq(text(root, ".done .big"), t("hr", "form.checkEmail"), "the confirmation");
});

await check("the snippet's own data-lang wins over the page", async () => {
  const { root } = mount(signup, { pageLang: "hr", attrs: 'data-lang="sl"', selector: "data-thauma-form" });
  eq(text(root, ".go"), t("sl", "form.button"), "Slovenian was asked for");
});

await check("a region tag finds its language: sr-Cyrl-RS is Serbian", async () => {
  const { root } = mount(signup, { pageLang: "sr-Cyrl-RS", selector: "data-thauma-form" });
  eq(text(root, ".go"), t("sr", "form.button"), "the base language of the tag");
});

await check("a language nobody has translated reads English, not blank", async () => {
  const { root } = mount(signup, { pageLang: "de", navLang: "de-DE", selector: "data-thauma-form" });
  eq(text(root, ".go"), t("en", "form.button"), "English fallback");
});

await check("the partner's own heading and button are left as they wrote them", async () => {
  const own = formScript([{ ...LIST, form_heading: "Hear from us", form_button: "Yes please" }],
    "chase-roush", "https://thauma.one");
  const { root } = mount(own, { pageLang: "hr", selector: "data-thauma-form" });
  eq(text(root, ".ttl"), "Hear from us", "their heading");
  eq(text(root, ".go"), "Yes please", "their button");
  eq(text(root, ".fld span"), t("hr", "form.name"), "while the fixed labels still follow the page");
});

await check("the sign-up sends the language it was read in", async () => {
  const { root, w, posted } = mount(signup, { pageLang: "sr", selector: "data-thauma-form" });
  root.querySelector("input[name=email]").value = "ana@example.org";
  submit(root, w);
  eq(posted.length, 1, "one submission");
  eq(posted[0].lang, "sr", "the confirmation email would be Serbian");
});

/* -------------------------------------------------------------- contact -- */

const contact = contactScript(FORM, "chase-roush", "https://thauma.one", null, TOPICS);

await check("a Slovenian page gets a Slovenian contact form", async () => {
  const { root } = mount(contact, { pageLang: "sl", selector: "data-thauma-contact" });
  eq(text(root, ".ttl"), t("sl", "contact.heading"), "the default heading");
  eq(text(root, "select option"), t("sl", "contact.choose"), "the topic prompt");
  eq(root.querySelector("textarea").getAttribute("placeholder"), t("sl", "contact.messageHint"), "the message hint");
  eq(text(root, ".go"), t("sl", "contact.button"), "the button");
  eq(text(root, ".done .big"), t("sl", "contact.thanks"), "the thank-you");
});

await check("the contact form sends the language it was read in", async () => {
  const { root, w, posted } = mount(contact, { pageLang: "hr", selector: "data-thauma-contact" });
  submit(root, w);
  eq(posted[0].lang, "hr", "the receipt would be Croatian");
});

function envFor() {
  return {
    RESEND_API_KEY: "re_test", SIGNUP_SALT: "0".repeat(48), MAIL_FROM: "Thauma <noreply@thauma.one>",
    DB: { prepare(sql) {
      const run = async () => {
        if (/FROM contact_forms/i.test(sql)) return { results: [FORM] };
        if (/FROM contact_topics/i.test(sql)) return { results: TOPICS };
        if (/COUNT\(\*\) AS n FROM signup_attempts/i.test(sql)) return { results: [{ n: 0 }] };
        return { results: [] };
      };
      return { bind() { return { all: run, run }; }, all: run, run };
    } },
  };
}
const postContact = (body) => contactHandler.fetch(
  new Request("https://thauma.one/embed/v1/chase-roush/contact", {
    method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7" },
    body: JSON.stringify(body),
  }), envFor(), "chase-roush", "contact");

await check("the server's corrections come back in the form's language", async () => {
  const noName = await (await postContact({ email: "a@b.hr", message: "Pozdrav svima", lang: "sr" })).json();
  eq(noName.error, t("sr", "contact.errName"), "a missing name, in Serbian");
  const badMail = await (await postContact({ name: "Ana", email: "nope", message: "Hvala!", lang: "sl" })).json();
  eq(badMail.error, t("sl", "contact.errEmail"), "a bad address, in Slovenian");
});

/* ----------------------------------------------------------- dictionary -- */

await check("every public language carries every form word", async () => {
  const keys = Object.keys(_STRINGS.en).filter((k) => k.startsWith("form.") || k.startsWith("contact."));
  assert(keys.length >= 20, "the form words are missing from the dictionary");
  for (const lang of LANGS) {
    const missing = keys.filter((k) => !_STRINGS[lang][k]);
    assert(!missing.length, `${lang} is missing ${missing.join(", ")}`);
  }
  assert(LANGS.includes("sl"), "Slovenian is on the public site but not in its emails and forms");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
