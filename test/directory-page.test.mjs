#!/usr/bin/env node
/**
 * Directory — the ministry's address book, shared by its team (board 11)
 *   node test/directory-page.test.mjs
 *
 * Runs the real console script against the built page, with /api/staff-data
 * answered in place.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/directory/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/directory/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

console.log("Directory\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(1); }

const CONTACTS = [
  { id: "dc_1", name: "Ana Horvat", role: "Sound technician", emails: ["ana@example.org"], phones: [],
    added_by: "Mira", created_at: "2026-09-01T10:00:00Z" },
  { id: "dc_2", name: "Pastor Dragan", role: "Home church, Beograd", emails: ["dragan@example.org"],
    phones: ["+381 11 555 0100"], added_by: "Chase", created_at: "2026-08-01T10:00:00Z" },
];

async function boot() {
  const sent = [];
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://next.thauma.one/staff/directory/",
  });
  const w = dom.window;
  w.fetch = async (u, o = {}) => {
    if (o.method && o.method !== "GET") sent.push({ method: o.method, url: String(u), body: o.body ? JSON.parse(o.body) : null });
    return { ok: true, status: 200, json: async () =>
      (String(u).includes("staff-data") ? { contacts: JSON.parse(JSON.stringify(CONTACTS)), resources: [] } : {}) };
  };
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffToast = () => {};
  await settle(200);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return { w, d, sent, click };
}
const names = (d) => [...d.querySelectorAll("#contacts tr[data-contact] .nm")].map((n) => n.textContent);

await check("one row per person: name, role, every address and number", async () => {
  const { d } = await boot();
  eq(names(d), ["Ana Horvat", "Pastor Dragan"], "rows");
  const row = d.querySelector('#contacts tr[data-contact="1"]');
  assert(row.querySelector('a[href="mailto:dragan@example.org"]'), "the address writes");
  assert(row.querySelector('a[href="tel:+381115550100"]'), "the number dials");
});

await check("search finds by name, role, address or number", async () => {
  const { w, d } = await boot();
  const f = d.getElementById("dirFind");
  const type = (v) => { f.value = v; f.dispatchEvent(new w.Event("input", { bubbles: true })); };
  type("sound"); eq(names(d), ["Ana Horvat"], "by role");
  type("555"); eq(names(d), ["Pastor Dragan"], "by number");
  type("zzz"); assert(/Nobody matches/.test(d.getElementById("contacts").textContent), "says when nobody matches");
});

await check("a row opens its card, saying who added it", async () => {
  const { d, click } = await boot();
  click(d.querySelector('#contacts tr[data-contact="0"] td'));
  eq(d.getElementById("contactBack").hidden, false, "the card did not open");
  eq(d.getElementById("contactName").value, "Ana Horvat", "whose card");
  assert(/Added by Mira/.test(d.getElementById("contactAdded").textContent), d.getElementById("contactAdded").textContent);
  eq(d.getElementById("contactDelete").hidden, false, "no way to remove it");
});

await check("a new card has no Added by and no Remove, and saves as a contact", async () => {
  const { d, sent, click } = await boot();
  click(d.getElementById("addContactBtn"));
  eq([d.getElementById("contactAdded").hidden, d.getElementById("contactDelete").hidden], [true, true], "new card");
  d.getElementById("contactName").value = "Luka";
  d.querySelector(".c-email").value = "luka@example.org";
  d.getElementById("contactForm").dispatchEvent(new d.defaultView.Event("submit", { cancelable: true }));
  await settle(120);
  eq([sent[0].body.kind, sent[0].body.name, sent[0].body.emails], ["contact", "Luka", ["luka@example.org"]], "saved");
});

await check("removing asks first, in the console's own words", async () => {
  const { w, d, sent, click } = await boot();
  let asked = null;
  w.StaffConfirm = async (o) => { asked = o; return false; };
  click(d.querySelector('#contacts tr[data-contact="0"] td'));
  click(d.getElementById("contactDelete"));
  await settle(60);
  assert(asked && asked.danger && /Ana Horvat/.test(asked.title), "no question, or not about Ana");
  eq(sent.length, 0, "removed anyway");
  assert(!/confirm\('Delete/.test(readFileSync("src/js/staff.js", "utf8")), "the English-only confirm is back");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
