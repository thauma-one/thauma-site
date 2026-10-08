#!/usr/bin/env node
/**
 * Every line of every language: reading, saving, the file, and approving what comes back
 *   node workers/test/translate.test.mjs
 *
 * The route Claude translates the site through (Chase, 2026-09-26): download
 * a file, have it filled in, bring it back, approve line by line. What has to
 * hold: the file survives whatever a spreadsheet or a model does to it on the
 * way, nothing is saved without approval, a broken placeholder can never be
 * saved, and a line whose English changed shows up as outdated.
 */
import { readFileSync } from "node:fs";
import { unwrapCell, wrapCell,
  linesFor, withStatus, hashText, buildFile, readFile, parseCsv, csvCell, noteFor,
  checkLine, setLine, leafMap,
} from "../src/lib/translation-file.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("translating the site\n");

const EN = {
  code: "en", name: "English",
  home: { title: "Serve the Church", h2_thin: "On-site,", h2_bold: "behind the scenes.", count: "{n} churches" },
  values: { items: [{ title: "Rest" }, { title: "Craft" }] },
};
const HR = {
  code: "hr", name: "Hrvatski",
  home: { title: "Služiti Crkvi", h2_thin: "Na terenu,", h2_bold: "", count: "{n} crkava" },
  values: { items: [{ title: "Odmor" }] },
};
const NOTES = {
  keep: [{ id: "tk_1", term: "Thauma" }],
  glossary: [{ id: "tg_1", lang: "hr", source: "All of Me For All of Him", target: "Sve od mene Darujem Njega" }],
  guides: { "*": "Warm, plain.", hr: "Standard Croatian, Latin script." },
};

/* ------------------------------------------------------------------ lines */

await check("the language's code is never offered for translation; its name is", async () => {
  const ids = linesFor("site", EN, HR).map((l) => l.id);
  assert(!ids.includes("site:code"), "code offered");
  assert(ids.includes("site:name"), "name missing");
});

await check("a line the language lacks entirely is simply missing", async () => {
  const l = linesFor("site", EN, HR).find((x) => x.key === "values.items.1.title");
  eq(l && l.current, "", "the second value");
});

await check("status: missing, outdated, done — and first sight is taken as current", async () => {
  const lines = linesFor("site", EN, HR);
  const state = [
    { source: "site", key: "home.title", english_hash: await hashText("Serve the church (old)"),
      text_hash: await hashText("Služiti Crkvi") },
    { source: "site", key: "home.count", english_hash: await hashText("{n} churches"),
      text_hash: await hashText("{n} crkava") },
  ];
  const { lines: s, baseline } = await withStatus(lines, state);
  const by = Object.fromEntries(s.map((l) => [l.key, l.status]));
  eq(by["home.title"], "outdated", "English changed since");
  eq(by["home.count"], "done", "English unchanged");
  eq(by["home.h2_bold"], "missing", "blank");
  eq(by["home.h2_thin"], "done", "never seen before");
  assert(baseline.some((b) => b.key === "home.h2_thin"), "not recorded as first seen");
  assert(!baseline.some((b) => b.key === "home.h2_bold"), "a blank line was baselined");
  assert(!baseline.some((b) => b.key === "home.title"), "a known line was baselined");
});

await check("English and translation rewritten together is current, not outdated", async () => {
  /* How most copy changes have been made: one commit editing every language
     file. Flagging those lines would bury the real ones. */
  const lines = linesFor("site", EN, HR);
  const state = [{ source: "site", key: "home.title",
    english_hash: await hashText("Serve the church (old)"), text_hash: await hashText("Služiti crkvi (staro)") }];
  const { lines: s, refresh } = await withStatus(lines, state);
  eq(s.find((l) => l.key === "home.title").status, "done", "status");
  eq(refresh.map((r) => r.key), ["home.title"], "recorded afresh, so the next English-only change still shows");
});

/* ------------------------------------------------------------------- file */

const briefHr = "Translate from English into Hrvatski (hr).\n\nNever translate these: \"Thauma\"";

function fileFor(lines) {
  return buildFile({ lang: "hr", langName: "Hrvatski", brief: briefHr, lines,
    englishByKey: Object.fromEntries(lines.map((l) => [l.key, l.english])) });
}

/** Fill the last column of every data row, as a translator would. */
function fill(text, fn) {
  const rows = parseCsv(text);
  const at = rows.findIndex((r) => r[0] === "id");
  return rows.map((r, i) => {
    if (i > at && r[0]) r[r.length - 1] = fn(r[0]);
    return r.map(csvCell).join(",");
  }).join("\r\n");
}

await check("the file names its language, carries the brief, and leaves the answer column empty", async () => {
  const text = fileFor(linesFor("site", EN, HR));
  assert(text.charCodeAt(0) === 0xfeff, "no BOM — Excel would garble Croatian");
  assert(text.includes("# Translate from English into Hrvatski (hr)."), "the brief is not in it");
  const rows = parseCsv(text);
  const header = rows.find((r) => r[0] === "id");
  eq(header[header.length - 1], "Hrvatski (hr)", "the answer column");
  const data = rows.slice(rows.indexOf(header) + 1).filter((r) => r[0]);
  assert(data.every((r) => r[r.length - 1] === ""), "the answer column arrives filled");
  assert(data.some((r) => r[3] === "Služiti Crkvi"), "the current translation is not shown");
});

await check("what goes out comes back: commas, quotes and line breaks included", async () => {
  const lines = linesFor("site", EN, HR);
  const want = { "site:home.title": 'Služiti Crkvi, "zajedno"', "site:home.h2_bold": "iza\nkulisa." };
  const back = readFile(fill(fileFor(lines), (id) => want[id] || ""));
  eq(back.lang, "hr", "language");
  const got = Object.fromEntries(back.entries.filter((e) => e.value).map((e) => [e.id, e.value]));
  eq(got, { "site:home.title": 'Služiti Crkvi, "zajedno"', "site:home.h2_bold": "iza kulisa." }, "values");
});

await check("a file edited on the way still reads: rows dropped, a column added, a bare code", async () => {
  const text = [
    "id,English,My notes,Extra,hr",
    'site:home.title,Serve the Church,,x,"Služiti Crkvi"',
    "",
    "site:home.count,{n} churches,,,{n} crkava",
  ].join("\n");
  const back = readFile(text);
  eq(back.lang, "hr", "bare code accepted");
  eq(back.entries.map((e) => e.value), ["Služiti Crkvi", "{n} crkava"], "values from the last column");
});

await check("a file that is not a translation file says so", async () => {
  eq(readFile("name,email\nAna,a@x").error, "not-a-file", "no header");
  eq(readFile("id,English,Croatian please\nsite:a,b,c").error, "no-language", "no code");
});

await check("each half of a split heading carries the whole heading", async () => {
  const lines = linesFor("site", EN, HR);
  const by = Object.fromEntries(lines.map((l) => [l.key, l.english]));
  const note = noteFor(lines.find((l) => l.key === "home.h2_bold"), by);
  assert(note.includes('Part 2 of 2 of the heading "On-site, behind the scenes."'), note);
  assert(noteFor(lines.find((l) => l.key === "home.count"), by).includes("Keep {n}"), "placeholder note");
});

await check("the real site and email words would survive the file", async () => {
  /* The unwrap on the way back turns the file's soft wraps into spaces; a
     line's own breaks travel as <br> and come back as breaks. */
  const site = leafMap(JSON.parse(readFileSync(new URL("../../src/_data/i18n/en.json", import.meta.url))));
  const emails = leafMap(JSON.parse(readFileSync(new URL("../../src/_data/emailsAndForms.json", import.meta.url))));
  const withBreaks = Object.entries({ ...site, ...emails }).filter(([, v]) => typeof v === "string" && /\n/.test(v));
  for (const [k, v] of withBreaks) {
    eq(unwrapCell(wrapCell(v.replace(/\n/g, "<br>"))), v, "a line break survives the file: " + k);
  }
});

/* ----------------------------------------------------------------- checks */

const ck = (english, proposed, lang = "hr") => checkLine({ english, proposed, lang, notes: NOTES });
const codes = (r) => r.map((x) => x.code);

await check("a lost or invented placeholder cannot be approved", async () => {
  eq(codes(ck("{n} churches", "crkava").problems), ["placeholders"], "lost");
  eq(codes(ck("Hello", "Bok {name}").problems), ["placeholders"], "invented");
  eq(ck("{n} churches", "{n} crkava").problems, [], "kept");
});

await check("the approver is warned about what they may not be able to read", async () => {
  eq(codes(ck("Confirm <b>{list}</b>", "Potvrdite {list}").warnings), ["markup"], "tags dropped");
  eq(codes(ck("Thauma serves", "Tauma služi").warnings), ["kept"], "a kept word translated");
  eq(codes(ck("All of Me For All of Him", "Sve od mene za sve od Njega").warnings), ["fixed"], "fixed phrase ignored");
  eq(codes(ck("Welcome home", "Welcome home").warnings), ["same"], "left in English");
  eq(ck("Thauma serves", "Thauma služi").warnings, [], "a good line");
});

await check("Serbian in Latin letters is flagged; Cyrillic with a kept Latin name is not", async () => {
  eq(codes(ck("Serve the Church", "Služiti Crkvi", "sr").warnings), ["script"], "Latin Serbian");
  eq(ck("Thauma serves", "Thauma служи", "sr").warnings, [], "Cyrillic with Thauma");
  eq(ck("Serve", "Služiti", "hr").warnings, [], "Croatian is Latin");
});

/* ------------------------------------------------------------------ write */

await check("an approved line can go where English has a place for it, and nowhere else", async () => {
  const doc = {};
  assert(setLine(doc, EN, "values.items.1.title", "Zanat"), "refused a real line");
  assert(Array.isArray(doc.values.items), "an array became an object");
  eq(doc.values.items, [{ title: "" }, { title: "Zanat" }], "a hole left in the list — the build would fail on it");
  assert(!setLine(doc, EN, "home.nonsense", "x"), "invented a line");
  assert(!setLine(doc, EN, "values.items", "x"), "overwrote a section");
});

/* =============================================================== endpoint */

const handler = (await import("../src/admin-translate.js")).default;
const { verifyAccessJwt } = await import("../src/lib/access.js");

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
const b64u = (x) => Buffer.from(x).toString("base64url");
const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
const claims = b64u(JSON.stringify({ email: "a@thauma.one", aud: ["aud"], iss: "https://t.example",
  exp: Math.floor(Date.now() / 1000) + 600 }));
const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${claims}`)));
const TOKEN = `${head}.${claims}.${sig}`;

const EMAILS = { en: { form: { name: "Your name", body: "Confirm <b>{list}</b>" } },
                 hr: { form: { name: "Vaše ime", body: "" } } };

/** A repository in memory, served the way the Contents API serves it. */
function repo(files) {
  const store = Object.fromEntries(Object.entries(files).map(([p, v]) => [p, { text: JSON.stringify(v, null, 2) + "\n", sha: "s0" }]));
  const puts = [];
  const handle = async (u, init = {}) => {
    const m = u.match(/\/contents\/([^?]+)/);
    const path = m && decodeURI(m[1]);
    if ((init.method || "GET") === "GET") {
      const f = store[path];
      if (!f) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ type: "file", sha: f.sha, content: Buffer.from(f.text).toString("base64") }));
    }
    const body = JSON.parse(init.body);
    puts.push({ path, message: body.message, sha: body.sha, doc: JSON.parse(Buffer.from(body.content, "base64").toString()) });
    store[path] = { text: Buffer.from(body.content, "base64").toString(), sha: "s" + puts.length };
    return new Response(JSON.stringify({ content: { sha: "s" + puts.length }, commit: { sha: "c" + puts.length } }));
  };
  return { puts, handle, store };
}

function world({ roles = "admin", state = [], files } = {}) {
  const r = repo(files || {
    "src/_data/site.json": { languages: ["en", "hr", "sr"] },
    "src/_data/i18n/en.json": EN, "src/_data/i18n/hr.json": HR, "src/_data/i18n/sr.json": { code: "sr" },
    "src/_data/emailsAndForms.json": EMAILS,
  });
  const sql = [];
  const env = {
    ACCESS_TEAM_DOMAIN: "t.example", ACCESS_AUD: "aud",
    GITHUB_TOKEN: "t", GITHUB_REPO: "thauma-one/thauma-site", CONTENT_BRANCH: "main",
    DB: { prepare(text) {
      const run = async (args) => {
        const q = text.replace(/\s+/g, " ").trim();
        sql.push({ q, args });
        if (/FROM users/i.test(q)) return { results: [{ user_id: "u_1", email: "a@thauma.one", user_name: "Chase", roles }] };
        if (/FROM translation_state/i.test(q)) return { results: state };
        if (/FROM translation_keep/i.test(q)) return { results: NOTES.keep };
        if (/FROM translation_glossary/i.test(q)) return { results: NOTES.glossary };
        if (/FROM translation_guides/i.test(q)) return { results: [] };
        return { results: [] };
      };
      return { bind(...args) { return { all: () => run(args) }; }, all: () => run([]) };
    } },
  };
  globalThis.fetch = async (u, init) => {
    u = String(u);
    if (u.includes("/cdn-cgi/access/certs")) return new Response(JSON.stringify({ keys: [jwk] }));
    return r.handle(u, init);
  };
  return { env, repo: r, sql };
}
{ const w = world(); assert(await verifyAccessJwt(TOKEN, { teamDomain: "t.example", aud: "aud" }), "test token rejected"); void w; }

const call = (env, method, payload, query = "") => handler.fetch(
  new Request("https://thauma.one/api/admin/translate" + query, {
    method, headers: { "cf-access-jwt-assertion": TOKEN, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  }), env);

await check("only the people who edit the site's words may translate them", async () => {
  const w = world({ roles: "staff,partner" });
  const res = await call(w.env, "GET", null, "?lang=hr");
  eq(res.status, 403, "status");
  eq(w.repo.puts.length, 0, "wrote anyway");
  eq((await call(world({ roles: "communications" }).env, "GET", null, "?lang=hr")).status, 200, "communications");
});

await check("a language's lines come with their status, from both sources", async () => {
  const w = world();
  const j = await (await call(w.env, "GET", null, "?lang=hr")).json();
  const by = Object.fromEntries(j.lines.map((l) => [l.id, l.status]));
  eq(by["site:home.h2_bold"], "missing", "blank site line");
  eq(by["emails:form.body"], "missing", "blank email line");
  eq(by["emails:form.name"], "done", "translated email line");
  eq(j.name, "Hrvatski", "the language's own name");
  assert(w.sql.some((s) => /INSERT OR IGNORE INTO translation_state/.test(s.q)), "first sight not recorded");
});

await check("English can be read and edited, but never sent out to translate", async () => {
  const j = await (await call(world().env, "GET", null, "?lang=en")).json();
  assert(j.lines.every((l) => l.english === l.current && l.status === "done"), "English is not its own source");
  eq((await call(world().env, "POST", { action: "file", lang: "en" })).status, 400, "an English translation file");
  eq((await call(world().env, "GET", null, "?lang=de")).status, 400, "a language the site lacks");
});

await check("the emails' group waits for its file to reach the content branch", async () => {
  const w = world({ files: { "src/_data/site.json": { languages: ["en", "hr"] },
    "src/_data/i18n/en.json": EN, "src/_data/i18n/hr.json": HR } });
  const j = await (await call(w.env, "GET", null, "?lang=hr")).json();
  eq(j.unavailable, ["emails"], "unavailable");
  assert(j.lines.length && j.lines.every((l) => l.source === "site"), "site lines missing");
});

await check("the file holds what is missing or outdated unless lines are chosen", async () => {
  const w = world();
  const j = await (await call(w.env, "POST", { action: "file", lang: "hr" })).json();
  const ids = readFile(j.text).entries.map((e) => e.id);
  assert(ids.includes("site:home.h2_bold") && ids.includes("emails:form.body"), `missing lines absent: ${ids}`);
  assert(!ids.includes("site:home.title"), "a finished line was included");
  const chosen = await (await call(w.env, "POST", { action: "file", lang: "hr", ids: ["site:home.title"] })).json();
  eq(readFile(chosen.text).entries.map((e) => e.id), ["site:home.title"], "the chosen line");
  assert(/^thauma-hr-\d{4}-\d\d-\d\d\.csv$/.test(j.filename), j.filename);
  eq(w.repo.puts.length, 0, "downloading wrote something");
});

async function reviewed(w, answers) {
  const file = await (await call(w.env, "POST", { action: "file", lang: "hr",
    ids: Object.keys(answers) })).json();
  const text = fill(file.text, (id) => answers[id] ?? "");
  return (await call(w.env, "POST", { action: "review", text })).json();
}

await check("a returned file is checked line by line and nothing is saved", async () => {
  const w = world();
  const j = await reviewed(w, {
    "site:home.h2_bold": "iza kulisa.",
    "emails:form.body": "Potvrdite {list}",
    "site:home.count": "",
    "site:home.title": "Služiti Crkvi",
  });
  eq(j.lang, "hr", "language read from the file");
  const by = Object.fromEntries(j.items.map((i) => [i.id, i]));
  eq(Object.keys(by).sort(), ["emails:form.body", "site:home.h2_bold"], "lines to approve");
  eq(codes(by["emails:form.body"].warnings), ["markup"], "tags dropped");
  eq(j.skipped, { unknown: 0, blank: 1, unchanged: 1 }, "skipped");
  eq(w.repo.puts.length, 0, "reviewing wrote something");
});

await check("approving saves one quiet commit per file and records the English it matched", async () => {
  const w = world();
  const j = await reviewed(w, { "site:home.h2_bold": "iza kulisa.", "emails:form.body": "Potvrdite <b>{list}</b>" });
  const res = await call(w.env, "POST", { action: "apply", lang: "hr",
    items: j.items.map((i) => ({ id: i.id, value: i.proposed, was: i.current, english_hash: i.english_hash })) });
  eq(res.status, 200, "status");
  eq(w.repo.puts.map((p) => p.path).sort(), ["src/_data/emailsAndForms.json", "src/_data/i18n/hr.json"], "commits");
  const site = w.repo.puts.find((p) => p.path.endsWith("hr.json"));
  eq(site.doc.home.h2_bold, "iza kulisa.", "the line");
  eq(site.doc.home.title, "Služiti Crkvi", "a line nobody touched");
  assert(site.message.includes("[skip ci]"), "not quiet — it would deploy");
  assert(site.message.includes("Hrvatski (hr): 1 translation approved"), site.message);
  eq(w.repo.puts.find((p) => p.path.endsWith("emailsAndForms.json")).doc.hr.form.body, "Potvrdite <b>{list}</b>", "email line");
  const confirms = w.sql.filter((s) => /INSERT INTO translation_state/.test(s.q) && !/OR IGNORE/.test(s.q));
  eq(confirms.length, 2, "state recorded per file");
});

await check("a broken placeholder is refused and nothing at all is saved", async () => {
  const w = world();
  const res = await call(w.env, "POST", { action: "apply", lang: "hr", items: [
    { id: "site:home.h2_bold", value: "iza kulisa." },
    { id: "site:home.count", value: "crkava" },
  ] });
  eq(res.status, 400, "status");
  eq((await res.json()).ids, ["site:home.count"], "the broken line named");
  eq(w.repo.puts.length, 0, "a partial save happened");
});

await check("a line changed by somebody else since the review is left alone", async () => {
  const w = world();
  const res = await (await call(w.env, "POST", { action: "apply", lang: "hr", items: [
    { id: "site:home.title", value: "Služimo Crkvi", was: "Something older" },
    { id: "site:home.h2_bold", value: "iza kulisa.", was: "" },
  ] })).json();
  eq(res.conflicts, ["site:home.title"], "conflict reported");
  eq(w.repo.puts[0].doc.home.title, "Služiti Crkvi", "theirs was overwritten");
});

await check("a new language's first email line gets a place of its own", async () => {
  const w = world();
  const res = await call(w.env, "POST", { action: "apply", lang: "sr", items: [
    { id: "emails:form.name", value: "Ваше име" } ] });
  eq(res.status, 200, "status");
  eq(w.repo.puts[0].doc.sr, { form: { name: "Ваше име" } }, "the Serbian section");
});

await check("every language's progress comes in one answer", async () => {
  const j = await (await call(world().env, "GET", null, "?summary")).json();
  const by = Object.fromEntries(j.languages.map((l) => [l.code, l]));
  eq(Object.keys(by), ["en", "hr", "sr"], "languages, in the site's order");
  eq([by.en.missing, by.en.outdated], [0, 0], "English is never behind");
  assert(by.hr.missing === 3 && by.hr.total === by.en.total, `Croatian: ${JSON.stringify(by.hr)}`);
  assert(by.sr.missing === by.sr.total, "an empty language is all missing");
});

/* ---------------------------------------------------- the Content page */

await check("the page's own edits save as edits, and a translation can be cleared", async () => {
  const w = world();
  const res = await call(w.env, "POST", { action: "save", lang: "hr", items: [
    { id: "site:home.title", value: "Služimo Crkvi", was: "Služiti Crkvi" },
    { id: "site:home.count", value: "", was: "{n} crkava" },
  ] });
  eq(res.status, 200, "status");
  const put = w.repo.puts[0];
  eq([put.doc.home.title, put.doc.home.count], ["Služimo Crkvi", ""], "the lines");
  assert(put.message.includes("Hrvatski (hr): 2 lines edited"), put.message);
  const confirm = w.sql.find((s) => /INSERT INTO translation_state/.test(s.q) && !/OR IGNORE/.test(s.q));
  const rows = JSON.parse(confirm.args.find((a) => typeof a === "string" && a.startsWith("[")));
  eq(rows.map((r) => r.key), ["home.title"], "a cleared line was recorded as translated");
});

await check("English is saved in place, and cannot lose a placeholder or be emptied", async () => {
  const w = world();
  const ok = await call(w.env, "POST", { action: "save", lang: "en", items: [
    { id: "site:home.title", value: "Serve the local Church", was: "Serve the Church" }] });
  eq(ok.status, 200, "status");
  eq(w.repo.puts[0].path, "src/_data/i18n/en.json", "the file");
  eq(w.repo.puts[0].doc.home.title, "Serve the local Church", "the line");
  assert(!w.sql.some((s) => /INSERT INTO translation_state/.test(s.q)), "English recorded as a translation");

  const w2 = world();
  const bad = await call(w2.env, "POST", { action: "save", lang: "en", items: [
    { id: "site:home.count", value: "Many churches" }, { id: "site:home.title", value: "" }] });
  eq(bad.status, 400, "status");
  eq((await bad.json()).ids.sort(), ["site:home.count", "site:home.title"], "refused lines");
  eq(w2.repo.puts.length, 0, "something was saved");
});

await check("a file's approval cannot clear a line", async () => {
  const w = world();
  const res = await call(w.env, "POST", { action: "apply", lang: "hr", items: [{ id: "site:home.title", value: "" }] });
  eq(res.status, 400, "status");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
