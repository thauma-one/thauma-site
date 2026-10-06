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
     the three that were in the workshop, and the two Chase asked for on
     2026-10-04 (Stage Runner, and Golden Hour, after Alto's Adventure). */
  var CABINETS = [
    { id: 'loadout',     controls: 'tap',    c: '--ar-amber',   ready: true },
    { id: 'soundcheck',  controls: 'stick',  c: '--ar-blue',    ready: true },
    { id: 'panelfixer',  controls: 'aim',    c: '--ar-magenta', ready: true },
    { id: 'cablerun',    controls: 'dpad',   c: '--ar-foam',    ready: true },
    { id: 'stagerunner', controls: 'dpad',   c: '--ar-red',     ready: true },
    { id: 'goldenhour',  controls: 'tap',    c: '--ar-amber',   ready: true },
    { id: 'followspot',  controls: 'dpad',   c: '--ar-violet',  ready: true },
    { id: 'strike',      controls: 'stick',  c: '--ar-red',     ready: true },
    { id: 'cuestack',    controls: 'lanes',  c: '--ar-blue',    ready: true }
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
    /* Panel Fixer: the tech on the lift, a ball bouncing down through the
       wall's panels, the broken ones lighting as it finds them. */
    panelfixer: function (g, w, h, t, col) {
      g.fillStyle = '#05070b'; g.fillRect(6, 44, w - 12, h - 70);
      var k = 0;
      for (var r = 0; r < 6; r++) for (var c = 0; c < 5; c++) {
        var x = 18 + c * 28 + (r % 2) * 12, y = 58 + r * 20, broken = (r * 5 + c) % 7 === 3, lit = broken && ((t * 1.3) % 6) > r;
        g.fillStyle = broken && !lit ? '#11151d' : 'hsl(' + (200 + r * 25 + c * 6) + ',80%,' + (lit ? 62 : 44) + '%)';
        g.fillRect(x, y, 16, 9);
        if (broken && !lit) { g.fillStyle = '#FF5A6E'; g.fillRect(x, y, 3, 3); }
        k++;
      }
      var p = (t * .35) % 1, bx = w / 2 + Math.sin(p * 14) * 40 * p, by = 40 + p * (h - 60);
      g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(bx, by, 3.5, 0, 7); g.fill();
      g.fillStyle = col; g.fillRect(w / 2 - 14, 30, 28, 3);
      g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(w / 2, 18, 4, 0, 7); g.fill();
      g.fillStyle = '#151a24'; g.fillRect(w / 2 - 4, 22, 8, 8);
      g.fillStyle = '#1b2230'; g.fillRect(w / 2 - 18 + Math.sin(t) * 30, h - 22, 36, 8);
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
    /* Stage Runner: three lanes running away into the venue, the stage
       manager running down the middle, cases coming. */
    stagerunner: function (g, w, h, t, col) {
      var hy = h * .3, cx = w / 2;
      var sky = g.createLinearGradient(0, 0, 0, hy); sky.addColorStop(0, '#120a1c'); sky.addColorStop(1, '#2a1030');
      g.fillStyle = sky; g.fillRect(0, 0, w, hy);
      g.fillStyle = '#0d1018'; g.beginPath(); g.moveTo(cx - 8, hy); g.lineTo(cx + 8, hy); g.lineTo(w + 30, h); g.lineTo(-30, h); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,181,71,.5)'; g.lineWidth = 1;
      [-1, 1].forEach(function (k) { g.beginPath(); g.moveTo(cx + k * 2.7, hy); g.lineTo(cx + k * w * .22, h); g.stroke(); });
      for (var i = 0; i < 6; i++) {
        var z = ((i / 6) + t * .9) % 1, y = hy + (h - hy) * z * z;
        g.fillStyle = 'rgba(255,255,255,' + (.05 + .12 * z) + ')'; g.fillRect(cx - (8 + w * .55 * z * z), y, (16 + w * 1.1 * z * z), 1);
      }
      for (var j = 0; j < 3; j++) {
        var zz = ((j / 3) + t * .5) % 1, sc = .15 + zz * zz * 1.2, lane = [-1, 0, 1][(j * 2 + Math.floor(t * .5 + j)) % 3];
        var yy = hy + (h - hy) * zz * zz;
        box(g, cx + lane * w * .27 * zz * zz - 14 * sc, yy - 18 * sc, 28 * sc, 18 * sc, j % 2 ? col : '#39445a');
      }
      var bob = Math.abs(Math.sin(t * 12)) * 4, rx = cx + Math.sin(t * 1.3) * w * .2;
      g.fillStyle = '#EDF2F8'; g.beginPath(); g.arc(rx, h - 52 - bob, 6, 0, 7); g.fill();
      g.fillStyle = '#1b2231'; g.fillRect(rx - 7, h - 46 - bob, 14, 18);
      g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(rx, h - 53 - bob, 7.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.fillStyle = '#1b2231'; g.fillRect(rx - 6 + Math.sin(t * 12) * 3, h - 28 - bob, 4, 14); g.fillRect(rx + 2 - Math.sin(t * 12) * 3, h - 28 - bob, 4, 14);
    },
    /* Golden Hour: a road case on a long sunset hill, the stage far off. */
    goldenhour: function (g, w, h, t) {
      var sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#2b1a4a'); sky.addColorStop(.55, '#e8765a'); sky.addColorStop(1, '#ffc27a');
      g.fillStyle = sky; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,240,200,.9)'; g.beginPath(); g.arc(w * .72, h * .46, 16, 0, 7); g.fill();
      g.fillStyle = 'rgba(70,30,60,.55)';
      g.beginPath(); g.moveTo(0, h * .62); for (var x = 0; x <= w; x += 8) g.lineTo(x, h * .6 + Math.sin(x * .03 + t * .2) * 10); g.lineTo(w, h); g.lineTo(0, h); g.fill();
      g.fillStyle = 'rgba(40,16,40,.9)'; g.fillRect(w * .2, h * .52, 22, 10); g.fillRect(w * .2 + 2, h * .45, 2, 8); g.fillRect(w * .2 + 18, h * .45, 2, 8);
      var off = t * 60, ground = function (x) { return h * .78 + Math.sin((x + off) * .022) * 16 + Math.sin((x + off) * .009) * 10; };
      g.fillStyle = '#2a1426'; g.beginPath(); g.moveTo(0, h); for (var x2 = 0; x2 <= w; x2 += 4) g.lineTo(x2, ground(x2)); g.lineTo(w, h); g.fill();
      var px = w * .42, py = ground(px), ang = Math.atan2(ground(px + 4) - ground(px - 4), 8);
      g.save(); g.translate(px, py - 4); g.rotate(ang);
      g.fillStyle = '#121620'; g.fillRect(-12, -6, 24, 7); g.fillStyle = '#FFB547'; g.fillRect(-12, -1, 24, 2);
      g.fillStyle = '#121620'; g.beginPath(); g.arc(0, -15, 4, 0, 7); g.fill(); g.fillRect(-3, -12, 6, 7);
      g.restore();
    },
    /* Follow Spot: the light finding the performer. */
    followspot: function (g, w, h, t, col) {
      g.fillStyle = '#05060a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#14101c'; g.fillRect(0, h * .78, w, h * .22);
      var px = w / 2 + Math.sin(t * 1.4) * w * .32 + Math.sin(t * 3.1) * 10, sx = w / 2 + Math.sin(t * 1.4 - .35) * w * .32;
      var gr = g.createRadialGradient(sx, h * .66, 2, sx, h * .66, 34);
      gr.addColorStop(0, 'rgba(255,245,220,.75)'); gr.addColorStop(1, 'rgba(255,245,220,0)');
      g.fillStyle = 'rgba(255,245,220,.06)'; g.beginPath(); g.moveTo(w / 2 - 4, 0); g.lineTo(w / 2 + 4, 0); g.lineTo(sx + 30, h * .66); g.lineTo(sx - 30, h * .66); g.closePath(); g.fill();
      g.fillStyle = gr; g.beginPath(); g.ellipse(sx, h * .7, 34, 30, 0, 0, 7); g.fill();
      g.fillStyle = col; g.beginPath(); g.arc(px, h * .6, 5, 0, 7); g.fill(); g.fillRect(px - 5, h * .62, 10, 16);
      g.fillRect(px - 5, h * .72, 4, 10); g.fillRect(px + 1, h * .72, 4, 10);
    },
    /* Strike: letter bricks, and the ball. */
    strike: function (g, w, h, t, col) {
      g.fillStyle = '#0a0b12'; g.fillRect(0, 0, w, h);
      var word = 'THAUMAGIVE', bw = (w - 16) / 5;
      for (var r = 0; r < 4; r++) for (var c = 0; c < 5; c++) {
        if ((r * 5 + c + Math.floor(t * .7)) % 7 === 0) continue;
        g.fillStyle = ['#FF5A6E', '#FFB547', '#9B7BFF', '#2FD8FF'][r];
        g.fillRect(8 + c * bw + 1, 16 + r * 18, bw - 2, 15);
        g.fillStyle = '#0a0b12'; g.font = '600 9px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(word[(r * 5 + c) % word.length], 8 + c * bw + bw / 2, 16 + r * 18 + 8);
      }
      var bx = w / 2 + Math.sin(t * 2.3) * w * .38, by = h * .55 + Math.sin(t * 3.7) * h * .25;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(bx, by, 3.5, 0, 7); g.fill();
      g.fillStyle = col; g.fillRect(Math.max(4, Math.min(w - 44, bx - 20)), h - 16, 40, 5);
    },
    /* Cue Stack: four lanes, cues falling to the line. */
    cuestack: function (g, w, h, t, col) {
      g.fillStyle = '#070912'; g.fillRect(0, 0, w, h);
      var lw = w / 4, cols = ['#FF4FD8', '#2FD8FF', '#5CF2C4', '#FFB547'];
      for (var l = 0; l < 4; l++) { g.fillStyle = l % 2 ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.015)'; g.fillRect(l * lw, 0, lw, h); }
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, h - 30, w, 2);
      for (var k = 0; k < 10; k++) {
        var lane = (k * 7 + 3) % 4, y = ((k / 10) + t * .55) % 1 * (h + 20) - 20;
        g.fillStyle = cols[lane]; g.fillRect(lane * lw + 5, y, lw - 10, 8);
      }
      var beat = (t * 2) % 1;
      g.fillStyle = 'rgba(255,255,255,' + (.25 * (1 - beat)) + ')'; g.fillRect(0, h - 36, w, 14);
    }
  };
  function box(g, x, y, w, h, col) {
    g.fillStyle = col; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + h - 3, w, 3);
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  }

  /* ----------------------------------------------------------- mount */
  /* the jukebox's tracks: the arcade's own theme, then each cabinet's tune,
     then Cue Stack's other two songs */
  var JUKE = [{ tune: 'menu', key: 'jukebox_theme' }].concat(CABINETS.map(function (c) {
    return { tune: c.id, key: c.id + '_title', sub: c.id === 'cuestack' ? 'cuestack_song_main' : null };
  })).concat([{ tune: 'cuestack_funk', key: 'cuestack_title', sub: 'cuestack_song_funk' }, { tune: 'cuestack_synth', key: 'cuestack_title', sub: 'cuestack_song_synth' }]);

  function mount(opts) {
    if (open) return Promise.resolve();
    opts = opts || {};
    return Promise.all([css(), words(), script('sound', '/js/arcade/sound.js').catch(function () {})]).then(function (res) {
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
          '<div class="arc-tools">' +
          /* the jukebox: every tune the arcade has, to play here (J) */
          '<button class="arc-jukebtn" type="button" aria-expanded="false" aria-label="' + esc(w('jukebox_label')) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>' +
            '<span>' + esc(w('jukebox_label')) + '</span></button>' +
          /* the one switch for music and sound, off until it is turned on (M) */
          '<button class="arc-sound" type="button" aria-pressed="false" aria-label="' + esc(w('sound_label')) + '">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4 9h4l5-4v14l-5-4H4z"/><path class="on" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/><path class="off" d="M17 9l5 6M22 9l-5 6"/></svg>' +
            '<span>' + esc(w('sound_label')) + '</span></button>' +
          '</div>' +
        '</header>' +
        '<div class="arc-juke" role="dialog" aria-label="' + esc(w('jukebox_label')) + '" hidden>' +
          '<div class="arc-juke-head"><b>' + esc(w('jukebox_label')).toUpperCase() + '</b>' +
            '<button class="arc-juke-x" type="button" aria-label="' + esc(w('jukebox_close')) + '"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
          '<ol>' + JUKE.map(function (t) {
            return '<li><button type="button" data-tune="' + t.tune + '"><span class="t">' + esc(w(t.key)) + (t.sub ? ' <small>' + esc(w(t.sub)) + '</small>' : '') + '</span>' +
              '<span class="b">' + (window.ThaumaSound && window.ThaumaSound.bpm ? window.ThaumaSound.bpm(t.tune) + ' BPM' : '') + '</span><i class="eq"><i></i><i></i><i></i></i></button></li>';
          }).join('') + '</ol></div>' +
        '<div class="arc-floor"><div class="arc-zoom"><div class="arc-row">' + CABINETS.map(function (c) {
          return '<div class="cab" data-id="' + c.id + '" style="--c:var(' + c.c + ')">' +
            '<div class="cab-body">' +
              '<div class="cab-marquee">' + esc(w(c.id + '_title')) + '</div>' +
              '<div class="cab-screen"><canvas></canvas><div class="cab-flash"></div>' +
                '</div>' +
              '<div class="cab-panel"><i class="cab-stick"></i><i class="cab-btn"></i><i class="cab-btn"></i></div>' +
              '<div class="cab-door"><i class="cab-slot"></i><i class="cab-coin"></i></div>' +
            '</div><div class="cab-base"></div></div>';
        }).join('') + '</div></div></div>' +
        '<div class="arc-info" aria-live="polite"><h2 class="arc-title"></h2><p class="arc-line"></p><div class="arc-meta"></div><ol class="arc-board"></ol></div>' +
        '<div class="arc-hint"><span class="pulse">' + esc(w(touch ? 'pick_touch_hint' : 'pick_hint')) + '</span></div>';
      document.body.appendChild(el);
      if (!reduced) el.classList.add('is-on');
      el.focus({ preventScroll: true });

      /* ---- sound: the switch, and the menu's tune ---- */
      var S = window.ThaumaSound, soundBtn = el.querySelector('.arc-sound');
      function soundShown(isOn) { soundBtn.setAttribute('aria-pressed', isOn ? 'true' : 'false'); soundBtn.classList.toggle('is-on', isOn); }
      if (S) {
        soundShown(S.on); S.onChange(function (v) { if (document.body.contains(soundBtn)) soundShown(v); });
        S.music('menu');
        soundBtn.addEventListener('click', function () { S.toggle(); });
      } else soundBtn.hidden = true;
      function sfx(n) { if (S) S.sfx(n); }

      /* ---- the jukebox (Chase, 2026-10-05: "Can we also add a Jukebox????
         We can add these custom arcade songs!") ---- */
      var juke = el.querySelector('.arc-juke'), jukeBtn = el.querySelector('.arc-jukebtn');
      if (!S) jukeBtn.hidden = true;
      function jukeShown() {
        var now = S && S.on ? S.now() : null;
        Array.prototype.forEach.call(juke.querySelectorAll('[data-tune]'), function (b) {
          var on = b.dataset.tune === now; b.classList.toggle('is-playing', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      function jukeOpen(v) {
        juke.hidden = !v; jukeBtn.setAttribute('aria-expanded', v ? 'true' : 'false');
        if (v) { jukeShown(); var cur = juke.querySelector('.is-playing') || juke.querySelector('[data-tune]'); cur.focus({ preventScroll: true }); cur.scrollIntoView({ block: 'nearest' }); }
        else el.focus({ preventScroll: true });
        sfx(v ? 'pausein' : 'pauseout');
      }
      jukeBtn.addEventListener('click', function () { jukeOpen(juke.hidden); });
      juke.querySelector('.arc-juke-x').addEventListener('click', function () { jukeOpen(false); });
      juke.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tune]'); if (!b || !S) return;
        if (!S.on) S.set(true);
        S.music(b.dataset.tune); jukeShown();
      });
      if (S) S.onChange(function () { if (document.body.contains(juke)) jukeShown(); });

      var row = el.querySelector('.arc-row'), floor = el.querySelector('.arc-floor'), zoom = el.querySelector('.arc-zoom');
      var cabs = Array.prototype.slice.call(el.querySelectorAll('.cab'));
      var title = el.querySelector('.arc-title'), line = el.querySelector('.arc-line');
      var meta = el.querySelector('.arc-meta'), board = el.querySelector('.arc-board');
      var sel = 0, closing = false, raf = 0, boards = {};
      /* OUT OF ORDER: games an admin has closed for this site (Website ›
         Arcade, /api/game-scores?config). Asked once as the arcade opens; if
         the answer never comes, every game stays open. */
      var closed = {};
      function playable(c) { return !!c.ready && !closed[c.id]; }
      fetch('/api/game-scores?config=1', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || !d.closed) return;
        d.closed.forEach(function (id) { closed[id] = true; });
        cabs.forEach(function (cab, i) { cab.classList.toggle('is-closed', !!closed[CABINETS[i].id]); });
        if (!closing && !playing) describe();
      }).catch(function () {});

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
        var c = CABINETS[sel], ready = playable(c);
        el.style.setProperty('--c', 'var(' + c.c + ')');
        rollTitle(w(c.id + '_title'));
        line.textContent = w(c.id + '_line');
        var chips = '<span class="arc-chip">' + esc(w(c.controls + '_hint')) + '</span>';
        if (!ready) chips += '<span class="arc-chip is-soon">' + esc(w(closed[c.id] ? 'broken_label' : 'soon_label')) + '</span>';
        else chips += '<span class="arc-chip" style="--c:var(' + c.c + ')">' + esc(w('best_label')) + ' <b>' + best(c.id) + '</b></span>';
        meta.innerHTML = chips;
        showBoard(c);
      }
      function showBoard(c) {
        board.innerHTML = '';
        if (!playable(c)) return;
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
        place(); describe(); sfx('move');
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
        if (!playable(c)) return flash(cab, w(closed[c.id] ? 'broken_label' : 'soon_label'));
        /* A game takes the whole arcade screen until Menu (play.js). */
        playing = true;
        var loaded = Promise.all([script('play', '/js/arcade/play.js'), script(c.id, '/js/arcade/games/' + c.id + '.js')]);
        /* THE WAY IN (Chase, 2026-10-04: a coin, then the screen, 2–3
           seconds): a coin drops into the cabinet's door with the two
           notes every arcade has, the screen says CREDIT 1, and the view
           dives into the cabinet's screen until it is the whole screen. */
        entrance(cab).then(function () { return loaded; })
          .then(function () {
            return window.ThaumaPlay.run(games[c.id], {
              root: el, id: c.id, words: w, color: 'var(' + c.c + ')',
              board: function () { return boardFor(c.id); },
              submit: function (name, score) { return submit(c.id, name, score); }
            });
          })
          .then(function () { playing = false; exitZoom(); describe(); el.focus({ preventScroll: true }); },
                function () { playing = false; exitZoom(); flash(cab, w('broken_label')); });
      }
      function entrance(cab) {
        sfx('coin');
        if (reduced) return new Promise(function (res) { setTimeout(res, 200); });
        cab.classList.add('is-coin');
        var f = cab.querySelector('.cab-flash');
        setTimeout(function () { f.textContent = w('credit_label'); f.classList.add('is-shown'); sfx('start'); }, 420);
        return new Promise(function (res) {
          setTimeout(function () {
            /* the cabinet's screen, grown to the size of this one */
            var r = cab.querySelector('.cab-screen').getBoundingClientRect(), z = zoom.getBoundingClientRect();
            var k = Math.max(innerWidth / r.width, innerHeight / r.height) * 1.08;
            var cx = r.left + r.width / 2 - z.left, cy = r.top + r.height / 2 - z.top;
            zoom.style.transformOrigin = cx + 'px ' + cy + 'px';
            zoom.style.transform = 'translate(' + (innerWidth / 2 - (r.left + r.width / 2)) + 'px,' + (innerHeight / 2 - (r.top + r.height / 2)) + 'px) scale(' + k + ')';
            el.classList.add('is-diving');
            setTimeout(res, 950);
          }, 900);
        });
      }
      function exitZoom() {
        cabs.forEach(function (cb) { cb.classList.remove('is-coin'); var f = cb.querySelector('.cab-flash'); f.classList.remove('is-shown'); });
        el.classList.remove('is-diving');
        zoom.style.transform = ''; 
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
          ATTRACT[c.id](s.g, s.W, s.H, reduced ? 1 : t, s.col);
          if (closed[c.id]) outOfOrder(s.g, s.W, s.H, t);
        });
      }
      raf = requestAnimationFrame(frame);
      /* the game still playing to itself behind static, and a strip of tape
         across the glass */
      function outOfOrder(g, W, H, t) {
        g.fillStyle = 'rgba(4,6,10,.55)'; g.fillRect(0, 0, W, H);
        for (var i = 0; i < 260; i++) { var v = Math.random() * 255 | 0; g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',.35)'; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
        var band = (t * 60) % H; g.fillStyle = 'rgba(237,242,248,.08)'; g.fillRect(0, band, W, 10);
        g.save(); g.translate(W / 2, H / 2); g.rotate(-.18);
        g.fillStyle = '#FFD34A'; g.fillRect(-W * .62, -13, W * 1.24, 26);
        g.fillStyle = '#10131a'; g.font = '800 12px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(w('broken_label').toUpperCase(), 0, 1);
        g.restore();
      }

      /* ---- controls: the same three the games use ---- */
      function onKey(e) {
        if (closing || playing) return;
        var k = e.key;
        /* the jukebox open: Esc (or J) closes it, ↑ ↓ move through it, Enter plays */
        if (!juke.hidden) {
          if (k === 'Escape' || k === 'j' || k === 'J') { jukeOpen(false); e.preventDefault(); }
          else if (k === 'ArrowDown' || k === 'ArrowUp') {
            var list = Array.prototype.slice.call(juke.querySelectorAll('[data-tune]')), at = list.indexOf(document.activeElement);
            var to = list[Math.max(0, Math.min(list.length - 1, at + (k === 'ArrowDown' ? 1 : -1)))]; to.focus(); to.scrollIntoView({ block: 'nearest' }); e.preventDefault();
          }
          else if ((k === 'Enter' || k === ' ') && document.activeElement && juke.contains(document.activeElement)) { document.activeElement.click(); e.preventDefault(); }
          else if (k === 'm' || k === 'M') { if (S) S.toggle(); }
          e.stopPropagation();
          return;
        }
        if (k === 'j' || k === 'J') { if (S) jukeOpen(true); e.preventDefault(); e.stopPropagation(); return; }
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') { choose(sel - 1); e.preventDefault(); }
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') { choose(sel + 1); e.preventDefault(); }
        else if (k === 'Enter' || k === ' ') { play(); e.preventDefault(); }
        else if (k === 'Escape' || k === 'Backspace') { leave(); e.preventDefault(); }
        else if (k === 'm' || k === 'M') { if (S) S.toggle(); }
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
        if (S) S.music(null);
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
