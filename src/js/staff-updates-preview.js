/* ============================================================
   staff-updates-preview.js — the real widget, beside the list
   ============================================================
   Mockup board "Preview beside the editing" (with board 9): on Updates,
   "Preview on a website" opens the widget for the tab you are on, beside the
   list, and redraws it as rows are edited. It draws the WORKING COPY — each
   section hands over its unpublished rows in the public data's shape
   (StaffUpdates.previewOf) — so this is what Publish would put on a
   partner's page, before Publish is pressed. Videos show the live data: a
   new channel is not videos until it has been read.

   What it does NOT hold: sharing, colors, code. Those are set once, on
   Sharing, and the link under the preview goes there. The colors drawn here
   are the saved ones, from the same payload the public widget gets.

   Open or closed survives a reload, like the tab.
   ============================================================ */
(function () {
  'use strict';

  var btn = document.getElementById('upPreviewBtn');
  if (!btn) return;

  var PREVIEW = '/api/staff-embed';
  var DESKTOP_W = 1000;            // see staff-sharing.js: the widget picks its layout by width
  var KEY = 'thauma.updates.preview';
  var KIND = { milestones: 'roadmap', goals: 'goal', prayer: 'prayer', videos: 'videos' };
  var ITEM = { milestones: 'roadmap', goals: 'goal', prayer: 'prayer', videos: 'videos' };

  var $ = function (id) { return document.getElementById(id); };
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = { open: false, payload: null, device: 'wide', lang: null, lastH: 300 };

  function tab() {
    var t = document.querySelector('.tabs .tab[aria-selected="true"]');
    return t ? t.dataset.tab : 'milestones';
  }

  async function loadPayload() {
    try {
      var res = await fetch(PREVIEW, { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      state.payload = await res.json();
    } catch (e) { return; }
    var langs = state.payload.languages || [];
    if (!langs.some(function (l) { return l.code === state.lang; })) {
      state.lang = langs.some(function (l) { return l.code === 'en'; }) ? 'en' : (langs[0] ? langs[0].code : 'en');
    }
    $('upLang').innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(l.native_name || l.name || l.code) + '</option>';
    }).join('');
    $('upLang').value = state.lang;
    $('upLang').hidden = langs.length < 2;
    draw();
  }

  function setOpen(on) {
    state.open = on;
    $('upPreview').hidden = !on;
    $('upBody').classList.toggle('is-previewing', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    try { sessionStorage.setItem(KEY, on ? '1' : ''); } catch (e) {}
    if (on && !state.payload) loadPayload(); else draw();
  }

  /* The widget in a frame sandboxed to scripts only, fed the payload with
     this tab's part replaced by the working copy. */
  var timer = null;
  function drawSoon() { if (state.open) { clearTimeout(timer); timer = setTimeout(draw, 200); } }
  function draw() {
    if (!state.open || !state.payload) return;
    var t = tab();
    var live = JSON.parse(JSON.stringify(state.payload));
    var mine = window.StaffUpdates ? window.StaffUpdates.previewOf(t) : null;
    if (mine) live[{ milestones: 'milestones', goals: 'goals', prayer: 'prayer' }[t]] = mine;
    $('upShareLink').href = '/staff/sharing/#' + ITEM[t];
    var mode = (live.theme && live.theme.mode) || 'auto';
    var bg = mode === 'light' ? '#ffffff' : mode === 'dark' ? '#0b0f15' : 'Canvas';   // dark is --bg
    var slug = live.partner && live.partner.slug;
    var attrs = 'data-thauma="' + esc(slug) + '"' + (t !== 'goals' ? ' data-widget="' + KIND[t] + '"' : '') +
      (state.lang ? ' data-lang="' + esc(state.lang) + '"' : '');
    fit(state.lastH);
    $('upFrame').srcdoc =
      '<!doctype html><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light dark">' +
      '<body style="margin:0;padding:20px;background:' + bg + '">' +
      '<script>window.__thaumaPreview=' + JSON.stringify(live).replace(/</g, '\\u003c') + '</' + 'script>' +
      '<div ' + attrs + '></div>' +
      '<script src="' + location.origin + '/embed/v1/widget.js"></' + 'script>';
  }

  function fit(h) {
    state.lastH = h;
    var frame = $('upFrame'), wrap = $('upScale'), stage = $('upStage');
    var scale = 1;
    if (state.device === 'wide') {
      var w = stage.getBoundingClientRect().width || DESKTOP_W;
      scale = Math.min(1, w / DESKTOP_W);
    }
    wrap.style.inlineSize = scale < 1 ? DESKTOP_W + 'px' : '100%';
    wrap.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    frame.style.blockSize = h + 'px';
    stage.style.blockSize = Math.ceil(h * scale) + 'px';
    $('upScaleNote').textContent = scale < 0.99 ? fill('emb.shownAt', { n: Math.round(scale * 100) }) : '';
  }

  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    if (!h || $('upFrame').contentWindow !== e.source) return;
    fit(Math.max(180, Math.min(2400, h)));
  });
  window.addEventListener('resize', function () { if (state.open) fit(state.lastH); });

  btn.addEventListener('click', function () { setOpen(!state.open); });
  $('upLang').addEventListener('change', function () { state.lang = this.value; draw(); });
  [].forEach.call(document.querySelectorAll('#upPreview [data-width]'), function (b) {
    b.addEventListener('click', function () {
      state.device = b.dataset.width;
      [].forEach.call(document.querySelectorAll('#upPreview [data-width]'), function (x) {
        x.classList.toggle('is-on', x === b);
        x.setAttribute('aria-selected', x === b ? 'true' : 'false');
      });
      $('upStage').classList.toggle('is-narrow', state.device === 'narrow');
      draw();
    });
  });
  /* Another tab, another widget. After the tab has switched. */
  document.querySelector('.tabs').addEventListener('click', function () { setTimeout(draw, 0); });
  /* Every edit, from any section. */
  if (window.StaffUpdates) window.StaffUpdates.onChange(drawSoon);
  /* After Publish the live data moved: read it again. */
  document.addEventListener('updates:published', function () { if (state.open) loadPayload(); else state.payload = null; });

  var was = '';
  try { was = sessionStorage.getItem(KEY) || ''; } catch (e) {}
  if (was) setOpen(true);
})();
