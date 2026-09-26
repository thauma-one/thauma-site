/**
 * mail-i18n.js — the words a SUPPORTER reads that Thauma writes, not a person
 *
 * WHICH WORDS, AND WHY ONLY THESE. Confirming a subscription, the receipt for
 * the contact form, the unsubscribe pages — and the fixed labels, messages and
 * errors of the sign-up and contact forms that sit on partners' websites
 * (form.* and contact.*). They go to people who never asked for an account and
 * may not read English — a Croatian supporter confirming a Croatian ministry's
 * list in English is a worse experience and a worse conversion.
 *
 * EVERY LANGUAGE THE PUBLIC SITE OFFERS, not only the console's. Chase,
 * 2026-09-26: everything a visitor can read must be translatable, while the
 * console may lag behind. So Slovenian is here although the console has none.
 *
 * WHAT A PARTNER TYPED IS NOT HERE. A form's own heading, button and thank-you
 * line, when the partner set them, are theirs; these are only the defaults
 * used when they did not.
 *
 * THE STAFF ONES ARE DELIBERATELY ABSENT. Invitations and address changes go
 * to a handful of people who are about to use a console that has its own
 * language switcher. Translating them is work with almost nobody on the other
 * end of it, and it can be added here later without changing anything else.
 *
 * NOT THE NEWSLETTER. A mailing is written by a person in whatever language
 * they wrote it; there is nothing here to translate and nothing that should
 * try.
 *
 * THE TRANSLATIONS ARE ROUGH, and that is a deliberate first pass — Chase
 * asked for rough. They are worth a read by somebody who speaks these before
 * they meet a real supporter. What is NOT rough is the shape: one table, three
 * languages, every key present in all of them, which is what a proper pass
 * needs in order to be a proper pass rather than a rewrite. That pass is now
 * the Translate page's job (Administration › Languages).
 *
 * FALLBACK IS ENGLISH, ONE KEY AT A TIME. A missing Croatian string yields the
 * English one rather than nothing, so a half-finished translation degrades to
 * a mixed message instead of a blank.
 */
/* THE WORDS LIVE IN src/_data/emailsAndForms.json, not here.

   They were a table in this file, which meant only somebody editing code could
   change or translate them. As data they are edited and translated in the
   console like the site's own words (Administration › Languages), committed to
   the repository, and shipped with the next Publish — the Worker is deployed
   from the same commit as the site.

   One file with every language inside it, rather than one per language like
   the site words, because a Worker cannot import a file it does not know the
   name of: a language added in the console becomes a new key in this file,
   never a new file.

   Nested one level ({ confirm: { subject } }) because the console edits leaves
   by dotted path; flattened back to "confirm.subject" here, which is the name
   every caller uses. */
import WORDS from "../../../src/_data/emailsAndForms.json" with { type: "json" };

const STRINGS = {};
for (const [lang, sections] of Object.entries(WORDS)) {
  STRINGS[lang] = {};
  for (const [section, table] of Object.entries(sections)) {
    for (const [k, v] of Object.entries(table)) STRINGS[lang][`${section}.${k}`] = v;
  }
}

/* A blank string is an untranslated one — a new language arrives with every
   value empty — so it falls back exactly like a missing key. */
const has = (table, key) => typeof table[key] === "string" && table[key] !== "";

/**
 * One string, in the best language available.
 *
 * `{name}` style placeholders are substituted here rather than by the caller,
 * so a key that gains a placeholder does not need every call site edited.
 * Values are NOT escaped: some strings carry deliberate markup, and the caller
 * escapes what came from a person before passing it in.
 */
export function t(lang, key, vars = {}) {
  const table = STRINGS[String(lang || "").toLowerCase()] || STRINGS.en;
  let s = (has(table, key) ? table : STRINGS.en)[key];
  if (s === undefined) return key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** The languages this file actually carries. */
export const LANGS = Object.keys(STRINGS);

/**
 * Every key starting with one of `prefixes`, in every language, each language
 * completed from English — so a widget running in a browser can pick its own
 * language without a round trip and without a missing key ever reading as
 * blank. Small: only what that widget shows.
 */
export function wordsFor(...prefixes) {
  const keep = (k) => prefixes.some((p) => k.startsWith(p));
  const out = {};
  for (const lang of LANGS) {
    out[lang] = {};
    for (const k of Object.keys(STRINGS.en).filter(keep)) {
      out[lang][k] = has(STRINGS[lang], k) ? STRINGS[lang][k] : STRINGS.en[k];
    }
  }
  return out;
}
export { STRINGS as _STRINGS };
