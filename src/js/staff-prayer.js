/* ============================================================
   staff-prayer.js — the Prayer section of the Ministry page
   ============================================================
   The milestone editor's shape and save model — EDIT FREELY, THEN PUBLISH
   (Chase's option B, 2026-09-26): an edit, a new request, the switch on a
   row, a delete, each is marked "not live yet" until the Updates bar's
   Publish changes (staff-updates.js). Closing the editor keeps what was
   typed; Cancel undoes it.

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

  var API = '/api/staff-prayer';
  var $ = function (id) { return document.getElementById(id); };
  /* A working copy: `saved` is what the server holds, `draft` what the screen
     shows, `removed` deletes waiting for Publish. `text` is the open editor's
     words, lang -> { title, description, answer_text }. */
  var state = {
    saved: {}, draft: {}, order: [], removed: {}, languages: [], preferred: 'en',
    editing: null, before: null, isAnswered: false, text: {}, colA: null, colB: null,
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isDirty(id) {
    return !!state.removed[id] || !state.saved[id] ||
      JSON.stringify(state.saved[id]) !== JSON.stringify(state.draft[id]);
  }
  function dirtyIds() { return state.order.filter(isDirty); }
  function changed() { if (window.StaffUpdates) window.StaffUpdates.changed(); }

  /* Shared with milestones and goals — see staff-rowpanel.js. */
  var panel = window.StaffRowPanel({
    listId: 'prList', formId: 'prForm', holderId: 'prFormHolder', saveBarId: 'upBar',
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
    if (!state.order.length) {
      $('prList').innerHTML = '<p class="empty">' + esc(tr('pr.empty')) + '</p>';
      return;
    }
    $('prList').innerHTML = state.order.map(function (id) {
      var p = state.draft[id];
      var gone = !!state.removed[id];
      return '<div class="ms-row' + (isDirty(id) ? ' is-dirty' : '') + (gone ? ' is-removed' : '') +
          '" data-id="' + esc(id) + '" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(anyTitle(p)) + '</span>' +
            (p.is_answered ? '<span class="badge live">' + esc(tr('pr.answered')) + '</span>' : '') +
            (gone ? '<span class="badge unsaved">' + esc(tr('up.willRemove')) + '</span>'
              : isDirty(id) ? '<span class="badge unsaved">' + esc(tr('up.notLive')) + '</span>' : '') +
          '</div>' +
          '<div class="ms-meta">' +
            (p.answered_on ? '<span>' + esc(p.answered_on) + '</span>' : '') +
          '</div>' +
        '</div>' +
        /* The published switch on the row, as on every Updates row (Chase). */
        '<div class="ms-toggle">' + (gone
          ? '<button type="button" class="ghost-btn sm" data-keep="' + esc(id) + '">' + esc(tr('up.keep')) + '</button>'
          : '<button type="button" class="switch" role="switch" data-pub="' + esc(id) + '"' +
            ' aria-checked="' + (p.is_public ? 'true' : 'false') + '" aria-label="' + esc(tr('ms.published')) + '">' +
            '<span class="switch-track"><span class="switch-state">' + (p.is_public ? 'On' : 'Off') +
            '</span><span class="switch-knob"></span></span></button>') +
        '</div>' +
      '</div>';
    }).join('');
    panel.reattach(state.editing);
  }

  /* ---- "Writing X beside Y" ----
     One language's fields at a time, with the language beside shown small
     above each field — the same model as the milestone editor and Website ›
     Pages, because a column per language stops working long before thirty.
     Writing opens on this person's own language; beside on another that has
     words to show. */

  function fillLangPickers() {
    var codes = state.languages.map(function (l) { return l.code; });
    if (codes.indexOf(state.colA) === -1) {
      state.colA = codes.indexOf(state.preferred) !== -1 ? state.preferred : (codes[0] || 'en');
    }
    var open = panel.isOpen() || state.editing !== null;
    var titled = function (c) { return !!(state.text[c] && state.text[c].title); };
    $('prLangA').innerHTML = state.languages.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) +
        (open && !titled(l.code) ? ' · ' + esc(tr('ms.missing')) : '') + '</option>';
    }).join('');
    $('prLangA').value = state.colA;
    var others = state.languages.filter(function (l) { return l.code !== state.colA; });
    if (!others.some(function (l) { return l.code === state.colB; })) {
      var best = others.filter(function (l) { return titled(l.code); })[0] || others[0];
      state.colB = best ? best.code : null;
    }
    $('prBesideWrap').hidden = !others.length;
    $('prLangB').innerHTML = others.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(langLabel(l)) + '</option>';
    }).join('');
    $('prLangB').value = state.colB || '';
  }

  /* An empty box over a missing value stays missing, and a language nobody
     wrote in is not added — so opening a request and closing it does not
     mark it changed. */
  function readCols() {
    var lang = state.colA;
    if (!lang) return;
    var had = state.text[lang], into = {}, any = false;
    document.querySelectorAll('#prForm [data-ptx]').forEach(function (el) {
      var k = el.getAttribute('data-ptx'), v = el.value;
      if (v === '' && (!had || had[k] == null)) v = had ? had[k] : null;
      if (v) any = true;
      into[k] = v;
    });
    if (had) Object.assign(had, into);
    else if (any) state.text[lang] = into;
  }

  function writeCols() {
    fillLangPickers();   // first: it moves beside off the language now being written
    var mine = state.text[state.colA] || {}, ref = (state.colB && state.text[state.colB]) || {};
    document.querySelectorAll('#prForm [data-ptx]').forEach(function (el) {
      el.value = mine[el.getAttribute('data-ptx')] || '';
    });
    document.querySelectorAll('#prForm [data-pref]').forEach(function (el) {
      var v = ref[el.getAttribute('data-pref')];
      el.textContent = v || '';
      el.hidden = !v;
      if (state.colB) el.setAttribute('lang', state.colB);
    });
  }

  function setSwitch(id, on) {
    var b = $(id);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
  }

  async function openForm(id) {
    /* Pressing the open row again closes it (keeping what was typed). */
    if (panel.isOpen() && state.editing === id) { await closeForm(true); return; }
    if (panel.isOpen()) await closeForm(true);
    var p = id ? state.draft[id] : null;
    state.editing = id;
    state.before = p ? clone(p) : null;
    state.text = p ? clone(p.text || {}) : {};
    state.isAnswered = p ? !!p.is_answered : false;
    $('prId').value = id || '';
    $('prAnsweredOn').value = (p && p.answered_on) || '';
    $('prSort').value = p ? (p.sort_order || 0) : 0;
    setSwitch('prAnswered', state.isAnswered);
    $('prDelete').hidden = !p;
    writeCols();
    panel.moveTo(state.editing);
    panel.markOpen(state.editing);
    await panel.open();
    var row = panel.rowFor(state.editing);
    if (row) panel.scrollRowToTop(row);
    var first = $('prForm').querySelector('[data-ptx="title"][data-col="a"]');
    if (first) first.focus();
  }

  /* Closing KEEPS what was typed (option B); Cancel puts back what it was. */
  async function closeForm(keep) {
    if (!panel.isOpen()) return;
    if (keep) applyForm();
    else if (state.editing && state.before) state.draft[state.editing] = state.before;
    await panel.close();
    state.editing = null;
    state.before = null;
    panel.markOpen(null);
    panel.detach();
    render();
    changed();
  }

  /* The form into the working copy. A new request with no words in any
     language is not added — there would be nothing to show. */
  function applyForm() {
    readCols();
    var titled = Object.keys(state.text).some(function (c) {
      return state.text[c] && String(state.text[c].title || '').trim();
    });
    var id = state.editing;
    if (!id) {
      if (!titled) return;
      id = 'new_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      state.order.push(id);
      state.saved[id] = null;
      state.draft[id] = { id: id, is_public: false };
      state.editing = id;
    }
    var p = state.draft[id];
    p.text = clone(state.text);
    p.is_answered = state.isAnswered;
    /* Only meaningful once answered; the endpoint clears it otherwise. */
    p.answered_on = state.isAnswered ? ($('prAnsweredOn').value || null) : null;
    p.sort_order = Number($('prSort').value) || 0;
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
    state.saved = {}; state.draft = {}; state.order = []; state.removed = {};
    (body.prayer || []).forEach(function (p) {
      state.saved[p.id] = p;
      state.draft[p.id] = clone(p);
      state.order.push(p.id);
    });
    state.languages = body.languages || [];
    state.preferred = body.preferred_lang || 'en';
    fillLangPickers();
    render();
    changed();
  }

  async function send(method, payload, query) {
    var res = await fetch(API + (query || ''), {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error((body && body.error) || ('(' + res.status + ')'));
    return body;
  }

  /* ---- publishing: what the Updates bar asks of this section ---- */

  async function publish() {
    if (panel.isOpen()) await closeForm(true);
    var failed = [];
    var ids = dirtyIds();
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], p = state.draft[id];
      try {
        if (state.removed[id]) {
          await send('DELETE', null, '?id=' + encodeURIComponent(id));
          continue;
        }
        await send('POST', {
          id: state.saved[id] ? id : undefined,
          is_public: !!p.is_public,
          is_answered: !!p.is_answered,
          answered_on: p.is_answered ? (p.answered_on || null) : null,
          sort_order: Number(p.sort_order) || 0,
          text: p.text || {},
        });
      } catch (e) {
        failed.push(anyTitle(p) + ' — ' + e.message);
      }
    }
    await load();
    return { failed: failed };
  }

  function discard() {
    state.before = null;
    if (panel.isOpen()) closeForm(false);
    state.order = state.order.filter(function (id) { return state.saved[id]; });
    Object.keys(state.draft).forEach(function (id) {
      if (state.saved[id]) state.draft[id] = clone(state.saved[id]); else delete state.draft[id];
    });
    state.removed = {};
    render();
    changed();
  }

  /* A delete waits for Publish like everything else. */
  async function remove(id) {
    if (!state.saved[id]) {
      delete state.draft[id];
      state.order = state.order.filter(function (x) { return x !== id; });
    } else {
      state.removed[id] = true;
    }
    state.before = null;
    if (panel.isOpen()) { await panel.close(); state.editing = null; panel.markOpen(null); panel.detach(); }
    render();
    changed();
  }

  /* ---- wiring ---- */

  $('prAdd').addEventListener('click', function () { openForm(null); });
  $('prCancel').addEventListener('click', function () { closeForm(false); });
  $('prDelete').addEventListener('click', function () { if (state.editing) remove(state.editing); });
  $('prForm').addEventListener('submit', function (e) { e.preventDefault(); closeForm(true); });
  $('prAnswered').addEventListener('click', function () {
    state.isAnswered = !state.isAnswered;
    setSwitch('prAnswered', state.isAnswered);
  });

  /* Switching either language keeps what was typed: read it out first. */
  [['prLangA', 'colA'], ['prLangB', 'colB']].forEach(function (cfg) {
    $(cfg[0]).addEventListener('change', function (e) {
      readCols();
      state[cfg[1]] = e.target.value;
      writeCols();
    });
  });

  /* Keyboard parity: the row is focusable and announces itself as a button. */
  $('prList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('#prForm')) return;
    var row = e.target.closest('.ms-row');
    if (!row || state.removed[row.dataset.id]) return;
    e.preventDefault();
    openForm(row.dataset.id);
  });

  $('prList').addEventListener('click', function (e) {
    if (e.target.closest('#prForm')) return;
    var btn = e.target.closest('button');
    if (btn) {
      if (btn.dataset.pub !== undefined) {
        var p = state.draft[btn.dataset.pub];
        if (p) { p.is_public = !p.is_public; render(); changed(); }
      } else if (btn.dataset.keep !== undefined) {
        delete state.removed[btn.dataset.keep]; render(); changed();
      }
      return;
    }
    /* THE WHOLE ROW OPENS IT (board 7). */
    var row = e.target.closest('.ms-row');
    if (row && !state.removed[row.dataset.id]) openForm(row.dataset.id);
  });

  if (window.StaffUpdates) {
    window.StaffUpdates.register({
      key: 'prayer',
      count: function () { return dirtyIds().length; },
      removals: function () { return Object.keys(state.removed).length; },
      publish: publish,
      discard: discard
    });
  }

  load();
})();
