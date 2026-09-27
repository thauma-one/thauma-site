/* ============================================================
   staff-updates.js — one bar for the four sections of Updates
   ============================================================
   Chase, 2026-09-26, option B: every section of Updates —
   milestones, goals, prayer, videos — works one way. Edit freely;
   nothing reaches a partner's site until Publish changes. So the
   page has ONE bar, not a save button per form: it says how much
   is not live yet and in which sections, and publishes or
   discards all of it.

   Each section registers itself here:

     StaffUpdates.register({
       key:      'milestones',          // i18n: up.part.<key>
       count:    function () { … },     // how many items are changed
       removals: function () { … },     // how many of those are deletes
       publish:  async function () { … return { failed: [msg…] } },
       discard:  function () { … },
     });

   and calls StaffUpdates.changed() whenever its count may have
   moved. Publishing goes section by section; one section failing
   does not stop the others, and each reloads what actually landed.
   ============================================================ */
(function () {
  'use strict';

  var bar = document.getElementById('upBar');
  if (!bar) return;
  var $ = function (id) { return document.getElementById(id); };
  var sections = [];
  var busy = false;

  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  function total() {
    return sections.reduce(function (n, s) { return n + s.count(); }, 0);
  }

  function refresh() {
    /* A tab holding changes is marked, so nothing typed on one section is
       forgotten while looking at another. */
    sections.forEach(function (s) {
      var tab = document.querySelector('.tabs .tab[data-tab="' + s.key + '"]');
      if (tab) tab.classList.toggle('is-dirty', !!s.count());
    });
    var n = total();
    bar.hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    if (!n) return;
    var parts = sections.filter(function (s) { return s.count(); }).map(function (s) {
      var c = s.count();
      return c === 1 ? tr('up.part.' + s.key + '1') : fill('up.part.' + s.key, { n: c });
    });
    /* The sections are named on a wide screen; on a phone the dots on the
       tabs say which, and the bar keeps to one line. */
    var count = $('upCount');
    count.textContent = n === 1 ? tr('up.pending1') : fill('up.pendingN', { n: n });
    var which = document.createElement('span');
    which.className = 'up-parts';
    which.textContent = ' — ' + parts.join(', ');
    count.appendChild(which);
  }

  $('upPublish').addEventListener('click', async function () {
    if (busy || !total()) return;
    /* A delete is the one change here that cannot be taken back once it is
       published, so it is said out loud before it happens. */
    var removals = sections.reduce(function (n, s) { return n + (s.removals ? s.removals() : 0); }, 0);
    if (removals) {
      var ok = await window.StaffConfirm({
        title: removals === 1 ? tr('up.removeTitle1') : fill('up.removeTitle', { n: removals }),
        confirm: tr('up.publish'), cancel: tr('ms.cancel'), danger: true
      });
      if (!ok) return;
    }
    busy = true;
    var btn = this;
    btn.disabled = true; $('upDiscard').disabled = true;
    var failed = [];
    for (var i = 0; i < sections.length; i++) {
      if (!sections[i].count()) continue;
      try {
        var r = await sections[i].publish();
        if (r && r.failed) failed = failed.concat(r.failed);
      } catch (e) {
        failed.push(e.message);
      }
    }
    busy = false;
    btn.disabled = false; $('upDiscard').disabled = false;
    refresh();
    if (failed.length) toast(fill('up.failed', { n: failed.length, first: failed[0] }), 'err');
    else toast(tr('up.published'), 'ok');
  });

  $('upDiscard').addEventListener('click', async function () {
    var n = total();
    if (!n || busy) return;
    var ok = await window.StaffConfirm({
      title: n === 1 ? tr('up.discardTitle1') : fill('up.discardTitle', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    sections.forEach(function (s) { if (s.count()) s.discard(); });
    refresh();
    toast(tr('toast.discarded'), 'ok');
  });

  /* Leaving with changes not live yet: the browser's own question. */
  window.addEventListener('beforeunload', function (e) {
    if (!total()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  window.StaffUpdates = {
    register: function (section) { sections.push(section); refresh(); },
    changed: refresh
  };
})();
