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
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }

  function toastKey(key, kind) {
    setStatus(window.StaffI18n ? window.StaffI18n.t(key) : key, kind);
  }

  function setStatus(text, kind) {
    if (text && kind && window.StaffToast) window.StaffToast(text, kind);
  }

  function langLabel(l) { return l.native_name || l.name; }

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
    /* THE HEADING IS YOU (board "Settings, just you"): first name thin, the
       rest bold, the way every heading here is set. No name on record falls
       back to the address. The key is dropped so a later language sweep does
       not put the generic heading back over it. */
    var h = document.querySelector('.page-head h1');
    if (h) {
      var parts = String(state.you.name || state.you.email || '').trim().split(/\s+/);
      var first = parts.shift() || '';
      h.removeAttribute('data-i18n-html');
      h.innerHTML = esc(first) + (parts.length ? ' <b>' + esc(parts.join(' ')) + '</b>' : '');
    }
    $('setEmail').textContent = state.you.email;

    /* What you can do: every role you hold, then the ministry and how you
       are on it — "Chase Roush · owner". Tags rather than a sentence, because
       a list reads the same at one item as at four. */
    var ROLE_ORDER = ['admin', 'partner', 'staff', 'board', 'communications'];
    var held = (state.you.roles || []).slice().sort(function (a, b) {
      return ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b);
    });
    var tags = held.map(function (r) {
      return '<span class="role-tag ' + esc(r) + '">' + esc(tr('role.' + r)) + '</span>';
    });
    if (state.partner && state.partner.display_name) {
      var how = state.partner.access_role ? ' · ' + tr('access.' + state.partner.access_role) : '';
      tags.push('<span class="role-tag ministry">' + esc(state.partner.display_name + how) + '</span>');
    }
    $('setRoles').innerHTML = tags.join('');

    // Your own working language: every language the organization offers, not
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
            tr(l.is_enabled ? 'switch.on' : 'switch.off') + '</span><span class="switch-knob"></span></span>' +
        '</button>' +
        '<span class="switch-label">' + esc(langLabel(l)) +
          (isDefault ? '<span class="switch-note">' + tr('set.defaultLangNote') + '</span>'
                     : '') +
        '</span></div>';
    }).join('');

    renderKeys();
  }

  /* Reads state.api_keys, which is what the endpoint actually returns. It
     read state.keys until 2026-08-15 — undefined, so .length threw and the
     whole Settings page failed to draw. The error was visible only because
     render failures stopped being reported as network problems. */
  /* The parts a key may read — the partner API's parts (lib/apikey.js
     KEY_PARTS on the Worker). Switches, not a list to read. */
  var PARTS = ['milestones', 'goals', 'prayer', 'videos', 'mailings'];
  function partSwitches(on, attrs) {
    return PARTS.map(function (p) {
      var yes = on.indexOf(p) !== -1;
      return '<button type="button" class="switch small" role="switch" aria-checked="' + yes + '" ' +
        attrs + ' data-part="' + p + '">' +
        '<span class="switch-track"><span class="switch-state">' + tr(yes ? 'switch.on' : 'switch.off') +
        '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(tr('set.part.' + p)) + '</span></button>';
    }).join('');
  }
  function drawNewParts() {
    var on = state.newParts || (state.newParts = PARTS.slice());
    $('setKeyParts').innerHTML = partSwitches(on, 'data-new');
  }

  function renderKeys() {
    drawNewParts();
    var keys = state.api_keys || [];
    if (!keys.length) {
      $('setKeyList').innerHTML = '<p class="empty">' + esc(tr('set.keysEmpty')) + '</p>';
      return;
    }
    $('setKeyList').innerHTML = keys.map(function (k) {
      var made = (k.created_at || '').slice(0, 10);
      var used = (k.last_used_at || '').slice(0, 10);
      var meta = [k.created_by_name ? fill('set.keyBy', { who: k.created_by_name }) : null,
                  fill('set.keyMade', { made: made }),
                  used ? fill('set.keyUsed', { used: used }) : tr('set.keyNeverUsed')]
        .filter(Boolean).join(' · ');
      return '<div class="key-row' + (k.revoked ? ' is-revoked' : '') + '" data-key="' + esc(k.id) + '">' +
        '<div class="key-head"><div><span class="key-title">' + esc(k.name) + '</span>' +
          '<span class="key-meta">' + esc(meta) + '</span></div>' +
        (k.revoked
          ? '<span class="badge proto">' + esc(tr('set.revoked')) + '</span>'
          : '<button type="button" class="del" data-revoke="' + esc(k.id) + '">' + esc(tr('set.revoke')) + '</button>') +
        '</div>' +
        (k.revoked ? '' : '<div class="key-parts">' + partSwitches(k.parts || [], 'data-key-part="' + esc(k.id) + '"') + '</div>') +
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

    /* The console's navigation is filtered from `you.roles`, and this page had
       no other source for them — opened directly rather than walked to from
       the dashboard, it showed every staff link to whoever arrived. Set before
       the refusal branch below: a 403 still says who you are, and the header
       should be right even when the rest of the page is not. */
    if (body && body.you && window.StaffIdentity) {
      window.StaffIdentity(body.you, body.partner);
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

  $('setKeyList').addEventListener('click', async function (e) {
    /* What a key may read: changed at once, like making or revoking one — a
       key is a credential, not a draft. */
    var sw = e.target.closest('[data-key-part]');
    if (sw) {
      var key = (state.api_keys || []).filter(function (k) { return k.id === sw.dataset.keyPart; })[0];
      if (!key) return;
      var parts = (key.parts || []).slice(), p = sw.dataset.part, at = parts.indexOf(p);
      if (at === -1) parts.push(p); else parts.splice(at, 1);
      if (!parts.length) { toastKey('err.keyNeedsPart', 'err'); return; }
      sw.disabled = true;
      await change({ key_parts: { id: key.id, parts: parts } }, sw, 'toast.saved');
      return;
    }
    var btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    var ok = await window.StaffConfirm({ title: tr('set.revokeTitle'), confirm: tr('set.revoke'),
      cancel: tr('ms.cancel'), danger: true });
    if (!ok) return;
    change({ revoke_key: btn.dataset.revoke }, btn, 'toast.keyRevoked');
  });

  $('setKeyParts').addEventListener('click', function (e) {
    var sw = e.target.closest('[data-new]');
    if (!sw) return;
    var on = state.newParts, p = sw.dataset.part, at = on.indexOf(p);
    if (at === -1) on.push(p); else if (on.length > 1) on.splice(at, 1);
    drawNewParts();
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
        body: JSON.stringify({ name: name, parts: state.newParts || PARTS })
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
      toastKey('set.keySelected', 'ok');
    }
  });

  showTab((location.hash || '#account').slice(1));
  load();
})();

/* ============================================================
   CHANGING YOUR OWN SIGN-IN ADDRESS
   ============================================================
   Email is the identity here — there is no password, and Access sends the
   one-time code to whatever address it holds. So this is the only piece of
   self-service account management that means anything.

   IT SENDS, IT DOES NOT CHANGE. The request goes to the NEW address and the
   account moves only when somebody opens the link in it. The wording below
   says so twice, because "we've sent you something" and "your address has
   changed" are very different things to be wrong about.
   ============================================================ */
(function () {
  'use strict';

  var form = document.getElementById('setEmailForm');
  if (!form) return;

  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function note(msg, bad) {
    var el = document.getElementById('setEmailNote');
    el.textContent = msg || '';
    el.className = 'set-email-note' + (bad ? ' is-bad' : '');
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var field = document.getElementById('setNewEmail');
    var email = field.value.trim();
    if (!email) { note(tr('set.emailNeeded'), true); return; }

    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    note(tr('set.emailSending'));
    try {
      var res = await fetch('/api/staff-account', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      });
      var data = await res.json();
      if (!res.ok) { note(data.error || tr('common.saveFailed'), true); return; }
      note(data.note || tr('set.emailSent'));
      field.value = '';
    } catch (err) {
      note(tr('common.saveFailed'), true);
    } finally {
      btn.disabled = false;
    }
  });
})();
