/* ============================================================
   staff-settings.js — Settings
   ============================================================
   Unlike the milestone editor, these save IMMEDIATELY and on
   purpose. Each one is a single decision with an obvious result,
   not a body of text edited in passes — a working copy and a Save
   button would be ceremony around flipping one switch.

   What that costs is a moment where the screen could be ahead of
   the database, so every control is disabled while its request is
   in flight and put back if it fails. The screen never claims a
   state the server has not confirmed.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-staff-page') !== 'settings') return;

  var API = '/api/staff-settings';
  var $ = function (id) { return document.getElementById(id); };
  var state = { languages: [], keys: [], you: null, partner: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* Outcomes only — see the note in staff-milestones.js. */
  function problem(msg, retry) {
    if (window.StaffProblem) window.StaffProblem(msg, retry);
  }
  function problemClear() {
    if (window.StaffProblemClear) window.StaffProblemClear();
  }

  /* Toast text goes through the dictionary, so a message raised by changing
     the language arrives IN that language. Passing an already-built English
     string here was the bug: the interface translated and its notifications
     did not. */
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }

  function toastKey(key, kind) {
    setStatus(window.StaffI18n ? window.StaffI18n.t(key) : key, kind);
  }

  function setStatus(text, kind) {
    if (text && kind && window.StaffToast) window.StaffToast(text, kind);
  }

  function langLabel(l) { return (l.native_name || l.name) + ' (' + l.code + ')'; }

  /* ---- tabs ---------------------------------------------------------- */

  function showTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
      p.hidden = p.dataset.panel !== name;
    });
    // Survives a reload, so returning to a tab you were working in does not
    // mean finding it again.
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }

  /* ---- rendering ------------------------------------------------------ */

  function render() {
    // Name AND address. The header shows whatever Cloudflare Access happens
    // to carry, which is often just an email; this is the record we hold.
    $('setEmail').innerHTML = (state.you.name ? '<b>' + esc(state.you.name) + '</b><br>' : '') +
      esc(state.you.email);

    // Roles as tags rather than a sentence, because there will be more of them
    // — board, and whatever else the org grows into — and a list reads the
    // same at one item as at four.
    var roles = [];
    if (state.you.is_admin) roles.push({ label: 'Administrator', cls: 'admin' });
    else roles.push({ label: 'Staff', cls: '' });
    if (state.partner && state.partner.display_name) {
      roles.push({ label: state.partner.display_name, cls: 'partner' });
    }
    $('setRoles').innerHTML = roles.map(function (r) {
      return '<span class="role-tag ' + r.cls + '">' + esc(r.label) + '</span>';
    }).join('');

    // Your own working language: every language the organisation offers, not
    // just the ones this partner publishes — you might work in a language the
    // site does not serve.
    $('setPrefLang').innerHTML = state.languages.map(function (l) {
      return '<option value="' + esc(l.code) + '"' +
        (l.code === state.you.preferred_lang ? ' selected' : '') + '>' +
        esc(langLabel(l)) + '</option>';
    }).join('');

    $('setLangList').innerHTML = state.languages.map(function (l) {
      var isDefault = l.code === state.partner.default_lang;
      return '<div class="lang-row">' +
        '<button type="button" class="switch" role="switch" data-lang="' + esc(l.code) + '"' +
          ' aria-checked="' + (l.is_enabled ? 'true' : 'false') + '"' +
          (isDefault ? ' disabled' : '') +
          ' aria-label="Publish ' + esc(l.name) + '">' +
          '<span class="switch-track"><span class="switch-state">' +
            (l.is_enabled ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
        '</button>' +
        '<span class="switch-label">' + esc(langLabel(l)) +
          (isDefault ? '<span class="switch-note">' + tr('set.defaultLangNote') + '</span>'
                     : '') +
        '</span></div>';
    }).join('');

    renderKeys();
    renderEmbeds();
  }

  /* Reads state.api_keys, which is what the endpoint actually returns. It
     read state.keys until 2026-08-15 — undefined, so .length threw and the
     whole Settings page failed to draw. The error was visible only because
     render failures stopped being reported as network problems. */
  function renderKeys() {
    var keys = state.api_keys || [];
    if (!keys.length) {
      $('setKeyList').innerHTML = '<p class="empty">' + tr('set.keysEmpty') + '</p>';
      return;
    }
    $('setKeyList').innerHTML = keys.map(function (k) {
      return '<div class="key-row' + (k.revoked ? ' is-revoked' : '') + '">' +
        '<div><span class="key-title">' + esc(k.name) + '</span>' +
          '<span class="key-meta">created ' + esc((k.created_at || '').slice(0, 10)) +
          ' · ' + (k.last_used_at
            ? 'last used ' + esc(k.last_used_at.slice(0, 10))
            : 'never used') + '</span></div>' +
        (k.revoked
          ? '<span class="badge proto">' + tr('set.revoked') + '</span>'
          : '<button type="button" class="del" data-revoke="' + esc(k.id) + '">Revoke</button>') +
      '</div>';
    }).join('');
  }

  /* ---- loading and saving --------------------------------------------- */

  /* WHY THE ERROR HANDLING IS THIS FUSSY

     This used to be one try/catch that reported everything as "Could not
     reach the server". That sentence was often untrue: the catch also caught
     bugs in the rendering code below it, so a null element or a bad property
     access was reported as a network failure. It told you nothing because it
     was not describing what happened.

     Three separate failures now say three different things:
       the request never completed   -> the network, retryable
       the server answered an error  -> the status, with its message
       the page failed to draw       -> a fault in the console itself
  */
  async function load() {
    var res, body;

    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      problem(tr('err.unreachable') + ' ' + e.message, load);
      return;
    }

    try {
      body = await res.json();
    } catch (e) {
      problem(tr('err.unreadable') + ' (' + res.status + ')', load);
      return;
    }

    if (!res.ok) {
      problem(
        res.status === 401
          ? tr('err.expired')
        : res.status === 403
          ? tr('err.noPartner') + ' (' + (body.email || 'unknown') + ')'
          : tr('err.refused') + ' (' + res.status + ')' +
            (body.error ? ' — ' + body.error : '') + '.',
        res.status === 401 ? null : load);
      return;
    }

    problemClear();
    state = body;
    // The banner is painted from the SERVER's word, never from the cookie.
    if (window.StaffActing) window.StaffActing(body);

    // The account is the source of truth; the cache only avoids a flash of
    // English on first paint.
    if (window.StaffI18n && state.you && state.you.preferred_lang) {
      window.StaffI18n.setLang(state.you.preferred_lang);
    }

    try {
      render();
    } catch (e) {
      // NOT a network problem, and saying so would send you looking in the
      // wrong place entirely.
      problem(tr('err.renderFailed') + ': ' + e.message, null);
      console.error('settings render failed:', e);
    }
  }

  /* Sends one change and reloads from what the server says. `control` is
     disabled throughout, so nothing can be flipped twice while in flight. */
  async function change(payload, control, message) {
    if (control) control.disabled = true;
    try {
      var res = await fetch(API, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
      await load();
      toastKey(message || 'toast.saved', 'ok');
    } catch (e) {
      // Reload rather than reverting by hand: the server is the only thing
      // that knows what actually happened.
      await load();
      setStatus(e.message, 'err');
    } finally {
      if (control) control.disabled = false;
    }
  }

  /* ---- wiring --------------------------------------------------------- */

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); });
  });

  // In-page links that move to another tab, so a pointer to a setting lands on
  // it rather than telling you where to look.
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-goto]');
    if (!go) return;
    showTab(go.dataset.goto);
    var target = $('setPrefLang');
    if (target) target.focus();
  });

  $('setPrefLang').addEventListener('change', function (e) {
    var code = e.target.value;
    // Applied before the request completes, deliberately. Translating the
    // interface has no consequence if the save fails, and waiting for a round
    // trip to change a language makes the control feel broken.
    // Applied before the request completes, so the toast that follows is
    // already in the new language.
    if (window.StaffI18n) window.StaffI18n.setLang(code);
    change({ preferred_lang: code }, e.target, 'toast.langChanged');
  });

  $('setLangList').addEventListener('click', function (e) {
    var sw = e.target.closest('[data-lang]');
    if (!sw || sw.disabled) return;
    var on = sw.getAttribute('aria-checked') !== 'true';
    change({ language: sw.dataset.lang, is_enabled: on }, sw,
           on ? 'toast.published' : 'toast.unpublished');
  });

  $('setKeyList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    if (!confirm('Revoke this key? Any site using it will stop receiving data ' +
                 'immediately, and it cannot be un-revoked.')) return;
    change({ revoke_key: btn.dataset.revoke }, btn, 'toast.keyRevoked');
  });

  $('setKeyAdd').addEventListener('click', async function () {
    var name = $('setKeyName').value.trim();
    if (!name) { toastKey('err.nameKeyFirst', 'err'); $('setKeyName').focus(); return; }

    $('setKeyAdd').disabled = true;
    try {
      var res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));

      // The one and only time this value exists outside the database as a hash.
      $('setKeyValue').textContent = body.key;
      $('setKeyReveal').hidden = false;
      $('setKeyName').value = '';
      state.api_keys = body.api_keys || [];
      renderKeys();
      toastKey('toast.keyCreated', 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
    } finally {
      $('setKeyAdd').disabled = false;
    }
  });

  $('setKeyCopy').addEventListener('click', function () {
    var v = $('setKeyValue').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(v).then(function () { toastKey('toast.copied', 'ok'); });
    } else {
      // Older Safari over http has no clipboard API; select it so Ctrl-C works.
      var r = document.createRange();
      r.selectNode($('setKeyValue'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      setStatus('Selected — press Ctrl/Cmd C', 'ok');
    }
  });

  /* ---- embeds ---------------------------------------------------------
     The only panel here that publishes to people who have not signed in to
     anything, so the switch governs everything below it and the rest of the
     panel is ABSENT rather than merely disabled until it is on. A colour
     picker for a widget nobody can fetch invites you to think you have
     shipped something.

     Appearance saves to the server; what the widget SHOWS does not. Colours
     belong to the ministry and should follow a rebrand everywhere at once;
     which widget goes on which page belongs to the page, and lives in the
     snippet. That split is why some controls here save and others only
     rewrite the code box. */

  var HEX = /^#[0-9a-fA-F]{6}$/;

  /* Whatever host this console is on. On dev.thauma.one the copied snippet
     points at dev, which is what makes it testable before it is real. */
  function embedOrigin() { return location.origin; }

  function embedAttrs() {
    var a = ['data-thauma="' + ((state.partner && state.partner.slug) || '') + '"'];

    var w = $('setEmbedWidget').value;
    if (w !== 'goal') a.push('data-widget="' + w + '"');

    var lang = $('setEmbedLang').value;
    if (lang && lang !== 'en') a.push('data-lang="' + lang + '"');

    var limit = parseInt($('setEmbedLimit').value, 10);
    if (limit > 0) a.push('data-limit="' + limit + '"');

    return a.join(' ');
  }

  function renderEmbedCode() {
    if (!state.partner || !state.partner.slug) return;
    $('setEmbedCode').textContent =
      '<div ' + embedAttrs() + '></div>\n' +
      '<script src="' + embedOrigin() + '/embed/v1/widget.js" async></' + 'script>';
    renderEmbedPreview();
  }

  var previewTimer = null;
  function renderEmbedPreview() {
    /* Debounced: a colour input fires continuously while the picker is
       dragged, and every rebuild is a fresh document and a fetch. */
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var frame = $('setEmbedFrame');
      if (!frame) return;

      /* srcdoc in a sandboxed iframe. The widget is a guest on pages we do
         not control, and previewing it inside THIS document — with its own
         stylesheet and fonts — would show something no visitor ever sees. */
      frame.srcdoc =
        '<!doctype html><meta charset="utf-8">' +
        '<body style="margin:0;padding:16px;background:transparent">' +
        '<div ' + embedAttrs() + '></div>' +
        '<script src="' + embedOrigin() + '/embed/v1/widget.js"></' + 'script>';
    }, 180);
  }

  function renderEmbeds() {
    var e = state.embed || {};
    var admin = state.you.is_admin;

    $('setEmbedOn').checked = !!e.enabled;
    $('setEmbedOn').disabled = !admin;
    $('setEmbedNotAdmin').hidden = admin;
    $('setEmbedRest').hidden = !e.enabled;

    var accent = HEX.test(e.accent || '') ? e.accent : '#6D4AFF';
    $('setEmbedAccent').value = accent;
    $('setEmbedAccentHex').value = accent;
    $('setEmbedAccent').disabled = !admin;
    $('setEmbedAccentHex').disabled = !admin;

    $('setEmbedTheme').value = e.theme || 'auto';
    $('setEmbedTheme').disabled = !admin;

    /* Only the languages this partner actually publishes. Offering one that
       is switched off would build a snippet whose widget silently falls back
       to English. */
    var langs = (state.languages || []).filter(function (l) { return l.is_enabled; });
    if (!langs.length) langs = state.languages || [];
    var current = $('setEmbedLang').value;
    $('setEmbedLang').innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
    }).join('');
    if (current) $('setEmbedLang').value = current;

    renderEmbedCode();
  }

  $('setEmbedOn').addEventListener('change', function () {
    change({ embed: {
      enabled: this.checked,
      accent: $('setEmbedAccentHex').value,
      theme: $('setEmbedTheme').value
    } }, this, 'toast.saved');
  });

  function saveLook(control) {
    var hex = $('setEmbedAccentHex').value.trim();
    if (!HEX.test(hex)) { setStatus(tr('set.embedBadHex'), 'err'); return; }
    change({ embed: {
      enabled: $('setEmbedOn').checked,
      accent: hex,
      theme: $('setEmbedTheme').value
    } }, control, 'toast.saved');
  }

  /* The picker mirrors into the hex box live and saves once, on change. The
     hex box saves on change rather than on input, or typing "#6D" would be
     four rejected requests. */
  $('setEmbedAccent').addEventListener('input', function () {
    $('setEmbedAccentHex').value = this.value.toUpperCase();
    renderEmbedPreview();
  });
  $('setEmbedAccent').addEventListener('change', function () {
    $('setEmbedAccentHex').value = this.value.toUpperCase();
    saveLook(this);
  });
  $('setEmbedAccentHex').addEventListener('change', function () {
    var hex = this.value.trim();
    if (HEX.test(hex)) $('setEmbedAccent').value = hex;
    saveLook(this);
  });
  $('setEmbedTheme').addEventListener('change', function () { saveLook(this); });

  /* Snippet-only. Nothing to save — these live in the code you paste. */
  ['setEmbedWidget', 'setEmbedLang', 'setEmbedLimit'].forEach(function (id) {
    $(id).addEventListener('change', renderEmbedCode);
  });

  $('setEmbedCopy').addEventListener('click', function () {
    var v = $('setEmbedCode').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(v).then(function () { toastKey('toast.copied', 'ok'); });
    } else {
      var r = document.createRange();
      r.selectNode($('setEmbedCode'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      setStatus('Selected — press Ctrl/Cmd C', 'ok');
    }
  });

  showTab((location.hash || '#account').slice(1));
  load();
})();
