#!/usr/bin/env node
/**
 * A ministry's email look: its website's, or its own choices
 *   node workers/test/email-look.test.mjs
 *
 * Chase, 2026-10-04: "each ministry's email should be built from the site's
 * design, but an email designer may be good too! That way they have complete
 * transparency as to what they have access to."
 */
import { emailLook, cleanEmailLook } from "../src/lib/email-look.js";
import { render } from "../src/lib/newsletter.js";
import { starter, cleanDoc } from "../src/site/model.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const HEX = /^#[0-9a-f]{6}$/i;

function site(design = {}, footer = {}) {
  const d = starter("full", { name: "Chase Roush", langs: ["en"], fallback: "en" });
  Object.assign(d.design, design);
  d.footer = { layout: "split", words: { en: { tagline: "Serving churches across Croatia", small: "A missionary with Thauma." } }, ...footer };
  return cleanDoc(d, ["en"]);
}
const THEME = { accent: "#FD5812", accent2: "#FF1854", mode: "auto" };

console.log("email-look — the website's, or the ministry's own\n");

await check("following a dark custom site: dark, the site's own surfaces, solid hex colors only", async () => {
  const L = emailLook({ doc: site({ look: "custom", mode: "dark", colors: { background: "#0D0D0D", accent: null } }), theme: THEME, siteUrl: "https://chaseroush.thauma.one/" });
  eq(L.mode, "dark", "mode");
  for (const k of ["bg", "card", "ink", "dim", "line", "accent", "accent2"]) assert(HEX.test(L[k]), `${k} is ${L[k]}, not a hex Outlook can use`);
  assert(L.follow && L.hasSite, "following");
  eq([L.tagline, L.small], ["Serving churches across Croatia", "A missionary with Thauma."], "the footer's words");
  eq(L.siteUrl, "https://chaseroush.thauma.one/", "a way to the site");
});

await check("Paper's serif headings and its web fonts come along", async () => {
  const L = emailLook({ doc: site({ look: "paper" }), theme: THEME });
  eq(L.mode, "light", "Paper is light");
  assert(/^'Fraunces',Georgia/.test(L.headFont), "Fraunces then Georgia: " + L.headFont);
  assert(/Manrope/.test(L.bodyFont) && /Arial/.test(L.bodyFont), "Manrope, with the safe stack behind it");
  assert(/fonts\.googleapis\.com/.test(L.fontsUrl), "the font link for Apple Mail");
});

await check("a site with a logo shows it at the top", async () => {
  const L = emailLook({ doc: site({ brand: "logo", logo: "/media/partnersite/chase-roush/logo-aaaa.webp" }), theme: THEME });
  eq([L.header, L.hasLogo], ["logo", true], "logo");
  const html = render("<p>Hi</p>", { look: L, subject: "S", fromName: "Chase Roush", unsubscribeUrl: "#" });
  assert(/<img src="https:\/\/thauma\.one\/media\/partnersite\/chase-roush\/logo-aaaa\.webp" alt="Chase Roush"/.test(html), "the logo, absolute, named");
});

await check("the designer's own choices: every value honored, and nothing follows the site", async () => {
  const L = emailLook({ doc: site({ look: "night" }), theme: THEME, saved: { follow: false, mode: "light", font: "serif", header: "none", corners: "square", bar: false, footer: false, site: false }, siteUrl: "https://x.thauma.one/" });
  eq([L.follow, L.mode, L.header, L.corners, L.bar, L.footer, L.siteUrl], [false, "light", "none", "square", false, false, null], "choices");
  assert(/^Georgia/.test(L.headFont), "serif");
  const html = render("<p>Hi</p>", { look: L, subject: "S", fromName: "Chase Roush", unsubscribeUrl: "#" });
  assert(!/height:4px;background:/.test(html), "no color bar");
  assert(/border-radius:0px/.test(html), "square corners");
  assert(!/CHASE ROUSH|>Chase Roush<\/p>/.test(html), "no name at the top");
});

await check("while following, the designer is shown what the website gives", async () => {
  const L = emailLook({ doc: site({ look: "night" }), theme: THEME, siteUrl: "https://x.thauma.one/" });
  eq(L.choice, { follow: true, mode: "dark", font: "site", header: "name", corners: "soft", bar: true, footer: true, site: true }, "choice");
});

await check("no website: the plain email in the ministry's colors, and follow cannot stick", async () => {
  const L = emailLook({ doc: null, theme: { accent: "#2266DD", accent2: "#22AA66", mode: "light" }, saved: null });
  eq([L.follow, L.hasSite, L.mode, L.accent, L.bg], [false, false, "light", "#2266DD", "#f4f5f8"], "plain");
});

await check("saved values are cleaned: anything odd means a default", async () => {
  eq(cleanEmailLook({ mode: "neon", font: "comic", header: "banner", corners: 9, bar: "yes" }),
     { follow: true, mode: "light", font: "site", header: "name", corners: "soft", bar: true, footer: true, site: true }, "cleaned");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
