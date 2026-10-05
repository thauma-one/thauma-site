/* =====================================================================
   Panel Fixer — the official LED wall fix (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "throwing a tennis ball at the wall is an official
   troubleshooting technique." And 2026-10-04, after the darts version:
   "it needs a lot of work … Peggle isn't a bad inspiration in general for
   how to make it entertaining. But we need to keep the LED aspect of it.
   And put more work into the person throwing the ball! It was very
   boring."

   THE WALL is a field of LED panels, and the ball bounces through them
   like Peggle's pegs. Each panel is one pixel of a picture the wall is
   meant to be showing; the BROKEN ones (dark, flickering, the wrong
   color, a red flag in the corner) are holes in it. Hit a broken panel and
   it is reseated — its piece of the picture lights up. Fix them all and
   it's SHOWTIME: the slow-motion last hit, the whole picture, and a bonus
   for every ball left. Working panels just bounce the ball (and pay a
   little); GREEN panels hold a power.

   THE TECH stands on a scissor lift above the wall with a tennis ball:
   drag to aim (the first stretch of the path shows), let go to throw — or
   ← → and Space. They lean into the aim, wind up, throw, then cheer,
   facepalm, sweat on the last ball, and dance at SHOWTIME. A road case
   rolls along the floor; a ball that lands in it is thrown again free.

   Ten balls a wall. Out of balls with panels still broken, and it's over.

   ROUND 3 (Chase, 2026-10-05: "figure out some way to make it easier to
   hit the panels in the middle. And add some special power up systems.
   The potential is there, but is wildly missed … the scoring goes up
   wildly fast while holding the ball, which is a bug"):
   - The bug: the aim preview tested its path with the real collide(),
     which scores a hit once its fake panel's hitAt was 0.12s in the past —
     i.e. after the first 99 seconds of play, every frame of aiming paid
     10. The preview now asks a pure geometry question (touches()).
   - The ball goes WHERE YOU POINT: a finger or the mouse picks a spot,
     and the throw is solved so its arc passes through it (the direct
     solution of the projectile equation), not merely aimed toward it.
   - Every wall keeps a CHUTE down its middle (no panels in the center
     strip of its top half), so a straight drop reaches the middle.
   - Slower, so it can be followed: speed 470 → 400, gravity 520 → 430.
     The first wall breaks 6 panels, then 2 more a wall up to 45%.
   - POWERS, each a green panel with its own drawn icon, three a wall:
     MULTI (two more balls), ZAP (lightning to the 3 nearest broken), GUIDE
     (the whole path for 3 throws), FIRE (burns through), BEACH BALL (this
     ball and the next, twice the size), MAGNET (this ball and the next
     curve toward broken panels), TEST PATTERN (every broken panel in that row lights).
   - CREW CALL, the second system: every fix fills the tech's meter;
     full, the next throw brings two crew onto the truss ends who throw
     with them, each at the broken panel nearest the middle.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 640;
  var LX = W / 2, LY = 104;                 /* where the ball leaves the hand */
  var TOPF = 150, BOTF = 540, FLOOR = 606;
  var PW = 28, PH = 18, R = 6;
  var G = 430, SPEED = 400, REST = .72;
  var BALLS = 10;
  var POWERS = ['multi', 'zap', 'guide', 'fire', 'big', 'magnet', 'pattern'];
  var CREW = 12;                            /* fixes to fill the crew meter */

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------------------------------------- walls and pictures */
  /* Where the panels go, wall by wall. Every shape keeps a ball's width
     between panels. */
  var LAYOUTS = [
    function arches() {
      var out = [];
      for (var r = 0; r < 5; r++) {
        var y = TOPF + 40 + r * 72, n = 7 + (r % 2);
        for (var i = 0; i < n; i++) {
          var u = (i + .5) / n, x = 26 + u * (W - 52);
          out.push({ x: x, y: y + Math.sin(u * Math.PI) * -26 });
        }
      }
      return out;
    },
    function diamond() {
      var out = [], cy = (TOPF + BOTF) / 2;
      for (var r = -5; r <= 5; r++) {
        var n = 6 - Math.abs(r), y = cy + r * 34;
        for (var i = 0; i < n; i++) out.push({ x: W / 2 + (i - (n - 1) / 2) * 52, y: y });
      }
      return out;
    },
    function rings() {
      var out = [];
      [[W / 2, 270, 92, 12], [W / 2, 270, 40, 6], [W / 2 - 92, 450, 50, 7], [W / 2 + 92, 450, 50, 7]].forEach(function (c) {
        for (var i = 0; i < c[3]; i++) { var a = i / c[3] * Math.PI * 2; out.push({ x: c[0] + Math.cos(a) * c[2], y: c[1] + Math.sin(a) * c[2] * .85 }); }
      });
      return out;
    },
    function wall() {
      /* a real LED wall: a block of panels, with gaps where cabinets are out */
      var out = [];
      for (var r = 0; r < 8; r++) for (var c = 0; c < 7; c++) {
        if ((r * 3 + c * 5) % 7 === 0) continue;
        out.push({ x: 40 + c * 47 + (r % 2) * 10, y: TOPF + 28 + r * 46 });
      }
      return out;
    },
    function zigzag() {
      var out = [];
      for (var c = 0; c < 6; c++) for (var k = 0; k < 7; k++) {
        out.push({ x: 34 + c * 58 + (k % 2 ? 18 : 0), y: TOPF + 20 + k * 54 + (c % 2) * 22 });
      }
      return out;
    }
  ];
  /* What the wall is meant to show: a color for every place on it. */
  var PICTURES = [
    function sunset(u, v) { return 'hsl(' + (20 + v * 300) + ',85%,' + (58 - v * 18) + '%)'; },
    function cross(u, v) { var on = Math.abs(u - .5) < .1 || Math.abs(v - .38) < .08; return on ? 'hsl(45,100%,70%)' : 'hsl(' + (215 + v * 40) + ',75%,' + (30 + u * 12) + '%)'; },
    function heart(u, v) {
      var x = (u - .5) * 2.4, y = (.45 - v) * 2.4, h = Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y;
      return h < 0 ? 'hsl(340,90%,62%)' : 'hsl(' + (250 + u * 30) + ',60%,26%)';
    },
    function waves(u, v) { var w = Math.sin(u * 9 + v * 4) * .5 + .5; return 'hsl(' + (180 + w * 70) + ',85%,' + (40 + w * 20) + '%)'; },
    function thauma(u, v) {
      /* a T, Thauma's own blue and seafoam */
      var on = (v < .3 && Math.abs(u - .5) < .38) || (Math.abs(u - .5) < .1 && v < .9);
      return on ? (v < .5 ? '#2FD8FF' : '#5CF2C4') : 'hsl(225,40%,' + (14 + v * 10) + '%)';
    }
  ];

  A.games.panelfixer = {
    size: { w: W, h: H },
    controls: 'aim',
    speaker: 'LD',
    quipAt: .205,
    create: function (ctx) {
      var words = ctx.words;
      var panels = [], balls = [], sparks = [], pops = [], arcs = [], confetti = [], sweeps = [];
      var level = 0, left = BALLS, score = 0, total = 0, fixedThisShot = 0, guide = 0;
      var crew = 0, crewOn = false, crewT = 0, nextBig = false, nextMagnet = false;
      var revealed = [], litThisShot = 0, shotT = 0, aimTarget = 0;
      var aim = 0, aimFrom = null, time = 0, slow = 0, showtime = 0;
      var state = 'aim';               /* aim | windup | flight | show | done */
      var windup = 0, mood = 'idle', moodT = 0, thrown = false;
      var bucket = { x: W / 2, dir: 1 };
      var picture = PICTURES[0];

      function brokenLeft() { return panels.filter(function (p) { return p.state === 'broken'; }).length; }
      function mult() {
        var f = 1 - brokenLeft() / Math.max(1, total);
        return f >= .9 ? 5 : f >= .75 ? 3 : f >= .5 ? 2 : 1;
      }

      function nextWall() {
        level++;
        /* the chute: the center strip of the top half stays open */
        var spots = LAYOUTS[(level - 1) % LAYOUTS.length]().filter(function (s) {
          return !(Math.abs(s.x - W / 2) < 24 && s.y < (TOPF + BOTF) / 2 - 10);
        });
        picture = PICTURES[(level - 1) % PICTURES.length];
        panels = spots.map(function (s) {
          var u = clamp((s.x - 14) / (W - 28), 0, 1), v = clamp((s.y - TOPF) / (BOTF - TOPF), 0, 1);
          return { x: s.x, y: s.y, u: u, v: v, col: picture(u, v), state: 'ok', hitAt: -9, fixedAt: -9, fault: null };
        });
        /* the broken ones, spread across the wall, then two green */
        var n = Math.min(Math.floor(panels.length * .45), 4 + level * 2), order = panels.slice().sort(function () { return Math.random() - .5; });
        for (var i = 0; i < n; i++) { order[i].state = 'broken'; order[i].fault = ['dead', 'flicker', 'tint'][i % 3]; }
        /* three powers, never two the same on one wall */
        var kinds = POWERS.slice().sort(function () { return Math.random() - .5; });
        for (var k = n; k < n + 3 && k < order.length; k++) { order[k].state = 'power'; order[k].power = kinds[k - n]; }
        total = n; left = BALLS; state = 'aim'; mood = 'idle'; showtime = 0; revealed = [];
        ctx.say(words('panelfixer_wall') + ' ' + level, { tag: 'LD' });
      }
      nextWall();

      /* ------------------------------------------------------- throwing */
      function dirOf(a) { return { x: Math.sin(a), y: Math.cos(a) }; }
      /* The angle (from straight down) whose arc, thrown at speed v from
         (x0,y0), passes through (tx,ty): the direct one of the two
         projectile solutions; straight at it when it cannot be reached. */
      function solve(x0, y0, tx, ty, v) {
        var X = tx - x0, Y = ty - y0, ax = Math.abs(X);
        if (ax < 1) return 0;
        var up = -Y, disc = v * v * v * v - G * (G * ax * ax + 2 * up * v * v);
        if (disc < 0) return clamp(Math.atan2(X, Math.max(8, Y)), -1.38, 1.38);
        var th = Math.atan((v * v - Math.sqrt(disc)) / (G * ax));
        return clamp(Math.atan2((X < 0 ? -1 : 1) * Math.cos(th), -Math.sin(th)), -1.38, 1.38);
      }
      function throwNow() {
        if (state !== 'aim' || left <= 0) return;
        state = 'windup'; windup = .22; mood = 'throw'; thrown = true;
        ctx.sfx('flip');
      }
      function launch() {
        var d = dirOf(aim);
        balls.push({ x: LX + d.x * 10, y: LY + d.y * 10, vx: d.x * SPEED, vy: d.y * SPEED, slowT: 0, fire: 0, bounces: 0,
          r: nextBig ? R * 2.2 : R, magnet: nextMagnet ? 1 : 0 });
        nextBig = nextMagnet = false;
        left--; fixedThisShot = 0; litThisShot = 0; shotT = 0; state = 'flight';
        ctx.sfx('jump');
        if (guide > 0) guide--;
        /* CREW CALL: two more throws from the truss ends, each at the
           broken panel nearest the middle that it can reach */
        if (crew >= CREW) {
          crew = 0; crewOn = true; crewT = 0;
          ctx.say('[SM] ' + words('panelfixer_crew'), { mood: 'good' });
          [[18, 58], [W - 18, 58]].forEach(function (o, i) {
            var t = panels.filter(function (p) { return p.state === 'broken'; })
              .sort(function (a, c) { return Math.hypot(a.x - W / 2, a.y - (TOPF + BOTF) / 2) - Math.hypot(c.x - W / 2, c.y - (TOPF + BOTF) / 2); })[i] ||
              { x: W / 2, y: (TOPF + BOTF) / 2 };
            setTimeout(function () {
              var a = solve(o[0], o[1], t.x, t.y, SPEED * .9), dd = dirOf(a);
              balls.push({ x: o[0], y: o[1], vx: dd.x * SPEED * .9, vy: dd.y * SPEED * .9, slowT: 0, fire: 0, bounces: 0, r: R, magnet: 0, crew: true });
              ctx.sfx('jump');
            }, 260 + i * 180);
          });
        }
      }

      /* ------------------------------------------------------- the ball */
      /* PEGGLE'S WAY (round 4, Chase: "Maybe we make it more Peggle like
         instead so that the panels disappear?"): a panel the ball hits
         lights up and scores once; when the shot is over, every lit panel
         drops out of the wall, and the picture shows through where it hung.
         A lit panel still bounces the ball until then. */
      function hitPanel(p, b) {
        p.hitAt = time;
        if (p.lit) { ctx.sfx('wall'); return; }
        p.lit = true; p.litAt = time; litThisShot++;
        ctx.sfx(p.state === 'broken' ? 'fix' : p.state === 'power' ? 'powerup' : 'wall');
        if (p.state === 'broken') fix(p);
        else if (p.state === 'power') {
          p.state = 'ok';
          power(p.power, p, b);
        } else { var g0 = 10 * mult(); score += g0; ctx.score(score); pops.push({ x: p.x, y: p.y - 12, text: '+' + g0, col: '#8FEBFF', life: .7 }); }
      }
      /* the shot is over (or stuck): the lit panels drop out */
      function clearLit(only) {
        panels = panels.filter(function (p) {
          if (!p.lit || (only && only.indexOf(p) < 0)) return true;
          revealed.push({ x: p.x, y: p.y, col: p.col, at: time });
          for (var i = 0; i < 5; i++) sparks.push({ x: p.x + rnd(-10, 10), y: p.y, vx: rnd(-40, 40), vy: rnd(20, 120), life: .5, c: p.col });
          return false;
        });
      }
      function fix(p) {
        p.state = 'ok'; p.fixedAt = time; p.fault = null;
        var gain = 100 * mult();
        score += gain; ctx.score(score); fixedThisShot++;
        if (crew < CREW) { crew++; if (crew === CREW) { ctx.sfx('powerup'); pops.push({ x: W / 2, y: 132, text: words('panelfixer_crew').toUpperCase() + '!', col: '#FFB547', life: 1.8 }); ctx.say('[SM] ' + words('panelfixer_crew_ready'), { mood: 'good' }); } }
        pops.push({ x: p.x, y: p.y - 14, text: '+' + gain, col: '#5CF2C4', life: 1 });
        for (var i = 0; i < 12; i++) sparks.push({ x: p.x, y: p.y, vx: rnd(-120, 120), vy: rnd(-140, 60), life: .55, c: p.col });
        ctx.shake(1.5);
        if (!brokenLeft()) startShow();
      }
      function power(name, p, b) {
        pops.push({ x: p.x, y: p.y - 16, text: words('panelfixer_' + name).toUpperCase(), col: '#5CF2C4', life: 1.4 });
        ctx.say('[LD] ' + words('panelfixer_' + name), { mood: 'good' });
        if (name === 'multi') [-1, 1].forEach(function (k) { balls.push({ x: b.x, y: b.y, vx: k * 160 + b.vx * .3, vy: -120, slowT: 0, fire: 0, bounces: 0 }); });
        if (name === 'zap') {
          panels.filter(function (q) { return q.state === 'broken'; })
            .sort(function (a, c) { return Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y); })
            .slice(0, 3).forEach(function (q, i) { arcs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, life: .5 }); setTimeout(function () { if (q.state === 'broken') fix(q); }, 120 * (i + 1)); });
          ctx.sfx('zap');
        }
        if (name === 'guide') guide = 3;
        if (name === 'fire') b.fire = 2.2;
        if (name === 'big') { b.r = R * 2.2; nextBig = true; }
        if (name === 'magnet') { b.magnet = 1; nextMagnet = true; }
        if (name === 'pattern') {
          var row = panels.filter(function (q) { return q.state === 'broken' && Math.abs(q.y - p.y) < 14; });
          if (!row.length) row = panels.filter(function (q) { return q.state === 'broken'; })
            .sort(function (a, c) { return Math.abs(a.y - p.y) - Math.abs(c.y - p.y); }).slice(0, 2);
          row.sort(function (a, c) { return Math.abs(a.x - p.x) - Math.abs(c.x - p.x); })
            .forEach(function (q, i) { setTimeout(function () { if (q.state === 'broken') fix(q); }, 90 * (i + 1)); });
          sweeps.push({ y: p.y, life: .7 });
          ctx.sfx('zap');
        }
      }
      /* the circle against a panel's rectangle: push out, bounce */
      function collide(b, p) {
        var hx = PW / 2, hy = PH / 2;
        var cx = clamp(b.x, p.x - hx, p.x + hx), cy = clamp(b.y, p.y - hy, p.y + hy);
        var dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), br = b.r || R;
        if (d >= br) return false;
        if (b.fire > 0) { if (p.state !== 'ok' || time - p.hitAt > .3) hitPanel(p, b); return false; }
        if (d < .001) { dx = 0; dy = -1; d = 1; }
        var nx = dx / d, ny = dy / d;
        b.x = cx + nx * br; b.y = cy + ny * br;
        var vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vy -= (1 + REST) * vn * ny; }
        b.bounces++;
        if (time - p.hitAt > .12) hitPanel(p, b);
        return true;
      }
      /* geometry only: would a ball at (x,y) touch panel p? (the preview's
         question — it must never score) */
      function touches(x, y, p, br) {
        var cx = clamp(x, p.x - PW / 2, p.x + PW / 2), cy = clamp(y, p.y - PH / 2, p.y + PH / 2);
        return Math.hypot(x - cx, y - cy) < br;
      }
      function stepBall(b, dt) {
        b.vy += G * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.fire > 0) b.fire -= dt;
        var br = b.r || R;
        if (b.x < br) { b.x = br; b.vx = Math.abs(b.vx) * .9; }
        if (b.x > W - br) { b.x = W - br; b.vx = -Math.abs(b.vx) * .9; }
        /* MAGNET: a gentle pull toward the nearest broken panel */
        if (b.magnet) {
          var near = null, nd = 1e9;
          panels.forEach(function (q) { if (q.state === 'broken') { var dd = Math.hypot(q.x - b.x, q.y - b.y); if (dd < nd) { nd = dd; near = q; } } });
          if (near && nd < 170) { b.vx += (near.x - b.x) / nd * 330 * dt; b.vy += (near.y - b.y) / nd * 330 * dt; }
        }
        for (var i = 0; i < panels.length; i++) collide(b, panels[i]);
        /* a ball stuck on a ledge gets a nudge, as Peggle's do */
        /* a ball that has stopped on a ledge: the panels under it go
           (round 4: "if a ball gets stuck, the panel disappears instead") */
        if (Math.hypot(b.vx, b.vy) < 40) {
          b.slowT += dt;
          if (b.slowT > 1) {
            b.slowT = 0;
            var under = panels.filter(function (q) { return touches(b.x, b.y, q, (b.r || R) + 8); });
            under.forEach(function (q) { q.lit = true; });
            if (under.length) clearLit(under); else { b.vy = 200; b.vx = rnd(-120, 120); }
          }
        } else b.slowT = 0;
        /* the road case on the floor: a catch is a free ball */
        if (!b.caught && b.y > FLOOR - 26 && b.y < FLOOR - 8 && Math.abs(b.x - bucket.x) < 32 && b.vy > 0) {
          b.caught = true; b.out = true; left++;
          pops.push({ x: bucket.x, y: FLOOR - 44, text: words('panelfixer_free').toUpperCase(), col: '#FFB547', life: 1.4 });
          ctx.sfx('combo'); ctx.quip('jokes_panelfixer_free', { mood: 'good', chance: .6 });
        }
        if (b.y > H + 12) b.out = true;
      }

      /* ------------------------------------------------------ SHOWTIME */
      function startShow() {
        clearLit();
        state = 'show'; slow = 1.3; showtime = 3.4; mood = 'dance';
        ctx.sfx('cheer');
        ctx.quip('jokes_panelfixer_showtime', { mood: 'good', force: true });
        var bonus = left * 200; score += bonus; ctx.score(score);
        pops.push({ x: W / 2, y: TOPF + 60, text: words('panelfixer_showtime').toUpperCase() + (bonus ? '  +' + bonus : ''), col: '#FFB547', life: 3, big: true });
        for (var i = 0; i < 90; i++) confetti.push({ x: rnd(0, W), y: rnd(-120, 0), vx: rnd(-30, 30), vy: rnd(60, 160), r: rnd(0, 6), c: ['#FF4FD8', '#2FD8FF', '#5CF2C4', '#FFB547'][i % 4], life: 3.4 });
      }

      /* -------------------------------------------------------- update */
      function update(dt) {
        time += dt; moodT += dt;
        var sdt = slow > 0 ? dt * .28 : dt;
        if (slow > 0) slow -= dt;
        bucket.x += bucket.dir * (42 + level * 7) * dt;
        if (bucket.x > W - 40) { bucket.x = W - 40; bucket.dir = -1; }
        if (bucket.x < 40) { bucket.x = 40; bucket.dir = 1; }

        if (state === 'aim') {
          var turn = (ctx.held.right ? 1 : 0) - (ctx.held.left ? 1 : 0);
          if (turn) aimTarget = clamp(aimTarget - turn * 1.5 * dt, -1.38, 1.38);
          /* the aim eases to where it is pointed, so the line never jumps */
          aim += (aimTarget - aim) * Math.min(1, dt * 18);
          if (left === 1 && mood !== 'nervous') { mood = 'nervous'; ctx.quip('jokes_panelfixer_last', { mood: 'bad', chance: .8 }); }
        }
        if (state === 'windup') { windup -= dt; if (windup <= 0) { launch(); mood = 'follow'; moodT = 0; } }

        if (state === 'flight') { shotT += dt; if (shotT > 10) { shotT = 0; clearLit(); } }
        if (balls.length) {
          var steps = Math.ceil(sdt * 900 / 6) || 1;
          for (var s = 0; s < steps; s++) balls.forEach(function (b) { if (!b.out) stepBall(b, sdt / steps); });
          balls = balls.filter(function (b) { return !b.out; });
          if (!balls.length && state === 'flight') endShot();
        }
        if (state === 'show') {
          balls.forEach(function (b) { b.out = true; });
          showtime -= dt;
          if (showtime <= 0) { balls = []; nextWall(); }
        }
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; p.life -= dt; });
        sparks = sparks.filter(function (p) { return p.life > 0; });
        pops.forEach(function (p) { p.y -= 22 * dt; p.life -= dt; });
        pops = pops.filter(function (p) { return p.life > 0; });
        arcs.forEach(function (a) { a.life -= dt; }); arcs = arcs.filter(function (a) { return a.life > 0; });
        sweeps.forEach(function (a) { a.life -= dt; }); sweeps = sweeps.filter(function (a) { return a.life > 0; });
        if (crewOn) { crewT += dt; if (crewT > 3.2 && state !== 'flight') crewOn = false; }
        confetti.forEach(function (c) { c.x += c.vx * dt; c.y += c.vy * dt; c.r += dt * 6; c.life -= dt; });
        confetti = confetti.filter(function (c) { return c.life > 0 && c.y < H + 10; });
      }
      function endShot() {
        clearLit();
        if (state === 'show') return;
        if (fixedThisShot >= 4) { mood = 'cheer'; moodT = 0; ctx.quip('jokes_panelfixer_great', { mood: 'good' }); pops.push({ x: W / 2, y: 132, text: fixedThisShot + ' ' + words('panelfixer_fixed').toUpperCase(), col: '#5CF2C4', life: 1.6 }); }
        else if (fixedThisShot === 0) { mood = 'facepalm'; moodT = 0; ctx.quip('jokes_panelfixer_miss', { mood: 'bad', chance: .7 }); }
        else { mood = fixedThisShot >= 2 ? 'cheer' : 'idle'; moodT = 0; }
        if (left <= 0) { state = 'done'; mood = 'facepalm'; setTimeout(function () { ctx.over(); }, 1100); return; }
        state = 'aim';
      }

      /* ------------------------------------------------------- drawing */
      function draw(g) {
        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#07090e');
        g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);
        /* the wall's frame: the LED wall the panels hang in */
        g.fillStyle = '#05070b'; g.fillRect(6, TOPF - 22, W - 12, BOTF - TOPF + 44);
        g.strokeStyle = '#1e2636'; g.lineWidth = 2; g.strokeRect(6, TOPF - 22, W - 12, BOTF - TOPF + 44);
        /* the picture the wall is meant to show, faint, and lit wherever a
           panel has been cleared */
        for (var py0 = TOPF - 16; py0 < BOTF + 16; py0 += 16) for (var px0 = 10; px0 < W - 10; px0 += 16) {
          g.fillStyle = picture(clamp((px0 - 14) / (W - 28), 0, 1), clamp((py0 - TOPF) / (BOTF - TOPF), 0, 1));
          g.globalAlpha = state === 'show' ? .9 : .07; g.fillRect(px0, py0, 15, 15);
        }
        g.globalAlpha = 1;
        revealed.forEach(function (r) {
          var k = Math.min(1, (time - r.at) * 4);
          /* a soft glow, not a tile, so nobody mistakes it for a panel */
          var rg = g.createRadialGradient(r.x, r.y, 2, r.x, r.y, 30);
          rg.addColorStop(0, r.col); rg.addColorStop(1, 'rgba(0,0,0,0)');
          g.globalAlpha = .45 * k; g.fillStyle = rg; g.fillRect(r.x - 30, r.y - 30, 60, 60);
        });
        g.globalAlpha = 1;
        /* the floor, and the road case on it */
        g.fillStyle = '#10151f'; g.fillRect(0, FLOOR, W, H - FLOOR);
        g.fillStyle = 'rgba(255,181,71,.5)'; g.fillRect(0, FLOOR, W, 2);
        catchCase(g);

        panels.forEach(function (p) { panel(g, p); });
        arcs.forEach(function (a) {
          g.strokeStyle = 'rgba(160,240,255,' + (a.life * 2).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath(); g.moveTo(a.x1, a.y1);
          for (var k = 1; k < 6; k++) g.lineTo(a.x1 + (a.x2 - a.x1) * k / 6 + rnd(-6, 6), a.y1 + (a.y2 - a.y1) * k / 6 + rnd(-6, 6));
          g.lineTo(a.x2, a.y2); g.stroke();
        });
        sweeps.forEach(function (a) {
          g.fillStyle = 'rgba(255,255,255,' + (a.life * .5).toFixed(2) + ')'; g.fillRect(6, a.y - 12, W - 12, 24);
        });
        if (state === 'aim') preview(g);
        balls.forEach(function (b) {
          var br = b.r || R;
          if (b.fire > 0) { g.fillStyle = 'rgba(255,140,40,.45)'; g.beginPath(); g.arc(b.x, b.y, br + 5, 0, 7); g.fill(); }
          if (b.magnet) { g.strokeStyle = 'rgba(255,79,216,' + (.4 + .3 * Math.sin(time * 14)).toFixed(2) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, br + 4, 0, 7); g.stroke(); }
          if (br > R) {
            /* the beach ball: panels of color */
            ['#FF4FD8', '#2FD8FF', '#FFB547', '#5CF2C4'].forEach(function (c, k) {
              g.fillStyle = c; g.beginPath(); g.moveTo(b.x, b.y); g.arc(b.x, b.y, br, k * Math.PI / 2 + time * 3, (k + 1) * Math.PI / 2 + time * 3); g.fill();
            });
            g.fillStyle = '#fff'; g.beginPath(); g.arc(b.x, b.y, br * .25, 0, 7); g.fill();
          } else {
            g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(b.x, b.y, br, 0, 7); g.fill();
            g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1; g.beginPath(); g.arc(b.x - 2, b.y, br * .8, -1, 1); g.stroke();
          }
        });
        sparks.forEach(function (p) { g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.c; g.fillRect(p.x, p.y, 2.5, 2.5); });
        g.globalAlpha = 1;
        rig(g);
        tech(g);
        if (crewOn) { crewMate(g, 18, 1); crewMate(g, W - 18, -1); }
        confetti.forEach(function (c) { g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.c; g.globalAlpha = Math.min(1, c.life); g.fillRect(-3, -1.5, 6, 3); g.restore(); });
        g.globalAlpha = 1;
        pops.forEach(function (p) {
          g.globalAlpha = Math.min(1, p.life * 1.5); g.fillStyle = p.col;
          g.font = (p.big ? '700 22px' : '700 12px') + ' Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          if (p.big) { g.shadowColor = p.col; g.shadowBlur = 18; }
          g.fillText(p.text, clamp(p.x, 60, W - 60), p.y); g.shadowBlur = 0;
        });
        g.globalAlpha = 1;
        hud(g);
        if (!thrown && state === 'aim') {
          g.fillStyle = 'rgba(237,242,248,' + (.55 + .3 * Math.sin(time * 4)).toFixed(2) + ')';
          g.font = '600 11px Inter, sans-serif'; g.textAlign = 'center';
          g.fillText(words(ctx.touch ? 'panelfixer_hint_touch' : 'panelfixer_hint'), W / 2, BOTF + 44);
        }
      }
      function panel(g, p) {
        var x = p.x - PW / 2, y = p.y - PH / 2, flash = time - p.hitAt < .15, fixedGlow = time - p.fixedAt < .6;
        g.fillStyle = '#0b0e14'; g.fillRect(x - 1, y - 1, PW + 2, PH + 2);
        if (p.state === 'broken') {
          var on = p.fault === 'flicker' ? Math.sin(time * 37 + p.x) > .3 : p.fault === 'tint';
          g.fillStyle = p.fault === 'tint' ? 'hsl(310,90%,45%)' : on ? p.col : '#0d1119';
          g.fillRect(x, y, PW, PH);
          g.fillStyle = Math.sin(time * 6 + p.y) > 0 ? '#FF5A6E' : '#8a2432';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.closePath(); g.fill();
        } else {
          g.fillStyle = p.col; g.globalAlpha = state === 'show' ? 1 : .62; g.fillRect(x, y, PW, PH); g.globalAlpha = 1;
          if (p.state === 'power') {
            g.fillStyle = 'rgba(92,242,196,' + (.55 + .35 * Math.sin(time * 5)).toFixed(2) + ')'; g.fillRect(x, y, PW, PH);
            icon(g, p.power, p.x, p.y);
          }
        }
        /* the LED pixel grid on every panel */
        g.fillStyle = 'rgba(0,0,0,.28)';
        for (var gx = 4; gx < PW; gx += 4) g.fillRect(x + gx, y, 1, PH);
        for (var gy = 4; gy < PH; gy += 4) g.fillRect(x, y + gy, PW, 1);
        if (flash) { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(x, y, PW, PH); }
        if (p.lit) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.shadowColor = '#ffffff'; g.shadowBlur = 10; g.strokeRect(x - 1, y - 1, PW + 2, PH + 2); g.shadowBlur = 0; }
        if (fixedGlow) { g.strokeStyle = 'rgba(92,242,196,' + (.6 - (time - p.fixedAt)).toFixed(2) + ')'; g.lineWidth = 3; g.strokeRect(x - 2, y - 2, PW + 4, PH + 4); }
      }
      /* the path the throw will take: the first stretch, or with GUIDE the
         whole way through the first two bounces */
      function preview(g) {
        var d = dirOf(aim), b = { x: LX + d.x * 10, y: LY + d.y * 10, vx: d.x * SPEED, vy: d.y * SPEED }, bounces = 0, limit = guide > 0 ? 3 : 0;
        var br = nextBig ? R * 2.2 : R;
        g.fillStyle = guide > 0 ? 'rgba(92,242,196,.8)' : 'rgba(216,245,90,.7)';
        for (var t = 0, f = 0; t < (guide > 0 ? 3.2 : 1.6); t += 1 / 60, f++) {
          b.vy += G / 60; b.x += b.vx / 60; b.y += b.vy / 60;
          if (b.x < br || b.x > W - br) { b.vx = -b.vx; b.x = clamp(b.x, br, W - br); }
          var p = null;
          for (var i = 0; i < panels.length; i++) if (touches(b.x, b.y, panels[i], br)) { p = panels[i]; break; }
          if (p) {
            /* where the throw first lands: a ring on that panel */
            if (bounces++ >= limit) { g.strokeStyle = g.fillStyle; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, br + 2, 0, 7); g.stroke(); break; }
            var cx = clamp(b.x, p.x - PW / 2, p.x + PW / 2), cy = clamp(b.y, p.y - PH / 2, p.y + PH / 2), dx = b.x - cx, dy = b.y - cy, dd = Math.hypot(dx, dy) || 1;
            var nx = dx / dd, ny = dy / dd, vn = b.vx * nx + b.vy * ny;
            b.x = cx + nx * br; b.y = cy + ny * br;
            if (vn < 0) { b.vx -= (1 + REST) * vn * nx; b.vy -= (1 + REST) * vn * ny; }
          }
          if (f % 3 === 0) { g.beginPath(); g.arc(b.x, b.y, 2, 0, 7); g.fill(); }
          if (b.y > FLOOR) break;
        }
      }
      function catchCase(g) {
        var x = bucket.x, y = FLOOR - 22;
        g.fillStyle = '#1b2230'; g.fillRect(x - 32, y, 64, 20);
        g.fillStyle = '#0a0d14'; g.fillRect(x - 28, y + 3, 56, 7);
        g.strokeStyle = '#8f99a8'; g.lineWidth = 2; g.strokeRect(x - 32, y, 64, 20);
        g.fillStyle = '#FFB547'; g.fillRect(x - 32, y + 15, 64, 3);
        g.fillStyle = '#c9d1dc'; [x - 24, x + 24].forEach(function (wx) { g.beginPath(); g.arc(wx, FLOOR - 1, 3.5, 0, 7); g.fill(); });
      }
      /* the truss and the scissor lift the tech stands on */
      function rig(g) {
        g.strokeStyle = '#3a4456'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, 22); g.lineTo(W, 22); g.moveTo(0, 34); g.lineTo(W, 34);
        for (var x = 0; x <= W; x += 14) { g.moveTo(x, 22); g.lineTo(x + 7, 34); g.lineTo(x + 14, 22); }
        g.stroke();
        var py = 118;
        g.fillStyle = '#1b2230'; g.fillRect(LX - 38, py, 76, 6);
        g.strokeStyle = '#FFB547'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(LX - 38, py); g.lineTo(LX - 38, py - 22); g.lineTo(LX + 38, py - 22); g.lineTo(LX + 38, py); g.stroke();
        g.strokeStyle = '#59647a'; g.lineWidth = 2;
        g.beginPath(); for (var k = 0; k < 2; k++) { var y0 = py + 6 + k * 12; g.moveTo(LX - 26, y0); g.lineTo(LX + 26, y0 + 12); g.moveTo(LX + 26, y0); g.lineTo(LX - 26, y0 + 12); } g.stroke();
      }
      /* THE TECH (Chase: "put more work into the person throwing the
         ball"): a body that leans into the aim, an arm that follows it, a
         face that reacts. */
      function tech(g) {
        var x = LX, feet = 116, t = time;
        var bob = Math.sin(t * 2.2) * 1.2, lean = state === 'aim' ? aim * 4 : 0, jump = 0, arms = 'aim';
        if (mood === 'cheer' && moodT < 1.6) { jump = -Math.abs(Math.sin(moodT * 9)) * 6; arms = 'up'; }
        if (mood === 'dance') { jump = -Math.abs(Math.sin(t * 10)) * 5; lean = Math.sin(t * 5) * 5; arms = Math.sin(t * 5) > 0 ? 'up' : 'wave'; }
        if (mood === 'facepalm' && moodT < 1.8) arms = 'palm';
        if (state === 'windup') { lean = -aim * 3 - 3; arms = 'back'; }
        if (mood === 'follow' && moodT < .35) arms = 'through';
        var hy = feet - 42 + bob + jump, hx = x + lean;
        g.lineCap = 'round';
        /* legs */
        g.strokeStyle = '#1c2330'; g.lineWidth = 5;
        g.beginPath(); g.moveTo(x - 4, feet - 16 + jump); g.lineTo(x - 5, feet); g.moveTo(x + 4, feet - 16 + jump); g.lineTo(x + 5, feet); g.stroke();
        /* body: black tee, tool belt */
        g.fillStyle = '#151a24'; roundRect(g, hx - 8, hy + 8, 16, 20, 4); g.fill();
        g.fillStyle = '#FFB547'; g.fillRect(hx - 8, hy + 23, 16, 3);
        g.fillStyle = '#8f99a8'; g.fillRect(hx + 3, hy + 26, 3, 5);
        /* arms */
        g.strokeStyle = '#e2b48f'; g.lineWidth = 3.5;
        var sh = { x: hx + 6, y: hy + 12 }, sh2 = { x: hx - 6, y: hy + 12 };
        var d = dirOf(aim), hand;
        if (arms === 'aim') hand = { x: sh.x + d.x * 13, y: sh.y + d.y * 13 };
        else if (arms === 'back') hand = { x: sh.x - d.x * 10, y: sh.y - 10 };
        else if (arms === 'through') hand = { x: sh.x + d.x * 16, y: sh.y + d.y * 16 };
        else if (arms === 'up') hand = { x: sh.x + 6, y: sh.y - 16 };
        else if (arms === 'wave') hand = { x: sh.x + 12, y: sh.y - 8 };
        else hand = { x: hx + 2, y: hy - 2 };   /* palm on face */
        g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(hand.x, hand.y); g.stroke();
        var other = arms === 'up' || arms === 'wave' ? { x: sh2.x - 6, y: sh2.y - 16 } : arms === 'palm' ? { x: sh2.x - 4, y: sh2.y + 10 } : { x: sh2.x - 4, y: sh2.y + 12 };
        g.beginPath(); g.moveTo(sh2.x, sh2.y); g.lineTo(other.x, other.y); g.stroke();
        /* the ball in hand, until it is thrown */
        if ((state === 'aim' || state === 'windup') && left > 0) { g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(hand.x, hand.y, 4.5, 0, 7); g.fill(); }
        /* head, hair, headset */
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(hx, hy, 8, 0, 7); g.fill();
        g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(hx, hy - 3, 8, Math.PI * 1.05, Math.PI * 1.95); g.fill();
        g.strokeStyle = '#2FD8FF'; g.lineWidth = 1.5; g.beginPath(); g.arc(hx, hy, 9.5, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        g.beginPath(); g.moveTo(hx - 8, hy + 1); g.lineTo(hx - 4, hy + 6); g.stroke();
        /* the face says how it went */
        g.fillStyle = '#10131a'; g.strokeStyle = '#10131a'; g.lineWidth = 1.3;
        var ex = state === 'aim' ? d.x * 2 : 0, ey = state === 'aim' ? clamp(d.y, 0, 1) * 1.5 : 0;
        if (arms !== 'palm') { g.fillRect(hx - 4 + ex, hy - 1 + ey, 2, 2); g.fillRect(hx + 2 + ex, hy - 1 + ey, 2, 2); }
        g.beginPath();
        if (mood === 'cheer' || mood === 'dance') g.arc(hx, hy + 3, 3, .1, Math.PI - .1);
        else if (mood === 'facepalm') g.arc(hx, hy + 6, 2.5, Math.PI + .3, -.3);
        else if (mood === 'nervous') { g.moveTo(hx - 3, hy + 4); g.lineTo(hx - 1, hy + 3); g.lineTo(hx + 1, hy + 4); g.lineTo(hx + 3, hy + 3); }
        else if (state === 'windup' || state === 'aim') { g.moveTo(hx - 2, hy + 4); g.lineTo(hx + 2, hy + 4); }
        else g.arc(hx, hy + 3, 2.5, .3, Math.PI - .3);
        g.stroke();
        if (mood === 'nervous') { g.fillStyle = '#8FEBFF'; g.beginPath(); g.ellipse(hx + 9, hy - 3 + (t * 12 % 6), 1.6, 2.4, 0, 0, 7); g.fill(); }
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
        g.fillStyle = 'rgba(138,150,166,.9)';
        g.fillText(words('panelfixer_wall').toUpperCase() + ' ' + level, 12, 48);
        g.fillText(words('panelfixer_throws').toUpperCase(), 12, 64);
        for (var i = 0; i < BALLS + 4; i++) {
          if (i >= left && i >= BALLS) break;
          g.fillStyle = i < left ? '#d8f55a' : 'rgba(255,255,255,.08)';
          g.beginPath(); g.arc(16 + (i % 7) * 11, 82 + Math.floor(i / 7) * 11, 4, 0, 7); g.fill();
        }
        g.textAlign = 'right'; g.fillStyle = 'rgba(138,150,166,.9)';
        g.fillText(words('panelfixer_broken').toUpperCase() + ' ' + brokenLeft(), W - 12, 48);
        var m = mult();
        g.fillStyle = m >= 5 ? '#FF4FD8' : m >= 3 ? '#FFB547' : m >= 2 ? '#5CF2C4' : 'rgba(138,150,166,.9)';
        g.font = '700 14px Sora, sans-serif'; g.fillText('×' + m, W - 12, 62);
        /* the crew meter, under the multiplier */
        var full = crew >= CREW;
        g.font = '600 9px Inter, sans-serif'; g.fillStyle = full ? '#FFB547' : 'rgba(138,150,166,.9)';
        g.fillText(words('panelfixer_crew').toUpperCase(), W - 12, 82);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(W - 82, 95, 70, 5);
        g.fillStyle = full ? (Math.sin(time * 8) > 0 ? '#FFB547' : '#ffd38a') : '#FFB547'; g.fillRect(W - 82, 95, 70 * crew / CREW, 5);
      }
      /* each power's own mark, drawn, so the wall can be read at a glance */
      function icon(g, name, x, y) {
        g.save(); g.translate(x, y); g.fillStyle = '#0b0e14'; g.strokeStyle = '#0b0e14'; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath();
        if (name === 'multi') { [-6, 0, 6].forEach(function (k) { g.moveTo(k + 2.4, 0); g.arc(k, 0, 2.4, 0, 7); }); g.fill(); }
        else if (name === 'zap') { g.moveTo(2, -7); g.lineTo(-3, 1); g.lineTo(1, 1); g.lineTo(-2, 7); g.lineTo(4, -1); g.lineTo(0, -1); g.closePath(); g.fill(); }
        else if (name === 'guide') { for (var k = 0; k < 4; k++) { g.moveTo(-8 + k * 5 + 1.2, -3 + k * k * .9); g.arc(-8 + k * 5, -3 + k * k * .9, 1.2, 0, 7); } g.fill(); }
        else if (name === 'fire') { g.moveTo(0, -7); g.quadraticCurveTo(6, -1, 4, 4); g.quadraticCurveTo(0, 8, -4, 4); g.quadraticCurveTo(-6, -1, 0, -7); g.fill(); }
        else if (name === 'big') { g.arc(0, 0, 6, 0, 7); g.stroke(); g.beginPath(); g.moveTo(-6, 0); g.lineTo(6, 0); g.moveTo(0, -6); g.lineTo(0, 6); g.lineWidth = 1.2; g.stroke(); }
        else if (name === 'magnet') { g.arc(0, -1, 5, Math.PI, 0); g.moveTo(5, -1); g.lineTo(5, 5); g.moveTo(-5, -1); g.lineTo(-5, 5); g.lineWidth = 3; g.stroke(); }
        else if (name === 'pattern') { for (var j = 0; j < 4; j++) g.rect(-9 + j * 4.6, -5, 3.4, 10); g.fill(); }
        g.restore();
      }
      /* a crew member on the truss end, arm over, for a crew call */
      function crewMate(g, x, side) {
        var y = 58, k = Math.min(1, crewT * 3), arm = crewT < .7 ? -1 : .6;
        g.save(); g.globalAlpha = k; g.lineCap = 'round';
        g.fillStyle = '#151a24'; g.fillRect(x - 6, y - 4, 12, 16);
        g.fillStyle = '#FFB547'; g.fillRect(x - 6, y + 8, 12, 2);
        g.strokeStyle = '#e2b48f'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + side * 5, y); g.lineTo(x + side * 13, y + arm * 10); g.stroke();
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(x, y - 10, 6, 0, 7); g.fill();
        g.fillStyle = '#FFB547'; g.beginPath(); g.arc(x, y - 12, 6.5, Math.PI, 0); g.fill();   /* a hard hat */
        g.restore();
      }
      function roundRect(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }

      return {
        update: update, draw: draw,
        press: function (d) { if (d === 'go') throwNow(); },
        /* a finger or the mouse aims from the hand toward it; letting go throws */
        point: function (phase, px, py) {
          if (state !== 'aim') return;
          if (phase === 'down' || phase === 'move' || phase === 'hover') aimTarget = py > LY + 20 ? solve(LX, LY, px, py, SPEED) : clamp((px - LX) / (W / 2) * 1.38, -1.38, 1.38);
          if (phase === 'down') aimFrom = { x: px, y: py };
          if (phase === 'up' && aimFrom) { aimFrom = null; throwNow(); }
          if (phase === 'cancel') aimFrom = null;
        },
        stop: function () { balls = []; }
      };
    }
  };
})();
