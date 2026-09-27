#!/usr/bin/env node
/**
 * Website › Photos — frame what matters
 *   node test/photos-page.test.mjs
 *
 * The window drawn on each picture has to be the part the site's frame
 * really shows, and it has to be able to go anywhere on the picture without
 * the frame's edge ever showing as the page scrolls. The rule lives in
 * lib/frame.js (the site), main.js (the scroll) and admin-photos.js (this
 * screen); these check all three say the same thing.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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
/* The pictures do not load in the test browser; give them their size. */
function sized(w, d) {
  const img = d.getElementById("phImg");
  Object.defineProperty(img, "naturalWidth", { value: 1800, configurable: true });
  Object.defineProperty(img, "naturalHeight", { value: 1200, configurable: true });
  img.dispatchEvent(new w.Event("load"));
}
async function zoom(w, d, z) {
  const el = d.getElementById("phZoom");
  el.value = z;
  el.dispatchEvent(new w.Event("input"));
}
function key(w, d, k, shift = false) {
  d.getElementById("phWin").dispatchEvent(new w.KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }));
}

await check("the site, the scroll and this screen agree on the numbers", async () => {
  const frame = require("../lib/frame.js");
  const main = readFileSync("src/js/main.js", "utf8");
  const photos = readFileSync("src/js/admin-photos.js", "utf8");
  assert(main.includes("* " + frame.HEADROOM + ";") && main.includes("PMAX = " + frame.DRIFT + ";"),
    "main.js's headroom or drift is not lib/frame.js's");
  assert(photos.includes("DRIFT = " + frame.DRIFT) && photos.includes("HEADROOM = " + frame.HEADROOM),
    "admin-photos.js's numbers are not lib/frame.js's");
});

await check("inside the band a photo renders exactly as before; outside, the zoom's origin stays in it", async () => {
  const { frameStyle } = require("../lib/frame.js");
  const inside = frameStyle({ focal_x: 50, focal_y: 28, zoom: 110 });
  assert(inside === "object-position:50% 28%;transform-origin:50% 28%;transform:scale(1.1)", inside);
  const top = frameStyle({ focal_x: 50, focal_y: 0, zoom: 100 });
  assert(top === "object-position:50% 0%;transform-origin:50% 37.5%;transform:scale(1)", top);
  const bottom = frameStyle({ focal_x: 50, focal_y: 100, zoom: 100 });
  assert(bottom === "object-position:50% 100%;transform-origin:50% 62.5%;transform:scale(1)", bottom);
});

await check("every photo slot in the file is offered, named by its page and section", async () => {
  const { d } = await boot();
  const names = [...d.querySelectorAll("#phThumbs [data-photo] span")].map((s) => s.textContent);
  assert(names.join(" | ") === "Home · The need | Give · Impact", names.join(" | "));
});

await check("the window is the part the frame shows: 57% of a 3:2 photo's height at zoom 100", async () => {
  const { w, d } = await boot();
  d.querySelector('[data-photo="give_impact"]').click();
  sized(w, d);
  const win = d.getElementById("phWin");
  assert(Math.abs(pct(win, "height") - 57.4) < 0.1, `height ${win.style.height}`);
  assert(Math.abs(pct(win, "width") - 89.29) < 0.1, `width ${win.style.width}`);
  await zoom(w, d, 150);
  assert(pct(win, "height") < 40, `zooming in did not shrink it: ${win.style.height}`);
});

await check("the window goes to the very top, and its travel stops at the picture's edge", async () => {
  const { w, d } = await boot();
  sized(w, d);
  for (let i = 0; i < 30; i++) key(w, d, "ArrowUp", true);
  const win = d.getElementById("phWin"), travel = d.getElementById("phTravel");
  assert(Math.abs(pct(travel, "top")) < 0.2, `travel reaches ${travel.style.top}, not the top edge`);
  assert(pct(win, "top") > 0, "the window itself sits on the edge, so the drift would show it");
});

await check("the preview frames the photo exactly as the site does", async () => {
  const { w, d } = await boot();
  const img = d.getElementById("phPreview");
  assert(img.style.objectPosition === "50% 28%" && img.style.transformOrigin === "50% 28%", img.style.cssText);
  assert(img.style.transform === "scale(1.232)", img.style.transform);
  sized(w, d);
  for (let i = 0; i < 30; i++) key(w, d, "ArrowUp", true);
  assert(img.style.objectPosition === "50% 0%" && /50% 19\.\d+%/.test(img.style.transformOrigin),
    `at the top: ${img.style.cssText}`);
});

await check("Save sends only what changed, against the file it read", async () => {
  const { w, d, sent } = await boot();
  assert(d.getElementById("phSaveBar").hidden, "a save bar with nothing to save");
  sized(w, d);
  key(w, d, "ArrowDown");
  d.getElementById("phSave").click();
  await tick(100);
  const put = sent.find((s) => s.method === "PUT");
  const keys = put ? Object.keys(put.body.changes) : [];
  assert(put && put.body.sha === "s1" && keys.length === 1 && keys[0] === "images.home_who.focal_y" &&
    put.body.changes["images.home_who.focal_y"] > 28, JSON.stringify(put && put.body));
  assert(d.getElementById("phSaveBar").hidden, "still unsaved after saving");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
