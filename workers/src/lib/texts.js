/**
 * texts.js — a record's wording in the languages besides its own (0047)
 *
 * Goals and mailing lists keep their name and description in plain columns,
 * in the ministry's own language; `texts` holds every other language as
 * { lang: { field: value } }. One reading and one cleaning for the console,
 * the public API and the sign-up form, so they cannot disagree.
 */

const CODE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

/** The stored JSON as an object. Unreadable or absent is no translations. */
export function readTexts(raw) {
  if (raw && typeof raw === "object") return raw;
  try {
    const o = JSON.parse(raw || "null");
    return o && typeof o === "object" && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

/**
 * What an editor sent, made safe to store: language codes only, the named
 * fields only, trimmed and capped, empties dropped. `caps` is
 * { field: maxLength }. Nothing left is NULL, like every row before 0047.
 */
export function cleanTexts(input, caps) {
  const src = readTexts(input);
  const out = {};
  for (const [code, fields] of Object.entries(src)) {
    if (!CODE_RE.test(code) || !fields || typeof fields !== "object") continue;
    const kept = {};
    for (const [field, max] of Object.entries(caps)) {
      const v = typeof fields[field] === "string" ? fields[field].trim().slice(0, max) : "";
      if (v) kept[field] = v;
    }
    if (Object.keys(kept).length) out[code] = kept;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** One field in `lang`, else the record's own wording. */
export function textIn(row, field, lang, fallback) {
  const t = readTexts(row && row.texts);
  return (lang && t[lang] && t[lang][field]) || fallback || "";
}
