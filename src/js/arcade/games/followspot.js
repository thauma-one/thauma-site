/* =====================================================================
   Follow Spot — keep the light on them (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-30: "looks like one-dimensional spotlight tracking until
   the director says 'use your tilt'. Then it's 2D, with backflips, stage
   dives and hiding behind other people. The performer you pick is the
   difficulty." 2026-10-05: "Make it enjoyable with good progression, but
   throw in some funny things. (And give it d pad control layout)". And,
   round 4: "It either needs to be harder, or a smaller spotlight, or less
   leeway … where is the child difficulty level we talked about!! And we
   should add more levels to the stage the harder it is and have the logic
   use them a little bit more. Feel free to start with the verticality …
   The more ideas like flips, crawling, hiding, moonwalking, etc
   techniques we add I think are going to be the appeal of this game".

   You run the follow spot from the booth. Pick who you are lighting —
   the PASTOR walks and talks, the WORSHIP LEADER roams, the YOUTH PASTOR
   is everywhere, and THE KID (the lead in the kids' musical, two juice
   boxes in) is small, fast and changes their mind — and keep the light on
   them. On target, the points run, faster the longer you hold it; off
   target, the director's patience runs out instead, quickly.

   THE STAGE HAS LEVELS from the first second, and the spot tilts from the
   first second: the deck, two risers, the drum riser, two ladders up to a
   catwalk. The harder the performer, the more of it they use.

   THE MOVES: walking and talking, hopping between levels, climbing the
   ladders, jumps and backflips, cartwheels, the moonwalk, the army crawl,
   knee slides, the worm, striking a pose, hiding behind the band, stage
   dives and crowd surfing. Each new move is named as it starts.

   THE SERVICE runs in acts (WELCOME, WORSHIP, THE MESSAGE, ONE MORE SONG)
   that unlock the moves and quicken the pace. And the funny things: a
   SHEEP (the sermon illustration), a MOTH in the beam, the FOG MACHINE.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 400, H = 560;
  var DECK = 420, CROWD = 478, GRAV = 900;
  /* the levels: the deck, two risers, the drum riser, the catwalk */
  var PLATS = [
    { x0: -10, x1: 410, y: DECK },
    { x0: 28, x1: 118, y: DECK - 44 },
    { x0: 160, x1: 240, y: DECK - 64 },
    { x0: 282, x1: 372, y: DECK - 44 },
    { x0: 92, x1: 308, y: DECK - 176 }
  ];
  var LADDERS = [{ x: 140, lo: 0, hi: 4 }, { x: 260, lo: 0, hi: 4 }];
  /* who you light: pace, how often they do something, which levels they
     use, which moves they have, and their size (the kid is small) */
  var WHO = [
    { key: 'pastor', speed: 48, rate: .45, plats: [0, 1, 3], moves: ['talk', 'pose', 'moonwalk', 'hop', 'jump', 'hide', 'kneeslide'], col: '#2FD8FF', skin: '#e2b48f', hair: '#6d6d72', size: 1, worth: 1 },
    { key: 'leader', speed: 72, rate: .7, plats: [0, 1, 2, 3, 4], moves: ['hop', 'jump', 'flip', 'kneeslide', 'cartwheel', 'hide', 'pose', 'climb', 'dive', 'moonwalk'], col: '#5CF2C4', skin: '#c68e6a', hair: '#2a1d16', size: 1, worth: 1.5 },
    { key: 'youth', speed: 96, rate: 1, plats: [0, 1, 2, 3, 4], moves: ['hop', 'jump', 'flip', 'kneeslide', 'cartwheel', 'hide', 'climb', 'dive', 'worm', 'crawl', 'moonwalk', 'pose'], col: '#FF4FD8', skin: '#efc29b', hair: '#FFB547', size: 1, worth: 2 },
    { key: 'kid', speed: 118, rate: 1.25, plats: [0, 1, 2, 3, 4], moves: ['hop', 'jump', 'flip', 'cartwheel', 'hide', 'climb', 'worm', 'crawl', 'kneeslide', 'pose', 'dive'], col: '#FFB547', skin: '#f1c7a1', hair: '#8a4b24', size: .7, worth: 2.6 }
  ];
  /* the acts: when each starts, the LED wall's color, which moves unlock, the pace */
  var ACTS = [
    { key: 'welcome', at: 0,  wall: [47, 216, 255],  moves: ['talk', 'pose', 'hop', 'jump', 'moonwalk', 'climb'], pace: .85 },
    { key: 'worship', at: 22, wall: [155, 123, 255], moves: ['talk', 'pose', 'hop', 'jump', 'moonwalk', 'climb', 'flip', 'kneeslide', 'cartwheel', 'hide'], pace: 1 },
    { key: 'message', at: 55, wall: [255, 181, 71],  moves: ['talk', 'pose', 'hop', 'jump', 'moonwalk', 'climb', 'flip', 'kneeslide', 'cartwheel', 'hide', 'crawl', 'worm', 'dive'], pace: 1.12 },
    { key: 'encore',  at: 95, wall: [255, 79, 216],  moves: null, pace: 1.25 }
  ];
  /* moves that are announced as they start */
  var NAMED = { flip: 1, cartwheel: 1, moonwalk: 1, crawl: 1, kneeslide: 1, worm: 1, pose: 1, climb: 1 };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pickOf(a) { return a[Math.floor(Math.random() * a.length)]; }

  A.games.followspot = {
    size: { w: W, h: H },
    controls: 'dpad',
    pad: 'cross',
    padStart: ['left', 'up', 'right', 'down'],
    speaker: 'DIR',
    quipAt: .1,
    create: function (ctx) {
      var words = ctx.words;
      var who = null, time = 0, played = 0, score = 0, streak = 0, patience = 1, act = 0, offBy = 0;
      var spot = { x: W / 2, y: DECK - 50, vx: 0, vy: 0, r: 38 };
      var p = { x: W / 2, y: DECK, vx: 0, vy: 0, plat: 0, act: 'walk', t: 0, dir: 1, rot: 0, goal: W / 2, hidden: false, air: false, low: false };
      var band = [{ x: 74, plat: 1, h: 64, kind: 'bass', col: '#3a3350' }, { x: 326, plat: 3, h: 70, kind: 'guitar', col: '#38304a' }, { x: 200, plat: 2, h: 58, kind: 'drums', col: '#2c2740' }];
      var crowd = [], pops = [], nextMove = 2, gagIn = 12, sheep = null, moth = null, fog = 0;
      for (var i = 0; i < 46; i++) crowd.push({ x: i * 9 + rnd(-3, 3), h: rnd(16, 28), ph: rnd(0, 6), phone: Math.random() < .3 });

      function choose(i) {
        if (who) return;
        who = WHO[i];
      }
      ctx.menu({
        heading: words('followspot_pick'), start: 0,
        items: WHO.map(function (w2, i) { return { title: words('followspot_' + w2.key), line: '★'.repeat(i + 1) + ' ' + words('followspot_' + w2.key + '_line'), col: w2.col }; }),
        pick: choose
      });
      function cur() { return ACTS[act]; }
      function platAt(i) { return PLATS[i]; }
      function onPlat(x, i) { var q = PLATS[i]; return x >= q.x0 && x <= q.x1; }

      /* ---- the performer's mind ---- */
      function pace() { return who.speed * cur().pace * (1 + Math.min(played, 150) / 400); }
      function allowed() {
        var m = cur().moves;
        return who.moves.filter(function (k) { return !m || m.indexOf(k) >= 0; });
      }
      function nextAction() {
        p.t = 0; p.hidden = false; p.low = false; p.rot = 0; p.label = null;
        var plat = platAt(p.plat);
        /* mostly a walk somewhere on this level; otherwise a move */
        if (Math.random() > Math.min(.75, .3 + who.rate * .3)) {
          p.act = 'walk'; p.goal = clamp(p.x + rnd(-1, 1) * 160 * (.5 + who.rate * .5), plat.x0 + 10, plat.x1 - 10);
          if (who.key === 'kid' && Math.random() < .5) p.goal = clamp(p.x + (Math.random() < .5 ? -1 : 1) * rnd(40, 120), plat.x0 + 10, plat.x1 - 10);
          return;
        }
        var list = allowed().filter(function (k) {
          if (k === 'hide' || k === 'dive' || k === 'kneeslide' || k === 'worm' || k === 'crawl') return p.plat === 0;
          if (k === 'climb') return (p.plat === 0 || p.plat === 4) && who.plats.indexOf(4) >= 0;
          return true;
        });
        var k = pickOf(list.length ? list : ['walk']);
        start(k);
      }
      function start(k) {
        p.act = k; p.t = 0;
        /* the ladder from the catwalk goes down, and says so (round 6) */
        var label = k === 'climb' && p.plat !== 0 ? 'climbdown' : k;
        if (NAMED[k]) pops.push({ x: p.x, y: p.y - 80 * who.size, text: words('followspot_s_' + label), life: 1.3, col: who.col });
        if (k === 'talk' || k === 'pose') return;
        if (k === 'jump') { p.vy = -430; p.air = true; return; }
        if (k === 'flip') { p.vy = -560; p.air = true; ctx.quip('jokes_followspot_stunt'); return; }
        if (k === 'hop') {
          /* to another level they use: up onto a riser, or down off it */
          var near = who.plats.filter(function (i) { return i !== p.plat && i !== 4 && Math.abs(platAt(i).y - platAt(p.plat).y) < 90; });
          if (!near.length) { p.act = 'walk'; p.goal = p.x; return; }
          var to = pickOf(near), q = platAt(to), tx = clamp(p.x + (q.x0 + q.x1) / 2 - p.x, q.x0 + 14, q.x1 - 14);
          if (Math.abs(tx - p.x) > 170) tx = p.x + Math.sign(tx - p.x) * 170;
          var T = .7, dy = q.y - p.y;
          p.vx = (tx - p.x) / T; p.vy = (dy - .5 * GRAV * T * T) / T; p.air = true; p.dir = p.vx > 0 ? 1 : -1;
          return;
        }
        if (k === 'climb') {
          var lad = LADDERS.reduce(function (a, b) { return Math.abs(a.x - p.x) < Math.abs(b.x - p.x) ? a : b; });
          p.ladder = lad; p.toPlat = p.plat === 0 ? lad.hi : lad.lo; p.goal = lad.x; p.phase = 'to';
          return;
        }
        if (k === 'cartwheel') { p.dir = Math.random() < .5 ? -1 : 1; return; }
        if (k === 'moonwalk') { p.dir = Math.random() < .5 ? -1 : 1; return; }
        if (k === 'kneeslide') { p.dir = p.x < W / 2 ? 1 : -1; p.vx = p.dir * 270; p.low = true; return; }
        if (k === 'crawl' || k === 'worm') { p.dir = p.x < W / 2 ? 1 : -1; p.low = true; return; }
        if (k === 'hide') { var b = pickOf(band); p.hideAt = b; p.goal = b.x; return; }   /* behind a band member's riser */
        if (k === 'dive') { p.dir = p.x < W / 2 ? -1 : 1; p.vy = -380; p.vx = p.dir * 60; p.air = true; ctx.say(words('followspot_dive'), { tag: 'DIR' }); return; }
      }

      function think(dt) {
        p.t += dt;
        var sp = pace(), plat = platAt(p.plat);
        if (p.air) return airborne(dt);
        switch (p.act) {
          case 'walk': {
            var d = p.goal - p.x; if (Math.abs(d) > 1) p.dir = d > 0 ? 1 : -1;
            p.x += clamp(d, -sp * dt, sp * dt);
            if (Math.abs(d) < 3 || p.t > 3.5) nextIn(who.key === 'kid' ? rnd(.1, .5) : rnd(.3, 1.2));
            break;
          }
          case 'talk': if (p.t > 1.8) nextAction(); break;
          case 'pose': if (p.t > 1.3) nextAction(); break;
          case 'cartwheel':
            p.x += p.dir * 120 * dt; p.rot = p.t / 1 * Math.PI * 2 * p.dir;
            if (p.t > 1 || p.x < plat.x0 + 8 || p.x > plat.x1 - 8) { p.rot = 0; p.x = clamp(p.x, plat.x0 + 8, plat.x1 - 8); nextAction(); }
            break;
          case 'moonwalk':
            /* gliding backwards, facing the other way */
            p.x -= p.dir * 62 * dt;
            if (p.t > 1.8 || p.x < plat.x0 + 8 || p.x > plat.x1 - 8) { p.x = clamp(p.x, plat.x0 + 8, plat.x1 - 8); nextAction(); }
            break;
          case 'kneeslide':
            p.x += p.vx * dt; p.vx *= Math.pow(.18, dt);
            if (Math.abs(p.vx) < 25 || p.x < 12 || p.x > W - 12) { p.x = clamp(p.x, 12, W - 12); nextAction(); }
            break;
          case 'crawl': case 'worm':
            p.x += p.dir * (p.act === 'worm' ? 46 : 38) * dt;
            if (p.t > 2.2 || p.x < 12 || p.x > W - 12) { p.x = clamp(p.x, 12, W - 12); nextAction(); }
            break;
          case 'hide': {
            var dh = p.hideAt.x - p.x; p.dir = dh > 0 ? 1 : -1;
            p.x += clamp(dh, -sp * 1.3 * dt, sp * 1.3 * dt);
            if (Math.abs(dh) < 3) { p.hidden = true; if (!p.hidT) p.hidT = p.t; if (p.t - p.hidT > 2.4) { p.hidden = false; p.hidT = 0; nextAction(); } }
            break;
          }
          case 'climb': {
            var lad = p.ladder;
            if (p.phase === 'to') {
              var dl = lad.x - p.x; p.dir = dl > 0 ? 1 : -1; p.x += clamp(dl, -sp * dt, sp * dt);
              if (Math.abs(dl) < 2) p.phase = 'up';
            } else {
              var ty = platAt(p.toPlat).y, dy = ty - p.y;
              p.y += clamp(dy, -78 * dt, 78 * dt);
              if (Math.abs(dy) < 1) { p.y = ty; p.plat = p.toPlat; nextAction(); }
            }
            break;
          }
          case 'surf':
            /* crowd surfing: carried along, bobbing, then back up onto the deck */
            p.x += p.dir * 52 * dt; p.y = CROWD + 6 + Math.sin(p.t * 5) * 4;
            if (p.x < 30 || p.x > W - 30) p.dir = -p.dir;
            if (p.t > 3) { p.act = 'jump'; p.vy = -560; p.vx = (W / 2 - p.x) * .8; p.air = true; p.plat = 0; }
            break;
          default: nextAction();
        }
        /* walked off the end of a riser or the catwalk: fall */
        if (!p.air && p.act !== 'climb' && p.act !== 'surf' && !onPlat(p.x, p.plat)) { p.air = true; p.vy = 0; p.vx = p.dir * 40; }
      }
      function nextIn(s) { p.act = 'talk'; p.t = 1.8 - s; }
      function airborne(dt) {
        p.vy += GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.act === 'flip') p.rot += dt * 9 * (p.dir || 1);
        p.x = clamp(p.x, 6, W - 6);
        if (p.act === 'dive' && p.y > CROWD) { p.air = false; p.act = 'surf'; p.t = 0; p.vy = 0; p.rot = 0; return; }
        if (p.vy > 0) {
          /* land on the highest level under the feet that was just crossed */
          for (var i = 0; i < PLATS.length; i++) {
            var q = PLATS[i];
            if (onPlat(p.x, i) && p.y >= q.y && p.y - p.vy * dt <= q.y + 2 && !(p.act === 'dive')) {
              p.y = q.y; p.plat = i; p.air = false; p.vx = 0; p.vy = 0; p.rot = 0;
              ctx.sfx('thud', { vol: .2 });
              nextAction(); return;
            }
          }
          if (p.y > DECK + 40 && p.act !== 'dive') { p.y = DECK; p.plat = 0; p.air = false; p.vx = 0; p.vy = 0; nextAction(); }
        }
      }

      /* ---- the funny things ---- */
      function gag() {
        var pool = ['sheep'];
        if (act >= 1) pool.push('moth', 'fog');
        var g2 = pickOf(pool);
        if (g2 === 'sheep' && !sheep) { var from = Math.random() < .5 ? -1 : 1; sheep = { x: from < 0 ? -30 : W + 30, dir: -from, t: 0, lit: 0, told: false, baa: 1.5 }; }
        else if (g2 === 'moth' && !moth) { moth = { x: spot.x + 60, y: spot.y - 50, t: 0, a: 0 }; ctx.quip('jokes_followspot_moth'); }
        else if (g2 === 'fog' && fog <= 0) { fog = 9; ctx.sfx('slide'); ctx.quip('jokes_followspot_fog'); }
      }
      function gags(dt, on) {
        gagIn -= dt;
        if (gagIn <= 0) { gagIn = rnd(12, 20); gag(); }
        if (sheep) {
          sheep.t += dt; sheep.x += sheep.dir * 34 * dt;
          sheep.baa -= dt; if (sheep.baa <= 0) { sheep.baa = rnd(2.5, 4); pops.push({ x: sheep.x, y: DECK - 40, text: words('followspot_baa'), life: 1.1, col: '#EDF2F8' }); }
          if (!on && Math.hypot(sheep.x - spot.x, DECK - 14 - spot.y) < spot.r + 4) {
            sheep.lit += dt;
            if (sheep.lit > .5 && !sheep.told) { sheep.told = true; ctx.quip('jokes_followspot_sheep'); }
          }
          if (sheep.x < -40 || sheep.x > W + 40) sheep = null;
        }
        if (moth) {
          moth.t += dt; moth.a += dt * rnd(4, 9);
          var tx = spot.x + Math.cos(moth.a) * spot.r * .5, ty = spot.y + Math.sin(moth.a * 1.3) * spot.r * .4;
          moth.x += (tx - moth.x) * Math.min(1, dt * 3) + rnd(-40, 40) * dt; moth.y += (ty - moth.y) * Math.min(1, dt * 3) + rnd(-40, 40) * dt;
          if (moth.t > 9) { moth.y -= 120 * dt * (moth.t - 9) * 3; if (moth.t > 10.5) moth = null; }
        }
        if (fog > 0) fog -= dt;
      }

      /* where the light has to be: the middle of them, lower when they are low */
      function center() {
        var s = who.size;
        if (p.act === 'surf') return { x: p.x, y: p.y - 6 };
        if (p.low) return { x: p.x, y: p.y - 9 * s };
        return { x: p.x, y: p.y - 30 * s };
      }

      /* ---- your light ---- */
      function update(dt) {
        time += dt;
        if (!who) return;
        played += dt;
        while (act < ACTS.length - 1 && played >= ACTS[act + 1].at) {
          act++;
          pops.push({ x: W / 2, y: 120, text: words('followspot_act_' + ACTS[act].key), life: 2.4, col: 'rgb(' + ACTS[act].wall.join(',') + ')', big: true });
          ctx.sfx('combo');
        }
        think(dt);
        var ax = (ctx.held.right ? 1 : 0) - (ctx.held.left ? 1 : 0), ay = (ctx.held.down ? 1 : 0) - (ctx.held.up ? 1 : 0);
        spot.vx = spot.vx + (ax * 270 - spot.vx) * Math.min(1, dt * 9);
        spot.vy = spot.vy + (ay * 250 - spot.vy) * Math.min(1, dt * 9);
        spot.x = clamp(spot.x + spot.vx * dt, 20, W - 20);
        spot.y = clamp(spot.y + spot.vy * dt, 120, CROWD + 20);
        /* a tighter iris than before (round 4: "too lenient"), closing as
           the night goes on */
        spot.r = Math.max(24, 38 - played * .05);

        /* on them: their middle inside the pool, with no leeway past its edge */
        var c = center(), on = Math.hypot(c.x - spot.x, c.y - spot.y) < spot.r - 2;
        if (p.hidden) on = Math.abs(p.x - spot.x) < spot.r * .8 && Math.abs(p.y - 30 - spot.y) < spot.r * 1.5;
        gags(dt, on);
        if (on) {
          offBy = 0; streak += dt;
          var m = streak > 6 ? 3 : streak > 3 ? 2 : 1;
          /* 5 a second, ×3 at most, × who (round 4: it was 30 ×4 ×who, up to 300 a second) */
          score += dt * 5 * m * who.worth;
          patience = Math.min(1, patience + dt * .08);
          if ((p.act === 'flip' || p.act === 'surf' || p.act === 'cartwheel' || p.act === 'worm') && !p.nailed) {
            p.nailed = true; score += 50; pops.push({ x: p.x, y: p.y - 70, text: words('followspot_nailed'), life: 1.4 }); ctx.sfx('combo');
          }
        } else {
          offBy += dt;
          if (streak > 6) ctx.quip('jokes_followspot_lost');
          streak = 0;
          /* the director notices almost at once, and runs out quicker */
          if (offBy > .15) patience -= dt * (.14 + Math.min(played, 150) / 900);
          if (patience <= 0) { patience = 0; ctx.say(words('followspot_fired'), { tag: 'DIR', mood: 'bad' }); ctx.sfx('gameover'); who = null; setTimeout(function () { ctx.over(); }, 1000); return; }
          if (patience < .3) ctx.quip('jokes_followspot_dark');
        }
        if (p.act === 'walk' || p.act === 'talk') p.nailed = false;
        ctx.score(score);
        pops.forEach(function (q) { q.y -= 20 * dt; q.life -= dt; }); pops = pops.filter(function (q) { return q.life > 0; });
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        g.fillStyle = '#05060a'; g.fillRect(-20, -20, W + 40, H + 40);
        var wc = (who ? cur() : ACTS[0]).wall.join(',');
        /* the LED wall upstage */
        var led = g.createLinearGradient(0, 70, 0, DECK);
        led.addColorStop(0, 'rgba(' + wc + ',' + (.1 + .04 * Math.sin(time * .8)).toFixed(3) + ')'); led.addColorStop(1, 'rgba(' + wc + ',.02)');
        g.fillStyle = led; g.fillRect(20, 70, W - 40, DECK - 100);
        g.fillStyle = 'rgba(0,0,0,.35)';
        for (var lx = 20; lx < W - 20; lx += 6) g.fillRect(lx, 70, 1, DECK - 100);
        for (var ly = 70; ly < DECK - 30; ly += 6) g.fillRect(20, ly, W - 40, 1);
        /* the top truss and its lights */
        g.strokeStyle = '#1f2533'; g.lineWidth = 1.5; g.beginPath();
        for (var x = 0; x <= W; x += 16) { g.moveTo(x, 44); g.lineTo(x + 8, 56); g.lineTo(x + 16, 44); } g.moveTo(0, 44); g.lineTo(W, 44); g.moveTo(0, 56); g.lineTo(W, 56); g.stroke();
        g.save(); g.globalCompositeOperation = 'lighter';
        [50, 150, 250, 350].forEach(function (fx, k) {
          var sw = Math.sin(time * .7 + k * 1.7) * 40, bm = g.createLinearGradient(fx, 58, fx + sw, DECK);
          bm.addColorStop(0, 'rgba(' + wc + ',.14)'); bm.addColorStop(1, 'rgba(' + wc + ',0)');
          g.fillStyle = bm; g.beginPath(); g.moveTo(fx - 3, 60); g.lineTo(fx + 3, 60); g.lineTo(fx + sw + 30, DECK); g.lineTo(fx + sw - 30, DECK); g.closePath(); g.fill();
        });
        g.restore();
        [50, 150, 250, 350].forEach(function (fx) { g.fillStyle = '#2a3142'; g.fillRect(fx - 5, 56, 10, 7); });
        levels(g);
        band.forEach(function (b) { if (b.kind === 'drums') musician(g, b); });
        if (sheep) sheepDraw(g);
        if (who) performer(g);
        band.forEach(function (b) { if (b.kind !== 'drums') musician(g, b); });
        if (fog > 0) fogDraw(g);
        if (who) light(g);
        if (moth) mothDraw(g);
        crowdDraw(g);
        if (!who) return;                       /* play.js draws the choice */
        hud(g);
        pops.forEach(function (q) {
          g.globalAlpha = Math.min(1, q.life * 2); g.fillStyle = q.col || '#FFB547';
          g.font = (q.big ? '700 20px' : '700 13px') + ' Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(String(q.text).toUpperCase(), clamp(q.x, 70, W - 70), q.y);
        });
        g.globalAlpha = 1;
      }
      /* the deck, the risers with their lit edges, the ladders and the catwalk */
      function levels(g) {
        g.fillStyle = '#12101a'; g.fillRect(0, DECK, W, CROWD - DECK);
        g.fillStyle = 'rgba(255,181,71,.4)'; g.fillRect(0, DECK, W, 2);
        LADDERS.forEach(function (l) {
          var y0 = PLATS[l.hi].y, y1 = DECK;
          g.strokeStyle = '#59647a'; g.lineWidth = 2; g.beginPath(); g.moveTo(l.x - 7, y0); g.lineTo(l.x - 7, y1); g.moveTo(l.x + 7, y0); g.lineTo(l.x + 7, y1);
          for (var ry = y0 + 8; ry < y1; ry += 12) { g.moveTo(l.x - 7, ry); g.lineTo(l.x + 7, ry); }
          g.stroke();
        });
        PLATS.forEach(function (q, i) {
          if (i === 0) return;
          if (i === 4) {
            /* the catwalk: a truss deck with a railing */
            g.fillStyle = '#1b2130'; g.fillRect(q.x0, q.y, q.x1 - q.x0, 8);
            g.strokeStyle = '#3a4456'; g.lineWidth = 1.2; g.beginPath();
            for (var tx = q.x0; tx < q.x1; tx += 12) { g.moveTo(tx, q.y + 8); g.lineTo(tx + 6, q.y + 2); g.lineTo(tx + 12, q.y + 8); }
            g.moveTo(q.x0, q.y - 22); g.lineTo(q.x1, q.y - 22); for (var rx = q.x0; rx <= q.x1; rx += 27) { g.moveTo(rx, q.y); g.lineTo(rx, q.y - 22); }
            g.stroke();
            g.fillStyle = 'rgba(92,242,196,.45)'; g.fillRect(q.x0, q.y, q.x1 - q.x0, 2);
            return;
          }
          g.fillStyle = '#1a1724'; g.fillRect(q.x0, q.y, q.x1 - q.x0, DECK - q.y);
          g.fillStyle = 'rgba(255,255,255,.04)'; for (var px = q.x0 + 8; px < q.x1; px += 10) g.fillRect(px, q.y + 6, 1, DECK - q.y - 6);
          g.fillStyle = 'rgba(255,181,71,.45)'; g.fillRect(q.x0, q.y, q.x1 - q.x0, 2);
        });
      }
      function light(g) {
        var bx = W / 2, by = H + 40;
        g.save();
        g.globalCompositeOperation = 'lighter';
        var k = fog > 0 ? 2.4 : 1;
        var beam = g.createLinearGradient(bx, by, spot.x, spot.y);
        beam.addColorStop(0, 'rgba(255,245,220,' + (.02 * k).toFixed(3) + ')'); beam.addColorStop(1, 'rgba(255,245,220,' + (.1 * k).toFixed(3) + ')');
        g.fillStyle = beam; g.beginPath(); g.moveTo(bx - 6, by); g.lineTo(bx + 6, by); g.lineTo(spot.x + spot.r, spot.y); g.lineTo(spot.x - spot.r, spot.y); g.closePath(); g.fill();
        var gr = g.createRadialGradient(spot.x, spot.y, 2, spot.x, spot.y, spot.r * 1.1);
        var gel = streak > 8 ? '255,180,230' : streak > 4 ? '200,240,255' : '255,245,220';
        gr.addColorStop(0, 'rgba(' + gel + ',.55)'); gr.addColorStop(.8, 'rgba(' + gel + ',.32)'); gr.addColorStop(1, 'rgba(' + gel + ',0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(spot.x, spot.y, spot.r * 1.1, spot.r, 0, 0, 7); g.fill();
        g.restore();
        /* the pool's hard edge, so its size can be judged */
        g.strokeStyle = 'rgba(255,245,220,.25)'; g.lineWidth = 1; g.beginPath(); g.ellipse(spot.x, spot.y, spot.r, spot.r * .92, 0, 0, 7); g.stroke();
      }
      function performer(g) {
        if (p.hidden) {
          /* a hand waving from behind the band member, to be found */
          var b = p.hideAt;
          if (b && b.h) { g.strokeStyle = who.skin; g.lineWidth = 3; g.lineCap = 'round'; var wv = Math.sin(time * 9) * 4, by = PLATS[b.plat].y; g.beginPath(); g.moveTo(b.x + 10, by - b.h + 4); g.lineTo(b.x + 15 + wv, by - b.h - 8); g.stroke(); }
          return;
        }
        var c = center(), lit = Math.hypot(c.x - spot.x, c.y - spot.y) < spot.r + 6;
        var s = who.size, facing = p.act === 'moonwalk' ? -p.dir : p.dir;
        g.save(); g.translate(p.x, p.y);
        g.globalAlpha = lit ? 1 : fog > 0 ? .18 : .5;
        g.scale(s * (facing < 0 ? -1 : 1), s);
        g.lineCap = 'round'; g.lineJoin = 'round';
        var a = p.act, t = time, air = p.air;
        if (a === 'surf') { g.rotate(-Math.PI / 2); g.translate(0, 10); }
        if (a === 'flip' || a === 'cartwheel') { g.translate(0, -26); g.rotate(p.rot * (facing < 0 ? -1 : 1)); g.translate(0, 26); }
        if (a === 'crawl' || a === 'worm') { lowBody(g, a, t); g.restore(); g.globalAlpha = 1; return; }
        if (a === 'kneeslide') { kneel(g); g.restore(); g.globalAlpha = 1; return; }
        var walking = a === 'walk' || a === 'moonwalk' || a === 'hide' || (a === 'climb' && p.phase === 'to');
        var sw = walking ? Math.sin(t * (a === 'moonwalk' ? 7 : 11)) : 0;
        /* legs */
        g.strokeStyle = '#1c1f2b'; g.lineWidth = 5; g.beginPath();
        if (air || a === 'cartwheel') { g.moveTo(-3, -18); g.lineTo(-8, -9); g.lineTo(-3, -2); g.moveTo(3, -18); g.lineTo(9, -10); g.lineTo(5, -3); }
        else if (a === 'moonwalk') { g.moveTo(-3, -18); g.lineTo(-3 - sw * 7, 0); g.moveTo(3, -18); g.lineTo(3 + Math.max(0, sw) * 5, -Math.max(0, -sw) * 4); }
        else if (a === 'pose') { g.moveTo(-3, -18); g.lineTo(-9, 0); g.moveTo(3, -18); g.lineTo(9, -8); g.lineTo(6, 0); }
        else { g.moveTo(-3, -18); g.lineTo(-3 + sw * 6, 0); g.moveTo(3, -18); g.lineTo(3 - sw * 6, 0); }
        g.stroke();
        /* body */
        g.fillStyle = who.col; g.beginPath(); g.moveTo(-8, -18); g.lineTo(-9, -38); g.quadraticCurveTo(0, -44, 9, -38); g.lineTo(8, -18); g.closePath(); g.fill();
        if (who.key === 'pastor') { g.fillStyle = '#0d1018'; g.beginPath(); g.moveTo(-9, -38); g.lineTo(-3, -38); g.lineTo(-6, -18); g.lineTo(-8, -18); g.closePath(); g.moveTo(9, -38); g.lineTo(3, -38); g.lineTo(6, -18); g.lineTo(8, -18); g.closePath(); g.fill(); }
        /* arms */
        g.strokeStyle = who.skin; g.lineWidth = 3.5; g.beginPath();
        if (air || a === 'cartwheel' || a === 'pose') { g.moveTo(-7, -38); g.lineTo(-15, -56); g.moveTo(7, -38); g.lineTo(a === 'pose' ? 18 : 15, a === 'pose' ? -50 : -56); }
        else if (a === 'climb' && p.phase !== 'to') { var cl = Math.sin(t * 8) * 6; g.moveTo(-7, -38); g.lineTo(-9, -52 + cl); g.moveTo(7, -38); g.lineTo(9, -52 - cl); }
        else if (a === 'talk') { g.moveTo(-7, -37); g.lineTo(-12, -26); g.moveTo(7, -37); g.lineTo(16 + Math.sin(t * 5) * 3, -46 + Math.sin(t * 5) * 4); }
        else if (a === 'moonwalk') { g.moveTo(-7, -37); g.lineTo(-11, -24); g.moveTo(7, -37); g.lineTo(12, -48); }
        else { g.moveTo(-7, -37); g.lineTo(-11 - sw * 3, -22); g.moveTo(7, -37); g.lineTo(5, -46); }
        g.stroke();
        if (!air && who.key === 'pastor' && a !== 'pose') { g.fillStyle = '#5a3720'; g.fillRect(-17, -30, 9, 11); }
        else if (!air && a !== 'pose' && a !== 'climb') { g.fillStyle = '#c9d1dc'; g.fillRect(3, -50, 3, 7); }
        if (a === 'moonwalk') { g.fillStyle = '#EDF2F8'; g.beginPath(); g.arc(12, -48, 2.5, 0, 7); g.fill(); }   /* one white glove */
        head(g);
        g.restore(); g.globalAlpha = 1;
      }
      function head(g) {
        g.fillStyle = who.skin; g.beginPath(); g.arc(0, -50, 7, 0, 7); g.fill();
        g.fillStyle = who.hair; g.beginPath(); g.arc(0, -53, 7, Math.PI, 0); g.fill();
        if (who.key === 'youth') { g.fillRect(-7, -56, 14, 3); g.fillRect(-1, -57, 11, 3); }
        if (who.key === 'kid') { g.fillStyle = '#FF4FD8'; g.beginPath(); g.arc(-6, -55, 3, 0, 7); g.arc(6, -55, 3, 0, 7); g.fill(); }  /* pigtails */
        g.fillStyle = '#10131a'; g.fillRect(1, -51, 2, 2); g.fillRect(4, -51, 2, 2);
      }
      /* the army crawl and the worm: along the deck */
      function lowBody(g, a, t) {
        var u = a === 'worm' ? Math.sin(t * 9) * 4 : 0;
        g.strokeStyle = '#1c1f2b'; g.lineWidth = 5; g.beginPath(); g.moveTo(-26, -4); g.lineTo(-12, -5 + u * .5); g.stroke();
        g.fillStyle = who.col; g.beginPath(); g.ellipse(-2, -7 - u, 12, 5, 0, 0, 7); g.fill();
        g.strokeStyle = who.skin; g.lineWidth = 3.5; g.beginPath();
        if (a === 'crawl') { var r = Math.sin(t * 8) * 5; g.moveTo(6, -8); g.lineTo(14 + r, -2); g.moveTo(4, -8); g.lineTo(12 - r, -1); }
        g.stroke();
        g.translate(14, 42 - u); head(g);
      }
      /* the knee slide: kneeling, leaning back, arms out */
      function kneel(g) {
        g.strokeStyle = '#1c1f2b'; g.lineWidth = 5; g.beginPath(); g.moveTo(-2, -14); g.lineTo(-12, -2); g.lineTo(6, -2); g.stroke();
        g.save(); g.translate(0, -14); g.rotate(-.5);
        g.fillStyle = who.col; g.fillRect(-8, -24, 16, 24);
        g.strokeStyle = who.skin; g.lineWidth = 3.5; g.beginPath(); g.moveTo(-7, -20); g.lineTo(-20, -30); g.moveTo(7, -20); g.lineTo(20, -30); g.stroke();
        g.translate(0, 24); head(g); g.restore();
      }
      function musician(g, b) {
        var y = PLATS[b.plat].y, sw = Math.sin(time * 3 + b.x) * 2;
        if (b.kind === 'drums') {
          g.fillStyle = '#211d2e'; g.fillRect(b.x - 34, y - 26, 68, 26);
          g.fillStyle = '#2b2540'; g.beginPath(); g.arc(b.x, y - 12, 13, 0, 7); g.fill();
          g.strokeStyle = 'rgba(255,181,71,.5)'; g.lineWidth = 2; g.beginPath(); g.ellipse(b.x - 26, y - 30, 10, 2.5, 0, 0, 7); g.ellipse(b.x + 26, y - 34, 10, 2.5, 0, 0, 7); g.stroke();
        }
        g.fillStyle = b.col;
        g.fillRect(b.x - 9, y - b.h + 16 + sw - (b.kind === 'drums' ? 22 : 0), 18, b.h - 16);
        g.beginPath(); g.arc(b.x, y - b.h + 8 + sw - (b.kind === 'drums' ? 22 : 0), 8, 0, 7); g.fill();
        if (b.kind !== 'drums') { g.strokeStyle = '#4b4363'; g.lineWidth = 4; g.beginPath(); g.moveTo(b.x - 18, y - 28 + sw); g.lineTo(b.x + 16, y - 44 + sw); g.stroke(); }
        else { g.strokeStyle = '#4b4363'; g.lineWidth = 2; var hit = Math.abs(Math.sin(time * 6)) * 8; g.beginPath(); g.moveTo(b.x - 8, y - b.h + 4); g.lineTo(b.x - 22, y - 34 - hit); g.moveTo(b.x + 8, y - b.h + 4); g.lineTo(b.x + 22, y - 38 - (8 - hit)); g.stroke(); }
      }
      function sheepDraw(g) {
        var x = sheep.x, y = DECK, step = Math.sin(sheep.t * 8) * 2, lit = Math.hypot(x - spot.x, y - 14 - spot.y) < spot.r + 4;
        g.save(); g.globalAlpha = lit ? 1 : fog > 0 ? .25 : .55;
        g.fillStyle = '#1c1f2b'; g.fillRect(x - 9, y - 9 + step * .5, 3, 9); g.fillRect(x + 6, y - 9 - step * .5, 3, 9);
        g.fillStyle = '#EDF2F8';
        [[-8, -16], [0, -19], [8, -16], [-4, -12], [5, -12]].forEach(function (c) { g.beginPath(); g.arc(x + c[0], y + c[1], 7, 0, 7); g.fill(); });
        g.fillStyle = '#4a4250'; g.beginPath(); g.ellipse(x + sheep.dir * 15, y - 18, 5, 6, sheep.dir * .3, 0, 7); g.fill();
        g.beginPath(); g.ellipse(x + sheep.dir * 11, y - 22, 4, 1.8, sheep.dir * -.6, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.fillRect(x + sheep.dir * 16 - 1, y - 20, 2, 2);
        g.restore();
      }
      function mothDraw(g) {
        var f = Math.abs(Math.sin(moth.t * 30));
        g.fillStyle = '#c9c2b0';
        g.beginPath(); g.ellipse(moth.x - 3, moth.y, 4, 2 + f * 2.5, -.5, 0, 7); g.ellipse(moth.x + 3, moth.y, 4, 2 + f * 2.5, .5, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(moth.x * .8 + 40, 160, 18, 6 + f * 10, -.4, 0, 7); g.ellipse(moth.x * .8 + 70, 160, 18, 6 + f * 10, .4, 0, 7); g.fill();
      }
      function fogDraw(g) {
        var a = Math.min(1, fog / 1.5, (9 - fog) / 1.5) * .5;
        for (var k = 0; k < 5; k++) {
          var fy = DECK - 30 - k * 36, fx = ((time * (14 + k * 6)) % (W + 200)) - 100;
          var fg = g.createRadialGradient(fx, fy, 10, fx, fy, 160);
          fg.addColorStop(0, 'rgba(180,190,210,' + (a * .5).toFixed(3) + ')'); fg.addColorStop(1, 'rgba(180,190,210,0)');
          g.fillStyle = fg; g.fillRect(0, fy - 60, W, 120);
        }
      }
      function crowdDraw(g) {
        g.fillStyle = '#07070c'; g.fillRect(0, CROWD, W, H - CROWD);
        var hands = act === 1 || act === 3;
        crowd.forEach(function (c) {
          var up = Math.max(0, Math.sin(time * 4 + c.ph)) * 6;
          g.fillStyle = '#0d0c14'; g.fillRect(c.x, CROWD - c.h + 20, 8, c.h + 10);
          g.beginPath(); g.arc(c.x + 4, CROWD - c.h + 16, 5, 0, 7); g.fill();
          if (hands && c.ph > 3.5) g.fillRect(c.x + 1, CROWD - c.h - 4 - up, 2, 14);
          if (hands && c.phone && who) {
            var sx = c.x + 3 + Math.sin(time * 1.6 + c.ph) * 4;
            g.fillStyle = 'rgba(255,250,235,.85)'; g.fillRect(sx, CROWD - c.h - 10, 2, 3);
            g.fillStyle = '#0d0c14';
          }
        });
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillStyle = 'rgba(138,150,166,.9)'; g.fillText(words('followspot_patience').toUpperCase(), 12, 12);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(12, 26, 110, 6);
        g.fillStyle = patience > .5 ? '#5CF2C4' : patience > .25 ? '#FFB547' : '#FF5A6E'; g.fillRect(12, 26, 110 * patience, 6);
        g.textAlign = 'center'; g.fillStyle = 'rgba(' + cur().wall.join(',') + ',.85)';
        g.fillText(words('followspot_act_' + cur().key).toUpperCase(), W / 2, 12);
        var m = streak > 6 ? 3 : streak > 3 ? 2 : 1;
        if (m > 1) { g.textAlign = 'right'; g.fillStyle = '#FFB547'; g.font = '700 14px Sora, sans-serif'; g.fillText('×' + m, W - 12, 12); }
      }

      return {
        update: update, draw: draw,
        press: function () {},
        stop: function () {}
      };
    }
  };
})();
