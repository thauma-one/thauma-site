#!/usr/bin/env node
/**
 * Settings › API keys — the ministry's keys, part by part
 *   node test/api-keys.test.mjs
 *
 * Like GitHub's and Cloudflare's tokens (Chase, 2026-09-27): keys live in the
 * account settings, belong to the ministry, show who made them, and each reads
 * only the parts it was given — changeable later without a new key. This
 * runs the real Settings script against the built page.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/settings/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/settings/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

console.log("Settings › API keys\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(1); }

const ANSWER = {
  you: { email: "mira@thauma.one", name: "Mira", is_admin: false, preferred_lang: "en" },
  partner: { id: "p_m", display_name: "Mira", slug: "mira" },
  languages: [{ code: "en", name: "English", is_enabled: true }],
  embed: {}, timeline: {},
  api_keys: [{ id: "k1", name: "Church site build", parts: ["milestones", "goals"],
               created_by_name: "Chase", created_at: "2026-08-01T00:00:00Z", last_used_at: null }],
};

async function boot() {
  const sent = [];
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only", pretendToBeVisual: true,
    url: "https://next.thauma.one/staff/settings/#keys",
  });
  const w = dom.window;
  w.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    if (method !== "GET") sent.push({ method, body: JSON.parse(opts.body) });
    const body = method === "POST"
      ? { key: "thk_once", api_keys: ANSWER.api_keys }
      : JSON.parse(JSON.stringify(ANSWER));
    return { ok: true, status: 200, json: async () => body };
  };
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};
  w.scrollTo = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-settings.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  w.StaffToast = () => {};
  w.StaffConfirm = async () => true;
  await settle(150);
  const d = w.document;
  const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return { w, d, sent, click };
}

await check("the keys are in Settings, each saying who made it and what it reads", async () => {
  const { d } = await boot();
  eq(d.querySelector('.tab[data-tab="keys"]').getAttribute("aria-selected"), "true", "the keys tab opened from #keys");
  const row = d.querySelector('#setKeyList [data-key="k1"]');
  assert(/made by Chase/.test(row.textContent), row.textContent);
  const on = [...row.querySelectorAll("[data-key-part]")].filter((b) => b.getAttribute("aria-checked") === "true")
    .map((b) => b.dataset.part);
  eq(on, ["milestones", "goals"], "what it reads");
});

await check("a new key reads what is switched on when it is made", async () => {
  const { d, sent, click } = await boot();
  click(d.querySelector('#setKeyParts [data-part="prayer"]'));
  click(d.querySelector('#setKeyParts [data-part="mailings"]'));
  d.getElementById("setKeyName").value = "New site";
  click(d.getElementById("setKeyAdd"));
  await settle(120);
  eq(sent[0].body, { name: "New site", parts: ["milestones", "goals", "videos"] }, "sent");
  eq(d.getElementById("setKeyValue").textContent, "thk_once", "shown once");
});

await check("changing what a key reads is sent at once, as its parts", async () => {
  const { d, sent, click } = await boot();
  click(d.querySelector('#setKeyList [data-key-part="k1"][data-part="videos"]'));
  await settle(120);
  eq(sent[0].body, { key_parts: { id: "k1", parts: ["milestones", "goals", "videos"] } }, "sent");
});

await check("a key cannot be left reading nothing — that is what Revoke is for", async () => {
  const saved = ANSWER.api_keys[0].parts;
  ANSWER.api_keys[0].parts = ["goals"];
  try {
    const { d, sent, click } = await boot();
    click(d.querySelector('#setKeyList [data-key-part="k1"][data-part="goals"]'));
    await settle(120);
    eq(sent.length, 0, "its only part was switched off anyway");
  } finally { ANSWER.api_keys[0].parts = saved; }
});

await check("revoking asks in the console's own words first", async () => {
  const { w, d, sent, click } = await boot();
  let asked = null;
  w.StaffConfirm = async (o) => { asked = o; return false; };
  click(d.querySelector('#setKeyList [data-revoke="k1"]'));
  await settle(60);
  assert(asked && asked.danger, "it did not ask");
  eq(sent.length, 0, "refused, so nothing sent");
  const src = readFileSync("src/js/staff-settings.js", "utf8");
  assert(!/confirm\('Revoke|'created '|'never used'/.test(src), "English-only text in the key screen");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
