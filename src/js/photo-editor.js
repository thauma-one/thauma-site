/* photo-editor.js — one photo editor for every place a photo goes
   =========================================================================
   Chase, 2026-10-04: "Maybe building it as one big photo editor where certain
   parameters are allowed depending on the purpose of the photo editor? That
   way we can reuse the code in multiple places?" Yes — this is that.

   NON-DESTRUCTIVE. The original is uploaded once and never changed. What the
   editor returns is a small description of the choices — which part of the
   photo, how dark, what corners, what border — and each place draws it:
   a site with CSS (lib in workers/src/site/render.js, `framed`), an email or a
   share picture by asking this file for the finished pixels (`exportBlob`),
   because a mail client or a social app cannot apply settings. Re-opening the
   editor starts from the original again, so nothing degrades and no pile of
   edited copies grows in storage.

   ONE TABLE OF PURPOSES. A place that takes a photo names its purpose; the
   purpose decides which controls appear and which shapes are allowed. A new
   place is a new row here, not new code.

   TWO WAYS OF CHOOSING THE PART OF THE PHOTO:
     crop   a rectangle of a chosen shape, moved and resized on the photo —
            for frames with a fixed shape (a side photo, an email picture);
     focus  a point that must stay in view and a zoom — for frames whose shape
            changes with the screen (a full-width band, a background), where a
            fixed rectangle would be wrong on every other screen size.

   The value:
     crop:  { x, y, w, h, ar, darken, corners, border }   x..h fractions 0-1
            of the original; ar the crop's real width ÷ height in pixels
     focus: { fx, fy, zoom, darken }                       fx/fy 0-100

   No library, like photo-crop.js beside it: a rectangle, pointer handlers and
   one drawImage. Respects reduced motion (it has none to respect).
   ========================================================================= */
(function () {
  'use strict';

  var SHAPES = {
    original: null, square: 1, portrait: 4 / 5, tall: 2 / 3, landscape: 4 / 3, wide: 16 / 9, share: 1.91
  };
  /* WHAT EACH PLACE MAY DO. `shapes` lists the shapes offered (the first is
     the default); `locked` fixes one; the flags switch controls on. */
  var PURPOSES = {
    section: { mode: 'crop', shapes: ['original', 'square', 'portrait', 'landscape', 'wide'], corners: true, border: true },
    framed:  { mode: 'crop', shapes: ['portrait'], corners: true, border: true },
    band:    { mode: 'focus', darken: true, window: 16 / 6 },
    background: { mode: 'focus', darken: true, window: 16 / 9 },
    mail:    { mode: 'crop', shapes: ['original', 'wide', 'landscape', 'square', 'portrait'], export: true, max: 1200 },
    share:   { mode: 'crop', shapes: ['share'], export: true, max: 1200 }
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

  /* The biggest rectangle of shape `ar` (pixel width ÷ height) inside the
     photo, centered — where a crop starts before anyone touches it. */
  function fit(W, H, ar) {
    if (!ar) return { x: 0, y: 0, w: 1, h: 1 };
    var w = 1, h = (W / ar) / H;
    if (h > 1) { h = 1; w = (H * ar) / W; }
    return { x: (1 - w) / 2, y: (1 - h) / 2, w: w, h: h };
  }

  /* ----------------------------------------------------------------- open */
  /**
   * @param {string} src        the ORIGINAL photo (same origin)
   * @param {object} opts       { purpose, value, accent }
   * @returns {Promise<object|null>}  the value, or null when canceled
   */
  function open(src, opts) {
    opts = opts || {};
    var P = PURPOSES[opts.purpose] || PURPOSES.section;
    return load(src).then(function (img) {
      return new Promise(function (resolve) { build(img, P, opts.value || null, opts.accent || '#1AE4FF', resolve); });
    });
  }

  function build(img, P, start, accent, resolve) {
    var W = img.naturalWidth, H = img.naturalHeight;
    var v = {};
    if (P.mode === 'crop') {
      var shape = P.shapes[0];
      if (start && start.ar) {
        shape = P.shapes.filter(function (s) { return SHAPES[s] && Math.abs(SHAPES[s] - start.ar) < 0.02; })[0] ||
          (P.shapes.indexOf('original') !== -1 ? 'original' : P.shapes[0]);
      }
      var r = start && start.w ? { x: start.x, y: start.y, w: start.w, h: start.h } : fit(W, H, SHAPES[shape]);
      v = { shape: shape, x: r.x, y: r.y, w: r.w, h: r.h, darken: (start && start.darken) || 0,
            corners: (start && start.corners) || 'soft', border: (start && start.border) || 'none' };
    } else {
      v = { fx: start && start.fx != null ? start.fx : 50, fy: start && start.fy != null ? start.fy : 50,
            zoom: (start && start.zoom) || 1, darken: (start && start.darken) || 0 };
    }

    var back = el('div', 'pe-back');
    var box = el('div', 'pe');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('pe.title', 'Edit photo'));
    var stage = el('div', 'pe-stage');
    var pic = el('img', 'pe-img');
    pic.src = img.src; pic.alt = '';
    var win = el('div', 'pe-win');
    var handles = P.mode === 'crop' ? ['nw', 'ne', 'sw', 'se'].map(function (c) { var hd = el('span', 'pe-h pe-' + c); hd.dataset.h = c; win.appendChild(hd); return hd; }) : [];
    stage.appendChild(pic); stage.appendChild(win);

    var side = el('div', 'pe-side');
    var prev = el('div', 'pe-prev'), prevImg = el('img'), shade = el('i', 'pe-shade');
    prevImg.src = img.src; prevImg.alt = '';
    prev.appendChild(prevImg); prev.appendChild(shade);
    side.appendChild(el('span', 'pe-lbl', t('pe.result', 'Result')));
    side.appendChild(prev);

    function chips(label, opts2, cur, onPick) {
      var row = el('div', 'pe-row');
      row.appendChild(el('span', 'pe-lbl', label));
      var g = el('div', 'pe-chips');
      opts2.forEach(function (o) {
        var b = el('button', 'pe-chip', o[1]);
        b.type = 'button';
        b.setAttribute('aria-pressed', o[0] === cur ? 'true' : 'false');
        b.addEventListener('click', function () {
          [].forEach.call(g.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
          onPick(o[0]);
        });
        g.appendChild(b);
      });
      row.appendChild(g);
      side.appendChild(row);
    }
    function slider(label, min, max, step, cur, onMove) {
      var row = el('label', 'pe-row');
      row.appendChild(el('span', 'pe-lbl', label));
      var s = el('input');
      s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = cur;
      s.addEventListener('input', function () { onMove(+s.value); });
      row.appendChild(s);
      side.appendChild(row);
    }

    if (P.mode === 'crop' && P.shapes.length > 1) {
      chips(t('pe.shape', 'Shape'), P.shapes.map(function (s) { return [s, t('pe.shape.' + s, s)]; }), v.shape, function (s) {
        v.shape = s;
        var r2 = fit(W, H, SHAPES[s]);
        /* Keep the middle of what was chosen, in the new shape. */
        var cx = v.x + v.w / 2, cy = v.y + v.h / 2;
        v.w = r2.w; v.h = r2.h;
        v.x = clamp(cx - v.w / 2, 0, 1 - v.w); v.y = clamp(cy - v.h / 2, 0, 1 - v.h);
        draw();
      });
    }
    if (P.mode === 'focus') slider(t('pe.zoom', 'Zoom'), 1, 2.5, 0.01, v.zoom, function (z) { v.zoom = z; draw(); });
    if (P.darken) slider(t('pe.darken', 'Darken'), 0, 0.7, 0.01, v.darken, function (d) { v.darken = d; draw(); });
    if (P.corners) chips(t('pe.corners', 'Corners'), [['square', t('pe.corners.square', 'Square')], ['soft', t('pe.corners.soft', 'Soft')], ['round', t('pe.corners.round', 'Round')]], v.corners, function (c) { v.corners = c; draw(); });
    if (P.border) chips(t('pe.border', 'Border'), [['none', t('pe.border.none', 'None')], ['thin', t('pe.border.thin', 'Thin')], ['accent', t('pe.border.accent', 'Your color')]], v.border, function (b) { v.border = b; draw(); });

    var acts = el('div', 'pe-acts');
    var reset = el('button', 'ghost-btn sm', t('pe.reset', 'Start over'));
    var cancel = el('button', 'ghost-btn', t('pe.cancel', 'Cancel'));
    var done = el('button', 'solid-btn', t('pe.done', 'Done'));
    [reset, cancel, done].forEach(function (b) { b.type = 'button'; acts.appendChild(b); });
    side.appendChild(acts);

    box.appendChild(stage); box.appendChild(side);
    back.appendChild(box);
    document.body.appendChild(back);

    /* ---- drawing ---- */
    function draw() {
      var sw = pic.clientWidth, sh = pic.clientHeight;
      if (P.mode === 'crop') {
        win.style.left = v.x * sw + 'px'; win.style.top = v.y * sh + 'px';
        win.style.width = v.w * sw + 'px'; win.style.height = v.h * sh + 'px';
        var ar = (v.w * W) / (v.h * H);
        prev.style.aspectRatio = String(ar);
        prevImg.style.cssText = 'position:absolute;max-width:none;width:' + (100 / v.w) + '%;left:' + (-v.x / v.w * 100) + '%;top:' + (-v.y / v.h * 100) + '%';
        prev.style.borderRadius = v.corners === 'round' ? '24px' : v.corners === 'soft' ? '10px' : '0';
        prev.style.boxShadow = v.border === 'thin' ? '0 0 0 1px rgba(255,255,255,.35)' : v.border === 'accent' ? '0 0 0 3px ' + accent : 'none';
      } else {
        var wa = P.window;
        /* The window a typical screen shows: as wide as the photo allows at
           this zoom, in the frame's usual shape, centered on the focus. */
        var ww = Math.min(1, (H * wa) / W) / v.zoom, wh = Math.min(1, W / wa / H) / v.zoom;
        var x = clamp(v.fx / 100 - ww / 2, 0, 1 - ww), y = clamp(v.fy / 100 - wh / 2, 0, 1 - wh);
        win.style.left = x * sw + 'px'; win.style.top = y * sh + 'px';
        win.style.width = ww * sw + 'px'; win.style.height = wh * sh + 'px';
        prev.style.aspectRatio = String(wa);
        prevImg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:' + v.fx + '% ' + v.fy + '%;transform:scale(' + v.zoom + ');transform-origin:' + v.fx + '% ' + v.fy + '%';
      }
      shade.style.background = 'rgba(0,0,0,' + (v.darken || 0) + ')';
    }

    /* ---- moving and resizing with a pointer ---- */
    var drag = null;
    function at(e) { var r = pic.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
    stage.addEventListener('pointerdown', function (e) {
      var p = at(e);
      if (P.mode === 'focus') {
        v.fx = clamp(p.x * 100, 0, 100); v.fy = clamp(p.y * 100, 0, 100); draw();
        drag = { focus: true };
      } else if (e.target.dataset.h) {
        drag = { h: e.target.dataset.h, s: p, r: { x: v.x, y: v.y, w: v.w, h: v.h } };
      } else if (e.target === win) {
        drag = { move: true, s: p, r: { x: v.x, y: v.y, w: v.w, h: v.h } };
      } else return;
      stage.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = at(e);
      if (drag.focus) { v.fx = clamp(p.x * 100, 0, 100); v.fy = clamp(p.y * 100, 0, 100); return draw(); }
      var dx = p.x - drag.s.x, dy = p.y - drag.s.y, r = drag.r;
      if (drag.move) {
        v.x = clamp(r.x + dx, 0, 1 - r.w); v.y = clamp(r.y + dy, 0, 1 - r.h);
        return draw();
      }
      /* A corner: the opposite corner stays put; a fixed shape keeps its
         shape, measured in pixels, not fractions. */
      var left = drag.h.indexOf('w') !== -1, top = drag.h.indexOf('n') !== -1;
      var ax = left ? r.x + r.w : r.x, ay = top ? r.y + r.h : r.y;
      var nx = clamp(left ? r.x + dx : r.x + r.w + dx, 0, 1), ny = clamp(top ? r.y + dy : r.y + r.h + dy, 0, 1);
      var w = Math.max(0.05, Math.abs(ax - nx)), h = Math.max(0.05, Math.abs(ay - ny));
      var ar = SHAPES[v.shape];
      if (ar) {
        var hFromW = (w * W / ar) / H;
        if (hFromW <= h || hFromW <= 1) h = hFromW; else w = (h * H * ar) / W;
        if ((left ? ax - w : ax + w) < 0 || (left ? ax - w : ax + w) > 1 || (top ? ay - h : ay + h) < 0 || (top ? ay - h : ay + h) > 1) return;
      }
      v.w = w; v.h = h;
      v.x = left ? ax - w : ax; v.y = top ? ay - h : ay;
      draw();
    });
    stage.addEventListener('pointerup', function () { drag = null; });

    function close(result) {
      document.removeEventListener('keydown', key);
      back.remove();
      resolve(result);
    }
    function key(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', key);
    cancel.addEventListener('click', function () { close(null); });
    back.addEventListener('click', function (e) { if (e.target === back) close(null); });
    reset.addEventListener('click', function () {
      if (P.mode === 'crop') { var r0 = fit(W, H, SHAPES[v.shape]); v.x = r0.x; v.y = r0.y; v.w = r0.w; v.h = r0.h; v.darken = 0; }
      else { v.fx = 50; v.fy = 50; v.zoom = 1; v.darken = 0; }
      draw();
    });
    done.addEventListener('click', function () {
      if (P.mode === 'crop') {
        var out = { x: +v.x.toFixed(4), y: +v.y.toFixed(4), w: +v.w.toFixed(4), h: +v.h.toFixed(4), ar: +((v.w * W) / (v.h * H)).toFixed(4) };
        if (P.darken && v.darken) out.darken = +v.darken.toFixed(2);
        if (P.corners) out.corners = v.corners;
        if (P.border && v.border !== 'none') out.border = v.border;
        return close(out);
      }
      close({ fx: Math.round(v.fx), fy: Math.round(v.fy), zoom: +v.zoom.toFixed(2), darken: +(v.darken || 0).toFixed(2) });
    });

    if (pic.complete) draw(); else pic.addEventListener('load', draw);
    window.addEventListener('resize', draw);
    done.focus();
  }

  /* ---------------------------------------------------------- the pixels */
  /**
   * The finished picture, for places that cannot apply settings (an email, a
   * share picture): the crop, at most `max` pixels on its long edge, darkened
   * if asked, as a JPEG (or WebP when asked).
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
