/* ============================================================
   staff-stewardship.js — one supporter's record, opened from their row
   ============================================================
   REPLACES A DRAWER. The row used to expand into a read-only timeline
   underneath itself, which was right while there was nothing to do but read.
   There is now: contact details, life events to write, a call to log. On a
   list sorted worst-first the person you want is near the top, and the drawer
   pushed the rest of the page down while you worked in it.

   WHERE THE DATA COMES FROM, AND WHY IT IS NOT THE SNAPSHOT. The list is
   rendered from /api/staff-snapshot, whose query deliberately carries no
   email and no phone. This dialog asks /api/staff-stewardship for ONE person
   by id — the only endpoint that returns a supporter's contact details, and
   the only one whose GET is written to the audit log. Opening a dialog costs
   one person's details; nothing costs the whole list.

   ONE SOURCE FOR WHAT IS ON SCREEN. Every write returns the person's whole
   refreshed record, and the dialog re-renders from that rather than patching
   what it already had. A dialog that edits its own copy is how two versions
   of somebody's history start to disagree.

   AND THE ROW BEHIND IT IS REFRESHED TOO. Logging a call changes what the
   table says — that is the entire point of logging it — so a successful
   write reloads the snapshot underneath. Without that the page would go on
   saying somebody had not been called for 140 days immediately after you
   recorded calling them, which is the exact failure this console has made
   before in other places.
   ============================================================ */
(function () {
  'use strict';

  /* The dialog, not the page name — a page without it is a page this script
     has nothing to do on. */
  if (!document.getElementById('swBack')) return;

  var API = '/api/staff-stewardship';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    contactId: null,   // whose record is open
    person: null,
    events: [],
    timeline: [],
    openedFrom: null,  // the row to give focus back to
    tab: 'facts',
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(key, vars);
    var s = tr(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function setStatus(text, isError) {
    var el = $('swStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'hint' + (isError ? ' err' : '');
  }

  /* Dates are stored as YYYY-MM-DD and read by people. Rendered through the
     console's own language rather than the browser's, so a Croatian staff
     member does not get a date in English inside a translated dialog. */
  function shortDate(d) {
    if (!d) return tr('stew.noDate');
    var parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    var dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    if (isNaN(dt.getTime())) return String(d);
    /* A getter, not a method — see the bottom of staff-i18n.js. Calling it
       threw, which took the whole dialog down on its first date. */
    var lang = (window.StaffI18n && window.StaffI18n.lang) || 'en';
    try {
      return dt.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    } catch (e) {
      return String(d).slice(0, 10);
    }
  }

  function fullName(p) {
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || tr('stew.unnamed');
  }

  /* --------------------------------------------------------------- fetch -- */

  function call(opts) {
    setStatus(tr('common.saving'));
    return fetch(opts.url, {
      method: opts.method || 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; })
        .then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    }).then(function (res) {
      if (!res.ok) {
        /* The server's sentence, not a generic one. Every refusal in
           staff-stewardship.js is written to be read by the person who hit
           it, and replacing that with "Something went wrong" would throw away
           the only useful part. */
        var msg = (res.body && res.body.error) || fill('stew.failed', { status: res.status });
        setStatus(msg, true);
        return null;
      }
      setStatus('');
      return res.body;
    }).catch(function (err) {
      setStatus(err.message || tr('stew.offline'), true);
      return null;
    });
  }

  /** Adopt a whole record returned by the endpoint and redraw everything. */
  function adopt(body) {
    if (!body || !body.person) return;
    state.person = body.person;
    state.events = body.events || [];
    state.timeline = body.timeline || [];
    render();
  }

  /* THE SEAM. What the table says about this person just changed, so the
     table is reloaded rather than left showing the figure the write
     invalidated. staff.js owns the snapshot; it exposes this for exactly
     this purpose. */
  function refreshRowsBehind() {
    if (window.StaffSnapshotReload) window.StaffSnapshotReload();
  }

  /* -------------------------------------------------------------- render -- */

  function renderFacts() {
    var p = state.person;
    if (!p) return;

    var rows = [];
    function add(label, valueHTML) {
      if (!valueHTML) return;
      rows.push('<dt>' + esc(label) + '</dt><dd>' + valueHTML + '</dd>');
    }

    if (p.email) {
      add(tr('stew.email'), '<a class="lnk" href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>');
    }
    if (p.phone) {
      add(tr('stew.phone'),
        '<a class="lnk" href="tel:' + esc(String(p.phone).replace(/[^0-9+]/g, '')) + '">' + esc(p.phone) + '</a>');
    }

    var postal = [p.address_1, p.address_2, [p.postal_code, p.city].filter(Boolean).join(' '),
                  p.region, p.country].filter(Boolean);
    if (postal.length) {
      add(tr('stew.address'), postal.map(esc).join('<br>'));
    }

    /* CONSENT IS PER-PURPOSE and the source is shown with it, because "is she
       on the list" and "how did she get on the list" are different questions
       and the second one is the evidence. */
    var consent = '<span class="chips">' +
      '<span class="chip' + (p.newsletter_consent ? ' on' : '') + '">' + esc(tr('stew.emailConsent')) + '</span>' +
      '<span class="chip' + (p.postal_consent ? ' on' : '') + '">' + esc(tr('stew.postConsent')) + '</span>' +
      '</span>';
    if (p.newsletter_consent && (p.newsletter_consent_source || p.newsletter_consent_at)) {
      consent += '<span class="sub">' + esc(fill('stew.consentVia', {
        how: p.newsletter_consent_source || tr('stew.consentUnknown'),
        when: shortDate(p.newsletter_consent_at),
      })) + '</span>';
    }
    add(tr('stew.consent'), consent);

    add(tr('stew.lastPersonal'), esc(shortDate(p.last_personal_contact)));
    add(tr('stew.lastAny'), esc(shortDate(p.last_contact_any)));
    add(tr('stew.touches'), esc(fill('stew.touchCount', {
      personal: p.personal_count || 0, total: p.interaction_count || 0,
    })));
    add(tr('stew.since'), esc(shortDate(p.created_at)));

    /* An identifier into the giving platform, never a figure — there is no
       amount in this database and db/README.md says why. Shown as a plain
       reference so somebody can find the record over there. */
    if (p.giving_ref) add(tr('stew.givingRef'), '<code>' + esc(p.giving_ref) + '</code>');

    if (p.notes) {
      add(tr('stew.notes'), '<span class="sw-notes">' + esc(p.notes) + '</span>');
    }

    $('swFacts').innerHTML = rows.join('');
  }

  function renderEvents() {
    var host = $('swEvents');
    if (!host) return;

    if (!state.events.length) {
      host.innerHTML = '<p class="empty">' + esc(tr('stew.noEvents')) + '</p>';
      return;
    }

    host.innerHTML = '<ul class="sw-events">' + state.events.map(function (e) {
      return '<li class="sw-ev" data-ev="' + esc(e.id) + '">' +
        '<div class="sw-ev-h">' +
          '<span class="sw-ev-k">' + esc(tr('stew.kind.' + e.kind)) + '</span>' +
          '<span class="sw-ev-d">' + esc(shortDate(e.occurred_on)) +
            (e.recurs ? '<span class="ev-tag">' + esc(tr('stew.everyYear')) + '</span>' : '') +
          '</span>' +
        '</div>' +
        (e.note ? '<p class="sw-ev-n">' + esc(e.note) + '</p>' : '') +
        '<div class="sw-ev-a">' +
          (e.logged_by_name ? '<span class="sub">' + esc(fill('stew.loggedBy', { who: e.logged_by_name })) + '</span>' : '<span></span>') +
          '<span class="row-actions">' +
            '<button type="button" class="ghost-btn sm" data-edit-ev="' + esc(e.id) + '">' + esc(tr('common.edit')) + '</button>' +
            '<button type="button" class="ghost-btn sm del" data-del-ev="' + esc(e.id) + '">' + esc(tr('common.delete')) + '</button>' +
          '</span>' +
        '</div>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function renderTimeline() {
    var host = $('swTimeline');
    if (!host) return;

    if (!state.timeline.length) {
      host.innerHTML = '<p class="empty">' + esc(tr('stew.noTouches')) + '</p>';
      return;
    }

    host.innerHTML = '<div class="tl">' + state.timeline.map(function (i) {
      return '<div class="ev ' + (i.is_personal ? 'personal' : 'bulk') + '">' +
        '<span class="ev-d">' + esc(shortDate(i.occurred_on)) + '</span>' +
        '<span class="ev-m"><i></i></span>' +
        '<span><span class="ev-t">' + esc(tr('stew.type.' + i.type)) +
          (i.is_personal ? '' : '<span class="ev-tag">' + esc(tr('stew.bulk')) + '</span>') +
          (i.logged_by_name ? '<span class="ev-tag">' + esc(i.logged_by_name) + '</span>' : '') +
        '</span>' +
        (i.note ? '<span class="ev-n">' + esc(i.note) + '</span>' : '') +
        '</span></div>';
    }).join('') + '</div>';
  }

  function render() {
    var p = state.person;
    if (!p) return;
    $('swName').textContent = fullName(p);
    $('swWhere').textContent = [p.city, p.country].filter(Boolean).join(', ');
    renderFacts();
    renderEvents();
    renderTimeline();
  }

  /* ---------------------------------------------------------------- tabs -- */

  function showTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll('#swBack .tab'), function (b) {
      b.setAttribute('aria-selected', b.dataset.swtab === name ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#swBack .tab-panel'), function (s) {
      s.hidden = s.dataset.swpanel !== name;
    });
  }

  /* ------------------------------------------------------ open and close -- */

  function open(contactId, fromEl) {
    state.contactId = contactId;
    state.openedFrom = fromEl || null;
    state.person = null;
    state.events = [];
    state.timeline = [];

    /* Cleared before the fetch, so a dialog opened on a second person never
       shows the first one's details for the moment the request is in flight.
       That is a privacy bug, not a cosmetic one. */
    $('swName').textContent = tr('common.loading');
    $('swWhere').textContent = '';
    $('swFacts').innerHTML = '';
    $('swEvents').innerHTML = '';
    $('swTimeline').innerHTML = '';
    hideForms();
    showTab('facts');
    setStatus('');

    var back = $('swBack');
    back.hidden = false;
    void back.offsetHeight;
    back.classList.add('in');

    var firstTab = back.querySelector('.tab');
    if (firstTab) firstTab.focus();

    call({ url: API + '?contact=' + encodeURIComponent(contactId) }).then(function (body) {
      /* Somebody may have closed it, or opened somebody else, while this was
         in flight. Answering into a dialog showing a different person is the
         same bug as not clearing it. */
      if (!body || state.contactId !== contactId) return;
      adopt(body);
    });
  }

  function close() {
    var back = $('swBack');
    if (!back || back.hidden) return;
    back.hidden = true;
    back.classList.remove('in');
    hideForms();

    var row = state.openedFrom;
    state.contactId = null;
    state.openedFrom = null;
    /* Back to the row it came from, so keyboard focus does not fall to the
       top of the document after every close. */
    if (row && document.contains(row)) row.focus();
  }

  function hideForms() {
    var ef = $('swEventForm'), tf = $('swTouchForm');
    if (ef) { ef.hidden = true; ef.reset(); $('swEventId').value = ''; }
    if (tf) { tf.hidden = true; tf.reset(); }
  }

  /* --------------------------------------------------------------- forms -- */

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function openEventForm(ev) {
    var f = $('swEventForm');
    $('swEventId').value = ev ? ev.id : '';
    $('swEventKind').value = ev ? ev.kind : 'birth';
    $('swEventDate').value = ev && ev.occurred_on ? String(ev.occurred_on).slice(0, 10) : '';
    $('swEventNote').value = ev && ev.note ? ev.note : '';
    $('swEventRecurs').checked = !!(ev && ev.recurs);
    f.hidden = false;
    $('swEventKind').focus();
  }

  function openTouchForm() {
    var f = $('swTouchForm');
    f.reset();
    /* Defaults to today, because the overwhelming case is logging something
       that just happened. Backdating stays one keystroke away. */
    $('swTouchDate').value = today();
    $('swTouchPersonal').checked = true;
    f.hidden = false;
    $('swTouchType').focus();
  }

  /* ---------------------------------------------------------------- wire -- */

  function wire() {
    var back = $('swBack');

    /* The backdrop closes; the dialog itself does not. Without the target
       test, every click inside the panel would close it. */
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    $('swClose').addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) { e.preventDefault(); close(); }
    });

    back.addEventListener('click', function (e) {
      var t = e.target.closest('.tab');
      if (t && t.dataset.swtab) showTab(t.dataset.swtab);
    });

    /* ------ life events ------ */
    $('swAddEvent').addEventListener('click', function () { openEventForm(null); });
    $('swEventCancel').addEventListener('click', function () { $('swEventForm').hidden = true; });

    $('swEvents').addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit-ev]');
      if (edit) {
        var ev = state.events.filter(function (x) { return x.id === edit.dataset.editEv; })[0];
        if (ev) openEventForm(ev);
        return;
      }
      var del = e.target.closest('[data-del-ev]');
      if (del) removeEvent(del.dataset.delEv);
    });

    $('swEventForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = {
        contact_id: state.contactId,
        event: {
          id: $('swEventId').value || undefined,
          kind: $('swEventKind').value,
          occurred_on: $('swEventDate').value || null,
          note: $('swEventNote').value,
          recurs: $('swEventRecurs').checked,
        },
      };
      call({ url: API, method: 'POST', body: payload }).then(function (body) {
        if (!body) return;
        hideForms();
        adopt(body);
        toast(tr(body.created ? 'stew.evAdded' : 'stew.evSaved'), 'ok');
      });
    });

    /* ------ logging a contact ------ */
    $('swAddTouch').addEventListener('click', openTouchForm);
    $('swTouchCancel').addEventListener('click', function () { $('swTouchForm').hidden = true; });

    $('swTouchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = {
        contact_id: state.contactId,
        interaction: {
          type: $('swTouchType').value,
          occurred_on: $('swTouchDate').value,
          note: $('swTouchNote').value,
          is_personal: $('swTouchPersonal').checked,
          /* Derived from the type rather than asked for. Nobody thinks of a
             visit as having a "channel", and the three values exist to
             describe the touch rather than to be chosen. */
          channel: channelFor($('swTouchType').value),
        },
      };
      call({ url: API, method: 'POST', body: payload }).then(function (body) {
        if (!body) return;
        hideForms();
        adopt(body);
        refreshRowsBehind();
        toast(tr('stew.tcLogged'), 'ok');
      });
    });
  }

  /* in_person for the ones you have to be there for, physical for the ones
     that arrive by post, digital for the rest. */
  function channelFor(type) {
    if (type === 'visit' || type === 'meal' || type === 'event') return 'in_person';
    if (type === 'handwritten' || type === 'postal_mail') return 'physical';
    return 'digital';
  }

  function removeEvent(id) {
    var ev = state.events.filter(function (x) { return x.id === id; })[0];
    var ask = window.StaffConfirm
      ? window.StaffConfirm({
          title: tr('stew.evDeleteTitle'),
          body: fill('stew.evDeleteBody', { kind: tr('stew.kind.' + (ev ? ev.kind : 'other')) }),
          confirm: tr('common.delete'),
          cancel: tr('common.cancel'),
          danger: true,
        })
      : Promise.resolve(window.confirm(tr('stew.evDeleteTitle')));

    ask.then(function (yes) {
      if (!yes) return;
      call({
        url: API + '?event=' + encodeURIComponent(id) +
             '&contact=' + encodeURIComponent(state.contactId),
        method: 'DELETE',
      }).then(function (body) {
        if (!body) return;
        adopt(body);
        toast(tr('stew.evDeleted'), 'ok');
      });
    });
  }

  wire();

  /* The row handler in staff.js calls this. Exposed rather than wired here
     because the rows are rebuilt on every snapshot load, so the listener has
     to live with whatever rebuilds them. */
  window.StaffSupporterDialog = { open: open, close: close };
})();
