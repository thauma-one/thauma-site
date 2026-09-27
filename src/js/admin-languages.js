/* ============================================================
   admin-languages.js — the site in every language
   ============================================================
   Two halves under one language picker:

   TRANSLATE (/api/admin/translate). What is missing or outdated
   in the picked language, the file handed to a translator, and
   approving what comes back, line by line. The route Claude
   translates the site through, for free. Nothing is saved until
   a person approves it, and approving saves the way Content
   does: a quiet commit, live at the next Publish.

   HOW EACH LANGUAGE IS WRITTEN (/api/admin/translation-notes).
   Words never translated, a guide for every language and one
   per language, fixed phrases. Saves at once, like Settings:
   none of it is public. Every answer from the server is the
   whole set, and the screen redraws from it.

   The picker lists the server's languages — site.json on the
   content branch — so a language added a minute ago is here
   before this page is rebuilt. English is not in it: it is
   what everything is translated from.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'languages') return;

  var NOTES = '/api/admin/translation-notes';
  var TRANSLATE = '/api/admin/translate';
  var $ = function (id) { return document.getElementById(id); };
  var BUILT = (function () {
    try { return JSON.parse(($('lnLangs') || {}).textContent || '[]'); }
    catch (e) { return []; }
  })();

  var state = {
    langs: [], lang: null,
    notes: { keep: [], glossary: [], guides: {} }, canWrite: false,
    lines: [], unavailable: [], selected: {}, open: {}, finished: false,
    review: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return tr(key).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* A language's name: its own word for itself from its file where the build
     has it, the browser's otherwise, the code in brackets either way. */
  function langName(code) {
    for (var i = 0; i < BUILT.length; i++) if (BUILT[i].code === code && BUILT[i].name !== code) return BUILT[i].name;
    try {
      var n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* a code Intl does not know */ }
    return code;
  }
  function langLabel(code) { return langName(code) + ' (' + code + ')'; }

  /* ---- talking to the server ---------------------------------------- */

  /* One path for every request. A failed read of the page's data takes the
     page over (StaffProblem, with a retry); a refused change is a toast. The
     server's answer comes back either way so a caller can read its code. */
  async function send(url, method, body) {
    var res, data;
    try {
      res = await fetch(url, {
        method: method, credentials: 'same-origin', cache: 'no-store',
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
    if (!res.ok) {
      data.failed = true;
      if (method === 'GET' && window.StaffProblem) {
        window.StaffProblem(res.status === 401 ? tr('err.expired')
          : tr('err.refused') + ' (' + res.status + ')' + (data.error ? ' — ' + data.error : ''),
          res.status === 401 ? null : boot);
      }
      return data;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    return data;
  }

  async function boot() {
    var both = await Promise.all([send(NOTES, 'GET'), send(TRANSLATE, 'GET')]);
    var notes = both[0], langs = both[1];
    if (!notes || notes.failed) return;
    takeNotes(notes);
    state.langs = (langs && !langs.failed ? langs.languages : BUILT.map(function (l) { return l.code; }))
      .filter(function (c) { return c !== 'en'; });
    fillLangs();
    $('lnRoot').hidden = false;
    renderNotes();
    await loadLines();
  }

  function fillLangs() {
    var sel = $('lnLang');
    sel.innerHTML = state.langs.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langLabel(c)) + '</option>';
    }).join('');
    if (state.langs.indexOf(state.lang) === -1) state.lang = state.langs[0] || null;
    sel.value = state.lang || '';
  }

  /* =================================================== TRANSLATE === */

  async function loadLines() {
    if (!state.lang) return;
    var data = await send(TRANSLATE + '?lang=' + encodeURIComponent(state.lang), 'GET');
    if (!data || data.failed) return;
    state.lines = data.lines || [];
    state.unavailable = data.unavailable || [];
    state.selected = {};
    state.lines.forEach(function (l) { if (l.status !== 'done' || state.finished) state.selected[l.id] = true; });
    renderGroups();
  }

  var SOURCES = ['site', 'emails'];
  var RANK = { missing: 0, outdated: 1, done: 2 };

  function shown(l) { return state.finished || l.status !== 'done'; }
  function chosenIds() {
    return state.lines.filter(function (l) { return shown(l) && state.selected[l.id]; })
      .map(function (l) { return l.id; });
  }

  function renderGroups() {
    $('tlGroups').innerHTML = SOURCES.map(function (src) {
      var lines = state.lines.filter(function (l) { return l.source === src; });
      var missing = lines.filter(function (l) { return l.status === 'missing'; }).length;
      var outdated = lines.filter(function (l) { return l.status === 'outdated'; }).length;
      /* Work first: missing, then outdated, then finished — otherwise the two
         lines that need doing hide among two hundred that do not. Otherwise
         the page order, which is the order the site reads in. */
      var visible = lines.filter(shown).map(function (l, i) { return { l: l, i: i }; })
        .sort(function (a, b) { return (RANK[a.l.status] - RANK[b.l.status]) || (a.i - b.i); })
        .map(function (x) { return x.l; });
      var picked = visible.filter(function (l) { return state.selected[l.id]; }).length;
      var off = state.unavailable.indexOf(src) !== -1;

      var summary = off ? tr('tl.notYet')
        : (missing || outdated)
          ? [missing ? fill('tl.missing', { n: missing }) : '', outdated ? fill('tl.outdated', { n: outdated }) : '']
              .filter(Boolean).join(' · ')
          : tr('tl.allDone');

      var open = !!state.open[src] && visible.length;
      return '<li class="tl-group' + (off ? ' is-off' : '') + '">' +
        '<div class="tl-ghead">' +
          '<label class="tl-gcheck"><input type="checkbox" data-group="' + src + '"' +
            (visible.length && picked === visible.length ? ' checked' : '') +
            (picked && picked < visible.length ? ' data-mixed' : '') +
            (visible.length ? '' : ' disabled') + '>' +
            '<span class="tl-gname">' + esc(tr('tl.src.' + src)) + '</span></label>' +
          '<span class="tl-gsum">' + esc(summary) + '</span>' +
          (visible.length
            ? '<button type="button" class="tl-more" data-open="' + src + '" aria-expanded="' + open + '">' +
                esc(tr('tl.choose')) + '</button>'
            : '') +
        '</div>' +
        (open
          ? '<ul class="tl-lines">' + visible.map(function (l) {
              return '<li><label class="tl-line">' +
                '<input type="checkbox" data-id="' + esc(l.id) + '"' + (state.selected[l.id] ? ' checked' : '') + '>' +
                '<span class="tl-key">' + esc(l.key) + '</span>' +
                '<span class="tl-en" lang="en">' + esc(l.english) + '</span>' +
                '<span class="tl-st is-' + l.status + '">' + esc(tr('tl.status.' + l.status)) + '</span>' +
              '</label></li>';
            }).join('') + '</ul>'
          : '') +
      '</li>';
    }).join('');

    /* "Some of this group" is the checkbox's third state, which only a script
       can set. */
    [].forEach.call(document.querySelectorAll('#tlGroups [data-mixed]'), function (el) { el.indeterminate = true; });

    var n = chosenIds().length;
    $('tlDownload').textContent = fill('tl.download', { n: n });
    $('tlDownload').disabled = !n;
  }

  $('tlGroups').addEventListener('change', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-group')) {
      var src = t.getAttribute('data-group');
      state.lines.forEach(function (l) { if (l.source === src && shown(l)) state.selected[l.id] = t.checked; });
    } else if (t.hasAttribute('data-id')) {
      state.selected[t.getAttribute('data-id')] = t.checked;
    }
    renderGroups();
  });

  $('tlGroups').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-open]');
    if (!b) return;
    var src = b.getAttribute('data-open');
    state.open[src] = !state.open[src];
    renderGroups();
    var again = document.querySelector('#tlGroups [data-open="' + src + '"]');
    if (again) again.focus();
  });

  $('tlFinished').addEventListener('change', function (e) {
    state.finished = e.target.checked;
    /* Showing the finished lines means offering them: somebody who asks for
       them is redoing a language (the Serbian, first). Hiding them again takes
       them back out. */
    state.lines.forEach(function (l) { if (l.status === 'done') state.selected[l.id] = state.finished; });
    renderGroups();
  });

  $('tlDownload').addEventListener('click', async function () {
    var btn = this;
    var ids = chosenIds();
    if (!ids.length) return;
    btn.disabled = true;
    var data = await send(TRANSLATE, 'POST', { action: 'file', lang: state.lang, ids: ids });
    btn.disabled = false;
    if (!data) return;
    if (data.failed) return toast(data.error || tr('err.refused'), 'err');
    var blob = new Blob([data.text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('tlUpload').addEventListener('click', function () { $('tlFile').click(); });

  $('tlFile').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                  // so choosing the same file again fires
    if (!file) return;
    var text;
    try { text = await file.text(); }
    catch (err) { return toast(tr('tl.errFile'), 'err'); }

    var data = await send(TRANSLATE, 'POST', { action: 'review', text: text });
    if (!data) return;
    if (data.failed) {
      /* No language in the file at all is a file this page did not make; a
         language the site lacks is a language to add first. */
      if (data.code === 'no-language' && data.lang) return toast(fill('tl.errLang', { lang: data.lang }), 'err');
      if (data.code === 'not-a-file' || data.code === 'no-language') return toast(tr('tl.errFile'), 'err');
      return toast(data.error || tr('err.refused'), 'err');
    }
    if (!data.items.length) return toast(tr('tl.nothingNew'), 'err');

    /* The file says which language it is for. Switch to it, so the review is
       shown under the language it will be saved into. */
    if (data.lang !== state.lang && state.langs.indexOf(data.lang) !== -1) {
      state.lang = data.lang;
      $('lnLang').value = data.lang;
      renderLangNotes();
      loadLines();
    }
    openReview(data);
  });

  /* ---- approving ----------------------------------------------------- */

  function openReview(data) {
    state.review = {
      lang: data.lang,
      items: data.items.map(function (it) {
        var clean = !it.problems.length && !it.warnings.length;
        return {
          id: it.id, source: it.source, key: it.key, english: it.english,
          english_hash: it.english_hash, current: it.current, value: it.proposed,
          problems: it.problems, warnings: it.warnings,
          approved: clean, blocked: it.problems.length > 0
        };
      })
    };
    $('tlPick').hidden = true;
    $('tlReview').hidden = false;
    renderReview();
    $('tlReview').scrollIntoView({ block: 'start' });
  }

  function closeReview() {
    state.review = null;
    $('tlReview').hidden = true;
    $('tlPick').hidden = false;
    $('tlItems').innerHTML = '';
  }

  function flagText(f) {
    return fill('tl.flag.' + f.code, { detail: f.detail || '' });
  }

  function renderReview() {
    var r = state.review;
    var lang = r.lang;
    var html = '';
    SOURCES.forEach(function (src) {
      var items = r.items.filter(function (it) { return it.source === src; });
      if (!items.length) return;
      html += '<h3 class="ln-h3">' + esc(tr('tl.src.' + src)) + '</h3>';
      html += items.map(function (it, i) {
        var flags = it.problems.map(function (f) { return '<li class="is-problem">' + esc(flagText(f)) + '</li>'; })
          .concat(it.warnings.map(function (f) { return '<li class="is-warning">' + esc(flagText(f)) + '</li>'; }));
        return '<article class="tl-item' + (it.blocked ? ' is-blocked' : '') + (it.approved ? ' is-approved' : '') +
            '" data-item="' + esc(it.id) + '">' +
          '<label class="tl-approve"><input type="checkbox" data-approve' + (it.approved ? ' checked' : '') +
            (it.blocked ? ' disabled' : '') + ' aria-label="' + esc(fill('tl.approve', { n: it.key })) + '"></label>' +
          '<div class="tl-body">' +
            '<p class="tl-key">' + esc(it.key) + '</p>' +
            '<p class="tl-en" lang="en">' + esc(it.english) + '</p>' +
            (it.current
              ? '<p class="tl-now"><span class="tl-tag">' + esc(tr('tl.now')) + '</span>' +
                '<span lang="' + esc(lang) + '">' + esc(it.current) + '</span></p>'
              : '') +
            '<label class="tl-new"><span class="tl-tag">' + esc(tr('tl.new')) + '</span>' +
              '<textarea rows="2" lang="' + esc(lang) + '" data-value>' + esc(it.value) + '</textarea></label>' +
            (flags.length ? '<ul class="tl-flags">' + flags.join('') + '</ul>' : '') +
          '</div>' +
        '</article>';
      }).join('');
    });
    $('tlItems').innerHTML = html;
    sizeAll();
    /* Measured again once the layout has settled: fonts and the narrow
       phone column can change a box's width after the first pass. Browsers
       that size a box to its content (field-sizing) need neither. */
    requestAnimationFrame(sizeAll);
    renderReviewBar();
  }

  function renderReviewBar() {
    var r = state.review;
    var n = r.items.filter(function (it) { return it.approved; }).length;
    $('tlReviewCount').textContent = fill('tl.review', { n: r.items.length }) + ' · ' + langLabel(r.lang);
    $('tlApprove').textContent = fill('tl.approve', { n: n });
    $('tlApprove').disabled = !n;
  }

  function autosize(ta) {
    if (window.CSS && CSS.supports && CSS.supports('field-sizing', 'content')) return;
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  function sizeAll() { [].forEach.call(document.querySelectorAll('#tlItems textarea'), autosize); }
  window.addEventListener('resize', function () { if (state.review) sizeAll(); });

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

  /* Editing a line is how a flagged one gets fixed, so an edit unblocks it —
     the server checks it again on approval, and refuses it if it is still
     broken. */
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
    var ok = window.StaffConfirm ? await window.StaffConfirm({
      title: tr('tl.discardReview'), confirm: tr('ln.discard'), cancel: tr('common.cancel')
    }) : true;
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
    var data = await send(TRANSLATE, 'POST', { action: 'apply', lang: r.lang, items: items });
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
      return toast(data.error || tr('err.refused'), 'err');
    }
    toast(fill('tl.saved', { n: data.saved }), 'ok');
    if (data.conflicts && data.conflicts.length) toast(fill('tl.conflicts', { n: data.conflicts.length }), 'err');
    closeReview();
    loadLines();
  });

  /* ======================================================= NOTES === */

  function takeNotes(data) {
    state.notes = { keep: data.keep || [], glossary: data.glossary || [], guides: data.guides || {} };
    state.canWrite = !!data.can_write;
  }

  function guideBoxes() { return [].slice.call(document.querySelectorAll('#lnRoot [data-guide]')); }
  function guideLang(box) { return box.getAttribute('data-guide'); }
  function guideDirty(box) {
    return box.querySelector('textarea').value !== (state.notes.guides[guideLang(box)] || '');
  }
  function anyGuideDirty() { return guideBoxes().some(guideDirty); }

  function renderNotes() {
    [].forEach.call(document.querySelectorAll('#lnRoot [data-write]'), function (el) {
      el.hidden = !state.canWrite;
    });
    $('lnKeep').innerHTML = state.notes.keep.length
      ? state.notes.keep.map(function (k) {
          return '<li class="ln-chip"><span>' + esc(k.term) + '</span>' +
            (state.canWrite
              ? '<button type="button" class="ln-x" data-keep="' + esc(k.id) + '" aria-label="' +
                esc(tr('ln.remove') + ' ' + k.term) + '">&times;</button>'
              : '') + '</li>';
        }).join('')
      : '<li class="ln-none">' + esc(tr('ln.none')) + '</li>';
    renderGuide(document.querySelector('#lnRoot [data-guide="*"]'));
    renderLangNotes();
  }

  /* Redrawn one guide at a time, so an unsaved guide is never overwritten by
     a change somewhere else on the page. */
  function renderGuide(box, force) {
    var ta = box.querySelector('textarea');
    if (force || !guideDirty(box) || ta.dataset.lang !== guideLang(box)) {
      ta.value = state.notes.guides[guideLang(box)] || '';
    }
    ta.dataset.lang = guideLang(box);
    ta.readOnly = !state.canWrite;
    box.querySelector('[data-save]').disabled = !guideDirty(box);
  }

  /* Everything that follows the picker: the language's own guide and its
     fixed phrases. */
  function renderLangNotes() {
    var lang = state.lang;
    var box = document.querySelector('#lnRoot [data-guide]:not([data-guide="*"])');
    box.setAttribute('data-guide', lang || '');
    box.querySelector('[data-name]').textContent = langName(lang || '');
    box.querySelector('textarea').setAttribute('lang', lang || '');
    renderGuide(box, true);

    $('lnTargetHead').textContent = langName(lang || '');
    var ro = state.canWrite ? '' : ' readonly';
    var rows = state.notes.glossary.filter(function (g) { return g.lang === lang; });
    $('lnGlossary').innerHTML = rows.length
      ? rows.map(function (g) {
          /* Edited in place and saved when the box is left — a correction is
             the same act as writing it, so it needs no separate mode. */
          return '<tr data-id="' + esc(g.id) + '">' +
            '<td><input type="text" lang="en" maxlength="300" data-gl="source" value="' + esc(g.source) +
              '" aria-label="' + esc(tr('ln.english')) + '"' + ro + '></td>' +
            '<td><input type="text" lang="' + esc(lang) + '" maxlength="300" data-gl="target" value="' +
              esc(g.target) + '" aria-label="' + esc(langName(lang)) + '"' + ro + '></td>' +
            '<td>' + (state.canWrite
              ? '<button type="button" class="ln-x" data-gloss="' + esc(g.id) + '" aria-label="' +
                esc(tr('ln.remove') + ' ' + g.source) + '">&times;</button>'
              : '') + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="3" class="ln-none">' + esc(tr('ln.none')) + '</td></tr>';
    $('lnTarget').setAttribute('lang', lang || '');
  }

  $('lnLang').addEventListener('change', async function (e) {
    /* Leaving unsaved words — a guide half-written, a review not yet
       approved — is a choice to discard them, but never a silent one. */
    var next = e.target.value;
    var own = document.querySelector('#lnRoot [data-guide]:not([data-guide="*"])');
    var losing = state.review ? 'tl.discardReview' : (guideDirty(own) ? 'ln.discardGuide' : null);
    if (losing) {
      e.target.value = state.lang;
      var yes = window.StaffConfirm ? await window.StaffConfirm({
        title: tr(losing), confirm: tr('ln.discard'), cancel: tr('common.cancel')
      }) : true;
      if (!yes) return;
      e.target.value = next;
      if (state.review) closeReview();
    }
    state.lang = next;
    renderLangNotes();
    loadLines();
  });

  document.addEventListener('input', function (e) {
    var box = e.target.closest && e.target.closest('#lnRoot [data-guide]');
    if (!box || e.target.tagName !== 'TEXTAREA') return;
    box.querySelector('[data-save]').disabled = !guideDirty(box);
    box.querySelector('[data-status]').textContent = '';
  });

  document.addEventListener('click', async function (e) {
    var save = e.target.closest && e.target.closest('#lnRoot [data-guide] [data-save]');
    if (save) {
      var box = save.closest('[data-guide]');
      save.disabled = true;
      var saved = await send(NOTES, 'POST', {
        kind: 'guide', lang: guideLang(box), guidance: box.querySelector('textarea').value
      });
      if (!saved || saved.failed) {
        save.disabled = false;
        if (saved) toast(saved.error || tr('err.refused'), 'err');
        return;
      }
      takeNotes(saved);
      renderGuide(box, true);
      box.querySelector('[data-status]').textContent = tr('ln.saved');
      return;
    }

    var k = e.target.closest && e.target.closest('[data-keep]');
    var g = e.target.closest && e.target.closest('[data-gloss]');
    if (!k && !g) return;
    var data = k
      ? await send(NOTES + '?kind=keep&id=' + encodeURIComponent(k.getAttribute('data-keep')), 'DELETE')
      : await send(NOTES + '?kind=glossary&id=' + encodeURIComponent(g.getAttribute('data-gloss')), 'DELETE');
    if (!data) return;
    if (data.failed) return toast(data.error || tr('err.refused'), 'err');
    takeNotes(data);
    renderNotes();
  });

  $('lnKeepAdd').addEventListener('submit', async function (e) {
    e.preventDefault();
    var box = $('lnKeepTerm');
    var term = box.value.trim();
    if (!term) { box.focus(); return; }
    var data = await send(NOTES, 'POST', { kind: 'keep', term: term });
    if (!data) return;
    if (data.failed) return toast(data.error || tr('err.refused'), 'err');
    box.value = '';
    takeNotes(data);
    renderNotes();
    box.focus();
  });

  $('lnGlossAdd').addEventListener('submit', async function (e) {
    e.preventDefault();
    var src = $('lnSource'), tgt = $('lnTarget');
    if (!src.value.trim()) { src.focus(); return; }
    if (!tgt.value.trim()) { tgt.focus(); return; }
    var data = await send(NOTES, 'POST', { kind: 'glossary', lang: state.lang, source: src.value, target: tgt.value });
    if (!data) return;
    if (data.failed) return toast(data.error || tr('err.refused'), 'err');
    src.value = ''; tgt.value = '';
    takeNotes(data);
    renderLangNotes();
    src.focus();
  });

  document.addEventListener('change', async function (e) {
    if (!e.target.matches || !e.target.matches('#lnGlossary input[data-gl]')) return;
    var row = e.target.closest('tr');
    var source = row.querySelector('[data-gl="source"]').value;
    var target = row.querySelector('[data-gl="target"]').value;
    if (!source.trim() || !target.trim()) { renderLangNotes(); return; }
    var data = await send(NOTES, 'POST', { kind: 'glossary', id: row.getAttribute('data-id'),
                                           lang: state.lang, source: source, target: target });
    if (!data || data.failed) {
      if (data) toast(data.error || tr('err.refused'), 'err');
      renderLangNotes();
      return;
    }
    takeNotes(data);
    renderLangNotes();
    toast(tr('ln.saved'), 'ok');
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.review || anyGuideDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
})();
