/* ============================================================
   admin-photos.js — Website › Photos: put the dot on what matters
   ============================================================
   Mockup board 14. Each photo frame on the site is four values
   in site.json — images.<id>.{src, focal_x, focal_y, zoom} —
   and they used to be four text boxes. Here they are the
   picture, a dot, a zoom and a preview.

   THE SAFE RANGE. The site holds a framed photo at
   zoom × 1.12 around its focus point and drifts it up and down
   by 4.5% of the frame's height as the page scrolls (main.js,
   "whisper-parallax"). The frame's edge stays hidden only while
   there is at least that much picture above and below the focus
   — so the focus height must stay between
       0.045 ÷ (scale − 1)   and   1 − that
   which is 37.5–62.5% at zoom 100 and about 19–81% at zoom 110,
   the numbers the project notes give. The bands outside it are
   drawn; the dot cannot enter them, and lowering the zoom moves
   the dot back in rather than leaving it somewhere unsafe.

   THE WORKING-COPY MODEL, like Settings: nothing is written
   until Save, which commits site.json quietly; publishing is
   the bar along the foot of the screen.

   DERIVED FROM THE FILE. The photos are whatever site.json's
   `images` holds, so a new photo slot on the site appears here
   without anybody adding it.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'photos') return;

  var API = '/api/admin/content';
  var DRIFT = 0.045, HEADROOM = 1.12;
  var $ = function (id) { return document.getElementById(id); };

  var state = { sha: null, saved: {}, draft: {}, ids: [], on: null, english: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function has(key) { return tr(key) !== key; }
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---- the range the dot may use ------------------------------------- */

  function safe(zoom) {
    var scale = Math.max(zoom / 100, 1) * HEADROOM;
    var edge = Math.min(0.5, DRIFT / (scale - 1)) * 100;
    return { min: Math.ceil(edge), max: Math.floor(100 - edge) };
  }
  function clampY(y, zoom) {
    var r = safe(zoom);
    return Math.max(r.min, Math.min(r.max, y));
  }

  /* ---- names ----------------------------------------------------------
     `home_who` is the photo in the Home page's "The need" section: the page
     by its console name, the section by its own heading line in English,
     read from en.json, so the name follows the site's words. */
  function nameOf(id) {
    var i = id.indexOf('_');
    var page = i === -1 ? id : id.slice(0, i), block = i === -1 ? '' : id.slice(i + 1);
    var pageName = has('lbl.s.' + page) ? tr('lbl.s.' + page) : page.charAt(0).toUpperCase() + page.slice(1);
    var cue = state.english && state.english[page] && state.english[page][block + '_cue'];
    var blockName = cue || (block ? block.charAt(0).toUpperCase() + block.slice(1).replace(/_/g, ' ') : '');
    return blockName ? pageName + ' · ' + blockName : pageName;
  }

  /* ---- loading -------------------------------------------------------- */

  async function get(url) {
    var res, body;
    try { res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); }
    catch (e) { if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, boot); return null; }
    try { body = await res.json(); }
    catch (e) { if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', boot); return null; }
    if (res.status === 403) {
      if ($('notAdmin')) $('notAdmin').hidden = false;
      return null;
    }
    if (!res.ok) {
      if (window.StaffProblem) window.StaffProblem(res.status === 401 ? tr('err.expired')
        : tr('err.refused') + ' (' + res.status + ')' + (body.error ? ' — ' + body.error : ''), res.status === 401 ? null : boot);
      return null;
    }
    return body;
  }

  async function boot() {
    /* Both at once: the photos, and English for their sections' names. */
    var both = await Promise.all([get(API + '?file=site'), get(API + '?file=en')]);
    var site = both[0];
    if (both[1] && both[1].data) state.english = both[1].data;
    if (!site) return;
    if (site.configured === false) {
      var el = $('phNotConfigured');
      el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(site.reason || site.error || '');
      el.hidden = false;
      return;
    }
    state.sha = site.sha;
    state.saved = clone((site.data && site.data.images) || {});
    state.draft = clone(state.saved);
    state.ids = Object.keys(state.saved);
    if (!state.on || state.ids.indexOf(state.on) === -1) state.on = state.ids[0] || null;
    $('phRoot').hidden = false;
    render();
  }

  /* ---- drawing -------------------------------------------------------- */

  function render() {
    renderThumbs();
    renderMain();
    renderSaveBar();
  }

  function renderThumbs() {
    $('phThumbs').innerHTML = state.ids.map(function (id) {
      var img = state.draft[id] || {};
      var on = id === state.on;
      return '<button type="button" class="ph-thumb' + (on ? ' is-on' : '') + (dirty(id) ? ' is-dirty' : '') +
          '" role="tab" aria-selected="' + on + '" data-photo="' + esc(id) + '">' +
        '<img src="' + esc(img.src) + '" alt="">' +
        '<span>' + esc(nameOf(id)) + '</span></button>';
    }).join('');
  }

  function place(img, el, scale) {
    el.style.objectPosition = img.focal_x + '% ' + img.focal_y + '%';
    el.style.transformOrigin = img.focal_x + '% ' + img.focal_y + '%';
    el.style.transform = 'scale(' + scale + ')';
  }

  function renderMain() {
    var img = state.draft[state.on];
    if (!img) return;
    if ($('phImg').getAttribute('src') !== img.src) {
      $('phImg').src = img.src;
      $('phPreview').src = img.src;
    }
    $('phImg').alt = nameOf(state.on);
    var r = safe(img.zoom);
    $('phBandTop').style.height = r.min + '%';
    $('phBandBottom').style.height = (100 - r.max) + '%';
    $('phDot').style.left = img.focal_x + '%';
    $('phDot').style.top = img.focal_y + '%';
    $('phDot').setAttribute('aria-valuetext', img.focal_x + '%, ' + img.focal_y + '%');
    $('phZoom').value = img.zoom;
    $('phZoomOut').textContent = img.zoom + '%';
    place(img, $('phPreview'), (Math.max(img.zoom / 100, 1) * HEADROOM).toFixed(3));
  }

  function dirty(id) {
    return JSON.stringify(state.draft[id]) !== JSON.stringify(state.saved[id]);
  }
  function changes() {
    var out = {};
    state.ids.forEach(function (id) {
      ['src', 'focal_x', 'focal_y', 'zoom'].forEach(function (f) {
        if (state.draft[id][f] !== state.saved[id][f]) out['images.' + id + '.' + f] = state.draft[id][f];
      });
    });
    return out;
  }
  function renderSaveBar() {
    var n = Object.keys(changes()).length;
    $('phSaveBar').hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    if (n) $('phDirtyCount').textContent = n === 1 ? tr('con.oneChange') : n + ' ' + tr('con.nChanges');
  }

  function set(fields) {
    var img = state.draft[state.on];
    Object.keys(fields).forEach(function (k) { img[k] = fields[k]; });
    img.focal_y = clampY(img.focal_y, img.zoom);
    renderMain();
    renderSaveBar();
    var t = $('phThumbs').querySelector('[data-photo="' + state.on + '"]');
    if (t) t.classList.toggle('is-dirty', dirty(state.on));
  }

  /* ---- the dot ---------------------------------------------------------
     Dragged, or clicked where it should go, or moved with the arrow keys
     (Shift for bigger steps) — it is a button, so it can be reached and
     moved without a mouse. */
  function pointAt(e) {
    var box = $('phPic').getBoundingClientRect();
    var x = Math.round(100 * (e.clientX - box.left) / box.width);
    var y = Math.round(100 * (e.clientY - box.top) / box.height);
    set({ focal_x: Math.max(0, Math.min(100, x)), focal_y: Math.max(0, Math.min(100, y)) });
  }
  var dragging = false;
  $('phPic').addEventListener('pointerdown', function (e) {
    dragging = true;
    $('phPic').setPointerCapture(e.pointerId);
    pointAt(e);
    $('phDot').focus();
  });
  $('phPic').addEventListener('pointermove', function (e) { if (dragging) pointAt(e); });
  $('phPic').addEventListener('pointerup', function () { dragging = false; });
  $('phPic').addEventListener('pointercancel', function () { dragging = false; });
  $('phDot').addEventListener('keydown', function (e) {
    var step = e.shiftKey ? 5 : 1, img = state.draft[state.on];
    var move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!move) return;
    e.preventDefault();
    set({ focal_x: Math.max(0, Math.min(100, img.focal_x + move[0])),
          focal_y: Math.max(0, Math.min(100, img.focal_y + move[1])) });
  });

  $('phZoom').addEventListener('input', function (e) { set({ zoom: Number(e.target.value) }); });

  $('phThumbs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-photo]');
    if (!b) return;
    state.on = b.getAttribute('data-photo');
    render();
  });

  /* ---- replacing the picture ---------------------------------------- */

  $('phReplace').addEventListener('click', function () { $('phFile').click(); });
  $('phFile').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    var shot = window.PhotoCrop ? await window.PhotoCrop.open(file, 'site') : null;
    if (!shot) return;
    var btn = $('phReplace');
    btn.disabled = true;
    try {
      var res = await fetch('/api/admin/media?kind=site', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': shot.blob.type }, body: shot.blob
      });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || tr('err.refused'));
      // A new picture starts with its focus in the middle, safely.
      set({ src: body.url, focal_x: 50, focal_y: 50 });
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  /* ---- saving --------------------------------------------------------- */

  $('phDiscard').addEventListener('click', function () {
    state.draft = clone(state.saved);
    render();
  });

  $('phSave').addEventListener('click', async function () {
    var ch = changes();
    if (!Object.keys(ch).length) return;
    var btn = this;
    btn.disabled = true; $('phDiscard').disabled = true;
    var res, body;
    try {
      res = await fetch(API, {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'site', sha: state.sha, changes: ch })
      });
      body = await res.json();
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'err');
      btn.disabled = false; $('phDiscard').disabled = false;
      return;
    }
    btn.disabled = false; $('phDiscard').disabled = false;
    if (res.status === 409) {
      if (window.StaffProblem) window.StaffProblem(body.error, boot);
      return;
    }
    if (!res.ok) return toast((body && body.error) || tr('err.refused'), 'err');
    state.sha = body.sha || state.sha;
    state.saved = clone(state.draft);
    toast(fill('con.saved', { n: Object.keys(ch).length }), 'ok');
    render();
  });

  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(changes()).length) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
})();
