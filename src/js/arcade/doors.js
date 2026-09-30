/* =====================================================================
   doors.js — the arcade's ways in (ARCADE-SPEC.md §1)
   =====================================================================
   Small on purpose: it is on every page while the arcade is switched on.
   The failure engine (fail.js) and the arcade (arcade.js) load only when
   somebody starts to reach for them.

   THE DOORS
     © 2026      the footer's year: five taps roll it, a character at a
                 time, into ▶ PLAY. Every page, phone and desktop.
     THAUMA      the big wordmark (landing page, home): five taps.
     the wheel   the page label under the nav on phones: five taps.
     404         the error's own numeral: one press. The original door.
     Konami      ↑ ↑ ↓ ↓ ← → ← → B A, then Enter, anywhere.
     "thauma"    typed anywhere: the page's own letters light up.

   Every door drives the same four stages of failure, and every door heals
   if you stop partway: the page snaps back and the count starts over.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.THAUMA_ARCADE;
  if (!A || A.doorsReady) return;
  A.doorsReady = true;

  var FILES = { fail: '/js/arcade/fail.js', arcade: '/js/arcade/arcade.js' };
  var loads = {};
  function load(name) {
    if (loads[name]) return loads[name];
    loads[name] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = FILES[name] + '?v=' + A.v[name];
      s.onload = res;
      s.onerror = function () { delete loads[name]; rej(new Error(name + ' did not load')); };
      document.head.appendChild(s);
    });
    return loads[name];
  }
  var engine = null;
  function fx() {
    return load('fail').then(function () { return engine || (engine = window.ThaumaFail.create()); });
  }
  A.loadArcade = function () { return load('arcade').then(function () { return window.ThaumaArcade; }); };

  /* Straight to the arcade's own address: nothing to break. */
  if (document.body.classList.contains('arcade-page')) {
    A.loadArcade().then(function (arc) { arc.mount({ direct: true }); });
    return;
  }

  var entering = false;
  function enter(door, opts) {
    if (entering) return;
    entering = true;
    fx().then(function (e) { return e.enter(door, opts); })
      .then(function () { entering = false; }, function () { entering = false; });
  }

  /* A door that is tapped: `taps` to open, a stage per tap, healing after a
     pause. `onTap(n)` lets the door dress its own element as it goes. */
  function tapDoor(el, name, taps, onTap, onReset, hit) {
    var n = 0;
    /* `hit` stands in for the element's own clicks when it takes none
       (the page wheel is pointer-events:none, and 15px tall). */
    (hit ? document : el).addEventListener('click', function (ev) {
      if (hit && !hit(ev)) return;
      if (entering) return;
      n++;
      if (onTap) onTap(n);
      if (n >= taps) { n = 0; ev.preventDefault(); enter(name, { first: el }); return; }
      fx().then(function (e) {
        e.progress(name, Math.ceil(n * 4 / taps), function (quiet) { n = 0; if (onReset) onReset(quiet); });
      });
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }

  ready(function () {
    /* ---- © 2026 → ▶ PLAY, one character per tap ---------------------- */
    Array.prototype.forEach.call(document.querySelectorAll('.foot-legal'), function (legal) {
      var t = legal.firstChild;
      if (!t || t.nodeType !== 3) return;
      var m = t.nodeValue.match(/^©\s?\d{4}/);
      if (!m) return;
      var span = document.createElement('span');
      span.className = 'arc-copy';
      Array.from(m[0]).forEach(function (c) {
        var ch = document.createElement('span');
        ch.style.cssText = 'display:inline-block;white-space:pre;font-kerning:none';
        ch.textContent = c; span.appendChild(ch);
      });
      t.nodeValue = t.nodeValue.slice(m[0].length);
      legal.insertBefore(span, t);
      var chars = span.children;
      var to = Array.from('▶ PLAY');
      /* Tap 1 turns the ©, taps 2–5 the year's digits; the space between
         stays put. */
      var order = [0, 2, 3, 4, 5];
      var was = Array.prototype.map.call(chars, function (c) { return c.textContent; });
      tapDoor(span, 'copyright', 5, function (n) {
        fx().then(function (e) { var i = order[n - 1]; if (chars[i]) e.rollChar(chars[i], to[i], 240); });
      }, function (quiet) {
        /* Back from the arcade the year is simply there again; healing
           mid-way it rolls back, as it came. */
        fx().then(function (e) {
          Array.prototype.forEach.call(chars, function (c, i) {
            if (c.textContent === was[i]) return;
            if (quiet) { c.getAnimations().forEach(function (a) { a.cancel(); }); c.textContent = was[i]; }
            else e.rollChar(c, was[i], 240);
          });
        });
      });
    });

    /* ---- THAUMA, the big wordmark (landing page and home) ------------- */
    Array.prototype.forEach.call(document.querySelectorAll('.wordmark'), function (mark) {
      tapDoor(mark, 'wordmark', 5);
    });

    /* ---- the page wheel under the nav, on phones ---------------------- */
    Array.prototype.forEach.call(document.querySelectorAll('.page-wheel'), function (wheel) {
      /* It takes no taps itself (main.css), so the door listens for taps on
         the band around its label: a finger-sized target without changing
         how the wheel behaves or looks. */
      tapDoor(wheel, 'wheel', 5, null, null, function (e) {
        var r = wheel.getBoundingClientRect();
        if (!r.height || getComputedStyle(wheel).display === 'none') return false;
        return e.clientY >= r.top - 16 && e.clientY <= r.bottom + 16 && e.clientX <= r.left + Math.min(r.width, 220);
      });
    });

    /* ---- the 404's own numeral: one press ------------------------------ */
    /* It hints, now and then: one digit misfires to a wrong character and
       rolls straight back, as if the error itself were unsteady — the
       "something's here" the original door always had. */
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    Array.prototype.forEach.call(document.querySelectorAll('.dict-word'), function (word) {
      word.style.cursor = 'pointer';
      word.addEventListener('click', function () { enter('404', { first: word }); });
      if (still || !word.animate) return;
      setInterval(function () {
        if (entering || word.closest('[hidden]') || document.getElementById('arcade')) return;
        var text = word.textContent, i = Math.floor(Math.random() * text.length);
        if (!/\S/.test(text[i])) return;
        var glyph = '#%&@$?!/<>'[Math.floor(Math.random() * 10)];
        word.innerHTML = '';
        Array.from(text).forEach(function (c, j) {
          var s = document.createElement('span');
          s.style.cssText = 'display:inline-block;font-kerning:none';
          s.textContent = j === i ? glyph : c; word.appendChild(s);
          if (j === i) {
            s.animate([{ translate: '0 -8%', opacity: .5 }, { translate: '0 0', opacity: 1 }], { duration: 90 });
            setTimeout(function () { word.textContent = text; }, 140);
          }
        });
      }, 5200);
    });
  });

  /* ---- keyboard doors -------------------------------------------------- */
  function typing(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el && el.isContentEditable);
  }

  var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a', 'Enter'];
  var kPos = 0;
  var WORD = 'thauma';
  var wPos = 0;

  document.addEventListener('keydown', function (e) {
    if (entering || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.getElementById('arcade')) return;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    /* Konami. The first two presses could be anybody scrolling, so they do
       nothing visible; from the third the page starts to give. A wrong key
       snaps it all back. */
    if (key === KONAMI[kPos]) {
      if (kPos >= 2 && /^Arrow/.test(key)) e.preventDefault();
      kPos++;
      if (kPos === KONAMI.length) { kPos = 0; enter('konami'); return; }
      if (kPos > 2) {
        var lvl = Math.ceil((kPos - 2) * 4 / (KONAMI.length - 3));
        fx().then(function (en) { en.progress('konami', lvl, function () { kPos = 0; }); });
      }
    } else if (kPos) {
      kPos = key === KONAMI[0] ? 1 : 0;
      if (engine) engine.heal();
    }

    /* "thauma": each right letter lights that letter wherever the page
       shows it; the last one gathers them into the word. */
    if (key.length === 1) {
      if (key === WORD[wPos]) {
        wPos++;
        var ch = key;
        if (wPos === WORD.length) { wPos = 0; fx().then(function (en) { en.light(ch); enter('thauma', { word: WORD }); }); return; }
        var lv = Math.ceil(wPos * 4 / WORD.length);
        fx().then(function (en) { en.light(ch); en.progress('thauma', lv, function () { wPos = 0; }); });
      } else if (wPos) {
        wPos = key === WORD[0] ? 1 : 0;
        if (engine) engine.heal();
        if (wPos) fx().then(function (en) { en.light('t'); en.progress('thauma', 1, function () { wPos = 0; }); });
      }
    }
  });
})();
