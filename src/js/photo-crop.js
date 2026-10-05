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
    newsletter:  { aspect: null,   max: 1200, label: 'Newsletter image' },
    /* A photo in one of the site's 21:9 frames. FREE, not 21:9: the frame
       shows a window of the picture chosen by its focus point (Website ›
       Photos), and a picture cropped to exactly the frame's shape would leave
       that point nowhere to move. */
    site:        { aspect: null,   max: 2400, label: 'Site photo' }
  };
  var FREE_MIN = 0.4, FREE_MAX = 2.5;

  /* StaffI18n.t returns the KEY when it has no entry, so `||` never reaches
     the fallback and a missing string renders as "pc.zoom". */
  var t = function (key, fallback) {
    var got = window.StaffI18n && window.StaffI18n.t && window.StaffI18n.t(key);
    return (got && got !== key) ? got : fallback;
  };

  /* ----------------------------------------------------------------- open */

  /* ONE EDITOR (BACKLOG §3: "moving Thauma's own photo tools onto the
     editor"). The choosing is photo-editor.js's — the same screen the Site
     Creator and Mail use, with drag, edges, pinch and the shape chips —
     given the purpose that matches each frame below. This file keeps what
     Thauma's frames want and turns the choice into the pixels uploaded,
     because the static site shows exactly the file it is given. */
  var PURPOSE = { photo: 'team', bio_photo: 'bio', home: 'home', wide: 'wide', newsletter: 'mail', site: 'site' };

  /**
   * @param {File}   file   what the person chose
   * @param {string} kind   a key in FRAMES
   * @returns {Promise<{blob, width, height, aspect} | null>}  null = canceled
   */
  function open(file, kind) {
    var frame = FRAMES[kind] || FRAMES.photo;
    if (!window.PhotoEditor) return Promise.reject(new Error(t('pe.cannotLoad', 'The photo editor did not load.')));
    var url = URL.createObjectURL(file);
    return decode(file).then(function (bitmap) {
      return window.PhotoEditor.open(url, { purpose: PURPOSE[kind] || 'wide' }).then(function (v) {
        if (!v || v.remove) return null;
        return render(bitmap, frame, v);
      });
    }).then(function (got) { URL.revokeObjectURL(url); return got; },
            function (err) { URL.revokeObjectURL(url); throw err; });
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

  /* ------------------------------------------------------------- render

     The chosen part of the ORIGINAL, at the frame's size: never the editor's
     preview scaled up. A free shape is held inside FREE_MIN–FREE_MAX, the
     bounds the build enforces (src/_data/team.js), trimmed evenly. */
  function render(bitmap, frame, v) {
    var W = bitmap.width, H = bitmap.height;
    var x = v.x * W, y = v.y * H, w = v.w * W, h = v.h * H;
    if (frame.aspect == null) {
      var a = clampFree(w / h);
      if (w / h > a) { var nw = h * a; x += (w - nw) / 2; w = nw; }
      else if (w / h < a) { var nh = w / a; y += (h - nh) / 2; h = nh; }
    }
    var k = Math.min(1, frame.max / Math.max(w, h));
    var c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    var ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, c.width, c.height);
    return toBlob(c).then(function (blob) {
      if (!blob) throw new Error('this browser could not convert that image');
      return { blob: blob, width: c.width, height: c.height, aspect: c.width / c.height };
    });
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

  window.PhotoCrop = { open: open, FRAMES: FRAMES, PURPOSE: PURPOSE };
})();
