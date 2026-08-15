/* ============================================================
   staff.js — Thauma staff console
   ============================================================
   Two data sources, deliberately kept separate and labelled on
   screen:

     PROTOTYPE — dashboard, support, stewardship, activity.
       Reads /staff/data/snapshot.json, produced by
       db/build_snapshot.py running the real queries in
       db/queries.sql. Real query SHAPES, no live database.
       Pointing these at an endpoint later changes SNAPSHOT_URL
       and nothing else.

     LIVE — directory and resources.
       Reads/writes netlify/functions/staff-data.js, which
       verifies the CLOUDFLARE ACCESS token server-side and
       stores in Netlify Blobs.

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

  var SNAPSHOT_URL = '/staff/data/snapshot.json';
  var STAFF_API = '/.netlify/functions/staff-data';

  var CRIT_DAYS = 120;
  var WARN_DAYS = 60;

  var $ = function (id) { return document.getElementById(id); };
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
    if ($('genStamp')) $('genStamp').textContent = 'Snapshot generated ' + d.generated_at + '.';

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
      { k: 'Needs attention', v: stale,
        s: 'no personal contact in ' + d.stale_days + '+ days',
        cls: stale > 0 ? 'alert' : 'calm' },
      { k: 'Supporters', v: s.contacts_total, s: 'active records' },
      { k: 'Newsletter opt-in', v: s.newsletter_optin,
        s: 'of ' + s.contacts_total + ' — consent recorded separately' },
      { k: 'Personal touches', v: s.personal_last_30, s: 'in the last 30 days' }
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
    }).join('') || '<p class="empty">No contacts yet.</p>';

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
    }).join('') || '<p class="empty">No resources yet.</p>';
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
      if (res.status === 401 || res.status === 500) {
        if ($('roleNote')) $('roleNote').hidden = false;
        var why = res.status === 500 ? 'Access is not configured on this deploy.'
                                     : 'The token was refused.';
        if ($('contacts')) $('contacts').innerHTML = '<p class="empty">' + why + '</p>';
        if ($('resourceList')) $('resourceList').innerHTML = '<p class="empty">' + why + '</p>';
        return;
      }
      var data = await res.json();
      state.contacts = data.contacts || [];
      state.resources = data.resources || [];
      renderCards();
      showUpdated(data);
    } catch (e) {
      if ($('contacts')) {
        $('contacts').innerHTML = '<p class="empty">Could not load — ' + esc(e.message) + '</p>';
      }
    }
  }

  // Render the optimistic local state immediately, then persist. On any
  // failure, reload real server state so the UI never shows something that
  // did not actually save.
  async function saveData() {
    renderCards();
    setStatus('Saving…', false);
    try {
      var res = await fetch(STAFF_API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: state.contacts, resources: state.resources })
      });
      if (!res.ok) {
        var msg = 'Save failed (' + res.status + ')';
        try { var err = await res.json(); if (err && err.error) msg += ': ' + err.error; } catch (e) {}
        setStatus(msg, true);
        await loadStaffData();
        return;
      }
      var data = await res.json();
      state.contacts = data.contacts || [];
      state.resources = data.resources || [];
      renderCards();
      showUpdated(data);
    } catch (e) {
      setStatus('Save failed: ' + e.message, true);
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
      if (idx === '') state.contacts.push(entry); else state.contacts[idx] = entry;
      cForm.classList.remove('open'); cForm.reset();
      emails.innerHTML = ''; phones.innerHTML = '';
      saveData();
    });

    // event delegation — cards re-render on every save
    $('contacts').addEventListener('click', function (e) {
      if (e.target.dataset.editContact !== undefined) open(e.target.dataset.editContact);
      if (e.target.dataset.deleteContact !== undefined) {
        state.contacts.splice(Number(e.target.dataset.deleteContact), 1); saveData();
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
      if (idx === '') state.resources.push(entry); else state.resources[idx] = entry;
      rForm.classList.remove('open'); rForm.reset();
      saveData();
    });

    $('resourceList').addEventListener('click', function (e) {
      if (e.target.dataset.editResource !== undefined) open(e.target.dataset.editResource);
      if (e.target.dataset.deleteResource !== undefined) {
        state.resources.splice(Number(e.target.dataset.deleteResource), 1); saveData();
      }
    });
  }

  /* =====================================================================
     IDENTITY — supplied by Cloudflare Access, not managed here
     ===================================================================== */

  // Access exposes the signed-in user at this endpoint on any gated hostname.
  // Cosmetic only: authorisation already happened at the edge and is
  // re-verified server-side by the function.
  function loadIdentity() {
    return fetch('/cdn-cgi/access/get-identity', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (id) {
        if (!id) throw new Error('no identity');
        $('userName').textContent = id.name || id.email || 'Signed in';
        $('userRole').textContent = id.email && id.name ? id.email : 'Cloudflare Access';
      })
      .catch(function () {
        $('userName').textContent = 'Signed in';
        $('userRole').textContent = 'Cloudflare Access';
      });
  }

  function loadSnapshot() {
    return fetch(SNAPSHOT_URL, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('snapshot ' + r.status); return r.json(); })
      .then(function (d) { renderSnapshot(d); wireStewardshipRows(); })
      .catch(function (err) {
        var host = $('tiles') || $('goalGrid') || $('rows') || $('auditList');
        if (host) {
          host.innerHTML = '<p class="empty">Could not load ' + esc(SNAPSHOT_URL) + ' — ' +
            esc(err.message) + '. Run <code>python3 db/build_snapshot.py</code>.</p>';
        }
      });
  }

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
