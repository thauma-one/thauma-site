/**
 * newsletter.js — turning what somebody wrote into an email that survives
 *
 * TWO JOBS, AND THEY ARE DELIBERATELY SEPARATE.
 *
 * `sanitise` takes HTML from a contenteditable box and reduces it to a small
 * known set of tags. `render` takes that and builds the email. Neither trusts
 * the other's input, and the split is the point: a browser's rich-text editor
 * emits whatever the browser felt like — <font>, style attributes, nested
 * spans, pasted markup carrying an entire other website's classes — and none
 * of that may reach a stranger's inbox. Editors produce MEANING here; this
 * file produces APPEARANCE.
 *
 * WHY SANITISING MATTERS EVEN THOUGH ONLY STAFF CAN WRITE
 * ---------------------------------------------------------------------------
 * The threat is not a hostile author. It is a paste. Somebody copies two
 * paragraphs out of a document or a web page and the clipboard carries a
 * stylesheet's worth of markup with it — which renders differently in every
 * mail client, and in Gmail mostly renders as a mess. Stripping to a known
 * set is what makes the output predictable.
 *
 * WHAT "EMAIL-SAFE" ACTUALLY REQUIRES
 * ---------------------------------------------------------------------------
 *   - NOTHING LOAD-BEARING IN A <style> BLOCK. The first version of this file
 *     said "Gmail strips it", which is wrong and worth correcting: Gmail
 *     webmail supports a reasonable CSS subset in <head>, and its mobile apps
 *     have historically been weaker. Several OTHER clients do strip it. So the
 *     rule is not "no style block" — it is that every colour, every dimension
 *     and every piece of structure must survive with the block deleted. One is
 *     included below carrying ONLY @media rules, which cannot be expressed
 *     inline and are pure refinement.
 *   - TABLES FOR LAYOUT. Not nostalgia: Outlook renders through Word, which
 *     has no float, no flexbox and no reliable max-width on a div.
 *   - NO SHORTHAND MARGIN on block elements — several clients drop it. Padding
 *     on table cells is the only spacing that lands everywhere.
 *   - WEB-SAFE FONTS ONLY. A webfont means a network request an inbox will not
 *     make, and the fallback is what everybody actually sees.
 *   - EVERY COLOUR STATED. Dark-mode clients invert what they can and a
 *     half-stated palette comes out unreadable.
 *   - MSO CONDITIONAL COMMENTS. Outlook desktop is a Word rendering engine
 *     wearing a mail client, and it is disproportionately common among the
 *     people a ministry writes to. Left alone it falls back to Times New Roman
 *     the moment a font stack names something not installed, and it ignores
 *     line-height unless told to obey it exactly.
 *   - UNDER GMAIL'S CLIPPING LIMIT. Past roughly 102KB Gmail truncates the
 *     message — sometimes mid-tag, which breaks the rest of the render — and
 *     shows "[Message clipped]". See `tooBig` below: the send checks rather
 *     than assumes.
 *
 * A PLAIN TEXT PART IS NOT OPTIONAL. Some people read mail as text, and a
 * message with no text alternative scores worse with spam filters — which is
 * the whole reason the domain work in SPEC.md exists.
 */

/* Tags a newsletter may contain. Everything else is unwrapped — its CONTENT is
   kept and its tag discarded — rather than deleted, because silently losing a
   paragraph somebody wrote is worse than losing its styling. */
const KEEP = new Set([
  "p", "br", "strong", "em", "u", "s",
  "h2", "h3",
  "ul", "ol", "li",
  "a", "img", "blockquote", "hr",
  // Carries size and colour, and ONLY through the two attributes below.
  "span",
]);

/* SIZE AND COLOUR ARE STORED AS MEANING, NOT AS CSS.
 *
 * A style attribute survives the sanitiser nowhere, including here: allowing
 * one would mean parsing CSS to decide what is safe, which is the job nobody
 * gets right. Instead a span may carry `data-sz` or `data-c` naming one of a
 * handful of choices, and inlineStyles turns those into real inline styles at
 * render time — the same division the whole file runs on, where the editor
 * produces meaning and this produces appearance.
 *
 * It also means restyling every newsletter ever sent is a change to the table
 * below, and that an archived mailing re-renders in the new palette.
 *
 * COLOUR IS LIMITED TO THE BRAND, deliberately. Free colour choice in email
 * produces unreadable text against a dark-mode inversion sooner or later, and
 * an accent that fights the ministry's own. `accent` resolves to whatever the
 * partner chose, so it is right by construction.
 */
const SIZES = { sm: "13.5px", lg: "19px" };
const COLOURS = new Set(["accent", "dim"]);

/* Tags whose CONTENT goes too. Script and style carry no prose, and keeping
   the text inside a <style> would paste CSS into the middle of a sentence. */
const DROP_WHOLE = new Set(["script", "style", "head", "title", "meta", "link", "iframe", "object", "embed"]);

/* What each surviving tag may carry. Anything not listed is dropped — that
   includes every style, class and id, which is what keeps a paste from
   bringing another website's appearance along. */
const ATTRS = { a: ["href"], img: ["src", "alt"], span: ["data-sz", "data-c"] };

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

/** Only what can be followed safely. javascript: is the reason this exists. */
function safeUrl(raw) {
  const v = String(raw || "").trim();
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  return null;
}

/**
 * Reduce arbitrary editor HTML to the KEEP set.
 *
 * Written as a scanner rather than with a DOM parser because Workers have no
 * DOMParser, and pulling one in to clean a few kilobytes of text would be a
 * dependency in the path of every send.
 */
export function sanitise(html) {
  const src = String(html || "");
  let out = "";
  let i = 0;
  const open = [];

  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { out += escapeText(src.slice(i)); break; }
    out += escapeText(src.slice(i, lt));

    const gt = src.indexOf(">", lt);
    if (gt === -1) { out += escapeText(src.slice(lt)); break; }

    const raw = src.slice(lt + 1, gt).trim();
    i = gt + 1;

    if (raw.startsWith("!")) continue;               // comments and doctypes

    const closing = raw.startsWith("/");
    const name = (closing ? raw.slice(1) : raw).split(/[\s/>]/)[0].toLowerCase();

    if (DROP_WHOLE.has(name)) {
      if (!closing) {
        // Skip to the matching close, content and all.
        const end = src.toLowerCase().indexOf("</" + name, i);
        i = end === -1 ? src.length : (src.indexOf(">", end) + 1 || src.length);
      }
      continue;
    }

    if (!KEEP.has(name)) continue;                   // unwrapped: content stays

    if (closing) {
      /* Only close what is actually open. A stray </div> from a paste would
         otherwise emit a close tag with no opener and unbalance everything
         after it. */
      const at = open.lastIndexOf(name);
      if (at === -1) continue;
      while (open.length > at) out += "</" + open.pop() + ">";
      continue;
    }

    /* IMPLICIT CLOSING. HTML says a new <p> ends an open one, and an editor
       emits exactly that — <p>one<p>two — where a naive scanner produces
       <p>one<p>two</p></p>. Nested paragraphs are not merely untidy: mail
       clients disagree about what they mean, so the same message would space
       differently in Gmail and in Outlook. */
    const CLOSES = { p: ["p"], li: ["li"], h2: ["p"], h3: ["p"] };
    for (const victim of CLOSES[name] || []) {
      const at = open.lastIndexOf(victim);
      if (at !== -1) while (open.length > at) out += "</" + open.pop() + ">";
    }

    const selfClosing = name === "br" || name === "img" || name === "hr";
    let attrs = "";
    for (const key of ATTRS[name] || []) {
      const m = new RegExp(key + '\\s*=\\s*"([^"]*)"', "i").exec(raw) ||
                new RegExp(key + "\\s*=\\s*'([^']*)'", "i").exec(raw);
      if (!m) continue;
      let value = m[1];
      if (key === "data-sz" && !SIZES[value]) continue;
      if (key === "data-c" && !COLOURS.has(value)) continue;
      if (key === "href" || key === "src") {
        value = safeUrl(value);
        if (!value) continue;
      }
      /* A data: URI never reaches safeUrl, which only admits http(s) and
         mailto — so a pasted base64 image is already dropped above. Stated
         here because it is the single likeliest way to blow Gmail's clipping
         limit, and somebody reading this file should not have to work out
         that it is handled. */
      attrs += " " + key + '="' + escapeHtml(value) + '"';
    }
    /* A link with no usable href becomes plain text rather than a dead <a>,
       which looks clickable and is not. A span carrying neither a size nor a
       colour is doing nothing at all — and pastes are full of them. */
    if (name === "a" && !attrs) continue;
    if (name === "span" && !attrs) continue;

    if (selfClosing) { out += "<" + name + attrs + ">"; continue; }
    out += "<" + name + attrs + ">";
    open.push(name);
  }

  while (open.length) out += "</" + open.pop() + ">";
  return out.trim();
}

/* Text between tags. Ampersands already written as entities are left alone,
   or "&amp;" typed by the editor would come out as "&amp;amp;". */
function escapeText(s) {
  return String(s)
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,9}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, "&amp;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A readable plain-text part, derived from the same HTML the email carries. */
export function toText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|h2|h3|li|blockquote)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "  • ")
    .replace(/<\s*hr\s*\/?>/gi, "\n----------\n")
    /* A link's text alone loses where it went, which is the useful half.
       PARENTHESES, not angle brackets: the tag strip on the next line would
       have eaten <https://…> as if it were a tag, which is exactly what it
       did — the destination vanished and the text read as if nothing had been
       linked at all. */
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, text) => {
      const words = text.replace(/<[^>]+>/g, "").trim();
      // "https://x (https://x)" helps nobody.
      return words && words !== href ? `${words} (${href})` : href;
    })
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,Cambria,'Times New Roman',serif";

/* Inline styles per tag. Applied on the way out rather than stored, so
   restyling every newsletter ever sent is a change here — and an archived
   mailing is re-rendered from the same source the email came from. */
function inlineStyles(html, accent, ink, dim, line) {
  const S = {
    p: `margin:0 0 16px;font-size:16px;line-height:1.6;color:${ink}`,
    h2: `margin:28px 0 12px;font-family:${SERIF};font-size:23px;line-height:1.3;` +
        `font-weight:700;color:${ink}`,
    h3: `margin:24px 0 10px;font-family:${SERIF};font-size:19px;line-height:1.35;` +
        `font-weight:700;color:${ink}`,
    ul: `margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:${ink}`,
    ol: `margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:${ink}`,
    li: "margin:0 0 7px",
    a: `color:${accent};text-decoration:underline`,
    blockquote: `margin:0 0 16px;padding:2px 0 2px 16px;border-left:3px solid ${accent};` +
                `font-size:16px;line-height:1.6;color:${dim}`,
    hr: `border:0;border-top:1px solid ${line};margin:26px 0`,
    img: "max-width:100%;height:auto;display:block;border:0;margin:0 0 16px",
    strong: "font-weight:700",
    em: "font-style:italic",
    u: "text-decoration:underline",
    s: "text-decoration:line-through",
    __sizes: SIZES,
  };
  return html.replace(/<([a-z0-9]+)((?:\s[^>]*)?)>/gi, (m, tag, rest) => {
    const name = tag.toLowerCase();

    /* A span's appearance comes from what it MEANS, resolved here. `accent` is
       the ministry's own colour, so a coloured word is right by construction
       rather than by whoever was typing having picked well. */
    if (name === "span") {
      const sz = /data-sz="([^"]*)"/.exec(rest);
      const c = /data-c="([^"]*)"/.exec(rest);
      const bits = [];
      if (sz && S.__sizes[sz[1]]) bits.push("font-size:" + S.__sizes[sz[1]]);
      if (c && c[1] === "accent") bits.push("color:" + accent);
      if (c && c[1] === "dim") bits.push("color:" + dim);
      return bits.length ? `<span style="${bits.join(";")}">` : m;
    }

    const style = S[name];
    if (!style) return m;
    return `<${tag}${rest} style="${style}">`;
  });
}

/**
 * The whole email.
 *
 * @param body      already sanitised HTML
 * @param opts.unsubscribeUrl  REQUIRED for a real send. See the note below.
 */
export function render(body, opts = {}) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(opts.accent || "")) ? opts.accent : "#6D4AFF";
  const dark = opts.mode === "dark";

  /* Fixed, not theme-aware. An email cannot ask what the reader prefers, and a
     client that inverts a light email does a better job than one asked to
     render a dark one it did not expect. Light unless somebody asks. */
  const bg   = dark ? "#15151c" : "#f4f5f8";
  const card = dark ? "#1c1c25" : "#ffffff";
  const ink  = dark ? "#f2f2f7" : "#1a1a22";
  const dim  = dark ? "#9a9aad" : "#5c5c6b";
  const line = dark ? "#2a2a36" : "#e6e6ee";

  const styled = inlineStyles(body, accent, ink, dim, line);
  const title = escapeHtml(opts.subject || "");

  /* THE PREHEADER. Hidden, and followed by enough blank characters to stop the
     client filling the rest of the preview with the first words of the body.
     Every serious sender does this; it looks like a hack because it is one. */
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;` +
      `mso-hide:all">${escapeHtml(opts.preheader)}` +
      "&#8199;&#65279;&#847; ".repeat(60) + "</div>"
    : "";

  const archive = opts.archiveUrl
    ? `<a href="${escapeHtml(opts.archiveUrl)}" style="color:${dim};text-decoration:underline">` +
      "View this in your browser</a> &nbsp;·&nbsp; "
    : "";

  /* NO UNSUBSCRIBE LINK MEANS NO SEND — enforced by the caller, stated here.
     A bulk message without one is a complaint waiting to happen and, in most
     of the places this will be read, unlawful. */
  const unsub = opts.unsubscribeUrl
    ? `<a href="${escapeHtml(opts.unsubscribeUrl)}" style="color:${dim};text-decoration:underline">` +
      "Unsubscribe</a>"
    : "";

  /* MSO CONDITIONALS. Outlook desktop is a Word rendering engine wearing a
     mail client, and it is disproportionately common among the people a
     ministry writes to — which is why this is worth the ugliness.

     The namespaces and OfficeDocumentSettings stop Outlook applying its own
     DPI scaling, which otherwise enlarges everything on a high-DPI screen and
     breaks a fixed 600px table.

     The font rule is the one that matters most: given a stack naming anything
     not installed, Word falls back to TIMES NEW ROMAN — so a carefully chosen
     sans-serif email arrives in a serif nobody picked. Forcing Arial for
     Outlook only is the standard fix, and it is inside a conditional so no
     other client ever sees it.

     mso-line-height-rule:exactly is the second: without it Word ignores
     line-height entirely and sets everything at single spacing. */
  const mso = `<!--[if mso]>
<xml><o:OfficeDocumentSettings>
<o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings></xml>
<style>
  * { font-family: Arial, Helvetica, sans-serif !important; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  td, p, h1, h2, h3, li { mso-line-height-rule: exactly; }
</style>
<![endif]-->`;

  /* THE ONLY <style> BLOCK, and nothing in it is load-bearing. Media queries
     cannot be written inline, so a mobile refinement has nowhere else to live
     — and a client that discards the block simply gets the 600px layout, which
     already works on a phone because the table is width:600 with
     max-width:100%. Delete this block and nothing breaks; that is the test it
     has to pass. */
  const media = `<style>
@media only screen and (max-width:620px) {
  .w { width: 100% !important; }
  .pad { padding-left: 22px !important; padding-right: 22px !important; }
  .h1 { font-size: 23px !important; line-height: 1.3 !important; }
}
</style>`;

  return `<!doctype html>
<html lang="${escapeHtml(opts.lang || "en")}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${title}</title>
${mso}
${media}
</head>
<body style="margin:0;padding:0;background:${bg};-webkit-font-smoothing:antialiased">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${bg};width:100%">
  <tr><td align="center" style="padding:28px 12px">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
           class="w"
           style="width:600px;max-width:100%;background:${card};border:1px solid ${line};
                  border-radius:10px;overflow:hidden">

      <tr><td style="height:4px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>

      <tr><td class="pad" style="padding:32px 36px 8px">
        <p style="margin:0;font-family:${FONT};font-size:12px;letter-spacing:.08em;
                  text-transform:uppercase;color:${dim};font-weight:600">
          ${escapeHtml(opts.fromName || "")}</p>
        <h1 class="h1" style="margin:10px 0 0;font-family:${SERIF};font-size:27px;line-height:1.25;
                   font-weight:700;color:${ink}">${title}</h1>
      </td></tr>

      <tr><td class="pad" style="padding:20px 36px 30px;font-family:${FONT}">
        ${styled}
      </td></tr>

      <tr><td class="pad" style="padding:20px 36px 28px;border-top:1px solid ${line};
                     font-family:${FONT};font-size:12.5px;line-height:1.6;color:${dim}">
        <p style="margin:0 0 8px;color:${dim}">${escapeHtml(opts.listName || "")}</p>
        <p style="margin:0;color:${dim}">${archive}${unsub}</p>
      </td></tr>

    </table>

  </td></tr>
</table>
</body>
</html>`;
}

/* ---------------------------------------------------------------- SIZE ----
 * GMAIL CLIPS AT ROUGHLY 102KB.
 *
 * Past that it truncates the message, shows "[Message clipped] View entire
 * message", and — because the cut can land mid-tag — often breaks the render
 * of everything after it. It is a more common failure than it sounds, and the
 * usual cause is somebody pasting a base64 image, which turns a 40KB email
 * into a 900KB one in a single keystroke.
 *
 * MEASURED IN BYTES, NOT CHARACTERS. The limit is on what is transmitted, and
 * a message full of Croatian diacritics or Cyrillic runs to two bytes per
 * character — so counting characters would pass a message Gmail then cuts.
 */
export const GMAIL_CLIP_BYTES = 102 * 1024;

/* The line drawn at 90% of it. A message that squeaks under the limit today
   clips the moment somebody adds a paragraph, and the failure appears in
   readers' inboxes rather than here. */
export const SIZE_LIMIT = Math.floor(GMAIL_CLIP_BYTES * 0.9);

export function sizeOf(html) {
  return new TextEncoder().encode(String(html || "")).length;
}

/** null when it fits, or a sentence saying by how much it does not. */
export function tooBig(html) {
  const n = sizeOf(html);
  if (n <= SIZE_LIMIT) return null;
  const kb = (x) => Math.round(x / 1024);
  return `This email is ${kb(n)}KB. Gmail cuts messages off at about ` +
         `${kb(GMAIL_CLIP_BYTES)}KB and shows "Message clipped" instead of the ` +
         `rest, so anything over ${kb(SIZE_LIMIT)}KB is refused here. The usual ` +
         `cause is an image pasted into the message rather than linked — add ` +
         `pictures with the image button so they are fetched, not carried.`;
}

/** Subject and preheader are plain text — a tag in either is shown literally. */
export function plainLine(s, max) {
  return String(s == null ? "" : s).replace(/<[^>]*>/g, "").replace(/\s+/g, " ")
    .trim().slice(0, max);
}
