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
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    lists: [], tags: [], scope: 'partner', partnerSlug: '',
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
    return (state.view === 'embed' || state.view === 'composer') ? null : listById(state.view);
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

  function show(view) {
    state.view = view;
    $('mlListView').hidden = view === 'embed' || view === 'composer' || !listById(view);
    $('mlEmbedView').hidden = view !== 'embed';
    $('mlComposerView').hidden = view !== 'composer';

    renderTabs();
    if (view === 'embed') renderEmbeds();
    else if (view !== 'composer') {
      var l = listById(view);
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

  function fillSettings(l) {
    $('mlId').value = l.id || '';
    $('mlName').value = l.name || '';
    $('mlDescription').value = l.description || '';
    $('mlFromName').value = l.from_name || '';
    $('mlFromEmail').value = l.from_email || '';
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

    ['mlId', 'mlName', 'mlDescription', 'mlFromName', 'mlFromEmail', 'mlReplyTo']
      .forEach(function (id) { $(id).value = ''; });
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

    $('mlSubscribers').innerHTML = '<p class="empty">' + esc(tr('common.loading')) + '</p>';

    var res, body;
    try {
      res = await fetch(url('list=' + encodeURIComponent(l.id)),
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

    state.subscribers = body.subscribers || [];
    renderCounts(l);
    renderPeople();
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

  function renderPeople() {
    if (!state.subscribers.length) {
      $('mlSubscribers').innerHTML = '<p class="empty">' + esc(tr('ml.noPeople')) + '</p>';
      return;
    }

    $('mlSubscribers').innerHTML = state.subscribers.map(function (s) {
      return '<div class="ms-row" data-sub="' + esc(s.id) + '">' +
        '<div class="ms-main">' +
          '<div class="ms-t">' +
            '<span class="ms-title">' + esc(s.email) + '</span>' +
            (s.status === 'pending'
              ? '<span class="badge proto">' + esc(tr('ml.status.pending')) + '</span>' : '') +
          '</div>' +
          '<div class="ms-meta">' +
            (s.name ? '<span>' + esc(s.name) + '</span>' : '') +
            '<span>' + esc((s.subscribed_at || '').slice(0, 10)) + '</span>' +
            (s.source ? '<span>' + esc(s.source) + '</span>' : '') +
            (s.tags ? '<span>' + esc(s.tags) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="ms-row-actions">' +
          /* A picker, not a one-way button: a bounced address that starts
             working and somebody asking to come back both need a way forward.
             `pending` shows but is never settable — moving somebody back to
             unconfirmed would be this console claiming they never agreed. */
          '<select class="status-pick" data-status="' + esc(s.id) + '"' +
            ' aria-label="' + esc(tr('ml.statusLabel')) + '">' +
            ['subscribed', 'unsubscribed', 'bounced'].map(function (v) {
              return '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' +
                esc(tr('ml.status.' + v)) + '</option>';
            }).join('') +
            (s.status === 'pending'
              ? '<option value="pending" selected disabled>' +
                  esc(tr('ml.status.pending')) + '</option>' : '') +
          '</select>' +
          (s.status === 'pending'
            ? '<button type="button" data-resend="' + esc(s.id) + '">' +
                esc(tr('ml.resend')) + '</button>' : '') +
          '<button type="button" class="del" data-delsub="' + esc(s.id) + '">' +
            esc(tr('ms.delete')) + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* ---- sign-up forms --------------------------------------------------- */

  function snippetFor(l) {
    return '<div data-thauma-form></div>\n' +
      '<script src="' + location.origin + '/embed/v1/' +
      state.partnerSlug + '/' + l.slug + '/form.js" defer></' + 'script>';
  }

  function renderEmbeds() {
    if (!state.lists.length) {
      $('mlEmbedList').innerHTML = '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
      return;
    }

    $('mlEmbedList').innerHTML = state.lists.map(function (l) {
      if (!l.is_open) {
        /* Said rather than omitted. A list missing from this page looks like a
           bug; a list saying why it has no form is an instruction. */
        /* A TOGGLE, IN PLACE. "Open it" sent somebody to Settings to find a
           switch, which is two screens for one decision that belongs here. */
        return '<div class="ml-embed-card is-closed">' +
          '<h4>' + esc(l.name) + '</h4>' +
          '<p class="hint">' + esc(tr('ml.embedClosed')) + '</p>' +
          '<button type="button" class="switch small" role="switch" aria-checked="false"' +
            ' data-toggle-open="' + esc(l.id) + '">' +
            '<span class="switch-track"><span class="switch-state">Off</span>' +
              '<span class="switch-knob"></span></span>' +
            '<span class="switch-label">' + esc(tr('ml.onTheForm')) + '</span>' +
          '</button>' +
        '</div>';
      }

      var heading = l.form_heading || l.name;
      var button = l.form_button || tr('ml.formPreviewFallback');
      return '<div class="ml-embed-card">' +
        '<h4>' + esc(l.name) + '</h4>' +
        '<div class="ml-embed-split">' +
          '<div class="ml-preview" aria-hidden="true">' +
            '<div class="ml-preview-inner">' +
              '<h4>' + esc(heading) + '</h4>' +
              (l.form_blurb ? '<p>' + esc(l.form_blurb) + '</p>' : '') +
              '<label><span>' + esc(tr('ml.previewName')) + '</span><input disabled></label>' +
              '<label><span>' + esc(tr('ml.previewEmail')) + '</span><input disabled></label>' +
              '<button type="button" disabled>' + esc(button) + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="ml-embed-code">' +
            '<button type="button" class="switch small" role="switch" aria-checked="true"' +
              ' data-toggle-open="' + esc(l.id) + '">' +
              '<span class="switch-track"><span class="switch-state">On</span>' +
                '<span class="switch-knob"></span></span>' +
              '<span class="switch-label">' + esc(tr('ml.onTheForm')) + '</span>' +
            '</button>' +

            /* THE WORDING IS EDITED BESIDE THE PREVIEW OF IT. The restructure
               moved these into Settings and then out again, leaving an "Edit
               the wording" button that led to a panel with no wording in it.
               They belong here: this is the only screen that shows what they
               do. */
            '<div class="ml-wording">' +
              '<label class="fld"><span>' + esc(tr('ml.formHeading')) + '</span>' +
                '<input type="text" maxlength="120" data-word="form_heading"' +
                ' data-list="' + esc(l.id) + '" value="' + esc(l.form_heading || '') + '"' +
                ' placeholder="' + esc(l.name) + '"></label>' +
              '<label class="fld"><span>' + esc(tr('ml.formBlurb')) + '</span>' +
                '<input type="text" maxlength="240" data-word="form_blurb"' +
                ' data-list="' + esc(l.id) + '" value="' + esc(l.form_blurb || '') + '"></label>' +
              '<label class="fld"><span>' + esc(tr('ml.formButton')) + '</span>' +
                '<input type="text" maxlength="40" data-word="form_button"' +
                ' data-list="' + esc(l.id) + '" value="' + esc(l.form_button || '') + '"' +
                ' placeholder="' + esc(tr('ml.formPreviewFallback')) + '"></label>' +
              '<button type="button" class="ghost-btn" data-save-words="' + esc(l.id) + '">' +
                esc(tr('ml.saveWording')) + '</button>' +
            '</div>' +

            '<textarea readonly rows="4" spellcheck="false">' + esc(snippetFor(l)) + '</textarea>' +
            '<button type="button" class="ghost-btn" data-copy="' + esc(l.id) + '">' +
              esc(tr('ml.copy')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
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
    state.partnerSlug = (body.partner && body.partner.slug) || '';

    if (body.may_send_as_organisation) {
      $('mlScope').hidden = false;
      $('mlScopeMine').textContent = (body.partner && body.partner.display_name) || tr('ml.scopeMine');
    }

    /* Where to land: what the caller asked for, then the address bar, then the
       first list. Somebody arriving from a bookmark should get their list. */
    var wanted = keepView || (location.hash || '').slice(1);
    var valid = wanted === 'embed' || wanted === 'composer' || !!listById(wanted);
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
  $('mlOpen').addEventListener('click', function () {
    setSwitch(this, this.getAttribute('aria-checked') !== 'true');
  });

  document.addEventListener('click', function (e) {
    var tab = e.target.closest('[data-view]');
    if (tab) return show(tab.dataset.view);

    var sub = e.target.closest('[data-sub]');
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
      var cl = listById(copy.dataset.copy);
      if (!cl) return;
      var ta = copy.parentNode.querySelector('textarea');
      navigator.clipboard.writeText(snippetFor(cl)).then(function () {
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
  document.addEventListener('input', function (e) {
    var w = e.target.closest('[data-word]');
    if (!w) return;
    var card = w.closest('.ml-embed-card');
    var l = listById(w.dataset.list);
    if (!card || !l) return;
    var val = function (n) {
      var el = card.querySelector('[data-word="' + n + '"]');
      return el ? el.value.trim() : '';
    };
    var inner = card.querySelector('.ml-preview-inner');
    if (!inner) return;
    inner.querySelector('h4').textContent = val('form_heading') || l.name;
    var blurb = inner.querySelector('p');
    var text = val('form_blurb');
    if (text && !blurb) {
      blurb = document.createElement('p');
      inner.insertBefore(blurb, inner.querySelector('label'));
    }
    if (blurb) { blurb.textContent = text; blurb.hidden = !text; }
    inner.querySelector('button').textContent = val('form_button') || tr('ml.formPreviewFallback');
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

  $('mlSubscribers').addEventListener('click', async function (e) {
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
