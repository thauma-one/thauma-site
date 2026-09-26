#!/usr/bin/env node
/**
 * The notes every translator reads, and who may change them
 *   node workers/test/translation-notes.test.mjs
 *
 * The SQL itself (case-insensitive words, a repeated phrase correcting the
 * old one, notes outliving their author) is tested against real rows in
 * db/test_schema.py. This covers the endpoint around it and the brief built
 * from it — the one piece of text every route to a translation shares.
 */
import { briefFor, cleanLang, cleanText } from "../src/lib/translation-notes.js";
import { verifyAccessJwt } from "../src/lib/access.js";

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b),
  `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("translation notes\n");

const NOTES = {
  keep: [{ id: "tk_1", term: "Thauma" }, { id: "tk_2", term: "501(c)3" }],
  glossary: [
    { id: "tg_1", lang: "hr", source: "All of Me For All of Him", target: "Sve od mene Darujem Njega" },
    { id: "tg_2", lang: "sr", source: "All of Me For All of Him", target: "Све од мене" },
  ],
  guides: { "*": "Warm, plain, direct.", hr: "Standard Croatian, Latin script." },
};

/* ------------------------------------------------------------- the brief -- */

await check("the brief names the language the way it names itself", async () => {
  const b = briefFor(NOTES, "hr", "Hrvatski");
  assert(b.startsWith("Translate from English into Hrvatski (hr)."), b.split("\n")[0]);
});

await check("the brief carries every kind of note that applies", async () => {
  const b = briefFor(NOTES, "hr", "Hrvatski");
  assert(b.includes("Warm, plain, direct."), "the guide for every language");
  assert(b.includes("Hrvatski: Standard Croatian, Latin script."), "the language's own guide");
  assert(b.includes('"Thauma", "501(c)3"'), "the never-translate list");
  assert(b.includes('"All of Me For All of Him" → "Sve od mene Darujem Njega"'), "the fixed phrase");
});

await check("another language's phrases stay out of this language's brief", async () => {
  const b = briefFor(NOTES, "hr", "Hrvatski");
  assert(!b.includes("Све од мене"), "the Serbian rendering leaked into the Croatian brief");
});

await check("an empty section is left out, not printed as a heading over nothing", async () => {
  const b = briefFor({ keep: [], glossary: [], guides: {} }, "sl", "Slovenščina");
  eq(b, "Translate from English into Slovenščina (sl).", "a brief with no notes");
});

/* ------------------------------------------------------------ validation -- */

await check("language codes are checked for shape", async () => {
  eq(cleanLang("HR"), "hr", "case");
  eq(cleanLang("pt-br"), "pt-br", "a regional code");
  eq(cleanLang("sr-cyrl-rs"), "sr-cyrl-rs", "script and region");
  eq(cleanLang("*"), null, "'*' only where a guide is being set");
  eq(cleanLang("*", { allowAll: true }), "*", "the every-language guide");
  eq(cleanLang("croatian"), null, "a name is not a code");
  eq(cleanLang("<b>"), null, "markup");
});

await check("text is trimmed and bounded", async () => {
  eq(cleanText("  Thauma  ", 80), "Thauma", "trimmed");
  eq(cleanText("   ", 80), null, "blank");
  eq(cleanText("x".repeat(81), 80), null, "too long");
});

/* ------------------------------------------------------------- endpoint -- */

/* The Access check is real; the token is not. Swap in a verifier that
   accepts one fixed email so the endpoint runs its own role logic. */
const handler = (await import("../src/admin-translation-notes.js")).default;

function envAs(roles) {
  const calls = [];
  const env = {
    calls, ACCESS_TEAM_DOMAIN: "t.example", ACCESS_AUD: "aud",
    DB: { prepare(sql) {
      const run = async () => {
        calls.push(sql.replace(/\s+/g, " ").trim());
        if (/FROM users/i.test(sql)) return { results: [{ user_id: "u_1", email: "a@thauma.one", roles }] };
        if (/FROM translation_keep/i.test(sql)) return { results: NOTES.keep };
        if (/FROM translation_glossary/i.test(sql)) return { results: NOTES.glossary };
        if (/FROM translation_guides/i.test(sql)) {
          return { results: Object.entries(NOTES.guides).map(([lang, guidance]) => ({ lang, guidance })) };
        }
        return { results: [] };
      };
      return { bind() { return { all: run, run, first: async () => (await run()).results[0] }; },
               all: run, run };
    } },
  };
  return env;
}

/* A signed token the real verifier accepts: a key made here, served as the
   team's certificate through a stubbed fetch. */
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
const b64u = (x) => Buffer.from(x).toString("base64url");
const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
const body = b64u(JSON.stringify({ email: "a@thauma.one", aud: ["aud"], iss: "https://t.example",
  exp: Math.floor(Date.now() / 1000) + 600 }));
const sig = b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${body}`)));
const TOKEN = `${head}.${body}.${sig}`;
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }));
assert(await verifyAccessJwt(TOKEN, { teamDomain: "t.example", aud: "aud" }), "test token rejected");

const call = (env, method, payload, query = "") => handler.fetch(
  new Request("https://thauma.one/api/admin/translation-notes" + query, {
    method, headers: { "cf-access-jwt-assertion": TOKEN, "Content-Type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  }), env);

await check("anyone signed in can read the notes, and is told whether they may change them", async () => {
  const res = await call(envAs("staff"), "GET");
  eq(res.status, 200, "status");
  const j = await res.json();
  eq(j.keep.length, 2, "the words");
  eq(j.guides.hr, NOTES.guides.hr, "a guide");
  eq(j.can_write, false, "staff cannot change them");
});

await check("only administrators and communications change them", async () => {
  const env = envAs("staff,partner");
  const res = await call(env, "POST", { kind: "keep", term: "Kuća molitve" });
  eq(res.status, 403, "staff refused");
  assert(!env.calls.some((c) => /INSERT INTO translation_keep/.test(c)), "the write went through anyway");
  for (const roles of ["admin", "communications"]) {
    const ok = await call(envAs(roles), "POST", { kind: "keep", term: "Kuća molitve" });
    eq(ok.status, 200, `${roles} allowed`);
  }
});

await check("every change is recorded in the activity log", async () => {
  const env = envAs("admin");
  await call(env, "POST", { kind: "glossary", lang: "hr", source: "Serve", target: "Služiti" });
  assert(env.calls.some((c) => /INSERT INTO translation_glossary/.test(c)), "not written");
  assert(env.calls.some((c) => /INSERT INTO audit_log/.test(c)), "not audited");
});

await check("bad input is refused before it reaches the database", async () => {
  const env = envAs("admin");
  const cases = [
    { kind: "keep", term: "" },
    { kind: "glossary", lang: "en", source: "a", target: "b" },
    { kind: "glossary", lang: "hr", source: "a", target: "" },
    { kind: "guide", lang: "Croatian", guidance: "x" },
    { kind: "guide", lang: "hr", guidance: "x".repeat(2001) },
    { kind: "nonsense" },
  ];
  for (const c of cases) {
    const res = await call(env, "POST", c);
    eq(res.status, 400, `refused: ${JSON.stringify(c).slice(0, 60)}`);
  }
  assert(!env.calls.some((c) => /INSERT INTO translation_/.test(c)), "something was written");
});

await check("a guide for every language is its own entry", async () => {
  const env = envAs("communications");
  const res = await call(env, "POST", { kind: "guide", lang: "*", guidance: "Warm." });
  eq(res.status, 200, "the '*' guide");
});

await check("a note is removed by its id", async () => {
  const env = envAs("admin");
  const res = await call(env, "DELETE", null, "?kind=glossary&id=tg_1");
  eq(res.status, 200, "status");
  assert(env.calls.some((c) => /DELETE FROM translation_glossary/.test(c)), "not deleted");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
