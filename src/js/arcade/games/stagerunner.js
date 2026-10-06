/* =====================================================================
   Stage Runner — the stage manager's errands, at a sprint
   =====================================================================
   Chase, 2026-10-04: "this is a Subway Surfers style game. Try to match
   the feel of it. We should change the name to Stage Runner … a game
   about a Stage Manager running everywhere to do things for the Talent.
   Get creative with this and take your time!" And 2026-10-05: "make the
   graphics more appealing! And throw in a few flairs that make it seem
   like a someone doing something for people. Space it out, give more
   progression. Animate the jumps. Make obstacles clearer."

   THREE LANES, RUNNING AWAY INTO THE VENUE. Swipe (or ← → ↑ ↓): change
   lane, jump, slide. Jump the road cases and the yellow cable ramps, slide
   under the low truss, get out of the way of the stacks and the tug coming
   the other way. Riser trains have a ramp: run up and along the top.

   THE ERRANDS, for people. Someone needs something — the TALENT wants a
   coffee, the DRUMMER has broken a stick, the PASTOR can't find the slide
   clicker, the KIDS' CHOIR wants juice boxes. It shows up ahead, glowing;
   grab it and you carry it over your head, and run it through the GREEN
   ROOM door, where they are waiting and say thank you. Every delivery
   raises the multiplier; too slow and they get "creative" (and the
   multiplier goes back to one).

   THE CREW along the walls wave you past, and now and then one holds a
   hand out: run the lane beside them for a HIGH FIVE.

   THE PM. Stumble — clip a cable ramp, a wet floor, the side of a case —
   and the production manager is right behind you, clipboard up, and you
   lose speed. They never catch you (round 4: "Caught by the PM isn't
   needed"). Hit something head on and it's over, unless you are riding a
   road case (it takes the hit).

   ONE COLOR CODE (round 5, Chase: "Make it really clear what I can climb
   and run on and what I should avoid"): GREEN you can stand and run on (a
   case's top, a riser's top, a ramp); YELLOW you jump over (a cable ramp,
   a wet floor); BLUE you slide under (the truss); RED you go around (a
   stack, the tug). The floor arrows use the same colors, and the first two
   of each kind carry a tag — RUN ON IT, JUMP OVER, SLIDE UNDER, GO AROUND.
   Nothing else in the venue uses those four colors for decoration.

   HIGH FIVES DO SOMETHING (round 5): stars burst from the hand, the crew
   member jumps and cheers, and you get CREW HYPE for a few seconds — a
   little faster, picks fly to you and count double, the runner glows.
   High fives in a row stack the hype longer; walking past an offered hand
   breaks the streak.

   READING THE WAY (round 4: "the obstacles are still too hard to
   understand what is needed to be done. I lost because I thought I could
   go up"): a painted floor arrow before each thing says what to do —
   yellow ↑ jump (a case, a cable ramp, a wet floor), blue ↓ slide (the low
   truss), red ⇆ dodge (a stack, the tug) — and what cannot be jumped has
   a red edge. A single case can be landed on and run along, as a train
   can in Subway Surfers.

   PICKS (guitar picks) everywhere; four powers: the HEADSET pulls picks
   to you, CASE SURF rides a road case, SPRING SHOES jump higher, ALL
   ACCESS doubles the picks.

   THE PACE (round 3): it starts slower (8.5, was 9.5) and tops out lower
   (20, was 23), and the run teaches itself — picks and a cable ramp first,
   then a lone case, the low truss from 140 m, riser trains from 220 m,
   two lanes blocked from 300 m, the tug from 450 m — with more floor
   between stretches.

   The venue changes as you go: backstage, the stage, the loading dock, the
   arena, and round again.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 640;
  var HOR = 196, F = 380, CAM_Y = 2.9, CAM_Z = -3.25;
  var LANES = [-1, 0, 1];
  var GRAV = 30, JUMP = 9.6, SUPER = 13.2;
  var WHO = {
    talent: { items: ['coffee', 'setlist', 'snack', 'water'], col: '#FF4FD8', tag: 'TALENT' },
    drums:  { items: ['sticks', 'batteries', 'tape'], col: '#FFB547', tag: 'DRUMS' },
    pastor: { items: ['clicker', 'water', 'coffee'], col: '#2FD8FF', tag: 'PASTOR' },
    kids:   { items: ['juice', 'snack'], col: '#5CF2C4', tag: 'KIDS' }
  };
  var ZONES = ['backstage', 'stage', 'dock', 'arena'];
  var POWERS = ['headset', 'case', 'shoes', 'pass'];
  var CASECOL = ['#FFB547', '#FF5A6E', '#2FD8FF', '#5CF2C4', '#9B7BFF', '#FF4FD8'];
  var SHIRTS = ['#2b3142', '#3b2b42', '#2b4238', '#423a2b'];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pickOf(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  A.games.stagerunner = {
    size: { w: W, h: H },
    controls: 'dpad',
    swipe: true,
    speaker: 'SM',
    quipAt: .19,
    create: function (ctx) {
      var words = ctx.words;
      var me = { lane: 1, x: 0, y: 0, vy: 0, ground: 0, slide: 0, run: 0, lean: 0, land: 0, onCase: 0, shoes: 0, magnet: 0, pass: 0, hype: 0 };
      var fiveStreak = 0, bursts = [], tagged = {};
      var things = [];                 /* obstacles, picks, items, doors, powers, crew: { kind, lane, z, len, ... } */
      var dist = 0, speed = 8.5, spawnZ = 16, picks = 0, mult = 1, pts = 0, made = 0;
      var mission = null, nextMission = 90, pm = 0, stumbles = 0, dead = false, time = 0;
      var zone = 0, zoneAt = 0, banner = null, dust = [], pops = [], camX = 0;
      var started = false;

      /* ------------------------------------------------------- the world */
      function laneX(l) { return LANES[l] * 1.05; }
      function proj(x, y, z) {
        var dz = z - CAM_Z;
        if (dz < .25) return null;
        var k = F / dz;
        return { x: W / 2 + (x - camX * .55) * k, y: HOR + (CAM_Y - y) * k, k: k };
      }
      /* what each thing asks of you, by the color code */
      var WHAT = { case: 'climb', ramp: 'climb', cable: 'jump', wet: 'jump', truss: 'slide', stack: 'dodge', cart: 'dodge' };
      function add(o) {
        var w = WHAT[o.kind];
        if (w && (tagged[w] || 0) < 2 && !(o.kind === 'cable' && tagged.jumpAt === o.z)) { o.tag = w; tagged[w] = (tagged[w] || 0) + 1; if (o.kind === 'cable' || o.kind === 'wet') tagged.jumpAt = o.z; }
        things.push(o); return o;
      }

      /* One stretch of the run at a time. The run teaches itself: each kind
         of obstacle arrives on its own before it is mixed with others, and
         every pattern leaves a way through. */
      function spawn() {
        var lvl = Math.min(1, dist / 2000), z = spawnZ, len, d = dist + spawnZ;   /* d: how far into the run this stretch is */
        var free = Math.floor(Math.random() * 3);
        var roll = Math.random();
        made++;
        if (d < 60) {
          /* the first stretch: picks, and a cable ramp to jump */
          if (made % 2) { add({ kind: 'cable', lane: free, z: z, len: .5 }); picksArc(free, z - 1); }
          else picksLine(Math.floor(Math.random() * 3), z, 6);
          len = 9;
        } else if (roll < .2 && d > 300) {                    /* cases in two lanes, picks in the third */
          LANES.forEach(function (_, l) { if (l !== free) add({ kind: Math.random() < .3 + lvl * .3 ? 'stack' : 'case', lane: l, z: z, len: 1.2, col: pickOf(CASECOL) }); });
          picksLine(free, z - 3, 6); len = 9;
        } else if (roll < .34 && d > 140) {                   /* the low truss: slide */
          var n = d > 400 && Math.random() < .5 ? 3 : 2;
          for (var l = 0; l < 3; l++) if (n === 3 || l !== free) add({ kind: 'truss', lane: l, z: z, len: .5 });
          if (n !== 3) picksLine(free, z - 2, 4);
          len = 8;
        } else if (roll < .48 && d > 220) {                   /* a riser train with a ramp: run along the top */
          var rl = Math.floor(Math.random() * 3);
          add({ kind: 'ramp', lane: rl, z: z, len: 2.2 });
          add({ kind: 'riser', lane: rl, z: z + 2.2, len: 9 });
          picksLine(rl, z + 3, 7, .75);
          if (d > 350 && Math.random() < .5) add({ kind: 'stack', lane: (rl + 1 + Math.floor(Math.random() * 2)) % 3, z: z + 4, len: 1.2, col: pickOf(CASECOL) });
          len = 14;
        } else if (roll < .58 && d > 450) {                   /* the tug, coming the other way */
          add({ kind: 'cart', lane: Math.floor(Math.random() * 3), z: z + 10, len: 1.6, moving: 4 + lvl * 4 });
          len = 10;
        } else if (roll < .72) {                              /* the floor: cable ramps and wet floors, jump them */
          var lanes = d > 200 ? [0, 1, 2] : [free];
          lanes.forEach(function (k) { if (lanes.length === 1 || Math.random() < .65) add({ kind: Math.random() < .55 ? 'cable' : 'wet', lane: k, z: z + k * .3, len: .5 }); });
          picksArc(free, z - 1);
          len = 8;
        } else if (roll < .88) {                              /* a lone case, picks over it in an arc */
          var cl = Math.floor(Math.random() * 3);
          add({ kind: 'case', lane: cl, z: z, len: 1.2, col: pickOf(CASECOL) });
          picksArc(cl, z - 1.5);
          len = 7;
        } else {                                              /* breathing room, and maybe a power */
          if (d > 80 && Math.random() < .55) add({ kind: 'power', lane: Math.floor(Math.random() * 3), z: z + 2, len: .6, power: pickOf(POWERS) });
          picksLine(Math.floor(Math.random() * 3), z, 6);
          len = 8;
        }
        /* the crew along the walls; now and then one wants a high five */
        if (Math.random() < .55) {
          var side = Math.random() < .5 ? -1 : 1, five = d > 40 && Math.random() < .6;
          add({ kind: 'crew', side: side, lane: side < 0 ? 0 : 2, z: z + rnd(0, len), len: .4, five: five, shirt: pickOf(SHIRTS), cup: Math.random() < .3, ph: rnd(0, 6),
                who: pickOf(['crew', 'crew', 'drums', 'pm', 'pastor', 'kid', 'singer']) });
        }
        /* the errand: the thing someone needs, or the door to bring it to */
        if (!mission && d > nextMission) {
          var who = pickOf(Object.keys(WHO));
          mission = { who: who, item: pickOf(WHO[who].items), have: false, patience: 40, door: false };
          add({ kind: 'item', lane: Math.floor(Math.random() * 3), z: z + len + 6, len: .6, item: mission.item, y: .55 });
          ctx.say(words('stagerunner_who_' + who) + ' ' + words('stagerunner_item_' + mission.item), { tag: WHO[who].tag });
          ctx.sfx('zap');
        } else if (mission && mission.have && !mission.door) {
          mission.door = true;
          add({ kind: 'door', lane: 1, z: z + len + 4, len: .8, who: mission.who, item: mission.item });
        }
        spawnZ += len + 8 - lvl * 4;
      }
      function picksLine(lane, z, n, y) { for (var i = 0; i < n; i++) add({ kind: 'pick', lane: lane, z: z + i * 1.4, len: .4, y: y || .35 }); }
      function picksArc(lane, z) { for (var i = 0; i < 7; i++) add({ kind: 'pick', lane: lane, z: z + i * .9, len: .4, y: .35 + Math.sin(i / 6 * Math.PI) * 1.25 }); }

      /* ------------------------------------------------------- moving */
      function press(d) {
        if (dead) return;
        if (!started) started = true;
        if (d === 'left' || d === 'right') {
          var to = clamp(me.lane + (d === 'left' ? -1 : 1), 0, 2);
          if (to === me.lane) { stumble('wall'); return; }
          /* the side of something in the way: bump back */
          var side = things.some(function (o) { return (o.kind === 'stack' || o.kind === 'cart' || o.kind === 'riser' || (o.kind === 'case' && me.y < .5)) && o.lane === to && o.z < .5 && o.z + o.len > -.4 && me.y < topOf(o); });
          if (side) { stumble('side'); me.lean = d === 'left' ? -1 : 1; return; }
          me.lane = to; me.lean = d === 'left' ? -1 : 1; ctx.sfx('move');
        }
        if (d === 'up' && me.y <= me.ground + .02) { me.vy = me.shoes > 0 ? SUPER : JUMP; me.slide = 0; ctx.sfx('jump'); }
        if (d === 'down') {
          if (me.y > me.ground + .05) me.vy = -18;            /* down in the air: drop now */
          me.slide = .62; ctx.sfx('slide');
        }
      }
      function topOf(o) { return o.kind === 'stack' ? 2 : o.kind === 'case' ? .55 : o.kind === 'riser' ? .72 : o.kind === 'cart' ? 1.3 : 0; }
      function groundAt(lane) {
        var gnd = 0;
        things.forEach(function (o) {
          if (o.lane !== lane || o.z > .3 || o.z + o.len < -.3) return;
          if (o.kind === 'ramp') gnd = Math.max(gnd, clamp((-o.z) / o.len, 0, 1) * .72);
          if (o.kind === 'riser') gnd = Math.max(gnd, .72);
          /* the top of a single case is somewhere to run, once you are on it */
          if (o.kind === 'case' && me.y >= .45) gnd = Math.max(gnd, .58);
        });
        return gnd;
      }

      function stumble() {
        if (dead) return;
        ctx.shake(3); ctx.sfx('whiff');
        speed = Math.max(7.5, speed * .85);
        pm = 6; stumbles++;
        ctx.quip('jokes_stagerunner_stumble', { mood: 'bad', chance: .5 });
      }
      function crash() {
        if (me.onCase > 0) {
          me.onCase = 0; ctx.shake(6); ctx.sfx('break');
          ctx.say(words('stagerunner_p_case_gone'), { mood: 'bad' });
          things = things.filter(function (o) { return !(o.lane === me.lane && o.z < 1.5 && o.z > -1 && o.kind !== 'pick' && o.kind !== 'crew'); });
          return;
        }
        dead = true; ctx.shake(9); ctx.sfx('crash');
        ctx.quip('jokes_stagerunner_crash', { mood: 'bad', force: true });
        setTimeout(function () { ctx.over(); }, 1200);
      }
      function pop(text, col) { pops.push({ text: text, col: col || '#5CF2C4', life: 1.2 }); }

      /* ------------------------------------------------------- update */
      function update(dt) {
        time += dt;
        me.run += dt * (5 + speed * .5);
        if (!started) { while (spawnZ < 60) spawn(); return; }
        if (dead) { me.y = Math.max(me.ground, me.y - dt * 2); return; }

        speed = Math.min(20, speed + dt * .06 * (speed < 12 ? 1.4 : 1));
        var move = speed * dt * (me.hype > 0 ? 1.15 : 1);
        dist += move;
        things.forEach(function (o) { o.z -= move + (o.moving ? o.moving * dt : 0); });
        spawnZ -= move;
        while (spawnZ < 70) spawn();

        /* the lane, eased; the jump; the slide */
        me.x += (laneX(me.lane) - me.x) * Math.min(1, dt * 16);
        camX += (me.x - camX) * Math.min(1, dt * 4);
        me.lean *= Math.pow(.02, dt);
        me.ground = groundAt(me.lane);
        var wasAir = me.y > me.ground + .05;
        me.vy -= GRAV * dt; me.y += me.vy * dt;
        if (me.y <= me.ground) { if (me.vy < -6) { ctx.sfx('thud', { vol: .3 }); me.land = .16; } me.y = me.ground; me.vy = 0; }
        if (wasAir && me.y <= me.ground) for (var q = 0; q < 6; q++) dust.push({ x: me.x + rnd(-.3, .3), z: rnd(-.2, .2), y: me.y, vy: rnd(.4, 1), life: .5 });
        me.slide = Math.max(0, me.slide - dt); me.land = Math.max(0, me.land - dt);
        ['onCase', 'shoes', 'magnet', 'pass', 'hype'].forEach(function (k) { me[k] = Math.max(0, me[k] - dt); });
        bursts.forEach(function (b) { b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 300 * dt; b.life -= dt; }); bursts = bursts.filter(function (b) { return b.life > 0; });
        if (pm > 0) { pm -= dt; if (pm <= 0) stumbles = 0; }

        /* what you run into */
        var lane = me.lane, sliding = me.slide > 0, tall = sliding ? .42 : .95;
        things.forEach(function (o) {
          if (o.hit) return;
          var near = o.z < .45 && o.z + o.len > -.35;
          var magnet = (me.magnet > 0 || me.hype > 0) && o.kind === 'pick' && o.z < 5 && o.z > -.5;
          if (magnet) { o.lane = lane; o.y = me.y + .4; }
          if (o.kind === 'crew') {
            /* a high five, from the lane beside them */
            if (o.five && near && lane === o.lane && me.y < .9) {
              o.hit = true; o.slapped = time; fiveStreak++;
              var hf = 25 * mult; pts += hf;
              /* the hype: longer for a streak */
              me.hype = Math.min(7, 3 + (fiveStreak - 1) * .8);
              pop(words('stagerunner_highfive') + (fiveStreak > 1 ? ' ×' + fiveStreak : '') + ' +' + hf, '#FFB547');
              ctx.sfx('combo'); ctx.sfx('cheer'); ctx.shake(2);
              var hp = proj(o.side * 1.35, 1.25, Math.max(.3, o.z));
              if (hp) for (var bi = 0; bi < 18; bi++) { var ang = bi / 18 * Math.PI * 2; bursts.push({ x: hp.x, y: hp.y, vx: Math.cos(ang) * rnd(80, 200), vy: Math.sin(ang) * rnd(80, 200) - 60, life: .7, col: ['#FFD34A', '#FFB547', '#fff'][bi % 3] }); }
            }
            /* an offered hand left hanging breaks the streak */
            if (o.five && !o.slapped && !o.passed && o.z < -.5) { o.passed = true; fiveStreak = 0; }
            return;
          }
          if (!near || (o.lane !== lane && !magnet)) return;
          switch (o.kind) {
            case 'pick':
              if (Math.abs((o.y || .35) - (me.y + .45)) < .7 || magnet) { o.hit = true; picks += me.pass > 0 ? 2 : 1; pts += 5 * mult * (me.pass > 0 ? 2 : 1) * (me.hype > 0 ? 2 : 1); ctx.sfx('collect'); }
              break;
            case 'item':
              if (Math.abs(o.y - (me.y + .4)) < .8) {
                o.hit = true; if (mission) mission.have = true; ctx.sfx('powerup');
                ctx.say(words('stagerunner_deliver'), { tag: 'SM', mood: 'good' });
              }
              break;
            case 'door':
              o.hit = true;
              if (mission && mission.have) {
                var bonus = 200 * mult; pts += bonus; mult = Math.min(4, mult + 1);   /* round 4: was 500, ×8 at most */
                o.happy = time;
                ctx.sfx('cheer'); ctx.shake(3);
                banner = { text: words('stagerunner_delivered') + '  +' + bonus + '  ×' + mult, t: 2.2, good: true };
                pop(pickOf([].concat(words('stagerunner_thanks'))), WHO[mission.who].col);
                ctx.quip('jokes_stagerunner_deliver', { mood: 'good', chance: .6 });
                mission = null; nextMission = dist + 220 + Math.random() * 160;
              }
              break;
            case 'power':
              o.hit = true; ctx.sfx('powerup');
              if (o.power === 'headset') me.magnet = 10;
              if (o.power === 'case') me.onCase = 14;
              if (o.power === 'shoes') me.shoes = 10;
              if (o.power === 'pass') me.pass = 15;
              banner = { text: words('stagerunner_p_' + o.power).toUpperCase(), sub: words('stagerunner_d_' + o.power), t: 2.4, good: true };
              ctx.quip('jokes_stagerunner_power', { mood: 'good', chance: .5 });
              break;
            case 'cable': case 'wet':
              if (me.y < .22 && me.onCase <= 0) { o.hit = true; stumble(); }
              break;
            case 'case':
              if (me.y < .45) { o.hit = true; crash(); }
              break;
            case 'stack': case 'cart':
              if (me.y < topOf(o) - .05) { o.hit = true; crash(); }
              break;
            case 'truss':
              if (me.y + tall > .78) { o.hit = true; crash(); }
              break;
            case 'riser':
              if (me.y < .62 && o.z > -.2 && o.z < .4) { o.hit = true; crash(); }
              break;
          }
        });
        things = things.filter(function (o) { return o.z + o.len > -3 && !(o.hit && (o.kind === 'pick' || o.kind === 'item' || o.kind === 'power')); });

        /* the errand's clock */
        if (mission) {
          mission.patience -= dt;
          if (mission.patience <= 0) {
            mission = null; mult = 1; nextMission = dist + 160;
            things = things.filter(function (o) { return o.kind !== 'item' && o.kind !== 'door'; });
            banner = { text: words('stagerunner_late'), t: 2, good: false };
            ctx.quip('jokes_stagerunner_late', { mood: 'bad', force: true });
          }
        }
        /* the venue changes as you go */
        if (dist - zoneAt > 420) {
          zoneAt = dist; zone = (zone + 1) % ZONES.length;
          banner = { text: words('stagerunner_zone_' + ZONES[zone]).toUpperCase(), t: 2, good: true };
        }
        if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
        if (!sliding && me.y <= me.ground + .02 && Math.random() < dt * 14) dust.push({ x: me.x + rnd(-.15, .15), z: -.1, y: me.ground, vy: rnd(.2, .5), life: .4 });
        dust.forEach(function (d) { d.z -= move; d.y += d.vy * dt; d.life -= dt; });
        dust = dust.filter(function (d) { return d.life > 0; });
        pops.forEach(function (p) { p.life -= dt; }); pops = pops.filter(function (p) { return p.life > 0; });

        /* a metre is half a point: the run's length alone outpaced every other game (round 4) */
        ctx.score(Math.floor(dist / 2) + pts);
      }

      /* ------------------------------------------------------ drawing */
      var ZC = {
        backstage: { ceil: ['#141824', '#2a2f3e'], floor: ['#3a3e49', '#343843'], lane: 'rgba(255,255,255,.035)', wall: '#2c3242', wall2: '#353c50', trim: '#FFB547', light: 'rgba(255,214,160,', fog: [42, 47, 62] },
        stage: { ceil: ['#07050d', '#1d1230'], floor: ['#16141e', '#1b1925'], lane: 'rgba(155,123,255,.06)', wall: null, trim: '#FF4FD8', light: 'rgba(155,123,255,', fog: [29, 18, 48] },
        dock: { ceil: ['#0b1634', '#2b4170'], floor: ['#3b3f47', '#363a41'], lane: 'rgba(255,255,255,.04)', wall: '#2a2f39', wall2: '#323844', trim: '#FFD34A', light: 'rgba(255,240,200,', fog: [43, 65, 112] },
        arena: { ceil: ['#090912', '#1e1838'], floor: ['#1e2a45', '#22304d'], lane: 'rgba(47,216,255,.06)', wall: null, trim: '#2FD8FF', light: 'rgba(47,216,255,', fog: [30, 24, 56] }
      };
      function fogA(z) { return 1 - clamp((z - 26) / 34, 0, 1) * .85; }
      function draw(g) {
        var Z = ZC[ZONES[zone]];
        var sky = g.createLinearGradient(0, 0, 0, HOR + 10);
        sky.addColorStop(0, Z.ceil[0]); sky.addColorStop(1, Z.ceil[1]);
        g.fillStyle = sky; g.fillRect(-20, -20, W + 40, H + 40);
        backdrop(g, Z);
        floor(g, Z);
        if (Z.wall) walls(g, Z);
        /* the far end glows: the way you are going */
        var glow = g.createRadialGradient(W / 2 - camX * 10, HOR, 4, W / 2 - camX * 10, HOR, 120);
        glow.addColorStop(0, Z.light + '.35)'); glow.addColorStop(1, Z.light + '0)');
        g.fillStyle = glow; g.fillRect(0, HOR - 120, W, 240);
        /* everything, far to near */
        var list = things.slice().sort(function (a, b) { return b.z - a.z; });
        list.forEach(function (o) { if (SIGN[o.kind] && !o.hit) floorSign(g, o); });
        var drewMe = false;
        list.forEach(function (o) {
          if (!drewMe && o.z < -.1) { runner(g); drewMe = true; }
          if (!o.hit || o.kind === 'door' || o.kind === 'crew') { g.globalAlpha = fogA(o.z); thing(g, o); g.globalAlpha = 1; }
        });
        if (!drewMe) runner(g);
        list.forEach(function (o) { if (o.tag && !o.hit) tagDraw(g, o); });
        bursts.forEach(function (b) { g.globalAlpha = Math.min(1, b.life * 2); g.fillStyle = b.col; g.beginPath(); g.arc(b.x, b.y, 2.5, 0, 7); g.fill(); });
        g.globalAlpha = 1;
        if (pm > 0 || (dead && stumbles)) chaser(g);
        dust.forEach(function (d) { var p = proj(d.x, d.y, d.z); if (p) { g.fillStyle = 'rgba(220,225,235,' + (d.life * .7) + ')'; g.beginPath(); g.arc(p.x, p.y, Math.max(1, p.k * .025), 0, 7); g.fill(); } });
        speedLines(g);
        hud(g);
        if (!started) {
          g.fillStyle = 'rgba(237,242,248,' + (.6 + .3 * Math.sin(time * 4)) + ')'; g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center';
          g.fillText(words(ctx.touch ? 'stagerunner_hint_touch' : 'stagerunner_hint'), W / 2, H - 40);
        }
      }
      function backdrop(g, Z) {
        var t = time, zn = ZONES[zone];
        if (zn === 'stage' || zn === 'arena') {
          /* an LED wall at the far end, then moving lights through the haze */
          if (zn === 'stage') {
            var lw = g.createLinearGradient(80, 0, 280, 0);
            lw.addColorStop(0, 'hsl(' + (t * 20 % 360) + ',80%,40%)'); lw.addColorStop(1, 'hsl(' + ((t * 20 + 120) % 360) + ',80%,40%)');
            g.fillStyle = lw; g.globalAlpha = .5; g.fillRect(70, HOR - 70, 220, 64); g.globalAlpha = 1;
            g.fillStyle = 'rgba(0,0,0,.35)'; for (var lx = 70; lx < 290; lx += 5) g.fillRect(lx, HOR - 70, 1, 64);
          }
          for (var i = 0; i < 5; i++) {
            var x = 40 + i * 70, a = Math.sin(t * .8 + i * 1.3) * .6;
            g.save(); g.translate(x, 24); g.rotate(a);
            var gr = g.createLinearGradient(0, 0, 0, 280);
            gr.addColorStop(0, Z.light + '.4)'); gr.addColorStop(1, Z.light + '0)');
            g.fillStyle = gr; g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.lineTo(44, 280); g.lineTo(-44, 280); g.closePath(); g.fill();
            g.restore();
            g.fillStyle = '#2a3142'; g.fillRect(x - 6, 18, 12, 8);
          }
          if (zn === 'arena') {
            /* the crowd on the horizon, hands up on the beat, phones lit */
            for (var c = 0; c < 40; c++) {
              var cx = c * 9.5, h = 12 + (c * 37 % 7) + Math.max(0, Math.sin(t * 6 + c)) * 6;
              g.fillStyle = '#0d0c18'; g.fillRect(cx, HOR - h, 7, h);
              if (c % 4 === 0) { g.fillStyle = 'rgba(255,250,230,.8)'; g.fillRect(cx + 3, HOR - h - 5, 2, 2); }
            }
          }
        } else if (zn === 'dock') {
          g.fillStyle = 'rgba(255,255,255,.7)';
          for (var s = 0; s < 30; s++) g.fillRect((s * 97) % W, (s * 53) % (HOR - 40), 1.2, 1.2);
          /* the trucks backed up to the dock, their doors open */
          g.fillStyle = '#d9dee6'; g.fillRect(6, HOR - 58, 110, 52); g.fillRect(244, HOR - 66, 110, 60);
          g.fillStyle = '#10131a'; g.fillRect(18, HOR - 50, 86, 44); g.fillRect(256, HOR - 58, 86, 52);
          g.fillStyle = '#FFD34A'; g.fillRect(6, HOR - 8, 110, 3); g.fillRect(244, HOR - 8, 110, 3);
          g.fillStyle = 'rgba(255,240,200,.9)'; g.fillRect(150, 30, 60, 4);
        } else {
          /* backstage: a corridor ceiling with strip lights, a lit sign far off */
          /* strip lights down the middle of the ceiling, receding */
          for (var cz = 54 - dist % 6; cz > 5; cz -= 6) {
            var l0 = proj(-.35, 3.6, cz), l1 = proj(.35, 3.6, cz + .6);
            if (!l0 || !l1) continue;
            g.fillStyle = Z.light + (.55 * fogA(cz)).toFixed(2) + ')'; g.fillRect(l0.x, l0.y, l1.x - l0.x, Math.max(1, l1.y - l0.y));
          }
          g.fillStyle = '#1f9a62'; g.fillRect(W / 2 - 22, HOR - 52, 44, 14);
          g.fillStyle = '#EDF2F8'; g.font = '700 8px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STAGE', W / 2, HOR - 45);
        }
      }
      function floor(g, Z) {
        var off = dist % 2;
        for (var z = 60; z > -3; z -= 1) {
          var zz = z - off, a = proj(-1.75, 0, zz + 1), b = proj(1.75, 0, zz + 1), c = proj(1.75, 0, zz), d = proj(-1.75, 0, zz);
          if (!a || !c) continue;
          g.fillStyle = (Math.floor(z) % 2 === 0) ? Z.floor[0] : Z.floor[1];
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
        }
        /* the middle lane a shade lighter, so the three read */
        var m0 = proj(-.52, 0, 60), m1 = proj(.52, 0, 60), m2 = proj(.52, 0, -2.5), m3 = proj(-.52, 0, -2.5);
        if (m0 && m2) { g.fillStyle = Z.lane; g.beginPath(); g.moveTo(m0.x, m0.y); g.lineTo(m1.x, m1.y); g.lineTo(m2.x, m2.y); g.lineTo(m3.x, m3.y); g.closePath(); g.fill(); }
        /* lane lines in gaff tape: strips that run past, so the speed shows */
        /* white tape: the four code colors are kept for what they mean */
        g.fillStyle = 'rgba(237,242,248,.75)';
        [-.52, .52].forEach(function (x) {
          for (var z = 60; z > -3; z -= 2) {
            var zz = z - (dist % 2), p1 = proj(x - .03, 0, zz + 1.2), p2 = proj(x + .03, 0, zz + 1.2), p3 = proj(x + .03, 0, zz), p4 = proj(x - .03, 0, zz);
            if (!p1 || !p3) continue;
            g.globalAlpha = .75 * fogA(zz);
            g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.lineTo(p3.x, p3.y); g.lineTo(p4.x, p4.y); g.closePath(); g.fill();
          }
        });
        g.globalAlpha = 1;
        /* spike marks: little taped crosses where things go, passing underfoot */
        for (var s = 0; s < 6; s++) {
          var sz = 60 - ((dist * 1 + s * 10) % 60), sx = [-1.05, 1.05, 0, -1.05, 1.05, 0][s] + .25, p = proj(sx, 0, sz);
          if (!p) continue;
          g.strokeStyle = '#EDF2F8'; g.globalAlpha = .35 * fogA(sz); g.lineWidth = Math.max(1, p.k * .02);
          var r = p.k * .06;
          g.beginPath(); g.moveTo(p.x - r, p.y - r * .3); g.lineTo(p.x + r, p.y + r * .3); g.moveTo(p.x + r, p.y - r * .3); g.lineTo(p.x - r, p.y + r * .3); g.stroke();
        }
        g.globalAlpha = 1;
      }
      function walls(g, Z) {
        var off = dist % 4;
        [-1, 1].forEach(function (side) {
          for (var z = 56; z > -3; z -= 4) {
            var zz = z - off, x = side * 1.75, id = Math.floor((z + dist) / 4);
            var a = proj(x, 0, zz), b = proj(x, 2.4, zz), c = proj(x, 2.4, zz + 4), d = proj(x, 0, zz + 4);
            if (!a || !d) continue;
            g.globalAlpha = fogA(zz);
            g.fillStyle = id % 2 ? Z.wall : Z.wall2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
            /* what is on the wall: a door with its sign, a poster, a sconce and its pool of light */
            var kind = ((id * 7) % 5 + 5) % 5;
            if (kind === 0) {
              var e = proj(x, 1.6, zz + 1.2), f = proj(x, 0, zz + 2.6);
              if (e && f) {
                g.fillStyle = '#1a1e28'; g.fillRect(Math.min(e.x, f.x), e.y, Math.abs(f.x - e.x) || 1, f.y - e.y);
                var sg = proj(x, 1.85, zz + 1.9); if (sg) { g.fillStyle = '#1f9a62'; g.fillRect(sg.x - sg.k * .1, sg.y - sg.k * .04, sg.k * .2, sg.k * .08); }
              }
            } else if (kind === 2) {
              var p0 = proj(x, 1.8, zz + 1.4), p1 = proj(x, .9, zz + 2.2);
              if (p0 && p1) { g.fillStyle = ['#9B7BFF', '#FF4FD8', '#8A96A6'][((id % 3) + 3) % 3]; g.globalAlpha *= .35; g.fillRect(Math.min(p0.x, p1.x), p0.y, Math.abs(p1.x - p0.x) || 1, p1.y - p0.y); g.globalAlpha = fogA(zz); }
            } else if (kind === 4) {
              var sc = proj(x, 1.7, zz + 2); if (sc) {
                g.fillStyle = Z.light + '.9)'; g.beginPath(); g.arc(sc.x, sc.y, Math.max(1.5, sc.k * .04), 0, 7); g.fill();
                var pool = proj(x * .75, 0, zz + 2);
                if (pool) { var pg = g.createRadialGradient(pool.x, pool.y, 1, pool.x, pool.y, pool.k * .7); pg.addColorStop(0, Z.light + '.2)'); pg.addColorStop(1, Z.light + '0)'); g.fillStyle = pg; g.beginPath(); g.ellipse(pool.x, pool.y, pool.k * .7, pool.k * .25, 0, 0, 7); g.fill(); }
              }
            }
            /* the cable tray along the top, cables in it */
            var t1 = proj(x, 2.1, zz), t2 = proj(x, 2.1, zz + 4);
            if (t1 && t2) {
              g.globalAlpha *= .55;
              g.strokeStyle = '#8A96A6'; g.lineWidth = Math.max(1, t1.k * .02); g.beginPath(); g.moveTo(t1.x, t1.y); g.lineTo(t2.x, t2.y); g.stroke();
              g.strokeStyle = '#9B7BFF'; g.lineWidth = Math.max(1, t1.k * .01); g.beginPath(); g.moveTo(t1.x, t1.y + t1.k * .03); g.lineTo(t2.x, t2.y + t2.k * .03); g.stroke();
              g.globalAlpha = fogA(zz);
            }
            /* the skirting, lit */
            var k1 = proj(x, .05, zz), k2 = proj(x, .05, zz + 4);
            if (k1 && k2) { g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 1; g.beginPath(); g.moveTo(k1.x, k1.y); g.lineTo(k2.x, k2.y); g.stroke(); }
            g.globalAlpha = 1;
          }
        });
      }
      function speedLines(g) {
        if (speed < 14 && me.hype <= 0) return;
        g.strokeStyle = me.hype > 0 ? 'rgba(255,214,120,.45)' : 'rgba(255,255,255,' + ((speed - 14) / 30).toFixed(2) + ')'; g.lineWidth = me.hype > 0 ? 1.5 : 1;
        for (var i = 0; i < 8; i++) {
          var a = (i / 8) * Math.PI * 2 + time, r = 140 + ((time * 400 + i * 50) % 120);
          g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r, HOR + 60 + Math.sin(a) * r * .8); g.lineTo(W / 2 + Math.cos(a) * (r + 30), HOR + 60 + Math.sin(a) * (r + 30) * .8); g.stroke();
        }
      }

      /* ---- the things in the venue ---- */
      function box3(g, x, y0, y1, z0, z1, hw, front, top, side) {
        /* a box from z0 to z1, y0 to y1, half-width hw, drawn as its front and top (and the side nearer the middle) */
        var fl = proj(x - hw, y0, z0), fr = proj(x + hw, y0, z0), tl = proj(x - hw, y1, z0), tr = proj(x + hw, y1, z0);
        var bl = proj(x - hw, y1, z1), br = proj(x + hw, y1, z1);
        if (!fl || !bl) return null;
        g.fillStyle = top; g.beginPath(); g.moveTo(tl.x, tl.y); g.lineTo(tr.x, tr.y); g.lineTo(br.x, br.y); g.lineTo(bl.x, bl.y); g.closePath(); g.fill();
        var sx = x > camX ? x - hw : x + hw;
        var s0 = proj(sx, y0, z0), s1 = proj(sx, y1, z0), s2 = proj(sx, y1, z1), s3 = proj(sx, y0, z1);
        if (s3) { g.fillStyle = side; g.beginPath(); g.moveTo(s0.x, s0.y); g.lineTo(s1.x, s1.y); g.lineTo(s2.x, s2.y); g.lineTo(s3.x, s3.y); g.closePath(); g.fill(); }
        g.fillStyle = front; g.fillRect(tl.x, tl.y, tr.x - tl.x, fl.y - tl.y);
        return { x: tl.x, y: tl.y, w: tr.x - tl.x, h: fl.y - tl.y, k: fl.k };
      }
      function shadow(g, x, z, hw) {
        var p = proj(x, 0, z + .3); if (!p) return;
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(p.x, p.y, p.k * hw * 1.15, p.k * .12, 0, 0, 7); g.fill();
      }
      function thing(g, o) {
        var x = laneX(o.lane), p;
        switch (o.kind) {
          case 'case': {
            shadow(g, x, o.z, .42);
            /* GREEN on top: you can land on it and run along */
            var f = box3(g, x, 0, .58, o.z, o.z + o.len, .42, '#262b37', '#24604f', '#191d27');
            if (f) { roadcase(g, f, '#c9d1dc'); walkEdge(g, f); }
            break;
          }
          case 'stack': {
            shadow(g, x, o.z, .44);
            var f1 = box3(g, x, 0, 1.0, o.z, o.z + o.len, .44, '#262b37', '#3a4254', '#191d27');
            if (f1) roadcase(g, f1, '#FF5A6E');
            var f2 = box3(g, x, 1.0, 2.0, o.z, o.z + o.len, .4, '#3a2a30', '#4a3038', '#241a1e');
            if (f2) roadcase(g, f2, '#FF5A6E');
            /* too tall to jump: a red edge says go round */
            if (f1 && f2) { g.strokeStyle = '#FF5A6E'; g.shadowColor = '#FF5A6E'; g.shadowBlur = 10; g.lineWidth = Math.max(1.5, f1.k * .025); g.strokeRect(f2.x - 1, f2.y - 1, f2.w + 2, f1.y + f1.h - f2.y + 2); g.shadowBlur = 0; }
            break;
          }
          case 'truss': {
            var a = proj(x - .52, 1.08, o.z), b = proj(x + .52, .8, o.z);
            if (!a) break;
            var u = a.k / 100;
            /* the chain hoists that hold it up, in red */
            var ceil = proj(x, 2.6, o.z), cy = ceil ? ceil.y : 0;
            g.strokeStyle = '#3a4456'; g.lineWidth = Math.max(1, u * 2); g.beginPath(); g.moveTo(a.x + 3 * u, a.y); g.lineTo(a.x + 3 * u, cy); g.moveTo(b.x - 3 * u, a.y); g.lineTo(b.x - 3 * u, cy); g.stroke();
            g.fillStyle = '#c0392b'; g.fillRect(a.x - 2 * u, a.y - 22 * u, 10 * u, 12 * u); g.fillRect(b.x - 8 * u, a.y - 22 * u, 10 * u, 12 * u);
            /* silver chords and lattice */
            g.fillStyle = '#1d222c'; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
            g.strokeStyle = '#dfe5ee'; g.lineWidth = Math.max(1, u * 2.4);
            g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, a.y); g.moveTo(a.x, b.y); g.lineTo(b.x, b.y);
            var n = 7; for (var i = 0; i < n; i++) { var x0 = a.x + (b.x - a.x) * i / n, x1 = a.x + (b.x - a.x) * (i + 1) / n; g.moveTo(x0, a.y); g.lineTo((x0 + x1) / 2, b.y); g.lineTo(x1, a.y); }
            g.stroke();
            /* hazard tape hanging off it, swinging: duck */
            var tp = Math.max(3, u * 5), sw = Math.sin(time * 4 + o.z) * u * 2;
            /* BLUE: slide under */
            for (var s = 0; s < 8; s++) { g.fillStyle = s % 2 ? '#10131a' : '#2FD8FF'; g.fillRect(a.x + (b.x - a.x) * s / 8 + sw, b.y, (b.x - a.x) / 8 + 1, tp); }
            break;
          }
          case 'ramp': {
            var r0 = proj(x - .45, 0, o.z), r1 = proj(x + .45, 0, o.z), r2 = proj(x + .45, .72, o.z + o.len), r3 = proj(x - .45, .72, o.z + o.len);
            if (!r0 || !r3) break;
            /* GREEN: run up it */
            g.fillStyle = '#2c4c44'; g.beginPath(); g.moveTo(r0.x, r0.y); g.lineTo(r1.x, r1.y); g.lineTo(r2.x, r2.y); g.lineTo(r3.x, r3.y); g.closePath(); g.fill();
            g.strokeStyle = '#5CF2C4'; g.lineWidth = Math.max(1.5, r0.k * .025);
            for (var cv = 1; cv < 5; cv++) {
              var t0 = cv / 5, q0 = proj(x - .38, .72 * t0, o.z + o.len * t0), qm = proj(x, .72 * (t0 + .08), o.z + o.len * (t0 + .08)), q1 = proj(x + .38, .72 * t0, o.z + o.len * t0);
              if (q0 && qm) { g.beginPath(); g.moveTo(q0.x, q0.y); g.lineTo(qm.x, qm.y); g.lineTo(q1.x, q1.y); g.stroke(); }
            }
            break;
          }
          case 'riser': {
            var fr = box3(g, x, 0, .72, o.z, o.z + o.len, .46, '#151820', '#2b2f3a', '#0f1218');
            if (fr) {
              /* the skirt's pleats, and the glow tape on the edge */
              g.fillStyle = 'rgba(255,255,255,.06)'; for (var pl = 1; pl < 8; pl++) g.fillRect(fr.x + fr.w * pl / 8, fr.y + fr.h * .12, Math.max(1, fr.k * .008), fr.h * .88);
              walkEdge(g, fr);
            }
            break;
          }
          case 'cart': {
            /* the tug: amber, beacon, headlights, coming at you */
            shadow(g, x, o.z, .46);
            var fc = box3(g, x, .18, 1.0, o.z, o.z + o.len, .44, '#b8452e', '#d65a40', '#8a3322');
            if (fc) {
              var cab = box3(g, x, 1.0, 1.4, o.z + .4, o.z + 1.2, .34, '#1a1e28', '#2b3240', '#12151c');
              if (cab) { g.fillStyle = 'rgba(143,235,255,.35)'; g.fillRect(cab.x + cab.w * .1, cab.y + cab.h * .15, cab.w * .8, cab.h * .6); }
              g.fillStyle = '#10131a'; g.fillRect(fc.x + fc.w * .1, fc.y + fc.h * .3, fc.w * .8, fc.h * .12);
              var on = Math.sin(time * 12) > 0;
              var bc = proj(x, 1.55, o.z + .8); if (bc) { g.fillStyle = on ? '#FF5A6E' : '#5a1e27'; if (on) { g.shadowColor = '#FF5A6E'; g.shadowBlur = 14; } g.beginPath(); g.arc(bc.x, bc.y, Math.max(2, bc.k * .06), 0, 7); g.fill(); g.shadowBlur = 0; }
              var w0 = proj(x - .34, .15, o.z), w1 = proj(x + .34, .15, o.z);
              if (w0) { g.fillStyle = '#05070b'; g.beginPath(); g.arc(w0.x, w0.y, w0.k * .12, 0, 7); g.arc(w1.x, w1.y, w1.k * .12, 0, 7); g.fill(); }
              g.fillStyle = 'rgba(255,248,220,.95)'; g.shadowColor = '#fff'; g.shadowBlur = 10;
              g.fillRect(fc.x + fc.w * .06, fc.y + fc.h * .6, fc.w * .16, fc.h * .14); g.fillRect(fc.x + fc.w * .78, fc.y + fc.h * .6, fc.w * .16, fc.h * .14); g.shadowBlur = 0;
            }
            break;
          }
          case 'cable': {
            /* a yellow-jacket cable ramp across the lane: yellow top, black ends */
            var c0 = proj(x - .5, 0, o.z), c1 = proj(x + .5, 0, o.z), c2 = proj(x + .5, .14, o.z + .25), c3 = proj(x - .5, .14, o.z + .25), c4 = proj(x + .5, 0, o.z + .5), c5 = proj(x - .5, 0, o.z + .5);
            if (!c0 || !c5) break;
            g.fillStyle = '#FFD34A'; g.beginPath(); g.moveTo(c0.x, c0.y); g.lineTo(c1.x, c1.y); g.lineTo(c2.x, c2.y); g.lineTo(c3.x, c3.y); g.closePath(); g.fill();
            g.fillStyle = '#b8901f'; g.beginPath(); g.moveTo(c3.x, c3.y); g.lineTo(c2.x, c2.y); g.lineTo(c4.x, c4.y); g.lineTo(c5.x, c5.y); g.closePath(); g.fill();
            g.fillStyle = '#10131a'; g.fillRect(c0.x, c3.y, Math.max(2, (c1.x - c0.x) * .08), c0.y - c3.y); g.fillRect(c1.x - Math.max(2, (c1.x - c0.x) * .08), c2.y, Math.max(2, (c1.x - c0.x) * .08), c1.y - c2.y);
            g.strokeStyle = 'rgba(16,19,26,.6)'; g.lineWidth = Math.max(1, c0.k * .01);
            for (var ch = 1; ch < 4; ch++) { g.beginPath(); g.moveTo(c0.x + (c1.x - c0.x) * ch / 4, c0.y); g.lineTo(c3.x + (c2.x - c3.x) * ch / 4, c3.y); g.stroke(); }
            break;
          }
          case 'wet': {
            p = proj(x, 0, o.z); if (!p) break;
            g.fillStyle = 'rgba(140,190,255,.35)'; g.beginPath(); g.ellipse(p.x, p.y, p.k * .42, p.k * .09, 0, 0, 7); g.fill();
            g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.ellipse(p.x - p.k * .12, p.y - p.k * .02, p.k * .1, p.k * .02, 0, 0, 7); g.fill();
            /* the yellow A-frame sign, with its figure slipping */
            var sx0 = p.x + p.k * .16, sy = p.y, sh = p.k * .55;
            g.fillStyle = '#FFD34A'; g.beginPath(); g.moveTo(sx0, sy); g.lineTo(sx0 + sh * .2, sy - sh); g.lineTo(sx0 + sh * .4, sy); g.closePath(); g.fill();
            g.strokeStyle = '#10131a'; g.lineWidth = Math.max(1, p.k * .012); g.beginPath(); g.arc(sx0 + sh * .2, sy - sh * .62, sh * .05, 0, 7); g.moveTo(sx0 + sh * .2, sy - sh * .56); g.lineTo(sx0 + sh * .14, sy - sh * .32); g.lineTo(sx0 + sh * .26, sy - sh * .22); g.stroke();
            break;
          }
          case 'pick': {
            p = proj(x, o.y, o.z); if (!p) break;
            var sp = Math.cos(time * 5 + o.z), s2 = p.k * .13;
            g.fillStyle = me.pass > 0 ? '#FF4FD8' : '#FFB547'; g.shadowColor = g.fillStyle; g.shadowBlur = 8;
            g.beginPath(); g.moveTo(p.x - s2 * sp, p.y - s2); g.quadraticCurveTo(p.x + s2 * sp * 1.2, p.y - s2, p.x + s2 * sp, p.y - s2 * .2); g.quadraticCurveTo(p.x, p.y + s2 * 1.4, p.x - s2 * sp, p.y - s2 * .2); g.closePath(); g.fill();
            g.shadowBlur = 0;
            break;
          }
          case 'item': {
            p = proj(x, o.y + Math.sin(time * 4) * .06, o.z); if (!p) break;
            var beam = proj(x, 3, o.z); if (beam) { g.fillStyle = 'rgba(92,242,196,.14)'; g.fillRect(p.x - p.k * .07, beam.y, p.k * .14, p.y - beam.y); }
            g.fillStyle = 'rgba(92,242,196,.3)'; g.beginPath(); g.arc(p.x, p.y, p.k * .34, 0, 7); g.fill();
            g.strokeStyle = '#5CF2C4'; g.lineWidth = Math.max(1.5, p.k * .02); g.stroke();
            icon(g, o.item, p.x, p.y, p.k * .28);
            break;
          }
          case 'power': {
            /* a power is not a pick: bigger, a turning ring, a beam from
               above, and its name under it */
            p = proj(x, .7 + Math.sin(time * 4) * .06, o.z); if (!p) break;
            var pb = proj(x, 3, o.z); if (pb) { g.fillStyle = 'rgba(155,123,255,.16)'; g.fillRect(p.x - p.k * .08, pb.y, p.k * .16, p.y - pb.y); }
            g.fillStyle = 'rgba(155,123,255,.45)'; g.beginPath(); g.arc(p.x, p.y, p.k * .38, 0, 7); g.fill();
            g.strokeStyle = '#C9B8FF'; g.lineWidth = Math.max(1.5, p.k * .03);
            g.beginPath(); g.arc(p.x, p.y, p.k * .46, time * 3, time * 3 + 4.4); g.stroke();
            powerIcon(g, o.power, p.x, p.y, p.k * .03);
            g.fillStyle = '#EDF2F8'; g.font = '700 ' + Math.max(8, p.k * .12).toFixed(0) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
            g.fillText(words('stagerunner_p_' + o.power).toUpperCase(), p.x, p.y + p.k * .52);
            break;
          }
          case 'door': door(g, o); break;
          case 'crew': crewDraw(g, o); break;
        }
      }
      /* WHAT TO DO, painted on the floor before each thing */
      var SIGN = { case: 'climb', ramp: 'climb', cable: 'jump', wet: 'jump', truss: 'slide', stack: 'dodge', cart: 'dodge' };
      var SIGNCOL = { climb: '#5CF2C4', jump: '#FFD34A', slide: '#2FD8FF', dodge: '#FF5A6E' };
      function floorSign(g, o) {
        var kind = SIGN[o.kind], z = o.z - 2.4, x = laneX(o.lane);
        if (z < -1 || z > 34) return;
        var P = function (dx, dz) { return proj(x + dx, .01, z + dz); };
        var pts2;
        if (kind === 'jump' || kind === 'climb') pts2 = [[0, 1.1], [.3, .55], [.12, .55], [.12, 0], [-.12, 0], [-.12, .55], [-.3, .55]];
        else if (kind === 'slide') pts2 = [[0, 0], [.3, .55], [.12, .55], [.12, 1.1], [-.12, 1.1], [-.12, .55], [-.3, .55]];
        else pts2 = [[-.34, .55], [-.14, .85], [-.14, .65], [.14, .65], [.14, .85], [.34, .55], [.14, .25], [.14, .45], [-.14, .45], [-.14, .25]];
        var q = pts2.map(function (v) { return P(v[0], v[1]); });
        if (q.some(function (v) { return !v; })) return;
        g.globalAlpha = .8 * fogA(z); g.fillStyle = SIGNCOL[kind];
        g.beginPath(); q.forEach(function (v, i) { if (i) g.lineTo(v.x, v.y); else g.moveTo(v.x, v.y); }); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      /* the green edge of something you can stand on */
      function walkEdge(g, f) {
        g.fillStyle = '#5CF2C4'; g.shadowColor = '#5CF2C4'; g.shadowBlur = 10;
        g.fillRect(f.x, f.y - Math.max(1, f.k * .01), f.w, Math.max(2.5, f.k * .03)); g.shadowBlur = 0;
      }
      /* the first two of each kind say what they ask, above them */
      function tagDraw(g, o) {
        if (o.z > 22 || o.z < .5) return;
        var x = laneX(o.lane), top = { case: .58, ramp: .8, cable: .2, wet: .5, truss: 1.1, stack: 2, cart: 1.4 }[o.kind];
        var p = proj(x, top + .55, o.z); if (!p) return;
        var t = words('stagerunner_t_' + o.tag).toUpperCase(), col = SIGNCOL[o.tag];
        g.font = '700 ' + Math.max(9, Math.min(14, p.k * .13)).toFixed(0) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        var tw = g.measureText(t).width + 12, th = Math.max(14, Math.min(20, p.k * .18));
        g.globalAlpha = fogA(o.z);
        g.fillStyle = 'rgba(8,10,16,.85)'; roundRect(g, p.x - tw / 2, p.y - th / 2, tw, th, 5); g.fill();
        g.strokeStyle = col; g.lineWidth = 1.5; g.stroke();
        g.fillStyle = col; g.fillText(t, p.x, p.y + 1);
        g.globalAlpha = 1;
      }
      function roadcase(g, f, tape) {
        var k = f.k;
        /* a light rim, so its shape reads against the floor */
        g.strokeStyle = '#c9d1dc'; g.lineWidth = Math.max(1.2, k * .022); g.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
        g.fillStyle = tape; g.fillRect(f.x + f.w * .08, f.y + f.h * .38, f.w * .84, Math.max(2, f.h * .16));
        /* latches and ball corners */
        g.fillStyle = '#dfe5ee'; var c = Math.max(2.5, k * .07);
        [[f.x, f.y], [f.x + f.w, f.y], [f.x, f.y + f.h], [f.x + f.w, f.y + f.h]].forEach(function (q) { g.beginPath(); g.arc(q[0], q[1], c * .7, 0, 7); g.fill(); });
        g.fillRect(f.x + f.w * .2, f.y + f.h * .22, Math.max(2, f.w * .08), Math.max(2, f.h * .1)); g.fillRect(f.x + f.w * .72, f.y + f.h * .22, Math.max(2, f.w * .08), Math.max(2, f.h * .1));
      }
      function icon(g, item, x, y, s) {
        g.save(); g.translate(x, y); g.scale(s / 10, s / 10);
        g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.fillStyle = '#fff';
        if (item === 'coffee') { g.fillRect(-5, -4, 9, 10); g.strokeRect(4, -2, 3, 5); g.fillStyle = '#6b4226'; g.fillRect(-4, -3, 7, 3); }
        if (item === 'batteries') { g.fillRect(-6, -5, 4, 10); g.fillRect(-1, -5, 4, 10); g.fillRect(4, -5, 4, 10); g.fillStyle = '#FFB547'; g.fillRect(-6, -7, 4, 2); g.fillRect(-1, -7, 4, 2); g.fillRect(4, -7, 4, 2); }
        if (item === 'setlist') { g.fillRect(-5, -7, 10, 14); g.fillStyle = '#10131a'; for (var i = 0; i < 4; i++) g.fillRect(-3, -4 + i * 3, 6, 1); }
        if (item === 'water') { g.fillStyle = '#8FEBFF'; g.fillRect(-3, -4, 6, 11); g.fillRect(-1.5, -7, 3, 3); }
        if (item === 'tape') { g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill(); g.fillStyle = '#10131a'; g.beginPath(); g.arc(0, 0, 3, 0, 7); g.fill(); }
        if (item === 'snack') { g.fillStyle = '#FF4FD8'; g.beginPath(); g.moveTo(-6, -6); g.lineTo(6, -6); g.lineTo(5, 7); g.lineTo(-5, 7); g.closePath(); g.fill(); g.fillStyle = '#fff'; g.fillRect(-4, -1, 8, 2); }
        if (item === 'sticks') { g.lineWidth = 2; g.strokeStyle = '#e8c48a'; g.beginPath(); g.moveTo(-6, 7); g.lineTo(4, -7); g.moveTo(-2, 7); g.lineTo(7, -6); g.stroke(); }
        if (item === 'clicker') { g.fillStyle = '#c9d1dc'; g.fillRect(-3, -7, 6, 14); g.fillStyle = '#FF5A6E'; g.beginPath(); g.arc(0, -3, 1.6, 0, 7); g.fill(); g.fillStyle = '#10131a'; g.fillRect(-1.5, 1, 3, 2); }
        if (item === 'juice') { g.fillStyle = '#5CF2C4'; g.fillRect(-5, -5, 7, 11); g.fillStyle = '#FFB547'; g.fillRect(-5, -1, 7, 3); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(1, -5); g.lineTo(3, -9); g.stroke(); }
        g.restore();
      }
      function powerIcon(g, kind, x, y, s) {
        g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineCap = 'round';
        if (kind === 'headset') { g.beginPath(); g.arc(0, 1, 7, Math.PI, 0); g.stroke(); g.fillRect(-9, 0, 4, 6); g.fillRect(5, 0, 4, 6); g.beginPath(); g.moveTo(7, 6); g.lineTo(2, 9); g.stroke(); }
        else if (kind === 'case') { g.fillRect(-9, -3, 18, 6); g.fillStyle = '#FFB547'; g.fillRect(-9, 0, 18, 1.5); g.fillStyle = '#fff'; g.beginPath(); g.arc(-6, 6, 2, 0, 7); g.arc(6, 6, 2, 0, 7); g.fill(); }
        else if (kind === 'shoes') { g.beginPath(); g.moveTo(-8, 4); g.lineTo(6, 4); g.lineTo(8, 1); g.lineTo(0, 0); g.lineTo(-3, -4); g.lineTo(-8, -4); g.closePath(); g.fill(); g.beginPath(); g.moveTo(-6, 6); g.lineTo(-3, 9); g.lineTo(0, 6); g.lineTo(3, 9); g.lineTo(6, 6); g.stroke(); }
        else { g.fillRect(-7, -9, 14, 18); g.fillStyle = '#9B7BFF'; g.fillRect(-5, -4, 10, 3); g.fillRect(-5, 1, 10, 2); g.fillStyle = '#FF5A6E'; g.fillRect(-7, -9, 14, 3); }
        g.restore();
      }
      /* the green room door: whoever asked is in it, waiting; delivered, they cheer */
      function door(g, o) {
        var d0 = proj(-1.6, 2.2, o.z), d1 = proj(1.6, 0, o.z);
        if (!d0) return;
        var on = (mission && mission.have) || o.happy, who = WHO[o.who] || WHO.talent;
        g.fillStyle = on ? 'rgba(92,242,196,.14)' : 'rgba(255,255,255,.04)'; g.fillRect(d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
        g.strokeStyle = on ? '#5CF2C4' : '#3a4456'; g.lineWidth = Math.max(2, d0.k * .06);
        g.strokeRect(d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
        /* the star on the door */
        var st = proj(0, 2.45, o.z), r = Math.max(4, d0.k * .12);
        if (st) { g.fillStyle = '#FFD34A'; g.beginPath(); for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; g.lineTo(st.x + Math.cos(a) * rr, st.y + Math.sin(a) * rr); } g.closePath(); g.fill(); }
        g.fillStyle = on ? '#5CF2C4' : '#8A96A6'; g.font = '700 ' + Math.max(7, d0.k * .2) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText(words('stagerunner_greenroom').toUpperCase(), (d0.x + d1.x) / 2, d0.y + d0.k * .08);
        /* the one who asked, beside the door, facing you */
        var pp = proj(1.25, 0, o.z + .3); if (!pp) return;
        var u = pp.k / 100, cheer = o.happy ? Math.abs(Math.sin((time - o.happy) * 10)) : 0;
        g.save(); g.translate(pp.x, pp.y - cheer * 10 * u);
        g.strokeStyle = '#1c2330'; g.lineWidth = 8 * u; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-5 * u, -44 * u); g.lineTo(-6 * u, 0); g.moveTo(5 * u, -44 * u); g.lineTo(6 * u, 0); g.stroke();
        g.fillStyle = who.col; roundRect(g, -12 * u, -84 * u, 24 * u, 42 * u, 6 * u); g.fill();
        g.strokeStyle = '#e2b48f'; g.lineWidth = 5.5 * u; g.beginPath();
        if (o.happy) { g.moveTo(-11 * u, -78 * u); g.lineTo(-20 * u, -104 * u); g.moveTo(11 * u, -78 * u); g.lineTo(20 * u, -104 * u); }
        else { g.moveTo(-11 * u, -78 * u); g.lineTo(-16 * u, -54 * u); g.moveTo(11 * u, -78 * u); g.lineTo(4 * u, -64 * u); }      /* arms crossed-ish, waiting */
        g.stroke();
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(0, -96 * u, 10 * u, 0, 7); g.fill();
        g.fillStyle = '#2a1d16'; g.beginPath(); g.arc(0, -99 * u, 10 * u, Math.PI, 0); g.fill();
        if (o.who === 'kids') { g.fillStyle = '#FFB547'; g.fillRect(-10 * u, -104 * u, 20 * u, 4 * u); }
        if (o.who === 'pastor') { g.fillStyle = '#fff'; g.fillRect(-2 * u, -84 * u, 4 * u, 4 * u); }
        if (o.who === 'drums') { g.strokeStyle = '#e8c48a'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(-16 * u, -54 * u); g.lineTo(-24 * u, -66 * u); g.stroke(); }
        g.fillStyle = '#10131a'; g.fillRect(-4 * u, -98 * u, 2 * u, 2 * u); g.fillRect(2 * u, -98 * u, 2 * u, 2 * u);
        g.strokeStyle = '#10131a'; g.lineWidth = 1.4 * u; g.beginPath();
        if (o.happy) g.arc(0, -92 * u, 4 * u, .2, Math.PI - .2); else { g.moveTo(-3 * u, -90 * u); g.lineTo(3 * u, -90 * u); }
        g.stroke();
        if (o.happy) {
          /* hearts rising */
          for (var h = 0; h < 3; h++) {
            var t = ((time - o.happy) * .9 + h * .33) % 1, hx = (h - 1) * 14 * u, hy = -120 * u - t * 40 * u;
            g.globalAlpha = 1 - t; g.fillStyle = '#FF4FD8'; g.beginPath(); g.arc(hx - 3 * u, hy, 3.5 * u, 0, 7); g.arc(hx + 3 * u, hy, 3.5 * u, 0, 7); g.moveTo(hx - 6.5 * u, hy + 1 * u); g.lineTo(hx, hy + 8 * u); g.lineTo(hx + 6.5 * u, hy + 1 * u); g.fill();
          }
          g.globalAlpha = 1;
        }
        g.restore();
      }
      /* the crew on the walls, waving you past; one with a hand out wants a high five */
      function crewDraw(g, o) {
        /* they pop out from the wall as you come (round 4: "band members,
           PMs, and other people randomly pop out of the sides and give you
           a high five") */
        var out = clamp((16 - o.z) / 5, 0, 1), x = o.side * (1.78 - .3 * out * out * (3 - 2 * out)), pp = proj(x, 0, o.z); if (!pp) return;
        var u = pp.k / 100 * (o.who === 'kid' ? .72 : 1), wave = Math.sin(time * 8 + o.ph);
        var SH = { crew: o.shirt, drums: '#3b2b42', pm: '#39445a', pastor: '#1c2330', kid: '#5CF2C4', singer: '#FF4FD8' };
        var LABEL = { crew: 'CREW', drums: 'BAND', pm: 'PM', pastor: '', kid: '', singer: '' };
        /* slapped: they jump and cheer, both arms up, for a moment */
        var cheer = o.slapped && time - o.slapped < 1.4 ? Math.abs(Math.sin((time - o.slapped) * 9)) * 9 * u : 0;
        g.save(); g.translate(pp.x, pp.y - cheer);
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(0, 0, 14 * u, 4 * u, 0, 0, 7); g.fill();
        g.strokeStyle = '#1c2330'; g.lineWidth = 8 * u; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-5 * u, -44 * u); g.lineTo(-6 * u, 0); g.moveTo(5 * u, -44 * u); g.lineTo(6 * u, 0); g.stroke();
        g.fillStyle = SH[o.who || 'crew']; roundRect(g, -12 * u, -84 * u, 24 * u, 42 * u, 6 * u); g.fill();
        if (o.who === 'pastor') { g.fillStyle = '#fff'; g.fillRect(-2 * u, -84 * u, 4 * u, 4 * u); }
        g.fillStyle = '#EDF2F8'; g.font = '700 ' + (6 * u).toFixed(1) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(LABEL[o.who || 'crew'], 0, -70 * u);
        if (o.who === 'pm') { g.fillStyle = '#c9a26b'; g.fillRect(-o.side * 14 * u, -66 * u, 10 * u, 13 * u); }
        if (o.who === 'drums') { g.strokeStyle = '#e8c48a'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(o.side * 14 * u, -56 * u); g.lineTo(o.side * 24 * u, -70 * u); g.stroke(); }
        if (o.who === 'singer') { g.fillStyle = '#c9d1dc'; g.fillRect(o.side * 13 * u, -66 * u, 3 * u, 9 * u); }
        g.strokeStyle = '#d9a37e'; g.lineWidth = 5.5 * u; g.beginPath();
        var toward = -o.side;
        if (o.five && !o.slapped) { g.moveTo(toward * 11 * u, -78 * u); g.lineTo(toward * 30 * u, -92 * u); }
        else if (o.slapped) { g.moveTo(toward * 11 * u, -78 * u); g.lineTo(toward * 18 * u, -104 * u); }
        else { g.moveTo(toward * 11 * u, -78 * u); g.lineTo(toward * (16 + wave * 5) * u, -104 * u); }
        if (cheer) { g.moveTo(-toward * 11 * u, -78 * u); g.lineTo(-toward * 18 * u, -104 * u); }
        else { g.moveTo(-toward * 11 * u, -78 * u); g.lineTo(-toward * 15 * u, -54 * u); }
        g.stroke();
        if (o.five && !o.slapped) { g.fillStyle = '#d9a37e'; g.beginPath(); g.arc(toward * 32 * u, -94 * u, 5 * u, 0, 7); g.fill(); g.strokeStyle = 'rgba(255,214,120,' + (.5 + .4 * Math.sin(time * 10)) + ')'; g.lineWidth = 2 * u; g.beginPath(); g.arc(toward * 32 * u, -94 * u, 10 * u, 0, 7); g.stroke(); }
        if (o.cup) { g.fillStyle = '#EDF2F8'; g.fillRect(-toward * 17 * u, -58 * u, 6 * u, 8 * u); }
        g.fillStyle = '#d9a37e'; g.beginPath(); g.arc(0, -96 * u, 10 * u, 0, 7); g.fill();
        g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(0, -99 * u, 10 * u, Math.PI, 0); g.fill();
        if (o.who === 'crew' || o.who === 'pm') { g.strokeStyle = '#2FD8FF'; g.lineWidth = 2 * u; g.beginPath(); g.arc(0, -96 * u, 12 * u, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
        if (o.who === 'kid') { g.fillStyle = '#FFB547'; g.fillRect(-10 * u, -104 * u, 20 * u, 4 * u); }
        g.restore();
      }

      /* ---- the stage manager, from behind ---- */
      function runner(g) {
        var p = proj(me.x, me.y, 0);
        if (!p) return;
        var k = p.k, u = k / 100, sliding = me.slide > 0, air = me.y > me.ground + .05;
        /* shadow, shrinking as you rise */
        var sp = proj(me.x, me.ground, 0), hgt = clamp((me.y - me.ground) / 2.4, 0, 1);
        g.fillStyle = 'rgba(0,0,0,' + (.4 - hgt * .25) + ')'; g.beginPath(); g.ellipse(sp.x, sp.y, k * .22 * (1 - hgt * .4), k * .06, 0, 0, 7); g.fill();
        var lift = me.onCase > 0 ? k * .14 : 0;
        if (me.onCase > 0) {
          g.fillStyle = '#262b37'; g.fillRect(p.x - k * .32, p.y - k * .14, k * .64, k * .14);
          g.strokeStyle = '#c9d1dc'; g.lineWidth = Math.max(1, k * .015); g.strokeRect(p.x - k * .32, p.y - k * .14, k * .64, k * .14);
          g.fillStyle = '#FFB547'; g.fillRect(p.x - k * .32, p.y - k * .07, k * .64, k * .03);
        }
        var squash = me.land > 0 ? 1 - me.land * 1.1 : 1;
        g.save(); g.translate(p.x, p.y - lift); g.rotate(me.lean * .14); g.scale(1 + (1 - squash) * .5, squash);
        g.lineCap = 'round'; g.lineJoin = 'round';
        var ph = me.run, carry = mission && mission.have;
        if (sliding) {
          /* a slide, from behind: low, leaning back, one leg out, arms back for balance */
          g.strokeStyle = '#1c2330'; g.lineWidth = 9 * u;
          g.beginPath(); g.moveTo(-6 * u, -20 * u); g.lineTo(-14 * u, -6 * u); g.lineTo(-10 * u, 0); g.moveTo(6 * u, -20 * u); g.lineTo(12 * u, -4 * u); g.stroke();
          torso(g, u, 0, -22 * u, .62);
          g.strokeStyle = '#151a24'; g.lineWidth = 6 * u;
          g.beginPath(); g.moveTo(-12 * u, -44 * u); g.lineTo(-24 * u, -30 * u); g.moveTo(12 * u, -44 * u); g.lineTo(24 * u, -30 * u); g.stroke();
          head(g, 0, -62 * u, u);
        } else if (air) {
          /* the jump: knees tucked, arms up and out (or holding the errand high) */
          var rise = me.vy > 0;
          g.strokeStyle = '#1c2330'; g.lineWidth = 9 * u;
          g.beginPath(); g.moveTo(-6 * u, -46 * u); g.lineTo(-11 * u, -30 * u); g.lineTo(-6 * u, rise ? -22 * u : -14 * u);
          g.moveTo(6 * u, -46 * u); g.lineTo(11 * u, -32 * u); g.lineTo(6 * u, rise ? -26 * u : -12 * u); g.stroke();
          sole(g, -6 * u, rise ? -22 * u : -14 * u, u); sole(g, 6 * u, rise ? -26 * u : -12 * u, u);
          torso(g, u, 0, -46 * u, 1);
          g.strokeStyle = '#151a24'; g.lineWidth = 6 * u; g.beginPath();
          g.moveTo(-12 * u, -82 * u); g.lineTo(-26 * u, rise ? -104 * u : -92 * u);
          if (!carry) { g.moveTo(12 * u, -82 * u); g.lineTo(26 * u, rise ? -104 * u : -92 * u); }
          g.stroke();
          head(g, 0, -98 * u, u);
        } else {
          /* the run: legs cycling (the soles show as each foot kicks up), arms pumping */
          [0, 1].forEach(function (i) {
            var s = Math.sin(ph + i * Math.PI), up = Math.max(0, s), hx = (i ? 6 : -6) * u;
            var fy = -2 * u - up * 18 * u, ky = -26 * u - up * 6 * u;
            g.strokeStyle = '#1c2330'; g.lineWidth = 9 * u;
            g.beginPath(); g.moveTo(hx, -48 * u); g.lineTo(hx * 1.3, ky); g.lineTo(hx, fy); g.stroke();
            if (up > .2) sole(g, hx, fy, u); else { g.fillStyle = '#0d0f15'; g.fillRect(hx - 5 * u, fy - 2 * u, 10 * u, 5 * u); }
          });
          var bob = Math.abs(Math.sin(ph)) * 3 * u;
          g.translate(0, -bob);
          torso(g, u, 0, -48 * u, 1);
          var aL = Math.sin(ph) * 12 * u;
          g.strokeStyle = '#151a24'; g.lineWidth = 6 * u; g.beginPath();
          g.moveTo(-12 * u, -82 * u); g.lineTo(-17 * u, -64 * u + aL); g.lineTo(-13 * u, -54 * u + aL);
          if (!carry) { g.moveTo(12 * u, -82 * u); g.lineTo(17 * u, -64 * u - aL); g.lineTo(13 * u, -54 * u - aL); }
          g.stroke();
          g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(-13 * u, -53 * u + aL, 3 * u, 0, 7); if (!carry) g.arc(13 * u, -53 * u - aL, 3 * u, 0, 7); g.fill();
          head(g, 0, -100 * u, u);
        }
        /* the errand, held high in one hand */
        if (carry && !sliding) {
          var top = air ? -116 * u : -120 * u;
          g.strokeStyle = '#151a24'; g.lineWidth = 6 * u; g.beginPath(); g.moveTo(12 * u, (air ? -82 : -82) * u); g.lineTo(16 * u, top + 10 * u); g.stroke();
          g.fillStyle = 'rgba(92,242,196,.35)'; g.beginPath(); g.arc(18 * u, top, 13 * u, 0, 7); g.fill();
          icon(g, mission.item, 18 * u, top, 9 * u);
        }
        g.restore();
        if (me.hype > 0) {
          /* CREW HYPE: the runner glows */
          var hg = g.createRadialGradient(p.x, p.y - k * .55, 4, p.x, p.y - k * .55, k * .7);
          hg.addColorStop(0, 'rgba(255,214,120,' + (.35 * Math.min(1, me.hype)).toFixed(2) + ')'); hg.addColorStop(1, 'rgba(255,214,120,0)');
          g.fillStyle = hg; g.fillRect(p.x - k, p.y - k * 1.4, k * 2, k * 1.6);
        }
        if (me.magnet > 0) { g.strokeStyle = 'rgba(155,123,255,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y - k * .55, k * .45 + Math.sin(time * 10) * 3, 0, 7); g.stroke(); }
      }
      /* the back of a black crew tee: CREW across the shoulders, the
         lanyard's strap, a belt, the walkie on it with its antenna */
      function torso(g, u, x, hipY, h) {
        var top = hipY - 40 * u * h;
        g.fillStyle = '#151a24'; roundRect(g, x - 13 * u, top, 26 * u, 40 * u * h + 2 * u, 6 * u); g.fill();
        g.fillStyle = '#EDF2F8'; g.font = '700 ' + (7 * u).toFixed(1) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('CREW', x, top + 11 * u * h);
        g.strokeStyle = '#FF5A6E'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(x - 6 * u, top + 1 * u); g.quadraticCurveTo(x, top + 5 * u, x + 6 * u, top + 1 * u); g.stroke();
        g.fillStyle = '#0b0d12'; g.fillRect(x - 13 * u, hipY - 4 * u, 26 * u, 4 * u);
        g.fillStyle = '#2a3142'; g.fillRect(x + 6 * u, hipY - 10 * u, 6 * u, 10 * u);
        g.strokeStyle = '#2a3142'; g.lineWidth = 1.6 * u; g.beginPath(); g.moveTo(x + 10 * u, hipY - 10 * u); g.lineTo(x + 10 * u, hipY - 18 * u); g.stroke();
      }
      function sole(g, x, y, u) { g.fillStyle = '#c9d1dc'; g.beginPath(); g.ellipse(x, y, 5 * u, 3.4 * u, 0, 0, 7); g.fill(); }
      /* the head from behind: hair, the headset's band and both cups, the boom peeking out */
      function head(g, x, y, u) {
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(x - 11 * u, y + 1 * u, 3 * u, 0, 7); g.arc(x + 11 * u, y + 1 * u, 3 * u, 0, 7); g.fill();
        g.fillStyle = '#2a1d16'; g.beginPath(); g.arc(x, y, 11 * u, 0, 7); g.fill();
        g.fillStyle = '#3b2a20'; g.beginPath(); g.arc(x - 3 * u, y - 4 * u, 5 * u, 0, 7); g.fill();
        g.strokeStyle = '#2FD8FF'; g.lineWidth = 2.6 * u; g.beginPath(); g.arc(x, y + 1 * u, 12.5 * u, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
        g.fillStyle = '#10131a'; g.fillRect(x - 15 * u, y - 3 * u, 5 * u, 9 * u); g.fillRect(x + 10 * u, y - 3 * u, 5 * u, 9 * u);
        g.strokeStyle = '#10131a'; g.lineWidth = 1.6 * u; g.beginPath(); g.moveTo(x + 14 * u, y + 4 * u); g.lineTo(x + 17 * u, y + 11 * u); g.stroke();
      }
      /* the PM, clipboard up, right behind you */
      function chaser(g) {
        var p = proj(me.x + Math.sin(time * 3) * .2, 0, -1.2 + Math.max(0, pm - 4) * .5);
        if (!p) return;
        var u = p.k / 100, sw = Math.sin(time * 14);
        g.save(); g.translate(p.x - 60 * u, p.y);
        g.strokeStyle = '#2a3346'; g.lineWidth = 9 * u; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-5 * u, -48 * u); g.lineTo(-5 * u + sw * 10 * u, 0); g.moveTo(5 * u, -48 * u); g.lineTo(5 * u - sw * 10 * u, 0); g.stroke();
        g.fillStyle = '#39445a'; roundRect(g, -13 * u, -88 * u, 26 * u, 42 * u, 6 * u); g.fill();
        g.fillStyle = '#EDF2F8'; g.font = '700 ' + 12 * u + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('PM', 0, -70 * u);
        g.strokeStyle = '#e2b48f'; g.lineWidth = 6 * u; g.beginPath(); g.moveTo(-12 * u, -82 * u); g.lineTo(-20 * u, -98 * u); g.stroke();
        g.fillStyle = '#c9a26b'; g.fillRect(-28 * u, -114 * u, 16 * u, 20 * u); g.fillStyle = '#EDF2F8'; g.fillRect(-26 * u, -111 * u, 12 * u, 14 * u);
        g.fillStyle = '#5a5f6b'; g.beginPath(); g.arc(0, -100 * u, 11 * u, 0, 7); g.fill();
        g.restore();
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
        g.fillStyle = 'rgba(200,208,220,.95)';
        g.fillText(Math.floor(dist) + ' M', 12, 50);
        g.fillStyle = '#FFB547'; g.fillText('◆ ' + picks, 12, 64);
        g.textAlign = 'right'; g.fillStyle = mult > 1 ? '#5CF2C4' : 'rgba(200,208,220,.95)'; g.font = '700 15px Sora, sans-serif';
        g.fillText('×' + mult, W - 12, 48);
        /* the errand: who, what, and the patience left */
        if (mission) {
          var bx = W - 142, by = 72, who = WHO[mission.who];
          g.fillStyle = 'rgba(8,10,16,.88)'; g.fillRect(bx, by, 130, 40);
          g.strokeStyle = mission.have ? '#5CF2C4' : who.col; g.lineWidth = 1.2; g.strokeRect(bx + .5, by + .5, 129, 39);
          icon(g, mission.item, bx + 17, by + 20, 10);
          g.fillStyle = who.col; g.font = '700 8px Sora, sans-serif'; g.textAlign = 'left';
          g.fillText(who.tag, bx + 32, by + 5);
          g.fillStyle = '#EDF2F8'; g.font = '600 9px Inter, sans-serif';
          g.fillText(words(mission.have ? 'stagerunner_deliver' : 'stagerunner_item_' + mission.item).toUpperCase().slice(0, 18), bx + 32, by + 16);
          var left = clamp(mission.patience / 40, 0, 1);
          g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(bx + 32, by + 29, 90, 5);
          g.fillStyle = left > .5 ? '#5CF2C4' : left > .25 ? '#FFB547' : '#FF5A6E'; g.fillRect(bx + 32, by + 29, 90 * left, 5);
        }
        /* powers running */
        /* powers running: each with its name and its time left */
        var py = 90;
        [['magnet', 'headset', 10], ['onCase', 'case', 14], ['shoes', 'shoes', 10], ['pass', 'pass', 15]].forEach(function (pw) {
          if (me[pw[0]] <= 0) return;
          g.fillStyle = 'rgba(155,123,255,.4)'; g.beginPath(); g.arc(22, py, 10, 0, 7); g.fill();
          powerIcon(g, pw[1], 22, py, .8);
          g.fillStyle = '#EDF2F8'; g.font = '700 8px Sora, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(words('stagerunner_p_' + pw[1]).toUpperCase(), 36, py - 3);
          g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(36, py + 4, 46, 3); g.fillStyle = '#9B7BFF'; g.fillRect(36, py + 4, 46 * me[pw[0]] / pw[2], 3);
          py += 26;
        });
        /* the crew's hype, and the streak behind it */
        if (me.hype > 0) {
          g.fillStyle = '#FFD34A'; g.font = '700 8px Sora, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
          g.fillText(words('stagerunner_hype').toUpperCase() + (fiveStreak > 1 ? '  ×' + fiveStreak : ''), 12, py - 3);
          g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(12, py + 4, 70, 3); g.fillStyle = '#FFD34A'; g.fillRect(12, py + 4, 70 * me.hype / 7, 3);
        }
        if (banner) {
          g.globalAlpha = Math.min(1, banner.t * 2);
          g.font = '700 20px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = banner.good ? '#5CF2C4' : '#FF5A6E'; g.shadowColor = g.fillStyle; g.shadowBlur = 16;
          g.fillText(banner.text, W / 2, HOR - 70); g.shadowBlur = 0;
          if (banner.sub) { g.font = '600 12px Inter, sans-serif'; g.fillStyle = '#EDF2F8'; g.fillText(banner.sub, W / 2, HOR - 46); }
          g.globalAlpha = 1;
        }
        /* thanks and high fives, floating up from the runner */
        var rp = proj(me.x, me.y, 0);
        pops.forEach(function (q, i) {
          if (!rp) return;
          g.globalAlpha = Math.min(1, q.life * 2); g.font = '700 15px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = q.col; g.shadowColor = q.col; g.shadowBlur = 10;
          g.fillText(q.text, clamp(rp.x, 80, W - 80), rp.y - rp.k * 1.5 - (1.2 - q.life) * 40 - i * 18); g.shadowBlur = 0; g.globalAlpha = 1;
        });
      }
      function roundRect(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }

      return {
        update: update, draw: draw,
        press: function (d) { if (d !== 'tap' && d !== 'go') press(d); else if (!started) started = true; },
        stop: function () { dead = true; things = []; }
      };
    }
  };
})();
