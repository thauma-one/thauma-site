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

   WRITING FIRST (mockup board 10, "Mail"). The page opens on "Write an
   update" and what has already gone out, every list together; the lists
   follow. The composer is not a tab — a tab bar that mixes "a thing" with "a
   thing you do to all the things" teaches people to read every tab before
   clicking — it opens from Write or Drafts and fills the page.
   ============================================================ */
(function () {
  'use strict';

  /* The element it needs, not the page name — see staff-milestones.js. */
  if (!document.getElementById('mlTabs')) return;

  var API = '/api/staff-mailing';
  var $ = function (id) { return document.getElementById(id); };

  /* WHOSE MAILING. The staff page is the ministry's; Website › Mail in the
     admin console is Thauma's (data-ml-fixed, mail-body.njk). Chase,
     2026-09-27: staff pages for staff work, admin for admin — so there is no
     switch between them on either page any more. */
  var FIXED = $('mlHome').getAttribute('data-ml-fixed') || null;
  var orgAsked = /(\?|&)scope=organization\b/.test(location.search);

  /* OLD LINKS STILL LAND. The part after # never reaches the server, so the
     Worker cannot forward these; this page does. The forms went to Sharing
     (board 9) and Thauma's to Website › Forms; Thauma's lists to Website ›
     Mail, with the list or view they named. */
  if (!FIXED) {
    var hash = (location.hash || '').slice(1);
    var form = { embed: 'signup', contact: 'contact' }[hash];
    if (form) {
      location.replace(orgAsked ? '/admin/website/forms/' : '/staff/sharing/#' + form);
      return;
    }
    if (orgAsked) {
      location.replace('/admin/website/mail/' + location.hash);
      return;
    }
  }

  var startScope = FIXED || 'partner';

  var state = {
    lists: [], tags: [], senders: [], contact: null, topics: [],
    home: 'en', langs: [], writing: 'en', beside: null, listForm: null,
    subsQ: '', subsStatus: '', subsSort: '', subsTag: '', subsPage: 0, picked: [],
    subsTotal: 0, subsPageSize: 100,
    scope: startScope, partnerSlug: '',
    embed: null, mayTheme: false,
    view: null,        // a list id, or 'composer'
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
    var q = state.scope === 'organization' ? '?scope=organization' : '';
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

    $('mlNoLists').hidden = state.lists.length > 0;
    /* A list's settings are for the list on screen; a list being made is
       all settings already. */
    var l = currentList();
    $('mlListSettings').hidden = !l;
    $('mlListSettings').setAttribute('aria-pressed', l && state.sub === 'settings' ? 'true' : 'false');
  }

  /* ---- the first card: write, and the drafts waiting ------------------- */

  function renderHero() {
    var names = state.lists.map(function (l) { return l.name; });
    var lang = (window.StaffI18n && window.StaffI18n.lang) || 'en';
    var joined = names.join(', ');
    try {
      /* "Newsletter, Prayer or Test" in whatever language the console is in,
         with that language's own "or". */
      joined = new Intl.ListFormat(lang, { type: 'disjunction' }).format(names);
    } catch (e) {}
    $('mlHeroTo').textContent = names.length ? fill('ml.writeTo', { lists: joined }) : '';
    $('mlWrite').hidden = !names.length;
    var n = state.lists.reduce(function (sum, l) { return sum + (Number(l.drafts) || 0); }, 0);
    $('mlDrafts').hidden = !n;
    $('mlDrafts').textContent = fill('ml.draftsN', { n: n });
  }

  /* ---- sent, every list together --------------------------------------
     Newest first, five until asked for the rest. Each row opens its public
     copy where the list publishes one; where it does not, the row says so —
     that is how somebody finds the list's switch for it. */
  var SENT_SHOWN = 5;
  function renderSentAll() {
    var rows = [];
    state.lists.forEach(function (l) {
      (l.sent || []).forEach(function (m) { rows.push({ m: m, l: l }); });
    });
    rows.sort(function (a, b) { return String(b.m.finished_at || '').localeCompare(String(a.m.finished_at || '')); });
    $('mlSentAll').hidden = !rows.length;
    var shown = state.sentAll ? rows : rows.slice(0, SENT_SHOWN);
    var origin = window.location.origin;
    $('mlSentRows').innerHTML = shown.map(function (r) {
      var m = r.m, l = r.l;
      var link = l.archive_public && m.slug && state.partnerSlug
        ? origin + '/archive/' + encodeURIComponent(state.partnerSlug) + '/' +
          encodeURIComponent(l.slug) + '/' + encodeURIComponent(m.slug) + '/'
        : null;
      var meta = esc(l.name) + ' · ' +
        esc(m.finished_at ? new Date(m.finished_at).toLocaleDateString() : '') +
        (m.sent_count ? ' · ' + esc(fill('ml.sentTo', { n: m.sent_count })) : '');
      var inner = '<span class="ml-sentall-subject">' + esc(m.subject) + '</span>' +
        '<span class="ml-sentall-meta">' + meta +
          (link ? '' : ' · <i>' + esc(tr('ml.notPublished')) + '</i>') + '</span>';
      return link
        ? '<a class="ml-sentall-row" href="' + esc(link) + '" target="_blank" rel="noopener">' + inner + '</a>'
        : '<div class="ml-sentall-row">' + inner + '</div>';
    }).join('');
    $('mlSentMore').hidden = rows.length <= SENT_SHOWN;
    $('mlSentMore').textContent = state.sentAll ? tr('ml.sentFewer') : fill('ml.sentAllN', { n: rows.length });
  }

  /* ---- drafts, every list together ------------------------------------
     Sent's shape, above it: what is waiting is what somebody came back for.
     A row reopens its draft in the composer. */
  function renderDraftsAll() {
    var rows = [];
    state.lists.forEach(function (l) {
      (l.draft_rows || []).forEach(function (m) { rows.push({ m: m, l: l }); });
    });
    rows.sort(function (a, b) { return String(b.m.created_at || '').localeCompare(String(a.m.created_at || '')); });
    $('mlDraftsAll').hidden = !rows.length;
    $('mlDraftRows').innerHTML = rows.map(function (r) {
      var m = r.m, l = r.l;
      var meta = esc(l.name) + ' · ' +
        esc(m.created_at ? new Date(m.created_at).toLocaleDateString() : '');
      return '<button type="button" class="ml-sentall-row" data-open-draft="' + esc(m.id) +
          '" data-draft-list="' + esc(l.id) + '">' +
        '<span class="ml-sentall-subject' + (m.subject ? '' : ' is-untitled') + '">' +
          esc(m.subject || tr('ml.cpUntitled')) + '</span>' +
        '<span class="ml-sentall-meta">' + meta + '</span></button>';
    }).join('');
  }

  /* The tool tabs — the views that are not a list. Kept as one list so a new
     one cannot be added to the tab bar and forgotten here, which is what
     leaves a tab that highlights and shows nothing. */
  var TOOLS = ['composer'];

  /* ONE VIEW AT A TIME, found by what the markup says it is rather than by a
     list of ids kept here.

     mlContactView was added months after this list and never joined it, so
     opening the contact form and then pressing New list left the contact form
     on screen underneath the new list's fields — two forms, one page, and no
     way to tell which one a Save belonged to. newList() had its own copy of
     the same list, with the same omission.

     Every section carries data-view. A view that exists is a view that hides,
     and the next tool cannot be forgotten because there is nothing to add. */
  function onlyView(which) {
    Array.prototype.forEach.call(document.querySelectorAll('.ml-view'), function (v) {
      v.hidden = v.dataset.view !== which;
    });
  }

  function show(view) {
    state.view = view;
    var isTool = TOOLS.indexOf(view) >= 0;
    onlyView(isTool ? view : (listById(view) ? 'list' : null));
    /* The composer fills the page; everything else sits under the first card. */
    $('mlHome').hidden = view === 'composer';
    if (listById(view)) state.lastList = view;

    renderTabs();
    if (view !== 'composer') {
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

    /* SURVIVES A RELOAD: the view is in the address. Whose mailing it is,
       is the page itself. In the Website area every tab is one page, so the
       address is only this tab's to change while this tab is on screen. */
    if (FIXED && !onScreen()) return;
    try { history.replaceState(null, '', location.pathname + '#' + view); } catch (e) {}
  }
  function onScreen() {
    var panel = $('mlHome').closest('[data-web-panel]');
    return !panel || !panel.hidden;
  }

  function showSub(which) {
    state.sub = which;
    $('mlListSettings').setAttribute('aria-pressed', which === 'settings' && currentList() ? 'true' : 'false');
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
       empty dropdown that reads as broken. Only then: with addresses to pick
       from, the dropdown needs no words beside it. */
    var none = $('mlFromNone');
    if (none) {
      none.textContent = state.senders.length ? '' : tr('ml.fromNone');
      none.hidden = !!state.senders.length;
    }
  }

  /* ---- a list's name and description, one language at a time (0047) ----
     Chase, 2026-10-01: "We need to fix that on Goals and Sign Up." name and
     description are the ministry's own language and the fallback; `texts`
     holds the others as { lang: { name, description } }. */
  function langLabel(code) {
    var l = state.langs.filter(function (x) { return x.code === code; })[0];
    return l ? l.name : code;
  }
  /* One language's wording: the ministry's own is the columns, the rest `texts`. */
  function listText(f, code, field) {
    return code === state.home ? (f[field] || '') : ((f.texts[code] || {})[field] || '');
  }
  /* The two boxes into the form's copy, for the language being edited. */
  function keepListWriting() {
    var f = state.listForm, w = state.writing;
    if (!f) return;
    var name = $('mlName').value, desc = $('mlDescription').value;
    if (w === state.home) { f.name = name; f.description = desc; return; }
    var t = Object.assign({}, f.texts[w] || {});
    if (name.trim()) t.name = name; else delete t.name;
    if (desc.trim()) t.description = desc; else delete t.description;
    if (Object.keys(t).length) f.texts[w] = t; else delete f.texts[w];
  }
  /* "Editing X, Reference Y" — the milestone editor's pair. Reference lists
     the other languages and opens on one that has words; its wording sits
     small above each box, tagged with its language, which is what
     console-translate.js translates from. */
  function drawListWriting() {
    var f = state.listForm, w = state.writing;
    var named = function (c) { return !!listText(f, c, 'name').trim(); };
    $('mlWriting').hidden = state.langs.length < 2;
    $('mlLang').innerHTML = state.langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(l.name) +
        (named(l.code) ? '' : ' · ' + esc(tr('ms.missing'))) + '</option>';
    }).join('');
    $('mlLang').value = w;
    var others = state.langs.filter(function (l) { return l.code !== w; });
    if (!others.some(function (l) { return l.code === state.beside; })) {
      var best = others.filter(function (l) { return named(l.code); })[0] || others[0];
      state.beside = best ? best.code : null;
    }
    $('mlBesideWrap').hidden = !others.length;
    $('mlBeside').innerHTML = others.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc(l.name) + '</option>';
    }).join('');
    $('mlBeside').value = state.beside || '';
    $('mlName').value = listText(f, w, 'name');
    $('mlDescription').value = listText(f, w, 'description');
    /* Only the list's own name is required; a translation may be left for later. */
    $('mlName').required = w === state.home;
    var b = state.beside;
    [['mlNameRef', 'name'], ['mlDescriptionRef', 'description']].forEach(function (r) {
      var v = b ? listText(f, b, r[1]) : '';
      $(r[0]).hidden = !v;
      $(r[0]).textContent = v;
      if (b) { $(r[0]).setAttribute('lang', b); $(r[0]).title = langLabel(b); }
    });
  }
  function startListForm(l) {
    state.listForm = { name: (l && l.name) || '', description: (l && l.description) || '',
                       texts: JSON.parse(JSON.stringify((l && l.texts) || {})) };
    state.writing = state.home;
    state.beside = null;
    drawListWriting();
  }
  /* Switching either language keeps what was typed first. */
  [['mlLang', 'writing'], ['mlBeside', 'beside']].forEach(function (cfg) {
    $(cfg[0]).addEventListener('change', function () {
      keepListWriting();
      state[cfg[1]] = this.value;
      drawListWriting();
    });
  });

  function fillSettings(l) {
    $('mlId').value = l.id || '';
    startListForm(l);
    $('mlFromName').value = l.from_name || '';
    fillSenders(l.from_email || '');
    $('mlReplyTo').value = l.reply_to || '';
    setSwitch($('mlOpen'), !!l.is_open);
    setSwitch($('mlArchivePublic'), !!l.archive_public);
    setStatus($('mlFormStatus'), '');

    $('mlArchive').hidden = !l.id;
  }

  function newList() {
    state.view = null;
    onlyView('list');
    $('mlHome').hidden = false;
    renderTabs();

    ['mlId', 'mlFromName', 'mlReplyTo']
      .forEach(function (id) { $(id).value = ''; });
    startListForm(null);
    fillSenders('');
    setSwitch($('mlOpen'), false);
    setSwitch($('mlArchivePublic'), false);
    $('mlArchive').hidden = true;
    setStatus($('mlFormStatus'), '');

    showSub('settings');
    $('mlName').focus();
  }

  async function submitSettings(e) {
    e.preventDefault();
    keepListWriting();
    var f = state.listForm;
    /* The list's own name is what every language falls back to. */
    if (!f.name.trim()) {
      state.writing = state.home; drawListWriting(); $('mlName').reportValidity(); return;
    }
    var payload = {
      id: $('mlId').value || undefined,
      name: f.name.trim(),
      description: f.description.trim(),
      texts: f.texts,
      from_name: $('mlFromName').value.trim(),
      from_email: $('mlFromEmail').value,
      reply_to: $('mlReplyTo').value.trim(),
      is_open: $('mlOpen').getAttribute('aria-checked') === 'true',
      archive_public: $('mlArchivePublic').getAttribute('aria-checked') === 'true',
    };
    /* as this form loaded it, so a save from another site since is caught */
    var opened = payload.id && currentList();
    if (opened && opened.id === payload.id) payload.updated_at = opened.updated_at;
    return sendSettings(payload);
  }

  async function sendSettings(payload) {
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
    /* Saved by someone else since it loaded (workers/src/lib/fresh.js): ask.
       Saving mine sends it again with overwrite; keeping theirs reloads. */
    if (res.status === 409 && body.changed) {
      setStatus($('mlFormStatus'), '');
      if (await window.StaffChanged(body)) return sendSettings(Object.assign({}, payload, { overwrite: true }));
      await load(state.view);
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
        /* One box to take the whole page. Not the whole LIST — a control that
           silently selects three hundred people you cannot see is one that
           gets pressed by accident exactly once. */
        '<th class="subs-pick"><input type="checkbox" id="subsAll" ' +
          'aria-label="' + esc(tr('ml.selectPage')) + '"></th>' +
        '<th data-i18n="ml.colWho">Who</th>' +
        '<th data-i18n="ml.colStatus">Status</th>' +
        '<th data-i18n="ml.colJoined">Joined</th>' +
        '<th data-i18n="ml.colTags">Tags</th>' +
        '<th><span class="vh" data-i18n="ml.colActions">Actions</span></th>' +
      '</tr></thead>';

    if (!state.subscribers.length) {
      var why = (state.subsQ || state.subsStatus) ? 'ml.noMatches' : 'ml.noPeople';
      $('mlSubscribers').innerHTML = head +
        '<tbody><tr><td colspan="6" class="subs-empty">' +
        esc(tr(why)) + '</td></tr></tbody>';
      renderBulk();
      return;
    }

    $('mlSubscribers').innerHTML = head + '<tbody>' + state.subscribers.map(function (s) {
      return '<tr data-subrow="' + esc(s.id) + '">' +
        '<td class="subs-pick"><input type="checkbox" data-pick="' + esc(s.id) + '"' +
          (state.picked.indexOf(s.id) >= 0 ? ' checked' : '') +
          ' aria-label="' + esc(tr('ml.select') + ' ' + s.email) + '"></td>' +
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
    renderBulk();
  }

  /* ---- acting on many at once ----------------------------------------
     The bar appears only when something is selected. A row of destructive
     buttons sitting there permanently is a row somebody eventually presses
     without a selection in mind. */
  function renderBulk() {
    var bar = $('subsBulk');
    if (!bar) return;
    var n = state.picked.length;
    bar.hidden = !n;
    if (!n) return;
    $('subsBulkCount').textContent = fill('ml.nSelected', { n: n });

    /* The tag pickers are filled from the same list as everything else, and
       hidden entirely when there are no tags — offering "add tag" with nothing
       to add is a dead end. */
    var opts = '<option value="">' + esc(tr('ml.chooseTag')) + '</option>' +
      (state.tags || []).map(function (t) {
        return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
      }).join('');
    $('subsBulkTag').innerHTML = opts;
    $('subsBulkTagWrap').hidden = !(state.tags || []).length;

    var all = $('subsAll');
    if (all) {
      var onPage = state.subscribers.map(function (x) { return x.id; });
      var picked = onPage.filter(function (id) { return state.picked.indexOf(id) >= 0; });
      all.checked = onPage.length > 0 && picked.length === onPage.length;
      /* Neither on nor off when some of the page is chosen — the box has to be
         able to say "partly", or it lies on every mixed selection. */
      all.indeterminate = picked.length > 0 && picked.length < onPage.length;
    }
  }

  function pick(id, on) {
    var at = state.picked.indexOf(id);
    if (on && at < 0) state.picked.push(id);
    if (!on && at >= 0) state.picked.splice(at, 1);
  }

  async function runBulk(what) {
    var n = state.picked.length;
    if (!n) return;

    var tagId = $('subsBulkTag').value;
    if ((what === 'tag-add' || what === 'tag-remove') && !tagId) {
      toast(tr('ml.chooseTagFirst'), 'bad');
      return;
    }
    var tag = (state.tags || []).filter(function (t) { return t.id === tagId; })[0];

    var ask = {
      'unsubscribed': { body: fill('ml.bulkUnsub', { n: n }), danger: true },
      'bounced':      { body: fill('ml.bulkBounce', { n: n }), danger: true },
      'delete':       { body: fill('ml.bulkDelete', { n: n }), danger: true,
                        note: tr('ml.bulkDeleteNote'), type: 'DELETE' },
      'tag-add':      { body: fill('ml.bulkTagAdd', { n: n, tag: tag && tag.name }) },
      'tag-remove':   { body: fill('ml.bulkTagRemove', { n: n, tag: tag && tag.name }) },
    }[what];
    if (!ask) return;

    var ok = await window.StaffConfirm({
      title: fill('ml.bulkTitle', { n: n }), body: ask.body, note: ask.note || '',
      type: ask.type, typeLabel: ask.type ? fill('ml.nSelected', { n: n }) + ' —' : undefined,
      confirm: tr('ml.bulkDo'), cancel: tr('ms.cancel'), danger: !!ask.danger,
    });
    if (!ok) return;

    var body = await postJson({
      action: 'subscribers-bulk', what: what, ids: state.picked, tag: tagId || undefined,
    });
    if (body.error) { toast(body.error, 'bad'); return; }

    /* The selection is dropped afterwards. Leaving forty people ticked after
       acting on them invites the next action to land on the same forty by
       accident. */
    state.picked = [];
    await loadPeople();
    toast(fill('ml.bulkDone', { n: body.count }), 'ok');
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

  /* THE SIGN-UP FORM AND THE CONTACT FORM LIVE ON SHARING now (mockup
     board 9), with the four widgets, the colors and the code: all six are the
     same kind of thing, something on another website. */

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
          res.status === 401 ? tr('err.expired')
            : (body.error || tr('err.refused') + ' (' + res.status + ')'),
          res.status === 401 ? null : load);
      }
      return;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    if (window.StaffActing) window.StaffActing(body);

    state.lists = body.lists || [];
    /* The languages a list's name is written in, the ministry's own first. */
    state.home = body.default_lang || 'en';
    state.langs = body.languages || [];
    if (!state.langs.some(function (l) { return l.code === state.home; })) {
      state.langs.unshift({ code: state.home, name: state.home });
    } else {
      state.langs.sort(function (a, b) { return (a.code === state.home ? -1 : 0) - (b.code === state.home ? -1 : 0); });
    }
    state.tags = body.tags || [];
    renderTags();
    renderHero();
    state.senders = body.senders || [];
    state.mayTheme = !!body.may_theme;
    state.partnerSlug = (body.partner && body.partner.slug) || '';
    renderSentAll();
    renderDraftsAll();


    /* Where to land: what the caller asked for, then the address bar, then the
       first list. Somebody arriving from a bookmark should get their list. */
    var wanted = keepView || (location.hash || '').slice(1);
    /* #drafts: Home's "Open" beside the drafts not sent (board "Home"). The
       composer is a deferred script, so it may not be there yet. */
    if (wanted === 'drafts' && state.lists.length) {
      var toDrafts = function () { openComposer('drafts'); };
      if (window.StaffComposer) toDrafts();
      else window.addEventListener('load', toDrafts, { once: true });
      return;
    }
    var valid = TOOLS.indexOf(wanted) >= 0 || !!listById(wanted);
    /* With no list there is nothing to write to: the page itself, with New
       list, rather than a composer with an empty picker and no way out. */
    if (wanted === 'composer' && !state.lists.length) valid = false;
    show(valid ? wanted : firstList());
  }

  /* WHOSE LISTS THE WHOLE PAGE IS SHOWING, read by the composer — a separate
     file, the same screen, one decision. (Lost once when the forms moved to
     Sharing, and the composer quietly wrote to the ministry's lists while the
     page showed Thauma's; test/mailing-views.test.mjs holds it now.) `changed`
     is the composer saying a save or a send moved the drafts or the sent. */
  window.StaffMailing = {
    scope: function () { return state.scope; },
    changed: function (body) {
      if (!body || body.scope !== state.scope || !body.lists) return;
      state.lists = body.lists;
      renderHero();
      renderSentAll();
      renderDraftsAll();
      renderTabs();
    }
  };

  function firstList() {
    return listById(state.lastList) ? state.lastList : (state.lists[0] ? state.lists[0].id : '');
  }
  function openComposer(how) {
    var from = currentList();
    show('composer');
    var c = window.StaffComposer;
    if (!c) return;
    if (how === 'drafts') c.drafts(); else c.write(from ? from.id : null);
  }

  /* ---- wiring ---------------------------------------------------------- */

  $('mlNewList').addEventListener('click', newList);
  $('mlWrite').addEventListener('click', function () { openComposer('write'); });
  $('mlDrafts').addEventListener('click', function () { openComposer('drafts'); });
  /* BACK SAVES. It only ever hid the composer, so an unsaved draft stayed
     in a page nobody returned to and was gone at the next reload — which read
     as Back deleting it. Saved first now; if that fails, the composer stays
     open with the words in it. */
  $('mlBack').addEventListener('click', function () {
    var c = window.StaffComposer;
    if (!c || !c.flush) { show(firstList()); return; }
    c.flush().then(function (ok) { if (ok) show(firstList()); });
  });
  $('mlListSettings').addEventListener('click', function () {
    if (!currentList()) return;
    showSub(state.sub === 'settings' ? 'people' : 'settings');
  });
  $('mlDraftRows').addEventListener('click', function (e) {
    var row = e.target.closest('[data-open-draft]');
    if (!row) return;
    show('composer');
    var c = window.StaffComposer;
    if (c && c.open) c.open(row.dataset.draftList, row.dataset.openDraft);
  });
  $('mlSentMore').addEventListener('click', function () {
    state.sentAll = !state.sentAll;
    renderSentAll();
  });
  $('mlForm').addEventListener('submit', submitSettings);

  /* CANCEL PUTS IT BACK. On an existing list, the saved values return; on one
     being created, there is nothing to return to, so it leaves — a form with
     no list behind it is a dead end, and the way out was previously to click
     another tab and hope. */
  $('mlCancel').addEventListener('click', function () {
    var l = currentList();
    if (l) { fillSettings(l); showSub('people'); return; }
    show(firstList());
  });
  $('mlArchive').addEventListener('click', archive);
  $('mlArchivePublic').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });

  $('mlOpen').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });

  document.addEventListener('click', function (e) {
    /* SCOPED TO THE TAB STRIP, for exactly the reason the sub-tabs below are.

       This read `closest('[data-view]')` anywhere on the page. That was fine
       while only the tab buttons carried the attribute — and then the view
       SECTIONS were given data-view too, so that one view could be shown and
       the rest hidden by what the markup says they are rather than by a list
       of ids kept in two places.

       Which meant every field in a view had an ancestor carrying data-view.
       Clicking any box in the contact editor matched the section, called
       show('contact'), and re-rendered the whole form: the caret was thrown
       out, typed characters were replaced by the saved values, and pressing
       Save re-rendered the fields BEFORE the submit handler read them, so an
       edited address was saved back exactly as it had been. Three symptoms,
       one selector.

       The fix is the same one already written a few lines down for data-sub,
       where subscriber rows collided with the sub-tabs. An attribute that
       means "this is a tab" cannot also mean "this is what a tab shows". */
    var tab = e.target.closest('.ml-tabs [data-view]');
    if (tab) return show(tab.dataset.view);

    /* The subscriber rows carry data-subrow, never data-sub or data-view:
       an attribute that means "this is a tab" cannot also mean "this is a
       person" (a click on a person once blanked the page). The Subscribers
       and Settings tabs became the List settings button (board 10). */
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
                               email: email, name: '' }),
      });
      body = await res.json();
    } catch (err) {
      setStatus($('mlAddStatus'), tr('err.unreachable') + ' ' + err.message);
      return;
    }
    if (!res.ok) { setStatus($('mlAddStatus'), body.error || tr('err.refused')); return; }

    $('mlNewEmail').value = '';
    setStatus($('mlAddStatus'), '');

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
  /* THE SELECTION DOES NOT SURVIVE A CHANGE OF WHAT IS ON SCREEN. Carrying it
     across a search means acting on people the current list does not show, and
     the count in the bar would be the only clue. */
  function reloadPeople() { state.picked = []; loadPeople(); }

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

  $('mlSubscribers').addEventListener('change', function (e) {
    if (e.target.id === 'subsAll') {
      /* The page, not the list. Selecting people you cannot see is how a bulk
         delete becomes a surprise. */
      var on = e.target.checked;
      state.subscribers.forEach(function (s) { pick(s.id, on); });
      [].forEach.call(document.querySelectorAll('[data-pick]'), function (b) {
        b.checked = on;
      });
      renderBulk();
      return;
    }
    if (e.target.dataset && e.target.dataset.pick) {
      pick(e.target.dataset.pick, e.target.checked);
      renderBulk();
    }
  }, true);

  $('subsBulk').addEventListener('click', function (e) {
    var b = e.target.closest('[data-bulk]');
    if (b) runBulk(b.dataset.bulk);
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
       delete would not honor that. */
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
