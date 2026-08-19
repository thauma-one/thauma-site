/* ============================================================
   staff-goals.js — the Goals section of the Ministry page
   ============================================================
   The same shape as the milestone editor: a list of rows, each opening into a
   form. Learning one should teach the other.

   TWO DELIBERATE DIFFERENCES.

   NO LANGUAGE COLUMNS. A goal's label has always been a plain column rather
   than a translations table. That is a real gap on a multilingual site and it
   is pre-existing — giving goals translations is its own migration and its own
   surface, and half-doing it here would leave two mechanisms for one job.

   NO SAVE BAR. Milestones hold a working copy because several are edited in
   one sitting and the list is reordered as you go. One goal is one row: it
   saves when you press Save, and a bar announcing unsaved work for a single
   small form is ceremony that teaches people to ignore bars.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-staff-page') !== 'ministry') return;
  if (!document.getElementById('glList')) return;

  var API = '/api/staff-goals';
  var $ = function (id) { return document.getElementById(id); };
  var state = { goals: [], editing: null, isPublic: false };

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

  function render() {
    var rows = state.goals;
    if (!rows.length) {
      $('glList').innerHTML = '<p class="empty">' + esc(tr('gl.empty')) + '</p>';
      return;
    }
    $('glList').innerHTML = rows.map(function (g) {
      var pct = g.percent == null ? 0 : g.percent;
      return '<div class="ms-row" data-id="' + esc(g.goal_id) + '">' +
        '<div class="ms-row-main">' +
          '<span class="ms-row-title">' + esc(g.label) + '</span>' +
          (g.is_public ? '' : '<span class="badge proto">' + esc(tr('ms.draft')) + '</span>') +
          '<span class="ms-row-sub">' +
            esc(money(g.raised_cents || 0, g.currency)) + ' / ' +
            esc(money(g.target_cents, g.currency)) + ' · ' + pct + '%' +
            (g.donor_count ? ' · ' + g.donor_count : '') +
          '</span>' +
        '</div>' +
        '<div class="ms-row-acts">' +
          '<button type="button" class="ghost-btn" data-edit="' + esc(g.goal_id) + '">' +
            esc(tr('ms.edit')) + '</button>' +
          '<button type="button" class="del" data-del="' + esc(g.goal_id) + '">' +
            esc(tr('ms.delete')) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---- the form ---- */

  function setPublic(on) {
    state.isPublic = !!on;
    var b = $('glPublic');
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
  }

  function openForm(goal) {
    state.editing = goal ? goal.goal_id : null;

    $('glId').value = goal ? goal.goal_id : '';
    $('glLabel').value = goal ? goal.label : '';
    $('glDescription').value = goal && goal.description ? goal.description : '';
    $('glKind').value = goal ? goal.kind : 'monthly';
    $('glTarget').value = goal ? fromCents(goal.target_cents) : '';
    $('glCurrency').value = goal ? goal.currency : 'USD';
    setPublic(goal ? goal.is_public : false);

    /* Progress is left EMPTY when editing rather than pre-filled with the
       current figure. Pre-filling would mean every save re-appended the same
       reading as a new snapshot, filling the series with duplicates that say
       nothing happened. Blank means "no new reading". */
    $('glRaised').value = '';
    $('glDonors').value = '';
    $('glRaised').placeholder = goal && goal.raised_cents != null
      ? fromCents(goal.raised_cents) : '0';
    $('glDonors').placeholder = goal && goal.donor_count != null
      ? String(goal.donor_count) : '';

    var form = $('glForm');
    form.hidden = false;
    if (goal) {
      var row = $('glList').querySelector('[data-id="' + goal.goal_id + '"]');
      if (row) row.insertAdjacentElement('afterend', form);
    } else {
      $('glFormHolder').appendChild(form);
    }
    $('glLabel').focus();
  }

  function closeForm() {
    state.editing = null;
    $('glForm').hidden = true;
    $('glFormHolder').appendChild($('glForm'));
  }

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
    state.goals = body.goals || [];
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
    if (body.goals) { state.goals = body.goals; render(); }
    return body;
  }

  /* ---- wiring ---- */

  $('glAdd').addEventListener('click', function () { openForm(null); });
  $('glCancel').addEventListener('click', closeForm);
  $('glPublic').addEventListener('click', function () { setPublic(!state.isPublic); });

  $('glList').addEventListener('click', async function (e) {
    var edit = e.target.closest('[data-edit]');
    if (edit) {
      var g = state.goals.find(function (x) { return x.goal_id === edit.dataset.edit; });
      if (g) openForm(g);
      return;
    }
    var del = e.target.closest('[data-del]');
    if (!del) return;

    var g = state.goals.find(function (x) { return x.goal_id === del.dataset.del; });
    if (!g) return;

    /* The typed confirmation the rest of the console uses for anything that
       destroys a record. A goal takes its whole history of readings with it. */
    var ok = await window.StaffConfirm({
      title: tr('gl.deleteTitle'),
      body: fill('gl.deleteBody', { name: g.label }),
      note: tr('gl.deleteNote'),
      type: 'DELETE',
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('ms.delete'),
      cancel: tr('ms.cancel'),
      danger: true,
    });
    if (!ok) return;

    var r = await send('DELETE', null, '?id=' + encodeURIComponent(g.goal_id));
    if (r) toast(tr('gl.deleted'), 'ok');
  });

  $('glForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    var target = toCents($('glTarget').value);
    if (!Number.isFinite(target) || target <= 0) {
      toast(tr('gl.needTarget'), 'bad');
      return;
    }

    var payload = {
      id: $('glId').value || undefined,
      label: $('glLabel').value,
      description: $('glDescription').value,
      kind: $('glKind').value,
      target_cents: target,
      currency: $('glCurrency').value,
      is_public: state.isPublic,
    };

    /* A new goal can carry its opening figure in the same action, so it does
       not read 0% until somebody remembers a second step. */
    var raised = $('glRaised').value.trim();
    if (!state.editing && raised !== '') {
      payload.raised_cents = toCents(raised);
      if ($('glDonors').value.trim() !== '') payload.donor_count = Number($('glDonors').value);
    }

    var r = await send('POST', payload);
    if (!r) return;

    /* On an EXISTING goal a figure is a new reading, which is a different
       write — the definition is edited, the progress is appended. */
    if (state.editing && raised !== '') {
      await send('PATCH', {
        id: state.editing,
        raised_cents: toCents(raised),
        donor_count: $('glDonors').value.trim() === '' ? null : Number($('glDonors').value),
      });
    }

    closeForm();
    toast(tr('gl.saved'), 'ok');
  });

  load();
})();
