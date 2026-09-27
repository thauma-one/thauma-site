/* ============================================================
   staff-goals.js — the Goals section of the Ministry page
   ============================================================
   The same shape as the milestone editor: a list of rows, each opening into a
   form, and the same save model — EDIT FREELY, THEN PUBLISH (Chase's option
   B, 2026-09-26). An edit, a new goal, the switch on a row, a new progress
   reading, a delete: each is marked "not live yet" and waits for the Updates
   bar's Publish changes (staff-updates.js). Closing the editor keeps what was
   typed; Cancel undoes it.

   NO LANGUAGE COLUMNS. A goal's label is still a plain column rather than a
   translations table; making it translatable is its own migration and its
   own surface (noted in the language work), not something to half-do here.
   ============================================================ */
(function () {
  'use strict';

  /* The list, not the page name — see the note in staff-milestones.js. */
  if (!document.getElementById('glList')) return;

  var API = '/api/staff-goals';
  var $ = function (id) { return document.getElementById(id); };
  /* A working copy. `saved` is what the server holds, `draft` what the screen
     shows; `reading` is a new progress figure waiting to be appended;
     `removed` is a delete waiting for Publish. */
  var state = { saved: {}, draft: {}, order: [], removed: {}, reading: {},
                editing: null, before: null, isPublic: false };
  var FIELDS = ['label', 'description', 'kind', 'target_cents', 'currency', 'is_public'];
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function defn(g) {
    var out = {};
    FIELDS.forEach(function (f) { out[f] = g ? (g[f] == null ? null : g[f]) : null; });
    return out;
  }
  function isDirty(id) {
    return !!state.removed[id] || !state.saved[id] || !!state.reading[id] ||
      JSON.stringify(defn(state.saved[id])) !== JSON.stringify(defn(state.draft[id]));
  }
  function dirtyIds() { return state.order.filter(isDirty); }

  /* The row-with-a-panel behavior is shared with milestones and prayer —
     see staff-rowpanel.js for why there is one copy of it and not three. */
  var panel = window.StaffRowPanel({
    listId: 'glList', formId: 'glForm', holderId: 'glFormHolder', saveBarId: 'upBar',
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


  /* Minor units in the database, whole units in the form. Nobody types cents
     into a target, and storing what was typed would make every figure a
     hundred times too small. */
  function toCents(v) {
    var n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  function fromCents(c) {
    if (c == null) return '';
    return String(Math.round(Number(c)) / 100);
  }
  function money(cents, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: currency || 'USD',
        maximumFractionDigits: (cents % 100) === 0 ? 0 : 2,
      }).format((cents || 0) / 100);
    } catch (e) { return (currency || '') + ' ' + Math.round((cents || 0) / 100); }
  }

  /* ---- the list ---- */

  var KIND_KEY = { monthly: 'gl.monthly', one_time: 'gl.oneTime', project: 'gl.project' };

  /* THE SAME ROW THE MILESTONE EDITOR DRAWS, down to the class names. This
     used to emit ms-row-main / ms-row-title / ms-row-sub / ms-row-acts, none
     of which exist in staff.css — so the markup was styled only by the outer
     .ms-row and the list looked nothing like the one above it. The row IS the
     control: role and aria-expanded so it reads as an expander rather than as
     decoration with a button in it. */
  function render() {
    panel.detach();

    if (!state.order.length) {
      $('glList').innerHTML = '<p class="empty">' + esc(tr('gl.empty')) + '</p>';
      return;
    }

    $('glList').innerHTML = state.order.map(function (id) {
      var g = state.draft[id];
      var r = state.reading[id];
      var raised = r ? r.raised_cents : (g.raised_cents || 0);
      var donors = r && r.donor_count != null ? r.donor_count : g.donor_count;
      var pct = g.target_cents ? Math.round(100 * raised / g.target_cents) : 0;
      var gone = !!state.removed[id];
      return '<div class="ms-row' + (isDirty(id) ? ' is-dirty' : '') + (gone ? ' is-removed' : '') +
          '" data-id="' + esc(id) + '" role="button" tabindex="0" aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(g.label) + '</span>' +
            (gone ? '<span class="badge unsaved">' + esc(tr('up.willRemove')) + '</span>'
              : isDirty(id) ? '<span class="badge unsaved">' + esc(tr('up.notLive')) + '</span>' : '') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(tr(KIND_KEY[g.kind] || 'gl.kind')) + '</span>' +
            '<span>' + esc(money(raised, g.currency)) + ' / ' + esc(money(g.target_cents, g.currency)) + '</span>' +
            '<span class="tnum">' + pct + '%</span>' +
            (donors ? '<span>' + donors + ' · ' + esc(tr('gl.donors')) + '</span>' : '') +
          '</div>' +
        '</div>' +
        /* The published switch on the row, as on every Updates row (Chase). */
        '<div class="ms-toggle">' + (gone
          ? '<button type="button" class="ghost-btn sm" data-keep="' + esc(id) + '">' + esc(tr('up.keep')) + '</button>'
          : '<button type="button" class="switch" role="switch" data-pub="' + esc(id) + '"' +
            ' aria-checked="' + (g.is_public ? 'true' : 'false') + '" aria-label="' + esc(tr('ms.published')) + '">' +
            '<span class="switch-track"><span class="switch-state">' + (g.is_public ? 'On' : 'Off') +
            '</span><span class="switch-knob"></span></span></button>') +
        '</div>' +
      '</div>';
    }).join('');

    panel.reattach(state.editing);
  }

  /* ---- the form ---- */

  async function openForm(id) {
    /* Pressing the open row again closes it (keeping what was typed). */
    if (panel.isOpen() && state.editing === id) { await closeForm(true); return; }
    if (panel.isOpen()) await closeForm(true);

    var goal = id ? state.draft[id] : null;
    state.editing = id;
    state.before = goal ? { goal: clone(goal), reading: state.reading[id] ? clone(state.reading[id]) : null } : null;

    $('glId').value = id || '';
    $('glLabel').value = goal ? goal.label : '';
    $('glDescription').value = goal && goal.description ? goal.description : '';
    $('glKind').value = goal ? goal.kind : 'monthly';
    $('glTarget').value = goal ? fromCents(goal.target_cents) : '';
    $('glCurrency').value = goal ? goal.currency : 'USD';
    $('glDelete').hidden = !goal;

    /* Progress is left EMPTY rather than pre-filled with the current figure:
       a figure is a new reading, appended, and pre-filling would append the
       same reading again on every save. Blank means "no new reading". */
    var r = id && state.reading[id];
    $('glRaised').value = r ? fromCents(r.raised_cents) : '';
    $('glDonors').value = r && r.donor_count != null ? String(r.donor_count) : '';
    $('glRaised').placeholder = goal && goal.raised_cents != null ? fromCents(goal.raised_cents) : '0';
    $('glDonors').placeholder = goal && goal.donor_count != null ? String(goal.donor_count) : '';

    panel.moveTo(state.editing);
    panel.markOpen(state.editing);
    await panel.open();
    var row = panel.rowFor(state.editing);
    if (row) panel.scrollRowToTop(row);
    $('glLabel').focus();
  }

  /* Closing KEEPS what was typed (option B); Cancel puts back what it was. */
  async function closeForm(keep) {
    if (!panel.isOpen()) return;
    if (keep) applyForm();
    else if (state.editing && state.before) {
      state.draft[state.editing] = state.before.goal;
      if (state.before.reading) state.reading[state.editing] = state.before.reading;
      else delete state.reading[state.editing];
    }
    await panel.close();
    state.editing = null;
    state.before = null;
    panel.markOpen(null);
    panel.detach();
    render();
    changed();
  }

  /* The form into the working copy. A new goal needs a name and a target, or
     there is nothing to add; an existing one keeps its target if the box was
     emptied. */
  function applyForm() {
    var target = toCents($('glTarget').value);
    var okTarget = Number.isFinite(target) && target > 0;
    var id = state.editing;
    if (!id) {
      if (!$('glLabel').value.trim() || !okTarget) {
        if ($('glLabel').value.trim() || $('glTarget').value.trim()) toast(tr('gl.needTarget'), 'err');
        return;
      }
      id = 'new_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      state.order.push(id);
      state.saved[id] = null;
      state.draft[id] = { goal_id: id, is_public: false, raised_cents: 0 };
      state.editing = id;
    }
    var g = state.draft[id];
    g.label = $('glLabel').value;
    g.description = $('glDescription').value;
    g.kind = $('glKind').value;
    if (okTarget) g.target_cents = target;
    g.currency = $('glCurrency').value;
    var raised = $('glRaised').value.trim();
    if (raised !== '') {
      state.reading[id] = { raised_cents: toCents(raised),
        donor_count: $('glDonors').value.trim() === '' ? null : Number($('glDonors').value) };
    } else {
      delete state.reading[id];
    }
  }

  function changed() { if (window.StaffUpdates) window.StaffUpdates.changed(); }

  /* ---- talking to the server ---- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) {
      $('glList').innerHTML = '<p class="empty">' + esc(tr('err.unreachable')) + '</p>';
      return;
    }
    if (!res.ok) {
      $('glList').innerHTML = '<p class="empty">' +
        esc((body && body.error) || tr('err.refused')) + '</p>';
      return;
    }
    state.saved = {}; state.draft = {}; state.order = []; state.removed = {}; state.reading = {};
    (body.goals || []).forEach(function (g) {
      state.saved[g.goal_id] = g;
      state.draft[g.goal_id] = clone(g);
      state.order.push(g.goal_id);
    });
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
      var id = ids[i], g = state.draft[id], r = state.reading[id];
      try {
        if (state.removed[id]) {
          await send('DELETE', null, '?id=' + encodeURIComponent(id));
          continue;
        }
        var isNew = !state.saved[id];
        var payload = defn(g);
        payload.id = isNew ? undefined : id;
        /* A new goal carries its opening figure in the same write, so it
           does not read 0% until somebody remembers a second step. */
        if (isNew && r) { payload.raised_cents = r.raised_cents; payload.donor_count = r.donor_count; }
        if (isNew || JSON.stringify(defn(state.saved[id])) !== JSON.stringify(defn(g))) await send('POST', payload);
        /* On an existing goal a figure is a new reading — appended, not an
           edit of the definition. */
        if (!isNew && r) await send('PATCH', { id: id, raised_cents: r.raised_cents, donor_count: r.donor_count });
      } catch (e) {
        failed.push((g && g.label ? g.label : id) + ' — ' + e.message);
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
    state.removed = {}; state.reading = {};
    render();
    changed();
  }

  /* A delete waits for Publish like everything else; the bar asks before any
     is published, because a goal takes its history of readings with it. */
  async function remove(id) {
    if (!state.saved[id]) {
      delete state.draft[id]; delete state.reading[id];
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

  $('glAdd').addEventListener('click', function () { openForm(null); });
  $('glCancel').addEventListener('click', function () { closeForm(false); });
  $('glDelete').addEventListener('click', function () { if (state.editing) remove(state.editing); });
  $('glForm').addEventListener('submit', function (e) { e.preventDefault(); closeForm(true); });

  /* Keyboard parity: the row is focusable and announces itself as a button. */
  $('glList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('#glForm')) return;
    var row = e.target.closest('.ms-row');
    if (!row || state.removed[row.dataset.id]) return;
    e.preventDefault();
    openForm(row.dataset.id);
  });

  $('glList').addEventListener('click', function (e) {
    if (e.target.closest('#glForm')) return;
    var btn = e.target.closest('button');
    if (btn) {
      if (btn.dataset.pub !== undefined) {
        var g = state.draft[btn.dataset.pub];
        if (g) { g.is_public = !g.is_public; render(); changed(); }
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
      key: 'goals',
      count: function () { return dirtyIds().length; },
      removals: function () { return Object.keys(state.removed).length; },
      publish: publish,
      discard: discard
    });
  }

  load();
})();
