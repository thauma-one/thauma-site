/* =====================================================================
   Strike — break the wall, and the show goes wild (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-30: brick breaker where every brick is a letter;
   "spelling the target word in order, in a row, triggers a rare super
   power … Those words don't really have anything to do with the site …
   those power ups are tame. I want something WILD!"

   ROUND 4 (Chase, 2026-10-05: "Let's just lean into the brick breaker
   aspect. Spelling seems to be too hard, but we should still have those
   crazy powerful power ups"): no spelling. A brick breaker on an LED
   wall, a new pattern every set, armored bricks (road cases) that take
   two or three hits, and bricks that drop CAPSULES — catch one with the
   fader for its power, each labeled with its name:
     WIDE (a wider fader) · MULTIBALL (two more balls)
     PYRO (flame up every column) · LASER SHOW (lasers cut the wall)
     CONFETTI CANNON (two dozen little balls) · BASS DROP (every brick takes
     a hit, three times) · ENCORE (the ball three times the size, going
     straight through)

   The stick (play.js): drag the fader under the play area on a phone,
   ← → on a desktop. Space (or a tap) serves.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, BW = 42, BH = 20, COLS = 8, R = 5;
  var WILD = ['pyro', 'laser', 'confetti', 'bass', 'encore'];
  /* what a capsule can hold: the two helpers more often than the wild five */
  var DROPS = ['wide', 'wide', 'multi', 'multi', 'pyro', 'laser', 'confetti', 'bass', 'encore'];
  var DROPCOL = { wide: '#5CF2C4', multi: '#2FD8FF', pyro: '#FF5A6E', laser: '#FF4FD8', confetti: '#FFD34A', bass: '#9B7BFF', encore: '#FFB547' };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  A.games.strike = {
    size: function (o) { return { w: W, h: o && o.touch ? 540 : 600 }; },
    /* a phone gets two arrows, as Soundcheck does (Chase, 2026-10-05) */
    controls: function (o) { return o && o.touch ? 'dpad' : 'stick'; },
    padStart: ['left', 'right'],
    speaker: 'PYRO',
    quipAt: .13,
    create: function (ctx) {
      var words = ctx.words, H = ctx.H, PY = H - 36;
      var bricks = [], balls = [], drops = [], fx = [], sparks = [], pops = [];
      var pad = { x: W / 2, w: 74, wide: 0 }, lives = 3, level = 0, score = 0, time = 0, serveT = 1.2, wildT = 0, wildName = null;

      /* the wall, set by set: a pattern to clear (a full wall, a pyramid,
         a checkerboard, a heart, arches, stripes), more rows and more
         armor as the sets go */
      var PATTERNS = [
        function (r, c) { return true; },
        function (r, c) { return Math.abs(c - 3.5) <= r * .7 + .5; },
        function (r, c) { return (r + c) % 2 === 0; },
        function (r, c) { var x = (c - 3.5) / 3.6, y = (2.8 - r) / 3; return Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y < 0; },
        function (r, c) { return r < 2 || c % 3 !== 1; },
        function (r, c) { return r % 2 === 0 || c === 0 || c === 7; }
      ];
      function nextLevel() {
        level++;
        bricks = [];
        var rows = Math.min(8, 4 + Math.floor(level / 2)), pat = PATTERNS[(level - 1) % PATTERNS.length];
        for (var r = 0; r < rows; r++) for (var c = 0; c < COLS; c++) {
          if (!pat(r, c)) continue;
          var armor = level > 1 && Math.random() < Math.min(.3, .06 * level) ? (level > 3 && Math.random() < .3 ? 3 : 2) : 1;
          bricks.push({ x: 12 + c * BW + BW / 2 - 6, y: 96 + r * (BH + 4), hp: armor, max: armor, row: r, hitT: -9 });
        }
        if (!bricks.length) return nextLevel();
        balls = []; serve();
        ctx.say(words('strike_level') + ' ' + level, { tag: 'PYRO' });
      }
      function serve() { balls.push({ x: pad.x, y: PY - 12, vx: 0, vy: 0, speed: 255 + level * 14, stuck: true, big: false }); serveT = 1.2; }
      function launch(b) { var a = rnd(-.5, .5); b.vx = Math.sin(a) * b.speed; b.vy = -Math.cos(a) * b.speed; b.stuck = false; ctx.sfx('hit'); }

      /* --------------------------------------------------- the letters */
      function hit(br, b) {
        br.hp--; br.hitT = time;
        score += 10; ctx.sfx(br.hp > 0 ? 'wall' : 'good');
        if (br.hp <= 0) {
          br.dead = true; score += 10 * br.max;
          for (var i = 0; i < 8; i++) sparks.push({ x: br.x, y: br.y, vx: rnd(-120, 120), vy: rnd(-120, 60), life: .45, c: colorOf(br) });
          /* a capsule, now and then: catch it with the fader */
          if (Math.random() < .13) drops.push({ x: br.x, y: br.y, kind: DROPS[Math.floor(Math.random() * DROPS.length)] });
        }
        ctx.score(score);
      }
      function colorOf(br) { return ['#FF5A6E', '#FFB547', '#9B7BFF', '#2FD8FF', '#5CF2C4', '#FF4FD8', '#FFD34A', '#8FEBFF'][br.row % 8]; }

      /* ------------------------------------------------ the WILD powers */
      function wild(name) {
        wildName = name; wildT = 2.2;
        score += 100; ctx.score(score);
        ctx.sfx('boom'); ctx.shake(8);
        ctx.say('[PYRO] ' + words('strike_' + wildName), { mood: 'good' });
        ctx.quip('jokes_strike_wild', { mood: 'good', force: false });
        if (wildName === 'pyro') for (var c = 0; c < 5; c++) fx.push({ kind: 'pyro', x: 30 + c * 75 + rnd(-10, 10), t: -c * .12 });
        if (wildName === 'laser') for (var k = 0; k < 4; k++) fx.push({ kind: 'laser', t: -k * .25, dir: k % 2 ? 1 : -1, y0: 80 + k * 50 });
        if (wildName === 'confetti') for (var j = 0; j < 24; j++) { var a = rnd(-1.2, 1.2); balls.push({ x: pad.x, y: PY - 14, vx: Math.sin(a) * 380, vy: -Math.cos(a) * 380, speed: 380, confetti: 6, hue: j * 15 }); }
        if (wildName === 'bass') fx.push({ kind: 'bass', t: 0, drops: 0 });
        if (wildName === 'encore') balls.forEach(function (b) { b.big = 8; });
      }
      function runFx(dt) {
        fx.forEach(function (f) {
          f.t += dt;
          if (f.t < 0) return;
          if (f.kind === 'pyro') {
            /* a jet of flame up the column, burning what it touches */
            var top = H - f.t * 900;
            bricks.forEach(function (br) { if (!br.dead && Math.abs(br.x - f.x) < 26 && br.y > top) { br.hp = 0; hitDead(br); } });
            if (Math.random() < .6) sparks.push({ x: f.x + rnd(-14, 14), y: Math.max(top, 60), vx: rnd(-40, 40), vy: rnd(-80, 0), life: .5, c: Math.random() < .5 ? '#FFB547' : '#FF5A6E' });
          }
          if (f.kind === 'laser') {
            var ang = f.dir * (-.6 + f.t * .8), x0 = f.dir > 0 ? 0 : W;
            bricks.forEach(function (br) {
              if (br.dead) return;
              var y = f.y0 + Math.tan(ang) * (br.x - x0) * f.dir;
              if (Math.abs(br.y - y) < 12) { br.hp = 0; hitDead(br); }
            });
            f.ang = ang;
          }
          if (f.kind === 'bass') {
            var n = Math.floor(f.t / .55);
            if (n > f.drops && f.drops < 3) {
              f.drops++; ctx.shake(10); ctx.sfx('boom');
              bricks.forEach(function (br) { if (!br.dead) { br.hp--; br.y += 6; if (br.hp <= 0) hitDead(br); } });
            }
          }
        });
        fx = fx.filter(function (f) { return f.t < (f.kind === 'pyro' ? .9 : f.kind === 'laser' ? 1.7 : 1.8); });
      }
      function hitDead(br) {
        if (br.dead) return;
        br.dead = true; score += 15; ctx.score(score);
        for (var i = 0; i < 6; i++) sparks.push({ x: br.x, y: br.y, vx: rnd(-160, 160), vy: rnd(-160, 40), life: .5, c: colorOf(br) });
      }

      nextLevel();

      /* --------------------------------------------------------- update */
      function update(dt) {
        time += dt;
        var s = ctx.stick();
        pad.wide = Math.max(0, pad.wide - dt);
        pad.w = pad.wide > 0 ? 120 : 74;
        pad.x = clamp(pad.x + s * 520 * dt, pad.w / 2, W - pad.w / 2);
        wildT = Math.max(0, wildT - dt);
        runFx(dt);

        var n = Math.max(1, Math.ceil(dt * 700 / 5));
        for (var k = 0; k < n; k++) balls.forEach(function (b) { step(b, dt / n); });
        balls = balls.filter(function (b) { return !b.gone; });
        balls.forEach(function (b) { if (b.stuck) { b.trail = []; return; } (b.trail = b.trail || []).push({ x: b.x, y: b.y }); if (b.trail.length > 7) b.trail.shift(); });
        if (!balls.some(function (b) { return !b.confetti; })) {
          lives--; ctx.sfx('miss'); ctx.shake(5);
          ctx.quip('jokes_strike_drop', { mood: 'bad', force: true });
          if (lives <= 0) { lives = 0; balls = []; setTimeout(function () { ctx.over(); }, 900); update = function () {}; return; }
          serve();
        }
        drops.forEach(function (d) {
          d.y += 120 * dt;
          if (d.y > PY - 8 && d.y < PY + 8 && Math.abs(d.x - pad.x) < pad.w / 2 + 8) {
            d.got = true; ctx.sfx('powerup');
            if (d.kind === 'wide') { pad.wide = 12; wildName = 'wide'; wildT = 1.4; }
            else if (d.kind === 'multi') { wildName = 'multi'; wildT = 1.4; balls.filter(function (b) { return !b.confetti; }).slice(0, 1).forEach(function (b) {
              [-.4, .4].forEach(function (a) { balls.push({ x: b.x, y: b.y, vx: Math.sin(a) * b.speed, vy: -Math.cos(a) * b.speed, speed: b.speed }); });
            }); }
            else wild(d.kind);
          }
        });
        drops = drops.filter(function (d) { return !d.got && d.y < H + 10; });
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }); sparks = sparks.filter(function (p) { return p.life > 0; });
        pops.forEach(function (p) { p.y -= 30 * dt; p.life -= dt; }); pops = pops.filter(function (p) { return p.life > 0; });
        bricks = bricks.filter(function (b) { return !b.dead; });
        if (!bricks.length) {
          score += 500 + lives * 100; ctx.score(score); ctx.sfx('newbest');
          ctx.quip('jokes_strike_clear', { mood: 'good', force: true });
          nextLevel();
        }
      }
      function step(b, dt) {
        if (b.stuck) {
          b.x = pad.x; b.y = PY - 12;
          serveT -= dt; if (serveT <= 0) launch(b);
          return;
        }
        if (b.confetti) { b.confetti -= dt; if (b.confetti <= 0) { b.gone = true; return; } }
        if (b.big) { b.big -= dt; if (b.big <= 0) b.big = false; }
        var r = b.big ? R * 3 : R;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < r) { b.x = r; b.vx = Math.abs(b.vx); ctx.sfx('wall'); }
        if (b.x > W - r) { b.x = W - r; b.vx = -Math.abs(b.vx); ctx.sfx('wall'); }
        if (b.y < 64 + r) { b.y = 64 + r; b.vy = Math.abs(b.vy); }
        if (b.y > H + 20) { b.gone = true; return; }
        /* the paddle: where it lands sets the angle */
        if (b.vy > 0 && b.y + r >= PY - 5 && b.y < PY + 6 && Math.abs(b.x - pad.x) < pad.w / 2 + r) {
          var off = clamp((b.x - pad.x) / (pad.w / 2), -1, 1), a = off * 1.05;
          b.speed = Math.min(520, (b.speed || 255) * 1.008);   /* gentler (round 3: was ×1.012 to 620) */
          b.vx = Math.sin(a) * b.speed; b.vy = -Math.cos(a) * b.speed; b.y = PY - 5 - r;
          ctx.sfx('hit');
        }
        /* the bricks */
        for (var i = 0; i < bricks.length; i++) {
          var br = bricks[i];
          if (br.dead) continue;
          var hw = BW / 2 - 1 + r, hh = BH / 2 + r;
          var dx = b.x - br.x, dy = b.y - br.y;
          if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
            hit(br, b);
            if (b.big) continue;                                  /* the encore ball goes straight through */
            if (hw - Math.abs(dx) < hh - Math.abs(dy)) b.vx = dx > 0 ? Math.abs(b.vx) : -Math.abs(b.vx);
            else b.vy = dy > 0 ? Math.abs(b.vy) : -Math.abs(b.vy);
            break;
          }
        }
      }

      /* -------------------------------------------------------- drawing */
      function draw(g) {
        /* the stage: a dark house, an LED wall behind the letters breathing
           slowly through the colors, a truss of PAR cans whose soft beams
           sweep, and the stage floor's lit edge under the fader */
        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0a0b14'); bg.addColorStop(1, '#120a18');
        g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);
        var hue = (time * 12) % 360;
        var led = g.createLinearGradient(0, 70, W, 300);
        led.addColorStop(0, 'hsla(' + hue + ',70%,45%,.10)'); led.addColorStop(1, 'hsla(' + ((hue + 140) % 360) + ',70%,45%,.10)');
        g.fillStyle = led; g.fillRect(6, 70, W - 12, 290);
        g.fillStyle = 'rgba(0,0,0,.4)';
        for (var lx = 6; lx < W - 6; lx += 6) g.fillRect(lx, 70, 1, 290);
        for (var ly = 70; ly < 360; ly += 6) g.fillRect(6, ly, W - 12, 1);
        var fade = g.createLinearGradient(0, 290, 0, 362);
        fade.addColorStop(0, 'rgba(15,10,22,0)'); fade.addColorStop(1, 'rgba(15,10,22,1)');
        g.fillStyle = fade; g.fillRect(0, 290, W, 72);
        g.save(); g.globalCompositeOperation = 'lighter';
        for (var i = 0; i < 6; i++) {
          var parX = 30 + i * 60, a = Math.sin(time * .6 + i * 1.1) * .35, bh = ['190,75%', '300,80%', '45,90%', '160,75%', '220,80%', '330,80%'][i];
          g.save(); g.translate(parX, 66); g.rotate(a);
          var gr = g.createLinearGradient(0, 0, 0, H - 80);
          gr.addColorStop(0, 'hsla(' + bh + ',65%,.16)'); gr.addColorStop(1, 'hsla(' + bh + ',65%,0)');
          g.fillStyle = gr; g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.lineTo(46, H - 80); g.lineTo(-46, H - 80); g.closePath(); g.fill();
          g.restore();
        }
        g.restore();
        g.strokeStyle = '#2a3142'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 58); g.lineTo(W, 58); g.moveTo(0, 66); g.lineTo(W, 66);
        for (var tx = 0; tx < W; tx += 10) { g.moveTo(tx, 58); g.lineTo(tx + 5, 66); g.lineTo(tx + 10, 58); } g.stroke();
        for (var c = 0; c < 6; c++) { g.fillStyle = '#1b2130'; g.fillRect(24 + c * 60, 64, 12, 9); }
        g.fillStyle = 'rgba(255,90,110,.18)'; g.fillRect(0, PY + 12, W, 1.5);
        fx.forEach(function (f) { drawFx(g, f); });
        bricks.forEach(function (br) { brick(g, br); });
        /* a capsule: a lit pill with its name on it, so it is clear what
           catching it will do */
        drops.forEach(function (d) {
          var dc = DROPCOL[d.kind], name = words('strike_' + d.kind).toUpperCase();
          g.font = '700 9px Sora, sans-serif'; var tw = Math.max(40, g.measureText(name).width + 16);
          g.fillStyle = dc; g.shadowColor = dc; g.shadowBlur = 12; round(g, d.x - tw / 2, d.y - 8, tw, 16, 8); g.fill(); g.shadowBlur = 0;
          g.fillStyle = '#0b0e14'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, d.x, d.y + 1);
        });
        balls.forEach(function (b) {
          var r = b.big ? R * 3 : R, col = b.confetti ? 'hsl(' + b.hue + ',90%,65%)' : b.big ? '#FFB547' : '#ffffff';
          /* a short trail, so its path can be read at speed */
          (b.trail || []).forEach(function (t, i, all) {
            g.globalAlpha = (i + 1) / all.length * .35; g.fillStyle = col;
            g.beginPath(); g.arc(t.x, t.y, r * (.4 + .6 * (i + 1) / all.length), 0, 7); g.fill();
          });
          g.globalAlpha = 1;
          g.fillStyle = col; g.shadowColor = b.big ? '#FFB547' : 'rgba(180,230,255,.9)'; g.shadowBlur = b.big ? 18 : 10;
          g.beginPath(); g.arc(b.x, b.y, r, 0, 7); g.fill(); g.shadowBlur = 0;
        });
        /* the fader: a ridged cap with its channel's light */
        var px = pad.x - pad.w / 2;
        g.fillStyle = 'rgba(255,90,110,.18)'; g.beginPath(); g.ellipse(pad.x, PY + 9, pad.w * .55, 5, 0, 0, 7); g.fill();
        var cap = g.createLinearGradient(0, PY - 7, 0, PY + 7);
        cap.addColorStop(0, '#3a4456'); cap.addColorStop(1, '#151a24');
        g.fillStyle = cap; round(g, px, PY - 7, pad.w, 14, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,.12)'; for (var rx = px + 8; rx < px + pad.w - 6; rx += 6) g.fillRect(rx, PY - 5, 1, 4);
        g.fillStyle = '#FF5A6E'; g.shadowColor = '#FF5A6E'; g.shadowBlur = 12; g.fillRect(px + 6, PY + 1, pad.w - 12, 2.5); g.shadowBlur = 0;
        sparks.forEach(function (p) { g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.c; g.fillRect(p.x, p.y, 2.5, 2.5); });
        g.globalAlpha = 1;
        pops.forEach(function (p) { g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.col; g.font = '700 14px Sora, sans-serif'; g.textAlign = 'center'; g.fillText(p.text, p.x, p.y); });
        g.globalAlpha = 1;
        if (wildT > 0) {
          g.globalAlpha = Math.min(1, wildT); g.font = '700 30px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = '#FFB547'; g.shadowColor = '#FF5A6E'; g.shadowBlur = 24; g.fillText(words('strike_' + wildName).toUpperCase(), W / 2, H * .55); g.shadowBlur = 0; g.globalAlpha = 1;
        }
        /* lives */
        for (var l = 0; l < lives; l++) { g.fillStyle = '#fff'; g.beginPath(); g.arc(W - 14 - l * 14, H - 12, 4, 0, 7); g.fill(); }
        g.fillStyle = 'rgba(138,150,166,.8)'; g.font = '600 9px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.fillText(words('strike_level').toUpperCase() + ' ' + level, 12, H - 12);
      }
      function round(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }
      /* a brick is a lit LED tile: rounded, a highlight along its top, a
         shade along its foot; the next letter you need breathes and glows */
      function brick(g, br) {
        var x = br.x - BW / 2 + 1, y = br.y - BH / 2;
        var col = colorOf(br), flash = time - br.hitT < .1;
        g.fillStyle = flash ? '#fff' : br.max > 1 ? '#2b3242' : col;
        round(g, x, y, BW - 2, BH, 4); g.fill();
        if (br.max > 1) {
          /* armor: a road case, its corners and a light per hit left */
          g.strokeStyle = '#c9d1dc'; g.lineWidth = 1.5; round(g, x + 1, y + 1, BW - 4, BH - 2, 3); g.stroke();
          for (var k = 0; k < br.hp; k++) { g.fillStyle = col; g.beginPath(); g.arc(br.x - (br.hp - 1) * 5 + k * 10, br.y, 3, 0, 7); g.fill(); }
        } else {
          g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 3, y + 2, BW - 8, 2);
          g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x + 2, y + BH - 4, BW - 6, 3);
          g.fillStyle = 'rgba(0,0,0,.18)'; for (var gx = x + 5; gx < x + BW - 4; gx += 5) g.fillRect(gx, y + 4, 1, BH - 8);
        }
      }
      function drawFx(g, f) {
        if (f.t < 0) return;
        if (f.kind === 'pyro') {
          var top = H - f.t * 900;
          var gr = g.createLinearGradient(0, H, 0, Math.max(60, top));
          gr.addColorStop(0, 'rgba(255,90,40,.9)'); gr.addColorStop(.5, 'rgba(255,181,71,.7)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
          g.fillStyle = gr; g.beginPath(); g.moveTo(f.x - 14, H); g.quadraticCurveTo(f.x + Math.sin(time * 30) * 10, (H + top) / 2, f.x, Math.max(60, top)); g.quadraticCurveTo(f.x - Math.sin(time * 27) * 10, (H + top) / 2, f.x + 14, H); g.fill();
        }
        if (f.kind === 'laser' && f.ang != null) {
          var x0 = f.dir > 0 ? 0 : W, x1 = f.dir > 0 ? W : 0, y1 = f.y0 + Math.tan(f.ang) * W;
          g.strokeStyle = ['#5CF2C4', '#FF4FD8', '#2FD8FF', '#FFB547'][Math.floor(f.y0 / 50) % 4]; g.lineWidth = 3; g.shadowColor = g.strokeStyle; g.shadowBlur = 14;
          g.beginPath(); g.moveTo(x0, f.y0); g.lineTo(x1, y1); g.stroke(); g.shadowBlur = 0;
        }
        if (f.kind === 'bass') { g.strokeStyle = 'rgba(155,123,255,' + Math.max(0, .6 - (f.t % .55)) + ')'; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H, (f.t % .55) * 700, Math.PI, 0); g.stroke(); }
      }

      return {
        update: function (dt) { update(dt); }, draw: draw,
        press: function (d) { if (d === 'go') balls.forEach(function (b) { if (b.stuck) launch(b); }); },
        stop: function () {}
      };
    }
  };
})();
