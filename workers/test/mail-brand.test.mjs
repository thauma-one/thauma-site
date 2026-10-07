#!/usr/bin/env node
/**
 * A partner's mail is Thauma's mail, rebranded
 *   node workers/test/mail-brand.test.mjs
 *
 * Chase, 2026-10-04: "Just match their subscribed emails and all those
 * confirmations to what Thauma already does, except branded to the Partner
 * Ministry (like replace the color scheme to match theirs …, and change the
 * name Thauma to their First and Last name). You should still have 'A Thauma
 * Ministry' … to credit Thauma."
 */
import { brandForMail } from "../src/lib/mail-brand.js";
import { listConfirmEmail, contactReceiptEmail } from "../src/lib/mail.js";
import { render } from "../src/lib/newsletter.js";
import { page } from "../src/lib/public-page.js";
import { QUERIES } from "../src/lib/db.js";
import { createDb } from "../src/lib/db.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

function db({ siteAccent = null } = {}) {
  const sqlOf = (n) => QUERIES[n].replace(/:[a-z_][a-z0-9_]*/gi, "?");
  return createDb({ prepare(sql) {
    const run = async () => {
      if (sql === sqlOf("partner_for_site")) return { results: [{ id: "p_c", display_name: "Chase Roush", embed_accent: "#1AE4FF", embed_accent2: null, embed_turn: null, embed_theme: "auto" }] };
      if (sql === sqlOf("partner_site_get")) return { results: [{ published: JSON.stringify({ design: { colors: { accent: siteAccent } } }) }] };
      return { results: [] };
    };
    const st = { bind() { return st; }, all: run, run, first: async () => (await run()).results[0] || null };
    return st;
  } });
}

console.log("mail-brand — Thauma's mail, in the ministry's colors and name\n");

await check("the colors: the site's own accent if it chose one, else Sharing's; the ministry's name", async () => {
  eq(await brandForMail(db(), "p_c").then((b) => [b.accent, b.name, b.mode]), ["#1AE4FF", "Chase Roush", "light"], "Sharing's");
  eq((await brandForMail(db({ siteAccent: "#fd5812" }), "p_c")).accent, "#FD5812", "the site's own");
  eq(await brandForMail(db(), null), null, "Thauma's own lists: no brand");
});

await check("the confirmation is Thauma's template with the name in the band, their color, and the credit", async () => {
  const brand = { accent: "#FD5812", accent2: "#FF1854", mode: "light", name: "Chase Roush" };
  const m = listConfirmEmail({ name: "Ana", listName: "Newsletter", fromName: "Chase Roush", origin: "https://thauma.one", confirmUrl: "https://thauma.one/confirm?t=a", lang: "en", brand });
  assert(!/email-band\.png/.test(m.html), "no THAUMA image");
  assert(/class="bname"[^>]*letter-spacing:10px;text-transform:uppercase;color:#EDF2F8;">Chase Roush</.test(m.html), "the name, spaced like Thauma's");
  assert(/class="bkind"[^>]*>Sign-up confirmation</.test(m.html), "what it is, beneath the name");
  assert(/linear-gradient\(45deg,#[0-9A-F]{6} 0%,#070A10 46%/.test(m.html), "on a wash of their two colors");
  assert(/<h1[^>]*>Confirm your subscription</.test(m.html), "the heading in the body");
  assert(/bgcolor="#FD5812"/.test(m.html), "their color");
  assert(/A Thauma ministry/.test(m.html), "the credit");
  const thauma = listConfirmEmail({ name: "Ana", listName: "News", fromName: "Thauma", origin: "https://thauma.one", confirmUrl: "https://thauma.one/confirm?t=a", lang: "en" });
  assert(/email-band\.png/.test(thauma.html) && !/A Thauma ministry/.test(thauma.html), "Thauma's own, unchanged");
});

await check("a partner's contact receipt wears their band; Thauma's keeps the wordmark", async () => {
  const brand = { accent: "#FD5812", accent2: "#FF1854", mode: "light", name: "Chase Roush" };
  const m = contactReceiptEmail({ name: "Ana", ministry: "Chase Roush", message: "Hello", origin: "https://thauma.one", lang: "en", brand });
  assert(/class="bname"[^>]*>Chase Roush</.test(m.html) && /class="bkind"[^>]*>Message received</.test(m.html), "name and kind");
  assert(/A Thauma ministry/.test(m.html), "the credit");
  const own = contactReceiptEmail({ name: "Ana", ministry: "Thauma", message: "Hello", origin: "https://thauma.one", lang: "en" });
  assert(/email-band\.png/.test(own.html) && !/class="bname"/.test(own.html), "Thauma's own, unchanged");
});

await check("a newsletter: Thauma's template, the ministry's color, the credit line", async () => {
  const html = render("<p>Hi</p>", { subject: "S", fromName: "Chase Roush", accent: "#FD5812", credit: "A Thauma ministry", unsubscribeUrl: "#" });
  assert(/bgcolor="#FD5812"/.test(html) && /A Thauma ministry/.test(html), "color and credit");
  assert(/class="bname"[^>]*>Chase Roush</.test(html) && /class="bkind"[^>]*>Newsletter</.test(html), "the band: name, then Newsletter when the list has no name");
  assert(/class="bkind"[^>]*>Prayer</.test(render("<p>Hi</p>", { subject: "S", fromName: "C", listName: "Prayer" })), "the list's own name as the kind");
  assert(!/height:4px/.test(html), "no bare accent line over the letter any more");
  assert(!/A Thauma ministry/.test(render("<p>Hi</p>", { subject: "S", unsubscribeUrl: "#" })), "none without it");
});

await check("the public pages: the ministry's name and credit only when branded", async () => {
  const b = page("Subscribed", "<h1>You are subscribed</h1>", undefined, "en", { accent: "#FD5812", name: "Chase Roush" });
  assert(/class="who">Chase Roush</.test(b) && /A Thauma ministry/.test(b) && /#FD5812/.test(b), "branded");
  const plain = page("Subscribed", "<h1>You are subscribed</h1>");
  assert(!/class="who"/.test(plain) && !/A Thauma ministry/.test(plain), "Thauma's plain page");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
