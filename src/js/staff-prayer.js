/* ============================================================
   staff-prayer.js — the Prayer section of the Ministry page
   ============================================================
   The milestone editor's shape, including its two language columns and for
   the same reason: a missing or stale translation is invisible when you edit
   one language at a time, which is how a trilingual site ends up with three
   versions that disagree.

   ANSWERED IS A SWITCH, NOT A STATUS. A prayer is being asked, or it has been
   answered. An enum here would invite "in progress", which is not a thing
   anybody means about prayer.

   The account of what happened is per language alongside the request, because
   "answered" with no account of how is a badge rather than a testimony — and
   the account is usually why a ministry publishes the list at all.
   ============================================================ */
(function () {
  'use strict';

  /* The list, not the page name — see the note in staff-milestones.js. */
  if (!document.getElementById('prList')) return;
  if (!document.getElementById('prList')) return;

  var API = '/api/staff-prayer';
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    prayer: [], languages: [], preferred: 'en',
    editing: null, isPublic: false, isAnswered: false,
    text: {},           // lang -> { title, description, answer_text }
  };

  /* Shared with milestones and goals — see staff-rowpanel.js. */
  var panel = window.StaffRowPanel({
    listId: 'prList', formId: 'prForm', holderId: 'prFormHolder',
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  /* Translate AND substitute. Never falls back to the raw string: a key with
     {name} in it printed as "{name}" on screen once already, which is why the
     test that guards this exists. */
  function fill(key, vars) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(key, vars);
    var s = tr(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }

  function langLabel(l) { return (l.native_name || l.name) + ' (' + l.code + ')'; }

  /* The title in whichever language has one — the list is a list of things,
     and a row with no words in it is unusable whatever the reason. */
  function anyTitle(p) {
    var t = p.text || {};
    if (t[state.preferred] && t[state.preferred].title) return t[state.preferred].title;
    if (t.en && t.en.title) return t.en.title;
    var k = Object.keys(t).find(function (c) { return t[c] && t[c].title; });
    return k ? t[k].title : '—';
  }

  /* ---- the list ---- */

  /* THE SAME ROW THE MILESTONE EDITOR DRAWS. See the note in staff-goals.js:
     ms-row-main / ms-row-sub / ms-row-acts are not classes staff.css has ever
     had, so this list was unstyled inside a styled shell. */
  function render() {
    panel.detach();

    var rows = state.prayer;
    if (!rows.length) {
      $('prList').innerHTML = '<p class="empty">' + esc(tr('pr.empty')) + '</p>';
      return;
    }

    $('prList').innerHTML = rows.map(function (p) {
      var langs = Object.keys(p.text || {}).filter(function (c) { return p.text[c].title; });
      return '<div class="ms-row" data-id="' + esc(p.id) + '"' +
        ' role="button" tabindex="0" aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(anyTitle(p)) + '</span>' +
            (p.is_answered
              ? '<span class="badge live">' + esc(tr('pr.answered')) + '</span>' : '') +
            (p.is_public ? '' : '<span class="badge proto">' + esc(tr('ms.draft')) + '</span>') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(langs.join(', ').toUpperCase()) + '</span>' +
            (p.answered_on ? '<span>' + esc(p.answered_on) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          '<span class="ms-chev" aria-hidden="true"></span>' +
          '<button type="button" data-edit="' + esc(p.id) + '">Edit</button>' +
          '<button type="button" class="del" data-del="' + esc(p.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    panel.reattach(state.editing);
  }

  /* ---- the two language columns ---- */

  function fillLangPickers() {
    var opts = state.languages.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
    }).join('');
    $('prLangA').innerHTML = opts;
    $('prLangB').innerHTML = opts;

    /* The left column opens on this person's own language and the right on the
       next one published, so the common case needs no picking. */
    var codes = state.languages.map(function (l) { return l.code; });
    var a = codes.indexOf(state.preferred) !== -1 ? state.preferred : (codes[0] || 'en');
    var b = codes.find(function (c) { return c !== a; }) || a;
    $('prLangA').value = a;
    $('prLangB').value = b;
  }

  function readCols() {
    ['a', 'b'].forEach(function (col) {
      var lang = $(col === 'a' ? 'prLangA' : 'prLangB').value;
      if (!lang) return;
      var into = state.text[lang] || (state.text[lang] = {});
      document.querySelectorAll('[data-ptx][data-col="' + col + '"]').forEach(function (el) {
        into[el.getAttribute('data-ptx')] = el.value;
      });
    });
  }

  function writeCols() {
    ['a', 'b'].forEach(function (col) {
      var lang = $(col === 'a' ? 'prLangA' : 'prLangB').value;
      var v = state.text[lang] || {};
      document.querySelectorAll('[data-ptx][data-col="' + col + '"]').forEach(function (el) {
        el.value = v[el.getAttribute('data-ptx')] || '';
      });
      var tag = $(col === 'a' ? 'prTagA' : 'prTagB');
      if (tag) tag.textContent = (v.title ? '' : tr('ms.untranslated'));
    });
  }

  function setSwitch(id, on) {
    var b = $(id);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
  }

  async function openForm(p) {
    var id = p ? p.id : null;

    /* Pressing the open row again closes it — see staff-milestones.js. */
    if (panel.isOpen() && state.editing === id) { await closeForm(); return; }
    if (panel.isOpen()) await panel.close();

    state.editing = p ? p.id : null;
    state.text = p ? JSON.parse(JSON.stringify(p.text || {})) : {};
    state.isPublic = p ? !!p.is_public : false;
    state.isAnswered = p ? !!p.is_answered : false;

    $('prId').value = p ? p.id : '';
    $('prAnsweredOn').value = (p && p.answered_on) || '';
    $('prSort').value = p ? (p.sort_order || 0) : 0;
    setSwitch('prPublic', state.isPublic);
    setSwitch('prAnswered', state.isAnswered);
    writeCols();

    panel.moveTo(state.editing);
    panel.markOpen(state.editing);
    await panel.open();

    var row = panel.rowFor(state.editing);
    if (row) panel.scrollRowToTop(row);

    var first = $('prForm').querySelector('[data-ptx="title"][data-col="a"]');
    if (first) first.focus();
  }

  async function closeForm() {
    await panel.close();
    state.editing = null;
    panel.markOpen(null);
    panel.detach();
  }

  /* ---- server ---- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) {
      $('prList').innerHTML = '<p class="empty">' + esc(tr('err.unreachable')) + '</p>';
      return;
    }
    if (!res.ok) {
      $('prList').innerHTML = '<p class="empty">' +
        esc((body && body.error) || tr('err.refused')) + '</p>';
      return;
    }
    state.prayer = body.prayer || [];
    state.languages = body.languages || [];
    state.preferred = body.preferred_lang || 'en';
    fillLangPickers();
    render();
  }

  async function send(method, payload, query) {
    var res, body;
    try {
      res = await fetch(API + (query || ''), {
        method: method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      body = await res.json().catch(function () { return {}; });
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'bad');
      return null;
    }
    if (!res.ok) {
      toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'bad');
      return null;
    }
    if (body.prayer) { state.prayer = body.prayer; render(); }
    return body;
  }

  /* ---- wiring ---- */

  $('prAdd').addEventListener('click', function () { openForm(null); });
  $('prCancel').addEventListener('click', closeForm);
  $('prPublic').addEventListener('click', function () {
    state.isPublic = !state.isPublic;
    setSwitch('prPublic', state.isPublic);
  });
  $('prAnswered').addEventListener('click', function () {
    state.isAnswered = !state.isAnswered;
    setSwitch('prAnswered', state.isAnswered);
  });

  /* Changing a column's language keeps what was typed: read the old language
     out before the picker moves, then write the new one in. Without this,
     switching columns silently discards an unsaved translation. */
  ['prLangA', 'prLangB'].forEach(function (id) {
    $(id).addEventListener('focus', readCols);
    $(id).addEventListener('change', writeCols);
  });

  /* Keyboard parity: the row is focusable and announces itself as a button. */
  $('prList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('#prForm')) return;
    var row = e.target.closest('.ms-row');
    if (!row) return;
    e.preventDefault();
    var p = state.prayer.find(function (x) { return x.id === row.dataset.id; });
    if (p) openForm(p);
  });

  $('prList').addEventListener('click', async function (e) {
    var edit = e.target.closest('[data-edit]');
    if (edit) {
      var p = state.prayer.find(function (x) { return x.id === edit.dataset.edit; });
      if (p) openForm(p);
      return;
    }
    var del = e.target.closest('[data-del]');
    if (!del) {
      /* THE WHOLE BAR IS THE TARGET, matching the milestone rows. */
      if (e.target.closest('#prForm')) return;
      var row = e.target.closest('.ms-row');
      if (row) {
        var rp = state.prayer.find(function (x) { return x.id === row.dataset.id; });
        if (rp) openForm(rp);
      }
      return;
    }

    var p = state.prayer.find(function (x) { return x.id === del.dataset.del; });
    if (!p) return;

    var ok = await window.StaffConfirm({
      title: tr('pr.deleteTitle'),
      body: fill('pr.deleteBody', { name: anyTitle(p) }),
      note: tr('pr.deleteNote'),
      type: 'DELETE',
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('ms.delete'),
      cancel: tr('ms.cancel'),
      danger: true,
    });
    if (!ok) return;

    var r = await send('DELETE', null, '?id=' + encodeURIComponent(p.id));
    if (r) toast(tr('pr.deleted'), 'ok');
  });

  $('prForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    readCols();

    var titled = Object.keys(state.text).some(function (c) {
      return state.text[c] && String(state.text[c].title || '').trim();
    });
    if (!titled) { toast(tr('pr.needTitle'), 'bad'); return; }

    var r = await send('POST', {
      id: $('prId').value || undefined,
      is_public: state.isPublic,
      is_answered: state.isAnswered,
      /* Only meaningful once answered; the endpoint clears it otherwise, so a
         request un-marked by mistake does not keep a date that means nothing. */
      answered_on: state.isAnswered ? ($('prAnsweredOn').value || null) : null,
      sort_order: Number($('prSort').value) || 0,
      text: state.text,
    });
    if (!r) return;

    closeForm();
    toast(tr('pr.saved'), 'ok');
  });

  load();
})();
