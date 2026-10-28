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
    lines: [], byId: {}, rows: [], saved: {}, draft: {}, blocked: {}, waiting: {}, base: {}, changedSecs: {}, others: {},
    beside: 'en', besideLines: {},
    view: null, find: '',
    notes: { keep: [], glossary: [], guides: {} }, notesWrite: false, openNotes: null,
    review: null,
    /* THE PAGES AS SECTIONS (pageSections.json, /api/admin/sections): the
       arrangement on screen, as saved (a string, to compare), its SHA; which
       section each word belongs to; the section open, and its tab; words of
       parts added since the last save, in every language (`fresh`); photos
       chosen for a section's own frame, not saved yet. */
    doc: null, docSaved: null, docSha: null, keyAt: {}, idAt: {}, changedIds: {}, shown: {},
    open: null, sectab: 'words', fresh: {}, photos: {}, needIds: {}, structSaved: false
  };
  var SS = window.SiteSections;
  var SECTIONS_API = '/api/admin/sections';

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
        hideTools();
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
  /* The language's own name, not its code (Chase, 2026-10-08). */
  function langLabel(code) { return langName(code); }

  /* `helloAnon` or `who_h2` -> "Hello anon", "Who h2". The last resort, for a
     line the vocabulary below does not know yet. */
  function humanize(s) {
    return String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ').trim()
      .replace(/^./, function (c) { return c.toUpperCase(); });
  }

  /* ---- where a line lives, and what it is called ----------------------

     THE PAGES, in groups, in the order the site has them; the menu and the
     footer are one entry, as on the board. Every word a visitor can meet
     is on a page here (Chase, 2026-10-20: "including showing the pages
     that I don't see normally like the subscribed confirmation page"): the
     ones after a link in an email, the emails, the forms and widgets on
     other websites, and a ministry's own site — each its own page, where
     they were one long "Emails and forms". Their ids are `e:` and the
     words' first part (emailsAndForms.json), so the contact form on other
     websites is not taken for Thauma's own contact page. */
  var GROUPS = [
    ['site', ['home', 'about', 'mission', 'values', 'resources', 'give', 'contact', 'stay', 'events', 'team',
              'menu', 'arcade', 'coming', 'notFound', 'staff', '_general']],
    ['after', ['e:confirmed', 'e:unsub', 'e:back']],
    ['emails', ['e:confirm', 'e:receipt', 'e:brand', 'e:notify']],
    ['embeds', ['e:form', 'e:contact', 'e:widget', 'e:dates']],
    ['ministry', ['e:site', 'closed', 'e:app']]
  ];
  var PAGE_ORDER = [].concat.apply([], GROUPS.map(function (g) { return g[1]; }));
  function groupOf(sec) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][1].indexOf(sec) !== -1) return GROUPS[i][0];
    return sec.indexOf('e:') === 0 ? 'emails' : 'site';
  }

  function sectionOf(line) {
    /* A SECTION'S OWN WORDS (`blocks.<id>.…`) are on the page the section is on. */
    if (line.source === 'site' && line.key.indexOf('blocks.') === 0) {
      var at = state.idAt[line.key.split('.')[1]];
      return at ? at.page : '_unused';
    }
    /* THE CLOSED PAGE (a ministry site switched off; serve.js closedSite):
       its words live with the partner-site words, but it is a page of its
       own (Chase, 2026-10-19: "I don't see the Closed page in the Admin
       Website Pages tab") */
    if (line.source === 'emails' && /^site\.closed/.test(line.key)) return 'closed';
    if (line.source === 'emails') return 'e:' + line.key.split('.')[0];
    if (line.key.indexOf('.') === -1) return '_general';
    var s = line.key.split('.')[0];
    return s === 'nav' || s === 'footer' ? 'menu' : s;
  }
  function sectionLabel(s) {
    if (s === '_general') return tr('lbl.s.general');
    if (s.indexOf('e:') === 0) return has('lbl.s.e.' + s.slice(2)) ? tr('lbl.s.e.' + s.slice(2)) : humanize(s.slice(2));
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
    h1: 'lbl.p.h1', h2: 'lbl.p.h2', h: 'lbl.p.h2', line: 'lbl.p.line', sub: 'lbl.p.intro', lede: 'lbl.p.intro',
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

  /* A SECTION'S WORDS ARE NAMED FOR THEIR PART OF IT ("Heading",
     "Paragraph 2", "Point 3 · Title"), as the staff Site Creator names a
     section's fields; where pages are mixed, the section's kind leads. */
  function kindName(kind) { return tr('sec.kind.' + kind); }
  /* the word a part is called by: Home's line under its headline, and an
     introduction (the console's dictionary keeps "lede" out of its names) */
  function partWord(sec, f) { return sec.kind === 'homeHero' && f === 'text' ? 'under' : f === 'lede' ? 'intro' : f; }
  function partOf(sec, key) {
    var k = SS.KINDS[sec.kind], wd = sec.words || {}, base = key.replace(/_(thin|bold)$/, ''), i, j;
    for (i = 0; i < (k.words || []).length; i++) {
      var f = k.words[i];
      if (wd[f] === base || wd[f] === key) return tr('sec.part.' + partWord(sec, f));
    }
    if (k.list && wd[k.list]) {
      i = wd[k.list].indexOf(key);
      if (i !== -1) return fill('sec.part.' + k.list, { n: i + 1 });
    }
    if (wd.alt === key) return tr('sec.part.alt');
    if (wd.placeholder === key) return tr('sec.part.placeholder');
    for (i = 0; i < (sec.items || []).length; i++) {
      for (j = 0; j < (k.items || []).length; j++) {
        if (sec.items[i][k.items[j]] === key) return fill('sec.item.' + sec.kind, { n: i + 1 }) + ' · ' + tr('sec.part.i' + k.items[j]);
      }
    }
    for (i = 0; i < (sec.buttons || []).length; i++) {
      if (sec.buttons[i].label === key) return (sec.buttons.length > 1 ? fill('sec.part.buttonN', { n: i + 1 }) : tr('sec.part.button'));
    }
    return null;
  }
  function labelFor(row) {
    if (row.place && row.place.sec && state.idAt[row.place.sec]) {
      var sec = state.idAt[row.place.sec].sec, part = partOf(sec, row.lines[0].key);
      if (part) { row.part = part; return kindName(sec.kind) + ' · ' + part; }
    }
    if (row.source === 'emails') return emailLabel(row.key);
    if (/\.seo_title$/.test(row.key)) return tr('con.seoTitle');
    if (/\.seo_desc$/.test(row.key)) return tr('con.seoText');
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

  /* ---- which section a word is in --------------------------------------
     On a page made of sections, each word is named by one of them
     (site-sections.js keysOf). The page's own lines — its name in the
     browser's tab, how it shows in a search — are the page's; the rest of a
     page whose fixed part is drawn from elsewhere (the team, the form…) are
     that part's. A word no section names any more (a section taken away)
     is not on the page, and is not shown. */
  function takeDoc(doc) {
    state.doc = doc;
    state.keyAt = {}; state.idAt = {};
    Object.keys(doc.pages).forEach(function (page) {
      doc.pages[page].forEach(function (sec, i) {
        state.idAt[sec.id] = { page: page, sec: sec, at: i };
        SS.keysOf(sec).forEach(function (k) { state.keyAt[k] = sec.id; });
      });
    });
  }
  function isSectioned(page) { return !!(state.doc && state.doc.pages[page]); }
  /* The fixed part of a page that takes its leftover words (the team, the
     library…): one with no words of its own. */
  function leftoverOf(page) {
    var list = state.doc.pages[page] || [];
    for (var i = 0; i < list.length; i++) if (SS.KINDS[list[i].kind].fixed && !SS.KINDS[list[i].kind].words) return list[i].id;
    return null;
  }
  /* { page, sec } for a row on a page of sections, `sec` null for the page's
     own lines; `gone` for a word nothing names. */
  function placeOf(row) {
    var key = row.lines[0].key, sec = row.lines[0].source === 'site' ? state.keyAt[key] : null;
    var page = row.section;
    if (sec) return { page: state.idAt[sec].page, sec: sec };
    if (row.lines[0].source === 'site' && key.indexOf('blocks.') === 0) return { page: page, sec: null, gone: true };
    if (row.lines[0].source !== 'site' || !isSectioned(page)) return { page: page, sec: null };
    if (/\.(title|seo_title|seo_desc)$/.test(key) && key.split('.').length === 2) return { page: page, sec: null };
    var left = leftoverOf(page);
    return left ? { page: page, sec: left } : { page: page, sec: null, gone: true };
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
    rows.forEach(function (r) { r.section = sectionOf(r.lines[0]); r.place = placeOf(r); r.label = labelFor(r); });
    state.rows = rows.filter(function (r) { return !r.place.gone && r.section !== '_unused'; });
    state.shown = {};
    state.rows.forEach(function (r) { r.lines.forEach(function (l) { state.shown[l.id] = true; }); });
  }

  var isEn = function () { return state.lang === 'en'; };
  function rowStatus(row) {
    var st = row.lines.map(function (l) { return l.status; });
    return st.indexOf('missing') !== -1 ? 'missing' : st.indexOf('outdated') !== -1 ? 'outdated' : 'done';
  }
  function needsWork(row) { return !isEn() && rowStatus(row) !== 'done'; }
  function lineDirty(l) { return state.draft[l.id] !== state.saved[l.id]; }
  function rowDirty(row) { return row.lines.some(lineDirty); }
  /* Only words that are on a page: a word of a part taken away is not
     saved, whatever was typed into it. */
  function dirtyIds() {
    return state.lines.filter(function (l) { return state.shown[l.id] && lineDirty(l); }).map(function (l) { return l.id; });
  }

  function orderedSections() {
    var seen = [];
    state.rows.forEach(function (r) { if (seen.indexOf(r.section) === -1) seen.push(r.section); });
    /* the site's own pages in the menu's order */
    var own = state.doc ? ['home'].concat(state.doc.nav, ['give']) : [];
    var order = own.concat(PAGE_ORDER.filter(function (s) { return own.indexOf(s) === -1; }));
    return order.filter(function (s) { return seen.indexOf(s) !== -1; })
      .concat(seen.filter(function (s) { return order.indexOf(s) === -1; }));
  }

  /* ---- loading -------------------------------------------------------- */

  /* EVERYTHING THE FIRST DRAW NEEDS, ASKED FOR AT ONCE. The settings, the
     notes and the words of the language you were last writing each cost a
     trip to GitHub (about 100–140ms, measured); asked one after another
     they were most of the second the page took to appear. The language is
     guessed from last time and checked against the list when it arrives. */
  /* OPENS AT ONCE ON A RETURN VISIT (Chase, 2026-10-20: "if you navigated
     away to People and back to Website, Website should open quickly
     again"). What the last visit in this tab read — the settings, the
     notes, one language's words, the summary — is kept for the session
     and drawn first; the page then reads them again behind it. Nothing
     can be saved from the kept copy: Save waits for the fresh one, so a
     save is always checked against what the repository holds now. */
  var SNAP = 'thauma.content.snap', SNAP_AGE = 30 * 60 * 1000;
  function snapGet() {
    try {
      var v = JSON.parse(sessionStorage.getItem(SNAP) || 'null');
      return v && Date.now() - v.at < SNAP_AGE ? v : null;
    } catch (e) { return null; }
  }
  function snapPut(part, data) {
    try {
      var v = snapGet() || {};
      v[part] = data; v.at = Date.now();
      sessionStorage.setItem(SNAP, JSON.stringify(v));
    } catch (e) { /* private mode, or full: the next visit reads afresh */ }
  }

  /* EVERYTHING THE FIRST DRAW NEEDS, ASKED FOR AT ONCE. The settings, the
     notes and the words of the language you were last writing each cost a
     trip to GitHub (about 100–140ms, measured); asked one after another
     they were most of the second the page took to appear. The language is
     guessed from last time and checked against the list when it arrives. */
  async function boot() {
    var remembered = null;
    try { remembered = localStorage.getItem('thauma.content.lang'); } catch (e) { /* private mode */ }
    var guess = state.lang || remembered || 'en';
    /* THE LANGUAGE BESIDE IT, asked for at the same time (Chase, 2026-10-21:
       Pages "still loads slowly" — it was asked for only once the first had
       come back, and the page waited for both). English comes with every
       answer; another is the one chosen last time. */
    var besideWas = null;
    try { besideWas = localStorage.getItem('thauma.content.beside'); } catch (e) { /* private mode */ }
    if (besideWas && besideWas !== 'en' && besideWas !== guess && !state.besideLines[besideWas]) {
      state.besidePre = { lang: besideWas, data: send(WORDS + '?lang=' + encodeURIComponent(besideWas), 'GET', null, true) };
      state.beside = besideWas;
    }
    var asking = Promise.all([
      send(CONTENT + '?file=site'),
      send(NOTES, 'GET', null, true),
      send(WORDS + '?lang=' + encodeURIComponent(guess) + '&quick', 'GET', null, true),
      send(SECTIONS_API, 'GET', null, true)
    ]);
    askWaiting(guess);
    var snap = state.lang ? null : snapGet();
    if (snap && snap.site && snap.words && snap.words.lang === guess) {
      var done;
      state.ready = new Promise(function (r) { done = r; });
      await start(snap.site, snap.notes, snap.words.data, guess, snap.sections);
      if (snap.summary) takeSummary(snap.summary);
      var both = await asking;
      await refresh(both, guess, snap);
      done();
      state.ready = null;
      return;
    }
    var got = await asking;
    if (await start(got[0], got[1], got[2], guess, got[3])) loadSummary();   // names and progress, after the first draw
  }
  /* The pages' sections, as saved. What is on screen is kept when it has
     changes of its own (a fresh copy read behind the kept one). */
  function takeSections(data) {
    if (!data || data.failed || !data.doc || !data.doc.pages) return;
    snapPut('sections', data);
    var dirty = state.doc && docDirty();
    state.docSha = data.sha;
    state.docSaved = JSON.stringify(data.doc);
    if (!dirty) takeDoc(JSON.parse(state.docSaved));
  }
  async function start(site, notes, words, guess, sections) {
    if (!site || site.failed) return false;
    if (site.configured === false) { notConfigured(site.reason || site.error || ''); return false; }
    snapPut('site', site);
    takeSite(site);
    takeSections(sections);
    if (notes && !notes.failed) { snapPut('notes', notes); takeNotes(notes); }
    var want = state.langs.indexOf(guess) !== -1 ? guess : state.langs[0];
    fillPickers();
    $('cLang').disabled = false;
    if (onTab() === 'languages') showLangs();
    await openLang(want, false, want === guess && words && !words.failed ? words : null);
    return true;
  }
  /* The fresh copy, behind the kept one: nothing to do when they agree
     (nearly always); otherwise drawn in its place, keeping the page you are
     on and anything typed meanwhile. */
  async function refresh(both, guess, snap) {
    var site = both[0], notes = both[1], words = both[2], sections = both[3];
    if (!site || site.failed || site.configured === false) return;
    var docWas = state.docSaved;
    takeSections(sections);
    if (state.docSaved !== docWas && state.lines.length) { buildRows(); render(); }
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    snapPut('site', site);
    if (notes && !notes.failed) { snapPut('notes', notes); takeNotes(notes); }
    var siteSame = same(site.data, snap.site.data);
    takeSite(site);
    if (words && !words.failed && state.lang === guess && (!siteSame || !same(words, snap.words.data))) {
      var typed = {};
      dirtyIds().forEach(function (id) { typed[id] = state.draft[id]; });
      await openLang(guess, true, words);
      Object.keys(typed).forEach(function (id) { if (id in state.draft) state.draft[id] = typed[id]; });
      if (Object.keys(typed).length) render();
    } else if (!siteSame) fillPickers();
    loadSummary();
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
    snapPut('summary', data);
    takeSummary(data);
  }
  function takeSummary(data) {
    state.summary = {};
    (data.languages || []).forEach(function (l) {
      state.summary[l.code] = l;
      if (l.name && l.name !== l.code) state.names[l.code] = l.name;
    });
    fillPickers();
    takeOthers();
    if (state.rows.length && !state.review) { renderCrumb(); if (!state.view && !state.find) renderRows(); }
    if (onTab() === 'languages') renderTable();
  }

  function notConfigured(reason) {
    var el = $('cNotConfigured');
    el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' + esc(reason);
    el.hidden = false;
    $('cRoot').hidden = true;
    hideTools();
  }
  function hideTools() {
    state.noTools = true;
    $('cWriting').hidden = true;
    document.querySelector('.c-find-row').hidden = true;
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

  /* EVERY OTHER LANGUAGE'S GAPS BY PAGE, from the summary: which of its
     lines are missing or outdated (`needs`). It was every language's whole
     word list, read again after each language opened — four answers of
     125KB for a count. */
  function takeOthers() {
    var out = {};
    Object.keys(state.summary).forEach(function (c) {
      var l = state.summary[c], by = {};
      if (c === 'en' || !l.needs) return;
      state.needIds[c] = {};
      l.needs.forEach(function (id) {
        state.needIds[c][id] = true;
        var line = state.byId[id];
        if (line) { var sec = sectionOf(line); by[sec] = (by[sec] || 0) + 1; }
      });
      out[c] = by;
    });
    state.others = out;
  }

  /* WHAT DEV CHANGED AND HAS NOT PUBLISHED, behind the words (?waiting):
     the slowest thing GitHub is asked, so the words are drawn first and these
     few lines are marked when it answers. A Save waits for it. */
  state.waitingData = {};
  function askWaiting(code) {
    delete state.waitingData[code];
    var p = send(WORDS + '?waiting=' + encodeURIComponent(code), 'GET', null, true).then(function (data) {
      if (!data || data.failed) return;
      state.waitingData[code] = data;
      if (code === state.lang && takeWaiting(data) && state.rows.length && !state.review) { buildRows(); renderAll(); }
    });
    state.waitingAsk = p;
    return p;
  }
  /* returns whether anything on screen changed */
  function takeWaiting(data) {
    var mine = (data && data.mine) || {}, eng = (data && data.english) || {}, any = false;
    state.lines.forEach(function (l) {
      if (l.source !== 'site') return;
      if (l.key in eng && l.english !== eng[l.key]) { l.english = eng[l.key]; any = true; }
      if (l.key in mine && !state.waiting[l.id]) {
        var untouched = state.draft[l.id] === state.saved[l.id];
        l.waiting = mine[l.key];
        state.waiting[l.id] = true;
        state.saved[l.id] = mine[l.key];
        if (untouched) state.draft[l.id] = mine[l.key];
        any = true;
      }
    });
    return any;
  }

  async function openLang(code, keepView, already) {
    if (!already) askWaiting(code);
    var data = already || await send(WORDS + '?lang=' + encodeURIComponent(code) + '&quick');
    if (!data || data.failed) { $('cLang').value = state.lang || ''; return false; }
    snapPut('words', { lang: code, data: data });
    state.lang = code;
    if (data.name && data.name !== code) state.names[code] = data.name;
    state.lines = data.lines || [];
    state.saved = {}; state.draft = {}; state.blocked = {}; state.waiting = {}; state.base = {};
    /* A line changed on dev and not published yet shows dev's text — what
       dev.thauma.one draws — marked as waiting for Publish, and is edited
       like any other: a save writes it to both copies (admin-translate.js).
       `base` is what the saved copy holds, which a save checks against. */
    state.lines.forEach(function (l) {
      var v = l.waiting != null ? l.waiting : l.current;
      state.saved[l.id] = v; state.draft[l.id] = v; state.base[l.id] = l.current;
      if (l.waiting != null) state.waiting[l.id] = true;
    });
    if (state.waitingData[code]) takeWaiting(state.waitingData[code]);
    addFreshLines();
    buildRows();
    markChanged();
    try { localStorage.setItem('thauma.content.lang', code); } catch (e) { /* private mode */ }

    /* Where to start: what needs doing, if anything does; otherwise the first
       page — or, after a save, wherever you were. */
    if (!keepView || (state.view && !viewExists(state.view))) {
      /* The page a link asked for (?page=contact, from Sharing), else where
         you were if this language has it — a reload returns there (Chase,
         2026-09-27) — else the list of pages. */
      var asked = new URLSearchParams(location.search).get('page');
      var was = null;
      try { was = sessionStorage.getItem('thauma.content.view.' + code); } catch (e) { /* private mode */ }
      state.view = asked && viewExists('section:' + asked) ? 'section:' + asked : viewExists(was) ? was : null;
      if (asked) try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) { /* file: */ }
    }
    fillPickers();
    $('cRoot').hidden = !!state.review;
    takeOthers();
    render();
    document.dispatchEvent(new CustomEvent('sections:ready'));
    /* drawn first; the language beside it fills in when it arrives */
    if (state.beside && state.beside !== 'en' && !state.besideLines[state.beside]) loadBeside().then(function () { if (!state.review) renderAll(); });
    return true;
  }

  /* THE WORDS OF A PART ADDED SINCE THE LAST SAVE (a section, a point, a
     paragraph): not in the language files yet, so lines of their own here,
     in the language being written, beside the stand-in words every other
     language has. They are written into every language file with the
     section, in one commit (Save). `fresh[key]` is what each language holds
     now, `freshBase[key]` what it started as. */
  state.freshBase = {};
  function addFreshLines() {
    Object.keys(state.fresh).forEach(function (key) {
      var id = 'site:' + key;
      if (state.lines.some(function (l) { return l.id === id; })) return;
      var f = state.fresh[key], base = state.freshBase[key] || {};
      state.lines.push({ id: id, source: 'site', key: key, english: f.en || '', current: '', fresh: true,
                         status: state.lang === 'en' ? 'done' : SS.isLorem(f[state.lang]) ? 'missing' : 'done' });
      state.saved[id] = base[state.lang] != null ? base[state.lang] : '';
      state.draft[id] = f[state.lang] != null ? f[state.lang] : '';
    });
  }
  function freshKeys(keys) {
    keys.forEach(function (key) {
      var f = {}, b = {};
      state.langs.forEach(function (l) { f[l] = b[l] = SS.lorem(key); });
      state.fresh[key] = f; state.freshBase[key] = b;
    });
    addFreshLines();
  }
  function dropFresh(keys) {
    keys.forEach(function (key) {
      if (!state.fresh[key]) return;
      delete state.fresh[key]; delete state.freshBase[key];
      var id = 'site:' + key;
      state.lines = state.lines.filter(function (l) { return l.id !== id; });
      delete state.saved[id]; delete state.draft[id];
    });
  }

  /* The language shown above each line. English comes with every answer;
     another language is read once and kept. */
  async function loadBeside() {
    var b = state.beside;
    if (!b || b === 'en' || state.besideLines[b]) return;
    var pre = state.besidePre && state.besidePre.lang === b ? state.besidePre.data : null;
    state.besidePre = null;
    var data = await (pre || send(WORDS + '?lang=' + encodeURIComponent(b), 'GET', null, true));
    if (!data || data.failed) return;
    var map = {};
    (data.lines || []).forEach(function (l) { map[l.id] = l.waiting != null ? l.waiting : l.current; });
    state.besideLines[b] = map;
  }
  function besideText(line) {
    if (line.fresh) return (state.fresh[line.key] || {})[state.beside] || '';
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

  /* What a view holds. The list of pages (no view) holds no lines on
     screen; what it would download is every line. A page's own view leaves
     its search title and description to Advanced. */
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
    if (!state.view || state.view === 'all') return state.rows;
    if (state.view === 'needs') return state.rows.filter(needsWork);
    return state.rows.filter(function (r) { return 'section:' + r.section === state.view && !isSeo(r); });
  }
  function visibleLineIds() {
    var ids = [];
    visible().forEach(function (r) { r.lines.forEach(function (l) { ids.push(l.id); }); });
    return ids;
  }

  function render() {
    renderCrumb();
    renderRows();
    renderNav();
    renderFoot();
    renderAdvanced();
    renderMore();
    renderSaveBar();
    previewSync();
  }

  /* ---- which tab is on screen -------------------------------------------
     The words are written on two tabs, Pages and Advanced; the language row
     above them and their save bar belong to both (website/writing.njk). */
  var areaEl = document.getElementById('webArea');
  /* the tabs words are written on, under the one language row */
  var WRITTEN = ['pages', 'navigation', 'footer', 'advanced'];
  /* the tabs with the page beside them */
  var PREVIEWED = ['pages', 'navigation', 'footer'];
  function onTab() { return areaEl ? areaEl.getAttribute('data-tab') : 'pages'; }
  function tabShown() {
    var t = onTab();
    if (!state.noTools) $('cWriting').hidden = WRITTEN.indexOf(t) === -1;
    previewSync();
  }

  /* ---- the live preview -------------------------------------------------
     Chase, 2026-10-07 (asked for beside the words, "like the Site Editor"):
     the page these words are on, in the language being written, with what
     is typed shown in it before it is saved. The site marks each of its
     words with the key it came from (<span data-k>, site-rich.js); a
     change is drawn into those with the very function the build uses
     (SiteRich.richHtml), so the preview and the page cannot disagree.
     Focusing a line scrolls the preview to it and lights it up.

     BESIDE PAGES, AS THE STAFF SITE CREATOR HAS IT (2026-10-20): always
     there where the window has room for it (admin.css AREAS), and it goes
     where you go — a page opened in the list shows in it, and a link
     pressed in it opens that page's words. */
  var PAGE_OF = { home: '', about: 'about/', mission: 'mission/', values: 'values/', resources: 'resources/',
    give: 'give/', contact: 'contact/', events: 'events/', team: 'team/', coming: 'coming-soon/' };
  var prev = { url: null, device: 'wide', section: null, timer: null };
  /* THE PAGES AND EMAILS THE SERVER DRAWS (admin-translate.js previewOf):
     after a link in an email, and the emails themselves — asked for with
     the words as they are on screen, and asked again as they are typed. */
  var SERVED = ['e:confirmed', 'e:unsub', 'e:back', 'e:confirm', 'e:brand', 'e:receipt'];
  function prevKind(sec) { return PAGE_OF[sec] != null ? 'site' : SERVED.indexOf(sec) !== -1 ? 'served' : 'none'; }
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
  /* One line's words, drawn wherever the page shows them — in the language
     being written, never into another language's page. */
  function prevDraw(id) {
    var doc = prevDoc(), line = state.byId[id];
    if (line && line.source === 'emails' && prevKind(prevSection()) === 'served' && sectionOf(line) === prevSection()) {
      clearTimeout(prev.timer);
      prev.timer = setTimeout(served, 450);
      return;
    }
    if (!doc || !doc.documentElement || !line || line.source !== 'site' || !window.SiteRich) return;
    if ((doc.documentElement.getAttribute('lang') || state.lang) !== state.lang) return;
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
    /* an email is read at an email's width, not a desktop's */
    var w = prevKind(prevSection()) === 'served' && /^e:(confirm|brand|receipt)$/.test(prevSection()) ? 720 : 1280;
    var k = Math.min(1, box.clientWidth / w);
    f.style.width = w + 'px';
    f.style.height = Math.round(box.clientHeight / k) + 'px';
    f.style.transform = 'scale(' + k + ')';
  }
  window.addEventListener('resize', function () { if (!$('cPreview').hidden) prevFit(); });
  function previewSync() {
    var box = $('cPreview');
    if (!box) return;
    var on = PREVIEWED.indexOf(onTab()) !== -1 && !state.review && !!state.lang;
    if (areaEl) areaEl.classList.toggle('with-preview', on);
    box.hidden = !on;
    if (!on) return;
    prevFit();
    var sec = prevSection(), kind = prevKind(sec);
    $('cPrevNone').hidden = kind !== 'none';
    $('cPreview').classList.toggle('is-none', kind === 'none');
    if (kind === 'none') { prev.url = 'none:' + sec; $('cPrevUrl').textContent = sectionLabel(sec); $('cPrevGone').hidden = true; return; }
    if (kind === 'served') {
      if (prev.url === 'served:' + sec + ':' + state.lang) return;
      prev.url = 'served:' + sec + ':' + state.lang;
      $('cPrevUrl').textContent = sectionLabel(sec);
      $('cPrevGone').hidden = true;
      $('cPrevOpen').hidden = true;
      prevFit();
      return served();
    }
    $('cPrevOpen').hidden = false;
    var url = prevUrl();
    if (url !== prev.url) {
      prev.url = url;
      $('cPrevUrl').textContent = url;
      $('cPrevOpen').href = url;
      $('cPrevGone').hidden = true;
      $('cPrevFrame').removeAttribute('srcdoc');
      $('cPrevFrame').src = url;
    } else prevDrawAll();
  }
  /* The footer, on Footer. */
  function prevToFoot() {
    var f = $('cPrevFrame'), doc = prevDoc();
    if (!doc || !doc.body || onTab() !== 'footer') return;
    try { f.contentWindow.scrollTo({ top: doc.body.scrollHeight, behavior: 'smooth' }); } catch (e) { /* not drawn yet */ }
  }
  /* One of the server's pages or emails, with this page's words as they are
     on screen; an email shows its subject line above it. */
  var servedAsk = 0;
  async function served() {
    var sec = prevSection(), ask = ++servedAsk, words = {};
    state.lines.forEach(function (l) {
      if (l.source === 'emails' && sectionOf(l) === sec) words[l.key] = state.draft[l.id];
    });
    var data = await send(WORDS, 'POST', { action: 'preview', page: sec, lang: state.lang, words: words }, true);
    if (ask !== servedAsk || !data || data.failed || prev.url !== 'served:' + sec + ':' + state.lang) return;
    var html = data.html;
    if (data.subject) {
      html = html.replace(/<body([^>]*)>/i, '<body$1><div style="font:14px/1.5 Helvetica,Arial,sans-serif;color:#93a1b2;background:#0B0F15;' +
        'padding:14px 22px;border-bottom:1px solid #1A222D"><span style="color:#5e6b7a">' + esc(tr('con.subject')) + '</span> &nbsp;' +
        '<b style="color:#EDF2F8;font-weight:600">' + esc(data.subject) + '</b></div>');
    }
    var f = $('cPrevFrame'), y = 0;
    try { y = f.contentWindow.scrollY || 0; } catch (e) { /* not drawn yet */ }
    f.removeAttribute('src');
    f.dataset.keep = String(y);
    f.srcdoc = html;
  }
  /* Which of the site's pages an address is, or null. */
  function pageAt(path) {
    var m = String(path).match(/^\/[a-z]{2,3}(?:-[a-z0-9]+)?\/(.*)$/);
    if (!m) return null;
    for (var k in PAGE_OF) if (PAGE_OF[k] === m[1]) return k;
    return null;
  }
  if ($('cPreview')) {
    $('cPrevFrame').addEventListener('load', function () {
      var doc = prevDoc();
      /* A page this build does not have (a coming-soon site builds only its
         landing page): said, not shown as a blank. */
      if (doc && $('cPrevFrame').hasAttribute('srcdoc')) {
        var keep = Number($('cPrevFrame').dataset.keep || 0);
        if (keep) try { $('cPrevFrame').contentWindow.scrollTo(0, keep); } catch (e) { /* gone */ }
        return;
      }
      var missing = !doc || !doc.querySelector('[data-k]') || /404/.test(doc.title || '');
      $('cPrevGone').hidden = !missing;
      if (!doc) return;
      /* THE WORDS FOLLOW THE PREVIEW (as the staff Site Creator's do,
         2026-10-04): a page opened by pressing a link in it becomes the
         page being written, so the two never show different pages. */
      var path = doc.location.pathname, seen = pageAt(path);
      if (path !== prev.url && seen) {
        prev.url = path;
        $('cPrevUrl').textContent = path;
        $('cPrevOpen').href = path;
        if (seen !== prevSection() && onTab() === 'pages' && viewExists('section:' + seen)) openView('section:' + seen, true);
      }
      var st = doc.createElement('style');
      st.textContent = '.c-prev-on{outline:2px solid #2FD8FF;outline-offset:6px;border-radius:3px;transition:outline-color .3s}' +
        '.c-prev-sec{outline:2px solid rgba(245,184,69,.75);outline-offset:-2px}main > *{cursor:default}';
      doc.head.appendChild(st);
      prevDrawAll();
      prevArrange();
      doc.addEventListener('click', function (ev) { prevPress(doc, ev); });
      if (onTab() === 'footer') prevToFoot();
    });
    [].forEach.call(document.querySelectorAll('[data-prev-dev]'), function (b) {
      b.addEventListener('click', function () {
        prev.device = b.getAttribute('data-prev-dev');
        $('cPreview').setAttribute('data-device', prev.device);
        prevFit();
        [].forEach.call(document.querySelectorAll('[data-prev-dev]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      });
    });
    /* A line from another page (a search, Needs Work) shows its own page. */
    $('cRows').addEventListener('focusin', function (e) {
      if ($('cPreview').hidden) return;
      var rowEl = e.target.closest && e.target.closest('.c-row');
      var row = rowEl && state.rows.filter(function (r) { return r.id === rowEl.getAttribute('data-row'); })[0];
      if (!row) return;
      var sec = prevKind(row.section) !== 'none' ? row.section : prevSection();
      if (sec !== prevSection()) { prev.section = sec; previewSync(); setTimeout(function () { prevShow(row.lines[0].id); }, 700); return; }
      prevShow(row.lines[0].id);
    });
  }

  /* ---- the list of pages, and the menu over one page ------------------
     As the staff Site Creator's Pages tab (Chase, 2026-10-20): every page
     as a row — how many lines, what still needs translating, which other
     languages are behind, and the dot for changes not published yet —
     then one page's lines, with "← All Pages" and a menu of every page at
     the top. */
  function pageStats() {
    var out = {};
    orderedSections().forEach(function (s) { out[s] = { n: 0, needs: 0, dirty: 0 }; });
    state.rows.forEach(function (r) {
      var c = out[r.section];
      c.n++;
      if (needsWork(r)) c.needs++;
      if (rowDirty(r)) c.dirty++;
    });
    return out;
  }
  /* which other languages are behind on a page: their codes, quietly */
  function behindOn(sec) {
    return Object.keys(state.others).filter(function (c) { return c !== state.lang && (state.others[c][sec] || 0) > 0; });
  }
  /* THE LIST OF PAGES, as the staff Site Creator's "Your Pages": the site's
     own pages first, in the menu's order, each with how many sections it
     has, the languages it is still missing and the dot for changes; then
     the pages a visitor meets another way — Stay Connected, the landing
     page, the arcade, after a link in an email, the emails, the forms on
     other websites — each with how many lines it has. */
  function pageDirty(page) {
    if (!isSectioned(page)) return false;
    if (state.unpubPages && state.unpubPages[page]) return true;
    var d = savedDoc();
    if (d && JSON.stringify(d.pages[page]) !== JSON.stringify(state.doc.pages[page])) return true;
    return state.doc.pages[page].some(secChanged) ||
      state.rows.some(function (r) { return r.place.page === page && !r.place.sec && (rowDirty(r) || rowUnpub(r)); });
  }
  function pageMissing(page) {
    var out = {};
    state.doc.pages[page].forEach(function (sec) {
      var m = secMissing(sec);
      Object.keys(m).forEach(function (c) { out[c] = 1; });
    });
    return out;
  }
  function liveOff(page) {
    var v = state.site && state.site.visibility && state.site.visibility.pages && state.site.visibility.pages[page];
    return v != null && (typeof v === 'object' ? !v.live : !v);
  }
  function overviewHtml() {
    var stats = pageStats(), needs = state.rows.filter(needsWork).length, by = {};
    var own = state.doc ? ['home'].concat(state.doc.nav, ['give']).filter(isSectioned) : [];
    orderedSections().forEach(function (s) {
      if (s === 'menu' || own.indexOf(s) !== -1) return;
      var g = groupOf(s); (by[g] = by[g] || []).push(s);
    });
    var prow = function (view, label, sub, note, changed, aside, attrs) {
      return '<li class="ws-prow"' + (attrs || '') + '><button type="button" class="ws-prow-open" data-view="' + esc(view) + '">' +
        '<b>' + esc(label) + dot(changed) + '</b>' +
        '<span class="ws-prow-sub"><span>' + esc(sub) + '</span>' + (note || '') + '</span>' +
        '<span class="ws-chev ws-chev-r" aria-hidden="true"></span></button>' + (aside || '') + '</li>';
    };
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.yourPages')) + '</h2></div>';
    if (own.length) {
      /* AS THE STAFF SITE CREATOR'S LIST (Chase, 2026-10-27: "things feel
         different between the 2"): each page in the menu with its switch —
         on the live site or not, saved at once like the languages — and its
         grip, dragged into the menu's order (saved with the pages). Home is
         always there; Give is the button at the end of the menu. */
      html += '<ol class="ws-plist c-menu">' + own.map(function (page) {
        var n = state.doc.pages[page].length, inMenu = state.doc.nav.indexOf(page) !== -1;
        var v = state.site && state.site.visibility && state.site.visibility.pages && state.site.visibility.pages[page];
        var aside = page === 'home' ? '<span class="ws-always">' + esc(tr('ws.always')) + '</span>'
          : v == null ? '' : pageSwitch(page, !liveOff(page));
        return prow('section:' + page, sectionLabel(page), n === 1 ? tr('ws.nSections1') : fill('ws.nSections', { n: n }),
          missingNote(pageMissing(page)), pageDirty(page), aside + (inMenu ? grip() : ''), inMenu ? ' data-slug="' + esc(page) + '"' : '');
      }).join('') + '</ol>';
    }
    GROUPS.map(function (g) { return g[0]; }).concat(Object.keys(by).filter(function (g) {
      return !GROUPS.some(function (x) { return x[0] === g; });
    })).forEach(function (g) {
      if (!by[g]) return;
      html += '<h3 class="c-group">' + esc(tr(g === 'site' && own.length ? 'lbl.g.more' : 'lbl.g.' + g)) + '</h3><ol class="ws-plist">' + by[g].map(function (s) {
        var c = stats[s], codes = behindOn(s), miss = {};
        if (!isEn() && c.needs) miss[state.lang] = 1;
        codes.forEach(function (x) { miss[x] = 1; });
        return prow('section:' + s, sectionLabel(s), c.n === 1 ? tr('con.oneLine') : fill('con.nLines', { n: c.n }),
          missingNote(miss), !!state.changedSecs[s] || c.dirty > 0);
      }).join('') + '</ol>';
    });
    html += '<div class="c-everyline">' +
      (needs ? '<button type="button" class="link-btn" data-view="needs">' + esc(tr('con.needsWork')) + ' (' + needs + ')</button>' : '') +
      '<button type="button" class="link-btn" data-view="all">' + esc(fill('con.everyLine', { n: state.rows.length })) + '</button></div>';
    return html;
  }
  /* A page's switch: shown on the live site, or only on the preview. */
  function pageSwitch(page, on) {
    var label = tr(on ? 'sec.page.live' : 'sec.page.preview');
    return '<button type="button" class="switch small" role="switch" data-page-live="' + esc(page) + '" aria-checked="' + on + '" aria-label="' + esc(sectionLabel(page) + ' — ' + label) + '">' +
      '<span class="switch-track"><span class="switch-state">' + esc(tr(on ? 'switch.on' : 'switch.off')) + '</span><span class="switch-knob"></span></span>' +
      '<span class="switch-label">' + esc(label) + '</span></button>';
  }
  /* Saved at once, as the languages are: a quiet commit to site.json. */
  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('[data-page-live]');
    if (!b || b.disabled) return;
    var page = b.getAttribute('data-page-live'), v = state.site.visibility.pages[page];
    var on = b.getAttribute('aria-checked') !== 'true';
    b.disabled = true;
    var ok = await saveSetting(typeof v === 'object' ? 'visibility.pages.' + page + '.live' : 'visibility.pages.' + page, on);
    b.disabled = false;
    if (ok) { renderRows(); renderCrumb(); renderNav(); }
  });
  if (window.StaffSort) StaffSort($('cRows'), { items: '.c-menu > .ws-prow[data-slug]', handle: '.ws-prow .sort-grip',
    key: function (it) { return it.getAttribute('data-slug'); },
    drop: function (parent, from, to) {
      state.doc.nav.splice(to, 0, state.doc.nav.splice(from, 1)[0]);
      renderRows(); renderNav(); renderSaveBar(); prevArrange();
    } });

  /* The menu of pages: the same groups as the list. A mark after a name
     says it has changes. */
  function pageMenu(selected, only) {
    var stats = pageStats(), by = {};
    orderedSections().forEach(function (s) { if (s !== 'menu' && (!only || only(s))) { var g = groupOf(s); (by[g] = by[g] || []).push(s); } });
    var opt = function (v, label) { return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    return Object.keys(by).sort(function (a, b) {
      var ia = GROUPS.map(function (g) { return g[0]; }).indexOf(a), ib = GROUPS.map(function (g) { return g[0]; }).indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).map(function (g) {
      return '<optgroup label="' + esc(tr('lbl.g.' + g)) + '">' + by[g].map(function (s) {
        var c = stats[s];
        return opt('section:' + s, sectionLabel(s) + (state.changedSecs[s] || c.dirty || pageDirty(s) ? ' •' : ''));
      }).join('') + '</optgroup>';
    }).join('');
  }
  function renderCrumb() {
    var box = $('cCrumb');
    var open = !!state.view && !state.find;
    box.hidden = !open;
    if (!open) { box.innerHTML = ''; return; }
    var needs = state.rows.filter(needsWork).length;
    var sel = (state.view === 'needs' || needs ? '<option value="needs"' + (state.view === 'needs' ? ' selected' : '') + '>' + esc(tr('con.needsWork')) + ' (' + needs + ')</option>' : '') +
      '<option value="all"' + (state.view === 'all' ? ' selected' : '') + '>' + esc(fill('con.everyLine', { n: state.rows.length })) + '</option>';
    var pg = /^section:/.test(state.view || '') ? state.view.slice(8) : null;
    var pv = pg && state.site && state.site.visibility && state.site.visibility.pages && state.site.visibility.pages[pg];
    box.innerHTML = '<button type="button" class="ghost-btn sm" data-view="">← ' + esc(tr('ws.allPages')) + '</button>' +
      '<label class="ws-pagepick"><span class="sr-only">' + esc(tr('web.pages')) + '</span>' +
        '<select data-page-pick>' + sel + pageMenu(state.view) + '</select></label>' +
      (pg === 'home' ? '<span class="ws-always">' + esc(tr('ws.always')) + '</span>' : pv != null ? pageSwitch(pg, !liveOff(pg)) : '');
  }

  /* FORMATTED WORDS (2026-10-07, Chase: "allowing the text controls that the
     Site Creator has … AND also the idea of having the times when a new line
     is started defined in the text box itself"). A page's words are a
     formatted box with the Site Creator's bar (rich-text.js): bold, italic,
     underline, a link, a size, a color, and Enter for a new line, which is
     where the page breaks it (src/js/site-rich.js). Email and form words stay plain:
     an email cannot show the page's formatting. */
  var RT = window.RichText;
  /* a search title and description are text only: an app shows no formatting */
  function isRich(r) { return !!RT && r.source === 'site' && !/\.seo_(title|desc)$/.test(r.key); }
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

  /* `opts`: the name it has where it is drawn (a section's "Heading"), and
     `drop`, a part of a section it can be taken away as. */
  function rowHtml(r, opts) {
    opts = opts || {};
    /* In a view that mixes pages — Needs work, All, a search — "Intro" alone
       does not say which page; there the page leads the name. */
    var mixed = !!state.find || state.view === 'needs' || state.view === 'all';
    if (isSeo(r) && onTab() === 'advanced') mixed = false;
    var name = opts.label || (mixed && r.section !== '_general' ? sectionLabel(r.section) + ' · ' + r.label : r.label);
    var dirty = rowDirty(r), unpub = !dirty && rowUnpub(r);
    var mark = needsWork(r) && !dirty ? rowStatus(r) : '';
    var blocked = r.lines.some(function (l) { return state.blocked[l.id]; });
    var waits = r.lines.some(function (l) { return state.waiting[l.id]; });
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
    /* DISCARD CHANGES, ON THE BOX ITSELF (Chase, 2026-10-21: "each text box
       to have the option to discard the changes if changes happen. Like a
       'Discard Changes' fades in if edits are made"): what was typed goes
       back to what is saved; a saved change not published yet goes back to
       what visitors see. */
    return '<div class="c-row' + (dirty ? ' is-dirty' : '') + (unpub ? ' is-unpub' : '') + (mark ? ' is-' + mark : '') +
        (blocked ? ' is-blocked' : '') + (waits ? ' is-waiting' : '') + '" data-row="' + esc(r.id) + '">' +
      '<div class="c-key">' +
        '<span class="c-name">' + esc(name) + '</span>' +
        '<code>' + esc(r.split ? r.key + '_thin + _bold' : r.key) + '</code>' +
        (mark ? '<span class="tl-st is-' + mark + '">' + esc(tr('tl.status.' + mark)) + '</span>' : '') +
        (dirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
        (waits ? '<span class="badge waiting">' + esc(tr('con.waiting')) + '</span>' : '') +
        (opts.drop ? '<button type="button" class="link-btn c-drop" data-drop-part="' + esc(opts.drop) + '">' + esc(tr('sec.takeAway')) + '</button>' : '') +
        '<button type="button" class="link-btn c-undo" data-undo="' + esc(r.id) + '"' + (dirty || unpub ? '' : ' tabindex="-1"') + '>' + esc(tr('con.discardBox')) + '</button>' +
      '</div>' + ref + field +
    '</div>';
  }

  /* How a page shows in a search, when shared, and in a browser's tab: the
     Advanced tab's (2026-10-27, as the staff Site Creator keeps the tab's
     name there; the page itself keeps only its name in the menu). */
  function isTabName(r) { return !r.split && r.key.split('.').length === 2 && /\.title$/.test(r.key) && PAGE_OF[r.section] != null; }
  function isSeo(r) { return !r.split && (/\.seo_(title|desc)$/.test(r.key) || isTabName(r)); }
  function draftOf(key) { var id = 'site:' + key; return state.draft[id] != null ? state.draft[id] : ''; }
  function plainOf(v) { return String(v || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
  function seoCard(page) {
    var share = (state.site && state.site.share && state.site.share[page]) || '';
    var path = (location.host || 'thauma.one') + ' › ' + (state.lang || 'en') + (PAGE_OF[page] ? ' › ' + PAGE_OF[page].replace(/\/$/, '') : '');
    return '<div class="c-seo" data-seo="' + esc(page) + '">' +
      '<div class="c-seo-serp"><span class="c-seo-lbl">' + esc(tr('ws.adv.inSearch')) + '</span>' +
        '<span class="c-seo-url">' + esc(path) + '</span>' +
        '<b class="c-seo-title" data-seo-title>' + esc(plainOf(draftOf(page + '.seo_title'))) + '</b>' +
        '<span class="c-seo-desc" data-seo-desc>' + esc(plainOf(draftOf(page + '.seo_desc'))) + '</span></div>' +
      '<div class="c-seo-share"><span class="c-seo-lbl">' + esc(tr('ws.adv.inShare')) + '</span>' +
        '<div class="c-seo-card"><img src="' + esc(share || '/img/og-default.png') + '" alt="">' +
          '<b data-seo-title>' + esc(plainOf(draftOf(page + '.seo_title'))) + '</b><span>' + esc(location.host || 'thauma.one') + '</span></div>' +
        '<div class="c-seo-acts"><label class="ghost-btn sm">' + esc(tr(share ? 'ws.changePhoto' : 'ws.sharePic.choose')) +
          '<input type="file" accept="image/*" data-seo-pic="' + esc(page) + '" hidden></label>' +
          (share ? '<button type="button" class="link-btn" data-seo-unpic="' + esc(page) + '">' + esc(tr('con.seoCard')) + '</button>' : '') +
          '<span class="hint" data-seo-status></span></div></div></div>';
  }
  /* the card follows what is typed */
  function seoLive(id) {
    var line = state.byId[id], card = $('cAdv').querySelector('.c-seo');
    if (!line || !card || !/\.seo_(title|desc)$/.test(line.key)) return;
    var which = /seo_title$/.test(line.key) ? '[data-seo-title]' : '[data-seo-desc]';
    [].forEach.call(card.querySelectorAll(which), function (el) { el.textContent = plainOf(state.draft[id]); });
  }
  /* A PAGE'S OWN PICTURE WHEN SHARED: chosen, shaped in the photo editor to
     a share card's 1.91:1, uploaded as the finished picture (an app shows
     the file it is given), and saved to site.json at once, like the other
     settings. "Use the Thauma card" goes back to the default. */
  async function seoPicture(page, file) {
    var status = $('cAdv').querySelector('.c-seo [data-seo-status]');
    var say = function (k) { if (status) status.textContent = tr(k); };
    try {
      var url = URL.createObjectURL(file), v = null;
      if (window.PhotoEditor) v = await window.PhotoEditor.open(url, { purpose: 'share' });
      if (window.PhotoEditor && !v) { URL.revokeObjectURL(url); return; }
      say('lib.uploading');
      var blob = v && window.PhotoEditor ? await window.PhotoEditor.exportBlob(url, v, { max: 1200 }) : file;
      URL.revokeObjectURL(url);
      var res = await fetch('/api/admin/media?kind=site', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-File-Name': 'share-' + page }, body: blob });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || tr('err.refused'));
      if (await saveSetting('share.' + page, body.url)) renderAdvanced();
    } catch (e) { if (status) status.textContent = e.message; }
  }
  $('cAdv').addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.seoPic && t.files && t.files[0]) seoPicture(t.dataset.seoPic, t.files[0]);
    if (t.hasAttribute('data-adv-page')) {
      state.advPage = t.value;
      try { sessionStorage.setItem('thauma.content.adv', state.advPage); } catch (e2) { /* private mode */ }
      renderAdvanced();
    }
  });
  $('cAdv').addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('[data-seo-unpic]');
    if (b && await saveSetting('share.' + b.dataset.seoUnpic, '')) renderAdvanced();
  });
  /* The list of pages, a page from it, "← All Pages", the menu, and one
     page's way back. */
  $('cRoot').addEventListener('click', function (e) {
    var v = e.target.closest && e.target.closest('[data-view]');
    if (v) openView(v.getAttribute('data-view') || null);
  });
  $('cCrumb').addEventListener('change', function (e) {
    if (e.target.hasAttribute('data-page-pick')) openView(e.target.value);
  });

  /* ONE BOX BACK: its Discard Changes (rowHtml). What visitors see is read
     once per language, when first asked for. */
  var liveCache = {};
  async function liveLines() {
    if (liveCache[state.lang]) return liveCache[state.lang];
    var data = await send(WORDS + '?live=' + encodeURIComponent(state.lang));
    if (!data || data.failed) return null;
    return (liveCache[state.lang] = data.lines || {});
  }
  document.addEventListener('web:changes', function () { liveCache = {}; });
  async function undoRow(id) {
    var row = state.rows.filter(function (r) { return r.id === id; })[0];
    if (!row) return;
    if (rowDirty(row)) {
      row.lines.forEach(function (l) { state.draft[l.id] = state.saved[l.id]; delete state.blocked[l.id]; freshTyped(l.id); });
    } else if (rowUnpub(row)) {
      var live = await liveLines();
      if (!live) return;
      /* a line visitors never had (new since) keeps what is saved */
      row.lines.forEach(function (l) { if (l.id in live) state.draft[l.id] = live[l.id]; });
      toast(tr('con.backSave'), 'ok');
    } else return;
    renderAll();
    row.lines.forEach(function (l) { prevDraw(l.id); });
  }
  /* Everything the words are drawn on, again (after a change that is not
     a keystroke). */
  function renderAll() {
    renderRows(); renderAdvanced(); renderNav(); renderFoot(); renderSaveBar(); renderCrumb();
  }

  function renderRows() {
    /* THE LIST OF PAGES, until one is opened (or a search is typed). */
    if (!state.view && !state.find) {
      $('cCount').textContent = '';
      $('cRows').className = 'c-rows is-list';
      $('cRows').innerHTML = overviewHtml();
      return;
    }
    /* A PAGE OF SECTIONS, as the staff Site Creator shows one. */
    var page = !state.find && viewPage();
    if (page && isSectioned(page)) {
      $('cCount').textContent = '';
      $('cRows').className = 'c-sections';
      if (state.open && (!state.idAt[state.open] || state.idAt[state.open].page !== page)) state.open = null;
      $('cRows').innerHTML = pageHtml(page);
      $('cRows').querySelectorAll('textarea').forEach(autosize);
      return;
    }
    $('cRows').className = 'c-rows';
    var rows = visible();
    $('cCount').textContent = state.find ? rows.length + ' ' + tr('con.matches') : '';
    /* THE CONTACT PAGE'S FORM: its words are here, like the rest of the
       page; where its messages go is Sharing. */
    var forms = !state.find && state.view === 'section:contact'
      ? '<a class="up-share-link c-formslink" href="/admin/website/sharing/">' + esc(tr('con.formsLink')) + '</a>' : '';
    /* ONE PAGE BACK (Chase, 2026-10-19: "we need the ability to discard
       changes of certain section"): this page's lines go back to what
       visitors see now — typed words and saved ones not yet published. They
       come back as unsaved, to look over and Save like any change. */
    $('cRows').innerHTML = forms + (rows.length ? rows.map(function (r) { return rowHtml(r); }).join('')
      : '<p class="empty">' + esc(tr('con.noMatches')) + '</p>');
    $('cRows').querySelectorAll('textarea').forEach(autosize);
  }

  /* ---- THE PAGES AS SECTIONS ---------------------------------------------
     Chase, 2026-10-21: "should we just have the site creator operate almost
     exactly the same?" — as the staff Site Creator: a page is its sections,
     each opened to its words, its photo, its buttons and its look, with a
     place between any two to add one, a grip to move one, and ✕ to take one
     away. The kinds are the site's own designs (site-sections.js), so the
     site looks as it did; the arrangement is saved with the words, by Save
     (/api/admin/sections, one commit). The head of a page stays where it
     is, and the parts drawn from elsewhere (the team, the form, the
     gatherings…) can be moved but not taken away. */
  function docDirty() { return !!state.doc && JSON.stringify(state.doc) !== state.docSaved; }
  function savedDoc() { try { return state.docSaved ? JSON.parse(state.docSaved) : null; } catch (e) { return null; } }
  function secOf(id) { return state.idAt[id] ? state.idAt[id].sec : null; }
  function savedSecOf(id) {
    var d = savedDoc(), out = null;
    if (d) Object.keys(d.pages).forEach(function (p) { d.pages[p].forEach(function (s, i) { if (s.id === id) out = { sec: s, at: i }; }); });
    return out;
  }
  /* How many things about the arrangement are not saved: a section added,
     taken away, changed or moved, and the menu's order. */
  function structChanges() {
    var d = savedDoc();
    if (!state.doc || !d) return 0;
    var n = JSON.stringify(state.doc.nav) !== JSON.stringify(d.nav) ? 1 : 0;
    Object.keys(state.doc.pages).forEach(function (p) {
      var now = state.doc.pages[p], was = d.pages[p] || [];
      var ids = now.map(function (s) { return s.id; }), old = was.map(function (s) { return s.id; });
      now.forEach(function (s) {
        var w = was[old.indexOf(s.id)];
        if (!w || JSON.stringify(w) !== JSON.stringify(s)) n++;
      });
      old.forEach(function (id) { if (ids.indexOf(id) === -1) n++; });
      var kept = ids.filter(function (id) { return old.indexOf(id) !== -1; });
      if (kept.join() !== old.filter(function (id) { return ids.indexOf(id) !== -1; }).join()) n++;
    });
    return n;
  }
  /* A section's rows, in the order its words are read. */
  function secRows(sec) {
    var order = SS.keysOf(sec);
    return state.rows.filter(function (r) { return r.place.sec === sec.id && !isSeo(r); }).sort(function (a, b) {
      var ia = order.indexOf(a.lines[0].key), ib = order.indexOf(b.lines[0].key);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }
  function rowUnpub(r) { return r.lines.some(function (l) { return state.changedIds[l.id]; }); }
  function secChanged(sec) {
    var was = savedSecOf(sec.id);
    if (!was || JSON.stringify(was.sec) !== JSON.stringify(sec)) return true;
    return secRows(sec).some(function (r) { return rowDirty(r) || rowUnpub(r); });
  }
  /* Which other languages a section's words are still missing in — stand-in
     words, or a line the summary says needs work. */
  function secMissing(sec) {
    var out = {}, rows = secRows(sec);
    state.langs.forEach(function (c) {
      if (c === state.lang) {
        if (rows.some(needsWork)) out[c] = 1;
        return;
      }
      var need = state.needIds[c] || {};
      if (rows.some(function (r) { return r.lines.some(function (l) { return need[l.id] || (l.fresh && SS.isLorem((state.fresh[l.key] || {})[c])); }); })) out[c] = 1;
    });
    return out;
  }
  function missingNote(out) {
    var codes = state.langs.filter(function (l) { return out[l]; });
    if (!codes.length) return '';
    return '<span class="ws-miss" title="' + esc(tr('ms.missing') + ' ' + codes.map(langName).join(', ')) + '">' +
      esc(tr('ms.missing') + ' ' + codes.join(', ').toUpperCase()) + '</span>';
  }
  function dot(on) { return on ? '<i class="ws-dot" title="' + esc(tr('ws.changedHere')) + '"></i>' : ''; }
  /* What a section says, in a line: its heading, else its first words. */
  function secSummary(sec) {
    var rows = secRows(sec);
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i].lines.map(function (l) { return plainOf(state.draft[l.id]); }).join(' ').trim();
      if (t) return t.length > 80 ? t.slice(0, 78) + '…' : t;
    }
    var k = SS.KINDS[sec.kind];
    return k.fixed ? tr('sec.what.' + sec.kind) : '';
  }

  /* THE SKETCHES, as the staff Site Creator draws its kinds: the shape of
     the section in a few blocks — text light, words dim, the accent where
     the small line above and the buttons are, a photo gray. */
  var SKETCH = {
    homeHero: [[34,12,32,5,'a'],[14,24,72,20,'t'],[26,54,48,9,'l'],[32,70,36,6,'l']],
    pageHeader: [[8,20,22,6,'a'],[8,36,62,14,'t'],[8,60,70,6,'l'],[8,72,52,6,'l']],
    dictionary: [[8,14,44,18,'t'],[8,38,26,6,'a'],[8,54,80,6,'l'],[8,66,72,6,'l'],[8,78,64,6,'l']],
    story: [[8,8,20,5,'a'],[8,18,56,10,'t'],[8,34,80,5,'l'],[8,44,74,5,'l'],[8,56,84,34,'p']],
    points: [[8,8,20,5,'a'],[8,18,50,10,'t'],[8,38,26,44,'l'],[37,38,26,44,'l'],[66,38,26,44,'l'],[11,43,6,7,'a'],[40,43,6,7,'a'],[69,43,6,7,'a'],[8,86,18,8,'o']],
    invite: [[40,12,20,5,'a'],[22,24,56,12,'t'],[26,44,48,6,'l'],[29,62,19,12,'a'],[52,62,19,12,'o']],
    rows: [[8,12,16,6,'a'],[30,10,50,8,'t'],[30,22,60,5,'l'],[8,42,16,6,'a'],[30,40,50,8,'t'],[30,52,60,5,'l'],[8,72,16,6,'a'],[30,70,50,8,'t'],[30,82,60,5,'l']],
    convictions: [[8,10,8,10,'a'],[22,10,40,6,'t'],[22,20,66,5,'l'],[8,40,8,10,'a'],[22,40,40,6,'t'],[22,50,66,5,'l'],[8,70,8,10,'a'],[22,70,40,6,'t'],[22,80,66,5,'l']],
    teamGrid: [[8,12,24,44,'p'],[38,12,24,44,'p'],[68,12,24,44,'p'],[8,62,18,6,'t'],[38,62,18,6,'t'],[68,62,18,6,'t'],[8,74,12,5,'l'],[38,74,12,5,'l'],[68,74,12,5,'l']],
    library: [[8,10,40,10,'l'],[52,10,40,10,'l'],[8,28,84,8,'l'],[8,44,26,40,'l'],[37,44,26,40,'l'],[66,44,26,40,'l']],
    gatherings: [[8,10,84,3,'a'],[8,18,30,20,'t'],[8,46,70,6,'l'],[8,58,60,6,'l'],[8,74,22,10,'o']],
    contactForm: [[10,12,80,12,'l'],[10,30,80,12,'l'],[10,48,80,24,'l'],[10,80,20,10,'a']],
    giving: [[8,10,40,30,'l'],[52,10,40,30,'l'],[8,48,84,24,'p'],[30,78,40,14,'o']],
    quote: [[10,26,76,12,'t'],[10,44,60,12,'t'],[10,68,22,5,'a']],
    photo: [[6,14,88,58,'p'],[6,80,40,5,'l']],
    links: [[8,8,20,5,'a'],[8,18,50,10,'t'],[8,38,84,1,'l'],[8,44,50,7,'t'],[86,44,6,7,'a'],[8,58,84,1,'l'],[8,64,46,7,'t'],[86,64,6,7,'a'],[8,78,84,1,'l']],
    signup: [[8,12,20,5,'a'],[8,24,56,12,'t'],[8,44,70,6,'l'],[8,64,24,12,'a']]
  };
  function sketch(kind) {
    return (SKETCH[kind] || []).map(function (r) {
      return '<span class="sk sk-' + r[4] + '" style="left:' + r[0] + '%;top:' + r[1] + '%;width:' + r[2] + '%;height:' + r[3] + '%"></span>';
    }).join('');
  }
  function grip() { return window.StaffSort ? StaffSort.grip(tr('ws.dragMove')).replace('class="sort-grip"', 'class="ws-icon sort-grip"') : ''; }
  function seg(attr, options, current, labelOf) {
    return '<div class="ws-seg" role="group">' + options.map(function (o) {
      return '<button type="button" class="ws-segbtn" ' + attr + ' data-value="' + esc(o) + '" aria-pressed="' + (o === current) + '">' + esc(labelOf(o)) + '</button>';
    }).join('') + '</div>';
  }
  function lookRow(label, control) {
    return '<div class="ws-row"><span class="ws-lbl">' + esc(label) + '</span><div class="ws-ctl">' + control + '</div></div>';
  }

  /* ---- a page of sections, drawn ---- */
  function rowOfKey(key) {
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].lines.some(function (l) { return l.key === key; })) return state.rows[i];
    }
    return null;
  }
  function box(key, label, drop) {
    var r = rowOfKey(key);
    return r ? rowHtml(r, { label: label, drop: drop }) : '';
  }
  function addRow(attr, label) {
    return '<div class="c-row c-addrow"><button type="button" class="link-btn ws-more" ' + attr + '>+ ' + esc(label) + '</button></div>';
  }
  function pageHtml(page) {
    var list = state.doc.pages[page], html = '';
    /* the page's own lines: what the menu and the browser's tab call it */
    var own = [];
    if (page !== 'home' && rowOfKey('nav.' + page)) own.push(box('nav.' + page, tr('sec.page.menuName')));
    if (own.length) html += '<div class="c-rows c-pagerows">' + own.join('') + '</div>';
    html += '<div class="ws-stack' + (state.open ? ' has-open' : '') + '">';
    list.forEach(function (sec, i) {
      html += secHtml(page, sec, i) + '<button type="button" class="ws-insert" data-insert-at="' + (i + 1) + '">+ ' + esc(tr('ws.addHere')) + '</button>';
    });
    return html + '</div>';
  }
  function secHtml(page, sec, i) {
    var k = SS.KINDS[sec.kind], open = state.open === sec.id;
    var movable = i > 0, removable = i > 0 && !k.fixed;
    return '<article class="ws-acc' + (open ? ' is-open' : '') + (movable ? ' is-movable' : '') + '" data-sid="' + esc(sec.id) + '">' +
      '<div class="ws-acc-head">' +
        '<button type="button" class="ws-stile" data-open-sec="' + esc(sec.id) + '" aria-expanded="' + open + '">' +
          '<span class="ws-sketch ws-sketch-sm" aria-hidden="true">' + sketch(sec.kind) + '</span>' +
          '<span class="ws-stile-words"><b>' + esc(kindName(sec.kind)) + dot(secChanged(sec)) + '</b>' +
            '<span>' + esc(secSummary(sec)) + '</span>' + missingNote(secMissing(sec)) + '</span>' +
          '<span class="ws-chev" aria-hidden="true"></span></button>' +
        '<span class="ws-stile-tools">' + (movable ? grip() : '') +
          (removable ? '<button type="button" class="ws-icon del" data-sec-remove="' + esc(sec.id) + '" aria-label="' + esc(tr('sec.remove')) + '" title="' + esc(tr('sec.remove')) + '">✕</button>' : '') +
        '</span></div>' +
      '<div class="ws-acc-body"><div class="ws-acc-inner">' + (open ? secBody(sec) : '') + '</div></div></article>';
  }
  function secTabs(sec) {
    var k = SS.KINDS[sec.kind], t = ['words'];
    if (k.photo) t.push('photo');
    if (k.buttons) t.push('buttons');
    if (k.ground || k.voice) t.push('look');
    return t;
  }
  function secBody(sec) {
    var tabs = secTabs(sec);
    if (tabs.indexOf(state.sectab) === -1) state.sectab = 'words';
    var html = tabs.length > 1 ? '<div class="ws-sectabs" role="tablist">' + tabs.map(function (t) {
      return '<button type="button" role="tab" data-sectab="' + t + '" aria-selected="' + (t === state.sectab) + '">' + esc(tr('ws.tabw.' + t)) + '</button>';
    }).join('') + '</div>' : '';
    html += '<div class="ws-panelbody">';
    if (state.sectab === 'words') html += secWords(sec);
    else if (state.sectab === 'photo') html += secPhoto(sec);
    else if (state.sectab === 'buttons') html += secButtons(sec);
    else if (state.sectab === 'look') html += secLook(sec);
    return html + '</div>';
  }
  /* WHERE A FIXED PART IS EDITED: the people in People, the gatherings
     and resources in Updates, the form's messages in Sharing. */
  var FIXED_AT = { teamGrid: '/admin/users/', library: '/admin/website/updates/resources/', gatherings: '/admin/website/updates/',
                   contactForm: '/admin/website/sharing/' };
  function secWords(sec) {
    var k = SS.KINDS[sec.kind], wd = sec.words || {}, id = esc(sec.id), out = [];
    var note = k.fixed ? '<p class="ws-data">' + esc(tr('sec.what.' + sec.kind)) +
      (FIXED_AT[sec.kind] ? ' <a href="' + FIXED_AT[sec.kind] + '">' + esc(tr('sec.editThere.' + sec.kind)) + ' →</a>' : '') + '</p>' : '';
    if (k.fixed && !k.words) {
      var rows = secRows(sec);
      return note + (rows.length ? '<div class="c-rows">' + rows.map(function (r) { return rowHtml(r); }).join('') + '</div>' : '');
    }
    (k.words || []).forEach(function (f) {
      var optional = (k.optional || []).indexOf(f) !== -1 && !k.fixed;
      if (wd[f] == null) {
        if (optional) out.push(addRow('data-add-part="' + id + ':' + f + '"', tr('sec.add.' + partWord(sec, f))));
        return;
      }
      var label = tr('sec.part.' + partWord(sec, f));
      out.push(box(f === 'heading' ? wd[f] + '_thin' : wd[f], label, optional ? id + ':' + f : null));
    });
    if (k.list) {
      var list = wd[k.list] || [];
      list.forEach(function (key, i) {
        out.push(box(key, fill('sec.part.' + k.list, { n: i + 1 }), list.length > 1 || sec.kind === 'story' ? id + ':' + k.list + ':' + i : null));
      });
      if (list.length < (k.listMax || 8)) out.push(addRow('data-add-para="' + id + '"', tr('sec.add.' + k.list)));
    }
    var html = note + '<div class="c-rows c-secrows">' + out.join('') + '</div>';
    if (k.items) {
      var items = sec.items || [];
      items.forEach(function (it, i) {
        html += '<div class="c-item"><div class="c-item-head"><b>' + esc(fill('sec.item.' + sec.kind, { n: i + 1 })) + '</b>' +
          (items.length > 1 ? '<button type="button" class="ws-icon del" data-drop-item="' + id + ':' + i + '" aria-label="' + esc(tr('sec.removeItem')) + '" title="' + esc(tr('sec.removeItem')) + '">✕</button>' : '') +
          '</div><div class="c-rows">' + k.items.map(function (f) { return box(it[f], tr('sec.part.i' + f)); }).join('') + '</div>' +
          /* a link goes somewhere: one of the site's pages, or an address (2026-10-27) */
          (k.itemTo ? '<div class="ws-rows">' + lookRow(tr('sec.btn.to'), '<div class="ws-link"><select data-item-to="' + id + ':' + i + '">' + pageOptions(it.to) + '</select>' +
            (SS.PAGES.indexOf(it.to) === -1 ? '<input type="url" data-item-url="' + id + ':' + i + '" value="' + esc(it.to || '') + '" placeholder="https://" spellcheck="false">' : '') + '</div>') + '</div>' : '') +
          '</div>';
      });
      if (items.length < (k.itemsMax || 8)) html += '<button type="button" class="link-btn ws-more" data-add-item="' + id + '">+ ' + esc(tr('sec.add.item.' + sec.kind)) + '</button>';
    }
    return html;
  }
  function photoOf(sec) {
    if (!sec.photo) return null;
    if (state.photos[sec.photo]) return { src: state.photos[sec.photo], focal_x: 50, focal_y: 50, zoom: 100 };
    return (state.site && state.site.images && state.site.images[sec.photo]) || null;
  }
  function secPhoto(sec) {
    var img = photoOf(sec), own = !sec.photo || sec.photo === sec.id, id = esc(sec.id);
    var html = img && img.src
      ? '<div class="c-secphoto"><img src="' + esc(img.src) + '" alt="" style="object-position:' + Number(img.focal_x || 50) + '% ' + Number(img.focal_y || 50) + '%"></div>'
      : '<div class="ws-bigphoto"><span class="ws-nophoto">' + esc(tr('ws.noPhoto')) + '</span></div>';
    html += '<div class="ws-sec-row">';
    /* a photo the site always had is changed and framed in Photos; a
       section's own is chosen here, and framed in Photos once saved */
    if (own) html += '<label class="ghost-btn sm ws-file">' + esc(tr(img && img.src ? 'sec.photo.change' : 'ws.choosePhoto')) +
      '<input type="file" accept="image/*" data-sec-photo="' + id + '" hidden></label>';
    if (sec.photo && !state.photos[sec.photo] && img && img.src) html += '<button type="button" class="ghost-btn sm" data-goto-photo="' + esc(sec.photo) + '">' + esc(tr(own ? 'sec.photo.frame' : 'sec.photo.inPhotos')) + ' →</button>';
    if (own && sec.photo) html += '<button type="button" class="link-btn" data-sec-unphoto="' + id + '">' + esc(tr('ws.removePhoto')) + '</button>';
    html += '<span class="hint" data-photo-hint></span></div>';
    var wd = sec.words || {};
    if (sec.photo && (wd.alt || wd.placeholder)) {
      html += '<div class="c-rows">' + (wd.alt ? box(wd.alt, tr('sec.part.alt')) : '') + (wd.placeholder ? box(wd.placeholder, tr('sec.part.placeholder')) : '') + '</div>';
    }
    return html;
  }
  function pageOptions(current) {
    var custom = SS.PAGES.indexOf(current) === -1;
    return SS.PAGES.map(function (p) {
      return '<option value="' + esc(p) + '"' + (p === current ? ' selected' : '') + '>' + esc(sectionLabel(p)) + '</option>';
    }).join('') + '<option value="__url"' + (custom ? ' selected' : '') + '>' + esc(tr('sec.btn.address')) + '…</option>';
  }
  function secButtons(sec) {
    var k = SS.KINDS[sec.kind], bs = sec.buttons || [], id = esc(sec.id), html = '';
    bs.forEach(function (b, i) {
      var custom = SS.PAGES.indexOf(b.to) === -1;
      html += '<div class="c-item"><div class="c-item-head"><b>' + esc(bs.length > 1 ? fill('sec.part.buttonN', { n: i + 1 }) : tr('sec.part.button')) + '</b>' +
        '<button type="button" class="ws-icon del" data-drop-button="' + id + ':' + i + '" aria-label="' + esc(tr('sec.removeButton')) + '" title="' + esc(tr('sec.removeButton')) + '">✕</button></div>' +
        '<div class="c-rows">' + box(b.label, tr('sec.btn.words')) + '</div>' +
        '<div class="ws-rows">' +
          lookRow(tr('sec.btn.to'), '<div class="ws-link"><select data-btn-to="' + id + ':' + i + '">' + pageOptions(b.to) + '</select>' +
            (custom ? '<input type="url" data-btn-url="' + id + ':' + i + '" value="' + esc(b.to) + '" placeholder="https://" spellcheck="false">' : '') + '</div>') +
          lookRow(tr('sec.btn.style'), seg('data-btn-style="' + id + ':' + i + '"', SS.STYLES, b.style || 'solid', function (v) { return tr('sec.btn.' + v); })) +
        '</div></div>';
    });
    if (bs.length < k.buttons) html += '<button type="button" class="link-btn ws-more" data-add-button="' + id + '">+ ' + esc(tr('ws.addButton')) + '</button>';
    return html || '<p class="ws-small">' + esc(tr('sec.btn.none')) + '</p>';
  }
  function secLook(sec) {
    var k = SS.KINDS[sec.kind], look = sec.look || {}, id = esc(sec.id), html = '<div class="ws-rows">';
    if (k.ground) html += lookRow(tr('sec.look.ground'), seg('data-look="' + id + ':ground"', SS.GROUNDS, look.ground || 'plain', function (v) { return tr('sec.look.ground.' + v); }));
    if (k.voice) html += lookRow(tr('sec.look.voice'), seg('data-look="' + id + ':voice"', SS.VOICES, look.voice || 'tech', function (v) { return tr('sec.look.voice.' + v); }));
    return html + '</div>';
  }

  /* ---- a page of sections, changed ---- */
  /* After a change to the arrangement: every section found again, the
     rows placed again, the page and the preview drawn. */
  function arranged(keepOpen) {
    takeDoc(state.doc);
    buildRows();
    renderRows();
    renderCrumb();
    renderSaveBar();
    renderNav();
    prevArrange();
    if (keepOpen && state.open) {
      var el = $('cRows').querySelector('.ws-acc[data-sid="' + state.open + '"]');
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function newId() { return 's' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5); }
  function viewPage() { return /^section:/.test(state.view || '') ? state.view.slice(8) : null; }
  /* The keys of a section's words that were added since the last save. */
  function freshIn(keys) { return keys.filter(function (k) { return state.fresh[k]; }); }

  function openAdd(at) {
    var page = viewPage();
    if (!page) return;
    state.insertAt = at;
    $('cAddTitle').innerHTML = esc(tr('ws.addTo')) + ' <b>' + esc(sectionLabel(page)) + '</b>';
    $('cTiles').innerHTML = SS.ADDABLE.map(function (kind) {
      return '<button type="button" class="ws-tile" data-add-kind="' + kind + '"><span class="ws-sketch" aria-hidden="true">' + sketch(kind) + '</span>' +
        '<b>' + esc(kindName(kind)) + '</b><span>' + esc(tr('sec.what.' + kind)) + '</span></button>';
    }).join('');
    $('cAddBack').hidden = false; void $('cAddBack').offsetHeight; $('cAddBack').classList.add('in');
    var first = $('cTiles').querySelector('button'); if (first) first.focus();
  }
  function closeAdd() { $('cAddBack').classList.remove('in'); $('cAddBack').hidden = true; }
  $('cAddClose').addEventListener('click', closeAdd);
  $('cAddBack').addEventListener('click', function (e) {
    if (e.target === this) return closeAdd();
    var t = e.target.closest && e.target.closest('[data-add-kind]');
    if (!t) return;
    var page = viewPage(), kind = t.getAttribute('data-add-kind');
    closeAdd();
    if (!page) return;
    var sec = SS.newSection(kind, newId());
    state.doc.pages[page].splice(Math.max(1, state.insertAt || 1), 0, sec);
    freshKeys(SS.keysOf(sec));
    state.open = sec.id; state.sectab = 'words';
    arranged(true);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('cAddBack').hidden) closeAdd(); });

  async function removeSection(id) {
    var sec = secOf(id), at = state.idAt[id];
    if (!sec || !at) return;
    var fresh = !savedSecOf(id);
    if (!fresh) {
      var ok = await window.StaffConfirm({ title: tr('sec.removeTitle'), body: tr('sec.removeBody'), confirm: tr('sec.remove'), cancel: tr('ms.cancel'), danger: true });
      if (!ok) return;
    }
    dropFresh(freshIn(SS.keysOf(sec)));
    delete state.photos[id];
    state.doc.pages[at.page].splice(at.at, 1);
    if (state.open === id) state.open = null;
    arranged();
  }
  function addKeys(sec, keys) { freshKeys(keys.filter(function (k) { return !state.byId['site:' + k]; })); }
  function dropKeys(keys) { dropFresh(freshIn(keys)); }
  function partKeys(key, f) { return f === 'heading' ? [key + '_thin', key + '_bold'] : [key]; }

  /* everything a section's own controls do */
  $('cRows').addEventListener('click', async function (e) {
    var t = e.target.closest && e.target.closest('button');
    if (!t || !$('cRows').contains(t)) return;
    var d = t.dataset, sec, at, k;
    if (d.openSec) {
      state.open = state.open === d.openSec ? null : d.openSec;
      state.sectab = 'words';
      renderRows();
      prevShowSection(state.open);
      if (state.open) { var el = $('cRows').querySelector('.ws-acc[data-sid="' + state.open + '"]'); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
      return;
    }
    if (d.sectab) { state.sectab = d.sectab; return renderRows(); }
    if (d.insertAt) return openAdd(Number(d.insertAt));
    if (d.secRemove) return removeSection(d.secRemove);
    if (d.addPart) {
      at = d.addPart.split(':'); sec = secOf(at[0]);
      if (!sec) return;
      sec.words = sec.words || {};
      sec.words[at[1]] = SS.blockKey(sec.id, at[1]);
      addKeys(sec, partKeys(sec.words[at[1]], at[1]));
      return arranged();
    }
    if (d.dropPart) {
      at = d.dropPart.split(':'); sec = secOf(at[0]);
      if (!sec) return;
      if (at.length === 3) {
        k = SS.KINDS[sec.kind].list;
        dropKeys(sec.words[k].splice(Number(at[2]), 1));
      } else {
        dropKeys(partKeys(sec.words[at[1]], at[1]));
        delete sec.words[at[1]];
      }
      return arranged();
    }
    if (d.addPara) {
      sec = secOf(d.addPara);
      k = SS.KINDS[sec.kind].list;
      var pk = SS.blockKey(sec.id, SS.nextPart(sec, k === 'defs' ? 'def' : 'p'));
      sec.words[k] = (sec.words[k] || []).concat(pk);
      addKeys(sec, [pk]);
      return arranged();
    }
    if (d.addItem) {
      sec = secOf(d.addItem);
      var n = SS.nextPart(sec, 'item'), it = {};
      SS.KINDS[sec.kind].items.forEach(function (f) { it[f] = SS.blockKey(sec.id, n + '_' + f); });
      if (SS.KINDS[sec.kind].itemTo) it.to = 'about';
      sec.items.push(it);
      it = Object.assign({}, it); delete it.to;
      addKeys(sec, Object.keys(it).map(function (f) { return it[f]; }));
      return arranged();
    }
    if (d.dropItem) {
      at = d.dropItem.split(':'); sec = secOf(at[0]);
      var gone = sec.items.splice(Number(at[1]), 1)[0];
      dropKeys(Object.keys(gone).map(function (f) { return gone[f]; }));
      return arranged();
    }
    if (d.addButton) {
      sec = secOf(d.addButton);
      sec.buttons = sec.buttons || [];
      var bk = SS.blockKey(sec.id, SS.nextPart(sec, 'button'));
      sec.buttons.push({ label: bk, to: 'contact', style: sec.buttons.length ? 'ghost' : 'solid' });
      addKeys(sec, [bk]);
      return arranged();
    }
    if (d.dropButton) {
      at = d.dropButton.split(':'); sec = secOf(at[0]);
      dropKeys([sec.buttons.splice(Number(at[1]), 1)[0].label]);
      if (!sec.buttons.length) delete sec.buttons;
      return arranged();
    }
    if (d.btnStyle) {
      at = d.btnStyle.split(':'); sec = secOf(at[0]);
      sec.buttons[Number(at[1])].style = d.value;
      return arranged();
    }
    if (d.look) {
      at = d.look.split(':'); sec = secOf(at[0]);
      sec.look = sec.look || {};
      var plain = at[1] === 'ground' ? 'plain' : 'tech';
      if (d.value === plain) delete sec.look[at[1]]; else sec.look[at[1]] = d.value;
      if (!Object.keys(sec.look).length) delete sec.look;
      return arranged();
    }
    if (d.secUnphoto) {
      sec = secOf(d.secUnphoto);
      delete state.photos[sec.id];
      delete sec.photo;
      if (sec.words && sec.words.alt) { dropKeys([sec.words.alt]); delete sec.words.alt; }
      return arranged();
    }
    if (d.gotoPhoto) {
      /* Photos, on this photo (admin-photos.js) */
      var tabLink = document.querySelector('.web-side [data-web-tab="photos"]');
      if (tabLink) tabLink.click();
      document.dispatchEvent(new CustomEvent('photos:show', { detail: d.gotoPhoto }));
    }
  });
  $('cRows').addEventListener('change', async function (e) {
    var t = e.target, d = t.dataset, at, sec;
    if (d.btnTo) {
      at = d.btnTo.split(':'); sec = secOf(at[0]);
      var b = sec.buttons[Number(at[1])];
      b.to = t.value === '__url' ? 'https://' : t.value;
      arranged();
      if (t.value === '__url') { var u = $('cRows').querySelector('[data-btn-url="' + d.btnTo + '"]'); if (u) u.focus(); }
      return;
    }
    if (d.btnUrl) {
      at = d.btnUrl.split(':'); sec = secOf(at[0]);
      sec.buttons[Number(at[1])].to = t.value.trim();
      return arranged();
    }
    if (d.itemTo) {
      at = d.itemTo.split(':'); sec = secOf(at[0]);
      sec.items[Number(at[1])].to = t.value === '__url' ? 'https://' : t.value;
      arranged();
      if (t.value === '__url') { var iu = $('cRows').querySelector('[data-item-url="' + d.itemTo + '"]'); if (iu) iu.focus(); }
      return;
    }
    if (d.itemUrl) {
      at = d.itemUrl.split(':'); sec = secOf(at[0]);
      sec.items[Number(at[1])].to = t.value.trim();
      return arranged();
    }
    if (d.secPhoto && t.files && t.files[0]) {
      sec = secOf(d.secPhoto);
      var hint = t.closest('.ws-sec-row').querySelector('[data-photo-hint]');
      var file = t.files[0];
      t.value = '';
      var shot = window.PhotoCrop ? await window.PhotoCrop.open(file, 'site') : { blob: file };
      if (!shot) return;
      if (hint) hint.textContent = tr('lib.uploading');
      try {
        var res = await fetch('/api/admin/media?kind=site', { method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': shot.blob.type || 'image/jpeg', 'X-File-Name': String(file.name || sec.id).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').slice(0, 80) },
          body: shot.blob });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || tr('err.refused'));
        state.photos[sec.id] = body.url;
        sec.photo = sec.id;
        sec.words = sec.words || {};
        if (!sec.words.alt) { sec.words.alt = SS.blockKey(sec.id, 'alt'); addKeys(sec, [sec.words.alt]); }
        arranged();
      } catch (err) { if (hint) hint.textContent = err.message; }
    }
  });
  /* MOVING A SECTION: its grip, dragged or moved with the arrow keys, as on
     the staff Site Creator. The head of the page is not among them. */
  if (window.StaffSort) StaffSort($('cRows'), { items: '.ws-stack > .ws-acc.is-movable', handle: '.ws-acc.is-movable .sort-grip',
    key: function (it) { return it.getAttribute('data-sid'); },
    drop: function (parent, from, to) {
      var page = viewPage();
      if (!page) return;
      var list = state.doc.pages[page], moving = list.slice(1);
      moving.splice(to, 0, moving.splice(from, 1)[0]);
      state.doc.pages[page] = [list[0]].concat(moving);
      arranged();
    } });

  /* ---- Navigation: the menu ---------------------------------------------
     THE HEADER (Chase, 2026-10-21: "should we have the footer and header
     editor"): the menu's pages in the order the site shows them, each
     called what the menu calls it, and the Give button at the end. Home is
     the logo. A page switched off in Settings stays in its place here,
     marked, and comes back there when it is switched on. */
  function renderNav() {
    var el = $('cNav');
    if (!el || !state.rows.length) return;
    if (!state.doc) { el.innerHTML = ''; return; }
    var vis = (state.site && state.site.visibility && state.site.visibility.pages) || {};
    var html = '<div class="ws-head"><h2>' + esc(tr('sec.nav.title')) + '</h2></div>' +
      '<p class="ws-small c-navnote">' + esc(tr('sec.nav.note')) + '</p>' +
      '<div class="ws-linkrows c-navlist">' + state.doc.nav.map(function (slug) {
        var v = vis[slug], off = v && typeof v === 'object' ? !v.live : v === false;
        return '<div class="ws-linkitem" data-slug="' + esc(slug) + '"><div class="ws-linkrow c-navrow">' + grip() +
          '<div class="c-rows">' + box('nav.' + slug, sectionLabel(slug)) + '</div>' +
          (off ? '<a class="ws-pill c-navoff" href="/admin/website/settings/" data-web-go="settings">' + esc(tr('sec.offLive')) + '</a>' : '') + '</div></div>';
      }).join('') + '</div>' +
      '<div class="c-rows c-navgive">' + box('nav.give', tr('sec.nav.give')) + '</div>';
    el.innerHTML = html;
    el.querySelectorAll('textarea').forEach(autosize);
  }
  if ($('cNav') && window.StaffSort) StaffSort($('cNav'), { items: '.c-navlist > .ws-linkitem', handle: '.ws-linkitem .sort-grip',
    key: function (it) { return it.getAttribute('data-slug'); },
    drop: function (parent, from, to) {
      state.doc.nav.splice(to, 0, state.doc.nav.splice(from, 1)[0]);
      renderNav(); renderSaveBar(); prevArrange();
    } });

  /* ---- Footer ----------------------------------------------------------
     What is in it — the contact page, Stay Connected, the site's own links
     and its social icons (Links) — and what it says. The © and the year
     that start the small print are one of the arcade's doors (doors.js),
     and are said to be. */
  function renderFoot() {
    var el = $('cFoot');
    if (!el || !state.rows.length) return;
    var site = state.site || {}, vis = (site.visibility || {}), pages = vis.pages || {}, secs = vis.sections || {};
    var on = function (v) { return v == null ? true : typeof v === 'object' ? !!v.dev : !!v; };
    var pills = [];
    if (on(pages.contact)) pills.push(plainOf(draftOf('nav.contact')));
    pills.push(plainOf(draftOf('footer.stay')));
    (site.links || []).forEach(function (k) { var l = (k.label || {})[state.lang] || (k.label || {}).en || k.url; if (l) pills.push(l); });
    if (on(secs.socialLinks)) Object.keys(site.socials || {}).forEach(function (s) { if (site.socials[s]) pills.push(s.charAt(0).toUpperCase() + s.slice(1)); });
    var legal = plainOf(draftOf('footer.legal'));
    el.innerHTML = '<div class="ws-head"><h2>' + esc(tr('ws.footer.has')) + '</h2></div><div class="ws-infoot">' +
        pills.map(function (x) { return '<span class="ws-pill">' + esc(x) + '</span>'; }).join('') +
        '<a class="ghost-btn sm" href="/admin/website/links/" data-web-go="links">' + esc(tr('ws.footer.editLinks')) + ' →</a></div>' +
      '<div class="c-rows">' +
        box('footer.tagline', tr('sec.foot.tagline')) + box('footer.stay', tr('sec.foot.stay')) +
        box('footer.legal', tr('sec.foot.legal')) + box('footer.region', tr('sec.foot.region')) + '</div>' +
      '<p class="ws-small c-footnote' + (/^©\s?\d{4}/.test(legal) ? '' : ' is-warn') + '" data-arcade-note>' + esc(tr(/^©\s?\d{4}/.test(legal) ? 'sec.foot.door' : 'sec.foot.noDoor')) + '</p>';
    el.querySelectorAll('textarea').forEach(autosize);
  }

  /* A photo's name, for Photos: the page, and what its section says. */
  window.ThaumaPhotoName = function (slot) {
    if (!state.doc || !state.rows.length) return null;
    var hit = null;
    Object.keys(state.doc.pages).forEach(function (p) { state.doc.pages[p].forEach(function (s) { if (s.photo === slot) hit = s; }); });
    if (!hit) return null;
    var words = secSummary(hit);
    return sectionLabel(state.idAt[hit.id].page) + ' · ' + (words.length > 40 ? words.slice(0, 38) + '…' : words || kindName(hit.kind));
  };

  /* ---- the preview, arranged as on screen --------------------------------
     A page's sections are drawn into the preview with the templates that
     build the site (src/_includes/sections, copied to /site-sections/) by
     the engine that builds it (Nunjucks, copied to /js/vendor/), so what is
     added, moved or taken away shows before it is saved. A section that has
     not changed is the page's own, animations and all; a fixed part (the
     team, the form) is always the page's own. */
  var NJ = null, njLoading = null;
  function loadScript(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = no;
      document.head.appendChild(s);
    });
  }
  function renderer() {
    if (NJ) return Promise.resolve(NJ);
    if (njLoading) return njLoading;
    var v = ($('cPreview') && $('cPreview').getAttribute('data-v')) || '';
    var kinds = Object.keys(SS.KINDS).filter(function (k) { return !SS.KINDS[k].fixed; });
    njLoading = Promise.all([
      window.nunjucks ? null : loadScript('/js/vendor/nunjucks.min.js?v=' + v),
      window.ThaumaFrame ? null : loadScript('/js/frame.js?v=' + v),
      Promise.all(kinds.map(function (k) {
        return fetch('/site-sections/' + k + '.njk?v=' + v, { credentials: 'same-origin' }).then(function (r) {
          if (!r.ok) throw new Error(k);
          return r.text();
        });
      }))
    ]).then(function (got) {
      var src = {};
      kinds.forEach(function (k, i) { src['sections/' + k + '.njk'] = got[2][i]; });
      var Loader = window.nunjucks.Loader.extend({
        getSource: function (name) { return src[name] != null ? { src: src[name], path: name, noCache: false } : null; }
      });
      var env = new window.nunjucks.Environment(new Loader(), { autoescape: true });
      env.addFilter('w', SS.wordAt);
      env.addFilter('sectionHref', SS.sectionHref);
      env.addFilter('rich', function (s, key) {
        var html = window.SiteRich.richHtml(s);
        return new window.nunjucks.runtime.SafeString(key ? '<span data-k="' + String(key).replace(/[^\w.\-]/g, '') + '">' + html + '</span>' : html);
      });
      env.addFilter('plain', function (s) { return window.SiteRich.richPlain(s); });
      env.addFilter('frameStyle', window.ThaumaFrame.frameStyle);
      NJ = env;
      return env;
    }, function (e) { njLoading = null; throw e; });
    return njLoading;
  }
  /* The words of the language being written, as the page reads them. */
  function wordsTree() {
    var t = {};
    state.lines.forEach(function (l) {
      if (l.source !== 'site') return;
      var parts = l.key.split('.'), node = t;
      for (var i = 0; i < parts.length - 1; i++) {
        if (node[parts[i]] == null) node[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        node = node[parts[i]];
      }
      node[parts[parts.length - 1]] = state.draft[l.id];
    });
    return t;
  }
  function renderSection(env, sec, t) {
    var images = {}, si = (state.site && state.site.images) || {};
    Object.keys(si).forEach(function (k) { images[k] = si[k]; });
    Object.keys(state.photos).forEach(function (k) { images[k] = { src: state.photos[k], focal_x: 50, focal_y: 50, zoom: 100 }; });
    return env.render('sections/' + sec.kind + '.njk', { sec: sec, t: t, lang: state.lang, site: { images: images }, env: { isProduction: false } });
  }
  /* Which of the preview's elements a section is: the one holding its
     first word, or for a fixed part, the one only it could be. */
  var FIXED_EL = { homeHero: 'header.hero', convictions: 'section:has(.conviction)', teamGrid: 'section:has(.team-grid)',
    library: 'section:has(.lib), section:has([data-k^="resources."])', gatherings: 'section:has([data-k^="events."]), section:has(.invite)',
    contactForm: 'section:has(form.contact)', giving: 'section:has(.give-grid)' };
  function kidsOf(main) { return [].filter.call(main.children, function (c) { return !/^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName); }); }
  function elOf(main, sec) {
    var kids = kidsOf(main), i;
    if (SS.KINDS[sec.kind].fixed) {
      for (i = 0; i < kids.length; i++) { try { if (kids[i].matches(FIXED_EL[sec.kind])) return kids[i]; } catch (e) { return null; } }
      return null;
    }
    var first = SS.keysOf(sec)[0];
    if (!first) return null;
    for (i = 0; i < kids.length; i++) if (kids[i].querySelector('[data-k="' + first + '"]')) return kids[i];
    return null;
  }
  /* Drawn by the page itself when the page was built from it as it is; a
     section changed since, or anything after a save the site has not been
     rebuilt from yet, is drawn here. */
  function unchanged(sec) {
    if (SS.KINDS[sec.kind].fixed) return true;
    if (state.structSaved) return false;
    var was = savedSecOf(sec.id);
    return !!was && JSON.stringify(was.sec) === JSON.stringify(sec) && !freshIn(SS.keysOf(sec)).length;
  }
  var arrangeTimer = null;
  function prevArrange() { clearTimeout(arrangeTimer); arrangeTimer = setTimeout(arrangeNow, 40); }
  async function arrangeNow() {
    var doc = prevDoc(), page = prevSection();
    if (!doc || !state.doc || !doc.querySelector('main')) return;
    if ((doc.documentElement.getAttribute('lang') || state.lang) !== state.lang) return;
    prevMenu(doc);
    if (!isSectioned(page)) return;
    var main = doc.querySelector('main'), list = state.doc.pages[page], kids = kidsOf(main);
    var found = list.map(function (sec) { return unchanged(sec) ? elOf(main, sec) : null; });
    /* nothing to do: every section is the page's own, in the page's order */
    if (found.length === kids.length && found.every(function (el, i) { return el && el === kids[i]; })) return prevShowSection(state.open, true);
    var env;
    try { env = await renderer(); } catch (e) { return; }
    if (prevDoc() !== doc) return;
    var t = wordsTree(), win = doc.defaultView, y = win ? win.scrollY : 0;
    var els = list.map(function (sec, i) {
      if (found[i]) return found[i];
      if (SS.KINDS[sec.kind].fixed) return null;
      var tmp = doc.createElement('div');
      try { tmp.innerHTML = renderSection(env, sec, t); } catch (e) { return null; }
      return tmp.firstElementChild;
    }).filter(Boolean);
    kids.forEach(function (c) { if (els.indexOf(c) === -1) c.remove(); });
    var tail = [].filter.call(main.children, function (c) { return /^(SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName); })[0] || null;
    els.forEach(function (el) { main.insertBefore(el, tail); });
    if (win) win.scrollTo(0, y);
    prevShowSection(state.open, true);
  }
  /* The menu in the order on screen: its own links, moved. */
  function prevMenu(doc) {
    var saved = savedDoc();
    if (!saved || !state.doc) return;
    ['.links', '.mobile-menu'].forEach(function (sel) {
      var box = doc.querySelector(sel);
      if (!box) return;
      state.doc.nav.forEach(function (slug) {
        var a = box.querySelector('a[href$="/' + slug + '/"]');
        if (a) box.appendChild(a);
      });
      var give = sel === '.mobile-menu' && box.querySelector('a[href$="/give/"]');
      if (give) box.appendChild(give);
    });
  }
  /* The open section, outlined in the preview and brought into view. */
  function prevShowSection(id, quiet) {
    var doc = prevDoc();
    if (!doc) return;
    [].forEach.call(doc.querySelectorAll('.c-prev-sec'), function (x) { x.classList.remove('c-prev-sec'); });
    var sec = id && secOf(id), main = doc.querySelector('main');
    if (!sec || !main || state.idAt[id].page !== prevSection()) return;
    var el = elOf(main, sec);
    if (!el) return;
    el.classList.add('c-prev-sec');
    if (!quiet) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  /* A SECTION PRESSED IN THE PREVIEW OPENS IN THE LIST (as the staff Site
     Creator's preview does): its words, ready to write. A link still goes
     where it goes, and opens that page. */
  function prevPress(doc, e) {
    if (onTab() !== 'pages') return;
    var t = e.target;
    if (!t.closest || t.closest('a, button, input, textarea, select, label, form, dialog')) return;
    var main = doc.querySelector('main'), page = prevSection();
    if (!main || !main.contains(t) || !isSectioned(page)) return;
    var hit = null;
    state.doc.pages[page].some(function (sec) { var el = elOf(main, sec); if (el && el.contains(t)) { hit = sec.id; return true; } return false; });
    if (!hit) return;
    if (state.view !== 'section:' + page) openView('section:' + page, true);
    state.open = hit; state.sectab = 'words';
    renderRows();
    prevShowSection(hit, true);
    var acc = $('cRows').querySelector('.ws-acc[data-sid="' + hit + '"]');
    if (acc) acc.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---- Advanced: search and sharing ------------------------------------
     SEARCH AND SHARING (2026-10-07, suggestion 4; on its own tab since
     2026-10-20, as the staff Site Creator has it): a page from the menu,
     how it shows in a search and when shared, then its two lines and its
     picture. */
  function advPages() {
    return orderedSections().filter(function (sec) {
      return PAGE_OF[sec] != null && state.rows.some(function (r) { return r.section === sec && isSeo(r); });
    });
  }
  function renderAdvanced() {
    var box = $('cAdv');
    if (!state.rows.length) return;
    var pages = advPages();
    if (!pages.length) { box.innerHTML = '<p class="empty">' + esc(tr('con.noMatches')) + '</p>'; return; }
    if (pages.indexOf(state.advPage) === -1) {
      var was = null;
      try { was = sessionStorage.getItem('thauma.content.adv'); } catch (e) { /* private mode */ }
      state.advPage = pages.indexOf(was) !== -1 ? was : pages[0];
    }
    var page = state.advPage;
    var rows = state.rows.filter(function (r) { return r.section === page && isSeo(r); })
      .sort(function (a, b) { return (isTabName(b) ? 1 : 0) - (isTabName(a) ? 1 : 0); });
    box.innerHTML = '<div class="ws-head"><h2>' + esc(tr('ws.adv.title')) + '</h2>' +
      '<label class="ws-pagepick"><span class="sr-only">' + esc(tr('web.pages')) + '</span><select data-adv-page>' +
        pages.map(function (sec) {
          var dirty = state.rows.some(function (r) { return r.section === sec && isSeo(r) && rowDirty(r); });
          return '<option value="' + esc(sec) + '"' + (sec === page ? ' selected' : '') + '>' + esc(sectionLabel(sec)) + (dirty ? ' •' : '') + '</option>';
        }).join('') + '</select></label></div>' +
      seoCard(page) + '<div class="c-rows">' + rows.map(function (r) { return rowHtml(r, isTabName(r) ? { label: tr('sec.page.tabName') } : null); }).join('') + '</div>';
    box.querySelectorAll('textarea').forEach(autosize);
  }

  /* THE FILE FOR A TRANSLATOR (Languages tab): the lines still to be
     translated into the language being written — every line once none is.
     English, the source, has neither the file nor the upload. */
  function translatorLines() {
    var rows = state.rows.filter(needsWork);
    if (!rows.length) rows = state.rows;
    var ids = [];
    rows.forEach(function (r) { r.lines.forEach(function (l) { ids.push(l.id); }); });
    return ids;
  }
  function renderMore() {
    if (!$('cDown')) return;
    var n = translatorLines().length;
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
    var d = dirtyIds().filter(function (id) { return !state.byId[id] || !state.byId[id].fresh; });
    /* which tabs hold them, for the marks on the tabs (admin-website.js) */
    var tabs = [], add = function (t) { if (tabs.indexOf(t) === -1) tabs.push(t); };
    d.forEach(function (id) {
      var l = state.byId[id], k = l && l.source === 'site' ? l.key : '';
      add(/\.seo_(title|desc)$/.test(k) ? 'advanced' : /^nav\./.test(k) ? 'navigation' : /^footer\./.test(k) ? 'footer' : 'pages');
    });
    var saved = savedDoc();
    if (saved && state.doc) {
      if (JSON.stringify(saved.nav) !== JSON.stringify(state.doc.nav)) add('navigation');
      if (JSON.stringify(saved.pages) !== JSON.stringify(state.doc.pages)) add('pages');
    }
    var n = d.length + structChanges();
    $('cSaveBar').setAttribute('data-tabs', tabs.join(' ') || 'pages');
    $('cSaveBar').hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    if (!n) return;
    $('cDirtyCount').textContent = n === 1 ? tr('con.oneChange') : n + ' ' + tr('con.nChanges');
  }

  /* After an edit, the row's own marks change without a redraw — a redraw
     would take the focus out of the box being typed into. */
  function markRow(el) {
    var rowEl = el.closest('.c-row');
    var row = state.rows.filter(function (r) { return r.id === rowEl.getAttribute('data-row'); })[0];
    if (!row) return;
    row.lines.forEach(function (l) { delete state.blocked[l.id]; });
    var dirty = rowDirty(row), unpub = !dirty && rowUnpub(row);
    [].forEach.call(document.querySelectorAll('.c-row[data-row="' + rowEl.getAttribute('data-row').replace(/"/g, '') + '"]'), function (el) {
      el.classList.toggle('is-dirty', dirty);
      el.classList.toggle('is-unpub', unpub);
      var u = el.querySelector('.c-undo');
      if (u) { if (dirty || unpub) u.removeAttribute('tabindex'); else u.setAttribute('tabindex', '-1'); }
    });
    rowEl.classList.remove('is-blocked');
    /* the section's own mark, as it changes */
    var acc = rowEl.closest('.ws-acc'), sec = acc && secOf(acc.getAttribute('data-sid'));
    var head = acc && acc.querySelector('.ws-stile-words b');
    if (sec && head) {
      var d = head.querySelector('.ws-dot'), on = secChanged(sec);
      if (on && !d) head.insertAdjacentHTML('beforeend', dot(true));
      if (!on && d) d.remove();
    }
    /* Being written now says more than having been missing or outdated. */
    var mark = needsWork(row) ? rowStatus(row) : '';
    rowEl.classList.toggle('is-' + mark, !!mark && !dirty);
    var badge = rowEl.querySelector('.c-key .tl-st');
    if (badge) badge.hidden = dirty;
    renderSaveBar();
    renderCrumb();
  }

  /* ---- editing -------------------------------------------------------- */

  var BOXES = [$('cRows'), $('cAdv'), $('cNav'), $('cFoot')].filter(Boolean);
  function onBoxes(type, fn) { BOXES.forEach(function (b) { b.addEventListener(type, fn); }); }
  onBoxes('input', function (e) {
    var t = e.target;
    if (t.tagName === 'TEXTAREA') {
      state.draft[t.getAttribute('data-id')] = t.value;
      freshTyped(t.getAttribute('data-id'));
      autosize(t);
      prevDraw(t.getAttribute('data-id'));
      seoLive(t.getAttribute('data-id'));
      return markRow(t);
    }
    var box = t.closest && t.closest('.c-rt');
    if (!box) return;
    if (box.hasAttribute('data-thin')) {
      var parts = readSplit(box);
      state.draft[box.getAttribute('data-thin')] = parts.thin;
      state.draft[box.getAttribute('data-bold')] = parts.bold;
      freshTyped(box.getAttribute('data-thin')); freshTyped(box.getAttribute('data-bold'));
      prevDraw(box.getAttribute('data-thin')); prevDraw(box.getAttribute('data-bold'));
    } else {
      state.draft[box.getAttribute('data-id')] = boxWords(box);
      freshTyped(box.getAttribute('data-id'));
      prevDraw(box.getAttribute('data-id'));
      seoLive(box.getAttribute('data-id'));
    }
    markRow(box);
  });

  function freshTyped(id) {
    var l = state.byId[id];
    if (l && l.fresh && state.fresh[l.key]) state.fresh[l.key][state.lang] = state.draft[id];
  }

  function readSplit(box) {
    var all = boxWords(box), at = all.indexOf('<b>');
    if (at === -1) return { thin: all.replace(/[ \t]+$/, ''), bold: '' };
    return { thin: all.slice(0, at).replace(/[ \t]+$/, ''), bold: all.slice(at).replace(/<\/?b>/g, '').replace(/^[ \t]+/, '') };
  }

  /* Enter is a new line, never a new paragraph block; a paste brings the
     words (and their line breaks), not another page's formatting. */
  onBoxes('keydown', function (e) {
    var box = e.target.closest && e.target.closest('.c-rt');
    if (!box || e.key !== 'Enter') return;
    e.preventDefault();
    document.execCommand('insertLineBreak');
  });
  onBoxes('paste', function (e) {
    var box = e.target.closest && e.target.closest('.c-rt');
    if (!box) return;
    e.preventDefault();
    var text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
    if (document.execCommand) document.execCommand('insertText', false, text);
  });
  /* Leaving a heading shows it as it will be saved: where its bold half
     really begins. */
  /* a box's own Discard Changes */
  onBoxes('click', function (e) {
    var u = e.target.closest && e.target.closest('[data-undo]');
    if (u) undoRow(u.getAttribute('data-undo'));
  });
  onBoxes('focusout', function (e) {
    var box = e.target.closest && e.target.closest('.c-splitbox');
    if (!box) return;
    var html = splitHtml(state.draft[box.getAttribute('data-thin')], state.draft[box.getAttribute('data-bold')]);
    if (box.innerHTML !== html) box.innerHTML = html;
  });

  /* A page, Needs Work, every line, or (null) the list of pages. `quiet`:
     the preview is already there, having been pressed into. */
  function openView(view, quiet) {
    if ((view || null) !== state.view) state.open = null;
    state.view = view || null;
    prev.section = null;
    try {
      if (state.view) sessionStorage.setItem('thauma.content.view.' + state.lang, state.view);
      else sessionStorage.removeItem('thauma.content.view.' + state.lang);
    } catch (e2) { /* private mode */ }
    // A page and a search are two ways of choosing what is on screen;
    // leaving both on shows neither.
    if (state.find) { state.find = ''; $('cFind').value = ''; }
    renderCrumb(); renderRows(); renderMore();
    if (!quiet) previewSync();
    var top = $('cRoot').getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top - 100);
  }
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
      renderCrumb(); renderRows(); renderMore();
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
    try { localStorage.setItem('thauma.content.beside', state.beside); } catch (e2) { /* private mode */ }
    await loadBeside();
    renderRows();
  });

  $('cDiscard').addEventListener('click', async function () {
    var n = dirtyIds().length + structChanges();
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: tr('con.discardTitle'), body: fill('con.discardBody', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.lines.forEach(function (l) { state.draft[l.id] = state.saved[l.id]; });
    state.blocked = {};
    /* the arrangement as saved, and nothing added since */
    dropFresh(Object.keys(state.fresh));
    state.photos = {};
    if (state.docSaved) takeDoc(JSON.parse(state.docSaved));
    buildRows();
    prev.url = null;
    render();
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
     refused, and a line somebody else changed meanwhile is left as theirs.

     THE ARRANGEMENT FIRST: sections added, moved or taken away, with the
     words of what was added in every language, in one commit
     (/api/admin/sections) — then the words of what was already there. If
     the arrangement is refused, nothing else is sent. */
  $('cSave').addEventListener('click', async function () {
    var btn = this;
    if (state.ready) await state.ready;       // never saved against the kept copy
    if (state.waitingAsk) await state.waitingAsk;   // nor before knowing what dev changed
    var struct = docDirty() || Object.keys(state.fresh).length > 0;
    var ids = dirtyIds().filter(function (id) { return !state.byId[id].fresh; });
    if (!ids.length && !struct) return;
    btn.disabled = true; $('cDiscard').disabled = true;
    var done = function () { btn.disabled = false; $('cDiscard').disabled = false; };
    var saved = 0, siteMoved = false, structN = structChanges();

    if (struct) {
      var words = {};
      state.langs.forEach(function (l) { words[l] = {}; });
      Object.keys(state.fresh).forEach(function (key) {
        state.langs.forEach(function (l) { words[l][key] = l === state.lang ? state.draft['site:' + key] : state.fresh[key][l]; });
      });
      var made = await send(SECTIONS_API, 'POST', { action: 'save', sha: state.docSha, doc: state.doc, words: words, photos: state.photos });
      if (!made) return done();
      if (made.failed) { done(); return refused(made); }
      state.docSha = made.sha;
      state.docSaved = JSON.stringify(made.doc);
      state.structSaved = true;
      state.fresh = {}; state.freshBase = {}; state.photos = {};
      takeDoc(JSON.parse(state.docSaved));
      snapPut('sections', { doc: made.doc, sha: made.sha });
      siteMoved = (made.files || []).indexOf('src/_data/site.json') !== -1;
      saved += Math.max(1, structN);
    }

    var conflicts = [], kept = {};
    if (ids.length) {
      var data = await send(WORDS, 'POST', { action: 'save', lang: state.lang, items: ids.map(function (id) {
        var it = { id: id, value: state.draft[id], was: state.base[id] };
        if (state.waiting[id]) it.waiting = true;
        return it;
      }) });
      if (!data) { done(); if (struct) await openLang(state.lang, true); return; }
      if (data.failed) {
        done();
        if (data.code === 'problems' && data.ids) {
          data.ids.forEach(function (id) { state.blocked[id] = true; });
          renderRows();
          return toast(tr('tl.problems'), 'err');
        }
        return refused(data);
      }
      ids.forEach(function (id) { kept[id] = state.draft[id]; });
      saved += data.saved || 0;
      conflicts = data.conflicts || [];
      if (conflicts.length) toast(fill('tl.conflicts', { n: conflicts.length }), 'err');
      if (data.devMissed && data.devMissed.length) toast(tr('con.devMissed'), 'err');
    }
    done();
    toast(fill('con.saved', { n: saved }), 'ok');
    document.dispatchEvent(new CustomEvent('web:saved'));
    /* a section's own photo is a slot in site.json: every tab that reads it
       reads it again (admin-photos.js, admin-site.js) */
    if (siteMoved) {
      var site = await send(CONTENT + '?file=site', 'GET', null, true);
      if (site && !site.failed && site.data) {
        snapPut('site', site);
        takeSite(site);
        document.dispatchEvent(new CustomEvent('thauma:site-saved', { detail: { sha: site.sha, changes: {}, from: 'sections' } }));
      }
    }
    await openLang(state.lang, true);
    loadSummary();
    prev.url = null;
    previewSync();
    // A line left as somebody else's keeps what was typed, still unsaved.
    if (conflicts.length) {
      conflicts.forEach(function (id) { if (id in kept) state.draft[id] = kept[id]; });
      render();
    }
  });

  /* THE PAGES WITH WORDS NOT PUBLISHED YET get the same dot as an unsaved
     one (admin-website.js asks which lines differ from live). */
  var changedLines = [];
  function markChanged() {
    var set = {};
    changedLines.forEach(function (id) { set[id] = true; });
    state.changedIds = set;
    state.changedSecs = {};
    state.lines.forEach(function (l) { if (set[l.id]) state.changedSecs[sectionOf(l)] = true; });
    if (state.rows.length && !state.review) renderAll();
  }
  document.addEventListener('web:changes', function (e) {
    changedLines = (e.detail && e.detail.lines) || [];
    /* the pages whose sections are arranged differently from what visitors see */
    state.unpubPages = {};
    ((e.detail && e.detail.pages) || []).forEach(function (p) { state.unpubPages[p] = true; });
    markChanged();
  });

  window.addEventListener('beforeunload', function (e) {
    if (dirtyIds().length || docDirty() || state.review) { e.preventDefault(); e.returnValue = ''; }
  });

  /* Shown after loading hidden (admin-website.js): a text box measured while
     hidden measured nothing, so measure again. */
  document.addEventListener('web:panel', function (e) {
    if (e.detail === 'pages' && state.rows.length) renderRows();
    if (e.detail === 'navigation') renderNav();
    if (e.detail === 'footer') { renderFoot(); setTimeout(prevToFoot, 50); }
    /* Advanced opens on the page open on Pages, where it has a search card */
    if (e.detail === 'advanced') {
      var sec = /^section:/.test(state.view || '') ? state.view.slice(8) : null;
      if (sec && advPages().indexOf(sec) !== -1) state.advPage = sec;
      renderAdvanced();
    }
    tabShown();
  });

  /* ---- the file for a translator, and what comes back ---------------- */

  $('cDown').addEventListener('click', async function () {
    var ids = translatorLines();
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
    await openLang(body.code);
    showLangs();
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
    if (onTab() === 'languages') renderTable();
  });

  function sw(path, on, label) {
    return '<button type="button" class="switch small" role="switch" data-set="' + esc(path) + '"' +
      ' aria-checked="' + (on ? 'true' : 'false') + '"' + (on ? ' data-on="1"' : '') +
      ' aria-label="' + esc(label) + '">' +
        '<span class="switch-track"><span class="switch-state">' + tr(on ? 'switch.on' : 'switch.off') +
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

  /* THE LANGUAGES TAB (2026-10-27): drawn whenever it is shown, with each
     language's progress read again. */
  function showLangs() {
    if (!$('cSetBody') || !state.site) return;
    renderTable();
    loadSummary();
  }
  document.addEventListener('web:panel', function (e) { if (e.detail === 'languages') showLangs(); });
  function guidesDirty() {
    return [].some.call(document.querySelectorAll('#cSetBody [data-guide]'), function (box) {
      return box.querySelector('textarea').value !== (state.notes.guides[box.getAttribute('data-guide')] || '');
    });
  }
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

  tabShown();
  boot();
})();
