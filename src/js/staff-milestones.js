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
  var state = { milestones: [], languages: [], editing: null,
              colA: null, colB: null, prefLang: 'en' };

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

  function has(code) {
    return state.languages.some(function (l) { return l.code === code; });
  }
  function langName(code) {
    var l = state.languages.filter(function (x) { return x.code === code; })[0];
    return l ? (l.native_name || l.name) : code;
  }
  function isEnabled(code) {
    var l = state.languages.filter(function (x) { return x.code === code; })[0];
    return !!(l && l.is_enabled);
  }

  /* Both pickers list every language. A disabled one is still selectable —
     you must be able to write a translation before switching it on. */
  function fillLangPickers() {
    [['msLangA', 'colA', 'msTagA'], ['msLangB', 'colB', 'msTagB']].forEach(function (t) {
      var sel = $(t[0]); if (!sel) return;
      sel.innerHTML = state.languages.map(function (l) {
        return '<option value="' + esc(l.code) + '">' + esc(l.native_name || l.name) +
               (l.is_enabled ? '' : ' — not published') + '</option>';
      }).join('');
      sel.value = state[t[1]] || '';
      var tag = $(t[2]);
      if (tag) {
        var on = isEnabled(sel.value);
        tag.textContent = on ? 'published' : 'not published';
        tag.className = 'ms-col-tag' + (on ? ' on' : '');
      }
    });
  }

  /* ---- rendering ------------------------------------------------------ */

  var STATUS_LABEL = {
    upcoming: 'Upcoming', in_progress: 'In progress',
    complete: 'Complete', cancelled: 'Cancelled'
  };

  /* The list shows the left column's language, falling back to any other so a
     milestone translated only into Croatian is never a blank row. */
  function titleOf(m) {
    var tx = m.text || {};
    if (state.colA && tx[state.colA] && tx[state.colA].title) return tx[state.colA].title;
    for (var code in tx) if (tx[code].title) return tx[code].title + ' (' + langName(code) + ')';
    return '(untitled)';
  }

  /* Which PUBLISHED languages this milestone is still missing. Only published
     ones: a gap in a language nobody serves is not a problem to nag about. */
  function missingWarning(m) {
    var tx = m.text || {};
    var missing = state.languages
      .filter(function (l) { return l.is_enabled && !(tx[l.code] && tx[l.code].title); })
      .map(function (l) { return l.native_name || l.name; });
    if (!missing.length) return '';
    return '<span class="ms-warn">missing ' + esc(missing.join(', ')) + '</span>';
  }

  /* Same fallback as the title: show the left column's wording, or any. */
  function whenOf(m) {
    var tx = m.text || {};
    if (state.colA && tx[state.colA] && tx[state.colA].target_label) {
      return tx[state.colA].target_label;
    }
    for (var code in tx) if (tx[code].target_label) return tx[code].target_label;
    return '';
  }

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
            '<span class="ms-title">' + esc(titleOf(m)) + '</span>' +
            (m.is_featured ? '<span class="badge live">featured</span>' : '') +
            (m.is_public ? '' : '<span class="badge proto">draft</span>') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(STATUS_LABEL[m.status] || m.status) + '</span>' +
            (whenOf(m) ? '<span>' + esc(whenOf(m)) + '</span>' : '') +
            (m.completion ? '<span class="tnum">' + m.completion + '%</span>' : '') +
            missingWarning(m) +
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
      state.languages = body.languages || [];
      state.prefLang = body.preferred_lang || 'en';

      // Left column opens on the staff member's own language. Right opens on
      // the next language they PUBLISH, falling back to any other language —
      // so the pairing is useful on first load without being fixed.
      if (!state.colA) {
        state.colA = has(state.prefLang) ? state.prefLang
                   : (state.languages[0] || {}).code;
      }
      if (!state.colB) {
        var others = state.languages.filter(function (l) { return l.code !== state.colA; });
        var enabled = others.filter(function (l) { return l.is_enabled; });
        state.colB = (enabled[0] || others[0] || {}).code || null;
      }
      fillLangPickers();
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

  function colFields(col) {
    return Array.prototype.slice.call(
      document.querySelectorAll('[data-col="' + col + '"]'));
  }

  function fillColumn(col, m) {
    var code = col === 'a' ? state.colA : state.colB;
    var tx = (m && m.text && code) ? (m.text[code] || {}) : {};
    colFields(col).forEach(function (el) { el.value = tx[el.dataset.tx] || ''; });
  }

  function readColumn(col) {
    var out = {};
    colFields(col).forEach(function (el) { out[el.dataset.tx] = el.value; });
    return out;
  }

  function openForm(id) {
    var m = id ? state.milestones.filter(function (x) { return x.id === id; })[0] : null;
    state.editing = id || null;

    $('msId').value = m ? m.id : '';
    fillColumn('a', m);
    fillColumn('b', m);
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
    // Only the two visible languages are sent. The endpoint upserts exactly
    // what it receives, so a language not on screen is left untouched rather
    // than being wiped by an editor that could not see it.
    var text = {};
    if (state.colA) text[state.colA] = readColumn('a');
    if (state.colB && state.colB !== state.colA) text[state.colB] = readColumn('b');

    var payload = {
      id: $('msId').value || undefined,
      text: text,
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

  // Switching a column's language re-reads that column from the milestone
  // being edited, so unsaved text in the OTHER column is never disturbed.
  [['msLangA', 'colA', 'a'], ['msLangB', 'colB', 'b']].forEach(function (cfg) {
    $(cfg[0]).addEventListener('change', function (e) {
      state[cfg[1]] = e.target.value;
      fillLangPickers();
      var m = state.editing
        ? state.milestones.filter(function (x) { return x.id === state.editing; })[0]
        : null;
      fillColumn(cfg[2], m);
      render();
    });
  });

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
