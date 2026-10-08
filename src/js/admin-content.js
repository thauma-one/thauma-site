/* ============================================================
   admin-content.js — Website › Pages: every word, every language
   ============================================================
   Built to the mockup board "Site words by page", with Chase's
   notes (2026-09-26/27): labels first and the live preview
   later; every language control with the words; everything a
   visitor reads translatable. Three servers behind it:

     /api/admin/translate          every line of one language —
                                   the site's pages and the emails
                                   and forms — with its English and
                                   whether it is missing or
                                   outdated; saving; the file for
                                   a translator and approving what
                                   comes back; every language's
                                   progress (?summary)
     /api/admin/content            site.json: a language's preview
                                   and live switches, the default,
                                   the donation page; adding and
                                   removing a language
     /api/admin/translation-notes  how each language is written

   THE WORDS USE THE WORKING-COPY MODEL. Copy is edited in
   passes, and half a rewritten sentence must never reach the
   site: `saved` is what the repository holds, `draft` is the
   screen, and nothing crosses without Save. A save is a quiet
   commit; publishing is the bar along the foot of the screen.

   THE LANGUAGE SETTINGS SAVE AS THEY ARE CHANGED, like Settings:
   each is one decision with an obvious result, and none is live
   before publishing either.

   A ROW IS WHAT A PERSON READS AS ONE LINE. Usually that is one
   stored string. A heading stored as two strings for its bold
   half (`h1_thin` + `h1_bold`) is one row, edited as it reads.
   Saving still sends the two strings; the row is presentation.

   WHAT YOU SEE IS WHAT YOU DOWNLOAD. The translator's file holds
   the rows on screen — a page, a search, Needs work, All — and
   More says how many lines that is.
   ============================================================ */
(function () {
  'use strict';

  /* On the Website page, as its Pages tab; finds its own elements. */
  if (!document.getElementById('cRoot')) return;

  var CONTENT = '/api/admin/content';
  var WORDS = '/api/admin/translate';
  var NOTES = '/api/admin/translation-notes';
  var ADD = '__add';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    site: null, siteSha: null,
    langs: [], lang: null, names: {}, summary: {},
    lines: [], byId: {}, rows: [], saved: {}, draft: {}, blocked: {},
    beside: 'en', besideLines: {},
    view: null, find: '',
    notes: { keep: [], glossary: [], guides: {} }, notesWrite: false, openNotes: null,
    review: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function has(key) { return tr(key) !== key; }
  /* Translate and substitute together — see StaffI18n.fill. */
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  /* ---- talking to the servers ---------------------------------------- */

  /* One path for every request. A page that cannot load says so and offers
     to try again (StaffProblem); a refused change is a toast; either way the
     caller gets the answer back to read its code. THREE FAILURES, THREE
     MESSAGES: the network, the server's refusal, an unreadable answer. */
  async function send(url, method, body, quiet) {
    var res, data;
    try {
      res = await fetch(url, {
        method: method || 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      if (!quiet && window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, boot);
      return null;
    }
    try { data = await res.json(); }
    catch (e) {
      if (!quiet && window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', boot);
      return null;
    }
    data.status = res.status;
    if (!res.ok) {
      data.failed = true;
      if (res.status === 403 && url.indexOf(CONTENT) === 0 && (!method || method === 'GET')) {
        if ($('notAdmin')) $('notAdmin').hidden = false;
        $('cRoot').hidden = true;
        document.querySelector('.c-tools').hidden = true;
      } else if ((!method || method === 'GET') && !quiet && window.StaffProblem) {
        window.StaffProblem(res.status === 401 ? tr('err.expired')
          : tr('err.refused') + ' (' + res.status + ')' + (data.error ? ' — ' + data.error : ''),
          res.status === 401 ? null : boot);
      }
      return data;
    }
    return data;
  }

  function refused(data) { toast((data && data.error) || tr('err.refused'), 'err'); }

  /* ---- names ------------------------------------------------------------ */

  /* What a language calls itself: its own `name` line once any answer has
     carried it, the browser's endonym before that, the code in brackets. */
  function langName(code) {
    if (state.names[code]) return state.names[code];
    try {
      var n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* a code Intl does not know */ }
    return code;
  }
  function langLabel(code) { return langName(code) + ' (' + code + ')'; }

  /* `helloAnon` or `who_h2` -> "Hello anon", "Who h2". The last resort, for a
     line the vocabulary below does not know yet. */
  function humanize(s) {
    return String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ').trim()
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /* ---- where a line lives, and what it is called ----------------------

     THE PAGES, in the order the site has them; the menu and the footer are
     one entry, as on the board. */
  var PAGE_ORDER = ['home', 'about', 'mission', 'values', 'resources', 'give', 'contact', 'stay',
                    'events', 'team', 'menu', 'coming', 'notFound', 'arcade', 'staff', 'emails', '_general'];

  function sectionOf(line) {
    if (line.source === 'emails') return 'emails';
    if (line.key.indexOf('.') === -1) return '_general';
    var s = line.key.split('.')[0];
    return s === 'nav' || s === 'footer' ? 'menu' : s;
  }
  function sectionLabel(s) {
    if (s === '_general') return tr('lbl.s.general');
    if (s === 'emails') return tr('tl.src.emails');
    return has('lbl.s.' + s) ? tr('lbl.s.' + s) : humanize(s);
  }

  /* NAMES ARE COMPOSED, NOT LISTED. The keys follow a pattern — a block
     (`who`) and a part (`h2`), or a page-level part (`cue`) — so a line is
     named "<block> · <part>", where the block's name is its OWN English
     heading line (`who_cue` is "The need") and the part comes from a short
     vocabulary. A line added next month is named without anybody writing a
     label for it; only a new KIND of part needs a word. */
  var PART_KEY = {
    img_tag: 'lbl.p.img_tag', placeholder: 'lbl.p.placeholder', title: 'lbl.p.title', cue: 'lbl.p.cue',
    h1: 'lbl.p.h1', h2: 'lbl.p.h2', line: 'lbl.p.line', sub: 'lbl.p.intro', lede: 'lbl.p.intro',
    text: 'lbl.p.text', body: 'lbl.p.body', label: 'lbl.p.label', link: 'lbl.p.link', word: 'lbl.p.word',
    ipa: 'lbl.p.ipa', def: 'lbl.p.def', note: 'lbl.p.note', cta: 'lbl.p.cta', hint: 'lbl.p.tip'
  };
  var PARTS = Object.keys(PART_KEY).sort(function (a, b) { return b.length - a.length; });
  var PART_RE = PARTS.map(function (p) { return { p: p, re: new RegExp('^(?:(.+)_)?' + p + '(\\d*)$') }; });

  function english(key) {
    var l = state.byId['site:' + key];
    return l ? l.english : '';
  }
  function short(s) { s = String(s || ''); return s.length > 40 ? s.slice(0, 38).trim() + '…' : s; }

  function partLabel(part, inBlock, n) {
    if (part === 'cue') return tr(inBlock ? 'lbl.p.cue' : 'lbl.p.cueTop');
    if (part === 'title') return tr(inBlock ? 'lbl.p.blockTitle' : 'lbl.p.title');
    if (PART_KEY[part]) return fill(PART_KEY[part], { n: n || '' }).replace(/\s+$/, '');
    return humanize(part);
  }
  function blockName(section, block) {
    return short(english(section + '.' + block + '_cue')) ||
      short(english(section + '.' + block + '_title')) ||
      (has('lbl.b.' + block) ? tr('lbl.b.' + block) : humanize(block));
  }

  var EMAIL_PART = { subjectHint: 'subjectEmpty', messageHint: 'messageEmpty' };
  function emailLabel(key) {
    var b = key.split('.')[0], p = key.split('.')[1] || '';
    var pk = EMAIL_PART[p] || p;
    var part = has('lbl.m.' + b + '.' + pk) ? tr('lbl.m.' + b + '.' + pk)
      : has('lbl.m.' + pk) ? tr('lbl.m.' + pk) : humanize(p);
    return (has('lbl.e.' + b) ? tr('lbl.e.' + b) : humanize(b)) + ' · ' + part;
  }

  function labelFor(row) {
    if (row.source === 'emails') return emailLabel(row.key);
    var dot = row.key.indexOf('.');
    if (dot === -1) return row.key === 'name' ? tr('lbl.p.name') : humanize(row.key);
    var section = row.key.slice(0, dot), rest = row.key.slice(dot + 1);

    /* A list: `values.items.2.title` is named by that item's own title;
       an item with no title is its list's name and number. */
    var arr = rest.match(/^([A-Za-z_]+)\.(\d+)(?:\.([A-Za-z_]+))?$/);
    if (arr) {
      var n = Number(arr[2]) + 1;
      if (arr[3]) {
        var name = short(english(section + '.' + arr[1] + '.' + arr[2] + '.title')) || humanize(arr[1]) + ' ' + n;
        return name + ' · ' + partLabel(arr[3], true);
      }
      return has('lbl.b.' + arr[1]) ? fill('lbl.b.' + arr[1], { n: n }) : humanize(arr[1]) + ' ' + n;
    }

    for (var i = 0; i < PART_RE.length; i++) {
      var m = rest.match(PART_RE[i].re);
      if (m) {
        return m[1] ? blockName(section, m[1]) + ' · ' + partLabel(PART_RE[i].p, true, m[2])
                    : partLabel(PART_RE[i].p, false, m[2]);
      }
    }
    /* No known part: the first word is the block (`door_crisis` is the
       "crisis" line of the doors), the rest is its own name. */
    var us = rest.indexOf('_');
    return us === -1 ? humanize(rest) : blockName(section, rest.slice(0, us)) + ' · ' + humanize(rest.slice(us + 1));
  }

  /* ---- rows ------------------------------------------------------------- */

  function buildRows() {
    state.byId = {};
    state.lines.forEach(function (l) { state.byId[l.id] = l; });
    var used = {}, rows = [];
    state.lines.forEach(function (l) {
      if (used[l.id]) return;
      var m = l.key.match(/^(.*)_(thin|bold)$/);
      if (m) {
        var thin = state.byId[l.source + ':' + m[1] + '_thin'];
        var bold = state.byId[l.source + ':' + m[1] + '_bold'];
        if (thin && bold) {
          used[thin.id] = used[bold.id] = true;
          rows.push({ id: 'split:' + l.source + ':' + m[1], split: true, source: l.source,
                      key: m[1], thin: thin, bold: bold, lines: [thin, bold] });
          return;
        }
      }
      used[l.id] = true;
      rows.push({ id: l.id, source: l.source, key: l.key, line: l, lines: [l] });
    });
    rows.forEach(function (r) { r.label = labelFor(r); r.section = sectionOf(r.lines[0]); });
    state.rows = rows;
  }

  var isEn = function () { return state.lang === 'en'; };
  function rowStatus(row) {
    var st = row.lines.map(function (l) { return l.status; });
    return st.indexOf('missing') !== -1 ? 'missing' : st.indexOf('outdated') !== -1 ? 'outdated' : 'done';
  }
  function needsWork(row) { return !isEn() && rowStatus(row) !== 'done'; }
  function lineDirty(l) { return state.draft[l.id] !== state.saved[l.id]; }
  function rowDirty(row) { return row.lines.some(lineDirty); }
  function dirtyIds() {
    return state.lines.filter(lineDirty).map(function (l) { return l.id; });
  }

  function orderedSections() {
    var seen = [];
    state.rows.forEach(function (r) { if (seen.indexOf(r.section) === -1) seen.push(r.section); });
    return PAGE_ORDER.filter(function (s) { return seen.indexOf(s) !== -1; })
      .concat(seen.filter(function (s) { return PAGE_ORDER.indexOf(s) === -1; }));
  }

  /* ---- loading -------------------------------------------------------- */

  /* EVERYTHING THE FIRST DRAW NEEDS, ASKED FOR AT ONCE. The settings, the
     notes and the words of the language you were last writing each cost a
     trip to GitHub (about 100–140ms, measured); asked one after another
     they were most of the second the page took to appear. The language is
     guessed from last time and checked against the list when it arrives. */
  async function boot() {
    var remembered = null;
    try { remembered = localStorage.getItem('thauma.content.lang'); } catch (e) { /* private mode */ }
    var guess = state.lang || remembered || 'en';
    var both = await Promise.all([
      send(CONTENT + '?file=site'),
      send(NOTES, 'GET', null, true),
      send(WORDS + '?lang=' + encodeURIComponent(guess), 'GET', null, true)
    ]);
    var site = both[0], notes = both[1], words = both[2];
    if (!site || site.failed) return;
    if (site.configured === false) return notConfigured(site.reason || site.error || '');
    takeSite(site);
    if (notes && !notes.failed) takeNotes(notes);

    var want = state.langs.indexOf(guess) !== -1 ? guess : state.langs[0];
    fillPickers();
    $('cLang').disabled = false;
    $('cLangs').disabled = false;
    await openLang(want, false, want === guess && words && !words.failed ? words : null);
    loadSummary();               // names and progress, after the first draw
  }

  function takeSite(site) {
    state.site = site.data;
    state.siteSha = site.sha;
    state.langs = (site.data && site.data.languages) || ['en'];
  }

  /* Every language's progress and its own name, in one answer. Not awaited:
     the page is usable before it arrives, and it only fills in. */
  async function loadSummary() {
    var data = await send(WORDS + '?summary', 'GET', null, true);
    if (!data || data.failed) return;
    state.summary = {};
    (data.languages || []).forEach(function (l) {
      state.summary[l.code] = l;
      if (l.name && l.name !== l.code) state.names[l.code] = l.name;
    });
    fillPickers();
    if (!$('cSet').hidden) renderTable();
  }

  function notConfigured(reason) {
    var el = $('cNotConfigured');
    el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(reason);
    el.hidden = false;
    $('cRoot').hidden = true;
    document.querySelector('.c-tools').hidden = true;
  }

  function fillPickers() {
    /* Adding a language is the last choice in the list of languages, where
       somebody looking for one that is not there is already looking. */
    $('cLang').innerHTML = state.langs.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langLabel(c)) + '</option>';
    }).join('') + '<option value="' + ADD + '">' + esc(tr('con.addLang')) + '…</option>';
    $('cLang').value = state.lang || state.langs[0];

    var others = state.langs.filter(function (c) { return c !== state.lang; });
    if (others.indexOf(state.beside) === -1) state.beside = others.indexOf('en') !== -1 ? 'en' : others[0];
    $('cBeside').innerHTML = others.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + '</option>';
    }).join('');
    $('cBeside').value = state.beside || '';
    /* English too has a Reference (Chase, 2026-09-28): writing the source,
       it helps to see what a translation already says. */
    $('cBesideWrap').hidden = !others.length;
  }

  async function openLang(code, keepView, already) {
    var data = already || await send(WORDS + '?lang=' + encodeURIComponent(code));
    if (!data || data.failed) { $('cLang').value = state.lang || ''; return false; }
    state.lang = code;
    if (data.name && data.name !== code) state.names[code] = data.name;
    state.lines = data.lines || [];
    state.saved = {}; state.draft = {}; state.blocked = {};
    state.lines.forEach(function (l) { state.saved[l.id] = l.current; state.draft[l.id] = l.current; });
    buildRows();
    try { localStorage.setItem('thauma.content.lang', code); } catch (e) { /* private mode */ }

    /* Where to start: what needs doing, if anything does; otherwise the first
       page — or, after a save, wherever you were. */
    if (!keepView || !viewExists(state.view)) {
      /* Where you were, if this language has it — a reload returns there
         (Chase, 2026-09-27) — otherwise what needs doing, otherwise the
         first page. */
      var was = null;
      try { was = sessionStorage.getItem('thauma.content.view.' + code); } catch (e) { /* private mode */ }
      state.view = viewExists(was) ? was
        : state.rows.some(needsWork) ? 'needs' : 'section:' + (orderedSections()[0] || '_general');
    }
    fillPickers();
    await loadBeside();
    $('cRoot').hidden = !!state.review;
    render();
    return true;
  }

  /* The language shown above each line. English comes with every answer;
     another language is read once and kept. */
  async function loadBeside() {
    var b = state.beside;
    if (!b || b === 'en' || state.besideLines[b]) return;
    var data = await send(WORDS + '?lang=' + encodeURIComponent(b), 'GET', null, true);
    if (!data || data.failed) return;
    var map = {};
    (data.lines || []).forEach(function (l) { map[l.id] = l.current; });
    state.besideLines[b] = map;
  }
  function besideText(line) {
    if (state.beside === 'en') return line.english;
    /* Not read yet: nothing, rather than English beside English. */
    if (!state.besideLines[state.beside]) return '';
    return state.besideLines[state.beside][line.id] || '';
  }

  function viewExists(v) {
    if (!v) return false;
    if (v === 'all') return true;
    if (v === 'needs') return state.rows.some(needsWork);
    return state.rows.some(function (r) { return 'section:' + r.section === v; });
  }

  /* ---- drawing -------------------------------------------------------- */

  function visible() {
    if (state.find) {
      var q = state.find.toLowerCase();
      return state.rows.filter(function (r) {
        return r.label.toLowerCase().indexOf(q) >= 0 || r.key.toLowerCase().indexOf(q) >= 0 ||
          r.lines.some(function (l) {
            return String(state.draft[l.id]).toLowerCase().indexOf(q) >= 0 ||
              l.english.toLowerCase().indexOf(q) >= 0;
          });
      });
    }
    if (state.view === 'all') return state.rows;
    if (state.view === 'needs') return state.rows.filter(needsWork);
    return state.rows.filter(function (r) { return 'section:' + r.section === state.view; });
  }
  function visibleLineIds() {
    var ids = [];
    visible().forEach(function (r) { r.lines.forEach(function (l) { ids.push(l.id); }); });
    return ids;
  }

  function render() {
    renderSections();
    renderRows();
    renderMore();
    renderSaveBar();
    previewSync();
  }

  /* ---- the live preview -------------------------------------------------
     Chase, 2026-10-07 (asked for beside the words, "like the Site Editor"):
     the page these words are on, in the language being written, with what
     is typed shown in it before it is saved. The site marks each of its
     words with the key it came from (<span data-k>, site-rich.js); a
     change is drawn into those with the very function the build uses
     (SiteRich.richHtml), so the preview and the page cannot disagree.
     Focusing a line scrolls the preview to it and lights it up. */
  var PAGE_OF = { home: '', about: 'about/', mission: 'mission/', values: 'values/', resources: 'resources/',
    give: 'give/', contact: 'contact/', events: 'events/', team: 'team/', coming: 'coming-soon/' };
  var prev = { on: false, url: null, device: 'wide', section: null };
  try { prev.on = localStorage.getItem('thauma.pages.preview') === '1'; } catch (e) { /* private mode */ }
  function prevSection() {
    if (prev.section) return prev.section;
    var v = state.view || '';
    return v.indexOf('section:') === 0 ? v.slice(8) : 'home';
  }
  function prevUrl() {
    var sec = prevSection();
    return '/' + (state.lang || 'en') + '/' + (PAGE_OF[sec] != null ? PAGE_OF[sec] : '');
  }
  function prevDoc() {
    var f = $('cPrevFrame');
    try { return f && f.contentDocument; } catch (e) { return null; }
  }
  /* One line's words, drawn wherever the page shows them. */
  function prevDraw(id) {
    var doc = prevDoc(), line = state.byId[id];
    if (!doc || !line || line.source !== 'site' || !window.SiteRich) return;
    [].forEach.call(doc.querySelectorAll('[data-k="' + line.key + '"]'), function (el) {
      el.innerHTML = window.SiteRich.richHtml(state.draft[id]);
    });
  }
  function prevDrawAll() { dirtyIds().forEach(prevDraw); }
  function prevShow(id) {
    var doc = prevDoc(), line = state.byId[id];
    if (!doc || !line) return;
    var el = doc.querySelector('[data-k="' + line.key + '"]');
    [].forEach.call(doc.querySelectorAll('.c-prev-on'), function (x) { x.classList.remove('c-prev-on'); });
    if (!el) return;
    el.classList.add('c-prev-on');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  /* DESKTOP IS A DESKTOP: the page drawn at 1280px and scaled to the room
     there is, rather than a narrow window that gets the phone's layout. */
  function prevFit() {
    var box = $('cPreview') && $('cPreview').querySelector('.c-prev-frame'), f = $('cPrevFrame');
    if (!box || !f) return;
    if (prev.device === 'phone') { f.style.width = ''; f.style.height = ''; f.style.transform = ''; return; }
    var k = Math.min(1, box.clientWidth / 1280);
    f.style.width = '1280px';
    f.style.height = Math.round(box.clientHeight / k) + 'px';
    f.style.transform = 'scale(' + k + ')';
  }
  window.addEventListener('resize', function () { if (prev.on) prevFit(); });
  function previewSync() {
    var box = $('cPreview');
    if (!box) return;
    $('cRoot').classList.toggle('has-preview', prev.on);
    box.hidden = !prev.on;
    $('cPrevBtn').setAttribute('aria-pressed', prev.on ? 'true' : 'false');
    if (!prev.on) return;
    prevFit();
    var url = prevUrl();
    if (url !== prev.url) {
      prev.url = url;
      $('cPrevUrl').textContent = url;
      $('cPrevOpen').href = url;
      $('cPrevGone').hidden = true;
      $('cPrevFrame').src = url;
    } else prevDrawAll();
  }
  if ($('cPreview')) {
    $('cPrevFrame').addEventListener('load', function () {
      var doc = prevDoc();
      /* A page this build does not have (a coming-soon site builds only its
         landing page): said, not shown as a blank. */
      var missing = !doc || !doc.querySelector('[data-k]') || /404/.test(doc.title || '');
      $('cPrevGone').hidden = !missing;
      if (!doc) return;
      var st = doc.createElement('style');
      st.textContent = '.c-prev-on{outline:2px solid #2FD8FF;outline-offset:6px;border-radius:3px;transition:outline-color .3s}';
      doc.head.appendChild(st);
      prevDrawAll();
    });
    $('cPrevBtn').addEventListener('click', function () {
      prev.on = !prev.on;
      try { localStorage.setItem('thauma.pages.preview', prev.on ? '1' : '0'); } catch (e) { /* private mode */ }
      previewSync();
    });
    [].forEach.call(document.querySelectorAll('[data-prev-dev]'), function (b) {
      b.addEventListener('click', function () {
        prev.device = b.getAttribute('data-prev-dev');
        $('cPreview').setAttribute('data-device', prev.device);
        prevFit();
        [].forEach.call(document.querySelectorAll('[data-prev-dev]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    /* A line from another page (a search, Needs work) shows its own page. */
    $('cRows').addEventListener('focusin', function (e) {
      if (!prev.on) return;
      var rowEl = e.target.closest && e.target.closest('.c-row');
      var row = rowEl && state.rows.filter(function (r) { return r.id === rowEl.getAttribute('data-row'); })[0];
      if (!row) return;
      var sec = PAGE_OF[row.section] != null ? row.section : 'home';
      if (sec !== prevSection()) { prev.section = sec; previewSync(); setTimeout(function () { prevShow(row.lines[0].id); }, 700); return; }
      prevShow(row.lines[0].id);
    });
  }

  function renderSections() {
    var counts = {};
    orderedSections().forEach(function (s) { counts[s] = { n: 0, needs: 0, dirty: 0 }; });
    state.rows.forEach(function (r) {
      var c = counts[r.section];
      c.n++;
      if (needsWork(r)) c.needs++;
      if (rowDirty(r)) c.dirty++;
    });
    var needs = state.rows.filter(needsWork).length;
    var on = state.find ? null : state.view;

    function button(view, label, n, extra, dirty) {
      return '<button type="button" class="c-sec' + (view === on ? ' is-on' : '') + (dirty ? ' is-dirty' : '') +
        '" data-view="' + esc(view) + '"' + (view === on ? ' aria-current="true"' : '') + '>' +
        '<span class="c-sec-n">' + esc(label) + '</span>' +
        '<span class="c-sec-c tnum">' + n + '</span>' + (extra || '') + '</button>';
    }

    $('cSections').innerHTML =
      (needs ? button('needs', tr('con.needsWork'), needs, '', false) : '') +
      button('all', tr('con.all'), state.rows.length, '', false) +
      '<span class="c-sec-rule" aria-hidden="true"></span>' +
      orderedSections().map(function (s) {
        var c = counts[s];
        return button('section:' + s, sectionLabel(s), c.n,
          c.needs ? '<span class="c-sec-empty">' + c.needs + '</span>' : '', c.dirty);
      }).join('');
  }

  /* FORMATTED WORDS (2026-10-07, Chase: "allowing the text controls that the
     Site Creator has … AND also the idea of having the times when a new line
     is started defined in the text box itself"). A page's words are a
     formatted box with the Site Creator's bar (rich-text.js): bold, italic,
     underline, a link, a size, a color, and Enter for a new line, which is
     where the page breaks it (src/js/site-rich.js). Email and form words stay plain:
     an email cannot show the page's formatting. */
  var RT = window.RichText;
  function isRich(r) { return !!RT && r.source === 'site'; }
  /* A box's words as stored: the bar's markup, with its own escaping of
     text undone so a plain word saves exactly as it was typed. */
  function boxWords(box) {
    return RT.from(box).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  function wordsHtml(v) { return RT ? RT.html(v, true) : esc(v); }
  /* A heading is stored in two halves and printed `light <b>bold</b>`: the
     box shows that and reads it back — everything before its first bold
     word is the light half, everything from there on the bold half. A
     line break typed between them is kept at the end of the light half. */
  function splitHtml(thin, bold) {
    thin = String(thin || '').replace(/[ \t]+$/, ''); bold = String(bold || '').replace(/^[ \t]+/, '');
    var gap = thin && bold && !/\n$/.test(thin) ? ' ' : '';
    return wordsHtml(thin) + gap + (bold ? '<b>' + wordsHtml(bold) + '</b>' : '');
  }

  function rowHtml(r) {
    /* In a view that mixes pages — Needs work, All, a search — "Intro" alone
       does not say which page; there the page leads the name. */
    var mixed = !!state.find || state.view === 'needs' || state.view === 'all';
    var name = mixed && r.section !== '_general' ? sectionLabel(r.section) + ' · ' + r.label : r.label;
    var dirty = rowDirty(r);
    var mark = needsWork(r) && !dirty ? rowStatus(r) : '';
    var blocked = r.lines.some(function (l) { return state.blocked[l.id]; });
    var lang = esc(state.lang);
    var aria = esc(r.label + ' — ' + langName(state.lang));
    var ref = '';
    if (state.beside && state.beside !== state.lang) {
      var bl = esc(state.beside || 'en');
      ref = r.split
        ? '<p class="c-ref" lang="' + bl + '">' + splitHtml(besideText(r.thin), besideText(r.bold)) + '</p>'
        : '<p class="c-ref" lang="' + bl + '">' + (isRich(r) ? (RT ? RT.html(besideText(r.line), false) : esc(besideText(r.line))) : esc(besideText(r.line))) + '</p>';
    }
    var field = r.split
      ? '<div class="rt c-rt c-splitbox" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" lang="' + lang + '"' +
          ' data-rt="split" data-thin="' + esc(r.thin.id) + '" data-bold="' + esc(r.bold.id) + '" aria-label="' + aria + '">' +
          splitHtml(state.draft[r.thin.id], state.draft[r.bold.id]) + '</div>'
      : isRich(r)
        ? '<div class="rt c-rt" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" lang="' + lang + '"' +
            ' data-rt="one" data-id="' + esc(r.line.id) + '" aria-label="' + aria + '">' + wordsHtml(state.draft[r.line.id]) + '</div>'
        : '<textarea rows="1" data-id="' + esc(r.line.id) + '" lang="' + lang + '" spellcheck="true"' +
            ' aria-label="' + aria + '">' + esc(state.draft[r.line.id]) + '</textarea>';
    return '<div class="c-row' + (dirty ? ' is-dirty' : '') + (mark ? ' is-' + mark : '') +
        (blocked ? ' is-blocked' : '') + '" data-row="' + esc(r.id) + '">' +
      '<div class="c-key">' +
        '<span class="c-name">' + esc(name) + '</span>' +
        '<code>' + esc(r.split ? r.key + '_thin + _bold' : r.key) + '</code>' +
        (mark ? '<span class="tl-st is-' + mark + '">' + esc(tr('tl.status.' + mark)) + '</span>' : '') +
        (dirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
      '</div>' + ref + field +
    '</div>';
  }

  function renderRows() {
    var rows = visible();
    $('cCount').textContent = state.find ? rows.length + ' ' + tr('con.matches') : '';
    /* THE CONTACT PAGE'S FORM: its words are here, like the rest of the
       page; where its messages go is Website › Forms. */
    var forms = !state.find && state.view === 'section:contact'
      ? '<a class="up-share-link c-formslink" href="/admin/website/forms/" data-web-go="forms">' +
          esc(tr('con.formsLink')) + '</a>' : '';
    $('cRows').innerHTML = forms + (rows.length ? rows.map(rowHtml).join('')
      : '<p class="empty">' + esc(tr('con.noMatches')) + '</p>');
    $('cRows').querySelectorAll('textarea').forEach(autosize);
  }

  function renderMore() {
    /* The file and the upload are for translating, so English has neither. */
    var n = visibleLineIds().length;
    $('cDown').hidden = isEn();
    $('cUp').hidden = isEn();
    $('cDown').textContent = n === 1 ? tr('con.download1') : fill('con.downloadN', { n: n });
    $('cDown').disabled = !n || !!state.review;
    $('cUp').disabled = !!state.review;
  }

  function autosize(ta) {
    if (window.CSS && CSS.supports && CSS.supports('field-sizing', 'content')) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 420) + 'px';
  }

  function renderSaveBar() {
    var d = dirtyIds();
    $('cSaveBar').hidden = !d.length;
    document.body.classList.toggle('has-savebar', !!d.length);
    if (!d.length) return;
    $('cDirtyCount').textContent = d.length === 1 ? tr('con.oneChange') : d.length + ' ' + tr('con.nChanges');
  }

  /* After an edit, the row's own marks change without a redraw — a redraw
     would take the focus out of the box being typed into. */
  function markRow(el) {
    var rowEl = el.closest('.c-row');
    var row = state.rows.filter(function (r) { return r.id === rowEl.getAttribute('data-row'); })[0];
    if (!row) return;
    row.lines.forEach(function (l) { delete state.blocked[l.id]; });
    var dirty = rowDirty(row);
    rowEl.classList.toggle('is-dirty', dirty);
    rowEl.classList.remove('is-blocked');
    /* Being written now says more than having been missing or outdated. */
    var mark = needsWork(row) ? rowStatus(row) : '';
    rowEl.classList.toggle('is-' + mark, !!mark && !dirty);
    var badge = rowEl.querySelector('.c-key .tl-st');
    if (badge) badge.hidden = dirty;
    renderSaveBar();
    renderSections();
  }

  /* ---- editing -------------------------------------------------------- */

  $('cRows').addEventListener('input', function (e) {
    var t = e.target;
    if (t.tagName === 'TEXTAREA') {
      state.draft[t.getAttribute('data-id')] = t.value;
      autosize(t);
      prevDraw(t.getAttribute('data-id'));
      return markRow(t);
    }
    var box = t.closest && t.closest('.c-rt');
    if (!box) return;
    if (box.hasAttribute('data-thin')) {
      var parts = readSplit(box);
      state.draft[box.getAttribute('data-thin')] = parts.thin;
      state.draft[box.getAttribute('data-bold')] = parts.bold;
      prevDraw(box.getAttribute('data-thin')); prevDraw(box.getAttribute('data-bold'));
    } else {
      state.draft[box.getAttribute('data-id')] = boxWords(box);
      prevDraw(box.getAttribute('data-id'));
    }
    markRow(box);
  });

  function readSplit(box) {
    var all = boxWords(box), at = all.indexOf('<b>');
    if (at === -1) return { thin: all.replace(/[ \t]+$/, ''), bold: '' };
    return { thin: all.slice(0, at).replace(/[ \t]+$/, ''), bold: all.slice(at).replace(/<\/?b>/g, '').replace(/^[ \t]+/, '') };
  }

  /* Enter is a new line, never a new paragraph block; a paste brings the
     words (and their line breaks), not another page's formatting. */
  $('cRows').addEventListener('keydown', function (e) {
    var box = e.target.closest && e.target.closest('.c-rt');
    if (!box || e.key !== 'Enter') return;
    e.preventDefault();
    document.execCommand('insertLineBreak');
  });
  $('cRows').addEventListener('paste', function (e) {
    var box = e.target.closest && e.target.closest('.c-rt');
    if (!box) return;
    e.preventDefault();
    var text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    if (document.execCommand) document.execCommand('insertText', false, text);
  });
  /* Leaving a heading shows it as it will be saved: where its bold half
     really begins. */
  $('cRows').addEventListener('focusout', function (e) {
    var box = e.target.closest && e.target.closest('.c-splitbox');
    if (!box) return;
    var html = splitHtml(state.draft[box.getAttribute('data-thin')], state.draft[box.getAttribute('data-bold')]);
    if (box.innerHTML !== html) box.innerHTML = html;
  });

  function openView(view) {
    state.view = view;
    prev.section = null;
    try { sessionStorage.setItem('thauma.content.view.' + state.lang, state.view); } catch (e2) { /* private mode */ }
    // A page and a search are two ways of choosing what is on screen;
    // leaving both on shows neither.
    if (state.find) { state.find = ''; $('cFind').value = ''; }
    renderSections(); renderRows(); renderMore();
  }
  $('cSections').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) openView(b.getAttribute('data-view'));
  });
  /* Another tab asking for one page's words — Forms' "Its words → Pages ›
     Contact" (admin-website.js). */
  document.addEventListener('content:section', function (e) {
    if (state.rows && viewExists('section:' + e.detail)) openView('section:' + e.detail);
  });

  var findTimer = null;
  $('cFind').addEventListener('input', function (e) {
    clearTimeout(findTimer);
    var v = e.target.value.trim();
    findTimer = setTimeout(function () {
      state.find = v;
      renderSections(); renderRows(); renderMore();
    }, 150);
  });

  /* Leaving unsaved words behind is a choice, never a silent one. */
  async function mayLeave() {
    var n = dirtyIds().length;
    if (!n) return true;
    return window.StaffConfirm({
      title: tr('con.leaveTitle'),
      body: fill('con.leaveBody', { n: n, lang: langLabel(state.lang) }),
      confirm: tr('con.leaveDiscard'), cancel: tr('ms.cancel'), danger: true
    });
  }

  $('cLang').addEventListener('change', async function (e) {
    var next = e.target.value;
    e.target.value = state.lang;
    if (next === ADD) return addLanguage();
    if (!(await mayLeave())) return;
    if (state.review) closeReview();
    await openLang(next);
  });

  $('cBeside').addEventListener('change', async function (e) {
    state.beside = e.target.value;
    await loadBeside();
    renderRows();
  });

  $('cDiscard').addEventListener('click', async function () {
    var n = dirtyIds().length;
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: tr('con.discardTitle'), body: fill('con.discardBody', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.lines.forEach(function (l) { state.draft[l.id] = state.saved[l.id]; });
    state.blocked = {};
    prev.url = null;
    render();
  });

  /* ---- More ------------------------------------------------------------
     The file for a translator, bringing one back, and reading the words
     again. A disclosure: a button showing buttons. */
  function setMore(open) {
    $('cMoreBtn').setAttribute('aria-expanded', open ? 'true' : 'false');
    $('cMore').parentNode.classList.toggle('is-open', open);
  }
  $('cMoreBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    setMore($('cMoreBtn').getAttribute('aria-expanded') !== 'true');
  });
  $('cMore').addEventListener('click', function () { setMore(false); });
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.c-more')) setMore(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('cMoreBtn').getAttribute('aria-expanded') === 'true') {
      setMore(false); $('cMoreBtn').focus();
    }
  });

  $('cReload').addEventListener('click', async function () {
    if (!state.lang) return;
    var n = dirtyIds().length;
    if (n) {
      var ok = await window.StaffConfirm({
        title: tr('con.reloadTitle'), body: fill('con.reloadBody', { n: n }),
        confirm: tr('con.reload'), cancel: tr('ms.cancel'), danger: true
      });
      if (!ok) return;
    }
    state.besideLines = {};
    if (await openLang(state.lang, true)) toast(tr('con.reloaded'), 'ok');
  });

  /* A save is a quiet commit — nothing is live before publishing — so it asks
     nothing. The server checks every line again: a lost {placeholder} is
     refused, and a line somebody else changed meanwhile is left as theirs. */
  $('cSave').addEventListener('click', async function () {
    var ids = dirtyIds();
    if (!ids.length) return;
    var btn = this;
    btn.disabled = true; $('cDiscard').disabled = true;
    var data = await send(WORDS, 'POST', { action: 'save', lang: state.lang, items: ids.map(function (id) {
      return { id: id, value: state.draft[id], was: state.saved[id] };
    }) });
    btn.disabled = false; $('cDiscard').disabled = false;
    if (!data) return;
    if (data.failed) {
      if (data.code === 'problems' && data.ids) {
        data.ids.forEach(function (id) { state.blocked[id] = true; });
        renderRows();
        return toast(tr('tl.problems'), 'err');
      }
      return refused(data);
    }
    var kept = {};
    ids.forEach(function (id) { kept[id] = state.draft[id]; });
    toast(fill('con.saved', { n: data.saved }), 'ok');
    var conflicts = data.conflicts || [];
    if (conflicts.length) toast(fill('tl.conflicts', { n: conflicts.length }), 'err');
    await openLang(state.lang, true);
    loadSummary();
    // A line left as somebody else's keeps what was typed, still unsaved.
    if (conflicts.length) {
      conflicts.forEach(function (id) { if (id in kept) state.draft[id] = kept[id]; });
      render();
    }
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirtyIds().length || state.review) { e.preventDefault(); e.returnValue = ''; }
  });

  /* Shown after loading hidden (admin-website.js): a text box measured while
     hidden measured nothing, so measure again. */
  document.addEventListener('web:panel', function (e) {
    if (e.detail === 'pages') $('cRows').querySelectorAll('textarea').forEach(autosize);
  });

  /* ---- the file for a translator, and what comes back ---------------- */

  $('cDown').addEventListener('click', async function () {
    var ids = visibleLineIds();
    if (!ids.length) return;
    var data = await send(WORDS, 'POST', { action: 'file', lang: state.lang, ids: ids });
    if (!data) return;
    if (data.failed) return refused(data);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data.text], { type: 'text/csv;charset=utf-8' }));
    a.download = data.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  $('cUp').addEventListener('click', function () { $('cFile').click(); });

  $('cFile').addEventListener('change', async function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';                  // so choosing the same file again fires
    if (!file) return;
    var text;
    try { text = await file.text(); }
    catch (err) { return toast(tr('tl.errFile'), 'err'); }

    var data = await send(WORDS, 'POST', { action: 'review', text: text });
    if (!data) return;
    if (data.failed) {
      if (data.code === 'no-language' && data.lang && data.lang !== 'en') {
        return toast(fill('tl.errLang', { lang: data.lang }), 'err');
      }
      if (data.code === 'not-a-file' || data.code === 'no-language') return toast(tr('tl.errFile'), 'err');
      return refused(data);
    }
    if (!data.items.length) return toast(tr('tl.nothingNew'), 'err');

    /* The file says which language it is for; it is reviewed under that one. */
    if (data.lang !== state.lang) {
      if (!(await mayLeave())) return;
      if (!(await openLang(data.lang))) return;
    }
    openReview(data);
  });

  function openReview(data) {
    state.review = {
      lang: data.lang,
      items: data.items.map(function (it) {
        var row = { source: it.source, key: it.key, lines: [{ source: it.source, key: it.key }] };
        return {
          id: it.id, source: it.source, key: it.key, english: it.english, label: labelFor(row),
          section: sectionOf(row.lines[0]),
          english_hash: it.english_hash, current: it.current, value: it.proposed,
          problems: it.problems, warnings: it.warnings,
          approved: !it.problems.length && !it.warnings.length, blocked: it.problems.length > 0
        };
      })
    };
    $('cRoot').hidden = true;
    $('tlReview').hidden = false;
    renderMore();
    renderReview();
    window.scrollTo(0, 0);
  }

  function closeReview() {
    state.review = null;
    $('tlReview').hidden = true;
    $('tlItems').innerHTML = '';
    $('cRoot').hidden = false;
    renderMore();
  }

  function renderReview() {
    var r = state.review;
    var sections = [];
    r.items.forEach(function (it) { if (sections.indexOf(it.section) === -1) sections.push(it.section); });
    function flag(kind) {
      return function (f) {
        return '<li class="is-' + kind + '">' + esc(fill('tl.flag.' + f.code, { detail: f.detail || '' })) + '</li>';
      };
    }
    $('tlItems').innerHTML = sections.map(function (s) {
      return '<h3 class="ln-h3">' + esc(sectionLabel(s)) + '</h3>' +
        r.items.filter(function (it) { return it.section === s; }).map(function (it) {
          var flags = it.problems.map(flag('problem')).concat(it.warnings.map(flag('warning')));
          return '<article class="tl-item' + (it.blocked ? ' is-blocked' : '') + (it.approved ? ' is-approved' : '') +
              '" data-item="' + esc(it.id) + '">' +
            '<label class="tl-approve"><input type="checkbox" data-approve' + (it.approved ? ' checked' : '') +
              (it.blocked ? ' disabled' : '') + ' aria-label="' + esc(fill('tl.approve', { n: it.label })) + '"></label>' +
            '<div class="tl-body">' +
              '<p class="tl-key">' + esc(it.label) + '</p>' +
              '<p class="tl-en" lang="en">' + esc(it.english) + '</p>' +
              (it.current
                ? '<p class="tl-now"><span class="tl-tag">' + esc(tr('tl.now')) + '</span>' +
                  '<span lang="' + esc(r.lang) + '">' + esc(it.current) + '</span></p>'
                : '') +
              '<label class="tl-new"><span class="tl-tag">' + esc(tr('tl.new')) + '</span>' +
                '<textarea rows="2" lang="' + esc(r.lang) + '" data-value>' + esc(it.value) + '</textarea></label>' +
              (flags.length ? '<ul class="tl-flags">' + flags.join('') + '</ul>' : '') +
            '</div>' +
          '</article>';
        }).join('');
    }).join('');
    $('tlItems').querySelectorAll('textarea').forEach(autosize);
    renderReviewBar();
  }

  function renderReviewBar() {
    var r = state.review;
    var n = r.items.filter(function (it) { return it.approved; }).length;
    $('tlReviewCount').textContent = fill('tl.review', { n: r.items.length }) + ' · ' + langLabel(r.lang);
    $('tlApprove').textContent = fill('tl.approve', { n: n });
    $('tlApprove').disabled = !n;
  }

  function itemFor(el) {
    var box = el.closest('[data-item]');
    if (!box || !state.review) return null;
    var id = box.getAttribute('data-item');
    for (var i = 0; i < state.review.items.length; i++) if (state.review.items[i].id === id) return state.review.items[i];
    return null;
  }

  $('tlItems').addEventListener('change', function (e) {
    if (!e.target.hasAttribute('data-approve')) return;
    var it = itemFor(e.target);
    if (!it) return;
    it.approved = e.target.checked;
    e.target.closest('[data-item]').classList.toggle('is-approved', it.approved);
    renderReviewBar();
  });

  /* Editing a flagged line is how it gets fixed, so an edit unblocks it; the
     server checks it again when it is approved. */
  $('tlItems').addEventListener('input', function (e) {
    if (!e.target.hasAttribute('data-value')) return;
    var it = itemFor(e.target);
    if (!it) return;
    it.value = e.target.value;
    autosize(e.target);
    if (it.blocked) {
      it.blocked = false;
      var box = e.target.closest('[data-item]');
      box.classList.remove('is-blocked');
      box.querySelector('[data-approve]').disabled = false;
    }
  });

  $('tlCancel').addEventListener('click', async function () {
    var ok = await window.StaffConfirm({
      title: tr('tl.discardReview'), confirm: tr('ln.discard'), cancel: tr('common.cancel')
    });
    if (ok) closeReview();
  });

  $('tlApprove').addEventListener('click', async function () {
    var r = state.review;
    if (!r) return;
    var items = r.items.filter(function (it) { return it.approved; }).map(function (it) {
      return { id: it.id, value: it.value, was: it.current, english_hash: it.english_hash };
    });
    if (!items.length) return;
    var btn = this;
    btn.disabled = true;
    var data = await send(WORDS, 'POST', { action: 'apply', lang: r.lang, items: items });
    btn.disabled = false;
    if (!data) return;
    if (data.failed) {
      if (data.code === 'problems' && data.ids) {
        data.ids.forEach(function (id) {
          var box = document.querySelector('#tlItems [data-item="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
          if (box) box.classList.add('is-blocked');
        });
        return toast(tr('tl.problems'), 'err');
      }
      return refused(data);
    }
    toast(fill('tl.saved', { n: data.saved }), 'ok');
    if (data.conflicts && data.conflicts.length) toast(fill('tl.conflicts', { n: data.conflicts.length }), 'err');
    closeReview();
    await openLang(state.lang, true);
    loadSummary();
  });

  /* ---- adding and removing a language --------------------------------- */

  var codeLooksValid = function (v) { return /^[a-z]{2}(-[a-z]{2})?$/.test(String(v || '').trim().toLowerCase()); };

  /* Picked BY NAME, from the languages people are likeliest to need — each
     named in itself, the way somebody who speaks it would look for it — with
     "Another language…" for a code the list does not have (mockup board 6). */
  var OFFERED = ['de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'cs', 'sk', 'sl', 'hu', 'ro', 'bg', 'mk', 'sq',
                 'bs', 'me', 'uk', 'ru', 'el', 'tr', 'lt', 'lv', 'et', 'fi', 'sv', 'no', 'da',
                 'ar', 'fa', 'he', 'hi', 'zh', 'ja', 'ko', 'sw', 'am'];

  async function addLanguage(code) {
    if (!(await mayLeave())) return;
    if (!code) {
      code = await window.StaffPrompt({
        title: tr('con.addLangTitle'),
        label: tr('con.addLangLabel'),
        placeholder: 'sl',
        confirm: tr('con.addLangDo'),
        cancel: tr('ms.cancel'),
        // Checked here for a quick answer and again on the server, which counts.
        validate: function (v) {
          v = String(v || '').trim().toLowerCase();
          if (!codeLooksValid(v)) return tr('con.addLangBadCode');
          if (state.langs.indexOf(v) !== -1) return tr('con.addLangExists');
          return null;
        }
      });
      if (!code) return;
    }
    var body = await send(CONTENT, 'POST', { code: code.trim().toLowerCase() });
    if (!body) return;
    if (body.failed) {
      /* A partial failure left a file behind and said so — a condition to act
         on, not an event that scrolls away. */
      if (body.partial && window.StaffProblem) return window.StaffProblem(body.error, null);
      return refused(body);
    }
    toast(fill('con.addLangDone', { code: langLabel(body.code), n: body.strings }), 'ok');
    var site = await send(CONTENT + '?file=site');
    if (site && !site.failed) takeSite(site);
    closeSettings();
    await openLang(body.code);
    loadSummary();
  }

  /* Same shape as deleting a partner: something that exists nowhere else
     stops existing. The count of what is lost is asked for first and shown in
     the question; the word is typed, and checked again on the server. */
  async function removeLanguage(code) {
    var info = await send(CONTENT + '?code=' + encodeURIComponent(code), 'DELETE');
    if (!info) return;
    // Anything but "needs confirmation" is a real refusal, and explains itself.
    if (!info.failed || info.translated === undefined) return refused(info);

    var ok = await window.StaffConfirm({
      title: fill('vis.removeTitle', { lang: langName(code) }),
      body: info.translated
        ? fill('vis.removeBody', { n: info.translated, lang: langName(code) })
        : fill('vis.removeEmpty', { lang: langName(code) }),
      type: 'DELETE', typeLabel: tr('pub.typeLabel'),
      confirm: tr('vis.removeDo'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    var body = await send(CONTENT + '?code=' + encodeURIComponent(code) + '&confirm=DELETE', 'DELETE');
    if (!body) return;
    if (body.failed) {
      if (body.partial && window.StaffProblem) return window.StaffProblem(body.error, null);
      return refused(body);
    }
    toast(fill('vis.removed', { lang: langName(code) }), 'ok');
    var site = await send(CONTENT + '?file=site');
    if (site && !site.failed) takeSite(site);
    delete state.summary[code];
    if (state.lang === code) await openLang('en'); else fillPickers();
    renderTable();
    loadSummary();
  }

  /* ---- every language, in one place ------------------------------------ */

  function siteValue(path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, state.site);
  }
  function setSiteValue(path, value) {
    var parts = path.split('.'), o = state.site;
    for (var i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
    o[parts[parts.length - 1]] = value;
  }

  /* One setting, saved as it is changed: a quiet commit to site.json. The
     SHA moves with each one, so the next is checked against it. */
  async function saveSetting(path, value) {
    var changes = {};
    changes[path] = value;
    var body = await send(CONTENT, 'PUT', { file: 'site', sha: state.siteSha, changes: changes });
    if (!body) return false;
    if (body.failed) {
      refused(body);
      var site = await send(CONTENT + '?file=site');       // read again rather than guess
      if (site && !site.failed) takeSite(site);
      renderTable();
      return false;
    }
    if (body.sha) state.siteSha = body.sha;
    setSiteValue(path, value);
    document.dispatchEvent(new CustomEvent('thauma:site-saved', { detail: { sha: state.siteSha, changes: changes, from: 'pages' } }));
    toast(tr('ln.saved'), 'ok');
    return true;
  }

  /* Another Website tab saved site.json (admin-website.js): take its version
     and values. Nothing here is a working copy — the languages table saves
     as it changes — so they simply apply. */
  document.addEventListener('thauma:site-saved', function (e) {
    var d = e.detail || {};
    if (d.from === 'pages' || !state.site) return;
    if (d.sha) state.siteSha = d.sha;
    Object.keys(d.changes || {}).forEach(function (p) { setSiteValue(p, d.changes[p]); });
    if (!$('cSet').hidden) renderTable();
  });

  function sw(path, on, label) {
    return '<button type="button" class="switch small" role="switch" data-set="' + esc(path) + '"' +
      ' aria-checked="' + (on ? 'true' : 'false') + '"' + (on ? ' data-on="1"' : '') +
      ' aria-label="' + esc(label) + '">' +
        '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
        '</span><span class="switch-knob"></span></span></button>';
  }

  function guideHtml(lang, label) {
    var ro = state.notesWrite ? '' : ' readonly';
    return '<div class="c-set-guide" data-guide="' + esc(lang) + '">' +
      '<label class="fld"><span>' + esc(label) + '</span>' +
        '<textarea rows="3" maxlength="2000"' + ro + ' lang="' + esc(lang === '*' ? 'en' : lang) + '">' +
        esc(state.notes.guides[lang] || '') + '</textarea></label>' +
      (state.notesWrite
        ? '<p class="ln-acts"><button type="button" class="ghost-btn" data-save-guide disabled>' +
          esc(tr('ln.saveGuide')) + '</button></p>'
        : '') +
    '</div>';
  }

  /* How a language is written, opened under its row. English's is the rules
     every translation follows: the words that stay as written, and the
     guide for all of them. */
  function notesHtml(code) {
    if (code === 'en') {
      return '<h4 class="ln-h3">' + esc(tr('ln.keep')) + '</h4>' +
        '<ul class="ln-chips">' + (state.notes.keep.length
          ? state.notes.keep.map(function (k) {
              return '<li class="ln-chip"><span>' + esc(k.term) + '</span>' +
                (state.notesWrite ? '<button type="button" class="ln-x" data-keep="' + esc(k.id) +
                  '" aria-label="' + esc(tr('ln.remove') + ' ' + k.term) + '">&times;</button>' : '') + '</li>';
            }).join('')
          : '<li class="ln-none">' + esc(tr('ln.none')) + '</li>') + '</ul>' +
        (state.notesWrite
          ? '<form class="ln-add" data-keep-add><input type="text" maxlength="80" autocomplete="off" placeholder="' +
            esc(tr('ln.keepAdd')) + '" aria-label="' + esc(tr('ln.keepAdd')) + '">' +
            '<button type="submit" class="ghost-btn">' + esc(tr('ln.add')) + '</button></form>'
          : '') +
        guideHtml('*', tr('ln.every'));
    }
    var rows = state.notes.glossary.filter(function (g) { return g.lang === code; });
    var ro = state.notesWrite ? '' : ' readonly';
    return guideHtml(code, tr('con.set.written')) +
      '<h4 class="ln-h3">' + esc(tr('ln.fixed')) + '</h4>' +
      '<table class="ln-table"><thead><tr><th scope="col">' + esc(tr('ln.english')) + '</th>' +
      '<th scope="col">' + esc(langName(code)) + '</th><th scope="col"><span class="visually-hidden">' +
      esc(tr('ln.remove')) + '</span></th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (g) {
        return '<tr data-gloss-row="' + esc(g.id) + '">' +
          '<td><input type="text" lang="en" maxlength="300" data-gl="source" value="' + esc(g.source) +
            '" aria-label="' + esc(tr('ln.english')) + '"' + ro + '></td>' +
          '<td><input type="text" lang="' + esc(code) + '" maxlength="300" data-gl="target" value="' + esc(g.target) +
            '" aria-label="' + esc(langName(code)) + '"' + ro + '></td>' +
          '<td>' + (state.notesWrite ? '<button type="button" class="ln-x" data-gloss="' + esc(g.id) +
            '" aria-label="' + esc(tr('ln.remove') + ' ' + g.source) + '">&times;</button>' : '') + '</td></tr>';
      }).join('') : '<tr><td colspan="3" class="ln-none">' + esc(tr('ln.none')) + '</td></tr>') +
      '</tbody></table>' +
      (state.notesWrite
        ? '<form class="ln-add ln-add-pair" data-gloss-add>' +
          '<input type="text" lang="en" maxlength="300" autocomplete="off" placeholder="' + esc(tr('ln.source')) +
            '" aria-label="' + esc(tr('ln.source')) + '" data-new="source">' +
          '<input type="text" lang="' + esc(code) + '" maxlength="300" autocomplete="off" placeholder="' +
            esc(tr('ln.target')) + '" aria-label="' + esc(tr('ln.target')) + '" data-new="target">' +
          '<button type="submit" class="ghost-btn">' + esc(tr('ln.add')) + '</button></form>'
        : '');
  }

  function renderTable() {
    var html = '<div class="lt" role="table" aria-label="' + esc(tr('con.languages')) + '">' +
      '<div class="lt-r lt-head" role="row">' +
        ['con.lt.language', 'con.lt.words', 'con.lt.preview', 'con.lt.everyone'].map(function (k) {
          return '<span role="columnheader">' + esc(tr(k)) + '</span>';
        }).join('') + '<span role="columnheader"></span></div>';

    state.langs.forEach(function (code) {
      var en = code === 'en';
      var vis = siteValue('visibility.languages.' + code) || {};
      var sum = state.summary[code];
      var done = sum && sum.total ? sum.total - (sum.missing || 0) : null;
      var pct = sum && sum.total ? Math.round(100 * done / sum.total) : 0;
      var open = state.openNotes === code;
      var sub = en ? tr('con.lt.source') : code + (vis.live === false ? ' · ' + tr('con.lt.notPublic') : '');
      html += '<div class="lt-r" role="row" data-lang="' + esc(code) + '">' +
        '<span role="cell" class="lt-name"><b>' + esc(langName(code)) + '</b><small>' + esc(sub) + '</small></span>' +
        '<span role="cell" class="lt-words">' + (sum
          ? '<span class="lt-bar"><i style="width:' + pct + '%"></i></span><small>' +
            esc(fill('con.lt.of', { done: done, total: sum.total })) + '</small>'
          : '<small>…</small>') + '</span>' +
        /* data-label: on a phone the header row is gone, and each cell
           carries its own heading instead. */
        '<span role="cell" data-label="' + esc(tr('con.lt.preview')) + '">' + (en ? '<small>' + esc(tr('con.lt.always')) + '</small>'
          : sw('visibility.languages.' + code + '.dev', !!vis.dev, langName(code) + ' — ' + tr('con.lt.preview'))) + '</span>' +
        '<span role="cell" data-label="' + esc(tr('con.lt.everyone')) + '">' + (en ? '<small>' + esc(tr('con.lt.always')) + '</small>'
          : sw('visibility.languages.' + code + '.live', !!vis.live, langName(code) + ' — ' + tr('con.lt.everyone'))) + '</span>' +
        '<span role="cell" class="lt-acts">' +
          '<button type="button" class="tl-more" data-notes="' + esc(code) + '" aria-expanded="' + open + '">' +
            esc(tr('con.lt.written')) + '</button>' +
          (en ? '' : '<button type="button" class="ghost-btn sm c-remove" data-remove="' + esc(code) + '">' +
            esc(tr('ln.remove')) + '</button>') +
        '</span>' +
      '</div>' +
      (open ? '<div class="lt-notes" data-notes-for="' + esc(code) + '">' + notesHtml(code) + '</div>' : '');
    });
    html += '</div>';

    var offered = OFFERED.filter(function (c) { return state.langs.indexOf(c) === -1; })
      .map(function (c) { return { c: c, n: langName(c) }; })
      .sort(function (a, b) { return a.n.localeCompare(b.n); });
    html += '<div class="lt-add">' +
      '<select id="ltAdd" aria-label="' + esc(tr('con.addLang')) + '"><option value="">' + esc(tr('con.lt.add')) + '</option>' +
        offered.map(function (o) { return '<option value="' + esc(o.c) + '">' + esc(o.n) + '</option>'; }).join('') +
        '<option value="' + ADD + '">' + esc(tr('con.lt.other')) + '</option></select>' +
      '<button type="button" class="ghost-btn" id="ltAddBtn" disabled>' + esc(tr('con.lt.addBtn')) + '</button>' +
    '</div>' +
    '<label class="lt-default fld"><span>' + esc(tr('con.lt.default')) + '</span>' +
      '<select data-default>' + state.langs.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === state.site.defaultLang ? ' selected' : '') + '>' +
          esc(langName(c)) + '</option>';
      }).join('') + '</select></label>';
    $('cSetBody').innerHTML = html;
  }

  var lastFocus = null;
  function openSettings() {
    renderTable();
    lastFocus = document.activeElement;
    var back = $('cSet');
    back.hidden = false;
    void back.offsetHeight;
    back.classList.add('in');
    $('cSetClose').focus();
    loadSummary();
  }
  function guidesDirty() {
    return [].some.call(document.querySelectorAll('#cSetBody [data-guide]'), function (box) {
      return box.querySelector('textarea').value !== (state.notes.guides[box.getAttribute('data-guide')] || '');
    });
  }
  async function closeSettings(ask) {
    var back = $('cSet');
    if (back.hidden) return;
    if (ask && guidesDirty()) {
      var ok = await window.StaffConfirm({
        title: tr('ln.discardGuide'), confirm: tr('ln.discard'), cancel: tr('common.cancel')
      });
      if (!ok) return;
    }
    back.classList.remove('in');
    setTimeout(function () { back.hidden = true; }, 200);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $('cLangs').addEventListener('click', openSettings);
  $('cSetClose').addEventListener('click', function () { closeSettings(true); });
  $('cSet').addEventListener('click', function (e) { if (e.target === $('cSet')) closeSettings(true); });
  document.addEventListener('keydown', function (e) {
    // Only when this dialog is on top; a confirmation opened from it closes first.
    if (e.key === 'Escape' && !$('cSet').hidden && !document.querySelector('.dlg-back:not(#cSet)')) closeSettings(true);
  });

  function takeNotes(data) {
    state.notes = { keep: data.keep || [], glossary: data.glossary || [], guides: data.guides || {} };
    state.notesWrite = !!data.can_write;
  }
  function notesLang(el) {
    var box = el.closest && el.closest('[data-notes-for]');
    return box ? box.getAttribute('data-notes-for') : null;
  }

  $('cSetBody').addEventListener('click', async function (e) {
    var t = e.target;
    var s = t.closest && t.closest('.switch[data-set]');
    if (s) {
      if (s.disabled) return;
      s.disabled = true;
      var path = s.getAttribute('data-set');
      if (await saveSetting(path, !siteValue(path))) renderTable(); else s.disabled = false;
      return;
    }
    var n = t.closest && t.closest('[data-notes]');
    if (n) {
      var code = n.getAttribute('data-notes');
      if (state.openNotes && state.openNotes !== code && guidesDirty()) {
        var ok = await window.StaffConfirm({ title: tr('ln.discardGuide'), confirm: tr('ln.discard'), cancel: tr('common.cancel') });
        if (!ok) return;
      }
      state.openNotes = state.openNotes === code ? null : code;
      renderTable();
      var again = $('cSetBody').querySelector('[data-notes="' + code + '"]');
      if (again) again.focus();
      return;
    }
    var rm = t.closest && t.closest('[data-remove]');
    if (rm) return removeLanguage(rm.getAttribute('data-remove'));
    if (t.id === 'ltAddBtn') {
      var v = $('ltAdd').value;
      return v ? addLanguage(v === ADD ? null : v) : null;
    }

    var save = t.closest && t.closest('[data-save-guide]');
    if (save) {
      var box = save.closest('[data-guide]');
      save.disabled = true;
      var saved = await send(NOTES, 'POST', { kind: 'guide', lang: box.getAttribute('data-guide'),
                                             guidance: box.querySelector('textarea').value });
      if (!saved || saved.failed) { save.disabled = false; if (saved) refused(saved); return; }
      takeNotes(saved);
      toast(tr('ln.saved'), 'ok');
      return;
    }
    var k = t.closest && t.closest('[data-keep]');
    var g = t.closest && t.closest('[data-gloss]');
    if (!k && !g) return;
    var data = await send(NOTES + (k ? '?kind=keep&id=' + encodeURIComponent(k.getAttribute('data-keep'))
                                     : '?kind=glossary&id=' + encodeURIComponent(g.getAttribute('data-gloss'))), 'DELETE');
    if (!data) return;
    if (data.failed) return refused(data);
    takeNotes(data);
    renderTable();
  });

  $('cSetBody').addEventListener('input', function (e) {
    var box = e.target.closest && e.target.closest('[data-guide]');
    if (!box || e.target.tagName !== 'TEXTAREA') return;
    var btn = box.querySelector('[data-save-guide]');
    if (btn) btn.disabled = e.target.value === (state.notes.guides[box.getAttribute('data-guide')] || '');
  });

  $('cSetBody').addEventListener('change', async function (e) {
    var t = e.target;
    if (t.id === 'ltAdd') { $('ltAddBtn').disabled = !t.value; return; }
    if (t.matches('[data-default]')) {
      if (!(await saveSetting('defaultLang', t.value))) renderTable();
      return;
    }
    if (t.matches('input[data-set]')) return saveSetting(t.getAttribute('data-set'), t.value.trim());
    if (!t.matches('[data-gl]')) return;
    var row = t.closest('tr');
    var source = row.querySelector('[data-gl="source"]').value;
    var target = row.querySelector('[data-gl="target"]').value;
    if (!source.trim() || !target.trim()) return renderTable();
    var data = await send(NOTES, 'POST', { kind: 'glossary', id: row.getAttribute('data-gloss-row'),
                                           lang: notesLang(t), source: source, target: target });
    if (!data || data.failed) { if (data) refused(data); return renderTable(); }
    takeNotes(data);
    toast(tr('ln.saved'), 'ok');
  });

  $('cSetBody').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target;
    var keepAdd = form.hasAttribute('data-keep-add');
    var data;
    if (keepAdd) {
      var term = form.querySelector('input').value.trim();
      if (!term) return form.querySelector('input').focus();
      data = await send(NOTES, 'POST', { kind: 'keep', term: term });
    } else if (form.hasAttribute('data-gloss-add')) {
      var src = form.querySelector('[data-new="source"]'), tgt = form.querySelector('[data-new="target"]');
      if (!src.value.trim()) return src.focus();
      if (!tgt.value.trim()) return tgt.focus();
      data = await send(NOTES, 'POST', { kind: 'glossary', lang: notesLang(form), source: src.value, target: tgt.value });
    } else return;
    if (!data) return;
    if (data.failed) return refused(data);
    takeNotes(data);
    renderTable();
    var again = $('cSetBody').querySelector(keepAdd ? '[data-keep-add] input' : '[data-new="source"]');
    if (again) again.focus();
  });

  boot();
})();
