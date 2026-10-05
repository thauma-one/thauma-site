/* =====================================================================
   Stage Runner — the stage manager's errands, at a sprint
   =====================================================================
   Chase, 2026-10-04: "this is a Subway Surfers style game. Try to match
   the feel of it. We should change the name to Stage Runner … a game
   about a Stage Manager running everywhere to do things for the Talent.
   Get creative with this and take your time!" (It began as "Signal Run",
   ARCADE-SPEC.md §4.)

   THREE LANES, RUNNING AWAY INTO THE VENUE. Swipe (or ← → ↑ ↓): change
   lane, jump, slide. Jump the road cases and the cable runs, slide under
   the low truss, get out of the way of the stacks and the carts coming
   the other way. Riser trains have a ramp: run up and along the top.

   THE ERRANDS. The talent wants something — a coffee, AA batteries, the
   setlist, water, gaff tape, the snacks off the rider. It shows up ahead,
   glowing; grab it, and run it through the GREEN ROOM door that comes up
   after. Every delivery raises the multiplier. Too slow and the talent
   gets "creative" (and the multiplier goes back to one).

   THE PM. Stumble — clip a cable, a wet floor, the side of a case — and
   the production manager is right behind you, clipboard up. Stumble again
   before they give up, and you're caught. Hit something head on and it's
   over, unless you are riding a road case (it takes the hit).

   PICKS (guitar picks) everywhere; and four powers: the HEADSET pulls
   picks to you, CASE SURF rides a road case, SPRING SHOES jump higher,
   ALL ACCESS doubles the picks.

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
  var ITEMS = ['coffee', 'batteries', 'setlist', 'water', 'tape', 'snack'];
  var ZONES = ['backstage', 'stage', 'dock', 'arena'];
  var POWERS = ['headset', 'case', 'shoes', 'pass'];

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
      var me = { lane: 1, x: 0, y: 0, vy: 0, ground: 0, slide: 0, run: 0, lean: 0, onCase: 0, shoes: 0, magnet: 0, pass: 0 };
      var things = [];                 /* obstacles, picks, items, doors, powers: { kind, lane, z, len, ... } */
      var dist = 0, speed = 9.5, spawnZ = 18, picks = 0, mult = 1, pts = 0;
      var mission = null, nextMission = 120, pm = 0, stumbles = 0, dead = false, time = 0;
      var zone = 0, zoneAt = 0, banner = null, dust = [], camX = 0;
      var started = false;

      /* ------------------------------------------------------- the world */
      function laneX(l) { return LANES[l] * 1.05; }
      function proj(x, y, z) {
        var dz = z - CAM_Z;
        if (dz < .25) return null;
        var k = F / dz;
        return { x: W / 2 + (x - camX * .55) * k, y: HOR + (CAM_Y - y) * k, k: k };
      }
      function add(o) { things.push(o); return o; }

      /* One stretch of the run at a time, harder the further you are. Every
         pattern leaves a way through. */
      function spawn() {
        var lvl = Math.min(1, dist / 1500), z = spawnZ, len;
        var free = Math.floor(Math.random() * 3);
        var roll = Math.random();
        if (roll < .22) {                                   /* cases in two lanes, picks in the third */
          LANES.forEach(function (_, l) { if (l !== free) add({ kind: Math.random() < .35 + lvl * .3 ? 'stack' : 'case', lane: l, z: z, len: 1.2 }); });
          picksLine(free, z - 3, 6); len = 9;
        } else if (roll < .38) {                            /* the low truss: slide */
          var n = Math.random() < .5 ? 3 : 2;
          for (var l = 0; l < 3; l++) if (n === 3 || l !== free) add({ kind: 'truss', lane: l, z: z, len: .5 });
          if (n !== 3) picksLine(free, z - 2, 4);
          len = 8;
        } else if (roll < .52) {                            /* a riser train with a ramp: run along the top */
          var rl = Math.floor(Math.random() * 3);
          add({ kind: 'ramp', lane: rl, z: z, len: 2.2 });
          add({ kind: 'riser', lane: rl, z: z + 2.2, len: 9 });
          picksLine(rl, z + 3, 7, .75);
          if (Math.random() < .6) add({ kind: 'stack', lane: (rl + 1 + Math.floor(Math.random() * 2)) % 3, z: z + 4, len: 1.2 });
          len = 14;
        } else if (roll < .64 && dist > 120) {              /* a cart, coming the other way */
          add({ kind: 'cart', lane: Math.floor(Math.random() * 3), z: z + 10, len: 1.6, moving: 5 + lvl * 5 });
          len = 10;
        } else if (roll < .76) {                            /* the floor: cables and wet floors, jump them */
          for (var k = 0; k < 3; k++) if (Math.random() < .7) add({ kind: Math.random() < .5 ? 'cable' : 'wet', lane: k, z: z + k * .3, len: .5 });
          picksArc(free, z - 1);
          len = 8;
        } else if (roll < .88) {                            /* a lone case, picks over it in an arc */
          var cl = Math.floor(Math.random() * 3);
          add({ kind: 'case', lane: cl, z: z, len: 1.2 });
          picksArc(cl, z - 1.5);
          len = 7;
        } else {                                            /* breathing room, and maybe a power */
          if (Math.random() < .55) add({ kind: 'power', lane: Math.floor(Math.random() * 3), z: z + 2, len: .6, power: pickOf(POWERS) });
          picksLine(Math.floor(Math.random() * 3), z, 6);
          len = 8;
        }
        /* the errand: the thing the talent wants, or the door to bring it to */
        if (!mission && dist > nextMission) {
          mission = { item: pickOf(ITEMS), have: false, patience: 38, door: false };
          add({ kind: 'item', lane: Math.floor(Math.random() * 3), z: z + len + 6, len: .6, item: mission.item, y: .55 });
          ctx.say(words('stagerunner_wants') + ' ' + words('stagerunner_item_' + mission.item), { tag: 'TALENT' });
          ctx.sfx('zap');
        } else if (mission && mission.have && !mission.door) {
          mission.door = true;
          add({ kind: 'door', lane: 1, z: z + len + 4, len: .8 });
        }
        spawnZ += len * (1 + lvl * .25) + 3 - lvl * 1.5;
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
        });
        return gnd;
      }

      function stumble(why) {
        if (dead) return;
        ctx.shake(3); ctx.sfx('whiff');
        speed = Math.max(8, speed * .82);
        if (pm > 0) return caught();
        pm = 6; stumbles++;
        ctx.quip('jokes_stagerunner_stumble', { mood: 'bad', chance: .5 });
        void why;
      }
      function caught() {
        dead = true; ctx.sfx('crash');
        ctx.say(words('stagerunner_caught'), { mood: 'bad', tag: 'PM' });
        setTimeout(function () { ctx.over(); }, 1100);
      }
      function crash() {
        if (me.onCase > 0) {
          me.onCase = 0; ctx.shake(6); ctx.sfx('break');
          ctx.say(words('stagerunner_p_case_gone'), { mood: 'bad' });
          things = things.filter(function (o) { return !(o.lane === me.lane && o.z < 1.5 && o.z > -1 && o.kind !== 'pick'); });
          return;
        }
        dead = true; ctx.shake(9); ctx.sfx('crash');
        ctx.quip('jokes_stagerunner_crash', { mood: 'bad', force: true });
        setTimeout(function () { ctx.over(); }, 1200);
      }

      /* ------------------------------------------------------- update */
      function update(dt) {
        time += dt;
        me.run += dt * (6 + speed * .55);
        if (!started) { while (spawnZ < 60) spawn(); return; }
        if (dead) { me.y = Math.max(me.ground, me.y - dt * 2); return; }

        speed = Math.min(23, speed + dt * .085 * (speed < 14 ? 1.6 : 1));
        var move = speed * dt;
        dist += move;
        things.forEach(function (o) { o.z -= move + (o.moving ? o.moving * dt : 0); });
        spawnZ -= move;
        while (spawnZ < 70) spawn();

        /* the lane, eased; the jump; the slide */
        me.x += (laneX(me.lane) - me.x) * Math.min(1, dt * 16);
        camX += (me.x - camX) * Math.min(1, dt * 4);
        me.lean *= Math.pow(.02, dt);
        me.ground = groundAt(me.lane);
        me.vy -= GRAV * dt; me.y += me.vy * dt;
        if (me.y <= me.ground) { if (me.vy < -6) ctx.sfx('thud', { vol: .3 }); me.y = me.ground; me.vy = 0; }
        me.slide = Math.max(0, me.slide - dt);
        ['onCase', 'shoes', 'magnet', 'pass'].forEach(function (k) { me[k] = Math.max(0, me[k] - dt); });
        if (pm > 0) { pm -= dt; if (pm <= 0) stumbles = 0; }

        /* what you run into */
        var lane = me.lane, sliding = me.slide > 0, tall = sliding ? .42 : .95;
        things.forEach(function (o) {
          if (o.hit) return;
          var near = o.z < .45 && o.z + o.len > -.35;
          var magnet = me.magnet > 0 && o.kind === 'pick' && o.z < 5 && o.z > -.5;
          if (magnet) { o.lane = lane; o.y = me.y + .4; }
          if (!near || (o.lane !== lane && !magnet)) return;
          switch (o.kind) {
            case 'pick':
              if (Math.abs((o.y || .35) - (me.y + .45)) < .7 || magnet) { o.hit = true; picks += me.pass > 0 ? 2 : 1; pts += 10 * mult * (me.pass > 0 ? 2 : 1); ctx.sfx('collect'); }
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
                var bonus = 500 * mult; pts += bonus; mult = Math.min(8, mult + 1);
                ctx.sfx('cheer'); ctx.shake(3);
                banner = { text: words('stagerunner_delivered') + '  +' + bonus + '  ×' + mult, t: 2.2, good: true };
                ctx.quip('jokes_stagerunner_deliver', { mood: 'good', force: true });
                mission = null; nextMission = dist + 200 + Math.random() * 160;
              }
              break;
            case 'power':
              o.hit = true; ctx.sfx('powerup');
              if (o.power === 'headset') me.magnet = 10;
              if (o.power === 'case') me.onCase = 14;
              if (o.power === 'shoes') me.shoes = 10;
              if (o.power === 'pass') me.pass = 15;
              banner = { text: words('stagerunner_p_' + o.power).toUpperCase(), t: 1.6, good: true };
              ctx.quip('jokes_stagerunner_power', { mood: 'good', chance: .5 });
              break;
            case 'cable': case 'wet':
              if (me.y < .22 && me.onCase <= 0) { o.hit = true; stumble(o.kind); }
              break;
            case 'case': case 'stack': case 'cart':
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
        if (Math.random() < dt * 30) dust.push({ x: me.x + rnd(-.2, .2), z: -.2, y: 0, life: .5 });
        dust.forEach(function (d) { d.z -= move; d.y += dt * .4; d.life -= dt; });
        dust = dust.filter(function (d) { return d.life > 0; });

        ctx.score(Math.floor(dist) + pts);
      }

      /* ------------------------------------------------------ drawing */
      var ZC = {
        backstage: { sky: ['#0d0f16', '#1a1d28'], floor: ['#1d212b', '#252a35'], wall: '#161a24', trim: '#FFB547', light: 'rgba(255,220,170,' },
        stage: { sky: ['#050409', '#120b1d'], floor: ['#0b0b10', '#131218'], wall: null, trim: '#FF4FD8', light: 'rgba(155,123,255,' },
        dock: { sky: ['#0a1430', '#1f2f55'], floor: ['#262a30', '#2d3239'], wall: '#1b1f27', trim: '#FFD34A', light: 'rgba(255,240,200,' },
        arena: { sky: ['#07070d', '#141022'], floor: ['#121521', '#171b29'], wall: null, trim: '#2FD8FF', light: 'rgba(47,216,255,' }
      };
      function draw(g) {
        var Z = ZC[ZONES[zone]];
        var sky = g.createLinearGradient(0, 0, 0, HOR + 40);
        sky.addColorStop(0, Z.sky[0]); sky.addColorStop(1, Z.sky[1]);
        g.fillStyle = sky; g.fillRect(-20, -20, W + 40, H + 40);
        backdrop(g, Z);
        floor(g, Z);
        if (Z.wall) walls(g, Z);
        /* everything, far to near */
        var list = things.slice().sort(function (a, b) { return b.z - a.z; });
        var drewMe = false;
        list.forEach(function (o) {
          if (!drewMe && o.z < -.1) { runner(g); drewMe = true; }
          if (!o.hit || o.kind === 'door') thing(g, o);
        });
        if (!drewMe) runner(g);
        if (pm > 0 || (dead && stumbles)) chaser(g);
        dust.forEach(function (d) { var p = proj(d.x, d.y, d.z); if (p) { g.fillStyle = 'rgba(200,205,220,' + (d.life * .5) + ')'; g.fillRect(p.x, p.y, 2, 2); } });
        speedLines(g);
        hud(g);
        if (!started) {
          g.fillStyle = 'rgba(237,242,248,' + (.6 + .3 * Math.sin(time * 4)) + ')'; g.font = '600 12px Inter, sans-serif'; g.textAlign = 'center';
          g.fillText(words(ctx.touch ? 'stagerunner_hint_touch' : 'stagerunner_hint'), W / 2, H - 40);
        }
      }
      function backdrop(g, Z) {
        var t = time;
        if (ZONES[zone] === 'stage' || ZONES[zone] === 'arena') {
          /* moving lights through the haze */
          for (var i = 0; i < 5; i++) {
            var x = 40 + i * 70, a = Math.sin(t * .8 + i * 1.3) * .6;
            g.save(); g.translate(x, 30); g.rotate(a);
            var gr = g.createLinearGradient(0, 0, 0, 260);
            gr.addColorStop(0, Z.light + '.35)'); gr.addColorStop(1, Z.light + '0)');
            g.fillStyle = gr; g.beginPath(); g.moveTo(-4, 0); g.lineTo(4, 0); g.lineTo(40, 260); g.lineTo(-40, 260); g.closePath(); g.fill();
            g.restore();
          }
          if (ZONES[zone] === 'arena') {
            /* the crowd on the horizon, hands up on the beat */
            g.fillStyle = '#0a0a12';
            for (var c = 0; c < 40; c++) { var cx = c * 9.5, h = 10 + (c * 37 % 7) + Math.max(0, Math.sin(t * 6 + c)) * 6; g.fillRect(cx, HOR - h, 7, h); }
          }
        } else if (ZONES[zone] === 'dock') {
          g.fillStyle = 'rgba(255,255,255,.6)';
          for (var s = 0; s < 30; s++) g.fillRect((s * 97) % W, (s * 53) % (HOR - 20), 1, 1);
          g.fillStyle = '#10131a'; g.fillRect(0, HOR - 46, 120, 46); g.fillRect(240, HOR - 60, 120, 60);
          g.fillStyle = '#FFD34A'; g.fillRect(250, HOR - 52, 100, 4);
        } else {
          g.fillStyle = '#121620'; g.fillRect(0, 0, W, 60);
          for (var k = 0; k < 6; k++) { g.fillStyle = Z.light + (.25 + .1 * Math.sin(t * 3 + k)) + ')'; g.fillRect(20 + k * 60, 52, 30, 3); }
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
        /* lane lines, taped */
        g.strokeStyle = Z.trim; g.globalAlpha = .45; g.lineWidth = 1.5;
        [-.52, .52].forEach(function (x) { var p1 = proj(x, 0, 60), p2 = proj(x, 0, -2.5); if (p1 && p2) { g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); } });
        g.globalAlpha = 1;
      }
      function walls(g, Z) {
        var off = dist % 4;
        [-1, 1].forEach(function (side) {
          for (var z = 56; z > -3; z -= 4) {
            var zz = z - off, x = side * 1.75;
            var a = proj(x, 0, zz), b = proj(x, 2.3, zz), c = proj(x, 2.3, zz + 4), d = proj(x, 0, zz + 4);
            if (!a || !d) continue;
            g.fillStyle = Z.wall; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.lineTo(d.x, d.y); g.closePath(); g.fill();
            g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.stroke();
            /* a door now and then, and the cable tray along the top */
            if (Math.floor((z + dist) / 4) % 3 === 0) {
              var e = proj(x, 1.4, zz + 1.2), f = proj(x, 0, zz + 2.6);
              if (e && f) { g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(Math.min(e.x, f.x), e.y, Math.abs(f.x - e.x) || 1, f.y - e.y); }
            }
            var t1 = proj(x, 2.0, zz), t2 = proj(x, 2.0, zz + 4);
            if (t1 && t2) { g.strokeStyle = Z.trim; g.globalAlpha = .35; g.beginPath(); g.moveTo(t1.x, t1.y); g.lineTo(t2.x, t2.y); g.stroke(); g.globalAlpha = 1; }
          }
        });
      }
      function speedLines(g) {
        if (speed < 15) return;
        g.strokeStyle = 'rgba(255,255,255,' + ((speed - 15) / 30).toFixed(2) + ')'; g.lineWidth = 1;
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
      function thing(g, o) {
        var x = laneX(o.lane), p;
        switch (o.kind) {
          case 'case': {
            var f = box3(g, x, 0, .55, o.z, o.z + o.len, .42, '#1b2230', '#2a3346', '#121722');
            if (f) { roadcase(g, f, '#FFB547'); }
            break;
          }
          case 'stack': {
            var f1 = box3(g, x, 0, 1.0, o.z, o.z + o.len, .44, '#1b2230', '#2a3346', '#121722');
            if (f1) roadcase(g, f1, '#FF5A6E');
            var f2 = box3(g, x, 1.0, 2.0, o.z, o.z + o.len, .4, '#202839', '#2f3a50', '#141a26');
            if (f2) roadcase(g, f2, '#9B7BFF');
            break;
          }
          case 'truss': {
            var a = proj(x - .5, 1.05, o.z), b = proj(x + .5, .8, o.z);
            if (!a) break;
            g.fillStyle = '#59647a'; g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
            g.strokeStyle = '#8f99a8'; g.lineWidth = Math.max(1, a.k * .02);
            g.beginPath(); var n = 6;
            for (var i = 0; i < n; i++) { var x0 = a.x + (b.x - a.x) * i / n, x1 = a.x + (b.x - a.x) * (i + 1) / n; g.moveTo(x0, a.y); g.lineTo((x0 + x1) / 2, b.y); g.lineTo(x1, a.y); }
            g.stroke();
            /* the chain motors that hold it up */
            g.strokeStyle = '#3a4456'; g.beginPath(); g.moveTo(a.x + 2, a.y); g.lineTo(a.x + 2, 0); g.moveTo(b.x - 2, a.y); g.lineTo(b.x - 2, 0); g.stroke();
            g.fillStyle = '#FFB547'; g.fillRect(a.x, b.y - Math.max(2, a.k * .03), b.x - a.x, Math.max(2, a.k * .03));
            break;
          }
          case 'ramp': {
            var r0 = proj(x - .45, 0, o.z), r1 = proj(x + .45, 0, o.z), r2 = proj(x + .45, .72, o.z + o.len), r3 = proj(x - .45, .72, o.z + o.len);
            if (!r0 || !r3) break;
            g.fillStyle = '#3a3f4b'; g.beginPath(); g.moveTo(r0.x, r0.y); g.lineTo(r1.x, r1.y); g.lineTo(r2.x, r2.y); g.lineTo(r3.x, r3.y); g.closePath(); g.fill();
            g.strokeStyle = '#FFD34A'; g.lineWidth = 1; for (var s = 1; s < 5; s++) { var q0 = proj(x - .45, .72 * s / 5, o.z + o.len * s / 5), q1 = proj(x + .45, .72 * s / 5, o.z + o.len * s / 5); if (q0) { g.beginPath(); g.moveTo(q0.x, q0.y); g.lineTo(q1.x, q1.y); g.stroke(); } }
            break;
          }
          case 'riser': {
            var fr = box3(g, x, 0, .72, o.z, o.z + o.len, .46, '#141821', '#20242e', '#0e1118');
            if (fr) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(fr.x, fr.y + fr.h * .3, fr.w, Math.max(1, fr.h * .06)); g.fillStyle = '#5CF2C4'; g.fillRect(fr.x, fr.y, fr.w, Math.max(1, fr.k * .02)); }
            break;
          }
          case 'cart': {
            var fc = box3(g, x, .2, 1.3, o.z, o.z + o.len, .44, '#2a1c1c', '#3a2626', '#1d1414');
            if (fc) {
              g.fillStyle = '#FFD34A'; g.fillRect(fc.x + fc.w * .1, fc.y + fc.h * .15, fc.w * .8, fc.h * .1);
              g.fillStyle = Math.sin(time * 12) > 0 ? '#FF5A6E' : '#5a1e27'; g.fillRect(fc.x + fc.w * .42, fc.y - fc.h * .14, fc.w * .16, fc.h * .1);
              var w0 = proj(x - .35, .1, o.z), w1 = proj(x + .35, .1, o.z);
              if (w0) { g.fillStyle = '#05070b'; g.beginPath(); g.arc(w0.x, w0.y, w0.k * .1, 0, 7); g.arc(w1.x, w1.y, w1.k * .1, 0, 7); g.fill(); }
              /* its headlights, coming at you */
              g.fillStyle = 'rgba(255,240,200,.85)'; g.fillRect(fc.x + fc.w * .08, fc.y + fc.h * .55, fc.w * .14, fc.h * .1); g.fillRect(fc.x + fc.w * .78, fc.y + fc.h * .55, fc.w * .14, fc.h * .1);
            }
            break;
          }
          case 'cable': {
            p = proj(x, .02, o.z); if (!p) break;
            g.strokeStyle = '#05070b'; g.lineWidth = Math.max(1.5, p.k * .06);
            g.beginPath(); for (var c = -.45; c <= .45; c += .05) { var q = proj(x + c, .03 + Math.sin(c * 20) * .02, o.z + Math.sin(c * 9) * .1); if (q) (c === -.45 ? g.moveTo(q.x, q.y) : g.lineTo(q.x, q.y)); } g.stroke();
            g.strokeStyle = '#FFB547'; g.lineWidth = Math.max(1, p.k * .025); g.stroke();
            break;
          }
          case 'wet': {
            p = proj(x, 0, o.z); if (!p) break;
            g.fillStyle = 'rgba(120,170,255,.25)'; g.beginPath(); g.ellipse(p.x, p.y, p.k * .4, p.k * .08, 0, 0, 7); g.fill();
            /* the yellow sign */
            g.fillStyle = '#FFD34A'; g.beginPath(); g.moveTo(p.x + p.k * .2, p.y); g.lineTo(p.x + p.k * .28, p.y - p.k * .45); g.lineTo(p.x + p.k * .36, p.y); g.closePath(); g.fill();
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
            g.fillStyle = 'rgba(92,242,196,.25)'; g.beginPath(); g.arc(p.x, p.y, p.k * .32, 0, 7); g.fill();
            icon(g, o.item, p.x, p.y, p.k * .28);
            var beam = proj(x, 3, o.z); if (beam) { g.fillStyle = 'rgba(92,242,196,.12)'; g.fillRect(p.x - p.k * .05, beam.y, p.k * .1, p.y - beam.y); }
            break;
          }
          case 'power': {
            p = proj(x, .55 + Math.sin(time * 4) * .06, o.z); if (!p) break;
            g.fillStyle = 'rgba(155,123,255,.3)'; g.beginPath(); g.arc(p.x, p.y, p.k * .3, 0, 7); g.fill();
            g.strokeStyle = '#9B7BFF'; g.lineWidth = Math.max(1.5, p.k * .03); g.stroke();
            g.fillStyle = '#fff'; g.font = '700 ' + Math.max(8, p.k * .26) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText({ headset: 'Ω', case: '▭', shoes: '⇑', pass: '★' }[o.power], p.x, p.y + 1);
            break;
          }
          case 'door': {
            var d0 = proj(-1.6, 2.1, o.z), d1 = proj(1.6, 0, o.z);
            if (!d0) break;
            var on = mission && mission.have;
            g.strokeStyle = on ? '#5CF2C4' : '#3a4456'; g.lineWidth = Math.max(2, d0.k * .06);
            g.strokeRect(d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
            g.fillStyle = on ? 'rgba(92,242,196,.12)' : 'rgba(255,255,255,.03)'; g.fillRect(d0.x, d0.y, d1.x - d0.x, d1.y - d0.y);
            g.fillStyle = on ? '#5CF2C4' : '#8A96A6'; g.font = '700 ' + Math.max(7, d0.k * .2) + 'px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
            g.fillText(words('stagerunner_greenroom').toUpperCase(), (d0.x + d1.x) / 2, d0.y + d0.k * .08);
            break;
          }
        }
      }
      function roadcase(g, f, tape) {
        var k = f.k;
        g.strokeStyle = '#8f99a8'; g.lineWidth = Math.max(1, k * .02); g.strokeRect(f.x + 1, f.y + 1, f.w - 2, f.h - 2);
        var c = Math.max(2, k * .07); g.fillStyle = '#c9d1dc';
        [[f.x, f.y], [f.x + f.w - c, f.y], [f.x, f.y + f.h - c], [f.x + f.w - c, f.y + f.h - c]].forEach(function (q) { g.fillRect(q[0], q[1], c, c); });
        g.fillStyle = tape; g.fillRect(f.x + f.w * .15, f.y + f.h * .2, f.w * .3, Math.max(1, f.h * .08));
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
        g.restore();
      }

      /* ---- the stage manager ---- */
      function runner(g) {
        var p = proj(me.x, me.y, 0);
        if (!p) return;
        var k = p.k, sliding = me.slide > 0, air = me.y > me.ground + .05;
        var sw = Math.sin(me.run) * (air ? .3 : 1), h = sliding ? .42 : .95;
        /* shadow */
        var sp = proj(me.x, me.ground, 0);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(sp.x, sp.y, k * .22, k * .06, 0, 0, 7); g.fill();
        if (me.onCase > 0) { g.fillStyle = '#1b2230'; g.fillRect(p.x - k * .3, p.y - k * .12, k * .6, k * .12); g.fillStyle = '#FFB547'; g.fillRect(p.x - k * .3, p.y - k * .04, k * .6, k * .03); }
        g.save(); g.translate(p.x, p.y - (me.onCase > 0 ? k * .12 : 0)); g.rotate(me.lean * .12 + (sliding ? -.0 : 0));
        var u = k / 100;
        g.lineCap = 'round';
        if (sliding) {
          /* sliding: low, legs out front */
          g.strokeStyle = '#1c2330'; g.lineWidth = 9 * u;
          g.beginPath(); g.moveTo(-6 * u, -10 * u); g.lineTo(-30 * u, -6 * u); g.stroke();
          g.fillStyle = '#151a24'; g.fillRect(-4 * u, -34 * u, 26 * u, 22 * u);
          head(g, 22 * u, -38 * u, u);
        } else {
          /* legs */
          g.strokeStyle = '#1c2330'; g.lineWidth = 9 * u;
          g.beginPath(); g.moveTo(-5 * u, -48 * u); g.lineTo(-5 * u + sw * 12 * u, -2 * u - Math.max(0, sw) * 10 * u);
          g.moveTo(5 * u, -48 * u); g.lineTo(5 * u - sw * 12 * u, -2 * u - Math.max(0, -sw) * 10 * u); g.stroke();
          /* body: blacks, lanyard */
          g.fillStyle = '#151a24'; roundRect(g, -13 * u, -88 * u, 26 * u, 42 * u, 6 * u); g.fill();
          g.strokeStyle = '#FF5A6E'; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(-6 * u, -86 * u); g.lineTo(0, -66 * u); g.lineTo(6 * u, -86 * u); g.stroke();
          g.fillStyle = '#EDF2F8'; g.fillRect(-4 * u, -66 * u, 8 * u, 10 * u);
          /* arms, pumping; a clipboard in one hand */
          g.strokeStyle = '#e2b48f'; g.lineWidth = 6 * u;
          g.beginPath(); g.moveTo(-12 * u, -82 * u); g.lineTo(-16 * u - sw * 8 * u, -58 * u); g.moveTo(12 * u, -82 * u); g.lineTo(16 * u + sw * 8 * u, -58 * u); g.stroke();
          g.fillStyle = '#c9a26b'; g.fillRect(14 * u + sw * 8 * u, -66 * u, 10 * u, 13 * u);
          g.fillStyle = '#EDF2F8'; g.fillRect(15.5 * u + sw * 8 * u, -63 * u, 7 * u, 9 * u);
          head(g, 0, -100 * u, u);
        }
        g.restore();
        if (me.magnet > 0) { g.strokeStyle = 'rgba(155,123,255,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y - k * .55, k * .45 + Math.sin(time * 10) * 3, 0, 7); g.stroke(); }
      }
      function head(g, x, y, u) {
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(x, y, 11 * u, 0, 7); g.fill();
        g.fillStyle = '#2a1d16'; g.beginPath(); g.arc(x, y - 3 * u, 11 * u, Math.PI * 1.05, Math.PI * 1.95); g.fill();
        /* the headset: band, cup, boom mic */
        g.strokeStyle = '#2FD8FF'; g.lineWidth = 2.5 * u; g.beginPath(); g.arc(x, y, 13 * u, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        g.fillStyle = '#10131a'; g.fillRect(x + 9 * u, y - 4 * u, 5 * u, 8 * u);
        g.strokeStyle = '#10131a'; g.lineWidth = 1.6 * u; g.beginPath(); g.moveTo(x + 12 * u, y + 2 * u); g.lineTo(x + 4 * u, y + 9 * u); g.stroke();
      }
      /* the PM, clipboard up, right behind you */
      function chaser(g) {
        var p = proj(me.x + Math.sin(time * 3) * .2, 0, -1.2 + Math.max(0, pm - 4) * .5);
        if (!p) return;
        var u = p.k / 100, sw = Math.sin(time * 14);
        g.save(); g.translate(p.x - 60 * u, p.y);
        g.strokeStyle = '#2a3346'; g.lineWidth = 9 * u;
        g.beginPath(); g.moveTo(-5 * u, -48 * u); g.lineTo(-5 * u + sw * 10 * u, 0); g.moveTo(5 * u, -48 * u); g.lineTo(5 * u - sw * 10 * u, 0); g.stroke();
        g.fillStyle = '#39445a'; roundRect(g, -13 * u, -88 * u, 26 * u, 42 * u, 6 * u); g.fill();
        g.fillStyle = '#c9a26b'; g.fillRect(-26 * u, -112 * u, 14 * u, 18 * u);
        g.strokeStyle = '#e2b48f'; g.lineWidth = 6 * u; g.beginPath(); g.moveTo(-12 * u, -82 * u); g.lineTo(-20 * u, -98 * u); g.stroke();
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(0, -100 * u, 11 * u, 0, 7); g.fill();
        g.fillStyle = '#10131a'; g.font = '700 ' + 12 * u + 'px Sora, sans-serif'; g.textAlign = 'center'; g.fillText('PM', 0, -60 * u);
        g.restore();
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
        g.fillStyle = 'rgba(138,150,166,.95)';
        g.fillText(Math.floor(dist) + ' M', 12, 50);
        g.fillStyle = '#FFB547'; g.fillText('◆ ' + picks, 12, 64);
        g.textAlign = 'right'; g.fillStyle = mult > 1 ? '#5CF2C4' : 'rgba(138,150,166,.95)'; g.font = '700 15px Sora, sans-serif';
        g.fillText('×' + mult, W - 12, 48);
        /* the errand: what, and the patience left */
        if (mission) {
          var bx = W - 132, by = 72;
          g.fillStyle = 'rgba(8,10,16,.85)'; g.fillRect(bx, by, 120, 34);
          g.strokeStyle = mission.have ? '#5CF2C4' : '#FFB547'; g.lineWidth = 1; g.strokeRect(bx + .5, by + .5, 119, 33);
          icon(g, mission.item, bx + 16, by + 17, 9);
          g.fillStyle = '#EDF2F8'; g.font = '600 9px Inter, sans-serif'; g.textAlign = 'left';
          g.fillText(words(mission.have ? 'stagerunner_deliver' : 'stagerunner_item_' + mission.item).toUpperCase().slice(0, 18), bx + 30, by + 6);
          var left = clamp(mission.patience / 38, 0, 1);
          g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(bx + 30, by + 21, 82, 5);
          g.fillStyle = left > .5 ? '#5CF2C4' : left > .25 ? '#FFB547' : '#FF5A6E'; g.fillRect(bx + 30, by + 21, 82 * left, 5);
        }
        /* powers running */
        var px = 12;
        [['magnet', 'Ω', 10], ['onCase', '▭', 14], ['shoes', '⇑', 10], ['pass', '★', 15]].forEach(function (pw) {
          if (me[pw[0]] <= 0) return;
          g.fillStyle = '#9B7BFF'; g.font = '700 12px Sora, sans-serif'; g.textAlign = 'left'; g.fillText(pw[1], px, 82);
          g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(px, 98, 22, 3); g.fillStyle = '#9B7BFF'; g.fillRect(px, 98, 22 * me[pw[0]] / pw[2], 3);
          px += 30;
        });
        if (banner) {
          g.globalAlpha = Math.min(1, banner.t * 2);
          g.font = '700 20px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = banner.good ? '#5CF2C4' : '#FF5A6E'; g.shadowColor = g.fillStyle; g.shadowBlur = 16;
          g.fillText(banner.text, W / 2, HOR - 70); g.shadowBlur = 0; g.globalAlpha = 1;
        }
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
