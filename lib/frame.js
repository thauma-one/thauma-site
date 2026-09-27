/**
 * frame.js — how a framed photo is placed, for the site and for Photos
 *
 * A framed photo (.frame img, 21:9) is set by four values in site.json:
 * src, focal_x, focal_y, zoom. The site covers the frame with the picture,
 * slides it by object-position to the focus, and scales it by zoom/100.
 * While the page scrolls, main.js ("whisper-parallax") holds it at
 * zoom × HEADROOM and drifts it up and down by DRIFT of the frame's height.
 *
 * THE SCALE'S ORIGIN IS NOT ALWAYS THE FOCUS. A scaled picture only has
 * room to drift where the origin leaves it room: the edge stays hidden while
 * origin × (scale − 1) ≥ DRIFT above and below. With the origin at the focus,
 * a focus near the top or bottom showed the frame's edge mid-drift — so the
 * focus was fenced into a band (37.5–62.5% at zoom 100), and a photo could
 * not show its own top or bottom (Chase, 2026-09-27: "I'd like to be able to
 * reposition the parallax zone itself"). Now the ORIGIN is kept inside that
 * band and the focus is free: object-position still puts the focus where it
 * was asked, and zooming centers on it wherever the band allows. A focus
 * that was already inside the band — every photo before this — renders
 * exactly as before.
 *
 * DRIFT and HEADROOM must match main.js; test/photos-page.test.mjs reads
 * both files and fails if they part. admin-photos.js carries the same
 * arithmetic for the browser, checked by the same test.
 */
const DRIFT = 0.045;
const HEADROOM = 1.12;

/** The band the scale's origin must stay inside, in percent, for a zoom. */
function originBand(zoom) {
  const scale = Math.max(Number(zoom) / 100, 1) * HEADROOM;
  const edge = Math.min(0.5, DRIFT / (scale - 1)) * 100;
  return { min: edge, max: 100 - edge };
}

/** The inline style for a framed photo's <img>. */
function frameStyle(img) {
  const fx = Number(img && img.focal_x), fy = Number(img && img.focal_y), zoom = Number(img && img.zoom) || 100;
  const band = originBand(zoom);
  const oy = Math.min(band.max, Math.max(band.min, fy));
  const r = (n) => Math.round(n * 100) / 100;
  return `object-position:${r(fx)}% ${r(fy)}%;transform-origin:${r(fx)}% ${r(oy)}%;transform:scale(${zoom / 100})`;
}

module.exports = { DRIFT, HEADROOM, originBand, frameStyle };
