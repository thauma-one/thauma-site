#!/usr/bin/env node
/**
 * Tests for workers/src/admin-content.js
 *   node workers/test/admin-content.test.mjs
 *
 * This endpoint holds a token that can commit to the repository that deploys
 * the site. Every other handler's worst case is showing the wrong data to
 * somebody who was already signed in; this one's worst case is a commit.
 *
 * So the tests are about refusals, in rough order of how bad the thing being
 * refused would be:
 *
 *   · a non-admin reaching it at all
 *   · a request choosing its own file path
 *   · a save changing the SHAPE of the document rather than a value in it
 *   · a save landing on top of somebody else's edit
 */
import handler, { pathFor, setLeaf, leafPaths } from "../src/admin-content.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/* ------------------------------- harness ------------------------------- */

/** A file as it sits in the repository, with the formatting these files use. */
const EN = { code: "en", nav: { home: "Home", give: "Give" }, notFound: { taunts: ["a", "b"] } };
const SITE = { name: "Thauma", comingSoon: true, languages: ["en", "hr"],
               images: { home_who: { src: "/img/x.webp", zoom: 110 } },
               socials: { youtube: "" } };

const asText = (o) => JSON.stringify(o, null, 2);

/* ---- a real Access token -------------------------------------------------
   These tests have to get PAST the gate to test anything beyond it, so the
   token is genuinely signed and genuinely verified rather than stubbed. That
   also means the gate is exercised on every single request below. */
const TEAM = "thaumaone.cloudflareaccess.com";
const AUD = "test-aud-tag";

const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]
);
const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
jwk.kid = "test-kid-1";
jwk.alg = "RS256";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function mint(email = "admin@thauma.one") {
  const h = enc({ alg: "RS256", kid: "test-kid-1", typ: "JWT" });
  const p = enc({ iss: `https://${TEAM}`, aud: AUD, email, sub: "u-1",
                  exp: Math.floor(Date.now() / 1000) + 600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey,
    new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}
const TOKEN = await mint();

function envWith(roles, { token = "t" } = {}) {
  return {
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    GITHUB_TOKEN: token,
    GITHUB_REPO: "thauma-one/thauma-site",
    CONTENT_BRANCH: "main",
    DB: {
      prepare() {
        return { bind() { return { async all() {
          return { results: roles === null ? [] : [{ id: "u_1", name: "Chase Roush", roles }] };
        } }; } };
      },
    },
  };
}

/**
 * One global fetch, serving the JWKS always and GitHub per-test.
 *
 * `seen` records ONLY the GitHub calls, so "it never touched GitHub" is a
 * assertion about this endpoint rather than about Access fetching its keys.
 */
let github = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/cdn-cgi/access/certs")) {
    return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
  }
  if (!github) throw new Error("unexpected fetch, no GitHub stub active: " + u);
  return github.handle(u, init);
};

function stubGitHub({ file = EN, sha = "sha1", putStatus = 200, putBody } = {}) {
  const seen = [];
  seen.handle = async (u, init) => {
    seen.push({ url: u, method: init.method || "GET",
                body: init.body ? JSON.parse(init.body) : null });
    if ((init.method || "GET") === "GET") {
      const bytes = new TextEncoder().encode(asText(file));
      let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
      return new Response(JSON.stringify({ type: "file", sha, content: btoa(bin) }), { status: 200 });
    }
    return new Response(JSON.stringify(putBody || {
      content: { sha: "sha2" }, commit: { sha: "c1", html_url: "https://gh/c1" },
    }), { status: putStatus });
  };
  seen.restore = () => { github = null; };
  github = seen;
  return seen;
}

/** A request carrying a genuinely signed Access token. */
const req = (method, { query = "", body } = {}) =>
  new Request(`https://x/api/admin/content${query}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Cf-Access-Jwt-Assertion": TOKEN,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

console.log("admin-content — the endpoint that can commit\n");

/* ----------------------------- pure helpers ---------------------------- */

await check("pathFor accepts only a language code or `site`", () => {
  eq(pathFor("site"), "src/_data/site.json", "site");
  eq(pathFor("en"), "src/_data/i18n/en.json", "en");
  eq(pathFor("sr"), "src/_data/i18n/sr.json", "sr");
  eq(pathFor("pt-br"), "src/_data/i18n/pt-br.json", "a regional code still works");
});

await check("pathFor refuses everything that is not one", () => {
  // The client sends a KEY, never a path. These are the strings somebody would
  // try if they found the endpoint; none of them resolves to a file.
  for (const bad of ["../../.github/workflows/deploy.yml", "src/_data/site.json",
                     "en.json", "en/../../x", "", null, undefined, "EN",
                     "package.json", "../en", "en.json.bak", "e", "english"]) {
    eq(pathFor(bad), null, `${JSON.stringify(bad)} must not resolve`);
  }
});

await check("leafPaths flattens objects and arrays alike", () => {
  const l = leafPaths(EN);
  eq(l["nav.home"], "Home", "object leaf");
  eq(l["notFound.taunts.1"], "b", "array leaf");
  eq(Object.keys(l).length, 5, "leaf count");
});

await check("setLeaf writes a value that already exists", () => {
  const doc = JSON.parse(asText(EN));
  eq(setLeaf(doc, "nav.home", "Početna"), null, "no complaint");
  eq(doc.nav.home, "Početna", "written");
});

await check("setLeaf REFUSES a path that is not already in the file", () => {
  // This is what stops the endpoint adding keys. A key the build does not know
  // about is dead weight; a key it does know about being renamed is a broken
  // page. Both are git operations.
  const doc = JSON.parse(asText(EN));
  assert(setLeaf(doc, "nav.newThing", "x"), "invented a key");
  assert(setLeaf(doc, "totally.made.up", "x"), "invented a section");
  assert(setLeaf(doc, "notFound.taunts.9", "x"), "invented an array index");
  eq(Object.keys(doc.nav), ["home", "give"], "nav must be untouched");
});

await check("setLeaf REFUSES to overwrite a section with a value", () => {
  const doc = JSON.parse(asText(EN));
  assert(setLeaf(doc, "nav", "oops"), "flattened a whole section");
  eq(doc.nav.home, "Home", "section survived");
});

await check("setLeaf REFUSES a change of type, and says which type", () => {
  const doc = JSON.parse(asText(SITE));
  const p = setLeaf(doc, "comingSoon", "true");
  assert(p && /boolean/.test(p), `should name the type, said: ${p}`);
  eq(doc.comingSoon, true, "unchanged");
  assert(setLeaf(doc, "images.home_who.zoom", "110"), "accepted a string for a number");
});

await check("setLeaf accepts a boolean and a number of the right type", () => {
  const doc = JSON.parse(asText(SITE));
  eq(setLeaf(doc, "comingSoon", false), null, "boolean");
  eq(doc.comingSoon, false, "written");
  eq(setLeaf(doc, "images.home_who.zoom", 125), null, "number");
  eq(doc.images.home_who.zoom, 125, "written");
});

await check("setLeaf caps the length of one value", () => {
  const doc = JSON.parse(asText(EN));
  assert(setLeaf(doc, "nav.home", "x".repeat(5001)), "accepted a 5001-character value");
});

await check("setLeaf cannot be walked through the prototype", () => {
  const doc = JSON.parse(asText(EN));
  assert(setLeaf(doc, "__proto__.polluted", "x"), "walked into the prototype");
  assert(setLeaf(doc, "constructor.prototype.polluted", "x"), "walked into the constructor");
  eq({}.polluted, undefined, "the prototype was polluted");
});

/* -------------------------------- the gate ----------------------------- */

await check("no Access token is refused", async () => {
  const res = await handler.fetch(new Request("https://x/api/admin/content"), envWith("admin"));
  eq(res.status, 401, "status");
});

await check("a signed-in NON-admin is refused", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("GET", { query: "?file=en" }), envWith("partner,staff"));
    eq(res.status, 403, "status");
    eq(g.length, 0, "it talked to GitHub before checking the role");
  } finally { g.restore(); }
});

await check("an address with no account is refused", async () => {
  const res = await handler.fetch(req("GET", { query: "?file=en" }), envWith(null));
  eq(res.status, 403, "status");
});

await check("a misconfigured deploy FAILS CLOSED", async () => {
  const res = await handler.fetch(req("GET", { query: "?file=en" }), { DB: {} });
  eq(res.status, 500, "status");
});

await check("no handler method throws", async () => {
  // The failure this project shipped twice: a ReferenceError past the auth
  // check becomes an HTML 500 that the page reports as a network error.
  const g = stubGitHub();
  try {
    for (const m of ["GET", "PUT", "POST", "DELETE", "PATCH"]) {
      const res = await handler.fetch(req(m, { query: "?file=en", body: m === "GET" ? undefined : {} }),
                                      envWith("admin"));
      assert(res && typeof res.status === "number", `${m} returned no Response`);
      await res.json().catch(() => ({}));
    }
  } finally { g.restore(); }
});

await check("a missing credential explains itself instead of 500ing blankly", async () => {
  // "Not configured" and "configured wrongly" are different afternoons, and a
  // content editor that returns a bare 500 sends somebody to the database.
  const res = await handler.fetch(req("GET", { query: "?file=en" }), envWith("admin", { token: "" }));
  const b = await res.json();
  eq(b.configured, false, "configured");
  assert(/GITHUB_APP_ID/.test(b.error), "names the App variables");
  assert(/RUNBOOK/.test(b.error), "points at the instructions");
});

/* --------------------------------- read -------------------------------- */

await check("GET returns the document and its SHA", async () => {
  const g = stubGitHub({ sha: "abc" });
  try {
    const res = await handler.fetch(req("GET", { query: "?file=en" }), envWith("admin"));
    const b = await res.json();
    eq(res.status, 200, "status");
    eq(b.sha, "abc", "sha");
    eq(b.data.nav.home, "Home", "data");
    eq(b.path, "src/_data/i18n/en.json", "path");
    assert(g[0].url.includes("ref=main"), "read the configured branch");
  } finally { g.restore(); }
});

await check("GET refuses a file key it does not recognise", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("GET", { query: "?file=../package.json" }), envWith("admin"));
    eq(res.status, 400, "status");
    eq(g.length, 0, "it fetched something anyway");
  } finally { g.restore(); }
});

/* -------------------------------- write -------------------------------- */

await check("PUT commits one changed value and nothing else", async () => {
  const g = stubGitHub({ sha: "sha1" });
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "Početna" },
    } }), envWith("admin"));
    const b = await res.json();
    eq(res.status, 200, "status");
    eq(b.commit, "c1", "commit");

    const put = g.find((r) => r.method === "PUT");
    assert(put, "never wrote");
    eq(put.body.sha, "sha1", "wrote against the SHA it read");
    eq(put.body.branch, "main", "wrote to the configured branch");

    const written = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
    eq(written.nav.home, "Početna", "the edit");
    eq(written.nav.give, "Give", "the untouched sibling survived");
    eq(written.code, "en", "the rest of the document survived");
  } finally { g.restore(); }
});

await check("SAVING DOES NOT DEPLOY", async () => {
  /* The promise the word "Save" makes. Without the marker every keystroke
     batch would rebuild and republish the public site, which is the behaviour
     this whole design exists to avoid. */
  const g = stubGitHub();
  try {
    await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "Po\u010detna" },
    } }), envWith("admin"));
    const put = g.find((r) => r.method === "PUT");
    assert(/\[skip ci\]/.test(put.body.message.split("\n")[0]),
           `save must be quiet, subject was: ${put.body.message.split("\n")[0]}`);
  } finally { g.restore(); }
});

await check("the commit is attributed to the person, not the Worker", async () => {
  const g = stubGitHub();
  try {
    await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "Početna" },
    } }), envWith("admin"));
    const put = g.find((r) => r.method === "PUT");
    eq(put.body.author.name, "Chase Roush", "author name comes from users.name");
    assert(/nav\.home/.test(put.body.message), "the message should list what changed");
  } finally { g.restore(); }
});

await check("the written file keeps its exact formatting", async () => {
  // A save that reformats the file produces a 200-line diff for a one-word
  // change, which makes `git log` useless for reviewing content edits.
  const g = stubGitHub();
  try {
    await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "Početna" },
    } }), envWith("admin"));
    const put = g.find((r) => r.method === "PUT");
    const text = Buffer.from(put.body.content, "base64").toString("utf8");
    const expected = JSON.parse(asText(EN));
    expected.nav.home = "Početna";
    eq(text, JSON.stringify(expected, null, 2), "byte-for-byte");
  } finally { g.restore(); }
});

await check("Croatian and Cyrillic survive the commit", async () => {
  const g = stubGitHub();
  try {
    await handler.fetch(req("PUT", { body: {
      file: "sr", sha: "sha1", changes: { "nav.home": "Почетна страница — žčć" },
    } }), envWith("admin"));
    const put = g.find((r) => r.method === "PUT");
    const text = Buffer.from(put.body.content, "base64").toString("utf8");
    eq(JSON.parse(text).nav.home, "Почетна страница — žčć", "round trip through the endpoint");
  } finally { g.restore(); }
});

await check("a stale SHA is refused BEFORE anything is written", async () => {
  const g = stubGitHub({ sha: "current" });
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "what-the-browser-had", changes: { "nav.home": "x" },
    } }), envWith("admin"));
    eq(res.status, 409, "status");
    assert(!g.some((r) => r.method === "PUT"), "it wrote anyway");
    const b = await res.json();
    assert(/nothing was written/i.test(b.error), "must say the write did not happen");
  } finally { g.restore(); }
});

await check("a change to an unknown path is refused and nothing is committed", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "ok", "nav.invented": "no" },
    } }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((r) => r.method === "PUT"), "a partial save was committed");
  } finally { g.restore(); }
});

await check("site.json's language list cannot be edited here", async () => {
  const g = stubGitHub({ file: SITE });
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "site", sha: "sha1", changes: { "languages.0": "de" },
    } }), envWith("admin"));
    eq(res.status, 400, "status");
    assert(!g.some((r) => r.method === "PUT"), "it wrote anyway");
  } finally { g.restore(); }
});

await check("comingSoon — the launch switch — can be flipped", async () => {
  const g = stubGitHub({ file: SITE });
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "site", sha: "sha1", changes: { comingSoon: false },
    } }), envWith("admin"));
    eq(res.status, 200, "status");
    const put = g.find((r) => r.method === "PUT");
    const written = JSON.parse(Buffer.from(put.body.content, "base64").toString("utf8"));
    eq(written.comingSoon, false, "flipped");
    eq(written.languages, ["en", "hr"], "the frozen list is untouched");
  } finally { g.restore(); }
});

await check("saving a value that is already set makes no commit", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("PUT", { body: {
      file: "hr", sha: "sha1", changes: { "nav.home": "Home" },
    } }), envWith("admin"));
    const b = await res.json();
    eq(b.unchanged, true, "should say so");
    assert(!g.some((r) => r.method === "PUT"), "made an empty commit");
  } finally { g.restore(); }
});

await check("an empty change set is refused", async () => {
  const g = stubGitHub();
  try {
    const res = await handler.fetch(req("PUT", { body: { file: "hr", sha: "sha1", changes: {} } }),
                                    envWith("admin"));
    eq(res.status, 400, "status");
  } finally { g.restore(); }
});

/* ------------------------- against the real files ------------------------
   Everything above uses a fixture. These use the files this endpoint will
   actually be pointed at, because the failure that matters is not "the logic
   is wrong" — it is "the logic is right and the real file still comes back
   different". */

const REAL = new URL("../../src/_data/", import.meta.url);
const readReal = async (name) =>
  (await import("node:fs/promises")).readFile(new URL(name, REAL), "utf8");

await check("editing a real language file rewrites ONLY the edited line", async () => {
  for (const name of ["i18n/en.json", "i18n/hr.json", "i18n/sr.json", "site.json"]) {
    const raw = await readReal(name);
    const doc = JSON.parse(raw);

    // Pick a real string leaf from the real file rather than inventing one.
    const target = Object.entries(leafPaths(doc))
      .find(([, v]) => typeof v === "string" && v.length > 3)[0];
    assert(!setLeaf(doc, target, "EDITED"), `${name}: could not set ${target}`);

    const trailing = raw.endsWith("\n") ? "\n" : "";
    const out = JSON.stringify(doc, null, 2) + trailing;

    const before = raw.split("\n");
    const after = out.split("\n");
    eq(after.length, before.length, `${name}: line count changed`);
    const changed = before.filter((l, i) => l !== after[i]);
    eq(changed.length, 1, `${name}: ${changed.length} lines differ, expected 1`);
  }
});

await check("a real file survives a no-op save byte for byte", async () => {
  // Reformatting on save would turn every content commit into a whole-file
  // diff, which makes reviewing what somebody actually changed impossible.
  for (const name of ["i18n/en.json", "i18n/hr.json", "i18n/sr.json", "site.json"]) {
    const raw = await readReal(name);
    const trailing = raw.endsWith("\n") ? "\n" : "";
    eq(JSON.stringify(JSON.parse(raw), null, 2) + trailing, raw, `${name} would be reformatted`);
  }
});

await check("the language files hold identical key sets", async () => {
  /* The editor shows one language beside another, matching them up by path.
     If the files ever diverge, a reference column silently shows nothing for
     the paths the other file does not have — and a translator would read that
     as "there is no English for this", which is not what it means. */
  const sets = {};
  for (const code of ["en", "hr", "sr"]) {
    sets[code] = Object.keys(leafPaths(JSON.parse(await readReal(`i18n/${code}.json`))));
  }
  for (const code of ["hr", "sr"]) {
    const missing = sets.en.filter((p) => !sets[code].includes(p));
    const extra = sets[code].filter((p) => !sets.en.includes(p));
    eq(missing, [], `${code}.json is missing paths that en.json has`);
    eq(extra, [], `${code}.json has paths en.json does not`);
  }
});

await check("every leaf in the language files is a string", async () => {
  // The editor renders a textarea for each one. A number or a boolean would
  // come back from that textarea as a string and be refused by setLeaf — a
  // field that cannot be saved, discovered by the person trying to save it.
  for (const code of ["en", "hr", "sr"]) {
    const bad = Object.entries(leafPaths(JSON.parse(await readReal(`i18n/${code}.json`))))
      .filter(([, v]) => typeof v !== "string")
      .map(([p, v]) => `${p} is ${v === null ? "null" : typeof v}`);
    eq(bad, [], `${code}.json has non-string leaves`);
  }
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
