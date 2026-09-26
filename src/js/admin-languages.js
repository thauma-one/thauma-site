/* ============================================================
   admin-languages.js — how each language is written
   ============================================================
   The notes every translator reads (see workers/src/lib/
   translation-notes.js): words never translated, a guide per
   language, and fixed phrases per language.

   SAVES AT ONCE, like Settings. Nothing here is public, so there
   is no Publish; every answer from the server is the whole set,
   and the screen redraws from it — what you see is what the
   database holds, never what the page hoped it wrote.

   READ-ONLY FOR MOST PEOPLE. Anyone signed in may read the notes
   (a partner translating their own milestones needs them); only
   administrators and communications change them. The server says
   which, and the page hides the controls rather than offering
   ones that would be refused.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'languages') return;

  var API = '/api/admin/translation-notes';
  var $ = function (id) { return document.getElementById(id); };
  var LANGS = (function () {
    try { return JSON.parse(($('lnLangs') || {}).textContent || '[]'); }
    catch (e) { return []; }
  })();

  var state = { keep: [], glossary: [], guides: {}, canWrite: false, lang: '*', guideDirty: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function langName(code) {
    for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i].name;
    return code;
  }

  /* ---- talking to the server ---------------------------------------- */

  /* One path for every request, so every failure is told the same way: the
     network, the server's own refusal, or a page that could not read the
     answer — three different things, three different messages. */
  async function send(method, body, query) {
    var res, data;
    try {
      res = await fetch(API + (query || ''), {
        method: method, credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
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
      if (method === 'GET' && window.StaffProblem) {
        window.StaffProblem(res.status === 401 ? tr('err.expired')
          : tr('err.refused') + ' (' + res.status + ')' + (data.error ? ' — ' + data.error : ''),
          res.status === 401 ? null : boot);
      } else {
        toast(data.error || tr('err.refused'), 'err');
      }
      return null;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    return data;
  }

  function take(data) {
    state.keep = data.keep || [];
    state.glossary = data.glossary || [];
    state.guides = data.guides || {};
    state.canWrite = !!data.can_write;
  }

  async function boot() {
    var data = await send('GET');
    if (!data) return;
    take(data);
    fillLangs();
    $('lnRoot').hidden = false;
    render();
  }

  /* ---- drawing ------------------------------------------------------- */

  function fillLangs() {
    var sel = $('lnLang');
    sel.innerHTML = '<option value="*">' + esc(tr('ln.every')) + '</option>' +
      LANGS.filter(function (l) { return l.code !== 'en'; }).map(function (l) {
        return '<option value="' + esc(l.code) + '">' + esc(l.name) + ' (' + esc(l.code) + ')</option>';
      }).join('');
    sel.value = state.lang;
  }

  function render() {
    [].forEach.call(document.querySelectorAll('#lnRoot [data-write]'), function (el) {
      el.hidden = !state.canWrite;
    });

    $('lnKeep').innerHTML = state.keep.length
      ? state.keep.map(function (k) {
          return '<li class="ln-chip"><span>' + esc(k.term) + '</span>' +
            (state.canWrite
              ? '<button type="button" class="ln-x" data-keep="' + esc(k.id) + '" aria-label="' +
                esc(tr('ln.remove') + ' ' + k.term) + '">&times;</button>'
              : '') + '</li>';
        }).join('')
      : '<li class="ln-none">' + esc(tr('ln.none')) + '</li>';

    renderLang();
  }

  /* The part of the page that follows the language picker. Redrawn on its
     own so an unsaved guide is never overwritten by a change elsewhere. */
  function renderLang() {
    var lang = state.lang;
    if (!state.guideDirty) $('lnGuide').value = state.guides[lang] || '';
    $('lnGuide').readOnly = !state.canWrite;
    $('lnGuideSave').disabled = !state.guideDirty;

    var every = lang === '*';
    $('lnGlossWrap').hidden = every;
    if (every) return;

    $('lnTargetHead').textContent = langName(lang);
    var rows = state.glossary.filter(function (g) { return g.lang === lang; });
    $('lnGlossary').innerHTML = rows.length
      ? rows.map(function (g) {
          /* Edited in place and saved when the box is left — a correction is
             the same act as writing it, so it needs no separate mode. */
          var ro = state.canWrite ? '' : ' readonly';
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
    $('lnTarget').setAttribute('lang', lang);
  }

  /* ---- acting -------------------------------------------------------- */

  $('lnLang').addEventListener('change', async function (e) {
    /* Leaving a guide half-written is a choice to discard it — but not a
       silent one: switching language with unsaved words asks first, in the
       console's own dialog. */
    var next = e.target.value;
    if (state.guideDirty) {
      e.target.value = state.lang;
      var yes = window.StaffConfirm ? await window.StaffConfirm({
        title: tr('ln.discardGuide'), confirm: tr('ln.discard'), cancel: tr('common.cancel'),
      }) : true;
      if (!yes) return;
      e.target.value = next;
    }
    state.lang = next;
    state.guideDirty = false;
    renderLang();
  });

  $('lnGuide').addEventListener('input', function () {
    state.guideDirty = $('lnGuide').value !== (state.guides[state.lang] || '');
    $('lnGuideSave').disabled = !state.guideDirty;
    $('lnGuideStatus').textContent = '';
  });

  $('lnGuideSave').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    var data = await send('POST', { kind: 'guide', lang: state.lang, guidance: $('lnGuide').value });
    if (!data) { btn.disabled = false; return; }
    state.guideDirty = false;
    take(data);
    renderLang();
    $('lnGuideStatus').textContent = tr('ln.saved');
  });

  $('lnKeepAdd').addEventListener('submit', async function (e) {
    e.preventDefault();
    var box = $('lnKeepTerm');
    var term = box.value.trim();
    if (!term) { box.focus(); return; }
    var data = await send('POST', { kind: 'keep', term: term });
    if (!data) return;
    box.value = '';
    take(data);
    render();
    box.focus();
  });

  $('lnGlossAdd').addEventListener('submit', async function (e) {
    e.preventDefault();
    var src = $('lnSource'), tgt = $('lnTarget');
    if (!src.value.trim()) { src.focus(); return; }
    if (!tgt.value.trim()) { tgt.focus(); return; }
    var data = await send('POST', { kind: 'glossary', lang: state.lang,
                                    source: src.value, target: tgt.value });
    if (!data) return;
    src.value = ''; tgt.value = '';
    take(data);
    renderLang();
    src.focus();
  });

  document.addEventListener('click', async function (e) {
    var k = e.target.closest && e.target.closest('[data-keep]');
    var g = e.target.closest && e.target.closest('[data-gloss]');
    if (!k && !g) return;
    var data = k
      ? await send('DELETE', null, '?kind=keep&id=' + encodeURIComponent(k.getAttribute('data-keep')))
      : await send('DELETE', null, '?kind=glossary&id=' + encodeURIComponent(g.getAttribute('data-gloss')));
    if (!data) return;
    take(data);
    render();
  });

  document.addEventListener('change', async function (e) {
    if (!e.target.matches || !e.target.matches('#lnGlossary input[data-gl]')) return;
    var row = e.target.closest('tr');
    var source = row.querySelector('[data-gl="source"]').value;
    var target = row.querySelector('[data-gl="target"]').value;
    if (!source.trim() || !target.trim()) { renderLang(); return; }
    var data = await send('POST', { kind: 'glossary', id: row.getAttribute('data-id'),
                                    lang: state.lang, source: source, target: target });
    if (!data) { renderLang(); return; }
    take(data);
    renderLang();
    toast(tr('ln.saved'), 'ok');
  });

  window.addEventListener('beforeunload', function (e) {
    if (state.guideDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  boot();
})();
