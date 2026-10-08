#!/usr/bin/env node
/**
 * Words changed on dev and not published yet
 *   node workers/test/words-waiting.test.mjs
 *
 * The words are saved on the site's branch (main); a code change can alter
 * them on dev, and dev.thauma.one draws dev's copy. Chase, 2026-10-08: the
 * editor showed the Mission heading on one line while the page showed two.
 * The editor is told which lines dev changed, against the point the two
 * branches last agreed — so a word saved a minute ago on main, and not yet
 * carried to dev, is NOT mistaken for a change waiting on dev.
 */
import { waitingOnDev } from "../src/admin-translate.js";
import { changes } from "../src/admin-publish.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("words waiting on dev\n");

const PATH = "src/_data/i18n/en.json";
const env = { GITHUB_TOKEN: "t", GITHUB_REPO: "o/r", CONTENT_BRANCH: "main", STAGING_BRANCH: "dev" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

function github({ base, dev, changed = [PATH] }) {
  return async (url) => {
    const u = new URL(url);
    if (/\/compare\//.test(u.pathname)) {
      return Response.json({ status: "diverged", files: changed.map((filename) => ({ filename })), merge_base_commit: { sha: "base123" } });
    }
    const ref = u.searchParams.get("ref");
    const doc = ref === "dev" ? dev : ref === "base123" ? base : null;
    if (!doc) return new Response("{}", { status: 404 });
    return Response.json({ type: "file", content: b64(doc), sha: ref });
  };
}

await check("a line dev changed shows dev's text", async () => {
  const base = { mission: { h2_thin: "Three expressions of" } };
  const dev = { mission: { h2_thin: "Three expressions\nof" } };
  const out = await waitingOnDev(env, [{ path: PATH, doc: base }], github({ base, dev }));
  eq(out[PATH], { "mission.h2_thin": "Three expressions\nof" }, "waiting");
});

await check("a word just saved on main, not yet on dev, is not waiting", async () => {
  const base = { home: { title: "Old" } };
  const main = { home: { title: "Just saved" } };
  const dev = base;                     // sync-dev has not run yet
  const out = await waitingOnDev(env, [{ path: PATH, doc: main }], github({ base, dev }));
  eq(out[PATH], {}, "nothing waiting");
});

await check("the same change on both branches is not waiting", async () => {
  const base = { a: "x" }, both = { a: "y" };
  const out = await waitingOnDev(env, [{ path: PATH, doc: both }], github({ base, dev: both }));
  eq(out[PATH], {}, "nothing waiting");
});

await check("a file dev did not touch is not read at all", async () => {
  let reads = 0;
  const gh = github({ base: {}, dev: {}, changed: ["src/js/main.js"] });
  const out = await waitingOnDev(env, [{ path: PATH, doc: {} }], async (u, o) => { if (/contents/.test(u)) reads++; return gh(u, o); });
  eq(out, {}, "nothing"); eq(reads, 0, "file reads");
});

await check("where the editor saves to dev itself, nothing is waiting", async () => {
  const out = await waitingOnDev({ ...env, CONTENT_BRANCH: "dev" }, [{ path: PATH, doc: {} }], github({ base: {}, dev: { a: "b" } }));
  eq(out, {}, "nothing");
});

await check("GitHub failing leaves the editor as it was", async () => {
  const out = await waitingOnDev(env, [{ path: PATH, doc: {} }], async () => new Response("no", { status: 500 }));
  eq(out, {}, "nothing");
});

console.log("\nwhat differs from live, for the Website's dots\n");

await check("a changed word marks Pages and its line; a changed event marks Events; a code change marks nothing", async () => {
  /* Chase, 2026-10-08: "add the dot to the tabs … like we do for Site Creator" */
  const live = { mission: { h2_thin: "Three expressions of" }, home: { title: "Home" } };
  const dev = { mission: { h2_thin: "Three expressions\nof" }, home: { title: "Home" } };
  const siteLive = { socials: { youtube: "" }, visibility: { comingSoon: { live: true } } };
  const siteDev = { socials: { youtube: "https://youtube.com/@x" }, visibility: { comingSoon: { live: true } } };
  const gh = async (url) => {
    const u = new URL(url);
    if (/\/actions\/workflows\//.test(u.pathname)) return Response.json({ workflow_runs: [{ head_sha: "livesha" }] });
    if (/\/compare\//.test(u.pathname)) return Response.json({ files: ["src/_data/i18n/en.json", "src/_data/site.json",
      "src/content/gatherings/x.md", "src/js/main.js"].map((filename) => ({ filename })), merge_base_commit: { sha: "livesha" } });
    const ref = u.searchParams.get("ref"), path = decodeURIComponent(u.pathname.replace(/.*contents\//, ""));
    const doc = path.endsWith("en.json") ? (ref === "livesha" ? live : dev) : (ref === "livesha" ? siteLive : siteDev);
    return Response.json({ type: "file", content: b64(doc), sha: ref });
  };
  const out = await changes(env, gh);
  eq(out.tabs.sort(), ["events", "links", "pages"], "tabs");
  eq(out.lines, ["site:mission.h2_thin"], "lines");
});

await check("never published, or GitHub failing: no dots, no error", async () => {
  eq(await changes(env, async () => Response.json({ workflow_runs: [] })), { tabs: [], lines: [] }, "never");
  eq(await changes(env, async () => new Response("x", { status: 500 })), { tabs: [], lines: [] }, "failing");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
