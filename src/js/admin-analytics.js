/* ============================================================
   admin-analytics.js — the Overview's "How the sites are visited"
   ============================================================
   Chase, 2026-10-13: "On the admin homepage, can we add an analytics
   section for the site as well? Complete with visit numbers graph and a map
   that shows where they visited from. Or some cool stuff like that. And
   maybe a few basic filters."

   Numbers from /api/admin/analytics (workers/src/analytics.js), counted
   without knowing who: a visit is a browser tab, no cookie, no address.
   Filters: the period, which site, and whether dev and previews count.
   The graph is drawn here as SVG; the map is src/img/world.svg (Natural
   Earth, one shape per country by its two-letter code), shaded by visits,
   each country named in the reader's language on hover.
   ============================================================ */
(function () {
  'use strict';
  var box = document.getElementById('an');
  if (!box) return;
  var $ = function (id) { return document.getElementById(id); };
  var tr = function (k) { return (window.StaffI18n && window.StaffI18n.t(k)) || k; };
  var fill = function (k, v) { return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(k, v) : tr(k); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var lang = function () { return (window.StaffI18n && window.StaffI18n.lang) || 'en'; };
  var num = function (n) { try { return new Intl.NumberFormat(lang()).format(n || 0); } catch (e) { return String(n || 0); } };
  var region = function (c) {
    try { return new Intl.DisplayNames([lang()], { type: 'region' }).of(c) || c; } catch (e) { return c; }
  };
  var tongue = function (c) {
    try { return new Intl.DisplayNames([lang()], { type: 'language' }).of(c) || c; } catch (e) { return c; }
  };

  var ui = { days: 30, site: 'thauma', test: false };
  try { var kept = JSON.parse(localStorage.getItem('th-an') || 'null'); if (kept) ui = Object.assign(ui, kept); } catch (e) {}
  var data = null, mapReady = null;

  async function load() {
    try { localStorage.setItem('th-an', JSON.stringify(ui)); } catch (e) {}
    marks();
    var q = '?days=' + ui.days + '&site=' + encodeURIComponent(ui.site === 'all' ? '' : ui.site) + '&live=' + (ui.test ? 0 : 1);
    try {
      var res = await fetch('/api/admin/analytics' + q, { credentials: 'same-origin', cache: 'no-store' });
      var body = await res.json().catch(function () { return {}; });
      if (res.status === 403) { box.hidden = true; return; }
      if (!res.ok) throw new Error(body.error || tr('err.refused'));
      data = body;
    } catch (e) {
      $('anNote').hidden = false; $('anNote').textContent = e.message; $('anBody').hidden = true; return;
    }
    draw();
  }

  function marks() {
    [].forEach.call(box.querySelectorAll('[data-an-days]'), function (b) {
      var on = +b.getAttribute('data-an-days') === ui.days;
      b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('anTest').checked = ui.test;
  }

  function sites() {
    var opts = [['thauma', 'thauma.one'], ['all', tr('an.allSites')]].concat((data.sites || []).map(function (s) {
      return [s.id, s.name + ' · ' + s.sub + '.thauma.one']; }));
    if (!opts.some(function (o) { return o[0] === ui.site; })) ui.site = 'thauma';
    $('anSite').innerHTML = opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (o[0] === ui.site ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }

  function draw() {
    sites();
    if (data.missing) {
      $('anNote').hidden = false; $('anNote').textContent = tr('an.missing'); $('anBody').hidden = true; return;
    }
    $('anBody').hidden = false;
    var t = data.totals || {};
    $('anNote').hidden = !!t.visits;
    $('anNote').textContent = t.visits ? '' : tr('an.none');
    var change = function (now, before) {
      if (!before) return '';
      var p = Math.round((now - before) / before * 100);
      return '<span class="an-chg ' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '+' : '') + p + '%</span>';
    };
    $('anNums').innerHTML = [
      [tr('an.visits'), num(t.visits), change(t.visits, t.prev_visits)],
      [tr('an.views'), num(t.views), change(t.views, t.prev_views)],
      [tr('an.perVisit'), t.visits ? (t.views / t.visits).toFixed(1) : '0', ''],
      [tr('an.countries'), num((data.country || []).filter(function (r) { return r.k; }).length), '']
    ].map(function (n) {
      return '<div class="an-num"><span class="k">' + esc(n[0]) + '</span><span class="v tnum">' + n[1] + '</span>' + n[2] + '</div>';
    }).join('');
    chart();
    map();
    list('anCountries', tr('an.where'), (data.country || []).slice(0, 10), function (k) { return k ? region(k) : tr('an.unknown'); });
    list('anPages', tr('an.pages'), data.path || [], function (k) { return k; }, 'views');
    list('anRefs', tr('an.from'), data.referrer || [], function (k) { return k || tr('an.direct'); });
    list('anDevices', tr('an.devices'), data.device || [], function (k) { return tr('an.device.' + (k || 'unknown')); });
    list('anLangs', tr('an.langs'), data.lang || [], function (k) { return k ? tongue(k) : tr('an.unknown'); });
  }

  function list(id, title, rows, name, by) {
    var key = by || 'visits';
    var top = rows.reduce(function (m, r) { return Math.max(m, r[key] || 0); }, 0) || 1;
    $(id).innerHTML = '<span class="an-lbl">' + esc(title) + '</span>' + (rows.length ? '<ol>' + rows.map(function (r) {
      return '<li><span class="an-bar" style="width:' + Math.max(2, Math.round((r[key] || 0) / top * 100)) + '%"></span>' +
        '<span class="an-k">' + esc(name(r.k)) + '</span><span class="an-v tnum">' + num(r[key]) + '</span></li>';
    }).join('') + '</ol>' : '<p class="an-empty">—</p>');
  }

  /* Visits per day as a line over a soft area, pages seen as faint bars;
     every day of the period present, a quiet day as zero. */
  function chart() {
    var days = [], byDay = {};
    (data.by_day || []).forEach(function (d) { byDay[d.day] = d; });
    for (var i = data.days - 1; i >= 0; i--) {
      var d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days.push({ day: d, visits: (byDay[d] || {}).visits || 0, views: (byDay[d] || {}).views || 0 });
    }
    var W = 1000, H = 220, P = 28, max = Math.max(4, days.reduce(function (m, d) { return Math.max(m, d.views); }, 0));
    var x = function (i) { return P + (W - 2 * P) * (days.length === 1 ? 0.5 : i / (days.length - 1)); };
    var y = function (v) { return H - P - (H - 2 * P) * v / max; };
    var bw = Math.max(1, (W - 2 * P) / days.length * 0.6);
    var line = days.map(function (d, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(d.visits).toFixed(1); }).join('');
    var area = line + 'L' + x(days.length - 1).toFixed(1) + ',' + (H - P) + 'L' + x(0).toFixed(1) + ',' + (H - P) + 'Z';
    var fmt = function (s) { try { return new Date(s + 'T12:00:00Z').toLocaleDateString(lang(), { month: 'short', day: 'numeric' }); } catch (e) { return s; } };
    var ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
    $('anChart').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(tr('an.chart')) + '" preserveAspectRatio="none">' +
      [0.25, 0.5, 0.75, 1].map(function (f) { return '<line class="an-grid" x1="' + P + '" x2="' + (W - P) + '" y1="' + y(max * f) + '" y2="' + y(max * f) + '"/>'; }).join('') +
      days.map(function (d, i) { return '<rect class="an-views" x="' + (x(i) - bw / 2).toFixed(1) + '" y="' + y(d.views).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - P - y(d.views)).toFixed(1) + '"><title>' + esc(fmt(d.day) + ' · ' + fill('an.tip', { v: d.visits, p: d.views })) + '</title></rect>'; }).join('') +
      '<path class="an-area" d="' + area + '"/><path class="an-line" d="' + line + '" vector-effect="non-scaling-stroke"/>' +
      '</svg><div class="an-axis">' + ticks.map(function (i) { return '<span>' + esc(fmt(days[i].day)) + '</span>'; }).join('') + '</div>' +
      '<div class="an-key"><span class="an-key-v">' + esc(tr('an.visits')) + '</span><span class="an-key-p">' + esc(tr('an.views')) + '</span></div>';
  }

  /* The world, shaded by visits; drawn once, recolored on each load. */
  function map() {
    if (!mapReady) {
      mapReady = fetch('/img/world.svg').then(function (r) { return r.text(); }).then(function (svg) {
        $('anMap').innerHTML = svg;
        var tip = document.createElement('span'); tip.className = 'an-tip'; tip.hidden = true; $('anMap').appendChild(tip);
        $('anMap').addEventListener('pointermove', function (e) {
          var p = e.target.closest && e.target.closest('path[data-c]');
          if (!p) { tip.hidden = true; return; }
          var c = p.getAttribute('data-c'), r = $('anMap').getBoundingClientRect();
          tip.textContent = region(c) + ' · ' + num(p.getAttribute('data-n') || 0);
          tip.style.left = (e.clientX - r.left + 12) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px';
          tip.hidden = false;
        });
        $('anMap').addEventListener('pointerleave', function () { tip.hidden = true; });
      }).catch(function () { $('anMap').hidden = true; });
    }
    mapReady.then(function () {
      var by = {}, top = 0;
      (data.country || []).forEach(function (r) { if (r.k) { by[r.k] = r.visits; top = Math.max(top, r.visits); } });
      [].forEach.call($('anMap').querySelectorAll('path[data-c]'), function (p) {
        var n = by[p.getAttribute('data-c')] || 0;
        p.setAttribute('data-n', n);
        p.style.setProperty('--an-s', n ? (0.25 + 0.75 * Math.sqrt(n / top)).toFixed(2) : 0);
        p.classList.toggle('has', !!n);
      });
    });
  }

  box.addEventListener('click', function (e) {
    var d = e.target.closest('[data-an-days]');
    if (d) { ui.days = +d.getAttribute('data-an-days'); load(); }
  });
  $('anSite').addEventListener('change', function () { ui.site = this.value; load(); });
  $('anTest').addEventListener('change', function () { ui.test = this.checked; load(); });
  load();
})();
