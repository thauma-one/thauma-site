/* =====================================================================
   play.js — the screen a game runs in (ARCADE-SPEC.md §4)
   =====================================================================
   Everything the games share, so each game is only its own rules:

   A FIXED PLAY AREA. A game names its logical size (Load Out is 360×640;
   `size` may be a function of { touch } for a game whose phone field is
   shorter) and the whole area is scaled to fit the screen, letterboxed.
   The same physics on every screen — the retired Flappy game spent three
   rounds of fixes on phones because its world was sized to the window.

   THE SAME FEEL EVERYWHERE (BACKLOG §4: Load Out's motor ran slower on
   phones, Soundcheck's fader was sluggish on a desktop and twitchy on a
   phone). Every game moves by the time that passed, never by the frame;
   a frame may be up to a tenth of a second long, and a game that needs
   small steps takes them itself.

   THE CONTROLS (Chase, 2026-09-29, and since):
     tap     a tap anywhere, or Space / Enter / ↑; held as `held.go`, and
             let go as release('go') — for a hold-to-flip
     toggle  hold the left or right half, or ← → / A D
     stick   a fader to drag on a phone (how far is how fast), or ← → / A D
     dpad    arrows / WASD; on a phone a cross of four buttons (or a row,
             or only some of them: ctx.pad()), or swipes when the game
             says `swipe`
     lanes   four lanes: D F J K or ← ↓ ↑ →; on a phone four pads
     aim     a finger (or the mouse) held on the play area aims, and
             letting go throws: run.point('down'|'move'|'up', x, y) in the
             game's own coordinates; ← → turn the aim, Space throws

   THE ARCADE AROUND IT. On a desktop the play area sits in a cabinet — a
   lit marquee, the bezel, a deck whose stick and buttons move with the
   player's keys. Every game starts with PLAYER 1 · READY · GO. Jokes come
   over the radio in a banner that stays long enough to read and never
   takes a touch (ctx.quip). Sound and music are sound.js's, off until the
   player turns them on.

   A game registers ThaumaArcade.games[id] = { size, controls, needs,
   create(ctx) } and create returns { update(dt), draw(g), press(dir),
   release(dir)?, stop() }; see games/loadout.js for a whole one.
   ===================================================================== */
(function () {
  'use strict';

  var BEST = 'thauma.arcade.best.';
  var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var ICON = {
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>',
    up: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10l5-5 5 5"/></svg>',
    down: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6l5 5 5-5"/></svg>',
    left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 3L5 8l5 5"/></svg>',
    right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3l5 5-5 5"/></svg>'
  };
  var LANE_KEYS = { d: 0, D: 0, f: 1, F: 1, j: 2, J: 2, k: 3, K: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function best(id) { try { return parseInt(localStorage.getItem(BEST + id), 10) || 0; } catch (e) { return 0; } }
  function keepBest(id, n) { try { localStorage.setItem(BEST + id, String(n)); } catch (e) { /* private mode */ } }
  function snd() { return window.ThaumaSound || null; }

  var vendors = {};
  function vendor(name) {
    if (vendors[name]) return vendors[name];
    vendors[name] = new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = '/js/arcade/vendor/' + name + '.min.js?v=' + ((window.THAUMA_ARCADE.v.vendor || {})[name] || '1');
      s.onload = res; s.onerror = function () { delete vendors[name]; rej(new Error(name)); };
      document.head.appendChild(s);
    });
    return vendors[name];
  }

  /**
   * Run one game until the player goes back to the menu.
   * @param game   the registered game
   * @param opts   { root: #arcade, id, color, words: w(key), board: () => Promise<scores>, submit(name, score) }
   * @returns a Promise that resolves when the player chooses Menu
   */
  function run(game, opts) {
    return Promise.all((game.needs || []).map(vendor)).then(function () {
      return new Promise(function (done) { screen(game, opts, done); });
    });
  }

  function screen(game, opts, done) {
    var w = opts.words, id = opts.id;
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var touch = window.matchMedia && matchMedia('(hover: none)').matches;
    var size = typeof game.size === 'function' ? game.size({ touch: touch }) : game.size;
    var W = size.w, H = size.h, scheme = game.controls;
    /* The cabinet, where there is room for it and a keyboard to play with. */
    var framed = !touch && window.matchMedia && matchMedia('(min-width: 900px) and (min-height: 600px)').matches;

    var el = document.createElement('div');
    el.className = 'arc-play is-' + scheme + (framed ? ' has-frame' : '');
    if (opts.color) el.style.setProperty('--c', opts.color);
    el.style.setProperty('--ar', (W / H).toFixed(4));   /* the cabinet takes the game's shape */
    el.innerHTML =
      '<div class="arc-hud">' +
        '<button class="arc-pause" type="button" aria-label="' + esc(w('paused_label')) + '">' + ICON.pause + '</button>' +
        '<div class="arc-score"><span>' + esc(w('score_label')) + '</span><b>0</b></div>' +
        '<div class="arc-best"><span>' + esc(w('best_label')) + '</span><b>' + best(id) + '</b></div>' +
      '</div>' +
      '<div class="arc-cabinet">' +
        (framed ? '<div class="arc-marquee"><span>' + esc(w(id + '_title')) + '</span></div>' : '') +
        '<div class="arc-bezel"><div class="arc-stage"><canvas></canvas>' +
          '<div class="arc-quip" aria-live="polite"></div><div class="arc-ready" hidden></div></div></div>' +
        (framed ? '<div class="arc-deck"><i class="deck-stick"></i><span class="deck-btns"><i class="deck-btn"></i><i class="deck-btn"></i></span>' +
          '<span class="deck-hint">' + esc(w(scheme + '_hint')) + '</span></div>' : '') +
      '</div>' +
      (touch ? controlsHtml() : '') +
      '<div class="arc-over" hidden></div>';
    opts.root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });

    function controlsHtml() {
      if (scheme === 'dpad' && !game.swipe) {
        return '<div class="arc-pad' + (game.pad === 'cross' ? ' is-cross' : '') + '">' + ['up', 'left', 'right', 'down'].map(function (d) {
          return '<button type="button" data-dir="' + d + '" class="pad-' + d + '" aria-label="' + d + '">' + ICON[d] + '</button>';
        }).join('') + '</div>';
      }
      if (scheme === 'stick') return '<div class="arc-stickbar"><i class="stick-track"></i><i class="stick-knob"></i></div>';
      if (scheme === 'lanes') return '<div class="arc-lanes">' + [0, 1, 2, 3].map(function (i) { return '<button type="button" data-lane="' + i + '"></button>'; }).join('') + '</div>';
      return '';
    }

    var stage = el.querySelector('.arc-stage'), canvas = el.querySelector('canvas');
    var g = canvas.getContext('2d');
    var scoreEl = el.querySelector('.arc-score b'), bestEl = el.querySelector('.arc-best b');
    var quipEl = el.querySelector('.arc-quip'), readyEl = el.querySelector('.arc-ready'), overEl = el.querySelector('.arc-over');
    var stickEl = el.querySelector('.arc-stickbar'), knobEl = el.querySelector('.stick-knob');
    var scale = 1, dpr = 1;

    function fit() {
      var r = stage.getBoundingClientRect();
      scale = Math.min(r.width / W, r.height / H);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.style.width = (W * scale) + 'px'; canvas.style.height = (H * scale) + 'px';
      canvas.width = Math.round(W * scale * dpr); canvas.height = Math.round(H * scale * dpr);
    }
    fit();
    window.addEventListener('resize', fit);

    /* ---- no zoom, no magnifier, while a game is up (BACKLOG §4) ---- */
    function noGesture(e) { e.preventDefault(); }
    el.addEventListener('dblclick', noGesture);
    el.addEventListener('contextmenu', noGesture);
    el.addEventListener('touchmove', noGesture, { passive: false });
    document.addEventListener('gesturestart', noGesture);

    /* ---- input ---- */
    var held = { left: false, right: false, up: false, down: false, go: false, l0: false, l1: false, l2: false, l3: false };
    var paused = false, over = false, saved = false, run = null, raf = 0, last = 0, shakeT = 0, shakeA = 0;
    var readyUntil = 0;
    function live() { return !paused && !over && run && performance.now() >= readyUntil; }
    function press(dir) { deck(dir, true); if (live() && run.press) run.press(dir); }
    function release(dir) { deck(dir, false); if (live() && run.release) run.release(dir); }

    var KEYS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
      ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down' };
    /* While the card is locked, every tap or key pushes the unlock back:
       it opens only once the player has stopped for a moment, however long
       they keep mashing (a fixed delay let a steady tapper hit Save). */
    function stillMashing() {
      var now = performance.now();
      if (!over || now >= lockedUntil) return false;
      lockedUntil = Math.max(lockedUntil, now + 500);
      return true;
    }
    function onKey(e) {
      if (stillMashing()) { e.preventDefault(); e.stopPropagation(); return; }
      if (overEl.contains(e.target) && e.target.tagName === 'BUTTON' && e.key === 'Enter') return;
      e.stopPropagation();
      if (over) { if (e.key === ' ' && !slots) e.preventDefault(); overKey(e); return; }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePause(); return; }
      if (paused) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePause(); } return; }
      if (e.key === 'm' || e.key === 'M') { var S = snd(); if (S) S.toggle(); return; }
      if (scheme === 'lanes') {
        var ln = LANE_KEYS[e.key];
        if (ln !== undefined) { e.preventDefault(); if (!e.repeat) { held['l' + ln] = true; press('l' + ln); } }
        return;
      }
      var dir = KEYS[e.key];
      if (scheme === 'tap' && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W')) {
        e.preventDefault(); if (!e.repeat) { held.go = true; press('go'); } return;
      }
      if ((e.key === ' ' || (e.key === 'Enter' && scheme === 'aim')) && scheme !== 'tap') { e.preventDefault(); if (!e.repeat) press('go'); return; }
      if (dir && (scheme === 'dpad' || dir === 'left' || dir === 'right')) {
        e.preventDefault();
        if (!held[dir] && !e.repeat) press(dir);
        held[dir] = true;
      }
    }
    function onKeyUp(e) {
      e.stopPropagation();
      if (scheme === 'lanes') { var ln = LANE_KEYS[e.key]; if (ln !== undefined) { held['l' + ln] = false; release('l' + ln); } }
      else if (scheme === 'tap' && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W')) { held.go = false; release('go'); }
      else { var dir = KEYS[e.key]; if (dir && held[dir]) { held[dir] = false; release(dir); } }
      /* a focused button clicks on Space's release: not on the game-over card while choosing initials */
      if (over && e.key === ' ' && (slots || performance.now() < lockedUntil)) e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);

    /* Pointers: tap anywhere, or the half a finger is holding, or a pad. */
    var pointers = new Map();
    function sideOf(x) { return x < window.innerWidth / 2 ? 'left' : 'right'; }
    function recount() {
      if (scheme === 'toggle') { held.left = held.right = false; pointers.forEach(function (d) { held[d] = true; }); }
      if (scheme === 'dpad') { held.left = held.right = held.up = held.down = false; pointers.forEach(function (d) { if (d) held[d] = true; }); }
    }
    var swipe = null, stickId = null, stickV = 0, stickKeys = 0, aimId = null;
    /* a pointer, in the game's own coordinates */
    function aimAt(phase, e) {
      if (!live() || !run.point) return;
      var r = canvas.getBoundingClientRect();
      run.point(phase, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale);
    }
    function stickAt(x) {
      var r = stickEl.getBoundingClientRect(), half = r.width / 2 - 26;
      stickV = Math.max(-1, Math.min(1, (x - (r.left + r.width / 2)) / half));
      knobEl.style.translate = (stickV * half).toFixed(1) + 'px 0';
    }
    el.addEventListener('pointerdown', function (e) {
      if (stillMashing()) { e.preventDefault(); return; }
      if (e.target.closest('.arc-hud,.arc-over')) return;
      e.preventDefault();
      var padBtn = e.target.closest('.arc-pad button'), lane = e.target.closest('[data-lane]');
      if (scheme === 'stick' && e.target.closest('.arc-stickbar')) {
        stickId = e.pointerId; stickEl.classList.add('is-held'); stickAt(e.clientX);
        try { stickEl.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        return;
      }
      if (scheme === 'aim') {
        aimId = e.pointerId; aimAt('down', e);
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        return;
      }
      if (scheme === 'lanes' && lane) { var n = +lane.dataset.lane; pointers.set(e.pointerId, 'l' + n); held['l' + n] = true; lane.classList.add('is-on'); press('l' + n); return; }
      if (scheme === 'tap') { pointers.set(e.pointerId, 'go'); held.go = true; press('go'); return; }
      if (scheme === 'toggle' || scheme === 'stick') { var s = sideOf(e.clientX); pointers.set(e.pointerId, s); press(s); recount(); held[s] = true; return; }
      if (padBtn) { var d = padBtn.dataset.dir; pointers.set(e.pointerId, d); press(d); recount(); return; }
      swipe = { x: e.clientX, y: e.clientY, id: e.pointerId, used: false };
    });
    el.addEventListener('pointermove', function (e) {
      if (stickId === e.pointerId) { stickAt(e.clientX); return; }
      if (scheme === 'aim' && (aimId === e.pointerId || (!touch && aimId === null))) { aimAt(aimId === null ? 'hover' : 'move', e); return; }
      /* a swipe counts the moment it is long enough, not when the finger lifts */
      if (swipe && swipe.id === e.pointerId && !swipe.used) {
        var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 26) {
          swipe.used = true;
          press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        }
      }
    });
    function lift(e) {
      if (aimId === e.pointerId) { aimId = null; aimAt(e.type === 'pointercancel' ? 'cancel' : 'up', e); return; }
      if (stickId === e.pointerId) { stickId = null; stickV = 0; stickEl.classList.remove('is-held'); knobEl.style.translate = '0 0'; return; }
      if (swipe && swipe.id === e.pointerId) {
        if (!swipe.used && game.swipe) press('tap');
        swipe = null;
      }
      var was = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (was === 'go') { held.go = false; release('go'); }
      if (was && /^l\d$/.test(was)) {
        held[was] = false; release(was);
        var b = el.querySelector('[data-lane="' + was.slice(1) + '"]'); if (b) b.classList.remove('is-on');
      }
      if (scheme === 'toggle' || scheme === 'stick') { if (was) { held[was] = false; release(was); } recount(); }
      else recount();
    }
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);

    /* The deck's stick and buttons move with the player (desktop cabinet). */
    var deckStick = el.querySelector('.deck-stick'), deckBtns = el.querySelectorAll('.deck-btn');
    function deck(dir, on) {
      if (!framed) return;
      var x = (held.right ? 1 : 0) - (held.left ? 1 : 0), y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      deckStick.style.rotate = (x * 14) + 'deg'; deckStick.style.translate = '0 ' + (y * 3) + 'px';
      if (dir === 'go' || dir === 'tap' || /^l\d$/.test(dir)) deckBtns[/^l[23]$/.test(dir) ? 1 : 0].classList.toggle('is-on', on);
    }

    /* ---- the radio: jokes and calls, in a banner that can be read ---- */
    var quipUntil = 0, quipLast = {}, quipTimer = 0;
    function showLine(text, opts) {
      opts = opts || {};
      if (!text) return;
      var tag = opts.tag || game.speaker || 'SM', m = /^\[([^\]]{1,10})\]\s*/.exec(text);
      if (m) { tag = m[1]; text = text.slice(m[0].length); }
      quipEl.innerHTML = '<b>' + esc(tag) + '</b><span>' + esc(text) + '</span>';
      /* where it sits: each game names the band it can spare ('bottom', or a
         fraction of the height down from the top) so it covers no play */
      var at = opts.at != null ? opts.at : game.quipAt;
      quipEl.classList.toggle('is-low', at === 'bottom');
      quipEl.style.top = typeof at === 'number' ? (at * 100).toFixed(1) + '%' : '';
      quipEl.classList.remove('is-shown', 'is-good', 'is-bad'); void quipEl.offsetWidth;
      quipEl.classList.add('is-shown');
      if (opts.mood) quipEl.classList.add('is-' + opts.mood);
      var ms = Math.max(3600, Math.min(6500, 1800 + text.length * 55));
      quipEl.style.setProperty('--quip-ms', ms + 'ms');
      quipUntil = performance.now() + ms;
      clearTimeout(quipTimer); quipTimer = setTimeout(function () { quipEl.classList.remove('is-shown'); }, ms);
    }
    function pickFrom(key, list) {
      /* round-robin through a shuffled list, so a joke is not heard twice
         before the others have had their turn */
      var st = quipLast[key];
      if (!st || !st.left.length) {
        st = quipLast[key] = { left: list.slice().sort(function () { return Math.random() - .5; }), prev: st && st.prev };
        if (st.left.length > 1 && st.left[0] === st.prev) st.left.push(st.left.shift());
      }
      st.prev = st.left.shift();
      return st.prev;
    }

    /* ---- the context a game gets ---- */
    var score = 0;
    var ctx = {
      W: W, H: H, held: held, reduced: reduced, touch: touch, words: w, best: best(id),
      score: function (n) { score = Math.max(0, Math.floor(n)); scoreEl.textContent = score; },
      /* A camera jolt, in logical pixels; none under reduced motion. */
      shake: function (a) { if (!reduced) { shakeA = Math.max(shakeA, a); shakeT = 1; } },
      /* A call over the radio, now: a line, or one of a list. */
      say: function (line, o) {
        if (Array.isArray(line)) line = line[Math.floor(Math.random() * line.length)];
        showLine(line, o);
      },
      /* A JOKE: one of words(key)'s list, when the radio is free (or
         `force`), at most every few seconds, and only `chance` of the time —
         a joke on every event is no joke. { mood: 'good' | 'bad', at } */
      quip: function (key, o) {
        o = o || {};
        var now = performance.now();
        if (!o.force && now < quipUntil + 900) return false;
        if (o.chance != null && Math.random() > o.chance) return false;
        var list = w(key);
        if (!Array.isArray(list) || !list.length) return false;
        showLine(pickFrom(key, list), o);
        return true;
      },
      sfx: function (name, o) { var S = snd(); if (S) S.sfx(name, o); },
      /* Which d-pad buttons a phone shows (Follow Spot gains its tilt). */
      pad: function (list) {
        el.querySelectorAll('.arc-pad button').forEach(function (b) { b.hidden = list.indexOf(b.dataset.dir) < 0; });
      },
      /* The stick: a finger's fader, or the arrow keys easing toward full. */
      stick: function () { return stickId !== null ? stickV : stickKeys; },
      over: function () { finish(); }
    };
    if (game.padStart) ctx.pad(game.padStart);

    function start(short) {
      if (run && run.stop) run.stop();
      over = false; paused = false; saved = false; overEl.hidden = true; overEl.innerHTML = '';
      ctx.best = best(id); bestEl.textContent = ctx.best;
      ctx.score(0);
      run = game.create(ctx);
      last = performance.now();
      ready(short);
      var S = snd(); if (S) S.music(id);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }
    /* PLAYER 1 · the game · READY · GO — the game is drawn behind it, still,
       and takes no input until GO. */
    function ready(short) {
      var ms = reduced ? 300 : short ? 1100 : 2000;
      readyUntil = performance.now() + ms;
      readyEl.hidden = false;
      readyEl.innerHTML = '<small>' + esc(w('player_label')) + '</small><b>' + esc(w(id + '_title')) + '</b><em>' + esc(w('ready_label')) + '</em>';
      readyEl.classList.remove('is-go'); void readyEl.offsetWidth;
      readyEl.style.setProperty('--ready-ms', ms + 'ms');
      setTimeout(function () {
        if (!readyEl.isConnected) return;
        readyEl.querySelector('em').textContent = w('go_label');
        readyEl.classList.add('is-go'); ctx.sfx('go');
      }, Math.max(0, ms - 450));
      setTimeout(function () { readyEl.hidden = true; last = performance.now(); }, ms);
      ctx.sfx('ready');
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      /* never backwards: a frame's timestamp can be a hair before the start */
      var dt = Math.max(0, Math.min(.1, (now - last) / 1000)); last = Math.max(last, now);
      /* the keys ease the stick to full in a tenth of a second, both ways */
      var kx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      stickKeys += Math.max(-dt * 9, Math.min(dt * 9, kx - stickKeys));
      if (live()) run.update(dt);
      g.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
      if (shakeT > 0) {
        shakeT = Math.max(0, shakeT - dt * 3.5);
        var a = shakeA * shakeT;
        g.translate((Math.random() - .5) * a, (Math.random() - .5) * a);
        if (!shakeT) shakeA = 0;
      }
      if (run) run.draw(g);
    }

    /* ---- pause ---- */
    function togglePause() {
      if (over) return;
      paused = !paused;
      var S = snd(); if (S) S.duck(paused);
      if (paused) {
        overEl.hidden = false;
        overEl.innerHTML = '<div class="arc-card"><h3>' + esc(w('paused_label')) + '</h3>' +
          '<div class="arc-btns"><button type="button" class="arc-btn is-main" data-act="resume">' + esc(w('resume_label')) + '</button>' +
          '<button type="button" class="arc-btn" data-act="menu">' + esc(w('menu_label')) + '</button></div></div>';
        overEl.querySelector('[data-act=resume]').focus({ preventScroll: true });
      } else { overEl.hidden = true; overEl.innerHTML = ''; last = performance.now(); }
    }
    el.querySelector('.arc-pause').addEventListener('click', togglePause);
    function onHide() { if (document.hidden && !paused && !over) togglePause(); }
    document.addEventListener('visibilitychange', onHide);

    /* ---- game over, and the initials ---- */
    var slots = null, slot = 0;
    var lockedUntil = 0, LOCK_MS = 1400;
    function finish() {
      if (over) return;
      over = true;
      /* A player mashing the button as the run ends must not restart it, or
         save initials they never chose. The card takes input after a beat. */
      lockedUntil = performance.now() + LOCK_MS;
      var prev = best(id), isBest = score > prev;
      if (isBest) { keepBest(id, score); bestEl.textContent = score; }
      var S = snd(); if (S) { S.sfx(isBest ? 'newbest' : 'gameover'); S.duck(true); }
      overEl.hidden = false;
      overEl.innerHTML = '<div class="arc-card"><h3>' + esc(w('over_title')) + '</h3>' +
        '<div class="arc-final"><b>' + score + '</b>' + (isBest ? '<span>' + esc(w('newbest_label')) + '</span>' : '') + '</div>' +
        '<div class="arc-initials" hidden></div><ol class="arc-board"></ol>' +
        '<div class="arc-btns"><button type="button" class="arc-btn is-main" data-act="again">' + esc(w('again_label')) + '</button>' +
        '<button type="button" class="arc-btn" data-act="menu">' + esc(w('menu_label')) + '</button></div></div>';
      var boardEl = overEl.querySelector('.arc-board');
      /* the card's buttons wake up with the lock, so the pause reads as meant */
      var card = overEl.querySelector('.arc-card');
      card.classList.add('is-locked');
      (function wake() {
        var left = lockedUntil - performance.now();
        if (left > 0) { setTimeout(wake, left + 20); return; }
        card.classList.remove('is-locked');
      })();
      overEl.querySelector('[data-act=again]').focus({ preventScroll: true });
      opts.board().then(function (list) {
        paintBoard(boardEl, list);
        var qualifies = score > 0 && (list.length < 5 || score > list[Math.min(4, list.length - 1)].score);
        if (qualifies && !saved) askInitials(boardEl);
      }).catch(function () {});
    }
    function paintBoard(boardEl, list) {
      boardEl.innerHTML = list.slice(0, 5).map(function (s, i) {
        return '<li><i>' + (i + 1) + '</i>' + esc(s.name) + '<b>' + (s.score | 0) + '</b></li>';
      }).join('');
    }
    function askInitials(boardEl) {
      var box = overEl.querySelector('.arc-initials');
      var saved = (function () { try { return localStorage.getItem('thauma.arcade.initials') || 'AAA'; } catch (e) { return 'AAA'; } })();
      slots = saved.slice(0, 3).split(''); slot = 0;
      box.hidden = false;
      box.innerHTML = '<p>' + esc(w('initials_title')) + ' · ' + esc(w('initials_hint')) + '</p><div class="arc-slots">' +
        [0, 1, 2].map(function (i) {
          return '<div class="arc-slot" data-i="' + i + '"><button type="button" data-d="1" aria-label="up">' + ICON.up + '</button>' +
            '<b></b><button type="button" data-d="-1" aria-label="down">' + ICON.down + '</button></div>';
        }).join('') + '</div><button type="button" class="arc-btn is-main" data-act="save">' + esc(w('initials_ok')) + '</button>';
      function paint() {
        box.querySelectorAll('.arc-slot').forEach(function (s, i) { s.querySelector('b').textContent = slots[i]; s.classList.toggle('is-on', i === slot); });
      }
      paint();
      box.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        if (b.dataset.act === 'save') { save(); return; }
        var s = +b.closest('.arc-slot').dataset.i; slot = s; turn(+b.dataset.d); paint();
      });
      function turn(d) { var i = LETTERS.indexOf(slots[slot]); slots[slot] = LETTERS[(i + d + LETTERS.length) % LETTERS.length]; }
      overKey = function (e) {
        var k = e.key;
        if (k === 'ArrowUp' || k === 'w' || k === 'W') { turn(1); paint(); e.preventDefault(); return; }
        if (k === 'ArrowDown' || k === 's' || k === 'S') { turn(-1); paint(); e.preventDefault(); return; }
        if (k === 'ArrowLeft') { slot = Math.max(0, slot - 1); paint(); e.preventDefault(); return; }
        if (k === 'ArrowRight') { slot = Math.min(2, slot + 1); paint(); e.preventDefault(); return; }
        if (k === 'Enter') { save(); e.preventDefault(); return; }
        if (k === ' ') { e.preventDefault(); return; }
        if (k.length === 1 && LETTERS.indexOf(k.toUpperCase()) !== -1) { slots[slot] = k.toUpperCase(); slot = Math.min(2, slot + 1); paint(); e.preventDefault(); }
      };
      /* Focus waits on the first letter, not on Save: a stray Space must not
         put "AAA" on the board. Enter saves; Save saves. */
      box.querySelector('.arc-slot button').focus({ preventScroll: true });
      function save() {
        var name = slots.join('');
        try { localStorage.setItem('thauma.arcade.initials', name); } catch (e) { /* private mode */ }
        box.innerHTML = '<p>' + esc(w('saving_label')) + '</p>';
        saved = true;
        overKey = baseOverKey; slots = null;
        opts.submit(name, score).then(function (list) { box.hidden = true; paintBoard(boardEl, list); })
          .catch(function () { box.hidden = true; });
        overEl.querySelector('[data-act=again]').focus({ preventScroll: true });
      }
    }
    function again() { var S = snd(); if (S) S.duck(false); overKey = baseOverKey; start(true); }
    function baseOverKey(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); again(); }
      else if (e.key === 'Escape') { e.preventDefault(); leave(); }
    }
    var overKey = baseOverKey;
    overEl.addEventListener('click', function (e) {
      if (over && performance.now() < lockedUntil) return;   /* stillMashing() already saw this press */
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'again') again();
      else if (b.dataset.act === 'menu') leave();
      else if (b.dataset.act === 'resume') togglePause();
    });

    function leave() {
      cancelAnimationFrame(raf);
      clearTimeout(quipTimer);
      if (run && run.stop) run.stop();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('gesturestart', noGesture);
      window.removeEventListener('resize', fit);
      var S = snd(); if (S) { S.duck(false); S.music('menu'); }
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); done(); }, reduced ? 0 : 260);
    }

    start();
  }

  window.ThaumaPlay = { run: run };
})();
