#!/usr/bin/env node
/**
 * A person in Admin › People, in two tabs (boards "a person: Access" and
 * "a person: Team page")
 *   node test/person-tabs.test.mjs
 *
 * Access saves as it is touched; the team page is one edit with Save and
 * Cancel, and beside it the card as the site will show it. Driven through a
 * real DOM, with the same console payload as profile-save.test.mjs.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/users/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("a person: Access and Team page\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const US = String.fromCharCode(31);
const USER = { id: "u_1", email: "chase@thauma.one", name: "Chase Roush",
  status: "active", protected: false, roles: ["admin", "staff"],
  partner_ids: ["p_1"], partner_names: ["Chase Roush"] };
const MASTER = { id: "u_m", email: "admin@thauma.one", name: "Master", status: "active",
  protected: true, roles: ["admin", "partner", "staff", "board"], partner_ids: [], partner_names: [] };
const PROFILE = { user_id: "u_1", name: "Chase Roush", email: "chase@thauma.one",
  status: "active", is_public: 1, slug: "chase-roush", region: "KC",
  public_email: "", photo: "/media/a.webp", bio_photo: "/media/b.webp",
  bio_photo_aspect: 0.75, photo_master: "", bio_photo_master: "", sort_order: 0,
  file_synced_at: null, file_error: null,
  translations: "en" + US + "Founder" + US + "Bio text" };

function payload(extra) {
  return Object.assign({
    you: { id: "u_me", email: "me@thauma.one", name: "Me", roles: ["admin"] },
    users: [USER, MASTER],
    partners: [{ id: "p_1", slug: "chase-roush", display_name: "Chase Roush",
                 status: "active", default_lang: "en", members: [] }],
    profiles: [PROFILE],
    languages: [{ code: "en", name: "English", native_name: "English", is_active: 1 }],
    senders: [], settings: {},
  }, extra || {});
}

/** The console, rendered, with one person's panel open. */
async function boot({ postResponse, profiles } = {}) {
  const posts = [];
  const over = profiles ? { profiles } : null;
  const dom = new JSDOM(readFileSync(`${build}/admin/users/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/users/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin", "staff"] }), setItem: () => {} } });
      w.fetch = async (url, opts) => {
        if (opts && opts.method === "POST") {
          posts.push({ url: String(url), body: opts.body });
          return postResponse || { ok: true, status: 200, json: async () => payload(over) };
        }
        return { ok: true, status: 200, json: async () => payload(over) };
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window;
  for (const f of ["tokens.css", "staff.css", "admin.css"]) {
    const st = w.document.createElement("style");
    st.textContent = readFileSync("src/css/" + f, "utf8");
    w.document.head.appendChild(st);
  }
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/photo-crop.js", "utf8"));
  w.eval(readFileSync("src/js/admin.js", "utf8"));
  await new Promise((r) => setTimeout(r, 150));
  const row = w.document.querySelector('[data-person="u_1"] .adm-row');
  if (row) row.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  return { w, posts };
}

const click = (w, el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
const panelOf = (w, id) => w.document.querySelector(`[data-person="${id}"] .adm-panel`);
const shown = (el) => el && !el.hidden;

await check("Access opens first: what they can do, their ministries, sign-in, and Remove", async () => {
  const { w } = await boot();
  const p = panelOf(w, "u_1");
  const tabs = [...p.querySelectorAll("[data-pp-tab]")].map((t) => [t.textContent, t.getAttribute("aria-selected")]);
  assert(JSON.stringify(tabs) === JSON.stringify([["Access", "true"], ["Team page", "false"]]), JSON.stringify(tabs));
  const access = p.querySelector('[data-pp-panel="access"]');
  assert(shown(access) && !shown(p.querySelector('[data-pp-panel="team"]')), "only Access shows");
  assert(access.querySelectorAll("[data-role]").length === 4, "the four roles");
  assert(access.querySelector('[data-partner="p_1"]'), "the ministry chip");
  assert(access.querySelector(".status-pick"), "sign-in");
  assert(/save as you make them/.test(access.querySelector(".pp-foot").textContent), "says it saves at once");
  assert(access.querySelector('[data-remove="u_1"]'), "Remove person");
  assert(!access.querySelector("[data-pf-save]"), "no Save on Access");
});

await check("Team page: the fields, the card beside them, Cancel and Save", async () => {
  const { w } = await boot();
  const p = panelOf(w, "u_1");
  click(w, p.querySelector('[data-pp-tab="team"]'));
  const team = p.querySelector('[data-pp-panel="team"]');
  assert(shown(team) && !shown(p.querySelector('[data-pp-panel="access"]')), "only Team page shows");
  const pv = team.querySelector("[data-pf-preview]");
  assert(pv.querySelector(".pp-card-name").innerHTML === "Chase <b>Roush</b>", pv.querySelector(".pp-card-name").innerHTML);
  assert(pv.querySelector('[data-pv="title"]').textContent === "Founder", "title");
  assert(pv.querySelector('[data-pv="region"]').textContent === "KC", "region");
  assert(/\/en\/team\/chase-roush\/$/.test(pv.querySelector('[data-pv="address"]').textContent), "address");
  assert(/\/media\/a\.webp$/.test(pv.querySelector('[data-pv="photo"]').src), "the team photo");
  assert(/next Publish/.test(team.querySelector(".pp-foot").textContent), "says when it goes live");
  assert(team.querySelector("[data-pf-save]") && team.querySelector("[data-pf-cancel]"), "Save and Cancel");
});

await check("typing moves the card, lights Save, and Cancel puts it back on the same tab", async () => {
  const { w } = await boot();
  click(w, panelOf(w, "u_1").querySelector('[data-pp-tab="team"]'));
  const region = panelOf(w, "u_1").querySelector('.pf-grid [data-pf="region"]');
  region.value = "Zagreb";
  region.dispatchEvent(new w.Event("input", { bubbles: true }));
  let p = panelOf(w, "u_1");
  assert(p.querySelector('[data-pv="region"]').textContent === "Zagreb", "the card follows");
  assert(p.querySelector("[data-pf-save]").classList.contains("is-dirty"), "Save lit");
  click(w, p.querySelector("[data-pf-cancel]"));
  p = panelOf(w, "u_1");
  assert(p.querySelector('.pf-grid [data-pf="region"]').value === "KC", "back to what is saved");
  assert(!p.querySelector("[data-pf-save]").classList.contains("is-dirty"), "Save quiet");
  assert(shown(p.querySelector('[data-pp-panel="team"]')), "still on Team page");
});

await check("the master account has no tabs and no team page", async () => {
  const { w } = await boot();
  click(w, w.document.querySelector('[data-person="u_m"] .adm-row'));
  await new Promise((r) => setTimeout(r, 150));
  const p = panelOf(w, "u_m");
  assert(!p.querySelector("[data-pp-tab]"), "no tabs");
  assert(!p.querySelector('[data-pp-panel="team"]'), "no team page");
  assert(!p.querySelector("[data-remove]"), "no Remove");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
