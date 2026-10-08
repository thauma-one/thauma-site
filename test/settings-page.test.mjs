#!/usr/bin/env node
/**
 * Website › Settings — the site's settings, by their real names
 *   node test/settings-page.test.mjs
 *
 * The form is derived from site.json; what matters is that it names what
 * it shows, that the donation forms are here (one per language, a slot for
 * a language that lacks one), and that what moved elsewhere — languages to
 * Pages, pictures to Photos — is not shown twice.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/website/settings/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("Website › Settings\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const SITE = {
  name: "Thauma", url: "https://thauma.one", languages: ["en", "hr", "sr"], defaultLang: "en",
  visibility: { comingSoon: { live: true, dev: false }, languages: { hr: { live: true, dev: true } },
                pages: { events: { live: false, dev: true } } },
  images: { home_who: { src: "/img/a.webp", focal_x: 50, focal_y: 28, zoom: 110 } },
  donorbox: { en: "en-form", hr: "" },
  socials: { youtube: "", x: "" },
};

async function boot() {
  const sent = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/website/settings/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/website/settings/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        u = String(u);
        const body = o.body ? JSON.parse(o.body) : null;
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: u, body });
        const ok = (j) => ({ ok: true, status: 200, json: async () => j });
        if (u.includes("/api/admin/publish")) return ok({ configured: true, waiting: 0 });
        if (u.includes("/api/admin/content")) {
          if (o.method === "PUT") return ok({ ok: true, sha: "s2", changed: Object.keys(body.changes) });
          return ok({ configured: true, data: JSON.parse(JSON.stringify(SITE)), sha: "s1", frozen: ["languages"] });
        }
        return ok({});
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.StaffConfirm = async () => true;
  w.eval(readFileSync("src/js/admin-site.js", "utf8"));
  await tick(150);
  return { w, d, sent };
}
const names = (d) => [...d.querySelectorAll("#sRoot .s-name")].map((n) => n.textContent);

await check("settings carry their real names; the social links are on Website › Links now", async () => {
  const { d } = await boot();
  const n = names(d);
  for (const want of ["Site name", "Address"]) assert(n.includes(want), `no "${want}" in ${n}`);
  assert(!n.includes("YouTube link") && !d.querySelector('[data-path^="socials."]'), "the social links are still here too");
  const first = d.querySelector("#sRoot .s-group h3").textContent;
  assert(first === "The site", `the first card is "${first}"`);
});

await check("a donation form for every language, the missing one ready to fill", async () => {
  const { d } = await boot();
  const card = [...d.querySelectorAll("#sRoot .s-group")].find((g) => g.querySelector("h3").textContent === "Donation form");
  assert(card, "no Donation form card");
  const fields = [...card.querySelectorAll("[data-path]")].map((i) => i.getAttribute("data-path"));
  assert(fields.join() === "donorbox.en,donorbox.hr,donorbox.sr", `fields: ${fields}`);
  assert(card.querySelector('[data-path="donorbox.en"]').value === "en-form", "English's form");
  assert(/\(sr\)/.test(card.textContent), "each line named by its language");
  assert(d.getElementById("sSaveBar").hidden, "an untouched empty slot counts as an unsaved change");
});

await check("typing into the missing slot saves it, which creates it", async () => {
  const { w, d, sent } = await boot();
  const box = d.querySelector('[data-path="donorbox.sr"]');
  box.value = "sr-form";
  box.dispatchEvent(new w.Event("input", { bubbles: true }));
  d.getElementById("sSave").click();
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  assert(put && JSON.stringify(put.body.changes) === JSON.stringify({ "donorbox.sr": "sr-form" }), JSON.stringify(put && put.body));
});

await check("languages and pictures are not shown here twice", async () => {
  const { d } = await boot();
  assert(!d.querySelector('[data-path^="visibility.languages"]'), "a language switch on Settings");
  assert(!d.querySelector('[data-path^="images."]'), "a picture on Settings");
  assert(!d.querySelector('[data-path="defaultLang"]'), "the default language on Settings");
});

await check("what visitors can see is in Preview site and Everyone columns", async () => {
  const { d } = await boot();
  const heads = [...d.querySelectorAll("[data-web-panel=\"settings\"] .v-head b")].map((b) => b.textContent);
  assert(heads.join() === "Preview site,Everyone", `columns: ${heads}`);
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
