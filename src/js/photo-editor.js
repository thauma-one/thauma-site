/* photo-editor.js — one photo editor for every place a photo goes
   =========================================================================
   Chase, 2026-10-04: "Maybe building it as one big photo editor where certain
   parameters are allowed depending on the purpose of the photo editor? That
   way we can reuse the code in multiple places?" Yes — this is that.

   NON-DESTRUCTIVE. The original is uploaded once and never changed. What the
   editor returns is a small description of the choices — which part of the
   photo, how dark, what corners, what border — and each place draws it:
   a site with CSS (workers/src/site/render.js, `edited`), an email or a share
   picture by asking this file for the finished pixels (`exportBlob`),
   because a mail client or a social app cannot apply settings. Re-opening
   the editor starts from the original again, so nothing degrades and no pile
   of edited copies grows in storage.

   ONE TABLE OF PURPOSES. A place that takes a photo names its purpose; the
   purpose decides which controls appear and which shapes are allowed. A new
   place is a new row here, not new code.

   TWO WAYS OF CHOOSING THE PART OF THE PHOTO:
     crop   a rectangle, of a fixed shape or free, moved and resized on the
            photo — for frames with a fixed shape (a side photo, an email
            picture, a share picture);
     focus  a point that must stay in view and a zoom — for frames whose shape
            changes with the screen (a full-width band, a background).
   Pinching zooms either way: two fingers on a phone, or a trackpad.

   The value:
     crop:  { x, y, w, h, ar, darken?, corners?, border? }   x..h fractions
            0-1 of the original; ar the crop's real width ÷ height;
            border { w: px, c: 'accent' | 'accent2' | '#rrggbb' }
     focus: { fx, fy, zoom, darken }                          fx/fy 0-100
     { remove: true } when the person removed the photo.
   ========================================================================= */
(function () {
  'use strict';

  var SHAPES = {
    free: null, original: 'own', square: 1, portrait: 4 / 5, tall: 2 / 3, landscape: 4 / 3, wide: 16 / 9, share: 1.91
  };
  /* WHAT EACH PLACE MAY DO. `shapes` lists the shapes offered (the first is
     the default); the flags switch controls on. */
  var PURPOSES = {
    section:    { mode: 'crop', shapes: ['original', 'free', 'square', 'portrait', 'landscape', 'wide'], corners: true, border: true },
    framed:     { mode: 'crop', shapes: ['portrait'], corners: true, border: true },
    /* A full-width band takes the shape of its crop (Chase, 2026-10-04: "I
       still don't have free controls for the Full Width Photo section"). */
    band:       { mode: 'crop', shapes: ['free', 'wide', 'share', 'landscape'], darken: true },
    background: { mode: 'focus', darken: true, window: 16 / 9 },
    mail:       { mode: 'crop', shapes: ['original', 'free', 'wide', 'landscape', 'square', 'portrait'], max: 1200 },
    share:      { mode: 'crop', shapes: ['share', 'free'], max: 1200 }
  };

  var t = function (key, fallback) {
    var got = window.StaffI18n && window.StaffI18n.t ? window.StaffI18n.t(key) : null;
    return got && got !== key ? got : fallback;
  };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function load(src) {
    return new Promise(function (ok, no) {
      var i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = function () { ok(i); };
      i.onerror = function () { no(new Error(t('pe.cannotLoad', 'That photo could not be opened.'))); };
      i.src = src;
    });
  }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var ratio = function (shape, W, H) { var r = SHAPES[shape]; return r === 'own' ? W / H : r; };

  /* The biggest rectangle of shape `ar` (pixel width ÷ height) inside the
     photo, centered — where a crop starts before anyone touches it. */
  function fit(W, H, ar) {
    if (!ar) return { x: 0, y: 0, w: 1, h: 1 };
    var w = 1, h = (W / ar) / H;
    if (h > 1) { h = 1; w = (H * ar) / W; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h };
  }
  /* A border's color as CSS: the site's own two colors by name, or a hex. */
  function borderColor(c, accent, accent2) { return c === 'subtle' ? 'rgba(255,255,255,.28)' : c === 'accent2' ? accent2 : c === 'accent' || !c ? accent : c; }

  /* ----------------------------------------------------------------- open */
  /**
   * @param {string} src   the ORIGINAL photo (same origin)
   * @param {object} opts  { purpose, value, accent, accent2, removable }
   * @returns {Promise<object|null>}  the value, { remove: true }, or null when canceled
   */
  function open(src, opts) {
    opts = opts || {};
    var P = PURPOSES[opts.purpose] || PURPOSES.section;
    return load(src).then(function (img) {
      return new Promise(function (resolve) { build(img, P, opts, resolve); });
    });
  }

  function build(img, P, opts, resolve) {
    var W = img.naturalWidth, H = img.naturalHeight, start = opts.value || null;
    var accent = opts.accent || '#1AE4FF', accent2 = opts.accent2 || accent;
    var v;
    if (P.mode === 'crop') {
      var shape = P.shapes[0];
      if (start && start.ar) {
        shape = P.shapes.filter(function (s) { var r = ratio(s, W, H); return r && Math.abs(r - start.ar) < 0.02; })[0] ||
          (P.shapes.indexOf('free') !== -1 ? 'free' : P.shapes[0]);
      }
      var r0 = start && start.w ? { x: start.x, y: start.y, w: start.w, h: start.h } : fit(W, H, ratio(shape, W, H));
      var b0 = start && start.border;
      if (typeof b0 === 'string') b0 = { w: b0 === 'thin' ? 1 : 3, c: b0 === 'thin' ? '#ffffff' : 'accent' };
      v = { shape: shape, x: r0.x, y: r0.y, w: r0.w, h: r0.h, darken: (start && start.darken) || 0,
            corners: (start && start.corners) || 'soft', bw: b0 ? b0.w : 0, bc: b0 ? b0.c : 'accent' };
    } else {
      v = { fx: start && start.fx != null ? start.fx : 50, fy: start && start.fy != null ? start.fy : 50,
            zoom: (start && start.zoom) || 1, darken: (start && start.darken) || 0 };
    }

    /* ---- the dialog: title, the photo beside its controls, the actions ---- */
    var back = el('div', 'pe-back');
    var box = el('div', 'pe');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('pe.title', 'Edit photo'));
    var head = el('div', 'pe-head');
    head.appendChild(el('h3', null, t('pe.title', 'Edit photo')));
    var x = el('button', 'pe-x', '×');
    x.type = 'button'; x.setAttribute('aria-label', t('pe.cancel', 'Cancel'));
    head.appendChild(x);
    var body = el('div', 'pe-body');
    var stage = el('div', 'pe-stage');
    var pic = el('img', 'pe-img');
    pic.src = img.src; pic.alt = ''; pic.draggable = false;
    var win = el('div', 'pe-win');
    var canFree = P.mode === 'crop' && P.shapes.indexOf('free') !== -1;
    /* Corners, and the four edges where the shape may be free. */
    if (P.mode === 'crop') ['nw', 'ne', 'sw', 'se'].concat(canFree ? ['n', 's', 'e', 'w'] : []).forEach(function (c) { var hd = el('span', 'pe-h pe-' + c); hd.dataset.h = c; win.appendChild(hd); });
    else win.appendChild(el('span', 'pe-dot'));
    stage.appendChild(pic); stage.appendChild(win);

    var side = el('div', 'pe-side');
    var prevWrap = el('div', 'pe-prevwrap');
    var prev = el('div', 'pe-prev'), prevImg = el('img'), shade = el('i', 'pe-shade');
    prevImg.src = img.src; prevImg.alt = '';
    prev.appendChild(prevImg); prev.appendChild(shade);
    side.appendChild(el('span', 'pe-lbl', t('pe.result', 'Result')));
    prevWrap.appendChild(prev);
    side.appendChild(prevWrap);

    function chips(label, list, cur, onPick) {
      var row = el('div', 'pe-row');
      row.appendChild(el('span', 'pe-lbl', label));
      var g = el('div', 'pe-chips');
      list.forEach(function (o) {
        var b = el('button', 'pe-chip', o[1]);
        b.type = 'button';
        if (o[2]) { b.classList.add('pe-swatch'); b.style.setProperty('--sw', o[2]); b.setAttribute('aria-label', o[1]); b.title = o[1]; b.textContent = ''; }
        b.setAttribute('aria-pressed', o[0] === cur ? 'true' : 'false');
        b.addEventListener('click', function () {
          [].forEach.call(g.querySelectorAll('.pe-chip'), function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
          onPick(o[0]);
        });
        g.appendChild(b);
      });
      row.appendChild(g);
      side.appendChild(row);
      return g;
    }
    function slider(label, min, max, step, cur, onMove) {
      var row = el('label', 'pe-row');
      row.appendChild(el('span', 'pe-lbl', label));
      var s = el('input');
      s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = cur;
      s.addEventListener('input', function () { onMove(+s.value); });
      row.appendChild(s);
      side.appendChild(row);
      return s;
    }

    var shapeChips = null;
    if (P.mode === 'crop' && P.shapes.length > 1) {
      shapeChips = chips(t('pe.shape', 'Shape'), P.shapes.map(function (s) { return [s, t('pe.shape.' + s, s)]; }), v.shape, function (s) {
        v.shape = s;
        var ar = ratio(s, W, H);
        if (ar) {
          var r2 = fit(W, H, ar), cx = v.x + v.w / 2, cy = v.y + v.h / 2;
          v.w = r2.w; v.h = r2.h;
          v.x = clamp(cx - v.w / 2, 0, 1 - v.w); v.y = clamp(cy - v.h / 2, 0, 1 - v.h);
        }
        draw();
      });
    }
    var zoomSlider = P.mode === 'focus' ? slider(t('pe.zoom', 'Zoom'), 1, 3, 0.01, v.zoom, function (z) { v.zoom = z; draw(); }) : null;
    if (P.darken) slider(t('pe.darken', 'Darken'), 0, 0.7, 0.01, v.darken, function (d) { v.darken = d; draw(); });
    if (P.corners) chips(t('pe.corners', 'Corners'), [['square', t('pe.corners.square', 'Square')], ['soft', t('pe.corners.soft', 'Soft')], ['round', t('pe.corners.round', 'Round')]], v.corners, function (c) { v.corners = c; draw(); });
    if (P.border) {
      /* Width as Photoshop shows it: − [px] +, half pixels allowed. */
      var brow = el('div', 'pe-row');
      brow.appendChild(el('span', 'pe-lbl', t('pe.border', 'Border')));
      var step = el('div', 'pe-step');
      var minus = el('button', 'pe-chip', '−'), plus = el('button', 'pe-chip', '+'), num = el('input'), unit = el('span', 'pe-unit', 'px');
      minus.type = plus.type = 'button';
      minus.setAttribute('aria-label', t('ws.fmt.smaller', 'Smaller')); plus.setAttribute('aria-label', t('ws.fmt.larger', 'Larger'));
      num.type = 'number'; num.min = '0'; num.max = '40'; num.step = '0.5'; num.value = v.bw; num.setAttribute('aria-label', t('pe.border', 'Border'));
      var setW = function (w) { v.bw = Math.max(0, Math.min(40, Math.round(w * 2) / 2)); num.value = v.bw; draw(); };
      minus.addEventListener('click', function () { setW(v.bw - 0.5); });
      plus.addEventListener('click', function () { setW(v.bw + 0.5); });
      num.addEventListener('input', function () { if (num.value !== '') setW(+num.value); });
      [minus, num, unit, plus].forEach(function (n) { step.appendChild(n); });
      brow.appendChild(step); side.appendChild(brow);
      /* The same color choice as the text: quiet, the site's two colors,
         white, black, any. */
      var g2 = chips(t('pe.borderColor', 'Border color'), [
        ['subtle', t('pe.subtle', 'Subtle'), 'rgba(255,255,255,.28)'],
        ['accent', t('ml.cpToneAccent', 'Brand color'), accent], ['accent2', t('ml.cpToneAccent2', 'Second color'), accent2],
        ['#ffffff', t('pe.white', 'White'), '#ffffff'], ['#000000', t('pe.black', 'Black'), '#000000']
      ], v.bc, function (c) { v.bc = c; if (!v.bw) setW(2); else draw(); });
      var any = el('label', 'pe-chip pe-any');
      any.title = t('ml.cpToneAny', 'Any color');
      var pick = el('input'); pick.type = 'color'; pick.value = /^#/.test(v.bc) ? v.bc : '#3366cc';
      pick.setAttribute('aria-label', t('ml.cpToneAny', 'Any color'));
      pick.addEventListener('input', function () {
        v.bc = pick.value; if (!v.bw) setW(2);
        [].forEach.call(g2.querySelectorAll('.pe-chip'), function (c) { c.setAttribute('aria-pressed', 'false'); });
        draw();
      });
      any.appendChild(pick); g2.appendChild(any);
    }

    var acts = el('div', 'pe-acts');
    var remove = opts.removable ? el('button', 'link-btn pe-remove', t('pe.remove', 'Remove photo')) : null;
    var reset = el('button', 'ghost-btn', t('pe.reset', 'Start over'));
    var cancel = el('button', 'ghost-btn', t('pe.cancel', 'Cancel'));
    var done = el('button', 'solid-btn', t('pe.done', 'Done'));
    [remove, reset, cancel, done].forEach(function (b) { if (b) { b.type = 'button'; acts.appendChild(b); } });

    body.appendChild(stage); body.appendChild(side);
    box.appendChild(head); box.appendChild(body); box.appendChild(acts);
    back.appendChild(box);
    document.body.appendChild(back);
    document.documentElement.classList.add('pe-open');

    /* ---- drawing ---- */
    function draw() {
      var sw = pic.clientWidth, sh = pic.clientHeight;
      var PW = 280, PH = 170, ar;
      if (P.mode === 'crop') {
        win.style.left = v.x * sw + 'px'; win.style.top = v.y * sh + 'px';
        win.style.width = v.w * sw + 'px'; win.style.height = v.h * sh + 'px';
        ar = (v.w * W) / (v.h * H);
        prevImg.style.cssText = 'position:absolute;max-width:none;width:' + (100 / v.w) + '%;left:' + (-v.x / v.w * 100) + '%;top:' + (-v.y / v.h * 100) + '%';
        prev.style.borderRadius = v.corners === 'round' ? '24px' : v.corners === 'soft' ? '10px' : '0';
        prev.style.boxShadow = P.border && v.bw ? '0 0 0 ' + v.bw + 'px ' + borderColor(v.bc, accent, accent2) : 'none';
      } else {
        ar = P.window;
        /* The window a typical screen shows: as much of the photo as fits at
           this zoom, in the frame's usual shape, around the point. */
        var ww = Math.min(1, (H * ar) / W) / v.zoom, wh = Math.min(1, W / ar / H) / v.zoom;
        var px = clamp(v.fx / 100 - ww / 2, 0, 1 - ww), py = clamp(v.fy / 100 - wh / 2, 0, 1 - wh);
        win.style.left = px * sw + 'px'; win.style.top = py * sh + 'px';
        win.style.width = ww * sw + 'px'; win.style.height = wh * sh + 'px';
        win.firstChild.style.left = ((v.fx / 100 - px) / ww * 100) + '%';
        win.firstChild.style.top = ((v.fy / 100 - py) / wh * 100) + '%';
        prevImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:' + v.fx + '% ' + v.fy + '%;transform:scale(' + v.zoom + ');transform-origin:' + v.fx + '% ' + v.fy + '%';
        if (zoomSlider) zoomSlider.value = v.zoom;
      }
      /* The result at its TRUE shape, inside a box — sized here, because a
         height cap on an aspect-ratio box squashes it out of shape. */
      var pw = Math.min(PW, PH * ar), ph = pw / ar;
      prev.style.width = Math.round(pw) + 'px'; prev.style.height = Math.round(ph) + 'px';
      shade.style.background = 'rgba(0,0,0,' + (v.darken || 0) + ')';
    }

    /* ---- zooming: pinch on a phone or a trackpad, or the slider ---- */
    function zoomBy(f) {
      if (P.mode === 'focus') { v.zoom = clamp(v.zoom * f, 1, 3); return draw(); }
      /* A crop zooms by shrinking or growing around its middle, in shape. */
      var cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      var w = clamp(v.w / f, 0.05, 1), h = clamp(v.h / f, 0.05, 1);
      var k = Math.min(w / v.w, h / v.h);
      w = v.w * k; h = v.h * k;
      if (w > 1 || h > 1) { var m = Math.max(w, h); w /= m; h /= m; }
      v.w = w; v.h = h;
      v.x = clamp(cx - w / 2, 0, 1 - w); v.y = clamp(cy - h / 2, 0, 1 - h);
      draw();
    }
    stage.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;              // a trackpad pinch arrives as ctrl+wheel
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01));
    }, { passive: false });
    var gScale = 1;                         // Safari's own trackpad gesture
    stage.addEventListener('gesturestart', function (e) { e.preventDefault(); gScale = 1; });
    stage.addEventListener('gesturechange', function (e) { e.preventDefault(); zoomBy(e.scale / gScale); gScale = e.scale; });

    /* ---- moving and resizing with a pointer; two fingers pinch ---- */
    var drag = null, fingers = {}, pinch = null;
    function at(e) { var r = pic.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
    function spread() { var p = Object.keys(fingers).map(function (k) { return fingers[k]; }); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
    stage.addEventListener('pointerdown', function (e) {
      fingers[e.pointerId] = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (Object.keys(fingers).length === 2) { drag = null; pinch = spread(); return; }
      var p = at(e);
      if (P.mode === 'focus') {
        v.fx = clamp(p.x * 100, 0, 100); v.fy = clamp(p.y * 100, 0, 100); draw();
        drag = { focus: true };
      } else if (e.target.dataset.h) {
        /* Dragging a handle means "this shape, by hand": Free, where allowed. */
        if (canFree && v.shape !== 'free') {
          v.shape = 'free';
          if (shapeChips) [].forEach.call(shapeChips.querySelectorAll('.pe-chip'), function (c, i) { c.setAttribute('aria-pressed', P.shapes[i] === 'free' ? 'true' : 'false'); });
        }
        drag = { h: e.target.dataset.h, s: p, r: { x: v.x, y: v.y, w: v.w, h: v.h } };
      } else if (e.target === win) {
        drag = { move: true, s: p, r: { x: v.x, y: v.y, w: v.w, h: v.h } };
      }
    });
    stage.addEventListener('pointermove', function (e) {
      if (fingers[e.pointerId]) fingers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && Object.keys(fingers).length === 2) { var d = spread(); zoomBy(d / pinch); pinch = d; return; }
      if (!drag) return;
      var p = at(e);
      if (drag.focus) { v.fx = clamp(p.x * 100, 0, 100); v.fy = clamp(p.y * 100, 0, 100); return draw(); }
      var dx = p.x - drag.s.x, dy = p.y - drag.s.y, r = drag.r;
      if (drag.move) {
        v.x = clamp(r.x + dx, 0, 1 - r.w); v.y = clamp(r.y + dy, 0, 1 - r.h);
        return draw();
      }
      /* An edge: only that side moves. */
      if (drag.h.length === 1) {
        var hh = drag.h;
        if (hh === 'w') { var nx2 = clamp(r.x + dx, 0, r.x + r.w - 0.05); v.x = nx2; v.w = r.x + r.w - nx2; }
        if (hh === 'e') { v.w = clamp(r.w + dx, 0.05, 1 - r.x); }
        if (hh === 'n') { var ny2 = clamp(r.y + dy, 0, r.y + r.h - 0.05); v.y = ny2; v.h = r.y + r.h - ny2; }
        if (hh === 's') { v.h = clamp(r.h + dy, 0.05, 1 - r.y); }
        return draw();
      }
      /* A corner: the opposite corner stays put; a fixed shape keeps its
         shape, measured in pixels, not fractions. Free is any rectangle. */
      var left = drag.h.indexOf('w') !== -1, top = drag.h.indexOf('n') !== -1;
      var ax = left ? r.x + r.w : r.x, ay = top ? r.y + r.h : r.y;
      var nx = clamp(left ? r.x + dx : r.x + r.w + dx, 0, 1), ny = clamp(top ? r.y + dy : r.y + r.h + dy, 0, 1);
      var w = Math.max(0.05, Math.abs(ax - nx)), h = Math.max(0.05, Math.abs(ay - ny));
      var ar = ratio(v.shape, W, H);
      if (ar) {
        var hFromW = (w * W / ar) / H;
        if (hFromW <= 1) h = hFromW; else { h = 1; w = (H * ar) / W; }
        var ex = left ? ax - w : ax + w, ey = top ? ay - h : ay + h;
        if (ex < 0 || ex > 1 || ey < 0 || ey > 1) return;
      }
      v.w = w; v.h = h;
      v.x = left ? ax - w : ax; v.y = top ? ay - h : ay;
      draw();
    });
    function lift(e) { delete fingers[e.pointerId]; if (Object.keys(fingers).length < 2) pinch = null; drag = null; }
    stage.addEventListener('pointerup', lift);
    stage.addEventListener('pointercancel', lift);

    function close(result) {
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', draw);
      document.documentElement.classList.remove('pe-open');
      back.remove();
      resolve(result);
    }
    function key(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', key);
    x.addEventListener('click', function () { close(null); });
    cancel.addEventListener('click', function () { close(null); });
    back.addEventListener('click', function (e) { if (e.target === back) close(null); });
    if (remove) remove.addEventListener('click', function () { close({ remove: true }); });
    reset.addEventListener('click', function () {
      if (P.mode === 'crop') { var r1 = fit(W, H, ratio(v.shape, W, H)); v.x = r1.x; v.y = r1.y; v.w = r1.w; v.h = r1.h; v.darken = 0; }
      else { v.fx = 50; v.fy = 50; v.zoom = 1; v.darken = 0; }
      draw();
    });
    done.addEventListener('click', function () {
      if (P.mode === 'crop') {
        var out = { x: +v.x.toFixed(4), y: +v.y.toFixed(4), w: +v.w.toFixed(4), h: +v.h.toFixed(4), ar: +((v.w * W) / (v.h * H)).toFixed(4) };
        if (P.darken && v.darken) out.darken = +v.darken.toFixed(2);
        if (P.corners) out.corners = v.corners;
        if (P.border && v.bw) out.border = { w: v.bw, c: v.bc };
        return close(out);
      }
      close({ fx: Math.round(v.fx), fy: Math.round(v.fy), zoom: +v.zoom.toFixed(2), darken: +(v.darken || 0).toFixed(2) });
    });

    /* Drawn once the photo has its size on screen — a photo already in the
       browser's memory can report "complete" before it has one, and a
       window drawn then is zero by zero. */
    pic.addEventListener('load', draw);
    (pic.decode ? pic.decode() : Promise.resolve()).then(function () { requestAnimationFrame(draw); }, function () { requestAnimationFrame(draw); });
    window.addEventListener('resize', draw);
    done.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------- the pixels */
  /**
   * The finished picture, for places that cannot apply settings (an email, a
   * share picture): the crop, at most `max` pixels on its long edge, darkened
   * if asked, as a JPEG (or another type when asked).
   */
  function exportBlob(src, value, opts) {
    opts = opts || {};
    var max = opts.max || 1200;
    return load(src).then(function (img) {
      var W = img.naturalWidth, H = img.naturalHeight, c = value && value.w ? value : { x: 0, y: 0, w: 1, h: 1 };
      var sw = c.w * W, sh = c.h * H, k = Math.min(1, max / Math.max(sw, sh));
      var cv = document.createElement('canvas');
      cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
      var g = cv.getContext('2d');
      g.drawImage(img, c.x * W, c.y * H, sw, sh, 0, 0, cv.width, cv.height);
      if (value && value.darken) { g.fillStyle = 'rgba(0,0,0,' + value.darken + ')'; g.fillRect(0, 0, cv.width, cv.height); }
      return new Promise(function (r) { cv.toBlob(r, opts.type || 'image/jpeg', 0.86); });
    });
  }

  window.PhotoEditor = { open: open, exportBlob: exportBlob, PURPOSES: PURPOSES, SHAPES: SHAPES };
})();
