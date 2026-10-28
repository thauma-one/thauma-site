/* ============================================================
   logo-conductor.js — one clock for the logo's shimmer and the line
   ============================================================
   The landing page (coming-soon.njk) and the closed page (workers/src/
   site/serve.js closedSite, which inlines this file from the deploy) both
   show the logo with its shimmer and, under it, the footer line in every
   published language. Chase, 2026-10-19:

     "can we align the cascade and the shimmer glow somehow? … they feel
      like 2 different things instead of 1 cohesive whole … sync up the
      shimmer with the cascade so that the letters cascade when the shimmer
      is above it … a consistent interval … increase [each language] to 8
      … when I open another tab … whenever I go back to the tab, it could
      possibly cycle through 2 different languages immediately."

   SO ONE CLOCK, ONE CYCLE OF 8s: the band of light sweeps the logo, and
   each character of the line changes at the moment the band passes over
   it — the old one cascades down and out, the new one down and in, under
   the light. Every language is up for the same 8s, counted from the start
   of its own cascade. The band waits fully off the logo between sweeps
   (it could be seen resting on the arriving line's end).

   NOTHING RUNS IN A HIDDEN TAB: the sweep is drawn frame by frame (frames
   stop when the tab is hidden) and the next cycle is only scheduled while
   the page is visible — coming back starts a fresh cycle a moment later,
   never two at once.

   2026-10-28 (Chase): "the shimmer can slow down as well as the cascade
   effect" — the sweep takes 3.8s (was 2.6s) and each character 1.6s (was
   1.1s, .cs-ch in both pages); the cycle stays 8s. The first sweep comes
   at 1.3s, with the logo.

   Reduced motion: the line in the page's language, still; no sweep.

   Reads: window.THAUMA_LINES = { lines: [...], start: ms }
          .brand-logo-sheen linearGradient   the band
          [data-cascade] .cs-out / .cs-in    the line
   ============================================================ */
(function () {
  'use strict';
  var C = window.THAUMA_LINES || {}, lines = C.lines || [];
  var logo = document.querySelector('.brand-logo-split');
  var grad = document.querySelector('.brand-logo-sheen linearGradient');
  var box = document.querySelector('[data-cascade]');
  var out = box && box.querySelector('.cs-out'), inn = box && box.querySelector('.cs-in');
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* the band, in the logo's own units: 2600 wide, parked well clear */
  var BAND = 2600, PARK = -9000, FROM = -1450 - BAND, TO = 7712;
  var CYCLE = 8000, SWEEP = 3800, START = C.start || 1300;
  if (grad) {
    Array.prototype.forEach.call(grad.querySelectorAll('animateTransform'), function (a) { a.parentNode.removeChild(a); });
  }
  function bandAt(x) { if (grad) grad.setAttribute('gradientTransform', 'translate(' + x.toFixed(1) + ' 0)'); }
  bandAt(PARK);

  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  /* when (0..1 of the sweep) the band's middle reaches x */
  function whenAt(x) {
    var want = (x - (FROM + BAND / 2)) / (TO - FROM);
    if (want <= 0) return 0;
    if (want >= 1) return 1;
    var lo = 0, hi = 1;
    for (var k = 0; k < 24; k++) { var mid = (lo + hi) / 2; if (ease(mid) < want) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }
  /* a point on the screen, in the logo's units */
  function toLogo(px) {
    if (!logo || !logo.getScreenCTM) return 0;
    var m = logo.getScreenCTM(), pt = logo.createSVGPoint();
    pt.x = px; pt.y = 0;
    return pt.matrixTransform(m.inverse()).x;
  }

  var i = -1, timer = null, raf = 0;
  function chars(el, s) {
    el.textContent = '';
    Array.from(s || '').forEach(function (c) {
      var x = document.createElement('span'); x.className = 'cs-ch'; x.textContent = c; x.style.animationPlayState = 'paused'; el.appendChild(x);
    });
  }
  /* each character starts its turn when the light reaches it */
  function cue(el) {
    Array.prototype.forEach.call(el.children, function (c) {
      var r = c.getBoundingClientRect();
      c.style.animationDelay = Math.round(whenAt(toLogo(r.left + r.width / 2)) * SWEEP) + 'ms';
      c.style.animationPlayState = 'running';
    });
  }
  function sweep() {
    var t0 = performance.now();
    cancelAnimationFrame(raf);
    (function frame(now) {
      var t = Math.min(1, (now - t0) / SWEEP);
      bandAt(FROM + ease(t) * (TO - FROM));
      if (t < 1) raf = requestAnimationFrame(frame); else bandAt(PARK);
    })(t0);
  }
  function cycle() {
    timer = null;
    if (document.hidden) return;                 /* picked up again on return */
    if (box && lines.length && (i < 0 || lines.length > 1)) {
      var next = (i + 1) % lines.length;
      chars(out, i < 0 ? '' : lines[i]);
      chars(inn, lines[next]);
      box.setAttribute('aria-label', lines[next]);
      i = next;
      cue(out); cue(inn);
    }
    sweep();
    timer = setTimeout(cycle, CYCLE);
  }

  if (still || !grad) {
    if (box && lines.length) { chars(inn, lines[0]); Array.prototype.forEach.call(inn.children, function (c) { c.style.animation = 'none'; }); }
    return;
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { clearTimeout(timer); timer = null; cancelAnimationFrame(raf); bandAt(PARK); }
    else if (!timer) timer = setTimeout(cycle, 900);
  });
  timer = setTimeout(cycle, START);
})();
