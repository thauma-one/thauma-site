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
     (html.has-ai); on the Pi it does not.
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
    .then(function (b) { if (b && b.available) document.documentElement.classList.add('has-ai'); })
    .catch(function () {});

  /* The editor a button belongs to: the nearest thing that holds both the
     pair and the fields. */
  function scopeOf(btn) {
    return btn.closest('[data-web-panel], .adm-panel, .sh-words, form, .tab-panel') || document;
  }

  function visible(el) { return !!(el && el.offsetParent !== null && !el.hidden); }

  /* Each reference line with the field right after it. */
  function pairs(scope) {
    return [].slice.call(scope.querySelectorAll('.ms-ref, .c-ref')).map(function (ref) {
      var field = ref.nextElementSibling;
      while (field && !field.matches('input, textarea, [contenteditable="true"], .c-split')) field = field.nextElementSibling;
      if (field && field.classList.contains('c-split')) field = field.querySelector('[contenteditable="true"]');
      return { ref: ref, field: field };
    }).filter(function (p) {
      return p.field && visible(p.ref) && visible(p.field) && p.ref.textContent.trim();
    });
  }

  function valueOf(field) {
    return field.isContentEditable ? field.innerHTML.replace(/<(?!\/?b>)[^>]*>/g, '').trim() : field.value.trim();
  }
  function sourceOf(ref) {
    /* Pages writes a split heading's bold half as <b>; keep it. */
    return ref.innerHTML.replace(/<(?!\/?b>)[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
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

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-lang-translate]');
    if (btn) run(btn);
  });
  /* Once somebody edits a flagged field, it is theirs. */
  document.addEventListener('input', function (e) {
    if (e.isTrusted && e.target.classList && e.target.classList.contains('ai-check')) e.target.classList.remove('ai-check');
  });
})();
