/* ============================================================
   staff-milestones.js — the public roadmap editor
   ============================================================
   Talks to /api/staff-milestones. Access has already authenticated
   the visitor by the time this runs; the endpoint re-verifies and
   scopes every query to the partner it resolves.

   TWO SAVE MODELS ON ONE SCREEN, DELIBERATELY:

     The toggles save IMMEDIATELY. Publishing is a decision, not a
     draft — you should not be able to flip "Published" and wander
     off believing it took effect. The switch disables while the
     request is in flight and reverts if it fails, so the control
     never shows a state the database does not hold.

     The form saves on SUBMIT. Text is edited in passes; saving
     every keystroke would fill the audit trail with noise and
     fight the person typing.

   Nothing here is optimistic. The list is re-rendered from what the
   server returned, not from what we hoped it would say — the whole
   point of a publish flag is that its displayed state is true.
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/staff-milestones';

  var $ = function (id) { return document.getElementById(id); };
  var state = { milestones: [], editing: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- status line -------------------------------------------------- */

  var statusTimer = null;
  function setStatus(el, text, kind) {
    if (!el) return;
    clearTimeout(statusTimer);
    el.textContent = text || '';
    el.className = 'hint' + (kind ? ' ' + kind : '');
    // "Saved" is worth showing and not worth keeping. An error stays until
    // something replaces it.
    if (kind === 'ok') {
      statusTimer = setTimeout(function () {
        if (el.textContent === text) { el.textContent = ''; el.className = 'hint'; }
      }, 2600);
    }
  }

  /* ---- toggles ------------------------------------------------------- */

  function setSwitch(btn, on) {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    var label = btn.querySelector('.switch-state');
    if (label) label.textContent = on ? 'On' : 'Off';
  }
  function isOn(btn) { return btn.getAttribute('aria-checked') === 'true'; }

  /* Wires a switch that only changes local state — used inside the form,
     where nothing persists until Save. */
  function wireLocalSwitch(btn) {
    btn.addEventListener('click', function () { setSwitch(btn, !isOn(btn)); });
  }

  /* ---- rendering ------------------------------------------------------ */

  var STATUS_LABEL = {
    upcoming: 'Upcoming', in_progress: 'In progress',
    complete: 'Complete', cancelled: 'Cancelled'
  };

  function render() {
    var host = $('msList');
    if (!state.milestones.length) {
      host.innerHTML = '<p class="empty">No milestones yet. ' +
        'Add one and it will stay unpublished until you switch it on.</p>';
      return;
    }

    host.innerHTML = state.milestones.map(function (m) {
      var child = m.parent_id ? ' ms-child' : '';
      return '<div class="ms-row' + child + '" data-id="' + esc(m.id) + '">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(m.title) + '</span>' +
            (m.is_featured ? '<span class="badge live">featured</span>' : '') +
            (m.is_public ? '' : '<span class="badge proto">draft</span>') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(STATUS_LABEL[m.status] || m.status) + '</span>' +
            (m.target_label ? '<span>' + esc(m.target_label) + '</span>' : '') +
            (m.completion ? '<span class="tnum">' + m.completion + '%</span>' : '') +
            (m.title_hr ? '' : '<span class="ms-warn">no Croatian title</span>') +
          '</div>' +
        '</div>' +
        '<div class="ms-toggle">' +
          '<button type="button" class="switch" role="switch" data-pub="' + esc(m.id) + '"' +
            ' aria-checked="' + (m.is_public ? 'true' : 'false') + '"' +
            ' aria-label="Published">' +
            '<span class="switch-track"><span class="switch-state">' +
              (m.is_public ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
          '</button>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          '<button type="button" data-edit="' + esc(m.id) + '">Edit</button>' +
          '<button type="button" class="del" data-del="' + esc(m.id) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---- loading -------------------------------------------------------- */

  async function load() {
    try {
      var res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      var body = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        $('msList').innerHTML = '<p class="empty">' + (
          res.status === 401 ? 'Your session has expired. ' +
            '<a href="/cdn-cgi/access/logout">Sign in again</a>.' :
          res.status === 403 ? 'Signed in as <b>' + esc(body.email || 'unknown') +
            '</b>, but that address has no partner access yet.' :
          'Could not load milestones (' + res.status + ')' +
            (body.error ? ' — ' + esc(body.error) : '') + '.'
        ) + '</p>';
        return;
      }
      state.milestones = body.milestones || [];
      render();
      fillParents();
    } catch (e) {
      $('msList').innerHTML = '<p class="empty">Could not reach the server — ' +
        esc(e.message) + '.</p>';
    }
  }

  /* ---- the publish toggle, saved immediately -------------------------- */

  async function togglePublished(btn, id) {
    var m = state.milestones.filter(function (x) { return x.id === id; })[0];
    if (!m) return;

    var next = !isOn(btn);
    // Show the intent, but lock the control: the state on screen is a claim
    // about the database, and it must not be made before it is true.
    setSwitch(btn, next);
    btn.disabled = true;
    setStatus($('msStatus'), next ? 'Publishing…' : 'Unpublishing…');

    try {
      var res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, m, { is_public: next }))
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('save failed (' + res.status + ')'));

      // Adopt the server's row rather than our guess.
      state.milestones = state.milestones.map(function (x) {
        return x.id === id ? body.saved : x;
      });
      render();
      setStatus($('msStatus'),
        body.saved.is_public ? 'Published — now visible on partner sites' : 'Unpublished',
        'ok');
    } catch (e) {
      setSwitch(btn, !next);          // put it back; nothing was saved
      btn.disabled = false;
      setStatus($('msStatus'), 'Could not save: ' + e.message, 'err');
    }
  }

  /* ---- the form -------------------------------------------------------- */

  function fillParents() {
    var sel = $('msParent');
    if (!sel) return;
    var current = state.editing;
    sel.innerHTML = '<option value="">— top level —</option>' +
      state.milestones
        // A milestone cannot be its own parent, and one level of nesting is
        // all the partner sites render.
        .filter(function (m) { return m.id !== current && !m.parent_id; })
        .map(function (m) {
          return '<option value="' + esc(m.id) + '">' + esc(m.title) + '</option>';
        }).join('');
  }

  function openForm(id) {
    var m = id ? state.milestones.filter(function (x) { return x.id === id; })[0] : null;
    state.editing = id || null;

    $('msId').value = m ? m.id : '';
    $('msTitle').value = m ? (m.title || '') : '';
    $('msTitleHr').value = m ? (m.title_hr || '') : '';
    $('msDesc').value = m ? (m.description || '') : '';
    $('msDescHr').value = m ? (m.description_hr || '') : '';
    $('msTarget').value = m ? (m.target_label || '') : '';
    $('msTargetHr').value = m ? (m.target_label_hr || '') : '';
    $('msDate').value = m ? (m.actual_date || '') : '';
    $('msStatusSel').value = m ? (m.status || 'upcoming') : 'upcoming';
    $('msCompletion').value = m ? (m.completion || 0) : 0;

    setSwitch($('msPublic'), m ? !!m.is_public : false);
    setSwitch($('msFeatured'), m ? !!m.is_featured : false);

    fillParents();
    $('msParent').value = m && m.parent_id ? m.parent_id : '';

    setStatus($('msFormStatus'), '');
    $('msForm').hidden = false;
    $('msTitle').focus();
  }

  function closeForm() {
    $('msForm').hidden = true;
    state.editing = null;
  }

  async function submitForm(e) {
    e.preventDefault();
    var payload = {
      id: $('msId').value || undefined,
      title: $('msTitle').value,
      title_hr: $('msTitleHr').value,
      description: $('msDesc').value,
      description_hr: $('msDescHr').value,
      target_label: $('msTarget').value,
      target_label_hr: $('msTargetHr').value,
      actual_date: $('msDate').value,
      status: $('msStatusSel').value,
      completion: $('msCompletion').value,
      parent_id: $('msParent').value,
      is_public: isOn($('msPublic')),
      is_featured: isOn($('msFeatured'))
    };

    var submit = $('msForm').querySelector('[type="submit"]');
    submit.disabled = true;
    setStatus($('msFormStatus'), 'Saving…');

    try {
      var res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('save failed (' + res.status + ')'));

      setStatus($('msFormStatus'), 'Saved', 'ok');
      closeForm();
      await load();
      setStatus($('msStatus'), body.created ? 'Milestone added' : 'Milestone updated', 'ok');
    } catch (err) {
      // The form stays open with the text still in it. Losing what someone
      // typed because a request failed is the worst thing an editor can do.
      setStatus($('msFormStatus'), err.message, 'err');
    } finally {
      submit.disabled = false;
    }
  }

  async function remove(id) {
    var m = state.milestones.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    if (!confirm('Delete "' + m.title + '"? This cannot be undone.')) return;

    setStatus($('msStatus'), 'Deleting…');
    try {
      var res = await fetch(API + '?id=' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin'
      });
      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        throw new Error(body.error || ('delete failed (' + res.status + ')'));
      }
      await load();
      setStatus($('msStatus'), 'Deleted', 'ok');
    } catch (e) {
      setStatus($('msStatus'), e.message, 'err');
    }
  }

  /* ---- boot ------------------------------------------------------------ */

  if (document.body.getAttribute('data-staff-page') !== 'milestones') return;

  wireLocalSwitch($('msPublic'));
  wireLocalSwitch($('msFeatured'));

  $('msAdd').addEventListener('click', function () { openForm(null); });
  $('msCancel').addEventListener('click', closeForm);
  $('msForm').addEventListener('submit', submitForm);

  // Delegated: the list re-renders after every change.
  $('msList').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.pub !== undefined) togglePublished(t, t.dataset.pub);
    else if (t.dataset.edit !== undefined) openForm(t.dataset.edit);
    else if (t.dataset.del !== undefined) remove(t.dataset.del);
  });

  load();
})();
