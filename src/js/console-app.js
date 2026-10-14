/* ============================================================
   console-app.js — the console as an app (docs/APP-PLAN.md)
   ============================================================
   Chase, 2026-10-13: "UX IS SUPER SUPER IMPORTANT!!!! Especially when it
   comes to mobile apps. it has to be fast and easy to use, as well as
   fun/interactive."

   On every console page, after staff.js:

   · THE SERVICE WORKER (/sw.js): what lets a push reach a phone, and pages
     and assets open fast (and say so plainly when offline).
   · THE NUMBER ON THE ICON: the bell's unread count on the home-screen
     icon too (navigator.setAppBadge), wherever the browser allows it.
   · BOTTOM TABS when the console is open as the installed app on a phone:
     the three pages this account uses most, the bell and More (the whole
     menu) — under the thumb, where an app keeps them. The header keeps
     only the logo.
   · PULL TO REFRESH in the app, which an installed iPhone app does not get
     from the browser.
   · A GENTLE INVITATION to install, on a phone in the browser: once, and
     again a week after "Not now". Android installs from the button; an
     iPhone cannot be installed from a page, so it shows the two steps.
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  var html = document.documentElement;
  var standalone = (window.matchMedia && (matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: minimal-ui)').matches)) || window.navigator.standalone === true;
  var phone = window.matchMedia && matchMedia('(max-width: 900px)').matches;
  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  html.classList.toggle('in-app', !!standalone);

  /* ---- the service worker ---- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
    /* a notice pressed while this page is open, where navigate() is refused */
    navigator.serviceWorker.addEventListener && navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.open) location.href = e.data.open;
    });
  }

  /* ---- the number on the icon (staff.js's bell calls this) ---- */
  window.StaffAppBadge = function (n) {
    try {
      if (n && navigator.setAppBadge) navigator.setAppBadge(n);
      else if (!n && navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (e) {}
  };

  function buzz() { try { if (navigator.vibrate && !reduced) navigator.vibrate(8); } catch (e) {} }

  /* ---- bottom tabs, in the installed app on a phone ---- */
  var ICON = {
    home: '<path d="M4 11.5 12 5l8 6.5V20h-5.5v-5h-5v5H4z"/>',
    updates: '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>',
    mail: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="m4 7 8 6 8-6"/>',
    overview: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.6c2.6-.3 4.4 1.3 5 4"/>',
    website: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5z"/>',
    stewardship: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  };
  var PICK = [['/staff/', 'home'], ['/staff/updates/', 'updates'], ['/staff/mail/', 'mail'], ['/admin/', 'overview'],
              ['/admin/users/', 'people'], ['/staff/stewardship/', 'stewardship'], ['/admin/website/', 'website']];
  function svg(name) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>';
  }
  function tabs() {
    if (!standalone || !phone || $('appTabs')) return;
    /* the three this account uses most, from the links the header shows it */
    var shown = [].slice.call(document.querySelectorAll('.console-row:not([hidden]) nav a:not([hidden])'));
    var have = shown.map(function (a) { return a.getAttribute('href'); });
    var chosen = PICK.filter(function (p) { return have.indexOf(p[0]) >= 0; }).slice(0, 3);
    if (!chosen.length) return;
    var here = location.pathname;
    var active = chosen.reduce(function (best, p) { return here.indexOf(p[0]) === 0 && (!best || p[0].length > best.length) ? p[0] : best; }, null);
    var label = function (href) { var a = shown.filter(function (x) { return x.getAttribute('href') === href; })[0]; return a ? a.textContent.trim() : href; };
    var bar = document.createElement('nav');
    bar.id = 'appTabs'; bar.className = 'app-tabs'; bar.setAttribute('aria-label', tr('app.tabs'));
    bar.innerHTML = chosen.map(function (p) {
      return '<a href="' + p[0] + '"' + (p[0] === active ? ' aria-current="page"' : '') + '>' + svg(p[1]) + '<span>' + label(p[0]) + '</span></a>';
    }).join('') +
      '<button type="button" data-app-tab="bell">' + svg('bell') + '<span>' + tr('bell.title') + '</span><i class="app-tabs-n" id="appTabsN" hidden></i></button>' +
      '<button type="button" data-app-tab="more">' + svg('more') + '<span>' + tr('app.more') + '</span></button>';
    document.body.appendChild(bar);
    html.classList.add('has-app-tabs');
    bar.addEventListener('click', function (e) {
      var t = e.target.closest('a,button');
      if (!t) return;
      buzz();
      var which = t.getAttribute('data-app-tab');
      if (which === 'bell') { e.preventDefault(); e.stopPropagation(); var b = $('consoleBellBtn'); if (b) b.click(); }
      if (which === 'more') { e.preventDefault(); e.stopPropagation(); var m = $('consoleMenuBtn'); if (m) m.click(); }
    });
    /* the bell's number on its tab as well */
    var n = $('consoleBellN'), tn = $('appTabsN');
    if (n && tn && window.MutationObserver) {
      var sync = function () { tn.hidden = n.hidden; tn.textContent = n.textContent; };
      new MutationObserver(sync).observe(n, { attributes: true, childList: true, characterData: true, subtree: true });
      sync();
    }
  }
  /* after staff.js has decided which links this account sees */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(tabs, 0); });
  else setTimeout(tabs, 0);

  /* ---- pull to refresh, in the app ---- */
  if (standalone && 'ontouchstart' in window) {
    var startY = null, pulled = 0, cue = null;
    var LIMIT = 72;
    document.addEventListener('touchstart', function (e) {
      if (window.scrollY > 0 || e.touches.length !== 1 || document.querySelector('.dlg-back:not([hidden]),.bell-open,.menu-open')) { startY = null; return; }
      startY = e.touches[0].clientY; pulled = 0;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (startY == null) return;
      pulled = Math.max(0, e.touches[0].clientY - startY);
      if (!pulled) return;
      if (!cue) { cue = document.createElement('div'); cue.className = 'app-pull'; cue.innerHTML = '<i></i>'; document.body.appendChild(cue); }
      var p = Math.min(1, pulled / LIMIT);
      cue.style.transform = 'translate(-50%,' + Math.round(p * 56) + 'px) rotate(' + Math.round(p * 270) + 'deg)';
      cue.style.opacity = String(p);
      cue.classList.toggle('is-ready', p >= 1);
    }, { passive: true });
    document.addEventListener('touchend', function () {
      if (startY == null) return;
      startY = null;
      if (cue && pulled >= LIMIT) { cue.classList.add('is-loading'); buzz(); location.reload(); return; }
      if (cue) { cue.remove(); cue = null; }
    });
  }

  /* ---- the invitation to install, on a phone in the browser ---- */
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; invite(); });
  function later() { try { return Date.now() < Number(localStorage.getItem('thauma.console.install.later') || 0); } catch (e) { return false; } }
  function invite() {
    if (standalone || !phone || later() || $('appInvite')) return;
    if (!deferred && !ios) return;
    var box = document.createElement('div');
    box.id = 'appInvite'; box.className = 'app-invite'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', tr('app.install'));
    box.innerHTML = '<img src="/console-icon-192.png" alt="" width="44" height="44">' +
      '<div class="app-invite-t"><b>' + tr('app.install') + '</b></div>' +
      '<button type="button" class="solid-btn sm" data-app-invite="yes">' + tr(ios ? 'app.how' : 'app.installBtn') + '</button>' +
      '<button type="button" class="app-invite-x" data-app-invite="no" aria-label="' + tr('app.notNow') + '">&times;</button>';
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add('is-in'); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-app-invite]');
      if (!b) return;
      if (b.getAttribute('data-app-invite') === 'no') {
        try { localStorage.setItem('thauma.console.install.later', String(Date.now() + 7 * 864e5)); } catch (err) {}
        box.remove(); return;
      }
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function () { box.remove(); deferred = null; });
      } else iosSteps();
    });
  }
  /* An iPhone cannot be asked from a page: show the two steps. */
  function iosSteps() {
    var share = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/></svg>';
    var add = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg>';
    var sheet = document.createElement('div');
    sheet.className = 'app-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', tr('app.iosTitle'));
    sheet.innerHTML = '<div class="app-sheet-in"><b>' + tr('app.iosTitle') + '</b>' +
      '<ol><li>' + share + '<span>' + tr('app.ios1') + '</span></li><li>' + add + '<span>' + tr('app.ios2') + '</span></li></ol>' +
      '<button type="button" class="ghost-btn" data-close>' + tr('nav.close') + '</button></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.closest('[data-close]')) sheet.remove(); });
  }
  if (ios) setTimeout(invite, 2500);
})();
