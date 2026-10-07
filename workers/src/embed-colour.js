/**
 * embed-colour.js — deriving the SECOND color of the pair
 *
 * chaseroush.com's timeline runs on two clearly different colors, and the
 * legend is where you see it plainly: completed is green, in progress is cyan,
 * upcoming is a hollow ring. The rail's gradient runs between the two. That
 * pair is the identity of the thing — collapsing it into one accent, as the
 * first version of this widget did, loses the ability to tell finished work
 * from work in flight at a glance.
 *
 * Thauma cannot ship a fixed pair, because the accent is chosen per partner.
 * So the second color is DERIVED from the first, keeping the same
 * relationship CR's pair has: cyan (#00D4FF, hue 190°) to green (#00FF9F, hue
 * 157°) is a rotation of about -33° with the saturation and lightness left
 * alone. Applied to any accent, that produces a companion which is recognisably
 * related and clearly distinct.
 *
 * WHY IN JAVASCRIPT RATHER THAN color-mix
 * ---------------------------------------------------------------------------
 * color-mix cannot rotate a hue — mixing toward white only lightens, which is
 * what the earlier version did and why both ends of the gradient read as the
 * same color. Doing it here also means the two colors are real hex values
 * the widget can use anywhere, including in a glow's alpha, with no dependency
 * on how new the visitor's browser is.
 */

/** #RRGGBB -> {h, s, l} with h in degrees, s and l in 0..1. */
export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;

  return { h: h * 60, s, l };
}

/** {h, s, l} -> #RRGGBB */
export function hslToHex({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return "#" + to(r) + to(g) + to(b);
}

/**
 * The companion color: what "completed" is drawn in when the accent means
 * "in progress".
 *
 * -33° by default, the same rotation that separates CR's cyan from its green.
 * `turn` is how far round the wheel it sits instead — the degrees a ministry
 * picks on Sharing (0040): -33, 120 or 180. NULL means -33, which is what
 * every ministry had before there was a choice.
 *
 * A GRAY ACCENT IS THE ONE CASE THAT HAS TO BE HANDLED, and it is not
 * theoretical — a partner choosing black, white or a neutral is entirely
 * plausible. Rotating the hue of something with no saturation returns the same
 * color, so the pair would silently collapse back into one. There, the second
 * color is separated by LIGHTNESS instead, which is the only axis a gray has.
 */
export function companion(hex, turn) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;

  if (hsl.s < 0.12) {
    const l = hsl.l > 0.5 ? Math.max(0.28, hsl.l - 0.3) : Math.min(0.82, hsl.l + 0.3);
    return hslToHex({ h: hsl.h, s: hsl.s, l });
  }

  return hslToHex({
    h: hsl.h + (Number.isFinite(turn) ? turn : -33),
    /* Nudged up a little, because the eye reads the completed color as the
       "arrived" one and a flatter version of the accent reads as faded. */
    s: Math.min(1, hsl.s * 1.05),
    l: Math.min(0.72, hsl.l * 1.04),
  });
}

/* The degrees a second color may sit from the first (0040). */
export const TURNS = [-33, 120, 180];
const HEX = /^#[0-9a-fA-F]{6}$/;
const MODES = ["auto", "light", "dark"];

/**
 * THE COLORS ONE EMBED WEARS: its own if it has them, the ministry's if not,
 * resolved to two hex values and a background. `row` carries the ministry's
 * columns (embed_accent, embed_accent2, embed_turn, embed_theme); `look` is
 * the embed's embed_looks row or null. A stored second color is the free
 * choice; without one, the second sits `turn` degrees from the first.
 */
export function lookFor(row, look, fallback = "#1AE4FF") {
  row = row || {};
  const own = look && HEX.test(look.accent || "");
  const accent = own ? look.accent : HEX.test(row.embed_accent || "") ? row.embed_accent : fallback;
  const two = own ? look.accent2 : row.embed_accent2;
  const turn = own ? look.turn : row.embed_turn;
  const theme = look && MODES.includes(look.theme) ? look.theme : row.embed_theme;
  return {
    accent,
    accent2: HEX.test(two || "") ? two : companion(accent, TURNS.includes(turn) ? turn : undefined),
    mode: MODES.includes(theme) ? theme : "auto",
  };
}

/** lookFor, for a form's row, which carries its own look as look_* columns
    beside the ministry's (public_lists_for_signup, public_contact_form). */
export function rowLook(row) {
  row = row || {};
  return lookFor(row, { accent: row.look_accent, accent2: row.look_accent2,
                        turn: row.look_turn, theme: row.look_theme });
}

/* ---- READABILITY -----------------------------------------------------------
   A ministry may pick any color at all, and some are unreadable as text on
   some pages — a pale yellow on white, a navy on a dark page. The widgets
   draw their colored TEXT (a percentage, an amount, a date) in a version
   nudged just far enough in lightness to reach `min` contrast against the
   page, and pick white or near-black for words ON the color (a button). The
   fills, dots and bars keep the color exactly as chosen. */

function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
/** WCAG relative luminance of a hex. */
export function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio between two hexes. */
export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** `hex`, lightened or darkened only as far as it takes to read on `bg`. */
export function readable(hex, bg, min = 3) {
  const o = hexToHsl(hex);
  if (!o) return hex;
  const up = luminance(bg) < 0.5;
  let c = hslToHex(o), i = 0;
  while (contrast(c, bg) < min && i < 100) {
    o.l = Math.max(0, Math.min(1, o.l + (up ? 0.01 : -0.01)));
    c = hslToHex(o);
    i++;
  }
  return c;
}
/** White or near-black, whichever reads better on `hex`. */
export function onColor(hex) {
  return contrast("#ffffff", hex) >= contrast("#12121a", hex) ? "#ffffff" : "#12121a";
}

/** rgba() from a hex and an alpha — for glows, where a hex cannot carry one. */
export function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return `rgba(109,74,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}


/* ===========================================================================
   THE SAME MATHS, AS SOURCE A BROWSER CAN RUN

   The widgets are shipped to other people's websites as strings, so they
   cannot import this module — the maths has to travel with them. Rather than
   let each widget carry its own transcription, they share this one, and
   workers/test/embed-colour.test.mjs evaluates it and compares every result
   against the functions above. A copy that is checked against its original on
   every run is a copy that cannot quietly drift.

   TWO CONSTRAINTS while editing: no backticks and no dollar-brace, because
   this is inlined into template literals that build widget source.

   embed-widget.js carried its own transcription until the readability maths
   arrived (0040); it inlines this one now, so there is one browser copy.
   =========================================================================== */
export const COLOUR_JS = [
  "function hexToHsl(hex) {",
  "  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());",
  "  if (!m) return null;",
  "  var n = parseInt(m[1], 16);",
  "  var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;",
  "  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);",
  "  var l = (mx + mn) / 2, d = mx - mn;",
  "  if (d === 0) return { h: 0, s: 0, l: l };",
  "  var s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), h;",
  "  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));",
  "  else if (mx === g) h = (b - r) / d + 2;",
  "  else h = (r - g) / d + 4;",
  "  return { h: h * 60, s: s, l: l };",
  "}",
  "function hslToHex(o) {",
  "  var h = ((o.h % 360) + 360) % 360, s = o.s, l = o.l;",
  "  var c = (1 - Math.abs(2 * l - 1)) * s;",
  "  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));",
  "  var m = l - c / 2, r = 0, g = 0, b = 0;",
  "  if (h < 60) { r = c; g = x; }",
  "  else if (h < 120) { r = x; g = c; }",
  "  else if (h < 180) { g = c; b = x; }",
  "  else if (h < 240) { g = x; b = c; }",
  "  else if (h < 300) { r = x; b = c; }",
  "  else { r = c; b = x; }",
  "  function to(v) { var q = Math.round((v + m) * 255).toString(16); return q.length < 2 ? '0' + q : q; }",
  "  return '#' + to(r) + to(g) + to(b);",
  "}",
  "function companion(hex, turn) {",
  "  var o = hexToHsl(hex);",
  "  if (!o) return hex;",
  "  if (o.s < 0.12) {",
  "    var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);",
  "    return hslToHex({ h: o.h, s: o.s, l: l });",
  "  }",
  "  var t = typeof turn === 'number' && isFinite(turn) ? turn : -33;",
  "  return hslToHex({ h: o.h + t, s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });",
  "}",
  "function channel(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }",
  "function luminance(hex) {",
  "  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());",
  "  if (!m) return 0;",
  "  var n = parseInt(m[1], 16);",
  "  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);",
  "}",
  "function contrast(a, b) {",
  "  var x = luminance(a), y = luminance(b);",
  "  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);",
  "}",
  "function readable(hex, bg, min) {",
  "  if (min === undefined) min = 3;",
  "  var o = hexToHsl(hex);",
  "  if (!o) return hex;",
  "  var up = luminance(bg) < 0.5, c = hslToHex(o), i = 0;",
  "  while (contrast(c, bg) < min && i < 100) {",
  "    o.l = Math.max(0, Math.min(1, o.l + (up ? 0.01 : -0.01)));",
  "    c = hslToHex(o);",
  "    i++;",
  "  }",
  "  return c;",
  "}",
  "function onColor(hex) {",
  "  return contrast('#ffffff', hex) >= contrast('#12121a', hex) ? '#ffffff' : '#12121a';",
  "}",
  "function alpha(hex, a) {",
  "  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());",
  "  if (!m) return 'rgba(109,74,255,' + a + ')';",
  "  var n = parseInt(m[1], 16);",
  "  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';",
  "}",
].join("\n");
