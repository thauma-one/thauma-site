/* ============================================================
   staff-embed.js — "Edit" or "As embedded", once per section
   ============================================================
   THREE PANELS ON ONE PAGE. Milestones, Goals and Prayer each carry their own
   copy, so nothing here may address an element by id — every control is found
   by data-emb WITHIN its own panel.

   What they SHARE is the partner's settings: the colour pair, the background
   and the publication switch belong to the ministry, not to one widget. A
   change made in any panel redraws all of them, and one fetch feeds the lot.
   What they do NOT share is the language and the width being previewed, which
   belong to the panel you are looking at.

   IT IS A VIEW SWITCH, NOT A SECOND PANEL. Choosing "As embedded" hides that
   section's own editor and shows the real widget in its place — never two
   renderings of the same numbers on one screen. Read the other way round it is
   the "hide the visualiser and just edit" control.

   THE PREVIEW WORKS BEFORE YOU PUBLISH, which is why /api/staff-embed exists.
   The public endpoint 404s until embedding is switched on, so a preview that
   fetched it could only show what had already been published.

   WHAT SAVES AND WHAT DOES NOT:
     accent, accent2, theme, on   SAVED, per partner, shared by every widget
     language, device             NOT saved — they belong to this panel
   ============================================================ */
(function () {
  'use strict';

  var bars = document.querySelectorAll('[data-embed-panel]');
  if (!bars.length) return;

  var SETTINGS = '/api/staff-settings';
  var PREVIEW  = '/api/staff-embed';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#6D4AFF';

  var settings = null;   // shared: languages, roles, embed config, timeline
  var payload = null;    // shared: what every widget draws
  var panels = [];

  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function langLabel(l) { return (l.native_name || l.name) + ' (' + l.code + ')'; }

  /* ---- the colour pair -------------------------------------------------
     The same -33 degree rotation the Worker and the widget use, so the panel
     can show what "match automatically" produces without a round trip. Three
     copies exist and a test asserts they agree — see embed-colour.js. */

  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min;
    if (d === 0) return { h: 0, s: 0, l: l };
    var sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: sat, l: l };
  }
  function hslToHex(o) {
    var h = ((o.h % 360) + 360) % 360, sat = o.s, l = o.l;
    var c = (1 - Math.abs(2 * l - 1)) * sat;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    function to(v) { var q = Math.round((v + m) * 255).toString(16); return q.length < 2 ? '0' + q : q; }
    return '#' + to(r) + to(g) + to(b);
  }
  function companion(hex) {
    var o = hexToHsl(hex);
    if (!o) return hex;
    if (o.s < 0.12) {
      var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);
      return hslToHex({ h: o.h, s: o.s, l: l });
    }
    return hslToHex({ h: o.h - 33, s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });
  }

  /* ---- one panel ------------------------------------------------------- */

  function makePanel(bar) {
    var kind = bar.getAttribute('data-widget') || 'goal';

    /* Scoped to this bar's own section. Every panel has the same data-emb
       names, so a document-wide lookup would give all three the first one's
       controls. */
    var section = bar.parentNode;
    var p = {};
    Array.prototype.forEach.call(section.querySelectorAll('[data-emb]'), function (el) {
      p[el.getAttribute('data-emb')] = el;
    });
    var content = section.querySelectorAll('[data-emb-content]');

    var panel = { bar: bar, kind: kind, p: p, showing: 'edit', device: 'wide', timer: null };

    function origin() { return location.origin; }
    function slug() { return (settings && settings.partner && settings.partner.slug) || ''; }

    function secondColour() {
      if (p.pairAuto && p.pairAuto.checked) {
        return companion(HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT);
      }
      return HEX.test(p.accent2Hex.value.trim()) ? p.accent2Hex.value.trim() : DEFAULT_ACCENT;
    }

    function attrs() {
      var a = ['data-thauma="' + esc(slug()) + '"'];
      if (kind !== 'goal') a.push('data-widget="' + esc(kind) + '"');
      var lang = p.lang.value;
      if (lang && lang !== 'en') a.push('data-lang="' + esc(lang) + '"');
      return a.join(' ');
    }

    panel.renderCode = function () {
      if (!slug()) return;
      p.code.textContent =
        '<div ' + attrs() + '></div>\n' +
        '<script src="' + origin() + '/embed/v1/widget.js" async></' + 'script>';
      p.api.textContent = origin() + '/embed/v1/' + slug() + '.json';
      if (p.guide) p.guide.href = origin() + '/embed/v1/' + slug() + '-guide.md';
      panel.renderPreview();
    };

    panel.renderPreview = function () {
      /* Debounced: a colour input fires continuously while the picker is
         dragged, and every rebuild is a fresh document. */
      clearTimeout(panel.timer);
      panel.timer = setTimeout(function () {
        if (!p.frame || !payload) return;

        /* MERGED, not replaced. Assigning a fresh theme object dropped
           accent2 entirely, so a chosen second colour could never appear. */
        var live = JSON.parse(JSON.stringify(payload));
        live.theme = Object.assign({}, live.theme, {
          accent: HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT,
          accent2: secondColour(),
          mode: p.theme.value || 'auto',
        });

        p.frame.srcdoc =
          '<!doctype html><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<body style="margin:0;padding:20px;background:transparent">' +
          '<script>window.__thaumaPreview=' +
            JSON.stringify(live).replace(/</g, '\\u003c') +
          '</' + 'script>' +
          '<div ' + attrs() + '></div>' +
          '<script src="' + origin() + '/embed/v1/widget.js"></' + 'script>';
      }, 160);
    };

    /* Narrowing the STAGE is not a simulation. The widget picks its layout
       from the width it is actually given, so a 380px frame makes exactly the
       decision a phone would — the roadmap becomes a vertical column rather
       than a horizontal rail. */
    panel.setDevice = function (which) {
      panel.device = which;
      p.devWide.classList.toggle('is-on', which === 'wide');
      p.devWide.setAttribute('aria-selected', String(which === 'wide'));
      p.devNarrow.classList.toggle('is-on', which === 'narrow');
      p.devNarrow.setAttribute('aria-selected', String(which === 'narrow'));
      p.stage.classList.toggle('is-narrow', which === 'narrow');
      setTimeout(function () { panel.renderPreview(); }, 30);
    };

    panel.show = function (which) {
      panel.showing = which;
      var embedded = which === 'embed';
      p.viewEdit.classList.toggle('is-on', !embedded);
      p.viewEdit.setAttribute('aria-selected', String(!embedded));
      p.viewEmbed.classList.toggle('is-on', embedded);
      p.viewEmbed.setAttribute('aria-selected', String(embedded));
      p.panel.hidden = !embedded;
      Array.prototype.forEach.call(content, function (el) { el.hidden = embedded; });
      if (embedded) panel.renderPreview();
    };

    panel.render = function () {
      if (!settings) return;
      var e = settings.embed || {};
      var admin = settings.you && settings.you.is_admin;

      bar.hidden = false;

      p.on.disabled = !admin;
      if (p.notAdmin) p.notAdmin.hidden = !!admin;

      var accent = HEX.test(e.accent || '') ? e.accent : DEFAULT_ACCENT;
      p.accent.value = accent;
      p.accentHex.value = accent;
      p.accent.disabled = !admin;
      p.accentHex.disabled = !admin;

      /* NULL in the database means "derive it", which is exactly what the
         automatic switch means — so the stored value IS the state of the
         switch, and there is no separate flag to fall out of step with it. */
      var auto = !e.accent2;
      p.pairAuto.checked = auto;
      p.pairAuto.disabled = !admin;
      var second = auto ? companion(accent) : e.accent2;
      p.accent2.value = second;
      p.accent2Hex.value = second;
      p.accent2.disabled = !admin || auto;
      p.accent2Hex.disabled = !admin || auto;

      p.theme.value = e.theme || 'auto';
      p.theme.disabled = !admin;

      if (p.tlStart) {
        var tl = settings.timeline || {};
        p.tlStart.value = tl.start || '';
        p.tlEnd.value = tl.end || '';
        p.tlStart.disabled = !admin;
        p.tlEnd.disabled = !admin;
        p.tlSave.disabled = !admin;
      }

      /* Only the languages this partner publishes. Offering one that is
         switched off would build a snippet whose widget silently falls back
         to English on somebody else's website. */
      var langs = (settings.languages || []).filter(function (l) { return l.is_enabled; });
      if (!langs.length) langs = settings.languages || [];
      var keep = p.lang.value;
      p.lang.innerHTML = langs.map(function (l) {
        return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
      }).join('');
      if (keep) p.lang.value = keep;

      var on = !!e.enabled;
      p.state.textContent = on ? tr('emb.stateOn') : tr('emb.stateOff');
      p.state.className = 'emb-state' + (on ? ' is-on' : '');
      p.on.setAttribute('aria-checked', on ? 'true' : 'false');
      if (p.onState) p.onState.textContent = on ? tr('emb.switchOn') : tr('emb.switchOff');
      if (p.shareDesc) p.shareDesc.textContent = on ? tr('emb.shareOn') : tr('emb.shareOff');

      panel.renderCode();
    };

    /* ---- wiring ---- */

    p.viewEdit.addEventListener('click', function () { panel.show('edit'); });
    p.viewEmbed.addEventListener('click', function () { panel.show('embed'); });
    p.devWide.addEventListener('click', function () { panel.setDevice('wide'); });
    p.devNarrow.addEventListener('click', function () { panel.setDevice('narrow'); });

    p.on.addEventListener('click', function () { if (!this.disabled) save(panel, this, true); });
    p.theme.addEventListener('change', function () { save(panel, this); });

    p.accent.addEventListener('input', function () {
      p.accentHex.value = this.value.toUpperCase();
      if (p.pairAuto.checked) {
        var d = companion(this.value);
        p.accent2.value = d;
        p.accent2Hex.value = d;
      }
      panel.renderPreview();
    });
    p.accent.addEventListener('change', function () {
      p.accentHex.value = this.value.toUpperCase();
      save(panel, this);
    });
    p.accentHex.addEventListener('change', function () {
      if (HEX.test(this.value.trim())) p.accent.value = this.value.trim();
      save(panel, this);
    });

    p.pairAuto.addEventListener('change', function () {
      var d = companion(HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT);
      if (this.checked) { p.accent2.value = d; p.accent2Hex.value = d; }
      p.accent2.disabled = this.checked;
      p.accent2Hex.disabled = this.checked;
      save(panel, this);
    });
    p.accent2.addEventListener('input', function () {
      p.accent2Hex.value = this.value.toUpperCase();
      panel.renderPreview();
    });
    p.accent2.addEventListener('change', function () {
      p.accent2Hex.value = this.value.toUpperCase();
      save(panel, this);
    });
    p.accent2Hex.addEventListener('change', function () {
      if (HEX.test(this.value.trim())) p.accent2.value = this.value.trim();
      save(panel, this);
    });

    // Snippet-only — nothing to save.
    p.lang.addEventListener('change', panel.renderCode);

    if (p.tlSave) {
      p.tlSave.addEventListener('click', async function () {
        var start = p.tlStart.value || null, end = p.tlEnd.value || null;
        this.disabled = true;
        try {
          var res = await fetch(SETTINGS, {
            method: 'PATCH', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeline: { start: start, end: end } })
          });
          var body = await res.json().catch(function () { return {}; });
          if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
          toast(tr('toast.saved'), 'ok');
          /* Re-read the PREVIEW too: the bounds move every milestone and
             change how far the line has filled. */
          await load();
        } catch (err) {
          toast(err.message, 'bad');
        } finally {
          this.disabled = false;
        }
      });
    }

    function copier(source) {
      return function () {
        var v = source.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(v).then(function () { toast(tr('toast.copied'), 'ok'); });
        } else {
          var r = document.createRange();
          r.selectNode(source);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(r);
          toast('Selected — press Ctrl/Cmd C', 'ok');
        }
      };
    }
    p.copyCode.addEventListener('click', copier(p.code));
    p.copyApi.addEventListener('click', copier(p.api));

    return panel;
  }

  /* ---- shared loading and saving --------------------------------------- */

  async function load() {
    var results = await Promise.allSettled([
      fetch(SETTINGS, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('settings ' + r.status));
      }),
      fetch(PREVIEW, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('preview ' + r.status));
      }),
    ]);

    if (results[0].status !== 'fulfilled') {
      /* SAY SO, in the page. Failing silently here once read as the feature
         never having been built. */
      panels.forEach(function (panel) {
        panel.bar.hidden = false;
        panel.p.viewEdit.hidden = true;
        panel.p.viewEmbed.hidden = true;
        panel.p.state.className = 'emb-state';
        panel.p.state.textContent =
          tr('emb.unavailable') + ' ' + String(results[0].reason.message || '');
      });
      console.error('embed panel could not load settings:', results[0].reason);
      return;
    }
    settings = results[0].value;
    payload = results[1].status === 'fulfilled' ? results[1].value : null;
    if (!payload) console.error('embed preview unavailable:', results[1].reason);

    panels.forEach(function (panel) {
      try { panel.render(); }
      catch (err) { console.error('embed panel failed to draw:', err); }
    });
  }

  async function save(panel, control, toggling) {
    var p = panel.p;
    var hex = p.accentHex.value.trim();
    if (!HEX.test(hex)) { toast(tr('emb.badHex'), 'bad'); return; }

    var wasOn = !!(settings.embed && settings.embed.enabled);
    var want = toggling ? !wasOn : wasOn;

    if (control) control.disabled = true;
    var res, body;
    try {
      res = await fetch(SETTINGS, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed: {
          enabled: want, accent: hex, theme: p.theme.value,
          /* null means "derive it" — the switch and the stored value are the
             same fact. */
          accent2: p.pairAuto.checked ? null : p.accent2Hex.value.trim(),
        } })
      });
      body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
    } catch (err) {
      toast(err.message, 'bad');
      await load();
      if (control) control.disabled = false;
      return;
    }
    if (control) control.disabled = false;

    settings.embed = body.embed || settings.embed;
    /* EVERY panel, not just this one — the colours are shared, so a second
       panel still showing the old pair would be lying. */
    panels.forEach(function (x) { x.render(); });
    toast(tr(toggling ? (want ? 'emb.nowShared' : 'emb.nowPrivate') : 'toast.saved'), 'ok');
  }

  /* ---- the frame follows its content ----------------------------------- */

  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    if (!h) return;
    /* WHICH panel sent it. The message comes from an iframe, and contentWindow
       identifies which — without this the first panel would take every
       measurement, including the other two sections'. */
    panels.forEach(function (panel) {
      var f = panel.p.frame;
      if (f && f.contentWindow === e.source) {
        f.style.height = Math.max(180, Math.min(2400, h)) + 'px';
      }
    });
  });

  Array.prototype.forEach.call(bars, function (bar) { panels.push(makePanel(bar)); });
  load();
})();
