/* ============================================================
   admin-photos.js — Website › Photos: put the dot on what matters
   ============================================================
   Mockup board 14. Each photo frame on the site is four values
   in site.json — images.<id>.{src, focal_x, focal_y, zoom} —
   and they used to be four text boxes. Here they are the
   picture, a dot, a zoom and a preview.

   THE WINDOW (Chase, 2026-09-27: "reposition the parallax zone
   itself"). What matters to a person is which part of the picture
   the frame shows, so that is what is drawn — a rectangle on the
   picture, dragged to move it, sized by the zoom — with faint
   lines for how far it travels as the page scrolls. The window is
   computed exactly as the site places the photo (lib/frame.js:
   cover, object-position at the focus, scale zoom × 1.12 around an
   origin kept inside the band that leaves room for the drift), and
   dragging it solves back for the focus that puts it there.

   THE WORKING-COPY MODEL, like Settings: nothing is written
   until Save, which commits site.json quietly; publishing is
   the bar along the foot of the screen.

   DERIVED FROM THE FILE. The photos are whatever site.json's
   `images` holds, so a new photo slot on the site appears here
   without anybody adding it.
   ============================================================ */
(function () {
  'use strict';

  /* On the Website page, as its Photos tab; finds its own elements. */
  if (!document.getElementById('phRoot')) return;

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

  /* ---- where the frame looks ------------------------------------------
     The same arithmetic as lib/frame.js and main.js, in the picture's own
     terms: everything below is a fraction of the picture's width or height. */
  var FRAME = 21 / 9;

  function band(zoom) {
    var scale = Math.max(zoom / 100, 1) * HEADROOM;
    var edge = Math.min(0.5, DRIFT / (scale - 1));
    return { min: edge, max: 1 - edge, scale: scale };
  }

  /* The part of the picture the frame shows while the page is still, and how
     far that moves as it scrolls. */
  function windowOf(img, nat) {
    var b = band(img.zoom), S = b.scale;
    var H = 1, W = FRAME;
    var c = Math.max(W / nat.w, H / nat.h), Iw = c * nat.w, Ih = c * nat.h;
    var fx = img.focal_x / 100, fy = img.focal_y / 100;
    var oy = Math.min(b.max, Math.max(b.min, fy)) * H, ox = fx * W;
    var left = ((Iw - W) * fx + ox * (1 - 1 / S)) / Iw;
    var top = ((Ih - H) * fy + oy * (1 - 1 / S)) / Ih;
    return { left: left, top: top, width: (W / S) / Iw, height: (H / S) / Ih,
             travel: (DRIFT * H / S) / Ih };
  }

  /* The focus that puts the window's top (or left) edge where it was asked.
     The edge only ever moves one way as the focus does, so halving the
     interval finds it; the answer is a whole percent, like the file holds. */
  function solve(img, nat, axis, want) {
    var lo = 0, hi = 100;
    for (var i = 0; i < 30; i++) {
      var mid = (lo + hi) / 2, probe = Object.assign({}, img);
      probe[axis === 'y' ? 'focal_y' : 'focal_x'] = mid;
      var w = windowOf(probe, nat);
      if ((axis === 'y' ? w.top : w.left) < want) lo = mid; else hi = mid;
    }
    return Math.round((lo + hi) / 2);
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
    var b = band(img.zoom);
    var oy = Math.round(100 * Math.min(b.max, Math.max(b.min, img.focal_y / 100)) * 100) / 100;
    el.style.objectPosition = img.focal_x + '% ' + img.focal_y + '%';
    el.style.transformOrigin = img.focal_x + '% ' + oy + '%';
    el.style.transform = 'scale(' + scale + ')';
  }
  /* The picture's own size, once it has loaded; until then there is nothing
     to draw the window on. */
  function natural() {
    var el = $('phImg');
    return el.naturalWidth ? { w: el.naturalWidth, h: el.naturalHeight } : null;
  }
  $('phImg').addEventListener('load', function () { renderMain(); });

  function renderMain() {
    var img = state.draft[state.on];
    if (!img) return;
    if ($('phImg').getAttribute('src') !== img.src) {
      $('phImg').src = img.src;
      $('phPreview').src = img.src;
    }
    $('phImg').alt = nameOf(state.on);
    var nat = natural();
    if (nat) {
      var w = windowOf(img, nat), pc = function (n) { return (n * 100).toFixed(2) + '%'; };
      var win = $('phWin').style, tr = $('phTravel').style;
      win.left = pc(w.left); win.width = pc(w.width); win.top = pc(w.top); win.height = pc(w.height);
      tr.left = pc(w.left); tr.width = pc(w.width);
      tr.top = pc(w.top - w.travel); tr.height = pc(w.height + 2 * w.travel);
    }
    $('phZoom').value = img.zoom;
    $('phZoomOut').textContent = img.zoom + '%';
    place(img, $('phPreview'), band(img.zoom).scale.toFixed(3));
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
    renderMain();
    renderSaveBar();
    var t = $('phThumbs').querySelector('[data-photo="' + state.on + '"]');
    if (t) t.classList.toggle('is-dirty', dirty(state.on));
  }

  /* ---- the window -----------------------------------------------------
     Dragged where it should look, or placed by pressing where it should be
     centered, or moved with the arrow keys (Shift for bigger steps) — it is
     a button, so it can be reached and moved without a mouse. */
  function pointerAt(e) {
    var box = $('phPic').getBoundingClientRect();
    return { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
  }
  function moveTo(left, top) {
    var nat = natural(), img = state.draft[state.on];
    if (!nat) return;
    set({ focal_x: solve(img, nat, 'x', left), focal_y: solve(img, nat, 'y', top) });
  }
  var grab = null;
  $('phPic').addEventListener('pointerdown', function (e) {
    var nat = natural();
    if (!nat) return;
    var w = windowOf(state.draft[state.on], nat), p = pointerAt(e);
    var inside = p.x >= w.left && p.x <= w.left + w.width && p.y >= w.top && p.y <= w.top + w.height;
    /* Grabbed where it was pressed; pressed outside, it comes to the press. */
    grab = inside ? { dx: p.x - w.left, dy: p.y - w.top } : { dx: w.width / 2, dy: w.height / 2 };
    if (!inside) moveTo(p.x - grab.dx, p.y - grab.dy);
    $('phPic').setPointerCapture(e.pointerId);
    $('phWin').focus();
    e.preventDefault();
  });
  $('phPic').addEventListener('pointermove', function (e) {
    if (!grab) return;
    var p = pointerAt(e);
    moveTo(p.x - grab.dx, p.y - grab.dy);
  });
  $('phPic').addEventListener('pointerup', function () { grab = null; });
  $('phPic').addEventListener('pointercancel', function () { grab = null; });
  $('phWin').addEventListener('keydown', function (e) {
    var nat = natural();
    var move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!move || !nat) return;
    e.preventDefault();
    var step = e.shiftKey ? 0.05 : 0.01, w = windowOf(state.draft[state.on], nat);
    moveTo(w.left + move[0] * step, w.top + move[1] * step);
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
    document.dispatchEvent(new CustomEvent('thauma:site-saved', { detail: { sha: state.sha, changes: ch, from: 'photos' } }));
    toast(fill('con.saved', { n: Object.keys(ch).length }), 'ok');
    render();
  });

  /* Another Website tab saved site.json (admin-website.js): take its version
     and any photo values it changed, except where this tab is mid-change. */
  document.addEventListener('thauma:site-saved', function (e) {
    var d = e.detail || {};
    if (d.from === 'photos' || !state.sha) return;
    if (d.sha) state.sha = d.sha;
    Object.keys(d.changes || {}).forEach(function (p) {
      var m = p.match(/^images\.([^.]+)\.([^.]+)$/);
      if (!m || !state.saved[m[1]]) return;
      var wasClean = state.draft[m[1]][m[2]] === state.saved[m[1]][m[2]];
      state.saved[m[1]][m[2]] = d.changes[p];
      if (wasClean) state.draft[m[1]][m[2]] = d.changes[p];
    });
    render();
  });

  window.addEventListener('beforeunload', function (e) {
    if (Object.keys(changes()).length) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
})();
