/* ============================================================
   staff-changes.js — What's new
   ============================================================
   Every Publish, newest first: when, who, and what changed, under the
   page it changed on — only the pages this account can open (the server
   filters; workers/src/changes.js). The section names are the header's own
   words, so a section reads exactly like the link that leads to it. A
   release named in the address (#r_…, from the bell) is opened and
   brought into view; the rest are folded after the first.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-staff-page') !== 'changes') return;

  var $ = function (id) { return document.getElementById(id); };
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) { return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* "staff:mail" → the header's "Mail"; staff:index is Home */
  function pageName(page) {
    if (page === 'console' || page === 'site') return tr('chg.' + page);
    var m = /^(staff|admin):(.+)$/.exec(page);
    if (!m) return page;
    return m[1] === 'staff' ? tr('nav.' + (m[2] === 'index' ? 'home' : m[2])) : tr('adm.nav.' + m[2]);
  }
  function sections(list, content) {
    var out = (list || []).map(function (s) {
      return '<section class="chg-sec"><h3>' + esc(pageName(s.page)) + '</h3><ul>' +
        s.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></section>';
    });
    if (content && content.length) {
      out.push('<section class="chg-sec"><h3>' + esc(tr('chg.siteContent')) + '</h3><ul><li>' +
        esc(fill('chg.updated', { what: content.map(function (t) { return tr('web.' + t); }).join(', ') })) + '</li></ul></section>');
    }
    return out.join('');
  }
  function when(iso) {
    var lang = (window.StaffI18n && window.StaffI18n.lang) || 'en';
    try { return new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (e) { return new Date(iso).toLocaleDateString(); }
  }

  var data = null;
  function render() {
    if (!data) return;
    var want = (location.hash || '').slice(1);
    var html = '';
    if (data.waiting && data.waiting.length) {
      html += '<details class="chg-rel is-waiting" open><summary><span class="chg-when">' + esc(tr('chg.waiting')) + '</span>' +
        '<span class="chg-by">' + esc(tr('chg.waitingNote')) + '</span></summary>' + sections(data.waiting) + '</details>';
    }
    if (!data.releases.length) html += '<p class="chg-empty">' + esc(tr('chg.none')) + '</p>';
    html += data.releases.map(function (r, i) {
      var open = want ? r.id === want : i === 0;
      return '<details class="chg-rel" id="' + esc(r.id) + '"' + (open ? ' open' : '') + '>' +
        '<summary><span class="chg-when">' + esc(when(r.at)) + '</span>' +
        (r.by ? '<span class="chg-by">' + esc(fill('chg.by', { name: r.by })) + '</span>' : '') + '</summary>' +
        sections(r.sections, r.content) + '</details>';
    }).join('');
    $('chgList').innerHTML = html;
    var target = want && document.getElementById(want);
    if (target) { target.open = true; target.classList.add('is-target'); target.scrollIntoView({ block: 'start' }); }
  }

  fetch('/api/changes', { credentials: 'same-origin' })
    .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error || r.status); return b; }); })
    .then(function (b) { data = { releases: b.releases || [], waiting: b.waiting || [] }; render(); })
    .catch(function (e) { if (window.StaffProblem) window.StaffProblem(e.message, null); });
  /* the bell pressed while this page is open names another release */
  window.addEventListener('hashchange', render);
})();
