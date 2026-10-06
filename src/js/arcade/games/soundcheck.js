/* =====================================================================
   Soundcheck — Pong on the desk (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "let's keep the soundcheck as pong" … "Don't do any
   feedback audio … Just fun references tied into the game would be good."
   And 2026-10-04, after playing it: it sped up too slowly; on a phone the
   finger hid the fader; the dB meter did nothing; the jokes went by too
   fast. "Add a lot of power ups that even the computer player can use …
   Use the funny meme style throws a baseball game sometimes uses. And you
   can even make some negative power ups. Make sure the computer has some
   logic to want or avoid certain power ups, but don't make it perfect."

   You hold the fader at the bottom; front of house (FOH) holds the one at
   the top. Every return turns the gain up — faster than before — and the
   match ends when FOH has five. Score: every return, plus ten for each
   point you take, plus five for each power you catch.

   TWO MODES, chosen at the start (← CLASSIC · MODERN →):
     classic   Pong.
     modern    power-ups drift across the middle. The ball catches one for
               whoever hit it last. Green ones help you, violet ones are
               aimed at the other fader, amber ones are trick balls (the
               meme throws), and red ones bite the one who catches them.

   THE dB METER does something now: every return fills it, and full, your
   next return is a SMASH. FOH has one too.

   THE CONTROLS: on a desktop ← → ease to full (play.js 'stick'); on a
   phone, two arrow buttons under the field (Chase, 2026-10-05, after the
   drag fader), which drive the same stick, so the finger never covers the
   play. The field is shorter on a phone for the same reason.

   THE PACE (round 3): the ball starts at 215 and tops out at 540; the
   capsules come one at a time, 7-11s apart, the first after 9s, and their
   families arrive in turn — helpers, then hexes, then trick throws, then
   the bad ones — so each is learned before the next.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, PW = 74, PH = 12, R = 6;
  /* Round 3 (Chase, 2026-10-05: "it's hard to process what's going on
     with the speed of the ball"): it starts slower, speeds up a little
     each return, and tops out well below where it did (270/790/1.07). */
  var BASE = 215, TOP = 540, GROW = 1.035;
  var MATCH = 5, SPEED = 470, BAND = 14;

  /* THE POWERS. kind: good (helps whoever catches it), hex (aimed at the
     other one), trick (a meme throw: the ball does something silly on its
     way to the other one), bad (bites whoever catches it). `t` is how long
     a fader effect lasts. `v` is how much the computer wants it. */
  /* Round 4 (Chase, 2026-10-05: "Some of the power ups feel too similar or
     I didn't know what to do"): fourteen, each doing one clearly different
     thing, each capsule labeled, each catch saying what it did. Gone: the
     ones that looked like another (tornado, banana, moon, count-in, sleepy,
     gain boost, haze, unplugged); BUTTERFINGERS is now ice, not a second
     Tiny fader. The trick balls are the five Chase asked for: fast,
     invisible, split, double bounce, squiggle. */
  var POWERS = {
    wide:     { kind: 'good',  t: 10, v: 2 },
    shield:   { kind: 'good',  t: 0,  v: 3 },
    slowmo:   { kind: 'good',  t: 8,  v: 2 },
    magnet:   { kind: 'good',  t: 8,  v: 2 },
    tiny:     { kind: 'hex',   t: 9,  v: 2 },
    flip:     { kind: 'hex',   t: 6,  v: 3 },
    mute:     { kind: 'hex',   t: 1.5, v: 3 },
    split:    { kind: 'trick', v: 2 },
    ghost:    { kind: 'trick', v: 2 },
    fast:     { kind: 'trick', v: 1 },
    zigzag:   { kind: 'trick', v: 2 },
    squiggle: { kind: 'trick', v: 1 },
    butter:   { kind: 'bad',   t: 7,  v: -3 },
    blackout: { kind: 'bad',   t: 2,  v: -2 }
  };
  /* HOW HARD: FOH's reach, how often it plans its return, how far off it
     lands, and the ball's pace */
  var DIFF = {
    easy:   { reach: 170, grow: 9,  smart: .3,  miss: 1.9, pace: .88, col: '#5CF2C4' },
    normal: { reach: 230, grow: 17, smart: .62, miss: 1,   pace: 1,   col: '#FFB547' },
    hard:   { reach: 320, grow: 22, smart: .92, miss: .45, pace: 1.1, col: '#FF5A6E' }
  };
  var NAMES = Object.keys(POWERS);
  var KIND = { good: '#5CF2C4', hex: '#9B7BFF', trick: '#FFB547', bad: '#FF5A6E' };
  var GLYPH = { wide: '⟷', magnet: 'U', shield: '▣', slowmo: '◷', tiny: '·', mute: 'M', flip: '⇄',
    fast: '»', ghost: '?', split: '⋔', zigzag: 'Z', squiggle: '∿', butter: '~', blackout: '●' };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  A.games.soundcheck = {
    size: function (o) { return { w: W, h: o && o.touch ? 560 : 640 }; },
    /* a phone gets two arrow buttons (Chase, 2026-10-05: "on mobile, just
       make it a left right arrow control system"); a keyboard keeps ← →
       easing to full, which is the same stick underneath */
    controls: function (o) { return o && o.touch ? 'dpad' : 'stick'; },
    padStart: ['left', 'right'],
    speaker: 'FOH',
    quipAt: .4,
    create: function (ctx) {
      var words = ctx.words, H = ctx.H;
      var YOU_Y = H - 46, FOH_Y = 50, MID = H / 2;
      var mode = null;                                   /* 'classic' | 'modern' once chosen */
      var level = null, D = DIFF.normal;                  /* how hard, once chosen */
      var awaiting = false;                              /* a point is over: the next serve waits for you */
      var you = { x: W / 2, v: 0, fx: {}, meter: 0, smash: false, id: 'you' };
      var foh = { x: W / 2, fx: {}, meter: 0, smash: false, id: 'foh', goal: W / 2, plan: null };
      var balls = [], caps = [], sparks = [], hist = [];
      var hits = 0, rally = 0, mine = 0, theirs = 0, caught = 0, wait = 1.1, serveTo = 1;
      var time = 0, nextCap = 9, flashT = 0, banner = null, spawned = 0, firstServe = true;

      function other(p) { return p === you ? foh : you; }
      function width(p) {
        var k = 1;
        if (p.fx.wide > 0) k *= 1.6;
        if (p.fx.tiny > 0) k *= .58;
        return PW * k;
      }

      /* ---------------------------------------------------- the ball */
      function newBall(x, y, vx, vy, owner) {
        var b = { x: x, y: y, vx: vx, vy: vy, speed: Math.hypot(vx, vy), owner: owner, fx: null, t: 0, extra: false,
          cx: x, cy: y, trail: [], smash: false };
        balls.push(b);
        return b;
      }
      function serve() {
        var ang = (Math.random() - .5) * .9;
        balls = [];
        newBall(W / 2, MID, Math.sin(ang) * BASE * D.pace, Math.cos(ang) * BASE * D.pace * serveTo, serveTo > 0 ? foh : you);
        rally = 0;
        ctx.sfx('hit');
        if (serveTo > 0) ctx.say(words('soundcheck_serve'));
      }
      function setVel(b, ang, dir) {
        b.vx = Math.sin(ang) * b.speed; b.vy = Math.cos(ang) * b.speed * dir;
      }

      /* A return: where it met the fader sets the angle, as in every Pong. */
      function bounce(b, p, dir) {
        var off = clamp((b.x - p.x) / (width(p) / 2), -1, 1);
        b.speed = Math.min(TOP * D.pace, Math.max(BASE * D.pace, b.speed) * GROW + (rally % 5 === 4 ? 12 : 0));
        b.fx = null; b.t = 0; b.owner = p; b.smash = false; b.zigged = false;
        /* the meter: full, and this return is a smash */
        p.meter = Math.min(1, p.meter + .13);
        if (p.meter >= 1) { p.meter = 0; b.smash = true; b.speed = Math.min(TOP * 1.2, b.speed * 1.3); ctx.shake(5); ctx.sfx('boom'); if (p === you) ctx.say(words('soundcheck_smash'), { mood: 'good', tag: 'FOH' }); }
        setVel(b, off * 1.05, dir);
        for (var i = 0; i < 10; i++) sparks.push({ x: b.x, y: b.y, vx: rnd(-90, 90), vy: dir * rnd(0, 120), life: .4, c: b.smash ? '#FFB547' : '#8FEBFF' });
        if (b.speed > 500) ctx.shake(1.5 + (b.speed - 500) / 110);
        ctx.sfx('hit');
      }

      /* ------------------------------------------------- the powers */
      function spawnCap() {
        /* the kinds arrive one family at a time, so each can be learned:
           helpers first, then hexes, then the silly throws, then the bad */
        var kinds = spawned < 3 ? ['good'] : spawned < 6 ? ['good', 'hex'] : spawned < 9 ? ['good', 'hex', 'trick'] : ['good', 'hex', 'trick', 'bad'];
        var pool = NAMES.filter(function (n) { return kinds.indexOf(POWERS[n].kind) >= 0; });
        var name = pool[Math.floor(Math.random() * pool.length)];
        spawned++;
        var left = Math.random() < .5;
        caps.push({ name: name, x: left ? -16 : W + 16, y: rnd(MID - H * .18, MID + H * .18), vx: (left ? 1 : -1) * rnd(26, 42), born: time });
      }
      function grant(name, p) {
        var P = POWERS[name], q = other(p);
        caught += p === you ? 1 : 0;
        if (p === you) ctx.score(score());
        var good = P.kind === 'good' || P.kind === 'hex' || P.kind === 'trick';
        ctx.sfx(P.kind === 'bad' ? 'powerdown' : 'powerup');
        banner = { name: name, who: p, t: 1.6 };
        /* what it did, in words: the name, who it landed on, and what it means */
        ctx.say('[' + (p === you ? words('soundcheck_you') : words('soundcheck_foh')).toUpperCase() + '] ' + words('soundcheck_p_' + name) + ': ' + words('soundcheck_d_' + name), { mood: (p === you) === good ? 'good' : 'bad' });
        if (P.kind === 'good') {
          if (name === 'shield') p.fx.shield = 1;
          else p.fx[name] = P.t;
        } else if (P.kind === 'hex') q.fx[name] = P.t;
        else if (P.kind === 'bad') { if (name === 'blackout') flashT = P.t; else p.fx[name] = P.t; }
        else {
          /* a trick ball: the ball that caught it does the trick */
          var b = trickBall;
          if (!b) return;
          b.fx = name; b.t = 0;
          if (name === 'fast') b.speed = Math.min(TOP * 1.15, b.speed * 1.3), setVel(b, Math.atan2(b.vx, Math.abs(b.vy)), b.vy > 0 ? 1 : -1);
          if (name === 'split') {
            [-.38, .38].forEach(function (d) {
              var ang = Math.atan2(b.vx, Math.abs(b.vy)) + d, n = newBall(b.x, b.y, 0, 0, b.owner);
              n.speed = b.speed; n.extra = true; setVel(n, ang, b.vy > 0 ? 1 : -1);
            });
          }
          if (name === 'zigzag') { b.zigAt = b.y + (b.vy > 0 ? 1 : -1) * Math.abs((b.vy > 0 ? YOU_Y : FOH_Y) - b.y) * .45; b.zigged = false; }
        }
        if (Math.random() < .35) ctx.quip('jokes_soundcheck_power', { mood: (p === you) === good ? 'good' : 'bad' });
      }
      var trickBall = null;

      /* ----------------------------------------------- the computer */
      /* Where a ball now heading for y will cross it, walls and all. */
      function landing(b, y) {
        var t = (y - b.y) / b.vy;
        if (t <= 0 || !isFinite(t)) return b.x;
        var x = b.x + b.vx * t, span = W - 2 * R, m = ((x - R) % (2 * span) + 2 * span) % (2 * span);
        return R + (m > span ? 2 * span - m : m);
      }
      /* FOH's plan for a ball on its way: where to stand, and so which way
         to send it back. It weighs the capsules on each return line — wants
         the good ones, steers clear of the red — and the gap it can leave
         you. Not always: some returns it just gets back. */
      function plan(b) {
        var land = landing(b, FOH_Y + PH);
        var smart = Math.random() < Math.min(.95, D.smart + rally * .02);
        var best = 0, bestV = -1e9, sp = Math.min(TOP, b.speed * GROW);
        for (var off = -.85; off <= .86; off += .17) {
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
        }
        if (!smart) best = rnd(-.6, .6);
        var miss = rnd(-1, 1) * Math.max(6, 30 - rally * 1.4) * D.miss * (flashT > 0 ? 2.2 : 1);
        return land - best * width(foh) / 2 + miss;
      }

      /* Where a ball will REALLY cross FOH's line: a copy of it run forward
         through the same motion — so a squiggle, a double bounce or the
         magnet's pull are followed, not guessed at from a straight line
         (round 4: "the AI didn't seem to know what to do with these power
         ups"). */
      function predict(b) {
        var c = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, speed: b.speed, fx: b.fx, t: b.t, zigAt: b.zigAt, zigged: b.zigged, sim: true };
        for (var k = 0; k < 480 && c.y > FOH_Y + PH; k++) motion(c, 1 / 120);
        return c.x;
      }
      /* the same pace as the other games (round 4): a return 10, a point 100, a catch 25 */
      function score() { return hits * 10 + mine * 100 + caught * 25; }
      function choose(m) { if (mode) return; mode = m; ctx.sfx('go'); }
      function chooseLevel(l) { if (!mode || level) return; level = l; D = DIFF[l]; ctx.sfx('go'); ctx.say(words('soundcheck_' + mode) + ' · ' + words('diff_' + l)); }
      var LEVELS = ['easy', 'normal', 'hard'];

      /* ------------------------------------------------------ update */
      function update(dt) {
        time += dt;
        if (!mode || !level) return;
        /* effects run down */
        [you, foh].forEach(function (p) { Object.keys(p.fx).forEach(function (k) { if (k !== 'shield' && p.fx[k] > 0) p.fx[k] -= dt; }); });
        flashT = Math.max(0, flashT - dt);
        if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

        /* your fader: the stick sets its speed, straight away */
        var s = ctx.stick();
        if (you.fx.flip > 0) s = -s;
        if (you.fx.mute > 0) s = 0;
        /* butterfingers: the fader slides as if on ice */
        if (you.fx.butter > 0) you.v += (s * SPEED - you.v) * Math.min(1, dt * 1.6);
        else you.v = s * SPEED;
        var hw = width(you) / 2;
        you.x = clamp(you.x + you.v * dt, hw, W - hw);

        if (mode === 'modern') {
          nextCap -= dt;
          /* one at a time, with room to breathe between (was every 2.6-4.6s, three at once) */
          if (nextCap <= 0 && !caps.length) { spawnCap(); nextCap = rnd(7, 11); }
          caps.forEach(function (c) { c.x += c.vx * dt; c.y += Math.sin((time - c.born) * 2) * 8 * dt; });
          caps = caps.filter(function (c) { return c.x > -30 && c.x < W + 30; });
        }

        if (wait > 0) { wait -= dt; if (wait <= 0) { if (firstServe) { firstServe = false; serve(); } else awaiting = true; } moveFoh(dt, null); tick(dt); return; }
        if (awaiting) { moveFoh(dt, null); tick(dt); return; }

        /* FOH */
        /* the ball that will reach FOH first, not merely the nearest */
        var coming = balls.filter(function (b) { return b.vy < 0 && !b.gone; }).sort(function (a, b) { return (a.y - FOH_Y) / -a.vy - (b.y - FOH_Y) / -b.vy; })[0];
        moveFoh(dt, coming);

        /* the balls: small steps, the fast ones are fast */
        var n = Math.max(1, Math.ceil(Math.max.apply(null, balls.map(function (b) { return b.speed; }).concat([1])) * dt / 7));
        for (var k = 0; k < n; k++) balls.forEach(function (b) { if (!b.gone) stepBall(b, dt / n); });
        balls.forEach(function (b) { b.trail.push({ x: b.x, y: b.y }); if (b.trail.length > 10) b.trail.shift(); });

        /* out the back */
        for (var i = 0; i < balls.length; i++) {
          var b = balls[i];
          if (b.gone) continue;
          if (b.y > H + 20) {
            if (you.fx.shield) { you.fx.shield = 0; b.y = YOU_Y - 30; b.vy = -Math.abs(b.vy); ctx.sfx('wall'); ctx.say(words('soundcheck_p_shield'), { mood: 'good' }); continue; }
            return point(foh);
          }
          if (b.y < -20) {
            if (foh.fx.shield) { foh.fx.shield = 0; b.y = FOH_Y + 30; b.vy = Math.abs(b.vy); ctx.sfx('wall'); continue; }
            return point(you);
          }
        }
        tick(dt);
      }
      function tick(dt) {
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
        sparks = sparks.filter(function (p) { return p.life > 0; });
      }
      function moveFoh(dt, b) {
        if (foh.fx.mute > 0) return;
        var reach = Math.min(620, D.reach + rally * D.grow + mine * 20) * (foh.fx.butter > 0 ? .55 : 1);
        if (b) {
          if (!b.plan || b.planFor !== b.t0) { b.plan = plan(b); b.planFor = b.t0; }
          /* a ghost or a blackout: FOH squints at where it was */
          var late = b.fx === 'ghost' || flashT > 0;
          /* a curving ball: re-aimed at where it will really arrive, a few
             times a second, keeping the planned offset */
          var curves = b.fx === 'zigzag' || b.fx === 'squiggle' || foh.fx.magnet > 0;
          if (curves && (!b.predAt || time - b.predAt > .2)) { b.predAt = time; b.pred = predict(b) + (b.plan - landing(b, FOH_Y + PH)); }
          var aim = curves && b.pred != null ? b.pred : b.plan;
          foh.goal = late ? aim + Math.sin(time * 3) * 22 : aim;
        } else foh.goal = W / 2 + Math.sin(time * .9) * 30;
        var d = foh.goal - foh.x;
        if (foh.fx.flip > 0) d = -d * .7;
        foh.x += clamp(d, -reach * dt, reach * dt);
        var hw = width(foh) / 2;
        foh.x = clamp(foh.x, hw, W - hw);
      }

      /* how a ball moves — its trick, the helpers on the side it is on, the
         walls — with nothing else: the computer runs copies of it */
      function motion(b, dt) {
        b.t += dt;
        var dir = b.vy > 0 ? 1 : -1, home = dir > 0 ? you : foh, mult = 1;
        if (b.fx === 'squiggle') b.x += Math.cos(b.t * 13) * 260 * dt;
        if (b.fx === 'zigzag' && !b.zigged && (dir > 0 ? b.y > b.zigAt : b.y < b.zigAt)) { b.zigged = true; b.vx = -b.vx * 1.15; if (!b.sim) ctx.sfx('zap'); }
        if (home.fx.slowmo > 0 && (dir > 0 ? b.y > MID : b.y < MID)) mult *= .62;
        if (home.fx.magnet > 0 && (dir > 0 ? b.y > MID : b.y < MID)) b.vx += clamp(home.x - b.x, -1, 1) * 420 * dt;
        b.x += b.vx * dt * mult; b.y += b.vy * dt * mult;
        if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); if (!b.sim) ctx.sfx('wall'); }
        if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); if (!b.sim) ctx.sfx('wall'); }
      }
      function stepBall(b, dt) {
        motion(b, dt);

        /* the faders */
        if (b.vy > 0 && b.y + R >= YOU_Y - PH / 2 && b.y < YOU_Y + PH && Math.abs(b.x - you.x) <= width(you) / 2 + R) {
          b.y = YOU_Y - PH / 2 - R;
          bounce(b, you, -1); b.t0 = time;
          hits++; rally++;
          ctx.score(score());
          if (rally % 7 === 0) ctx.quip('jokes_soundcheck_rally', { mood: 'good' });
          if (b.extra) b.gone = true;
        } else if (b.vy < 0 && b.y - R <= FOH_Y + PH / 2 && b.y > FOH_Y - PH && Math.abs(b.x - foh.x) <= width(foh) / 2 + R) {
          b.y = FOH_Y + PH / 2 + R;
          bounce(b, foh, 1); b.t0 = time;
          if (b.extra) b.gone = true;
        }

        /* a capsule in the ball's way is caught, for whoever hit it last */
        if (mode === 'modern') for (var i = caps.length - 1; i >= 0; i--) {
          var c = caps[i];
          if (Math.hypot(c.x - b.x, c.y - b.y) < BAND + R) {
            caps.splice(i, 1);
            trickBall = b; grant(c.name, b.owner); trickBall = null;
            for (var k = 0; k < 14; k++) sparks.push({ x: c.x, y: c.y, vx: rnd(-140, 140), vy: rnd(-140, 140), life: .5, c: KIND[POWERS[c.name].kind] });
          }
        }
      }

      function point(winner) {
        balls = [];
        if (winner === foh) {
          theirs++; ctx.shake(5); ctx.sfx('miss');
          /* the jokes come after a miss, where there is time to read them */
          ctx.quip('jokes_soundcheck_miss', { mood: 'bad', force: true });
          if (theirs >= MATCH) { setTimeout(function () { ctx.over(); }, 900); wait = 99; return; }
          serveTo = 1;
        } else {
          mine++; ctx.score(score()); ctx.sfx('point');
          ctx.quip('jokes_soundcheck_win', { mood: 'good', force: true });
          serveTo = -1;
        }
        wait = .7;
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        g.fillStyle = '#0a0e16'; g.fillRect(-20, -20, W + 40, H + 40);
        /* the desk: faint channel strips */
        for (var x = 20; x < W; x += 34) {
          g.fillStyle = 'rgba(255,255,255,.025)'; g.fillRect(x, 0, 22, H);
          g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x + 10, 110, 2, H - 220);
        }
        g.strokeStyle = 'rgba(237,242,248,.14)'; g.setLineDash([6, 8]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(0, MID); g.lineTo(W, MID); g.stroke(); g.setLineDash([]);

        if (!mode) return pick(g);
        if (!level) return ctx.cards(g, words('diff_pick'), LEVELS.map(function (l, i) {
          return { title: words('diff_' + l), line: words('diff_' + l + '_line'), key: ['←', '↑', '→'][i], col: DIFF[l].col };
        }), time);

        meter(g, you, 10, '#2FD8FF'); meter(g, foh, W - 16, '#FF4FD8');
        tally(g);

        caps.forEach(function (c) { capsule(g, c); });

        fader(g, foh, FOH_Y, '#FF4FD8');
        fader(g, you, YOU_Y, '#2FD8FF');

        balls.forEach(function (b) { if (!b.gone) ball(g, b); });
        sparks.forEach(function (s) { g.globalAlpha = Math.min(1, s.life * 2); g.fillStyle = s.c || '#8FEBFF'; g.fillRect(s.x, s.y, 2, 2); });
        g.globalAlpha = 1;

        /* the blackout */
        if (flashT > 0) { g.fillStyle = 'rgba(0,0,0,' + Math.min(.92, flashT * 2) + ')'; g.fillRect(0, 0, W, H); balls.forEach(function (b) { g.fillStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.arc(b.x, b.y, 3, 0, 7); g.fill(); }); }

        /* the stick, shown on a desktop too: which way and how fast */
        if (!ctx.touch) {
          var s = ctx.stick();
          g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(W / 2 - 60, H - 14, 120, 4);
          g.fillStyle = '#2FD8FF'; g.fillRect(W / 2 + Math.min(0, s * 60), H - 14, Math.abs(s) * 60, 4);
        }
        if (awaiting) {
          g.fillStyle = 'rgba(237,242,248,' + (.55 + .35 * Math.sin(time * 5)).toFixed(2) + ')'; g.font = '700 13px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(words(ctx.touch ? 'soundcheck_serve_touch' : 'soundcheck_serve_keys').toUpperCase(), W / 2, serveTo > 0 ? MID - 34 : MID + 34);
        }
        if (banner) {
          g.globalAlpha = Math.min(1, banner.t * 2);
          var P = POWERS[banner.name];
          g.font = '700 22px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = KIND[P.kind]; g.shadowColor = KIND[P.kind]; g.shadowBlur = 16;
          g.fillText(words('soundcheck_p_' + banner.name).toUpperCase(), W / 2, banner.who === you ? MID + 40 : MID - 40);
          g.shadowBlur = 0; g.globalAlpha = 1;
        }
      }
      function pick(g) {
        /* ← CLASSIC · MODERN → */
        [['classic', 0, '#2FD8FF'], ['modern', 1, '#FFB547']].forEach(function (m) {
          var x = m[1] ? W / 2 + 8 : 14, y = H / 2 - 110, w = W / 2 - 22, h = 220, on = Math.sin(time * 4 + m[1] * 3) > 0;
          g.fillStyle = 'rgba(12,16,26,.92)'; g.fillRect(x, y, w, h);
          g.strokeStyle = m[2]; g.lineWidth = on ? 2 : 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
          g.fillStyle = m[2]; g.font = '700 17px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(words('soundcheck_' + m[0]).toUpperCase(), x + w / 2, y + 40);
          g.fillStyle = 'rgba(237,242,248,.8)'; g.font = '500 11px Inter, sans-serif';
          wrap(g, words('soundcheck_' + m[0] + '_line'), x + w / 2, y + 80, w - 20, 15);
          g.fillStyle = m[2]; g.font = '700 22px Sora, sans-serif';
          g.fillText(m[1] ? '→' : '←', x + w / 2, y + h - 34);
        });
      }
      function wrap(g, text, x, y, max, lh) {
        var line = '', yy = y;
        String(text).split(' ').forEach(function (word) {
          var test = line ? line + ' ' + word : word;
          if (g.measureText(test).width > max && line) { g.fillText(line, x, yy); line = word; yy += lh; } else line = test;
        });
        g.fillText(line, x, yy);
      }
      function ball(g, b) {
        b.trail.forEach(function (p, i) {
          if (b.fx === 'ghost') return;
          g.fillStyle = 'rgba(143,235,255,' + (i / b.trail.length * .3).toFixed(2) + ')';
          g.fillRect(p.x - R * .7, p.y - R * .7, R * 1.4, R * 1.4);
        });
        var hot = (b.speed - BASE) / (TOP - BASE), col = b.smash ? '#FFB547' : hot > .6 ? '#FFE1A8' : '#E8FBFF';
        if (b.fx === 'ghost') {
          /* hard to see, not impossible: a faint shimmer, and a ring now and then */
          g.fillStyle = 'rgba(232,251,255,.07)'; g.fillRect(b.x - R, b.y - R, R * 2, R * 2);
          var ring = (b.t * 3) % 1;
          if (ring < .35) { g.strokeStyle = 'rgba(232,251,255,' + (.35 - ring).toFixed(2) + ')'; g.lineWidth = 1; g.beginPath(); g.arc(b.x, b.y, 4 + ring * 30, 0, 7); g.stroke(); }
          return;
        }
        var size = R;
        g.shadowColor = col; g.shadowBlur = b.smash ? 22 : 14;
        g.fillStyle = col; g.fillRect(b.x - size, b.y - size, size * 2, size * 2);
        g.shadowBlur = 0;
      }
      function capsule(g, c) {
        var P = POWERS[c.name], col = KIND[P.kind], pulse = 1 + Math.sin((time - c.born) * 6) * .06;
        g.save(); g.translate(c.x, c.y); g.scale(pulse, pulse);
        g.fillStyle = 'rgba(8,10,16,.9)'; g.beginPath(); g.arc(0, 0, BAND, 0, 7); g.fill();
        g.strokeStyle = col; g.lineWidth = 2; g.shadowColor = col; g.shadowBlur = 10; g.stroke(); g.shadowBlur = 0;
        g.fillStyle = col; g.font = '700 13px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(GLYPH[c.name] || '?', 0, 1);
        /* its name under it, so it can be read before it is caught */
        g.font = '700 8px Sora, sans-serif'; g.fillStyle = col; g.fillText(words('soundcheck_p_' + c.name).toUpperCase(), 0, BAND + 9);
        g.restore();
      }
      function fader(g, p, y, col) {
        var w = width(p), x = p.x;
        var frozen = p.fx.mute > 0;
        g.fillStyle = '#1b2231'; roundRect(g, x - w / 2, y - PH / 2, w, PH, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x - w / 2 + 3, y - PH / 2 + 2, w - 6, 2);
        g.fillStyle = frozen ? '#8A96A6' : col; g.shadowColor = col; g.shadowBlur = frozen ? 0 : 10;
        g.fillRect(x - w / 2 + 6, y - 1, w - 12, 2);
        g.shadowBlur = 0;
        if (p.fx.shield) { g.strokeStyle = '#5CF2C4'; g.lineWidth = 2; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, p === you ? H - 6 : 6); g.lineTo(W, p === you ? H - 6 : 6); g.stroke(); g.setLineDash([]); }
        if (p.fx.butter > 0) { g.fillStyle = 'rgba(180,230,255,.35)'; g.fillRect(x - w / 2 - 4, y + PH / 2, w + 8, 3); }
        if (p.fx.flip > 0) { g.fillStyle = '#9B7BFF'; g.font = '700 10px Sora, sans-serif'; g.textAlign = 'center'; g.fillText('⇄', x, y + (p === you ? 16 : -14)); }
        if (frozen) { g.fillStyle = '#8A96A6'; g.font = '700 9px Sora, sans-serif'; g.textAlign = 'center'; g.fillText(words('soundcheck_muted').toUpperCase(), x, y + (p === you ? 16 : -14)); }
      }
      /* the dB meter: every return fills it; full, the next return smashes */
      function meter(g, p, x, col) {
        var n = 16, top = MID - 120, h = 240, seg = h / n, lvl = p.meter;
        for (var i = 0; i < n; i++) {
          var on = i < Math.round(lvl * n);
          var y = top + h - (i + 1) * seg;
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
          if (!mode) { if (d === 'left' || d === 'right') choose(d === 'left' ? 'classic' : 'modern'); else if (d === 'go') choose('modern'); return; }
          if (!level) { chooseLevel(d === 'left' ? 'easy' : d === 'right' ? 'hard' : 'normal'); return; }
          if (awaiting && (d === 'left' || d === 'right' || d === 'up' || d === 'down' || d === 'go' || d === 'tap')) { awaiting = false; serve(); }
        },
        /* a tap: on a card, or anywhere to serve */
        tapAt: function (x, y) {
          if (!mode) { choose(x < W / 2 ? 'classic' : 'modern'); return true; }
          if (!level) { var i = ctx.cardAt(x, y); if (i >= 0) { chooseLevel(LEVELS[i]); return true; } return false; }
          if (awaiting) { awaiting = false; serve(); return true; }
          return false;
        },
        stop: function () { balls = []; }
      };
    }
  };
})();
