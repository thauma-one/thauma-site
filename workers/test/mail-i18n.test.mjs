#!/usr/bin/env node
/**
 * The supporter-facing messages, in the reader's language
 *   node workers/test/mail-i18n.test.mjs
 *
 * The translations are a rough first pass and will be revised by somebody who
 * speaks these languages. What must NOT drift while that happens is the shape:
 * every key present everywhere, a fallback that degrades one key at a time,
 * and escaping that still holds when the surrounding words change.
 */
import { t, LANGS, _STRINGS } from "../src/lib/mail-i18n.js";
import { listConfirmEmail, contactReceiptEmail } from "../src/lib/mail.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("supporter messages, translated\n");

check("every language carries every key", () => {
  const en = Object.keys(_STRINGS.en);
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const missing = en.filter((k) => !(k in _STRINGS[lang]));
    eq(missing.length, 0, `${lang} is missing ${missing.join(", ")}`);
    const extra = Object.keys(_STRINGS[lang]).filter((k) => !en.includes(k));
    eq(extra.length, 0, `${lang} has keys English does not: ${extra.join(", ")}`);
  }
});

check("no translation lost its placeholders", () => {
  /* A key whose English says {list} and whose Croatian does not produces a
     sentence with the list name silently missing — which reads as finished
     and is not. */
  const en = _STRINGS.en;
  for (const lang of LANGS.filter((l) => l !== "en")) {
    for (const [key, value] of Object.entries(en)) {
      const want = (value.match(/\{[a-z]+\}/gi) || []).sort();
      const got = ((_STRINGS[lang][key] || "").match(/\{[a-z]+\}/gi) || []).sort();
      eq(got.join(","), want.join(","), `${lang} ${key} placeholders`);
    }
  }
});

check("an unknown language answers in English rather than nothing", () => {
  eq(t("de", "unsub.heading"), _STRINGS.en["unsub.heading"], "unknown language");
  eq(t(null, "unsub.heading"), _STRINGS.en["unsub.heading"], "no language");
  eq(t("", "unsub.heading"), _STRINGS.en["unsub.heading"], "empty language");
});

check("a MISSING key falls back one key at a time", () => {
  /* Half a translation should produce a mixed message, not a blank one. */
  eq(t("hr", "unsub.heading"), _STRINGS.hr["unsub.heading"], "a translated key");
  eq(t("hr", "receipt.subject"), _STRINGS.hr["receipt.subject"], "another");
  eq(t("hr", "not.a.real.key"), "not.a.real.key", "an unknown key names itself");
});

check("the subject line changes with the language", () => {
  const subjects = LANGS.map((lang) => listConfirmEmail({
    name: "Ana", listName: "Mission Updates", fromName: "Chase",
    confirmUrl: "https://x/confirm?t=a", origin: "https://x", lang,
  }).subject);
  eq(new Set(subjects).size, LANGS.length, `subjects were not all different: ${subjects}`);
  for (const s of subjects) assert(s.includes("Mission Updates"), `list name lost: ${s}`);
});

check("ESCAPING SURVIVES TRANSLATION", () => {
  /* The strings carry deliberate markup and the values do not. A translated
     sentence must not become a hole through which a list name injects. */
  for (const lang of LANGS) {
    const m = listConfirmEmail({
      name: "<b>x", listName: '<script>alert(1)</script>', fromName: '"><img>',
      confirmUrl: "https://x", origin: "https://x", lang,
    });
    assert(!/<script>alert/.test(m.html), `${lang}: a list name injected`);
    assert(!/<img>/.test(m.html), `${lang}: a sender name injected`);
    assert(/<b style/.test(m.html), `${lang}: the deliberate bold was lost`);
  }
});

check("the receipt names the ministry in every language", () => {
  for (const lang of LANGS) {
    const m = contactReceiptEmail({ name: "Ana", ministry: "Chase Roush", topic: null,
      subject: null, message: "Hi", origin: "https://x", lang });
    assert(m.html.includes("Chase Roush"), `${lang}: the ministry is not named`);
    assert(m.text.includes("Chase Roush"), `${lang}: text version does not name it`);
  }
});

check("the staff messages are deliberately NOT translated", () => {
  /* Invitations and address changes go to a handful of people about to use a
     console with its own language switcher. If somebody adds them here later
     that is fine — this records that their absence is a decision. */
  const staffKeys = Object.keys(_STRINGS.en)
    .filter((k) => /^(invite|change)\./.test(k));
  eq(staffKeys.length, 0, `staff strings appeared: ${staffKeys.join(", ")}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
