#!/usr/bin/env node
/**
 * The Library editor — resources and gatherings
 *   node test/library.test.mjs
 *
 * DRIVEN, NOT READ. Every bug this console has produced in the last week was
 * two correct-looking halves that did the wrong thing to each other: a tab
 * selector that matched every field beneath it, a Save button whose status
 * line had moved, a form that posted values it had just overwritten. None of
 * those are visible in the source of either half. So this clicks and types.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/library/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log("the Library editor\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const VOCAB = {
  moment: ["crisis", "growth", "planning", "lookup"],
  format: ["guide", "diagram", "checklist", "glossary-entry", "video"],
  type: ["gathering", "cohort"], status: ["upcoming", "past", "canceled"],
  cadence: ["weekly", "fortnightly", "monthly", "custom"],
};

async function boot({ resources = [], gatherings = [], truncated = false } = {}) {
  const posts = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/library/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/library/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        if (o.method === "POST") {
          posts.push(JSON.parse(o.body));
          return { ok: true, status: 200, json: async () => ({ ok: true, slug: "saved-slug" }) };
        }
        return { ok: true, status: 200, json: async () => ({
          you: { email: "me@thauma.one", name: "Me" },
          resources: { items: resources, truncated },
          gatherings: { items: gatherings, truncated: false },
          vocabulary: VOCAB, limit: 40,
        }) };
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  for (const f of ["tokens.css", "staff.css", "admin.css"]) {
    const st = d.createElement("style");
    st.textContent = readFileSync("src/css/" + f, "utf8");
    d.head.appendChild(st);
  }
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.eval(readFileSync("src/js/admin-library.js", "utf8"));
  await new Promise((r) => setTimeout(r, 220));
  return { w, d, posts };
}

const GLOSSARY = {
  slug: "glossary", title: { en: "Production glossary", hr: "Pojmovnik" },
  summary: { en: "The words, both ways." }, moment: "lookup",
  format: "glossary-entry", pinned: true, symptoms: [], body: "A…",
};

/* --------------------------------------------------- both collections, one page */

await check("one nav entry holds both collections", async () => {
  const { d } = await boot();
  const tabs = [...d.querySelectorAll(".tabs .tab")].map((t) => t.dataset.tab);
  assert(tabs.join(",") === "resources,gatherings", `tabs are ${tabs.join(",")}`);
  assert(d.querySelector('[data-lib-list="resources"]'), "no resources list");
  assert(d.querySelector('[data-lib-list="gatherings"]'), "no gatherings list");
});

await check("an empty collection says so rather than looking broken", async () => {
  const { d } = await boot();
  const host = d.querySelector('[data-lib-list="resources"]');
  assert(/Nothing here yet/i.test(host.textContent), `says: ${host.textContent.trim()}`);
});

/* ------------------------------------------------- language optional per item */

await check("the row shows which languages an item actually has", async () => {
  /* What still needs translating is the thing somebody scanning wants, and it
     is invisible if you have to open every item to find out. */
  const { d } = await boot({ resources: [GLOSSARY] });
  const chips = [...d.querySelectorAll(".lib-lang")];
  assert(chips.length >= 3, `only ${chips.length} language chips`);
  const on = chips.filter((c) => c.classList.contains("is-on")).map((c) => c.textContent);
  assert(on.includes("en") && on.includes("hr"), `lit: ${on.join(",")}`);
  const off = chips.filter((c) => !c.classList.contains("is-on")).map((c) => c.textContent);
  assert(off.includes("sr"), "a language with no title is not shown as missing");
});

await check("an item with ONE language saves", async () => {
  /* The rule the whole collection is built on: a save is never refused for a
     missing translation. Site chrome is written once at a desk; this is
     written in the field in whatever language the person has. */
  const { w, d, posts } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const panel = d.querySelector('[data-lib-item="gatherings/"]');
  panel.querySelector('[data-lib-title="hr"]').value = "Prva grupa";
  panel.querySelector("[data-lib-save]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 200));

  assert(posts.length === 1, `${posts.length} saves posted`);
  assert(posts[0].title.hr === "Prva grupa", "the Croatian title did not travel");
  assert(!("en" in posts[0].title), "an empty English title was sent as a value");
});

await check("but something with no title at all is refused, in the browser", async () => {
  const { w, d, posts } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const panel = d.querySelector('[data-lib-item="gatherings/"]');
  panel.querySelector("[data-lib-save]").dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 150));
  assert(posts.length === 0, "an untitled item was posted to the server");
  assert(/at least one language/i.test(panel.querySelector("[data-lib-status]").textContent),
    "nothing told the person why");
});

/* ------------------------------------------ fields that depend on other fields */

await check("a cohort asks about sessions; a one-off gathering asks about a date", async () => {
  const { w, d } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  let panel = d.querySelector('[data-lib-item="gatherings/"]');
  assert(panel.querySelector('[data-lib-field="date"]'), "a gathering has no date field");
  assert(!panel.querySelector(".lib-session"), "a one-off gathering is asked for sessions");

  const type = panel.querySelector('[data-lib-field="type"]');
  type.value = "cohort";
  type.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));

  panel = d.querySelector('[data-lib-item="gatherings/"]');
  assert(!panel.querySelector('[data-lib-field="date"]'), "a cohort is still asked for one date");
  assert(panel.querySelector(".lib-session"), "a cohort has no session list");
  assert(panel.querySelector('[data-lib-field="capacity"]'), "a cohort has no capacity");
});

await check("changing a choice keeps what has already been typed", async () => {
  /* Redrawing from the saved item would throw away the words somebody is in
     the middle of writing — which is exactly how the contact editor felt when
     a click was re-rendering the form. */
  const { w, d } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  let panel = d.querySelector('[data-lib-item="gatherings/"]');
  panel.querySelector('[data-lib-title="en"]').value = "Regional gathering";

  const type = panel.querySelector('[data-lib-field="type"]');
  type.value = "cohort";
  type.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));

  panel = d.querySelector('[data-lib-item="gatherings/"]');
  assert(panel.querySelector('[data-lib-title="en"]').value === "Regional gathering",
    "the title was wiped by changing the kind");
});

await check("symptoms are asked for only at the crisis door", async () => {
  const { w, d } = await boot({ resources: [GLOSSARY] });
  d.querySelector('[data-lib-item] .adm-row').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  let panel = d.querySelector("[data-lib-item]");
  assert(!panel.querySelector('[data-lib-field="symptoms"]'),
    "a glossary entry is being asked for symptoms");

  const moment = panel.querySelector('[data-lib-field="moment"]');
  moment.value = "crisis";
  moment.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  panel = d.querySelector("[data-lib-item]");
  assert(panel.querySelector('[data-lib-field="symptoms"]'),
    "a crisis resource cannot be given symptoms");
});

/* ------------------------------------------------------------- the row trap */

await check("clicking inside an open item does not collapse it", async () => {
  /* The mailing page's lesson, in the one place it would recur: an attribute
     meaning "this is a header" must not match everything underneath it. */
  const { w, d } = await boot({ resources: [GLOSSARY] });
  d.querySelector('[data-lib-item] .adm-row').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const title = d.querySelector('[data-lib-title="en"]');
  assert(title, "the panel did not open");
  title.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  assert(d.querySelector('[data-lib-title="en"]'),
    "clicking a field closed the item being edited");
});

await check("a full collection says so instead of quietly showing part of it", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...GLOSSARY, slug: `r${i}` }));
  const { d } = await boot({ resources: many, truncated: true });
  assert(/outgrown|first 40/i.test(d.querySelector('[data-lib-list="resources"]').textContent),
    "a truncated list looks identical to a complete one");
});

/* --------------------------------------------- what the closed row says */

await check("the row says what KIND of thing it is, in words", async () => {
  /* A checklist and a video looked identical until you opened them. And the
     vocabulary is slugs — "glossary-entry" is what the file stores; "Glossary
     entry" is what a person reads. */
  const { d } = await boot({ resources: [GLOSSARY] });
  const tags = [...d.querySelectorAll(".lib-tags .role-tag")].map((t) => t.textContent);
  assert(tags.some((t) => t === "Glossary entry"),
    `the format is missing or unformatted: ${tags.join(" | ")}`);
  assert(!tags.some((t) => /-/.test(t)), `a raw slug reached the screen: ${tags.join(" | ")}`);
});

await check("a gathering's row shows the whole span, not just the first day", async () => {
  const { d } = await boot({ gatherings: [{
    slug: "weekend", title: { en: "Weekend" }, summary: {}, type: "gathering",
    status: "upcoming", date: "2027-03-14", end_date: "2027-03-15", sessions: [] }] });
  const tags = [...d.querySelectorAll(".lib-tags .role-tag")].map((t) => t.textContent);
  assert(tags.some((t) => t.includes("2027-03-14") && t.includes("2027-03-15")),
    `the row shows ${tags.join(" | ")} — a weekend reads as a single day`);
});

/* ----------------------------------------------------- multi-day and cadence */

await check("a one-off gathering can be given a last day", async () => {
  const { w, d } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const panel = d.querySelector('[data-lib-item="gatherings/"]');
  assert(panel.querySelector('[data-lib-field="end_date"]'),
    "there is no way to say a gathering runs over a weekend");
});

await check("a cohort is asked how often it meets, and a one-off is not", async () => {
  const { w, d } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  let panel = d.querySelector('[data-lib-item="gatherings/"]');
  assert(!panel.querySelector('[data-lib-field="cadence"]'),
    "a one-off gathering is asked how often it repeats");

  const type = panel.querySelector('[data-lib-field="type"]');
  type.value = "cohort";
  type.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  panel = d.querySelector('[data-lib-item="gatherings/"]');
  const cadence = panel.querySelector('[data-lib-field="cadence"]');
  assert(cadence, "a cohort cannot say how often it meets");
  const options = [...cadence.options].map((o) => o.textContent);
  assert(options.includes("Weekly"), `cadences read as ${options.join(", ")}`);
  assert(options.includes("Custom"),
    "no escape hatch — first Monday of the month fits none of the fixed ones");
});

await check("the session table says what a session IS", async () => {
  /* "I don't understand what sessions means" was a fair question about two
     unlabelled boxes under a bare heading. */
  const { w, d } = await boot({ gatherings: [] });
  d.querySelector('[data-lib-add="gatherings"]').dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60));
  const type = d.querySelector('[data-lib-field="type"]');
  type.value = "cohort";
  type.dispatchEvent(new w.Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const panel = d.querySelector('[data-lib-item="gatherings/"]');
  const head = panel.querySelector(".lib-session-head");
  assert(head, "the date and topic boxes are still unlabelled");
  assert(/Date/i.test(head.textContent) && /covers/i.test(head.textContent),
    `the columns say: ${head.textContent}`);
  const block = panel.querySelector(".lib-sessions");
  assert(/each time the group|time the group gets together/i.test(block.textContent),
    "nothing explains what a session is");
});

/* ----------------------------------------------------------------- pictures */

await check("a picture is chosen, not typed as a path", async () => {
  const { d } = await boot({ resources: [GLOSSARY] });
  const d2 = d;
  d2.querySelector('[data-lib-item] .adm-row').dispatchEvent(
    new d2.defaultView.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  const slot = d2.querySelector('[data-lib-photo="photo"]');
  assert(slot, "there is no picture control at all");
  assert(slot.querySelector("[data-lib-file]"), "no file input — a path must be typed");
  assert(slot.querySelector("[data-lib-pick]"), "nothing opens the file picker");
  const text = [...d2.querySelectorAll('input[type="text"][data-lib-field="photo"]')];
  assert(text.length === 0, "the old 'photo path' text box is still there");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
