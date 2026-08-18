/* ============================================================
   admin-publish.js — Preview and Publish
   ============================================================
   Talks to /api/admin/publish.

   NO WORKING COPY AND NO SAVE BAR IN THE USUAL SENSE. The other
   admin screens hold a draft because they are editing
   something. This one has nothing to edit: it reads a state
   that lives in GitHub and performs one of two acts against it.
   Everything on screen is the server's answer, re-read after
   every action — the whole value of the page is that the list
   is true.

   THE LIST IS THE FEATURE. Publishing sends everything that has
   been saved since the last time, not only the change you made
   five minutes ago. So the changes, the files, and above all
   any DATABASE MIGRATIONS are shown before the button.

   THE WORD "BRANCH" DOES NOT APPEAR ON THIS PAGE. It is in the
   payload, because the server has to name what it is building,
   and it is deliberately not rendered. Branches are how code
   gets shipped; this page is for words.
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
  /* Translate and substitute together — see StaffI18n.fill. Every value named
     in one place, so a missing one is visible rather than invisible. */
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill
      ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* "2 hours ago" rather than a timestamp. The only question anyone asks of
     these dates is how stale the thing is. */
  function ago(iso) {
    if (!iso) return '';
    var s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 90) return tr('pub.justNow');
    var m = Math.round(s / 60);
    if (m < 60) return tr('pub.minutesAgo').replace('{n}', m);
    var h = Math.round(m / 60);
    if (h < 36) return tr('pub.hoursAgo').replace('{n}', h);
    return tr('pub.daysAgo').replace('{n}', Math.round(h / 24));
  }

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
      $('pRoot').hidden = true; $('pBar').hidden = true;
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
      $('pRoot').hidden = true; $('pBar').hidden = true;
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
    renderBar();
  }

  function renderState() {
    var n = state.waiting;
    var headline, cls;

    if (state.neverPublished) {
      headline = tr('pub.neverPublished');
      cls = 'is-waiting';
    } else if (n) {
      headline = n === 1 ? tr('pub.oneWaiting') : tr('pub.nWaiting').replace('{n}', n);
      cls = 'is-waiting';
    } else {
      headline = tr('pub.upToDate');
      cls = 'is-clean';
    }

    var lines = [];
    if (state.published) {
      lines.push(fill('pub.liveSince',
                      { when: ago(state.published.at), sha: state.published.sha }));
    }
    if (state.preview) {
      /* Whether next.thauma.one is showing what you would be publishing. A
         preview quietly out of date is worse than no preview, because it is
         believed. */
      lines.push(fill(state.preview.current ? 'pub.previewCurrent' : 'pub.previewStale',
                      { when: ago(state.preview.at) }));
    } else {
      lines.push(tr('pub.previewNever'));
    }

    $('pState').className = 'p-state ' + cls;
    $('pState').innerHTML =
      '<div class="p-headline">' + esc(headline) + '</div>' +
      '<div class="p-sub">' + lines.map(esc).join(' &middot; ') +
        (state.compare_url
          ? ' &middot; <a href="' + esc(state.compare_url) + '" target="_blank" rel="noopener">' +
            esc(tr('pub.viewOnGithub')) + '</a>'
          : '') +
      '</div>';
  }

  function renderMigrations() {
    var m = state.migrations || [];
    var el = $('pMigrations');
    el.hidden = !m.length;
    if (!m.length) return;
    el.innerHTML =
      '<b>' + esc(tr('pub.migrationsTitle')) + '</b> ' +
      esc(tr('pub.migrationsBody').replace('{n}', m.length)) +
      '<ul>' + m.map(function (f) {
        return '<li><code>' + esc(f) + '</code></li>';
      }).join('') + '</ul>';
  }

  function renderCommits() {
    var c = state.commits || [];
    if (!c.length) {
      $('pCommits').innerHTML = '<p class="empty">' + esc(tr('pub.noChanges')) + '</p>';
      return;
    }
    $('pCommits').innerHTML = c.map(function (x) {
      /* The save marker is machinery, not information — every content save
         carries it. Showing it would put "[skip ci]" on every line of a list
         meant to be readable. */
      var msg = String(x.message || '').replace(/\s*\[skip ci\]\s*/g, ' ').trim();
      return '<div class="p-commit">' +
        '<span class="p-msg">' + esc(msg) + '</span>' +
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

  function renderBar() {
    var n = state.waiting;
    // Preview is useful even with nothing waiting — it rebuilds the preview
    // site. Publish is not, so only that one goes away.
    $('pBar').hidden = false;
    document.body.classList.toggle('has-savebar', true);
    $('pPublish').disabled = !n && !state.neverPublished;

    $('pBarCount').textContent = n
      ? (n === 1 ? tr('pub.oneWaiting') : tr('pub.nWaiting').replace('{n}', n))
      : tr('pub.upToDate');
    $('pBarNote').textContent = n ? tr('pub.barNote') : '';
  }

  /* ---- the two actions ------------------------------------------------ */

  $('pRefresh').addEventListener('click', function () { if (!busy) load(); });

  $('pPreview').addEventListener('click', function () {
    // No confirmation. Preview changes nothing anybody outside can see, and a
    // dialog on a harmless action trains people to dismiss dialogs.
    if (!busy) act({ action: 'preview' }, this);
  });

  $('pPublish').addEventListener('click', async function () {
    if (busy || !state) return;

    var m = (state.migrations || []).length;
    var ok = await window.StaffConfirm({
      title: tr('pub.confirmTitle'),
      body: tr('pub.confirmBody').replace('{n}', state.waiting),
      note: m ? tr('pub.confirmMigrations').replace('{n}', m) : tr('pub.confirmNote'),
      type: state.confirm_word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('pub.publish'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    await act({ action: 'publish', confirm: state.confirm_word }, this);
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
      /* A missing permission is a CONDITION — it will fail identically every
         time until somebody changes the app's settings — so it is pinned
         rather than raised as a toast that scrolls away. */
      if (res.status === 403 && window.StaffProblem) window.StaffProblem(body.error, load);
      else toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'bad');
      return;
    }

    toast(payload.action === 'publish'
      ? tr('pub.publishStarted')
      : tr('pub.previewStarted'), 'ok');

    /* The build takes a minute or two and nothing here waits for it. Re-read
       shortly, so "live since" catches up without anyone pressing Refresh —
       once, not on a loop, because a page that polls forever is a page that
       keeps a laptop awake. */
    setTimeout(load, 20000);
  }

  load();
})();
