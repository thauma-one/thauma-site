/* =====================================================================
   Soundcheck — Pong on the desk (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "let's keep the soundcheck as pong" … "Don't do any
   feedback audio". 2026-10-04: power-ups both players use, a computer
   with some sense, not perfect. 2026-10-05, round 5: "The power up names
   get in the way of the gameplay. Let's just make a few true power ups
   with distinct visuals on the ball itself and the power up colors are
   distinct as well. I like the loop ball, magnet ball, small platform,
   large platform, multiball (but change it so that the isn't going to be
   instant death) … Maybe a Proximity ball … Also.... the AI breaks for
   those special movement balls like magnet."

   You hold the fader at the bottom; front of house (FOH) holds the one at
   the top. Every return turns the gain up; the match ends when FOH has
   five. Score: 10 a return, 100 a point you take, 25 a capsule you catch.

   CLASSIC or MODERN, then EASY / NORMAL / HARD (play.js ctx.menu: pick,
   then Enter).

   MODERN: capsules drift across the middle, one at a time. The ball
   catches one for whoever hit it last. Seven, each its own color and its
   own drawing, no words — and each one SHOWS on the ball or the fader:
     LARGE FADER   (green)   your fader grows, lit along its length
     SMALL FADER   (violet)  the other fader shrinks, cracked
     MAGNET        (pink)    balls on your side bend to your fader; the ball
                             wears pulsing pink rings there
     PROXIMITY     (lime)    balls coming at you slow as they near you; the
                             ball wears a lime halo that tightens
     MULTIBALL     (cyan)    two more balls, small and cyan. They are
                             bonus balls: one getting past costs nothing,
                             only the main ball scores
     LOOP BALL     (amber)   the ball loops the loop at the middle line,
                             amber with a spiral trail
     FIREBALL      (red)     the ball sent away is a third faster, red with
                             a flame trail

   THE dB METER: every return fills it; full, the next return is a SMASH.

   INERTIA (round 5, Chase: "ball speed is based on where the ball lands on
   the platform. We should add inertia"): the fader's own movement as it
   meets the ball carries into it — swing into a return to send it wider
   and faster, stand still for a clean one.

   THE OPPONENT reads a ball's real path by running a copy of it through
   the same motion (predict()), and for a ball that bends toward it — a
   magnet, a loop — it stops guessing near the end and follows the ball
   itself, which is what had it chasing straight lines into misses.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, PW = 74, PH = 12, R = 6;
  var BASE = 215, TOP = 540, GROW = 1.035;
  var MATCH = 5, SPEED = 470, BAND = 14;

  /* the seven: who they go to, how long, how much the computer wants them,
     and their color */
  var POWERS = {
    wide:   { to: 'me',    t: 10, v: 2, col: '#5CF2C4' },
    tiny:   { to: 'them',  t: 9,  v: 2, col: '#9B7BFF' },
    magnet: { to: 'me',    t: 9,  v: 2, col: '#FF4FD8' },
    prox:   { to: 'me',    t: 9,  v: 2, col: '#D8F55A' },
    multi:  { to: 'ball',  v: 2, col: '#2FD8FF' },
    loop:   { to: 'ball',  v: 1, col: '#FFB547' },
    fast:   { to: 'ball',  v: 1, col: '#FF5A6E' }
  };
  var NAMES = Object.keys(POWERS);
  var DIFF = {
    easy:   { reach: 170, grow: 9,  smart: .3,  miss: 1.9, pace: .88, col: '#5CF2C4' },
    normal: { reach: 230, grow: 17, smart: .62, miss: 1,   pace: 1,   col: '#FFB547' },
    hard:   { reach: 320, grow: 22, smart: .92, miss: .45, pace: 1.1, col: '#FF5A6E' }
  };
  var LEVELS = ['easy', 'normal', 'hard'];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  A.games.soundcheck = {
    size: function (o) { return { w: W, h: o && o.touch ? 560 : 640 }; },
    controls: function (o) { return o && o.touch ? 'dpad' : 'stick'; },
    padStart: ['left', 'right'],
    speaker: 'FOH',
    quipAt: .4,
    create: function (ctx) {
      var words = ctx.words, H = ctx.H;
      var YOU_Y = H - 46, FOH_Y = 50, MID = H / 2;
      var mode = null, level = null, D = DIFF.normal, awaiting = false;
      var you = { x: W / 2, v: 0, fx: {}, meter: 0, id: 'you' };
      var foh = { x: W / 2, v: 0, fx: {}, meter: 0, id: 'foh', goal: W / 2 };
      var balls = [], caps = [], sparks = [], icons = [];
      var hits = 0, rally = 0, mine = 0, theirs = 0, caught = 0, wait = 1.1, serveTo = 1;
      var time = 0, nextCap = 9, spawned = 0, firstServe = true;

      /* the two choices, through play.js's menu */
      ctx.menu({
        heading: words('soundcheck_mode_pick'), start: 1,
        items: ['classic', 'modern'].map(function (m) { return { title: words('soundcheck_' + m), line: words('soundcheck_' + m + '_line'), col: m === 'classic' ? '#2FD8FF' : '#FFB547' }; }),
        pick: function (i) {
          mode = i ? 'modern' : 'classic';
          ctx.menu({
            heading: words('diff_pick'), start: 1,
            items: LEVELS.map(function (l) { return { title: words('diff_' + l), line: words('diff_' + l + '_line'), col: DIFF[l].col }; }),
            pick: function (j) { level = LEVELS[j]; D = DIFF[level]; }
          });
        }
      });

      function other(p) { return p === you ? foh : you; }
      function width(p) {
        var k = 1;
        if (p.fx.wide > 0) k *= 1.6;
        if (p.fx.tiny > 0) k *= .58;
        return PW * k;
      }

      /* ---------------------------------------------------- the ball */
      function newBall(x, y, vx, vy, owner) {
        var b = { x: x, y: y, vx: vx, vy: vy, speed: Math.hypot(vx, vy), owner: owner, fx: null, t: 0, extra: false, trail: [], smash: false };
        balls.push(b);
        return b;
      }
      function serve() {
        var ang = (Math.random() - .5) * .9;
        balls = [];
        newBall(W / 2, MID, Math.sin(ang) * BASE * D.pace, Math.cos(ang) * BASE * D.pace * serveTo, serveTo > 0 ? foh : you);
        rally = 0;
        ctx.sfx('hit');
      }
      function setVel(b, ang, dir) { b.vx = Math.sin(ang) * b.speed; b.vy = Math.cos(ang) * b.speed * dir; }

      /* A return: where it met the fader sets the angle, as in every Pong,
         and the fader's own movement carries into it */
      function bounce(b, p, dir) {
        var off = clamp((b.x - p.x) / (width(p) / 2), -1, 1), inVx = b.vx;
        b.speed = Math.min(TOP * D.pace, Math.max(BASE * D.pace, b.speed) * GROW + (rally % 5 === 4 ? 12 : 0));
        b.fx = null; b.t = 0; b.plan = null; b.owner = p; b.smash = false; b.looped = false; b.loop = null;
        p.meter = Math.min(1, p.meter + .13);
        if (p.meter >= 1) { p.meter = 0; b.smash = true; b.speed = Math.min(TOP * 1.2, b.speed * 1.3); ctx.shake(5); ctx.sfx('boom'); }
        setVel(b, off * 1.05, dir);
        /* INERTIA: a third of the fader's speed goes into the ball sideways,
           and a swing adds a little pace; the angle is kept playable */
        /* round 8 (Chase: "The movement of the platform aligns with the
           movement of the ball, it can speed up the ball"): swinging the way
           the ball travels sends it up to 40% faster, against it up to 40%
           slower, and the speed is kept (round 7 renormalized it, so a
           swing only turned the ball) */
        var along = Math.abs(inVx) > 20 ? Math.sign(inVx) : Math.sign(b.vx) || Math.sign(p.v);
        var push = p.v / SPEED * along;                      /* +1 with the ball at full speed, -1 against */
        b.vx += p.v * .3;
        var ang = clamp(Math.atan2(b.vx, Math.abs(b.vy)), -1.15, 1.15);
        b.speed = clamp(b.speed * (1 + .4 * push), BASE * D.pace * .8, TOP * 1.25);
        setVel(b, ang, dir);
        for (var i = 0; i < 10; i++) sparks.push({ x: b.x, y: b.y, vx: rnd(-90, 90), vy: dir * rnd(0, 120), life: .4, c: b.smash ? '#FFB547' : '#8FEBFF' });
        if (b.speed > 500) ctx.shake(1.5 + (b.speed - 500) / 110);
        ctx.sfx('hit');
      }

      /* ------------------------------------------------- the powers */
      function spawnCap() {
        /* the helpers first, so the first few teach what a capsule is */
        var pool = spawned < 3 ? ['wide', 'magnet', 'prox'] : NAMES;
        var name = pool[Math.floor(Math.random() * pool.length)];
        spawned++;
        var left = Math.random() < .5;
        caps.push({ name: name, x: left ? -16 : W + 16, y: rnd(MID - H * .16, MID + H * .16), vx: (left ? 1 : -1) * rnd(26, 42), born: time });
      }
      function grant(name, p, b) {
        var P = POWERS[name], q = other(p);
        if (p === you) caught++;
        ctx.sfx('powerup');
        /* no words: the capsule's drawing rises from the one it went to */
        var to = P.to === 'them' ? q : p;
        icons.push({ name: name, x: to.x, y: to === you ? YOU_Y - 26 : FOH_Y + 26, life: 1.3 });
        if (P.to === 'me') p.fx[name] = P.t;
        else if (P.to === 'them') q.fx[name] = P.t;
        else if (b) {
          if (name === 'fast') { b.fx = 'fast'; b.speed = Math.min(TOP * 1.15, b.speed * 1.3); setVel(b, Math.atan2(b.vx, Math.abs(b.vy)), b.vy > 0 ? 1 : -1); }
          if (name === 'loop') { b.fx = 'loop'; b.looped = false; }
          if (name === 'multi') {
            [-.4, .4].forEach(function (d) {
              var ang = Math.atan2(b.vx, Math.abs(b.vy)) + d, n = newBall(b.x, b.y, 0, 0, b.owner);
              n.speed = b.speed; n.extra = true; setVel(n, ang, b.vy > 0 ? 1 : -1);
            });
          }
        }
      }

      /* ------------------------------------------------- how a ball moves */
      /* the trick, the helpers on the side it is on, the walls — nothing
         else, so the computer can run copies of it (predict) */
      function motion(b, dt) {
        b.t += dt;
        var dir = b.vy > 0 ? 1 : -1, home = dir > 0 ? you : foh, mult = 1;
        /* LOOP: at the middle line it goes round once, then on */
        if (b.fx === 'loop' && !b.looped && !b.loop && (dir > 0 ? b.y > MID : b.y < MID)) {
          var side = b.x < W / 2 ? 1 : -1;
          b.loop = { cx: b.x + side * 30, cy: b.y, a: side > 0 ? Math.PI : 0, t: 0, side: side };
        }
        if (b.loop) {
          var L = b.loop; L.t += dt;
          var a = L.a + L.side * dir * (L.t / .7) * Math.PI * 2;
          b.x = L.cx + Math.cos(a) * 30; b.y = L.cy + Math.sin(a) * 30;
          if (L.t >= .7) { b.loop = null; b.looped = true; b.x = L.cx + Math.cos(L.a) * 30; b.y = L.cy; }
          return;
        }
        /* PROXIMITY: the nearer the fader that has it, the slower */
        if (home.fx.prox > 0) {
          var dist = Math.abs((dir > 0 ? YOU_Y : FOH_Y) - b.y) / (YOU_Y - FOH_Y);
          if (dist < .45) mult *= .35 + dist / .45 * .65;
        }
        if (home.fx.magnet > 0 && (dir > 0 ? b.y > MID : b.y < MID)) b.vx += clamp(home.x - b.x, -1, 1) * 420 * dt;
        b.x += b.vx * dt * mult; b.y += b.vy * dt * mult;
        if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); if (!b.sim) ctx.sfx('wall'); }
        if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); if (!b.sim) ctx.sfx('wall'); }
      }
      function stepBall(b, dt) {
        motion(b, dt);
        if (b.loop) return;
        /* the faders */
        if (b.vy > 0 && b.y + R >= YOU_Y - PH / 2 && b.y < YOU_Y + PH && Math.abs(b.x - you.x) <= width(you) / 2 + R) {
          b.y = YOU_Y - PH / 2 - R;
          bounce(b, you, -1);
          hits++; rally++;
          ctx.score(score());
        } else if (b.vy < 0 && b.y - R <= FOH_Y + PH / 2 && b.y > FOH_Y - PH && Math.abs(b.x - foh.x) <= width(foh) / 2 + R) {
          b.y = FOH_Y + PH / 2 + R;
          bounce(b, foh, 1);
        }
        /* a capsule in the ball's way is caught, for whoever hit it last */
        if (mode === 'modern') for (var i = caps.length - 1; i >= 0; i--) {
          var c = caps[i];
          if (Math.hypot(c.x - b.x, c.y - b.y) < BAND + R) {
            caps.splice(i, 1);
            grant(c.name, b.owner, b);
            for (var k = 0; k < 14; k++) sparks.push({ x: c.x, y: c.y, vx: rnd(-140, 140), vy: rnd(-140, 140), life: .5, c: POWERS[c.name].col });
          }
        }
      }

      /* ----------------------------------------------- the computer */
      function landing(b, y) {
        var t = (y - b.y) / b.vy;
        if (t <= 0 || !isFinite(t)) return b.x;
        var x = b.x + b.vx * t, span = W - 2 * R, m = ((x - R) % (2 * span) + 2 * span) % (2 * span);
        return R + (m > span ? 2 * span - m : m);
      }
      /* where a ball will REALLY cross FOH's line: a copy run forward */
      function predict(b) {
        var c = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed: b.speed, fx: b.fx, t: b.t, looped: b.looped,
          loop: b.loop ? { cx: b.loop.cx, cy: b.loop.cy, a: b.loop.a, t: b.loop.t, side: b.loop.side } : null, sim: true };
        for (var k = 0; k < 480 && c.y > FOH_Y + PH; k++) motion(c, 1 / 120);
        return c.x;
      }
      /* where to stand: the predicted landing, and a chosen part of the
         fader to meet it with (to aim the return), not always cleverly */
      function plan(b) {
        var land = predict(b);
        var smart = Math.random() < Math.min(.95, D.smart + rally * .02);
        var best = 0, bestV = -1e9, sp = Math.min(TOP, b.speed * GROW);
        if (smart) for (var off = -.85; off <= .86; off += .17) {
          var ang = off * 1.05, vx = Math.sin(ang) * sp, vy = Math.cos(ang) * sp, v = 0;
          if (mode === 'modern') caps.forEach(function (c) {
            var tt = (c.y - FOH_Y) / vy, bx = land + vx * tt;
            var span = W - 2 * R, m = ((bx - R) % (2 * span) + 2 * span) % (2 * span); bx = R + (m > span ? 2 * span - m : m);
            if (Math.abs(bx - (c.x + c.vx * tt)) < 24) v += POWERS[c.name].v;
          });
          var tY = (YOU_Y - FOH_Y) / vy, lx = land + vx * tY, span2 = W - 2 * R, m2 = ((lx - R) % (2 * span2) + 2 * span2) % (2 * span2);
          lx = R + (m2 > span2 ? 2 * span2 - m2 : m2);
          v += Math.abs(lx - you.x) / W * 1.6 + rnd(-.4, .4);
          if (v > bestV) { bestV = v; best = off; }
        } else best = rnd(-.6, .6);
        return { land: land, off: best, miss: rnd(-1, 1) * Math.max(6, 30 - rally * 1.4) * D.miss };
      }
      function moveFoh(dt, b) {
        var was = foh.x;
        var reach = Math.min(620, D.reach + rally * D.grow + mine * 20);
        if (b) {
          if (!b.plan) b.plan = plan(b);
          /* re-read the path a few times a second (it can bend) */
          if (!b.predAt || time - b.predAt > .2) { b.predAt = time; b.plan.land = predict(b); }
          var aim = b.plan.land - b.plan.off * width(foh) / 2 + b.plan.miss;
          /* the last stretch of a ball that bends toward it (its own magnet,
             a loop): follow the ball itself, not a guess */
          var near = (b.y - FOH_Y) / (MID - FOH_Y);
          if (near < .5 && (foh.fx.magnet > 0 || b.fx === 'loop')) aim = b.x + b.vx * .08 - b.plan.off * width(foh) / 4;
          foh.goal = aim;
        } else foh.goal = W / 2 + Math.sin(time * .9) * 30;
        var d = foh.goal - foh.x;
        foh.x += clamp(d, -reach * dt, reach * dt);
        var hw = width(foh) / 2;
        foh.x = clamp(foh.x, hw, W - hw);
        foh.v = dt > 0 ? (foh.x - was) / dt : 0;
      }

      function score() { return hits * 10 + mine * 100 + caught * 25; }

      /* ------------------------------------------------------ update */
      function update(dt) {
        time += dt;
        if (!mode || !level) return;
        [you, foh].forEach(function (p) { Object.keys(p.fx).forEach(function (k) { if (p.fx[k] > 0) p.fx[k] -= dt; }); });
        icons.forEach(function (c) { c.life -= dt; c.y += (c.y < MID ? 14 : -14) * dt; }); icons = icons.filter(function (c) { return c.life > 0; });

        var s = ctx.stick();
        you.v = s * SPEED;
        var hw = width(you) / 2;
        you.x = clamp(you.x + you.v * dt, hw, W - hw);

        if (mode === 'modern') {
          nextCap -= dt;
          if (nextCap <= 0 && !caps.length) { spawnCap(); nextCap = rnd(7, 11); }
          caps.forEach(function (c) { c.x += c.vx * dt; c.y += Math.sin((time - c.born) * 2) * 8 * dt; });
          caps = caps.filter(function (c) { return c.x > -30 && c.x < W + 30; });
        }

        if (wait > 0) { wait -= dt; if (wait <= 0) { if (firstServe) { firstServe = false; serve(); } else awaiting = true; } moveFoh(dt, null); tick(dt); return; }
        if (awaiting) { moveFoh(dt, null); tick(dt); return; }

        /* FOH meets the ball that will reach it first */
        var coming = balls.filter(function (b) { return b.vy < 0 && !b.gone; }).sort(function (a, b) { return (a.y - FOH_Y) / -a.vy - (b.y - FOH_Y) / -b.vy; })[0];
        moveFoh(dt, coming);

        var n = Math.max(1, Math.ceil(Math.max.apply(null, balls.map(function (b) { return b.speed; }).concat([1])) * dt / 7));
        for (var k = 0; k < n; k++) balls.forEach(function (b) { if (!b.gone) stepBall(b, dt / n); });
        balls.forEach(function (b) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 12) b.trail.shift(); });

        /* out the back: only the main ball scores; a bonus ball just goes */
        for (var i = 0; i < balls.length; i++) {
          var b = balls[i];
          if (b.gone) continue;
          if (b.y > H + 20 || b.y < -20) {
            if (b.extra) { b.gone = true; continue; }
            return point(b.y > H + 20 ? foh : you);
          }
        }
        balls = balls.filter(function (b) { return !b.gone; });
        tick(dt);
      }
      function tick(dt) {
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
        sparks = sparks.filter(function (p) { return p.life > 0; });
      }
      function point(winner) {
        balls = [];
        if (winner === foh) {
          theirs++; ctx.shake(5); ctx.sfx('miss');
          if (theirs >= MATCH) { setTimeout(function () { ctx.over(); }, 900); wait = 99; return; }
          serveTo = 1;
        } else {
          mine++; ctx.score(score()); ctx.sfx('point');
          serveTo = -1;
        }
        wait = .7;
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        g.fillStyle = '#0a0e16'; g.fillRect(-20, -20, W + 40, H + 40);
        for (var x = 20; x < W; x += 34) {
          g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(x, 0, 22, H);
          g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 10, 110, 2, H - 220);
        }
        g.strokeStyle = 'rgba(237,242,248,.14)'; g.setLineDash([6, 8]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, MID); g.lineTo(W, MID); g.stroke(); g.setLineDash([]);
        if (!mode || !level) return;            /* play.js draws the choice */

        meter(g, you, 10, '#2FD8FF'); meter(g, foh, W - 16, '#FF4FD8');
        tally(g);
        caps.forEach(function (c) { capsule(g, c); });
        fader(g, foh, FOH_Y, '#FF4FD8');
        fader(g, you, YOU_Y, '#2FD8FF');
        balls.forEach(function (b) { if (!b.gone) ball(g, b); });
        sparks.forEach(function (s) { g.globalAlpha = Math.min(1, s.life * 2); g.fillStyle = s.c || '#8FEBFF'; g.fillRect(s.x, s.y, 2, 2); });
        icons.forEach(function (c) { g.globalAlpha = Math.min(1, c.life * 2); icon(g, c.name, c.x, c.y, 1.1); });
        g.globalAlpha = 1;
        if (!ctx.touch) {
          var s = ctx.stick();
          g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(W / 2 - 60, H - 14, 120, 4);
          g.fillStyle = '#2FD8FF'; g.fillRect(W / 2 + Math.min(0, s * 60), H - 14, Math.abs(s) * 60, 4);
        }
        if (awaiting) {
          g.fillStyle = 'rgba(237,242,248,' + (.55 + .35 * Math.sin(time * 5)).toFixed(2) + ')'; g.font = '700 13px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(words(ctx.touch ? 'soundcheck_serve_touch' : 'soundcheck_serve_keys').toUpperCase(), W / 2, serveTo > 0 ? MID - 34 : MID + 34);
        }
      }
      /* each ball wears what it carries */
      function ball(g, b) {
        var home = b.vy > 0 ? you : foh;
        var magnetOn = home.fx.magnet > 0 && (b.vy > 0 ? b.y > MID : b.y < MID), proxOn = home.fx.prox > 0;
        var col = b.extra ? '#2FD8FF' : b.fx === 'fast' ? '#FF5A6E' : b.fx === 'loop' ? '#FFB547' : b.smash ? '#FFB547' : '#E8FBFF';
        var size = b.extra ? R * .75 : R;
        /* the trail: a flame for the fireball, a spiral for the loop, else a fade */
        b.trail.forEach(function (p, i) {
          var k = i / b.trail.length;
          if (b.fx === 'fast') { g.fillStyle = 'rgba(255,' + Math.round(120 + 100 * k) + ',60,' + (k * .6).toFixed(2) + ')'; g.beginPath(); g.arc(p.x + rnd(-1.5, 1.5), p.y, size * (.4 + k * .8), 0, 7); g.fill(); }
          else if (b.fx === 'loop') { var a = time * 12 + i; g.fillStyle = 'rgba(255,181,71,' + (k * .5).toFixed(2) + ')'; g.fillRect(p.x + Math.cos(a) * 4 - 1.5, p.y + Math.sin(a) * 4 - 1.5, 3, 3); }
          else { g.fillStyle = b.extra ? 'rgba(47,216,255,' + (k * .3).toFixed(2) + ')' : 'rgba(143,235,255,' + (k * .3).toFixed(2) + ')'; g.fillRect(p.x - size * .7, p.y - size * .7, size * 1.4, size * 1.4); }
        });
        if (magnetOn) {
          for (var r = 0; r < 2; r++) { var ph = (time * 2.5 + r * .5) % 1; g.strokeStyle = 'rgba(255,79,216,' + (1 - ph).toFixed(2) + ')'; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x, b.y, size + 3 + ph * 14, 0, 7); g.stroke(); }
        }
        if (proxOn) {
          var dist = Math.abs((b.vy > 0 ? YOU_Y : FOH_Y) - b.y) / (YOU_Y - FOH_Y);
          g.strokeStyle = 'rgba(216,245,90,.85)'; g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, size + 3 + dist * 18, 0, 7); g.stroke();
        }
        g.shadowColor = col; g.shadowBlur = b.smash || b.fx ? 20 : 12;
        g.fillStyle = col; g.fillRect(b.x - size, b.y - size, size * 2, size * 2);
        g.shadowBlur = 0;
      }
      /* a capsule: its color and its drawing, no words */
      function capsule(g, c) {
        var P = POWERS[c.name], pulse = 1 + Math.sin((time - c.born) * 6) * .06;
        g.save(); g.translate(c.x, c.y); g.scale(pulse, pulse);
        g.fillStyle = 'rgba(8,10,16,.92)'; g.beginPath(); g.arc(0, 0, BAND, 0, 7); g.fill();
        g.strokeStyle = P.col; g.lineWidth = 2.5; g.shadowColor = P.col; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0;
        g.restore();
        icon(g, c.name, c.x, c.y, pulse);
      }
      function icon(g, name, x, y, k) {
        var col = POWERS[name].col;
        g.save(); g.translate(x, y); g.scale(k, k); g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 2; g.lineCap = 'round';
        g.beginPath();
        if (name === 'wide') { g.fillRect(-9, -2, 18, 4); g.moveTo(-9, -5); g.lineTo(-12, 0); g.lineTo(-9, 5); g.moveTo(9, -5); g.lineTo(12, 0); g.lineTo(9, 5); g.stroke(); }
        else if (name === 'tiny') { g.fillRect(-3, -2, 6, 4); g.moveTo(-11, -5); g.lineTo(-7, 0); g.lineTo(-11, 5); g.moveTo(11, -5); g.lineTo(7, 0); g.lineTo(11, 5); g.stroke(); }
        else if (name === 'magnet') { g.arc(0, -1, 6, Math.PI, 0); g.moveTo(6, -1); g.lineTo(6, 6); g.moveTo(-6, -1); g.lineTo(-6, 6); g.lineWidth = 3.5; g.stroke(); }
        else if (name === 'prox') { g.arc(0, 0, 3, 0, 7); g.fill(); g.beginPath(); g.arc(0, 0, 8, 0, 7); g.stroke(); }
        else if (name === 'multi') { [[-5, 3], [5, 3], [0, -5]].forEach(function (p) { g.moveTo(p[0] + 3, p[1]); g.arc(p[0], p[1], 3, 0, 7); }); g.fill(); }
        else if (name === 'loop') { g.arc(0, -1, 5.5, .6, Math.PI * 2.3); g.stroke(); g.beginPath(); g.moveTo(-9, 7); g.lineTo(9, 7); g.stroke(); }
        else if (name === 'fast') { g.moveTo(-8, 6); g.quadraticCurveTo(-1, -9, 2, -9); g.quadraticCurveTo(7, -2, 4, 6); g.closePath(); g.fill(); }
        g.restore();
      }
      /* a fader shows what it has: lit long, cracked small, a magnet's pink, a halo's lime */
      function fader(g, p, y, col) {
        var w = width(p), x = p.x;
        g.fillStyle = '#1b2231'; roundRect(g, x - w / 2, y - PH / 2, w, PH, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x - w / 2 + 3, y - PH / 2 + 2, w - 6, 2);
        g.fillStyle = p.fx.wide > 0 ? '#5CF2C4' : col; g.shadowColor = g.fillStyle; g.shadowBlur = p.fx.wide > 0 ? 16 : 10;
        g.fillRect(x - w / 2 + 6, y - 1, w - 12, 2);
        g.shadowBlur = 0;
        if (p.fx.tiny > 0) { g.strokeStyle = '#9B7BFF'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 4, y - PH / 2); g.lineTo(x - 1, y); g.lineTo(x - 5, y + PH / 2); g.stroke(); }
        if (p.fx.magnet > 0) { g.strokeStyle = 'rgba(255,79,216,.7)'; g.lineWidth = 2; g.strokeRect(x - w / 2 - 3, y - PH / 2 - 3, w + 6, PH + 6); }
        if (p.fx.prox > 0) { g.strokeStyle = 'rgba(216,245,90,.6)'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, w / 2 + 10, PH + 6, 0, 0, 7); g.stroke(); }
      }
      function meter(g, p, x, col) {
        var n = 16, top = MID - 120, h = 240, seg = h / n, lvl = p.meter;
        for (var i = 0; i < n; i++) {
          var on = i < Math.round(lvl * n), y = top + h - (i + 1) * seg;
          g.fillStyle = on ? (i > 12 ? '#FF5A6E' : i > 9 ? '#FFB547' : '#5CF2C4') : 'rgba(255,255,255,.06)';
          g.fillRect(x, y + 1, 6, seg - 2);
        }
        g.save(); g.translate(x + 3, top + h + 10); g.fillStyle = 'rgba(138,150,166,.8)';
        g.font = '600 7px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText('dB', 0, 0); g.restore();
      }
      function tally(g) {
        g.font = '600 9px Inter, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,79,216,.85)';
        g.fillText(words('soundcheck_foh').toUpperCase() + '  ' + theirs + ' / ' + MATCH, W - 26, MID - 16);
        g.fillStyle = 'rgba(47,216,255,.85)';
        g.fillText(words('soundcheck_you').toUpperCase() + '  ' + mine, W - 26, MID + 16);
      }
      function roundRect(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }

      return {
        update: update, draw: draw,
        press: function (d) {
          if (awaiting && (d === 'left' || d === 'right' || d === 'up' || d === 'down' || d === 'go' || d === 'tap' || d === 'enter')) { awaiting = false; serve(); }
        },
        tapAt: function () {
          if (awaiting) { awaiting = false; serve(); return true; }
          return false;
        },
        stop: function () { balls = []; }
      };
    }
  };
})();
