/* ============================================================
   admin-website.js — an area's tabs, on one page
   ============================================================
   Chase, 2026-09-27: "Instead of having each tab load on press,
   why not having all tabs load all the content at once. Then nav
   through the tabs can happen at once." And: "if the page reloads
   while working in it, it opens to the same tab we were working
   on."

   The public site's work is four areas in the header since
   2026-10-20 — Updates, Mail, Sharing and Site Creator (Chase:
   "restructure it entirely so it matches similar to the staff
   header"; consoleNav.js `areas`). Each is ONE page with a panel
   per tab, and every tab's script loads its data when the page
   does. This moves between an area's tabs:

   - A tab link shows its panel and changes the address
     (history.pushState) without a reload. The page exists at
     every tab's address and opens on that tab, so a reload or a
     bookmark comes back to the same one. Back and Forward move
     between tabs. A link opened in a new tab or window still
     just follows its address.
   - The window title follows the tab; the heading is the area's.
   - A tab holding unsaved changes is marked in the list, and the
     changes stay while you look at another tab.
   - An old link to the Library's Gatherings tab (#gatherings)
     opens Events.
   - A link to a tab of ANOTHER area is an ordinary link.

   THE ONE THING THE TABS SHARE is site.json — Settings, Photos
   and the languages on Pages all save into it. Each of them
   announces a save ('thauma:site-saved', with the new version and
   what changed) and listens for the others', so after a save on
   one tab every tab shows what was saved and saves against the
   new version rather than being refused as out of date.
   ============================================================ */
(function () {
  'use strict';

  var area = document.getElementById('webArea');
  var panels = [].slice.call(document.querySelectorAll('[data-web-panel]'));
  if (!area || !panels.length) return;

  var side = area.querySelector('.web-side');
  var links = side ? [].slice.call(side.querySelectorAll('[data-web-tab]')) : [];
  function linkFor(tab) {
    for (var i = 0; i < links.length; i++) if (links[i].getAttribute('data-web-tab') === tab) return links[i];
    return null;
  }

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
    var link = linkFor(tab);
    if (!link) return;
    panels.forEach(function (p) { p.hidden = p.getAttribute('data-web-panel') !== tab; });
    links.forEach(function (a) {
      if (a === link) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    area.setAttribute('data-tab', tab);
    document.title = document.title.replace(/^[^·]*·/, link.textContent.trim() + ' ·');
    /* Tell the tab it is on screen, for anything it can only measure when
       it is (the height of a text box). */
    document.dispatchEvent(new CustomEvent('web:panel', { detail: tab }));
  }
  function go(link) {
    var tab = link.getAttribute('data-web-tab');
    if (tab === current()) return false;
    history.pushState({ webTab: tab }, '', link.href);
    show(tab);
    return true;
  }
  function plain(e) { return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey; }

  if (side) side.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-web-tab]');
    if (!a || !plain(e)) return;
    e.preventDefault();
    if (go(a)) window.scrollTo(0, 0);
  });

  /* A LINK FROM ONE TAB TO ANOTHER of this area moves like the list does,
     keeping unsaved edits on the tab being left. One to another area —
     "Its words → Pages › Contact" on Sharing — is an ordinary link, and
     the page it opens reads where to go from its address. */
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-web-go]');
    if (!a || !plain(e)) return;
    var link = linkFor(a.getAttribute('data-web-go'));
    if (!link) return;
    e.preventDefault();
    go(link);
    window.scrollTo(0, 0);
  });

  window.addEventListener('popstate', function () {
    var tab = tabFromPath(location.pathname);
    if (tab) show(tab);
  });

  if (location.hash === '#gatherings') {
    var ev = linkFor('events');
    if (ev) { history.replaceState({ webTab: 'events' }, '', ev.href); show('events'); }
  }

  /* ---- which tabs are holding unsaved changes -------------------------
     Each tab's save bar says so for itself; the list says so for all of
     them, so nothing typed on one tab is forgotten while on another. A
     bar shared by tabs (the words, on Pages and Advanced) names them in
     data-tabs. */
  var bars = [].slice.call(area.querySelectorAll('.ms-savebar'));
  function markDirty() {
    var dirty = {};
    bars.forEach(function (b) {
      if (b.hidden) return;
      var panel = b.closest('[data-web-panel]');
      var tabs = b.getAttribute('data-tabs') ? b.getAttribute('data-tabs').split(' ') : panel ? [panel.getAttribute('data-web-panel')] : [];
      tabs.forEach(function (t) { dirty[t] = true; });
    });
    links.forEach(function (a) { a.classList.toggle('is-dirty', !!dirty[a.getAttribute('data-web-tab')]); });
  }
  var watch = new MutationObserver(markDirty);
  bars.forEach(function (b) { watch.observe(b, { attributes: true, attributeFilter: ['hidden', 'data-tabs'] }); });
  markDirty();

  /* ---- which tabs hold changes not published yet ----------------------
     The same dot as an unsaved change, as the Site Creator marks its tabs
     (Chase, 2026-10-08). Asked once, and again after anything is saved,
     where the area publishes; Pages is told which lines, for the dots on
     its pages. */
  if (!document.getElementById('pBar')) return;
  var asking = null;
  function askChanges() {
    if (asking) return;
    asking = fetch('/api/admin/publish?changes', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        asking = null;
        if (!d || !d.tabs) return;
        links.forEach(function (a) { a.classList.toggle('has-changes', d.tabs.indexOf(a.getAttribute('data-web-tab')) !== -1); });
        document.dispatchEvent(new CustomEvent('web:changes', { detail: { lines: d.lines || [] } }));
      })
      .catch(function () { asking = null; });
  }
  askChanges();
  document.addEventListener('web:saved', function () { setTimeout(askChanges, 1500); });
  document.addEventListener('thauma:site-saved', function () { setTimeout(askChanges, 1500); });
})();
