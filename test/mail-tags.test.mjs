#!/usr/bin/env node
/**
 * Tags on the subscriber rows: chips, not a form
 *   node test/mail-tags.test.mjs
 *
 * BACKLOG §1, Chase: tags management was "not user friendly". Tagging one
 * person meant the pencil, a row of checkboxes and Save, and a new tag had to
 * be made in another panel first. Now each row shows its tags as chips: ×
 * takes one off, pressing one shows everyone with it, + offers the others and
 * makes a new tag from what is typed. Each change saves at once.
 *
 * Drives the REAL staff-mailing.js on the built Mail page in jsdom, with a
 * fake API that keeps tags the way the Worker does.
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

console.log("mail tags — chips on the rows\n");
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
  };
  const count = () => api.tags.forEach((t) => { t.used = api.people.filter((p) => String(p.tag_ids || "").split(",").includes(t.id)).length; });
  w.fetch = async (u, o = {}) => {
    const reply = (x) => ({ ok: true, status: 200, json: async () => x });
    if (o.method === "POST") {
      const b = JSON.parse(o.body); api.posts.push(b);
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

await check("each row shows its tags as chips, with a + to add one", async () => {
  const { d, chips } = await boot();
  eq(chips("s1"), ["Home church"], "Ana's chip");
  eq(chips("s2"), [], "Ivo has none");
  assert(d.querySelector('[data-subrow="s2"] [data-tag-plus="s2"]'), "a + on every row");
});

await check("+ offers the tags the person does not have; picking one saves it at once", async () => {
  const { d, api, press, chips } = await boot();
  press(d.querySelector('[data-tag-plus="s1"]'));
  const offered = [...d.querySelectorAll(".subs-tagpop [data-tag-on]")].map((b) => b.textContent);
  eq(offered, ["Prayer team"], "only the one Ana lacks");
  press(d.querySelector('.subs-tagpop [data-tag-on="tg_prayer"]'));
  await wait(50);
  eq(api.posts.at(-1), { action: "subscriber-tags", id: "s1", tags: ["tg_church", "tg_prayer"] }, "saved");
  eq(chips("s1"), ["Home church", "Prayer team"], "the row shows it");
  assert(!d.querySelector(".subs-tagpop"), "the popover closed");
});

await check("typing a new name in + makes the tag and puts it on the person", async () => {
  const { w, d, api, press, chips } = await boot();
  press(d.querySelector('[data-tag-plus="s2"]'));
  const form = d.querySelector(".subs-tagpop [data-tag-new]");
  form.querySelector("input").value = "Volunteers";
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  await wait(60);
  eq(api.posts.map((p) => p.action), ["tag", "subscriber-tags"], "made, then applied");
  eq(chips("s2"), ["Volunteers"], "Ivo carries it");
});

await check("× takes a tag off; the filter's counts follow", async () => {
  const { d, api, press, chips } = await boot();
  press(d.querySelector('[data-tag-off="s1:tg_church"]'));
  await wait(50);
  eq(api.posts.at(-1), { action: "subscriber-tags", id: "s1", tags: [] }, "saved");
  eq(chips("s1"), [], "gone from the row");
  const opt = [...d.querySelectorAll("#subsTag option")].find((o) => o.value === "tg_church");
  assert(opt && !/\(\d+\)/.test(opt.textContent), "the filter no longer counts anyone: " + (opt && opt.textContent));
});

await check("pressing a chip shows everyone with that tag", async () => {
  const { d, api, press } = await boot();
  press(d.querySelector('[data-subrow="s1"] [data-tag-filter="tg_church"]'));
  await wait(80);
  assert(api.gets.at(-1).includes("tag=tg_church"), "asked for that tag");
  eq(d.getElementById("subsTag").value, "tg_church", "the filter says so");
  eq([...d.querySelectorAll("#mlSubscribers [data-subrow]")].map((r) => r.dataset.subrow), ["s1"], "only Ana");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
