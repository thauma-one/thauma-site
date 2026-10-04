/**
 * tones.js — the text colors and sizes a person may choose, in one place
 *
 * Shared by the Mail composer (lib/newsletter.js) and the Site Creator
 * (site/model.js, site/render.js), so a color named in one means the same in
 * the other (Chase, 2026-10-03: "a full palette, with a few predetermined
 * quick picks").
 *
 *   accent  the ministry's own color, resolved where it is drawn
 *   dim     the quieter text color of whatever it sits on
 *   red, green, blue, gold
 *           quick picks with a shade for a LIGHT ground and one for a DARK
 *           ground, both readable (4.5:1) on their own
 *   #rrggbb any color at all, written as it was picked
 *
 * Stored as MEANING (`data-c`, `data-sz`), never as a style attribute: a
 * style cannot be checked without parsing CSS, and a name can be restyled
 * later everywhere it was used.
 */
export const TONES = {
  red:   ["#B42318", "#FF8A80"],
  green: ["#1B7F4B", "#6FE3A6"],
  blue:  ["#1D5FC2", "#8DB8FF"],
  gold:  ["#9A5B00", "#F2C14E"],
};
export const COLOR_NAMES = ["accent", "dim", ...Object.keys(TONES)];
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** A color a person may store: a quick pick's name or any #rrggbb. */
export function isColor(v) {
  return COLOR_NAMES.includes(v) || HEX_COLOR.test(String(v || ""));
}
/** The stored form: names as they are, a picked color lowercased. */
export function cleanColor(v) {
  if (!isColor(v)) return null;
  return HEX_COLOR.test(v) ? v.toLowerCase() : v;
}

/* The text sizes besides normal. Each place draws them its own way: an email
   in pixels, a site in ems of whatever the words already are. */
export const SIZE_NAMES = ["sm", "lg", "xl"];
