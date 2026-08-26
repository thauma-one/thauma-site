/* ============================================================
   staff-videos.js — the Videos section of the Ministry page
   ============================================================
   THE SIMPLEST SECTION ON THIS PAGE, and it should stay that way. The other
   three edit words somebody typed into the console. This one edits ONE fact —
   which channel — and everything it lists was written on YouTube by whoever
   uploaded it. There is nothing here to edit, so there is no editor: no row
   panel, no save bar, no language columns.

   SAVING CHECKS THE CHANNEL WHILE YOU ARE STILL LOOKING AT IT. The endpoint
   resolves the address, stores it, and reads the feed in the same request, so
   a wrong channel says so immediately rather than fifteen minutes later on a
   screen nobody is watching. That is why Save can take a second and why the
   button says so while it works.
   ============================================================ */
(function () {
  'use strict';

  if (!document.getElementById('vidForm')) return;

  var API = '/api/staff-videos';
  var $ = function (id) { return document.getElementById(id); };
  var state = { channel: null, videos: [], links: [], busy: false };

  /* Four is not a technical limit. A rail of eight pill buttons under three
     videos is not navigation, it is a sitemap — and the endpoint enforces the
     same number, because a limit only the browser knows is not a limit. */
  var MAX_LINKS = 4;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function fill(key, vars) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(key, vars);
    var s = tr(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }

  /* "2026-08-01T10:00:00+00:00" -> the reader's own locale. Dates from a feed
     are always full timestamps and nobody needs the minute a video went up. */
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    try {
      return d.toLocaleDateString(undefined,
        { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) { return d.toISOString().slice(0, 10); }
  }

  function setSwitch(el, on) {
    el.setAttribute('aria-checked', on ? 'true' : 'false');
    var s = el.querySelector('.switch-state');
    if (s) s.textContent = on ? tr('common.on') : tr('common.off');
  }
  function isOn(el) { return el.getAttribute('aria-checked') === 'true'; }

  /* ------------------------------ rendering ----------------------------- */

  function render() {
    var c = state.channel;

    $('vidChannel').value = c ? c.source_id : '';
    $('vidCount').value = c ? c.max_items : 3;
    setSwitch($('vidPublic'), !!(c && c.is_public));

    var found = $('vidFound');
    if (c) {
      /* The channel's OWN name, from the feed — the confirmation that what was
         typed found what was meant. Falls back to the id rather than showing
         an empty line, because a channel that has never synced has no name
         here yet. */
      /* Which KIND it resolved to, said out loud. One field takes both, so
         the only way somebody learns that the address they pasted was read as
         a playlist rather than its channel is if this says so. */
      found.innerHTML = fill(
        c.source_kind === 'playlist' ? 'vid.foundPlaylistHtml' : 'vid.foundHtml',
        { name: esc(c.source_title || c.source_id), url: esc(c.source_url) });
      found.hidden = false;
    } else {
      found.hidden = true;
    }

    $('vidClear').hidden = !c;
    $('vidCheck').hidden = !c;

    renderSync();
    renderLinks();
    renderList();
  }

  function renderSync() {
    var el = $('vidSync');
    var c = state.channel;
    if (!c) { el.hidden = true; return; }

    el.hidden = false;
    if (c.sync_error) {
      el.className = 'vid-sync is-bad';
      el.textContent = fill('vid.syncFailed', { why: c.sync_error });
    } else if (c.synced_at) {
      el.className = 'vid-sync';
      el.textContent = fill('vid.syncedAt', { when: when(c.synced_at) });
    } else {
      el.className = 'vid-sync';
      el.textContent = tr('vid.neverChecked');
    }
  }

  /* ------------------------------ the rail ------------------------------ */

  /* Rows are rebuilt from the DOM on every read rather than mirrored into
     state as you type. Two copies of a form's contents is how a field ends up
     saving what it held one keystroke ago. */
  function readLinks() {
    return Array.prototype.map.call(
      document.querySelectorAll('#vidLinks .vid-link-row'),
      function (row) {
        return {
          label: row.querySelector('[data-vl="label"]').value.trim(),
          url: row.querySelector('[data-vl="url"]').value.trim(),
        };
      });
  }

  function linkRow(link) {
    var row = document.createElement('div');
    row.className = 'vid-link-row';
    row.innerHTML =
      '<input type="text" data-vl="label" maxlength="40"' +
      ' placeholder="' + esc(tr('vid.buttonLabel')) + '" value="' +
        esc(link && link.label || '') + '">' +
      '<input type="url" data-vl="url" maxlength="400" spellcheck="false"' +
      ' placeholder="https://" value="' + esc(link && link.url || '') + '">' +
      '<button type="button" class="ghost-btn danger" data-vl="del"' +
      ' aria-label="' + esc(tr('vid.removeButton')) + '">&times;</button>';
    row.querySelector('[data-vl="del"]').addEventListener('click', function () {
      row.remove();
      refreshAddButton();
    });
    return row;
  }

  function refreshAddButton() {
    var n = document.querySelectorAll('#vidLinks .vid-link-row').length;
    $('vidLinkAdd').hidden = n >= MAX_LINKS;
  }

  function renderLinks() {
    var box = $('vidLinks');
    box.innerHTML = '';
    state.links.forEach(function (l) { box.appendChild(linkRow(l)); });
    refreshAddButton();
  }

  function renderList() {
    var el = $('vidList');
    if (!state.channel) { el.innerHTML = ''; return; }

    if (!state.videos.length) {
      el.innerHTML = '<p class="empty">' + esc(tr('vid.none')) + '</p>';
      return;
    }

    /* Poster images come straight from YouTube's own CDN. They are not copied
       into R2: this is a cache of somebody else's public feed, and holding
       their artwork would make it something more than that. */
    el.innerHTML = state.videos.map(function (v) {
      return '<a class="vid-card" href="' + esc(v.url) + '"' +
             ' target="_blank" rel="noopener noreferrer">' +
             '<img class="vid-thumb" src="' + esc(v.thumbnail_url) + '"' +
             ' alt="" loading="lazy" width="480" height="360">' +
             '<span class="vid-meta">' +
             '<b class="vid-title">' + esc(v.title) + '</b>' +
             '<span class="vid-date">' + esc(when(v.published_at)) + '</span>' +
             '</span></a>';
    }).join('');
  }

  /* -------------------------------- data -------------------------------- */

  function apply(data) {
    state.channel = data.channel || null;
    state.videos = data.videos || [];
    state.links = data.links || [];
    render();
  }

  function busy(on, key) {
    state.busy = on;
    $('vidStatus').textContent = on ? tr(key || 'common.loading') : '';
    Array.prototype.forEach.call(
      $('vidForm').querySelectorAll('button, input'),
      function (b) { b.disabled = on; });
  }

  async function send(method, body, busyKey) {
    busy(true, busyKey);
    try {
      var res = await fetch(API, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      var data = await res.json();
      if (!res.ok) { toast(data.error || tr('common.saveFailed'), 'bad'); return null; }
      apply(data);
      return data;
    } catch (e) {
      toast(tr('common.saveFailed'), 'bad');
      return null;
    } finally {
      busy(false);
    }
  }

  /* Save and Check report the SYNC's outcome, not the request's. A save that
     stored the channel and then could not read its feed is not a success, and
     saying "Saved" over the top of that is how somebody walks away from a
     channel that will never update. */
  function reportSync(data) {
    if (!data) return;
    var r = data.checked;
    if (!r) { toast(tr('vid.saved'), 'good'); return; }
    if (!r.ok) { toast(r.error || tr('vid.syncFailedShort'), 'bad'); return; }
    toast(fill('vid.gotVideos', { n: r.count }), 'good');
  }

  /* ------------------------------- events ------------------------------- */

  $('vidPublic').addEventListener('click', function () {
    setSwitch(this, !isOn(this));
  });

  $('vidForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (state.busy) return;

    var raw = $('vidChannel').value.trim();
    if (!raw) { toast(tr('vid.needChannel'), 'bad'); return; }

    reportSync(await send('POST', {
      channel: raw,
      max_items: Number($('vidCount').value) || 3,
      is_public: isOn($('vidPublic')),
      links: readLinks(),
    }, 'vid.checking'));
  });

  $('vidLinkAdd').addEventListener('click', function () {
    $('vidLinks').appendChild(linkRow(null));
    refreshAddButton();
    var rows = document.querySelectorAll('#vidLinks .vid-link-row');
    rows[rows.length - 1].querySelector('[data-vl="label"]').focus();
  });

  $('vidCheck').addEventListener('click', async function () {
    if (state.busy) return;
    reportSync(await send('POST', { action: 'check' }, 'vid.checking'));
  });

  $('vidClear').addEventListener('click', async function () {
    if (state.busy) return;
    /* Asks, because a partner site loses its video section the moment this
       lands. Not a typed confirmation: nothing is destroyed that cannot be
       restored by pasting the channel back in. */
    var ok = window.StaffConfirm
      ? await window.StaffConfirm({
          title: tr('vid.clearTitle'),
          body: tr('vid.clearBody'),
          confirm: tr('vid.clear'),
          danger: true,
        })
      : window.confirm(tr('vid.clearBody'));
    if (!ok) return;
    if (await send('DELETE')) toast(tr('vid.cleared'), 'good');
  });

  /* Loaded when the tab is first shown rather than on page load: three other
     sections already fetch on arrival, and a channel nobody opened does not
     need a request. */
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    send('GET');
  }

  var tab = document.querySelector('.tab[data-tab="videos"]');
  if (tab) tab.addEventListener('click', load);
  /* …unless the page was opened straight onto this tab, in which case no
     click is coming. */
  var panel = document.querySelector('[data-panel="videos"]');
  if (panel && !panel.hidden) load();
})();
