/* ============================================================
   staff-mailing.js — a partner's mailing lists
   ============================================================
   The same row-that-opens-into-a-form the milestone, goal and prayer editors
   use, via staff-rowpanel.js. Learning one screen in this console should teach
   the next one, and a mailing list is the same shape of object as everything
   else here: a thing in a list, with settings behind it.

   WHAT IS DIFFERENT, and why it gets its own page rather than a tab on
   another: a list has PEOPLE on it. That is a second view — potentially
   thousands of rows, paged — and eventually a composer, a send history and an
   archive beside it. Those do not fit inside a row.

   SCOPE. Most people see their own partner's lists and nothing else. An
   administrator or somebody with the communications role can switch to
   Thauma's own lists, and the switch appears ONLY because the API said so
   (`may_send_as_organisation`) — never because this file read a role out of
   the browser. A control that appears and then answers 403 teaches people that
   the console lies to them.
   ============================================================ */
(function () {
  'use strict';

  /* The list, not the page name — see the note in staff-milestones.js. */
  if (!document.getElementById('mlList')) return;

  var API = '/api/staff-mailing';
  var $ = function (id) { return document.getElementById(id); };

  var state = { lists: [], tags: [], scope: 'partner', editing: null, viewing: null };

  var panel = window.StaffRowPanel({
    listId: 'mlList', formId: 'mlForm', holderId: 'mlFormHolder',
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return String(tr(key)).replace(/\{(\w+)\}/g, function (m, k) {
      return vars[k] == null ? m : vars[k];
    });
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function setStatus(el, text) { if (el) el.textContent = text || ''; }

  function url(extra) {
    var q = state.scope === 'organisation' ? '?scope=organisation' : '';
    if (!extra) return API + q;
    return API + (q ? q + '&' : '?') + extra;
  }

  /* ---- the list of lists ---------------------------------------------- */

  function render() {
    panel.detach();

    var host = $('mlList');
    if (!state.lists.length) {
      host.innerHTML = '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
      return;
    }

    host.innerHTML = state.lists.map(function (l) {
      /* THE COUNT THAT MATTERS IS `subscribed`. Pending are people who have
         not confirmed and must never be mailed, so showing a single total
         would overstate the reach of every list on the page. */
      var counts = [
        fill('ml.countSubscribed', { n: l.subscribed || 0 }),
        (l.pending ? fill('ml.countPending', { n: l.pending }) : null),
      ].filter(Boolean).join(' · ');

      return '<div class="ms-row" data-id="' + esc(l.id) + '"' +
        ' role="button" tabindex="0" aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(l.name) + '</span>' +
            (l.is_open
              ? '<span class="badge live">' + esc(tr('ml.openBadge')) + '</span>'
              : '<span class="badge proto">' + esc(tr('ml.closedBadge')) + '</span>') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(counts) + '</span>' +
            '<span>' + esc(l.from_name + ' <' + l.from_email + '>') + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          '<button type="button" data-people="' + esc(l.id) + '">' +
            esc(tr('ml.viewPeople')) + '</button>' +
          '<span class="ms-chev" aria-hidden="true"></span>' +
          '<button type="button" data-edit="' + esc(l.id) + '">' +
            esc(tr('ms.edit')) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    panel.reattach(state.editing);
  }

  function listById(id) {
    return state.lists.filter(function (l) { return l.id === id; })[0] || null;
  }

  /* ---- the form -------------------------------------------------------- */

  function setSwitch(btn, on) {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
  }

  async function openForm(id) {
    var l = id ? listById(id) : null;

    if (panel.isOpen() && state.editing === id) { await closeForm(); return; }
    if (panel.isOpen()) await panel.close();

    state.editing = id || null;

    $('mlId').value = l ? l.id : '';
    $('mlName').value = l ? l.name : '';
    $('mlSlug').value = l ? l.slug : '';
    $('mlDescription').value = (l && l.description) || '';
    $('mlFromName').value = l ? l.from_name : '';
    $('mlFromEmail').value = l ? l.from_email : '';
    $('mlReplyTo').value = (l && l.reply_to) || '';
    setSwitch($('mlOpen'), !!(l && l.is_open));

    /* A list that does not exist yet cannot be archived. */
    $('mlArchive').hidden = !l;
    setStatus($('mlFormStatus'), '');

    panel.moveTo(state.editing);
    panel.markOpen(state.editing);
    await panel.open();

    var row = panel.rowFor(state.editing);
    if (row) panel.scrollRowToTop(row);
    $('mlName').focus();
  }

  async function closeForm() {
    await panel.close();
    state.editing = null;
    panel.markOpen(null);
    panel.detach();
  }

  async function submitForm(e) {
    e.preventDefault();
    var payload = {
      id: $('mlId').value || undefined,
      name: $('mlName').value.trim(),
      slug: $('mlSlug').value.trim(),
      description: $('mlDescription').value.trim(),
      from_name: $('mlFromName').value.trim(),
      from_email: $('mlFromEmail').value.trim(),
      reply_to: $('mlReplyTo').value.trim(),
      is_open: $('mlOpen').getAttribute('aria-checked') === 'true',
    };

    setStatus($('mlFormStatus'), tr('ml.saving'));
    var res, body;
    try {
      res = await fetch(url(), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      body = await res.json();
    } catch (err) {
      setStatus($('mlFormStatus'), tr('err.unreachable') + ' ' + err.message);
      return;
    }
    if (!res.ok) { setStatus($('mlFormStatus'), body.error || tr('err.refused')); return; }

    setStatus($('mlFormStatus'), '');
    toast(tr('ml.saved'), 'ok');
    await closeForm();
    await load();
  }

  async function archive() {
    var l = listById(state.editing);
    if (!l) return;

    /* The typed confirmation this console uses for anything that removes
       something people can see. Archiving keeps the subscribers, and the
       dialog says so — the fear it needs to answer is "am I deleting these
       people", and the answer is no. */
    var ok = await window.StaffConfirm({
      title: fill('ml.archiveTitle', { name: l.name }),
      body: tr('ml.archiveBody'),
      note: tr('ml.archiveNote'),
      type: 'ARCHIVE',
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('ml.archive'),
      cancel: tr('ms.cancel'),
    });
    if (!ok) return;

    var res = await fetch(url(), {
      method: 'DELETE', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: l.id }),
    });
    if (!res.ok) { toast(tr('err.refused'), 'bad'); return; }
    toast(tr('ml.archived'), 'ok');
    await closeForm();
    await load();
  }

  /* ---- the people on a list -------------------------------------------- */

  async function showPeople(id) {
    var l = listById(id);
    if (!l) return;
    state.viewing = id;

    $('mlPeopleTitle').textContent = l.name;
    $('mlSubscribers').innerHTML = '<p class="empty">' + esc(tr('common.loading')) + '</p>';
    $('mlPeople').hidden = false;
    document.querySelector('.ms-bar').hidden = true;
    $('mlList').hidden = true;

    var res, body;
    try {
      res = await fetch(url('list=' + encodeURIComponent(id)),
                        { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, null);
      return;
    }
    if (!res.ok) {
      if (window.StaffProblem) window.StaffProblem(body.error || tr('err.refused'), null);
      return;
    }

    var rows = body.subscribers || [];
    setStatus($('mlPeopleCount'), fill('ml.countSubscribed', { n: rows.length }));

    if (!rows.length) {
      $('mlSubscribers').innerHTML = '<p class="empty">' + esc(tr('ml.noPeople')) + '</p>';
      return;
    }

    $('mlSubscribers').innerHTML = rows.map(function (s) {
      return '<div class="ms-row" data-sub="' + esc(s.id) + '">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(s.email) + '</span>' +
            (s.status === 'subscribed' ? '' :
              '<span class="badge proto">' + esc(tr('ml.status.' + s.status)) + '</span>') +
          '</div>' +
          '<div class="ms-meta">' +
            (s.name ? '<span>' + esc(s.name) + '</span>' : '') +
            '<span>' + esc((s.subscribed_at || '').slice(0, 10)) + '</span>' +
            (s.tags ? '<span>' + esc(s.tags) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          (s.status === 'subscribed'
            ? '<button type="button" data-unsub="' + esc(s.id) + '">' +
                esc(tr('ml.unsubscribe')) + '</button>'
            : '') +
          '<button type="button" class="del" data-delsub="' + esc(s.id) + '">' +
            esc(tr('ms.delete')) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function backToLists() {
    state.viewing = null;
    $('mlPeople').hidden = true;
    document.querySelector('.ms-bar').hidden = false;
    $('mlList').hidden = false;
  }

  /* ---- loading --------------------------------------------------------- */

  async function load() {
    panel.detach();

    var res, body;
    try {
      res = await fetch(url(), { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, load);
      return;
    }
    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', load);
      return;
    }
    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401 ? tr('err.expired')
            : (body.error || tr('err.refused') + ' (' + res.status + ')'),
          res.status === 401 ? null : load);
      }
      return;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    if (window.StaffActing) window.StaffActing(body);

    state.lists = body.lists || [];
    state.tags = body.tags || [];

    /* The scope switch exists only if the SERVER says this account may use it. */
    if (body.may_send_as_organisation) {
      $('mlScope').hidden = false;
      $('mlScopeMine').textContent = (body.partner && body.partner.display_name) || tr('ml.scopeMine');
    }

    try { render(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.renderFailed') + ': ' + e.message, null);
      console.error('mailing render failed:', e);
    }
  }

  /* ---- wiring ---------------------------------------------------------- */

  $('mlAdd').addEventListener('click', function () { openForm(null); });
  $('mlCancel').addEventListener('click', closeForm);
  $('mlForm').addEventListener('submit', submitForm);
  $('mlArchive').addEventListener('click', archive);
  $('mlBack').addEventListener('click', backToLists);
  $('mlOpen').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });

  document.addEventListener('click', function (e) {
    var scope = e.target.closest('[data-scope]');
    if (scope) {
      state.scope = scope.dataset.scope;
      Array.prototype.forEach.call(document.querySelectorAll('[data-scope]'), function (b) {
        b.classList.toggle('is-on', b.dataset.scope === state.scope);
      });
      backToLists();
      return load();
    }
  });

  $('mlList').addEventListener('click', function (e) {
    var people = e.target.closest('[data-people]');
    if (people) return showPeople(people.dataset.people);

    var edit = e.target.closest('[data-edit]');
    if (edit) return openForm(edit.dataset.edit);

    /* THE WHOLE BAR IS THE TARGET, as everywhere else in this console. */
    if (e.target.closest('#mlForm')) return;
    var row = e.target.closest('.ms-row');
    if (row) openForm(row.dataset.id);
  });

  $('mlList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('#mlForm')) return;
    var row = e.target.closest('.ms-row');
    if (row) { e.preventDefault(); openForm(row.dataset.id); }
  });

  $('mlSubscribers').addEventListener('click', async function (e) {
    var unsub = e.target.closest('[data-unsub]');
    if (unsub) {
      await fetch(url(), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'subscriber', id: unsub.dataset.unsub,
                               status: 'unsubscribed' }),
      });
      return showPeople(state.viewing);
    }

    var del = e.target.closest('[data-delsub]');
    if (!del) return;

    /* REMOVING SOMEBODY IS REMOVING THEM. There is no undo and the dialog
       says so — this is the action somebody takes because a person asked to
       be forgotten, and a soft delete would not honour that. */
    var ok = await window.StaffConfirm({
      title: tr('ml.removeTitle'),
      body: tr('ml.removeBody'),
      note: tr('ml.removeNote'),
      type: 'DELETE',
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('ms.delete'),
      cancel: tr('ms.cancel'),
    });
    if (!ok) return;

    await fetch(url(), {
      method: 'DELETE', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ what: 'subscriber', id: del.dataset.delsub }),
    });
    showPeople(state.viewing);
  });

  load();
})();
