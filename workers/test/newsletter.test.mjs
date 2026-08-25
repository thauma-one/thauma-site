#!/usr/bin/env node
/**
 * The composer's output — what actually reaches an inbox
 *   node workers/test/newsletter.test.mjs
 *
 * Two things are being protected here and they are not the same.
 *
 * SANITISING protects the reader from what the editor emitted. The threat is
 * not a hostile author — it is a PASTE, carrying another website's markup,
 * which renders differently in every mail client and mostly renders as a mess
 * in Gmail.
 *
 * RENDERING protects the message from the mail client. Gmail strips <style>,
 * Outlook renders through Word, and a dark-mode client inverts whatever is not
 * stated. Every rule that looks like superstition below is one of those.
 */
import { sanitise, render, toText, plainLine, escapeHtml,
         tooBig, sizeOf } from "../src/lib/newsletter.js";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("newsletter — sanitising and rendering\n");

const BODY = sanitise("<h2>News</h2><p>Hello <strong>friend</strong>.</p>" +
                      '<ul><li>One</li></ul><a href="https://x.test">link</a>');
const OPTS = { subject: "June", fromName: "Chase Roush", listName: "Newsletter",
               accent: "#E4572E", unsubscribeUrl: "https://thauma.one/u?t=abc",
               archiveUrl: "https://thauma.one/a/june", preheader: "What happened in June" };

/* ------------------------------ sanitising ----------------------------- */

check("script is removed with its contents", () => {
  const out = sanitise('<p>Hello</p><script>alert(1)</script><p>Bye</p>');
  assert(!/alert/.test(out), `script survived: ${out}`);
  assert(/Hello/.test(out) && /Bye/.test(out), "the prose either side must survive");
});

check("a style block does not become text in the middle of a sentence", () => {
  // Dropping the TAG but keeping its contents would paste CSS into the prose.
  const out = sanitise("<p>A</p><style>p{color:red}</style><p>B</p>");
  assert(!/color:red/.test(out), `stylesheet leaked into the body: ${out}`);
});

check("an unknown tag is unwrapped, never deleted with its words", () => {
  /* Losing somebody's paragraph is worse than losing its styling, and a paste
     is mostly div and span. */
  const out = sanitise('<div class="x"><span style="color:red">Kept</span></div>');
  assert(/Kept/.test(out), `the words were thrown away: ${out}`);
  assert(!/<div|<span|color:red/.test(out), `the markup survived: ${out}`);
});

check("every attribute except href and src is dropped", () => {
  const out = sanitise('<p class="a" style="color:red" onclick="x()">t</p>');
  eq(out, "<p>t</p>", "attributes must not survive");
});

check("javascript: links become plain text", () => {
  const out = sanitise('<a href="javascript:alert(1)">click</a>');
  assert(!/javascript/i.test(out), `dangerous href survived: ${out}`);
  assert(/click/.test(out), "the words should remain");
  assert(!/<a/.test(out), "a link with no usable href must not look clickable");
});

check("http, https and mailto links are kept", () => {
  for (const href of ["https://thauma.one", "http://x.test", "mailto:a@b.one"]) {
    assert(sanitise(`<a href="${href}">t</a>`).includes(href), `${href} was dropped`);
  }
});

check("a stray closing tag cannot unbalance the rest", () => {
  // A paste routinely ends mid-structure. One unmatched </p> must not close
  // something it never opened and cascade through the whole message.
  const out = sanitise("</p><p>Real</p></div>");
  eq(out, "<p>Real</p>", "structure was corrupted");
});

check("unclosed tags are closed", () => {
  eq(sanitise("<p>one<p>two"), "<p>one</p><p>two</p>", "should balance");
});

check("a bare list item does not nest inside the one before it", () => {
  eq(sanitise("<ul><li>a<li>b</ul>"), "<ul><li>a</li><li>b</li></ul>", "should balance");
});

check("a heading ends the paragraph above it", () => {
  eq(sanitise("<p>intro<h2>Title</h2>"), "<p>intro</p><h2>Title</h2>", "should balance");
});

check("text that looks like a tag is escaped, not executed", () => {
  const out = sanitise("<p>Use &lt;b&gt; for bold, and 5 &lt; 6</p>");
  assert(/&lt;b&gt;/.test(out), `entity was mangled: ${out}`);
});

check("an already-escaped ampersand is not double-escaped", () => {
  // "&amp;" typed by the editor coming out as "&amp;amp;" is the classic one.
  assert(sanitise("<p>Tom &amp; Jerry</p>").includes("Tom &amp; Jerry"),
    "double-escaped");
  assert(sanitise("<p>a & b</p>").includes("a &amp; b"), "a bare ampersand must be escaped");
});

/* --------------------- size and colour, as MEANING --------------------- */

check("a span may carry a size or a brand colour, and nothing else", () => {
  /* Storing CSS would mean parsing CSS to decide what is safe, which is the
     job nobody gets right. A span carries a NAME instead, and the renderer
     turns it into a style — the same split the whole file runs on. */
  assert(sanitise('<p><span data-sz="lg">big</span></p>').includes('data-sz="lg"'),
    "a known size should survive");
  assert(sanitise('<p><span data-c="accent">brand</span></p>').includes('data-c="accent"'),
    "a known colour should survive");
});

check("an invented size or colour is dropped, keeping the words", () => {
  for (const [html, what] of [
    ['<p><span data-sz="huge">x</span></p>', "an invented size"],
    ['<p><span data-c="#ff0000">x</span></p>', "an arbitrary colour"],
    ['<p><span style="color:red">x</span></p>', "a pasted style attribute"],
  ]) {
    const out = sanitise(html);
    eq(out, "<p>x</p>", `${what} should leave plain text`);
  }
});

check("a span doing nothing is not kept — a paste is full of them", () => {
  eq(sanitise("<p><span>x</span></p>"), "<p>x</p>", "bare span");
});

check("the brand colour resolves to the ministry's own accent", () => {
  // Free colour choice produces text that vanishes under a dark-mode
  // inversion, and an accent fighting the one on their website. This is right
  // by construction instead.
  const out = render(sanitise('<p><span data-c="accent">brand</span></p>'),
                     { ...OPTS, accent: "#22C55E" });
  assert(/<span style="[^"]*color:#22C55E/.test(out), `not resolved: ${out.slice(0, 200)}`);
});

check("underline and strikethrough survive with real styles", () => {
  const out = render(sanitise("<p><u>u</u> <s>s</s></p>"), OPTS);
  assert(/<u[^>]*style="[^"]*underline/.test(out), "underline lost its style");
  assert(/<s[^>]*style="[^"]*line-through/.test(out), "strikethrough lost its style");
});

/* ------------------------------ rendering ------------------------------ */

check("NOTHING IN THE STYLE BLOCK IS LOAD-BEARING", () => {
  /* This test used to assert there was no <style> block at all, on the belief
     that Gmail strips them. That was wrong — Gmail webmail supports a
     reasonable subset in <head>, its mobile apps historically less — and the
     belief cost a mobile refinement that had nowhere else to live, since media
     queries cannot be written inline.

     The real rule is what is checked now: delete every style block and the
     email must still be right. Clients that discard it get the 600px layout,
     which already works on a phone. */
  const html = render(BODY, OPTS);
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  for (const [what, needle] of [
    ["the accent", "#E4572E"],
    ["the body width", 'width="600"'],
    ["the page background", "#f4f5f8"],
    ["the card background", "#ffffff"],
    ["the unsubscribe link", "https://thauma.one/u?t=abc"],
  ]) {
    assert(stripped.includes(needle),
      `${what} lives only in a <style> block — a client that drops it loses it`);
  }
  assert(/<h2[^>]*style="/i.test(stripped), "blocks lost their inline styles");
});

check("the style block carries ONLY media queries", () => {
  // Anything else in there is a rule that silently does not apply in the
  // clients that strip it, which is the definition of load-bearing.
  const html = render(BODY, OPTS);
  const outside = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
  const blocks = [...outside.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  assert(blocks.length === 1, `expected exactly one style block, found ${blocks.length}`);
  const withoutMedia = blocks[0].replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, "").trim();
  assert(withoutMedia === "",
    `there are non-media rules in the style block: ${withoutMedia.slice(0, 120)}`);
});

/* ------------------------------ Outlook -------------------------------- */

check("Outlook is told not to fall back to Times New Roman", () => {
  /* Word's engine falls back to a serif the moment a font stack names anything
     not installed — so a carefully chosen sans-serif email arrives in a font
     nobody picked. This is the standard fix, and Outlook is common among the
     people a ministry writes to. */
  const html = render(BODY, OPTS);
  const mso = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/i.exec(html);
  assert(mso, "there is no MSO conditional block at all");
  assert(/font-family:\s*Arial/i.test(mso[1]), "no Arial override for Outlook");
  assert(/mso-line-height-rule:\s*exactly/i.test(mso[1]),
    "without this Word ignores line-height and sets everything single-spaced");
  assert(/PixelsPerInch/i.test(mso[1]),
    "without this Outlook applies its own DPI scaling and breaks the 600px table");
});

check("the Outlook rules are invisible to every other client", () => {
  // A conditional comment is a comment. If the block ever escaped one, every
  // other client would be forced into Arial too.
  const html = render(BODY, OPTS);
  const outside = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");

  /* INLINE mso- properties are fine and stay outside on purpose:
     `mso-hide:all` on the preheader is how Outlook is told to hide it, and
     every other client ignores a property it does not know. What must never
     escape is a STYLE BLOCK of mso rules, which would force Arial on
     everybody. */
  const styleBlocks = [...outside.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => m[1]).join("");
  assert(!/mso-/i.test(styleBlocks),
    "an mso- rule is in a style block every client will read");
  assert(!/font-family:\s*Arial[^;]*!important/i.test(outside),
    "the Arial override escaped its conditional and now applies to everybody");
});

/* -------------------------------- size --------------------------------- */

check("an oversized email is refused before it is sent", () => {
  /* Gmail cuts at about 102KB — sometimes mid-tag, breaking the render of
     everything after it — and shows "Message clipped". */
  eq(tooBig(render(BODY, OPTS)), null, "an ordinary email must pass");
  const huge = render(sanitise("<p>" + "word ".repeat(30000) + "</p>"), OPTS);
  const problem = tooBig(huge);
  assert(problem, "a message far over the limit was allowed");
  assert(/clipped|Gmail/i.test(problem), `the message should say why: ${problem}`);
});

check("size is counted in BYTES, not characters", () => {
  // Croatian diacritics and Cyrillic run to two bytes each, so counting
  // characters would pass a message Gmail then cuts.
  assert(sizeOf("ć") > 1, "a two-byte character counted as one");
  eq(sizeOf("abc"), 3, "plain ASCII");
});

check("a pasted base64 image cannot reach the email", () => {
  /* The single likeliest way to blow the limit — one paste turns a 40KB email
     into a 900KB one. safeUrl admits only http(s) and mailto, so it is dropped
     at the sanitiser rather than discovered by readers. */
  const out = sanitise('<img src="data:image/png;base64,' + "A".repeat(500) + '">');
  assert(!/data:/i.test(out), `a data URI survived: ${out.slice(0, 80)}`);
});

check("every block element carries an inline style", () => {
  const html = render(BODY, OPTS);
  for (const tag of ["h2", "p", "ul", "li", "a"]) {
    /* The style may not sit first — <a href="…" style="…"> is normal — so the
       check is that the tag carries one, not where. */
    const re = new RegExp("<" + tag + "(\\s[^>]*)?\\sstyle=\"", "i");
    assert(re.test(html), `<${tag}> has no inline style, so it will render unstyled`);
  }
});

check("the layout is tables, because Outlook renders through Word", () => {
  const html = render(BODY, OPTS);
  assert(/<table/i.test(html), "no table layout");
  assert(/role="presentation"/.test(html),
    "layout tables must be hidden from screen readers");
  assert(/width="600"/.test(html), "expected the standard 600px body width");
});

check("no webfont is requested", () => {
  // An inbox will not make the request, so the fallback is what everybody sees.
  const html = render(BODY, OPTS);
  assert(!/fonts\.googleapis|@font-face|@import/i.test(html), "a webfont was referenced");
});

check("the accent reaches the email, and nonsense does not", () => {
  assert(render(BODY, OPTS).includes("#E4572E"), "the ministry's colour is missing");
  const bad = render(BODY, { ...OPTS, accent: "red;}</style><script>" });
  assert(!/<script/i.test(bad), "an accent must never become markup");
  assert(bad.includes("#6D4AFF"), "expected the default accent");
});

check("the unsubscribe link is in the email", () => {
  assert(render(BODY, OPTS).includes("https://thauma.one/u?t=abc"), "missing");
  assert(/Unsubscribe/i.test(render(BODY, OPTS)), "and it must say so");
});

check("the preheader is hidden and padded", () => {
  /* Unpadded, the client fills the rest of the preview with the first words of
     the body — which is why so much mail previews as "View this in your
     browser". */
  const html = render(BODY, OPTS);
  const at = html.indexOf("What happened in June");
  assert(at > -1, "the preheader is missing");
  const block = html.slice(html.lastIndexOf("<div", at), at + 400);
  assert(/display:none/.test(block), "the preheader must not be visible in the body");
  assert(/&#8199;|&#65279;/.test(block), "it must be padded, or the body leaks into the preview");
});

check("the subject is escaped everywhere it appears", () => {
  const html = render(BODY, { ...OPTS, subject: '<img src=x onerror=alert(1)>' });
  /* The words may appear — escaped, they are just text. What must not appear
     is a tag, so the check is for an unescaped opening bracket. */
  assert(!/<img/i.test(html), `a subject became markup: ${html.slice(0, 400)}`);
  assert(html.includes("&lt;img"), "expected it escaped and still readable");
});

check("dark mode states every colour", () => {
  // A client that inverts a half-stated palette produces something unreadable.
  const html = render(BODY, { ...OPTS, mode: "dark" });
  assert(/#15151c/.test(html), "no dark background");
  assert(/#f2f2f7/.test(html), "no light ink to go with it");
});

/* -------------------------------- text --------------------------------- */

check("the plain text part keeps the words and where links went", () => {
  const t = toText(BODY);
  assert(/News/.test(t) && /Hello friend/.test(t), `prose lost: ${JSON.stringify(t)}`);
  assert(/link \(https:\/\/x\.test\)/.test(t),
    `a link's destination is the useful half — got ${JSON.stringify(t)}`);
  assert(!/<[a-z]/i.test(t), `tags survived: ${t}`);
});

check("list items read as a list", () => {
  assert(/•\s*One/.test(toText(BODY)), `no bullet: ${JSON.stringify(toText(BODY))}`);
});

check("entities are turned back into characters", () => {
  eq(toText("<p>Tom &amp; Jerry &lt;3</p>"), "Tom & Jerry <3", "entities");
});

/* ------------------------------ plain lines ---------------------------- */

check("a subject cannot carry markup or newlines", () => {
  eq(plainLine("<b>Hi</b>\n\nthere", 200), "Hi there", "collapsed and stripped");
  eq(plainLine("x".repeat(300), 200).length, 200, "and capped");
});

check("escapeHtml covers the characters that matter", () => {
  eq(escapeHtml(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;", "all five");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
