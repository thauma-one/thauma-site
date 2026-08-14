/* ============================================================
   ops.js — Thauma operations console (prototype renderer)
   ============================================================
   Reads a snapshot produced by db/build_snapshot.py, which runs
   the real queries in db/queries.sql. The rendering below is
   written against those query SHAPES, so pointing this at a live
   endpoint later is a change to DATA_URL and nothing else.

   Deliberately no framework and no build step: this has to run
   inside Eleventy's passthrough copy with zero tooling.
   ============================================================ */
(function () {
  'use strict';

  var DATA_URL = '/ops/data/snapshot.json';

  // Thresholds for "how overdue is this person". Mirrors stale_days in
  // the snapshot; the amber band is a UI concern only.
  var CRIT_DAYS = 120;
  var WARN_DAYS = 60;

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(cents, currency) {
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0
    });
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

  /* severity is returned as a class AND a label so the table never relies
     on colour alone to communicate state */
  function severity(days) {
    if (days === null || days === undefined) return { cls: 'none', label: 'never contacted' };
    if (days >= CRIT_DAYS) return { cls: 'crit', label: days + ' days' };
    if (days >= WARN_DAYS) return { cls: 'warn', label: days + ' days' };
    return { cls: 'ok', label: days + ' days' };
  }

  // ---------------------------------------------------------------- render --

  function renderHeader(d) {
    $('partnerPill').textContent = d.partner.display_name;
    $('userName').textContent = 'Chase Roush';
    $('userRole').textContent = 'owner · ' + d.partner.slug;
    $('asOf').textContent = 'as of ' + shortDate(d.as_of);
    $('genStamp').textContent = 'Generated ' + d.generated_at + '.';
  }

  function renderTiles(d) {
    var s = d.summary, stale = d.needs_attention.stale_count;
    var tiles = [
      {
        k: 'Needs attention', v: stale,
        s: 'no personal contact in ' + d.stale_days + '+ days',
        cls: stale > 0 ? 'alert' : 'calm'
      },
      { k: 'Contacts', v: s.contacts_total, s: 'active records' },
      { k: 'Newsletter opt-in', v: s.newsletter_optin,
        s: 'of ' + s.contacts_total + ' — consent recorded separately' },
      { k: 'Personal touches', v: s.personal_last_30, s: 'in the last 30 days' }
    ];
    $('tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile ' + (t.cls || '') + '">' +
        '<span class="k">' + esc(t.k) + '</span>' +
        '<span class="v tnum">' + esc(t.v) + '</span>' +
        '<span class="s">' + esc(t.s) + '</span></div>';
    }).join('');
  }

  function renderGoals(d) {
    if (!d.goals.length) { $('goalGrid').innerHTML = ''; return; }
    $('goalGrid').innerHTML = d.goals.map(function (g) {
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
  }

  function renderTimeline(list) {
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

  function renderContacts(d) {
    var html = '';
    d.contacts.forEach(function (c) {
      var sev = severity(c.days_since_personal);
      var where = [c.city, c.country].filter(Boolean).join(', ');
      html +=
        '<tr data-id="' + esc(c.id) + '" aria-expanded="false" tabindex="0">' +
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
          renderTimeline(d.timelines[c.id]) + '</td></tr>';
    });
    $('rows').innerHTML = html;

    function toggle(tr) {
      var id = tr.getAttribute('data-id');
      var drawer = document.querySelector('.tl-row[data-for="' + id + '"]');
      var open = tr.getAttribute('aria-expanded') === 'true';
      tr.setAttribute('aria-expanded', open ? 'false' : 'true');
      drawer.hidden = open;
    }
    $('rows').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-id]');
      if (tr) toggle(tr);
    });
    $('rows').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest('tr[data-id]');
      if (tr) { e.preventDefault(); toggle(tr); }
    });
  }

  function renderAudit(d) {
    if (!d.audit.length) { $('auditList').innerHTML = ''; return; }
    $('auditList').innerHTML = d.audit.map(function (a) {
      return '<div class="audit-r">' +
        '<span class="tnum">' + esc(a.at.replace('T', ' ').replace('Z', '')) + '</span>' +
        '<span><b>' + esc(a.action) + '</b></span>' +
        '<span>' + esc(a.entity) + (a.entity_id ? ' · ' + esc(a.entity_id) : '') +
          ' — ' + esc(a.actor || 'system') + '</span></div>';
    }).join('');
  }

  // ------------------------------------------------------------------ boot --

  fetch(DATA_URL, { cache: 'no-store' })
    .then(function (r) {
      if (!r.ok) throw new Error('snapshot ' + r.status);
      return r.json();
    })
    .then(function (d) {
      renderHeader(d);
      renderTiles(d);
      renderGoals(d);
      renderContacts(d);
      renderAudit(d);
    })
    .catch(function (err) {
      document.querySelector('main').insertAdjacentHTML('afterbegin',
        '<div class="note" style="border-left-color:var(--voice-tech)"><b>Could not load ' +
        esc(DATA_URL) + '</b> — ' + esc(err.message) +
        '. Run <code>python3 db/build_snapshot.py</code> from the repo root.</div>');
    });
})();
