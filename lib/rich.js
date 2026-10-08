/**
 * rich.js — one of the site's words, with the formatting it was given
 *
 * Website › Pages writes formatted words (2026-10-07, Chase: "allowing the
 * text controls that the Site Creator has … how the text styles, sizes,
 * colors, etc. AND also … the times when a new line is started defined in
 * the text box itself"). They are stored as the Site Creator stores them —
 * as meaning (src/js/rich-text.js):
 *
 *   <b> <i> <u>                    bold, italic, underline
 *   <a href="…">                   a link (web, mailto, or one of the site's own)
 *   <span data-sz data-c>          a size (sm, lg, xl or 4–200px) and a color
 *                                  (accent, accent2, dim, red, green, blue,
 *                                  gold, or any #rrggbb)
 *   "\n"                           a new line, exactly where it was typed
 *
 * Everything else is text. A string with no formatting at all comes out
 * exactly as before, so a plain line is unaffected.
 *
 * MARKED FOR THE PREVIEW. Given its key, the words are wrapped in
 * <span data-k="…">, which is how Website › Pages finds them in its live
 * preview to show what is being typed before it is saved.
 *
 * THE TWO VOICES (CLAUDE.md rule 3): "accent" is the technical blue, the
 * second color the ministry's seafoam. The quick picks use their shade for a
 * dark ground (workers/src/lib/tones.js), which is the site's.
 */
const TONES = { red: "#FF8A80", green: "#6FE3A6", blue: "#8DB8FF", gold: "#F2C14E" };
const NAMED = { accent: "var(--blue)", accent2: "var(--foam)", dim: "var(--dim)" };
const SIZES = { sm: "rt-sm", lg: "rt-lg", xl: "rt-xl" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/* Words saved from a box arrive escaped (&amp;); words typed in a plain box
   do not (Q&A). Both are read as text, then escaped once. */
const unesc = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, "&");

function linkOk(h) {
  return /^(https?:\/\/[^\s"<>]+|mailto:[^\s"<>]+|\/[^\s"<>]*)$/i.test(h);
}

/** The words as HTML: only the formatting listed above survives. */
function richHtml(value) {
  const s = String(value == null ? "" : value);
  const open = [];
  let out = "";
  for (const part of s.split(/(<[^>]*>)/)) {
    if (!part) continue;
    if (part[0] !== "<") { out += esc(unesc(part)).replace(/\r?\n/g, "<br>"); continue; }
    const m = /^<(\/?)([a-z]+)\b([^>]*)>$/i.exec(part);
    if (!m) { out += esc(part); continue; }
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3];
    if (close) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    if (tag === "b" || tag === "i" || tag === "u") { out += `<${tag}>`; open.push(tag); continue; }
    if (tag === "br") { out += "<br>"; continue; }
    if (tag === "a") {
      const h = /href="([^"]*)"/i.exec(attrs);
      const href = h ? unesc(h[1]) : "";
      if (!linkOk(href)) continue;
      const away = /^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : "";
      out += `<a href="${esc(href)}"${away}>`; open.push("a"); continue;
    }
    if (tag === "span") {
      const sz = (/data-sz="([^"]*)"/i.exec(attrs) || [])[1] || "";
      const c = (/data-c="([^"]*)"/i.exec(attrs) || [])[1] || "";
      const cls = [], style = [];
      if (SIZES[sz]) cls.push(SIZES[sz]);
      else if (/^\d{1,3}(\.5)?px$/.test(sz) && +sz.slice(0, -2) >= 4 && +sz.slice(0, -2) <= 200) style.push(`font-size:${sz}`);
      if (NAMED[c]) style.push(`color:${NAMED[c]}`);
      else if (TONES[c]) style.push(`color:${TONES[c]}`);
      else if (/^#[0-9a-f]{6}$/i.test(c)) style.push(`color:${c.toLowerCase()}`);
      if (!cls.length && !style.length) continue;
      out += `<span${cls.length ? ` class="${cls.join(" ")}"` : ""}${style.length ? ` style="${style.join(";")}"` : ""}>`;
      open.push("span");
      continue;
    }
    /* any other tag is not formatting: shown as the text it is */
    out += esc(part);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

/** Plain text of the words, for a place that cannot hold formatting. */
function richPlain(value) {
  return unesc(String(value == null ? "" : value).replace(/<[^>]*>/g, "")).replace(/\s*\n\s*/g, " ").trim();
}

module.exports = { richHtml, richPlain };
