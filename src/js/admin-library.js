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
      { name: 'link', kind: 'text', label: 'Link (optional)',
        placeholder: 'thauma.one/guide',
        hint: 'Somewhere this points to — a download, a video, a page. ' +
              'https:// is added if you leave it off.' },
      { name: 'photo', kind: 'photo', label: 'Picture (optional)' }
    ],
    gatherings: [
      { name: 'type', kind: 'choice', label: 'Kind', vocab: 'type',
        hint: 'A gathering happens once. A cohort runs over several sessions.' },
      { name: 'status', kind: 'choice', label: 'Status', vocab: 'status',
        hint: 'Set deliberately, never worked out from the date — a canceled ' +
              'gathering is not "upcoming" because its date has not passed yet.' },
      { name: 'date', kind: 'date', label: 'First day',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'end_date', kind: 'date', label: 'Last day (if more than one)',
        when: function (it) { return it.type !== 'cohort'; },
        hint: 'Leave empty for a single day. A weekend is two dates, not a ' +
              'sentence somebody has to read to work it out.' },
      { name: 'time', kind: 'text', label: 'Time', placeholder: '10:00',
        when: function (it) { return it.type !== 'cohort'; } },
      { name: 'location', kind: 'text', label: 'Where',
        placeholder: 'Kuća molitve, Zagreb',
        when: function (it) { return it.type !== 'cohort'; },
        hint: 'Written as you would say it. The page turns it into a link that ' +
              'opens the reader\'s own maps app.' },
      { name: 'cohort_name', kind: 'text', label: 'Cohort name',
        placeholder: 'Cohort 1', when: function (it) { return it.type === 'cohort'; } },
      { name: 'capacity', kind: 'text', label: 'Places',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'application_required', kind: 'flag', label: 'Application needed',
        when: function (it) { return it.type === 'cohort'; },
        hint: 'Off means anybody can register. On means you decide who joins.' },
      { name: 'cadence', kind: 'choice', label: 'How often they meet', vocab: 'cadence',
        when: function (it) { return it.type === 'cohort'; },
        hint: 'Said once here instead of being implied by a list of dates. ' +
              'Choose Custom for anything that does not follow a rule — first ' +
              'Monday of the month, or nothing regular at all.' },
      { name: 'location', kind: 'text', label: 'Where they meet',
        placeholder: 'Kuća molitve, Zagreb',
        when: function (it) { return it.type === 'cohort'; },
        hint: 'The page turns this into a link that opens the reader\'s own maps app.' },
      { name: 'sessions', kind: 'sessions', label: 'The meetings themselves',
        when: function (it) { return it.type === 'cohort'; } },
      { name: 'registration', kind: 'text', label: 'How to register',
        placeholder: 'thauma.one/register  ·  hello@thauma.one',
        hint: 'A link or an email address — https:// or mailto: is added for ' +
              'you. Plain words are left alone, so "ask Chase" stays a note ' +
              'rather than becoming a broken link.' },
      { name: 'photo', kind: 'photo', label: 'Picture (optional)' }
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
      if (item.status) out.push('<span class="role-tag st-' + esc(item.status) + '">' +
        esc(label(item.status)) + '</span>');
      if (item.type) out.push('<span class="role-tag partner">' + esc(label(item.type)) + '</span>');
      var when = item.date || '';
      /* A gathering can run over a weekend, and one date cannot say so. */
      if (item.end_date && item.end_date !== item.date) when += ' – ' + item.end_date;
      if (when) out.push('<span class="role-tag">' + esc(when) + '</span>');
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
          esc(label(o)) + '</option>';
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
          ' value="' + esc(v || '') + '">' + hint + '</label>';
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
        '<span class="hint" data-lib-shot-status></span>' + hint +
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
        '<span class="fld-hint">' + esc(tr('lib.sessionsWhat',
          'One row per time the group gets together — the date it happens and ' +
          'what that meeting covers. A cohort that runs six evenings has six ' +
          'rows. Leave the last one blank; a new one appears as you fill it.')) +
        '</span>' +
        '<div class="lib-session lib-session-head"><span>' +
          esc(tr('lib.sessionDate', 'Date')) + '</span><span>' +
          esc(tr('lib.sessionTopic', 'What it covers')) + '</span></div>' +
        rows + '</div>';
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

  /* ------------------------------------------------------------- pictures */

  async function putMedia(blob) {
    var res = await fetch('/api/admin/media?kind=library', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': blob.type }, body: blob
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

  async function uploadPhoto(slot, file) {
    var status = slot.querySelector('[data-lib-shot-status]');
    var say = function (k, f) { if (status) status.textContent = tr(k, f); };
    try {
      var shot = window.PhotoCrop ? await window.PhotoCrop.open(file, 'wide') : null;
      if (window.PhotoCrop && !shot) return say('lib.cropCancelled', 'Nothing changed.');

      say('lib.keepingOriginal', 'Keeping the original…');
      var masterUrl = '';
      try {
        var full = await shrink(file, 2400);
        if (full) masterUrl = (await putMedia(full)).url;
      } catch (e) { masterUrl = ''; }

      say('lib.uploading', 'Uploading…');
      var body = await putMedia(shot ? shot.blob : await shrink(file, 1600));
      setPhoto(slot, body.url, masterUrl);
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
        new File([blob], 'photo', { type: blob.type || 'image/webp' }), 'wide');
      if (!shot) { if (status) status.textContent = ''; return; }
      var body = await putMedia(shot.blob);
      /* The master is NOT replaced — writing the new crop over it would make
         the next edit one-way again. */
      setPhoto(slot, body.url, master);
      if (status) status.textContent = tr('lib.photoReady', 'Picture updated — press Save to keep it.');
    } catch (e) {
      if (status) status.textContent = e.message;
    }
  }

  function setPhoto(slot, url, master) {
    var fields = slot.querySelectorAll('[data-lib-field]');
    fields[0].value = url || '';
    if (master !== undefined) fields[1].value = master || '';
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

    var pick = e.target.closest('[data-lib-pick]');
    if (pick) return pick.closest('[data-lib-photo]').querySelector('[data-lib-file]').click();

    var crop = e.target.closest('[data-lib-crop]');
    if (crop) return recropPhoto(crop.closest('[data-lib-photo]'));

    var unphoto = e.target.closest('[data-lib-unphoto]');
    if (unphoto) {
      var slot = unphoto.closest('[data-lib-photo]');
      setPhoto(slot, '', '');
      unphoto.remove();
      var cropBtn = slot.querySelector('[data-lib-crop]');
      if (cropBtn) cropBtn.remove();
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
    var file = e.target.closest('[data-lib-file]');
    if (file) {
      var f = file.files && file.files[0];
      if (f) uploadPhoto(file.closest('[data-lib-photo]'), f);
      file.value = '';                 // so choosing the same file twice fires
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
