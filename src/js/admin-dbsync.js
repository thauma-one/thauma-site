/* ============================================================
   admin-dbsync.js — the "move data between sites" panel
   ============================================================
   Publishing carries code and schema; it has never carried rows. Doing that
   used to mean two python scripts and a terminal, which meant in practice it
   did not happen. This is the same job with a button on it.

   THE PANEL IS ABSENT, NOT DISABLED, where it is not offered. Staging and
   production hold no credential for reaching another database, so the endpoint
   answers "not available" and the section never appears. A greyed-out control
   invites people to ask why; a missing one matches the truth, which is that
   this is a development-site tool.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('pSync');
  if (!root) return;

  var API = '/api/admin/db-sync';
  var $ = function (id) { return document.getElementById(id); };
  var state = { tables: [], remote: '', busy: false };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function fill(k, v) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(k, v);
    var s = tr(k);
    Object.keys(v || {}).forEach(function (n) { s = s.split('{' + n + '}').join(String(v[n])); });
    return s;
  }
  function note(msg, bad) {
    var el = $('pSyncNote');
    el.textContent = msg || '';
    el.className = 'p-sync-note' + (bad ? ' is-bad' : '');
  }

  function render() {
    var rows = ['<div class="p-sync-row head"><span>' + esc(tr('sync.table')) +
      '</span><span>' + esc(tr('sync.here')) + '</span><span>' +
      esc(state.remote || 'staging') + '</span></div>'];
    state.tables.forEach(function (r) {
      rows.push('<div class="p-sync-row"><span>' + esc(r.table) +
        '</span><span data-side="here">' + r.here +
        '</span><span data-side="there">' + r.there + '</span></div>');
    });
    $('pSyncCounts').innerHTML = rows.join('');
  }

  /* Hovering a direction reddens the column about to be overwritten. The
     wording says "replaces" but a number turning red says which one. */
  function preview(side) {
    Array.prototype.forEach.call(
      root.querySelectorAll('[data-side]'), function (el) {
        el.classList.toggle('loses', !!side && el.getAttribute('data-side') === side);
      });
  }

  async function load() {
    try {
      var res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      var data = await res.json();
      if (!data.available) {
        $('pSyncOff').textContent = data.reason || '';
        $('pSyncOff').hidden = !data.reason;
        return;
      }
      state.tables = data.tables || [];
      state.remote = data.remote || 'staging';
      render();
      root.hidden = false;
    } catch (e) {
      /* Silent. This panel is an extra on a page whose main job is publishing,
         and a red banner about a tool you were not using is noise. */
    }
  }

  async function run(direction) {
    if (state.busy) return;

    var word = direction === 'push' ? 'REPLACE STAGING' : 'REPLACE DEV';
    var losing = direction === 'push' ? state.remote : tr('sync.thisSite');
    var ok = await window.StaffConfirm({
      title: fill('sync.confirmTitle', { where: losing }),
      body: fill('sync.confirmBody', { where: losing }),
      note: tr('sync.confirmNote'),
      type: word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('sync.confirmGo'),
      cancel: tr('ms.cancel'),
    });
    if (!ok) return;

    state.busy = true;
    $('pSyncPush').disabled = $('pSyncPull').disabled = true;
    note(tr('sync.working'));
    try {
      var res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: direction, confirm: word }),
      });
      var data = await res.json();
      if (!res.ok) {
        /* The refusal that matters: real addresses on the way up. It names the
           tables rather than saying "failed", because the fix is to go and
           look at them. */
        if (data.found && data.found.length) {
          note(data.error + ' — ' + data.found.map(function (f) {
            return f.table + ': ' + f.address;
          }).join(', ') + (data.more ? ' (+' + data.more + ')' : ''), true);
        } else {
          note(data.error || tr('sync.failed'), true);
        }
        return;
      }
      note(fill('sync.done', { n: data.rows, where: data.remote }));
      await load();
    } catch (e) {
      note(tr('sync.failed'), true);
    } finally {
      state.busy = false;
      $('pSyncPush').disabled = $('pSyncPull').disabled = false;
      preview(null);
    }
  }

  $('pSyncPush').addEventListener('mouseenter', function () { preview('there'); });
  $('pSyncPull').addEventListener('mouseenter', function () { preview('here'); });
  $('pSyncPush').addEventListener('mouseleave', function () { preview(null); });
  $('pSyncPull').addEventListener('mouseleave', function () { preview(null); });
  $('pSyncPush').addEventListener('click', function () { run('push'); });
  $('pSyncPull').addEventListener('click', function () { run('pull'); });

  load();
})();
