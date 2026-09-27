/**
 * topics.js — a contact form's reasons, in every language (0041)
 *
 * A reason ("General", "Working with Thauma") carries `label`, the name as
 * first written and the fallback, and `labels`, JSON { lang: label } for the
 * languages it has been written in. One place reads that shape, so the
 * console, thauma.one's own form and the contact widget cannot disagree about
 * which name a visitor sees.
 */

const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

/** The stored JSON as an object; {} for none or for anything unreadable. */
export function topicLabels(row) {
  try {
    const o = JSON.parse((row && row.labels) || "null");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/** The reason's name in `lang`, or the name it was first written with. */
export function topicLabel(row, lang) {
  const l = topicLabels(row);
  return (lang && l[lang]) || (row && row.label) || "";
}

/**
 * What the console sent, made safe to store: language codes only, each name
 * trimmed to `max`, empty ones dropped. null when nothing is left, so a
 * reason with no translations stores NULL like every row before 0041.
 */
export function cleanLabels(raw, max = 80) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  for (const [lang, v] of Object.entries(raw).slice(0, 40)) {
    if (!LANG_RE.test(lang)) continue;
    const s = String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
    if (s) out[lang.toLowerCase()] = s;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}
