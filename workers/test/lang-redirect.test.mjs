#!/usr/bin/env node
/**
 * Tests for workers/src/lang-redirect.js
 *
 * Runs on plain Node — Request/Response/URL are global since Node 18, which
 * is the point of the port: the logic is Web-standard, so it is testable
 * without a Worker runtime.
 *
 *   node workers/test/lang-redirect.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chooseLang, savedLang, redirectFor, LANG_MAP, SUPPORTED, DEFAULT_LANG,
} from "../src/lang-redirect.js";

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const req = (cookie) =>
  new Request("https://thauma.one/", { headers: cookie ? { cookie } : {} });

console.log("lang-redirect — geo language routing\n");

// ---------------------------------------------------------------- geo ------
check("Croatia -> hr", () => eq(chooseLang({ country: "HR" }).lang, "hr", "HR"));
check("Bosnia  -> hr", () => eq(chooseLang({ country: "BA" }).lang, "hr", "BA"));
check("Serbia  -> sr", () => eq(chooseLang({ country: "RS" }).lang, "sr", "RS"));
check("US      -> en (default)", () => eq(chooseLang({ country: "US" }).lang, "en", "US"));

check("country code is case-insensitive", () => {
  eq(chooseLang({ country: "hr" }).lang, "hr", "lowercase hr");
});

check("missing/unknown country falls back to default", () => {
  for (const c of [undefined, null, "", "ZZ", "  "]) {
    eq(chooseLang({ country: c }).lang, DEFAULT_LANG, `country=${JSON.stringify(c)}`);
  }
});

// ------------------------------------------------------------- cookie ------
check("a saved choice beats geo — the important one", () => {
  // An English speaker living in Zagreb must not be forced into Croatian.
  eq(chooseLang({ cookie: "thauma_lang=en", country: "HR" }).lang, "en", "en cookie in HR");
  // ...and a Croatian speaker travelling keeps Croatian.
  eq(chooseLang({ cookie: "thauma_lang=hr", country: "US" }).lang, "hr", "hr cookie in US");
});

check("cookie is found among other cookies", () => {
  eq(savedLang("foo=1; thauma_lang=sr; bar=2"), "sr", "middle");
  eq(savedLang("thauma_lang=sr"), "sr", "only");
  eq(savedLang("bar=2; thauma_lang=sr"), "sr", "last");
});

check("an unsupported cookie value is ignored, not obeyed", () => {
  // Would otherwise redirect to /de/, which is never built -> 404 loop.
  eq(chooseLang({ cookie: "thauma_lang=de", country: "US" }).lang, "en", "de");
  eq(savedLang("thauma_lang=de"), null, "savedLang");
});

check("a lookalike cookie name does not match", () => {
  eq(savedLang("not_thauma_lang=hr"), null, "prefixed name matched");
  eq(savedLang("thauma_language=hr"), null, "longer name matched");
});

check("malformed cookie headers are survivable", () => {
  for (const c of [undefined, null, "", ";;;", "thauma_lang=", "thauma_lang=TOOLONG"]) {
    assert(savedLang(c) === null, `accepted ${JSON.stringify(c)}`);
  }
});

// ------------------------------------------------------------ response -----
check("redirect is 302 and points at the language root", () => {
  const res = redirectFor(req(), "HR");
  eq(res.status, 302, "status");
  eq(new URL(res.headers.get("location")).pathname, "/hr/", "location");
});

check("redirect is not cacheable across visitors", () => {
  const res = redirectFor(req(), "HR");
  // Without Vary/no-store a shared cache can serve one visitor's language
  // to the next one.
  assert((res.headers.get("vary") || "").toLowerCase().includes("cookie"), "missing Vary: Cookie");
  assert((res.headers.get("cache-control") || "").includes("no-store"), "missing no-store");
});

check("reason is reported for debugging", () => {
  eq(redirectFor(req("thauma_lang=sr"), "US").headers.get("x-lang-reason"), "cookie", "cookie");
  eq(redirectFor(req(), "HR").headers.get("x-lang-reason"), "geo", "geo");
  eq(redirectFor(req(), "US").headers.get("x-lang-reason"), "default", "default");
});

check("origin is preserved (dev host redirects within dev)", () => {
  const r = new Request("https://dev.thauma.one/", { headers: {} });
  const loc = new URL(redirectFor(r, "RS").headers.get("location"));
  eq(loc.host, "dev.thauma.one", "host");
  eq(loc.pathname, "/sr/", "path");
});

// -------------------------------------------------------------- config -----
check("every language in LANG_MAP is actually supported", () => {
  // Catches the documented failure mode: a code here that site.json does not
  // build, sending visitors to pages that do not exist.
  for (const lang of Object.keys(LANG_MAP)) {
    assert(SUPPORTED.includes(lang), `${lang} in LANG_MAP but not SUPPORTED`);
  }
  assert(SUPPORTED.includes(DEFAULT_LANG), "DEFAULT_LANG not in SUPPORTED");
});

/* THE COMMENT SAID "keep in sync with site.json" AND IT WAS NOT KEPT.
   Slovenian was added to the site and this list still named three languages,
   so /sl/ visitors were redirected out of their own language and the contact
   form fell back to English for them. A list that must match another list is
   not a thing to remember. */
check("SUPPORTED matches the languages the site actually builds", () => {
  const site = JSON.parse(readFileSync(
    fileURLToPath(new URL("../../src/_data/site.json", import.meta.url)), "utf8"));

  const onSite = [...(site.languages || [])].sort();
  const inCode = [...SUPPORTED].sort();

  const missing = onSite.filter((l) => !inCode.includes(l));
  const extra = inCode.filter((l) => !onSite.includes(l));

  assert(!missing.length,
    `the site builds ${missing.join(", ")} but SUPPORTED does not list ${missing.length > 1 ? "them" : "it"} — ` +
    `visitors in that language get redirected away from it`);
  assert(!extra.length,
    `SUPPORTED lists ${extra.join(", ")}, which the site does not build — ` +
    `a redirect there is a 404`);
});

check("no country is claimed by two languages", () => {
  const seen = new Map();
  for (const [lang, ccs] of Object.entries(LANG_MAP)) {
    for (const cc of ccs) {
      assert(!seen.has(cc), `${cc} claimed by both ${seen.get(cc)} and ${lang}`);
      seen.set(cc, lang);
    }
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
