/**
 * embed-colour.js — deriving the SECOND colour of the pair
 *
 * chaseroush.com's timeline runs on two clearly different colours, and the
 * legend is where you see it plainly: completed is green, in progress is cyan,
 * upcoming is a hollow ring. The rail's gradient runs between the two. That
 * pair is the identity of the thing — collapsing it into one accent, as the
 * first version of this widget did, loses the ability to tell finished work
 * from work in flight at a glance.
 *
 * Thauma cannot ship a fixed pair, because the accent is chosen per partner.
 * So the second colour is DERIVED from the first, keeping the same
 * relationship CR's pair has: cyan (#00D4FF, hue 190°) to green (#00FF9F, hue
 * 157°) is a rotation of about -33° with the saturation and lightness left
 * alone. Applied to any accent, that produces a companion which is recognisably
 * related and clearly distinct.
 *
 * WHY IN JAVASCRIPT RATHER THAN color-mix
 * ---------------------------------------------------------------------------
 * color-mix cannot rotate a hue — mixing toward white only lightens, which is
 * what the earlier version did and why both ends of the gradient read as the
 * same colour. Doing it here also means the two colours are real hex values
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
 * The companion colour: what "completed" is drawn in when the accent means
 * "in progress".
 *
 * -33°, the same rotation that separates CR's cyan from its green.
 *
 * A GREY ACCENT IS THE ONE CASE THAT HAS TO BE HANDLED, and it is not
 * theoretical — a partner choosing black, white or a neutral is entirely
 * plausible. Rotating the hue of something with no saturation returns the same
 * colour, so the pair would silently collapse back into one. There, the second
 * colour is separated by LIGHTNESS instead, which is the only axis a grey has.
 */
export function companion(hex) {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;

  if (hsl.s < 0.12) {
    const l = hsl.l > 0.5 ? Math.max(0.28, hsl.l - 0.3) : Math.min(0.82, hsl.l + 0.3);
    return hslToHex({ h: hsl.h, s: hsl.s, l });
  }

  return hslToHex({
    h: hsl.h - 33,
    /* Nudged up a little, because the eye reads the completed colour as the
       "arrived" one and a flatter version of the accent reads as faded. */
    s: Math.min(1, hsl.s * 1.05),
    l: Math.min(0.72, hsl.l * 1.04),
  });
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

   embed-widget.js still carries its own transcription. It predates this and
   is covered by its own comparison test, so it is left alone rather than
   changed to prove a point about tidiness — but it is the next thing to fold
   in here if either is touched again.
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
  "function companion(hex) {",
  "  var o = hexToHsl(hex);",
  "  if (!o) return hex;",
  "  if (o.s < 0.12) {",
  "    var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);",
  "    return hslToHex({ h: o.h, s: o.s, l: l });",
  "  }",
  "  return hslToHex({ h: o.h - 33, s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });",
  "}",
  "function alpha(hex, a) {",
  "  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());",
  "  if (!m) return 'rgba(109,74,255,' + a + ')';",
  "  var n = parseInt(m[1], 16);",
  "  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';",
  "}",
].join("\n");
