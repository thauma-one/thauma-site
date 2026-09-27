#!/usr/bin/env node
/**
 * Website › Photos — put the dot on what matters
 *   node test/photos-page.test.mjs
 *
 * The focus of a framed photo must stay where the site's scroll drift never
 * shows the frame's edge (see admin-photos.js for the arithmetic). These
 * check that the page draws that range where the project notes say it is,
 * keeps the dot inside it, and saves only what changed.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const build = ["_site", "_site_next", "_site_prod"].find((d) =>
  existsSync(`${d}/admin/website/photos/index.html`));

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

console.log("Website › Photos\n");
if (!build) { console.log("  SKIP  no build — run eleventy first."); process.exit(1); }

const IMAGES = {
  home_who: { src: "/img/a.webp", focal_x: 50, focal_y: 28, zoom: 110 },
  give_impact: { src: "/img/b.webp", focal_x: 40, focal_y: 50, zoom: 100 },
};

async function boot() {
  const sent = [];
  const dom = new JSDOM(readFileSync(`${build}/admin/website/photos/index.html`, "utf8"), {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "https://dev.thauma.one/admin/website/photos/",
    beforeParse(w) {
      Object.defineProperty(w, "sessionStorage", { value: {
        getItem: () => JSON.stringify({ roles: ["admin"] }), setItem: () => {} } });
      w.fetch = async (u, o = {}) => {
        u = String(u);
        const body = o.body ? JSON.parse(o.body) : null;
        if (o.method && o.method !== "GET") sent.push({ method: o.method, url: u, body });
        const ok = (j) => ({ ok: true, status: 200, json: async () => j });
        if (u.includes("/api/admin/publish")) return ok({ configured: true, waiting: 0 });
        if (u.includes("file=en")) return ok({ configured: true, data: { home: { who_cue: "The need" } }, sha: "e1" });
        if (u.includes("/api/admin/content")) {
          if (o.method === "PUT") return ok({ ok: true, sha: "s2", changed: Object.keys(body.changes) });
          return ok({ configured: true, data: { images: JSON.parse(JSON.stringify(IMAGES)) }, sha: "s1" });
        }
        return ok({});
      };
      w.scrollTo = () => {};
    },
  });
  const w = dom.window, d = w.document;
  w.eval(readFileSync("src/js/staff-i18n.js", "utf8"));
  w.eval(readFileSync("src/js/staff.js", "utf8"));
  w.eval(readFileSync("src/js/admin-photos.js", "utf8"));
  await tick(150);
  return { w, d, sent };
}
const pct = (el, prop) => parseFloat(el.style[prop]);
async function zoom(w, d, z) {
  const el = d.getElementById("phZoom");
  el.value = z;
  el.dispatchEvent(new w.Event("input"));
}
function key(w, d, k, shift = false) {
  d.getElementById("phDot").dispatchEvent(new w.KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));
}

await check("every photo slot in the file is offered, named by its page and section", async () => {
  const { d } = await boot();
  const names = [...d.querySelectorAll("#phThumbs [data-photo] span")].map((s) => s.textContent);
  assert(names.join(" | ") === "Home · The need | Give · Impact", names.join(" | "));
});

await check("the bands sit where the project notes put the safe range", async () => {
  /* zoom 110: about 19–81%; zoom 100: 37.5–62.5%. */
  const { w, d } = await boot();
  const top = d.getElementById("phBandTop"), bottom = d.getElementById("phBandBottom");
  assert(pct(top, "height") === 20 && pct(bottom, "height") === 20, `110: ${top.style.height} / ${bottom.style.height}`);
  await zoom(w, d, 100);
  assert(pct(top, "height") === 38 && pct(bottom, "height") === 38, `100: ${top.style.height} / ${bottom.style.height}`);
});

await check("lowering the zoom moves an unsafe focus back inside, never leaves it", async () => {
  const { w, d } = await boot();
  await zoom(w, d, 100);
  assert(pct(d.getElementById("phDot"), "top") === 38, `dot at ${d.getElementById("phDot").style.top}`);
});

await check("the dot moves with the arrow keys and stops at the band", async () => {
  const { w, d } = await boot();
  key(w, d, "ArrowRight", true);
  assert(pct(d.getElementById("phDot"), "left") === 55, d.getElementById("phDot").style.left);
  for (let i = 0; i < 20; i++) key(w, d, "ArrowUp", true);
  assert(pct(d.getElementById("phDot"), "top") === 20, `went to ${d.getElementById("phDot").style.top}`);
});

await check("the preview frames the photo exactly as the site does", async () => {
  const { d } = await boot();
  const img = d.getElementById("phPreview");
  assert(img.style.objectPosition === "50% 28%" && img.style.transformOrigin === "50% 28%", img.style.cssText);
  assert(img.style.transform === "scale(1.232)", img.style.transform);
});

await check("Save sends only what changed, against the file it read", async () => {
  const { w, d, sent } = await boot();
  assert(d.getElementById("phSaveBar").hidden, "a save bar with nothing to save");
  key(w, d, "ArrowDown");
  d.getElementById("phSave").click();
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  assert(put && put.body.sha === "s1" && JSON.stringify(put.body.changes) === JSON.stringify({ "images.home_who.focal_y": 29 }),
    JSON.stringify(put && put.body));
  assert(d.getElementById("phSaveBar").hidden, "still unsaved after saving");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
