/* ============================================================
   admin-content.js — every word the site says, in every language
   ============================================================
   One page for the words and for the languages they are in
   (Chase, 2026-09-27). Three servers behind it:

     /api/admin/translate          every line of one language —
                                   the site's pages and the emails
                                   and forms — with the English and
                                   whether it is missing or
                                   outdated; saving; the file for
                                   a translator and approving what
                                   comes back
     /api/admin/content            site.json: a language's dev and
                                   live switches, the default, the
                                   donation form; adding and
                                   removing a language
     /api/admin/translation-notes  how each language is written

   THE WORDS USE THE WORKING-COPY MODEL. Copy is edited in
   passes, and half a rewritten sentence must never reach the
   site: `saved` is what the repository holds, `draft` is the
   screen, and nothing crosses without Save. A save is a quiet
   commit; Publish is a separate act on a separate page.

   THE SETTINGS SAVE AS THEY ARE CHANGED, like Settings: each is
   one decision with an obvious result, and none is live before
   Publish either.

   WHAT YOU SEE IS WHAT YOU DOWNLOAD. The translator's file holds
   the lines on screen — a section, a search, Needs work, All —
   and the button says how many, so choosing lines needs no
   controls of its own.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'content') return;

  var CONTENT = '/api/admin/content';
  var WORDS = '/api/admin/translate';
  var NOTES = '/api/admin/translation-notes';
  var ADD = '__add';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    site: null, siteSha: null,
    langs: [], lang: null, names: {},
    lines: [], saved: {}, draft: {}, blocked: {},
    view: null, find: '',
    notes: { keep: [], glossary: [], guides: {} }, notesWrite: false,
    review: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  /* Translate and substitute together — see StaffI18n.fill. */
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* ---- talking to the servers ---------------------------------------- */

  /* One path for every request. A page that cannot load says so and offers
     to try again (StaffProblem); a refused change is a toast; either way the
     caller gets the answer back to read its code. THREE FAILURES, THREE
     MESSAGES: the network, the server's refusal, an unreadable answer. */
  async function send(url, method, body, quiet) {
    var res, data;
    try {
      res = await fetch(url, {
        method: method || 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, boot);
      return null;
    }
    try { data = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', boot);
      return null;
    }
    data.status = res.status;
    if (!res.ok) {
      data.failed = true;
      if (res.status === 403 && url.indexOf(CONTENT) === 0 && (!method || method === 'GET')) {
        if ($('notAdmin')) $('notAdmin').hidden = false;
        $('cRoot').hidden = true;
        document.querySelector('.c-bar').hidden = true;
      } else if ((!method || method === 'GET') && !quiet && window.StaffProblem) {
        window.StaffProblem(res.status === 401 ? tr('err.expired')
          : tr('err.refused') + ' (' + res.status + ')' + (data.error ? ' — ' + data.error : ''),
          res.status === 401 ? null : boot);
      }
      return data;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    return data;
  }

  function refused(data) { toast((data && data.error) || tr('err.refused'), 'err'); }

  /* ---- names and places ---------------------------------------------- */

  /* What a language calls itself: its own `name` line once its words are
     loaded, the browser's endonym before that, the code in brackets always. */
  function langName(code) {
    if (state.names[code]) return state.names[code];
    try {
      var n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* a code Intl does not know */ }
    return code;
  }
  function langLabel(code) { return langName(code) + ' (' + code + ')'; }

  /* The section a line belongs to: the page of the site it is on, or the
     emails and forms. Top-level lines (the language's name) gather under one
     heading rather than each being a section of one. */
  function sectionOf(line) {
    if (line.source === 'emails') return 'emails';
    return line.key.indexOf('.') === -1 ? '_general' : line.key.split('.')[0];
  }
  function sectionLabel(s) {
    if (s === '_general') return tr('con.general');
    if (s === 'emails') return tr('tl.src.emails');
    // Page names name files and URL segments — typed, not read — so they are
    // shown as they are rather than translated.
    return s.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function shortKey(line) {
    return line.source === 'emails' || line.key.indexOf('.') === -1
      ? line.key : line.key.slice(line.key.indexOf('.') + 1);
  }
  /* `home.who_h2_bold` -> "Who h2 bold": mechanical, with the key kept
     underneath. A confidently wrong label is worse than a plain one. */
  function readable(line) {
    return shortKey(line).replace(/[._]/g, ' ')
      .replace(/\b\d+\b/g, function (n) { return '#' + n; })
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  var isEn = function () { return state.lang === 'en'; };
  function needsWork(line) { return !isEn() && line.status !== 'done'; }
  function dirtyIds() {
    return state.lines.filter(function (l) { return state.draft[l.id] !== state.saved[l.id]; })
      .map(function (l) { return l.id; });
  }

  /* ---- loading -------------------------------------------------------- */

  async function boot() {
    var site = await send(CONTENT + '?file=site');
    if (!site || site.failed) return;
    if (site.configured === false) return notConfigured(site.reason || site.error || '');
    takeSite(site);

    var notes = await send(NOTES, 'GET', null, true);
    if (notes && !notes.failed) takeNotes(notes);

    var remembered = null;
    try { remembered = localStorage.getItem('thauma.content.lang'); } catch (e) { /* private mode */ }
    var want = state.langs.indexOf(state.lang) !== -1 ? state.lang
      : (state.langs.indexOf(remembered) !== -1 ? remembered : state.langs[0]);
    fillPicker();
    $('cLang').disabled = false;
    $('cLangSet').disabled = false;
    await openLang(want);
  }

  function takeSite(site) {
    state.site = site.data;
    state.siteSha = site.sha;
    state.langs = (site.data && site.data.languages) || ['en'];
  }

  function notConfigured(reason) {
    var el = $('cNotConfigured');
    el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(reason);
    el.hidden = false;
    $('cRoot').hidden = true;
    document.querySelector('.c-bar').hidden = true;
  }

  function fillPicker() {
    /* Adding a language is the last choice in the list of languages, where
       somebody looking for one that is not there is already looking. */
    $('cLang').innerHTML = state.langs.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langLabel(c)) + '</option>';
    }).join('') + '<option value="' + ADD + '">' + esc(tr('con.addLang')) + '…</option>';
    $('cLang').value = state.lang || state.langs[0];
  }

  async function openLang(code, keepView) {
    var data = await send(WORDS + '?lang=' + encodeURIComponent(code));
    if (!data || data.failed) { $('cLang').value = state.lang || ''; return false; }
    state.lang = code;
    if (data.name && data.name !== code) state.names[code] = data.name;
    state.lines = data.lines || [];
    state.saved = {}; state.draft = {}; state.blocked = {};
    state.lines.forEach(function (l) { state.saved[l.id] = l.current; state.draft[l.id] = l.current; });
    try { localStorage.setItem('thauma.content.lang', code); } catch (e) { /* private mode */ }

    /* Where to start: what needs doing, if anything does; otherwise the first
       page — or, after a save, wherever you were. */
    if (!keepView || !viewExists(state.view)) {
      state.view = state.lines.some(needsWork) ? 'needs'
        : 'section:' + (orderedSections()[0] || '_general');
    }
    fillPicker();
    $('cRoot').hidden = !!state.review;
    render();
    return true;
  }

  /* The pages in the order the site has them, then the emails and forms;
     the language's own name — one line, set once — last rather than first. */
  function orderedSections() {
    var out = [];
    state.lines.forEach(function (l) { var s = sectionOf(l); if (out.indexOf(s) === -1) out.push(s); });
    return out.filter(function (s) { return s !== '_general'; })
      .concat(out.indexOf('_general') !== -1 ? ['_general'] : []);
  }

  function viewExists(v) {
    if (!v) return false;
    if (v === 'all') return true;
    if (v === 'needs') return state.lines.some(needsWork);
    return state.lines.some(function (l) { return 'section:' + sectionOf(l) === v; });
  }

  /* ---- drawing -------------------------------------------------------- */

  function visible() {
    if (state.find) {
      var q = state.find.toLowerCase();
      return state.lines.filter(function (l) {
        return l.key.toLowerCase().indexOf(q) >= 0 ||
          String(state.draft[l.id]).toLowerCase().indexOf(q) >= 0 ||
          l.english.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (state.view === 'all') return state.lines;
    if (state.view === 'needs') return state.lines.filter(needsWork);
    return state.lines.filter(function (l) { return 'section:' + sectionOf(l) === state.view; });
  }

  function render() {
    renderSections();
    renderRows();
    renderBar();
    renderSaveBar();
  }

  function renderSections() {
    var sections = [], counts = {};
    orderedSections().forEach(function (s) { counts[s] = { n: 0, needs: 0, dirty: 0 }; sections.push(s); });
    state.lines.forEach(function (l) {
      var s = sectionOf(l);
      counts[s].n++;
      if (needsWork(l)) counts[s].needs++;
      if (state.draft[l.id] !== state.saved[l.id]) counts[s].dirty++;
    });
    var needs = state.lines.filter(needsWork).length;
    var on = state.find ? null : state.view;

    function button(view, label, n, extra, dirty) {
      return '<button type="button" class="c-sec' + (view === on ? ' is-on' : '') + (dirty ? ' is-dirty' : '') +
        '" data-view="' + esc(view) + '"' + (view === on ? ' aria-current="true"' : '') + '>' +
        '<span class="c-sec-n">' + esc(label) + '</span>' +
        '<span class="c-sec-c tnum">' + n + '</span>' + (extra || '') + '</button>';
    }

    $('cSections').innerHTML =
      (needs ? button('needs', tr('con.needsWork'), needs, '', false) : '') +
      button('all', tr('con.all'), state.lines.length, '', false) +
      '<span class="c-sec-rule" aria-hidden="true"></span>' +
      sections.map(function (s) {
        var c = counts[s];
        return button('section:' + s, sectionLabel(s), c.n,
          c.needs ? '<span class="c-sec-empty">' + c.needs + '</span>' : '', c.dirty);
      }).join('');
  }

  function renderRows() {
    var lines = visible();
    $('cCount').textContent = state.find ? lines.length + ' ' + tr('con.matches') : '';
    if (!lines.length) {
      $('cRows').innerHTML = '<p class="empty">' + esc(tr('con.noMatches')) + '</p>';
      return;
    }
    var en = isEn();
    $('cRows').innerHTML = lines.map(function (l) {
      var dirty = state.draft[l.id] !== state.saved[l.id];
      var mark = needsWork(l) && !dirty ? l.status : '';
      return '<div class="c-row' + (dirty ? ' is-dirty' : '') + (mark ? ' is-' + mark : '') +
          (state.blocked[l.id] ? ' is-blocked' : '') + '" data-id="' + esc(l.id) + '">' +
        '<div class="c-key">' +
          '<span class="c-name">' + esc(readable(l)) + '</span>' +
          '<code>' + esc(state.find ? l.key : shortKey(l)) + '</code>' +
          (mark ? '<span class="tl-st is-' + mark + '">' + esc(tr('tl.status.' + mark)) + '</span>' : '') +
          (dirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
        '</div>' +
        '<div class="c-edit">' +
          (en ? '' : '<p class="c-en" lang="en">' + esc(l.english) + '</p>') +
          /* Named by the line it edits and the language of this copy of it:
             one box among hundreds needs both. */
          '<textarea rows="1" data-id="' + esc(l.id) + '" lang="' + esc(state.lang) + '" spellcheck="true"' +
            ' aria-label="' + esc(readable(l) + ' — ' + langName(state.lang)) + '">' +
            esc(state.draft[l.id]) + '</textarea>' +
        '</div>' +
      '</div>';
    }).join('');
    $('cRows').querySelectorAll('textarea').forEach(autosize);
  }

  function renderBar() {
    /* The file and the upload are for translating, so English has neither. */
    var n = visible().length;
    $('cDown').hidden = isEn();
    $('cUp').hidden = isEn();
    $('cDown').textContent = n === 1 ? tr('con.download1') : fill('con.downloadN', { n: n });
    $('cDown').disabled = !n || !!state.review;
    $('cUp').disabled = !!state.review;
  }

  function autosize(ta) {
    if (window.CSS && CSS.supports && CSS.supports('field-sizing', 'content')) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px';
  }

  function renderSaveBar() {
    var d = dirtyIds();
    $('cSaveBar').hidden = !d.length;
    document.body.classList.toggle('has-savebar', !!d.length);
    if (!d.length) return;
    $('cDirtyCount').textContent = d.length === 1 ? tr('con.oneChange') : d.length + ' ' + tr('con.nChanges');
  }

  /* ---- editing -------------------------------------------------------- */

  $('cRows').addEventListener('input', function (e) {
    var ta = e.target;
    if (ta.tagName !== 'TEXTAREA') return;
    var id = ta.getAttribute('data-id');
    state.draft[id] = ta.value;
    delete state.blocked[id];
    autosize(ta);
    // The row's own marks change without a redraw, which would take the
    // focus out of the box being typed into.
    var row = ta.closest('.c-row');
    row.classList.toggle('is-dirty', state.draft[id] !== state.saved[id]);
    row.classList.remove('is-blocked');
    renderSaveBar();
    renderSections();
  });

  $('cSections').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    state.view = b.getAttribute('data-view');
    // A section and a search are two ways of choosing what is on screen;
    // leaving both on shows neither.
    if (state.find) { state.find = ''; $('cFind').value = ''; }
    renderSections(); renderRows(); renderBar();
  });

  var findTimer = null;
  $('cFind').addEventListener('input', function (e) {
    clearTimeout(findTimer);
    var v = e.target.value.trim();
    findTimer = setTimeout(function () {
      state.find = v;
      renderSections(); renderRows(); renderBar();
    }, 150);
  });

  /* Leaving unsaved words behind is a choice, never a silent one. */
  async function mayLeave() {
    var n = dirtyIds().length;
    if (!n) return true;
    return window.StaffConfirm({
      title: tr('con.leaveTitle'),
      body: fill('con.leaveBody', { n: n, lang: langLabel(state.lang) }),
      confirm: tr('con.leaveDiscard'), cancel: tr('ms.cancel'), danger: true
    });
  }

  $('cLang').addEventListener('change', async function (e) {
    var next = e.target.value;
    e.target.value = state.lang;
    if (next === ADD) return addLanguage();
    if (!(await mayLeave())) return;
    if (state.review) closeReview();
    await openLang(next);
  });

  $('cDiscard').addEventListener('click', async function () {
    var n = dirtyIds().length;
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: tr('con.discardTitle'), body: fill('con.discardBody', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.lines.forEach(function (l) { state.draft[l.id] = state.saved[l.id]; });
    state.blocked = {};
    render();
  });

  $('cReload').addEventListener('click', async function () {
    if (!state.lang) return;
    var n = dirtyIds().length;
    if (n) {
      var ok = await window.StaffConfirm({
        title: tr('con.reloadTitle'), body: fill('con.reloadBody', { n: n }),
        confirm: tr('con.reload'), cancel: tr('ms.cancel'), danger: true
      });
      if (!ok) return;
    }
    var btn = this;
    btn.disabled = true;
    try { if (await openLang(state.lang, true)) toast(tr('con.reloaded'), 'ok'); }
    finally { btn.disabled = false; }
  });

  /* A save is a quiet commit — nothing is live before Publish — so it asks
     nothing. The server checks every line again: a lost {placeholder} is
     refused, and a line somebody else changed meanwhile is left as theirs. */
  $('cSave').addEventListener('click', async function () {
    var ids = dirtyIds();
    if (!ids.length) return;
    var btn = this;
    btn.disabled = true; $('cDiscard').disabled = true;
    var data = await send(WORDS, 'POST', { action: 'save', lang: state.lang, items: ids.map(function (id) {
      return { id: id, value: state.draft[id], was: state.saved[id] };
    }) });
    btn.disabled = false; $('cDiscard').disabled = false;
    if (!data) return;
    if (data.failed) {
      if (data.code === 'problems' && data.ids) {
        data.ids.forEach(function (id) { state.blocked[id] = true; });
        renderRows();
        return toast(tr('tl.problems'), 'err');
      }
      return refused(data);
    }
    var kept = {};
    ids.forEach(function (id) { kept[id] = state.draft[id]; });
    toast(fill('con.saved', { n: data.saved }), 'ok');
    var conflicts = data.conflicts || [];
    if (conflicts.length) toast(fill('tl.conflicts', { n: conflicts.length }), 'err');
    await openLang(state.lang, true);
    // A line left as somebody else's keeps what was typed, still unsaved.
    if (conflicts.length) {
      conflicts.forEach(function (id) { if (id in kept) state.draft[id] = kept[id]; });
      render();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirtyIds().length || state.review) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---- the file for a translator, and what comes back ---------------- */

  $('cDown').addEventListener('click', async function () {
    var ids = visible().map(function (l) { return l.id; });
    if (!ids.length) return;
    var btn = this;
    btn.disabled = true;
    var data = await send(WORDS, 'POST', { action: 'file', lang: state.lang, ids: ids });
    btn.disabled = false;
    if (!data) return;
    if (data.failed) return refused(data);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.text], { type: 'text/csv;charset=utf-8' }));
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('cUp').addEventListener('click', function () { $('cFile').click(); });

  $('cFile').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                  // so choosing the same file again fires
    if (!file) return;
    var text;
    try { text = await file.text(); }
    catch (err) { return toast(tr('tl.errFile'), 'err'); }

    var data = await send(WORDS, 'POST', { action: 'review', text: text });
    if (!data) return;
    if (data.failed) {
      if (data.code === 'no-language' && data.lang && data.lang !== 'en') {
        return toast(fill('tl.errLang', { lang: data.lang }), 'err');
      }
      if (data.code === 'not-a-file' || data.code === 'no-language') return toast(tr('tl.errFile'), 'err');
      return refused(data);
    }
    if (!data.items.length) return toast(tr('tl.nothingNew'), 'err');

    /* The file says which language it is for; it is reviewed under that one. */
    if (data.lang !== state.lang) {
      if (!(await mayLeave())) return;
      if (!(await openLang(data.lang))) return;
    }
    openReview(data);
  });

  function openReview(data) {
    state.review = {
      lang: data.lang,
      items: data.items.map(function (it) {
        return {
          id: it.id, source: it.source, key: it.key, english: it.english,
          english_hash: it.english_hash, current: it.current, value: it.proposed,
          problems: it.problems, warnings: it.warnings,
          approved: !it.problems.length && !it.warnings.length, blocked: it.problems.length > 0
        };
      })
    };
    $('cRoot').hidden = true;
    $('tlReview').hidden = false;
    renderBar();
    renderReview();
    window.scrollTo(0, 0);
  }

  function closeReview() {
    state.review = null;
    $('tlReview').hidden = true;
    $('tlItems').innerHTML = '';
    $('cRoot').hidden = false;
    renderBar();
  }

  function renderReview() {
    var r = state.review;
    var sections = [];
    r.items.forEach(function (it) {
      var s = sectionOf(it);
      if (sections.indexOf(s) === -1) sections.push(s);
    });
    function flag(kind) {
      return function (f) {
        return '<li class="is-' + kind + '">' + esc(fill('tl.flag.' + f.code, { detail: f.detail || '' })) + '</li>';
      };
    }
    $('tlItems').innerHTML = sections.map(function (s) {
      return '<h3 class="ln-h3">' + esc(sectionLabel(s)) + '</h3>' +
        r.items.filter(function (it) { return sectionOf(it) === s; }).map(function (it) {
          var flags = it.problems.map(flag('problem')).concat(it.warnings.map(flag('warning')));
          return '<article class="tl-item' + (it.blocked ? ' is-blocked' : '') + (it.approved ? ' is-approved' : '') +
              '" data-item="' + esc(it.id) + '">' +
            '<label class="tl-approve"><input type="checkbox" data-approve' + (it.approved ? ' checked' : '') +
              (it.blocked ? ' disabled' : '') + ' aria-label="' + esc(fill('tl.approve', { n: readable(it) })) + '"></label>' +
            '<div class="tl-body">' +
              '<p class="tl-key">' + esc(readable(it)) + '</p>' +
              '<p class="tl-en" lang="en">' + esc(it.english) + '</p>' +
              (it.current
                ? '<p class="tl-now"><span class="tl-tag">' + esc(tr('tl.now')) + '</span>' +
                  '<span lang="' + esc(r.lang) + '">' + esc(it.current) + '</span></p>'
                : '') +
              '<label class="tl-new"><span class="tl-tag">' + esc(tr('tl.new')) + '</span>' +
                '<textarea rows="2" lang="' + esc(r.lang) + '" data-value>' + esc(it.value) + '</textarea></label>' +
              (flags.length ? '<ul class="tl-flags">' + flags.join('') + '</ul>' : '') +
            '</div>' +
          '</article>';
        }).join('');
    }).join('');
    $('tlItems').querySelectorAll('textarea').forEach(autosize);
    renderReviewBar();
  }

  function renderReviewBar() {
    var r = state.review;
    var n = r.items.filter(function (it) { return it.approved; }).length;
    $('tlReviewCount').textContent = fill('tl.review', { n: r.items.length }) + ' · ' + langLabel(r.lang);
    $('tlApprove').textContent = fill('tl.approve', { n: n });
    $('tlApprove').disabled = !n;
  }

  function itemFor(el) {
    var box = el.closest('[data-item]');
    if (!box || !state.review) return null;
    var id = box.getAttribute('data-item');
    for (var i = 0; i < state.review.items.length; i++) if (state.review.items[i].id === id) return state.review.items[i];
    return null;
  }

  $('tlItems').addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-approve')) return;
    var it = itemFor(e.target);
    if (!it) return;
    it.approved = e.target.checked;
    e.target.closest('[data-item]').classList.toggle('is-approved', it.approved);
    renderReviewBar();
  });

  /* Editing a flagged line is how it gets fixed, so an edit unblocks it; the
     server checks it again when it is approved. */
  $('tlItems').addEventListener('input', function (e) {
    if (!e.target.hasAttribute('data-value')) return;
    var it = itemFor(e.target);
    if (!it) return;
    it.value = e.target.value;
    autosize(e.target);
    if (it.blocked) {
      it.blocked = false;
      var box = e.target.closest('[data-item]');
      box.classList.remove('is-blocked');
      box.querySelector('[data-approve]').disabled = false;
    }
  });

  $('tlCancel').addEventListener('click', async function () {
    var ok = await window.StaffConfirm({
      title: tr('tl.discardReview'), confirm: tr('ln.discard'), cancel: tr('common.cancel')
    });
    if (ok) closeReview();
  });

  $('tlApprove').addEventListener('click', async function () {
    var r = state.review;
    if (!r) return;
    var items = r.items.filter(function (it) { return it.approved; }).map(function (it) {
      return { id: it.id, value: it.value, was: it.current, english_hash: it.english_hash };
    });
    if (!items.length) return;
    var btn = this;
    btn.disabled = true;
    var data = await send(WORDS, 'POST', { action: 'apply', lang: r.lang, items: items });
    btn.disabled = false;
    if (!data) return;
    if (data.failed) {
      if (data.code === 'problems' && data.ids) {
        data.ids.forEach(function (id) {
          var box = document.querySelector('#tlItems [data-item="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
          if (box) box.classList.add('is-blocked');
        });
        return toast(tr('tl.problems'), 'err');
      }
      return refused(data);
    }
    toast(fill('tl.saved', { n: data.saved }), 'ok');
    if (data.conflicts && data.conflicts.length) toast(fill('tl.conflicts', { n: data.conflicts.length }), 'err');
    closeReview();
    await openLang(state.lang, true);
  });

  /* ---- adding and removing a language --------------------------------- */

  var codeLooksValid = function (v) { return /^[a-z]{2}(-[a-z]{2})?$/.test(String(v || '').trim().toLowerCase()); };

  async function addLanguage() {
    if (!(await mayLeave())) return;
    var code = await window.StaffPrompt({
      title: tr('con.addLangTitle'),
      label: tr('con.addLangLabel'),
      placeholder: 'sl',
      confirm: tr('con.addLangDo'),
      cancel: tr('ms.cancel'),
      // Checked here for a quick answer and again on the server, which counts.
      validate: function (v) {
        v = String(v || '').trim().toLowerCase();
        if (!codeLooksValid(v)) return tr('con.addLangBadCode');
        if (state.langs.indexOf(v) !== -1) return tr('con.addLangExists');
        return null;
      }
    });
    if (!code) return;
    var body = await send(CONTENT, 'POST', { code: code.trim().toLowerCase() });
    if (!body) return;
    if (body.failed) {
      /* A partial failure left a file behind and said so — a condition to act
         on, not an event that scrolls away. */
      if (body.partial && window.StaffProblem) return window.StaffProblem(body.error, null);
      return refused(body);
    }
    toast(fill('con.addLangDone', { code: langLabel(body.code), n: body.strings }), 'ok');
    var site = await send(CONTENT + '?file=site');
    if (site && !site.failed) takeSite(site);
    await openLang(body.code);
  }

  /* Same shape as deleting a partner: something that exists nowhere else
     stops existing. The count of what is lost is asked for first and shown in
     the question; the word is typed, and checked again on the server. */
  async function removeLanguage(code) {
    var info = await send(CONTENT + '?code=' + encodeURIComponent(code), 'DELETE');
    if (!info) return;
    // Anything but "needs confirmation" is a real refusal, and explains itself.
    if (!info.failed || info.translated === undefined) return refused(info);

    var ok = await window.StaffConfirm({
      title: fill('vis.removeTitle', { lang: langName(code) }),
      body: info.translated
        ? fill('vis.removeBody', { n: info.translated, lang: langName(code) })
        : fill('vis.removeEmpty', { lang: langName(code) }),
      type: 'DELETE', typeLabel: tr('pub.typeLabel'),
      confirm: tr('vis.removeDo'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    var body = await send(CONTENT + '?code=' + encodeURIComponent(code) + '&confirm=DELETE', 'DELETE');
    if (!body) return;
    if (body.failed) {
      if (body.partial && window.StaffProblem) return window.StaffProblem(body.error, null);
      return refused(body);
    }
    toast(fill('vis.removed', { lang: langName(code) }), 'ok');
    closeSettings();
    var site = await send(CONTENT + '?file=site');
    if (site && !site.failed) takeSite(site);
    await openLang('en');
  }

  /* ---- language settings ---------------------------------------------- */

  function siteValue(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, state.site);
  }
  function setSiteValue(path, value) {
    var parts = path.split('.'), o = state.site;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = value;
  }

  /* One setting, saved as it is changed: a quiet commit to site.json, like
     every save here. The SHA moves with each one, so the next is checked
     against it. */
  async function saveSetting(path, value) {
    var changes = {};
    changes[path] = value;
    var body = await send(CONTENT, 'PUT', { file: 'site', sha: state.siteSha, changes: changes });
    if (!body) return false;
    if (body.failed) {
      refused(body);
      var site = await send(CONTENT + '?file=site');       // read again rather than guess
      if (site && !site.failed) takeSite(site);
      renderSettings();
      return false;
    }
    if (body.sha) state.siteSha = body.sha;
    setSiteValue(path, value);
    toast(tr('ln.saved'), 'ok');
    return true;
  }

  function switchHtml(attr, on, label, disabled) {
    return '<div class="c-set-row"><span class="switch-label">' + esc(label) + '</span>' +
      '<button type="button" class="switch" role="switch" ' + attr +
      ' aria-checked="' + (on ? 'true' : 'false') + '"' + (on ? ' data-on="1"' : '') +
      (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '">' +
        '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
        '</span><span class="switch-knob"></span></span></button></div>';
  }

  function guideHtml(lang, label) {
    var ro = state.notesWrite ? '' : ' readonly';
    return '<div class="c-set-guide" data-guide="' + esc(lang) + '">' +
      '<label class="fld"><span>' + esc(label) + '</span>' +
        '<textarea rows="4" maxlength="2000"' + ro + ' lang="' + esc(lang === '*' ? 'en' : lang) + '">' +
        esc(state.notes.guides[lang] || '') + '</textarea></label>' +
      (state.notesWrite
        ? '<p class="ln-acts"><button type="button" class="ghost-btn" data-save-guide disabled>' +
          esc(tr('ln.saveGuide')) + '</button></p>'
        : '') +
    '</div>';
  }

  function renderSettings() {
    var code = state.lang;
    var en = code === 'en';
    $('cSetTitle').textContent = langLabel(code);
    var html = '<div class="c-set-sws">';

    /* Whether the language is built at all. English has no switch: every
       missing translation falls back to it. */
    var vis = siteValue('visibility.languages.' + code);
    if (!en && vis) {
      html += switchHtml('data-set="visibility.languages.' + esc(code) + '.dev"', !!vis.dev, tr('vis.devCol')) +
              switchHtml('data-set="visibility.languages.' + esc(code) + '.live"', !!vis.live, tr('vis.liveCol'));
    }
    /* The default can be given to a language, not taken away: exactly one
       language is it, so turning another on is how it moves. */
    var isDefault = state.site.defaultLang === code;
    html += switchHtml('data-default', isDefault, tr('con.set.default'), isDefault) + '</div>';

    if (state.site.donorbox && typeof state.site.donorbox === 'object') {
      html += '<label class="fld c-set-fld"><span>' + esc(tr('con.set.donate')) + '</span>' +
        '<input type="text" data-set="donorbox.' + esc(code) + '" value="' +
        esc(state.site.donorbox[code] || '') + '" autocomplete="off" spellcheck="false"></label>';
    }

    if (en) {
      /* English is the source, so its notes are the ones every translation
         follows: the words that stay as written, and the guide for all. */
      html += '<h4 class="ln-h3">' + esc(tr('ln.keep')) + '</h4>' +
        '<ul class="ln-chips">' + (state.notes.keep.length
          ? state.notes.keep.map(function (k) {
              return '<li class="ln-chip"><span>' + esc(k.term) + '</span>' +
                (state.notesWrite ? '<button type="button" class="ln-x" data-keep="' + esc(k.id) +
                  '" aria-label="' + esc(tr('ln.remove') + ' ' + k.term) + '">&times;</button>' : '') + '</li>';
            }).join('')
          : '<li class="ln-none">' + esc(tr('ln.none')) + '</li>') + '</ul>' +
        (state.notesWrite
          ? '<form class="ln-add" data-keep-add><input type="text" maxlength="80" autocomplete="off" placeholder="' +
            esc(tr('ln.keepAdd')) + '" aria-label="' + esc(tr('ln.keepAdd')) + '">' +
            '<button type="submit" class="ghost-btn">' + esc(tr('ln.add')) + '</button></form>'
          : '') +
        guideHtml('*', tr('ln.every'));
    } else {
      html += guideHtml(code, tr('con.set.written'));
      var rows = state.notes.glossary.filter(function (g) { return g.lang === code; });
      var ro = state.notesWrite ? '' : ' readonly';
      html += '<h4 class="ln-h3">' + esc(tr('ln.fixed')) + '</h4>' +
        '<table class="ln-table"><thead><tr><th scope="col">' + esc(tr('ln.english')) + '</th>' +
        '<th scope="col">' + esc(langName(code)) + '</th><th scope="col"><span class="visually-hidden">' +
        esc(tr('ln.remove')) + '</span></th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (g) {
          return '<tr data-gloss-row="' + esc(g.id) + '">' +
            '<td><input type="text" lang="en" maxlength="300" data-gl="source" value="' + esc(g.source) +
              '" aria-label="' + esc(tr('ln.english')) + '"' + ro + '></td>' +
            '<td><input type="text" lang="' + esc(code) + '" maxlength="300" data-gl="target" value="' + esc(g.target) +
              '" aria-label="' + esc(langName(code)) + '"' + ro + '></td>' +
            '<td>' + (state.notesWrite ? '<button type="button" class="ln-x" data-gloss="' + esc(g.id) +
              '" aria-label="' + esc(tr('ln.remove') + ' ' + g.source) + '">&times;</button>' : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="3" class="ln-none">' + esc(tr('ln.none')) + '</td></tr>') +
        '</tbody></table>' +
        (state.notesWrite
          ? '<form class="ln-add ln-add-pair" data-gloss-add>' +
            '<input type="text" lang="en" maxlength="300" autocomplete="off" placeholder="' + esc(tr('ln.source')) +
              '" aria-label="' + esc(tr('ln.source')) + '" data-new="source">' +
            '<input type="text" lang="' + esc(code) + '" maxlength="300" autocomplete="off" placeholder="' +
              esc(tr('ln.target')) + '" aria-label="' + esc(tr('ln.target')) + '" data-new="target">' +
            '<button type="submit" class="ghost-btn">' + esc(tr('ln.add')) + '</button></form>'
          : '') +
        '<p class="c-set-danger"><button type="button" class="ghost-btn c-remove" data-remove>' +
          esc(fill('con.set.remove', { lang: langName(code) })) + '</button></p>';
    }
    $('cSetBody').innerHTML = html;
  }

  var lastFocus = null;
  function openSettings() {
    renderSettings();
    lastFocus = document.activeElement;
    var back = $('cSet');
    back.hidden = false;
    void back.offsetHeight;
    back.classList.add('in');
    $('cSetClose').focus();
  }
  function guidesDirty() {
    return [].some.call(document.querySelectorAll('#cSetBody [data-guide]'), function (box) {
      return box.querySelector('textarea').value !== (state.notes.guides[box.getAttribute('data-guide')] || '');
    });
  }
  async function closeSettings(ask) {
    var back = $('cSet');
    if (back.hidden) return;
    if (ask && guidesDirty()) {
      var ok = await window.StaffConfirm({
        title: tr('ln.discardGuide'), confirm: tr('ln.discard'), cancel: tr('common.cancel')
      });
      if (!ok) return;
    }
    back.classList.remove('in');
    setTimeout(function () { back.hidden = true; }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $('cLangSet').addEventListener('click', openSettings);
  $('cSetClose').addEventListener('click', function () { closeSettings(true); });
  $('cSet').addEventListener('click', function (e) { if (e.target === $('cSet')) closeSettings(true); });
  document.addEventListener('keydown', function (e) {
    // Only when this dialog is on top; a confirmation opened from it closes first.
    if (e.key === 'Escape' && !$('cSet').hidden && !document.querySelector('.dlg-back:not(#cSet)')) closeSettings(true);
  });

  function takeNotes(data) {
    state.notes = { keep: data.keep || [], glossary: data.glossary || [], guides: data.guides || {} };
    state.notesWrite = !!data.can_write;
  }

  $('cSetBody').addEventListener('click', async function (e) {
    var sw = e.target.closest('.switch');
    if (sw) {
      if (sw.disabled) return;
      sw.disabled = true;
      var ok = sw.hasAttribute('data-default')
        ? await saveSetting('defaultLang', state.lang)
        : await saveSetting(sw.getAttribute('data-set'), !siteValue(sw.getAttribute('data-set')));
      if (ok) renderSettings(); else sw.disabled = false;
      return;
    }
    if (e.target.closest('[data-remove]')) return removeLanguage(state.lang);

    var save = e.target.closest('[data-save-guide]');
    if (save) {
      var box = save.closest('[data-guide]');
      save.disabled = true;
      var saved = await send(NOTES, 'POST', { kind: 'guide', lang: box.getAttribute('data-guide'),
                                             guidance: box.querySelector('textarea').value });
      if (!saved || saved.failed) { save.disabled = false; if (saved) refused(saved); return; }
      takeNotes(saved);
      toast(tr('ln.saved'), 'ok');
      return;
    }
    var k = e.target.closest('[data-keep]');
    var g = e.target.closest('[data-gloss]');
    if (!k && !g) return;
    var data = await send(NOTES + (k ? '?kind=keep&id=' + encodeURIComponent(k.getAttribute('data-keep'))
                                     : '?kind=glossary&id=' + encodeURIComponent(g.getAttribute('data-gloss'))), 'DELETE');
    if (!data) return;
    if (data.failed) return refused(data);
    takeNotes(data);
    renderSettings();
  });

  $('cSetBody').addEventListener('input', function (e) {
    var box = e.target.closest('[data-guide]');
    if (!box || e.target.tagName !== 'TEXTAREA') return;
    var btn = box.querySelector('[data-save-guide]');
    if (btn) btn.disabled = e.target.value === (state.notes.guides[box.getAttribute('data-guide')] || '');
  });

  $('cSetBody').addEventListener('change', async function (e) {
    var t = e.target;
    if (t.matches('input[data-set]')) return saveSetting(t.getAttribute('data-set'), t.value.trim());
    if (!t.matches('[data-gl]')) return;
    var row = t.closest('tr');
    var source = row.querySelector('[data-gl="source"]').value;
    var target = row.querySelector('[data-gl="target"]').value;
    if (!source.trim() || !target.trim()) return renderSettings();
    var data = await send(NOTES, 'POST', { kind: 'glossary', id: row.getAttribute('data-gloss-row'),
                                           lang: state.lang, source: source, target: target });
    if (!data || data.failed) { if (data) refused(data); return renderSettings(); }
    takeNotes(data);
    toast(tr('ln.saved'), 'ok');
  });

  $('cSetBody').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target;
    var keepAdd = form.hasAttribute('data-keep-add');
    var data;
    if (keepAdd) {
      var term = form.querySelector('input').value.trim();
      if (!term) return form.querySelector('input').focus();
      data = await send(NOTES, 'POST', { kind: 'keep', term: term });
    } else if (form.hasAttribute('data-gloss-add')) {
      var src = form.querySelector('[data-new="source"]'), tgt = form.querySelector('[data-new="target"]');
      if (!src.value.trim()) return src.focus();
      if (!tgt.value.trim()) return tgt.focus();
      data = await send(NOTES, 'POST', { kind: 'glossary', lang: state.lang, source: src.value, target: tgt.value });
    } else return;
    if (!data) return;
    if (data.failed) return refused(data);
    takeNotes(data);
    renderSettings();
    var again = $('cSetBody').querySelector(keepAdd ? '[data-keep-add] input' : '[data-new="source"]');
    if (again) again.focus();
  });

  boot();
})();
