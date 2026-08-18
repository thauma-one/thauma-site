/* ============================================================
   staff-embed.js — the "put this on another website" panel
   ============================================================
   Mounts into any element carrying [data-embed-panel]. The page decides which
   widget it is about via data-widget; there is no picker, because the page you
   are on has already chosen — the roadmap panel lives under the milestone
   editor and the giving panel under the goals.

   This began life as a tab on the Settings page and was moved on 2026-08-18.
   Configuring a preview of something you had to navigate away from to see was
   the wrong shape, and the tab had nothing else to justify it.

   WHAT SAVES AND WHAT DOES NOT, because the panel mixes both:

     accent, theme   SAVED, per partner. They belong to the ministry, so a
                     page that embedded this last year picks up a rebrand
                     without anyone editing it. Shared by every widget.
     language, rows  NOT saved. They belong to the placement, and live in the
                     snippet you paste.

   Reads and writes /api/staff-settings, which is also what the Settings page
   uses — one endpoint, because this is partner configuration wherever it is
   drawn.
   ============================================================ */
(function () {
  'use strict';

  var panels = document.querySelectorAll('[data-embed-panel]');
  if (!panels.length) return;

  var API = '/api/staff-settings';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#6D4AFF';

  var state = null;      // the last response, shared by every panel on the page

  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function langLabel(l) { return (l.native_name || l.name) + ' (' + l.code + ')'; }

  /** Every control in one panel, by its data-emb name. */
  function parts(panel) {
    var q = {};
    Array.prototype.forEach.call(panel.querySelectorAll('[data-emb]'), function (el) {
      q[el.getAttribute('data-emb')] = el;
    });
    return q;
  }

  /* ---- the snippet ----------------------------------------------------- */

  /* Whatever host this console is on. On dev.thauma.one the copied snippet
     points at dev, which is what makes it testable before it is real. */
  function origin() { return location.origin; }

  function attrs(panel, p) {
    var a = ['data-thauma="' + esc(state.partner.slug) + '"'];

    var kind = panel.getAttribute('data-widget') || 'goal';
    if (kind !== 'goal') a.push('data-widget="' + esc(kind) + '"');

    var lang = p.lang && p.lang.value;
    if (lang && lang !== 'en') a.push('data-lang="' + esc(lang) + '"');

    var limit = parseInt(p.limit && p.limit.value, 10);
    if (limit > 0) a.push('data-limit="' + limit + '"');

    return a.join(' ');
  }

  function renderCode(panel, p) {
    if (!state || !state.partner || !state.partner.slug) return;
    p.code.textContent =
      '<div ' + attrs(panel, p) + '></div>\n' +
      '<script src="' + origin() + '/embed/v1/widget.js" async></' + 'script>';
    renderPreview(panel, p);
  }

  var timers = new WeakMap();
  function renderPreview(panel, p) {
    /* Debounced: a colour input fires continuously while the picker is
       dragged, and every rebuild is a fresh document and a fetch. */
    clearTimeout(timers.get(panel));
    timers.set(panel, setTimeout(function () {
      if (!p.frame) return;
      p.frame.srcdoc =
        '<!doctype html><meta charset="utf-8">' +
        '<body style="margin:0;padding:16px;background:transparent">' +
        '<div ' + attrs(panel, p) + '></div>' +
        '<script src="' + origin() + '/embed/v1/widget.js"></' + 'script>';
    }, 180));
  }

  /* ---- drawing --------------------------------------------------------- */

  function render(panel) {
    var p = parts(panel);
    var e = (state && state.embed) || {};
    var admin = state && state.you && state.you.is_admin;

    panel.hidden = false;

    p.on.checked = !!e.enabled;
    p.on.disabled = !admin;
    if (p.notAdmin) p.notAdmin.hidden = !!admin;
    if (p.offNote) p.offNote.hidden = !!e.enabled;
    p.rest.hidden = !e.enabled;

    var accent = HEX.test(e.accent || '') ? e.accent : DEFAULT_ACCENT;
    p.accent.value = accent;
    p.accentHex.value = accent;
    p.accent.disabled = !admin;
    p.accentHex.disabled = !admin;

    p.theme.value = e.theme || 'auto';
    p.theme.disabled = !admin;

    /* Only the languages this partner actually publishes. Offering one that is
       switched off would build a snippet whose widget silently falls back to
       English on somebody else's website. */
    var langs = (state.languages || []).filter(function (l) { return l.is_enabled; });
    if (!langs.length) langs = state.languages || [];
    var keep = p.lang.value;
    p.lang.innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
    }).join('');
    if (keep) p.lang.value = keep;

    renderCode(panel, p);
  }

  function renderAll() {
    Array.prototype.forEach.call(panels, function (panel) {
      try { render(panel); }
      catch (err) { console.error('embed panel failed to draw:', err); }
    });
  }

  /* ---- loading and saving ---------------------------------------------- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (err) {
      /* Quiet. This panel is secondary to the page it sits on, and a milestone
         editor that shouts about an embed panel it could not draw is worse
         than one that simply does not show it. */
      console.error('embed panel could not load:', err);
      return;
    }
    if (!res.ok) {
      console.error('embed panel refused:', (body && body.error) || res.status);
      return;
    }
    state = body;
    renderAll();
  }

  async function save(panel, p, control) {
    var hex = p.accentHex.value.trim();
    if (!HEX.test(hex)) { toast(tr('emb.badHex'), 'bad'); return; }

    if (control) control.disabled = true;
    var res, body;
    try {
      res = await fetch(API, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embed: {
          enabled: p.on.checked, accent: hex, theme: p.theme.value,
        } })
      });
      body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
    } catch (err) {
      toast(err.message, 'bad');
      await load();                        // the server knows what actually happened
      if (control) control.disabled = false;
      return;
    }
    if (control) control.disabled = false;

    state.embed = body.embed || state.embed;
    /* Every panel on the page, not just this one — accent and theme are shared,
       so a second panel showing the old colour would be lying. */
    renderAll();
    toast(tr('toast.saved'), 'ok');
  }

  /* ---- wiring ---------------------------------------------------------- */

  Array.prototype.forEach.call(panels, function (panel) {
    var p = parts(panel);

    p.on.addEventListener('change', function () { save(panel, p, this); });
    p.theme.addEventListener('change', function () { save(panel, p, this); });

    /* The picker mirrors into the hex box live and saves once, on change. The
       hex box saves on change rather than on input, or typing "#6D" would be
       four rejected requests. */
    p.accent.addEventListener('input', function () {
      p.accentHex.value = this.value.toUpperCase();
      renderPreview(panel, p);
    });
    p.accent.addEventListener('change', function () {
      p.accentHex.value = this.value.toUpperCase();
      save(panel, p, this);
    });
    p.accentHex.addEventListener('change', function () {
      if (HEX.test(this.value.trim())) p.accent.value = this.value.trim();
      save(panel, p, this);
    });

    // Snippet-only — nothing to save.
    p.lang.addEventListener('change', function () { renderCode(panel, p); });
    p.limit.addEventListener('change', function () { renderCode(panel, p); });

    p.copy.addEventListener('click', function () {
      var v = p.code.textContent;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(v).then(function () { toast(tr('toast.copied'), 'ok'); });
      } else {
        var r = document.createRange();
        r.selectNode(p.code);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
        toast('Selected — press Ctrl/Cmd C', 'ok');
      }
    });
  });

  load();
})();
