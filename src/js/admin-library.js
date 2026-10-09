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

  /* VOCABULARY VALUES ARE SLUGS; PEOPLE READ WORDS. "glossary-entry" is what
     the file stores and "Glossary entry" is what a person scanning a list
     should see. Done here rather than by writing every label out twice, so a
     new value in the vocabulary is readable the moment it exists. */
  var label = function (v) {
    return String(v || '').replace(/[-_]/g, ' ')
      .replace(/^./, function (c) { return c.toUpperCase(); });
  };

  var LANGS = (function () {
    try { return JSON.parse(($('libLangs') || {}).textContent || '[]'); }
    catch (e) { return ['en']; }
  })();

  var state = { resources: [], gatherings: [], vocabulary: {}, open: null, limit: 40 };
  /* Which language is being edited and which shown for reference. Kept
     across items and redraws, like the other editors' pair. */
  var lib = { edit: null, ref: null };
  /* Each language in its own words — "Hrvatski", "Српски" — as the other
     editors' pickers name them. */
  function langName(code) {
    try {
      var n = new Intl.DisplayNames([code, 'en'], { type: 'language' }).of(code) || code;
      return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { return code; }
  }
  /* Show the language being edited; write the reference language's words,
     as they stand in their boxes now, small above each box. */
  function showLangs(panel) {
    if (!panel) return;
    [].forEach.call(panel.querySelectorAll('.lib-lang-block'), function (b) {
      b.hidden = b.dataset.lang !== lib.edit;
    });
    var block = panel.querySelector('.lib-lang-block[data-lang="' + lib.edit + '"]');
    if (!block) return;
    ['title', 'summary'].forEach(function (k) {
      var src = lib.ref && panel.querySelector('[data-lib-' + k + '="' + lib.ref + '"]');
      var el = block.querySelector('[data-lib-ref="' + k + '"]');
      var v = src ? src.value.trim() : '';
      el.textContent = v;
      el.hidden = !v;
      if (lib.ref) el.setAttribute('lang', lib.ref);
    });
  }

  /* WHAT AN ITEM IS MADE OF. `when` decides whether a field applies to this
     particular item — a location belongs to a one-off gathering and a session
     list belongs to a cohort, and showing both to both is how a form starts
     asking questions that do not apply. */
  var FIELDS = {
    resources: [
      /* The four doors of the Resources page, in the page's own words, so
         choosing one says where a visitor will find it (2026-10-07). */
      { name: 'moment', kind: 'choice', label: 'Where a visitor finds it', vocab: 'moment' },
      { name: 'format', kind: 'choice', label: 'Format', vocab: 'format' },
      { name: 'symptoms', kind: 'tags', label: 'Symptoms',
        when: function (it) { return it.moment === 'crisis'; } },
      { name: 'pinned', kind: 'flag', label: 'Keep at the top' },
      { name: 'link', kind: 'text', label: 'Link',
        placeholder: 'thauma.one/guide' },
      { name: 'photo', kind: 'photo', label: 'Picture' }
    ],
    gatherings: [
      { name: 'type', kind: 'choice', label: 'Kind', vocab: 'type' },
      { name: 'status', kind: 'choice', label: 'Status', vocab: 'status' },
      { name: 'featured', kind: 'flag', label: tr('lib.featured', 'Highlighted at the top'),
        when: function (it) { return (it.status || 'upcoming') === 'upcoming'; } },
      { name: 'date', kind: 'date', label: 'First day',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'end_date', kind: 'date', label: 'Last day',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'time', kind: 'text', label: 'Time', placeholder: '10:00',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'location', kind: 'text', label: 'Where',
        placeholder: 'Kuća molitve, Zagreb',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'cohort_name', kind: 'text', label: 'Cohort name',
        placeholder: 'Cohort 1', when: function (it) { return it.type === 'cohort'; } },
      { name: 'capacity', kind: 'text', label: 'Places',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'application_required', kind: 'flag', label: 'Application needed',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'cadence', kind: 'choice', label: 'How often they meet', vocab: 'cadence',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'location', kind: 'text', label: 'Where they meet',
        placeholder: 'Kuća molitve, Zagreb',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'sessions', kind: 'sessions', label: 'Each time the group meets',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'registration', kind: 'text', label: 'How to register',
        placeholder: 'thauma.one/register  ·  hello@thauma.one' },
      { name: 'photo', kind: 'photo', label: 'Picture' }
    ]
  };

  /* ------------------------------------------------------------- loading */

  /* Resources and Events are separate pages; each holds one list and asks
     for only that collection. */
  function onlyCollection() {
    var lists = document.querySelectorAll('[data-lib-list]');
    return lists.length === 1 ? lists[0].getAttribute('data-lib-list') : null;
  }

  async function load() {
    var res, body;
    var only = onlyCollection();
    try {
      res = await fetch(API + (only ? '?collection=' + encodeURIComponent(only) : ''), { credentials: 'same-origin' });
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
  /* THE LANGUAGES IT IS STILL MISSING, said as Updates and the Site Creator
     say it — "missing HR, SR" (2026-10-07, suggestion 2) — rather than a row
     of lit and unlit codes to decode. Missing means no title, as Updates
     counts it. */
  function langChips(item) {
    var miss = LANGS.filter(function (l) { return !String(((item.title || {})[l]) || '').trim(); });
    return miss.length ? '<span class="lib-miss">' + esc(tr('ms.missing', 'missing') + ' ' + miss.join(', ').toUpperCase()) + '</span>' : '';
  }

  /* WHEN SOMETHING HAPPENS DECIDES WHERE IT SITS.
   *
   * The list arrived alphabetical by filename, which tells an editor nothing:
   * a gathering from last year sat above the one three weeks away because "f"
   * precedes "p". What somebody opening this page wants is the next thing
   * first and the finished things out of the way.
   *
   * SAME RULES AS THE PUBLIC PAGE, deliberately — see src/_data/gatherings.js.
   * Upcoming reads soonest-first, because that is the order they will happen;
   * past reads newest-first, because last month matters more than 2019. The
   * two surfaces disagreeing about what "next" means would be its own small
   * confusion.
   *
   * AND ANYTHING WITHOUT A REAL DATE FALLS TO THE END of its own group rather
   * than to the top. A date typed as prose — "13 March - 27 March 2027" is a
   * real thing to write before one is fixed — cannot be compared to anything,
   * and string comparison put it first purely because "1" precedes "2". A
   * half-finished draft was outranking a confirmed gathering. */
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  function at(item) {
    return ISO.test(String(item.date || '')) ? Date.parse(item.date) : NaN;
  }
  function byDate(dir) {
    return function (a, b) {
      var x = at(a), y = at(b);
      var xo = !isNaN(x), yo = !isNaN(y);
      if (xo !== yo) return xo ? -1 : 1;      // undated last, either way
      if (!xo) return 0;
      return dir === 'asc' ? x - y : y - x;
    };
  }

  /* Three groups, and only the ones that exist get a heading. Canceled is
     neither coming up nor finished — it stays near the top where an editor can
     see it and change their mind, rather than being filed with the past. */
  function groupsFor(collection, items) {
    if (collection !== 'gatherings') return [{ items: items }];
    var by = function (status) { return items.filter(function (i) { return i.status === status; }); };
    return [
      { label: tr('lib.comingUp', 'Coming up'), items: by('upcoming').sort(byDate('asc')) },
      { label: tr('lib.canceled', 'Canceled'), items: by('canceled').sort(byDate('asc')) },
      { label: tr('lib.past', 'Already happened'), items: by('past').sort(byDate('desc')) },
    ].filter(function (g) { return g.items.length; });
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
        groupsFor(collection, items).map(function (group) {
        return (group.label
          ? '<p class="cue bare lib-group">' + esc(group.label) + '</p>' : '') +
        group.items.map(function (item) {
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
        }).join('');
      /* The reference words above each box, from the boxes as drawn. */
      [].forEach.call(host.querySelectorAll('.adm-panel'), showLangs);
    });
  }

  /* WHAT THE ROW SAYS WITHOUT BEING OPENED. The kind of thing it is comes
     first, because that is what somebody is scanning for — "where is the
     checklist" — and it was missing entirely from the closed row. */
  function badges(collection, item) {
    var out = [];
    if (collection === 'resources') {
      if (item.pinned) out.push('<span class="role-tag on-site">' +
        esc(tr('lib.pinned', 'Pinned')) + '</span>');
      if (item.format) out.push('<span class="role-tag partner">' + esc(label(item.format)) + '</span>');
      if (item.moment) out.push('<span class="role-tag">' + esc(label(item.moment)) + '</span>');
    } else {
      /* No status tag: the group heading above already says Coming up,
         Canceled or Already happened, and saying it twice was a third of the
         row's tags. */
      /* HIGHLIGHTED AT THE TOP (2026-10-08, Chase: "a toggle … for a
         highlighted event … controls for highlighting multiple"): a star on
         every coming event, pressed in the list without opening it. */
      if ((item.status || 'upcoming') === 'upcoming') {
        out.push('<button type="button" class="lib-star" data-lib-feature="' + esc(item.slug) + '" aria-pressed="' + (item.featured === true) + '"' +
          ' title="' + esc(tr('lib.featured', 'Highlighted at the top')) + '">' +
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5z"/></svg>' +
          '<span>' + esc(tr(item.featured === true ? 'lib.featuredOn' : 'lib.featureIt', item.featured === true ? 'Highlighted' : 'Highlight')) + '</span></button>');
      }
      if (item.type) out.push('<span class="role-tag partner">' + esc(label(item.type)) + '</span>');
      var when = whenText(item.date, item.end_date);
      if (when) out.push('<span class="role-tag">' + esc(when) + '</span>');
    }
    return out.join('');
  }

  /* A date as a person says it, in the console's language — "Mar 14 – 15,
     2027" — rather than 2027-03-14. A gathering can run over a weekend, and
     one date cannot say so. A date typed as prose is shown as typed. */
  function whenText(from, to) {
    if (!ISO.test(String(from || ''))) return from || '';
    var a = new Date(from + 'T00:00:00Z');
    var b = ISO.test(String(to || '')) && to !== from ? new Date(to + 'T00:00:00Z') : null;
    try {
      var f = new Intl.DateTimeFormat((window.StaffI18n && window.StaffI18n.lang) || 'en',
        { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      return b && f.formatRange ? f.formatRange(a, b) : f.format(a) + (b ? ' – ' + f.format(b) : '');
    } catch (e) {
      return from + (b ? ' – ' + to : '');
    }
  }

  /* One field, drawn from its description. */
  function field(collection, item, spec) {
    if (spec.when && !spec.when(item)) return '';
    var v = item[spec.name];
    var id = 'f-' + spec.name;

    if (spec.kind === 'choice') {
      var options = (state.vocabulary[spec.vocab] || []).map(function (o) {
        return '<option value="' + esc(o) + '"' + (v === o ? ' selected' : '') + '>' +
          esc(tr('lib.v.' + spec.vocab + '.' + o, label(o))) + '</option>';
      }).join('');
      return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
        '<select data-lib-field="' + esc(spec.name) + '">' + options + '</select></label>';
    }
    if (spec.kind === 'flag') {
      return '<label class="fld lib-flag"><span>' + esc(spec.label) + '</span>' +
        '<input type="checkbox" data-lib-field="' + esc(spec.name) + '"' +
          (v ? ' checked' : '') + '></label>';
    }
    if (spec.kind === 'tags') {
      return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
        '<input type="text" data-lib-field="' + esc(spec.name) + '" data-lib-list-field="1"' +
          ' value="' + esc((v || []).join(', ')) + '"' +
          ' placeholder="no sound, one channel dead"></label>';
    }
    if (spec.kind === 'date') {
      /* A REAL DATE CONTROL, not a text box with a hopeful placeholder. Left
         as text, somebody types "13 March - 27 March 2027" — perfectly clear
         to a person, and not a date to anything that has to sort, compare or
         translate it into Croatian.

         UNLESS WHAT IS ALREADY THERE IS NOT A DATE. A date input silently
         shows nothing for a value it cannot parse, and saving would then wipe
         words somebody deliberately wrote. So free text keeps a text box and
         says why, rather than being quietly discarded. */
      var iso = /^\d{4}-\d{2}-\d{2}$/.test(v || '');
      if (v && !iso) {
        return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
          '<input type="text" data-lib-field="' + esc(spec.name) + '"' +
            ' value="' + esc(v) + '">' +
          '<span class="fld-hint">' + esc(tr('lib.freeDate',
            'This is not a date the site can read — it will be shown exactly as ' +
            'written. Clear it to pick a real one.')) + '</span></label>';
      }
      return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
        '<input type="date" data-lib-field="' + esc(spec.name) + '"' +
          ' value="' + esc(v || '') + '"></label>';
    }
    if (spec.kind === 'photo') {
      /* A REAL UPLOAD, not a path. "Photo path (optional)" was a text box
         asking somebody to know where a file lives on a server, which is not
         a thing anybody knows — and it was the only place in this console that
         asked. Same control as a staff photo: pick, crop, replace, remove. */
      return '<div class="fld lib-photo" data-lib-photo="' + esc(spec.name) + '">' +
        '<span>' + esc(spec.label) + '</span>' +
        '<div class="lib-shot">' +
          (v ? '<img src="' + esc(v) + '" alt="">'
             : '<span class="pf-empty">' + esc(tr('lib.noPhoto', 'No picture yet')) + '</span>') +
        '</div>' +
        '<input type="hidden" data-lib-field="' + esc(spec.name) + '" value="' + esc(v || '') + '">' +
        '<input type="hidden" data-lib-field="' + esc(spec.name) + '_master" value="' +
          esc(item[spec.name + '_master'] || '') + '">' +
        /* its shape, width ÷ height, so the page's frame matches it */
        '<input type="hidden" data-lib-field="' + esc(spec.name) + '_ar" value="' +
          esc(item[spec.name + '_ar'] || '') + '">' +
        '<input type="file" accept="image/*" hidden data-lib-file>' +
        '<div class="pf-photo-acts">' +
          '<button type="button" class="ghost-btn" data-lib-pick>' +
            esc(tr(v ? 'lib.replacePhoto' : 'lib.choosePhoto', v ? 'Replace' : 'Choose a picture')) +
          '</button>' +
          (v ? '<button type="button" class="ghost-btn" data-lib-crop>' +
                 esc(tr('lib.editPhoto', 'Edit')) + '</button>' +
               '<button type="button" class="del" data-lib-unphoto>' +
                 esc(tr('lib.removePhoto', 'Remove')) + '</button>' : '') +
        '</div>' +
        '<span class="hint" data-lib-shot-status></span>' +
      '</div>';
    }
    if (spec.kind === 'sessions') {
      var rows = (v || []).concat([{ date: '', topic: '' }]).map(function (s, i) {
        return '<div class="lib-session" data-session="' + i + '">' +
          '<input type="' + (/^\d{4}-\d{2}-\d{2}$/.test(s.date || '') || !s.date ? 'date' : 'text') +
            '" data-session-field="date" value="' + esc(s.date || '') + '">' +
          '<input type="text" data-session-field="topic" value="' + esc(s.topic || '') +
            '" placeholder="Signal flow">' +
        '</div>';
      }).join('');
      return '<div class="fld lib-sessions"><span>' + esc(spec.label) + '</span>' +
        '<div class="lib-session lib-session-head"><span>' +
          esc(tr('lib.sessionDate', 'Date')) + '</span><span>' +
          esc(tr('lib.sessionTopic', 'What it covers')) + '</span></div>' +
        rows + '</div>';
    }
    return '<label class="fld"><span>' + esc(spec.label) + '</span>' +
      '<input type="text" data-lib-field="' + esc(spec.name) + '"' +
        ' value="' + esc(v || '') + '"' +
        (spec.placeholder ? ' placeholder="' + esc(spec.placeholder) + '"' : '') + '></label>';
  }

  function editor(collection, item) {
    var specs = FIELDS[collection] || [];

    /* THE WORDS, ONE LANGUAGE AT A TIME — "Editing" and "Reference", the
       same pair every other editor has (Chase, 2026-09-28). Every language
       still has its boxes, so saving reads them all as before; only the one
       being edited shows, and the reference language's words sit small above
       each box. An empty language is a legitimate saved state: "not
       translated yet" must be as easy to leave as to fill in. */
    if (LANGS.indexOf(lib.edit) === -1) lib.edit = LANGS[0];
    if (lib.ref === lib.edit || LANGS.indexOf(lib.ref) === -1) {
      lib.ref = LANGS.filter(function (l) { return l !== lib.edit; })[0] || null;
    }
    var words = LANGS.map(function (l) {
      var t = (item.title || {})[l] || '';
      var s = (item.summary || item.description || {})[l] || '';
      return '<div class="lib-lang-block" data-lang="' + esc(l) + '"' + (l === lib.edit ? '' : ' hidden') + '>' +
        '<small class="ms-ref" data-lib-ref="title" hidden></small>' +
        '<input type="text" data-lib-title="' + esc(l) + '" value="' + esc(t) + '"' +
          ' placeholder="' + esc(tr('lib.title', 'Title')) + '" lang="' + esc(l) + '">' +
        '<small class="ms-ref" data-lib-ref="summary" hidden></small>' +
        '<textarea data-lib-summary="' + esc(l) + '" rows="2" lang="' + esc(l) + '"' +
          ' placeholder="' + esc(tr('lib.summary', 'One or two sentences')) + '">' +
          esc(s) + '</textarea>' +
      '</div>';
    }).join('');
    var pick = function (attr, selected, except) {
      /* Every language, the one being edited hidden and disabled rather
         than left out, so a swap can pick it the moment it is not. */
      return '<select class="lang-pick" ' + attr + '>' + LANGS
        .map(function (l) {
          var has = !!(item.title || {})[l];
          return '<option value="' + esc(l) + '"' + (l === selected ? ' selected' : '') +
            (l === except ? ' hidden disabled' : '') + '>' +
            esc(langName(l)) + (has ? '' : ' · ' + esc(tr('ms.missing', 'missing'))) + '</option>';
        }).join('') + '</select>';
    };
    var pair = '<div class="ms-writing lib-writing">' +
      '<label class="ms-pick"><span>' + esc(tr('con.editing', 'Editing')) + '</span>' +
        pick('data-lang-edit data-lib-lang="edit"', lib.edit) + '</label>' +
      (LANGS.length > 1
        ? '<span class="lang-ref">' +
            '<button type="button" class="lang-swap" data-lang-swap aria-label="' + esc(tr('con.swap', 'Swap languages')) +
              '" title="' + esc(tr('con.swap', 'Swap languages')) + '">&#8644;</button>' +
            '<label class="ms-pick"><span>' + esc(tr('con.reference', 'Reference')) + '</span>' +
              pick('data-lang-ref data-lib-lang="ref"', lib.ref, lib.edit) + '</label>' +
            '<button type="button" class="ghost-btn sm lang-ai" data-lang-translate>' +
              esc(tr('ai.translate', 'Translate')) + '</button>' +
          '</span>'
        : '') +
    '</div>';

    return '<div class="adm-panel">' +
      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.words', 'Words')) + '</span>' +
        pair + '<div class="lib-langs-one">' + words + '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.details', 'Details')) + '</span>' +
        '<div class="ms-grid">' +
          specs.map(function (s) { return field(collection, item, s); }).join('') +
        '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('lib.body', 'The full text')) + '</span>' +
        '<textarea class="lib-body" data-lib-body rows="10">' +
          esc(item.body || '') + '</textarea>' +
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

  /* ------------------------------------------------------------- pictures */

  /* name: what the file was called, so the stored copy is findable by eye
     (media.js turns it into plain words in front of the fingerprint). */
  async function putMedia(blob, name) {
    var headers = { 'Content-Type': blob.type };
    if (name) headers['X-File-Name'] = String(name).slice(0, 80);
    var res = await fetch('/api/admin/media?kind=library', {
      method: 'PUT', credentials: 'same-origin',
      headers: headers, body: blob
    });
    var body = await res.json();
    if (!res.ok) throw new Error(body.error || tr('err.refused', 'Refused.'));
    return body;
  }

  /* Scaled without cropping, so Edit can widen a crop later rather than only
     tighten it — the pixels outside the frame are gone the moment they are not
     kept. Same reasoning as a staff photo's master. */
  async function shrink(file, maxPx) {
    var bitmap = await createImageBitmap(file);
    var scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bitmap.width * scale));
    c.height = Math.max(1, Math.round(bitmap.height * scale));
    c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
    if (bitmap.close) bitmap.close();
    return await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.85); });
  }

  /* Header-safe: accents dropped (č → c), anything else non-ASCII removed. */
  function baseName(n) { return String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').replace(/\.[a-z0-9]{2,5}$/i, ''); }

  async function uploadPhoto(slot, file) {
    var status = slot.querySelector('[data-lib-shot-status]');
    var say = function (k, f) { if (status) status.textContent = tr(k, f); };
    try {
      var shot = window.PhotoCrop ? await window.PhotoCrop.open(file, 'library') : null;
      if (window.PhotoCrop && !shot) return say('lib.cropCancelled', 'Nothing changed.');

      say('lib.keepingOriginal', 'Keeping the original…');
      var masterUrl = '';
      try {
        var full = await shrink(file, 2400);
        if (full) masterUrl = (await putMedia(full, baseName(file.name) + '-original')).url;
      } catch (e) { masterUrl = ''; }

      say('lib.uploading', 'Uploading…');
      var body = await putMedia(shot ? shot.blob : await shrink(file, 1600), baseName(file.name));
      setPhoto(slot, body.url, masterUrl, shot ? shot.aspect : null);
      say('lib.photoReady', 'Picture added — press Save to keep it.');
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  }

  /* Re-crop what is already there. From the master where one exists, so the
     frame can be widened; from the cropped copy otherwise, which can only be
     tightened and says so. */
  async function recropPhoto(slot) {
    var status = slot.querySelector('[data-lib-shot-status]');
    var fields = slot.querySelectorAll('[data-lib-field]');
    var current = fields[0].value, master = fields[1].value;
    var from = master || current;
    if (!from || !window.PhotoCrop) return;
    try {
      if (status) status.textContent = tr(master ? 'lib.loading' : 'lib.loadingCropped',
        master ? 'Opening the original…' : 'Opening the cropped copy — this one can only be cropped further in.');
      var res = await fetch(from, { cache: 'force-cache' });
      if (!res.ok) throw new Error(tr('lib.gone', 'That picture could not be loaded'));
      var blob = await res.blob();
      var shot = await window.PhotoCrop.open(
        new File([blob], 'photo', { type: blob.type || 'image/webp' }), 'library');
      if (!shot) { if (status) status.textContent = ''; return; }
      var body = await putMedia(shot.blob, baseName(from.split('/').pop()).replace(/-?[0-9a-f]{16}$/, '').replace(/-original$/, ''));
      /* The master is NOT replaced — writing the new crop over it would make
         the next edit one-way again. */
      setPhoto(slot, body.url, master, shot.aspect);
      if (status) status.textContent = tr('lib.photoReady', 'Picture updated — press Save to keep it.');
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  }

  function setPhoto(slot, url, master, ar) {
    var fields = slot.querySelectorAll('[data-lib-field]');
    fields[0].value = url || '';
    if (master !== undefined) fields[1].value = master || '';
    if (ar !== undefined && fields[2]) fields[2].value = url && ar ? String(Math.round(ar * 1000) / 1000) : '';
    slot.querySelector('.lib-shot').innerHTML = url
      ? '<img src="' + esc(url) + '" alt="">'
      : '<span class="pf-empty">' + esc(tr('lib.noPhoto', 'No picture yet')) + '</span>';
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
      /* a picture carries its original and its shape beside it */
      if (spec.kind === 'photo') {
        ['_master', '_ar'].forEach(function (x) {
          var h = node.querySelector('[data-lib-field="' + spec.name + x + '"]');
          if (h) out[spec.name + x] = h.value.trim();
        });
      }
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
      document.dispatchEvent(new CustomEvent('web:saved'));
      await load();
    } catch (e) {
      say(tr('err.unreachable', 'Could not reach the server.') + ' ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  /* The star: the event saved as it is, highlighted or not. */
  async function feature(btn) {
    var item = find('gatherings', btn.dataset.libFeature);
    if (!item) return;
    var payload = Object.assign({}, item, { collection: 'gatherings', featured: item.featured !== true });
    btn.disabled = true;
    try {
      var res = await fetch(API, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) { btn.disabled = false; return toast(body.error || tr('err.refused', 'Refused.'), 'bad'); }
      toast(tr('toast.saved', 'Saved'), 'ok');
      document.dispatchEvent(new CustomEvent('web:saved'));
      await load();
    } catch (e) {
      btn.disabled = false;
      toast(tr('err.unreachable', 'Could not reach the server.'), 'bad');
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
      document.dispatchEvent(new CustomEvent('web:saved'));
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

    var pick = e.target.closest('[data-lib-pick]');
    if (pick) return pick.closest('[data-lib-photo]').querySelector('[data-lib-file]').click();

    var crop = e.target.closest('[data-lib-crop]');
    if (crop) return recropPhoto(crop.closest('[data-lib-photo]'));

    var unphoto = e.target.closest('[data-lib-unphoto]');
    if (unphoto) {
      var slot = unphoto.closest('[data-lib-photo]');
      setPhoto(slot, '', '', null);
      unphoto.remove();
      var cropBtn = slot.querySelector('[data-lib-crop]');
      if (cropBtn) cropBtn.remove();
      return;
    }

    var star = e.target.closest('[data-lib-feature]');
    if (star) return feature(star);

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
    var file = e.target.closest('[data-lib-file]');
    if (file) {
      var f = file.files && file.files[0];
      if (f) uploadPhoto(file.closest('[data-lib-photo]'), f);
      file.value = '';                 // so choosing the same file twice fires
      return;
    }

    /* Editing or Reference changed: no redraw, so nothing typed is lost.
       Reference never offers the language being edited. */
    var lp = e.target.closest('[data-lib-lang]');
    if (lp) {
      var panel = lp.closest('.adm-panel');
      if (lp.dataset.libLang === 'edit') {
        lib.edit = lp.value;
        if (lib.ref === lib.edit) lib.ref = LANGS.filter(function (l) { return l !== lib.edit; })[0] || null;
        var refSel = panel.querySelector('[data-lib-lang="ref"]');
        if (refSel) {
          var keep = lib.ref;
          [].forEach.call(refSel.options, function (o) { o.hidden = o.value === lib.edit; o.disabled = o.value === lib.edit; });
          refSel.value = keep;
        }
      } else {
        lib.ref = lp.value;
      }
      showLangs(panel);
      return;
    }

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
