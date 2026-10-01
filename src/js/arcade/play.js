/* =====================================================================
   play.js — the screen a game runs in (ARCADE-SPEC.md §4)
   =====================================================================
   Everything the games share, so each game is only its own rules:

   A FIXED PLAY AREA. A game names its logical size (Load Out is 360×640)
   and the whole area is scaled to fit the screen, letterboxed. The same
   physics on every screen — the retired Flappy game spent three rounds of
   fixes on phones because its world was sized to the window.

   THE THREE CONTROLS (Chase, 2026-09-29):
     tap     a tap anywhere, or Space / Enter
     toggle  hold the left or right half, or ← → / A D
     dpad    arrows / WASD; on a touch screen a strip of four buttons
             across the bottom, and swipes on the play area

   The score line, pause (Esc / P, the button, or the tab going to the
   background), game over, and three-letter initials for a top-five board.

   A game registers ThaumaArcade.games[id] = { size, controls, needs,
   create(ctx) } and create returns { update(dt), draw(g), press(dir),
   stop() }; see games/loadout.js for a whole one.
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

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function best(id) { try { return parseInt(localStorage.getItem(BEST + id), 10) || 0; } catch (e) { return 0; } }
  function keepBest(id, n) { try { localStorage.setItem(BEST + id, String(n)); } catch (e) { /* private mode */ } }

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
   * @param opts   { root: #arcade, id, words: w(key), board: () => Promise<scores>, submit(name, score) }
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
    var W = game.size.w, H = game.size.h, scheme = game.controls;

    var el = document.createElement('div');
    el.className = 'arc-play is-' + scheme;
    el.innerHTML =
      '<div class="arc-hud">' +
        '<button class="arc-pause" type="button" aria-label="' + esc(w('paused_label')) + '">' + ICON.pause + '</button>' +
        '<div class="arc-score"><span>' + esc(w('score_label')) + '</span><b>0</b></div>' +
        '<div class="arc-best"><span>' + esc(w('best_label')) + '</span><b>' + best(id) + '</b></div>' +
      '</div>' +
      '<div class="arc-stage"><canvas></canvas><div class="arc-toast" aria-live="polite"></div></div>' +
      (scheme === 'dpad' && touch ? '<div class="arc-pad">' + ['left', 'up', 'down', 'right'].map(function (d) {
        return '<button type="button" data-dir="' + d + '" aria-label="' + d + '">' + ICON[d] + '</button>';
      }).join('') + '</div>' : '') +
      '<div class="arc-over" hidden></div>';
    opts.root.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('is-in'); });

    var stage = el.querySelector('.arc-stage'), canvas = el.querySelector('canvas');
    var g = canvas.getContext('2d');
    var scoreEl = el.querySelector('.arc-score b'), bestEl = el.querySelector('.arc-best b');
    var toastEl = el.querySelector('.arc-toast'), overEl = el.querySelector('.arc-over');
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

    /* ---- input ---- */
    var held = { left: false, right: false, up: false, down: false };
    var paused = false, over = false, saved = false, run = null, raf = 0, last = 0, shakeT = 0, shakeA = 0;
    function press(dir) { if (!paused && !over && run && run.press) run.press(dir); }

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
      var dir = KEYS[e.key];
      if (scheme === 'tap' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!e.repeat) press('go'); return; }
      if (dir && (scheme === 'dpad' || dir === 'left' || dir === 'right')) {
        e.preventDefault();
        if (!held[dir] && !e.repeat) press(dir);
        held[dir] = true;
      }
    }
    function onKeyUp(e) {
      var dir = KEYS[e.key]; if (dir) held[dir] = false; e.stopPropagation();
      /* a focused button clicks on Space's release: not on the game-over card while choosing initials */
      if (over && e.key === ' ' && (slots || performance.now() < lockedUntil)) e.preventDefault();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);

    /* Pointers: tap anywhere, or the half a finger is holding, or the pad. */
    var pointers = new Map();
    function sideOf(x) { return x < window.innerWidth / 2 ? 'left' : 'right'; }
    function recount() {
      if (scheme === 'toggle') { held.left = held.right = false; pointers.forEach(function (d) { held[d] = true; }); }
      if (scheme === 'dpad') { held.left = held.right = held.up = held.down = false; pointers.forEach(function (d) { if (d) held[d] = true; }); }
    }
    var swipe = null;
    el.addEventListener('pointerdown', function (e) {
      if (stillMashing()) { e.preventDefault(); return; }
      if (e.target.closest('.arc-hud,.arc-over')) return;
      var padBtn = e.target.closest('.arc-pad button');
      e.preventDefault();
      if (scheme === 'tap') { press('go'); return; }
      if (scheme === 'toggle') { var s = sideOf(e.clientX); pointers.set(e.pointerId, s); press(s); recount(); return; }
      if (padBtn) { var d = padBtn.dataset.dir; pointers.set(e.pointerId, d); press(d); recount(); return; }
      swipe = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    function lift(e) {
      if (swipe && swipe.id === e.pointerId) {
        var dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) press(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
        swipe = null;
      }
      pointers.delete(e.pointerId); recount();
    }
    el.addEventListener('pointerup', lift);
    el.addEventListener('pointercancel', lift);

    /* ---- the context a game gets ---- */
    var score = 0;
    var ctx = {
      W: W, H: H, held: held, reduced: reduced, touch: touch, words: w, best: best(id),
      score: function (n) { score = Math.max(0, Math.floor(n)); scoreEl.textContent = score; },
      /* A camera jolt, in logical pixels; none under reduced motion. */
      shake: function (a) { if (!reduced) { shakeA = Math.max(shakeA, a); shakeT = 1; } },
      /* A line across the top of the play area: the stage manager on the
         radio. One of a list when given a list. */
      say: function (line) {
        if (Array.isArray(line)) line = line[Math.floor(Math.random() * line.length)];
        if (!line) return;
        toastEl.textContent = line; toastEl.classList.remove('is-shown'); void toastEl.offsetWidth; toastEl.classList.add('is-shown');
      },
      over: function () { finish(); }
    };

    function start() {
      if (run && run.stop) run.stop();
      over = false; paused = false; saved = false; overEl.hidden = true; overEl.innerHTML = '';
      ctx.best = best(id); bestEl.textContent = ctx.best;
      ctx.score(0);
      run = game.create(ctx);
      last = performance.now();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(.05, (now - last) / 1000); last = now;
      if (!paused && !over && run) run.update(dt);
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
    function baseOverKey(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); }
      else if (e.key === 'Escape') { e.preventDefault(); leave(); }
    }
    var overKey = baseOverKey;
    overEl.addEventListener('click', function (e) {
      if (over && performance.now() < lockedUntil) return;   /* stillMashing() already saw this press */
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'again') { overKey = baseOverKey; start(); }
      else if (b.dataset.act === 'menu') leave();
      else if (b.dataset.act === 'resume') togglePause();
    });

    function leave() {
      cancelAnimationFrame(raf);
      if (run && run.stop) run.stop();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('resize', fit);
      el.classList.remove('is-in');
      setTimeout(function () { el.remove(); done(); }, reduced ? 0 : 260);
    }

    start();
  }

  window.ThaumaPlay = { run: run };
})();
