/* ============================================================
   staff-sharing.js — Sharing: everything that goes on other websites
   ============================================================
   Mockup board 9. Six things, one page (see sharing.njk):

     roadmap · goal · prayer · videos   the ministry's data, drawn by
                                        /embed/v1/widget.js; each shared on
                                        its own (0038); administrator-only
     signup                             the sign-up form (form.js): its Live
                                        switch, which lists it offers, its words
     contact                            the contact form (contact.js): Live,
                                        where messages go, its reasons, words

   THREE SOURCES, NO NEW ENDPOINT. /api/staff-settings holds the colors, what
   is shared and the roadmap's period; /api/staff-embed the data the preview
   draws; /api/staff-mailing the lists, the sign-up switch and the contact
   form. Each is saved back the way the screens it replaces saved it.

   A WORKING COPY AND ONE BAR. `saved` is what the three said; `draft` is the
   screen. Nothing is sent until Save, and Save sends only what changed — a
   color, a switch, a list, the contact form — each to its own endpoint.
   ============================================================ */
(function () {
  'use strict';

  if (!document.getElementById('shList')) return;

  var SETTINGS = '/api/staff-settings';
  var PREVIEW = '/api/staff-embed';
  var MAILING = '/api/staff-mailing';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#6D4AFF';
  var PREVIEW_MAX_H = 480;
  /* A widget on a desktop page is drawn at a desktop page's width and scaled
     to fit, because the widget chooses its layout from the width it is given:
     at the middle column's own width the roadmap would draw as a phone's
     column and "Desktop" would be untrue. */
  var DESKTOP_W = 1000;
  var WIDGETS = ['roadmap', 'goal', 'prayer', 'videos'];
  var ITEMS = WIDGETS.concat(['signup', 'contact']);

  var $ = function (id) { return document.getElementById(id); };
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function setSwitch(btn, on) {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    var st = btn.querySelector('.switch-state');
    if (st) st.textContent = on ? 'On' : 'Off';
  }
  function isForm(item) { return item === 'signup' || item === 'contact'; }

  /* ---- the color pair --------------------------------------------------
     The -33 degree rotation the Worker and the widget use (embed-colour.js),
     so "matched automatically" shows its real result without a round trip. */
  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min;
    if (d === 0) return { h: 0, s: 0, l: l };
    var sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: sat, l: l };
  }
  function hslToHex(o) {
    var h = ((o.h % 360) + 360) % 360, sat = o.s, l = o.l;
    var c = (1 - Math.abs(2 * l - 1)) * sat;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    function to(v) { var q = Math.round((v + m) * 255).toString(16); return q.length < 2 ? '0' + q : q; }
    return '#' + to(r) + to(g) + to(b);
  }
  function companion(hex) {
    var o = hexToHsl(hex);
    if (!o) return hex;
    if (o.s < 0.12) {
      var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);
      return hslToHex({ h: o.h, s: o.s, l: l });
    }
    return hslToHex({ h: o.h - 33, s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });
  }

  /* ---- state ----------------------------------------------------------- */

  var state = {
    scope: /(\?|&)scope=organization\b/.test(location.search) ? 'organization' : 'partner',
    settings: null, payload: null, mail: null,
    item: null, device: 'wide', lang: null,
    saved: null, draft: null, busy: false
  };

  function isAdmin() { return !!(state.settings && state.settings.you && state.settings.you.is_admin); }
  function slug() { return (state.settings && state.settings.partner && state.settings.partner.slug) ||
    (state.mail && state.mail.partner && state.mail.partner.slug) || ''; }
  function who() { return state.scope === 'organization' ? 'thauma' : slug(); }
  /* The four widgets are a ministry's data: Thauma's own scope, or an account
     with no ministry, has only the forms. */
  function items() {
    return state.scope === 'organization' || !state.settings ? ['signup', 'contact'] : ITEMS;
  }

  /* The list whose words the form wears: the first open one, alphabetically —
     the rule form.js uses. (Part 4 gives the form words of its own.) */
  function wordsList(lists, open) {
    var on = lists.filter(function (l) { return open[l.id]; });
    on.sort(function (a, b) { return String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1; });
    return on[0] || null;
  }

  function snapshot() {
    var s = state.settings || {};
    var e = s.embed || {};
    var sh = e.shared || {};
    var tl = s.timeline || {};
    var m = state.mail || {};
    var lists = m.lists || [];
    var open = {};
    lists.forEach(function (l) { open[l.id] = !!l.is_open; });
    var wl = wordsList(lists, open);
    var c = m.contact || {};
    return {
      accent: HEX.test(e.accent || '') ? e.accent.toUpperCase() : DEFAULT_ACCENT,
      accent2: HEX.test(e.accent2 || '') ? e.accent2.toUpperCase() : null,
      theme: e.theme || 'auto',
      shared: { roadmap: !!sh.roadmap, goal: !!sh.goal, prayer: !!sh.prayer, videos: !!sh.videos },
      period: { start: tl.start || '', end: tl.end || '' },
      signupOpen: m.embed ? !!m.embed.signup_form_open : true,
      lists: open,
      wordsList: wl ? wl.id : null,
      words: wl ? { heading: wl.form_heading || '', blurb: wl.form_blurb || '', button: wl.form_button || '' } : null,
      contact: {
        deliver_to: c.deliver_to || '', from_address: c.from_address || '',
        heading: c.heading || '', blurb: c.blurb || '', button: c.button || '', thanks: c.thanks || '',
        is_open: !!c.is_open,
        topics: (m.topics || []).map(function (t) { return { label: t.label || '', deliver_to: t.deliver_to || '' }; })
      }
    };
  }

  /* What changed, as the parts Save sends separately. */
  function changes() {
    var a = state.saved, b = state.draft;
    if (!a || !b) return {};
    var out = {};
    if (a.accent !== b.accent || a.accent2 !== b.accent2 || a.theme !== b.theme || !same(a.shared, b.shared)) out.embed = true;
    if (!same(a.period, b.period)) out.period = true;
    if (a.signupOpen !== b.signupOpen) out.signupOpen = true;
    var lists = Object.keys(b.lists).filter(function (id) { return a.lists[id] !== b.lists[id]; });
    if (b.wordsList && !same(a.words, b.words)) {
      if (lists.indexOf(b.wordsList) === -1) lists.push(b.wordsList);
    }
    if (lists.length) out.lists = lists;
    if (!same(a.contact, b.contact)) out.contact = true;
    return out;
  }
  function count() {
    var c = changes();
    return (c.embed ? 1 : 0) + (c.period ? 1 : 0) + (c.signupOpen ? 1 : 0) +
      (c.lists ? c.lists.length : 0) + (c.contact ? 1 : 0);
  }

  /* Which of the six a change touches, for the dot on its row. */
  function itemDirty(item) {
    var a = state.saved, b = state.draft;
    if (!a || !b) return false;
    if (WIDGETS.indexOf(item) !== -1) {
      return a.shared[item] !== b.shared[item] || (item === 'roadmap' && !same(a.period, b.period));
    }
    if (item === 'signup') return a.signupOpen !== b.signupOpen || !same(a.lists, b.lists) || !same(a.words, b.words);
    return !same(a.contact, b.contact);
  }
  function itemLive(item, d) {
    if (WIDGETS.indexOf(item) !== -1) return !!d.shared[item];
    if (item === 'signup') {
      var any = Object.keys(d.lists).some(function (id) { return d.lists[id]; });
      return any && (state.scope === 'organization' || d.signupOpen);
    }
    return !!d.contact.is_open;
  }

  /* ---- drawing --------------------------------------------------------- */

  function drawBar() {
    var n = count();
    $('shBar').hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    $('shCount').textContent = n === 1 ? tr('up.pending1') : fill('up.pendingN', { n: n });
  }

  function drawList() {
    var d = state.draft;
    $('shList').innerHTML = items().map(function (item) {
      var live = itemLive(item, d);
      return '<button type="button" class="sh-item' + (item === state.item ? ' is-on' : '') +
          (itemDirty(item) ? ' is-dirty' : '') + '" data-item="' + item + '"' +
          (item === state.item ? ' aria-current="true"' : '') + '>' +
        '<span class="sh-item-name">' + esc(tr('sh.item.' + item)) + '</span>' +
        '<span class="sh-item-state' + (live ? ' is-live' : '') + '">' +
          esc(tr(live ? 'sh.live' : 'sh.notShared')) + '</span>' +
      '</button>';
    }).join('');
  }

  function drawColors() {
    var d = state.draft;
    var show = state.scope !== 'organization' && !!state.settings;
    $('shColors').hidden = !show;
    if (!show) return;
    var admin = isAdmin();
    $('shAccent').value = d.accent;
    $('shAccentHex').value = d.accent;
    var second = d.accent2 || companion(d.accent);
    $('shAccent2').value = second;
    $('shPairNote').textContent = d.accent2 ? second.toUpperCase() : tr('sh.matched');
    $('shPairAuto').hidden = !d.accent2 || !admin;
    $('shTheme').value = d.theme;
    ['shAccent', 'shAccentHex', 'shAccent2', 'shTheme'].forEach(function (id) { $(id).disabled = !admin; });
  }

  function drawSide() {
    var d = state.draft, item = state.item;
    var widget = WIDGETS.indexOf(item) !== -1;
    var admin = isAdmin();

    /* LIVE. A widget's is an administrator's decision; the sign-up form's is
       the ministry's own; Thauma's own sign-up form is its lists alone. */
    var live = $('shLive');
    var liveCard = !(item === 'signup' && state.scope === 'organization');
    $('shLiveCard').hidden = !liveCard;
    if (widget) setSwitch(live, d.shared[item]);
    else if (item === 'signup') setSwitch(live, d.signupOpen);
    else setSwitch(live, d.contact.is_open);
    live.disabled = widget && !admin;
    $('shAdminOnly').hidden = !(widget && !admin);

    /* Which lists the sign-up form offers. */
    $('shListsCard').hidden = item !== 'signup';
    if (item === 'signup') {
      var lists = (state.mail && state.mail.lists) || [];
      $('shLists').innerHTML = lists.length ? lists.map(function (l) {
        var on = !!d.lists[l.id];
        return '<button type="button" class="switch small" role="switch" aria-checked="' + on + '"' +
          ' data-list="' + esc(l.id) + '">' +
          '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
          '</span><span class="switch-knob"></span></span>' +
          '<span class="switch-label">' + esc(l.name) + '</span></button>';
      }).join('') : '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
    }

    /* Where contact messages go, and the reasons a visitor picks from. */
    $('shContactCard').hidden = item !== 'contact';
    if (item === 'contact') drawContact();

    /* The roadmap is drawn against a period. */
    $('shPeriodCard').hidden = item !== 'roadmap';
    if (item === 'roadmap') {
      $('shStart').value = d.period.start;
      $('shEnd').value = d.period.end;
      $('shStart').disabled = $('shEnd').disabled = !admin;
    }

    $('shCode').textContent = code();
    $('shLangWrap').hidden = !widget;
    /* Whose form — Thauma's or this ministry's — only means something for
       the two forms, so it sits with them. */
    $('shScope').hidden = !(state.mayOrg && isForm(item));

    var api = location.origin + '/embed/v1/' + slug() + '.json';
    $('shDev').hidden = !slug() || state.scope === 'organization';
    $('shApi').textContent = api;
    $('shGuide').href = location.origin + '/embed/v1/' + slug() + '-guide.md';
  }

  function drawContact() {
    var c = state.draft.contact;
    var to = $('shCtTo');
    if (document.activeElement !== to) to.value = c.deliver_to;
    var senders = (state.mail && state.mail.senders) || [];
    var opts = senders.slice();
    if (c.from_address && !opts.some(function (a) { return a.address === c.from_address; })) {
      opts.unshift({ address: c.from_address, missing: true });
    }
    $('shCtFrom').innerHTML = '<option value="">' + esc(tr('ml.fromPick')) + '</option>' +
      opts.map(function (a) {
        return '<option value="' + esc(a.address) + '"' + (a.address === c.from_address ? ' selected' : '') + '>' +
          esc(a.address + (a.missing ? '  (' + tr('ml.fromGone') + ')' : '')) + '</option>';
      }).join('');
    drawTopics();
  }

  function drawTopics() {
    var t = state.draft.contact.topics;
    $('shTopics').innerHTML = t.length ? t.map(function (x, i) {
      return '<div class="ct-topic" data-topic="' + i + '">' +
        '<input type="text" class="ct-topic-label" maxlength="80" value="' + esc(x.label) + '"' +
          ' placeholder="' + esc(tr('ml.ctTopicLabel')) + '">' +
        '<input type="email" class="ct-topic-to" maxlength="200" value="' + esc(x.deliver_to) + '"' +
          ' placeholder="' + esc(tr('ml.ctTopicTo')) + '">' +
        '<span class="ct-topic-move">' +
          '<button type="button" data-move-topic="' + i + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') +
            ' aria-label="' + esc(tr('ml.ctMoveUp')) + '">&#9650;</button>' +
          '<button type="button" data-move-topic="' + i + '" data-dir="1"' + (i === t.length - 1 ? ' disabled' : '') +
            ' aria-label="' + esc(tr('ml.ctMoveDown')) + '">&#9660;</button>' +
        '</span>' +
        '<button type="button" class="del" data-drop-topic="' + i + '" aria-label="' + esc(tr('common.delete')) + '">×</button>' +
      '</div>';
    }).join('') : '<p class="hint">' + esc(tr('ml.ctNoTopics')) + '</p>';
  }

  /* THE WORDS ON A FORM. The four widgets have none of their own. */
  var WORD_FIELDS = {
    signup: [['heading', 'ml.formHeading', 120, 'ml.formHeadingFallback'],
             ['blurb', 'ml.formBlurb', 240, null],
             ['button', 'ml.formButton', 40, 'ml.formPreviewFallback']],
    contact: [['heading', 'ml.ctHeading', 120, null], ['blurb', 'ml.ctBlurb', 240, null],
              ['button', 'ml.ctButton', 40, null], ['thanks', 'ml.ctThanks', 240, null]]
  };
  function wordsOf(item) {
    var d = state.draft;
    return item === 'signup' ? d.words : item === 'contact' ? d.contact : null;
  }
  function drawWords() {
    var item = state.item;
    var words = wordsOf(item);
    $('shWords').hidden = !words;
    if (!words) return;
    $('shWordFields').innerHTML = WORD_FIELDS[item].map(function (f) {
      return '<label class="fld"><span>' + esc(tr(f[1])) + '</span>' +
        '<input type="text" data-word="' + f[0] + '" maxlength="' + f[2] + '" value="' + esc(words[f[0]] || '') + '"' +
        (f[3] ? ' placeholder="' + esc(tr(f[3])) + '"' : '') + '></label>';
    }).join('');
  }

  function code() {
    var item = state.item;
    if (isForm(item)) {
      return '<div data-thauma-' + (item === 'signup' ? 'form' : 'contact') + '></div>\n' +
        '<script src="' + location.origin + '/embed/v1/' + who() + '/' +
        (item === 'signup' ? 'form' : 'contact') + '.js" defer></' + 'script>';
    }
    var a = ['data-thauma="' + esc(slug()) + '"'];
    if (item !== 'goal') a.push('data-widget="' + item + '"');
    if (state.lang && state.lang !== 'en') a.push('data-lang="' + esc(state.lang) + '"');
    return '<div ' + a.join(' ') + '></div>\n' +
      '<script src="' + location.origin + '/embed/v1/widget.js" async></' + 'script>';
  }

  function fillLangs() {
    var langs = (state.payload && state.payload.languages) || [];
    if (!langs.some(function (l) { return l.code === state.lang; })) {
      state.lang = langs.some(function (l) { return l.code === 'en'; }) ? 'en' : (langs[0] ? langs[0].code : 'en');
    }
    $('shLang').innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l.code) + '">' + esc((l.native_name || l.name) + ' (' + l.code + ')') + '</option>';
    }).join('');
    $('shLang').value = state.lang;
  }

  /* ---- the preview -----------------------------------------------------
     The real widget or form, in a frame sandboxed to scripts only (no
     same-origin, so it cannot reach this console's session), drawn from the
     screen rather than from what is saved — the preview leads Save. */
  var timer = null;
  function drawPreviewSoon() { clearTimeout(timer); timer = setTimeout(drawPreview, 180); }

  function drawPreview() {
    var frame = $('shFrame'), d = state.draft, item = state.item;
    if (!d || !item) return;
    fit(lastH);
    var mode = d.theme;
    var accent2 = d.accent2 || companion(d.accent);
    /* The background the mode assumes: "Match their page" follows the
       viewer's own light or dark setting. Dark is --bg (main.css). */
    var bg = mode === 'light' ? '#ffffff' : mode === 'dark' ? '#0b0f15' : 'Canvas';
    var head = '<!doctype html><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light dark">' +
      '<body style="margin:0;padding:20px;background:' + bg + '">';

    if (!isForm(item)) {
      if (!state.payload || !slug()) { frame.removeAttribute('srcdoc'); return; }
      var live = clone(state.payload);
      live.theme = Object.assign({}, live.theme, { accent: d.accent, accent2: accent2, mode: mode });
      live.timeline = { start: d.period.start || null, end: d.period.end || null };
      var attrs = 'data-thauma="' + esc(slug()) + '"' + (item !== 'goal' ? ' data-widget="' + item + '"' : '') +
        (state.lang ? ' data-lang="' + esc(state.lang) + '"' : '');
      frame.srcdoc = head +
        '<script>window.__thaumaPreview=' + JSON.stringify(live).replace(/</g, '\\u003c') + '</' + 'script>' +
        '<div ' + attrs + '></div>' +
        '<script src="' + location.origin + '/embed/v1/widget.js"></' + 'script>';
      return;
    }

    if (!who()) { frame.removeAttribute('srcdoc'); return; }
    var fa = ' data-accent="' + esc(d.accent) + '" data-theme="' + esc(mode) + '"' +
      (d.accent2 ? ' data-accent2="' + esc(d.accent2) + '"' : '');
    var words = wordsOf(item) || {};
    WORD_FIELDS[item].forEach(function (f) {
      var v = String(words[f[0]] || '').trim();
      if (v) fa += ' data-' + f[0] + '="' + esc(v) + '"';
      else if (f[0] === 'blurb') fa += ' data-blurb=""';
    });
    var tag = item === 'signup' ? 'form' : 'contact';
    frame.srcdoc = head + '<div data-thauma-' + tag + fa + '></div>' +
      '<script src="/embed/v1/' + encodeURIComponent(who()) + '/' + tag + '.js?t=' + Date.now() + '"></' + 'script>';
  }

  /* The frame takes the height its content reports. A form is scaled down to
     fit rather than scrolled, and says so — otherwise the smaller type reads
     as the type a visitor gets. */
  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    var frame = $('shFrame');
    if (!h || !frame || frame.contentWindow !== e.source) return;
    h = Math.max(180, Math.min(2400, h));
    fit(h);
  });

  var lastH = 300;
  function fit(h) {
    lastH = h;
    var frame = $('shFrame'), wrap = $('shScale'), stage = $('shStage');
    var scale;
    if (isForm(state.item)) {
      scale = Math.min(1, PREVIEW_MAX_H / h);
      wrap.style.inlineSize = (100 / scale) + '%';
    } else if (state.device === 'wide') {
      var w = stage.getBoundingClientRect().width || DESKTOP_W;
      scale = Math.min(1, w / DESKTOP_W);
      wrap.style.inlineSize = scale < 1 ? DESKTOP_W + 'px' : '100%';
    } else {
      scale = 1;
      wrap.style.inlineSize = '100%';
    }
    frame.style.blockSize = h + 'px';
    wrap.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    stage.style.blockSize = Math.ceil(h * scale) + 'px';
    $('shScaleNote').textContent = scale < 0.99 ? fill('emb.shownAt', { n: Math.round(scale * 100) }) : '';
  }
  window.addEventListener('resize', function () { fit(lastH); });

  function drawAll() {
    drawColors();
    drawList();
    drawSide();
    drawWords();
    drawBar();
    drawPreviewSoon();
  }
  /* After an edit: everything but the field being typed in. */
  function changed() {
    drawList();
    drawBar();
    drawPreviewSoon();
  }

  function choose(item) {
    if (items().indexOf(item) === -1) item = items()[0];
    state.item = item;
    try { history.replaceState(null, '', location.pathname + location.search + '#' + item); } catch (e) {}
    drawAll();
  }

  /* ---- loading --------------------------------------------------------- */

  async function get(url) {
    var res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.error || (tr('err.refused') + ' (' + res.status + ')'));
    return body;
  }

  async function load() {
    var q = state.scope === 'organization' ? '?scope=organization' : '';
    var r = await Promise.allSettled([get(SETTINGS), get(PREVIEW), get(MAILING + q)]);
    state.settings = r[0].status === 'fulfilled' ? r[0].value : null;
    state.payload = r[1].status === 'fulfilled' ? r[1].value : null;
    state.mail = r[2].status === 'fulfilled' ? r[2].value : null;
    if (!state.settings && !state.mail) {
      $('shList').innerHTML = '<p class="empty">' + esc((r[0].reason && r[0].reason.message) || tr('err.unreachable')) + '</p>';
      return;
    }
    if (window.StaffActing && state.settings) window.StaffActing(state.settings);
    /* The header's name and rows come from whichever answer carries them. */
    var id = state.settings && state.settings.you ? state.settings : state.mail;
    if (id && id.you && window.StaffIdentity) window.StaffIdentity(id.you, id.partner);

    /* Whose forms — offered only to accounts that can reach Thauma's. */
    var mayOrg = !!(state.mail && state.mail.may_send_as_organisation);
    state.mayOrg = mayOrg;
    if (mayOrg) {
      $('shScopeMine').textContent = (state.mail.partner && state.mail.partner.display_name) || '';
      [].forEach.call(document.querySelectorAll('#shScope [data-scope]'), function (b) {
        b.classList.toggle('is-on', b.dataset.scope === state.scope);
      });
    }

    state.saved = snapshot();
    state.draft = clone(state.saved);
    fillLangs();
    choose(state.item || (location.hash || '').slice(1) || items()[0]);
  }

  /* ---- saving ---------------------------------------------------------- */

  async function send(url, method, body) {
    var res = await fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || (tr('err.refused') + ' (' + res.status + ')'));
    return out;
  }

  async function save() {
    if (state.busy) return;
    var c = changes(), d = state.draft;
    var mailUrl = MAILING + (state.scope === 'organization' ? '?scope=organization' : '');
    var failed = [];
    state.busy = true;
    $('shSave').disabled = $('shDiscard').disabled = true;
    async function step(fn) { try { await fn(); } catch (e) { failed.push(e.message); } }

    if (c.embed) await step(function () {
      return send(SETTINGS, 'PATCH', { embed: { accent: d.accent, accent2: d.accent2, theme: d.theme, shared: d.shared } });
    });
    if (c.period) await step(function () {
      return send(SETTINGS, 'PATCH', { timeline: { start: d.period.start || null, end: d.period.end || null } });
    });
    if (c.signupOpen) await step(function () {
      return send(mailUrl, 'POST', { action: 'signup-form', open: d.signupOpen });
    });
    for (var i = 0; c.lists && i < c.lists.length; i++) {
      var l = ((state.mail && state.mail.lists) || []).filter(function (x) { return x.id === c.lists[i]; })[0];
      if (!l) continue;
      var w = l.id === d.wordsList && d.words ? d.words
        : { heading: l.form_heading || '', blurb: l.form_blurb || '', button: l.form_button || '' };
      /* The whole list, as the Mailing page saves it: this endpoint takes a
         list entire. */
      await step(function () {
        return send(mailUrl, 'POST', {
          id: l.id, name: l.name, description: l.description || '',
          from_name: l.from_name, from_email: l.from_email, reply_to: l.reply_to || '',
          is_open: !!d.lists[l.id],
          form_heading: w.heading.trim(), form_blurb: w.blurb.trim(), form_button: w.button.trim()
        });
      });
    }
    if (c.contact) await step(function () {
      var k = d.contact;
      return send(mailUrl, 'POST', {
        action: 'contact-form',
        deliver_to: k.deliver_to.trim(), from_address: k.from_address,
        heading: k.heading.trim(), blurb: k.blurb.trim(), button: k.button.trim(), thanks: k.thanks.trim(),
        is_open: k.is_open,
        /* A reason nobody named is not a reason yet. */
        topics: k.topics.filter(function (t) { return t.label.trim(); })
          .map(function (t) { return { label: t.label.trim(), deliver_to: t.deliver_to.trim() }; })
      });
    });

    state.busy = false;
    $('shSave').disabled = $('shDiscard').disabled = false;
    await load();
    if (failed.length) toast(fill('up.failed', { n: failed.length, first: failed[0] }), 'err');
    else toast(tr('toast.saved'), 'ok');
  }

  async function discard() {
    var n = count();
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: n === 1 ? tr('up.discardTitle1') : fill('up.discardTitle', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.draft = clone(state.saved);
    drawAll();
  }

  /* ---- wiring ---------------------------------------------------------- */

  $('shList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-item]');
    if (b) choose(b.dataset.item);
  });

  $('shAccentHex').addEventListener('input', function () {
    var v = this.value.trim();
    if (!HEX.test(v)) return;
    state.draft.accent = v.toUpperCase();
    $('shAccent').value = v;
    drawColors(); changed();
  });
  $('shAccent').addEventListener('input', function () {
    state.draft.accent = this.value.toUpperCase();
    drawColors(); changed();
  });
  /* Picking the second color IS turning off "matched automatically". */
  $('shAccent2').addEventListener('input', function () {
    state.draft.accent2 = this.value.toUpperCase();
    drawColors(); changed();
  });
  $('shPairAuto').addEventListener('click', function () {
    state.draft.accent2 = null;
    drawColors(); changed();
  });
  $('shTheme').addEventListener('change', function () {
    state.draft.theme = this.value;
    changed();
  });

  $('shLive').addEventListener('click', function () {
    var d = state.draft, item = state.item;
    if (WIDGETS.indexOf(item) !== -1) { if (!isAdmin()) return; d.shared[item] = !d.shared[item]; }
    else if (item === 'signup') d.signupOpen = !d.signupOpen;
    else d.contact.is_open = !d.contact.is_open;
    drawSide(); changed();
  });

  $('shLists').addEventListener('click', function (e) {
    var b = e.target.closest('[data-list]');
    if (!b) return;
    var d = state.draft;
    d.lists[b.dataset.list] = !d.lists[b.dataset.list];
    /* The words follow the first open list, as they do on the form. */
    var lists = (state.mail && state.mail.lists) || [];
    var wl = wordsList(lists, d.lists);
    if ((wl ? wl.id : null) !== d.wordsList) {
      d.wordsList = wl ? wl.id : null;
      d.words = wl ? { heading: wl.form_heading || '', blurb: wl.form_blurb || '', button: wl.form_button || '' } : null;
      drawWords();
    }
    drawSide(); changed();
  });

  $('shWordFields').addEventListener('input', function (e) {
    var f = e.target.closest('[data-word]');
    var words = wordsOf(state.item);
    if (!f || !words) return;
    words[f.dataset.word] = f.value;
    changed();
  });

  $('shCtTo').addEventListener('input', function () { state.draft.contact.deliver_to = this.value; changed(); });
  $('shCtFrom').addEventListener('change', function () { state.draft.contact.from_address = this.value; changed(); });
  $('shTopics').addEventListener('input', function (e) {
    var row = e.target.closest('[data-topic]');
    if (!row) return;
    var t = state.draft.contact.topics[+row.dataset.topic];
    t.label = row.querySelector('.ct-topic-label').value;
    t.deliver_to = row.querySelector('.ct-topic-to').value;
    changed();
  });
  $('shTopics').addEventListener('click', function (e) {
    var t = state.draft.contact.topics;
    var mv = e.target.closest('[data-move-topic]');
    if (mv) {
      var i = +mv.dataset.moveTopic, j = i + (+mv.dataset.dir);
      if (j < 0 || j >= t.length) return;
      var x = t[i]; t[i] = t[j]; t[j] = x;
      drawTopics(); changed(); return;
    }
    var dr = e.target.closest('[data-drop-topic]');
    if (dr) { t.splice(+dr.dataset.dropTopic, 1); drawTopics(); changed(); }
  });
  $('shAddTopic').addEventListener('click', function () {
    state.draft.contact.topics.push({ label: '', deliver_to: '' });
    drawTopics();
    var rows = document.querySelectorAll('#shTopics .ct-topic-label');
    if (rows.length) rows[rows.length - 1].focus();
  });

  ['shStart', 'shEnd'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      state.draft.period[id === 'shStart' ? 'start' : 'end'] = this.value;
      changed();
    });
  });

  $('shLang').addEventListener('change', function () {
    state.lang = this.value;
    $('shCode').textContent = code();
    drawPreviewSoon();
  });

  [].forEach.call(document.querySelectorAll('[data-width]'), function (b) {
    b.addEventListener('click', function () {
      state.device = b.dataset.width;
      [].forEach.call(document.querySelectorAll('[data-width]'), function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $('shStage').classList.toggle('is-narrow', state.device === 'narrow');
      drawPreviewSoon();
    });
  });

  function copy(text) {
    navigator.clipboard.writeText(text).then(function () { toast(tr('ml.copied'), 'ok'); })
      .catch(function () { toast(tr('ml.copyManual'), 'err'); });
  }
  $('shCopy').addEventListener('click', function () { copy(code()); });
  $('shCopyApi').addEventListener('click', function () { copy($('shApi').textContent); });

  $('shSave').addEventListener('click', save);
  $('shDiscard').addEventListener('click', discard);

  $('shScope').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-scope]');
    if (!b || b.dataset.scope === state.scope) return;
    if (count()) {
      var ok = await window.StaffConfirm({
        title: tr('up.discardTitle1'), confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
      });
      if (!ok) return;
    }
    state.scope = b.dataset.scope;
    try {
      history.replaceState(null, '', location.pathname +
        (state.scope === 'organization' ? '?scope=organization' : '') + location.hash);
    } catch (err) {}
    state.item = null;
    load();
  });

  window.addEventListener('beforeunload', function (e) {
    if (!count()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  load();
})();
