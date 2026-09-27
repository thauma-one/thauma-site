/* ============================================================
   admin-website.js — the Website area's tabs, on one page
   ============================================================
   Chase, 2026-09-27: "Instead of having each tab load on press,
   why not having all tabs load all the content at once. Then nav
   through the tabs can happen at once." And: "if the page reloads
   while working in it, it opens to the same tab we were working
   on."

   So every tab (Pages, Forms, Mail, Resources, Events, Photos,
   Settings) is a panel of one page, and every tab's script loads
   its data when the page does. This moves between them:

   - A tab link shows its panel and changes the address
     (history.pushState) without a reload. The page exists at
     every tab's address and opens on that tab, so a reload or a
     bookmark comes back to the same one. Back and Forward move
     between tabs. A link opened in a new tab or window still
     just follows its address.
   - The heading and the window title follow the tab.
   - A tab holding unsaved changes is marked in the list, and the
     changes stay while you look at another tab.
   - An old link to the Library's Gatherings tab (#gatherings)
     opens Events.

   THE ONE THING THE TABS SHARE is site.json — Settings, Photos
   and the languages table on Pages all save into it. Each of them
   announces a save ('thauma:site-saved', with the new version and
   what changed) and listens for the others', so after a save on
   one tab every tab shows what was saved and saves against the
   new version rather than being refused as out of date.
   ============================================================ */
(function () {
  'use strict';

  var side = document.querySelector('.web-side');
  if (!side || !document.querySelector('[data-web-panel]')) return;

  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  var links = [].slice.call(side.querySelectorAll('[data-web-tab]'));
  var panels = [].slice.call(document.querySelectorAll('[data-web-panel]'));

  function tabFromPath(path) {
    for (var i = 0; i < links.length; i++) {
      if (new URL(links[i].href, location.href).pathname === path) return links[i].getAttribute('data-web-tab');
    }
    return null;
  }
  function current() {
    for (var i = 0; i < panels.length; i++) if (!panels[i].hidden) return panels[i].getAttribute('data-web-panel');
    return null;
  }

  function show(tab) {
    var link = side.querySelector('[data-web-tab="' + tab + '"]');
    if (!link) return;
    panels.forEach(function (p) { p.hidden = p.getAttribute('data-web-panel') !== tab; });
    links.forEach(function (a) {
      if (a === link) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var h = document.getElementById('pageHeading');
    if (h) {
      var key = 'adm.page.' + link.getAttribute('data-heading-key') + '.heading';
      h.setAttribute('data-i18n-html', key);
      if (tr(key) !== key) h.innerHTML = tr(key);
    }
    document.title = document.title.replace(/^[^·]*·/, link.textContent.trim() + ' ·');
    /* Tell the tab it is on screen, for anything it can only measure when
       it is (the height of a text box). */
    document.dispatchEvent(new CustomEvent('web:panel', { detail: tab }));
  }

  side.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-web-tab]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    var tab = a.getAttribute('data-web-tab');
    if (tab === current()) return;
    history.pushState({ webTab: tab }, '', a.href);
    show(tab);
    window.scrollTo(0, 0);
  });

  /* A LINK FROM ONE TAB TO ANOTHER — "Its words → Pages › Contact" on
     Forms, "Where messages go → Forms" on Pages — moves like the side list
     does, keeping unsaved edits on the tab being left. data-pages-section
     opens Pages on that page's words. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-web-go]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var link = side.querySelector('[data-web-tab="' + a.getAttribute('data-web-go') + '"]');
    if (!link) return;
    e.preventDefault();
    var tab = link.getAttribute('data-web-tab');
    if (tab !== current()) { history.pushState({ webTab: tab }, '', link.href); show(tab); }
    var section = a.getAttribute('data-pages-section');
    if (section) document.dispatchEvent(new CustomEvent('content:section', { detail: section }));
    window.scrollTo(0, 0);
  });

  window.addEventListener('popstate', function () {
    var tab = tabFromPath(location.pathname);
    if (tab) show(tab);
  });

  if (location.hash === '#gatherings') {
    var ev = side.querySelector('[data-web-tab="events"]');
    if (ev) { history.replaceState({ webTab: 'events' }, '', ev.href); show('events'); }
  }

  /* ---- which tabs are holding unsaved changes -------------------------
     Each tab's save bar says so for itself; the list says so for all of
     them, so nothing typed on one tab is forgotten while on another. */
  function markDirty() {
    panels.forEach(function (p) {
      var bars = p.querySelectorAll('.ms-savebar');
      var dirty = [].some.call(bars, function (b) { return !b.hidden; });
      var link = side.querySelector('[data-web-tab="' + p.getAttribute('data-web-panel') + '"]');
      if (link) link.classList.toggle('is-dirty', dirty);
    });
  }
  var watch = new MutationObserver(markDirty);
  panels.forEach(function (p) {
    [].forEach.call(p.querySelectorAll('.ms-savebar'), function (b) {
      watch.observe(b, { attributes: true, attributeFilter: ['hidden'] });
    });
  });
  markDirty();
})();
