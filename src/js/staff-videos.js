/* ============================================================
   staff-videos.js — the Videos section of the Updates page
   ============================================================
   THE SIMPLEST SECTION ON THIS PAGE, and it should stay that way. The other
   three edit words somebody typed into the console. This one edits ONE fact —
   which channel — and everything it lists was written on YouTube by whoever
   uploaded it. There is nothing here to edit, so there is no editor: no row
   panel, no language columns.

   IT SAVES LIKE THE REST OF UPDATES (Chase's option B, 2026-09-26): the
   channel, the count, the switch and the buttons are edited freely and go
   live with the page's one Publish changes (staff-updates.js). Removing the
   channel waits for Publish too. Check now is the exception — it changes
   nothing, it only reads the stored channel's feed again.

   PUBLISHING CHECKS THE CHANNEL WHILE YOU ARE STILL LOOKING AT IT. The
   endpoint resolves the address, stores it, and reads the feed in the same
   request, so a wrong channel says so immediately rather than fifteen minutes
   later on a screen nobody is watching.
   ============================================================ */
(function () {
  'use strict';

  if (!document.getElementById('vidForm')) return;

  var API = '/api/staff-videos';
  var $ = function (id) { return document.getElementById(id); };
  var state = { channel: null, videos: [], links: [], busy: false, removing: false };

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
    if (s) s.textContent = tr(on ? 'switch.on' : 'switch.off');
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
    renderRemoving();

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

  /* A removal waiting for Publish: the button turns into Keep, and the form
     shows the channel struck. */
  function renderRemoving() {
    $('vidClear').textContent = tr(state.removing ? 'up.keep' : 'vid.clear');
    $('vidClear').classList.toggle('danger', !state.removing);
    $('vidForm').classList.toggle('is-removed', state.removing);
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
      changed();
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
    state.removing = false;
    render();
    changed();
  }

  /* What the form says, and what the server holds, in the same shape. A
     button row with nothing typed in it is not a button. */
  function current() {
    return {
      channel: $('vidChannel').value.trim(),
      max_items: Number($('vidCount').value) || 3,
      is_public: isOn($('vidPublic')),
      links: readLinks().filter(function (l) { return l.label || l.url; }),
    };
  }
  function saved() {
    var c = state.channel;
    return {
      channel: c ? c.source_id : '',
      max_items: c ? c.max_items : 3,
      is_public: !!(c && c.is_public),
      links: state.links.map(function (l) { return { label: l.label || '', url: l.url || '' }; }),
    };
  }
  function isDirty() {
    return state.removing || JSON.stringify(current()) !== JSON.stringify(saved());
  }
  function changed() { if (window.StaffUpdates) window.StaffUpdates.changed(); }

  function busy(on, key) {
    state.busy = on;
    $('vidStatus').textContent = on ? tr(key || 'common.loading') : '';
    Array.prototype.forEach.call(
      $('vidForm').querySelectorAll('button, input'),
      function (b) { b.disabled = on; });
  }

  /* Returns the answer, or throws with the server's reason. The caller says
     so: Check now as a toast, Publish through the Updates bar. */
  async function send(method, body, busyKey) {
    busy(true, busyKey);
    try {
      var res, data;
      try {
        res = await fetch(API, {
          method: method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        data = await res.json();
      } catch (e) {
        throw new Error(tr('common.saveFailed'));
      }
      if (!res.ok) throw new Error(data.error || tr('common.saveFailed'));
      apply(data);
      return data;
    } finally {
      busy(false);
    }
  }

  /* Publish and Check report the SYNC's outcome, not the request's. A save
     that stored the channel and then could not read its feed is not a
     success, and saying "Published" over the top of that is how somebody
     walks away from a channel that will never update. */
  function syncFailure(data) {
    var r = data && data.checked;
    if (r && !r.ok) return r.error || tr('vid.syncFailedShort');
    return null;
  }

  /* ---- publishing: what the Updates bar asks of this section ---- */

  async function publish() {
    var label = tr('min.videos');
    try {
      if (state.removing) {
        await send('DELETE');
        return { failed: [] };
      }
      var now = current();
      if (!now.channel) return { failed: [label + ' — ' + tr('vid.needChannel')] };
      var data = await send('POST', now, 'vid.checking');
      var bad = syncFailure(data);
      return { failed: bad ? [label + ' — ' + bad] : [] };
    } catch (e) {
      return { failed: [label + ' — ' + e.message] };
    }
  }

  function discard() {
    state.removing = false;
    render();
    changed();
  }

  /* ------------------------------- events ------------------------------- */

  $('vidPublic').addEventListener('click', function () {
    setSwitch(this, !isOn(this));
    changed();
  });

  /* Enter in a field does not publish; the bar does. */
  $('vidForm').addEventListener('submit', function (e) { e.preventDefault(); });
  $('vidForm').addEventListener('input', changed);

  $('vidLinkAdd').addEventListener('click', function () {
    $('vidLinks').appendChild(linkRow(null));
    refreshAddButton();
    var rows = document.querySelectorAll('#vidLinks .vid-link-row');
    rows[rows.length - 1].querySelector('[data-vl="label"]').focus();
  });

  $('vidCheck').addEventListener('click', async function () {
    if (state.busy) return;
    try {
      var data = await send('POST', { action: 'check' }, 'vid.checking');
      var bad = syncFailure(data);
      if (bad) toast(bad, 'bad');
      else toast(fill('vid.gotVideos', { n: data.checked ? data.checked.count : state.videos.length }), 'good');
    } catch (e) {
      toast(e.message, 'bad');
    }
  });

  /* Removing waits for Publish like any other change, and the bar asks
     before a removal goes out. Pressing it again keeps the channel. */
  $('vidClear').addEventListener('click', function () {
    if (state.busy) return;
    state.removing = !state.removing;
    renderRemoving();
    changed();
  });

  if (window.StaffUpdates) {
    window.StaffUpdates.register({
      key: 'videos',
      count: function () { return isDirty() ? 1 : 0; },
      removals: function () { return state.removing ? 1 : 0; },
      publish: publish,
      discard: discard
    });
  }

  /* Loaded with the page, like the other three sections: every tab of
     Updates is ready before it is opened (Chase, 2026-09-27). */
  send('GET').catch(function (e) {
    $('vidList').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
  });
})();
