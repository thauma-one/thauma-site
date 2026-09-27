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

  /* ---- the color maths ------------------------------------------------
     The Worker's (embed-colour.js), so what the picker shows is what the
     embeds draw without a round trip: the second color sits `turn` degrees
     round the wheel (-33 unless chosen), and colored text is nudged just far
     enough to read on each page. The picker itself speaks hue, saturation
     and brightness (Chase), so HSB is converted here and never stored. */
  var TURNS = [-33, 120, 180];
  var PAGES = { light: '#ffffff', dark: '#15151c' };
  function rgbOf(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function hueOf(r, g, b, max, d) {
    if (d === 0) return 0;
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return h * 60;
  }
  function hexOf(r, g, b) {
    function to(v) { var q = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return q.length < 2 ? '0' + q : q; }
    return ('#' + to(r) + to(g) + to(b)).toUpperCase();
  }
  function sextant(h, c, x) {
    h = ((h % 360) + 360) % 360;
    if (h < 60) return [c, x, 0];
    if (h < 120) return [x, c, 0];
    if (h < 180) return [0, c, x];
    if (h < 240) return [0, x, c];
    if (h < 300) return [x, 0, c];
    return [c, 0, x];
  }
  function hexToHsl(hex) {
    var c = rgbOf(hex);
    if (!c) return null;
    var max = Math.max(c[0], c[1], c[2]), min = Math.min(c[0], c[1], c[2]);
    var l = (max + min) / 2, d = max - min;
    var sat = d === 0 ? 0 : l > 0.5 ? d / (2 - max - min) : d / (max + min);
    return { h: hueOf(c[0], c[1], c[2], max, d), s: sat, l: l };
  }
  function hslToHex(o) {
    var c = (1 - Math.abs(2 * o.l - 1)) * o.s;
    var t = sextant(o.h, c, c * (1 - Math.abs(((((o.h % 360) + 360) % 360 / 60) % 2) - 1)));
    var m = o.l - c / 2;
    return hexOf(t[0] + m, t[1] + m, t[2] + m);
  }
  function hexToHsv(hex) {
    var c = rgbOf(hex);
    if (!c) return { h: 0, s: 0, v: 0 };
    var max = Math.max(c[0], c[1], c[2]), d = max - Math.min(c[0], c[1], c[2]);
    return { h: hueOf(c[0], c[1], c[2], max, d), s: max ? d / max : 0, v: max };
  }
  function hsvToHex(o) {
    var c = o.v * o.s;
    var t = sextant(o.h, c, c * (1 - Math.abs(((((o.h % 360) + 360) % 360 / 60) % 2) - 1)));
    var m = o.v - c;
    return hexOf(t[0] + m, t[1] + m, t[2] + m);
  }
  function companion(hex, turn) {
    var o = hexToHsl(hex);
    if (!o) return hex;
    if (o.s < 0.12) {
      var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);
      return hslToHex({ h: o.h, s: o.s, l: l });
    }
    return hslToHex({ h: o.h + (typeof turn === 'number' ? turn : -33),
      s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });
  }
  function luminance(hex) {
    var c = rgbOf(hex) || [0, 0, 0];
    var f = function (v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function contrast(a, b) {
    var x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function readable(hex, bg) {
    var o = hexToHsl(hex);
    if (!o) return hex;
    var up = luminance(bg) < 0.5, c = hslToHex(o), i = 0;
    while (contrast(c, bg) < 3 && i < 100) {
      o.l = Math.max(0, Math.min(1, o.l + (up ? 0.01 : -0.01)));
      c = hslToHex(o);
      i++;
    }
    return c;
  }
  function onColor(hex) { return contrast('#ffffff', hex) >= contrast('#12121a', hex) ? '#ffffff' : '#12121a'; }

  /* The second color of a pair: chosen (Free), or `turn` degrees round. */
  function secondOf(o) { return o.accent2 || companion(o.accent, o.turn == null ? -33 : o.turn); }
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
    hsv: {}, colorsOpen: false
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

  /* ---- the wheel -------------------------------------------------------
     Mockup option C: two points on one wheel. The first color by hue,
     saturation and brightness; the second -33, 120 or 180 degrees round
     from it, or Free with its own three. Dragging a point on the ring sets
     its hue. Below, the pair as text and as a button on a light and a dark
     page, marked where the embeds will nudge the text to keep it readable.
     One picker for the ministry's colors and for an item's own: `key` is
     'ministry' or the item. */
  var CHANNELS = [['h', 'sh.hue', 359, '°'], ['s', 'sh.sat', 100, '%'], ['v', 'sh.bright', 100, '%']];

  function pickTarget(key) { return key === 'ministry' ? state.draft : state.draft.looks[key]; }
  function hsvFor(id, hex) {
    var c = state.hsv[id];
    if (c && hsvToHex(c) === String(hex).toUpperCase()) return c;
    return (state.hsv[id] = hexToHsv(hex));
  }

  function pickerHtml(o, admin) {
    var free = !!o.accent2, off = admin ? '' : ' disabled';
    function rows(n) {
      return CHANNELS.map(function (c) {
        return '<label class="pk-row"><span>' + esc(tr(c[1])) + '</span>' +
          '<input type="range" class="pk-rng" min="0" max="' + c[2] + '" data-ch="' + n + c[0] + '"' + off + '>' +
          '<span class="pk-num" data-num="' + n + c[0] + '"></span></label>';
      }).join('');
    }
    function hex(n, label) {
      return '<input type="text" class="emb-hex" maxlength="7" spellcheck="false" data-hex="' + n + '"' +
        ' aria-label="' + esc(label) + '"' + off + '>';
    }
    return '<div class="pk-wheel' + (admin ? '' : ' is-off') + '" data-wheel>' +
        '<div class="pk-ring" data-ring></div>' +
        '<div class="pk-hole"><span data-hexout="1"></span><span data-hexout="2"></span></div>' +
        '<span class="pk-dot pk-dot2' + (free ? '' : ' is-fixed') + '" data-dot="2"></span>' +
        '<span class="pk-dot pk-dot1" data-dot="1"></span>' +
      '</div>' +
      '<div class="pk-controls">' +
        '<div class="pk-group"><div class="pk-head"><span class="sh-lbl">' + esc(tr('sh.first')) + '</span>' +
          hex(1, tr('sh.first')) + '</div>' + rows(1) + '</div>' +
        '<div class="pk-group"><div class="pk-head"><span class="sh-lbl">' + esc(tr('sh.second')) + '</span>' +
          (free ? hex(2, tr('sh.second')) : '') + '</div>' +
          '<div class="pk-turns" role="radiogroup" aria-label="' + esc(tr('sh.second')) + '">' +
            TURNS.map(function (t) {
              return '<button type="button" class="pk-turn" role="radio" data-turn="' + t + '"' + off + '>' +
                (t < 0 ? '\u2212' : '') + Math.abs(t) + '°</button>';
            }).join('') +
            '<button type="button" class="pk-turn" role="radio" data-turn="free"' + off + '>' + esc(tr('sh.free')) + '</button>' +
          '</div>' +
          (free ? rows(2) : '') +
        '</div>' +
        '<div class="pk-samples">' + ['light', 'dark'].map(function (k) {
          return '<div class="pk-sample is-' + k + '" data-sample="' + k + '">' +
            '<span class="pk-t" data-st="1">Aa</span><span class="pk-t" data-st="2">Aa</span>' +
            '<span class="pk-btn" data-sb>Aa</span>' +
            '<span class="pk-adj" data-adj hidden>' + esc(tr('sh.adjusted')) + '</span></div>';
        }).join('') + '</div>' +
      '</div>';
  }

  /* A slider's track: what that one channel does to this color. */
  function track(c, o) {
    if (c === 'h') {
      var stops = [];
      for (var deg = 0; deg <= 360; deg += 30) stops.push(hsvToHex({ h: deg, s: Math.max(0.45, o.s), v: Math.max(0.6, o.v) }));
      return 'linear-gradient(90deg,' + stops.join(',') + ')';
    }
    var from = c === 's' ? { h: o.h, s: 0, v: o.v } : { h: o.h, s: o.s, v: 0 };
    var to = c === 's' ? { h: o.h, s: 1, v: o.v } : { h: o.h, s: o.s, v: 1 };
    return 'linear-gradient(90deg,' + hsvToHex(from) + ',' + hsvToHex(to) + ')';
  }

  function paintPicker(box, key) {
    var o = pickTarget(key);
    if (!o || !o.accent) return;
    var admin = isAdmin(), free = !!o.accent2;
    var sig = key + '|' + free + '|' + admin;
    if (box.dataset.sig !== sig) { box.innerHTML = pickerHtml(o, admin); box.dataset.sig = sig; box.dataset.key = key; }
    var a = o.accent, b = secondOf(o);
    var hsv = { 1: hsvFor(key + '1', a), 2: hsvFor(key + '2', b) };
    [].forEach.call(box.querySelectorAll('[data-ch]'), function (el) {
      var n = el.dataset.ch[0], c = el.dataset.ch[1], o3 = hsv[n];
      var val = Math.round(c === 'h' ? o3.h : o3[c] * 100);
      if (document.activeElement !== el) el.value = val;
      el.style.setProperty('--track', track(c, o3));
      el.style.setProperty('--knob', hsvToHex(o3));
      box.querySelector('[data-num="' + el.dataset.ch + '"]').textContent = val + (c === 'h' ? '°' : '%');
    });
    [].forEach.call(box.querySelectorAll('[data-hex]'), function (el) {
      if (document.activeElement !== el) el.value = el.dataset.hex === '1' ? a : b;
    });
    box.querySelector('[data-hexout="1"]').textContent = a;
    box.querySelector('[data-hexout="2"]').textContent = b;
    /* The ring in the first color's own strength, so it shows the colors a
       turn of the hue would give — kept vivid enough to steer by. */
    var rs = Math.max(0.45, hsv[1].s), rv = Math.max(0.6, hsv[1].v), stops = [];
    for (var deg = 0; deg <= 360; deg += 30) stops.push(hsvToHex({ h: deg, s: rs, v: rv }) + ' ' + deg + 'deg');
    box.querySelector('[data-ring]').style.background = 'conic-gradient(from 90deg,' + stops.join(',') + ')';
    [[1, a, hsv[1].h], [2, b, hsv[2].h]].forEach(function (p) {
      var dot = box.querySelector('[data-dot="' + p[0] + '"]'), r = p[2] * Math.PI / 180;
      dot.style.left = (50 + 41 * Math.cos(r)) + '%';
      dot.style.top = (50 + 41 * Math.sin(r)) + '%';
      dot.style.background = p[1];
    });
    var turn = free ? 'free' : String(o.turn == null ? -33 : o.turn);
    [].forEach.call(box.querySelectorAll('[data-turn]'), function (el) {
      var on = el.dataset.turn === turn;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    [].forEach.call(box.querySelectorAll('[data-sample]'), function (el) {
      var bg = PAGES[el.dataset.sample], ta = readable(a, bg), tb = readable(b, bg);
      el.querySelector('[data-st="1"]').style.color = ta;
      el.querySelector('[data-st="2"]').style.color = tb;
      var btn = el.querySelector('[data-sb]');
      btn.style.background = a;
      btn.style.color = onColor(a);
      el.querySelector('[data-adj]').hidden = ta === a.toUpperCase() && tb === b.toUpperCase();
    });
  }

  /* A change from the picker: the item's own look or the ministry's. */
  function picked(key) {
    drawColors();
    if (key !== 'ministry') paintPicker($('shOwnPicker'), key);
    changed();
  }

  function wirePicker(box) {
    function key() { return box.dataset.key; }
    box.addEventListener('input', function (e) {
      var o = pickTarget(key());
      if (!o || !isAdmin()) return;
      var ch = e.target.dataset && e.target.dataset.ch;
      if (ch) {
        var n = ch[0], id = key() + n;
        var hsv = hsvFor(id, n === '1' ? o.accent : secondOf(o));
        hsv[ch[1]] = ch[1] === 'h' ? +e.target.value : +e.target.value / 100;
        var hex = hsvToHex(hsv);
        if (n === '1') o.accent = hex; else o.accent2 = hex;
        picked(key());
        return;
      }
      var hx = e.target.dataset && e.target.dataset.hex;
      if (hx) {
        var v = e.target.value.trim();
        if (v && v[0] !== '#') v = '#' + v;
        if (!HEX.test(v)) return;
        if (hx === '1') o.accent = v.toUpperCase(); else o.accent2 = v.toUpperCase();
        picked(key());
      }
    });
    box.addEventListener('click', function (e) {
      var t = e.target.closest('[data-turn]');
      var o = pickTarget(key());
      if (!t || !o || !isAdmin()) return;
      if (t.dataset.turn === 'free') {
        if (!o.accent2) o.accent2 = secondOf(o);
      } else {
        o.accent2 = null;
        o.turn = +t.dataset.turn === -33 ? null : +t.dataset.turn;
      }
      picked(key());
    });
    /* Dragging round the ring: the nearer point (the second only when it is
       Free) follows the pointer's angle. */
    box.addEventListener('pointerdown', function (e) {
      var wheel = e.target.closest('[data-wheel]');
      var o = pickTarget(key());
      if (!wheel || !o || !isAdmin()) return;
      e.preventDefault();
      var which = null;
      function angle(ev) {
        var r = wheel.getBoundingClientRect();
        var deg = Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180 / Math.PI;
        return (deg + 360) % 360;
      }
      function move(ev) {
        var h = angle(ev);
        if (!which) {
          var gap = function (x) { var g = Math.abs(x - h) % 360; return g > 180 ? 360 - g : g; };
          which = o.accent2 && gap(hsvFor(key() + '2', o.accent2).h) < gap(hsvFor(key() + '1', o.accent).h) ? '2' : '1';
        }
        var hsv = hsvFor(key() + which, which === '1' ? o.accent : o.accent2);
        hsv.h = Math.round(h) % 360;
        if (which === '1') o.accent = hsvToHex(hsv); else o.accent2 = hsvToHex(hsv);
        picked(key());
      }
      move(e);
      try { wheel.setPointerCapture(e.pointerId); } catch (err) {}
      function up() {
        wheel.removeEventListener('pointermove', move);
        wheel.removeEventListener('pointerup', up);
        wheel.removeEventListener('pointercancel', up);
      }
      wheel.addEventListener('pointermove', move);
      wheel.addEventListener('pointerup', up);
      wheel.addEventListener('pointercancel', up);
    });
  }

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
  function drawTopics() {
    var t = state.draft.contact.topics;
    var writing = state.writing || topicHome(), beside = state.beside;
    var many = formLangs().length > 1;
    var named = formLangs().filter(function (l) { return l.code === writing; })[0];
    $('shTopicsLang').textContent = many && named ? ' · ' + (named.native_name || named.name || writing) : '';
    $('shTopics').innerHTML = t.length ? t.map(function (x, i) {
      var ref = beside && beside !== writing ? topicName(x, beside) : '';
      return '<div class="ct-topic" data-topic="' + i + '">' +
        '<span class="ct-topic-name">' +
          (ref ? '<small class="ms-ref" lang="' + esc(beside) + '">' + esc(ref) + '</small>' : '') +
          '<input type="text" class="ct-topic-label" maxlength="80" lang="' + esc(writing) + '"' +
            ' value="' + esc(topicName(x, writing)) + '"' +
            ' placeholder="' + esc(writing === topicHome() ? tr('ml.ctTopicLabel') : x.label) + '">' +
        '</span>' +
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
        theme: d.theme, shared: d.shared, looks: looks } });
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
          id: l.id, name: l.name, description: l.description || '',
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
        action: 'contact-form',
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
      state.hsv[state.item + '1'] = state.hsv.ministry1;
      state.hsv[state.item + '2'] = state.hsv.ministry2;
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
