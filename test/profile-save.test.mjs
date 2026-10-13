#!/usr/bin/env node
/**
 * Saving a profile, driven through a real DOM
 *   node test/profile-save.test.mjs
 *
 * WHY THIS EXISTS. Save moved out of the profile section and into the panel's
 * action row beside Remove person, and the status line moved with it.
 * saveProfile went on looking for that line INSIDE the profile section, found
 * nothing, and dropped every message on the floor — "Saving…", "Saved", and
 * every error. The save itself still worked, so nothing was broken except the
 * only way to tell whether it had worked.
 *
 * "I pressed Save and nothing happened" was a completely accurate report.
 *
 * Source-level checks could not have caught this: both the button and the
 * status line existed, in the right markup, with the right attributes. Only
 * clicking the thing shows that the two ends were no longer connected.
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

console.log("saving a profile\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const US = String.fromCharCode(31);
const USER = { id: "u_1", email: "chase@thauma.one", name: "Chase Roush",
  status: "active", protected: false, roles: ["admin", "staff"],
  partner_ids: ["p_1"], partner_names: ["Chase Roush"] };
const PROFILE = { user_id: "u_1", name: "Chase Roush", email: "chase@thauma.one",
  status: "active", is_public: 1, slug: "chase-roush", region: "KC",
  public_email: "", photo: "/media/a.webp", bio_photo: "/media/b.webp",
  bio_photo_aspect: 0.75, photo_master: "", bio_photo_master: "", sort_order: 0,
  file_synced_at: null, file_error: null,
  translations: "en" + US + "Founder" + US + "Bio text" };

function payload(extra) {
  return Object.assign({
    you: { id: "u_me", email: "me@thauma.one", name: "Me", roles: ["admin"] },
    users: [USER],
    partners: [{ id: "p_1", slug: "chase-roush", display_name: "Chase Roush",
                 status: "active", default_lang: "en", members: [] }],
    profiles: [PROFILE],
    languages: [{ code: "en", name: "English", native_name: "English" }],
    senders: [], settings: {},
  }, extra || {});
}

/** The console, rendered, with one person's panel open. */
async function boot({ postResponse, profiles, languages, extra } = {}) {
  const posts = [];
  const over = profiles || languages || extra ? Object.assign({}, profiles ? { profiles } : {}, languages ? { languages } : {}, extra || {}) : null;
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

await check("the panel renders a Save button", async () => {
  const { w } = await boot();
  const btn = w.document.querySelector("[data-pf-save]");
  assert(btn, "no Save button in the open panel");
  assert(btn.dataset.pfSave === "u_1", `Save is wired to ${btn.dataset.pfSave}`);
});

await check("Save actually posts the profile", async () => {
  const { w, posts } = await boot();
  w.document.querySelector("[data-pf-save]")
   .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  assert(posts.length === 1, `${posts.length} POSTs; expected exactly one`);
  assert(/\/api\/admin\/profile/.test(posts[0].url), `posted to ${posts[0].url}`);
  const body = JSON.parse(posts[0].body);
  assert(body.user_id === "u_1", "the wrong person was saved");
  assert(body.is_public === true, "the publish flag did not travel");
});

await check("one language at a time, the reference above, and Save sends EVERY language", async () => {
  /* The two columns sent only the two shown, and the server drops a language
     it is not sent — saving English beside Croatian wiped a Serbian bio. */
  const languages = ["en", "hr", "sr"].map((code) => ({ code, name: code, native_name: code, is_active: 1 }));
  const three = Object.assign({}, PROFILE, { translations: ["en" + US + "Founder" + US + "Bio",
    "hr" + US + "Osnivač" + US + "Bio hr", "sr" + US + "Оснивач" + US + "Био"].join(String.fromCharCode(30)) });
  const { w, posts } = await boot({ profiles: [three], languages });
  const d = w.document;
  const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
  assert(!d.querySelector(".pf-col"), "still two columns");
  assert(d.querySelector("[data-plang=a][data-lang-edit]") && d.querySelector("[data-plang=b][data-lang-ref]") &&
         d.querySelector("[data-profile] [data-lang-translate]"), "no Editing ⇄ Reference row with Translate");
  const role = () => d.querySelector('[data-profile] [data-pf="role_title"]');
  assert(role().value === "Founder", "editing English: " + role().value);
  const refLine = role().previousElementSibling;
  assert(refLine && refLine.matches(".ms-ref") && refLine.getAttribute("lang") === "hr" && refLine.textContent === "Osnivač",
    "Croatian is not shown above the field");
  role().value = "Founder 2"; fire(role(), "input");
  const edit = d.querySelector("[data-plang=a]");
  edit.value = "sr"; fire(edit, "change");
  assert(role().value === "Оснивач", "switching did not show Serbian");
  const again = d.querySelector("[data-plang=a]");   // drawn again by the switch
  again.value = "en"; fire(again, "change");
  assert(role().value === "Founder 2", "the unsaved English was lost on switching");
  d.querySelector("[data-pf-save]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const text = JSON.parse(posts[0].body).text;
  assert(text.en.role_title === "Founder 2" && text.hr.role_title === "Osnivač" && text.sr.role_title === "Оснивач",
    "not every language was sent: " + JSON.stringify(text));
});

await check("a person's own changes: shown word by word, Approve saves them and clears them (0058)", async () => {
  /* Chase, 2026-10-13: "they can edit, but it has to be approved by an Admin
     before it goes live. Just make sure that there is something that shows
     the edits that were made." */
  const languages = ["en", "hr"].map((code) => ({ code, name: code, native_name: code, is_active: 1 }));
  const profile_proposals = [{ user_id: "u_1", submitted_at: "2026-10-13T10:00:00Z", region: "KC",
    text: { en: { role_title: "Founder and Director", bio: "Bio text" } } }];
  const { w, posts } = await boot({ languages, extra: { profile_proposals } });
  const d = w.document;
  assert(d.querySelector('[data-person="u_1"] .role-tag.waiting'), "the row does not say changes are waiting");
  const box = d.querySelector('.pf-proposal[data-proposal="u_1"]');
  assert(box, "no box of waiting changes");
  const diffs = [...box.querySelectorAll(".pf-diff")].map((x) => x.innerHTML);
  assert(diffs.length === 1 && /Founder<ins> and Director<\/ins>/.test(diffs[0]), "only the title changed, shown word by word: " + JSON.stringify(diffs));
  box.querySelector("[data-proposal-approve]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  const body = JSON.parse(posts[0].body);
  assert(body.clear_proposal === true && body.text.en.role_title === "Founder and Director" && body.text.en.bio === "Bio text",
    "Approve did not save the changes and clear them: " + JSON.stringify(body));
});

await check("a FAILED save says so on screen", async () => {
  /* THE REGRESSION. The status line moved out of the profile section with the
     Save button; saveProfile kept looking for it inside the section and found
     nothing, so a refusal from the server was written to no element at all. */
  const { w } = await boot({
    postResponse: { ok: false, status: 409,
      json: async () => ({ error: "That slug is taken by somebody else." }) },
  });
  w.document.querySelector("[data-pf-save]")
   .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));

  const line = w.document.querySelector("[data-pf-status]");
  assert(line, "there is no status line anywhere on the page");
  assert(/taken by somebody else/.test(line.textContent),
    `the failure was not shown to anybody — the status line says ` +
    `"${line.textContent.trim()}"`);
});

await check("a successful save reports back too", async () => {
  const { w } = await boot();
  w.document.querySelector("[data-pf-save]")
   .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const line = w.document.querySelector("[data-pf-status]");
  assert(line && line.textContent.trim().length > 0,
    "the status line is empty after a save — no way to tell it worked");
});

/* ------------------------------------------- the switch that needed a Save */

await check("turning the profile on marks it as needing a Save", async () => {
  /* THE ONE THAT COST A DAY. toggleProfilePublic flipped the switch in the DOM
     and did nothing else — no post, and no dirty mark. So the control most
     likely to be pressed was the only one that did not light the Save button.
     You turned a profile on, the screen agreed with you, and nothing said the
     website had not been told. */
  const { w } = await boot();
  const sw = w.document.querySelector("[data-pf-public]");
  assert(sw, "no publish switch");
  const save = w.document.querySelector("[data-pf-save]");
  assert(!save.classList.contains("is-dirty"), "it started dirty; nothing to prove");

  sw.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  assert(save.classList.contains("is-dirty"),
    "flipping the publish switch does not light the Save button — the change " +
    "looks done and is not saved");
});

/* ------------------------------ when the console and the website disagree */

await check("a profile switched on but never written SAYS SO", async () => {
  /* Three surfaces: the switch said On, the database said published, the team
     page was empty. Two of them confident and wrong, and the only record was
     the audit log, which nobody reads until they already suspect something. */
  const broken = JSON.parse(JSON.stringify(PROFILE));
  broken.file_error = "Refusing to write without the SHA of the file being replaced.";
  const { w } = await boot({ profiles: [broken] });
  const note = w.document.querySelector(".pf-outofsync");
  assert(note, "nothing warns that the profile is not actually on the site");
  assert(/not on the site/i.test(note.textContent),
    `the warning does not say what is wrong: ${note.textContent.trim().slice(0, 80)}`);
  assert(/Refusing to write/.test(note.textContent),
    "the actual reason is hidden, so there is nothing to act on or report");
});

await check("a healthy profile is NOT nagged", async () => {
  const ok = JSON.parse(JSON.stringify(PROFILE));
  ok.file_synced_at = "2026-09-06T00:00:00Z"; ok.file_error = null;
  const { w } = await boot({ profiles: [ok] });
  assert(!w.document.querySelector(".pf-outofsync"),
    "a profile that published cleanly is being told it did not");
});

await check("an UNPUBLISHED profile with no file is not a problem", async () => {
  /* Switched off and absent from the site is agreement, not disagreement. */
  const off = JSON.parse(JSON.stringify(PROFILE));
  off.is_public = 0; off.file_error = "never written";
  const { w } = await boot({ profiles: [off] });
  assert(!w.document.querySelector(".pf-outofsync"),
    "an unpublished profile is being warned about not being on the site, " +
    "which is exactly where it should be");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
