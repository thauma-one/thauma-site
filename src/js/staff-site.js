/* ============================================================
   staff-site.js — the ministry's own website (Website tab, 0044)
   ============================================================
   Pages · Design · Links · Footer · Settings, from /api/staff-site.

   HOW SAVING WORKS. Every change goes into the working copy on the
   server a moment after it is made ("Saved"), so nothing is lost
   between visits and the preview beside the sections shows it. What
   visitors see changes only with Publish, in the bar along the foot.

   WHO MAY CHANGE IT. The owner, and whoever the owner allows. Anyone
   else on the team sees the same screens with every control switched
   off, and a way to ask. The server enforces that; this only draws it.

   Words are written one language at a time — Editing and Reference,
   with Swap and Translate — like every other editor here.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-staff-page') !== 'website') return;

  var API = '/api/staff-site';
  var $ = function (id) { return document.getElementById(id); };
  var state = { body: null, doc: null, openSocial: null, openCustom: null, tab: 'design', page: null, edit: null, anchor: null, animate: null, sectab: 'words', openItem: null, showKicker: false,
                insertAt: null, frameDirty: false, langA: null, langB: null,
                timer: null, saving: false, again: false, frameTimer: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function fill(k, v) { return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(k, v) : tr(k); }
  function toast(m, kind) { if (window.StaffToast) window.StaffToast(m, kind); }
  function canEdit() { return !!(state.body && state.body.can.edit); }
  /* Asked the device for less motion? (Never assume there is a way to ask.) */
  function still() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* What each kind of section is made of — the same list as site/model.js. */
  var SECTIONS = {
    hero: { variants: ['behind', 'beside', 'words', 'monogram'], words: ['kicker', 'heading', 'text', 'button'], photo: true, buttons: true, link: 'button' },
    header: { variants: ['watermark', 'plain'], words: ['label', 'heading', 'text', 'mark'] },
    text: { variants: ['left', 'center'], words: ['heading', 'text', 'verse', 'verseRef', 'button'], link: 'button' },
    photoText: { variants: ['left', 'right', 'above', 'wrapLeft', 'wrapRight'], words: ['heading', 'text', 'verse', 'verseRef', 'button'], photo: true, link: 'both' },
    photo: { variants: ['drift', 'still', 'zoom'], words: ['caption'], photo: true, link: 'photo' },
    quote: { variants: ['large', 'quiet'], words: ['quote', 'who'] },
    timeline: { variants: ['condensed', 'full'], words: ['heading', 'text'], data: 'updates/#milestones', align: true },
    goals: { variants: ['cards'], words: ['heading', 'text'], data: 'updates/#goals', align: true },
    prayer: { variants: ['list'], words: ['heading', 'text'], data: 'updates/#prayer', align: true },
    videos: { variants: ['stage'], words: ['heading', 'text'], data: 'updates/#videos', align: true },
    newsletters: { variants: ['latest', 'list'], words: ['heading', 'text'], data: 'mail/', align: true },
    signup: { variants: ['band', 'card', 'split', 'open'], words: ['heading', 'text'], data: 'sharing/#signup' },
    contact: { variants: ['form', 'split', 'wide', 'open'], words: ['heading', 'text'], data: 'sharing/#contact', align: true },
    give: { variants: ['band', 'card', 'split', 'spotlight'], words: ['heading', 'text', 'button'] },
    cards: { variants: ['attached', 'detached'], words: ['heading', 'text'], items: 'cards' },
    links: { variants: ['list', 'cards'], words: ['heading', 'text'], items: true, align: true },
  };
  /* Everything but the opening and a full-width photo can sit on a raised band. */
  var FLAT = { hero: 1, photo: 1, header: 1 };
  /* On a section of the ministry's data, "text" is the line under the heading;
     on a header it is the small print below the title. */
  function fieldName(type, f) {
    if (type === 'header' && f === 'text') return tr('ws.f.below');
    return f === 'text' && (SECTIONS[type].data || type === 'links') && type !== 'signup' && type !== 'contact' ? tr('ws.f.subtitle') : tr('ws.f.' + f);
  }
  var ORDER = ['hero', 'header', 'text', 'photoText', 'photo', 'quote', 'timeline', 'goals', 'prayer', 'videos', 'newsletters', 'signup', 'contact', 'give', 'cards', 'links'];
  var MOTION = {
    entrance: ['rise', 'fade', 'slide', 'zoom', 'none'], photos: ['drift', 'zoom', 'still'],
    headings: ['letters', 'words', 'plain'], buttons: ['lift', 'glow', 'plain'],
    pages: ['fade', 'cut'], progress: ['on', 'off'], cue: ['line', 'arrow', 'mouse', 'none'],
  };
  var SOCIALS = ['youtube', 'instagram', 'facebook', 'x', 'tiktok', 'linkedin', 'spotify', 'email'];
  var LOOKS = ['night', 'paper', 'bold', 'custom'];
  var FOOTERS = ['split', 'center', 'columns'];
  var SOCIAL_NAME = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok',
    linkedin: 'LinkedIn', spotify: 'Spotify', email: 'Email' };

  /* ---- the languages --------------------------------------------------- */

  function langName(code) {
    var l = (state.body.languages || []).filter(function (x) { return x.code === code; })[0];
    return l ? (l.native_name || l.name) : code;
  }
  function fillPair() {
    var langs = state.doc.languages;
    if (langs.indexOf(state.langA) === -1) state.langA = langs.indexOf(state.doc.fallback) !== -1 ? state.doc.fallback : langs[0];
    var others = langs.filter(function (l) { return l !== state.langA; });
    if (others.indexOf(state.langB) === -1) state.langB = others[0] || null;
    $('wsLangA').innerHTML = langs.map(function (l) { return '<option value="' + esc(l) + '">' + esc(langName(l)) + '</option>'; }).join('');
    $('wsLangA').value = state.langA;
    $('wsLangB').innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l) + '"' + (l === state.langA ? ' hidden disabled' : '') + '>' + esc(langName(l)) + '</option>';
    }).join('');
    $('wsLangB').value = state.langB || '';
    $('wsRefWrap').hidden = !others.length;
    /* Words are written on Pages, Links and Footer; Design and Settings have none. */
    $('wsWriting').hidden = !(state.tab === 'pages' || state.tab === 'links' || state.tab === 'footer');
  }
  $('wsLangA').addEventListener('change', function () { state.langA = this.value; if (state.langB === state.langA) state.langB = null; fillPair(); draw(); });
  $('wsLangB').addEventListener('change', function () { state.langB = this.value; draw(); });

  /* ---- saving ---------------------------------------------------------- */

  function changed(redrawPreview, fromUndo) {
    if (!canEdit()) return;
    if (!fromUndo) pushUndo();
    drawDots();
    $('wsSaved').textContent = tr('ws.saving');
    clearTimeout(state.timer);
    state.timer_pending = true;
    state.timer = setTimeout(function () { state.timer_pending = false; save(); }, 650);
    /* The preview is redrawn once the save has landed, never before — so
       it shows exactly what is in the boxes (Chase, 2026-09-29). */
    if (redrawPreview !== false) state.frameDirty = true;
  }
  async function save() {
    if (state.saving) { state.again = true; return; }
    state.saving = true;
    try {
      var body;
      try { body = await send({ action: 'save', draft: state.doc, base: state.base }); }
      catch (e) {
        /* Someone else saved this site since it loaded (workers/src/lib/
           fresh.js): ask. Saving mine sends it again with overwrite;
           keeping theirs loads their version into the editor. */
        if (!(e.answer && e.answer.changed)) throw e;
        $('wsSaved').textContent = '';
        if (!(await window.StaffChanged(e.answer))) { state.saving = false; await load(); return; }
        body = await send({ action: 'save', draft: state.doc, overwrite: true });
      }
      state.base = body.draft;
      state.body.site = body.site;
      $('wsSaved').textContent = tr('ws.saved');
      drawBar(); drawStatus();
      if (state.frameDirty && !state.timer_pending) { state.frameDirty = false; refreshFrame(); }
    } catch (e) {
      $('wsSaved').textContent = '';
      toast(e.message, 'err');
    }
    state.saving = false;
    if (state.again) { state.again = false; save(); }
  }
  async function send(payload) {
    var res = await fetch(API, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error(body.error || tr('common.saveFailed'));
      err.answer = body;
      throw err;
    }
    return body;
  }
  async function act(payload, message) {
    clearTimeout(state.timer);
    if (state.saving || state.timer) {
      try { state.base = (await send({ action: 'save', draft: state.doc, base: state.base })).draft; } catch (e) {}
    }
    try {
      apply(await send(payload));
      if (message) toast(message, 'ok');
      refreshFrame();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---- the whole page -------------------------------------------------- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) { if (window.StaffProblem) window.StaffProblem(tr('err.unreachable'), load); return; }
    if (body && body.you && window.StaffIdentity) window.StaffIdentity(body.you, body.partner);
    if (!res.ok) { if (window.StaffProblem) window.StaffProblem(body.error || tr('err.refused'), load); return; }
    if (window.StaffActing) window.StaffActing(body);
    apply(body);
  }

  function apply(body) {
    state.body = body;
    state.doc = body.draft;
    /* the draft as the server holds it, for a save to be compared against */
    state.base = JSON.parse(JSON.stringify(body.draft));
    if (state.page && !state.doc.pages.some(function (p) { return p.id === state.page; })) state.page = null;
    $('wsRoot').hidden = false;
    $('wsStatus').hidden = false;
    var h = document.querySelector('.page-head h1');
    if (h && !body.can.owner && body.owner) {
      h.removeAttribute('data-i18n-html');
      h.innerHTML = esc(fill('ws.theirs', { name: body.owner.name || body.partner.display_name })).replace(/\s(\S+)$/, ' <b>$1</b>');
    }
    document.body.classList.toggle('ws-readonly', !body.can.edit);
    if (!state.placed) { state.placed = true; restorePlace(); }
    /* What Undo steps back through starts again from what the server holds. */
    state.undo = []; state.redo = []; state.snap = JSON.stringify(state.doc); drawUndo();
    drawStatus(); drawAsk(); drawBar(); fillPair(); draw(); drawDots();
  }

  /* ---- undo -------------------------------------------------------------- */

  /* EVERY CHANGE SAVES AS IT IS MADE, so there is no Cancel; Undo is the way
     back (Chase, 2026-09-29: "Do you think an undo button would be good?").
     A burst of typing is one step: the copy before the burst goes on the
     stack when the burst starts. Ctrl/Cmd+Z does the same outside a text
     box (inside one, the box's own undo is the right one); Shift adds redo.
     Discard is still the way back to what visitors see. */
  function pushUndo() {
    if (!state.burst) { state.undo.push(state.snap); if (state.undo.length > 60) state.undo.shift(); state.redo = []; drawUndo(); }
    clearTimeout(state.burst);
    state.burst = setTimeout(function () { state.burst = null; state.snap = JSON.stringify(state.doc); }, 700);
  }
  function drawUndo() {
    var u = $('wsUndo');
    if (u) u.disabled = !(state.undo && state.undo.length);
  }
  function stepBack(from, to) {
    if (!from.length) return;
    clearTimeout(state.burst); state.burst = null;
    to.push(JSON.stringify(state.doc));
    state.snap = from.pop();
    state.doc = JSON.parse(state.snap);
    drawUndo(); fillPair(); draw(); drawDots();
    changed(true, true);
  }
  $('wsUndo').addEventListener('click', function () { stepBack(state.undo, state.redo); });
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== 'z' && e.key !== 'Z' && e.key !== 'y')) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!canEdit() || document.body.getAttribute('data-staff-page') !== 'website') return;
    e.preventDefault();
    if (e.key === 'y' || e.shiftKey) stepBack(state.redo, state.undo); else stepBack(state.undo, state.redo);
  });

  function drawStatus() {
    var s = state.body.site;
    var on = $('wsOn');
    on.setAttribute('aria-checked', s.enabled ? 'true' : 'false');
    on.querySelector('.switch-state').textContent = s.enabled ? 'On' : 'Off';
    on.disabled = !state.body.can.owner;
    on.hidden = !state.body.can.owner;
    $('wsState').textContent = s.enabled ? tr('ws.isLive') : s.archived ? tr('ws.isArchived') : tr('ws.isOff');
    var shown = s.address.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('wsAddress').textContent = shown + (s.enabled && s.dns && s.dns !== 'ready' ? ' · ' + tr('ws.dnsPending') : '');
    $('wsOpen').href = s.address;
    $('wsOpen').hidden = !s.enabled;
    $('wsPreview').href = s.preview;
    $('wsStatus').classList.toggle('is-on', !!s.enabled);
  }

  function drawAsk() {
    var b = state.body, box = $('wsAsk');
    box.hidden = b.can.edit;
    if (b.can.edit) return;
    var owner = (b.owner && b.owner.name) || b.partner.display_name;
    $('wsAskTitle').textContent = fill('ws.onlyOwner', { name: owner });
    if (b.my_request) {
      $('wsAskText').textContent = fill('ws.asked', { name: owner });
      $('wsAskBtn').hidden = true; $('wsAskNote').parentNode.hidden = true;
    } else {
      $('wsAskText').textContent = fill('ws.askText', { name: owner });
      $('wsAskBtn').hidden = false; $('wsAskNote').parentNode.hidden = false;
    }
  }
  $('wsAskBtn').addEventListener('click', function () {
    act({ action: 'request', note: $('wsAskNote').value.trim() }, tr('ws.askSent'));
  });

  /* ---- which parts have changes not yet published ------------------- */

  /* Each tab's part of the site, as text to compare. A tab shows its dot while
     its part of the working copy differs from what visitors see (Chase,
     2026-09-29) — on every tab, not only the one being edited. */
  function areas(doc) {
    var d = JSON.parse(JSON.stringify(doc.design)); var head = d.headerLinks; delete d.headerLinks;
    var nav = [d.nav, d.giveTo, head]; delete d.nav; delete d.giveTo;
    return {
      design: JSON.stringify(d),
      nav: JSON.stringify(nav),
      pages: JSON.stringify(doc.pages),
      links: JSON.stringify(doc.links),
      footer: JSON.stringify(doc.footer),
      settings: JSON.stringify([doc.languages, doc.fallback, doc.give]),
    };
  }
  function pageChanged(p) {
    var pub = state.body.published;
    if (!pub) return false;
    var was = pub.pages.filter(function (x) { return x.id === p.id; })[0];
    return JSON.stringify(p) !== JSON.stringify(was);
  }
  function drawDots() {
    var pub = state.body && state.body.published;
    var now = areas(state.doc), was = pub ? areas(pub) : null;
    [].forEach.call(document.querySelectorAll('[data-ws-tab]'), function (b) {
      var dot = b.querySelector('.ws-dot');
      if (!dot) return;
      var t = b.getAttribute('data-ws-tab');
      dot.hidden = !was || now[t] === was[t];
      dot.title = dot.hidden ? '' : tr('ws.changedHere');
    });
  }

  function drawBar() {
    var show = canEdit() && state.body.site.unpublished;
    $('wsBar').hidden = !show;
    document.body.classList.toggle('has-savebar', show);
    $('wsDiscard').hidden = !state.body.site.published_at;
    $('wsBarText').textContent = state.body.site.published_at ? tr('ws.unpublished') : tr('ws.neverPublished');
  }
  $('wsPublish').addEventListener('click', function () { act({ action: 'publish' }, tr('ws.published')); });
  $('wsDiscard').addEventListener('click', async function () {
    var ok = window.StaffConfirm ? await window.StaffConfirm({ title: tr('ws.discardTitle'), confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true }) : true;
    if (ok) act({ action: 'discard' }, tr('toast.discarded'));
  });
  $('wsOn').addEventListener('click', async function () {
    var turningOn = this.getAttribute('aria-checked') !== 'true';
    var ok = window.StaffConfirm ? await window.StaffConfirm({
      title: turningOn ? tr('ws.onTitle') : tr('ws.offTitle'),
      body: turningOn ? fill('ws.onBody', { address: state.body.site.address.replace(/^https?:\/\//, '').replace(/\/$/, '') }) : tr('ws.offBody'),
      confirm: turningOn ? tr('ws.turnOn') : tr('ws.turnOff'), cancel: tr('ms.cancel'), danger: !turningOn,
    }) : true;
    if (ok) {
      try { sessionStorage.removeItem('thauma.mysite'); } catch (e) {}
      act({ action: 'enable', on: turningOn }, turningOn ? tr('ws.nowLive') : tr('ws.nowOff'));
    }
  });

  /* ---- tabs ------------------------------------------------------------ */

  function showTab(name) {
    state.tab = name;
    [].forEach.call(document.querySelectorAll('[data-ws-tab]'), function (b) {
      if (b.getAttribute('data-ws-tab') === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    [].forEach.call(document.querySelectorAll('[data-ws-panel]'), function (p) { p.hidden = p.getAttribute('data-ws-panel') !== state.tab; });
  }
  /* A tab opens at its start — Pages at the list of pages, even when Pages is
     the tab already open (Chase, 2026-10-01: "If I press the Pages button,
     it should take me back to the Page selection screen"). Only a reload
     returns to where the owner was (restorePlace). */
  document.querySelector('.ws-side').addEventListener('click', function (e) {
    var t = e.target.closest('[data-ws-tab]');
    if (!t) return;
    showTab(t.getAttribute('data-ws-tab'));
    state.page = null; state.edit = null;
    fillPair(); draw(); keepPlace();
  });

  /* ---- where you were ---------------------------------------------------- */

  /* A RELOAD opens where the owner left off — the tab, the page, the open
     section and its tab (Chase, 2026-09-29: "let's also remember the page
     that was present too"). Only a reload (Chase, 2026-10-01: "basic
     navigation should take us to the home page of each tab"): arriving from
     elsewhere starts fresh. Kept for this browser tab only (sessionStorage):
     a convenience, not a record, so it is fine for it to be missing. */
  var PLACE = 'thauma.ws.place';
  function keepPlace() {
    try { sessionStorage.setItem(PLACE, JSON.stringify({ tab: state.tab, page: state.page, edit: state.edit, sectab: state.sectab })); } catch (e) {}
  }
  function reloaded() {
    try {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      return !!nav && nav.type === 'reload';
    } catch (e) { return false; }
  }
  function restorePlace() {
    var p = null;
    if (!reloaded()) return;
    try { p = JSON.parse(sessionStorage.getItem(PLACE) || 'null'); } catch (e) {}
    if (!p || !document.querySelector('[data-ws-tab="' + p.tab + '"]')) return;
    showTab(p.tab);
    var page = p.page && state.doc.pages.filter(function (x) { return x.id === p.page; })[0];
    state.page = page ? page.id : null;
    state.edit = page && typeof p.edit === 'number' && page.sections[p.edit] ? p.edit : null;
    if (p.sectab) state.sectab = p.sectab;
  }

  /* The site's own accent (Custom's, else the ministry's), so "Brand color"
     shows in the boxes and the bar as the site will draw it. */
  function siteAccent() {
    var d = state.doc && state.doc.design, th = state.body && state.body.theme;
    return (d && d.colors && d.colors.accent) || (th && th.accent) || '#1AE4FF';
  }
  /* The site's second color, as render.js derives it: Custom's accent turned
     33 degrees back, else the ministry's own second color. */
  function siteAccent2() {
    var d = state.doc && state.doc.design, th = state.body && state.body.theme;
    if (d && d.colors && d.colors.accent) return turnHue(d.colors.accent, -33);
    return (th && th.accent2) || turnHue(siteAccent(), -33);
  }
  function turnHue(hex, deg) {
    var n = parseInt(String(hex).slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d0 = mx - mn, h = 0, s = 0;
    if (d0) { s = d0 / (1 - Math.abs(2 * l - 1)); h = mx === r ? ((g - b) / d0) % 6 : mx === g ? (b - r) / d0 + 2 : (r - g) / d0 + 4; h *= 60; }
    h = ((h + deg) % 360 + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + rgb.map(function (v) { return ('0' + Math.round((v + m) * 255).toString(16)).slice(-2); }).join('');
  }
  function draw() {
    document.documentElement.style.setProperty('--ws-acc', siteAccent());
    document.documentElement.style.setProperty('--ws-acc2', siteAccent2());
    keepPlace();
    if (state.tab === 'pages') drawPages();
    if (state.tab === 'design') drawDesign();
    if (state.tab === 'links') drawLinks();
    if (state.tab === 'footer') drawFooter();
    if (state.tab === 'nav') drawNav();
    if (state.tab === 'settings') drawSettings();
    /* The site beside whatever is being changed: the page being arranged, or
       Home for the look, the links and the footer. */
    var showFrame = state.tab === 'pages' || state.tab === 'design' || state.tab === 'links' || state.tab === 'footer' || state.tab === 'nav';
    $('wsPreviewPane').hidden = !showFrame;
    $('wsRoot').classList.toggle('with-preview', showFrame);
    if (showFrame) refreshFrame();
    if (!canEdit()) {
      [].forEach.call($('wsRoot').querySelectorAll('.ws-panel input, .ws-panel textarea, .ws-panel select, .ws-panel button:not([data-open-page]):not([data-all-pages]):not([data-pick-page]):not([data-edit-sec]):not([data-panel-back]):not([data-sectab]):not([data-item-open])'), function (el) { el.disabled = true; });
    }
  }

  /* The preview is a 1280px desktop shrunk to the pane's width (see the
     .ws-preview-frame rule in staff.css). */
  function fitFrame() {
    var box = $('wsFrame').parentNode, w = box.clientWidth;
    if (w) box.style.setProperty('--ws-scale', (w / 1280).toFixed(4));
  }
  if (window.ResizeObserver) new ResizeObserver(fitFrame).observe($('wsFrame').parentNode);

  function refreshFrame() {
    if ($('wsPreviewPane').hidden) return;
    fitFrame();
    var s = state.body.site, lang = state.langA;
    var page = state.tab === 'pages' && state.page ? currentPage().id : 'home';
    var path = s.preview.replace(/\?draft$/, '') + lang + '/' + (page === 'home' ? '' : page + '/');
    $('wsPreviewPath').textContent = '/' + lang + '/' + (page === 'home' ? '' : page + '/');
    /* On the Footer tab, the footer and nothing else (Chase, 2026-09-29). */
    /* On Footer and Links, the footer and nothing else — links show there. */
    var foot = state.tab === 'footer' || state.tab === 'links';
    $('wsPreviewPane').classList.toggle('only-foot', foot);
    /* To the section being edited — scrolled INSIDE the preview once it has
       loaded. A #fragment on the frame's address would do it too, but a
       browser then scrolls this page as well, to bring the frame's target
       into view: the jump Chase saw when opening a section. */
    var open = state.tab === 'pages' && state.page && state.edit != null && currentPage().sections[state.edit];
    state.frameTarget = open ? 's-' + open.id : null;
    $('wsFrame').src = path + '?draft' + (foot ? '&part=footer' : '') + '&t=' + Date.now();
  }

  $('wsFrame').addEventListener('load', function () {
    /* THE EDITOR FOLLOWS THE PREVIEW (Chase, 2026-10-04): a page opened by
       clicking inside the preview becomes the page being edited, so the two
       never show different pages. Same origin, so its address is readable. */
    try {
      var m = this.contentWindow.location.pathname.match(/\/site\/[^/]+\/([a-z-]+)\/(?:([a-z0-9-]+)\/)?$/);
      var seen = m && (m[2] || 'home');
      var cur = state.page ? currentPage().id : 'home';
      if (seen && seen !== cur && state.doc.pages.some(function (x) { return x.id === seen; })) {
        state.page = seen; state.edit = null;
        if (state.tab === 'pages') drawPages();
        $('wsPreviewPath').textContent = '/' + m[1] + '/' + (seen === 'home' ? '' : seen + '/');
      }
    } catch (e) { /* another origin: nothing to follow */ }
    /* THE FOOTER PREVIEW IS AS TALL AS THE FOOTER (Chase, 2026-10-01: the
       small print "doesn't show up on the preview for Split view"). It was a
       fixed 170px of a scaled frame, which cut off whatever wrapped below
       the columns. Measured from the footer itself, at the frame's scale. */
    var box = this.parentNode;
    if ($('wsPreviewPane').classList.contains('only-foot')) {
      try {
        var f = this.contentWindow.document.querySelector('footer');
        var scale = this.getBoundingClientRect().width / this.offsetWidth || 1;
        if (f) box.style.height = Math.ceil((f.getBoundingClientRect().height + 8) * scale) + 'px';
      } catch (e) { box.style.height = ''; }
    } else {
      box.style.height = '';
    }
    if (!state.frameTarget) return;
    try {
      var w = this.contentWindow, el = w.document.getElementById(state.frameTarget);
      /* In the middle of the preview, so the outline is easy to see; a
         section taller than the preview starts at its top instead. */
      if (el) {
        el.classList.add('is-editing');
        /* Room below, in the editor's copy only, so a section near the end
           of the page can still come to the middle. */
        var pad = w.document.createElement('div');
        pad.style.height = Math.round(w.innerHeight / 2) + 'px';
        w.document.body.appendChild(pad);
        w.scrollTo(0, Math.max(0, el.offsetTop - Math.max(24, (w.innerHeight - el.offsetHeight) / 2)));
      }
    } catch (e) {}
  });

  /* ---- small pieces ---------------------------------------------------- */

  function chips(name, options, current, labelOf) {
    return '<div class="ws-chips" role="group">' + options.map(function (o) {
      return '<button type="button" class="ws-chip" data-chip="' + esc(name) + '" data-value="' + esc(o) + '" aria-pressed="' + (o === current) + '">' +
        esc(labelOf(o)) + '</button>';
    }).join('') + '</div>';
  }
  function sw(attr, on, label) {
    return '<button type="button" class="switch small" role="switch" ' + attr + ' aria-checked="' + (on ? 'true' : 'false') + '"' +
      (label ? ' aria-label="' + esc(label) + '"' : '') + '><span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
      '</span><span class="switch-knob"></span></span>' + (label ? '<span class="switch-label">' + esc(label) + '</span>' : '') + '</button>';
  }
  function row(label, control) {
    return '<div class="ws-row"><span class="ws-lbl">' + esc(label) + '</span><div class="ws-ctl">' + control + '</div></div>';
  }
  function ref(words) {
    var b = state.langB, v = b && words && words[b];
    return v ? '<small class="ms-ref" lang="' + esc(b) + '">' + esc(v) + '</small>' : '';
  }
  /* A page's name IN THE LANGUAGE ASKED: the owner's own, else the name the
     site gives it in that language (page_names, from the server) — never the
     console's word, which ignored Editing ⇄ Reference (Chase, 2026-10-03). */
  function builtInName(id, lang) {
    var n = state.body.page_names && state.body.page_names[lang];
    return (n && n[id]) || tr('ws.page.' + id);
  }
  function pageLabel(p, lang) {
    return (p.label && p.label[lang]) || builtInName(p.id, lang);
  }
  /* The Reference line under a page's name: what that language's visitors
     read in the menu, renamed or not. */
  function refPage(p) {
    var b = state.langB;
    return b ? '<small class="ms-ref" lang="' + esc(b) + '">' + esc(pageLabel(p, b)) + '</small>' : '';
  }
  /* WHERE SOMETHING SENDS A VISITOR: first what kind — nothing, one of the
     site's pages, or a web address — as three plain choices; then only the
     one thing that kind needs. (Chase, 2026-09-29, of the dropdown's
     "Another address…": "I don't know what that is there for.") A page that
     is switched off is still offered, marked; the link shows once it is on. */
  /* The other sections of the page being edited, for a button that jumps
     within it ("section:<id>"). Only a section's own links can: a footer or
     custom link is on every page, so "this page" means nothing there. */
  function jumpTargets(key) {
    if (!/^(sec|item):/.test(key)) return [];
    var self = currentPage().sections[+key.split(':')[1]];
    return currentPage().sections.filter(function (x) { return x !== self; });
  }
  function sectionName(x) {
    var w = (x.words && (x.words[state.langA] || x.words[state.doc.fallback])) || {};
    var words = String(w.heading || w.quote || w.caption || '').replace(/<[^>]*>/g, '').trim();
    return tr('ws.sec.' + x.type) + (words ? ' · ' + words : '');
  }
  function linkPicker(key, value, allowNone) {
    var v = value || '';
    var kind = !v ? 'none' : v.indexOf('page:') === 0 ? 'page' : v.indexOf('section:') === 0 ? 'section' : 'url';
    var targets = jumpTargets(key);
    var kinds = (allowNone ? ['none'] : []).concat(['page'], targets.length || kind === 'section' ? ['section'] : [], ['url']);
    var html = chips('linkkind:' + key, kinds, kind, function (k) { return tr('ws.link.kind.' + k); });
    if (kind === 'section') {
      html += '<select data-link="' + esc(key) + '">' + targets.map(function (x) {
        return '<option value="section:' + esc(x.id) + '"' + (v === 'section:' + x.id ? ' selected' : '') + '>' + esc(sectionName(x)) + '</option>';
      }).join('') + '</select>';
    }
    if (kind === 'page') {
      html += '<select data-link="' + esc(key) + '">' + state.doc.pages.map(function (p) {
        var name = pageLabel(p, state.langA);
        return '<option value="page:' + esc(p.id) + '"' + (v === 'page:' + p.id ? ' selected' : '') + '>' +
          esc(p.on ? name : fill('ws.link.hidden', { page: name })) + '</option>';
      }).join('') + '</select>';
    }
    if (kind === 'url') {
      html += '<input type="url" data-link-url="' + esc(key) + '" value="' + esc(v === 'https://' ? '' : v) + '" placeholder="https://…">';
    }
    return '<span class="ws-link">' + html + '</span>';
  }

  /* ---- Pages ----------------------------------------------------------- */

  /* PAGES, REWORKED (Chase, 2026-09-29: "overly complicated … really
     crowded and has lots of text boxes, which will overwhelm the user";
     canvas board "Round two · Pages"). The site's pages as tabs; the page
     chosen, as a short stack of pictures, one line of words each — no box
     to type in until a section is opened. Opening one shows that section
     alone, in the same place, its settings sorted into a few tabs, while
     the site beside it keeps showing the result. */

  function currentPage() {
    var id = state.page || 'home';
    var p = state.doc.pages.filter(function (x) { return x.id === id; })[0];
    if (!p) { state.page = null; state.edit = null; p = state.doc.pages[0]; }
    return p;
  }
  function plain(html) {
    var d = document.createElement('div'); d.innerHTML = String(html || '').replace(/\n/g, ' ');
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function summary(s) {
    var w = (s.words || {})[state.langA] || {};
    var bits = [plain(w.heading), plain(w.text || w.quote || w.caption)].filter(Boolean);
    if (s.type === 'links') bits.push(fill('ws.linksN', { n: (s.items || []).filter(function (it) { return it.url && it.url !== 'https://'; }).length }));
    return bits.join(' · ') || tr('ws.sec.' + s.type + '.what');
  }
  function sectionChanged(s) {
    var pub = state.body.published, p = currentPage();
    if (!pub) return false;
    var was = (pub.pages.filter(function (x) { return x.id === p.id; })[0] || { sections: [] }).sections.filter(function (x) { return x.id === s.id; })[0];
    return JSON.stringify(s) !== JSON.stringify(was);
  }
  function dot(on) { return on ? '<i class="ws-dot" title="' + esc(tr('ws.changedHere')) + '"></i>' : ''; }

  /* ALL PAGES, then ONE PAGE (Chase, 2026-09-29, after the page tabs: "didn't
     work as well as I hoped … keep the original idea, but with the
     condensed sections that open when you click on them … a better way to
     go back to the page selection"). The list of pages first; a page opens
     to its sections as short rows, and a row unfolds where it is — the rest
     of the screen stays still. "← All pages" and a menu of the pages sit at
     the top of every page. */
  function drawPages() {
    keepPlace();
    if (!state.page) return drawOverview();
    var p = currentPage();
    if (state.edit != null && !p.sections[state.edit]) state.edit = null;

    /* THE ROW BEING WORKED ON STAYS WHERE IT IS ON SCREEN through the redraw:
       what jumped before was the window scrolling to the top. */
    var anchorAt = state.anchor != null ? state.anchor : state.edit;
    var was = anchorAt != null && $('wsPages').querySelector('.ws-acc[data-si="' + anchorAt + '"]');
    var before = was ? was.getBoundingClientRect().top : null;

    var pi = state.doc.pages.indexOf(p);
    var html = '<div class="ws-crumb">' +
      '<button type="button" class="ghost-btn sm" data-all-pages>← ' + esc(tr('ws.allPages')) + '</button>' +
      '<label class="ws-pagepick"><span class="sr-only">' + esc(tr('ws.tab.pages')) + '</span>' +
        '<select data-pick-page>' + state.doc.pages.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (x.id === p.id ? ' selected' : '') + '>' +
            esc(pageLabel(x, state.langA)) + (x.on ? '' : ' · ' + esc(tr('ws.off'))) + '</option>';
        }).join('') + '</select></label>' +
      (p.id === 'home' ? '<span class="ws-always">' + esc(tr('ws.always')) + '</span>' : sw('data-page-on="' + pi + '"', p.on, tr('ws.shown'))) +
      '</div>' +
      '<label class="ws-pagename"><span>' + esc(tr('ws.nameInMenu')) + '</span>' + refPage(p) +
        '<input type="text" maxlength="40" data-page-label="' + pi + '" value="' + esc((p.label || {})[state.langA] || '') + '" placeholder="' + esc(builtInName(p.id, state.langA)) + '" lang="' + esc(state.langA) + '"></label>';

    var n = p.sections.length;
    /* Room below an open section, so even the last one can rise to the top. */
    /* A place above the first section too: a Header belongs at the top. */
    html += '<div class="ws-stack' + (state.edit != null ? ' has-open' : '') + '">' + (n ? '<button type="button" class="ws-insert" data-insert-at="0">+ ' + esc(tr('ws.addHere')) + '</button>' : '<p class="empty">' + esc(tr('ws.noSections')) + '</p>') +
      p.sections.map(function (x, i) {
        var open = state.edit === i;
        return '<article class="ws-acc' + (open ? ' is-open' + (state.animate === i ? ' is-entering' : '') : '') + '" data-si="' + i + '">' +
          '<div class="ws-acc-head">' +
            '<button type="button" class="ws-stile" data-edit-sec="' + i + '" aria-expanded="' + open + '">' +
              '<span class="ws-sketch ws-sketch-sm" aria-hidden="true">' + sketch(x.type) + '</span>' +
              '<span class="ws-stile-words"><b>' + esc(tr('ws.sec.' + x.type)) + dot(sectionChanged(x)) + '</b><span>' + esc(summary(x)) + '</span></span>' +
              '<span class="ws-chev" aria-hidden="true"></span></button>' +
            '<span class="ws-stile-tools">' +
              '<button type="button" class="ws-icon" data-sec-up="' + i + '" aria-label="' + esc(tr('ws.up')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
              '<button type="button" class="ws-icon" data-sec-down="' + i + '" aria-label="' + esc(tr('ws.down')) + '"' + (i === n - 1 ? ' disabled' : '') + '>↓</button>' +
              '<button type="button" class="ws-icon del" data-sec-remove="' + i + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button>' +
            '</span></div>' +
          '<div class="ws-acc-body"><div class="ws-acc-inner">' + (open ? panelHtml(p, i) : '') + '</div></div>' +
        '</article>' +
        '<button type="button" class="ws-insert" data-insert-at="' + (i + 1) + '">+ ' + esc(tr('ws.addHere')) + '</button>';
      }).join('') +
      (n ? '' : '<button type="button" class="ws-addbtn" data-insert-at="0">+ ' + esc(tr('ws.addSection')) + '</button>') + '</div>';
    $('wsPages').innerHTML = html;
    if (!canEdit()) [].forEach.call($('wsPages').querySelectorAll('[contenteditable]'), function (el) { el.setAttribute('contenteditable', 'false'); });

    var now = anchorAt != null && $('wsPages').querySelector('.ws-acc[data-si="' + anchorAt + '"]');
    if (before != null && now) window.scrollBy(0, now.getBoundingClientRect().top - before);
    /* The unfolding: drawn closed, then opened on the next frame, so the
       height eases open (none of it for reduced motion — see staff.css). */
    var entering = $('wsPages').querySelector('.ws-acc.is-entering');
    if (entering) {
      requestAnimationFrame(function () { requestAnimationFrame(function () { entering.classList.remove('is-entering'); }); });
      /* …then glides up to where it is worked on: its top just under the
         console's header (Chase, 2026-09-29: "can it reposition itself on
         the page to be worked on"). The row does not jump — it is carried
         there, and not at all for reduced motion, which is a plain move. */
      var bar = document.getElementById('console');
      var head = bar ? bar.offsetHeight : 64;
      var y = window.scrollY + entering.getBoundingClientRect().top - head - 16;
      window.scrollTo({ top: Math.max(0, y), behavior: still() ? 'auto' : 'smooth' });
    }
    state.anchor = null; state.animate = null;
  }
  var drawSections = function () { drawPages(); };

  function drawOverview() {
    var pages = state.doc.pages, last = pages.length - 1;
    $('wsPages').innerHTML = '<div class="ws-head"><h2>' + esc(tr('ws.yourPages')) + '</h2></div>' +
      '<ol class="ws-plist">' + pages.map(function (x, i) {
        var n = x.sections.length;
        return '<li class="ws-prow' + (x.on ? '' : ' is-off') + '">' +
          '<button type="button" class="ws-prow-open" data-open-page="' + esc(x.id) + '">' +
            '<b>' + esc(pageLabel(x, state.langA)) + dot(pageChanged(x)) + '</b>' +
            '<span>' + esc(n === 1 ? tr('ws.nSections1') : n ? fill('ws.nSections', { n: n }) : tr('ws.noSectionsShort')) + '</span>' +
            '<span class="ws-chev ws-chev-r" aria-hidden="true"></span></button>' +
          (x.id === 'home' ? '<span class="ws-always">' + esc(tr('ws.always')) + '</span>' : sw('data-page-on="' + i + '"', x.on, tr('ws.shown'))) +
          '<span class="ws-move">' +
            '<button type="button" class="ws-icon" data-page-up="' + i + '" aria-label="' + esc(tr('ws.earlier')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="ws-icon" data-page-down="' + i + '" aria-label="' + esc(tr('ws.later')) + '"' + (i === last ? ' disabled' : '') + '>↓</button>' +
          '</span></li>';
      }).join('') + '</ol>';
  }

  /* One section, alone. Only the tabs it has something for. */
  /* What a section looks like before anybody lines it up: the same rule as
     the server's (site/model.js defaultAlign), so nothing moves. */
  function defaultAlign(s) {
    if (SECTIONS[s.type].align) return 'center';
    if ((s.type === 'text' && s.variant === 'center') || (s.type === 'signup' && s.variant === 'card') ||
        (s.type === 'hero' && s.variant === 'words')) return 'center';
    return 'left';
  }
  function tabsFor(s) {
    var spec = SECTIONS[s.type], t = ['words'];
    if (spec.photo) t.push('photo');
    if (spec.buttons || spec.link === 'button' || spec.link === 'both' || s.type === 'give') t.push('buttons');
    if (spec.items) t.push(spec.items === 'cards' ? 'cards' : 'links');
    /* Every section lines up (2026-10-03), so every section has a Look. */
    t.push('look');
    return t;
  }

  function panelHtml(p, i) {
    var s = p.sections[i], spec = SECTIONS[s.type], tabs = tabsFor(s);
    if (tabs.indexOf(state.sectab) === -1) state.sectab = 'words';
    var w = (s.words || {})[state.langA] || {};
    var src = function (f) { var o = {}; Object.keys(s.words || {}).forEach(function (l) { o[l] = (s.words[l] || {})[f]; }); return o; };
    var html = '<div class="ws-sectabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" data-sectab="' + t + '" aria-selected="' + (t === state.sectab) + '">' + esc(tr('ws.tabw.' + t)) + '</button>';
      }).join('') + '</div><div class="ws-panelbody">';

    if (state.sectab === 'words') {
      spec.words.filter(function (f) { return f !== 'button'; }).forEach(function (f) {
        /* The small line above the heading waits behind a button until wanted. */
        if (f === 'kicker' && !w.kicker && !state.showKicker) {
          html += '<button type="button" class="link-btn ws-more" data-show-kicker>+ ' + esc(tr('ws.kickerAdd')) + '</button>';
          return;
        }
        html += field(i, f, w[f], src(f), s.type);
      });
      if (spec.data) html += '<p class="ws-data">' + esc(tr('ws.data.' + s.type)) + ' <a href="/staff/' + spec.data + '">' + esc(tr('ws.editThere')) + ' →</a></p>';
    }

    if (state.sectab === 'photo') {
      /* A full-width photo is cropped to a band: press the spot that must
         stay in view (Chase, BACKLOG §3: "height cropping and positioning"). */
      var aim = s.type === 'photo' && s.photo && (s.height || 'medium') !== 'whole';
      var fy = typeof s.focusY === 'number' ? s.focusY : 50;
      html += '<div class="ws-bigphoto' + (aim ? ' ws-aim' : '') + '"' + (aim ? ' data-sec-focus="' + i + '" title="' + esc(tr('ws.photoFocus')) + '"' : '') + '>' +
        (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' + (aim ? '<i class="ws-aimline" style="top:' + fy + '%"></i>' : '') : '<span class="ws-nophoto">' + esc(tr('ws.noPhoto')) + '</span>') + '</div>' +
        (s.type === 'photo' ? '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.photoHeight')) + '</span>' +
          chips('pheight:' + i, ['short', 'medium', 'tall', 'whole'], s.height || 'medium', function (v) { return tr('ws.photoHeight.' + v); }) + '</div>' : '') +
        '<div class="ws-sec-row"><label class="ghost-btn sm ws-file">' + esc(s.photo ? tr('ws.changePhoto') : tr('ws.choosePhoto')) +
          '<input type="file" accept="image/*" data-sec-photo="' + i + '" hidden></label>' +
          (s.photo ? '<button type="button" class="link-btn" data-sec-unphoto="' + i + '">' + esc(tr('ws.removePhoto')) + '</button>' : '') +
          '<span class="hint"></span></div>';
      if (spec.link === 'photo') html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.link.photo')) + '</span>' + linkPicker('sec:' + i, s.link, true) + '</div>';
      if (spec.link === 'both' && s.link && s.photo) {
        html += '<label class="chk"><input type="checkbox" data-sec-photolink="' + i + '"' + (s.photoLink ? ' checked' : '') + '><span>' + esc(tr('ws.link.photoToo')) + '</span></label>';
      }
    }

    if (state.sectab === 'buttons') {
      if (spec.buttons) {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.buttons')) + '</span><div class="ws-checks">' + ['give', 'stay', 'contact'].map(function (b) {
          var on = (s.buttons || []).indexOf(b) !== -1;
          return '<label class="chk"><input type="checkbox" data-sec-btn="' + i + ':' + b + '"' + (on ? ' checked' : '') + '><span>' + esc(tr('ws.btn.' + b)) + '</span></label>';
        }).join('') + '</div></div>';
      }
      if (spec.link === 'button' || spec.link === 'both') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr(spec.buttons ? 'ws.link.another' : 'ws.link.button')) + '</span>' + linkPicker('sec:' + i, s.link, true) + '</div>';
      }
      if (s.type === 'give' || s.link) html += field(i, 'button', w.button, src('button'), s.type);
      if (s.type === 'give') html += '<p class="ws-data">' + esc(tr('ws.data.give')) + '</p>';
    }

    if (state.sectab === 'cards') {
      html += '<div class="ws-linkrows">' + (s.items || []).map(function (it, j) {
        var t = (it.words || {})[state.langA] || {}, k = i + ':' + j, open = state.openItem === j;
        var head = '<div class="ws-linkrow' + (open ? ' is-open' : '') + '">' +
          (s.numbers !== false ? '<span class="ws-cnum">' + (j + 1) + '</span>' : '') +
          '<b>' + esc(t.title || tr('ws.itemUntitled')) + '</b><span>' + esc(t.text || '') + '</span>' +
          '<button type="button" class="link-btn" data-item-open="' + j + '">' + esc(open ? tr('ws.close') : tr('ws.edit')) + '</button>' +
          '<button type="button" class="ws-icon del" data-item-remove="' + k + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
        if (!open) return head;
        return head + '<div class="ws-linkedit">' +
          '<label class="fld"><span>' + esc(tr('ws.itemTitle')) + '</span><input type="text" data-item="' + k + ':title" value="' + esc(t.title || '') + '" placeholder="' + esc(ph('card', 'title')) + '" lang="' + esc(state.langA) + '"></label>' +
          '<label class="fld"><span>' + esc(tr('ws.itemText')) + '</span><textarea rows="3" data-item="' + k + ':text" placeholder="' + esc(ph('card', 'text')) + '" lang="' + esc(state.langA) + '">' + esc(t.text || '') + '</textarea></label></div>';
      }).join('') + '</div><button type="button" class="ghost-btn" data-item-add="' + i + '">+ ' + esc(tr('ws.addCard')) + '</button>';
    }

    if (state.sectab === 'links') {
      html += '<div class="ws-linkrows">' + (s.items || []).map(function (it, j) {
        var t = (it.words || {})[state.langA] || {}, k = i + ':' + j, open = state.openItem === j;
        var jump = it.url && it.url.indexOf('section:') === 0 &&
          currentPage().sections.filter(function (x) { return 'section:' + x.id === it.url; })[0];
        var where = !it.url || it.url === 'https://' ? tr('ws.link.nowhere') : jump ? sectionName(jump) : it.url.indexOf('page:') === 0
          ? pageLabel(state.doc.pages.filter(function (x) { return 'page:' + x.id === it.url; })[0] || { id: it.url.slice(5) }, state.langA) : it.url.replace(/^https?:\/\//, '');
        var head = '<div class="ws-linkrow' + (open ? ' is-open' : '') + '">' +
          (it.photo ? '<img src="' + esc(it.photo) + '" alt="">' : '') +
          '<b>' + esc(t.title || tr('ws.itemUntitled')) + '</b><span>→ ' + esc(where) + '</span>' +
          '<button type="button" class="link-btn" data-item-open="' + j + '">' + esc(open ? tr('ws.close') : tr('ws.edit')) + '</button>' +
          '<button type="button" class="ws-icon del" data-item-remove="' + k + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
        if (!open) return head;
        return head + '<div class="ws-linkedit">' +
          '<label class="fld"><span>' + esc(tr('ws.itemTitle')) + '</span><input type="text" data-item="' + k + ':title" value="' + esc(t.title || '') + '" placeholder="' + esc(ph('item', 'title')) + '" lang="' + esc(state.langA) + '"></label>' +
          '<label class="fld"><span>' + esc(tr('ws.itemText')) + '</span><input type="text" data-item="' + k + ':text" value="' + esc(t.text || '') + '" placeholder="' + esc(ph('item', 'text')) + '" lang="' + esc(state.langA) + '"></label>' +
          '<label class="fld"><span>' + esc(tr('ws.itemType')) + '</span><input type="text" maxlength="40" data-item="' + k + ':type" value="' + esc(t.type || '') + '" lang="' + esc(state.langA) + '"></label>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.tier')) + '</span>' +
            chips('tier:' + k, ['big', 'std', 'small'], it.tier || 'std', function (v) { return tr('ws.tier.' + v); }) + '</div>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.link.goesTo')) + '</span>' + linkPicker('item:' + k, it.url || 'https://', false) + '</div>' +
          '<div class="ws-sec-row">' + (it.photo ? '<img class="ws-thumb" src="' + esc(it.photo) + '" alt="">' : '') +
            '<label class="ghost-btn sm ws-file">' + esc(it.photo ? tr('ws.changePhoto') : tr('ws.choosePhoto')) + '<input type="file" accept="image/*" data-item-photo="' + k + '" hidden></label>' +
            (it.photo ? '<button type="button" class="link-btn" data-item-unphoto="' + k + '">' + esc(tr('ws.removePhoto')) + '</button>' : '') +
            '<span class="hint"></span></div></div>';
      }).join('') + '</div><button type="button" class="ghost-btn" data-item-add="' + i + '">+ ' + esc(tr('ws.addLink')) + '</button>';
    }

    if (state.sectab === 'look') {
      /* A Words section's old Left / Centered layout IS its alignment now. */
      if (spec.variants.length > 1 && s.type !== 'text') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.layout')) + '</span>' +
          chips('variant:' + i, spec.variants, s.variant, function (v) { return tr('ws.v.' + s.type + '.' + v); }) + '</div>';
      }
      html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.align')) + '</span>' +
        chips('align:' + i, ['left', 'center', 'right', 'indent'], s.align || defaultAlign(s), function (v) { return tr('ws.align.' + v); }) + '</div>';
      /* The opening's scroll indicator, for this page. Stored on the page;
         offered here, where it shows. Not offered while the site's Scroll
         hint is None: there would be nothing to show. */
      if (s.type === 'hero' && (state.doc.design.motion || {}).cue !== 'none') {
        html += '<div class="ws-field">' + sw('data-page-cue="' + state.doc.pages.indexOf(p) + '"', p.cue !== false, tr('ws.cueOnPage')) + '</div>';
      }
      /* The hero's line under the title (render.js). Unset, the monogram
         shows it and the rest do not — exactly as before the option. */
      if (s.type === 'hero') {
        var lined = s.variant === 'monogram' ? s.divider !== false : s.divider === true;
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.divider')) + '</span>' +
          chips('divider:' + i, ['on', 'off'], lined ? 'on' : 'off', function (v) { return tr('ws.divider.' + v); }) + '</div>';
      }
      /* The header's own looks (render.js .phead). */
      if (s.type === 'header') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.bg')) + '</span>' +
          chips('hbg:' + i, ['plain', 'raised', 'tint', 'accent'], s.bg || 'plain', function (v) { return tr('ws.bg.' + v); }) + '</div>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.topline')) + '</span>' +
          chips('topline:' + i, ['on', 'off'], s.topline === false ? 'off' : 'on', function (v) { return tr('ws.divider.' + v); }) + '</div>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.divider')) + '</span>' +
          chips('divider:' + i, ['on', 'off'], s.divider === false ? 'off' : 'on', function (v) { return tr('ws.divider.' + v); }) + '</div>';
      }
      /* Custom Cards: numbered or not. */
      if (s.type === 'videos') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.vTitle')) + '</span>' +
          chips('vtitle:' + i, ['words', 'latest'], s.titleFrom || 'words', function (v) { return tr('ws.vTitle.' + v); }) + '</div>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.vLinks')) + '</span>' +
          chips('vlinks:' + i, ['buttons', 'outline', 'subtle'], s.linkStyle || 'buttons', function (v) { return tr('ws.vLinks.' + v); }) + '</div>';
      }
      if (s.type === 'cards') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.numbers')) + '</span>' +
          chips('numbers:' + i, ['on', 'off'], s.numbers === false ? 'off' : 'on', function (v) { return tr('ws.divider.' + v); }) + '</div>';
      }
      /* A verse's look, where a section can carry one. */
      if (s.type === 'text' || s.type === 'photoText') {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.verseStyle')) + '</span>' +
          chips('verse:' + i, ['quote', 'line', 'mark'], s.verseStyle || 'quote', function (v) { return tr('ws.verseStyle.' + v); }) + '</div>';
      }
      if (!FLAT[s.type]) {
        html += '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.bg')) + '</span>' +
          chips('raised:' + i, ['plain', 'raised'], s.raised ? 'raised' : 'plain', function (v) { return tr('ws.bg.' + v); }) + '</div>';
      }
    }

    html += '</div><div class="ws-panelfoot">' +
      '<button type="button" class="solid-btn" data-panel-back>' + esc(tr('ws.done')) + '</button></div>';
    return html;
  }

  /* One field. Headings, words and quotes are formatted boxes (bold, italic,
     underline, links); the rest are plain. */
  var RICH = { heading: 1, text: 1, quote: 1, verse: 1 };
  /* What an empty field suggests, in the language being written (the site's
     words, from the server; model.js placeholders). Never saved. */
  function ph(type, f) {
    var all = state.body.placeholders || {}, l = all[state.langA] || all.en || {};
    return (l[type] && l[type][f]) || '';
  }
  function field(i, f, value, refWords, type) {
    var label = '<span>' + esc(fieldName(type, f)) + '</span>';
    var hint = ph(type, f) || (f === 'button' ? tr('ws.readMore') : '');
    if (RICH[f]) {
      var b = state.langB, r = b && refWords && refWords[b];
      return '<div class="fld ws-rfld">' + label +
        (r ? '<small class="ms-ref" lang="' + esc(b) + '">' + inlineHtml(r) + '</small>' : '') +
        '<div class="rt rt-' + f + '" contenteditable="true" role="textbox" aria-multiline="' + (f !== 'heading') + '" data-rt="' + i + ':' + f + '"' +
        (hint ? ' data-ph="' + esc(hint) + '" aria-placeholder="' + esc(hint) + '"' : '') + ' lang="' + esc(state.langA) + '">' +
        inlineHtml(value, true) + '</div></div>';
    }
    return '<label class="fld">' + label + ref(refWords) +
      '<input type="text" data-sec-word="' + i + ':' + f + '" value="' + esc(value || '') + '"' +
      (hint ? ' placeholder="' + esc(hint) + '"' : '') + ' lang="' + esc(state.langA) + '"></label>';
  }
  /* Stored formatted words back into a box: only the marks it may hold, links
     kept only inside the box being edited. */
  function inlineHtml(v, withLinks) {
    var out = String(v || '').replace(/<(?!\/?(b|i|u)>)(?!a href="[^"]*">)(?!\/a>)(?!span( data-(sz|c)="[^"]*")+>)(?!\/span>)[^>]*>/g, '');
    if (!withLinks) out = out.replace(/<\/?a[^>]*>/g, '');
    /* A picked color has no class to wear; it is painted where it is shown.
       richFrom reads data-c, never the paint. */
    out = out.replace(/<span([^>]*) data-c="(#[0-9a-f]{6})"([^>]*)>/gi, '<span$1 data-c="$2"$3 style="color:$2">');
    return out.replace(/\n/g, '<br>');
  }
  /* A box's contents as they are stored: what a browser's editable box makes
     — <div> per line, <strong>, pasted styles — reduced to <b>, <i>, <u>,
     <a href> and line breaks. The server cleans it again (model.richClean);
     this keeps the working copy tidy and the change dots honest. */
  function richFrom(el) {
    var out = '';
    var TAGS = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', a: 'a' };
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += esc(c.nodeValue.replace(/ /g, ' ')); continue; }
        if (c.nodeType !== 1) continue;
        var t = c.nodeName.toLowerCase();
        if (t === 'br') { out += '\n'; continue; }
        if (/^(div|p|li|h[1-6]|blockquote)$/.test(t) && out && !/\n$/.test(out)) out += '\n';
        var tag = TAGS[t];
        if (tag === 'a') {
          var h = c.getAttribute('href') || '';
          if (/^(https?:\/\/|mailto:|page:[a-z]+$)/i.test(h)) out += '<a href="' + esc(h) + '">'; else tag = null;
        } else if (t === 'span') {
          var sz = c.getAttribute('data-sz'), cc = c.getAttribute('data-c'), at = '';
          if (SIZES.indexOf(sz) !== -1) at += ' data-sz="' + sz + '"';
          if (isTone(cc)) at += ' data-c="' + cc.toLowerCase() + '"';
          if (at) { out += '<span' + at + '>'; tag = 'span'; }
        } else if (tag) out += '<' + tag + '>';
        walk(c);
        if (tag) out += '</' + tag + '>';
      }
    })(el);
    return out.replace(/<(b|i|u)><\/\1>|<span[^>]*><\/span>/g, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  /* SIZE AND COLOR WITHIN THE WORDS (Chase, 2026-10-03: "different sizes and
     colors WITHIN one text box"; "a full palette, with a few predetermined
     quick picks"). Stored as meaning, <span data-sz data-c>, the names the
     Mail composer uses (workers/src/lib/tones.js); the site draws them in its
     own colors, light or dark. */
  var SIZES = ['sm', 'lg', 'xl'];
  var TONE_NAMES = ['accent', 'accent2', 'dim', 'red', 'green', 'blue', 'gold'];
  /* Swatches as a dark ground shows them, the console's own. */
  var TONE_SWATCH = { dim: '#9AA6B6', red: '#FF8A80', green: '#6FE3A6', blue: '#8DB8FF', gold: '#F2C14E' };
  function isTone(c) { return TONE_NAMES.indexOf(c) !== -1 || /^#[0-9a-f]{6}$/i.test(String(c || '')); }

  /**
   * Give the selected words a size or a color (attr data-sz / data-c), or
   * take it away (value ""). Words wholly inside a span that already has one
   * are split out of it, so one word of a red phrase can turn blue and keep
   * the rest of what it wore. Returns a range over the words, to select.
   */
  function applyMark(box, range, attr, value) {
    var anc = range.commonAncestorContainer;
    anc = anc.nodeType === 1 ? anc : anc.parentNode;
    var outer = anc && anc.closest ? anc.closest('span[' + attr + ']') : null;
    if (outer && !box.contains(outer)) outer = null;
    var set = function (el, v) {
      if (v) el.setAttribute(attr, v); else el.removeAttribute(attr);
      if (attr === 'data-c') el.style.color = /^#/.test(v || '') ? v : '';
      if (!el.getAttribute('style')) el.removeAttribute('style');
    };
    var marked = function (el) { return el.hasAttribute('data-sz') || el.hasAttribute('data-c'); };
    var strip = function (root) {
      [].slice.call(root.querySelectorAll('span[' + attr + ']')).forEach(function (sp) {
        set(sp, '');
        if (!marked(sp)) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.parentNode.removeChild(sp); }
      });
    };
    var out = document.createRange();
    if (outer) {
      /* The words before and after the selection keep the old value, each in
         a copy of the span; the span itself becomes the selected words. */
      var tailR = document.createRange();
      tailR.setStart(range.endContainer, range.endOffset); tailR.setEnd(outer, outer.childNodes.length);
      var tail = outer.cloneNode(false); tail.appendChild(tailR.extractContents());
      var headR = document.createRange();
      headR.setStart(outer, 0); headR.setEnd(range.startContainer, range.startOffset);
      var head = outer.cloneNode(false); head.appendChild(headR.extractContents());
      if (head.textContent) outer.parentNode.insertBefore(head, outer);
      if (tail.textContent) outer.parentNode.insertBefore(tail, outer.nextSibling);
      strip(outer);
      set(outer, value);
      if (marked(outer)) { out.selectNodeContents(outer); return out; }
      var first = outer.firstChild, last = outer.lastChild;
      while (outer.firstChild) outer.parentNode.insertBefore(outer.firstChild, outer);
      outer.parentNode.removeChild(outer);
      if (first) { out.setStartBefore(first); out.setEndAfter(last); }
      return out;
    }
    var frag = range.extractContents();
    strip(frag);
    if (value) {
      var w = document.createElement('span');
      set(w, value);
      w.appendChild(frag);
      range.insertNode(w);
      out.selectNodeContents(w);
    } else {
      var f0 = frag.firstChild, f1 = frag.lastChild;
      range.insertNode(frag);
      if (f0) { out.setStartBefore(f0); out.setEndAfter(f1); }
    }
    return out;
  }

  /* ---- the formatting bar ------------------------------------------------ */

  /* B, I, U and a link, above whatever is selected in a formatted box —
     the only formatting there is, so a person is never faced with a
     toolbar full of choices (Chase: "without overly complicating
     everything"). The usual keys work too: Ctrl/Cmd + B, I, U. */
  var fmt = document.createElement('div');
  fmt.className = 'ws-fmt';
  fmt.hidden = true;
  fmt.innerHTML = [['bold', 'B'], ['italic', 'I'], ['underline', 'U']].map(function (x) {
    return '<button type="button" data-fmt="' + x[0] + '" class="ws-fmt-' + x[0] + '" aria-label="' + esc(tr('ws.fmt.' + x[0])) + '" title="' + esc(tr('ws.fmt.' + x[0])) + '">' + x[1] + '</button>';
  }).join('') +
    '<button type="button" data-fmt="size" class="ws-fmt-size" aria-expanded="false" aria-label="' + esc(tr('ml.cpSize')) + '" title="' + esc(tr('ml.cpSize')) + '">Aa</button>' +
    '<button type="button" data-fmt="color" class="ws-fmt-color" aria-expanded="false" aria-label="' + esc(tr('ml.cpColor')) + '" title="' + esc(tr('ml.cpColor')) + '"><i class="is-none"></i></button>' +
    '<button type="button" data-fmt="link" aria-label="' + esc(tr('ws.fmt.link')) + '" title="' + esc(tr('ws.fmt.link')) + '">' +
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>' +
    '<div class="ws-fmt-row" data-fmt-row="size" hidden>' + [['', 'ml.cpSizeNormal'], ['sm', 'ml.cpSizeSm'], ['lg', 'ml.cpSizeLg'], ['xl', 'ml.cpSizeXl']].map(function (x) {
      return '<button type="button" data-fmt-sz="' + x[0] + '" class="ws-fmt-sz-' + (x[0] || 'n') + '" aria-pressed="false">' + esc(tr(x[1])) + '</button>';
    }).join('') + '</div>' +
    '<div class="ws-fmt-row" data-fmt-row="color" hidden>' + [''].concat(TONE_NAMES).map(function (c) {
      var key = 'ml.cpTone' + (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'None');
      return '<button type="button" class="ws-fmt-tone" data-fmt-c="' + c + '" aria-pressed="false" aria-label="' + esc(tr(key)) + '" title="' + esc(tr(key)) + '"><i' +
        (TONE_SWATCH[c] ? ' style="background:' + TONE_SWATCH[c] + '"' : c === 'accent2' ? ' style="background:var(--ws-acc2)"' : '') + '></i></button>';
    }).join('') +
    '<label class="ws-fmt-tone ws-fmt-any" title="' + esc(tr('ml.cpToneAny')) + '"><input type="color" value="#3366cc" data-fmt-any aria-label="' + esc(tr('ml.cpToneAny')) + '"></label></div>';
  document.body.appendChild(fmt);
  function fmtRow(which) {
    [].forEach.call(fmt.querySelectorAll('[data-fmt-row]'), function (r) {
      var open = r.getAttribute('data-fmt-row') === which && r.hidden;
      r.hidden = !open;
      var b = fmt.querySelector('[data-fmt="' + r.getAttribute('data-fmt-row') + '"]');
      if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  /* What the selection already wears, shown on the bar. */
  function markOf(box, attr) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return '';
    var n = sel.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentNode);
    var sp = n && n.closest ? n.closest('span[' + attr + ']') : null;
    return sp && box.contains(sp) ? sp.getAttribute(attr) : '';
  }
  function showMarks(box) {
    var sz = markOf(box, 'data-sz'), c = markOf(box, 'data-c');
    [].forEach.call(fmt.querySelectorAll('[data-fmt-sz]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-fmt-sz') === sz ? 'true' : 'false'); });
    [].forEach.call(fmt.querySelectorAll('[data-fmt-c]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-fmt-c') === c ? 'true' : 'false'); });
    var any = /^#/.test(c), dot = fmt.querySelector('.ws-fmt-color i');
    fmt.querySelector('.ws-fmt-any').classList.toggle('is-on', any);
    if (any) fmt.querySelector('[data-fmt-any]').value = c;
    dot.style.background = any ? c : TONE_SWATCH[c] || (c === 'accent' ? 'var(--ws-acc)' : c === 'accent2' ? 'var(--ws-acc2)' : '');
    dot.classList.toggle('is-none', !c);
  }
  function boxOfSelection() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var n = sel.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentNode);
    var box = n && n.closest && n.closest('[data-rt]');
    return box && box.getAttribute('contenteditable') === 'true' ? box : null;
  }
  document.addEventListener('selectionchange', function () {
    var box = boxOfSelection();
    if (!box) { if (!fmt.contains(document.activeElement)) fmt.hidden = true; return; }
    var r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    fmt.hidden = false;
    fmt.style.top = (window.scrollY + r.top - fmt.offsetHeight - 8) + 'px';
    fmt.style.left = Math.max(8, window.scrollX + r.left + r.width / 2 - fmt.offsetWidth / 2) + 'px';
    [].forEach.call(fmt.querySelectorAll('[data-fmt]'), function (b) {
      var c = b.getAttribute('data-fmt');
      if (c === 'bold' || c === 'italic' || c === 'underline') b.setAttribute('aria-pressed', document.queryCommandState(c) ? 'true' : 'false');
    });
    showMarks(box);
  });
  /* Keep the selection: a press on the bar must not take focus from the box.
     Except the color picker, which needs focus to open; the selection is
     kept aside for it instead. */
  var anyAt = null;
  fmt.addEventListener('mousedown', function (e) {
    if (e.target.closest('[data-fmt-any], .ws-fmt-any')) {
      var box = boxOfSelection();
      anyAt = box ? { box: box, range: window.getSelection().getRangeAt(0).cloneRange() } : null;
      return;
    }
    e.preventDefault();
  });
  function markSelection(box, range, attr, value) {
    var r = applyMark(box, range, attr, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return r;
  }
  fmt.querySelector('[data-fmt-any]').addEventListener('input', function () {
    if (!anyAt) return;
    anyAt.range = markSelection(anyAt.box, anyAt.range, 'data-c', this.value.toLowerCase());
  });
  fmt.querySelector('[data-fmt-any]').addEventListener('change', function () {
    if (!anyAt) return;
    anyAt.box.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(anyAt.range);
    anyAt = null;
    fmtRow(null);
  });
  fmt.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-fmt], [data-fmt-sz], [data-fmt-c]'), box = boxOfSelection();
    if (!b || !box) return;
    if (b.hasAttribute('data-fmt-sz') || b.hasAttribute('data-fmt-c')) {
      var attr = b.hasAttribute('data-fmt-sz') ? 'data-sz' : 'data-c';
      var r = markSelection(box, window.getSelection().getRangeAt(0), attr, b.getAttribute(attr === 'data-sz' ? 'data-fmt-sz' : 'data-fmt-c'));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      fmtRow(null);
      showMarks(box);
      return;
    }
    var c = b.getAttribute('data-fmt');
    if (c === 'size' || c === 'color') { fmtRow(c); return; }
    if (c === 'link') {
      var range = window.getSelection().getRangeAt(0).cloneRange();
      var url = window.StaffPrompt ? await window.StaffPrompt({ title: tr('ws.fmt.linkAsk'), label: tr('ws.fmt.linkLabel'),
        placeholder: 'https://…', confirm: tr('ws.fmt.link'), cancel: tr('ms.cancel') }) : null;
      if (!url) return;
      url = String(url).trim();
      if (!/^(https?:\/\/|mailto:)/i.test(url)) url = /@/.test(url) ? 'mailto:' + url : 'https://' + url;
      box.focus();
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand(c, false, null);
    }
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });

  /* ---- adding a section ------------------------------------------------ */

  var SKETCH = {
    hero: [[0,0,100,100,'p'],[8,50,60,12,'t'],[8,70,18,10,'a'],[29,70,22,10,'o']],
    text: [[10,14,50,12,'t'],[10,36,80,6,'l'],[10,48,76,6,'l'],[10,60,82,6,'l'],[10,72,60,6,'l']],
    photoText: [[6,14,42,72,'p'],[54,22,36,10,'t'],[54,42,38,6,'l'],[54,54,34,6,'l'],[54,66,36,6,'l']],
    photo: [[0,18,100,64,'p']],
    quote: [[12,30,76,14,'t'],[20,50,60,14,'t'],[38,72,24,5,'l']],
    timeline: [[8,48,84,4,'l'],[8,48,30,4,'b'],[10,42,7,16,'b','50%'],[30,42,7,16,'a','50%'],[52,42,7,16,'o','50%'],[76,42,7,16,'o','50%']],
    goals: [[8,20,38,60,'l'],[54,20,38,60,'l'],[12,60,22,6,'a'],[58,60,12,6,'a']],
    prayer: [[8,16,84,18,'l'],[8,42,84,18,'l'],[8,68,84,18,'l']],
    videos: [[8,8,84,56,'p'],[45,28,10,16,'a','50%'],[8,72,24,18,'l'],[38,72,24,18,'l'],[68,72,24,18,'l']],
    newsletters: [[8,14,84,16,'l'],[8,38,84,16,'l'],[8,62,84,16,'l']],
    signup: [[6,28,88,44,'l'],[12,44,34,10,'t'],[66,42,22,14,'a']],
    contact: [[10,14,80,12,'l'],[10,34,80,12,'l'],[10,54,80,20,'l'],[10,80,20,10,'a']],
    give: [[10,20,60,12,'t'],[10,42,76,6,'l'],[10,54,70,6,'l'],[10,70,26,12,'a']],
    links: [[8,14,84,20,'l'],[8,40,84,20,'l'],[8,66,84,20,'l']],
    cards: [[8,12,10,14,'a','50%'],[22,12,70,14,'l'],[12,30,2,10,'l'],[8,42,10,14,'a','50%'],[22,42,70,14,'l'],[12,60,2,10,'l'],[8,72,10,14,'a','50%'],[22,72,70,14,'l']],
  };
  function sketch(type) {
    return (SKETCH[type] || []).map(function (r) {
      return '<span class="sk sk-' + r[4] + '" style="left:' + r[0] + '%;top:' + r[1] + '%;width:' + r[2] + '%;height:' + r[3] + '%' +
        (r[5] ? ';border-radius:' + r[5] : '') + '"></span>';
    }).join('');
  }
  function openAdd(at) {
    var p = currentPage();
    state.insertAt = at == null ? p.sections.length : at;
    $('wsAddTitle').innerHTML = esc(tr('ws.addTo')) + ' <b>' + esc(pageLabel(p, state.langA)) + '</b>';
    $('wsTiles').innerHTML = ORDER.map(function (t) {
      return '<button type="button" class="ws-tile" data-add-type="' + t + '"><span class="ws-sketch" aria-hidden="true">' + sketch(t) + '</span>' +
        '<b>' + esc(tr('ws.sec.' + t)) + '</b><span>' + esc(tr('ws.sec.' + t + '.what')) + '</span></button>';
    }).join('');
    $('wsAddBack').hidden = false; void $('wsAddBack').offsetHeight; $('wsAddBack').classList.add('in');
    var first = $('wsTiles').querySelector('button'); if (first) first.focus();
  }
  function closeAdd() { $('wsAddBack').classList.remove('in'); $('wsAddBack').hidden = true; }
  $('wsAddClose').addEventListener('click', closeAdd);
  $('wsAddBack').addEventListener('click', function (e) {
    if (e.target === this) return closeAdd();
    var t = e.target.closest('[data-add-type]');
    if (!t) return;
    var type = t.getAttribute('data-add-type'), spec = SECTIONS[type], words = {};
    state.doc.languages.forEach(function (l) { words[l] = {}; spec.words.forEach(function (f) { words[l][f] = ''; }); });
    var s = { id: uid(), type: type, variant: spec.variants[0], words: words };
    if (type === 'hero') s.divider = true;
    s.align = defaultAlign(s);
    if (spec.photo) s.photo = null;
    if (spec.buttons) s.buttons = ['give', 'stay'];
    if (spec.items) s.items = [];
    if (spec.items === 'cards') s.numbers = true;
    /* Where it was asked for, and straight into it: a new section is one
       to be filled in. */
    var at = Math.min(state.insertAt == null ? 1e9 : state.insertAt, currentPage().sections.length);
    currentPage().sections.splice(at, 0, s);
    state.edit = at; state.animate = at; state.sectab = spec.items ? (spec.items === 'cards' ? 'cards' : 'links') : 'words'; state.openItem = null;
    closeAdd(); drawPages(); changed(); refreshFrame();
    var row = $('wsPages').querySelector('.ws-acc[data-si="' + at + '"]');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('wsAddBack').hidden) closeAdd(); });

  /* ---- Design ---------------------------------------------------------- */

  var LOOK_SAMPLE = {
    night: 'background:#0A0D12;color:#EDF2F8;font-family:Sora,system-ui', paper: 'background:#F6F2EA;color:#1A1C22;font-family:Georgia,serif',
    bold: 'color:#041D24;font-family:system-ui;font-weight:800',
  };
  function drawDesign() {
    var d = state.doc.design, th = state.body.theme || { accent: '#1AE4FF', accent2: '#25FFA1' };
    var col = d.colors || (d.colors = { background: null, accent: null });
    var acc = col.accent || th.accent;
    var name = state.body.partner.display_name;
    /* THE PRESETS WEAR THEIR OWN COLORS (and the ministry's accent); only
       Custom wears the owner's — as a dark and a light half, since that is
       what it makes (Chase, 2026-09-29). */
    var cBg = col.background || '#15171C', cAcc = col.accent || th.accent;
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.look')) + '</h2></div><div class="ws-looks">' + LOOKS.map(function (l) {
      var sample;
      if (l === 'custom') {
        var other = dark(cBg) ? '#F6F4F2' : '#16171B';
        var dk = dark(cBg) ? cBg : other, lt = dark(cBg) ? other : cBg;
        sample = '<span class="ws-look-sample ws-look-split">' +
          '<span style="background:' + dk + ';color:#F2F3F5"><span class="ws-look-name">' + esc(name.split(' ')[0]) + '</span>' +
            '<span class="ws-look-btn" style="background:' + cAcc + ';color:#fff">' + esc(tr('ws.btn.give')) + '</span></span>' +
          '<span style="background:' + lt + ';color:#15171C"><span class="ws-look-name">' + esc(name.split(' ')[0]) + '</span>' +
            '<span class="ws-look-btn" style="background:' + cAcc + ';color:#fff">' + esc(tr('ws.btn.give')) + '</span></span></span>';
      } else {
        var bg = l === 'bold' ? 'background:' + th.accent + ';' : '';
        var btn = 'background:' + (l === 'bold' ? '#041D24' : th.accent) + ';color:' + (l === 'bold' ? th.accent : '#06110c');
        sample = '<span class="ws-look-sample" style="' + bg + LOOK_SAMPLE[l] + '"><span class="ws-look-name">' + esc(name) + '</span>' +
          '<span class="ws-look-btn" style="' + btn + '">' + esc(tr('ws.btn.give')) + '</span></span>';
      }
      return '<button type="button" class="ws-look" data-chip="look" data-value="' + l + '" aria-pressed="' + (d.look === l) + '">' + sample +
        '<span class="ws-look-cap"><b>' + esc(tr('ws.look.' + l)) + '</b><span>' + esc(tr('ws.look.' + l + '.what')) + '</span></span></button>';
    }).join('') + '</div>';
    /* Custom's own settings, under it, only while it is chosen. */
    if (d.look === 'custom') {
      html += '<div class="ws-rows ws-custom">' +
        row(tr('ws.bgColor'), colorPick('background', col.background, '#15171C')) +
        row(tr('ws.accentColor'), colorPick('accent', col.accent, th.accent)) +
        row(tr('ws.mode'), chips('mode', ['auto', 'dark', 'light'], d.mode || 'auto', function (v) { return tr('ws.mode.' + v); })) +
        '</div>';
    }
    html += '<div class="ws-rows">' +
      row(tr('ws.menu'), chips('menu', ['top', 'center', 'button'], d.menu, function (v) { return tr('ws.menu.' + v); })) +
      row(tr('ws.brand'), chips('brand', ['name', 'logo'], d.brand, function (v) { return v === 'name' ? name : tr('ws.brand.logo'); }) +
        (d.brand === 'logo' ? (d.logo ? '<img class="ws-logo" src="' + esc(d.logo) + '" alt="">' : '') +
          '<label class="ghost-btn sm ws-file">' + esc(d.logo ? tr('ws.changePhoto') : tr('ws.chooseLogo')) + '<input type="file" accept="image/*" data-logo hidden></label>' : '')) +
      /* The little picture in the browser tab. */
      /* Filled, Letters or Photo (Chase, 2026-10-01); the picture's controls
         only under Photo. Without a picture, Photo shows the filled initials. */
      row(tr('ws.favicon'), chips('faviconStyle', ['filled', 'letters', 'photo'],
        d.faviconStyle || (d.favicon ? 'photo' : 'filled'), function (v) { return tr('ws.faviconStyle.' + v); }) +
        ((d.faviconStyle || (d.favicon ? 'photo' : 'filled')) === 'photo'
          ? (d.favicon ? '<img class="ws-favicon" src="' + esc(d.favicon) + '" alt="">' : '') +
            '<label class="ghost-btn sm ws-file">' + esc(d.favicon ? tr('ws.changePhoto') : tr('ws.choosePhoto')) +
            '<input type="file" accept="image/*" data-favicon hidden></label>' +
            (d.favicon ? '<button type="button" class="link-btn" data-unfavicon>' + esc(tr('ws.removePhoto')) + '</button>' : '')
          : '') +
        '<span class="hint"></span>') +
      '</div><div class="ws-head"><h2>' + esc(tr('ws.motion')) + '</h2></div><div class="ws-rows">' +
      Object.keys(MOTION).map(function (k) {
        return row(tr('ws.m.' + k), chips('motion:' + k, MOTION[k], d.motion[k], function (v) { return tr('ws.m.' + k + '.' + v); }));
      }).join('') + '</div>';
    $('wsDesign').innerHTML = html;
  }

  function dark(hex) {
    var n = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] < 0.25;
  }
  function colorPick(which, chosen, fallback) {
    return '<label class="ws-color"><input type="color" data-color="' + which + '" value="' + esc((chosen || fallback).toLowerCase()) + '">' +
      '<span>' + esc(chosen ? chosen.toUpperCase() : tr(which === 'accent' ? 'ws.colorMinistry' : 'ws.colorLook')) + '</span></label>' +
      (chosen ? '<button type="button" class="link-btn" data-color-reset="' + which + '">' + esc(tr('ws.colorReset')) + '</button>' : '');
  }

  /* ---- Links ----------------------------------------------------------- */

  /* The same icons the site draws (site/render.js). */
  var SOCIAL_ICON = {
    youtube: '<path d="M22 8.2s-.2-1.5-.8-2.1c-.8-.8-1.6-.8-2-.9C16.4 5 12 5 12 5s-4.4 0-7.2.2c-.4.1-1.2.1-2 .9-.6.6-.8 2.1-.8 2.1S2 9.9 2 11.6v1.6c0 1.7.2 3.4.2 3.4s.2 1.5.8 2.1c.8.8 1.8.8 2.2.9 1.6.2 6.8.2 6.8.2s4.4 0 7.2-.2c.4-.1 1.2-.1 2-.9.6-.6.8-2.1.8-2.1s.2-1.7.2-3.4v-1.6c0-1.7-.2-3.4-.2-3.4zM10 15V9l5.2 3L10 15z" fill="currentColor"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17.4" cy="6.6" r="1.1" fill="currentColor"/>',
    facebook: '<path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.6V3.6c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1v2.3H7.6V13h2.7v8h3.2z" fill="currentColor"/>',
    x: '<path d="M17.7 3h3l-6.6 7.5L22 21h-6.1l-4.8-6.2L5.6 21h-3l7-8L2.5 3h6.2l4.3 5.7L17.7 3zm-1 16.2h1.7L7.8 4.7H6l10.7 14.5z" fill="currentColor"/>',
    tiktok: '<path d="M16.5 3c.4 2.2 1.8 3.6 4 3.8v3c-1.5 0-2.9-.4-4-1.2v6.2c0 3.4-2.6 5.7-5.7 5.7S5 18.2 5 15.1c0-3.3 2.8-5.8 6.2-5.6v3.1c-1.6-.3-3.1.8-3.1 2.5 0 1.4 1.1 2.6 2.6 2.6 1.6 0 2.7-1.1 2.7-3V3h3.1z" fill="currentColor"/>',
    linkedin: '<path d="M4.5 9h3v11h-3V9zm1.5-5a1.8 1.8 0 110 3.6A1.8 1.8 0 016 4zm4 5h2.9v1.5c.4-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.1 3.9 4.9V20h-3v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V20h-3V9z" fill="currentColor"/>',
    spotify: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 9.6c3-1 6.6-.7 9.2.8M8 12.6c2.5-.7 5.3-.4 7.4.8M8.6 15.4c2-.5 4-.3 5.6.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>'
  };

  /* THE LINKS TAB, REWORKED (Chase, 2026-09-29; canvas "Round two ·
     Links"). Where people follow you, as a row of icons: a filled one is on
     the site, and a tap opens its one box. The owner's other links as
     plain rows — what it says, where it goes — one opened at a time. The
     preview beside shows the footer, where they appear. */
  function drawLinks() {
    var links = state.doc.links;
    var social = function (k) { return links.filter(function (x) { return x.kind === k; })[0]; };
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.socials')) + '</h2></div><div class="ws-socials">' + SOCIALS.map(function (k) {
      var set = !!social(k), open = state.openSocial === k;
      return '<button type="button" class="ws-soc' + (set ? ' is-set' : '') + '" data-social-pick="' + k + '" aria-pressed="' + open + '" aria-label="' +
        esc(SOCIAL_NAME[k] + (set ? '' : ' — ' + tr('ws.notSet'))) + '" title="' + esc(SOCIAL_NAME[k]) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + SOCIAL_ICON[k] + '</svg></button>';
    }).join('') + '</div>';
    if (state.openSocial) {
      var k = state.openSocial, l = social(k);
      html += '<div class="ws-socbox"><b>' + esc(SOCIAL_NAME[k]) + '</b>' +
        /* A handle is enough (model.js socialUrl), so a plain text box: a url
           box would flag "@name" as wrong. Spotify needs the whole link. */
        '<input type="' + (k === 'email' ? 'email' : 'text') + '" data-social="' + k + '" value="' + esc(l ? l.url.replace(/^mailto:/, '') : '') + '" placeholder="' +
          esc(k === 'email' ? 'you@example.org' : k === 'spotify' ? 'https://' : '@name / https://') + '" aria-label="' + esc(SOCIAL_NAME[k]) + '">' +
        (l ? '<button type="button" class="link-btn" data-social-remove="' + k + '">' + esc(tr('ws.remove')) + '</button>' : '') + '</div>';
    }
    html += '<p class="ws-small ws-soc-hint">' + esc(tr('ws.socialsHow')) + '</p>';

    var custom = links.map(function (l, i) { return { l: l, i: i }; }).filter(function (x) { return x.l.kind === 'custom'; });
    html += '<div class="ws-head ws-head-row"><h2>' + esc(tr('ws.custom')) + '</h2>' +
      '<button type="button" class="solid-btn sm" data-custom-add>+ ' + esc(tr('ws.addLink')) + '</button></div>';
    if (custom.length) {
      html += '<div class="ws-linkrows">' + custom.map(function (x, n) {
        var open = state.openCustom === x.i, u = x.l.url || '';
        var where = !u || u === 'https://' ? tr('ws.link.nowhere') : u.indexOf('page:') === 0
          ? pageLabel(state.doc.pages.filter(function (p) { return 'page:' + p.id === u; })[0] || { id: u.slice(5) }, state.langA) : u.replace(/^https?:\/\//, '');
        var row1 = '<div class="ws-linkrow' + (open ? ' is-open' : '') + '">' +
          '<b>' + esc((x.l.label || {})[state.langA] || tr('ws.itemUntitled')) + '</b><span>→ ' + esc(where) + '</span>' +
          '<button type="button" class="ws-icon" data-custom-up="' + x.i + '" aria-label="' + esc(tr('ws.up')) + '"' + (n === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="ws-icon" data-custom-down="' + x.i + '" aria-label="' + esc(tr('ws.down')) + '"' + (n === custom.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="link-btn" data-custom-open="' + x.i + '">' + esc(open ? tr('ws.close') : tr('ws.edit')) + '</button>' +
          '<button type="button" class="ws-icon del" data-custom-remove="' + x.i + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
        if (!open) return row1;
        return row1 + '<div class="ws-linkedit">' +
          '<label class="fld"><span>' + esc(tr('ws.linkName')) + '</span>' + ref(x.l.label) +
            '<input type="text" maxlength="40" data-custom-label="' + x.i + '" value="' + esc((x.l.label || {})[state.langA] || '') + '" lang="' + esc(state.langA) + '"></label>' +
          '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.link.goesTo')) + '</span>' + linkPicker('custom:' + x.i, u || 'https://', false) + '</div>' +
          /* A web address may show as its site's icon, beside the social icons. */
          (/^https?:\/\/[^/]+\.[^/]+/.test(u) ? '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.showAs')) + '</span>' +
            chips('cshow:' + x.i, ['words', 'icon'], x.l.icon ? 'icon' : 'words', function (v) { return tr('ws.showAs.' + v); }) + '</div>' : '') + '</div>';
      }).join('') + '</div>';
    } else {
      html += '<p class="ws-small">' + esc(tr('ws.noCustom')) + '</p>';
    }
    /* WHERE THE GIVE BUTTONS GO — a link, so it lives with the links (Chase,
       2026-09-29). Empty, it is the ministry's own giving link, shown in the
       box so it is plain which one that is. */
    html += '<div class="ws-head"><h2>' + esc(tr('ws.givingHead')) + '</h2></div><div class="ws-rows">' +
      row(tr('ws.giveLink'), '<input type="url" data-give value="' + esc(state.doc.give || '') + '" placeholder="' +
        esc(state.body.partner.giving_url || 'https://') + '">') + '</div>';
    $('wsLinks').innerHTML = html;
  }

  /* ---- Footer ---------------------------------------------------------- */

  /* Each layout drawn small, so the choice is seen rather than described. */
  var FOOT_SKETCH = {
    split: [[6,30,26,12,'t'],[6,52,34,7,'l'],[70,30,24,12,'o'],[62,56,32,7,'l']],
    center: [[26,18,48,8,'l'],[40,38,20,10,'o'],[22,58,56,8,'t'],[30,76,40,6,'l']],
    columns: [[5,24,22,12,'t'],[34,24,16,6,'l'],[34,38,14,6,'l'],[56,24,16,6,'l'],[56,38,14,6,'l'],[78,24,16,12,'o'],[5,74,90,5,'l']],
  };
  /* ---- the Navigation tab (2026-10-04, from the approved mockup) ---- */
  function navOf(doc) {
    return doc.design.nav || (doc.design.nav = { current: 'lit', tint: 'white', line: 'subtle', phone: 'drop' });
  }
  function drawNav() {
    var n = navOf(state.doc), d = state.doc.design;
    var look = function (group, k, on, sample) {
      return '<button type="button" class="ws-look" data-chip="nav:' + group + '" data-value="' + k + '" aria-pressed="' + on + '">' + sample +
        '<span class="ws-look-cap"><b>' + esc(tr('ws.nav.' + (group === 'current' ? 'cur' : group) + '.' + k)) + '</b><span>' +
        esc(tr('ws.nav.' + (group === 'current' ? 'cur' : group) + '.' + k + '.what')) + '</span></span></button>';
    };
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.nav.current')) + '</h2></div><div class="ws-looks ws-navs" data-tint="' + esc(n.tint) + '">' +
      ['lit', 'under', 'grow', 'pill'].map(function (k) {
        return look('current', k, n.current === k, '<span class="ws-nav-sample" data-cur="' + k + '" aria-hidden="true"><span>' +
          esc(tr('ws.page.about')) + '</span><span class="on">' + esc(tr('ws.page.mission')) + '</span><span>' + esc(tr('ws.page.timeline')) + '</span></span>');
      }).join('') + '</div>';
    html += '<div class="ws-rows">' +
      row(tr('ws.nav.tint'), chips('nav:tint', ['accent', 'white'], n.tint, function (v) { return tr('ws.nav.tint.' + v); })) +
      row(tr('ws.nav.line'), chips('nav:line', ['none', 'subtle', 'accent'], n.line, function (v) { return tr('ws.nav.line.' + v); })) +
      '</div>';
    html += '<div class="ws-head"><h2>' + esc(tr('ws.nav.phone')) + '</h2></div><div class="ws-looks ws-navs">' +
      ['drop', 'full', 'drawer'].map(function (k) {
        return look('phone', k, n.phone === k, '<span class="ws-phone-sample" data-phone="' + k + '" aria-hidden="true"><i></i></span>');
      }).join('') + '</div>';
    /* Straight to the giving link only when there is one to go to. */
    html += '<div class="ws-rows">' + row(tr('ws.nav.give'), state.doc.give
      ? chips('giveTo', ['page', 'link'], d.giveTo || 'page', function (v) { return tr('ws.nav.give.' + v); })
      : chips('giveTo', ['page'], 'page', function (v) { return tr('ws.nav.give.' + v); }) +
        '<button type="button" class="ghost-btn sm" data-goto-tab="settings">' + esc(tr('ws.nav.addGive')) + ' →</button>') + '</div>';
    /* The social icons in the menu too — here, with the rest of the menu
       (it was "Also show them at the top" on the Links tab). */
    html += '<div class="ws-rows">' + row(tr('ws.nav.icons'), sw('data-header-links', d.headerLinks, '')) + '</div>';
    $('wsNav').innerHTML = html;
  }

  function drawFooter() {
    var f = state.doc.footer || (state.doc.footer = { layout: 'split', menu: false, socials: 'icons', words: {} });
    var w = (f.words || {})[state.langA] || {};
    var src = function (k) { var o = {}; Object.keys(f.words || {}).forEach(function (l) { o[l] = (f.words[l] || {})[k]; }); return o; };
    /* WHAT IS IN IT, and where that comes from (Chase, 2026-09-29: "How do
       the footer links populate? I don't see any."): the social and other
       links from the Links tab, and the pages if switched on below. */
    var inIt = state.doc.links.filter(function (l) { return l.url && l.url !== 'https://'; }).map(function (l) {
      return l.kind === 'custom' ? ((l.label || {})[state.langA] || l.url.replace(/^page:/, '')) : SOCIAL_NAME[l.kind];
    });
    if (f.menu) inIt = state.doc.pages.filter(function (p) { return p.on; }).map(function (p) { return pageLabel(p, state.langA); }).concat(inIt);
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.footer.has')) + '</h2></div><div class="ws-infoot">' +
      (inIt.length ? inIt.map(function (x) { return '<span class="ws-pill">' + esc(x) + '</span>'; }).join('')
                   : '<span class="ws-small">' + esc(tr('ws.footer.nothing')) + '</span>') +
      '<button type="button" class="ghost-btn sm" data-goto-tab="links">' + esc(tr('ws.footer.editLinks')) + ' →</button></div>';
    html += '<div class="ws-head"><h2>' + esc(tr('ws.footer.layout')) + '</h2></div><div class="ws-looks ws-foots">' + FOOTERS.map(function (k) {
      return '<button type="button" class="ws-look" data-chip="footer:layout" data-value="' + k + '" aria-pressed="' + (f.layout === k) + '">' +
        '<span class="ws-sketch ws-foot-sketch" aria-hidden="true">' + (FOOT_SKETCH[k] || []).map(function (r) {
          return '<span class="sk sk-' + r[4] + '" style="left:' + r[0] + '%;top:' + r[1] + '%;width:' + r[2] + '%;height:' + r[3] + '%"></span>';
        }).join('') + '</span>' +
        '<span class="ws-look-cap"><b>' + esc(tr('ws.footer.' + k)) + '</b><span>' + esc(tr('ws.footer.' + k + '.what')) + '</span></span></button>';
    }).join('') + '</div>';
    html += '<div class="ws-rows">' +
      row(tr('ws.footer.menu'), sw('data-footer-menu', f.menu, '')) +
      row(tr('ws.footer.socials'), chips('footer:socials', ['icons', 'words'], f.socials, function (v) { return tr('ws.footer.socials.' + v); })) +
      /* The tagline's color (Chase, 2026-10-01): as now, quieter, or the accent. */
      row(tr('ws.footer.taglineColor'), chips('footer:tagline', ['plain', 'subtle', 'accent'], f.tagline || 'plain', function (v) { return tr('ws.footer.tagline.' + v); })) +
      '</div><div class="ws-fields">' +
      '<label class="fld ws-wide"><span>' + esc(tr('ws.footer.tagline')) + '</span>' + ref(src('tagline')) +
        '<input type="text" maxlength="120" data-footer-word="tagline" value="' + esc(w.tagline || '') + '" lang="' + esc(state.langA) + '"></label>' +
      '<label class="fld ws-wide"><span>' + esc(tr('ws.footer.small')) + '</span>' + ref(src('small')) +
        '<textarea rows="2" maxlength="400" data-footer-word="small" lang="' + esc(state.langA) + '">' + esc(w.small || '') + '</textarea></label>' +
      '</div>';
    $('wsFooter').innerHTML = html;
  }

  /* ---- Settings -------------------------------------------------------- */

  function drawSettings() {
    var b = state.body, d = state.doc;
    var sub = b.site.subdomain;
    var who = '<div class="ws-people"><div class="ws-person"><b>' + esc((b.owner && b.owner.name) || b.partner.display_name) + '</b> <span class="ws-small">· ' + esc(tr('ws.owner')) + '</span></div>' +
      (b.editors || []).map(function (e) {
        return '<div class="ws-person"><b>' + esc(e.name) + '</b> <span class="ws-small">· ' + esc(tr('ws.canEdit')) + '</span>' +
          (b.can.owner ? '<button type="button" class="link-btn" data-revoke="' + esc(e.user_id) + '">' + esc(tr('ws.remove')) + '</button>' : '') + '</div>';
      }).join('') +
      (b.requests || []).map(function (r) {
        return '<div class="ws-person is-asking"><span><b>' + esc(r.name) + '</b> ' + esc(tr('ws.asksToEdit')) +
          (r.note ? '<br><span class="ws-small">“' + esc(r.note) + '”</span>' : '') + '</span>' +
          '<button type="button" class="ghost-btn sm" data-decline="' + esc(r.user_id) + '">' + esc(tr('ws.decline')) + '</button>' +
          '<button type="button" class="solid-btn sm" data-grant="' + esc(r.user_id) + '">' + esc(tr('ws.allow')) + '</button></div>';
      }).join('') + '</div>';
    var html = '<div class="ws-rows">' +
      row(tr('ws.address'), '<span class="ws-addr"><b>' + esc(sub) + '</b>.thauma.one</span><span class="ws-small">' + esc(tr('ws.addressWho')) + '</span>') +
      row(tr('ws.languages'), '<span class="ws-langs">' + b.languages.map(function (l) {
        var on = d.languages.indexOf(l.code) !== -1;
        return '<label class="chk"><input type="checkbox" data-site-lang="' + esc(l.code) + '"' + (on ? ' checked' : '') +
          (on && d.languages.length === 1 ? ' disabled' : '') + '><span>' + esc(l.native_name || l.name) + '</span></label>';
      }).join('') + '</span>') +
      row(tr('ws.fallback'), '<select data-fallback>' + d.languages.map(function (l) {
        return '<option value="' + esc(l) + '"' + (l === d.fallback ? ' selected' : '') + '>' + esc(langName(l)) + '</option>';
      }).join('') + '</select>') +
      row(tr('ws.whoEdits'), who) +
      '</div><div class="ws-head"><h2>' + esc(tr('ws.startAgain')) + '</h2></div><div class="ws-starts">' +
      ['full', 'basic', 'blank'].map(function (k) {
        return '<button type="button" class="ws-start" data-start="' + k + '"><b>' + esc(tr('ws.start.' + k)) + '</b><span>' + esc(tr('ws.start.' + k + '.what')) + '</span></button>';
      }).join('') + '</div>';
    $('wsSettings').innerHTML = html;
  }

  /* ---- every change ---------------------------------------------------- */

  function words(obj, lang) { obj.words = obj.words || {}; obj.words[lang] = obj.words[lang] || {}; return obj.words[lang]; }
  function move(list, i, by) { var j = i + by; if (j < 0 || j >= list.length) return; var x = list[i]; list[i] = list[j]; list[j] = x; }

  $('wsRoot').addEventListener('input', function (e) {
    var t = e.target, p = currentPage(), v = t.value;
    if (t.dataset.pageLabel !== undefined) { var pg = state.doc.pages[+t.dataset.pageLabel]; pg.label = pg.label || {}; pg.label[state.langA] = v; return changed(); }
    if (t.dataset.secWord) { var a = t.dataset.secWord.split(':'); words(p.sections[+a[0]], state.langA)[a[1]] = v; return changed(); }
    if (t.dataset && t.dataset.rt) { var rt = t.dataset.rt.split(':'); words(p.sections[+rt[0]], state.langA)[rt[1]] = richFrom(t); return changed(); }
    if (t.dataset.item) { var b = t.dataset.item.split(':'); words(p.sections[+b[0]].items[+b[1]], state.langA)[b[2]] = v; return changed(); }
    if (t.dataset.linkUrl) { setLink(t.dataset.linkUrl, v.trim() || 'https://'); return changed(); }
    if (t.dataset.color) {
      state.doc.design.colors = state.doc.design.colors || {};
      state.doc.design.colors[t.dataset.color] = t.value.toUpperCase();
      var lbl = t.parentNode.querySelector('span'); if (lbl) lbl.textContent = t.value.toUpperCase();
      return changed();
    }
    if (t.dataset.footerWord) { var fw = state.doc.footer.words; fw[state.langA] = fw[state.langA] || {}; fw[state.langA][t.dataset.footerWord] = v; return changed(); }
    if (t.dataset.social) {
      var k = t.dataset.social, list = state.doc.links, at = list.findIndex(function (x) { return x.kind === k; });
      var url = v.trim(); if (k === 'email' && url && !/^mailto:/.test(url)) url = 'mailto:' + url;
      if (!url) { if (at !== -1) list.splice(at, 1); } else if (at === -1) list.push({ kind: k, url: url, label: {} }); else list[at].url = url;
      var ic = $('wsLinks').querySelector('[data-social-pick="' + k + '"]'); if (ic) ic.classList.toggle('is-set', !!url);
      return changed();
    }
    if (t.dataset.customLabel !== undefined) {
      var cl = state.doc.links[+t.dataset.customLabel]; cl.label = cl.label || {}; cl.label[state.langA] = v;
      var rb = t.closest('.ws-linkedit'); rb = rb && rb.previousElementSibling && rb.previousElementSibling.querySelector('b');
      if (rb) rb.textContent = v || tr('ws.itemUntitled');
      return changed();
    }
    if (t.dataset.give !== undefined) { state.doc.give = v.trim(); return changed(); }
  });

  /* "sec:<i>" is a section's link; "item:<i>:<j>" is one card's. */
  function setLink(key, value) {
    var a = key.split(':');
    if (a[0] === 'custom') { state.doc.links[+a[1]].url = value; return; }
    var s = currentPage().sections[+a[1]];
    if (a[0] === 'sec') s.link = value; else s.items[+a[2]].url = value;
  }

  /* Bring the top of the editor into view after moving between the list of
     pages and a page — gently, and only if it is off the screen. */
  function editorIntoView() {
    var top = $('wsRoot').getBoundingClientRect().top;
    if (top < 0) $('wsRoot').scrollIntoView({ block: 'start', behavior: still() ? 'auto' : 'smooth' });
  }

  $('wsRoot').addEventListener('change', async function (e) {
    var t = e.target, p = currentPage();
    if (t.dataset.pickPage !== undefined) { state.page = t.value; state.edit = null; drawPages(); refreshFrame(); return; }
    /* A color settled on: the look cards redraw in it (not while dragging,
       which would close the picker under the pointer). */
    if (t.dataset.color) { drawDesign(); return; }
    if (t.dataset.link) {
      /* "Another address" opens a box for it, empty and waiting. */
      setLink(t.dataset.link, t.value);
      return changed();
    }
    if (t.dataset.secPhotolink) { p.sections[+t.dataset.secPhotolink].photoLink = t.checked; return changed(); }
    if (t.dataset.itemPhoto) { var ip = t.dataset.itemPhoto.split(':'); return upload(t, function (url) { p.sections[+ip[0]].items[+ip[1]].photo = url; drawSections(); }); }
    if (t.dataset.secBtn) {
      var a = t.dataset.secBtn.split(':'), s = p.sections[+a[0]];
      s.buttons = (s.buttons || []).filter(function (x) { return x !== a[1]; });
      if (t.checked) s.buttons.push(a[1]);
      return changed();
    }
    if (t.dataset.siteLang) {
      var code = t.dataset.siteLang, langs = state.doc.languages;
      if (t.checked && langs.indexOf(code) === -1) langs.push(code);
      if (!t.checked) state.doc.languages = langs.filter(function (l) { return l !== code; });
      if (state.doc.languages.indexOf(state.doc.fallback) === -1) state.doc.fallback = state.doc.languages[0];
      fillPair(); drawSettings(); return changed();
    }
    if (t.dataset.fallback !== undefined) { state.doc.fallback = t.value; return changed(); }
    if (t.dataset.secPhoto) return upload(t, function (url) { p.sections[+t.dataset.secPhoto].photo = url; drawSections(); });
    if (t.dataset.logo !== undefined) return upload(t, function (url) { state.doc.design.logo = url; drawDesign(); });
    if (t.dataset.favicon !== undefined) return upload(t, function (url) { state.doc.design.favicon = url; drawDesign(); }, 256);
  });

  $('wsRoot').addEventListener('click', async function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    var p = currentPage(), d = t.dataset;
    if (d.openPage) { state.page = d.openPage; state.edit = null; drawPages(); refreshFrame(); editorIntoView(); return; }
    if (d.allPages !== undefined) { state.page = null; state.edit = null; drawPages(); refreshFrame(); editorIntoView(); return; }
    if (d.editSec !== undefined) {
      /* A row opens where it is; pressing it again, or Done, folds it. */
      var si = +d.editSec;
      state.anchor = si;
      if (state.edit === si) { state.edit = null; } else { state.edit = si; state.animate = si; state.sectab = 'words'; state.openItem = null; state.showKicker = false; }
      drawPages(); refreshFrame(); return;
    }
    if (d.panelBack !== undefined) { state.anchor = state.edit; state.edit = null; drawPages(); refreshFrame(); return; }
    if (d.sectab) { state.sectab = d.sectab; drawPages(); return; }
    if (d.insertAt !== undefined) return openAdd(+d.insertAt);
    if (d.itemOpen !== undefined) { state.openItem = state.openItem === +d.itemOpen ? null : +d.itemOpen; drawPages(); return; }
    if (d.showKicker !== undefined) { state.showKicker = true; drawPages(); var k = $('wsPages').querySelector('[data-sec-word$=":kicker"]'); if (k) k.focus(); return; }
    if (d.pageUp) { move(state.doc.pages, +d.pageUp, -1); drawPages(); return changed(); }
    if (d.pageDown) { move(state.doc.pages, +d.pageDown, 1); drawPages(); return changed(); }
    if (d.pageOn) { var pg = state.doc.pages[+d.pageOn]; pg.on = !pg.on; drawPages(); return changed(); }
    if (d.secUp) { move(p.sections, +d.secUp, -1); drawSections(); return changed(); }
    if (d.secDown) { move(p.sections, +d.secDown, 1); drawSections(); return changed(); }
    if (d.secRemove) {
      var s = p.sections[+d.secRemove];
      var ok = window.StaffConfirm ? await window.StaffConfirm({ title: fill('ws.removeTitle', { kind: tr('ws.sec.' + s.type) }), confirm: tr('ws.remove'), cancel: tr('ms.cancel'), danger: true }) : true;
      if (ok) { p.sections.splice(+d.secRemove, 1); state.edit = null; drawSections(); changed(); }
      return;
    }
    if (d.secUnphoto) { p.sections[+d.secUnphoto].photo = null; drawSections(); return changed(); }
    if (d.itemAdd) { var sec = p.sections[+d.itemAdd]; sec.items = sec.items || []; sec.items.push(sec.type === 'cards' ? { words: {} } : { url: 'https://', photo: null, words: {} }); state.openItem = sec.items.length - 1; drawSections(); var ti = $('wsPages').querySelector('[data-item$=":title"]'); if (ti) ti.focus(); return; }
    if (d.itemUnphoto) { var up = d.itemUnphoto.split(':'); p.sections[+up[0]].items[+up[1]].photo = null; drawSections(); return changed(); }
    if (d.unfavicon !== undefined) { state.doc.design.favicon = null; drawDesign(); return changed(); }
    /* Press the photo where it must stay in view. */
    var aimBox = e.target.closest && e.target.closest('[data-sec-focus]');
    if (aimBox) {
      var r = aimBox.getBoundingClientRect();
      p.sections[+aimBox.getAttribute('data-sec-focus')].focusY = Math.max(0, Math.min(100, Math.round((e.clientY - r.top) / r.height * 100)));
      drawSections(); return changed();
    }
    if (d.gotoTab) { var tb = document.querySelector('[data-ws-tab="' + d.gotoTab + '"]'); if (tb) tb.click(); return; }
    if (d.colorReset) { state.doc.design.colors[d.colorReset] = null; drawDesign(); return changed(); }
    if (d.footerMenu !== undefined) { state.doc.footer.menu = !state.doc.footer.menu; drawFooter(); return changed(); }
    if (d.itemRemove) { var r = d.itemRemove.split(':'); p.sections[+r[0]].items.splice(+r[1], 1); state.openItem = null; drawSections(); return changed(); }
    if (d.customAdd !== undefined) {
      state.doc.links.push({ kind: 'custom', url: 'https://', label: {} });
      state.openCustom = state.doc.links.length - 1; drawLinks();
      var nm = $('wsLinks').querySelector('[data-custom-label="' + state.openCustom + '"]'); if (nm) nm.focus();
      return;
    }
    if (d.customRemove) { state.doc.links.splice(+d.customRemove, 1); state.openCustom = null; drawLinks(); return changed(); }
    if (d.customOpen !== undefined) { state.openCustom = state.openCustom === +d.customOpen ? null : +d.customOpen; drawLinks(); return; }
    if (d.customUp || d.customDown) {
      /* Moved among the other links only; the social ones keep their place. */
      var at = +(d.customUp || d.customDown), list = state.doc.links;
      var idx = list.map(function (l, n) { return l.kind === 'custom' ? n : -1; }).filter(function (n) { return n !== -1; });
      var pos = idx.indexOf(at), to = idx[pos + (d.customUp ? -1 : 1)];
      if (to == null) return;
      var tmp = list[at]; list[at] = list[to]; list[to] = tmp;
      if (state.openCustom === at) state.openCustom = to; else if (state.openCustom === to) state.openCustom = at;
      drawLinks(); return changed();
    }
    if (d.socialPick) {
      state.openSocial = state.openSocial === d.socialPick ? null : d.socialPick; drawLinks();
      var sb = $('wsLinks').querySelector('[data-social="' + state.openSocial + '"]'); if (sb) sb.focus();
      return;
    }
    if (d.socialRemove) {
      state.doc.links = state.doc.links.filter(function (l) { return l.kind !== d.socialRemove; });
      state.openSocial = null; drawLinks(); return changed();
    }
    if (d.pageCue !== undefined) {
      var pc = state.doc.pages[+d.pageCue];
      pc.cue = pc.cue === false;
      drawSections(); return changed();
    }
    if (d.headerLinks !== undefined) { state.doc.design.headerLinks = !state.doc.design.headerLinks; drawNav(); return changed(); }
    if (d.chip) {
      var val = d.value, name = d.chip;
      if (name.indexOf('variant:') === 0) { p.sections[+name.slice(8)].variant = val; drawSections(); }
      else if (name.indexOf('raised:') === 0) { p.sections[+name.slice(7)].raised = val === 'raised'; drawSections(); }
      else if (name.indexOf('divider:') === 0) { p.sections[+name.slice(8)].divider = val === 'on'; drawSections(); }
      else if (name.indexOf('cshow:') === 0) { state.doc.links[+name.slice(6)].icon = val === 'icon'; drawLinks(); }
      else if (name.indexOf('pheight:') === 0) { p.sections[+name.slice(8)].height = val; drawSections(); }
      else if (name.indexOf('vtitle:') === 0) { p.sections[+name.slice(7)].titleFrom = val; drawSections(); }
      else if (name.indexOf('vlinks:') === 0) { p.sections[+name.slice(7)].linkStyle = val; drawSections(); }
      else if (name.indexOf('tier:') === 0) { var tk = name.slice(5).split(':'); p.sections[+tk[0]].items[+tk[1]].tier = val; drawSections(); }
      else if (name.indexOf('numbers:') === 0) { p.sections[+name.slice(8)].numbers = val === 'on'; drawSections(); }
      else if (name.indexOf('topline:') === 0) { p.sections[+name.slice(8)].topline = val === 'on'; drawSections(); }
      else if (name.indexOf('hbg:') === 0) { p.sections[+name.slice(4)].bg = val; drawSections(); }
      else if (name.indexOf('verse:') === 0) { p.sections[+name.slice(6)].verseStyle = val; drawSections(); }
      else if (name.indexOf('align:') === 0) { p.sections[+name.slice(6)].align = val; drawSections(); }
      else if (name.indexOf('linkkind:') === 0) {
        var key = name.slice(9);
        var firstPage = (state.doc.pages.filter(function (x) { return x.on && x.id !== 'home'; })[0] || state.doc.pages[0]).id;
        var firstSec = jumpTargets(key)[0];
        setLink(key, val === 'none' ? '' : val === 'page' ? 'page:' + firstPage :
          val === 'section' ? (firstSec ? 'section:' + firstSec.id : '') : 'https://');
        if (state.tab === 'links') drawLinks(); else drawSections();
        var box = val === 'url' && $('wsRoot').querySelector('[data-link-url="' + key + '"]');
        if (box) box.focus();
      }
      else if (name.indexOf('footer:') === 0) { state.doc.footer[name.slice(7)] = val; drawFooter(); }
      else if (name.indexOf('nav:') === 0) { navOf(state.doc)[name.slice(4)] = val; drawNav(); }
      else if (name === 'giveTo') { state.doc.design.giveTo = val; drawNav(); }
      else if (name.indexOf('motion:') === 0) { state.doc.design.motion[name.slice(7)] = val; drawDesign(); }
      else if (name === 'look' || name === 'menu' || name === 'brand' || name === 'mode' || name === 'faviconStyle') { state.doc.design[name] = val; drawDesign(); }
      return changed();
    }
    if (d.start) {
      var ok2 = window.StaffConfirm ? await window.StaffConfirm({ title: fill('ws.startTitle', { kind: tr('ws.start.' + d.start) }),
        body: tr('ws.startBody'), confirm: tr('ws.startGo'), cancel: tr('ms.cancel'), danger: true }) : true;
      if (ok2) { state.page = null; state.edit = null; act({ action: 'start', kind: d.start }, tr('ws.started')); }
      return;
    }
    if (d.grant) return act({ action: 'grant', user_id: d.grant }, tr('ws.allowed'));
    if (d.decline) return act({ action: 'decline', user_id: d.decline });
    if (d.revoke) return act({ action: 'revoke', user_id: d.revoke });
  });

  /* A picture: made smaller and WebP in the browser, then stored with the
     ministry's other pictures. */
  async function upload(input, done, max) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var status = input.closest('.ws-sec-row, .ws-ctl, .ws-card-pic');
    var note = status && status.querySelector('.hint');
    if (note) note.textContent = tr('ws.uploading');
    try {
      var bitmap = await createImageBitmap(file);
      var scale = Math.min(1, (max || 2000) / Math.max(bitmap.width, bitmap.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.84); });
      var res = await fetch('/api/admin/media?kind=partnersite', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'image/webp' }, body: blob });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      done(body.url);
      changed();
    } catch (err) {
      if (note) note.textContent = '';
      toast(err.message, 'err');
    }
  }

  load();
})();
