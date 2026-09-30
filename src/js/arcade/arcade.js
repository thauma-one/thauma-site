/* =====================================================================
   arcade.js — the hidden arcade itself (ARCADE-SPEC.md §3)
   =====================================================================
   Opens IN PLACE, over the page it was found on (fail.js has just made
   that page fall apart and switch off), or on its own address, /arcade/.
   Either way it is the same menu: a row of cabinets, moved through with
   the same controls the games use, so it feels like a console rather than
   a web page (Chase, 2026-09-29: "almost like changing menus in a game").

   Leaving puts the page back: the arcade switches off, and fail.js flies
   the debris home. The browser's Back does the same, because opening the
   arcade put /arcade/ into the history.

   A GAME is js/arcade/games/<id>.js, registering itself in
   ThaumaArcade.games[id] and run by play.js (ARCADE-SPEC.md §4); both load
   only when its cabinet is played. A cabinet without `ready` says so.
   ===================================================================== */
(function () {
  'use strict';

  /* The launch four (Chase, 2026-09-29: "You can start with the four"),
     then the three still in the workshop. */
  var CABINETS = [
    { id: 'loadout',    controls: 'tap',    c: '--ar-amber',  ready: true },
    { id: 'soundcheck', controls: 'toggle', c: '--ar-blue',   ready: true },
    { id: 'panelfixer', controls: 'tap',    c: '--ar-magenta', ready: true },
    { id: 'cablerun',   controls: 'dpad',   c: '--ar-foam',   ready: true },
    { id: 'followspot', controls: 'toggle', c: '--ar-violet', broken: true },
    { id: 'strike',     controls: 'toggle', c: '--ar-red',    broken: true },
    { id: 'cuestack',   controls: 'dpad',   c: '--ar-blue',   broken: true }
  ];
  var EASE = 'cubic-bezier(.55,.05,.45,.95)';
  var BEST = 'thauma.arcade.best.';

  var games = {};
  var open = null;

  function css() {
    var A = window.THAUMA_ARCADE;
    if (document.getElementById('arcade-css')) return Promise.resolve();
    return new Promise(function (res) {
      var l = document.createElement('link');
      l.id = 'arcade-css'; l.rel = 'stylesheet'; l.href = '/css/arcade.css?v=' + A.v.css;
      l.onload = res; l.onerror = res;
      document.head.appendChild(l);
    });
  }
  function words() {
    var A = window.THAUMA_ARCADE;
    return fetch('/arcade/words.json?v=' + A.v.words).then(function (r) { return r.json(); })
      .catch(function () { return {}; });
  }
  function lang(all) {
    var l = (document.documentElement.lang || 'en').slice(0, 2);
    var m = document.cookie.match(/thauma_lang=([a-z]{2})/);
    if (!all[l] && m) l = m[1];
    return all[l] ? l : 'en';
  }
  var scripts = {};
  function script(key, src) {
    if (scripts[key]) return scripts[key];
    var v = (window.THAUMA_ARCADE.v.games || {})[key] || window.THAUMA_ARCADE.v[key] || '';
    scripts[key] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src + '?v=' + v;
      s.onload = res; s.onerror = function () { delete scripts[key]; rej(new Error(src)); };
      document.head.appendChild(s);
    });
    return scripts[key];
  }
  function best(id) { try { return parseInt(localStorage.getItem(BEST + id), 10) || 0; } catch (e) { return 0; } }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ------------------------------------------------ attract screens */
  /* What each cabinet shows while it waits: a few seconds of its game,
     played by itself. Drawn small and cheap; only the chosen cabinet and
     its neighbors move. */
  var ATTRACT = {
    loadout: function (g, w, h, t, col) {
      g.fillStyle = '#0b1220'; g.fillRect(0, h - 16, w, 16);
      var sizes = [[62, 26], [48, 30], [70, 22], [40, 28], [56, 24]], y = h - 16, lean = Math.sin(t * 1.3) * 1.6;
      sizes.forEach(function (s, i) {
        y -= s[1];
        var x = w / 2 - s[0] / 2 + Math.sin(i * 1.7) * 6 + lean * i;
        box(g, x, y, s[0], s[1], i % 2 ? col : '#39445a');
      });
      var hx = w / 2 + Math.sin(t * 1.6) * w * .3;
      g.strokeStyle = '#8A96A6'; g.lineWidth = 1; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(hx, 0); g.lineTo(hx, 34); g.stroke(); g.setLineDash([]);
      box(g, hx - 22, 34, 44, 22, col);
    },
    soundcheck: function (g, w, h, t, col) {
      var bx = w / 2 + Math.sin(t * 2.1) * w * .38, by = h / 2 + Math.sin(t * 3.3) * h * .38;
      g.fillStyle = col; g.fillRect(bx - 3, by - 3, 6, 6);
      g.fillRect(Math.max(4, Math.min(w - 40, bx - 18)), 10, 36, 5);
      g.fillStyle = '#EDF2F8'; g.fillRect(Math.max(4, Math.min(w - 40, bx - 18 + Math.sin(t * 4) * 12)), h - 15, 36, 5);
      g.strokeStyle = 'rgba(237,242,248,.15)'; g.setLineDash([4, 5]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([]);
    },
    panelfixer: function (g, w, h, t, col) {
      var cols = 6, rows = 7, pw = (w * .58) / cols, ph = (h * .7) / rows, x0 = w * .36, y0 = h * .12;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        var dead = (r * 7 + c * 3) % 11 === 0, flick = (r + c) % 9 === 0 && Math.sin(t * 9 + r) > .3;
        var hue = ['#2FD8FF', '#5CF2C4', '#9B7BFF', '#FF4FD8'][(r + c + Math.floor(t)) % 4];
        g.fillStyle = dead ? '#141a26' : flick ? '#FFB547' : hue;
        g.globalAlpha = dead ? 1 : .55 + .35 * Math.sin(t * 2 + r * .6 + c * .4);
        g.fillRect(x0 + c * pw + 1, y0 + r * ph + 1, pw - 2, ph - 2);
      }
      g.globalAlpha = 1;
      g.fillStyle = '#8A96A6'; g.fillRect(12, h - 44, 8, 28); g.beginPath(); g.arc(16, h - 50, 6, 0, 7); g.fill();
      var p = (t * .6) % 1, bx = 22 + p * (x0 + pw * 2 - 22), by = h - 46 - Math.sin(p * Math.PI) * h * .55;
      g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(bx, by, 4, 0, 7); g.fill();
    },
    cablerun: function (g, w, h, t, col) {
      var n = 26, pts = [];
      for (var i = 0; i < n; i++) {
        var k = t * 1.4 - i * .16;
        pts.push([w / 2 + Math.sin(k * 1.3) * w * .34 + Math.sin(k * 3.1) * 8, h / 2 + Math.cos(k * .9) * h * .32]);
      }
      g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = col;
      g.beginPath(); pts.forEach(function (p, i) { i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }); g.stroke();
      g.fillStyle = '#EDF2F8'; g.fillRect(pts[0][0] - 4, pts[0][1] - 4, 8, 8);
      var gx = w * (.25 + .5 * ((Math.floor(t / 3) * 37) % 10) / 10), gy = h * (.3 + .4 * ((Math.floor(t / 3) * 53) % 10) / 10);
      g.fillStyle = '#FFB547'; g.fillRect(gx - 5, gy - 5, 10, 10);
    },
    broken: function (g, w, h) {
      var img = g.createImageData(w, h), d = img.data;
      for (var i = 0; i < d.length; i += 4) { var v = Math.random() * 90; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
  };
  function box(g, x, y, w, h, col) {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + h - 3, w, 3);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }

  /* ----------------------------------------------------------- mount */
  function mount(opts) {
    if (open) return Promise.resolve();
    opts = opts || {};
    return Promise.all([css(), words()]).then(function (res) {
      var all = res[1], L = lang(all), W = all[L] || all.en || {};
      var w = function (k) { return W[k] || (all.en && all.en[k]) || ''; };
      var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      var touch = window.matchMedia && matchMedia('(hover: none)').matches;

      var el = document.createElement('div');
      el.id = 'arcade'; el.tabIndex = -1;
      el.setAttribute('role', 'application'); el.setAttribute('aria-label', 'Thauma ' + w('title'));
      el.innerHTML =
        '<div class="arc-scan"></div>' +
        '<header class="arc-top">' +
          '<button class="arc-back" type="button"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 3 5 8l5 5"/></svg><span>' + esc(w('back_label')) + '</span></button>' +
          '<div class="arc-logo"><b>THAUMA</b><span>' + esc(w('title')).toUpperCase() + '</span></div>' +
          '<span class="arc-spacer"></span>' +
        '</header>' +
        '<div class="arc-floor"><div class="arc-row">' + CABINETS.map(function (c) {
          return '<div class="cab" data-id="' + c.id + '" style="--c:var(' + c.c + ')">' +
            '<div class="cab-body">' +
              '<div class="cab-marquee">' + esc(w(c.id + '_title')) + '</div>' +
              '<div class="cab-screen"><canvas></canvas><div class="cab-flash"></div>' +
                (c.broken ? '<div class="cab-tape">' + esc(w('broken_label')) + '</div>' : '') + '</div>' +
              '<div class="cab-panel"><i class="cab-stick"></i><i class="cab-btn"></i><i class="cab-btn"></i></div>' +
            '</div><div class="cab-base"></div></div>';
        }).join('') + '</div></div>' +
        '<div class="arc-info" aria-live="polite"><h2 class="arc-title"></h2><p class="arc-line"></p><div class="arc-meta"></div><ol class="arc-board"></ol></div>' +
        '<div class="arc-hint"><span class="pulse">' + esc(w(touch ? 'pick_touch_hint' : 'pick_hint')) + '</span></div>';
      document.body.appendChild(el);
      if (!reduced) el.classList.add('is-on');
      el.focus({ preventScroll: true });

      var row = el.querySelector('.arc-row'), floor = el.querySelector('.arc-floor');
      var cabs = Array.prototype.slice.call(el.querySelectorAll('.cab'));
      var title = el.querySelector('.arc-title'), line = el.querySelector('.arc-line');
      var meta = el.querySelector('.arc-meta'), board = el.querySelector('.arc-board');
      var sel = 0, closing = false, raf = 0, boards = {};

      /* ---- the chosen cabinet ---- */
      function place() {
        var cab = cabs[sel];
        var tx = -(cab.offsetLeft + cab.offsetWidth / 2 - floor.clientWidth / 2);
        row.style.transform = 'translateX(' + tx + 'px)';
      }
      function rollTitle(text) {
        if (reduced || !title.animate) { title.textContent = text; return; }
        title.innerHTML = Array.from(text).map(function (c) { return '<span class="arc-ch">' + esc(c) + '</span>'; }).join('');
        Array.prototype.forEach.call(title.children, function (s, i) {
          s.animate([{ translate: '0 70%', opacity: 0 }, { translate: '0 0', opacity: 1 }],
            { duration: 420, delay: i * 28, easing: EASE, fill: 'backwards' });
        });
      }
      function describe() {
        var c = CABINETS[sel], ready = !!c.ready;
        el.style.setProperty('--c', 'var(' + c.c + ')');
        rollTitle(w(c.id + '_title'));
        line.textContent = w(c.id + '_line');
        var chips = '<span class="arc-chip">' + esc(w(c.controls + '_hint')) + '</span>';
        if (c.broken) chips += '<span class="arc-chip is-soon">' + esc(w('broken_label')) + '</span>';
        else if (!ready) chips += '<span class="arc-chip is-soon">' + esc(w('soon_label')) + '</span>';
        else chips += '<span class="arc-chip" style="--c:var(' + c.c + ')">' + esc(w('best_label')) + ' <b>' + best(c.id) + '</b></span>';
        meta.innerHTML = chips;
        showBoard(c);
      }
      function showBoard(c) {
        board.innerHTML = '';
        if (c.broken || !c.ready) return;
        var paint = function (list) {
          if (CABINETS[sel] !== c) return;
          board.innerHTML = list.length
            ? list.slice(0, 5).map(function (s) { return '<li>' + esc(s.name) + '<b>' + (s.score | 0) + '</b></li>'; }).join('')
            : '<li>' + esc(w('empty_label')) + '</li>';
        };
        if (boards[c.id]) return paint(boards[c.id]);
        boardFor(c.id).then(paint).catch(function () {});
      }
      function choose(i) {
        i = Math.max(0, Math.min(cabs.length - 1, i));
        if (i === sel && cabs[i].classList.contains('is-sel')) return;
        cabs[sel].classList.remove('is-sel');
        sel = i; cabs[sel].classList.add('is-sel');
        place(); describe();
      }
      function flash(cab, text) {
        var f = cab.querySelector('.cab-flash');
        f.textContent = text; f.classList.add('is-shown');
        cab.classList.remove('is-shake'); void cab.offsetWidth; cab.classList.add('is-shake');
        clearTimeout(f._t); f._t = setTimeout(function () { f.classList.remove('is-shown'); }, 1100);
      }
      var playing = false;
      function play() {
        var c = CABINETS[sel], cab = cabs[sel];
        if (playing) return;
        if (c.broken) return flash(cab, w('broken_label'));
        if (!c.ready) return flash(cab, w('soon_label'));
        /* A game takes the whole arcade screen until Menu (play.js). */
        playing = true;
        Promise.all([script('play', '/js/arcade/play.js'), script(c.id, '/js/arcade/games/' + c.id + '.js')])
          .then(function () {
            return window.ThaumaPlay.run(games[c.id], {
              root: el, id: c.id, words: w,
              board: function () { return boardFor(c.id); },
              submit: function (name, score) { return submit(c.id, name, score); }
            });
          })
          .then(function () { playing = false; describe(); el.focus({ preventScroll: true }); },
                function () { playing = false; flash(cab, w('broken_label')); });
      }
      function boardFor(id) {
        if (boards[id]) return Promise.resolve(boards[id]);
        return fetch('/api/game-scores?game=' + id).then(function (r) { return r.ok ? r.json() : { scores: [] }; })
          .then(function (d) { boards[id] = d.scores || []; return boards[id]; });
      }
      function submit(id, name, score) {
        return fetch('/api/game-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game: id, name: name, score: score }) })
          .then(function (r) { return r.json(); })
          .then(function (d) { boards[id] = d.scores || []; return boards[id]; });
      }

      /* ---- the attract screens ---- */
      var screens = cabs.map(function (cab) {
        var cv = cab.querySelector('canvas'), dpr = Math.min(2, window.devicePixelRatio || 1);
        var W = 160, H = 200; cv.width = W * dpr; cv.height = H * dpr;
        var g = cv.getContext('2d'); g.scale(dpr, dpr);
        /* The palette's values, read from arcade.css rather than repeated. */
        var col = getComputedStyle(el).getPropertyValue(CABINETS[cabs.indexOf(cab)].c).trim();
        return { g: g, W: W, H: H, col: col };
      });
      var t0 = performance.now(), last = 0;
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (playing || now - last < 33) return; last = now;
        var t = (now - t0) / 1000;
        screens.forEach(function (s, i) {
          if (Math.abs(i - sel) > 1 && t > .1) return;
          var c = CABINETS[i];
          s.g.clearRect(0, 0, s.W, s.H);
          (c.broken ? ATTRACT.broken : ATTRACT[c.id])(s.g, s.W, s.H, reduced ? 1 : t, s.col);
        });
      }
      raf = requestAnimationFrame(frame);

      /* ---- controls: the same three the games use ---- */
      function onKey(e) {
        if (closing || playing) return;
        var k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { choose(sel - 1); e.preventDefault(); }
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') { choose(sel + 1); e.preventDefault(); }
        else if (k === 'Enter' || k === ' ') { play(); e.preventDefault(); }
        else if (k === 'Escape' || k === 'Backspace') { leave(); e.preventDefault(); }
        e.stopPropagation();
      }
      document.addEventListener('keydown', onKey, true);
      var sx = null, sy = null;
      floor.addEventListener('pointerdown', function (e) { sx = e.clientX; sy = e.clientY; });
      floor.addEventListener('pointercancel', function () { sx = null; });
      floor.addEventListener('pointerup', function (e) {
        if (sx === null || playing) return;
        var dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { choose(sel + (dx < 0 ? 1 : -1)); return; }
        var cab = e.target.closest('.cab');
        if (!cab) return;
        var i = cabs.indexOf(cab);
        if (i === sel) play(); else choose(i);
      });
      window.addEventListener('resize', place);
      el.querySelector('.arc-back').addEventListener('click', leave);

      /* ---- the address, and Back ---- */
      var pushed = false;
      if (!opts.direct && history.pushState) {
        history.pushState({ arcade: true }, '', '/arcade/');
        pushed = true;
      }
      function onPop() { close(); }
      window.addEventListener('popstate', onPop);

      function leave() {
        if (closing) return;
        if (pushed) { history.back(); return; }   /* popstate closes */
        close();
      }
      function close() {
        if (closing) return;
        closing = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('popstate', onPop);
        window.removeEventListener('resize', place);
        el.classList.remove('is-on'); if (!reduced) el.classList.add('is-off');
        setTimeout(function () {
          el.remove(); open = null;
          if (opts.direct) { location.href = '/' + (L || 'en') + '/'; return; }
          if (opts.onExit) opts.onExit();
        }, reduced ? 0 : 420);
      }

      choose(0);
      requestAnimationFrame(place);
      open = { close: close };
    });
  }

  window.ThaumaArcade = { mount: mount, games: games, cabinets: CABINETS };
})();
