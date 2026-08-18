/* ============================================================
   admin-content.js — editing the site's own words
   ============================================================
   Talks to /api/admin/content, which commits to the repository.

   A SAVE IS A COMMIT AND NOTHING ELSE. It carries [skip ci],
   so no build runs and the public site does not move. Publish
   is a separate act on a separate page.

   This header used to end "a commit is a deploy, and a deploy
   is the public site changing", which was true when it was
   written and stopped being true the day Save/Preview/Publish
   shipped. The button still said "Save & publish" three weeks
   later — copy describing old behaviour is worse than none,
   because somebody reads it and believes it.

   SO IT USES THE WORKING-COPY MODEL, not immediate saves.
   Settings saves immediately because each control there is one
   decision with an obvious result. Copy is not: it is edited in
   passes, a paragraph at a time, and half a rewritten sentence
   must never be able to reach the site. `saved` is what the
   repository holds, `draft` is what the screen shows, and
   nothing crosses between them without the Save button.

   ONE FILE PER SAVE. The endpoint writes one language file per
   commit, so `git log` reads as "Croatian: 4 values" rather
   than as an undifferentiated content change. Switching
   language with unsaved work asks first, because the draft
   belongs to the file it was typed into.

   WHAT IS SENT IS LEAF EDITS, NOT A DOCUMENT. The server
   re-reads the file and applies each path in place. So this
   script cannot add a key, remove one, reorder them or change
   a type, no matter what it does — the structure of the file
   the site is built from is not this page's to alter.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'content') return;

  var API = '/api/admin/content';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    langs: [],        // language codes the SITE builds, from site.json
    file: null,       // the language being edited
    ref: null,        // { code, leaves } — the reference column, or null
    sha: null,        // the SHA of `file` as it was read
    saved: {},        // path -> value, as the repository holds it
    draft: {},        // path -> value, as the screen shows it
    order: [],        // paths, in document order
    sections: [],     // section key -> label
    section: null,
    find: '',
    branch: '',
    repo: ''
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  /* Translate and substitute together — see StaffI18n.fill. Every value named
     in one place, so a missing one is visible rather than invisible. */
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill
      ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* ---- flattening ----------------------------------------------------
     The same shape the endpoint uses: dotted paths, array indices as
     numbers. Keeping the two identical means a path shown on screen is
     the path sent to the server and the path in the JSON file — one
     name for one thing, all the way through. */

  function isLeaf(v) { return v === null || typeof v !== 'object'; }

  function leaves(obj, prefix, out) {
    out = out || {};
    prefix = prefix || '';
    if (isLeaf(obj)) { out[prefix] = obj; return out; }
    var keys = Array.isArray(obj)
      ? obj.map(function (_, i) { return String(i); })
      : Object.keys(obj);
    keys.forEach(function (k) {
      leaves(obj[k], prefix ? prefix + '.' + k : k, out);
    });
    return out;
  }

  /* The section a path belongs to. Top-level scalars (`code`, `name`) have
     no section of their own, so they gather under one rather than each
     becoming a one-row heading. */
  function sectionOf(path) {
    var head = path.split('.')[0];
    return path.indexOf('.') === -1 ? '_general' : head;
  }

  /* A path without its section, for the row label. `home.lede` reads better
     as `lede` when the section is already named above it. */
  function shortPath(path) {
    var i = path.indexOf('.');
    return i === -1 ? path : path.slice(i + 1);
  }

  /* `home.who_h2_bold` -> "Who h2 bold".

     Mechanical, and the raw path stays visible underneath. Writing a proper
     label for all 210 of these would mean deciding what each one renders as,
     which is a guess I would get wrong somewhere — and a confidently wrong
     label on an editing screen is worse than a plain one, because you act on
     it. This makes the common case scannable without claiming to know more
     than it does. */
  function readable(path) {
    return shortPath(path)
      .replace(/[._]/g, ' ')
      .replace(/\b\d+\b/g, function (n) { return '#' + n; })
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function dirtyPaths() {
    return state.order.filter(function (p) { return state.draft[p] !== state.saved[p]; });
  }

  /* ---- loading -------------------------------------------------------- */

  async function get(file) {
    var res, body;
    try {
      res = await fetch(API + '?file=' + encodeURIComponent(file),
                        { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      /* THREE FAILURES, THREE MESSAGES. One try/catch around the fetch and
         the render reports a render bug as a network problem, which sent
         somebody looking in the wrong place for two rounds. */
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, boot);
      return null;
    }
    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', boot);
      return null;
    }

    if (res.status === 403) {
      if ($('notAdmin')) $('notAdmin').hidden = false;
      $('cRoot').hidden = true;
      document.querySelector('.c-bar').hidden = true;
      $('cNote').hidden = true;
      if (window.StaffProblemClear) window.StaffProblemClear();
      return null;
    }
    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401 ? tr('err.expired')
            : tr('err.refused') + ' (' + res.status + ')' + (body.error ? ' — ' + body.error : ''),
          res.status === 401 ? null : boot);
      }
      return null;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    return body;
  }

  /* The editor is useless without a token, and the token is something a
     person has to go and create. Say that, rather than failing to load. */
  function notConfigured(reason) {
    var el = $('cNotConfigured');
    el.innerHTML =
      '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(reason);
    el.hidden = false;
    $('cRoot').hidden = true;
    document.querySelector('.c-bar').hidden = true;
    $('cNote').hidden = true;
  }

  async function boot() {
    var site = await get('site');
    if (!site) return;
    if (site.configured === false) return notConfigured(site.reason || site.error || '');

    state.langs = (site.data && site.data.languages) || ['en'];
    state.branch = site.branch;
    state.repo = site.repo;

    var pick = $('cLang');
    pick.innerHTML = state.langs.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langLabel(c)) + '</option>';
    }).join('');
    pick.disabled = false;

    var ref = $('cRef');
    ref.innerHTML = '<option value="">' + esc(tr('con.noReference')) + '</option>' +
      state.langs.map(function (c) {
        return '<option value="' + esc(c) + '">' + esc(langLabel(c)) + '</option>';
      }).join('');
    ref.disabled = false;

    $('cAddLang').disabled = false;
    $('cExport').disabled = false;
    $('cImport').disabled = false;

    // Default to the first language the site builds, which is also the one
    // every other language is translated FROM.
    await openFile(state.langs[0]);
  }

  /* Language names, from the browser rather than a table we would have to
     maintain. Intl knows the endonym; falling back to the code is fine —
     it is what the file is called. */
  function langLabel(code) {
    try {
      var dn = new Intl.DisplayNames([code], { type: 'language' });
      var name = dn.of(code);
      if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1) + ' (' + code + ')';
    } catch (e) { /* older browser, or an unknown code */ }
    return code;
  }

  async function openFile(code) {
    var body = await get(code);
    if (!body) return;

    state.file = code;
    state.sha = body.sha;
    state.saved = leaves(body.data);
    state.draft = JSON.parse(JSON.stringify(state.saved));
    state.order = Object.keys(state.saved);

    // Sections in document order, which is the order the pages come in.
    var seen = {};
    state.sections = [];
    state.order.forEach(function (p) {
      var s = sectionOf(p);
      if (!seen[s]) { seen[s] = true; state.sections.push(s); }
    });
    if (!state.section || state.sections.indexOf(state.section) === -1) {
      state.section = state.sections[0];
    }

    $('cLang').value = code;
    $('cRoot').hidden = false;
    await loadReference();
    renderWhere();
    renderSections();
    renderRows();
    renderSaveBar();
  }

  /* The reference column. Skipped when it would be the file being edited —
     showing English beside English is a column of duplicates. */
  async function loadReference() {
    $('cRefWrap').hidden = state.langs.length < 2;

    /* Translating without the source in front of you is not a thing anybody
       does, so editing a language that is NOT the first one turns the
       reference on by itself. Editing the first one leaves it off, because a
       column of English beside English is a column of duplicates. */
    if (!$('cRef').value && state.file !== state.langs[0]) {
      $('cRef').value = state.langs[0];
    }
    var want = $('cRef').value;

    if (!want || want === state.file) { state.ref = null; return; }
    var body = await get(want);
    if (!body) { state.ref = null; return; }
    state.ref = { code: want, leaves: leaves(body.data) };
  }

  /* ---- rendering ------------------------------------------------------ */

  function renderWhere() {
    $('cWhere').textContent =
      state.repo + ' · ' + state.branch;
  }

  function renderSections() {
    var counts = {};
    state.order.forEach(function (p) {
      var s = sectionOf(p);
      counts[s] = counts[s] || { n: 0, empty: 0, dirty: 0 };
      counts[s].n++;
      if (state.draft[p] === '') counts[s].empty++;
      if (state.draft[p] !== state.saved[p]) counts[s].dirty++;
    });

    $('cSections').innerHTML = state.sections.map(function (s) {
      var c = counts[s];
      return '<button type="button" class="c-sec' + (s === state.section ? ' is-on' : '') +
        (c.dirty ? ' is-dirty' : '') + '" data-section="' + esc(s) + '">' +
        '<span class="c-sec-n">' + esc(sectionLabel(s)) + '</span>' +
        '<span class="c-sec-c tnum">' + c.n + '</span>' +
        (c.empty ? '<span class="c-sec-empty" title="' + esc(tr('con.emptyHere')) + '">' +
                   c.empty + '</span>' : '') +
        '</button>';
    }).join('');
  }

  function sectionLabel(s) {
    if (s === '_general') return tr('con.general');
    // The section keys ARE the page names — home, about, mission, give. They
    // are not translated: they name files and URL segments, which are things
    // you type rather than things you read.
    return s.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function matches(path) {
    if (!state.find) return true;
    var q = state.find.toLowerCase();
    if (path.toLowerCase().indexOf(q) >= 0) return true;
    if (String(state.draft[path]).toLowerCase().indexOf(q) >= 0) return true;
    if (state.ref && String(state.ref.leaves[path]).toLowerCase().indexOf(q) >= 0) return true;
    return false;
  }

  function renderRows() {
    // A search looks across the whole file; without one you are working in
    // the section you chose. Searching within one section would mean not
    // finding the string you can see on the site.
    var paths = state.order.filter(function (p) {
      return state.find ? matches(p) : sectionOf(p) === state.section;
    });

    $('cCount').textContent = state.find
      ? paths.length + ' ' + tr('con.matches')
      : '';

    if (!paths.length) {
      $('cRows').innerHTML = '<p class="empty">' + esc(tr('con.noMatches')) + '</p>';
      return;
    }

    var refCode = state.ref ? state.ref.code : null;
    $('cRows').innerHTML = paths.map(function (p) {
      var val = state.draft[p];
      var isDirty = state.draft[p] !== state.saved[p];
      var isEmpty = val === '';

      var refCell = '';
      if (refCode) {
        var rv = state.ref.leaves[p];
        refCell =
          '<div class="c-ref">' +
            '<span class="c-lang">' + esc(refCode) + '</span>' +
            '<div class="c-ref-val' + (rv === '' || rv == null ? ' is-empty' : '') + '">' +
              (rv === '' || rv == null ? esc(tr('con.empty')) : esc(rv)) +
            '</div>' +
          '</div>';
      }

      return '<div class="c-row' + (isDirty ? ' is-dirty' : '') + '" data-path="' + esc(p) + '">' +
        '<div class="c-key">' +
          '<span class="c-name">' + esc(readable(p)) + '</span>' +
          '<code>' + esc(state.find ? p : shortPath(p)) + '</code>' +
          (isEmpty ? '<span class="badge warn">' + esc(tr('con.empty')) + '</span>' : '') +
          (isDirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
        '</div>' +
        refCell +
        '<div class="c-edit">' +
          (refCode ? '<span class="c-lang">' + esc(state.file) + '</span>' : '') +
          '<textarea rows="1" data-path="' + esc(p) + '" spellcheck="true">' +
            esc(val) + '</textarea>' +
        '</div>' +
      '</div>';
    }).join('');

    // Size every box to its content once, up front. A one-line box holding
    // four lines of copy hides the thing you came to read.
    $('cRows').querySelectorAll('textarea').forEach(autosize);
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px';
  }

  function renderSaveBar() {
    var d = dirtyPaths();
    var bar = $('cSaveBar');
    bar.hidden = !d.length;
    document.body.classList.toggle('has-savebar', !!d.length);
    if (!d.length) return;

    $('cDirtyCount').textContent = d.length === 1
      ? tr('con.oneChange')
      : d.length + ' ' + tr('con.nChanges');
    $('cSaveNote').textContent =
      tr('con.saveBarNote').replace('{lang}', state.file).replace('{branch}', state.branch);
  }

  /* ---- adding a language ----------------------------------------------
     The only action on this page that creates a file rather than editing one,
     so it asks first and says exactly what it will do. */

  /* Creating a language, factored out: the button asks for a code, and the
     UPLOAD calls the same thing when it is handed a file for a language the
     site does not have yet. Two entry points, one operation — a second copy
     would be a second set of failure handling to keep in step. */
  async function createLanguage(code) {
    var res, body;
    try {
      res = await fetch(API, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: String(code).trim().toLowerCase() })
      });
      body = await res.json();
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'bad');
      return null;
    }
    if (!res.ok) {
      /* A partial failure left a file behind and said so. That is a condition
         somebody has to act on, not an event that scrolls away. */
      if (body && body.partial && window.StaffProblem) window.StaffProblem(body.error, null);
      else toast((body && body.error) || tr('err.refused'), 'bad');
      return null;
    }
    return body;
  }

  var codeLooksValid = function (v) {
    return /^[a-z]{2}(-[a-z]{2})?$/.test(String(v || '').trim().toLowerCase());
  };

  $('cAddLang').addEventListener('click', async function () {
    var code = await window.StaffPrompt({
      title: tr('con.addLangTitle'),
      body: tr('con.addLangBody'),
      note: tr('con.addLangNote'),
      label: tr('con.addLangLabel'),
      placeholder: 'sl',
      confirm: tr('con.addLangDo'),
      cancel: tr('ms.cancel'),
      // Validated here for a quick answer and again on the server, which is
      // the one that counts.
      validate: function (v) {
        v = String(v || '').trim().toLowerCase();
        if (!codeLooksValid(v)) return tr('con.addLangBadCode');
        if (state.langs.indexOf(v) !== -1) return tr('con.addLangExists');
        return null;
      }
    });
    if (!code) return;

    this.disabled = true;
    var body = await createLanguage(code);
    this.disabled = false;
    if (!body) return;

    toast(tr('con.addLangDone')
      .replace('{code}', body.code)
      .replace('{n}', body.strings), 'ok');

    await boot();
    $('cLang').value = body.code;
    await openFile(body.code);
  });

  /* ---- taking the work offline and bringing it back --------------------
     A translator usually has no console login and no reason to want one. They
     want the words in something they can open, and to hand them back.

     CSV, NOT JSON. A spreadsheet is what a translator already has; JSON is a
     format you have to be careful in, and a stray comma or a smart quote
     breaks the whole file rather than one cell.

     IMPORT DOES NOT SAVE. It fills the working copy, so the changes arrive as
     unsaved edits with the coloured edges and the count in the bar, and you
     look at them before anything is committed. That reuses the model the whole
     page already runs on rather than inventing a second path to the file — and
     it means an import can be discarded like any other mistake. */

  /* ---- wrapping, which a CSV can only do one way -------------------------

     A spreadsheet decides column widths itself, and there is nothing in a CSV
     file that can tell it otherwise — no widths, no styles, no formatting of
     any kind. The ONE thing it honours is a newline inside a quoted cell,
     which it renders as a second line within that cell.

     So: soft-wrap the text columns at a readable width. The longest string on
     the site is 388 characters, which as a single line makes the column wider
     than most screens and pushes everything after it out of view.

     THIS IS SAFE ONLY BECAUSE THE IMPORT UNDOES IT, and only because no string
     in the site contains a newline of its own — checked across all three
     languages, and asserted by a test so it stays true. If that ever changes,
     wrapping has to go, or a real line break would be eaten on the way back
     in. Column 4 is the one that matters: whatever is in it gets written to
     the site. */
  var WRAP_AT = 60;

  function wrapCell(text) {
    var s = String(text == null ? '' : text);
    if (s.length <= WRAP_AT) return s;
    var out = [], line = '';
    s.split(' ').forEach(function (word) {
      if (line && (line + ' ' + word).length > WRAP_AT) { out.push(line); line = word; }
      else { line = line ? line + ' ' + word : word; }
    });
    if (line) out.push(line);
    return out.join('\n');
  }

  /* The exact inverse, applied to everything coming back. A cell the
     translator wrapped by hand is undone the same way, which is right — the
     site stores one line and lays it out itself. */
  function unwrapCell(text) {
    return String(text == null ? '' : text).replace(/\s*\r?\n\s*/g, ' ').trim();
  }

  function csvCell(v) {
    v = String(v == null ? '' : v);
    // Quote if it could otherwise break the row. Doubling is how CSV escapes
    // a quote — backslashes are not a thing here.
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  /* ---- context, so a fragment is not translated as if it were a sentence ----

     Fifteen headings on this site are ONE phrase stored as TWO strings, split
     for typography — `h2_thin` holds "On-site," and `h2_bold` holds "behind
     the scenes." Handed to a translator as two rows they read as two things,
     and translated independently they come back as nonsense in any language
     that inflects: the split that works in English falls in the wrong place
     in Croatian, and neither half can be fixed without seeing the other.

     So the export carries the whole phrase on both rows, says which part this
     is, and says explicitly that the split may land somewhere else. That is
     the instruction a human needs and the context a machine translator needs
     to produce something usable rather than two dangling fragments.

     Detected by the naming convention rather than a list, so a heading added
     next month is covered without anybody remembering this. */
  function contextFor(path) {
    var m = path.match(/^(.*)_(thin|bold)$/);
    if (m) {
      var other = m[1] + '_' + (m[2] === 'thin' ? 'bold' : 'thin');
      if (state.draft[other] !== undefined) {
        var whole = m[2] === 'thin'
          ? state.draft[path] + ' ' + state.draft[other]
          : state.draft[other] + ' ' + state.draft[path];
        /* SHORT, and on two lines.

           This repeated a forty-word paragraph on all thirty split rows, which
           made the column wider than the screen and pushed the actual text off
           it. The explanation only ever needed saying once, so it moved to the
           column HEADER, and each row carries the two facts that differ: which
           part, and what the whole phrase is.

           The newline is real wrapping — a spreadsheet renders it as a second
           line inside the cell, and it is the only formatting a CSV can carry. */
        return fill('con.ctxSplit', { part: m[2] === 'thin' ? '1' : '2' }) +
               '\n"' + whole + '"';
      }
    }
    // A placeholder must survive translation or the sentence breaks at runtime.
    if (/\{[a-z_]+\}/i.test(String(state.draft[path]))) {
      var found = String(state.draft[path]).match(/\{[a-z_]+\}/ig).join(' ');
      return fill('con.ctxPlaceholder', { tokens: found });
    }
    return '';
  }

  $('cExport').addEventListener('click', async function () {
    /* THE SOURCE COLUMN IS ALWAYS ENGLISH, not whatever the Reference dropdown
       happens to be set to.

       Those are two different things and conflating them produced a real bug:
       with the dropdown on "No reference" the export wrote a column HEADED
       `en` and left every cell in it empty — a translation file with nothing
       to translate from, which is the one thing it exists to carry.

       The dropdown is a viewing preference for somebody who already knows the
       site. The download goes to a person who does not, and it has to stand on
       its own. So it fetches English if it is not already loaded rather than
       exporting whatever is to hand. */
    /* THE REFERENCE COLUMN IS ALWAYS THERE, even when the language being
       downloaded IS the reference.

       The file's job is to be a template somebody can work from — that was the
       point of having it at all. A version of it without the source text is
       only useful to a person who already knows the site, which is precisely
       not who receives it. So: four columns, always, and English appears twice
       when English is what you asked for. That looks redundant and is not — one
       column is what the words currently say, the other is where the new ones
       go. */
    var btn = this;
    var ref;
    if (state.ref && state.ref.code === 'en') {
      ref = state.ref.leaves;
    } else if (state.file === 'en') {
      ref = state.draft;                 // downloading English: it is its own source
    } else {
      btn.disabled = true;
      var enFile = await get('en');
      btn.disabled = false;
      if (!enFile) return;               // get() has already explained
      ref = leaves(enFile.data);
    }

    /* HEADERS THAT EXPLAIN THEMSELVES.

       They read `key, en, context, sl` — accurate, and no help to the person
       the file is FOR, who has never seen this system and has to work out
       which column to type in. A translator opening a spreadsheet should not
       have to guess, and neither should a machine asked to fill one in.

       The language code stays in the header inside brackets, because the
       upload reads it back to learn which language the file is for. Long name
       for the person, code for the machine, one string.

       Downloading English gets an extra sentence: changing the code in that
       header is what turns the file into a new language. It is the template
       flow, and it needs saying exactly where somebody would look for it. */
    var editHeader = state.file === 'en'
      ? fill('con.csvEditTemplate', { lang: langLabel('en') })
      : fill('con.csvEdit', { lang: langLabel(state.file) });

    var rows = [[
      tr('con.csvKey'),
      fill('con.csvRef', { lang: langLabel('en') }),
      tr('con.csvNotes'),
      editHeader,
    ]];

    state.order.forEach(function (p) {
      // The key is never wrapped: it is an identifier, and a line break in it
      // would make the row unmatchable on the way back.
      rows.push([p,
                 wrapCell(ref[p] == null ? '' : ref[p]),
                 contextFor(p),
                 wrapCell(state.draft[p])]);
    });

    var csv = rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');

    /* THE BOM IS NOT OPTIONAL. Excel opens a UTF-8 CSV as the local codepage
       without one, so Croatian and Serbian arrive as mojibake — and a
       translator would then "fix" it and hand back the damage. */
    var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'thauma-' + state.file + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast(fill('con.exported', { n: state.order.length }), 'ok');
  });

  /* A CSV parser, because the format has exactly one hard part and it is not
     splitting on commas: a quoted field can contain commas, newlines and
     doubled quotes. Splitting on /,/ works until the first translator writes a
     sentence with a comma in it. */
  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip the BOM back off
    var rows = [], row = [], field = '', inQuotes = false, i = 0;
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] && r[0].length); });
  }

  // The real control is the button; the file input is hidden because browsers
  // style it in ways no theme can reach.
  $('cImport').addEventListener('click', function () { $('cImportFile').click(); });

  $('cImportFile').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                 // so re-picking the same file fires again
    if (!file) return;

    var text;
    try { text = await file.text(); }
    catch (err) { return toast(tr('con.importUnreadable'), 'bad'); }

    var rows;
    try { rows = parseCsv(text); }
    catch (err) { return toast(tr('con.importUnreadable'), 'bad'); }

    if (rows.length < 2) return toast(tr('con.importEmpty'), 'bad');

    /* The LAST column is the translation — that is where the export puts it,
       and it survives somebody adding a notes column in the middle, which is
       exactly the sort of thing a spreadsheet invites. */
    var header = rows[0];
    var valueCol = header.length - 1;

    /* WHICH LANGUAGE IS THIS FILE FOR? The last column's header says. There
       are three answers and all three are useful:

         the open one    import it
         another we have switch to it, then import
         one we do not   CREATE it, then import

       That last case is the point of uploading at all for most people: a
       translator hands back a file for a language nobody has set up yet, and
       making them add it by hand first is a step that exists only because the
       software could not be bothered to read its own header.

       A header that is not a language code at all — a hand-made file, or one
       somebody renamed — falls through to the open language, which is the
       only guess available and the one they were already looking at. */
    /* The header now reads "Slovenian (sl) — put your translation here", so the
       code comes out of the brackets. A bare code is still accepted: a
       hand-made file will have one, and refusing it would be pedantry. */
    var rawHeader = String(header[valueCol] || '').trim();
    var bracketed = rawHeader.match(/\(([a-z]{2}(?:-[a-z]{2})?)\)/i);
    var fileLang = (bracketed ? bracketed[1] : rawHeader).trim().toLowerCase();
    var target = state.file;
    var justCreated = false;

    /* How many rows actually carry a translation. For a language that is about
       to be CREATED this is exactly the number of changes, because the new
       file starts empty — so the count can be shown before anything happens
       rather than in a second dialog afterwards. */
    var filled = 0;
    for (var q = 1; q < rows.length; q++) {
      if ((rows[q][0] || '').trim() && unwrapCell(rows[q][valueCol])) filled++;
    }

    if (codeLooksValid(fileLang) && fileLang !== state.file) {
      var known = state.langs.indexOf(fileLang) !== -1;

      var ok = await window.StaffConfirm({
        /* BOTH the title and the body take the values. The title did not,
           and read literally "Add {file} and bring this in?" on screen — the
           chain was on the body and forgetting it above looked like nothing.
           fill() takes them together so that cannot happen quietly. */
        title: fill(known ? 'con.importSwitchTitle' : 'con.importCreateTitle',
                    { file: fileLang, open: state.file, n: filled }),
        body: fill(known ? 'con.importSwitchBody' : 'con.importCreateBody',
                   { file: fileLang, open: state.file, n: filled }),
        note: known ? tr('con.importSwitchNote') : tr('con.importCreateNote'),
        confirm: known ? tr('con.importSwitchDo') : tr('con.importCreateDo'),
        cancel: tr('ms.cancel')
      });
      if (!ok) return;

      if (dirtyPaths().length) {
        /* Unsaved work in the language being left behind. Saving one file is
           what a save IS here, so switching would strand it. */
        var leave = await window.StaffConfirm({
          title: tr('con.leaveTitle'),
          body: fill('con.leaveBody', { n: dirtyPaths().length, lang: state.file }),
          confirm: tr('con.leaveDiscard'), cancel: tr('ms.cancel'), danger: true
        });
        if (!leave) return;
      }

      if (!known) {
        var made = await createLanguage(fileLang);
        if (!made) return;              // createLanguage has already explained
        justCreated = true;
        toast(tr('con.addLangDone').replace('{code}', made.code)
                                   .replace('{n}', made.strings), 'ok');
        await boot();                   // the pickers need the new language in them
      }

      $('cLang').value = fileLang;
      await openFile(fileLang);
      target = fileLang;
      if (state.file !== fileLang) return;   // opening failed and said so
    }

    /* Applied AFTER any switch, against the draft that is now loaded — doing
       it before would fill the old language's working copy and then throw it
       away. */
    var changes = {}, unknown = [], blank = 0;
    for (var r = 1; r < rows.length; r++) {
      var key = (rows[r][0] || '').trim();
      if (!key) continue;
      if (!Object.prototype.hasOwnProperty.call(state.draft, key)) { unknown.push(key); continue; }
      var v = rows[r][valueCol];
      if (v === undefined) continue;
      // Undo the soft wrap. A translator's own line breaks go too — the site
      // stores one line per string and lays it out itself.
      v = unwrapCell(v);
      if (v === '') { blank++; continue; }   // an untouched row is not an instruction to erase
      if (v !== state.draft[key]) changes[key] = v;
    }

    var n = Object.keys(changes).length;
    if (!n) {
      return toast(unknown.length ? tr('con.importNoneMatched') : tr('con.importNoChanges'), 'bad');
    }

    /* ONE DIALOG, NOT TWO, WHEN THE LANGUAGE WAS JUST CREATED.

       The create dialog already said "add Slovenian and bring in 187
       translations", and it was answered. Asking again reviews a file that was
       empty ten seconds ago — there is nothing to compare against and nothing
       to decide. A second confirmation that guards nothing is worse than none:
       it is where people learn to click through dialogs without reading, and
       that habit is spent on the ones that matter.

       The switch and same-language paths DO ask, because there the file being
       overwritten has somebody's existing work in it. */
    if (!justCreated) {
      var apply = await window.StaffConfirm({
        title: tr('con.importTitle'),
        body: fill('con.importBody', { n: n, lang: target }),
        note: (unknown.length ? fill('con.importUnknown', { n: unknown.length }) + ' ' : '') +
              (blank ? fill('con.importBlank', { n: blank }) + ' ' : '') +
              tr('con.importNote'),
        confirm: tr('con.importDo'),
        cancel: tr('ms.cancel')
      });
      if (!apply) return;
    }

    Object.keys(changes).forEach(function (k) { state.draft[k] = changes[k]; });
    renderSections();
    renderRows();
    renderSaveBar();
    toast(fill('con.imported', { n: n }), 'ok');
  });

  /* ---- editing -------------------------------------------------------- */

  $('cRows').addEventListener('input', function (e) {
    var ta = e.target;
    if (ta.tagName !== 'TEXTAREA') return;
    var p = ta.getAttribute('data-path');
    state.draft[p] = ta.value;
    autosize(ta);

    // The row's own marks update without a re-render; re-rendering on every
    // keystroke would take the focus out of the box being typed into.
    var row = ta.closest('.c-row');
    row.classList.toggle('is-dirty', state.draft[p] !== state.saved[p]);
    renderSaveBar();
    renderSections();
  });

  $('cSections').addEventListener('click', function (e) {
    var b = e.target.closest('[data-section]');
    if (!b) return;
    state.section = b.getAttribute('data-section');
    // Choosing a section clears a search; the two are alternative ways of
    // deciding what is on screen, and leaving both on shows neither.
    if (state.find) { state.find = ''; $('cFind').value = ''; }
    renderSections();
    renderRows();
  });

  var findTimer = null;
  $('cFind').addEventListener('input', function (e) {
    clearTimeout(findTimer);
    var v = e.target.value.trim();
    findTimer = setTimeout(function () {
      state.find = v;
      renderRows();
    }, 150);
  });

  /* ---- switching file ------------------------------------------------- */

  $('cLang').addEventListener('change', async function (e) {
    var next = e.target.value;
    if (dirtyPaths().length) {
      var ok = await window.StaffConfirm({
        title: tr('con.leaveTitle'),
        body: fill('con.leaveBody', { n: dirtyPaths().length, lang: state.file }),
        confirm: tr('con.leaveDiscard'),
        cancel: tr('ms.cancel'),
        danger: true
      });
      if (!ok) { e.target.value = state.file; return; }
    }
    await openFile(next);
  });

  $('cRef').addEventListener('change', async function () {
    await loadReference();
    renderRows();
  });

  $('cDiscard').addEventListener('click', async function () {
    var n = dirtyPaths().length;
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: tr('con.discardTitle'),
      body: tr('con.discardBody').replace('{n}', n),
      confirm: tr('ms.discard'),
      cancel: tr('ms.cancel'),
      danger: true
    });
    if (!ok) return;
    state.draft = JSON.parse(JSON.stringify(state.saved));
    renderSections();
    renderRows();
    renderSaveBar();
  });

  /* ---- saving --------------------------------------------------------- */

  $('cSave').addEventListener('click', async function () {
    var d = dirtyPaths();
    if (!d.length) return;

    /* A sentence about what happens, because what happens is a commit on the
       branch that deploys. "Are you sure" would not have said that. */
    var ok = await window.StaffConfirm({
      title: tr('con.saveTitle'),
      body: tr('con.saveBody')
        .replace('{n}', d.length)
        .replace('{lang}', state.file)
        .replace('{branch}', state.branch),
      note: tr('con.saveNote'),
      confirm: tr('con.save'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    var btn = this;
    btn.disabled = true;
    $('cDiscard').disabled = true;

    var changes = {};
    d.forEach(function (p) { changes[p] = state.draft[p]; });

    var res, body;
    try {
      res = await fetch(API, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: state.file, sha: state.sha, changes: changes })
      });
      body = await res.json();
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'bad');
      btn.disabled = false; $('cDiscard').disabled = false;
      return;
    }

    btn.disabled = false;
    $('cDiscard').disabled = false;

    if (res.status === 409) {
      // Somebody else's edit landed first. Nothing was written, and the only
      // safe move is to go and read what is actually there now.
      if (window.StaffProblem) window.StaffProblem(body.error, function () { openFile(state.file); });
      return;
    }
    if (!res.ok) {
      toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'bad');
      return;
    }

    if (body.unchanged) {
      toast(tr('con.nothingChanged'), 'ok');
      state.saved = JSON.parse(JSON.stringify(state.draft));
      renderSections(); renderRows(); renderSaveBar();
      return;
    }

    // The new baseline is what we just wrote, and the new SHA is what the
    // next save will be checked against. Forgetting the second is how the
    // save after this one becomes a phantom conflict.
    state.saved = JSON.parse(JSON.stringify(state.draft));
    state.sha = body.sha;

    toast(fill('con.saved', { n: body.changed.length }), 'ok');
    renderSections();
    renderRows();
    renderSaveBar();
  });

  /* Leaving with unsaved work. The browser decides the wording; all we can
     do is ask it to ask. */
  window.addEventListener('beforeunload', function (e) {
    if (!dirtyPaths().length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  boot();
})();
