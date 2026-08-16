/* ============================================================
   admin-publish.js — moving the working branch onto the live one
   ============================================================
   Talks to /api/admin/publish.

   NO WORKING COPY HERE, AND NO SAVE BAR IN THE USUAL SENSE.
   The other two admin screens hold a draft because they are
   editing something. This one has nothing to edit: it reads a
   state that lives in GitHub and performs one act against it.
   Everything on screen is the server's answer, re-read after
   every action — the whole value of the page is that the list
   is true.

   THE LIST IS THE FEATURE. A publish carries every commit on
   the working branch, not only the words somebody typed. So
   the commits, the files, and above all any MIGRATIONS are
   shown before the button, and the button says what it will
   ship rather than just "Publish".
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'publish') return;

  var API = '/api/admin/publish';
  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* ---- loading -------------------------------------------------------- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, load);
      return;
    }
    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', load);
      return;
    }

    if (res.status === 403) {
      if ($('notAdmin')) $('notAdmin').hidden = false;
      $('pRoot').hidden = true;
      $('pBar').hidden = true;
      if (window.StaffProblemClear) window.StaffProblemClear();
      return;
    }
    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401 ? tr('err.expired')
            : tr('err.refused') + ' (' + res.status + ')' + (body.error ? ' — ' + body.error : ''),
          res.status === 401 ? null : load);
      }
      return;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();

    if (body.configured === false) {
      var el = $('pNotConfigured');
      el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(body.reason || '');
      el.hidden = false;
      $('pRoot').hidden = true;
      $('pBar').hidden = true;
      return;
    }

    state = body;
    $('pRoot').hidden = false;
    try { render(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.renderFailed') + ': ' + e.message, null);
      console.error('publish render failed:', e);
    }
  }

  /* ---- rendering ------------------------------------------------------ */

  function render() {
    renderState();
    renderMigrations();
    renderCommits();
    renderFiles();
    renderDrift();
    renderBar();
  }

  function renderState() {
    var n = state.waiting;
    var cls = n ? 'is-waiting' : 'is-clean';
    var headline = n
      ? (n === 1 ? tr('pub.oneWaiting') : tr('pub.nWaiting').replace('{n}', n))
      : tr('pub.upToDate');

    $('pState').className = 'p-state ' + cls;
    $('pState').innerHTML =
      '<div class="p-branches">' +
        '<span class="p-branch">' + esc(state.staging) + '</span>' +
        '<span class="p-arrow" aria-hidden="true">&rarr;</span>' +
        '<span class="p-branch is-live">' + esc(state.live) + '</span>' +
      '</div>' +
      '<div class="p-headline">' + esc(headline) + '</div>' +
      '<div class="p-sub">' + esc(state.repo) +
        (state.compare_url
          ? ' · <a href="' + esc(state.compare_url) + '" target="_blank" rel="noopener">' +
            esc(tr('pub.viewOnGithub')) + '</a>'
          : '') +
      '</div>';
  }

  function renderMigrations() {
    var m = state.migrations || [];
    var el = $('pMigrations');
    el.hidden = !m.length;
    if (!m.length) return;

    /* The one warning on this page that is about something OUTSIDE the deploy.
       Everything else here fixes itself when the Action runs; this does not. */
    el.innerHTML =
      '<b>' + esc(tr('pub.migrationsTitle')) + '</b> ' +
      esc(tr('pub.migrationsBody').replace('{n}', m.length)) +
      '<ul>' + m.map(function (f) {
        return '<li><code>' + esc(f) + '</code></li>';
      }).join('') + '</ul>' +
      '<code class="p-cmd">npx wrangler d1 migrations apply thauma-ops --remote</code>';
  }

  function renderCommits() {
    var c = state.commits || [];
    if (!c.length) {
      $('pCommits').innerHTML = '<p class="empty">' + esc(tr('pub.noCommits')) + '</p>';
      return;
    }
    $('pCommits').innerHTML = c.map(function (x) {
      return '<div class="p-commit">' +
        '<code class="p-sha">' + esc(x.sha) + '</code>' +
        '<span class="p-msg">' + esc(x.message) + '</span>' +
        '<span class="p-who">' + esc(x.author) + '</span>' +
      '</div>';
    }).join('');
  }

  function renderFiles() {
    var f = state.files || [];
    if (!f.length) {
      $('pFiles').innerHTML = '<p class="empty">' + esc(tr('pub.noFiles')) + '</p>';
      return;
    }
    /* Grouped by top directory. A flat list of 58 paths is not something a
       person reads; "workers/ 14, src/ 31" is something they can judge. */
    var groups = {};
    f.forEach(function (path) {
      var top = path.indexOf('/') === -1 ? '/' : path.slice(0, path.indexOf('/'));
      (groups[top] = groups[top] || []).push(path);
    });
    $('pFiles').innerHTML = Object.keys(groups).sort().map(function (g) {
      return '<details class="p-fgroup">' +
        '<summary><span>' + esc(g) + '</span>' +
        '<span class="tnum">' + groups[g].length + '</span></summary>' +
        '<ul>' + groups[g].map(function (p) {
          return '<li><code>' + esc(p) + '</code></li>';
        }).join('') + '</ul>' +
      '</details>';
    }).join('');
  }

  function renderDrift() {
    var el = $('pDrift');
    el.hidden = !state.drifted;
    if (!state.drifted) return;
    el.innerHTML =
      '<div class="p-drift-text">' +
        '<b>' + esc(tr('pub.driftTitle')) + '</b> ' +
        esc(tr('pub.driftBody')
          .replace('{n}', state.drifted)
          .replace('{live}', state.live)
          .replace('{staging}', state.staging)) +
      '</div>' +
      '<button type="button" class="ghost-btn" id="pSync">' +
        esc(tr('pub.sync').replace('{live}', state.live).replace('{staging}', state.staging)) +
      '</button>';
  }

  function renderBar() {
    var n = state.waiting;
    $('pBar').hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    if (!n) return;
    $('pBarCount').textContent = n === 1
      ? tr('pub.oneWaiting') : tr('pub.nWaiting').replace('{n}', n);
    $('pBarNote').textContent = tr('pub.barNote').replace('{live}', state.live);
  }

  /* ---- publishing ----------------------------------------------------- */

  $('pPublish').addEventListener('click', async function () {
    if (busy || !state || !state.waiting) return;

    var m = (state.migrations || []).length;
    var ok = await window.StaffConfirm({
      title: tr('pub.confirmTitle'),
      body: tr('pub.confirmBody')
        .replace('{n}', state.waiting)
        .replace('{staging}', state.staging)
        .replace('{live}', state.live),
      /* The migration warning is repeated INSIDE the dialog. Somebody who
         scrolled past it on the page is exactly the person about to press the
         button, and the dialog is the last place it can still be read. */
      note: m
        ? tr('pub.confirmMigrations').replace('{n}', m)
        : tr('pub.confirmNote'),
      type: state.confirm_word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('pub.publish'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    await act({ direction: 'publish', confirm: state.confirm_word }, this);
  });

  $('pRefresh').addEventListener('click', function () { if (!busy) load(); });

  /* Delegated: the sync button only exists when the branches have drifted. */
  $('pRoot').addEventListener('click', async function (e) {
    if (!e.target.closest('#pSync') || busy) return;
    var ok = await window.StaffConfirm({
      title: tr('pub.syncTitle'),
      body: tr('pub.syncBody')
        .replace('{n}', state.drifted)
        .replace('{live}', state.live)
        .replace('{staging}', state.staging),
      confirm: tr('pub.syncDo'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;
    await act({ direction: 'sync' }, e.target.closest('#pSync'));
  });

  async function act(payload, btn) {
    busy = true;
    if (btn) btn.disabled = true;
    $('pRefresh').disabled = true;

    var res, body;
    try {
      res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      body = await res.json();
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'bad');
      busy = false;
      if (btn) btn.disabled = false;
      $('pRefresh').disabled = false;
      return;
    }

    busy = false;
    if (btn) btn.disabled = false;
    $('pRefresh').disabled = false;

    if (!res.ok) {
      /* A merge conflict is a condition, not an event — it persists until
         somebody goes and resolves it, and it needs a terminal. So it is
         pinned rather than raised as a toast that scrolls away. */
      if (res.status === 409 && window.StaffProblem) window.StaffProblem(body.error, load);
      else toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'bad');
      return;
    }

    if (body.alreadyUpToDate) toast(body.message || tr('pub.nothingToDo'), 'ok');
    else if (payload.direction === 'sync') {
      toast(tr('pub.synced').replace('{n}', body.merged), 'ok');
    } else {
      toast(tr('pub.published').replace('{n}', body.merged), 'ok');
    }

    // Re-read rather than assume. What is live is the one thing on this page
    // that must never be a guess.
    await load();
  }

  load();
})();
