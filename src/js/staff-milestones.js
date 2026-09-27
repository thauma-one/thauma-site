/* ============================================================
   staff-milestones.js — the public roadmap editor
   ============================================================
   Talks to /api/staff-milestones. Access has already authenticated
   the visitor by the time this runs; the endpoint re-verifies and
   scopes every query to the partner it resolves.

   EDIT FREELY, THEN PUBLISH (Chase's option B, 2026-09-26). The
   list is a working copy: an edit, a new milestone, the switch on
   a row, even a delete, is marked "not live yet" and waits for the
   Updates bar's Publish changes (staff-updates.js), which this
   section answers with publish(). Closing the editor keeps what
   was typed; Cancel undoes that editing.

   Nothing is optimistic after publishing: the list is re-read from
   the server, so what it shows is what landed.
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
                colA: null, colB: null, prefLang: 'en', removed: {}, before: null,
                /* The open editor's date and status (see "when" and "progress"
                   below); dateWords are the public season words it previews
                   with, from the endpoint. */
                when: null, prog: null, dateWords: {} };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isDirty(id) {
    return !!state.removed[id] ||
      JSON.stringify(state.saved[id]) !== JSON.stringify(state.draft[id]);
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

  var STATUS_KEY = {
    upcoming: 'ms.upcoming', in_progress: 'ms.inProgress',
    complete: 'ms.complete', canceled: 'ms.canceled'
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
  /* All three ministry editors share one implementation of "a row that opens
     into a form" — where it lives, how it animates, which row is marked open.
     See staff-rowpanel.js; this file used to carry its own copy. */
  var panel = window.StaffRowPanel({
    listId: 'msList', formId: 'msForm', holderId: 'msFormHolder',
    saveBarId: 'upBar',
  });

  function detachForm() { return panel.detach(); }
  function reattachForm() { panel.reattach(state.editing); }
  function markOpenRow() { panel.markOpen(state.editing); }
  function cssEscape(v) { return panel.cssEscape(v); }
  function reducedMotion() { return panel.reducedMotion(); }
  function updateStickyOffsets() { panel.updateStickyOffsets(); }
  function scrollRowToTop(row) { panel.scrollRowToTop(row); }
  function openPanel() { return panel.open(); }
  function closePanel() { return panel.close(); }

  function render() {
    var host = $('msList');
    detachForm();
    if (!state.order.length) {
      host.innerHTML = '<p class="empty">' + esc(tr('ms.empty')) + '</p>';
      return;
    }

    host.innerHTML = list().map(function (m) {
      var child = m.parent_id ? ' ms-child' : '';
      var rid = m.localId || m.id;
      // The row IS the control: role and aria-expanded so it reads as an
      // expander to a screen reader, not as decoration with a button in it.
      var gone = !!state.removed[rid];
      return '<div class="ms-row' + child + (isDirty(rid) ? ' is-dirty' : '') + (gone ? ' is-removed' : '') +
        '" data-id="' + esc(rid) + '" role="button" tabindex="0"' +
        ' aria-expanded="false">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            /* The star inside the title, so a long title wraps with it. */
            '<span class="ms-title">' +
              (m.is_featured ? '<span class="ms-star" title="' + esc(tr('ms.featured')) + '" aria-label="' +
                esc(tr('ms.featured')) + '">★</span> ' : '') +
              esc(titleOf(m)) + '</span>' +
            (gone ? '<span class="badge unsaved">' + esc(tr('up.willRemove')) + '</span>'
              : isDirty(rid) ? '<span class="badge unsaved">' + esc(tr('up.notLive')) + '</span>' : '') +
          '</div>' +
          '<div class="ms-meta">' +
            '<span>' + esc(tr(STATUS_KEY[m.status] || 'ms.upcoming')) + '</span>' +
            (whenOf(m) ? '<span>' + esc(whenOf(m)) + '</span>' : '') +
            /* Upcoming carries no progress, here as on the public site. */
            (m.completion && m.status !== 'upcoming' ? '<span class="tnum">' + m.completion + '%</span>' : '') +
            missingWarning(m) +
          '</div>' +
        '</div>' +
        /* THE SWITCH STAYS ON THE ROW (Chase): whether it is on the site, in
           one click. A removed row offers Keep instead. */
        '<div class="ms-toggle">' + (gone
          ? '<button type="button" class="ghost-btn sm" data-keep="' + esc(rid) + '">' + esc(tr('up.keep')) + '</button>'
          : '<button type="button" class="switch" role="switch" data-pub="' + esc(rid) + '"' +
            ' aria-checked="' + (m.is_public ? 'true' : 'false') + '"' +
            ' aria-label="' + esc(tr('ms.published')) + '">' +
            '<span class="switch-track"><span class="switch-state">' +
              (m.is_public ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
          '</button>') +
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

    /* The console's navigation is filtered from `you.roles`, and this page had
       no other source for them — opened directly rather than walked to from
       the dashboard, it showed every staff link to whoever arrived. Set before
       the refusal branch below: a 403 still says who you are, and the header
       should be right even when the rest of the page is not. */
    if (body && body.you && window.StaffIdentity) {
      window.StaffIdentity(body.you, body.partner);
    }

    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401
            ? tr('err.expired')
          : res.status === 403
            // The server's own sentence — see the note in staff.js. Two
            // different 403s were being reported as the same one.
            ? 'Signed in as ' + (body.email || 'unknown') + '. ' +
              (body.error || 'That address has no partner access yet.')
            : tr('err.refused') + ' (' + res.status + ')' +
              (body.error ? ' — ' + body.error : '') + '.',
          res.status === 401 ? null : load);
      }
      return;
    }

    if (window.StaffProblemClear) window.StaffProblemClear();

    if (window.StaffActing) window.StaffActing(body);
    state.saved = {}; state.draft = {}; state.order = []; state.removed = {};
    (body.milestones || []).forEach(function (m) {
      state.saved[m.id] = m;
      state.draft[m.id] = clone(m);
      state.order.push(m.id);
    });
    state.languages = body.languages || [];
    state.dateWords = body.date_words || {};
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
    if (window.StaffUpdates) window.StaffUpdates.changed();
    // The bar appearing or leaving changes how far down the open row must sit.
    updateStickyOffsets();
  }

  /* ---- publishing: what the Updates bar asks of this section ------------ */

  async function publish() {
    if (!$('msForm').hidden) await closeForm(true);    // what is open is included
    var failed = [];
    var ids = dirtyIds();
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i], m = state.draft[id];
      try {
        var res;
        if (state.removed[id]) {
          res = await fetch(API + '?id=' + encodeURIComponent(id), { method: 'DELETE', credentials: 'same-origin' });
        } else {
          res = await fetch(API, {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m)
          });
        }
        if (!res.ok) {
          var body = await res.json().catch(function () { return {}; });
          throw new Error(body.error || ('(' + res.status + ')'));
        }
      } catch (e) {
        // One bad milestone does not strand the others; the reload shows
        // exactly what landed.
        failed.push(titleOf(m) + ' — ' + e.message);
      }
    }
    await load();
    return { failed: failed };
  }

  function discard() {
    state.order = state.order.filter(function (id) { return state.saved[id]; });
    state.order.forEach(function (id) { state.draft[id] = clone(state.saved[id]); });
    Object.keys(state.draft).forEach(function (id) { if (!state.saved[id]) delete state.draft[id]; });
    state.removed = {};
    state.before = null;               // nothing to put back: all of it goes
    if (!$('msForm').hidden) closeForm(false);
    render();
    updateSaveBar();
  }

  /* ---- the form -------------------------------------------------------- */

  /* ---- the sticky stack ------------------------------------------------ */

  /* Only two things want the top now: the header, and the open row beneath it.
     The unsaved bar moved to the bottom of the viewport, which removed a
     three-way contest for the same edge — and with it the need to publish a
     measured offset for the row, which is a plain constant again. */
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

  /* SCOPED TO THIS FORM, NOT THE DOCUMENT. Milestones and prayer now sit on
     one page and both label their language columns with data-col, so a
     document-wide lookup returned the prayer form's inputs as well: filling a
     milestone blanked them (their data-tx is undefined, so the lookup missed
     and wrote ''), and saving read them back under an undefined key. */
  function colFields(col) {
    var form = $('msForm');
    if (!form) return [];
    return Array.prototype.slice.call(
      form.querySelectorAll('[data-col="' + col + '"]'));
  }

  /* ---- when: picked once (board 8) ------------------------------------
     THE SAME SENTENCES AS THE WORKER. workers/src/lib/when.js writes every
     language's "When" on save; snap() and whenLabel() here are its twins, so
     the preview is the sentence that will be stored. test/milestone-dates
     runs both over the same dates and fails if they ever disagree. */
  var PRECISIONS = ['day', 'month', 'season', 'year'];
  var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  var SEASON_MONTH = { spring: 3, summer: 6, autumn: 9, winter: 12 };
  var SEASON_OF = { 3: 'spring', 6: 'summer', 9: 'autumn', 12: 'winter' };
  var INTL = {
    day: { day: 'numeric', month: 'long', year: 'numeric' },
    month: { month: 'long', year: 'numeric' },
    year: { year: 'numeric' }
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function snap(precision, iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (precision === 'day') return y + '-' + pad(mo) + '-' + pad(d);
    if (precision === 'month') return y + '-' + pad(mo) + '-01';
    if (precision === 'year') return y + '-01-01';
    if (precision === 'season') {
      if (mo < 3) return (y - 1) + '-12-01';
      return y + '-' + pad(mo >= 12 ? 12 : mo >= 9 ? 9 : mo >= 6 ? 6 : 3) + '-01';
    }
    return null;
  }

  function dateWord(lang, key, vars) {
    var en = state.dateWords.en || {};
    var table = state.dateWords[String(lang).toLowerCase()] || en;
    var s = table['dates.' + key] || en['dates.' + key] || '';
    Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
    return s;
  }
  function asDate(iso) { return new Date(iso + 'T12:00:00Z'); }
  function fmt(lang, precision) {
    return new Intl.DateTimeFormat(lang, Object.assign({ timeZone: 'UTC' }, INTL[precision]));
  }
  function oneDate(lang, precision, iso) {
    if (precision === 'season') {
      return dateWord(lang, SEASON_OF[+iso.slice(5, 7)], { year: +iso.slice(0, 4) });
    }
    return fmt(lang, precision).format(asDate(iso));
  }
  function whenLabel(lang, precision, start, end) {
    if (PRECISIONS.indexOf(precision) === -1 || !start) return null;
    if (!(end && end > start)) return oneDate(lang, precision, start);
    if (precision === 'season') {
      return dateWord(lang, 'range', { from: oneDate(lang, precision, start), to: oneDate(lang, precision, end) });
    }
    return fmt(lang, precision).formatRange(asDate(start), asDate(end));
  }

  /* A milestone from before dates were picked: a sort date that is not the
     first of a month was a real day. */
  function guessPrecision(iso) {
    return iso && iso.slice(8, 10) !== '01' ? 'day' : 'month';
  }
  function uiLang() { return (window.StaffI18n && window.StaffI18n.lang) || 'en'; }

  /* One end of the date, as the inputs its precision needs. Day is the
     browser's date picker; the others are a month or season list and a year,
     because not every browser has a month picker. */
  function drawSlot(el, precision, iso) {
    var y = iso ? +iso.slice(0, 4) : '';
    var mo = iso ? +iso.slice(5, 7) : 0;
    var year = '<input type="number" data-w="y" min="1900" max="2200" step="1" inputmode="numeric"' +
      ' aria-label="' + esc(tr('ms.prec.year')) + '" value="' + y + '">';
    if (precision === 'day') {
      el.innerHTML = '<input type="date" data-w="d" aria-label="' + esc(tr('ms.prec.day')) +
        '" value="' + esc(iso || '') + '">';
    } else if (precision === 'year') {
      el.innerHTML = year;
    } else if (precision === 'month') {
      var names = new Intl.DateTimeFormat(uiLang(), { month: 'long', timeZone: 'UTC' });
      var opts = '<option value=""></option>';
      for (var i = 1; i <= 12; i++) {
        opts += '<option value="' + i + '"' + (i === mo ? ' selected' : '') + '>' +
          esc(names.format(new Date(Date.UTC(2020, i - 1, 1)))) + '</option>';
      }
      el.innerHTML = '<select data-w="m" aria-label="' + esc(tr('ms.prec.month')) + '">' + opts + '</select>' + year;
    } else {
      el.innerHTML = '<select data-w="s" aria-label="' + esc(tr('ms.prec.season')) + '">' +
        '<option value=""></option>' + SEASONS.map(function (k) {
          return '<option value="' + k + '"' + (SEASON_OF[mo] === k ? ' selected' : '') + '>' +
            esc(tr('ms.season.' + k)) + '</option>';
        }).join('') + '</select>' + year;
    }
  }
  function readSlot(el, precision) {
    var q = function (w) { var f = el.querySelector('[data-w="' + w + '"]'); return f ? f.value : ''; };
    var y = parseInt(q('y'), 10);
    var ok = y >= 1900 && y <= 2200;
    if (precision === 'day') return snap('day', q('d'));
    if (!ok) return null;
    if (precision === 'year') return y + '-01-01';
    if (precision === 'month') return q('m') ? y + '-' + pad(+q('m')) + '-01' : null;
    return q('s') ? y + '-' + pad(SEASON_MONTH[q('s')]) + '-01' : null;
  }

  function drawWhen() {
    var w = state.when, typed = w.mode === 'custom';
    $('msForm').classList.toggle('is-typed', typed);
    /* Typed, the sentences above say when; this date only orders the list. */
    var lbl = $('msWhenLbl');
    lbl.setAttribute('data-i18n', typed ? 'ms.sortDate' : 'ms.when');
    lbl.textContent = tr(typed ? 'ms.sortDate' : 'ms.when');
    $('msPrec').hidden = typed;
    Array.prototype.forEach.call($('msPrec').querySelectorAll('[data-prec]'), function (b) {
      var on = b.dataset.prec === w.precision;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    /* Written my way, the date only orders the list: one day, no range. */
    drawSlot($('msFrom'), typed ? 'day' : w.precision, w.start);
    if (typed) $('msFrom').querySelector('input').setAttribute('aria-label', tr('ms.sortDate'));
    $('msToWord').hidden = typed;
    $('msTo').hidden = typed;
    if (!typed) drawSlot($('msTo'), w.precision, w.end);
    $('msMyWay').textContent = tr(typed ? 'ms.pickWay' : 'ms.myWay');
    drawGen();
  }
  /* The sentence each published language will show. */
  function drawGen() {
    var w = state.when, el = $('msGen');
    var show = w.mode !== 'custom' && !!w.start;
    el.hidden = !show;
    el.innerHTML = show ? enabledLangs().map(function (l) {
      return '<div><b>' + esc(l.code.toUpperCase()) + '</b>' +
        esc(whenLabel(l.code, w.precision, w.start, w.end)) + '</div>';
    }).join('') : '';
  }
  function readWhen() {
    var w = state.when;
    var typed = w.mode === 'custom';
    w.start = readSlot($('msFrom'), typed ? 'day' : w.precision);
    w.end = typed ? null : readSlot($('msTo'), w.precision);
    w.touched = true;
    drawGen();
  }

  /* ---- progress: the status follows it -------------------------------- */
  function statusNow() {
    var p = state.prog;
    if (p.canceled) return 'canceled';
    if (p.upcoming) return 'upcoming';
    return p.pct >= 100 ? 'complete' : 'in_progress';
  }
  function drawProgress() {
    var p = state.prog, st = statusNow();
    setSwitch($('msUpcoming'), p.upcoming);
    setSwitch($('msCanceled'), p.canceled);
    $('msCompletion').value = p.pct;
    $('msProgOut').textContent = st === 'upcoming' || st === 'canceled'
      ? tr(STATUS_KEY[st]) : p.pct + '% · ' + tr(STATUS_KEY[st]);
    $('msForm').classList.toggle('is-not-started', st === 'upcoming' || st === 'canceled');
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

  async function openForm(id) {
    var form = $('msForm');

    // ALREADY OPEN ON THIS ROW -> close it. Pressing Edit again to put the
    // panel away is what everyone reaches for first, and having it do nothing
    // reads as a broken button.
    if (!form.hidden && state.editing === id) { await closeForm(); return; }

    // Open on a DIFFERENT row: close where it is — keeping what was typed —
    // before moving it. Without the wait, the panel jumps to its new position
    // at full height and then animates from there.
    if (!form.hidden) await closeForm(true);

    var m = id ? state.draft[id] : null;
    state.editing = id || null;
    /* What it was when opened, so Cancel can put it back. */
    state.before = m ? clone(m) : null;

    $('msId').value = m && state.saved[id] ? id : '';
    fillColumn('a', m);
    fillColumn('b', m);

    /* What the date was saved as. NULL is a milestone from before dates were
       picked: its typed sentences stand ("my way") until somebody picks. */
    var stored = m ? (m.date_precision == null ? null : m.date_precision) : undefined;
    var typedBefore = !!m && Object.keys(m.text || {}).some(function (c) {
      return m.text[c] && m.text[c].target_label;
    });
    var picked = PRECISIONS.indexOf(stored) !== -1;
    state.when = {
      stored: stored,
      mode: picked || (stored !== 'custom' && !(stored === null && typedBefore)) ? 'picked' : 'custom',
      precision: picked ? stored : guessPrecision(m && m.actual_date),
      start: m ? (m.actual_date || null) : null,
      end: m ? (m.end_date || null) : null,
      touched: false
    };
    drawWhen();

    /* A new milestone starts Upcoming: nothing has happened yet. */
    state.prog = {
      upcoming: m ? m.status === 'upcoming' : true,
      canceled: m ? m.status === 'canceled' : false,
      pct: m ? (Number(m.completion) || 0) : 0,
      touched: false
    };
    drawProgress();

    setSwitch($('msFeatured'), m ? !!m.is_featured : false);
    $('msDelete').hidden = !m;

    fillParents();
    $('msParent').value = m && m.parent_id ? m.parent_id : '';

    setStatus($('msFormStatus'), '');

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

  /* Closing KEEPS what was typed (option B: "closing the editor keeps your
     change in the list, marked") — except Cancel, which puts back what it was
     when opened. */
  async function closeForm(keep) {
    var form = $('msForm');
    if (form.hidden) return;
    if (keep) applyForm();
    else if (state.editing && state.before) state.draft[state.editing] = state.before;
    await closePanel(form);
    state.editing = null;
    state.before = null;
    markOpenRow();
    render();
    updateSaveBar();
  }

  function submitForm(e) {
    e.preventDefault();
    closeForm(true);
  }

  /* The form into the WORKING COPY. Nothing reaches the database until the
     Updates bar publishes. A new milestone with no title in any language is
     not added — there would be nothing to show for it. */
  function applyForm() {

    /* A column comes back exactly as it went in unless something was typed:
       an empty box over a missing value stays missing, and a language nobody
       wrote in is not added. Otherwise opening a milestone and closing it
       would mark it changed. */
    var before = (state.editing && state.draft[state.editing] && state.draft[state.editing].text) || {};
    var text = {};
    [['a', state.colA], ['b', state.colB]].forEach(function (c) {
      var code = c[1];
      if (!code || text[code]) return;
      var had = before[code], read = readColumn(c[0]), out = {}, any = false;
      Object.keys(read).forEach(function (k) {
        var v = read[k];
        if (v === '' && (!had || had[k] == null)) v = had ? had[k] : null;
        if (v) any = true;
        out[k] = v;
      });
      if (had || any) text[code] = had ? Object.assign({}, had, out) : out;
    });

    var id = state.editing || $('msId').value;
    var isNew = !id;
    var titled = Object.keys(text).some(function (c) { return String(text[c].title || '').trim(); });
    if (isNew && !titled) return;
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

    /* The date and status change only when their controls were touched, so
       opening an older milestone and closing it changes nothing. */
    var w = state.when, p = state.prog;
    var dates = {};
    if (w.touched || isNew) {
      var typed = w.mode === 'custom';
      dates.date_precision = typed ? (w.stored === null ? null : 'custom') : w.precision;
      dates.actual_date = w.start || null;
      dates.end_date = typed ? null : (w.end && w.end > w.start ? w.end : null);
      /* Picked: every language's sentence is written from the date, here for
         the list and again by the server when it is published. */
      if (!typed) {
        Object.keys(merged).forEach(function (c) {
          if (merged[c] && merged[c].title) {
            merged[c] = Object.assign({}, merged[c],
              { target_label: whenLabel(c, w.precision, dates.actual_date, dates.end_date) });
          }
        });
      }
    }
    var progress = {};
    if (p.touched || isNew) {
      progress.status = statusNow();
      progress.completion = p.pct;
    }

    state.draft[id] = Object.assign({}, existing, dates, progress, {
      id: isNew ? undefined : id,
      text: merged,
      parent_id: $('msParent').value || null,
      is_public: isNew ? false : !!existing.is_public,
      is_featured: isOn($('msFeatured'))
    });
    /* A brand-new milestone keeps its local id as the key, so the editor and
       the row agree on which one this is until the server issues a real id.
       Only a new one: on a saved one it would be a field the server never
       sent, and the row would read as changed after merely being opened. */
    if (isNew) { state.draft[id].localId = id; state.editing = id; }
  }

  /* A delete waits for Publish like everything else — marked, undoable with
     Keep or Discard — and the bar asks before any is published. A milestone
     that was never saved exists only here, so it simply goes. */
  async function remove(id) {
    var m = state.draft[id];
    if (!m) return;
    if (!state.saved[id]) {
      delete state.draft[id];
      state.order = state.order.filter(function (x) { return x !== id; });
    } else {
      state.removed[id] = true;
    }
    state.before = null;
    var form = $('msForm');
    if (!form.hidden) { await closePanel(form); state.editing = null; markOpenRow(); }
    render();
    updateSaveBar();
  }

  /* ---- boot ------------------------------------------------------------ */

  /* GUARDED ON THE LIST, NOT ON THE PAGE NAME. This used to read
     data-staff-page !== 'milestones', and renaming the page to "ministry"
     silently disabled the whole editor — every handler below went unwired and
     load() never ran, so the list sat on "Loading…" forever with nothing in
     the console to say why. The element this script needs is the honest
     condition; a page can be renamed or merged into another without it
     becoming a no-op again. */
  if (!document.getElementById('msList')) return;

  wireLocalSwitch($('msFeatured'));

  /* When: the precision, the dates, and the switch to typing it. */
  $('msPrec').addEventListener('click', function (e) {
    var b = e.target.closest('[data-prec]');
    if (!b) return;
    var w = state.when;
    w.precision = b.dataset.prec;
    w.start = snap(w.precision, w.start);
    w.end = snap(w.precision, w.end);
    w.touched = true;
    drawWhen();
  });
  ['msFrom', 'msTo'].forEach(function (id) {
    $(id).addEventListener('input', readWhen);
    $(id).addEventListener('change', readWhen);
  });
  $('msMyWay').addEventListener('click', function () {
    var w = state.when;
    if (w.mode === 'custom') {
      w.mode = 'picked';
      w.precision = guessPrecision(w.start);
    } else {
      /* Start typing from the sentence the date already makes. */
      [['a', state.colA], ['b', state.colB]].forEach(function (c) {
        var f = $('msForm').querySelector('[data-tx="target_label"][data-col="' + c[0] + '"]');
        if (f && !f.value && c[1] && w.start) f.value = whenLabel(c[1], w.precision, w.start, w.end) || '';
      });
      w.mode = 'custom';
      w.end = null;
    }
    w.touched = true;
    drawWhen();
  });

  /* Progress and the two decisions beside it. Canceling ends Upcoming, and
     the other way round: a milestone is one or the other. */
  $('msCompletion').addEventListener('input', function () {
    state.prog.pct = Number(this.value) || 0;
    state.prog.touched = true;
    drawProgress();
  });
  $('msUpcoming').addEventListener('click', function () {
    var p = state.prog;
    p.upcoming = !p.upcoming;
    if (p.upcoming) p.canceled = false;
    p.touched = true;
    drawProgress();
  });
  $('msCanceled').addEventListener('click', function () {
    var p = state.prog;
    p.canceled = !p.canceled;
    if (p.canceled) p.upcoming = false;
    p.touched = true;
    drawProgress();
  });

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
  $('msCancel').addEventListener('click', function () { closeForm(false); });
  $('msDelete').addEventListener('click', function () { if (state.editing) remove(state.editing); });
  $('msForm').addEventListener('submit', submitForm);

  // Delegated: the list re-renders after every change.
  $('msList').addEventListener('click', function (e) {
    if (e.target.closest('.ms-form')) return;
    var btn = e.target.closest('button');
    if (btn) {
      if (btn.dataset.pub !== undefined) return togglePublished(btn, btn.dataset.pub);
      if (btn.dataset.keep !== undefined) {
        delete state.removed[btn.dataset.keep];
        render(); updateSaveBar();
      }
      return;
    }
    // THE WHOLE ROW OPENS IT (board 7) — no Edit button to find. A row marked
    // for removal opens nothing; Keep is what it offers.
    var row = e.target.closest('.ms-row');
    if (row && !state.removed[row.dataset.id]) openForm(row.dataset.id);
  });

  // Keyboard parity: the row is focusable and announces itself as a button.
  $('msList').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button') || e.target.closest('.ms-form')) return;
    var row = e.target.closest('.ms-row');
    if (row) { e.preventDefault(); openForm(row.dataset.id); }
  });

  if (window.StaffUpdates) {
    window.StaffUpdates.register({
      key: 'milestones',
      count: function () { return dirtyIds().length; },
      removals: function () { return Object.keys(state.removed).length; },
      publish: publish,
      discard: discard
    });
  }

  updateStickyOffsets();
  window.addEventListener('resize', updateStickyOffsets);

  load();
})();
