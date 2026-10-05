/* ============================================================
   color-pair.js — the ministry's two colors, picked on a wheel
   ============================================================
   One picker for every place a pair of colors is chosen: the Sharing page
   (the ministry's colors, and an embed's own) and the Site Creator's Design
   tab. Chase, 2026-10-04: the colors should "stay in sync … using the same
   color selection design in the Site Creator as we made for the Sharing
   page" — so it is one file, not two copies that drift.

     ColorPair.paint(box, key, pair, editable)   draw / refresh
     ColorPair.wire(box, { target, editable, changed })   once per box
     ColorPair.secondOf(pair)   the second color, chosen or turned
     ColorPair.alias(from, to)   a copied pair keeps the sliders' place

   A pair is { accent, accent2|null, turn|null }. The words come from the
   console's i18n (sh.* keys).
   ============================================================ */
(function () {
  'use strict';
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var HEX = /^#[0-9A-Fa-f]{6}$/;
  var HSV = {};

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
  /* ---- the wheel -------------------------------------------------------
     Mockup option C: two points on one wheel. The first color by hue,
     saturation and brightness; the second -33, 120 or 180 degrees round
     from it, or Free with its own three. Dragging a point on the ring sets
     its hue. Below, the pair as text and as a button on a light and a dark
     page, marked where the embeds will nudge the text to keep it readable.
     One picker for the ministry's colors and for an item's own: `key` is
     'ministry' or the item. */
  var CHANNELS = [['h', 'sh.hue', 359, '°'], ['s', 'sh.sat', 100, '%'], ['v', 'sh.bright', 100, '%']];

  function hsvFor(id, hex) {
    var c = HSV[id];
    if (c && hsvToHex(c) === String(hex).toUpperCase()) return c;
    return (HSV[id] = hexToHsv(hex));
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

  function paint(box, key, o, admin) {
    if (!o || !o.accent) return;
    var free = !!o.accent2;
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

  /* opts: target(key) → the {accent, accent2, turn} being edited,
     editable() → may this person change it, changed(key) → after a change. */
  function wire(box, opts) {
    function key() { return box.dataset.key; }
    var pickTarget = opts.target, isAdmin = opts.editable, picked = opts.changed;
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


  /* A copy of one pair starts where that pair's sliders are (a gray keeps
     its hue). */
  function alias(from, to) { ['1', '2'].forEach(function (n) { if (HSV[from + n]) HSV[to + n] = HSV[from + n]; }); }

  window.ColorPair = { paint: paint, wire: wire, alias: alias, secondOf: secondOf, companion: companion,
    readable: readable, onColor: onColor, TURNS: TURNS, PAGES: PAGES };
})();
