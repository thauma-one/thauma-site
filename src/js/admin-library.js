/* admin-library.js — the site's collections, edited in place
   =========================================================================
   Two collections, one screen, one code path. A resource and a gathering
   differ in their fields and in nothing else: both are one item in one file,
   both are created, edited, and removed the same way, and both are published
   in whatever language exists at the time. So the shape of an item is
   DESCRIBED below and rendered from that description, rather than written
   twice and kept in step by hand.

   That is not tidiness. The two collections were specified together and will
   grow together — a third is expected — and every place this project has kept
   two parallel lists of the same thing by hand, one of them has drifted: the
   mailing views, the run_worker_first blocks, the protected account's roles.

   THE VISUALS OF THE PUBLIC PAGES ARE NOT DECIDED and nothing here assumes
   them. This edits the data; how a gathering is presented to a visitor is a
   later pass and can change completely without touching this file.
   ========================================================================= */
(function () {
  'use strict';

  var API = '/api/admin/library';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  /* THE KEY IS NOT A TRANSLATION. StaffI18n.t is `tOr`, which returns the key
     itself when it has no entry — a sensible last resort for a title
     attribute, and useless as a fallback test, because `||` never fires and
     the screen shows "lib.empty" where a sentence belongs. */
  var tr = function (k, fallback) {
    var got = window.StaffI18n && window.StaffI18n.t && window.StaffI18n.t(k);
    return (got && got !== k) ? got : fallback;
  };
  var toast = function (m, kind) { if (window.StaffToast) window.StaffToast(m, kind); };

  var LANGS = (function () {
    try { return JSON.parse(($('libLangs') || {}).textContent || '[]'); }
    catch (e) { return ['en']; }
  })();

  var state = { resources: [], gatherings: [], vocabulary: {}, open: null, limit: 40 };

  /* WHAT AN ITEM IS MADE OF. `when` decides whether a field applies to this
     particular item — a location belongs to a one-off gathering and a session
     list belongs to a cohort, and showing both to both is how a form starts
     asking questions that do not apply. */
  var FIELDS = {
    resources: [
      { name: 'moment', kind: 'choice', label: 'Which moment', vocab: 'moment',
        hint: 'What is the person doing when they need this? Crisis is something ' +
              'broken now; growth is learning with time; planning is deciding what ' +
              'to buy; lookup is the glossary.' },
      { name: 'format', kind: 'choice', label: 'Format', vocab: 'format',
        hint: 'Crisis material is better as text and diagrams — panic has no ' +
              'patience for a video.' },
      { name: 'symptoms', kind: 'tags', label: 'Symptoms',
        when: function (it) { return it.moment === 'crisis'; },
        hint: 'What somebody would actually say out loud: "no sound", "one ' +
              'channel dead". The one place an open vocabulary earns itself.' },
      { name: 'pinned', kind: 'flag', label: 'Keep at the top',
        hint: 'For material everything else refers to — the glossary — so newer ' +
              'items do not bury it.' },
      { name: 'link', kind: 'text', label: 'Link (optional)' },
      { name: 'photo', kind: 'text', label: 'Photo path (optional)' }
    ],
    gatherings: [
      { name: 'type', kind: 'choice', label: 'Kind', vocab: 'type',
        hint: 'A gathering happens once. A cohort runs over several sessions.' },
      { name: 'status', kind: 'choice', label: 'Status', vocab: 'status',
        hint: 'Set deliberately, never worked out from the date — a canceled ' +
              'gathering is not "upcoming" because its date has not passed yet.' },
      { name: 'date', kind: 'text', label: 'Date', placeholder: '2027-03-14',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'time', kind: 'text', label: 'Time', placeholder: '10:00',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'location', kind: 'text', label: 'Where',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'cohort_name', kind: 'text', label: 'Cohort name',
        placeholder: 'Cohort 1', when: function (it) { return it.type === 'cohort'; } },
      { name: 'capacity', kind: 'text', label: 'Places',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'application_required', kind: 'flag', label: 'Application needed',
        when: function (it) { return it.type === 'cohort'; },
        hint: 'Off means anybody can register. On means you decide who joins.' },
      { name: 'sessions', kind: 'sessions', label: 'Sessions',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'registration', kind: 'text', label: 'How to register',
        hint: 'A link or an email address. Not tied to any one tool — whatever ' +
              'is being used at the time.' }
    ]
  };

  /* ------------------------------------------------------------- loading */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin' });
      body = await res.json();
    } catch (e) {
      return fail(tr('err.unreachable', 'Could not reach the server.') + ' ' + e.message);
    }
    if (!res.ok) return fail(body.error || tr('err.refused', 'Refused.'));

    state.vocabulary = body.vocabulary || {};
    state.limit = body.limit || 40;
    ['resources', 'gatherings'].forEach(function (c) {
      var got = body[c] || {};
      state[c] = got.items || [];
      state[c + 'Truncated'] = !!got.truncated;
      state[c + 'Error'] = got.error || null;
    });
    render();
  }

  function fail(message) {
    ['resources', 'gatherings'].forEach(function (c) {
      var host = document.querySelector('[data-lib-list="' + c + '"]');
      if (host) host.innerHTML = '<p class="empty">' + esc(message) + '</p>';
    });
  }

  /* ----------------------------------------------------------- rendering */

  function titleOf(item) {
    var t = item.title || {};
    for (var i = 0; i < LANGS.length; i++) if (t[LANGS[i]]) return t[LANGS[i]];
    var any = Object.keys(t)[0];
    return any ? t[any] : tr('lib.untitled', 'Untitled');
  }

  /* WHICH LANGUAGES THIS ITEM HAS, shown on the closed row. It is the thing
     somebody scanning the list wants to know — what still needs translating —
     and it is invisible if you have to open every item to find out. */
  function langChips(item) {
    return LANGS.map(function (l) {
      var has = !!(item.title || {})[l];
      return '<span class="lib-lang' + (has ? ' is-on' : '') + '">' + esc(l) + '</span>';
    }).join('');
  }

  function render() {
    ['resources', 'gatherings'].forEach(function (collection) {
      var host = document.querySelector('[data-lib-list="' + collection + '"]');
      if (!host) return;

      if (state[collection + 'Error']) {
        host.innerHTML = '<p class="empty">' + esc(state[collection + 'Error']) + '</p>';
        return;
      }
      var items = state[collection];
      if (!items.length) {
        host.innerHTML = '<p class="empty">' +
          esc(tr('lib.empty', 'Nothing here yet.')) + '</p>';
        return;
      }

      host.innerHTML =
        (state[collection + 'Truncated']
          ? '<p class="note">' + esc(tr('lib.truncated',
              'Showing the first ' + state.limit + '. This collection has outgrown ' +
              'reading every file on each visit — worth an index before adding more.')) +
            '</p>'
          : '') +
        items.map(function (item) {
          var open = state.open === collection + '/' + item.slug;
          return '<div class="adm-person' + (open ? ' is-open' : '') + '"' +
                 ' data-lib-item="' + esc(collection + '/' + item.slug) + '">' +
            '<div class="adm-row" role="button" tabindex="0" aria-expanded="' +
              (open ? 'true' : 'false') + '">' +
              '<span class="ms-chev" aria-hidden="true"></span>' +
              '<div class="adm-who">' +
                '<span class="adm-name">' + esc(titleOf(item)) + '</span>' +
                '<span class="adm-email">' + esc(item.slug) + '</span>' +
              '</div>' +
              '<div class="adm-tags lib-tags">' + badges(collection, item) + '</div>' +
              '<div class="adm-access lib-langs">' + langChips(item) + '</div>' +
            '</div>' +
            (open ? editor(collection, item) : '') +
          '</div>';
        }).join('');
    });
  }

  function badges(collection, item) {
    var out = [];
    if (collection === 'resources') {
      if (item.pinned) out.push('<span class="role-tag on-site">' +
        esc(tr('lib.pinned', 'Pinned')) + '</span>');
      if (item.moment) out.push('<span class="role-tag">' + esc(item.moment) + '</span>');
      if (item.format) out.push('<span class="role-tag none">' + esc(item.format) + '</span>');
    } else {
      if (item.status) out.push('<span class="role-tag st-' + esc(item.status) + '">' +
        esc(item.status) + '</span>');
      if (item.type) out.push('<span class="role-tag none">' + esc(item.type) + '</span>');
      if (item.date) out.push('<span class="role-tag">' + esc(item.date) + '</span>');
    }
    return out.join('');
  }

  /* One field, drawn from its description. */
  function field(collection, item, spec) {
    if (spec.when && !spec.when(item)) return '';
    var v = item[spec.name];
    var hint = spec.hint
      ? '<span class="fld-hint">' + esc(spec.hint) + '</span>' : '';
    var id = 'f-' + spec.name;

    if (spec.kind === 'choice') {
      var options = (state.vocabulary[spec.vocab] || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (v === o ? ' selected' : '') + '>' +
          esc(o) + '</option>';
      }).join('');
      return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
        '<select data-lib-field="' + esc(spec.name) + '">' + options + '</select>' +
        hint + '</label>';
    }
    if (spec.kind === 'flag') {
      return '<label class="fld lib-flag"><span>' + esc(spec.label) + '</span>' +
        '<input type="checkbox" data-lib-field="' + esc(spec.name) + '"' +
          (v ? ' checked' : '') + '>' + hint + '</label>';
    }
    if (spec.kind === 'tags') {
      return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
        '<input type="text" data-lib-field="' + esc(spec.name) + '" data-lib-list-field="1"' +
          ' value="' + esc((v || []).join(', ')) + '"' +
          ' placeholder="no sound, one channel dead">' + hint + '</label>';
    }
    if (spec.kind === 'sessions') {
      var rows = (v || []).concat([{ date: '', topic: '' }]).map(function (s, i) {
        return '<div class="lib-session" data-session="' + i + '">' +
          '<input type="text" data-session-field="date" value="' + esc(s.date || '') +
            '" placeholder="2027-03-14">' +
          '<input type="text" data-session-field="topic" value="' + esc(s.topic || '') +
            '" placeholder="Signal flow">' +
        '</div>';
      }).join('');
      return '<div class="fld lib-sessions"><span>' + esc(spec.label) + '</span>' +
        rows + '<span class="fld-hint">' +
        esc(tr('lib.sessionsHint', 'Leave the last row blank. Dates are their own ' +
               'field so moving one is an edit, not a rewrite.')) +
        '</span></div>';
    }
    return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
      '<input type="text" data-lib-field="' + esc(spec.name) + '"' +
        ' value="' + esc(v || '') + '"' +
        (spec.placeholder ? ' placeholder="' + esc(spec.placeholder) + '"' : '') + '>' +
      hint + '</label>';
  }

  function editor(collection, item) {
    var specs = FIELDS[collection] || [];

    /* THE WORDS, ONE LANGUAGE AT A TIME. Every language gets a box and an
       empty one is a legitimate saved state — this is the screen where "not
       translated yet" has to be as easy to leave as to fill in. */
    var words = LANGS.map(function (l) {
      var t = (item.title || {})[l] || '';
      var s = (item.summary || item.description || {})[l] || '';
      return '<div class="lib-lang-block' + (t ? '' : ' is-empty') + '" data-lang="' + esc(l) + '">' +
        '<div class="lib-lang-head"><b>' + esc(l.toUpperCase()) + '</b>' +
          (t ? '' : '<span class="lib-lang-none">' +
            esc(tr('lib.notYet', 'not written yet')) + '</span>') + '</div>' +
        '<input type="text" data-lib-title="' + esc(l) + '" value="' + esc(t) + '"' +
          ' placeholder="' + esc(tr('lib.title', 'Title')) + '">' +
        '<textarea data-lib-summary="' + esc(l) + '" rows="2"' +
          ' placeholder="' + esc(tr('lib.summary', 'One or two sentences')) + '">' +
          esc(s) + '</textarea>' +
      '</div>';
    }).join('');

    return '<div class="adm-panel">' +
      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.words', 'Words')) + '</span>' +
        '<div class="lib-langs-grid">' + words + '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.details', 'Details')) + '</span>' +
        '<div class="ms-grid">' +
          specs.map(function (s) { return field(collection, item, s); }).join('') +
        '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.body', 'The full text')) + '</span>' +
        '<textarea class="lib-body" data-lib-body rows="10" placeholder="' +
          esc(tr('lib.bodyHint', 'Markdown. One clean topic — a title, a summary ' +
                 'and this.')) + '">' + esc(item.body || '') + '</textarea>' +
      '</div>' +

      '<div class="adm-section adm-danger">' +
        (item.isNew ? '' :
          '<button type="button" class="del" data-lib-delete>' +
            esc(tr('lib.remove', 'Remove')) + '</button>') +
        '<div class="pf-commit">' +
          '<span class="hint" data-lib-status></span>' +
          '<button type="button" class="solid-btn" data-lib-save>' +
            esc(tr('lib.save', 'Save')) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* -------------------------------------------------------------- saving */

  function readEditor(collection, node, item) {
    var out = { collection: collection, slug: item.slug, title: {}, summary: {} };

    LANGS.forEach(function (l) {
      var t = node.querySelector('[data-lib-title="' + l + '"]');
      var s = node.querySelector('[data-lib-summary="' + l + '"]');
      if (t && t.value.trim()) out.title[l] = t.value.trim();
      if (s && s.value.trim()) out.summary[l] = s.value.trim();
    });

    (FIELDS[collection] || []).forEach(function (spec) {
      var el = node.querySelector('[data-lib-field="' + spec.name + '"]');
      if (spec.kind === 'sessions') {
        out.sessions = [].slice.call(node.querySelectorAll('.lib-session'))
          .map(function (row) {
            return {
              date: (row.querySelector('[data-session-field="date"]') || {}).value || '',
              topic: (row.querySelector('[data-session-field="topic"]') || {}).value || ''
            };
          })
          .filter(function (s) { return s.date.trim() || s.topic.trim(); });
        return;
      }
      if (!el) return;                       // not applicable to this item
      if (spec.kind === 'flag') { out[spec.name] = el.checked; return; }
      if (spec.kind === 'tags') {
        out[spec.name] = el.value.split(',').map(function (x) { return x.trim(); })
          .filter(Boolean);
        return;
      }
      out[spec.name] = el.value.trim();
    });

    var body = node.querySelector('[data-lib-body]');
    out.body = body ? body.value : '';
    return out;
  }

  async function save(collection, slug, node, btn) {
    var item = find(collection, slug) || { slug: slug };
    var payload = readEditor(collection, node, item);
    var status = node.querySelector('[data-lib-status]');
    var say = function (m) { if (status) status.textContent = m; };

    if (!Object.keys(payload.title).length) {
      return say(tr('lib.needTitle', 'A title in at least one language is needed.'));
    }

    btn.disabled = true;
    say(tr('lib.saving', 'Saving…'));
    try {
      var res = await fetch(API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await res.json();
      if (!res.ok) { say(body.error || tr('err.refused', 'Refused.')); return; }
      /* The slug can change on a first save — it is derived from the title —
         so the panel that reopens has to be the one the server just wrote. */
      state.open = collection + '/' + body.slug;
      toast(tr('toast.saved', 'Saved'), 'ok');
      await load();
    } catch (e) {
      say(tr('err.unreachable', 'Could not reach the server.') + ' ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function remove(collection, slug) {
    var ok = window.StaffConfirm
      ? await window.StaffConfirm({
          title: tr('lib.removeTitle', 'Remove this?'),
          body: tr('lib.removeBody',
                   'The file is deleted from the site. Anything already published ' +
                   'stays until the next Publish.'),
          confirm: tr('lib.remove', 'Remove'), danger: true
        })
      : window.confirm(tr('lib.removeTitle', 'Remove this?'));
    if (!ok) return;

    try {
      var res = await fetch(API, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: collection, slug: slug, action: 'delete' })
      });
      var body = await res.json();
      if (!res.ok) return toast(body.error || tr('err.refused', 'Refused.'), 'bad');
      state.open = null;
      toast(tr('toast.deleted', 'Removed'), 'ok');
      await load();
    } catch (e) {
      toast(tr('err.unreachable', 'Could not reach the server.'), 'bad');
    }
  }

  function find(collection, slug) {
    return (state[collection] || []).filter(function (i) { return i.slug === slug; })[0];
  }

  /* ------------------------------------------------------------- wiring */

  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-lib-add]');
    if (add) {
      var c = add.dataset.libAdd;
      var blank = { slug: '', title: {}, summary: {}, body: '', isNew: true };
      /* First value of each vocabulary, so a new item opens with a valid
         choice rather than an empty select that saves as something. */
      (FIELDS[c] || []).forEach(function (s) {
        if (s.kind === 'choice') blank[s.name] = (state.vocabulary[s.vocab] || [])[0];
      });
      state[c] = [blank].concat(state[c]);
      state.open = c + '/';
      render();
      var box = document.querySelector('[data-lib-item="' + c + '/"] [data-lib-title]');
      if (box) box.focus();
      return;
    }

    var save0 = e.target.closest('[data-lib-save]');
    if (save0) {
      var node0 = save0.closest('[data-lib-item]');
      var key = node0.dataset.libItem.split('/');
      return save(key[0], key.slice(1).join('/'), node0, save0);
    }

    var del = e.target.closest('[data-lib-delete]');
    if (del) {
      var key2 = del.closest('[data-lib-item]').dataset.libItem.split('/');
      return remove(key2[0], key2.slice(1).join('/'));
    }

    /* THE ROW, LAST — and only the row itself. Everything above lives inside
       the open panel, and letting the row handler see those clicks would
       collapse the item being edited on every keystroke's worth of clicking.
       The mailing page learned this the expensive way: an attribute that means
       "this is a header" must not also match everything underneath it. */
    var row = e.target.closest('.adm-row');
    if (!row) return;
    var host = row.closest('[data-lib-item]');
    if (!host) return;
    state.open = state.open === host.dataset.libItem ? null : host.dataset.libItem;
    render();
  });

  /* A choice can change which fields apply — a cohort has sessions and no
     single date — so the panel redraws when one changes, and only then. */
  document.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-lib-field]');
    if (!sel || sel.tagName !== 'SELECT') return;
    var host = sel.closest('[data-lib-item]');
    if (!host) return;
    var key = host.dataset.libItem.split('/');
    var item = find(key[0], key.slice(1).join('/'));
    if (!item) return;
    /* Keep everything typed so far — redrawing from the saved item would throw
       away the words somebody is in the middle of writing. */
    var edited = readEditor(key[0], host, item);
    Object.keys(edited).forEach(function (k) { if (k !== 'collection') item[k] = edited[k]; });
    render();
  });

  if (document.querySelector('[data-lib-list]')) load();
})();
