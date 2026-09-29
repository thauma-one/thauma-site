/* ============================================================
   staff.js — Thauma staff console
   ============================================================
   Two data sources, deliberately kept separate:

     D1 — Home, stewardship, activity.
       Reads /api/staff-snapshot, which runs the named queries
       in db/queries.sql against the D1 database and returns
       the shape db/build_snapshot.py used to write to a file.

       That equivalence was the point of building the UI against
       query OUTPUT rather than fixtures: going live changed this
       one URL. build_snapshot.py still exists for working
       offline — see SNAPSHOT_URL below.

     KV — directory and resources.
       Reads/writes staff-data, which verifies the CLOUDFLARE
       ACCESS token server-side.

   AUTH is Cloudflare Access, not Netlify Identity. Access gates
   /staff* at the edge, so by the time this script runs the
   visitor is already authenticated — there is no sign-in state
   to manage, no widget to load, and no gate to render. Identity
   comes from Cloudflare's /cdn-cgi/access/get-identity endpoint
   and sign-out is /cdn-cgi/access/logout.

   Requests to the function are same-origin, so the browser sends
   the CF_Authorization cookie automatically; the function
   verifies it rather than trusting the edge (functions live
   outside /staff*, so Access does not necessarily cover them).

   ONE FILE, SIX PAGES. The console is now a page per section
   (layouts/staff.njk), but they share this script. Each page
   sets data-staff-page on <body>; boot() reads it and runs only
   what that page needs — so /staff/directory/ never fetches the
   snapshot, and /staff/stewardship/ never calls the staff-data
   endpoint. Splitting the file six ways would have meant six
   copies of esc(), shortDate() and severity().

   No framework, no build step: this runs under Eleventy's
   passthrough copy with zero tooling.
   ============================================================ */
(function () {
  'use strict';

  // Live D1, via the Worker. The generated file it replaced is still built by
  // db/build_snapshot.py and still served at /staff/data/snapshot.json —
  // point this back at it to work on the console without a database.
  var SNAPSHOT_URL = '/api/staff-snapshot';
  var STAFF_API = '/api/staff-data';

  var CRIT_DAYS = 120;
  var WARN_DAYS = 60;

  var $ = function (id) { return document.getElementById(id); };

  /* Strings built here rather than sitting in the markup cannot be reached by
     a data-i18n sweep, so they go through the dictionary by hand. Falls back
     to the key's English if i18n has not loaded, which is better than a blank
     tile. */
  function tr(key) {
    return window.StaffI18n ? window.StaffI18n.t(key) : key;
  }
  /* Translate AND substitute. Never falls back to the raw string: a key with
     {who} in it printed as "{who}" on screen once already, elsewhere in this
     console, which is why every file that needs one has this. */
  function fill(key, vars) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(key, vars);
    var s = tr(key);
    Object.keys(vars || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(vars[k]));
    });
    return s;
  }
  var state = { contacts: [], resources: [], people: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fullName(c) {
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || tr('stew.unnamed');
  }
  /* The console's language, not the browser's and not English. A Croatian
     staff member was reading "Mar 15, 2026" and "195 days" inside an
     otherwise Croatian table. */
  function uiLang() {
    return (window.StaffI18n && window.StaffI18n.lang) || 'en';
  }
  function shortDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    try {
      return d.toLocaleDateString(uiLang(),
        { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch (e) {
      return iso;
    }
  }
  /* "195 days" in any language, plurals included, from the browser's own
     number formatting rather than a word per language in the dictionary —
     Croatian needs dan/dana, Slovenian dan/dneva/dni, and a thirtieth
     language needs nothing added here. */
  function dayCount(n) {
    try {
      return new Intl.NumberFormat(uiLang(), { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(n);
    } catch (e) {
      return n + ' days';
    }
  }
  /* The row stores a two-letter code; people read a country's name. */
  function countryName(code) {
    if (!code) return '';
    try {
      return new Intl.DisplayNames([uiLang(), 'en'], { type: 'region' }).of(code) || code;
    } catch (e) {
      return code;
    }
  }
  /* severity carries a class AND a label, so the table never relies on
     color alone to communicate state */
  function severity(days) {
    if (days === null || days === undefined) return { cls: 'none', label: tr('stew.never') };
    if (days >= CRIT_DAYS) return { cls: 'crit', label: dayCount(days) };
    if (days >= WARN_DAYS) return { cls: 'warn', label: dayCount(days) };
    return { cls: 'ok', label: dayCount(days) };
  }

  /* =====================================================================
     PROTOTYPE SECTIONS — snapshot.json
     ===================================================================== */

  // Each block is guarded: a page only has the elements it needs, and a
  // missing one means "not on this page", not "something broke".
  function renderSnapshot(d) {
    /* The pill is NOT written here any more. It carries the signed-in
       person, and this line — left over from when it carried the partner —
       overwrote that a moment after the page loaded. It only ran on the four
       pages that fetch a snapshot, which is exactly why the name reverted on
       those and held everywhere else.

       Only one place may write to the pill: paintIdentity(). */
    // --- stewardship table ---
    /* OWNER ONLY. The server sends no names at all to anybody else — an
       administrator viewing as the owner included — and says why. Saying so
       here matters: an empty list with "add the first person" under it would
       read as the owner's supporters having vanished. */
    lastSnapshot = d;
    renderStewardship();
    renderHome();

    // --- activity (board "Activity"): sentences, by day — activity.js ---
    if ($('auditList') && window.ConsoleActivity) window.ConsoleActivity.render($('auditList'), d.audit);
  }

  /* THE SUPPORTERS, worst first as the server sorted them, narrowed by the
     search box (board 11). Kept apart from renderSnapshot so typing in the
     search redraws the rows without refetching anybody. On a phone each row
     is a card: data-label names what each cell is once the header is gone. */
  var lastSnapshot = null;
  function renderStewardship() {
    var d = lastSnapshot, rows = $('rows');
    if (!d || !rows) return;
    if ($('swAddPerson')) $('swAddPerson').hidden = !!d.stewardship_withheld;
    if ($('swFind')) $('swFind').hidden = !!d.stewardship_withheld || !d.contacts.length;
    if (d.stewardship_withheld) {
      rows.innerHTML = '<tr class="empty-row"><td colspan="4"><p class="empty">' +
        esc(tr('stew.withheld')) + '</p></td></tr>';
      return;
    }
    var q = ($('swFind') ? $('swFind').value : '').trim().toLowerCase();
    var shown = d.contacts.filter(function (c) {
      if (!q) return true;
      return [fullName(c), c.city, countryName(c.country)].join(' ').toLowerCase().indexOf(q) !== -1;
    });
    rows.innerHTML = shown.map(function (c) {
      var sev = severity(c.days_since_personal);
      var where = [c.city, countryName(c.country)].filter(Boolean).join(', ');
      /* aria-haspopup="dialog", not aria-expanded: the row no longer expands
         into anything, it opens a dialog over the page. */
      return '<tr data-id="' + esc(c.id) + '" tabindex="0" role="button" ' +
        'aria-haspopup="dialog">' +
        '<td class="sw-who"><span class="nm">' + esc(fullName(c)) + '</span>' +
          (where ? '<span class="sub">' + esc(where) + '</span>' : '') + '</td>' +
        '<td data-label="' + esc(tr('stew.lastPersonal')) + '"><span class="sev ' + sev.cls + '">' +
          esc(sev.label) + '</span>' +
          '<span class="sub">' + esc(shortDate(c.last_personal_contact)) + '</span></td>' +
        '<td data-label="' + esc(tr('stew.lastAny')) + '"><span class="sub" style="color:var(--text)">' +
          esc(shortDate(c.last_contact_any)) + '</span></td>' +
        /* "1 of 2", not "1 / 2": personal contacts out of every contact. */
        '<td class="right tnum" data-label="' + esc(tr('stew.personalCol')) + '">' +
          esc(fill('stew.personalOf', { n: c.personal_count, total: c.interaction_count })) + '</td>' +
      '</tr>';
    }).join('') ||
      /* An empty table reads as broken rather than as empty. People are added
         from the button above it now, so say so; a search that found nobody
         says that instead. */
      '<tr class="empty-row"><td colspan="4"><p class="empty">' +
        esc(tr(q ? 'stew.noMatch' : 'stew.noPeople')) + '</p></td></tr>';
  }
  if ($('swFind')) $('swFind').addEventListener('input', renderStewardship);

  /* timelineHTML lived here and rendered the drawer under each row. The
     drawer is gone — a row opens the supporter dialog now — and the dialog
     renders its own timeline from its own fetch, in staff-stewardship.js.
     Removed rather than left for a second caller to find: two renderers for
     one list is how the console's copies drifted before. */
  /* THE ROWS ARE REBUILT ON EVERY SNAPSHOT LOAD, so the listeners are bound
     to the tbody once and find their row by closest() — binding per row would
     add a fresh set on every reload and leak them all. `wired` is the guard:
     this is called after each render, and without it a click would open the
     dialog as many times as the page has been refreshed. */
  var stewardshipWired = false;
  function wireStewardshipRows() {
    var rows = $('rows');
    if (!rows || stewardshipWired) return;
    stewardshipWired = true;

    function openFor(tr) {
      var id = tr.getAttribute('data-id');
      if (!id) return;
      /* The dialog lives in staff-stewardship.js, which loads only on this
         page. Absent means the script did not load — better to do nothing
         than to throw on every row click. */
      if (window.StaffSupporterDialog) window.StaffSupporterDialog.open(id, tr);
    }

    rows.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]'); if (tr) openFor(tr);
    });
    rows.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); openFor(tr); }
    });
  }

  /* =====================================================================
     HOME — what needs you (board "Home", step 7)
     =====================================================================
     Four numbers, then three lists, each line with the button that does
     it. The numbers and the people come from the snapshot; the rest from
     /api/staff-home. Either can arrive first, so each draws what it has and
     the other fills in; the calm line waits for both, or it would flash up
     before the lists arrived.

     WHO SEES THE PEOPLE. Supporter numbers only for the roles that have
     Stewardship (consoleNav.js), and names only when the server sent them —
     it withholds them from anybody but the owner. */
  var homeData = null;
  var QUIET_SHOWN = 5;

  /* A title in the reader's language, or any language it has. */
  function titleIn(t) {
    t = t || {};
    if (t[uiLang()]) return t[uiLang()];
    for (var k in t) if (t[k]) return t[k];
    return tr('ms.untitled');
  }

  function homeRow(main, sub, mid, action) {
    return '<div class="hm-row">' +
      '<div class="hm-what"><span class="hm-nm">' + main + '</span>' +
        (sub ? '<span class="hm-sub">' + sub + '</span>' : '') + '</div>' +
      (mid || '') + action + '</div>';
  }
  function homeLink(href, key, solid) {
    return '<a class="' + (solid ? 'solid-btn' : 'ghost-btn') + '" href="' + esc(href) + '">' +
      esc(tr(key)) + '</a>';
  }
  function showSection(id, html) {
    $(id + 'Rows').innerHTML = html;
    $(id).hidden = !html;
    return !!html;
  }

  function renderHome() {
    if (!$('hmStats')) return;
    var d = lastSnapshot, h = homeData;
    var roles = (d && d.you && d.you.roles) || [];
    var steward = roles.indexOf('staff') !== -1 || roles.indexOf('partner') !== -1;

    var stats = [];
    if (d && steward) {
      stats.push({ v: d.summary.contacts_total || 0, k: 'home.stat.supporters', href: '/staff/stewardship/' });
      stats.push({ v: d.summary.personal_last_30 || 0, k: 'home.stat.personal', href: '/staff/stewardship/' });
    }
    var monthly = d && (d.goals || []).filter(function (g) { return g.kind === 'monthly'; })[0];
    if (monthly && monthly.percent != null) {
      stats.push({ v: monthly.percent + '%', k: 'home.stat.monthly', href: '/staff/updates/#goals' });
    }
    if (h) stats.push({ v: h.published, k: 'home.stat.published', href: '/staff/updates/#milestones' });
    $('hmStats').innerHTML = stats.map(function (s) {
      return '<a class="hm-stat" href="' + s.href + '"><b class="tnum">' + esc(s.v) + '</b>' +
        '<span>' + esc(tr(s.k)) + '</span></a>';
    }).join('');

    var any = false;

    if (d) {
      var quiet = steward && !d.stewardship_withheld ? d.contacts.filter(function (c) {
        return c.days_since_personal == null || c.days_since_personal >= d.stale_days;
      }) : [];
      $('hmQuietH').textContent = fill('home.quiet', { n: d.stale_days });
      any = showSection('hmQuiet', quiet.slice(0, QUIET_SHOWN).map(function (c) {
        var where = [c.city, countryName(c.country)].filter(Boolean).join(', ');
        var never = c.days_since_personal == null;
        return homeRow(esc(fullName(c)), esc(where),
          '<span class="sev ' + (never ? 'none' : 'crit') + ' hm-sev">' +
            esc(never ? tr('home.never') : dayCount(c.days_since_personal)) + '</span>',
          '<button type="button" class="ghost-btn" data-log="' + esc(c.id) + '">' +
            esc(tr('home.log')) + '</button>');
      }).join('')) || any;
    }

    if (h) {
      any = showSection('hmTodo', h.unfinished.map(function (u) {
        if (u.kind === 'milestone' || u.kind === 'prayer') {
          return homeRow(esc(titleIn(u.title)), esc(tr(u.kind === 'milestone' ? 'home.msDraft' : 'home.prDraft')), '',
            homeLink('/staff/updates/?open=' + encodeURIComponent(u.id) + '#' + (u.kind === 'milestone' ? 'milestones' : 'prayer'), 'home.open'));
        }
        if (u.kind === 'drafts') {
          return homeRow(esc(u.name), esc(u.n === 1 ? tr('home.drafts1') : fill('home.draftsN', { n: u.n })), '',
            homeLink('/staff/mail/#drafts', 'home.open'));
        }
        return homeRow(esc(u.name), esc(tr('home.listEmpty')), '', homeLink('/staff/sharing/#signup', 'home.share'));
      }).join('')) || any;

      /* One line per section, a chip per language with the count missing.
         The chip says the code; its title says the language. */
      any = showSection('hmLang', ['milestones', 'prayer'].map(function (part) {
        var gaps = h.missing[part] || {};
        var chips = h.languages.filter(function (l) { return gaps[l.code]; }).map(function (l) {
          var name = l.native_name || l.name;
          return '<span class="hm-chip" title="' + esc(fill('home.chip', { lang: name, n: gaps[l.code] })) + '">' +
            esc(l.code.toUpperCase()) + ' <b class="tnum">' + gaps[l.code] + '</b></span>';
        }).join('');
        if (!chips) return '';
        return homeRow(esc(tr('min.' + part)), '', '<span class="hm-chips">' + chips + '</span>',
          homeLink('/staff/updates/#' + part, 'home.translate', true));
      }).join('')) || any;
    }

    $('hmCalm').hidden = !(d && h) || any;
  }

  function loadHome() {
    return fetch('/api/staff-home', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        if (!body) return;
        homeData = body;
        renderHome();
      })
      .catch(function () {});
  }

  function wireHome() {
    if (!$('hmQuietRows')) return;
    $('hmQuietRows').addEventListener('click', function (e) {
      var b = e.target.closest('[data-log]');
      if (b && window.StaffSupporterDialog) window.StaffSupporterDialog.open(b.getAttribute('data-log'), b, true);
    });
  }

  /* =====================================================================
     LIVE SECTIONS — directory + resources via staff-data
     ===================================================================== */

  function setStatus(text, isError) {
    var el = $('saveStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'hint' + (isError ? ' err' : '');
  }

  function renderCards() {
    renderDirectory();
    renderResources();
  }

  /* THE MINISTRY'S ADDRESS BOOK (board 11): one row per person, opening its
     card in a dialog, narrowed by the search box. Every address and number is
     listed, each a link that dials or writes rather than opening the card. On
     a phone the rows are cards (.sw-cards), each cell saying what it is. */
  function renderDirectory() {
    var body = $('contacts');
    if (!body) return;
    var q = ($('dirFind') ? $('dirFind').value : '').trim().toLowerCase();
    var rows = state.contacts.map(function (c, i) { return { c: c, i: i }; }).filter(function (r) {
      if (!q) return true;
      var c = r.c;
      return [c.name, c.role].concat(c.emails || [], c.phones || []).join(' ').toLowerCase().indexOf(q) !== -1;
    });
    if ($('dirFind')) $('dirFind').hidden = !state.contacts.length;
    body.innerHTML = rows.map(function (r) {
      var c = r.c;
      return '<tr data-contact="' + r.i + '" tabindex="0" role="button" aria-haspopup="dialog">' +
        '<td class="sw-who"><span class="nm">' + esc(c.name) + '</span></td>' +
        '<td data-label="' + esc(tr('dir.role')) + '">' + esc(c.role || '') + '</td>' +
        '<td data-label="' + esc(tr('dir.email')) + '">' + (c.emails || []).map(function (e) {
          return '<a class="lnk" href="mailto:' + esc(e) + '">' + esc(e) + '</a>'; }).join('<br>') + '</td>' +
        '<td data-label="' + esc(tr('dir.phone')) + '">' + (c.phones || []).map(function (p) {
          return '<a class="lnk" href="tel:' + esc(String(p).replace(/[^0-9+]/g, '')) + '">' + esc(p) + '</a>';
        }).join('<br>') + '</td>' +
      '</tr>';
    }).join('') ||
      '<tr class="empty-row"><td colspan="4"><p class="empty">' +
        esc(tr(q ? 'stew.noMatch' : 'dir.empty')) + '</p></td></tr>';
  }

  /* THREE SHELVES, and the controls follow what the SERVER said rather than
     what the browser can work out. `can_edit` and `shelf` come back on every
     row; deriving them again here would be a second implementation of the
     ownership rule, and the two would eventually disagree — with the browser's
     version being the one people see.

     A card with no Edit button is not a permission check. The endpoint refuses
     the write regardless; this is about not offering. */
  function renderResources() {
    if (!$('resourceList')) return;

    var shelves = [
      { key: 'institutional', title: tr('res.shelfOrg') },
      /* NAMED, not "Mine". Three headings where one says a person's name reads
         as a place rather than a filter — and the same page is read by
         somebody an administrator is viewing as, where "Mine" would be a lie
         about whose shelf it is. Falls back when the name is not known yet. */
      { key: 'mine',
        title: state.whoName ? fill('res.shelfNamed', { who: state.whoName })
                             : tr('res.shelfMine') },
      { key: 'shared', title: tr('res.shelfShared') },
    ];

    var html = shelves.map(function (sh) {
      var rows = (state.resources || []).filter(function (r) {
        /* Rows from before this shelf existed have no `shelf` at all. They are
           the organization's, which is where they were. */
        return (r.shelf || 'institutional') === sh.key;
      });
      /* An empty shelf is omitted rather than shown empty — three headings
         with nothing under two of them reads as broken on a first visit. The
         exception is `mine`, which is where the Add button lives. */
      if (!rows.length && sh.key !== 'mine') return '';

      return '<section class="res-shelf" data-shelf="' + sh.key + '">' +
        '<h3>' + esc(sh.title) + '</h3>' +
        '<div class="cards">' +
          (rows.length
            ? rows.map(function (r) {
                var i = state.resources.indexOf(r);
                /* THE ORGANIZATION'S SHELF CARRIES A STATE WORTH SEEING: is
                   this actually out to all staff, or is it an administrator's
                   draft? It is the existing `visibility` column — 'staff'
                   means everyone, 'admin' means administrators only — shown as
                   a switch rather than left as a field nobody looks at.

                   Offered only to whoever may edit, and only on this shelf: a
                   personal resource is governed by sharing, not by this. */
                var shareAll = sh.key === 'institutional' && r.can_edit
                  ? '<button type="button" class="res-toggle' +
                      (r.visibility === 'staff' ? ' is-on' : '') + '"' +
                      ' role="switch" aria-checked="' + (r.visibility === 'staff') + '"' +
                      ' data-toggle-resource="' + i + '">' +
                      '<span class="res-toggle-dot" aria-hidden="true"></span>' +
                      esc(r.visibility === 'staff'
                            ? tr('res.sharedAll') : tr('res.adminsOnly')) +
                    '</button>'
                  : '';

                return '<div class="card">' +
                  '<div class="card-actions">' +
                    /* Edit for whoever may change it — the owner, an
                       administrator on the organization's shelf, or someone
                       it was shared with as "Can edit". Delete and Share are
                       the owner's alone (Chase, 2026-09-28); the endpoint
                       refuses anybody else either way. */
                    (r.can_edit
                      ? '<button type="button" data-edit-resource="' + i + '">' +
                          esc(tr('common.edit')) + '</button>'
                      : '') +
                    (r.can_edit && sh.key !== 'shared'
                      ? '<button type="button" class="del" data-delete-resource="' + i + '">' +
                          esc(tr('common.delete')) + '</button>'
                      : '') +
                    (sh.key === 'mine'
                      ? '<button type="button" data-share-resource="' + i + '">' +
                          esc(tr('res.share')) + '</button>'
                      : '') +
                  '</div>' +
                  (r.photo ? '<div class="photo"><img src="' + esc(r.photo) +
                             '" alt="" loading="lazy"></div>' : '') +
                  '<h4>' + esc(r.title) + '</h4>' +
                  (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
                  (r.shared_by_name
                    ? '<p class="res-from">' +
                        esc(fill('res.sharedBy', { who: r.shared_by_name })) + '</p>'
                    : '') +
                  (r.link ? '<a class="lnk" href="' + esc(r.link) +
                            '" target="_blank" rel="noopener">' +
                            esc(tr('res.open')) + '</a>' : '') +
                  shareAll +
                '</div>';
              }).join('')
            : '<p class="empty">' + esc(tr('res.emptyMine')) + '</p>') +
        '</div></section>';
    }).join('');

    $('resourceList').innerHTML = html || '<p class="empty">' + esc(tr('res.empty')) + '</p>';
  }

  function showUpdated(data) {
    setStatus(data.updatedAt
      ? 'Last updated ' + new Date(data.updatedAt).toLocaleString() +
        (data.updatedBy ? ' by ' + data.updatedBy : '')
      : '', false);
  }

  async function loadStaffData() {
    try {
      var res = await fetch(STAFF_API, { credentials: 'same-origin' });
      var body = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        // A 403 here usually means "no partner", which is a normal state for
        // an administrator or a board member — not a fault. The endpoint says
        // which, and its wording is used rather than a generic message.
        if (body.you && window.StaffIdentity) window.StaffIdentity(body.you);
        noteActing(body);
        var why = res.status === 500 ? tr('err.unreachable')
                : res.status === 403 ? (body.error || tr('err.noPartner'))
                : tr('err.expired');
        if ($('contacts')) $('contacts').innerHTML = '<p class="empty">' + esc(why) + '</p>';
        if ($('resourceList')) $('resourceList').innerHTML = '<p class="empty">' + esc(why) + '</p>';
        return;
      }
      if (body.you) rememberIdentity(body.you, body.partner);
      noteActing(body);
      state.contacts = body.contacts || [];
      state.resources = body.resources || [];
      state.canSetVisibility = !!(body.can && body.can.set_visibility);
      renderCards();
    } catch (e) {
      if ($('contacts')) {
        $('contacts').innerHTML = '<p class="empty">' + esc(tr('err.unreachable')) + '</p>';
      }
    }
  }

  /* ONE ITEM AT A TIME.

     This used to POST the entire document — every contact and every resource
     — on any change. With a single shared store that quietly meant last write
     wins: two people editing the same afternoon and the second erased the
     first. Now each save touches one row, and the server returns the fresh
     list rather than this page assuming its own copy is right. */
  async function saveItem(kind, item) {
    setStatus(tr('common.saving'), false);
    try {
      var res = await fetch(STAFF_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ kind: kind }, item))
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('save failed (' + res.status + ')'));

      if (body.contacts) state.contacts = body.contacts;
      if (body.resources) state.resources = body.resources;
      renderCards();
      setStatus('');
      if (window.StaffToast) window.StaffToast(tr('toast.saved'), 'ok');
    } catch (e) {
      setStatus(e.message, true);
      await loadStaffData();
    }
  }

  async function deleteItem(kind, id) {
    try {
      var res = await fetch(STAFF_API + '?kind=' + kind + '&id=' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin'
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('delete failed (' + res.status + ')'));
      if (body.contacts) state.contacts = body.contacts;
      if (body.resources) state.resources = body.resources;
      renderCards();
      if (window.StaffToast) window.StaffToast(tr('toast.deleted'), 'ok');
    } catch (e) {
      setStatus(e.message, true);
      await loadStaffData();
    }
  }

  /* SHARING ONE RESOURCE (Chase, 2026-09-28) — the dialog in resources.njk.

     Only the owner is offered Share (the endpoint refuses anybody else).
     Groups are switches: the owner's ministry team, and everyone at Thauma
     for an administrator. People are found by typing two letters of a name
     (people_find: names and ministries, never a list of everybody, never an
     address to type). Each share is "Can view" unless the owner picks "Can
     edit". Every change saves the moment it is made, and the dialog redraws
     from what the server answered. */
  var share = { r: null, data: null, findTimer: null, findSeq: 0 };

  function shareSelect(attrs, canEdit) {
    return '<select class="share-can" ' + attrs + ' aria-label="' + esc(tr('res.canEdit')) + '">' +
      '<option value="0"' + (canEdit ? '' : ' selected') + '>' + esc(tr('res.canView')) + '</option>' +
      '<option value="1"' + (canEdit ? ' selected' : '') + '>' + esc(tr('res.canEdit')) + '</option>' +
    '</select>';
  }

  function renderShare() {
    var d = share.data;
    if (!d) return;
    var group = function (audience, label) {
      var g = (d.groups || []).filter(function (x) { return x.audience === audience; })[0];
      return '<div class="share-row">' +
        '<button type="button" class="switch small" role="switch" data-share-group="' + audience + '"' +
          ' aria-checked="' + (g ? 'true' : 'false') + '">' +
          '<span class="switch-track"><span class="switch-state">' + (g ? 'On' : 'Off') +
          '</span><span class="switch-knob"></span></span>' +
          '<span class="switch-label">' + esc(label) + '</span></button>' +
        (g ? shareSelect('data-share-group-can="' + audience + '"', g.can_edit) : '') +
      '</div>';
    };
    $('shareGroups').innerHTML =
      group('team', fill('res.shareTeam', { name: d.team.name })) +
      (d.may_everyone ? group('everyone', tr('res.shareEveryone')) : '');
    $('sharePeople').innerHTML = (d.people || []).map(function (p) {
      return '<div class="share-row share-person">' +
        '<span class="share-name">' + esc(p.name || p.email) + '</span>' +
        shareSelect('data-share-person-can="' + esc(p.user_id) + '"', p.can_edit) +
        '<button type="button" class="share-x" data-share-remove="' + esc(p.user_id) + '"' +
          ' aria-label="' + esc(fill('res.unshare', { who: p.name || p.email })) + '">&times;</button>' +
      '</div>';
    }).join('');
  }

  async function shareSend(payload) {
    try {
      var res = await fetch(STAFF_API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ kind: 'share', resource_id: share.r.id }, payload)),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      share.data = body;
      if (body.resources) { state.resources = body.resources; renderCards(); }
      renderShare();
    } catch (e) {
      if (window.StaffToast) window.StaffToast(e.message, 'err');
    }
  }

  async function shareResource(r) {
    if (!r) return;
    share.r = r;
    share.data = null;
    $('shareTitle').textContent = fill('res.shareTitle', { title: r.title });
    $('shareGroups').innerHTML = '<p class="hint">' + esc(tr('common.loading')) + '</p>';
    $('sharePeople').innerHTML = '';
    $('shareFound').innerHTML = '';
    $('shareFind').value = '';
    $('shareBack').hidden = false;
    void $('shareBack').offsetHeight;
    $('shareBack').classList.add('in');
    try {
      var res = await fetch(STAFF_API + '?shares=' + encodeURIComponent(r.id), { credentials: 'same-origin' });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      share.data = body;
      renderShare();
      $('shareFind').focus();
    } catch (e) {
      $('shareGroups').innerHTML = '<p class="hint">' + esc(e.message) + '</p>';
    }
  }

  function closeShare() { $('shareBack').classList.remove('in'); $('shareBack').hidden = true; share.r = null; }

  /* Two letters, then ask; the newest answer wins, so a slow reply to "an"
     never overwrites the answer to "ana". */
  function findPeople() {
    var q = $('shareFind').value.trim();
    clearTimeout(share.findTimer);
    if (q.length < 2) { $('shareFound').innerHTML = ''; return; }
    share.findTimer = setTimeout(async function () {
      var seq = ++share.findSeq;
      var res = await fetch(STAFF_API + '?people=' + encodeURIComponent(q), { credentials: 'same-origin' });
      var body = await res.json().catch(function () { return {}; });
      if (seq !== share.findSeq) return;
      var have = {};
      ((share.data && share.data.people) || []).forEach(function (p) { have[p.user_id] = true; });
      var found = (body.people || []).filter(function (p) { return !have[p.user_id]; });
      /* Everyone it found already has it: nothing to offer, and "nobody by
         that name" would not be true. */
      $('shareFound').innerHTML = !found.length && (body.people || []).length ? ''
        : found.length
        ? found.map(function (p) {
            return '<button type="button" class="share-hit" data-share-add="' + esc(p.user_id) + '">' +
              '<span class="share-name">' + esc(p.name) + '</span>' +
              (p.ministries ? '<span class="share-sub">' + esc(p.ministries) + '</span>' : '') +
            '</button>';
          }).join('')
        : '<p class="hint">' + esc(tr('res.noMatch')) + '</p>';
    }, 180);
  }

  function wireShare() {
    if (!$('shareBack') || wireShare.done) return;
    wireShare.done = true;
    var back = $('shareBack');
    back.addEventListener('click', function (e) {
      if (e.target === back) return closeShare();
      var sw = e.target.closest('[data-share-group]');
      if (sw) {
        var on = sw.getAttribute('aria-checked') === 'true';
        return shareSend({ audience: sw.getAttribute('data-share-group'), remove: on });
      }
      var add = e.target.closest('[data-share-add]');
      if (add) {
        $('shareFind').value = '';
        $('shareFound').innerHTML = '';
        return shareSend({ user_id: add.getAttribute('data-share-add') });
      }
      var x = e.target.closest('[data-share-remove]');
      if (x) return shareSend({ user_id: x.getAttribute('data-share-remove'), remove: true });
    });
    back.addEventListener('change', function (e) {
      var g = e.target.closest('[data-share-group-can]');
      if (g) return shareSend({ audience: g.getAttribute('data-share-group-can'), can_edit: g.value === '1' });
      var p = e.target.closest('[data-share-person-can]');
      if (p) return shareSend({ user_id: p.getAttribute('data-share-person-can'), can_edit: p.value === '1' });
    });
    $('shareFind').addEventListener('input', findPeople);
    $('shareClose').addEventListener('click', closeShare);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) closeShare();
    });
  }

  /* Flip an organization resource between "all staff" and "administrators
     only". It saves through the ordinary resource write, so the endpoint's own
     rule — only an administrator may narrow visibility — applies without a
     second code path deciding it. */
  async function toggleShareAll(r) {
    if (!r) return;
    try {
      var res = await fetch(STAFF_API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'resource', id: r.id, shelf: 'institutional',
          title: r.title, description: r.description, link: r.link, photo: r.photo,
          visibility: r.visibility === 'staff' ? 'admin' : 'staff',
        }),
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      if (body.resources) state.resources = body.resources;
      renderCards();
    } catch (e) {
      setStatus(e.message, true);
    }
  }

  // ---- repeatable email/phone rows ----
  function addRow(container, type, cls, value) {
    var row = document.createElement('div');
    row.className = 'frow';
    var input = document.createElement('input');
    input.type = type; input.className = cls; input.value = value || '';
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'ghost-btn'; rm.textContent = tr('dir.removeRow');
    rm.addEventListener('click', function () { row.remove(); });
    row.appendChild(input); row.appendChild(rm);
    container.appendChild(row);
  }

  function wireContactForm() {
    var cForm = $('contactForm'), back = $('contactBack');
    if (!cForm || !back) return;
    var emails = $('contactEmails'), phones = $('contactPhones');

    $('addEmailRow').addEventListener('click', function () { addRow(emails, 'email', 'c-email', ''); });
    $('addPhoneRow').addEventListener('click', function () { addRow(phones, 'tel', 'c-phone', ''); });

    function close() {
      back.hidden = true;
      back.classList.remove('in');
      cForm.reset();
      emails.innerHTML = ''; phones.innerHTML = '';
    }

    function open(index) {
      var c = (index === '' || index === undefined) ? {} : state.contacts[index];
      $('contactIndex').value = index === undefined ? '' : index;
      $('contactFormTitle').textContent = c.id ? c.name : tr('dir.new');
      /* Who added it: the team shares the card, and this is the one thing
         about it nobody else wrote. */
      var added = $('contactAdded');
      added.hidden = !(c.id && c.added_by);
      if (!added.hidden) added.textContent = fill('dir.addedBy', { name: c.added_by, date: shortDate(String(c.created_at || '').slice(0, 10)) });
      $('contactDelete').hidden = !c.id;
      $('contactName').value = c.name || '';
      $('contactRole').value = c.role || '';
      emails.innerHTML = ''; phones.innerHTML = '';
      ((c.emails && c.emails.length) ? c.emails : ['']).forEach(function (v) {
        addRow(emails, 'email', 'c-email', v); });
      (c.phones || []).forEach(function (v) { addRow(phones, 'tel', 'c-phone', v); });
      back.hidden = false;
      void back.offsetHeight;
      back.classList.add('in');
      $('contactName').focus();
    }
    $('addContactBtn').addEventListener('click', function () { open(''); });
    $('contactCancel').addEventListener('click', close);
    /* The backdrop and Escape both cancel, as on every dialog here. */
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !back.hidden) close(); });

    $('contactDelete').addEventListener('click', async function () {
      var c = state.contacts[Number($('contactIndex').value)];
      if (!c) return;
      var ok = await window.StaffConfirm({
        title: fill('dir.deleteTitle', { name: c.name }),
        confirm: tr('dir.delete'), cancel: tr('common.cancel'), danger: true
      });
      if (!ok) return;
      close();
      deleteItem('contact', c.id);
    });

    cForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var idx = $('contactIndex').value;
      var entry = {
        name: $('contactName').value,
        role: $('contactRole').value,
        emails: Array.from(cForm.querySelectorAll('.c-email'))
                  .map(function (i) { return i.value.trim(); }).filter(Boolean),
        phones: Array.from(cForm.querySelectorAll('.c-phone'))
                  .map(function (i) { return i.value.trim(); }).filter(Boolean)
      };
      if (idx !== '') entry.id = state.contacts[idx] && state.contacts[idx].id;
      close();
      saveItem('contact', entry);
    });

    /* A row opens its card; an address or number in it writes or dials. */
    function rowOf(e) { return e.target.closest && !e.target.closest('a') && e.target.closest('tr[data-contact]'); }
    $('contacts').addEventListener('click', function (e) {
      var tr_ = rowOf(e); if (tr_) open(tr_.dataset.contact);
    });
    $('contacts').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr_ = rowOf(e); if (tr_) { e.preventDefault(); open(tr_.dataset.contact); }
    });
    if ($('dirFind')) $('dirFind').addEventListener('input', renderDirectory);
  }

  function wireResourceForm() {
    wireShare();
    var rForm = $('resourceForm');
    var back = $('resourceBack');
    if (!rForm || !back) return;

    /* Whether this account may put something on the organization's shelf.
       THE SERVER'S OWN ANSWER, carried in `can.set_visibility`, rather than
       anything worked out here from roles: staff-data.js decides it and will
       refuse the write on the same test, so a second opinion in the browser
       could only ever disagree with the one that counts. */
    function mayPublishOrg() { return !!state.canSetVisibility; }

    function close() {
      back.hidden = true;
      back.classList.remove('in');
      rForm.reset();
    }

    function open(index) {
      var r = (index === '' || index === undefined) ? {} : state.resources[index];
      $('resourceIndex').value = index === undefined ? '' : index;
      $('resourceTitle').value = r.title || '';
      $('resourceDescription').value = r.description || '';
      $('resourceLink').value = r.link || '';
      $('resourcePhoto').value = r.photo || '';

      var where = $('resourceWhereRow');
      where.hidden = !mayPublishOrg();
      /* An existing resource opens on the shelf it is actually on, so saving
         without touching this cannot move it. */
      $('resourceWhere').value = r.id
        ? ((r.shelf || 'institutional') === 'institutional'
             ? (r.visibility === 'admin' ? 'admin' : 'staff')
             : 'mine')
        : 'mine';

      var h = $('resourceFormTitle');
      if (h) h.textContent = tr(r.id ? 'res.edit' : 'res.add');

      back.hidden = false;
      void back.offsetHeight;
      back.classList.add('in');
      $('resourceTitle').focus();
    }

    $('addResourceBtn').addEventListener('click', function () { open(''); });
    $('resourceCancel').addEventListener('click', close);
    /* The backdrop and Escape both cancel — the safe answer should be the easy
       one to reach, the same way the confirm dialog works. */
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !back.hidden) close();
    });

    rForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var idx = $('resourceIndex').value;
      var entry = {
        title: $('resourceTitle').value,
        description: $('resourceDescription').value,
        link: $('resourceLink').value,
        photo: $('resourcePhoto').value
      };
      /* Only when the control was actually offered. Sending a shelf this
         account may not set would be asking the server to refuse. */
      if (!$('resourceWhereRow').hidden) {
        var w = $('resourceWhere').value;
        entry.shelf = w === 'mine' ? 'mine' : 'institutional';
        if (w !== 'mine') entry.visibility = w;
      }
      if (idx !== '') entry.id = state.resources[idx] && state.resources[idx].id;
      close();
      saveItem('resource', entry);
    });

    $('resourceList').addEventListener('click', function (e) {
      if (e.target.dataset.editResource !== undefined) open(e.target.dataset.editResource);
      if (e.target.dataset.deleteResource !== undefined) {
        var r = state.resources[Number(e.target.dataset.deleteResource)];
        /* The console's own dialog, in the console's language, not the
           browser's English confirm. */
        if (r && window.StaffConfirm) {
          window.StaffConfirm({ title: fill('res.confirmDelete', { title: r.title }),
                                confirm: tr('common.delete'), cancel: tr('common.cancel'), danger: true })
            .then(function (yes) { if (yes) deleteItem('resource', r.id); });
        }
      }
      if (e.target.dataset.shareResource !== undefined) {
        shareResource(state.resources[Number(e.target.dataset.shareResource)]);
      }
      /* closest(), because the switch has a dot inside it and a click can land
         on the child. */
      var toggle = e.target.closest && e.target.closest('[data-toggle-resource]');
      if (toggle) toggleShareAll(state.resources[Number(toggle.dataset.toggleResource)]);
    });
  }

  /* =====================================================================
     IDENTITY — supplied by Cloudflare Access, not managed here
     ===================================================================== */

  // Access exposes the signed-in user at this endpoint on any gated hostname.
  // Cosmetic only: authorisation already happened at the edge and is
  // re-verified server-side by the function.
  /* WHO IS SIGNED IN.

     Two sources, in order of authority:

       our database   the name we hold for this account. Cached, because not
                      every page makes a request that returns it, and a header
                      that fills in a second late reads as a glitch.

       Access         the fallback. It carries whatever the identity provider
                      chose to share, which is frequently an email and nothing
                      else — which is why the name was missing on some pages
                      and present on others. */
  /* sessionStorage, NOT localStorage.

     The cache exists to stop the header flashing blank while navigating
     between pages — which is a within-one-session problem, and sessionStorage
     is scoped to exactly that: one tab, cleared when it closes.

     localStorage would outlive the session, so on a shared machine the next
     person to sign in would briefly see the PREVIOUS person's name before
     their own arrived. Small, and wrong in the one direction that matters —
     showing nothing is never incorrect, showing somebody else always is. */
  var IDENT = 'thauma.staff.who';

  /* THE HEADER SAYS WHO YOU ARE, ONCE.

     The pill carries the signed-in person's NAME; the block beside it carries
     their role. Both used to show the name, which is a thing said twice, and
     the pill previously showed the PARTNER — so on one screen it read
     "Chase Roush" while the block read "Org Admin" and the two looked like a
     contradiction rather than two different facts.

     Which partner's records are on screen is a real thing to know, but it
     belongs where it has room to be labeled: Settings says "Working with X".
     It matters more once an admin can view several, and a bare name in a
     corner is the wrong place to learn that. */
  var ROLE_LABEL = { admin: 'Administration', staff: 'Staff', board: 'Board' };

  function paintIdentity(who) {
    if (!who) return;

    var raw = who.roles || [];
    var roles = raw.map(function (r) { return ROLE_LABEL[r] || r; });

    // Name and role in ONE chip. They were two elements side by side, which
    // made the right of the header four items wide and wrapped the lot onto a
    // second line inside a header that could not grow.
    /* THE NAME ONLY. This used to append the role list, which was useful when
       the header had no other way to say which console you were in. The two
       badges say it now, so the chip was repeating them — and reading
       "Administration · partner" beside a row labeled ADMINISTRATION was
       both redundant and the widest thing in the header, which is part of why
       the nav had no room and wrapped. */
    if (who.name && $('partnerPill')) {
      $('partnerPill').textContent = who.name;
      $('partnerPill').hidden = false;
      $('partnerPill').title = who.email || '';
    }

    /* The door to administration used to be a single link revealed here. The
       header now carries both consoles and shows the rows this account has, so
       somebody who is both does not travel between two places — they are in
       one. applyNav is what replaced it. */
    applyNav(raw);
  }

  /* =====================================================================
     THE NAV THIS ACCOUNT ACTUALLY HAS
     =====================================================================
     Both consoles are rendered into every page — Eleventy cannot know who is
     asking, and building a variant per role would ship the whole console
     several times over. So each row and each link carries the roles it is for
     and the wrong ones are removed here.

     PRESENTATION ONLY. Every endpoint checks the role itself and must: a
     hidden link is a tidier console, not a closed door.

     WHAT HAPPENS BEFORE THE IDENTITY ARRIVES is the part worth getting right.
     Rows are rendered hidden, so doing nothing would leave a bare header until
     the first fetch came back — the "titles pop in late" problem this project
     already set out to remove. So: a cached identity is applied before first
     paint, and failing that the row for the page you are ON is shown whole
     until the real answer lands. Nobody sees an empty header, and nobody sees
     a link appear that they cannot use for longer than one request. */
  function matches(el, roles) {
    var want = (el.getAttribute('data-roles') || '').split(/\s+/).filter(Boolean);
    if (!want.length) return true;          // unrestricted
    for (var i = 0; i < want.length; i++) {
      if (roles.indexOf(want[i]) !== -1) return true;
    }
    return false;
  }

  function applyNav(roles) {
    var rows = document.querySelectorAll('.console-row');
    if (!rows.length) return;
    var firstVisible = null;

    /* THE SAME CLASSES console-roles-head.njk SET, now from the real identity
       rather than a cache. Setting them again is what makes a stale cache
       correct itself within one request — and when the cache was right, this
       changes nothing, which is why the nav no longer moves after it paints. */
    var el = document.documentElement;
    el.className = el.className.replace(/\brole-[a-z]+\b/g, '').trim();
    roles.forEach(function (r) {
      el.classList.add('role-' + String(r).replace(/[^a-z]/gi, ''));
    });
    el.classList.add('roles-known');

    Array.prototype.forEach.call(rows, function (row) {
      var links = row.querySelectorAll('nav a');
      var kept = 0;
      Array.prototype.forEach.call(links, function (a) {
        var ok = matches(a, roles);
        a.hidden = !ok;
        if (ok) kept++;
      });
      /* A row with nothing left in it is not a row. This is why the two-row
         header needs no special case: it is simply what happens when both
         rows keep something. */
      row.hidden = kept === 0;
      if (!row.hidden && !firstVisible) firstVisible = row;
    });

    /* The pages under your name follow the same rule as the rows. */
    Array.prototype.forEach.call(document.querySelectorAll('.console-me-menu a[data-roles]'), function (a) {
      a.hidden = !matches(a, roles);
    });

    /* The wordmark goes to a console this account actually has. It used to be
       hardcoded to /staff/, which sent a board member to a page that refused
       them the moment they clicked their own logo. */
    var home = $('consoleHome');
    if (home && firstVisible) {
      home.href = firstVisible.getAttribute('data-row') === 'admin' ? '/admin/' : '/staff/';
    }
  }

  /* The cached identity, applied before the first fetch so the per-link state
     matches what the head script already painted.

     NO FALLBACK BRANCH HERE any more. When there is nothing cached, CSS shows
     the console this page belongs to (see the [data-area] rules) — doing it
     here as well meant JavaScript and stylesheet both deciding, and they
     disagreed for one frame on every page. */
  (function primeNav() {
    var cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(IDENT) || 'null'); } catch (e) {}
    if (cached && cached.roles && cached.roles.length) applyNav(cached.roles);
  })();

  /* =====================================================================
     THE TWO MENUS IN THE HEADER (mockup board 1)
     =====================================================================
     Your name opens what is about you: Settings, your Activity, Sign out.
     On a phone, Menu opens everything — both rows and those — as one list.
     Both are disclosures (a button that shows a list of links), not ARIA
     menus: links are what they hold, and Tab moves through them as links.

     They close on Escape (focus back to the button that opened them), on a
     click anywhere else, and on choosing a link, which leaves the page. */
  (function headerMenus() {
    var header = $('console');
    var meBtn = $('consoleMeBtn'), me = $('consoleMe');
    var menuBtn = $('consoleMenuBtn');
    if (!header || !meBtn || !me || !menuBtn) return;

    function setMe(open) {
      meBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      header.classList.toggle('me-open', open);
    }
    function setMenu(open) {
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      header.classList.toggle('menu-open', open);
      document.documentElement.classList.toggle('console-menu-open', open);
    }

    meBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMe(meBtn.getAttribute('aria-expanded') !== 'true');
    });
    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenu(menuBtn.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('click', function (e) {
      if (header.classList.contains('me-open') && !e.target.closest('.console-me')) setMe(false);
      if (header.classList.contains('menu-open') && !e.target.closest('#console')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (header.classList.contains('me-open')) { setMe(false); meBtn.focus(); }
      else if (header.classList.contains('menu-open')) { setMenu(false); menuBtn.focus(); }
    });
    /* A phone turned sideways past the breakpoint should not come back to a
       wide header with the phone menu still open underneath it. */
    if (window.matchMedia) {
      var wide = window.matchMedia('(min-width: 821px)');
      var onWide = function () { if (wide.matches) setMenu(false); };
      if (wide.addEventListener) wide.addEventListener('change', onWide);
    }
  })();

  /* Called by any page whose data included an identity block. */
  function rememberIdentity(who, partner) {
    /* Kept for the resource shelf heading, which says whose shelf it is. */
    if (who && who.name) state.whoName = who.name;
    if (partner && partner.display_name) who = Object.assign({}, who, {
      partner_name: partner.display_name });
    if (!who || !who.email) return;
    try { sessionStorage.setItem(IDENT, JSON.stringify(who)); } catch (e) {}
    paintIdentity(who);
  }
  window.StaffIdentity = rememberIdentity;

  /* =====================================================================
     ACTING AS SOMEBODY ELSE — unmissable, permanent, not flashing
     =====================================================================
     An administrator can open a partner's console to see what they see.
     Every screen then shows one person's data while a different person is
     signed in, and the failure mode is somebody editing the wrong ministry
     believing it was their own.

     So the state is carried THREE ways at once, for the same reason the
     admin area is: it has to survive being seen in a hurry, in grayscale,
     or by somebody who does not perceive color the way the designer does.

       a band across the top naming whose account it is
       a border round the entire viewport
       a watermark fixed in the corner, visible while scrolling

     A FLASHING banner was the first instinct and is a photosensitivity
     hazard. A permanent one is both safer and harder to ignore — a thing
     that blinks becomes background, a thing that is always there is a
     thing you are looking at.

     THE SERVER DECIDES. This is painted only from `acting` in an API
     response, never from the cookie: a person could set the cookie by hand
     and the server would ignore it, and a banner claiming otherwise would
     be a lie about who you are.
     ===================================================================== */

  var ACTING = 'thauma.staff.acting';
  var actingNow = null;

  /* CACHED, AND PAINTED BEFORE ANY REQUEST.
     Two bugs, one cause. The banner used to be painted only from a successful
     API response, so (a) it flashed absent on every page load until the fetch
     came back, and (b) if the fetch FAILED it never appeared at all — leaving
     somebody inside another person's account with no indication of it, at the
     exact moment the screen is confusing for other reasons.

     sessionStorage, not localStorage: it exists to survive navigation within
     one session, and on a shared machine localStorage would tell the next
     person they are inside somebody's account. */
  function cacheActing(acting) {
    try {
      if (acting) sessionStorage.setItem(ACTING, JSON.stringify(acting));
      else sessionStorage.removeItem(ACTING);
    } catch (e) {}
  }

  function paintActing(acting) {
    var had = !!actingNow;
    actingNow = acting || null;
    cacheActing(actingNow);

    /* THE LANGUAGE FOLLOWS THE ACCOUNT, IN BOTH DIRECTIONS.

       Seeing what somebody sees means reading what they read, so their
       language goes on screen — transiently, so it never becomes your own
       stored preference. Stopping puts yours back.

       Both halves were missing. Opening a Serbian account left the console in
       English until some later request happened to set it, and stopping left
       it in Serbian permanently, because the language cache is localStorage
       and nothing ever put it back. */
    if (window.StaffI18n) {
      if (actingNow && actingNow.lang) {
        window.StaffI18n.setLang(actingNow.lang, { transient: true });
      } else if (had && !actingNow) {
        window.StaffI18n.setLang(window.StaffI18n.ownLang(), { transient: true });
      }
    }

    if (!actingNow) {
      if (had) {
        document.body.classList.remove('is-acting');
        var old = document.getElementById('actingBar');
        if (old) old.remove();
        var mark = document.getElementById('actingMark');
        if (mark) mark.remove();
      }
      return;
    }

    document.body.classList.add('is-acting');

    /* THE BANNER IS IN YOUR LANGUAGE, not theirs.

       It is a message to the administrator — whose account this is, and how to
       leave — and the person being viewed never sees it. The console around it
       is deliberately in their language; the controls for getting out of it
       are yours. `mine` falls back to plain tr() if an older cached copy of
       staff-i18n.js is in the browser, so a stale asset degrades to the wrong
       language rather than to a crash. */
    var myLang = (window.StaffI18n && window.StaffI18n.ownLang)
      ? window.StaffI18n.ownLang() : 'en';
    var mine = (window.StaffI18n && window.StaffI18n.tIn)
      ? function (k) { return window.StaffI18n.tIn(myLang, k); }
      : tr;

    var bar = document.getElementById('actingBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'actingBar';
      bar.className = 'acting-bar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    bar.innerHTML =
      '<span class="acting-eye" aria-hidden="true">\u25C9</span>' +
      '<span class="acting-text">' +
        '<b>' + esc(actingNow.name) + '</b>' +
        '<span>' + esc(mine('act.youAreViewing')) + '</span>' +
      '</span>' +
      '<button type="button" class="acting-stop" id="actingStop">' +
        esc(mine('act.stop')) + '</button>';

    var mark = document.getElementById('actingMark');
    if (!mark) {
      mark = document.createElement('div');
      mark.id = 'actingMark';
      mark.className = 'acting-mark';
      mark.setAttribute('aria-hidden', 'true');
      document.body.appendChild(mark);
    }
    mark.textContent = mine('act.watermark').replace('{name}', actingNow.name);
  }

  /* THE WAY OUT MUST NEVER DEPEND ON ANYTHING OPTIONAL.

     This broke once, and the failure was total: the handler called
     StaffI18n.ownLang(), a browser holding an older cached copy of
     staff-i18n.js did not have that function, the TypeError killed the
     callback, and the navigation never ran. Pressing Stop did nothing at all,
     with no error anybody could see.

     A guard of `if (window.StaffI18n)` did not help, because the object
     existed — only the function was missing. So every piece of cleanup below
     is individually isolated, and the navigation happens whatever any of them
     does. Being unable to leave somebody else's account is the worst state
     this feature has. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('#actingStop');
    if (!btn) return;
    btn.disabled = true;

    var leave = function () {
      try { sessionStorage.removeItem(IDENT); } catch (err) {}
      try { cacheActing(null); } catch (err) {}
      try {
        if (window.StaffI18n && window.StaffI18n.ownLang) {
          window.StaffI18n.setLang(window.StaffI18n.ownLang(), { transient: true });
        }
      } catch (err) {}
      // Back to where the support job started.
      location.href = '/admin/users/';
    };

    fetch('/api/admin/act-as', { method: 'DELETE', credentials: 'same-origin' })
      .then(function (res) {
        if (res.ok) return leave();
        /* The server refused. The cookie is still set, so leaving now would
           land on the admin page still acting — confusing, but visible and
           recoverable. Staying put with a dead button is neither. */
        btn.disabled = false;
        if (window.StaffToast) window.StaffToast(tr('err.refused') + ' (' + res.status + ')', 'bad');
      })
      .catch(function () {
        btn.disabled = false;
        if (window.StaffToast) window.StaffToast(tr('err.unreachable'), 'bad');
      });
  });

  /* Called by every loader with whatever the server said.

     A response with no `acting` property carries NO OPINION and must not clear
     a banner — that is what a failed request looks like, and a failed request
     is the worst possible moment to stop telling somebody whose account they
     are in. Only an explicit `acting: null` from a request the server actually
     answered takes the banner down. */
  function noteActing(body) {
    if (!body || typeof body !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(body, 'acting')) return;
    paintActing(body.acting);
  }
  window.StaffActing = noteActing;

  /* Paint from cache at once, before anything is fetched. The server corrects
     it a moment later if it disagrees. */
  (function () {
    try {
      var cached = JSON.parse(sessionStorage.getItem(ACTING) || 'null');
      if (cached) paintActing(cached);
    } catch (e) {}
  })();


  function loadIdentity() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(IDENT) || 'null');
      if (cached) paintIdentity(cached);
    } catch (e) {}

    return fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (id) {
        if (!id) throw new Error('no identity');
        // Only fills a gap. A name from our own records outranks whatever the
        // identity provider happens to carry, which is often an email and
        // nothing else — that difference is why the header used to show a
        // name on some pages and not others.
        var pill = $('partnerPill');
        if (pill && pill.hidden) {
          pill.textContent = id.name || id.email || tr('common.signedIn');
          pill.title = id.email || '';
          pill.hidden = false;
        }
      })
      .catch(function () {
        var pill = $('partnerPill');
        if (pill && pill.hidden) {
          pill.textContent = tr('common.signedIn');
          pill.hidden = false;
        }
      });
  }

  /* THE FUNCTION EVERY SNAPSHOT ERROR PATH CALLED, AND WHICH DID NOT EXIST.

     All five branches below called snapshotError() and nothing anywhere
     declared it. So the dashboard, Stewardship and Activity — the three pages
     that load a snapshot — answered an expired session, a 403, a 500 or a
     dropped connection with a ReferenceError and an empty screen, instead of
     the message that had been carefully written for each case. The worst of
     them is the 401: the text says "Your session has expired, sign in again"
     and what you actually got was a page that looked broken.

     It renders MARKUP, which is why it is not just problem(). Those messages
     carry a sign-in link and a command to run, and problem() sets textContent
     on purpose so that nothing a server says can become HTML. Everything
     interpolated into the five callers goes through esc() first, so the markup
     here is ours rather than the server's — this is the one caller allowed to
     pass it. */
  function snapshotError(html) {
    problem('', loadSnapshot);
    if (!problemEl) return;
    problemEl.querySelector('.problem-msg').innerHTML = html;
  }

  function loadSnapshot() {
    /* Activity reads further back than the ten every other page carries. */
    var url = SNAPSHOT_URL + (page === 'activity' ? '?audit=300' : '');
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (body) { return { status: r.status, ok: r.ok, body: body }; });
      })
      .then(function (res) {
        // Before the branches: a 403 carries the banner too, and somebody
        // standing in an account with no partner still needs to be told whose
        // account they are standing in.
        noteActing(res.body);
        /* The nav filters from this, and Stewardship and Activity had no other
           source for it. Taken on the refusal path too: a 403 still says who
           you are, and the header should be right even when the page is not. */
        if (res.body && res.body.you && window.StaffIdentity) {
          window.StaffIdentity(res.body.you, res.body.partner);
        }
        if (res.ok) { renderSnapshot(res.body); wireStewardshipRows(); return; }

        if (res.status === 404) {
          // Almost always `netlify dev`, which serves the static build but not
          // the Worker routes. Blaming the database here would send someone
          // looking in entirely the wrong place.
          snapshotError('This server does not provide <code>' + esc(SNAPSHOT_URL) +
            '</code>. It is a Worker route — run <code>wrangler dev</code>, or ' +
            'point <code>SNAPSHOT_URL</code> at <code>/staff/data/snapshot.json</code> ' +
            'to work offline.');
        } else if (res.status === 401) {
          snapshotError('Your session has expired. ' +
            '<a href="/cdn-cgi/access/logout">Sign in again</a>.');
        } else if (res.status === 403) {
          /* THE SERVER'S OWN SENTENCE, not a guess made here.
             There are two different 403s — "not an active account" and "no
             partner yet" — and this branch used to print the second one for
             both, so an unconfirmed account was reported as a missing partner
             grant and the reader went looking in the wrong place. The server
             distinguishes them and says what to do about each; all this has
             to do is not throw that away. */
          snapshotError('Signed in as <b>' + esc(res.body.email || 'unknown') +
            '</b>. ' + esc(res.body.error ||
              'That address has no partner access yet.'));
        } else {
          snapshotError('The operations database did not answer (' + res.status + ')' +
            (res.body.error ? ' — ' + esc(res.body.error) : '') + '.');
        }
      })
      .catch(function (err) {
        snapshotError('Could not reach ' + esc(SNAPSHOT_URL) + ' — ' + esc(err.message) + '.');
      });
  }


  /* =====================================================================
     TOASTS — transient messages, bottom of the screen
     =====================================================================
     Replaces the inline status text each screen used to keep beside its
     controls. That text competed with the labels around it, moved the
     layout when it appeared, and was easy to miss when it sat next to a
     button you had already looked away from.

     One live region for the whole console, so a screen reader announces
     these the same way everywhere. aria-live="polite" rather than
     "assertive": a confirmation should not interrupt someone mid-sentence.

     Errors do NOT auto-dismiss. A success message is worth showing and not
     worth keeping; a failure is the one thing you may need to still be
     there when you look back.
     ===================================================================== */
  var toastHost = null;

  function toastRoot() {
    if (toastHost) return toastHost;
    toastHost = document.createElement('div');
    toastHost.className = 'toasts';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function toast(message, kind) {
    if (!message) return;
    /* Half the console says 'bad'/'good' for what the styles call 'err'/'ok'. */
    kind = { bad: 'err', good: 'ok' }[kind] || kind;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;

    if (kind === 'err') {
      var close = document.createElement('button');
      close.type = 'button';
      close.className = 'toast-x';
      close.setAttribute('aria-label', 'Dismiss');
      close.textContent = '\u00d7';
      close.addEventListener('click', function () { dismiss(el); });
      el.appendChild(close);
    }

    toastRoot().appendChild(el);
    // Force the browser to lay the element out in its starting state before
    // changing it. requestAnimationFrame alone can still coalesce with the
    // insert, and then there is nothing to transition FROM — the toast simply
    // appears. Reading offsetHeight makes the start state real.
    void el.offsetHeight;
    requestAnimationFrame(function () { el.classList.add('in'); });

    if (kind !== 'err') setTimeout(function () { dismiss(el); }, 3200);
    return el;
  }

  function dismiss(el) {
    if (!el || el.dataset.going) return;
    el.dataset.going = '1';
    el.classList.remove('in');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }

  // Shared with the per-page scripts, which load after this one.
  window.StaffToast = toast;

  /* =====================================================================
     PROBLEM BANNER — a condition, not an event
     =====================================================================
     Toasts are for things that HAPPENED. "The server cannot be reached" is
     a state that persists until something changes, and repeating it as a
     toast every time a request fails stacks identical messages that each
     have to be dismissed.

     This is one message that shows while the condition holds and goes away
     when it clears. Same toast styling, but pinned to the TOP so it is not
     mistaken for the transient ones stacking at the bottom, and overlaid
     rather than inserted into the flow — a banner that pushes the page down
     moves whatever someone is reading, then moves it back when the problem
     resolves.
     ===================================================================== */
  var problemEl = null;

  function problem(message, retry) {
    if (!problemEl) {
      problemEl = document.createElement('div');
      problemEl.className = 'toast warn problem-toast';
      problemEl.setAttribute('role', 'alert');
      /* A DISMISS BUTTON, because this toast does not go away on its own.
         "Try again" on a condition that needs an administrator just fails
         again, so an account with no partner grant got a banner it could not
         clear. A persistent message with no way out is a trap, however
         accurate it is. Same `.toast-x` the error toasts already use. */
      problemEl.innerHTML =
        '<span class="problem-msg"></span>' +
        '<button type="button" class="toast-act" data-i18n="err.tryAgain">Try again</button>' +
        '<button type="button" class="toast-x" aria-label="Dismiss">&times;</button>';
      problemEl.querySelector('.toast-x').onclick = problemClear;

      /* THE SAME STACK AS EVERY OTHER TOAST, at the bottom of the page.
         It used to have its own host pinned under the header, which put it
         across the navigation for a two-row account and left no way past it.
         Sharing the stack means one place for messages and no chance of one
         covering something.

         `order` rather than DOM position keeps it at the BOTTOM of that
         stack whatever arrives later: transient toasts are appended after it
         and would otherwise stack below, where this one — which does not time
         out — would sit on top of them. */
      toastRoot().appendChild(problemEl);
      if (window.StaffI18n) window.StaffI18n.apply(problemEl);
    }
    problemEl.querySelector('.problem-msg').textContent = message;

    var btn = problemEl.querySelector('.toast-act');
    btn.hidden = !retry;
    btn.onclick = retry || null;

    problemEl.hidden = false;
    void problemEl.offsetHeight;
    problemEl.classList.add('in');
  }

  function problemClear() {
    if (!problemEl) return;
    /* Hides THIS element, not the host — the host is now shared with every
       transient toast, and hiding it would take them all with it. */
    problemEl.classList.remove('in');
    setTimeout(function () { if (problemEl) problemEl.hidden = true; }, 260);
  }


  /* =====================================================================
     CONFIRM — a real dialog, not window.confirm
     =====================================================================
     window.confirm cannot say more than one sentence, cannot mark which
     button is the dangerous one, and looks like the browser rather than
     like this application. Granting somebody administration deserves a
     sentence about what that means before it happens.

     Returns a promise. Escape and the backdrop both cancel, because the
     safe answer should be the easy one to reach.
     ===================================================================== */
  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'dlg-back';
      wrap.innerHTML =
        '<div class="dlg" role="dialog" aria-modal="true">' +
          '<h3></h3><p class="dlg-body"></p>' +
          '<p class="dlg-note" hidden></p>' +
          '<label class="dlg-type" hidden><span></span>' +
            '<input type="text" autocomplete="off" spellcheck="false"></label>' +
          '<div class="dlg-actions">' +
            '<button type="button" class="ghost-btn dlg-no"></button>' +
            '<button type="button" class="solid-btn dlg-yes"></button>' +
          '</div>' +
        '</div>';
      wrap.querySelector('h3').textContent = opts.title || '';
      wrap.querySelector('.dlg-body').textContent = opts.body || '';
      if (opts.note) {
        var n = wrap.querySelector('.dlg-note');
        n.textContent = opts.note;
        n.hidden = false;
      }
      var yes = wrap.querySelector('.dlg-yes');
      var no = wrap.querySelector('.dlg-no');

      /* TYPE-TO-CONFIRM. For anything that destroys data somebody cannot get
         back. The button stays disabled until the word matches exactly, so
         the pause is real rather than decorative — and the word is checked
         again on the server, because a dialog is only a suggestion. */
      var typeField = null;
      if (opts.type) {
        var box = wrap.querySelector('.dlg-type');
        box.hidden = false;
        box.querySelector('span').textContent =
          (opts.typeLabel || 'Type') + ' ' + opts.type + ' to confirm';
        typeField = box.querySelector('input');
        typeField.placeholder = opts.type;
        yes.disabled = true;
        typeField.addEventListener('input', function () {
          yes.disabled = typeField.value.trim() !== opts.type;
        });
      }
      yes.textContent = opts.confirm || 'Confirm';
      no.textContent = opts.cancel || 'Cancel';
      if (opts.danger) yes.classList.add('is-danger');
      /* `only` makes it a NOTICE rather than a question: something has already
         happened and this says what to go and do about it. A Cancel button
         beside that reads as "undo", which it cannot do — so it is removed
         rather than relabeled. Escape and the backdrop still close it,
         because a dialog you cannot dismiss is a trap. */
      if (opts.only) no.remove();

      function close(answer) {
        document.removeEventListener('keydown', onKey);
        wrap.classList.remove('in');
        setTimeout(function () { wrap.remove(); }, 200);
        resolve(answer);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }

      yes.addEventListener('click', function () {
        if (typeField && typeField.value.trim() !== opts.type) return;
        close(true);
      });
      no.addEventListener('click', function () { close(false); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(false); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(wrap);
      void wrap.offsetHeight;
      wrap.classList.add('in');
      // Focus lands on CANCEL, or on the field when one has to be filled. A
      // dialog that opens with the destructive button focused turns a stray
      // Enter into the thing it was asking about.
      (typeField || no).focus();
    });
  }
  window.StaffConfirm = confirmDialog;

  /* =====================================================================
     PROMPT — a dialog that asks for one value
     =====================================================================
     Built on the same shell as StaffConfirm rather than beside it, so the two
     cannot drift apart in looks or behavior: Escape and the backdrop cancel,
     focus lands where typing goes, and the button that does the thing is on
     the right.

     window.prompt was the alternative. It cannot validate, cannot explain,
     looks like the browser rather than the application, and on some browsers
     is blocked entirely.

     VALIDATION IS LIVE AND THE MESSAGE IS SPECIFIC. "sl_SI is not a language
     code — use two letters" is actionable; a disabled button with no
     explanation is a puzzle. The same rule is enforced on the server, which
     is the one that counts.

     Resolves to the trimmed value, or null if canceled.
     ===================================================================== */
  function promptDialog(opts) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'dlg-back';
      wrap.innerHTML =
        '<div class="dlg" role="dialog" aria-modal="true">' +
          '<h3></h3><p class="dlg-body"></p>' +
          '<p class="dlg-note" hidden></p>' +
          '<label class="dlg-type"><span></span>' +
            '<input type="text" autocomplete="off" spellcheck="false" autocapitalize="off"></label>' +
          '<p class="dlg-err" hidden></p>' +
          '<div class="dlg-actions">' +
            '<button type="button" class="ghost-btn dlg-no"></button>' +
            '<button type="button" class="solid-btn dlg-yes"></button>' +
          '</div>' +
        '</div>';
      wrap.querySelector('h3').textContent = opts.title || '';
      wrap.querySelector('.dlg-body').textContent = opts.body || '';
      if (opts.note) {
        var n = wrap.querySelector('.dlg-note');
        n.textContent = opts.note;
        n.hidden = false;
      }
      var box = wrap.querySelector('.dlg-type');
      box.querySelector('span').textContent = opts.label || '';
      var input = box.querySelector('input');
      if (opts.placeholder) input.placeholder = opts.placeholder;

      var err = wrap.querySelector('.dlg-err');
      var yes = wrap.querySelector('.dlg-yes');
      var no = wrap.querySelector('.dlg-no');
      yes.textContent = opts.confirm || 'OK';
      no.textContent = opts.cancel || 'Cancel';
      yes.disabled = true;

      function validate() {
        var v = input.value.trim();
        var problem = v && opts.validate ? opts.validate(v) : (v ? null : '');
        yes.disabled = !!problem || !v;
        // Nothing typed yet is not a mistake, so it gets no error message.
        err.hidden = !problem || !v;
        if (problem && v) err.textContent = problem;
      }
      input.addEventListener('input', validate);

      function close(answer) {
        document.removeEventListener('keydown', onKey);
        wrap.classList.remove('in');
        setTimeout(function () { wrap.remove(); }, 200);
        resolve(answer);
      }
      function onKey(e) {
        if (e.key === 'Escape') close(null);
        // Enter submits, but only when the value is actually acceptable.
        if (e.key === 'Enter' && !yes.disabled && document.activeElement === input) {
          e.preventDefault();
          close(input.value.trim());
        }
      }
      yes.addEventListener('click', function () {
        if (!yes.disabled) close(input.value.trim());
      });
      no.addEventListener('click', function () { close(null); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) close(null); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(wrap);
      void wrap.offsetHeight;
      wrap.classList.add('in');
      // Focus the field, not a button: you opened this to type.
      input.focus();
    });
  }
  window.StaffPrompt = promptDialog;

  /* =====================================================================
     WHICH ONE AM I LOOKING AT
     =====================================================================
     Three consoles exist, they are pixel-identical, and each one reads a
     DIFFERENT database. On 2026-08-20 that cost an evening: the dev console
     was asked whether the database was up to date, answered "yes" — correctly,
     about its own database — and production was published past three unapplied
     migrations on the strength of it. Later the same night, production's admin
     pages were reported empty while every request in the log had gone to the
     Pi. Neither was a misreading of anything on screen, because there was
     nothing on screen to read.

     FROM THE HOSTNAME, NOT FROM THE API. This has to be right exactly when
     everything else is broken — an environment label that disappears when the
     server errors is missing at the only moment it matters. The hostname is
     already in the address bar and cannot fail to load.

     The mapping is checked against wrangler.toml by
     test/console-environment.test.mjs, so it cannot quietly drift from the
     bindings it claims to describe. */
  var ENVIRONMENTS = {
    'thauma.one':      { key: 'production', label: 'PRODUCTION', db: 'thauma-ops',
                         note: 'the live site' },
    'next.thauma.one': { key: 'staging',    label: 'STAGING',
                         db: 'thauma-ops-dev (in Cloudflare)',
                         note: 'preview only — nobody outside sees this' },
    /* ⚠ THE SAME NAME, A DIFFERENT DATABASE.
       dev and staging both bind `thauma-ops-dev` in wrangler.toml, but the Pi
       runs `wrangler dev --local`, so this one reads a SQLite FILE on that
       machine and never touches the Cloudflare database of that name. They can
       be twenty-two migrations apart while the console says the same word.

       Saying "thauma-ops-dev" here would be true and useless, so the label
       says where the data actually lives. */
    'dev.thauma.one':  { key: 'dev',        label: 'DEV',
                         db: 'a local copy on this Pi — not thauma-ops-dev in Cloudflare',
                         note: 'this Pi — not the live site' },
  };

  function showEnvironment() {
    var env = ENVIRONMENTS[location.hostname];
    /* An unknown host is worth saying out loud rather than staying silent:
       localhost, a tunnel, somebody's fork. "I do not know" is information. */
    if (!env) {
      env = { key: 'unknown', label: location.hostname.toUpperCase(),
              db: 'unknown', note: 'not a known Thauma address' };
    }

    var band = document.createElement('div');
    band.className = 'env-band env-' + env.key;
    band.setAttribute('role', 'note');
    band.innerHTML =
      '<b>' + esc(env.label) + '</b>' +
      '<span class="env-note">' + esc(env.note) + '</span>' +
      '<span class="env-db">database: <code>' + esc(env.db) + '</code></span>';

    var top = document.querySelector('.top');
    if (top && top.parentNode) top.parentNode.insertBefore(band, top);
    else document.body.insertBefore(band, document.body.firstChild);

    document.documentElement.classList.add('has-env-band');
  }

  showEnvironment();

  /* THE SEAM. Logging a contact from the supporter dialog changes what this
     table says about that person — that is the point of logging it — so the
     dialog reloads the snapshot rather than leaving the row showing the
     figure it just invalidated. */
  /* EDITING ⇄ REFERENCE (Chase, 2026-09-28: "Editing: Language" and
     "Reference: Language" with a swap button between them). One handler for
     every editor that has the pair — Pages, Forms, milestones, prayer, the
     form words on Sharing, the site's Resources and Events. It changes the
     two pickers the way a person would, so each editor's own handling runs:
     Editing first, then — once Editing has taken the new language, which on
     Pages waits for "discard unsaved changes?" — Reference. If Editing does
     not change (that question was answered No), nothing else does. */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-lang-swap]');
    if (!btn) return;
    var ref = btn.closest('.lang-ref');
    var edit = ref && ref.parentNode.querySelector('[data-lang-edit]');
    var refSel = ref && ref.querySelector('[data-lang-ref]');
    if (!edit || !refSel || !refSel.value) return;
    var was = edit.value, next = refSel.value;
    edit.value = next;
    edit.dispatchEvent(new Event('change', { bubbles: true }));
    var tries = 0;
    (function settle() {
      if (edit.value !== next) {
        if (++tries < 60) return setTimeout(settle, 50);
        return;
      }
      setTimeout(function () {
        if (![].some.call(refSel.options, function (o) { return o.value === was; })) return;
        refSel.value = was;
        refSel.dispatchEvent(new Event('change', { bubbles: true }));
      }, 0);
    })();
  });

  window.StaffSnapshotReload = loadSnapshot;
  window.StaffProblem = problem;
  window.StaffProblemClear = problemClear;


  /* =====================================================================
     BOOT — each page loads only what it needs
     ===================================================================== */

  // Pages that render snapshot-backed sections. /staff/directory/ and
  // /staff/resources/ are live-only, so they never fetch the snapshot. Home
  // needs the snapshot and /api/staff-home, not staff-data.
  var NEEDS_SNAPSHOT = ['index', 'stewardship', 'activity'];
  var NEEDS_STAFF_API = ['directory', 'resources'];

  var page = document.body.getAttribute('data-staff-page') || 'index';

  // Clear the cached identity on the way out, so the next person to use this
  // browser starts from nothing rather than from whoever was here last.
  /* Every sign-out link: the name menu's, and Settings' own. */
  Array.prototype.forEach.call(document.querySelectorAll('a[href*="access/logout"]'), function (signOut) {
    signOut.addEventListener('click', function () {
      try { sessionStorage.removeItem(IDENT); } catch (e) {}
    });
  });

  /* TABS, for any page that has them. Updates carries four sections and
     Settings carries three panels; both use the same markup, so the behavior
     belongs here rather than being written twice.

     Settings runs its own copy — it also rewrites the hash and is wired to its
     own load — so this bails out there rather than two handlers fighting over
     the same buttons. */
  (function wireTabs() {
    /* [data-tab]: the supporter dialog's own tabs (data-swtab) are not
       page tabs, and on Stewardship and Home they are the only ones. */
    var tabs = document.querySelectorAll('.tabs .tab[data-tab]');
    if (!tabs.length || page === 'settings') return;

    function show(name) {
      Array.prototype.forEach.call(tabs, function (b) {
        b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false');
      });
      Array.prototype.forEach.call(document.querySelectorAll('.tab-panel'), function (p) {
        p.hidden = p.dataset.panel !== name;
      });
      // Survives a reload, so returning to a section does not mean finding it.
      try { history.replaceState(null, '', '#' + name); } catch (e) {}
    }

    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () { show(b.dataset.tab); });
    });

    var wanted = (location.hash || '').slice(1);
    var known = Array.prototype.some.call(tabs, function (b) { return b.dataset.tab === wanted; });
    show(known ? wanted : tabs[0].dataset.tab);
  })();

  /* YOUR SITE (0044): beside Public site, once the ministry's own site is
     switched on. Asked once and kept for five minutes, so moving between
     pages does not ask again; nobody with no ministry sees it. */
  (function mySite() {
    var a = document.getElementById('consoleMySite');
    if (!a) return;
    function show(b) {
      if (b && b.enabled && b.address) { a.href = b.address; a.hidden = false; a.parentNode.classList.add('has-mysite'); }
    }
    try {
      var kept = JSON.parse(sessionStorage.getItem('thauma.mysite') || 'null');
      if (kept && Date.now() - kept.at < 300000) return show(kept.b);
    } catch (e) {}
    fetch('/api/staff-site?brief', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (b) {
        try { sessionStorage.setItem('thauma.mysite', JSON.stringify({ at: Date.now(), b: b })); } catch (e) {}
        show(b);
      }).catch(function () {});
  })();

  loadIdentity();
  if (NEEDS_SNAPSHOT.indexOf(page) !== -1) loadSnapshot();
  if (page === 'index') { wireHome(); loadHome(); }
  if (NEEDS_STAFF_API.indexOf(page) !== -1) {
    wireContactForm();
    wireResourceForm();
    loadStaffData();
  }
})();
