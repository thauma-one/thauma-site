/* =====================================================================
   site-app.js — thauma.one as an installed app (docs/APP-PLAN.md)
   =====================================================================
   Chase's decision, 2026-10-13: the Thauma app IS thauma.one, installed
   from the browser (site.webmanifest). In a browser this does nothing.
   Installed, on a phone:
     - the bottom tabs (site-app-tabs.njk) show, the current page lit;
     - the service worker (/sw.js) keeps the site for when there is no
       connection;
     - THE ARCADE stays hidden until it is found through one of its doors.
       From then on it is a tab for good (arcade.js sets
       thauma.arcade.found), and everything it needs is saved on the phone
       so it plays offline.
   ===================================================================== */
(function () {
  'use strict';
  var nav = document.getElementById('siteTabs');
  if (!nav) return;
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;
  if (!standalone) return;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  document.documentElement.classList.add('site-app');
  nav.hidden = false;
  var here = location.pathname;
  [].forEach.call(nav.querySelectorAll('a'), function (a) {
    if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
  });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});

  var arc = nav.querySelector('[data-tab="arcade"]');
  function unlock() {
    if (!arc) return;
    arc.hidden = false;
    keep();
  }
  /* Everything the arcade loads, at the versions this page names, fetched
     once so the service worker has a copy — again only when a version
     changes. */
  function keep() {
    var A = window.THAUMA_ARCADE;
    if (!A || !A.v || !('serviceWorker' in navigator)) return;
    var v = A.v, sig = JSON.stringify(v);
    if (get('thauma.arcade.kept') === sig) return;
    var list = ['/arcade/', '/arcade/words.json?v=' + v.words, '/css/arcade.css?v=' + v.css];
    ['doors', 'fail', 'arcade', 'play', 'sound'].forEach(function (k) { list.push('/js/arcade/' + k + '.js?v=' + v[k]); });
    Object.keys(v.games || {}).forEach(function (g) { list.push('/js/arcade/games/' + g + '.js?v=' + v.games[g]); });
    Object.keys(v.vendor || {}).forEach(function (n) { list.push('/js/arcade/vendor/' + n + '.min.js?v=' + v.vendor[n]); });
    navigator.serviceWorker.ready.then(function () {
      return Promise.all(list.map(function (u) { return fetch(u).then(function (r) { if (!r.ok) throw 0; }); }));
    }).then(function () { set('thauma.arcade.kept', sig); }, function () {});
  }
  if (get('thauma.arcade.found') === '1') unlock();
  document.addEventListener('arcade:found', unlock);
})();
