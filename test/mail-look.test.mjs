#!/usr/bin/env node
/**
 * The email look on the Mail page: every choice shown, the website's by
 * default, and changing one makes the look the ministry's own
 *   node test/mail-look.test.mjs
 *
 * Chase, 2026-10-04: "each ministry's email should be built from the site's
 * design, but an email designer may be good too! That way they have complete
 * transparency as to what they have access to."
 *
 * Drives the REAL staff-mailing.js on the built Mail page in jsdom.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const PAGE = ["_site", "_site_next", "_site_prod"].map((d) => `${d}/staff/mail/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/mail/index.html";
let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("mail look — the email designer\n");
if (!existsSync(PAGE)) { console.log(`  SKIP  ${PAGE} is missing — run the build first.`); process.exit(0); }

const LIST = { id: "ml_1", partner_id: "p_c", slug: "newsletter", name: "Newsletter", from_name: "C", from_email: "n@x.one",
  is_open: 1, archive_public: 1, subscribed: 2, pending: 0, unsubscribed: 0 };

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), { runScripts: "outside-only", url: "https://next.thauma.one/staff/mail/", pretendToBeVisual: true });
  const w = dom.window;
  const api = {
    tags: [{ id: "tg_church", name: "Home church", used: 1 }, { id: "tg_prayer", name: "Prayer team", used: 0 }],
    people: [
      { id: "s1", email: "ana@example.invalid", name: "Ana", status: "subscribed", subscribed_at: "2026-05-01T10:00:00Z", tags: "Home church", tag_ids: "tg_church" },
      { id: "s2", email: "ivo@example.invalid", name: null, status: "subscribed", subscribed_at: "2026-05-02T10:00:00Z", tags: null, tag_ids: null },
    ],
    posts: [], gets: [],
    look: { follow: true, mode: "dark", font: "site", header: "name", corners: "soft", bar: true, footer: true, site: true },
  };
  const count = () => api.tags.forEach((t) => { t.used = api.people.filter((p) => String(p.tag_ids || "").split(",").includes(t.id)).length; });
  w.fetch = async (u, o = {}) => {
    const reply = (x) => ({ ok: true, status: 200, json: async () => x });
    if (o.method === "POST") {
      const b = JSON.parse(o.body); api.posts.push(b);
      if (b.action === "email-look") {
        if (b.look) api.look = { ...b.look };
        return reply({ ok: true, preview: "<p>preview</p>", email_look: { choice: api.look, has_site: true, has_logo: false, accent: "#FD5812", accent2: "#FF1854" } });
      }
      if (b.action === "tag") {
        const t = { id: "tg_" + b.name.toLowerCase().replace(/\W+/g, ""), name: b.name, used: 0 };
        api.tags.push(t);
        return reply({ ok: true, id: t.id, name: t.name, tags: api.tags });
      }
      if (b.action === "subscriber-tags") {
        const p = api.people.find((x) => x.id === b.id);
        p.tag_ids = b.tags.join(","); count();
        return reply({ ok: true, tags: b.tags.map((id) => api.tags.find((t) => t.id === id)), all_tags: api.tags });
      }
      return reply({ ok: true });
    }
    api.gets.push(String(u));
    if (String(u).includes("list=")) {
      const tag = new URL(String(u), "https://x").searchParams.get("tag");
      const rows = tag ? api.people.filter((p) => String(p.tag_ids || "").split(",").includes(tag)) : api.people;
      return reply({ list: LIST, page: 0, page_size: 100, total: rows.length, subscribers: rows });
    }
    return reply({ you: { email: "c@thauma.one", roles: ["staff"] }, scope: "partner", partner: { id: "p_c", slug: "chase-roush", display_name: "Chase Roush" },
      lists: [LIST], tags: api.tags, senders: [], mailings: [], topics: [] });
  };
  for (const k of ["StaffProblem", "StaffProblemClear", "StaffToast", "StaffActing", "StaffIdentity"]) w[k] = () => {};
  w.console.error = () => {};
  for (const f of ["staff-i18n.js", "staff.js", "staff-rowpanel.js", "staff-mailing.js"]) w.eval(readFileSync("src/js/" + f, "utf8"));
  await wait(350);
  const d = w.document;
  const press = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  press(d.querySelector('[data-view="ml_1"]'));
  await wait(250);
  const chips = (id) => [...d.querySelectorAll(`[data-subrow="${id}"] .subs-chip-name`)].map((c) => c.textContent);
  return { w, d, api, press, chips };
}

await check("Email look opens the designer with every choice, the website's marked", async () => {
  const { d, api, press } = await boot();
  const btn = d.getElementById("mlLookBtn");
  assert(!btn.hidden, "offered to a ministry");
  press(btn);
  await wait(60);
  assert(!d.getElementById("mlLook").hidden, "open");
  eq(api.posts.at(-1), { action: "email-look" }, "read, not saved");
  const on = [...d.querySelectorAll('.ml-look-chip[aria-pressed="true"]')].map((b) => b.dataset.lookK + "=" + b.dataset.lookV);
  eq(on, ["follow=true", "mode=dark", "font=site", "header=name", "corners=soft", "bar=true", "footer=true", "site=true"], "what the website gives");
  assert(d.getElementById("mlLookFrame").getAttribute("srcdoc").includes("preview"), "the preview drawn");
});

await check("changing one choice makes the look the ministry's own, keeping the rest", async () => {
  const { d, api, press } = await boot();
  press(d.getElementById("mlLookBtn"));
  await wait(60);
  press(d.querySelector('[data-look-k="font"][data-look-v="serif"]'));
  await wait(60);
  eq(api.posts.at(-1), { action: "email-look", look: { follow: false, mode: "dark", font: "serif", header: "name", corners: "soft", bar: true, footer: true, site: true } }, "saved");
  assert(d.querySelector('[data-look-k="follow"][data-look-v="false"]').getAttribute("aria-pressed") === "true", "now its own");
  press(d.querySelector('[data-look-k="follow"][data-look-v="true"]'));
  await wait(60);
  eq(api.posts.at(-1).look.follow, true, "and back to the website");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
