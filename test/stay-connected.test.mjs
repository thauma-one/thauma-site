#!/usr/bin/env node
/**
 * Stay connected — Thauma's sign-up form, from every page's footer
 *   node test/stay-connected.test.mjs
 *
 * Chase, 2026-09-28: a footer link that opens the sign-up form, and Contact
 * beside it. Hand-built on the API (not the embed): the lists come from
 * /embed/v1/thauma/signup and a sign-up posts back to it. Runs the real
 * main.js against built pages.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) => existsSync(`${d}/en/about/index.html`));
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

console.log("Stay connected\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

async function boot(lang = "en", lists = [{ slug: "news", name: "Newsletter", description: null }]) {
  const sent = [];
  const dom = new JSDOM(readFileSync(`${build}/${lang}/about/index.html`, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: `https://thauma.one/${lang}/about/`,
  });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.matchMedia = w.matchMedia || (() => ({ matches: true, addEventListener() {}, addListener() {} }));
  w.IntersectionObserver = undefined;
  w.fetch = async (u, o = {}) => {
    if (String(u).includes("/embed/v1/thauma/signup")) {
      if (o.method === "POST") { sent.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ ok: true }) }; }
      return lists.length ? { ok: true, json: async () => ({ lists }) } : { ok: false, json: async () => ({}) };
    }
    return { ok: false, json: async () => ({}) };
  };
  w.console.error = () => {};
  try { w.eval(readFileSync("src/js/main.js", "utf8")); } catch { /* the rest of main.js is not under test */ }
  await settle();
  return { w, d: w.document, sent };
}

await check("the footer offers Contact and Stay connected on every page", async () => {
  const { d } = await boot();
  assert(d.querySelector('.foot-links a[href="/en/contact/"]'), "no Contact in the footer");
  assert(d.querySelector('nav .links a[href="/en/contact/"]'), "Contact left the main nav");
  eq(d.querySelector("[data-stay-open]").hidden, false, "Stay connected is hidden with a list to join");
});

await check("no list to join, no link", async () => {
  const { d } = await boot("en", []);
  eq(d.querySelector("[data-stay-open]").hidden, true, "a link to a form with nothing to choose");
});

await check("one list is simply joined; several are chosen", async () => {
  const one = await boot();
  eq(one.d.getElementById("stayLists").hidden, true, "a choice of one");
  const two = await boot("en", [{ slug: "news", name: "Newsletter" }, { slug: "prayer", name: "Prayer" }]);
  eq(two.d.getElementById("stayLists").hidden, false, "no choice between two");
  eq(two.d.querySelectorAll("#stayLists input:checked").length, 2, "both offered, ticked");
});

await check("signing up posts to the API in the page's language, then says to check email", async () => {
  const { w, d, sent } = await boot("hr");
  d.querySelector("[data-stay-open]").click();
  eq(d.getElementById("stay").open, true, "the window did not open");
  d.getElementById("stay-email").value = "a@b.invalid";
  d.getElementById("stayForm").dispatchEvent(new w.Event("submit", { cancelable: true }));
  await settle();
  eq([sent[0].email, sent[0].lists, sent[0].lang], ["a@b.invalid", ["news"], "hr"], "sent");
  eq([d.getElementById("stayForm").hidden, d.getElementById("stayDone").hidden], [true, false], "the thank-you replaces the form");
  assert(/Još samo korak/.test(d.getElementById("stayDone").textContent), "the thank-you is not in Croatian");
});

await check("its words are site words, in every language the site has", async () => {
  for (const l of ["en", "hr", "sr", "sl"]) {
    const t = JSON.parse(readFileSync(`src/_data/i18n/${l}.json`, "utf8"));
    for (const k of ["h_thin", "h_bold", "lede", "name", "email", "send", "thanks_h", "thanks", "error", "close"]) {
      assert(t.stay && t.stay[k], `${l} has no stay.${k}`);
    }
    assert(t.footer.stay, `${l} has no footer.stay`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
