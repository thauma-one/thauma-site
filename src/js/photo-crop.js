/* photo-crop.js — choose what part of a photo the frame gets
   =========================================================================
   THE PROBLEM. Every photo on this site lands in a frame with a shape of its
   own: the team card is a square, the home page band is 21:9, a bio page
   photo is whatever the picture wants to be. Until now an upload was scaled to
   fit 1600px and handed over whole, and CSS `object-fit: cover` decided what
   survived — which means the browser cropped to the center and nobody was
   asked. A portrait photographed with headroom lost the top of the head on the
   team page, and the only fix was to re-crop the file somewhere else and
   upload it again.

   So the decision moves to the person who knows what the photo is of.

   IT CROPS BEFORE IT UPLOADS. The bytes that leave the browser are already the
   right shape, which matters for three reasons: the frame no longer has to
   guess, a 1600px square is a quarter the weight of a 1600px original, and
   `object-fit` becomes a safety net rather than the mechanism.

   WHY THE FRAME IS DECLARED, NOT DRAWN. FRAMES below is the single statement
   of what shape each place wants. A new photo slot on the site is an entry in
   that table; it is not new code here, and it cannot be added to the site and
   forgotten here — which is exactly how the mailing page ended up with two
   forms on it.

   NO LIBRARY. A cropper is a rectangle, two pointer handlers and one
   drawImage. Pulling in a dependency for that would add more bytes to every
   console page than the feature itself, and this has to run inside a console
   that is already asked to load a rich-text editor.
   ========================================================================= */
(function () {
  'use strict';

  /* WHAT EACH PLACE ON THE SITE WANTS.

     `aspect` is width ÷ height. `null` means the person chooses — a bio page
     photo is deliberately variable, and the page reads the shape back off the
     file it is given.

     `max` is the longest edge in pixels after cropping. The band across the
     home page is wide and short, so capping its LONGEST edge at 1600 would
     leave it 686px tall on a display that will show it at twice that; the
     numbers are per frame for that reason rather than one constant.

     The clamps on a free aspect are the same 0.4–2.5 the build already applies
     in src/_data/team.js. A 20:1 panorama in a bio frame breaks the page
     layout, and refusing it here is friendlier than silently squaring it
     later. */
  var FRAMES = {
    photo:       { aspect: 1,      max: 1200, label: 'Team photo — square' },
    bio_photo:   { aspect: null,   max: 1600, label: 'Bio page photo — any shape' },
    home:        { aspect: 21 / 9, max: 2400, label: 'Home page band' },
    wide:        { aspect: 16 / 9, max: 1600, label: 'Wide' },
    newsletter:  { aspect: null,   max: 1200, label: 'Newsletter image' }
  };
  var FREE_MIN = 0.4, FREE_MAX = 2.5;

  /* Offered when the shape is the person's to choose. Named rather than
     numeric: "portrait" is a thing somebody means; 0.75 is a thing they have
     to work out. */
  var CHOICES = [
    { id: 'square',    label: 'Square',    aspect: 1 },
    { id: 'portrait',  label: 'Portrait',  aspect: 3 / 4 },
    { id: 'tall',      label: 'Tall',      aspect: 2 / 3 },
    { id: 'landscape', label: 'Landscape', aspect: 4 / 3 },
    { id: 'wide',      label: 'Wide',      aspect: 16 / 9 },
    { id: 'original',  label: 'As shot',   aspect: null }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* StaffI18n.t returns the KEY when it has no entry, so `||` never reaches
     the fallback and a missing string renders as "pc.zoom". */
  var t = function (key, fallback) {
    var got = window.StaffI18n && window.StaffI18n.t && window.StaffI18n.t(key);
    return (got && got !== key) ? got : fallback;
  };

  /* ----------------------------------------------------------------- open */

  /**
   * @param {File}   file   what the person chose
   * @param {string} kind   a key in FRAMES
   * @returns {Promise<{blob, width, height, aspect} | null>}  null = canceled
   */
  function open(file, kind) {
    var frame = FRAMES[kind] || FRAMES.photo;

    return decode(file).then(function (bitmap) {
      return new Promise(function (resolve) {
        build(bitmap, frame, file, resolve);
      });
    });
  }

  /* createImageBitmap handles orientation for us in current browsers and is
     the only decoder that does not need the image in the document. The <img>
     fallback is for anything that lacks it. */
  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }

  function viaImg(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        rej(new Error('that file could not be read as an image'));
      };
      img.src = url;
    });
  }

  /* ---------------------------------------------------------------- build */

  function build(bitmap, frame, file, done) {
    var srcW = bitmap.width, srcH = bitmap.height;

    /* THE VIEW. `scale` and the offsets describe where the picture sits behind
       a fixed window, which is the model a person already has from every photo
       tool they have used: the frame stays still and the picture moves. */
    var state = {
      aspect: frame.aspect != null ? frame.aspect
                                   : clampFree(srcW / srcH),
      scale: 1, x: 0, y: 0
    };

    var back = el('div', 'dlg-back pc-back');
    var box = el('div', 'dlg pc');
    back.appendChild(box);

    box.appendChild(el('h3', null, t('pc.title', 'Position the photo')));
    box.appendChild(el('p', 'pc-hint', t('pc.hint',
      'Drag to move, scroll or use the slider to zoom. Only what is inside the ' +
      'frame is uploaded.')));

    var stage = el('div', 'pc-stage');
    var canvas = el('canvas', 'pc-canvas');
    stage.appendChild(canvas);
    box.appendChild(stage);

    /* Shape buttons, only where the shape is the person's to choose. */
    var shapeRow = null;
    if (frame.aspect == null) {
      shapeRow = el('div', 'pc-shapes');
      CHOICES.forEach(function (c) {
        var b = el('button', 'pc-shape', t('pc.shape.' + c.id, c.label));
        b.type = 'button';
        b.dataset.aspect = c.aspect == null ? '' : String(c.aspect);
        b.addEventListener('click', function () {
          state.aspect = clampFree(c.aspect == null ? srcW / srcH : c.aspect);
          fit();
          markShapes();
          draw();
        });
        shapeRow.appendChild(b);
      });
      box.appendChild(shapeRow);
    }

    var zoomRow = el('div', 'pc-zoom');
    var zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '100'; zoom.max = '400'; zoom.value = '100';
    zoom.setAttribute('aria-label', t('pc.zoom', 'Zoom'));
    zoomRow.appendChild(zoom);
    var reset = el('button', 'ghost-btn pc-reset', t('pc.reset', 'Reset'));
    reset.type = 'button';
    zoomRow.appendChild(reset);
    box.appendChild(zoomRow);

    var out = el('p', 'pc-out');
    box.appendChild(out);

    var actions = el('div', 'dlg-actions');
    var cancel = el('button', 'ghost-btn', t('common.cancel', 'Cancel'));
    cancel.type = 'button';
    var ok = el('button', 'solid-btn', t('pc.use', 'Use this photo'));
    ok.type = 'button';
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(actions);

    document.body.appendChild(back);
    requestAnimationFrame(function () { back.classList.add('in'); });

    /* ------------------------------------------------------------ layout */

    /* The canvas is drawn at the size it occupies, times the device ratio, so
       the preview is not soft on a retina screen. Capped at 2 — a 3x phone
       would otherwise allocate nine times the pixels to a preview nobody
       inspects that closely. */
    function sizeCanvas() {
      var maxW = Math.min(stage.clientWidth || 520, 520);
      var maxH = 380;
      var w = maxW, h = w / state.aspect;
      if (h > maxH) { h = maxH; w = h * state.aspect; }
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = Math.round(w) + 'px';
      canvas.style.height = Math.round(h) + 'px';
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    /* The smallest zoom that still covers the frame. Panning is then clamped
       so a gap can never appear at an edge — an uploaded photo with a
       transparent wedge down one side is not a thing anybody wants and not a
       thing they would notice until it was on the website. */
    function coverScale() {
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      return Math.max(cw / srcW, ch / srcH);
    }

    function fit() {
      sizeCanvas();
      state.scale = 1;
      state.x = 0; state.y = 0;
      zoom.value = '100';
      clampPan();
    }

    function drawScale() { return coverScale() * state.scale; }

    function clampPan() {
      var s = drawScale();
      var w = srcW * s, h = srcH * s;
      var maxX = Math.max(0, (w - canvas.clientWidth) / 2);
      var maxY = Math.max(0, (h - canvas.clientHeight) / 2);
      state.x = Math.max(-maxX, Math.min(maxX, state.x));
      state.y = Math.max(-maxY, Math.min(maxY, state.y));
    }

    function draw() {
      var dpr = canvas.width / canvas.clientWidth;
      var ctx = canvas.getContext('2d');
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      var s = drawScale();
      var w = srcW * s, h = srcH * s;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap,
        (canvas.clientWidth - w) / 2 + state.x,
        (canvas.clientHeight - h) / 2 + state.y,
        w, h);
      ctx.restore();
      report();
    }

    /* SAID OUT LOUD, because the person is choosing pixels without seeing a
       number anywhere else, and "why is my photo blurry on the site" is
       answered here or not at all. */
    function report() {
      var d = outputSize();
      var short = d.w < 500 || d.h < 500;
      out.textContent = d.w + ' × ' + d.h +
        (short ? '  ·  ' + t('pc.small', 'small — this will look soft on a large screen') : '');
      out.classList.toggle('is-warn', short);
    }

    function outputSize() {
      var s = drawScale();
      /* How much of the ORIGINAL is inside the frame, in original pixels. */
      var w = Math.round(canvas.clientWidth / s);
      var h = Math.round(canvas.clientHeight / s);
      w = Math.min(w, srcW); h = Math.min(h, srcH);
      var k = Math.min(1, frame.max / Math.max(w, h));
      return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
    }

    function markShapes() {
      if (!shapeRow) return;
      [].forEach.call(shapeRow.children, function (b) {
        var a = b.dataset.aspect === '' ? clampFree(srcW / srcH) : Number(b.dataset.aspect);
        b.classList.toggle('is-on', Math.abs(a - state.aspect) < 0.001);
      });
    }

    /* ----------------------------------------------------------- gestures */

    var dragging = false, lastX = 0, lastY = 0;

    canvas.addEventListener('pointerdown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      state.x += e.clientX - lastX;
      state.y += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      clampPan(); draw();
    });
    var stop = function (e) {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var next = Number(zoom.value) * (e.deltaY < 0 ? 1.08 : 0.93);
      zoom.value = String(Math.max(100, Math.min(400, next)));
      state.scale = Number(zoom.value) / 100;
      clampPan(); draw();
    }, { passive: false });

    zoom.addEventListener('input', function () {
      state.scale = Number(zoom.value) / 100;
      clampPan(); draw();
    });

    reset.addEventListener('click', function () { fit(); draw(); });

    var onResize = function () { var s = state.scale; fit(); state.scale = s; clampPan(); draw(); };
    window.addEventListener('resize', onResize);

    /* -------------------------------------------------------------- close */

    function close(result) {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      back.classList.remove('in');
      setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 200);
      if (bitmap.close) bitmap.close();
      done(result);
    }
    function onKey(e) { if (e.key === 'Escape') close(null); }
    document.addEventListener('keydown', onKey);
    cancel.addEventListener('click', function () { close(null); });
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(null); });

    ok.addEventListener('click', function () {
      ok.disabled = true;
      render().then(close, function () { ok.disabled = false; });
    });

    /* ------------------------------------------------------------- render

       Drawn ONCE at the output size rather than by scaling the preview: the
       preview is a few hundred pixels and upscaling it would ship exactly the
       softness this feature exists to let somebody avoid. */
    function render() {
      var d = outputSize();
      var s = drawScale();
      var c = document.createElement('canvas');
      c.width = d.w; c.height = d.h;
      var ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';

      /* The same geometry as the preview, in output pixels. */
      var k = d.w / canvas.clientWidth;
      var w = srcW * s * k, h = srcH * s * k;
      ctx.drawImage(bitmap,
        (d.w - w) / 2 + state.x * k,
        (d.h - h) / 2 + state.y * k,
        w, h);

      return toBlob(c).then(function (blob) {
        if (!blob) throw new Error('this browser could not convert that image');
        return { blob: blob, width: d.w, height: d.h, aspect: d.w / d.h };
      });
    }

    fit();
    markShapes();
    /* The bitmap is already decoded, so there is nothing to wait for. */
    draw();
  }

  /* WebP, falling back to JPEG. Safari only gained canvas WebP in 14, and a
     browser that cannot encode it returns a PNG from toBlob without saying so
     — hence checking the type rather than trusting the call. PNG of a
     photograph is several megabytes, which the endpoint would then refuse. */
  function toBlob(canvas) {
    return new Promise(function (res) {
      canvas.toBlob(function (b) {
        if (b && b.type === 'image/webp') return res(b);
        canvas.toBlob(function (j) { res(j || b); }, 'image/jpeg', 0.86);
      }, 'image/webp', 0.85);
    });
  }

  function clampFree(a) {
    if (!isFinite(a) || a <= 0) return 1;
    return Math.max(FREE_MIN, Math.min(FREE_MAX, a));
  }

  window.PhotoCrop = { open: open, FRAMES: FRAMES, CHOICES: CHOICES };
})();
