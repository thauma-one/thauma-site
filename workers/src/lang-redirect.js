/**
 * lang-redirect — geo language routing for "/"
 *
 * Port of netlify/edge-functions/lang-redirect.js. The original was already
 * written against Web APIs (Request, Response, URL), so the ONLY thing that
 * actually changes for Workers is where the visitor's country comes from:
 *
 *   Netlify   context.geo?.country?.code
 *   Workers   request.cf?.country
 *
 * Restructured as a pure function so it can be tested without a Worker
 * runtime. `chooseLang` has no I/O at all, which is where the real logic is.
 *
 * SCALABILITY: to add a language, add its country codes to LANG_MAP, add the
 * language to src/_data/site.json, and add its i18n JSON file. A code here
 * that is not also enabled in site.json will redirect visitors to pages that
 * never get built — that mismatch is the failure mode worth guarding.
 */

export const LANG_MAP = {
  hr: ["HR", "BA"], // Croatia, Bosnia & Herzegovina
  sr: ["RS"],       // Serbia
};

export const DEFAULT_LANG = "en";

// Keep in sync with site.json's languages toggle.
export const SUPPORTED = ["en", "hr", "sr"];

const COOKIE_RE = /(?:^|;\s*)thauma_lang=([a-z]{2})(?:;|$)/;

/**
 * Pull a previously saved language choice out of a Cookie header.
 * Returns null unless it names a language we actually build.
 */
export function savedLang(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== "string") return null;
  const m = COOKIE_RE.exec(cookieHeader);
  return m && SUPPORTED.includes(m[1]) ? m[1] : null;
}

/**
 * The whole decision, with no I/O.
 *
 * A MANUAL CHOICE ALWAYS WINS. Someone who has picked a language should never
 * be overridden by where they happen to be sitting — including a Croatian
 * speaker travelling, or an English speaker living in Zagreb.
 */
export function chooseLang({ cookie, country }) {
  const saved = savedLang(cookie);
  if (saved) return { lang: saved, reason: "cookie" };

  const cc = String(country || "").toUpperCase();
  for (const [lang, countries] of Object.entries(LANG_MAP)) {
    if (countries.includes(cc)) return { lang, reason: "geo" };
  }
  return { lang: DEFAULT_LANG, reason: "default" };
}

/**
 * Build the redirect. 302 rather than 301 on purpose: the right answer
 * changes when someone picks a language, and a cached permanent redirect
 * would make that stick forever.
 */
export function redirectFor(request, country) {
  const { lang, reason } = chooseLang({
    cookie: request.headers.get("cookie"),
    country,
  });
  const url = new URL(`/${lang}/`, request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      // Vary so a shared cache can't serve one visitor's language to another.
      Vary: "Cookie",
      "Cache-Control": "no-store",
      "X-Lang-Reason": reason, // debugging aid; harmless to leave in
    },
  });
}

/** Worker entry point. */
export default {
  async fetch(request) {
    return redirectFor(request, request.cf?.country);
  },
};
