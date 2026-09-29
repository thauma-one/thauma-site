/* ============================================================
   console-translate.js — "Translate", beside every Editing ⇄ Reference
   ============================================================
   Chase, 2026-09-28: build in the Cloudflare AI now, even if it is not
   accurate yet, so every translation path — every field — can be tried.

   ONE BUTTON PER EDITOR, not per field: beside the language pair, it
   fills the fields in the language being edited from the reference
   language shown above them. Every editor already draws its reference
   the same way — a small line (.ms-ref / .c-ref, carrying its lang)
   directly above the field it belongs to — so this finds the pairs by
   that shape instead of each editor carrying its own copy.

   - Empty fields are filled. If nothing is empty, it asks before
     replacing what is written.
   - The words land as if typed: an input event, so each editor marks
     the change and keeps it for Save or Publish. Nothing is saved here.
   - An answer that lost a {placeholder} or a bold mark is still put in,
     and the field is marked so somebody looks at it.
   - The button shows only where the server has Workers AI
     (html.has-ai) — staging and live; not yet the Pi.

   AND ONE PER LINE (Chase, 2026-09-29: "a subtle Auto-Translate … per
   line as well as the whole document"). A small icon at the end of each
   reference line translates just that line into the field below it.
   Added here, to every reference line any editor draws, rather than by
   each editor — the same shape-finding as the button above, so an editor
   written tomorrow gets it too. Replacing words already written asks
   first, as the whole-document button does.
   ============================================================ */
(function () {
  'use strict';

  var API = '/api/translate';
  var BATCH = 20;

  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function fill(k, v) { return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(k, v) : tr(k); }
  function toast(m, kind) { if (window.StaffToast) window.StaffToast(m, kind); }

  fetch(API, { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b || !b.available) return;
      document.documentElement.classList.add('has-ai');
      mark();
    })
    .catch(function () {});

  /* The editor a button belongs to: the nearest thing that holds both the
     pair and the fields. */
  function scopeOf(btn) {
    return btn.closest('[data-web-panel], .adm-panel, .sh-words, form, .tab-panel') || document;
  }

  function visible(el) { return !!(el && el.offsetParent !== null && !el.hidden); }

  /* The field a reference line belongs to: the next one after it. */
  function fieldFor(ref) {
    var field = ref.nextElementSibling;
    while (field && !field.matches('input, textarea, [contenteditable="true"], .c-split')) field = field.nextElementSibling;
    if (field && field.classList.contains('c-split')) field = field.querySelector('[contenteditable="true"]');
    return field;
  }

  /* Each reference line with the field right after it. */
  function pairs(scope) {
    return [].slice.call(scope.querySelectorAll('.ms-ref, .c-ref')).map(function (ref) {
      return { ref: ref, field: fieldFor(ref) };
    }).filter(function (p) {
      return p.field && visible(p.ref) && visible(p.field) && p.ref.textContent.trim();
    });
  }

  function valueOf(field) {
    return field.isContentEditable ? field.innerHTML.replace(/<(?!\/?b>)[^>]*>/g, '').trim() : field.value.trim();
  }
  function sourceOf(ref) {
    /* Without the line's own translate icon. */
    var copy = ref.cloneNode(true);
    [].forEach.call(copy.querySelectorAll('.ai-one'), function (b) { b.remove(); });
    /* Pages writes a split heading's bold half as <b>; keep it. */
    return copy.innerHTML.replace(/<(?!\/?b>)[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  }
  function put(field, text) {
    if (field.isContentEditable) field.innerHTML = text;
    else field.value = text.replace(/<\/?b>/g, '');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function run(btn) {
    var scope = scopeOf(btn);
    var edit = scope.querySelector('[data-lang-edit]'), ref = scope.querySelector('[data-lang-ref]');
    var all = pairs(scope);
    if (!all.length || !edit) { toast(tr('ai.nothing'), 'err'); return; }
    var to = edit.value;
    var from = all[0].ref.getAttribute('lang') || (ref && ref.value);
    if (!from || from === to) { toast(tr('ai.nothing'), 'err'); return; }

    var todo = all.filter(function (p) { return !valueOf(p.field); });
    if (!todo.length) {
      var ok = window.StaffConfirm ? await window.StaffConfirm({
        title: fill('ai.replaceTitle', { n: all.length }), confirm: tr('ai.replace'), cancel: tr('ms.cancel'),
      }) : false;
      if (!ok) return;
      todo = all;
    }

    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = tr('ai.working');
    var checks = 0, failed = null;
    for (var i = 0; i < todo.length; i += BATCH) {
      var chunk = todo.slice(i, i + BATCH);
      try {
        var res = await fetch(API, {
          method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: from, to: to, items: chunk.map(function (p, j) { return { id: String(j), text: sourceOf(p.ref) }; }) }),
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) { failed = body.error || tr('common.saveFailed'); break; }
        (body.items || []).forEach(function (it) {
          var p = chunk[Number(it.id)];
          if (!p) return;
          if (it.text) put(p.field, it.text);
          p.field.classList.toggle('ai-check', !!it.check);
          if (it.check) checks++;
        });
      } catch (e) { failed = e.message; break; }
    }
    btn.disabled = false;
    btn.textContent = label;
    if (failed) toast(failed, 'err');
    else toast(checks ? fill('ai.doneCheck', { n: checks }) : tr('ai.done'), checks ? 'err' : 'ok');
  }

  /* ---- one line ------------------------------------------------------- */

  /* Material's "translate" glyph (Apache 2.0): an A and a character. */
  var ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.87 15.07l-2.54-2.51.03-.03a17.52 ' +
    '17.52 0 003.71-6.53H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 ' +
    '3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';

  /* Give every reference line its icon — including ones an editor draws
     later, which is most of them. Only once the server has said it can
     translate, so nothing appears where it would be refused. */
  function mark(root) {
    if (!document.documentElement.classList.contains('has-ai')) return;
    [].forEach.call((root || document).querySelectorAll('.ms-ref, .c-ref'), function (ref) {
      if (ref.querySelector('.ai-one') || !ref.textContent.trim()) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-one';
      b.setAttribute('data-ai-one', '');
      b.setAttribute('aria-label', tr('ai.one'));
      b.title = tr('ai.one');
      b.innerHTML = ICON;
      ref.appendChild(b);
    });
  }
  new MutationObserver(function () { mark(); }).observe(document.documentElement, { childList: true, subtree: true });

  async function one(btn) {
    var ref = btn.closest('.ms-ref, .c-ref'), field = ref && fieldFor(ref);
    if (!field) return;
    var scope = scopeOf(ref), edit = scope.querySelector('[data-lang-edit]');
    var from = ref.getAttribute('lang'), to = field.getAttribute('lang') || (edit && edit.value);
    if (!from || !to || from === to) { toast(tr('ai.nothing'), 'err'); return; }
    if (valueOf(field)) {
      var ok = window.StaffConfirm ? await window.StaffConfirm({
        title: tr('ai.replaceOne'), confirm: tr('ai.replace'), cancel: tr('ms.cancel'),
      }) : false;
      if (!ok) return;
    }
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      var res = await fetch(API, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: from, to: to, items: [{ id: '0', text: sourceOf(ref) }] }),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      var it = (body.items || [])[0];
      if (it && it.text) put(field, it.text);
      field.classList.toggle('ai-check', !!(it && it.check));
      if (it && it.check) toast(fill('ai.doneCheck', { n: 1 }), 'err');
      field.focus();
    } catch (e) {
      toast(e.message, 'err');
    }
    btn.disabled = false;
    btn.classList.remove('is-busy');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-lang-translate]');
    if (btn) run(btn);
    var line = e.target.closest && e.target.closest('[data-ai-one]');
    if (line) one(line);
  });
  /* Once somebody edits a flagged field, it is theirs. */
  document.addEventListener('input', function (e) {
    if (e.isTrusted && e.target.classList && e.target.classList.contains('ai-check')) e.target.classList.remove('ai-check');
  });
})();
