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

   CONTACTS AND NOTES IN ONE PLACE. Chase's description of the page. So a
   person can be added, edited and removed from here, and everything written
   about them — life events and logged contacts alike — can be corrected by
   whoever wrote it. Newsletter entries are the one exception: they record
   what the mailing run sent, and have no edit button.

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
    isNew: false,      // adding somebody: no record yet, only the form
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

  /* COUNTRIES, AS CODES. The column holds ISO 3166-1 alpha-2 and the server
     refuses anything else, so the form offers a list rather than a box that
     asks somebody to remember that Croatia is HR. The names come from the
     browser (Intl.DisplayNames) in the console's own language, which is why
     only the codes live here: 250 names in three languages would be a second
     dictionary that nobody keeps up to date. XK (Kosovo) is user-assigned
     rather than official, and included because it is in this ministry's
     region. */
  var COUNTRIES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI ' +
      'BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN ' +
      'CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK ' +
      'FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM ' +
      'HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
      'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ' +
      'ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP ' +
      'NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
      'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF ' +
      'TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
      'VN VU WF WS XK YE YT ZA ZM ZW').trim().split(' ');

  function countryName(code) {
    if (!code) return '';
    try {
      var lang = (window.StaffI18n && window.StaffI18n.lang) || 'en';
      return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  /* Rebuilt each time the form opens, so it follows a language switch. A
     value already saved that is not in the list still appears — dropping it
     would clear it on the next save without anybody choosing that. */
  function fillCountries(current) {
    var codes = COUNTRIES.slice();
    if (current && codes.indexOf(current) === -1) codes.push(current);
    var named = codes.map(function (c) { return { code: c, name: countryName(c) }; });
    var lang = (window.StaffI18n && window.StaffI18n.lang) || 'en';
    named.sort(function (a, b) { return a.name.localeCompare(b.name, lang); });
    $('swPCountry').innerHTML = '<option value=""></option>' + named.map(function (c) {
      return '<option value="' + esc(c.code) + '">' + esc(c.name) + '</option>';
    }).join('');
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
                  p.region, countryName(p.country)].filter(Boolean);
    if (postal.length) {
      add(tr('stew.address'), postal.map(esc).join('<br>'));
    }

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
        /* Only rows a person wrote. A newsletter entry records what was sent,
           and the server refuses to change it — so it is not offered. */
        (i.source === 'manual'
          ? '<span class="row-actions sw-tl-a">' +
              '<button type="button" class="ghost-btn sm" data-edit-tc="' + esc(i.id) + '">' + esc(tr('common.edit')) + '</button>' +
              '<button type="button" class="ghost-btn sm del" data-del-tc="' + esc(i.id) + '">' + esc(tr('common.delete')) + '</button>' +
            '</span>'
          : '') +
        '</span></div>';
    }).join('') + '</div>';
  }

  /* Adding somebody has no record yet, so no life events and no history to
     show — only the form. The tabs come back with the first save. */
  function setNewMode(on) {
    state.isNew = on;
    var tabs = document.querySelector('#swBack .tabs');
    if (tabs) tabs.hidden = on;
    $('swFacts').hidden = on;
    $('swFactActions').hidden = on;
  }

  function render() {
    var p = state.person;
    if (!p) return;
    setNewMode(false);
    $('swName').textContent = fullName(p);
    $('swWhere').textContent = [p.city, countryName(p.country)].filter(Boolean).join(', ');
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
    setNewMode(false);
    showTab('facts');
    setStatus('');
    show();

    var firstTab = $('swBack').querySelector('.tab');
    if (firstTab) firstTab.focus();

    call({ url: API + '?contact=' + encodeURIComponent(contactId) }).then(function (body) {
      /* Somebody may have closed it, or opened somebody else, while this was
         in flight. Answering into a dialog showing a different person is the
         same bug as not clearing it. */
      if (!body || state.contactId !== contactId) return;
      adopt(body);
    });
  }

  function show() {
    var back = $('swBack');
    back.hidden = false;
    void back.offsetHeight;
    back.classList.add('in');
  }

  /** A new person: an empty record and the details form, nothing else. */
  function openNew(fromEl) {
    state.contactId = null;
    state.openedFrom = fromEl || null;
    state.person = null;
    state.events = [];
    state.timeline = [];
    $('swName').textContent = tr('stew.newPerson');
    $('swWhere').textContent = '';
    $('swFacts').innerHTML = '';
    hideForms();
    showTab('facts');
    setNewMode(true);
    setStatus('');
    show();
    openPersonForm(null);
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
    var ef = $('swEventForm'), tf = $('swTouchForm'), pf = $('swPersonForm');
    if (ef) { ef.hidden = true; ef.reset(); $('swEventId').value = ''; }
    if (tf) { tf.hidden = true; tf.reset(); $('swTouchId').value = ''; }
    if (pf) { pf.hidden = true; pf.reset(); $('swPersonId').value = ''; }
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

  /* One form for logging and for correcting; `i` is the entry being
     corrected, or nothing for a new one. */
  function openTouchForm(i) {
    var f = $('swTouchForm');
    f.reset();
    $('swTouchId').value = i ? i.id : '';
    $('swTouchType').value = i ? i.type : 'call';
    /* A new one defaults to today, because the overwhelming case is logging
       something that just happened. Backdating stays one keystroke away. */
    $('swTouchDate').value = i ? String(i.occurred_on).slice(0, 10) : today();
    $('swTouchNote').value = i && i.note ? i.note : '';
    $('swTouchPersonal').checked = i ? !!i.is_personal : true;
    f.hidden = false;
    $('swTouchType').focus();
  }

  var PERSON_FIELDS = {
    first_name: 'swPFirst', last_name: 'swPLast', email: 'swPEmail',
    phone: 'swPPhone', address_1: 'swPAddr1', address_2: 'swPAddr2',
    city: 'swPCity', region: 'swPRegion', postal_code: 'swPPostal',
    country: 'swPCountry', notes: 'swPNotes',
  };

  function openPersonForm(p) {
    var f = $('swPersonForm');
    f.reset();
    $('swPersonId').value = p ? p.id : '';
    fillCountries(p && p.country);
    Object.keys(PERSON_FIELDS).forEach(function (k) {
      $(PERSON_FIELDS[k]).value = p && p[k] ? p[k] : '';
    });
    f.hidden = false;
    $('swFactActions').hidden = true;
    $('swPFirst').focus();
  }

  function closePersonForm() {
    $('swPersonForm').hidden = true;
    /* Canceling a NEW person leaves nothing to look at — close the dialog
       rather than show an empty record. */
    if (state.isNew) { close(); return; }
    $('swFactActions').hidden = false;
  }

  function removePerson() {
    var p = state.person;
    if (!p) return;
    window.StaffConfirm({
      title: fill('stew.pDeleteTitle', { name: fullName(p) }),
      body: tr('stew.pDeleteBody'),
      confirm: tr('common.delete'),
      cancel: tr('common.cancel'),
      danger: true,
      /* The same word the server checks. A dialog is a suggestion; the
         request carries confirm=DELETE or it is refused. */
      type: 'DELETE',
    }).then(function (yes) {
      if (!yes) return;
      var id = state.contactId;
      call({
        url: API + '?contact=' + encodeURIComponent(id) + '&confirm=DELETE',
        method: 'DELETE',
      }).then(function (body) {
        if (!body) return;
        state.openedFrom = null;  // that row is about to stop existing
        close();
        refreshRowsBehind();
        toast(tr('stew.pDeleted'), 'ok');
      });
    });
  }

  function removeTouch(id) {
    window.StaffConfirm({
      title: tr('stew.tcDeleteTitle'),
      body: tr('stew.tcDeleteBody'),
      confirm: tr('common.delete'),
      cancel: tr('common.cancel'),
      danger: true,
    }).then(function (yes) {
      if (!yes) return;
      call({
        url: API + '?contact=' + encodeURIComponent(state.contactId) +
             '&interaction=' + encodeURIComponent(id),
        method: 'DELETE',
      }).then(function (body) {
        if (!body) return;
        adopt(body);
        refreshRowsBehind();
        toast(tr('stew.tcDeleted'), 'ok');
      });
    });
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

    /* ------ the person ------ */
    $('swAddPerson').addEventListener('click', function (e) { openNew(e.currentTarget); });
    $('swEditPerson').addEventListener('click', function () { openPersonForm(state.person); });
    $('swDeletePerson').addEventListener('click', removePerson);
    $('swPersonCancel').addEventListener('click', closePersonForm);

    $('swPersonForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var person = { id: $('swPersonId').value || undefined };
      Object.keys(PERSON_FIELDS).forEach(function (k) {
        person[k] = $(PERSON_FIELDS[k]).value;
      });
      call({ url: API, method: 'POST', body: { person: person } }).then(function (body) {
        if (!body) return;
        /* A new person has an id now; from here on this dialog is theirs. */
        state.contactId = body.id || state.contactId;
        hideForms();
        adopt(body);
        refreshRowsBehind();
        toast(tr(body.created ? 'stew.pAdded' : 'stew.pSaved'), 'ok');
      });
    });

    /* ------ logging and correcting contacts ------ */
    $('swAddTouch').addEventListener('click', function () { openTouchForm(null); });
    $('swTimeline').addEventListener('click', function (e) {
      var edit = e.target.closest('[data-edit-tc]');
      if (edit) {
        var i = state.timeline.filter(function (x) { return x.id === edit.dataset.editTc; })[0];
        if (i) openTouchForm(i);
        return;
      }
      var del = e.target.closest('[data-del-tc]');
      if (del) removeTouch(del.dataset.delTc);
    });
    $('swTouchCancel').addEventListener('click', function () { $('swTouchForm').hidden = true; });

    $('swTouchForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = {
        contact_id: state.contactId,
        interaction: {
          id: $('swTouchId').value || undefined,
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
        toast(tr(body.logged ? 'stew.tcLogged' : 'stew.tcSaved'), 'ok');
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
  window.StaffSupporterDialog = { open: open, openNew: openNew, close: close };
})();
