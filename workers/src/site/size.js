/**
 * size.js — how big a ministry's site is drawn
 *
 * SMALLER ON A COMPUTER (Chase, 2026-10-28: "When in Chrome, the default
 * 100% size is too big to me, but the 80% feels much better … The default
 * size needs to be smaller"). Every length the site's own look sets in px
 * (and rem, at 16px) becomes that many of --su, one site unit: a whole pixel on a phone, where
 * the sizes were already right, easing down to four fifths of one on a wide
 * screen — 80%, as the browser would draw it, with the widths that follow
 * the window (vw, %) left alone, just as the browser leaves them.
 *
 *   · Lines of 2px and less stay as they are, so hairlines stay crisp.
 *   · Media queries keep their px: they are the screen's size, not the site's.
 *   · Sizes picked in the words (data-sz) scale with everything else.
 *   · The widgets and forms on the page do the same (SIZE_JS), where the
 *     page says it is a ministry's site; anywhere else --su is not set and a
 *     unit is a pixel, so nobody else's page changes.
 */

/** One site unit: 1px up to a 700px window, 0.8px from 1100px, eased between. */
export const SITE_UNIT = "--su:clamp(.8px,calc(1.35px - .05vw),1px)";

const PX = /(@(?:media|container)[^{]*)|(-?)(\d*\.?\d+)(px|rem)\b/g;
const unit = (neg, n) => `calc(var(--su,1px)*${neg}${n})`;

/** A stylesheet's px lengths in site units. */
export function sized(css) {
  return String(css).replace(PX, (m, media, neg, n, u) => {
    const px = u === "rem" ? +n * 16 : +n;
    return media ? media : px <= 2 ? m : unit(neg, px);
  });
}

/** The px font sizes written into the page's own style attributes. */
export function sizedInline(html) {
  return String(html).replace(/(\sstyle="[^"]*?)font-size:(\d*\.?\d+)px/g, (m, pre, n) => `${pre}font-size:${unit("", n)}`);
}

/** The same, for scripts that cannot import it (the widget, the forms). */
export const SIZE_JS = [
  "function sized(css) {",
  "  return String(css).replace(/(@(?:media|container)[^{]*)|(-?)(\\d*\\.?\\d+)(px|rem)\\b/g, function (m, media, neg, n, u) {",
  "    var px = u === 'rem' ? +n * 16 : +n;",
  "    return media ? media : px <= 2 ? m : 'calc(var(--su,1px)*' + neg + px + ')';",
  "  });",
  "}",
].join("\n");
