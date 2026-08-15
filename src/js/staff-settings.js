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
    $('setEmail').textContent = state.you.email;

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
          (isDefault ? '<span class="switch-note">the default language — cannot be switched off</span>'
                     : '') +
        '</span></div>';
    }).join('');

    renderKeys();
  }

  function renderKeys() {
    if (!state.keys.length) {
      $('setKeyList').innerHTML = '<p class="empty">No API keys yet.</p>';
      return;
    }
    $('setKeyList').innerHTML = state.keys.map(function (k) {
      return '<div class="key-row' + (k.revoked ? ' is-revoked' : '') + '">' +
        '<div><span class="key-title">' + esc(k.name) + '</span>' +
          '<span class="key-meta">created ' + esc((k.created_at || '').slice(0, 10)) +
          ' · ' + (k.last_used_at
            ? 'last used ' + esc(k.last_used_at.slice(0, 10))
            : 'never used') + '</span></div>' +
        (k.revoked
          ? '<span class="badge proto">revoked</span>'
          : '<button type="button" class="del" data-revoke="' + esc(k.id) + '">Revoke</button>') +
      '</div>';
    }).join('');
  }

  /* ---- loading and saving --------------------------------------------- */

  async function load() {
    try {
      var res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        setStatus(res.status === 403
          ? 'Signed in as ' + (body.email || 'unknown') + ', but that address has no partner access yet.'
          : 'Could not load settings (' + res.status + ')', 'err');
        return;
      }
      if (window.StaffProblemClear) window.StaffProblemClear();
      state = body;
      // The account is the source of truth; the cache is only there to
      // avoid a flash of English on first paint.
      if (window.StaffI18n && state.you && state.you.preferred_lang) {
        window.StaffI18n.setLang(state.you.preferred_lang);
      }
      render();
    } catch (e) {
      if (window.StaffProblem) {
        window.StaffProblem('Cannot reach the server — ' + e.message, load);
      }
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
      setStatus(message || 'Saved', 'ok');
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
    if (window.StaffI18n) window.StaffI18n.setLang(code);
    change({ preferred_lang: code }, e.target,
           'Language changed');
  });

  $('setLangList').addEventListener('click', function (e) {
    var sw = e.target.closest('[data-lang]');
    if (!sw || sw.disabled) return;
    var on = sw.getAttribute('aria-checked') !== 'true';
    change({ language: sw.dataset.lang, is_enabled: on }, sw,
           (on ? 'Publishing ' : 'No longer publishing ') + sw.dataset.lang.toUpperCase());
  });

  $('setKeyList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    if (!confirm('Revoke this key? Any site using it will stop receiving data ' +
                 'immediately, and it cannot be un-revoked.')) return;
    change({ revoke_key: btn.dataset.revoke }, btn, 'Key revoked');
  });

  $('setKeyAdd').addEventListener('click', async function () {
    var name = $('setKeyName').value.trim();
    if (!name) { setStatus('Give the key a name first', 'err'); $('setKeyName').focus(); return; }

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
      state.keys = body.api_keys || [];
      renderKeys();
      setStatus('Key created', 'ok');
    } catch (e) {
      setStatus(e.message, 'err');
    } finally {
      $('setKeyAdd').disabled = false;
    }
  });

  $('setKeyCopy').addEventListener('click', function () {
    var v = $('setKeyValue').textContent;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(v).then(function () { setStatus('Copied', 'ok'); });
    } else {
      // Older Safari over http has no clipboard API; select it so Ctrl-C works.
      var r = document.createRange();
      r.selectNode($('setKeyValue'));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      setStatus('Selected — press Ctrl/Cmd C', 'ok');
    }
  });

  showTab((location.hash || '#account').slice(1));
  load();
})();
