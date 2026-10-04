/* ============================================================
   activity.js — the record, in sentences (mockup board "Activity")
   ============================================================
   Both consoles' Activity pages. The log used to be printed as it is
   stored — "stewardship.open  contact · c_9e9f0f18…  — Chase Roush",
   with seconds and a Z — which is a database talking. Now each row is a
   sentence ("Chase Roush opened Ivana Babić's record"), grouped under
   its day, with the time beside it and the stored code kept small at the
   end for whoever needs to trace it.

   - The same sentence by the same person, one after another on one day,
     is one line: "· twice", "· 5 times".
   - Two filters, as on the board: who, and what kind — opening a record,
     changing something, publishing.
   - An action this file does not know yet still reads as a sentence:
     "{who} made a change", with its code beside it.

   THE NAMES COME FROM THE SERVER, and only where they may: a supporter's
   name reaches the owner alone (the snapshot drops it for anybody else,
   and the administrators' log never carries it), so a record opened by
   somebody else reads "a supporter's record".

   window.ConsoleActivity.render(host, rows, { where: bool })
   `where` adds the ministry to each line — the administrators' log is
   every ministry's.
   ============================================================ */
(function () {
  'use strict';

  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function fill(k, vars) {
    if (window.StaffI18n && window.StaffI18n.fill) return window.StaffI18n.fill(k, vars);
    var s = tr(k);
    Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  }
  function lang() { return (window.StaffI18n && window.StaffI18n.lang) || 'en'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* action → sentence. Checked first by action alone, then by
     action/entity for the generic verbs every handler shares. */
  var BY_ACTION = {
    'stewardship.open': 'act.open',
    'stewardship.person.add': 'act.personAdd',
    'stewardship.person.edit': 'act.personEdit',
    'stewardship.person.delete': 'act.personDelete',
    'stewardship.interaction': 'act.touch',
    'stewardship.interaction.edit': 'act.touchEdit',
    'stewardship.interaction.delete': 'act.touchDelete',
    'stewardship.event.add': 'act.eventAdd',
    'stewardship.event.edit': 'act.eventEdit',
    'stewardship.event.delete': 'act.eventDelete',
    'videos.source': 'act.videoSource',
    'videos.clear': 'act.videoClear',
    'actas.start': 'act.asStart',
    'actas.stop': 'act.asStop',
    'actas.change': 'act.asChange',
    'release.preview': 'act.preview',
    'release.publish': 'act.publish',
    'content.commit': 'act.words',
    'content.add_language': 'act.langAdd',
    'content.remove_language': 'act.langRemove',
    'translate.apply': 'act.translations',
    'media.upload': 'act.photo',
    'media.cleanup': 'act.storageClean',
    'profile.publish': 'act.teamUp',
    'profile.unpublish': 'act.teamDown',
    'migration.apply': 'act.migrate',
    'migration.baseline': 'act.migrateMark',
    'migration.failed': 'act.migrateFailed',
  };
  var BY_PAIR = {
    'read/goals': 'act.readGoals',
    'update/contacts': 'act.personEdit',
    'update/partner.embed': 'act.look',
    'update/partner.timeline': 'act.timeline',
    'enable/partner_language': 'act.langOn',
    'disable/partner_language': 'act.langOff',
    'update/partner.default_lang': 'act.defaultLang',
    'update/user.preferred_lang': 'act.ownLang',
    'create/api_key': 'act.keyMade',
    'update/api_key': 'act.keyChanged',
    'revoke/api_key': 'act.keyRevoked',
    'create/partner': 'act.ministryAdd',
    'update/partner': 'act.ministryEdit',
    'delete/partner': 'act.ministryDelete',
    'create/user': 'act.userAdd',
    'invite/user': 'act.userInvite',
    'update/user': 'act.userEdit',
    'delete/user': 'act.userDelete',
    'grant/user_role': 'act.roleGive',
    'revoke/user_role': 'act.roleTake',
    'grant/partner_access': 'act.accessGive',
    'revoke/partner_access': 'act.accessTake',
    'create/sender_address': 'act.sendersAdd',
    'delete/sender_address': 'act.sendersDelete',
  };

  function keyFor(a) {
    if (BY_ACTION[a.action]) return BY_ACTION[a.action];
    var pair = BY_PAIR[a.action + '/' + a.entity];
    if (pair) return pair;
    if (/^subscribers\./.test(a.action)) return 'act.subscribers';
    if (/^site_/.test(a.entity || '')) return 'act.library';
    if (a.entity === 'translation_notes') return 'act.notes';
    return 'act.other';
  }

  /* Which filter a row falls under. */
  function kindOf(a) {
    if (a.action === 'stewardship.open' || a.action === 'read') return 'open';
    if (/^release\./.test(a.action) || /^profile\./.test(a.action)) return 'publish';
    return 'change';
  }

  function detailOf(a) {
    if (a.detail && typeof a.detail === 'object') return a.detail;
    try { return JSON.parse(a.detail || 'null') || {}; } catch (e) { return {}; }
  }
  function langName(code) {
    if (!code) return '';
    try { return new Intl.DisplayNames([lang(), 'en'], { type: 'language' }).of(code) || code; }
    catch (e) { return code; }
  }

  /* The sentence, as HTML: {who} bold, everything else escaped. */
  function sentence(a) {
    var d = detailOf(a);
    var vars = {
      name: a.contact_name && a.contact_name.trim() ? a.contact_name.trim() : tr('act.aSupporter'),
      target: a.target_name || d.as || d.name || d.email || tr('act.someone'),
      lang: langName(a.entity === 'partner_language' ? a.entity_id : d.code),
      role: d.role ? tr('role.' + d.role) : '',
    };
    var text = esc(tr(keyFor(a)));
    Object.keys(vars).forEach(function (k) { text = text.split('{' + k + '}').join(esc(vars[k])); });
    return text.split('{who}').join('<b class="act-who">' + esc(a.actor || tr('act.system')) + '</b>');
  }

  function dayOf(at) {
    var d = new Date(at);
    if (isNaN(d)) return String(at || '').slice(0, 10);
    var opts = { weekday: 'long', day: 'numeric', month: 'long' };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    try { return d.toLocaleDateString(lang(), opts); } catch (e) { return d.toDateString(); }
  }
  function timeOf(at) {
    var d = new Date(at);
    if (isNaN(d)) return '';
    try { return d.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
    catch (e) { return d.toTimeString().slice(0, 5); }
  }
  function code(a) {
    var id = a.entity_id ? String(a.entity_id) : '';
    if (id.length > 12) id = id.slice(0, 12) + '…';
    return a.action + (id ? ' · ' + id : '');
  }
  function times(n) {
    return n === 2 ? tr('act.twice') : fill('act.times', { n: n });
  }

  /* Rows in, days out: each a heading and its lines, repeats folded. */
  function group(rows, opts) {
    var days = [];
    rows.forEach(function (a) {
      var day = dayOf(a.at);
      var last = days[days.length - 1];
      if (!last || last.day !== day) days.push(last = { day: day, lines: [] });
      var s = sentence(a);
      var where = opts.where && a.partner_name ? a.partner_name : '';
      var prev = last.lines[last.lines.length - 1];
      if (prev && prev.html === s && prev.where === where) { prev.n++; return; }
      last.lines.push({ html: s, where: where, at: a.at, code: code(a), n: 1 });
    });
    return days;
  }

  function render(host, rows, opts) {
    opts = opts || {};
    rows = rows || [];
    var state = host._activity || (host._activity = { who: '', kind: '' });

    var people = [];
    rows.forEach(function (a) {
      var who = a.actor || tr('act.system');
      if (people.indexOf(who) === -1) people.push(who);
    });
    people.sort(function (x, y) { return x.localeCompare(y, lang()); });
    if (people.indexOf(state.who) === -1) state.who = '';

    var shown = rows.filter(function (a) {
      return (!state.who || (a.actor || tr('act.system')) === state.who) &&
             (!state.kind || kindOf(a) === state.kind);
    });

    var opt = function (v, label, on) {
      return '<option value="' + esc(v) + '"' + (on ? ' selected' : '') + '>' + esc(label) + '</option>';
    };
    /* THE FILTERS SIT BESIDE THE HEADING, as on the board, in the page's
       head where there is one. Built once and kept, so a change of filter
       does not rebuild the control being used. */
    var bar = host._activityBar;
    if (!bar) {
      bar = host._activityBar = document.createElement('div');
      bar.className = 'act-bar';
      var head = document.querySelector('.page-head');
      if (head) { head.classList.add('has-act'); head.appendChild(bar); }
      else host.parentNode.insertBefore(bar, host);
      bar.addEventListener('change', function (e) {
        var sel = e.target.closest && e.target.closest('[data-act]');
        if (!sel) return;
        host._activity[sel.getAttribute('data-act')] = sel.value;
        render(host, host._activityRows, host._activityOpts);
      });
    }
    bar.hidden = !rows.length;
    bar.innerHTML =
      '<select class="act-sel" data-act="who" aria-label="' + esc(tr('act.person')) + '">' +
        opt('', tr('act.everyone'), !state.who) +
        people.map(function (p) { return opt(p, p, p === state.who); }).join('') +
      '</select>' +
      '<select class="act-sel" data-act="kind" aria-label="' + esc(tr('act.kind')) + '">' +
        opt('', tr('act.everything'), !state.kind) +
        ['open', 'change', 'publish'].map(function (k) {
          return opt(k, tr('act.kind.' + k), k === state.kind);
        }).join('') +
      '</select>';

    var days = group(shown, opts);
    host.innerHTML = days.map(function (g) {
      return '<h2 class="act-day">' + esc(g.day) + '</h2><div class="act-card">' +
        g.lines.map(function (l) {
          return '<div class="act-e"><span class="act-t tnum">' + esc(timeOf(l.at)) + '</span>' +
            '<span class="act-s">' + l.html +
              (l.n > 1 ? ' <span class="act-n">· ' + esc(times(l.n)) + '</span>' : '') +
              (l.where ? ' <span class="act-n">· ' + esc(l.where) + '</span>' : '') +
            '</span>' +
            '<span class="act-code">' + esc(l.code) + '</span></div>';
        }).join('') + '</div>';
    }).join('') ||
      '<p class="empty">' + esc(tr(rows.length ? 'act.noneMatch' : 'adm.noAudit')) + '</p>';
    host._activityRows = rows;
    host._activityOpts = opts;
  }

  window.ConsoleActivity = { render: render, sentence: sentence, kindOf: kindOf };
})();
