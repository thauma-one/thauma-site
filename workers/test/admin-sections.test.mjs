#!/usr/bin/env node
/**
 * Website › Site Creator: the site's pages as sections
 *   node workers/test/admin-sections.test.mjs
 *
 * Chase, 2026-10-21: the administrators' Site Creator works like the staff
 * one — sections added, moved and taken away, the menu in its own order —
 * without anything on the site looking different. This is the one door that
 * writes the arrangement (workers/src/admin-sections.js), so it is where the
 * rules are held: the head of a page stays, the fixed parts stay, a section
 * names only words of its own, and the page and its words change in ONE
 * commit, or not at all.
 */
import { readFileSync } from "node:fs";
import handler, { checkSections, planLanguage, planPhotos, namedKeys } from "../src/admin-sections.js";
import SECTIONS from "../../src/js/site-sections.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("the pages as sections\n");

const DOC = JSON.parse(readFileSync(new URL("../../src/_data/pageSections.json", import.meta.url), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const refused = (next) => checkSections(next, DOC).error;

/* ---------------------------------------------------------------- checking */

await check("the site's own arrangement passes its own checks, unchanged", async () => {
  const r = checkSections(clone(DOC), DOC);
  assert(!r.error, r.error);
  eq(r.doc, DOC, "rebuilt");
});

await check("every word the arrangement names is in every language file", async () => {
  for (const l of ["en", "hr", "sr", "sl"]) {
    const doc = JSON.parse(readFileSync(new URL(`../../src/_data/i18n/${l}.json`, import.meta.url), "utf8"));
    const missing = [...namedKeys(DOC)].filter((k) => typeof SECTIONS.wordAt(doc, k) !== "string" || SECTIONS.wordAt(doc, k) === "");
    eq(missing, [], `${l} lacks`);
  }
});

await check("a section can be added, moved and taken away", async () => {
  const next = clone(DOC), home = next.pages.home;
  home.splice(2, 0, SECTIONS.newSection("story", "s1abc"));
  home.splice(3, 1);                                       /* the values, gone */
  [home[1], home[2]] = [home[2], home[1]];                 /* moved */
  const r = checkSections(next, DOC);
  assert(!r.error, r.error);
  eq(r.doc.pages.home.map((s) => s.id), ["home-hero", "s1abc", "home-who", "home-cta"], "home");
});

await check("the head of a page stays where it is, and stays itself", async () => {
  const moved = clone(DOC); moved.pages.mission.reverse();
  assert(refused(moved), "the header was moved");
  const gone = clone(DOC); gone.pages.mission.shift();
  assert(refused(gone), "the header was taken away");
  const second = clone(DOC); second.pages.mission.splice(2, 0, { id: "s2abc", kind: "pageHeader", words: { heading: "blocks.s2abc.heading" } });
  assert(refused(second), "a second header was added");
});

await check("a fixed part can move, but not be taken away, added or put on another page", async () => {
  const moved = clone(DOC); moved.pages.contact.push(SECTIONS.newSection("invite", "s3abc"));
  [moved.pages.contact[1], moved.pages.contact[2]] = [moved.pages.contact[2], moved.pages.contact[1]];
  assert(!refused(moved), refused(moved));
  const gone = clone(DOC); gone.pages.contact.pop();
  assert(refused(gone), "the contact form was taken away");
  const twice = clone(DOC); twice.pages.about.push({ id: "s4abc", kind: "teamGrid" });
  assert(refused(twice), "the team was added to About");
});

await check("a section names only words of its own, or the ones it had", async () => {
  const theirs = clone(DOC);
  theirs.pages.home[1].words.lede = "staff.login_note";
  assert(refused(theirs), "Home's story was pointed at the staff page's words");
  const other = clone(DOC), s = SECTIONS.newSection("story", "s5abc");
  s.words.cue = "blocks.s6xyz.cue";
  other.pages.home.push(s);
  assert(refused(other), "a section named another section's words");
  const own = clone(DOC);
  own.pages.home[1].words.note = "blocks.home-who.note";
  assert(!refused(own), refused(own));
});

await check("pages and the menu are arranged, never added to or taken from", async () => {
  const more = clone(DOC); more.pages.extra = [{ id: "x-head", kind: "pageHeader", words: { heading: "blocks.x-head.heading" } }];
  assert(refused(more), "a page was added");
  const menu = clone(DOC); menu.nav.reverse();
  assert(!refused(menu), refused(menu));
  const lost = clone(DOC); lost.nav.pop();
  assert(refused(lost), "a page left the menu");
});

await check("a button goes to one of the site's pages or a web address, nothing else", async () => {
  const bad = clone(DOC); bad.pages.home[3].buttons[0].to = "javascript:alert(1)";
  assert(refused(bad), "a script link was accepted");
  const web = clone(DOC); web.pages.home[3].buttons[0].to = "https://example.org/give";
  assert(!refused(web), refused(web));
});

await check("the staff Site Creator's quote, wide photo, links and sign-up can be added; a link goes to a page or a web address", async () => {
  const doc = clone(DOC);
  for (const kind of ["quote", "photo", "links", "signup"]) doc.pages.about.splice(1, 0, SECTIONS.newSection(kind, "s" + kind + "1"));
  assert(!refused(doc), refused(doc));
  const ok = checkSections(doc, DOC).doc.pages.about.find((s) => s.kind === "links");
  assert(ok.items.every((it) => it.to === "about"), "where each goes, kept");
  const bad = clone(doc); bad.pages.about.find((s) => s.kind === "links").items[0].to = "javascript:alert(1)";
  assert(refused(bad), "a script link was accepted");
});

await check("what is not a known look is dropped, and the default is not written", async () => {
  const next = clone(DOC);
  next.pages.home[1].look = { ground: "plain", voice: "neon" };
  const r = checkSections(next, DOC);
  assert(!r.error && !r.doc.pages.home[1].look, JSON.stringify(r.doc.pages.home[1]));
});

/* ---------------------------------------------------------------- planning */

const EN = JSON.stringify({ home: { cue: "A" }, blocks: { gone1: { cue: "old" } } }, null, 2) + "\n";

await check("a section's new words are made in each file, and a gone one's words go with it", async () => {
  const named = new Set(["home.cue", "blocks.s7abc.cue", "blocks.s7abc.heading_thin"]);
  const out = JSON.parse(planLanguage(EN, named, { "blocks.s7abc.cue": "Our Story" }));
  eq(out.blocks, { s7abc: { cue: "Our Story", heading_thin: "" } }, "blocks");
  eq(out.home, { cue: "A" }, "the page's own words, untouched");
  eq(planLanguage(JSON.stringify({ home: { cue: "A" } }), new Set(["home.cue"]), {}), null, "nothing to change");
});

await check("words a section always had are never deleted, whatever is taken away", async () => {
  const out = planLanguage(EN, new Set(), {});
  assert(JSON.parse(out).home.cue === "A", "Home's own word was deleted");
});

await check("a section's own photo slot is made with it and goes with it; one the site always had stays", async () => {
  const site = JSON.stringify({ images: { home_who: { src: "/media/site/a.webp" } } });
  const next = clone(DOC), s = SECTIONS.newSection("story", "s8abc");
  s.photo = "s8abc";
  next.pages.home.push(s);
  const made = JSON.parse(planPhotos(site, next, DOC, { s8abc: "/media/site/b.webp" }));
  eq(made.images.s8abc, { src: "/media/site/b.webp", focal_x: 50, focal_y: 50, zoom: 100 }, "made");
  const back = JSON.parse(planPhotos(JSON.stringify(made), clone(DOC), next, {}));
  assert(!back.images.s8abc && back.images.home_who, JSON.stringify(back.images));
  const bad = clone(next);
  eq(planPhotos(site, bad, DOC, { s8abc: "https://elsewhere/x.jpg" }), null, "an outside picture was taken");
  assert(!bad.pages.home.at(-1).photo, "a section kept a photo it has no slot for");
});

/* ---------------------------------------------------------------- the door */

const TEAM = "thaumaone.cloudflareaccess.com", AUD = "test-aud-tag";
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "k1"; jwk.alg = "RS256";
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
const h = enc({ alg: "RS256", kid: "k1", typ: "JWT" });
const p = enc({ iss: `https://${TEAM}`, aud: AUD, email: "admin@thauma.one", sub: "u", exp: Math.floor(Date.now() / 1000) + 600 });
const TOKEN = `${h}.${p}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${h}.${p}`)))}`;
const env = (roles = "admin") => ({
  ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, GITHUB_TOKEN: "t", GITHUB_REPO: "thauma-one/thauma-site",
  CONTENT_BRANCH: "main", STAGING_BRANCH: "dev",
  DB: { prepare() { return { bind() { return { async all() {
    return { results: [{ user_id: "u_1", email: "admin@thauma.one", user_name: "Chase Roush", status: "active", preferred_lang: "en", roles }] };
  }, async run() { return { success: true }; } }; } }; } },
});
const req = (method, body) => new Request("https://x/api/admin/sections", { method,
  headers: { "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": TOKEN }, body: body ? JSON.stringify(body) : undefined });

/* GitHub: the branch at HEAD, its files, and git's own objects */
function repo({ files, moveRef = false }) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)), m = init.method || "GET";
    if (u.pathname.includes("/cdn-cgi/access/certs")) return Response.json({ keys: [jwk] });
    calls.push({ m, path: u.pathname, ref: u.searchParams.get("ref"), body: init.body ? JSON.parse(init.body) : null });
    if (/\/commits\/main$/.test(u.pathname)) return new Response("head1");
    const c = u.pathname.match(/\/contents\/(.+)$/);
    if (c && m === "GET") {
      const path = decodeURIComponent(c[1]), ref = u.searchParams.get("ref");
      const f = ref === "dev" ? files.dev && files.dev[path] : files[path];
      if (f == null) return new Response("{}", { status: 404 });
      return Response.json({ type: "file", sha: `${ref}:${path}`, content: btoa(unescape(encodeURIComponent(f))) });
    }
    if (/\/git\/commits\/head1$/.test(u.pathname)) return Response.json({ sha: "head1", tree: { sha: "tree1" } });
    if (/\/git\/trees$/.test(u.pathname)) return Response.json({ sha: "tree2" });
    if (/\/git\/commits$/.test(u.pathname)) return Response.json({ sha: "commit2" });
    if (/\/git\/refs\/heads\/main$/.test(u.pathname)) return moveRef ? new Response("{}", { status: 422 }) : Response.json({ object: { sha: "commit2" } });
    return new Response("{}", { status: 404 });
  };
  return calls;
}
const LANG = (o) => JSON.stringify(o, null, 2) + "\n";
const FILES = {
  "src/_data/pageSections.json": JSON.stringify(DOC, null, 2) + "\n",
  "src/_data/site.json": JSON.stringify({ languages: ["en", "hr"], images: {} }, null, 2) + "\n",
  "src/_data/i18n/en.json": LANG({ home: { cue: "A" } }),
  "src/_data/i18n/hr.json": LANG({ home: { cue: "A" } }),
};

await check("a saved arrangement is ONE commit: the page and every language's words, on the commit it was read at", async () => {
  const calls = repo({ files: FILES });
  const next = clone(DOC), s = SECTIONS.newSection("story", "s9abc");
  next.pages.home.splice(2, 0, s);
  const words = { en: { "blocks.s9abc.cue": "Our Story" }, hr: { "blocks.s9abc.cue": "Lorem" } };
  const res = await handler.fetch(req("POST", { action: "save", sha: "head1:src/_data/pageSections.json", doc: next, words }), env());
  const out = await res.json();
  assert(res.status === 200, JSON.stringify(out));
  const tree = calls.find((c) => /\/git\/trees$/.test(c.path));
  eq(tree.body.base_tree, "tree1", "built on HEAD's tree");
  eq(tree.body.tree.map((f) => f.path).sort(), ["src/_data/i18n/en.json", "src/_data/i18n/hr.json", "src/_data/pageSections.json"], "files");
  const en = JSON.parse(tree.body.tree.find((f) => f.path.endsWith("en.json")).content);
  eq(en.blocks.s9abc.cue, "Our Story", "the words typed");
  const commit = calls.find((c) => c.m === "POST" && /\/git\/commits$/.test(c.path));
  assert(/\[skip ci\]/.test(commit.body.message) && commit.body.parents[0] === "head1", JSON.stringify(commit.body));
  const ref = calls.find((c) => c.m === "PATCH");
  assert(ref.body.force === false, "the branch could be forced");
  assert(calls.filter((c) => c.ref && c.ref !== "head1" && c.ref !== "dev").length === 0, "something was read from a moving branch");
});

await check("a save made against an older copy is refused, and nothing is written", async () => {
  const calls = repo({ files: FILES });
  const res = await handler.fetch(req("POST", { action: "save", sha: "stale", doc: clone(DOC), words: {} }), env());
  eq(res.status, 409, "status");
  assert(!calls.some((c) => c.m !== "GET"), "something was written");
});

await check("if anything is saved on the site meanwhile, the branch is not moved", async () => {
  repo({ files: FILES, moveRef: true });
  const next = clone(DOC); next.nav.reverse();
  const res = await handler.fetch(req("POST", { action: "save", sha: "head1:src/_data/pageSections.json", doc: next, words: {} }), env());
  eq(res.status, 409, "status");
});

await check("before the code reaches the site's branch, the arrangement is read from dev and the first save writes it", async () => {
  const files = { ...FILES, dev: { "src/_data/pageSections.json": FILES["src/_data/pageSections.json"] } };
  delete files["src/_data/pageSections.json"];
  repo({ files });
  const got = await (await handler.fetch(req("GET"), env())).json();
  assert(got.seeded && got.doc.pages.home, JSON.stringify(got).slice(0, 120));
  const calls = repo({ files });
  const res = await handler.fetch(req("POST", { action: "save", sha: got.sha, doc: clone(DOC), words: {} }), env());
  assert(res.status === 200, await res.text());
  const tree = calls.find((c) => /\/git\/trees$/.test(c.path));
  eq(tree.body.tree.map((f) => f.path), ["src/_data/pageSections.json"], "written to the site's branch");
});

await check("only editors may arrange the pages", async () => {
  repo({ files: FILES });
  const res = await handler.fetch(req("GET"), env("staff"));
  eq(res.status, 403, "status");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
