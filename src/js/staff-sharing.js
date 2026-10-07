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

  /* THE MINISTRY'S ALONE. Thauma's own forms moved to Website › Forms in the
     admin console (Chase, 2026-09-27: staff pages for staff work, admin for
     admin); an old link to them lands there. */
  if (/(\?|&)scope=organization\b/.test(location.search)) {
    location.replace('/admin/website/forms/');
    return;
  }

  var SETTINGS = '/api/staff-settings';
  var PREVIEW = '/api/staff-embed';
  var MAILING = '/api/staff-mailing';
  var HEX = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_ACCENT = '#1AE4FF';
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

  /* THE COLOR MATHS AND THE WHEEL live in color-pair.js, shared with the
     Site Creator's Design tab (one picker, not two). */
  var CP = window.ColorPair;
  var secondOf = CP.secondOf, TURNS = CP.TURNS;

  /* What an item wears: its own colors, or the ministry's; its own
     background, or the ministry's. */
  function lookOf(item) {
    var d = state.draft, l = d.looks[item] || {};
    var src = l.accent ? l : d;
    return { accent: src.accent, accent2: secondOf(src), mode: l.theme || d.theme };
  }

  /* ---- state ----------------------------------------------------------- */

  var state = {
    settings: null, payload: null, mail: null,
    item: null, device: 'wide', lang: null,
    saved: null, draft: null, busy: false,
    writing: null, beside: null, roadStyle: 'full',
    /* The picker's own hue, saturation and brightness per color, kept while
       it still makes the stored hex — a gray has no hue of its own, and
       recomputing one from the hex would throw the slider back to 0. */
    colorsOpen: false
  };

  function isAdmin() { return !!(state.settings && state.settings.you && state.settings.you.is_admin); }
  function slug() { return (state.settings && state.settings.partner && state.settings.partner.slug) ||
    (state.mail && state.mail.partner && state.mail.partner.slug) || ''; }
  function who() { return slug(); }
  /* The four widgets are a ministry's data: an account the settings refused
     has only the forms. */
  function items() {
    return !state.settings ? ['signup', 'contact'] : ITEMS;
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
    var c = m.contact || {};
    var fw = m.form_words || {};
    return {
      accent: HEX.test(e.accent || '') ? e.accent.toUpperCase() : DEFAULT_ACCENT,
      accent2: HEX.test(e.accent2 || '') ? e.accent2.toUpperCase() : null,
      turn: TURNS.indexOf(e.turn) !== -1 && e.turn !== -33 ? e.turn : null,
      theme: e.theme || 'auto',
      /* Each item's own look (0040): accent null = the ministry's colors,
         theme null = the ministry's background. */
      looks: ITEMS.reduce(function (out, k) {
        var l = (e.looks || {})[k] || {};
        var own = HEX.test(l.accent || '');
        out[k] = {
          accent: own ? l.accent.toUpperCase() : null,
          accent2: own && HEX.test(l.accent2 || '') ? l.accent2.toUpperCase() : null,
          turn: own && TURNS.indexOf(l.turn) !== -1 && l.turn !== -33 ? l.turn : null,
          theme: ['auto', 'light', 'dark'].indexOf(l.theme) !== -1 ? l.theme : null
        };
        return out;
      }, {}),
      shared: { roadmap: !!sh.roadmap, goal: !!sh.goal, prayer: !!sh.prayer, videos: !!sh.videos },
      period: { start: tl.start || '', end: tl.end || '' },
      signupOpen: m.embed ? !!m.embed.signup_form_open : true,
      lists: open,
      /* Each form's own words, per language (0039): { signup: { lang: {…} }, contact: … } */
      formWords: { signup: fw.signup || {}, contact: fw.contact || {} },
      contact: {
        deliver_to: c.deliver_to || '', from_address: c.from_address || '',
        is_open: !!c.is_open,
        topics: (m.topics || []).map(function (t) {
          return { label: t.label || '', deliver_to: t.deliver_to || '', labels: Object.assign({}, t.labels || {}) };
        })
      }
    };
  }

  /* What changed, as the parts Save sends separately. */
  function changes() {
    var a = state.saved, b = state.draft;
    if (!a || !b) return {};
    var out = {};
    if (a.accent !== b.accent || a.accent2 !== b.accent2 || a.turn !== b.turn || a.theme !== b.theme ||
        !same(a.shared, b.shared)) out.embed = true;
    var looks = ITEMS.filter(function (k) { return !same(a.looks[k], b.looks[k]); });
    if (looks.length) out.looks = looks;
    if (!same(a.period, b.period)) out.period = true;
    if (a.signupOpen !== b.signupOpen) out.signupOpen = true;
    var lists = Object.keys(b.lists).filter(function (id) { return a.lists[id] !== b.lists[id]; });
    if (lists.length) out.lists = lists;
    var words = ['signup', 'contact'].filter(function (f) { return !same(tidy(a.formWords[f]), tidy(b.formWords[f])); });
    if (words.length) out.words = words;
    if (!same(a.contact, b.contact)) out.contact = true;
    return out;
  }
  /* Words compared as what would be stored: a language with nothing in it is
     no language at all. */
  function tidy(byLang) {
    var out = {};
    Object.keys(byLang || {}).sort().forEach(function (l) {
      var w = byLang[l] || {}, keep = {};
      ['heading', 'blurb', 'button', 'thanks'].forEach(function (k) { if (String(w[k] || '').trim()) keep[k] = String(w[k]).trim(); });
      if (Object.keys(keep).length) out[l] = keep;
    });
    return out;
  }
  function count() {
    var c = changes();
    return (c.embed ? 1 : 0) + (c.looks ? c.looks.length : 0) + (c.period ? 1 : 0) + (c.signupOpen ? 1 : 0) +
      (c.lists ? c.lists.length : 0) + (c.contact ? 1 : 0) + (c.words ? c.words.length : 0);
  }

  /* Which of the six a change touches, for the dot on its row. */
  function itemDirty(item) {
    var a = state.saved, b = state.draft;
    if (!a || !b) return false;
    if (!same(a.looks[item], b.looks[item])) return true;
    if (WIDGETS.indexOf(item) !== -1) {
      return a.shared[item] !== b.shared[item] || (item === 'roadmap' && !same(a.period, b.period));
    }
    if (item === 'signup') return a.signupOpen !== b.signupOpen || !same(a.lists, b.lists) ||
      !same(tidy(a.formWords.signup), tidy(b.formWords.signup));
    return !same(a.contact, b.contact) || !same(tidy(a.formWords.contact), tidy(b.formWords.contact));
  }
  function itemLive(item, d) {
    if (WIDGETS.indexOf(item) !== -1) return !!d.shared[item];
    if (item === 'signup') {
      var any = Object.keys(d.lists).some(function (id) { return d.lists[id]; });
      return any && d.signupOpen;
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

  /* THE MINISTRY'S COLORS: two swatches, opening onto the wheel. */
  function drawColors() {
    var d = state.draft;
    var show = !!state.settings;
    $('shColors').hidden = !show;
    if (!show) return;
    var b = secondOf(d);
    $('shPair').innerHTML = '<span class="sh-sw" style="background:' + esc(d.accent) + '"></span>' +
      '<span class="sh-sw" style="background:' + esc(b) + '"></span>' +
      '<span class="sh-hexes">' + esc(d.accent + ' · ' + b) + '</span>';
    $('shColorsToggle').setAttribute('aria-expanded', state.colorsOpen ? 'true' : 'false');
    $('shColors').classList.toggle('is-open', state.colorsOpen);
    $('shMinistryPicker').hidden = !state.colorsOpen;
    if (state.colorsOpen) paintPicker($('shMinistryPicker'), 'ministry');
  }

  /* WHAT THE CHOSEN ITEM WEARS: the ministry's colors or its own, and its
     background. */
  function drawLook() {
    var d = state.draft, item = state.item;
    var show = !!state.settings && !!item;
    $('shLookCard').hidden = !show;
    if (!show) return;
    var l = d.looks[item], own = !!l.accent, admin = isAdmin();
    [].forEach.call(document.querySelectorAll('#shLookSeg [data-look]'), function (btn) {
      var on = (btn.dataset.look === 'own') === own;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.disabled = !admin;
    });
    $('shOwnPicker').hidden = !own;
    if (own) paintPicker($('shOwnPicker'), item);
    $('shTheme').value = l.theme || d.theme;
    $('shTheme').disabled = !admin;
  }

  /* ---- the wheel (color-pair.js) ------------------------------------
     One picker for the ministry's colors and for an item's own: `key` is
     'ministry' or the item. */
  function pickTarget(key) { return key === 'ministry' ? state.draft : state.draft.looks[key]; }
  function paintPicker(box, key) { CP.paint(box, key, pickTarget(key), isAdmin()); }
  /* A change from the picker: the item's own look or the ministry's. */
  function picked(key) {
    drawColors();
    if (key !== 'ministry') paintPicker($('shOwnPicker'), key);
    changed();
  }
  function wirePicker(box) { CP.wire(box, { target: pickTarget, editable: isAdmin, changed: picked }); }

  function drawSide() {
    var d = state.draft, item = state.item;
    var widget = WIDGETS.indexOf(item) !== -1;
    var admin = isAdmin();

    /* LIVE. A widget's is an administrator's decision; the sign-up form's is
       the ministry's own. */
    var live = $('shLive');
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
    $('shRoadStyle').hidden = item !== 'roadmap';
    [].forEach.call(document.querySelectorAll('#shRoadStyle [data-road]'), function (b) {
      var on = b.dataset.road === state.roadStyle;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('shLangWrap').hidden = !widget;

    var api = location.origin + '/embed/v1/' + slug() + '.json';
    $('shDev').hidden = !slug();
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

  /* THE REASONS IN EVERY LANGUAGE (0041), written in the language the
     form's words are being written in — "Writing X beside Y" below the
     preview — with the other language small above each. `label` is the name
     in the ministry's own language and the fallback; `labels` the rest. */
  function topicHome() {
    return (state.settings && state.settings.partner && state.settings.partner.default_lang) || 'en';
  }
  function topicName(x, lang) { return lang === topicHome() ? x.label : ((x.labels || {})[lang] || ''); }
  /* A topic's own key while the page is open (topics carry no id), so a
     dragged one keeps focus through the redraw (StaffSort, staff.js). */
  var topicKeys = new WeakMap(), topicN = 0;
  function topicKey(x) { if (!topicKeys.has(x)) topicKeys.set(x, 't' + (++topicN)); return topicKeys.get(x); }

  function drawTopics() {
    var t = state.draft.contact.topics;
    var writing = state.writing || topicHome(), beside = state.beside;
    var many = formLangs().length > 1;
    var named = formLangs().filter(function (l) { return l.code === writing; })[0];
    $('shTopicsLang').textContent = many && named ? ' · ' + (named.native_name || named.name || writing) : '';
    $('shTopics').innerHTML = t.length ? t.map(function (x, i) {
      var ref = beside && beside !== writing ? topicName(x, beside) : '';
      return '<div class="ct-topic" data-topic="' + i + '" data-k="' + topicKey(x) + '">' +
        (window.StaffSort ? StaffSort.grip(tr('ws.dragMove')) : '') +
        '<span class="ct-topic-name">' +
          (ref ? '<small class="ms-ref" lang="' + esc(beside) + '">' + esc(ref) + '</small>' : '') +
          '<input type="text" class="ct-topic-label" maxlength="80" lang="' + esc(writing) + '"' +
            ' value="' + esc(topicName(x, writing)) + '"' +
            ' placeholder="' + esc(writing === topicHome() ? tr('ml.ctTopicLabel') : x.label) + '">' +
        '</span>' +
        '<input type="email" class="ct-topic-to" maxlength="200" value="' + esc(x.deliver_to) + '"' +
          ' placeholder="' + esc(tr('ml.ctTopicTo')) + '">' +

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
  /* "WRITING X BESIDE Y", as on Updates and Website › Pages: one language's
     words at a time, the other language small above each field. Languages
     are the ministry's own; a language left empty shows the form's
     translated defaults. */
  function formLangs() {
    var langs = ((state.settings && state.settings.languages) || []).filter(function (l) { return l.is_enabled; });
    return langs.length ? langs : [{ code: 'en', name: 'English' }];
  }
  function wordsIn(item, lang) {
    var byLang = state.draft.formWords[item];
    return byLang[lang] || (byLang[lang] = { heading: '', blurb: '', button: '', thanks: '' });
  }
  function drawWords() {
    var item = state.item;
    $('shWords').hidden = !isForm(item);
    if (!isForm(item)) return;
    var langs = formLangs(), codes = langs.map(function (l) { return l.code; });
    if (codes.indexOf(state.writing) === -1) state.writing = codes.indexOf('en') !== -1 ? 'en' : codes[0];
    var others = langs.filter(function (l) { return l.code !== state.writing; });
    if (!others.some(function (l) { return l.code === state.beside; })) state.beside = others.length ? others[0].code : null;
    var named = function (l) { return esc(l.native_name || l.name || l.code); };
    $('shWriting').innerHTML = langs.map(function (l) {
      var has = Object.keys(tidy(state.draft.formWords[item])).indexOf(l.code) !== -1;
      return '<option value="' + esc(l.code) + '">' + named(l) + (has ? '' : ' · ' + esc(tr('sh.defaults'))) + '</option>';
    }).join('');
    $('shWriting').value = state.writing;
    $('shBesideWrap').hidden = !others.length;
    $('shBeside').innerHTML = others.map(function (l) { return '<option value="' + esc(l.code) + '">' + named(l) + '</option>'; }).join('');
    $('shBeside').value = state.beside || '';
    var mine = wordsIn(item, state.writing);
    var ref = state.beside ? (state.draft.formWords[item][state.beside] || {}) : {};
    $('shWordFields').innerHTML = WORD_FIELDS[item].map(function (f) {
      return '<label class="fld"><span>' + esc(tr(f[1])) + '</span>' +
        (ref[f[0]] ? '<small class="ms-ref" lang="' + esc(state.beside) + '">' + esc(ref[f[0]]) + '</small>' : '') +
        '<input type="text" data-word="' + f[0] + '" maxlength="' + f[2] + '" value="' + esc(mine[f[0]] || '') + '"' +
        ' lang="' + esc(state.writing) + '"' + (f[3] ? ' placeholder="' + esc(tr(f[3])) + '"' : '') + '></label>';
    }).join('');
    /* The contact form's reasons are written in the same language. */
    if (item === 'contact') drawTopics();
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
    if (item === 'roadmap' && state.roadStyle === 'condensed') a.push('data-style="condensed"');
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
    var look = lookOf(item), mode = look.mode;
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
      live.theme = look;
      delete live.looks;
      live.timeline = { start: d.period.start || null, end: d.period.end || null };
      var attrs = 'data-thauma="' + esc(slug()) + '"' + (item !== 'goal' ? ' data-widget="' + item + '"' : '') +
        (item === 'roadmap' && state.roadStyle === 'condensed' ? ' data-style="condensed"' : '') +
        (state.lang ? ' data-lang="' + esc(state.lang) + '"' : '');
      frame.srcdoc = head +
        '<script>window.__thaumaPreview=' + JSON.stringify(live).replace(/</g, '\\u003c') + '</' + 'script>' +
        '<div ' + attrs + '></div>' +
        '<script src="' + location.origin + '/embed/v1/widget.js"></' + 'script>';
      return;
    }

    if (!who()) { frame.removeAttribute('srcdoc'); return; }
    var fa = ' data-accent="' + esc(look.accent) + '" data-accent2="' + esc(look.accent2) + '"' +
      ' data-theme="' + esc(mode) + '"';
    /* In the language being written, with its words as typed. */
    if (state.writing) fa += ' data-lang="' + esc(state.writing) + '"';
    var words = state.draft.formWords[item][state.writing] || {};
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
    drawLook();
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
    var r = await Promise.allSettled([get(SETTINGS), get(PREVIEW), get(MAILING)]);
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
    /* Saved by someone else since this page loaded it (workers/src/lib/
       fresh.js): ask. Saving mine sends it again with overwrite; keeping
       theirs skips it, and the reload after saving shows theirs. */
    if (res.status === 409 && out.changed && body) {
      if (await window.StaffChanged(out)) return send(url, method, Object.assign({}, body, { overwrite: true }));
      return {};
    }
    if (!res.ok) throw new Error(out.error || (tr('err.refused') + ' (' + res.status + ')'));
    return out;
  }

  async function save() {
    if (state.busy) return;
    var c = changes(), d = state.draft;
    var mailUrl = MAILING;
    var failed = [];
    state.busy = true;
    $('shSave').disabled = $('shDiscard').disabled = true;
    async function step(fn) { try { await fn(); } catch (e) { failed.push(e.message); } }

    if (c.embed || c.looks) await step(function () {
      var looks = {};
      (c.looks || []).forEach(function (k) {
        var l = d.looks[k];
        looks[k] = l.accent || l.theme ? l : null;
      });
      return send(SETTINGS, 'PATCH', { embed: { accent: d.accent, accent2: d.accent2, turn: d.turn,
        theme: d.theme, shared: d.shared, looks: looks },
        /* as this page was handed them, so a change made elsewhere since is
           caught rather than switched back (workers/src/lib/fresh.js) */
        base: (state.settings && state.settings.embed) || undefined });
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
      /* The list's own old word columns ride along unchanged; the form's
         words live in form_words now. */
      var w = { heading: l.form_heading || '', blurb: l.form_blurb || '', button: l.form_button || '' };
      /* The whole list, as the Mail page saves it: this endpoint takes a
         list entire. */
      await step(function () {
        return send(mailUrl, 'POST', {
          id: l.id, updated_at: l.updated_at, name: l.name, description: l.description || '',
          from_name: l.from_name, from_email: l.from_email, reply_to: l.reply_to || '',
          is_open: !!d.lists[l.id],
          /* EVERY FIELD, because a field left out is saved as off: this once
             sent no archive_public, so switching a list here also stopped
             its past issues being readable on the web. */
          archive_public: !!l.archive_public, form_thanks_url: l.form_thanks_url || '',
          form_heading: w.heading.trim(), form_blurb: w.blurb.trim(), form_button: w.button.trim()
        });
      });
    }
    for (var f = 0; c.words && f < c.words.length; f++) {
      var form = c.words[f];
      await step(function () {
        return send(mailUrl, 'POST', { action: 'form-words', form: form, words: tidy(d.formWords[form]) });
      });
    }
    if (c.contact) await step(function () {
      var k = d.contact, old = (state.mail && state.mail.contact) || {};
      return send(mailUrl, 'POST', {
        action: 'contact-form', updated_at: old.updated_at,
        deliver_to: k.deliver_to.trim(), from_address: k.from_address,
        /* The old single-language word columns ride along unchanged. */
        heading: old.heading || '', blurb: old.blurb || '', button: old.button || '', thanks: old.thanks || '',
        is_open: k.is_open,
        /* A reason nobody named is not a reason yet. */
        topics: k.topics.filter(function (t) { return t.label.trim(); })
          .map(function (t) { return { label: t.label.trim(), deliver_to: t.deliver_to.trim(), labels: t.labels }; })
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

  wirePicker($('shMinistryPicker'));
  wirePicker($('shOwnPicker'));
  $('shColorsToggle').addEventListener('click', function () {
    state.colorsOpen = !state.colorsOpen;
    drawColors();
  });
  /* Its own colors start from the ministry's, so the switch changes nothing
     until something is moved. */
  $('shLookSeg').addEventListener('click', function (e) {
    var b = e.target.closest('[data-look]');
    if (!b || !isAdmin()) return;
    var d = state.draft, l = d.looks[state.item];
    if (b.dataset.look === 'own') {
      if (l.accent) return;
      l.accent = d.accent; l.accent2 = d.accent2; l.turn = d.turn;
      CP.alias('ministry', state.item);
    } else {
      l.accent = l.accent2 = l.turn = null;
    }
    drawLook(); changed();
  });
  $('shTheme').addEventListener('change', function () {
    var d = state.draft;
    d.looks[state.item].theme = this.value === d.theme ? null : this.value;
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
    drawSide(); changed();
  });

  $('shWordFields').addEventListener('input', function (e) {
    var f = e.target.closest('[data-word]');
    if (!f || !isForm(state.item)) return;
    wordsIn(state.item, state.writing)[f.dataset.word] = f.value;
    changed();
  });
  /* Switching either language: the words typed are already in the draft. */
  $('shWriting').addEventListener('change', function () { state.writing = this.value; drawWords(); drawPreviewSoon(); });
  $('shBeside').addEventListener('change', function () { state.beside = this.value; drawWords(); });

  $('shCtTo').addEventListener('input', function () { state.draft.contact.deliver_to = this.value; changed(); });
  $('shCtFrom').addEventListener('change', function () { state.draft.contact.from_address = this.value; changed(); });
  $('shTopics').addEventListener('input', function (e) {
    var row = e.target.closest('[data-topic]');
    if (!row) return;
    var t = state.draft.contact.topics[+row.dataset.topic];
    var v = row.querySelector('.ct-topic-label').value, writing = state.writing || topicHome();
    if (writing === topicHome()) t.label = v;
    else {
      t.labels = t.labels || {};
      /* An emptied translation is no translation: the reason shows its
         first-written name there again. */
      if (v.trim()) t.labels[writing] = v; else delete t.labels[writing];
    }
    t.deliver_to = row.querySelector('.ct-topic-to').value;
    changed();
  });
  /* topics drag into order, or move by the arrow keys on their grip */
  if (window.StaffSort) StaffSort($('shTopics'), { items: '.ct-topic', handle: '.ct-topic .sort-grip',
    key: function (it) { return it.dataset.k; },
    drop: function (l, from, to) { var t = state.draft.contact.topics; t.splice(to, 0, t.splice(from, 1)[0]); drawTopics(); changed(); } });
  $('shTopics').addEventListener('click', function (e) {
    var t = state.draft.contact.topics;
    var dr = e.target.closest('[data-drop-topic]');
    if (dr) { t.splice(+dr.dataset.dropTopic, 1); drawTopics(); changed(); }
  });
  $('shAddTopic').addEventListener('click', function () {
    state.draft.contact.topics.push({ label: '', deliver_to: '', labels: {} });
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

  $('shRoadStyle').addEventListener('click', function (e) {
    var b = e.target.closest('[data-road]');
    if (!b || b.dataset.road === state.roadStyle) return;
    state.roadStyle = b.dataset.road;
    drawSide();
    drawPreviewSoon();
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

  window.addEventListener('beforeunload', function (e) {
    if (!count()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  load();
})();
