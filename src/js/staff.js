/* ============================================================
   staff.js — Thauma staff console
   ============================================================
   Two data sources, deliberately kept separate:

     D1 — dashboard, support, stewardship, activity.
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
  var state = { contacts: [], resources: [] };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents, currency) {
    return (cents / 100).toLocaleString('en-US',
      { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 });
  }
  function fullName(c) {
    return [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  }
  function shortDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  /* severity carries a class AND a label, so the table never relies on
     colour alone to communicate state */
  function severity(days) {
    if (days === null || days === undefined) return { cls: 'none', label: 'never contacted' };
    if (days >= CRIT_DAYS) return { cls: 'crit', label: days + ' days' };
    if (days >= WARN_DAYS) return { cls: 'warn', label: days + ' days' };
    return { cls: 'ok', label: days + ' days' };
  }

  /* =====================================================================
     PROTOTYPE SECTIONS — snapshot.json
     ===================================================================== */

  // Each block is guarded: a page only has the elements it needs, and a
  // missing one means "not on this page", not "something broke".
  function renderSnapshot(d) {
    if ($('partnerPill')) {
      $('partnerPill').textContent = d.partner.display_name;
      $('partnerPill').hidden = false;
    }
    if ($('genStamp')) {
      var when = new Date(d.generated_at);
      $('genStamp').textContent = 'Live from the operations database · loaded ' +
        (isNaN(when) ? d.generated_at : when.toLocaleTimeString()) + '.';
    }

    var s = d.summary, stale = d.needs_attention.stale_count;

    // --- dashboard quick-links ---
    if ($('qStale')) $('qStale').textContent = stale;
    // NOTE: qContacts is the DIRECTORY count and comes from staff-data, not
    // from here. s.contacts_total is SUPPORTERS — a different thing with a
    // confusingly similar name, which is exactly why the two live on
    // separate pages.
    if ($('qGoal')) {
      var monthly = d.goals.filter(function (g) { return g.kind === 'monthly'; })[0];
      $('qGoal').textContent = monthly ? monthly.percent + '%' : '—';
    }

    // --- tiles ---
    if ($('tiles')) $('tiles').innerHTML = [
      { k: tr('dash.needsAttention'), v: stale,
        s: 'no personal contact in ' + d.stale_days + '+ days',
        cls: stale > 0 ? 'alert' : 'calm' },
      { k: tr('dash.supporters'), v: s.contacts_total, s: 'active records' },
      { k: tr('dash.newsletterOptin'), v: s.newsletter_optin,
        s: 'of ' + s.contacts_total + ' — consent recorded separately' },
      { k: tr('dash.personalTouches'), v: s.personal_last_30, s: 'in the last 30 days' }
    ].map(function (t) {
      return '<div class="tile ' + (t.cls || '') + '">' +
        '<span class="k">' + esc(t.k) + '</span>' +
        '<span class="v tnum">' + esc(t.v) + '</span>' +
        '<span class="s">' + esc(t.s) + '</span></div>';
    }).join('');

    // --- goals ---
    if ($('goalGrid')) $('goalGrid').innerHTML = d.goals.map(function (g) {
      var pct = g.percent == null ? 0 : g.percent;
      return '<div class="goal">' +
        '<div class="goal-t"><h3>' + esc(g.label) + '</h3>' +
        '<span class="kind">' + esc(g.kind.replace('_', ' ')) + '</span>' +
        '<span class="pct tnum">' + pct + '%</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="goal-f"><span class="tnum">' +
          money(g.raised_cents || 0, g.currency) + ' of ' + money(g.target_cents, g.currency) +
        '</span><span class="tnum">' + (g.donor_count == null ? '—' : g.donor_count) +
        ' donors</span></div></div>';
    }).join('');

    // --- stewardship table ---
    if ($('rows')) $('rows').innerHTML = d.contacts.map(function (c) {
      var sev = severity(c.days_since_personal);
      var where = [c.city, c.country].filter(Boolean).join(', ');
      return '<tr data-id="' + esc(c.id) + '" aria-expanded="false" tabindex="0">' +
        '<td><span class="nm">' + esc(fullName(c)) + '</span>' +
          (where ? '<span class="sub">' + esc(where) + '</span>' : '') + '</td>' +
        '<td><span class="sev ' + sev.cls + '">' + esc(sev.label) + '</span>' +
          '<span class="sub">' + esc(shortDate(c.last_personal_contact)) + '</span></td>' +
        '<td><span class="sub" style="color:var(--text)">' +
          esc(shortDate(c.last_contact_any)) + '</span></td>' +
        '<td><span class="chips">' +
          '<span class="chip' + (c.newsletter_consent ? ' on' : '') + '">email</span>' +
          '<span class="chip' + (c.postal_consent ? ' on' : '') + '">post</span>' +
        '</span></td>' +
        '<td class="right tnum">' + c.personal_count + ' / ' + c.interaction_count + '</td>' +
      '</tr>' +
      '<tr class="tl-row" data-for="' + esc(c.id) + '" hidden><td colspan="5">' +
        timelineHTML(d.timelines[c.id]) + '</td></tr>';
    }).join('');

    // --- activity ---
    if ($('auditList')) $('auditList').innerHTML = d.audit.map(function (a) {
      return '<div class="audit-r">' +
        '<span class="tnum">' + esc(a.at.replace('T', ' ').replace('Z', '')) + '</span>' +
        '<span><b>' + esc(a.action) + '</b></span>' +
        '<span>' + esc(a.entity) + (a.entity_id ? ' · ' + esc(a.entity_id) : '') +
          ' — ' + esc(a.actor || 'system') + '</span></div>';
    }).join('');
  }

  function timelineHTML(list) {
    if (!list || !list.length) {
      return '<div class="tl"><div class="ev"><span class="ev-d">—</span>' +
             '<span class="ev-m"><i></i></span><span class="ev-t">No interactions logged.</span></div></div>';
    }
    return '<div class="tl">' + list.map(function (i) {
      var personal = i.is_personal === 1;
      return '<div class="ev ' + (personal ? 'personal' : 'bulk') + '">' +
        '<span class="ev-d">' + esc(shortDate(i.occurred_on).toUpperCase()) + '</span>' +
        '<span class="ev-m"><i></i></span>' +
        '<span><span class="ev-t">' + esc(i.type.replace('_', ' ')) +
          (personal ? '' : '<span class="ev-tag">bulk</span>') +
          (i.logged_by_name ? '<span class="ev-tag">' + esc(i.logged_by_name) + '</span>' : '') +
        '</span>' +
        (i.note ? '<span class="ev-n">' + esc(i.note) + '</span>' : '') +
        '</span></div>';
    }).join('') + '</div>';
  }

  function wireStewardshipRows() {
    if (!$('rows')) return;
    function toggle(tr) {
      var drawer = document.querySelector('.tl-row[data-for="' + tr.getAttribute('data-id') + '"]');
      var open = tr.getAttribute('aria-expanded') === 'true';
      tr.setAttribute('aria-expanded', open ? 'false' : 'true');
      drawer.hidden = open;
    }
    $('rows').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]'); if (tr) toggle(tr);
    });
    $('rows').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest('tr[data-id]'); if (tr) { e.preventDefault(); toggle(tr); }
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
    if ($('qContacts')) $('qContacts').textContent = state.contacts.length;
    if ($('contacts')) $('contacts').innerHTML = state.contacts.map(function (c, i) {
      return '<div class="card">' +
        '<div class="card-actions">' +
          '<button type="button" data-edit-contact="' + i + '">Edit</button>' +
          '<button type="button" class="del" data-delete-contact="' + i + '">Delete</button></div>' +
        '<h4>' + esc(c.name) + '</h4>' +
        (c.role ? '<div class="role">' + esc(c.role) + '</div>' : '') +
        (c.emails || []).map(function (e) {
          return '<a class="lnk" href="mailto:' + esc(e) + '">' + esc(e) + '</a>'; }).join('') +
        (c.phones || []).map(function (p) {
          return '<a class="lnk" href="tel:' + esc(String(p).replace(/[^0-9+]/g, '')) + '">' +
                 esc(p) + '</a>'; }).join('') +
      '</div>';
    }).join('') || '<p class="empty">' + tr('dir.empty') + '</p>';

    if ($('resourceList')) $('resourceList').innerHTML = state.resources.map(function (r, i) {
      return '<div class="card">' +
        '<div class="card-actions">' +
          '<button type="button" data-edit-resource="' + i + '">Edit</button>' +
          '<button type="button" class="del" data-delete-resource="' + i + '">Delete</button></div>' +
        (r.photo ? '<div class="photo"><img src="' + esc(r.photo) + '" alt="" loading="lazy"></div>' : '') +
        '<h4>' + esc(r.title) + '</h4>' +
        (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
        (r.link ? '<a class="lnk" href="' + esc(r.link) + '" target="_blank" rel="noopener">Open →</a>' : '') +
      '</div>';
    }).join('') || '<p class="empty">' + tr('res.empty') + '</p>';
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
        var why = res.status === 500 ? tr('err.unreachable')
                : res.status === 403 ? tr('err.noPartner')
                : tr('err.expired');
        if ($('contacts')) $('contacts').innerHTML = '<p class="empty">' + esc(why) + '</p>';
        if ($('resourceList')) $('resourceList').innerHTML = '<p class="empty">' + esc(why) + '</p>';
        return;
      }
      if (body.you) rememberIdentity(body.you);
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

  // ---- repeatable email/phone rows ----
  function addRow(container, type, cls, value) {
    var row = document.createElement('div');
    row.className = 'frow';
    var input = document.createElement('input');
    input.type = type; input.className = cls; input.value = value || '';
    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'ghost-btn'; rm.textContent = 'Remove';
    rm.addEventListener('click', function () { row.remove(); });
    row.appendChild(input); row.appendChild(rm);
    container.appendChild(row);
  }

  function wireContactForm() {
    var cForm = $('contactForm');
    if (!cForm) return;
    var emails = $('contactEmails'), phones = $('contactPhones');

    $('addEmailRow').addEventListener('click', function () { addRow(emails, 'email', 'c-email', ''); });
    $('addPhoneRow').addEventListener('click', function () { addRow(phones, 'tel', 'c-phone', ''); });

    function open(index) {
      var c = (index === '' || index === undefined) ? {} : state.contacts[index];
      $('contactIndex').value = index === undefined ? '' : index;
      $('contactName').value = c.name || '';
      $('contactRole').value = c.role || '';
      emails.innerHTML = ''; phones.innerHTML = '';
      ((c.emails && c.emails.length) ? c.emails : ['']).forEach(function (v) {
        addRow(emails, 'email', 'c-email', v); });
      (c.phones || []).forEach(function (v) { addRow(phones, 'tel', 'c-phone', v); });
      cForm.classList.add('open');
    }
    $('addContactBtn').addEventListener('click', function () { open(''); });
    $('contactCancel').addEventListener('click', function () { cForm.classList.remove('open'); });

    cForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var idx = $('contactIndex').value;
      var entry = {
        name: $('contactName').value,
        role: $('contactRole').value,
        emails: Array.from(document.querySelectorAll('.c-email'))
                  .map(function (i) { return i.value.trim(); }).filter(Boolean),
        phones: Array.from(document.querySelectorAll('.c-phone'))
                  .map(function (i) { return i.value.trim(); }).filter(Boolean)
      };
      if (idx !== '') entry.id = state.contacts[idx] && state.contacts[idx].id;
      cForm.classList.remove('open'); cForm.reset();
      emails.innerHTML = ''; phones.innerHTML = '';
      saveItem('contact', entry);
    });

    // event delegation — cards re-render on every save
    $('contacts').addEventListener('click', function (e) {
      if (e.target.dataset.editContact !== undefined) open(e.target.dataset.editContact);
      if (e.target.dataset.deleteContact !== undefined) {
        var c = state.contacts[Number(e.target.dataset.deleteContact)];
        if (c && confirm('Delete "' + c.name + '"?')) deleteItem('contact', c.id);
      }
    });
  }

  function wireResourceForm() {
    var rForm = $('resourceForm');
    if (!rForm) return;

    function open(index) {
      var r = (index === '' || index === undefined) ? {} : state.resources[index];
      $('resourceIndex').value = index === undefined ? '' : index;
      $('resourceTitle').value = r.title || '';
      $('resourceDescription').value = r.description || '';
      $('resourceLink').value = r.link || '';
      $('resourcePhoto').value = r.photo || '';
      rForm.classList.add('open');
    }
    $('addResourceBtn').addEventListener('click', function () { open(''); });
    $('resourceCancel').addEventListener('click', function () { rForm.classList.remove('open'); });

    rForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var idx = $('resourceIndex').value;
      var entry = {
        title: $('resourceTitle').value,
        description: $('resourceDescription').value,
        link: $('resourceLink').value,
        photo: $('resourcePhoto').value
      };
      if (idx !== '') entry.id = state.resources[idx] && state.resources[idx].id;
      rForm.classList.remove('open'); rForm.reset();
      saveItem('resource', entry);
    });

    $('resourceList').addEventListener('click', function (e) {
      if (e.target.dataset.editResource !== undefined) open(e.target.dataset.editResource);
      if (e.target.dataset.deleteResource !== undefined) {
        var r = state.resources[Number(e.target.dataset.deleteResource)];
        if (r && confirm('Delete "' + r.title + '"?')) deleteItem('resource', r.id);
      }
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
  var IDENT = 'thauma.staff.who';

  function paintIdentity(who) {
    if (!who) return;
    if (who.name) $('userName').textContent = who.name;
    // The role sits under the name. The email is on Settings, where there is
    // room for it; up here it would be the longest thing in the header.
    var LABEL = { admin: 'Administration', staff: 'Staff', board: 'Board' };
    var roles = (who.roles || []).map(function (r) { return LABEL[r] || r; });
    if (roles.length) $('userRole').textContent = roles.join(' · ');
    $('userName').title = who.email || '';
  }

  /* Called by any page whose data included an identity block. */
  function rememberIdentity(who) {
    if (!who || !who.email) return;
    try { localStorage.setItem(IDENT, JSON.stringify(who)); } catch (e) {}
    paintIdentity(who);
  }
  window.StaffIdentity = rememberIdentity;

  function loadIdentity() {
    try {
      var cached = JSON.parse(localStorage.getItem(IDENT) || 'null');
      if (cached) paintIdentity(cached);
    } catch (e) {}

    return fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (id) {
        if (!id) throw new Error('no identity');
        // Only fills gaps — a name from our own records outranks whatever the
        // identity provider happens to carry.
        if (!$('userName').textContent || $('userName').textContent === '—') {
          $('userName').textContent = id.name || id.email || tr('common.signedIn');
        }
        if (!$('userRole').textContent || $('userRole').textContent === '—') {
          $('userRole').textContent = id.email && id.name ? id.email : 'Cloudflare Access';
        }
        $('userName').title = id.email || '';
      })
      .catch(function () {
        if (!$('userName').textContent || $('userName').textContent === '—') {
          $('userName').textContent = tr('common.signedIn');
          $('userRole').textContent = 'Cloudflare Access';
        }
      });
  }

  function loadSnapshot() {
    return fetch(SNAPSHOT_URL, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return {}; })
          .then(function (body) { return { status: r.status, ok: r.ok, body: body }; });
      })
      .then(function (res) {
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
          snapshotError('Signed in as <b>' + esc(res.body.email || 'unknown') +
            '</b>, but that address has no partner access yet.');
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
      problemEl.innerHTML =
        '<span class="problem-msg"></span>' +
        '<button type="button" class="toast-act" data-i18n="err.tryAgain">Try again</button>';

      var host = document.createElement('div');
      host.className = 'toasts toasts-top';
      host.appendChild(problemEl);
      document.body.appendChild(host);
      // Created after the initial sweep, so it needs translating on the spot.
      if (window.StaffI18n) window.StaffI18n.apply(host);
    }
    problemEl.querySelector('.problem-msg').textContent = message;

    var btn = problemEl.querySelector('.toast-act');
    btn.hidden = !retry;
    btn.onclick = retry || null;

    problemEl.parentNode.hidden = false;
    void problemEl.offsetHeight;
    problemEl.classList.add('in');
  }

  function problemClear() {
    if (!problemEl) return;
    problemEl.classList.remove('in');
    var host = problemEl.parentNode;
    setTimeout(function () { if (host) host.hidden = true; }, 260);
  }

  window.StaffProblem = problem;
  window.StaffProblemClear = problemClear;


  /* =====================================================================
     BOOT — each page loads only what it needs
     ===================================================================== */

  // Pages that render snapshot-backed sections. /staff/directory/ and
  // /staff/resources/ are live-only, so they never fetch the snapshot; the
  // dashboard needs both.
  var NEEDS_SNAPSHOT = ['index', 'support', 'stewardship', 'activity'];
  var NEEDS_STAFF_API = ['index', 'directory', 'resources'];

  var page = document.body.getAttribute('data-staff-page') || 'index';

  loadIdentity();
  if (NEEDS_SNAPSHOT.indexOf(page) !== -1) loadSnapshot();
  if (NEEDS_STAFF_API.indexOf(page) !== -1) {
    wireContactForm();
    wireResourceForm();
    loadStaffData();
  }
})();
