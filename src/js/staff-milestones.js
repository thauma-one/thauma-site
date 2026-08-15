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
  /* A WORKING COPY, NOT A LIVE WIRE.
     `saved` is what the server last told us. `draft` is what the screen shows.
     Nothing reaches the database until Save is pressed, so a publish toggle is
     a decision you can change your mind about, and "what is live" never
     depends on having noticed a switch move. */
  var state = { saved: {}, draft: {}, order: [], languages: [], editing: null,
                colA: null, colB: null, prefLang: 'en' };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isDirty(id) {
    return JSON.stringify(state.saved[id]) !== JSON.stringify(state.draft[id]);
  }
  function dirtyIds() { return state.order.filter(isDirty); }
  function list() { return state.order.map(function (id) { return state.draft[id]; }); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---- status line -------------------------------------------------- */

  /* Everything that used to write inline status text now raises a toast.
     The first argument is kept so call sites did not all have to change; the
     element it names is no longer written to. */
  /* Progress messages are dropped on purpose. A toast saying "Saving…"
     is replaced by its own result a moment later, so it is a flash of text
     that carries nothing — the disabled control already says work is in
     flight. Only outcomes get announced. */
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }

  function toastKey(key, kind) {
    setStatus(null, window.StaffI18n ? window.StaffI18n.t(key) : key, kind);
  }

  function setStatus(_el, text, kind) {
    if (text && kind && window.StaffToast) window.StaffToast(text, kind);
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

  /* ONLY the languages this partner publishes. A language switched off in
     Settings does not appear here at all — offering a column for a language
     nobody serves invites work that goes nowhere. To translate into a new
     language, turn it on in Settings first; that publishes nothing by itself,
     because each milestone still has its own publish switch.

     missingWarning() filters the same way, so a language you do not serve is
     never reported as missing either. */
  function enabledLangs() {
    return state.languages.filter(function (l) { return l.is_enabled; });
  }

  function fillLangPickers() {
    // ONE LANGUAGE, ONE COLUMN. A second column offering the same language as
    // the first is a side-by-side comparison of a thing with itself, and it
    // halves the width available for the text you are actually writing.
    var only = enabledLangs().length < 2;
    document.querySelector('.ms-langs').classList.toggle('single', only);
    var colB = document.querySelectorAll('.ms-col')[1];
    if (colB) colB.hidden = only;
    if (only) state.colB = null;

    [['msLangA', 'colA', 'msTagA'], ['msLangB', 'colB', 'msTagB']].forEach(function (t) {
      var sel = $(t[0]); if (!sel) return;
      sel.innerHTML = enabledLangs().map(function (l) {
        return '<option value="' + esc(l.code) + '">' + esc(l.native_name || l.name) +
               '</option>';
      }).join('');
      sel.value = state[t[1]] || '';
      // Every language in the list is published, so the old published /
      // not-published tag said the same thing on every column. It now shows
      // the code, which is the useful thing when two columns look alike.
      var tag = $(t[2]);
      if (tag) tag.textContent = sel.value ? sel.value.toUpperCase() : '';
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
    return tr('ms.untitled');
  }

  /* Which PUBLISHED languages this milestone is still missing. Only published
     ones: a gap in a language nobody serves is not a problem to nag about. */
  function missingWarning(m) {
    var tx = m.text || {};
    var missing = state.languages
      .filter(function (l) { return l.is_enabled && !(tx[l.code] && tx[l.code].title); })
      .map(function (l) { return l.native_name || l.name; });
    if (!missing.length) return '';
    return '<span class="ms-warn">' + tr('ms.missing') + ' ' + esc(missing.join(', ')) + '</span>';
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

  /* Park the panel somewhere innerHTML cannot reach, then put it back under
     its row afterwards. This is the whole fix for "changing the language
     closed the editor and it would not reopen": render() rebuilt the list the
     panel was sitting inside, and took the element with it. */
  function detachForm() {
    var form = $('msForm');
    if (form && form.parentNode !== $('msFormHolder')) $('msFormHolder').appendChild(form);
    return form;
  }

  function reattachForm() {
    var form = $('msForm');
    if (!form || form.hidden || !state.editing) return;
    var row = $('msList').querySelector('[data-id="' + cssEscape(state.editing) + '"]');
    if (row) row.after(form);
    markOpenRow();
  }

  /* The row knows it is the open one, so the chevron, highlight and sticky
     position survive a re-render rather than resetting every refresh.

     KEYED ON state.editing, NOT on the form's hidden attribute. It used to ask
     whether the panel was visible, but this runs BEFORE openPanel() unhides
     it — so the answer was always "no" and the class was never applied at all.
     The sticky row looked like a CSS problem and was a sequencing one.
     state.editing is set before this runs and cleared before it runs again on
     close, so it is correct in both directions. */
  function markOpenRow() {
    Array.prototype.forEach.call($('msList').querySelectorAll('.ms-row'), function (r) {
      var isOpen = !!(state.editing && r.dataset.id === state.editing);
      r.classList.toggle('is-open', isOpen);
      r.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  function render() {
    var host = $('msList');
    detachForm();
    if (!state.order.length) {
      host.innerHTML = '<p class="empty">No milestones yet. ' +
        'Add one and it will stay unpublished until you switch it on.</p>';
      return;
    }

    host.innerHTML = list().map(function (m) {
      var child = m.parent_id ? ' ms-child' : '';
      var rid = m.localId || m.id;
      // The row IS the control: role and aria-expanded so it reads as an
      // expander to a screen reader, not as decoration with a button in it.
      return '<div class="ms-row' + child + (isDirty(rid) ? ' is-dirty' : '') +
        '" data-id="' + esc(rid) + '" role="button" tabindex="0"' +
        ' aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(titleOf(m)) + '</span>' +
            (m.is_featured ? '<span class="badge live">' + tr('ms.featuredBadge') + '</span>' : '') +
            (m.is_public ? '' : '<span class="badge proto">' + tr('ms.draft') + '</span>') +
            (isDirty(m.localId || m.id) ? '<span class="badge unsaved">' + tr('ms.unsaved') + '</span>' : '') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(STATUS_LABEL[m.status] || m.status) + '</span>' +
            (whenOf(m) ? '<span>' + esc(whenOf(m)) + '</span>' : '') +
            (m.completion ? '<span class="tnum">' + m.completion + '%</span>' : '') +
            missingWarning(m) +
          '</div>' +
        '</div>' +
        '<div class="ms-toggle">' +
          '<button type="button" class="switch" role="switch" data-pub="' + esc(rid) + '"' +
            ' aria-checked="' + (m.is_public ? 'true' : 'false') + '"' +
            ' aria-label="Published">' +
            '<span class="switch-track"><span class="switch-state">' +
              (m.is_public ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
          '</button>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          '<span class="ms-chev" aria-hidden="true"></span>' +
          '<button type="button" data-edit="' + esc(rid) + '">Edit</button>' +
          '<button type="button" class="del" data-del="' + esc(rid) + '">Delete</button>' +
        '</div>' +
      '</div>';
    }).join('');

    reattachForm();
  }

  /* ---- loading -------------------------------------------------------- */

  /* Three failures, three messages — see the note in staff-settings.js. One
     catch reporting everything as "cannot reach the server" was wrong often
     enough to be useless. */
  async function load() {
    detachForm();

    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      if (window.StaffProblem) {
        window.StaffProblem(tr('err.unreachable') + ' ' + e.message, load);
      }
      return;
    }

    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) {
        window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', load);
      }
      return;
    }

    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401
            ? tr('err.expired')
          : res.status === 403
            ? 'Signed in as ' + (body.email || 'unknown') +
              ', but that address has no partner access yet.'
            : tr('err.refused') + ' (' + res.status + ')' +
              (body.error ? ' — ' + body.error : '') + '.',
          res.status === 401 ? null : load);
      }
      return;
    }

    if (window.StaffProblemClear) window.StaffProblemClear();

    state.saved = {}; state.draft = {}; state.order = [];
    (body.milestones || []).forEach(function (m) {
      state.saved[m.id] = m;
      state.draft[m.id] = clone(m);
      state.order.push(m.id);
    });
    state.languages = body.languages || [];
    state.prefLang = body.preferred_lang || 'en';
    if (window.StaffI18n) window.StaffI18n.setLang(state.prefLang);

    var on = enabledLangs();
    if (!state.colA || !on.some(function (l) { return l.code === state.colA; })) {
      state.colA = on.some(function (l) { return l.code === state.prefLang; })
        ? state.prefLang : (on[0] || {}).code || null;
    }
    if (!state.colB || !on.some(function (l) { return l.code === state.colB; })) {
      var others = on.filter(function (l) { return l.code !== state.colA; });
      state.colB = (others[0] || {}).code || null;
    }

    try {
      fillLangPickers();
      render();
      fillParents();
      updateSaveBar();
    } catch (e) {
      if (window.StaffProblem) {
        window.StaffProblem(tr('err.renderFailed') + ': ' + e.message, null);
      }
      console.error('milestones render failed:', e);
    }
  }

  /* ---- publishing is a DRAFT change, not an instant one ---------------- */

  /* Previously this wrote to the database the moment the switch moved. That
     made "published" always true on screen, but it also meant there was no
     such thing as changing your mind, and no moment where you could see what
     you were about to do. Now it edits the working copy and the row is marked
     unsaved until you press Save. */
  function togglePublished(btn, id) {
    var m = state.draft[id];
    if (!m) return;
    m.is_public = !m.is_public;
    setSwitch(btn, m.is_public);
    render();
    updateSaveBar();
  }

  /* ---- saving, explicitly ---------------------------------------------- */

  function updateSaveBar() {
    var n = dirtyIds().length;
    var bar = $('msSaveBar');
    if (!bar) return;
    bar.hidden = n === 0;
    var label = $('msDirtyCount');
    if (label) {
      label.textContent = n === 1 ? '1 unsaved change' : n + ' unsaved changes';
    }
    // The bar appearing or leaving changes how far down the open row must sit.
    updateStickyOffsets();
  }

  async function saveAll() {
    var ids = dirtyIds();
    if (!ids.length) return;

    var btn = $('msSaveAll');
    btn.disabled = true;

    var failed = [];
    for (var i = 0; i < ids.length; i++) {
      var m = state.draft[ids[i]];
      try {
        var res = await fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m)
        });
        if (!res.ok) {
          var body = await res.json().catch(function () { return {}; });
          throw new Error(body.error || ('save failed (' + res.status + ')'));
        }
      } catch (e) {
        // Keep going: one bad milestone should not strand the others as
        // unsaved, and the reload afterwards shows exactly what landed.
        failed.push(titleOf(m) + ' — ' + e.message);
      }
    }

    btn.disabled = false;
    await load();
    if (failed.length) {
      setStatus($('msStatus'), failed.length + ' could not be saved: ' + failed[0], 'err');
    } else {
      toastKey('toast.saved', 'ok');
    }
  }

  function discardAll() {
    if (!confirm('Discard ' + dirtyIds().length + ' unsaved change(s)?')) return;
    state.order.forEach(function (id) { state.draft[id] = clone(state.saved[id]); });
    closeForm();
    render();
    updateSaveBar();
    toastKey('toast.discarded', 'ok');
  }

  /* ---- the form -------------------------------------------------------- */

  /* ---- the sticky stack ------------------------------------------------ */

  /* Only two things want the top now: the header, and the open row beneath it.
     The unsaved bar moved to the bottom of the viewport, which removed a
     three-way contest for the same edge — and with it the need to publish a
     measured offset for the row, which is a plain constant again. */
  function stickyTop() {
    var header = document.querySelector('.top');
    return header ? header.offsetHeight : 0;
  }

  /* The bar is fixed to the bottom, so the page needs matching padding or the
     last row sits permanently underneath it. Measured rather than guessed:
     the buttons wrap onto a second line on narrow screens. */
  function updateStickyOffsets() {
    var bar = $('msSaveBar');
    var showing = bar && !bar.hidden;
    document.body.classList.toggle('has-savebar', !!showing);
    if (showing) {
      document.documentElement.style.setProperty(
        '--ms-savebar-h', bar.offsetHeight + 'px');
    }
  }

  /* Put a row's top edge just under the sticky stack.

     scrollIntoView cannot do this: it knows nothing about sticky elements, so
     `block:"start"` parks the row underneath the header where it cannot be
     seen, and `block:"nearest"` often does not move at all. */
  function scrollRowToTop(row) {
    if (!row) return;
    var y = window.scrollY + row.getBoundingClientRect().top - stickyTop() - 10;
    window.scrollTo({
      top: Math.max(0, y),
      behavior: reducedMotion() ? 'auto' : 'smooth'
    });
  }

  /* ---- opening and closing the panel ----------------------------------- */

  /* Height cannot be transitioned to or from `auto`, so each direction
     measures the real height and animates between that and zero, then hands
     control back to the layout. Doing it in JS rather than with a max-height
     guess means the timing is the same for a one-line milestone and a long
     one — a max-height large enough for the longest makes short panels appear
     to snap open early and hang. */
  /* 600ms, up from 420. The first pass was measured to be "not instant" and
     it cleared that bar without clearing the real one: a panel that carries a
     whole form needs long enough that the eye follows the edge down rather
     than noticing the result. Matches the duration in staff.css. */
  var PANEL_MS = 600;

  function reducedMotion() {
    return window.matchMedia &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function openPanel(el) {
    return new Promise(function (resolve) {
      el.hidden = false;
      if (reducedMotion()) { el.style.height = ''; el.style.opacity = ''; return resolve(); }

      el.classList.add('is-animating');
      el.style.height = '0px';
      el.style.opacity = '0';
      // Force the browser to accept 0 as a starting point before changing it,
      // or both assignments collapse into one frame and nothing animates.
      void el.offsetHeight;
      el.style.height = el.scrollHeight + 'px';
      el.style.opacity = '1';

      setTimeout(function () {
        // Back to auto so the panel can grow as its content does — a fixed
        // height would clip a description someone keeps typing into.
        el.style.height = '';
        el.style.opacity = '';
        el.classList.remove('is-animating');
        resolve();
      }, PANEL_MS);
    });
  }

  function closePanel(el) {
    return new Promise(function (resolve) {
      if (el.hidden) return resolve();
      if (reducedMotion()) { el.hidden = true; el.style.height = ''; return resolve(); }

      el.classList.add('is-animating');
      el.style.height = el.scrollHeight + 'px';
      el.style.opacity = '1';
      void el.offsetHeight;
      el.style.height = '0px';
      // Fades faster than it collapses (see the CSS), so the text stops being
      // legible early rather than shrinking while still readable — that is
      // what makes a collapsing panel feel like a flicker.
      el.style.opacity = '0';

      setTimeout(function () {
        el.hidden = true;
        el.style.height = '';
        el.style.opacity = '';
        el.classList.remove('is-animating');
        resolve();
      }, PANEL_MS);
    });
  }



  function fillParents() {
    var sel = $('msParent');
    if (!sel) return;
    var current = state.editing;
    sel.innerHTML = '<option value="">— top level —</option>' +
      list()
        // A milestone cannot be its own parent, and one level of nesting is
        // all the partner sites render.
        .filter(function (m) { return m.id !== current && !m.parent_id; })
        .map(function (m) {
          return '<option value="' + esc(m.id) + '">' + esc(titleOf(m)) + '</option>';
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

  /* Ids are generated by us, but a milestone id still ends up inside an
     attribute selector, and CSS.escape is not in older Safari. */
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  async function openForm(id) {
    var form = $('msForm');

    // ALREADY OPEN ON THIS ROW -> close it. Pressing Edit again to put the
    // panel away is what everyone reaches for first, and having it do nothing
    // reads as a broken button.
    if (!form.hidden && state.editing === id) { await closeForm(); return; }

    // Open on a DIFFERENT row: close where it is before moving it. Without
    // the wait, the panel jumps to its new position at full height and then
    // animates from there, which looks like two unrelated things happening.
    if (!form.hidden) await closePanel(form);

    var m = id ? state.draft[id] : null;
    state.editing = id || null;

    $('msId').value = m && state.saved[id] ? id : '';
    fillColumn('a', m);
    fillColumn('b', m);
    $('msDate').value = m ? (m.actual_date || '') : '';
    $('msStatusSel').value = m ? (m.status || 'upcoming') : 'upcoming';
    $('msCompletion').value = m ? (m.completion || 0) : 0;

    setSwitch($('msPublic'), m ? !!m.is_public : false);
    setSwitch($('msFeatured'), m ? !!m.is_featured : false);

    fillParents();
    $('msParent').value = m && m.parent_id ? m.parent_id : '';

    setStatus($('msFormStatus'), 'Applies to the list — save to publish');

    // Directly beneath its own row. The form used to sit at the bottom of the
    // page, so editing the third of twelve milestones meant scrolling past
    // nine unrelated rows and losing sight of the one you meant.
    var row = id ? $('msList').querySelector('[data-id="' + cssEscape(id) + '"]') : null;
    if (row) row.after(form); else $('msList').after(form);

    markOpenRow();
    updateStickyOffsets();

    // The ROW goes to the top, not the panel. It stays pinned there while you
    // scroll the form, so which milestone you are editing never leaves the
    // screen — the panel is tall enough that its own heading would otherwise
    // scroll away within a few lines.
    scrollRowToTop(row);
    await openPanel(form);

    var first = form.querySelector('[data-col="a"][data-tx="title"]');
    if (first) first.focus({ preventScroll: true });
  }

  async function closeForm() {
    await closePanel($('msForm'));
    state.editing = null;
    markOpenRow();
  }

  /* Applies to the WORKING COPY. Nothing reaches the database until Save. */
  function submitForm(e) {
    e.preventDefault();

    var text = {};
    if (state.colA) text[state.colA] = readColumn('a');
    if (state.colB && state.colB !== state.colA) text[state.colB] = readColumn('b');

    var id = $('msId').value;
    var isNew = !id;
    if (isNew) {
      // A local id until the server issues a real one. Prefixed so it is
      // obvious in any log that this row has never been saved.
      id = 'new_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      state.order.push(id);
      state.saved[id] = null;
    }

    var existing = state.draft[id] || { text: {} };
    // Merge rather than replace: a language not on screen keeps its text.
    var merged = Object.assign({}, existing.text || {}, text);

    state.draft[id] = Object.assign({}, existing, {
      id: isNew ? undefined : id,
      localId: id,
      text: merged,
      actual_date: $('msDate').value,
      status: $('msStatusSel').value,
      completion: Number($('msCompletion').value) || 0,
      parent_id: $('msParent').value || null,
      is_public: isOn($('msPublic')),
      is_featured: isOn($('msFeatured'))
    });

    closeForm();
    render();
    updateSaveBar();
    toastKey(isNew ? 'toast.added' : 'toast.updated', 'ok');
  }

  async function remove(id) {
    var m = state.draft[id];
    if (!m) return;

    // A milestone that has never been saved exists only in this tab. Asking
    // the server to delete it would 404 on an id it has never seen, and
    // confirming a "permanent" delete for something that was never stored
    // would be theatre.
    if (!state.saved[id]) {
      delete state.draft[id];
      state.order = state.order.filter(function (x) { return x !== id; });
      closeForm(); render(); updateSaveBar();
      toastKey('toast.discarded', 'ok');
      return;
    }

    if (!confirm('Delete "' + titleOf(m) + '"? This cannot be undone.')) return;

    try {
      var res = await fetch(API + '?id=' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin'
      });
      if (!res.ok) {
        var body = await res.json().catch(function () { return {}; });
        throw new Error(body.error || ('delete failed (' + res.status + ')'));
      }
      await load();
      toastKey('toast.deleted', 'ok');
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
        ? state.draft[state.editing]
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
    var btn = e.target.closest('button');
    if (btn) {
      if (btn.dataset.pub !== undefined) return togglePublished(btn, btn.dataset.pub);
      if (btn.dataset.edit !== undefined) return openForm(btn.dataset.edit);
      if (btn.dataset.del !== undefined) return remove(btn.dataset.del);
      return;
    }
    // THE WHOLE BAR IS THE TARGET. Clicking a row opens it, the way a
    // disclosure row does everywhere else — the Edit button stays because it
    // is the discoverable affordance, but nobody should have to find it.
    // Clicks that land inside the open panel are not the row's business.
    if (e.target.closest('.ms-form')) return;
    var row = e.target.closest('.ms-row');
    if (row) openForm(row.dataset.id);
  });

  // Keyboard parity: the row is focusable and announces itself as a button.
  $('msList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('.ms-form')) return;
    var row = e.target.closest('.ms-row');
    if (row) { e.preventDefault(); openForm(row.dataset.id); }
  });

  // The browser's own dialog: wording is not ours to choose, and a custom
  // one cannot block navigation. Only armed when something is actually
  // unsaved, so it never cries wolf.
  window.addEventListener('beforeunload', function (e) {
    if (!dirtyIds().length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  $('msSaveAll').addEventListener('click', saveAll);
  $('msDiscard').addEventListener('click', discardAll);

  updateStickyOffsets();
  window.addEventListener('resize', updateStickyOffsets);

  load();
})();
