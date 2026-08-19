/* ============================================================
   staff-embed.js — "Edit" or "As embedded"
   ============================================================
   Mounts on the pages that AUTHOR what the widget publishes: the roadmap on
   Milestones, the giving progress on Support.

   IT IS A VIEW SWITCH, NOT A SECOND PANEL. Support already draws goal cards;
   putting the widget underneath would be two of nearly the same thing on one
   screen, and you would spend the time comparing them rather than reading
   either. So choosing "As embedded" hides the page's own content and shows
   the real widget in its place.

   Read the other way round, that is also the "hide the visualiser and just
   edit the data" control — same switch, one job.

   THE PREVIEW WORKS BEFORE YOU PUBLISH, which is the whole reason
   /api/staff-embed exists. The public endpoint 404s until embedding is
   switched on, so a preview that fetched it could only show what you had
   already published — backwards for the one control here that makes something
   readable by anyone on the internet. The console fetches the payload with its
   own session and hands it to the iframe.

   WHAT SAVES AND WHAT DOES NOT:
     accent, theme, on   SAVED, per partner, shared by every widget
     language            NOT saved — it belongs to the snippet you paste
   ============================================================ */
(function () {
  'use strict';

  var bar = document.querySelector('[data-embed-panel]');
  if (!bar) return;

  var SETTINGS = '/api/staff-settings';
  var PREVIEW  = '/api/staff-embed';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#6D4AFF';

  /* The same -33 degree rotation the Worker and the widget use, so the panel
     can show what "match automatically" will produce without asking the
     server. Three copies of this exist and a test asserts they agree — see
     workers/src/embed-colour.js. */
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

  /* What the second field should show right now: the chosen colour, or the
     derived one when the pair is on automatic. */
  function secondColour() {
    if (p.pairAuto && p.pairAuto.checked) {
      return companion(HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT);
    }
    return HEX.test(p.accent2Hex.value.trim()) ? p.accent2Hex.value.trim() : DEFAULT_ACCENT;
  }

  var kind = bar.getAttribute('data-widget') || 'goal';
  var panel = document.querySelector('[data-emb="panel"]');
  var pageContent = document.querySelectorAll('[data-emb-content]');

  var settings = null;   // /api/staff-settings — languages, roles, embed config
  var payload = null;    // /api/staff-embed    — what the widget will render
  var showing = 'edit';

  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function langLabel(l) { return (l.native_name || l.name) + ' (' + l.code + ')'; }

  var p = {};
  Array.prototype.forEach.call(document.querySelectorAll('[data-emb]'), function (el) {
    p[el.getAttribute('data-emb')] = el;
  });

  /* ---- the snippet and the data address -------------------------------- */

  /* Whatever host this console is on. On dev.thauma.one the copied snippet
     points at dev, which is what makes it testable before it is real. */
  function origin() { return location.origin; }
  function slug() { return (settings && settings.partner && settings.partner.slug) || ''; }

  function attrs() {
    var a = ['data-thauma="' + esc(slug()) + '"'];
    if (kind !== 'goal') a.push('data-widget="' + esc(kind) + '"');
    var lang = p.lang.value;
    if (lang && lang !== 'en') a.push('data-lang="' + esc(lang) + '"');
    return a.join(' ');
  }

  function renderCode() {
    if (!slug()) return;
    p.code.textContent =
      '<div ' + attrs() + '></div>\n' +
      '<script src="' + origin() + '/embed/v1/widget.js" async></' + 'script>';
    p.api.textContent = origin() + '/embed/v1/' + slug() + '.json';
    if (p.guide) p.guide.href = origin() + '/embed/v1/' + slug() + '-guide.md';
    renderPreview();
  }

  var timer = null;
  function renderPreview() {
    /* Debounced: a colour input fires continuously while the picker is dragged,
       and every rebuild is a fresh document. */
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!p.frame || !payload) return;

      /* The payload goes in as data, with the CURRENT unsaved appearance
         applied, so dragging the colour picker updates the widget without a
         round trip and without saving first. */
      var live = JSON.parse(JSON.stringify(payload));
      /* MERGED, not replaced. Assigning a fresh object here dropped accent2
         entirely, so a chosen second colour could never appear in the preview
         — it silently fell back to the derived one, which looks identical
         until somebody picks a colour that is not. */
      live.theme = Object.assign({}, live.theme, {
        accent: HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT,
        accent2: secondColour(),
        mode: p.theme.value || 'auto',
      });

      p.frame.srcdoc =
        '<!doctype html><meta charset="utf-8">' +
        '<body style="margin:0;padding:20px;background:transparent">' +
        '<script>window.__thaumaPreview=' +
          JSON.stringify(live).replace(/</g, '\\u003c') +
        '</' + 'script>' +
        '<div ' + attrs() + '></div>' +
        '<script src="' + origin() + '/embed/v1/widget.js"></' + 'script>';
    }, 160);
  }

  /* ---- drawing --------------------------------------------------------- */

  function renderState() {
    var on = !!(settings && settings.embed && settings.embed.enabled);
    p.state.textContent = on ? tr('emb.stateOn') : tr('emb.stateOff');
    p.state.className = 'emb-state' + (on ? ' is-on' : '');

    p.on.setAttribute('aria-checked', on ? 'true' : 'false');
    if (p.onState) p.onState.textContent = on ? tr('emb.switchOn') : tr('emb.switchOff');
    if (p.shareDesc) {
      p.shareDesc.textContent = on ? tr('emb.shareOn') : tr('emb.shareOff');
    }
  }

  function render() {
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

    p.theme.value = e.theme || 'auto';
    p.theme.disabled = !admin;

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

    var tl = (settings && settings.timeline) || {};
    p.tlStart.value = tl.start || '';
    p.tlEnd.value = tl.end || '';
    p.tlStart.disabled = !admin;
    p.tlEnd.disabled = !admin;
    p.tlSave.disabled = !admin;

    /* Only the languages this partner actually publishes. Offering one that is
       switched off would build a snippet whose widget silently falls back to
       English on somebody else's website. */
    var langs = (settings.languages || []).filter(function (l) { return l.is_enabled; });
    if (!langs.length) langs = settings.languages || [];
    var keep = p.lang.value;
    p.lang.innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
    }).join('');
    if (keep) p.lang.value = keep;

    renderState();
    renderCode();
  }

  /* ---- the view switch ------------------------------------------------- */

  function show(which) {
    showing = which;
    var embedded = which === 'embed';

    p.viewEdit.classList.toggle('is-on', !embedded);
    p.viewEdit.setAttribute('aria-selected', String(!embedded));
    p.viewEmbed.classList.toggle('is-on', embedded);
    p.viewEmbed.setAttribute('aria-selected', String(embedded));

    panel.hidden = !embedded;
    Array.prototype.forEach.call(pageContent, function (el) { el.hidden = embedded; });

    // Rebuild on entry: the appearance may have changed while editing.
    if (embedded) renderPreview();
  }

  p.viewEdit.addEventListener('click', function () { show('edit'); });
  p.viewEmbed.addEventListener('click', function () { show('embed'); });

  /* ---- loading and saving ---------------------------------------------- */

  async function load() {
    /* Both at once. The settings answer is what the panel is made of; the
       preview answer is what the widget draws. Neither is useful alone. */
    var results = await Promise.allSettled([
      fetch(SETTINGS, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('settings ' + r.status));
      }),
      fetch(PREVIEW, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
        return r.ok ? r.json() : Promise.reject(new Error('preview ' + r.status));
      }),
    ]);

    if (results[0].status !== 'fulfilled') {
      /* SAY SO, in the page.

         This used to fail silently — log to the console and leave the bar
         hidden — on the reasoning that a goals page should not shout about a
         secondary panel. That was wrong, and it cost an afternoon on
         2026-08-18: "there is still no visualiser anywhere" is what a silent
         failure looks like from the outside, and it is indistinguishable from
         the feature never having been built.

         A thing that is supposed to be on the page should either be on the
         page or explain itself. */
      bar.hidden = false;
      p.viewEdit.hidden = true;
      p.viewEmbed.hidden = true;
      p.state.className = 'emb-state';
      p.state.textContent = tr('emb.unavailable') + ' ' + String(results[0].reason.message || '');
      console.error('embed panel could not load settings:', results[0].reason);
      return;
    }
    settings = results[0].value;
    payload = results[1].status === 'fulfilled' ? results[1].value : null;

    if (!payload) console.error('embed preview unavailable:', results[1].reason);
    render();
  }

  async function save(control) {
    var hex = p.accentHex.value.trim();
    if (!HEX.test(hex)) { toast(tr('emb.badHex'), 'bad'); return; }

    var wasOn = !!(settings.embed && settings.embed.enabled);
    var want = control === p.on ? !wasOn : wasOn;

    if (control) control.disabled = true;
    var res, body;
    try {
      res = await fetch(SETTINGS, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed: {
          enabled: want, accent: hex, theme: p.theme.value,
          /* null means "derive it" — the automatic switch and the stored
             value are the same fact. */
          accent2: p.pairAuto.checked ? null : p.accent2Hex.value.trim(),
        } })
      });
      body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
    } catch (err) {
      toast(err.message, 'bad');
      await load();                     // the server knows what actually happened
      if (control) control.disabled = false;
      return;
    }
    if (control) control.disabled = false;

    settings.embed = body.embed || settings.embed;
    render();
    toast(tr(control === p.on
      ? (want ? 'emb.nowShared' : 'emb.nowPrivate')
      : 'toast.saved'), 'ok');
  }

  /* ---- wiring ---------------------------------------------------------- */

  p.on.addEventListener('click', function () { if (!this.disabled) save(this); });
  p.theme.addEventListener('change', function () { save(this); });

  /* The picker mirrors into the hex box live and saves once, on change. The hex
     box saves on change rather than on input, or typing "#6D" would be four
     rejected requests. */
  p.accent.addEventListener('input', function () {
    p.accentHex.value = this.value.toUpperCase();
    renderPreview();
  });
  p.accent.addEventListener('change', function () {
    p.accentHex.value = this.value.toUpperCase();
    save(this);
  });
  p.accentHex.addEventListener('change', function () {
    if (HEX.test(this.value.trim())) p.accent.value = this.value.trim();
    save(this);
  });

  p.pairAuto.addEventListener('change', function () {
    var derived = companion(HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT);
    if (this.checked) { p.accent2.value = derived; p.accent2Hex.value = derived; }
    p.accent2.disabled = this.checked;
    p.accent2Hex.disabled = this.checked;
    save(this);
  });
  p.accent2.addEventListener('input', function () {
    p.accent2Hex.value = this.value.toUpperCase();
    renderPreview();
  });
  p.accent2.addEventListener('change', function () {
    p.accent2Hex.value = this.value.toUpperCase();
    save(this);
  });
  p.accent2Hex.addEventListener('change', function () {
    if (HEX.test(this.value.trim())) p.accent2.value = this.value.trim();
    save(this);
  });

  /* The first colour moving drags the derived one with it, so the pair never
     shows a stale companion while automatic. */
  p.accent.addEventListener('input', function () {
    if (p.pairAuto.checked) {
      var d = companion(HEX.test(p.accentHex.value.trim()) ? p.accentHex.value.trim() : DEFAULT_ACCENT);
      p.accent2.value = d;
      p.accent2Hex.value = d;
    }
  });

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
      /* Re-read the PREVIEW too: the bounds change where every milestone sits
         and how far the line has filled, so the panel has to fetch again
         rather than redraw the payload it already had. */
      await load();
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      this.disabled = false;
    }
  });

  // Snippet-only — nothing to save.
  p.lang.addEventListener('change', renderCode);

  /* THE PREVIEW GROWS, IT DOES NOT SCROLL. The widget measures itself and
     posts its height out; a fixed frame with a scrollbar inside it is not what
     the thing looks like on a real page, and a roadmap is exactly the shape
     that overflows one. Clamped at the top end so a partner with forty
     milestones cannot produce a frame nobody can scroll past. */
  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    if (!h || !p.frame) return;
    p.frame.style.height = Math.max(180, Math.min(2400, h + 8)) + 'px';
  });

  function copier(sourceEl) {
    return function () {
      var v = sourceEl.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(v).then(function () { toast(tr('toast.copied'), 'ok'); });
      } else {
        var r = document.createRange();
        r.selectNode(sourceEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
        toast('Selected — press Ctrl/Cmd C', 'ok');
      }
    };
  }
  p.copyCode.addEventListener('click', copier(p.code));
  p.copyApi.addEventListener('click', copier(p.api));

  load();
})();
