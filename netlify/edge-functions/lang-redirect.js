// Detects the visitor's country and redirects "/" to their language.
// SCALABILITY: to add a language, add its country codes to LANG_MAP
// and add the language to src/_data/site.json + a new i18n JSON file.
const LANG_MAP = {
  hr: ["HR", "BA"], // Croatia, Bosnia & Herzegovina
  // sr: ["RS", "ME"],  <- example: enable when Serbian translations exist
};
const DEFAULT_LANG = "en";
const SUPPORTED = ["en", "hr"];

export default async (request, context) => {
  // 1. A manual choice (cookie set by the toggle) always wins.
  const cookies = request.headers.get("cookie") || "";
  const saved = cookies.match(/thauma_lang=([a-z]{2})/);
  if (saved && SUPPORTED.includes(saved[1])) {
    return Response.redirect(new URL(`/${saved[1]}/`, request.url), 302);
  }
  // 2. Otherwise, use Netlify's geo data.
  const country = context.geo?.country?.code || "";
  let lang = DEFAULT_LANG;
  for (const [code, countries] of Object.entries(LANG_MAP)) {
    if (countries.includes(country)) { lang = code; break; }
  }
  return Response.redirect(new URL(`/${lang}/`, request.url), 302);
};
