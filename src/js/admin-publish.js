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
  var MIG = '/api/admin/migrate';
  var $ = function (id) { return document.getElementById(id); };
  var state = null;
  var mig = null;      // what the DATABASE says, which is a different question
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

    /* Separate request, and deliberately not awaited above. The database's
       migration state is not part of "what is waiting to go live" — it is a
       property of the live database, true whether or not anything is waiting.
       A slow or failing answer here must not stop the rest of the page
       rendering. */
    loadMigrations();
  }

  async function loadMigrations() {
    try {
      var res = await fetch(MIG, { credentials: 'same-origin', cache: 'no-store' });
      var body = await res.json();
      mig = res.ok ? body : { error: (body && body.error) || ('HTTP ' + res.status) };
    } catch (e) {
      mig = { error: e.message };
    }
    try { renderMigrations(); }
    catch (e) { console.error('migration render failed:', e); }
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

  /**
   * The database panel.
   *
   * Two sources, and the difference between them is the point:
   *
   *   state.migrations  migration FILES in the release about to be published
   *   mig.pending       migrations the LIVE DATABASE has not run
   *
   * A file can be in the release and already applied. A migration can be
   * pending with no file in the release, because it was merged weeks ago and
   * nobody ran it — which is the case that went unnoticed for weeks and broke
   * removing a person. So `mig` is the authority, and the release list is
   * shown only as a heads-up when it is not already covered.
   */
  function renderMigrations() {
    var el = $('pMigrations');
    if (!mig) { el.hidden = true; return; }

    if (mig.error) {
      el.hidden = false;
      el.className = 'p-migrations is-unknown';
      el.innerHTML = '<b>' + esc(tr('pub.migUnknown')) + '</b> ' + esc(mig.error);
      return;
    }

    var pending = mig.pending || [];
    var inRelease = state && state.migrations ? state.migrations.length : 0;

    /* Applied, nothing pending, and nothing in the release: say so quietly
       and stop. A green box on every visit trains people to stop reading it. */
    if (!pending.length && !inRelease) {
      el.hidden = false;
      el.className = 'p-migrations is-clean';
      el.innerHTML = '<b>' + esc(tr('pub.migClean')) + '</b> ' +
        esc(fill('pub.migAppliedCount', { n: (mig.applied || []).length }));
      return;
    }

    el.hidden = false;
    el.className = 'p-migrations' + (pending.length ? ' is-pending' : '');

    var html = '';

    if (pending.length) {
      html += '<b>' + esc(tr('pub.migPendingTitle')) + '</b> ' +
        esc(fill(mig.needsBaseline ? 'pub.migNeedsBaseline' : 'pub.migPendingBody',
                 { n: pending.length })) +
        '<ul>' + pending.map(function (f) {
          return '<li><code>' + esc(f) + '</code></li>';
        }).join('') + '</ul>' +
        '<div class="p-mig-acts">' +
          (mig.needsBaseline
            ? '<button type="button" class="ghost-btn" id="pBaseline">' +
                esc(tr('pub.migBaseline')) + '</button>'
            : '<button type="button" class="solid-btn" id="pApplyMig">' +
                esc(tr('pub.migApply')) + '</button>') +
        '</div>';
    } else {
      /* Nothing pending, but the release carries migration files. Almost
         always means they are already applied — worth confirming rather than
         leaving the person to wonder. */
      html += '<b>' + esc(tr('pub.migInReleaseTitle')) + '</b> ' +
        esc(fill('pub.migInReleaseBody', { n: inRelease }));
    }

    el.innerHTML = html;

    if ($('pApplyMig')) $('pApplyMig').addEventListener('click', applyMigrations);
    if ($('pBaseline')) $('pBaseline').addEventListener('click', baselineMigrations);
  }

  async function applyMigrations() {
    if (busy || !mig) return;
    var pending = mig.pending || [];

    var ok = await window.StaffConfirm({
      title: tr('pub.migConfirmTitle'),
      body: fill('pub.migConfirmBody', { n: pending.length }),
      note: tr('pub.migConfirmNote'),
      type: mig.apply_word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('pub.migApply'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    await migAct({ action: 'apply', confirm: mig.apply_word });
  }

  async function baselineMigrations() {
    if (busy || !mig) return;
    var pending = mig.pending || [];
    var last = pending[pending.length - 1];

    /* Baseline claims work was done that this page did not do. It is the one
       action here that can make the database LIE about itself, so the dialog
       names the exact migration it will mark and asks for a different word. */
    var ok = await window.StaffConfirm({
      title: tr('pub.migBaselineTitle'),
      body: fill('pub.migBaselineBody', { n: pending.length, file: last }),
      note: tr('pub.migBaselineNote'),
      type: mig.baseline_word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('pub.migBaseline'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    await migAct({ action: 'baseline', confirm: mig.baseline_word, through: last });
  }

  async function migAct(payload) {
    busy = true;
    var btn = $('pApplyMig') || $('pBaseline');
    if (btn) btn.disabled = true;

    var res, body;
    try {
      res = await fetch(MIG, {
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
      return;
    }

    busy = false;
    if (btn) btn.disabled = false;

    if (!res.ok) {
      /* A half-applied migration is not a toast. It is a condition somebody
         has to look at the database about, and it must not scroll away. */
      var msg = (body && body.error) || (tr('err.refused') + ' (' + res.status + ')');
      if (body && body.partial && window.StaffProblem) {
        window.StaffProblem(tr('pub.migPartial') + ' ' + msg, null);
      } else if (window.StaffProblem) {
        window.StaffProblem(msg, loadMigrations);
      } else {
        toast(msg, 'bad');
      }
      loadMigrations();
      return;
    }

    if (window.StaffProblemClear) window.StaffProblemClear();
    var n = payload.action === 'baseline'
      ? (body.marked || []).length
      : (body.ran || []).length;
    toast(fill(payload.action === 'baseline' ? 'pub.migBaselined' : 'pub.migApplied',
               { n: n }), 'ok');
    loadMigrations();
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

    /* The two SHAs, in the manual panel. When somebody is convinced the page
       is lying to them, this is the line that settles it — the live branch's
       current commit against the one the last successful deploy built. Equal
       means up to date is true; different means it is not. */
    if ($('pManualNote')) {
      $('pManualNote').textContent = (state.head && state.published)
        ? fill('pub.manualShas', { head: state.head, live: state.published.sha })
        : '';
    }
  }

  /* ---- the two actions ------------------------------------------------ */

  $('pRefresh').addEventListener('click', function () { if (!busy) load(); });

  /* ---- manual actions -------------------------------------------------
     The same two dispatches as the bar, minus the "is this needed?" check.

     Nothing here is a different operation — Rebuild the live site IS Publish.
     What differs is that these do not consult `state.waiting` first, because
     the whole reason to reach for them is that `state.waiting` is wrong. The
     typed confirmation stays on the one that changes the public site; taking
     it away because "there is nothing to publish anyway" would remove the
     guard precisely when the page's idea of what is waiting is not to be
     trusted. */

  $('pForcePreview').addEventListener('click', function () {
    if (!busy) act({ action: 'preview' }, this);
  });

  $('pForcePublish').addEventListener('click', async function () {
    if (busy || !state) return;
    var n = state.waiting;

    var ok = await window.StaffConfirm({
      title: tr('pub.confirmTitle'),
      /* Different sentence when nothing is waiting, because "this sends 0
         saved changes" reads like a no-op and this is not one — it rebuilds
         and redeploys the site from the live branch. */
      body: n ? fill('pub.confirmBody', { n: n }) : tr('pub.forceBody'),
      note: tr('pub.forceNote'),
      type: state.confirm_word,
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('pub.publish'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    await act({ action: 'publish', confirm: state.confirm_word }, this);
  });

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
