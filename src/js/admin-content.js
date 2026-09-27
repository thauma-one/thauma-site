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
   later — copy describing old behavior is worse than none,
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

    // Default to the first language the site builds, which is also the one
    // every other language is translated FROM.
    await openFile(state.langs[0]);
  }

  /* Language names, from the browser rather than a table we would have to
     maintain. Intl knows the endonym; falling back to the code is fine —
     it is what the file is called. */
  /**
   * What a language is called, in its own words where we have them.
   *
   * Every language file carries a `name` row — "English", "Hrvatski",
   * "Српски" — written by whoever translated it. That beats anything computed:
   * Intl gives a serviceable endonym, but the person who speaks the language
   * decided what to call it, and the site already stores their answer.
   *
   * So: the loaded file first, then the browser, then the bare code. The code
   * stays in brackets throughout, because it is what the upload reads back and
   * what a person needs when two languages share a name.
   */
  function langLabel(code) {
    var own = null;
    if (code === state.file && state.draft && state.draft.name) {
      own = state.draft.name;
    } else if (state.ref && state.ref.code === code && state.ref.leaves &&
               state.ref.leaves.name) {
      own = state.ref.leaves.name;
    }
    if (own) return own + ' (' + code + ')';

    try {
      var dn = new Intl.DisplayNames([code], { type: 'language' });
      var name = dn.of(code);
      if (name && name !== code) return name.charAt(0).toUpperCase() + name.slice(1) + ' (' + code + ')';
    } catch (e) { /* older browser, or a code Intl does not know */ }
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
          /* NAMED BY THE STRING IT EDITS, and by which language's copy of it.
             There is one of these per row and one row per phrase in the
             dictionary, so an unnamed box is one of hundreds — both halves
             are data rather than copy, so neither needs translating. */
          '<textarea rows="1" data-path="' + esc(p) + '" spellcheck="true"' +
            ' aria-label="' + esc(readable(p) + ' — ' + state.file) + '">' +
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

    toast(fill('con.addLangDone', { code: langLabel(body.code), n: body.strings }), 'ok');

    await boot();
    $('cLang').value = body.code;
    await openFile(body.code);
  });

  /* Taking the words out for a translator and bringing them back lives on
     Administration › Languages (Translate), for every language at once and
     with approval line by line. This page is for writing them. */

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
        body: fill('con.leaveBody', { n: dirtyPaths().length, lang: langLabel(state.file) }),
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

  /* Re-read this file from GitHub, SHA and all.

     Available even when nothing looks like it needs doing, which is the point.
     Save is hidden when the draft matches what was loaded, and that is right —
     a commit whose content is identical to the file already there is not a
     thing git can record. But "nothing has changed" describes the copy this
     page pulled down, and that copy can be stale: somebody edited the same
     language in another tab, an import half-landed, a save was refused on a
     SHA conflict and the page kept showing the older text.

     So the remedy for "I am sure this is out of step" is to go and look again,
     not to force an empty commit. */
  $('cReload').addEventListener('click', async function () {
    if (!state.file) return;
    var n = dirtyPaths().length;

    if (n) {
      var ok = await window.StaffConfirm({
        title: tr('con.reloadTitle'),
        body: fill('con.reloadBody', { n: n }),
        confirm: tr('con.reload'),
        cancel: tr('ms.cancel'),
        danger: true
      });
      if (!ok) return;
    }

    this.disabled = true;
    try {
      await openFile(state.file);
      toast(tr('con.reloaded'), 'ok');
    } finally {
      this.disabled = false;
    }
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
