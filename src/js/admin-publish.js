/* ============================================================
   admin-publish.js — Preview and Publish
   ============================================================
   Talks to /api/admin/publish.

   ON EVERY WEBSITE SCREEN, not a page of its own (mockup board
   13): a bar along the foot says what is waiting, and Review
   and publish opens the list below as a panel. It loads on any
   page that has the panel (#pRoot).

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

  if (!document.getElementById('pRoot')) return;

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

  /* A FAILED CHECK IS QUIET UNTIL YOU ASK. This runs on every Website screen,
     and a hiccup at GitHub must not take over a screen somebody is writing
     on. So the bar says it could not check; the full reason, and the retry,
     are for the review, which is where somebody goes to publish. */
  function reviewOpen() { return !$('pReviewPanel').hidden; }
  function problem(msg, retry) {
    /* In the review, the reason and a retry sit where the list would be —
       not in the page's own problem strip, which the panel covers. */
    var box = $('pReviewProblem');
    box.hidden = false;
    box.querySelector('span').textContent = msg;
    box.querySelector('button').hidden = !retry;
    $('pRoot').hidden = true;
    $('pBar').hidden = false;
    document.body.classList.add('has-webbar');
    $('pBarCount').textContent = tr('pub.checkFailed');
    $('pPreview').hidden = true;
  }

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      return problem(tr('err.unreachable') + ' ' + e.message, load);
    }
    try { body = await res.json(); }
    catch (e) {
      return problem(tr('err.unreadable') + ' (' + res.status + ')', load);
    }

    if (res.status === 403) {
      /* Somebody who may edit the words but not publish them: no bar at all,
         rather than one offering a button that will be refused. */
      $('pRoot').hidden = true; $('pBar').hidden = true;
      document.body.classList.remove('has-webbar');
      return;
    }
    if (!res.ok) {
      return problem(res.status === 401 ? tr('err.expired')
        : tr('err.refused') + ' (' + res.status + ')' + (body.error ? ' — ' + body.error : ''),
        res.status === 401 ? null : load);
    }
    $('pPreview').hidden = false;
    $('pReviewProblem').hidden = true;
    // Only its own problem: on a Website screen the editor may have one too.
    if (reviewOpen() && window.StaffProblemClear) window.StaffProblemClear();

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
      toast(tr('err.unreachable') + ' ' + e.message, 'err');
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
        toast(msg, 'err');
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
    document.body.classList.add('has-webbar');
    $('pPublish').disabled = !n && !state.neverPublished;
    $('pPublish').textContent = fill('pub.publishTo', { site: $('pReviewPanel').getAttribute('data-live') || '' });

    $('pBarCount').textContent = n
      ? (n === 1 ? tr('pub.oneWaiting') : tr('pub.nWaiting').replace('{n}', n))
      : tr('pub.upToDate');
    followBuild();

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

  /* ---- following a build to its end --------------------------------------
     A build takes a minute or two, and the page used to say nothing once it
     had asked for one — the review stayed open showing the list it had
     before, and "it seems as though the changes didn't take effect" (Chase,
     2026-09-29). So after Publish or Preview the review closes and this bar
     says where the build is — building, live, or failed — reading the newest
     run every 15 seconds until it has finished, then stopping. */
  var pending = null, poll = null, lastWord = null;
  function followBuild() {
    var el = $('pBarCount'), bar = $('pBar');
    bar.classList.remove('is-building', 'is-done', 'is-failed');
    if (!pending) {
      if (lastWord) { bar.classList.add(lastWord.cls); el.innerHTML = lastWord.html; }
      return;
    }
    var run = state && state.latest && state.latest[pending.action === 'publish' ? 'live' : 'preview'];
    var mine = run && Date.parse(run.started) >= pending.since - 90000;
    var site = pending.action === 'publish' ? ($('pReviewPanel').getAttribute('data-live') || 'thauma.one') : 'next.thauma.one';
    if (mine && run.status === 'completed') {
      var ok = run.conclusion === 'success';
      var said = ok ? fill(pending.action === 'publish' ? 'pub.nowLive' : 'pub.nowPreview', { site: site }) : tr('pub.buildFailed');
      lastWord = {
        cls: ok ? 'is-done' : 'is-failed',
        html: esc(said) + (ok
          ? ' <a href="https://' + esc(site) + '/" target="_blank" rel="noopener">' + esc(tr('pub.open')) + ' ↗</a>'
          : ' <a href="' + esc(run.url) + '" target="_blank" rel="noopener">' + esc(tr('pub.whatHappened')) + ' ↗</a>'),
      };
      pending = null; clearInterval(poll); poll = null;
      toast(said, ok ? 'ok' : 'err');
      return followBuild();
    }
    if (Date.now() - pending.since > 15 * 60 * 1000) {
      pending = null; clearInterval(poll); poll = null;
      lastWord = { cls: 'is-failed', html: esc(tr('pub.tooLong')) };
      return followBuild();
    }
    bar.classList.add('is-building');
    el.textContent = fill(pending.action === 'publish' ? 'pub.buildingLive' : 'pub.buildingPreview', { site: site });
  }
  function startFollowing(action) {
    pending = { action: action, since: Date.now() };
    lastWord = null;
    clearInterval(poll);
    poll = setInterval(function () { if (!busy) load(); }, 15000);
    followBuild();
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

  [$('pPreview'), $('pPreviewIn')].forEach(function (b) {
    b.addEventListener('click', function () {
      // No confirmation. Preview changes nothing anybody outside can see, and
      // a dialog on a harmless action trains people to dismiss dialogs.
      if (!busy) act({ action: 'preview' }, this);
    });
  });

  /* ---- the review panel ------------------------------------------------
     Opens over the screen from the right, and closes on its ×, Escape, or a
     click beside it. The old /admin/publish/ address lands here with
     ?review, so a bookmark still opens what it used to show. */
  function setReview(open) {
    $('pReviewPanel').hidden = !open;
    $('pReviewBack').hidden = !open;
    $('pReview').setAttribute('aria-expanded', open ? 'true' : 'false');
    document.documentElement.classList.toggle('review-open', open);
    // Re-read on opening, so the list is what is waiting now (not on first
    // load, which is already reading it).
    if (open) { $('pReviewClose').focus(); if ((state || !$('pReviewProblem').hidden) && !busy) load(); }
    else $('pReview').focus();
  }
  $('pReview').addEventListener('click', function () { setReview(true); });
  $('pReviewClose').addEventListener('click', function () { setReview(false); });
  $('pReviewProblem').querySelector('button').addEventListener('click', function () { if (!busy) load(); });
  $('pReviewBack').addEventListener('click', function () { setReview(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('pReviewPanel').hidden && !document.querySelector('.dlg-back')) setReview(false);
  });

  $('pPublish').addEventListener('click', async function () {
    if (busy || !state) return;

    var m = (state.migrations || []).length;
    var ok = await window.StaffConfirm({
      title: tr('pub.confirmTitle'),
      body: tr('pub.confirmBody').replace('{n}', state.waiting),
      note: (m ? tr('pub.confirmMigrations').replace('{n}', m) : tr('pub.confirmNote')) +
        (state.carries && state.carries.live ? ' ' + tr('pub.carriesLive') : ''),
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
      /* The server answered, even if with an HTML error page rather than
         JSON — that is a refusal with a status, not a lost connection
         (2026-09-29: a Preview failure read "Cannot reach the server"). */
      var text = await res.text();
      try { body = JSON.parse(text); } catch (e2) { body = { error: tr('err.refused') + ' (' + res.status + ')' }; }
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'err');
      busy = false;
      if (btn) btn.disabled = false;
      $('pRefresh').disabled = false;
      return;
    }

    busy = false;
    if (btn) btn.disabled = false;
    $('pRefresh').disabled = false;

    if (!res.ok) {
      /* REFUSED BECAUSE THE DATABASE IS BEHIND. Pinned, not toasted, and the
         migration panel is re-read immediately — it is showing what it learned
         when the page loaded, and that staleness is the whole reason the
         server had to refuse. Re-reading makes the Apply button appear with
         the real answer instead of the one from before somebody merged. */
      if (body && body.refreshMigrations) {
        if (window.StaffProblem) window.StaffProblem(body.error, loadMigrations);
        else toast(body.error, 'err');
        loadMigrations();
        return;
      }
      /* A missing permission is a CONDITION — it will fail identically every
         time until somebody changes the app's settings — so it is pinned
         rather than raised as a toast that scrolls away. */
      if (res.status === 403 && window.StaffProblem) window.StaffProblem(body.error, load);
      else toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'err');
      return;
    }

    /* When dev's data went with it (lib/carry.js), say so — how many rows,
       and whether the database's structure had to catch up first. */
    var c = body && body.carried;
    toast(c
      ? fill(payload.action === 'publish' ? 'pub.publishCarried' : 'pub.previewCarried', { n: c.rows, m: c.migrations })
      : payload.action === 'publish' ? tr('pub.publishStarted') : tr('pub.previewStarted'), 'ok');

    /* The review has done its job: it closes, and the bar follows the build
       to its end (startFollowing) — then stops; never a loop left running. */
    setReview(false);
    startFollowing(payload.action);
  }

  load();
  if (/[?&]review\b/.test(location.search)) setReview(true);
})();
