/* ============================================================
   staff-mailing.js — a partner's mailing lists
   ============================================================
   ONE TAB PER LIST. The first version was a column of lists, each opening into
   a form, with the sign-up snippet buried inside it. That is the shape of the
   milestone editor, and it was the wrong shape here: a milestone is a small
   thing in a long list, but a mailing list is a place you WORK — it has people,
   settings, a form, and eventually a composer. Tabs put the one being worked on
   on screen and the rest out of the way.

   TWO VIEWS INSIDE A LIST, because subscribers and settings are different jobs
   on different days. Adding somebody should not mean scrolling past the sender
   address, and changing the sender should not mean scrolling past four hundred
   people.

   THE TOOLS ARE NOT LISTS. Sign-up forms and Composer sit at the far end with a
   gap before them: a tab bar that mixes "a thing" with "a thing you do to all
   the things" teaches people to read every tab before clicking.
   ============================================================ */
(function () {
  'use strict';

  /* The element it needs, not the page name — see staff-milestones.js. */
  if (!document.getElementById('mlTabs')) return;

  var API = '/api/staff-mailing';
  var SETTINGS = '/api/staff-settings';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#6D4AFF';

  /* The second colour, derived the way every widget derives it: a -33 degree
     hue rotation, the distance between cyan and green on chaseroush.com. Here
     it is only needed to SHOW the pair in the two swatches — the widget does
     its own, from the same maths, so nothing depends on these agreeing to the
     last digit. Grey has no hue to rotate and separates by lightness instead,
     or a partner choosing grey would see one colour twice. */
  function companion(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    var l = (mx + mn) / 2, d = mx - mn;
    var sat = d === 0 ? 0 : (l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn));
    var h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    if (sat < 0.12) {
      l = l > 0.5 ? Math.max(0.28, l - 0.3) : Math.min(0.82, l + 0.3);
    } else {
      h -= 33; sat = Math.min(1, sat * 1.05); l = Math.min(0.72, l * 1.04);
    }
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * sat;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1)), mm = l - c / 2;
    var rr = 0, gg = 0, bb = 0;
    if (h < 60) { rr = c; gg = x; }
    else if (h < 120) { rr = x; gg = c; }
    else if (h < 180) { gg = c; bb = x; }
    else if (h < 240) { gg = x; bb = c; }
    else if (h < 300) { rr = x; bb = c; }
    else { rr = c; bb = x; }
    function to(v) { var q = Math.round((v + mm) * 255).toString(16); return q.length < 2 ? '0' + q : q; }
    return '#' + to(rr) + to(gg) + to(bb);
  }
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    lists: [], tags: [], senders: [], contact: null, topics: [],
    subsQ: '', subsStatus: '', subsSort: '', subsTag: '', subsPage: 0,
    subsTotal: 0, subsPageSize: 100,
    scope: 'partner', partnerSlug: '',
    embed: null, mayTheme: false,
    view: null,        // a list id, or 'embed' / 'composer'
    sub: 'people',     // which half of a list view
    subscribers: [],
  };

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

  function listById(id) {
    return state.lists.filter(function (l) { return l.id === id; })[0] || null;
  }
  function currentList() {
    /* TOOLS rather than a hand-written pair. This listed 'embed' and
       'composer' by name, so the contact tab — added later — was briefly
       treated as a list id, and looking one up by it returned nothing at all
       by luck rather than by design. */
    return TOOLS.indexOf(state.view) >= 0 ? null : listById(state.view);
  }

  /* ---- the tab bar ----------------------------------------------------- */

  function renderTabs() {
    $('mlTabs').innerHTML = state.lists.map(function (l) {
      var on = state.view === l.id;
      return '<button type="button" class="ml-tab' + (on ? ' is-on' : '') + '"' +
        ' role="tab" aria-selected="' + (on ? 'true' : 'false') + '"' +
        ' data-view="' + esc(l.id) + '">' +
        esc(l.name) +
        /* THE NUMBER IS CONFIRMED SUBSCRIBERS. A total would let a list of
           forty unconfirmed addresses read as forty people. */
        '<span class="ml-tab-count">' + (l.subscribed || 0) + '</span>' +
      '</button>';
    }).join('');

    Array.prototype.forEach.call(document.querySelectorAll('.ml-tab-tool'), function (b) {
      var on = state.view === b.dataset.view;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    $('mlNoLists').hidden = state.lists.length > 0 ||
                            state.view === 'embed' || state.view === 'composer';
  }

  /* The tool tabs — the views that are not a list. Kept as one list so a new
     one cannot be added to the tab bar and forgotten here, which is what
     leaves a tab that highlights and shows nothing. */
  var TOOLS = ['embed', 'composer', 'contact'];

  function show(view) {
    state.view = view;
    var isTool = TOOLS.indexOf(view) >= 0;
    $('mlListView').hidden = isTool || !listById(view);
    $('mlEmbedView').hidden = view !== 'embed';
    $('mlComposerView').hidden = view !== 'composer';
    $('mlContactView').hidden = view !== 'contact';

    renderTabs();
    if (view === 'embed') renderEmbeds();
    else if (view === 'contact') renderContact();
    else if (view !== 'composer') {
      var l = listById(view);
      /* A NEW LIST STARTS CLEAN. Carrying a search from the last one means
         opening a list of 300 people and being shown four, with the reason
         sitting in a box somebody has already stopped looking at. */
      if (l && l.id !== state.subsFor) {
        state.subsFor = l.id;
        state.subsQ = ''; state.subsStatus = ''; state.subsSort = '';
        state.subsTag = ''; state.subsPage = 0;
        if ($('subsQ')) {
          $('subsQ').value = ''; $('subsStatus').value = '';
          $('subsSort').value = ''; $('subsTag').value = '';
        }
      }
      /* ALWAYS SUBSCRIBERS FIRST. Opening a list to see who is on it is the
         common act; changing the sender address is the rare one. Carrying the
         previous sub-tab across meant somebody who once opened Settings landed
         there on every list afterwards. */
      if (l) { fillSettings(l); showSub('people'); }
    }

    /* Survives a reload, so coming back to a list is not a hunt. */
    try { history.replaceState(null, '', '#' + view); } catch (e) {}
  }

  function showSub(which) {
    state.sub = which;
    Array.prototype.forEach.call(document.querySelectorAll('.ml-subtab'), function (b) {
      b.classList.toggle('is-on', b.dataset.sub === which);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-subpanel]'), function (p) {
      p.hidden = p.dataset.subpanel !== which;
    });
    if (which === 'people') loadPeople();
  }

  /* ---- settings -------------------------------------------------------- */

  function setSwitch(btn, on) {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
  }

  /* The senders an administrator has set up, as options.
     `current` is passed so a list saved before this address was removed still
     shows what it holds. Dropping it would silently repoint the list at
     whatever happened to be first — a list that quietly changes who it comes
     from is worse than one showing an address that needs attention. */
  function fillSenders(current) {
    var sel = $('mlFromEmail');
    if (!sel) return;
    var opts = state.senders.slice();
    if (current && !opts.some(function (a) { return a.address === current; })) {
      opts.unshift({ address: current, label: null, missing: true });
    }
    sel.innerHTML =
      '<option value="">' + esc(tr('ml.fromPick') || 'Choose an address') + '</option>' +
      opts.map(function (a) {
        /* THE ADDRESS AND NOTHING ELSE. It briefly carried the label an
           administrator had typed alongside it, which read fine for the four
           standard addresses and left every hand-added one bare — a picker
           where some rows are described and some are not looks like the
           undescribed ones are broken. `news@` and `prayer@` say what they
           are; a second name for them was never doing work.

           The kept-for-history one IS still marked. Shown plainly it looks
           like an ordinary choice, and the next person to open this would
           have no way to know the list sends from something no longer set up. */
        var text = a.address;
        if (a.missing) text += '  (' + (tr('ml.fromGone') || 'no longer set up') + ')';
        return '<option value="' + esc(a.address) + '"' +
          (a.address === current ? ' selected' : '') + '>' + esc(text) + '</option>';
      }).join('');
    sel.value = current || '';

    /* Nothing to choose from is not a form problem to solve by typing — it is
       something an administrator has to do. Say which, rather than leaving an
       empty dropdown that reads as broken. */
    var hint = sel.parentNode.querySelector('.fld-hint');
    if (hint) {
      hint.textContent = state.senders.length
        ? (tr('ml.fromEmailHintPick') || hint.textContent)
        : (tr('ml.fromNone') || hint.textContent);
    }
  }

  function fillSettings(l) {
    $('mlId').value = l.id || '';
    $('mlName').value = l.name || '';
    $('mlDescription').value = l.description || '';
    $('mlFromName').value = l.from_name || '';
    fillSenders(l.from_email || '');
    $('mlReplyTo').value = l.reply_to || '';
    setSwitch($('mlOpen'), !!l.is_open);
    setStatus($('mlFormStatus'), '');

    $('mlArchive').hidden = !l.id;
  }

  function newList() {
    state.view = null;
    $('mlEmbedView').hidden = true;
    $('mlComposerView').hidden = true;
    $('mlListView').hidden = false;
    renderTabs();

    ['mlId', 'mlName', 'mlDescription', 'mlFromName', 'mlReplyTo']
      .forEach(function (id) { $(id).value = ''; });
    fillSenders('');
    setSwitch($('mlOpen'), false);
    $('mlArchive').hidden = true;
    setStatus($('mlFormStatus'), '');

    showSub('settings');
    $('mlName').focus();
  }

  async function submitSettings(e) {
    e.preventDefault();
    var payload = {
      id: $('mlId').value || undefined,
      name: $('mlName').value.trim(),
      description: $('mlDescription').value.trim(),
      from_name: $('mlFromName').value.trim(),
      from_email: $('mlFromEmail').value,
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
    await load((body.list && body.list.id) || state.view);
  }

  async function archive() {
    var l = currentList();
    if (!l) return;

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
    await load('');
  }

  /* ---- subscribers ----------------------------------------------------- */

  async function loadPeople() {
    var l = currentList();
    if (!l) return;

    /* A row, not a paragraph. This is a <table> now, and a <p> child of one is
       hoisted out by the parser and lands above the table looking like a
       stray line of text. */
    $('mlSubscribers').innerHTML =
      '<tbody><tr><td colspan="5" class="subs-empty">' +
      esc(tr('common.loading')) + '</td></tr></tbody>';

    var qs = 'list=' + encodeURIComponent(l.id) +
      '&page=' + (state.subsPage || 0) +
      (state.subsQ ? '&q=' + encodeURIComponent(state.subsQ) : '') +
      (state.subsStatus ? '&status=' + encodeURIComponent(state.subsStatus) : '') +
      (state.subsSort ? '&sort=' + encodeURIComponent(state.subsSort) : '') +
      (state.subsTag ? '&tag=' + encodeURIComponent(state.subsTag) : '');

    var res, body;
    try {
      res = await fetch(url(qs), { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, null);
      return;
    }
    if (!res.ok) {
      if (window.StaffProblem) window.StaffProblem(body.error || tr('err.refused'), null);
      return;
    }

    state.subscribers = body.subscribers || [];
    state.subsTotal = typeof body.total === 'number' ? body.total : state.subscribers.length;
    state.subsPageSize = body.page_size || 100;
    state.subsPage = body.page || 0;
    renderCounts(l);
    renderPeople();
    renderPager();
  }

  /* Three numbers rather than one. A list is people at different stages of
     having agreed, and a single total hides the two that matter: how many can
     actually be mailed, and how many are stuck unconfirmed. */
  function renderCounts(l) {
    var parts = [
      { k: 'subscribed', n: l.subscribed || 0, cls: 'ok' },
      { k: 'pending', n: l.pending || 0, cls: 'warn' },
      { k: 'unsubscribed', n: l.unsubscribed || 0, cls: '' },
    ].filter(function (p) { return p.n > 0 || p.k === 'subscribed'; });

    $('mlCounts').innerHTML = parts.map(function (p) {
      return '<span class="ml-count ' + p.cls + '"><b>' + p.n + '</b> ' +
        esc(tr('ml.status.' + p.k)) + '</span>';
    }).join('');
  }

  /* ONE LINE PER PERSON. A card each is readable at ten and unusable at three
     hundred: the eye cannot compare down a column that keeps moving, and a
     screen holds six instead of twenty-five.

     A real <table>, not a grid of divs, because the columns have to line up
     and because a screen reader should be able to say which column a cell is
     in. */
  function renderPeople() {
    var head =
      '<thead><tr>' +
        '<th data-i18n="ml.colWho">Who</th>' +
        '<th data-i18n="ml.colStatus">Status</th>' +
        '<th data-i18n="ml.colJoined">Joined</th>' +
        '<th data-i18n="ml.colTags">Tags</th>' +
        '<th><span class="vh" data-i18n="ml.colActions">Actions</span></th>' +
      '</tr></thead>';

    if (!state.subscribers.length) {
      var why = (state.subsQ || state.subsStatus) ? 'ml.noMatches' : 'ml.noPeople';
      $('mlSubscribers').innerHTML = head +
        '<tbody><tr><td colspan="5" class="subs-empty">' +
        esc(tr(why)) + '</td></tr></tbody>';
      return;
    }

    $('mlSubscribers').innerHTML = head + '<tbody>' + state.subscribers.map(function (s) {
      return '<tr data-subrow="' + esc(s.id) + '">' +
        /* The address is the identity and the name is the label, so they share
           a cell with the address leading. Two columns would waste a third of
           the width on the many people who have no name recorded. */
        '<td class="subs-who">' +
          '<span class="subs-email">' + esc(s.email) + '</span>' +
          (s.name ? '<span class="subs-name">' + esc(s.name) + '</span>' : '') +
        '</td>' +
        '<td><span class="subs-dot s-' + esc(s.status) + '"></span>' +
          esc(tr('ml.status.' + s.status)) + '</td>' +
        '<td class="subs-when">' + esc((s.subscribed_at || '').slice(0, 10)) + '</td>' +
        '<td class="subs-tags">' + esc(s.tags || '') + '</td>' +
        '<td class="subs-acts">' +
          '<button type="button" class="subs-ico" data-editsub="' + esc(s.id) + '" ' +
            'title="' + esc(tr('ml.edit')) + '" aria-label="' +
            esc(tr('ml.edit') + ' ' + s.email) + '">&#9998;</button>' +
          (s.status === 'pending'
            ? '<button type="button" class="subs-ico" data-resend="' + esc(s.id) + '" ' +
                'title="' + esc(tr('ml.resend')) + '" aria-label="' +
                esc(tr('ml.resend')) + '">&#8635;</button>' : '') +
          /* A picker, not a one-way button: a bounced address that starts
             working and somebody asking to come back both need a way forward.
             `pending` shows but is never settable — moving somebody back to
             unconfirmed would be this console claiming they never agreed. */
          '<select class="status-pick subs-status" data-status="' + esc(s.id) + '"' +
            ' aria-label="' + esc(tr('ml.statusLabel')) + '">' +
            ['subscribed', 'unsubscribed', 'bounced'].map(function (v) {
              return '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' +
                esc(tr('ml.status.' + v)) + '</option>';
            }).join('') +
            (s.status === 'pending'
              ? '<option value="pending" selected disabled>' +
                  esc(tr('ml.status.pending')) + '</option>' : '') +
          '</select>' +
          '<button type="button" class="subs-ico del" data-delsub="' + esc(s.id) + '" ' +
            'title="' + esc(tr('ms.delete')) + '" aria-label="' +
            esc(tr('ms.delete') + ' ' + s.email) + '">&times;</button>' +
        '</td>' +
      '</tr>';
    }).join('') + '</tbody>';

    if (window.StaffI18n) window.StaffI18n.apply($('mlSubscribers'));
  }

  /* ---- tags -----------------------------------------------------------
     THE MINISTRY'S OWN, shared by every list. Managed from the subscriber
     screen because that is where they are used, and deliberately not inside a
     list's Settings tab, where they would read as belonging to that one list. */

  function renderTags() {
    var tags = state.tags || [];

    /* The filter. Rebuilt from the same data as the manager, so a tag renamed
       in one is renamed in the other without a reload. */
    var sel = $('subsTag');
    sel.innerHTML = '<option value="">' + esc(tr('ml.tagAny')) + '</option>' +
      tags.map(function (t) {
        return '<option value="' + esc(t.id) + '"' +
          (t.id === state.subsTag ? ' selected' : '') + '>' + esc(t.name) +
          (t.used ? ' (' + t.used + ')' : '') + '</option>';
      }).join('');
    sel.value = state.subsTag || '';

    $('subsTagList').innerHTML = tags.length
      ? tags.map(function (t) {
          return '<div class="subs-tag" data-tag="' + esc(t.id) + '">' +
            '<input type="text" class="subs-tag-name" maxlength="60" ' +
              'value="' + esc(t.name) + '" data-tag-name="' + esc(t.id) + '">' +
            '<span class="subs-tag-n">' +
              (t.used ? fill('ml.tagUsed', { n: t.used }) : esc(tr('ml.tagUnused'))) +
            '</span>' +
            '<button type="button" class="del" data-tag-del="' + esc(t.id) + '" ' +
              'aria-label="' + esc(tr('common.delete') + ' ' + t.name) + '">×</button>' +
          '</div>';
        }).join('')
      : '<p class="hint">' + esc(tr('ml.noTags')) + '</p>';
  }

  async function saveTag(id, name) {
    var body = await postJson({ action: 'tag', id: id || undefined, name: name });
    if (body.error) { toast(body.error, 'bad'); return false; }
    state.tags = body.tags || state.tags;
    renderTags();
    return true;
  }

  async function deleteTag(id) {
    var t = (state.tags || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    var ok = await window.StaffConfirm({
      title: tr('ml.tagDelete'),
      /* Named, not counted in the abstract. "Removes it from 12 people" is a
         different decision from "are you sure". */
      body: t.used
        ? fill('ml.tagDeleteUsed', { name: t.name, n: t.used })
        : fill('ml.tagDeleteUnused', { name: t.name }),
      confirm: tr('ml.tagDeleteDo'), cancel: tr('ms.cancel'), danger: true,
    });
    if (!ok) return;
    var body = await postJson({ action: 'tag-delete', id: id });
    if (body.error) { toast(body.error, 'bad'); return; }
    state.tags = body.tags || [];
    /* A tag being filtered by has just stopped existing, so the filter has to
       let go of it or the list comes back empty for no visible reason. */
    if (state.subsTag === id) { state.subsTag = ''; state.subsPage = 0; }
    renderTags();
    loadPeople();
    toast(tr('toast.deleted'), 'ok');
  }

  /* ---- correcting somebody's details ----
     EDITED IN PLACE, not in a dialog. There are two fields and the row they
     belong to is right there; a modal would cover the list somebody is using
     to decide what to change. */
  function editRow(id) {
    var row = document.querySelector('[data-subrow="' + id + '"]');
    var sub = state.subscribers.filter(function (x) { return x.id === id; })[0];
    if (!row || !sub || row.classList.contains('is-editing')) return;

    row.classList.add('is-editing');
    row.innerHTML =
      '<td colspan="5"><form class="subs-edit">' +
        '<label><span data-i18n="ml.editName">Name</span>' +
          '<input type="text" data-edit="name" maxlength="120" value="' +
            esc(sub.name || '') + '"></label>' +
        '<label><span data-i18n="ml.editEmail">Email address</span>' +
          '<input type="email" data-edit="email" maxlength="200" required value="' +
            esc(sub.email) + '"></label>' +
        ((state.tags || []).length
          ? '<div class="subs-edit-tags"><span data-i18n="ml.editTags">Tags</span>' +
              state.tags.map(function (t) {
                var on = (sub.tags || '').split(', ').indexOf(t.name) >= 0;
                return '<label class="subs-edit-tag">' +
                  '<input type="checkbox" data-edit-tag="' + esc(t.id) + '"' +
                    (on ? ' checked' : '') + '>' +
                  '<span>' + esc(t.name) + '</span></label>';
              }).join('') +
            '</div>'
          : '') +
        '<button type="submit" class="solid-btn" data-i18n="ml.editSave">Save</button>' +
        '<button type="button" class="ghost-btn" data-edit-cancel="1" ' +
          'data-i18n="ms.cancel">Cancel</button>' +
        /* SAID BEFORE, NOT AFTER. Changing an address sends the row back to
           unconfirmed and emails a fresh confirmation — because otherwise
           "edit" is a way to subscribe any address without its owner ever
           agreeing. Somebody correcting a typo should know that before they
           press Save, not discover it from a status that changed. */
        '<span class="subs-edit-note" data-i18n="ml.editNote">Changing the address ' +
          'sends them a new confirmation, and they count as unconfirmed until they ' +
          'click it. Changing the name does not.</span>' +
      '</form></td>';
    if (window.StaffI18n) window.StaffI18n.apply(row);
    var first = row.querySelector('[data-edit="name"]');
    if (first) first.focus();
  }

  async function saveEdit(row) {
    var id = row.dataset.subrow;
    var name = row.querySelector('[data-edit="name"]').value.trim();
    var email = row.querySelector('[data-edit="email"]').value.trim();
    if (!email) return;

    var body = await postJson({ action: 'subscriber-edit', id: id, name: name, email: email });
    if (body.error) { toast(body.error, 'bad'); return; }

    /* Sent separately because they are a different kind of change: a tag is
       something the ministry records ABOUT somebody, not something the person
       agreed to — so it never touches their confirmation the way an address
       change does. */
    var picked = [].slice.call(row.querySelectorAll('[data-edit-tag]:checked'))
      .map(function (i) { return i.dataset.editTag; });
    var tagged = await postJson({ action: 'subscriber-tags', id: id, tags: picked });
    if (tagged.error) toast(tagged.error, 'bad');

    if (body.reconfirm) {
      toast(body.sent
        ? tr('ml.editReconfirm').replace('{email}', body.email)
        : tr('ml.editReconfirmNoMail').replace('{email}', body.email),
        body.sent ? 'ok' : 'bad');
    } else {
      toast(tr('toast.saved'), 'ok');
    }
    await loadPeople();
  }

  /* WHICH SLICE OF HOW MANY. Without the total, the only way to find out
     whether there is another page is to press Next and see. */
  function renderPager() {
    var total = state.subsTotal || 0;
    var size = state.subsPageSize || 100;
    var from = state.subsPage * size;
    var shown = state.subscribers.length;

    $('subsRange').textContent = total
      ? fill('ml.showing', { a: from + 1, b: from + shown, n: total }) : '';

    var pages = Math.max(1, Math.ceil(total / size));
    $('subsPager').hidden = pages <= 1;
    $('subsPageLabel').textContent = fill('ml.pageOf',
      { a: state.subsPage + 1, b: pages });
    $('subsPrev').disabled = state.subsPage <= 0;
    $('subsNext').disabled = state.subsPage >= pages - 1;
  }

  /* ---- sign-up forms --------------------------------------------------- */

  /* ONE SNIPPET FOR THE WHOLE PARTNER, not one per list. The form asks which
     of the open lists somebody wants; pasting a form per list would make a
     visitor type their address once for each. */
  function snippet() {
    return '<div data-thauma-form></div>\n' +
      '<script src="' + location.origin + '/embed/v1/' +
      state.partnerSlug + '/form.js" defer></' + 'script>';
  }

  function renderEmbeds() {
    var open = state.lists.filter(function (l) { return l.is_open; });
    var closed = state.lists.filter(function (l) { return !l.is_open; });

    if (!state.lists.length) {
      $('mlEmbedList').innerHTML = '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
      return;
    }

    var first = open[0] || {};
    var heading = first.form_heading || tr('ml.formHeadingFallback');
    var button = first.form_button || tr('ml.formPreviewFallback');

    /* THE PREVIEW IS THE ACTUAL WIDGET, in a frame, drawn by the same
       form.js a visitor's browser would fetch.

       It used to be hand-built markup that imitated the form. That is fine
       until the two disagree, and they did the moment the real one became a
       bordered card in the ministry's accent while the imitation stayed a
       stack of grey inputs — the page was showing a picture of a form nobody
       would ever see. Rendering the real thing costs a frame and cannot drift.

       SANDBOXED TO SCRIPTS ONLY: no same-origin, so the preview cannot reach
       this console's session even though it is running code from our own
       domain. It is the same frame the ministry page uses. */
    /* ABOVE THE SETTINGS, matching the contact form and the Ministry page's
       roadmap and goal embeds. Same position, same classes, same
       Desktop/Mobile control — three layouts for one idea would be three
       things to learn.

       Beside the settings is where this used to be, and the narrow view is why
       it moved: 380px inside a half-width column is not a phone, it is a
       squeeze. */
    var preview = !open.length
      ? '<p class="hint">' + esc(tr('ml.embedNoneOpen')) + '</p>'
      : '<div class="emb-stagebar">' +
          '<p class="emb-lede">' + esc(tr('ml.embedLede')) + '</p>' +
          '<div class="emb-devices" role="tablist" aria-label="Width">' +
            '<button type="button" class="emb-device is-on" role="tab" ' +
              'aria-selected="true" data-pv-width="wide">' + esc(tr('emb.desktop')) + '</button>' +
            '<button type="button" class="emb-device" role="tab" ' +
              'aria-selected="false" data-pv-width="narrow">' + esc(tr('emb.mobile')) + '</button>' +
          '</div>' +
          '<span class="emb-scale-note" data-pv="scaleNote"></span>' +
        '</div>' +
        '<div class="emb-stage ct-stage" data-pv="stage">' +
          '<div class="emb-scale" data-pv="scale">' +
            '<iframe data-pv="frame" title="Sign-up form preview" sandbox="allow-scripts"></iframe>' +
          '</div>' +
        '</div>';

    /* WHICH LISTS APPEAR, and a switch for each, because "why is prayer not on
       my form" is answered here or nowhere. */
    var switches = state.lists.map(function (l) {
      return '<button type="button" class="switch small" role="switch"' +
        ' aria-checked="' + (l.is_open ? 'true' : 'false') + '"' +
        ' data-toggle-open="' + esc(l.id) + '">' +
        '<span class="switch-track"><span class="switch-state">' +
          (l.is_open ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(l.name) + '</span>' +
      '</button>';
    }).join('');

    var wordingOf = first.id ? first : null;
    var theme = liveTheme();

    $('mlEmbedList').innerHTML =
      '<div class="ml-embed-card">' +
        preview +
        '<div class="ml-embed-below">' +
          '<div class="ml-embed-code">' +
            '<span class="adm-label">' + esc(tr('ml.whichLists')) + '</span>' +
            '<div class="ml-embed-switches">' + switches + '</div>' +

            /* THE SAME COLOURS AS EVERY OTHER WIDGET, and the same controls
               that set them on the ministry page — one accent, an optional
               second, and whether to follow the host page's light or dark.
               Deliberately NOT a separate palette for mail: a sign-up form
               sitting under a goal card on the same website has to look like
               it came from the same ministry. */
            '<div class="ml-colours">' +
              '<span class="adm-label">' + esc(tr('emb.colours')) + '</span>' +
              '<div class="emb-controls">' +
                '<label class="emb-field"><span>' + esc(tr('emb.accent')) + '</span>' +
                  '<span class="emb-colour">' +
                    '<input type="color" data-clr="accent" value="' + esc(theme.accent) + '">' +
                    '<input type="text" class="emb-hex" maxlength="7" spellcheck="false" ' +
                      'data-clr="accentHex" value="' + esc(theme.accent) + '" ' +
                      'aria-label="Accent colour hex">' +
                  '</span></label>' +
                '<label class="emb-field"><span>' + esc(tr('emb.accent2')) + '</span>' +
                  '<span class="emb-colour">' +
                    '<input type="color" data-clr="accent2" value="' + esc(theme.accent2) + '"' +
                      (theme.auto ? ' disabled' : '') + '>' +
                    '<input type="text" class="emb-hex" maxlength="7" spellcheck="false" ' +
                      'data-clr="accent2Hex" value="' + esc(theme.accent2) + '"' +
                      (theme.auto ? ' disabled' : '') + ' aria-label="Second colour hex">' +
                  '</span></label>' +
                '<label class="emb-field emb-auto"><span>' + esc(tr('emb.pairAuto')) + '</span>' +
                  '<span class="emb-checkline">' +
                    '<input type="checkbox" data-clr="pairAuto"' + (theme.auto ? ' checked' : '') + '>' +
                    '<span>' + esc(tr('emb.pairAutoNote')) + '</span>' +
                  '</span></label>' +
                '<label class="emb-field"><span>' + esc(tr('emb.theme')) + '</span>' +
                  '<select data-clr="mode">' +
                    ['auto', 'light', 'dark'].map(function (m) {
                      return '<option value="' + m + '"' +
                        (theme.mode === m ? ' selected' : '') + '>' +
                        esc(tr('emb.' + (m === 'auto' ? 'auto' : m))) + '</option>';
                    }).join('') +
                  '</select></label>' +
              '</div>' +
              (state.mayTheme
                ? '<button type="button" class="ghost-btn" data-save-colours="1">' +
                    esc(tr('emb.saveColours')) + '</button>' +
                  '<p class="hint">' + esc(tr('emb.sharedShort')) + '</p>'
                : '<p class="rolegate">' + esc(tr('emb.adminOnly')) + '</p>') +
            '</div>' +

            (wordingOf
              ? '<div class="ml-wording">' +
                  '<span class="adm-label">' + esc(tr('ml.wording')) + '</span>' +
                  '<label class="fld"><span>' + esc(tr('ml.formHeading')) + '</span>' +
                    '<input type="text" maxlength="120" data-word="form_heading"' +
                    ' data-list="' + esc(wordingOf.id) + '"' +
                    ' value="' + esc(wordingOf.form_heading || '') + '"' +
                    ' placeholder="' + esc(tr('ml.formHeadingFallback')) + '"></label>' +
                  '<label class="fld"><span>' + esc(tr('ml.formBlurb')) + '</span>' +
                    '<input type="text" maxlength="240" data-word="form_blurb"' +
                    ' data-list="' + esc(wordingOf.id) + '"' +
                    ' value="' + esc(wordingOf.form_blurb || '') + '"></label>' +
                  '<label class="fld"><span>' + esc(tr('ml.formButton')) + '</span>' +
                    '<input type="text" maxlength="40" data-word="form_button"' +
                    ' data-list="' + esc(wordingOf.id) + '"' +
                    ' value="' + esc(wordingOf.form_button || '') + '"' +
                    ' placeholder="' + esc(tr('ml.formPreviewFallback')) + '"></label>' +
                  '<button type="button" class="ghost-btn" data-save-words="' +
                    esc(wordingOf.id) + '">' + esc(tr('ml.saveWording')) + '</button>' +
                '</div>'
              : '') +

            '<textarea readonly rows="4" spellcheck="false">' + esc(snippet()) + '</textarea>' +
            '<button type="button" class="ghost-btn" data-copy="1">' +
              esc(tr('ml.copy')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    drawPreview();
  }

  /* ---- the live preview -------------------------------------------------
     A frame carrying nothing but the embed node and the real script tag —
     exactly the two lines the snippet tells somebody to paste. If it works
     here it works there, because it IS there. */

  /* What the controls currently say, falling back to what is saved. Kept
     separate from the saved settings so the frame can be redrawn on every
     keystroke without writing anything. */
  function liveTheme() {
    var box = $('mlEmbedList');
    var get = function (k) {
      var el = box && box.querySelector('[data-clr="' + k + '"]');
      return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : null;
    };
    var saved = state.embed || {};
    var accent = get('accentHex') || saved.accent || DEFAULT_ACCENT;
    if (!HEX.test(accent)) accent = saved.accent || DEFAULT_ACCENT;

    var auto = get('pairAuto');
    if (auto === null) auto = !saved.accent2;

    var second = auto ? '' : (get('accent2Hex') || saved.accent2 || '');
    if (!HEX.test(second)) second = '';

    return { accent: accent, accent2: second || companion(accent),
             auto: auto, mode: get('mode') || saved.theme || 'auto' };
  }

  function drawPreview() {
    var frame = $('mlEmbedList') && $('mlEmbedList').querySelector('[data-pv="frame"]');
    if (!frame || !state.partnerSlug) return;
    var t = liveTheme();

    /* `data-accent2` is sent ONLY when it was chosen. Left off, the widget
       derives it — which is the same rule the stored value follows, so the
       preview and a real page cannot disagree about what "match it
       automatically" means. */
    var attrs = ' data-accent="' + esc(t.accent) + '" data-theme="' + esc(t.mode) + '"' +
                (t.auto ? '' : ' data-accent2="' + esc(t.accent2) + '"');

    /* The wording as TYPED, not as saved, so the preview leads the Save button
       rather than trailing it. Only sent when the field exists and differs
       from nothing — an absent attribute leaves the widget's own text alone,
       which is what an untouched field should mean. */
    var box = $('mlEmbedList');
    [['form_heading', 'heading'], ['form_blurb', 'blurb'], ['form_button', 'button']]
      .forEach(function (pair) {
        var el = box.querySelector('[data-word="' + pair[0] + '"]');
        if (!el) return;
        var v = el.value.trim();
        if (v) attrs += ' data-' + pair[1] + '="' + esc(v) + '"';
        else if (pair[1] === 'blurb') attrs += ' data-blurb=""';
      });

    frame.srcdoc =
      '<!doctype html><meta charset="utf-8">' +
      '<meta name="color-scheme" content="light dark">' +
      '<style>html,body{margin:0;padding:18px;background:transparent}</style>' +
      '<div data-thauma-form' + attrs + '></div>' +
      '<scr' + 'ipt src="/embed/v1/' + encodeURIComponent(state.partnerSlug) +
        '/form.js?t=' + Date.now() + '"></scr' + 'ipt>';
  }

  /* Typing a colour redraws the frame and writes NOTHING. Colours are shared
     by every widget this ministry publishes, so saving on each keystroke would
     repaint other people's pages while somebody was still deciding. */
  function colourInput(el) {
    var box = $('mlEmbedList');
    var pick = function (k) { return box.querySelector('[data-clr="' + k + '"]'); };
    var k = el.getAttribute('data-clr');

    // The swatch and the hex field are one control shown two ways.
    if (k === 'accent') pick('accentHex').value = el.value.toUpperCase();
    if (k === 'accentHex' && HEX.test(el.value.trim())) pick('accent').value = el.value.trim();
    if (k === 'accent2') pick('accent2Hex').value = el.value.toUpperCase();
    if (k === 'accent2Hex' && HEX.test(el.value.trim())) pick('accent2').value = el.value.trim();

    /* With "match it automatically" on, the second swatch SHOWS the derived
       colour rather than going blank — the pair is the thing being chosen, and
       hiding half of it makes the accent look like the only decision. */
    var auto = pick('pairAuto').checked;
    if (k === 'pairAuto' || k === 'accent' || k === 'accentHex') {
      var derived = companion(pick('accentHex').value.trim());
      pick('accent2').disabled = auto;
      pick('accent2Hex').disabled = auto;
      if (auto && HEX.test(derived)) {
        pick('accent2').value = derived;
        pick('accent2Hex').value = derived.toUpperCase();
      }
    }
    drawPreview();
  }

  async function saveColours(btn) {
    var t = liveTheme();
    if (!HEX.test(t.accent)) { toast(tr('emb.badHex'), 'bad'); return; }
    /* REFUSED rather than guessed. Sending the block without knowing the
       current `enabled` would switch a ministry's published widgets off as a
       side effect of picking a colour — silent, and visible only to the
       websites showing them. */
    if (!state.embed) { toast(tr('emb.noSettings'), 'bad'); return; }
    btn.disabled = true;
    try {
      var res = await fetch(SETTINGS, {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        /* `enabled` is sent unchanged. The server takes the embed block whole,
           so omitting it would read as "switch embedding off" — turning a
           ministry's published widgets dark because somebody picked a colour
           on a different screen. */
        body: JSON.stringify({ embed: {
          enabled: !!state.embed.enabled,
          accent: t.accent, theme: t.mode,
          // null means "derive it" — the switch and the stored value are one fact.
          accent2: t.auto ? null : t.accent2
        } })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
      state.embed = body.embed || state.embed;
      toast(tr('toast.saved'), 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    } finally { btn.disabled = false; }
  }

  /* Whose lists the whole page is showing. Read by the composer, which is a
     separate file but the same screen — one decision, not one per panel. */
  window.StaffMailing = { scope: function () { return state.scope; } };

  /* ---- the contact form -------------------------------------------------
     ONE PER MINISTRY, so this is a form rather than a list of forms. It shares
     the sending addresses with the newsletter, because it is the same ministry
     writing from the same domain — and it shares the sign-up form's card, so a
     visitor meets one design rather than two. */

  function renderContact() {
    var c = state.contact || {};
    $('ctTo').value = c.deliver_to || '';
    $('ctHeading').value = c.heading || '';
    $('ctBlurb').value = c.blurb || '';
    $('ctButton').value = c.button || '';
    $('ctThanks').value = c.thanks || '';
    setSwitch($('ctOpen'), !!c.is_open);
    setStatus($('ctStatus'), '');

    /* The same picker as the newsletter's sender, and for the same reason: the
       mail provider verifies DOMAINS rather than addresses, so a typo sends
       successfully and loses every reply. */
    var sel = $('ctFrom');
    var current = c.from_address || '';
    var opts = state.senders.slice();
    if (current && !opts.some(function (a) { return a.address === current; })) {
      opts.unshift({ address: current, missing: true });
    }
    sel.innerHTML = '<option value="">' + esc(tr('ml.fromPick')) + '</option>' +
      opts.map(function (a) {
        var text = a.address;
        if (a.missing) text += '  (' + (tr('ml.fromGone') || 'no longer set up') + ')';
        return '<option value="' + esc(a.address) + '"' +
          (a.address === current ? ' selected' : '') + '>' + esc(text) + '</option>';
      }).join('');
    sel.value = current;

    renderTopics();

    /* SHOWN WHETHER OR NOT THE FORM IS LIVE. It was hidden until then, and
       that made the embed code look like it did not exist. The reason it will
       not work yet is said instead of the code being taken away. */
    $('ctEmbedOff').hidden = !!c.is_open;
    var who = state.scope === 'organisation' ? 'thauma' : state.partnerSlug;
    $('ctSnippet').value = who
      ? '<div data-thauma-contact></div>\n' +
        '<script src="' + location.origin + '/embed/v1/' +
          who + '/contact.js" defer><' + '/script>'
      : '';

    drawContact();
  }

  /* THE FRAME TAKES ITS HEIGHT FROM THE WIDGET, because an iframe has a fixed
     height it does not learn from its contents. That is the only reason the
     preview scrolled while a real embed never does — on a host's page the
     widget is a div in their document, exactly as tall as its content.

     CLAMPED, AND THE FLOOR MATTERS. The Ministry page's version documents a
     ratchet: report the document's scrollHeight to a parent that then sets the
     frame to it, and every measurement returns the last one plus a margin.
     The widget measures its own body rect instead, so this only has to guard
     against a nonsense value. */
  /* FIT THE WHOLE THING IN THE BOX.

     A contact form is genuinely around 700px tall — six fields and a message
     box — and at 1:1 the console had to be scrolled to see the end of its own
     preview. Scrolling to see a preview defeats what a preview is for.

     So the frame is drawn at full size and the WRAPPER is scaled, which is how
     a design tool shows a page. Scaling the iframe itself would shrink the
     drawing surface too, and the widget would answer a different question
     about its container width — a 480px card in a 640px frame scaled to 70%
     is honest; a card asked to draw itself at 448px is not. */
  var PREVIEW_MAX_H = 480;

  function fitPreview(frame, h) {
    var scale = Math.min(1, PREVIEW_MAX_H / h);
    var wrap = frame.parentNode;
    var stage = wrap.parentNode;

    frame.style.blockSize = h + 'px';
    /* Wider than the box by exactly the amount the scale takes back, so the
       result lands at 100% rather than leaving a gutter. */
    wrap.style.inlineSize = (100 / scale) + '%';
    wrap.style.transform = 'scale(' + scale + ')';
    stage.style.blockSize = Math.ceil(h * scale) + 'px';

    /* SAID OUT LOUD. Without this the smaller type reads as the type a visitor
       gets, and somebody would go and make their heading bigger to fix a
       problem that does not exist. */
    var note = stage.parentNode.querySelector('.emb-scale-note');
    if (note) note.textContent = scale < 0.99
      ? tr('emb.shownAt').replace('{n}', Math.round(scale * 100)) : '';
  }

  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    if (!h) return;
    h = Math.max(220, Math.min(2000, h));
    [].forEach.call(document.querySelectorAll('[data-ct="frame"],[data-pv="frame"]'),
      function (f) {
        /* WHICH frame sent it. Two previews can exist on this page, and
           without checking the source the first would take every
           measurement — including the other one's. */
        if (f.contentWindow === e.source) fitPreview(f, h);
      });
  });

  /* NARROW IS A REAL CONSTRAINT, NOT A PICTURE OF ONE. The widget chooses its
     layout from the width it is actually given, so 380px produces exactly what
     a phone would — the same decision, not a simulation of it.

     One handler for both previews, because they are the same control on two
     screens and a second copy would drift. */
  function setStageWidth(btn, attr) {
    var narrow = btn.dataset[attr] === 'narrow';
    var bar = btn.closest('.emb-stagebar');
    [].forEach.call(bar.querySelectorAll('.emb-device'), function (b) {
      var on = b === btn;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var stage = bar.parentNode.querySelector('.emb-stage');
    if (stage) stage.classList.toggle('is-narrow', narrow);
  }

  /* THE VISUALISER. The real widget in a frame, drawn by the same contact.js a
     visitor's browser fetches.

     A browser preview is honest HERE, unlike the email composer's — which was
     removed precisely because a browser is not a mail client. This form ends
     up on a web page, so a browser IS what will draw it.

     Redrawn from what is TYPED rather than what is saved, so the preview leads
     the Save button instead of trailing it. Debounced, because each redraw
     refetches the widget script. */
  var ctTimer = null;
  function drawContactSoon() {
    clearTimeout(ctTimer);
    ctTimer = setTimeout(drawContact, 260);
  }

  function drawContact() {
    var frame = document.querySelector('[data-ct="frame"]');
    if (!frame) return;

    /* "thauma" is the reserved word for the organisation, which has no partner
       slug — the same convention the endpoint uses. */
    var who = state.scope === 'organisation' ? 'thauma' : state.partnerSlug;
    if (!who) { frame.removeAttribute('srcdoc'); return; }

    var saved = state.embed || {};
    var accent = HEX.test(saved.accent || '') ? saved.accent : DEFAULT_ACCENT;
    var attrs = ' data-accent="' + esc(accent) + '"' +
                ' data-theme="' + esc(saved.theme || 'auto') + '"';
    if (saved.accent2 && HEX.test(saved.accent2)) {
      attrs += ' data-accent2="' + esc(saved.accent2) + '"';
    }

    /* The wording as typed. An absent attribute leaves the widget's own text
       alone, which is what an untouched field should mean — so an empty box
       shows the default rather than a blank heading. */
    [['ctHeading', 'heading'], ['ctBlurb', 'blurb'],
     ['ctButton', 'button'], ['ctThanks', 'thanks']].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      var v = el.value.trim();
      if (v) attrs += ' data-' + pair[1] + '="' + esc(v) + '"';
      else if (pair[1] === 'blurb') attrs += ' data-blurb=""';
    });

    frame.srcdoc =
      '<!doctype html><meta charset="utf-8">' +
      '<meta name="color-scheme" content="light dark">' +
      '<style>html,body{margin:0;padding:18px;background:transparent}</style>' +
      '<div data-thauma-contact' + attrs + '></div>' +
      '<scr' + 'ipt src="/embed/v1/' + encodeURIComponent(who) +
        '/contact.js?t=' + Date.now() + '"></scr' + 'ipt>';
  }

  /* The dropdown, as editable rows. Each carries an optional address of its
     own, which is what makes a reason more than a label: prayer requests to
     one inbox, partnership enquiries to another. */
  function renderTopics() {
    var rows = (state.topics || []).map(function (t, i) {
      return '<div class="ct-topic" data-topic="' + i + '">' +
        '<input type="text" class="ct-topic-label" maxlength="80" ' +
          'value="' + esc(t.label || '') + '" ' +
          'placeholder="' + esc(tr('ml.ctTopicLabel')) + '">' +
        '<input type="email" class="ct-topic-to" maxlength="200" ' +
          'value="' + esc(t.deliver_to || '') + '" ' +
          'placeholder="' + esc(tr('ml.ctTopicTo')) + '">' +
        '<button type="button" class="del" data-drop-topic="' + i + '" ' +
          'aria-label="' + esc(tr('common.delete')) + '">×</button>' +
      '</div>';
    }).join('');
    $('ctTopicList').innerHTML = rows ||
      '<p class="hint">' + esc(tr('ml.ctNoTopics')) + '</p>';
  }

  /* Read back out of the boxes rather than tracked on every keystroke. One
     source of truth, and no way for the two to disagree.

     EVERY ROW, INCLUDING THE EMPTY ONE. This used to drop unlabelled rows
     here, which was right for saving and wrong for redrawing: pressing "Add a
     reason" and then deleting a different row made the new empty box vanish
     before it could be typed into. Filtering belongs at the point of saving,
     which is the only place an empty row is meaningless. */
  function readTopics() {
    return [].slice.call(document.querySelectorAll('.ct-topic')).map(function (row) {
      return {
        label: row.querySelector('.ct-topic-label').value.trim(),
        deliver_to: row.querySelector('.ct-topic-to').value.trim(),
      };
    });
  }

  async function saveContact(e) {
    e.preventDefault();
    setStatus($('ctStatus'), tr('ml.saving'));
    var body = await postJson({
      action: 'contact-form',
      deliver_to: $('ctTo').value.trim(),
      from_address: $('ctFrom').value,
      heading: $('ctHeading').value.trim(),
      blurb: $('ctBlurb').value.trim(),
      button: $('ctButton').value.trim(),
      thanks: $('ctThanks').value.trim(),
      is_open: $('ctOpen').getAttribute('aria-checked') === 'true',
      /* Filtered HERE and only here. A row somebody added and did not name is
         not a reason yet, and saving it would put a blank option in the
         dropdown. */
      topics: readTopics().filter(function (t) { return t.label; }),
    });
    if (body.error) { setStatus($('ctStatus'), ''); toast(body.error, 'bad'); return; }
    state.contact = body.contact;
    state.topics = body.topics || [];
    setStatus($('ctStatus'), '');
    renderContact();
    toast(tr('toast.saved'), 'ok');
  }

  async function postJson(payload) {
    var res, body;
    try {
      res = await fetch(url(), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      body = await res.json().catch(function () { return {}; });
    } catch (e) { return { error: tr('err.unreachable') + ' ' + e.message }; }
    if (!res.ok) return { error: body.error || (tr('err.refused') + ' (' + res.status + ')') };
    return body;
  }

  /* ---- loading --------------------------------------------------------- */

  async function load(keepView) {
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
    renderTags();
    state.senders = body.senders || [];
    state.contact = body.contact || null;
    state.topics = body.topics || [];
    state.embed = body.embed || null;
    state.mayTheme = !!body.may_theme;
    state.partnerSlug = (body.partner && body.partner.slug) || '';

    if (body.may_send_as_organisation) {
      $('mlScope').hidden = false;
      $('mlScopeMine').textContent = (body.partner && body.partner.display_name) || tr('ml.scopeMine');
    }

    /* Where to land: what the caller asked for, then the address bar, then the
       first list. Somebody arriving from a bookmark should get their list. */
    var wanted = keepView || (location.hash || '').slice(1);
    var valid = TOOLS.indexOf(wanted) >= 0 || !!listById(wanted);
    show(valid ? wanted : (state.lists[0] ? state.lists[0].id : 'embed'));
  }

  /* ---- wiring ---------------------------------------------------------- */

  $('mlNewList').addEventListener('click', newList);
  $('mlForm').addEventListener('submit', submitSettings);

  /* CANCEL PUTS IT BACK. On an existing list, the saved values return; on one
     being created, there is nothing to return to, so it leaves — a form with
     no list behind it is a dead end, and the way out was previously to click
     another tab and hope. */
  $('mlCancel').addEventListener('click', function () {
    var l = currentList();
    if (l) { fillSettings(l); showSub('people'); return; }
    show(state.lists[0] ? state.lists[0].id : 'embed');
  });
  $('mlArchive').addEventListener('click', archive);
  $('mlContactForm').addEventListener('submit', saveContact);
  $('mlContactForm').addEventListener('input', function (e) {
    /* Only the four fields the widget can be told about. The delivery address
       and the routing are not things a visitor ever sees, so redrawing for
       them would be a request per keystroke for no visible change. */
    if (/^ct(Heading|Blurb|Button|Thanks)$/.test(e.target.id)) drawContactSoon();
    /* A reason IS visible — it is the dropdown — but its label lives in the
       database, so the preview only catches up once it is saved. */
  });
  $('ctOpen').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });
  document.addEventListener('click', function (e) {
    var w = e.target.closest('[data-ct-width]');
    if (w) return setStageWidth(w, 'ctWidth');
    var p = e.target.closest('[data-pv-width]');
    if (p) return setStageWidth(p, 'pvWidth');
  });

  $('ctAddTopic').addEventListener('click', function () {
    state.topics = readTopics().concat([{ label: '', deliver_to: '' }]);
    renderTopics();
    var boxes = document.querySelectorAll('.ct-topic-label');
    if (boxes.length) boxes[boxes.length - 1].focus();
  });
  $('ctTopicList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-drop-topic]');
    if (!b) return;
    var keep = readTopics();
    keep.splice(Number(b.dataset.dropTopic), 1);
    state.topics = keep;
    renderTopics();
  });

  $('ctCopy').addEventListener('click', function () {
    var box = $('ctSnippet');
    box.select();
    navigator.clipboard.writeText(box.value).then(function () {
      toast(tr('toast.copied'), 'ok');
    }, function () { /* the text is selected either way */ });
  });

  $('mlOpen').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-view]');
    if (tab) return show(tab.dataset.view);

    /* SCOPED TO THE SUB-TABS, not to anything carrying data-sub.
       The subscriber rows used the same attribute for their id, so clicking
       one asked to show a panel named after a person — no panel matched, both
       sub-tabs went dark and the page went blank. The rows are `data-subrow`
       now, and this only looks inside the tab strip, so a future collision
       cannot reach it either. */
    var sub = e.target.closest('.ml-subtabs [data-sub]');
    if (sub) return showSub(sub.dataset.sub);

    var scope = e.target.closest('[data-scope]');
    if (scope) {
      state.scope = scope.dataset.scope;
      Array.prototype.forEach.call(document.querySelectorAll('[data-scope]'), function (b) {
        b.classList.toggle('is-on', b.dataset.scope === state.scope);
      });
      return load('');
    }

    var flip = e.target.closest('[data-toggle-open]');
    if (flip) {
      var fl = listById(flip.dataset.toggleOpen);
      if (!fl) return;
      flip.disabled = true;
      return (async function () {
        var r = await fetch(url(), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: fl.id, name: fl.name, description: fl.description || '',
            from_name: fl.from_name, from_email: fl.from_email,
            reply_to: fl.reply_to || '', is_open: !fl.is_open,
            form_heading: fl.form_heading || '', form_blurb: fl.form_blurb || '',
            form_button: fl.form_button || '',
          }),
        });
        if (!r.ok) { flip.disabled = false; toast(tr('err.refused'), 'bad'); return; }
        toast(tr(fl.is_open ? 'ml.formOff' : 'ml.formOn'), 'ok');
        await load('embed');
      })();
    }

    var sc = e.target.closest('[data-save-colours]');
    if (sc) return saveColours(sc);

    var saveWords = e.target.closest('[data-save-words]');
    if (saveWords) {
      var wl = listById(saveWords.dataset.saveWords);
      if (!wl) return;
      var card = saveWords.closest('.ml-embed-card');
      var read = function (n) {
        var el = card.querySelector('[data-word="' + n + '"]');
        return el ? el.value.trim() : '';
      };
      saveWords.disabled = true;
      return (async function () {
        var r = await fetch(url(), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: wl.id, name: wl.name, description: wl.description || '',
            from_name: wl.from_name, from_email: wl.from_email,
            reply_to: wl.reply_to || '', is_open: !!wl.is_open,
            form_heading: read('form_heading'),
            form_blurb: read('form_blurb'),
            form_button: read('form_button'),
          }),
        });
        saveWords.disabled = false;
        if (!r.ok) { toast(tr('err.refused'), 'bad'); return; }
        toast(tr('ml.saved'), 'ok');
        await load('embed');
      })();
    }

    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var ta = copy.parentNode.querySelector('textarea');
      navigator.clipboard.writeText(snippet()).then(function () {
        toast(tr('ml.copied'), 'ok');
      }).catch(function () {
        /* Clipboard access is refused in plenty of ordinary situations — an
           insecure origin, a browser setting. Selecting the text is something
           the person can finish themselves, which beats a silent failure. */
        ta.select();
        toast(tr('ml.copyManual'), 'bad');
      });
    }
  });

  /* The preview redraws as the wording is typed. A preview that only updates
     on save is a preview of the past. */
  /* Typing anything that changes how the form LOOKS redraws the frame.
     Debounced, because each redraw reloads the widget script — instant on a
     keystroke would be a request per character. 220ms is under the pause
     between words, so it reads as live without behaving like it. */
  var redrawTimer = null;
  function redrawSoon() {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(drawPreview, 220);
  }

  document.addEventListener('input', function (e) {
    if (e.target.closest('[data-clr]')) return colourInput(e.target);
    if (e.target.closest('[data-word]')) return redrawSoon();
  });
  document.addEventListener('change', function (e) {
    if (e.target.closest('[data-clr]')) return colourInput(e.target);
  });

  $('mlAddPerson').addEventListener('submit', async function (e) {
    e.preventDefault();
    var l = currentList();
    if (!l) return;
    var email = $('mlNewEmail').value.trim();
    if (!email) return;

    setStatus($('mlAddStatus'), tr('ml.adding'));
    var res, body;
    try {
      res = await fetch(url(), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-subscriber', list_id: l.id,
                               email: email, name: $('mlNewName').value.trim() }),
      });
      body = await res.json();
    } catch (err) {
      setStatus($('mlAddStatus'), tr('err.unreachable') + ' ' + err.message);
      return;
    }
    if (!res.ok) { setStatus($('mlAddStatus'), body.error || tr('err.refused')); return; }

    $('mlNewEmail').value = ''; $('mlNewName').value = '';
    setStatus($('mlAddStatus'), tr('ml.addNote'));

    /* Which of the two happened. The row exists and is pending either way, and
       somebody waiting on a confirmation that never left deserves to know now. */
    if (body.sent) toast(fill('ml.addedPending', { email: body.email }), 'ok');
    else {
      toast(fill('ml.addedNoEmail', { email: body.email }) +
            (body.sendError ? ' — ' + body.sendError : ''), 'bad');
    }
    await load(state.view);
  });

  /* ---- finding somebody ----
     Every control resets to page one, because staying on page four of a
     search that now matches three people is a blank screen with no
     explanation. */
  function reloadPeople() { loadPeople(); }

  var subsTimer = null;
  $('subsQ').addEventListener('input', function () {
    state.subsQ = this.value.trim();
    state.subsPage = 0;
    /* Debounced, because this is a database query per keystroke otherwise.
       260ms is under the pause between words. */
    clearTimeout(subsTimer);
    subsTimer = setTimeout(reloadPeople, 260);
  });
  $('subsStatus').addEventListener('change', function () {
    state.subsStatus = this.value; state.subsPage = 0; reloadPeople();
  });
  $('subsSort').addEventListener('change', function () {
    state.subsSort = this.value; state.subsPage = 0; reloadPeople();
  });
  $('subsTag').addEventListener('change', function () {
    state.subsTag = this.value; state.subsPage = 0; reloadPeople();
  });

  $('subsManageTags').addEventListener('click', function () {
    var panel = $('subsTagPanel');
    panel.hidden = !panel.hidden;
    this.classList.toggle('is-on', !panel.hidden);
    if (!panel.hidden) $('subsTagName').focus();
  });

  $('subsTagAdd').addEventListener('submit', async function (e) {
    e.preventDefault();
    var box = $('subsTagName');
    var name = box.value.trim();
    if (!name) return;
    if (await saveTag(null, name)) { box.value = ''; box.focus(); }
  });

  $('subsTagList').addEventListener('click', function (e) {
    var d = e.target.closest('[data-tag-del]');
    if (d) deleteTag(d.dataset.tagDel);
  });

  /* Renamed on blur rather than on every keystroke — one request per tag
     rather than one per character, and Enter is the same act. */
  $('subsTagList').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.dataset.tagName) { e.preventDefault(); e.target.blur(); }
  });
  $('subsTagList').addEventListener('focusout', function (e) {
    var box = e.target;
    if (!box.dataset || !box.dataset.tagName) return;
    var t = (state.tags || []).filter(function (x) { return x.id === box.dataset.tagName; })[0];
    var name = box.value.trim();
    if (!t || !name || name === t.name) { if (t) box.value = t.name; return; }
    saveTag(t.id, name).then(function (ok) {
      if (ok) { loadPeople(); toast(tr('toast.saved'), 'ok'); }
    });
  });
  $('subsPrev').addEventListener('click', function () {
    if (state.subsPage > 0) { state.subsPage--; reloadPeople(); }
  });
  $('subsNext').addEventListener('click', function () {
    state.subsPage++; reloadPeople();
  });

  $('mlSubscribers').addEventListener('change', async function (e) {
    var pick = e.target.closest('[data-status]');
    if (!pick) return;
    pick.disabled = true;
    var res = await fetch(url(), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'subscriber', id: pick.dataset.status, status: pick.value }),
    });
    pick.disabled = false;
    if (!res.ok) { toast(tr('err.refused'), 'bad'); return; }
    toast(tr('ml.statusChanged'), 'ok');
    await load(state.view);
  });

  $('mlSubscribers').addEventListener('submit', function (e) {
    var row = e.target.closest('[data-subrow]');
    if (!row || !e.target.closest('.subs-edit')) return;
    e.preventDefault();
    saveEdit(row);
  });

  $('mlSubscribers').addEventListener('click', async function (e) {
    var ed = e.target.closest('[data-editsub]');
    if (ed) return editRow(ed.dataset.editsub);
    if (e.target.closest('[data-edit-cancel]')) return renderPeople();

    var resend = e.target.closest('[data-resend]');
    if (resend) {
      resend.disabled = true;
      var r, b;
      try {
        r = await fetch(url(), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resend-confirmation', id: resend.dataset.resend }),
        });
        b = await r.json();
      } catch (err) {
        resend.disabled = false;
        toast(tr('err.unreachable') + ' ' + err.message, 'bad');
        return;
      }
      resend.disabled = false;
      if (b && b.sent) toast(fill('ml.resent', { email: b.email }), 'ok');
      else toast((b && (b.error || b.sendError)) || tr('err.refused'), 'bad');
      return;
    }

    var del = e.target.closest('[data-delsub]');
    if (!del) return;

    /* REMOVING SOMEBODY IS REMOVING THEM. No undo, and the dialog says so —
       this is the action taken when a person asks to be forgotten, and a soft
       delete would not honour that. */
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
    await load(state.view);
  });

  load();
})();
