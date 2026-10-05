/* =====================================================================
   Golden Hour — down the festival hills on a road case lid
   =====================================================================
   Chase, 2026-10-04: "For Alto's Adventure.... I just liked that game, so
   having something like it could be fun! So get creative with this too …
   There are a lot of elements that make this game unique to play."
   And 2026-10-05: "it looks like someone on a snowboard, but you said it
   was a case. Animate the person, make it clear what is happening. Make
   the obstacles on the ground easier to see since they currently blend in
   with the environment. Give some power ups similar to Altos. Take your
   time and make it pretty."

   WHAT MAKES ALTO ALTO, kept: one button; momentum you can feel on every
   slope; backflips that carry speed into the landing; grinds; a world that
   goes quietly from sunset to night and back while you ride; and things
   that have got loose, to chase.

   THE THAUMA OF IT: you are crew at an outdoor festival. Load-in is done;
   at the top of the hill you pull the LID off a road case — ball corners,
   aluminium edge, the handle — throw it down and ride it between the
   stages. The opening shows exactly that, so nobody mistakes it for a
   snowboard. You grind the cable runs (bunting hangs from them), jump the
   gaps between stages and the cases somebody left on the hill (each one
   taped and lit so it reads against any sky), launch off case-lid ramps,
   and chase the beach balls that escaped the crowd.

   THE RIDER is animated, not posed: a push-off, a crouch that deepens
   with speed, arms that balance, a pop with arms up, a tuck when flipping,
   a grab on a long air, a squash on landing, arms wide on a grind, and on a
   crash the rider and the lid part ways.

   TAP to jump. HOLD in the air to flip backwards; let go to stop turning.
   Land with the lid along the slope or it's over.

   POWERS, Alto's four in festival form:
     HEADLAMP   (the coin magnet) glow sticks come to you
     HARD HAT   (the helmet) one fall forgiven
     BALLOONS   (the hover feather) holding in the air floats you — so a
                jump holds more flips
     BANNER     (the wingsuit) the festival banner as a wing: hold to
                climb, let go to glide; the landing is always clean

   THE PACE (round 3): the top speed starts at 470 and grows to 620 over
   the first 3 km; the first cases come after 250 m, ramps after 120 m,
   gaps after 700 m; features come further apart, and closer slowly.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 600, H = 400;
  var G = 980, STEP = 16, MIN = 170;
  var POWER_T = { magnet: 12, balloon: 12, banner: 8 };

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function mix(c1, c2, t) {
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    var r = Math.round(lerp(a >> 16, b >> 16, t)), g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t)), bl = Math.round(lerp(a & 255, b & 255, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  /* The sky through one evening: golden hour, dusk, night, dawn, day. */
  var SKY = [
    { top: '#3b2a5c', mid: '#e5735a', low: '#ffc27a', hill: '#3a1f33', far: '#6b3b5a', sun: '#fff1c9', edge: '#f2b48a' },
    { top: '#1c1838', mid: '#7a3b6a', low: '#d9705c', hill: '#26152a', far: '#47284a', sun: '#ffd9a8', edge: '#b9707a' },
    { top: '#05060f', mid: '#10142c', low: '#1d1f3f', hill: '#0b0c18', far: '#151832', sun: '#e8eeff', edge: '#4b5687' },
    { top: '#1a2340', mid: '#4f5f8a', low: '#e8a98a', hill: '#202439', far: '#3c4566', sun: '#fff1c9', edge: '#c9a2a2' },
    { top: '#3d7cc9', mid: '#8fc0e8', low: '#f2e6c8', hill: '#3b5a48', far: '#6f8fa0', sun: '#fffbe8', edge: '#e9f0d8' }
  ];
  /* the rider's colors: a hi-vis crew jacket reads against every sky */
  var JACKET = '#FFB547', PANTS = '#1b2030', SKIN = '#e2b48f', BEANIE = '#FF5A6E', SCARF = '#2FD8FF';

  A.games.goldenhour = {
    size: { w: W, h: H },
    controls: 'tap',
    speaker: 'LX',
    create: function (ctx) {
      var words = ctx.words;
      /* ---- the world ---- */
      var ground = [];                       /* { x, y } every STEP px; null y = a gap */
      var rails = [], cases = [], ramps = [], sticks = [], balls = [], powers = [], fireworks = [], sparks = [], dust = [], snow = [], clouds = [];
      var genX = 0, genY = 200, slope = .26, nextFeature = 700, made = 0;
      var me = { x: 160, y: 0, vx: MIN, vy: 0, ang: 0, ground: true, rail: null, spin: 0, flips: 0, air: 0, crashed: false };
      var body = null;                       /* the rider, once a crash parts them from the lid */
      var pose = { c: .3, tuck: 0, lean: .2, aL: -.5, aR: .8, eL: .3, eR: -.2, lift: 0 };
      var score = 0, glow = 0, dist = 0, combo = 0, comboT = 0, time = 0, sky = 0, landT = 0;
      var hat = 0, active = null, activeT = 0, holding = false, started = false, intro = -1, camX = 0, camY = 0, banner = null;
      var caseAt = 0;                        /* where the opened case stands, at the top */

      function maxSpeed() { return 470 + Math.min(150, dist / 20); }
      function heightAt(x) {
        var i = Math.floor(x / STEP);
        var a = ground[i], b = ground[i + 1];
        if (!a || !b || a.y === null || b.y === null) return null;
        return lerp(a.y, b.y, (x - a.x) / STEP);
      }
      /* the ground you ride: the hill, raised where a ramp leans on it */
      function groundAt(x) {
        var h = heightAt(x); if (h === null) return null;
        for (var i = 0; i < ramps.length; i++) { var r = ramps[i]; if (x >= r.x && x <= r.x + r.len) return h - (x - r.x) / r.len * r.h; }
        return h;
      }
      function slopeAt(x) {
        var y1 = groundAt(x - 6), y2 = groundAt(x + 6);
        return y1 === null || y2 === null ? 0 : Math.atan2(y2 - y1, 12);
      }
      function generate(until) {
        while (genX < until) {
          /* the hills: a falling line with swells in it */
          slope = clamp(slope + rnd(-.03, .03), .12, .46);
          var swell = Math.sin(genX * .006) * 30 + Math.sin(genX * .017) * 10;
          genY += slope * STEP;
          var y = genY + swell, i = Math.round(genX / STEP);
          if (genX > nextFeature) feature();
          ground[i] = { x: genX, y: ground[i] && ground[i].y === null ? null : y };
          if (genX > 500 && Math.random() < .05) sticks.push({ x: genX, y: y - 30 - rnd(0, 40) });
          genX += STEP;
        }
      }
      /* now and then: a gap between stages, a cable run to grind, a case
         on the hill, a ramp, a beach ball loose, a power */
      function feature() {
        var d = genX / 10, r = Math.random(), x0 = genX + 120;
        made++;
        if (d > 300 && made % 4 === 0) {
          var kinds = ['magnet', 'hat', 'balloon', 'banner'];
          powers.push({ x: x0, y: null, kind: kinds[Math.floor(Math.random() * kinds.length)] });
        } else if (r < .24 && d > 700) {
          /* the gap: a stage on each side, nothing between */
          var len = rnd(60, 110) + Math.min(70, d / 80);
          for (var gx = x0; gx < x0 + len; gx += STEP) ground[Math.round(gx / STEP)] = { x: gx, y: null };
          cases.push({ x: x0 - 4, kind: 'stage', side: -1 }); cases.push({ x: x0 + len + 4, kind: 'stage', side: 1 });
          arc(x0, genY - 40, len);
        } else if (r < .5) {
          /* a cable run strung between two truss towers: grind it */
          var rl = rnd(170, 300), lift = rnd(28, 48);
          rails.push({ x0: x0, x1: x0 + rl, y0: null, lift: lift, slope: slope * .8 });
        } else if (r < .72 && d > 250) {
          cases.push({ x: x0, kind: 'case' });
        } else if (r < .86 && d > 120) {
          ramps.push({ x: x0, len: 64, h: 24 });
          arc(x0 + 120, genY - 70, 160);
        } else {
          balls.push({ x: x0 + 200, y: 0, vy: 0, caught: false });
        }
        nextFeature = genX + rnd(560, 900) - Math.min(240, d / 40);
      }
      function arc(x0, y0, len) { for (var i = 0; i < 5; i++) sticks.push({ x: x0 + len * (i + .5) / 5, y: y0 - Math.sin((i + .5) / 5 * Math.PI) * 60 }); }
      function railY(r, x) {
        if (r.y0 === null) { var h = heightAt(r.x0); if (h === null) return null; r.y0 = h - r.lift; }
        return r.y0 + (x - r.x0) * r.slope;
      }

      generate(1600);
      me.y = groundAt(me.x) || 200; me.ang = slopeAt(me.x);
      caseAt = me.x - 34;
      camX = me.x - W * .32; camY = me.y - H * .56;
      for (var s = 0; s < 40; s++) snow.push({ x: rnd(0, W), y: rnd(0, H), v: rnd(10, 30) });
      for (var c = 0; c < 7; c++) clouds.push({ x: rnd(0, W * 3), y: rnd(30, 150), w: rnd(60, 140), k: rnd(.03, .08) });

      /* ------------------------------------------------------ input */
      function press() {
        if (!started) { if (intro < 0) { intro = 0; ctx.sfx('flip'); } return; }
        holding = true;
        if (me.crashed) return;
        if (me.ground || me.rail) {
          var lift = me.rail ? 420 : 470;
          var a = me.rail ? Math.atan(me.rail.slope) : slopeAt(me.x);
          me.vy = Math.sin(a) * me.vx / Math.max(.3, Math.cos(a)) - lift;
          me.ground = false; me.rail = null; me.spin = 0; me.air = 0;
          ctx.sfx('jump');
        }
      }
      function release() { holding = false; }

      /* ------------------------------------------------------ update */
      function update(dt) {
        time += dt;
        sky = (sky + dt / 50) % SKY.length;            /* a whole evening every few minutes */
        generate(me.x + 1600);
        dust.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 20 * dt; p.life -= dt; }); dust = dust.filter(function (p) { return p.life > 0; });
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }); sparks = sparks.filter(function (p) { return p.life > 0; });
        if (!started) {
          /* the opening: the lid comes off the case, lands on the slope, and the rider hops on */
          if (intro >= 0) {
            intro += dt;
            if (intro > .62 && intro - dt <= .62) { ctx.sfx('thud', { vol: .3 }); puff(me.x, me.y, 8); }
            if (intro >= 1.15) { started = true; me.vx = MIN; ctx.sfx('jump'); puff(me.x, me.y, 6); }
          }
          return;
        }
        if (me.crashed) { crashed(dt); return; }

        var steps = 3, h = dt / steps;
        for (var k = 0; k < steps; k++) stepMe(h);
        dist = Math.max(0, me.x - 160) / 10;
        if (comboT > 0) { comboT -= dt; if (comboT <= 0 && combo > 1) combo = 0; }
        if (landT > 0) landT -= dt;
        if (active) { activeT -= dt; if (activeT <= 0) active = null; }
        /* the lid kicks up a little spray as it rides */
        if (me.ground && Math.random() < dt * (me.vx / 14)) dust.push({ x: me.x - 14, y: me.y - 2, vx: -me.vx * .2 + rnd(-20, 20), vy: rnd(-40, -10), life: rnd(.3, .6), r: rnd(1.5, 3) });

        /* glow sticks, balls, powers */
        sticks = sticks.filter(function (s) {
          if (s.x < me.x - 400) return false;
          var dx = me.x - s.x, dy = (me.y - 16) - s.y, d = Math.hypot(dx, dy);
          if (active === 'magnet' && d < 230) { s.x += dx * dt * 5; s.y += dy * dt * 5; }
          if (d < 22) { glow++; score += 5; ctx.sfx('collect'); return false; }
          return true;
        });
        balls.forEach(function (b) {
          if (b.caught) return;
          /* bouncing on downhill, ahead of you, a little slower than you */
          b.x += (me.vx * .78) * dt; var gy2 = heightAt(b.x);
          b.vy += G * .6 * dt; b.y += b.vy * dt;
          if (gy2 !== null && b.y > gy2 - 10) { b.y = gy2 - 10; b.vy = -rnd(260, 380); }
          if (Math.hypot(b.x - me.x, b.y - (me.y - 14)) < 26) {
            b.caught = true; score += 150; ctx.sfx('cheer');
            banner = { text: words('goldenhour_ball'), t: 1.6 };
            ctx.quip('jokes_goldenhour_ball', { mood: 'good', chance: .7 });
          }
        });
        balls = balls.filter(function (b) { return !b.caught && b.x > me.x - 500; });
        powers = powers.filter(function (p) {
          if (p.y === null) { var py = heightAt(p.x); p.y = py === null ? 0 : py - 44; }
          if (Math.hypot(p.x - me.x, p.y - (me.y - 16)) < 28) {
            if (p.kind === 'hat') hat = 1; else { active = p.kind; activeT = POWER_T[p.kind]; }
            ctx.sfx('powerup');
            banner = { text: words('goldenhour_p_' + p.kind).toUpperCase(), sub: p.kind === 'balloon' || p.kind === 'banner' ? words('goldenhour_p_' + p.kind + '_how') : '', t: 2.2 };
            if (p.kind === 'banner') ctx.quip('jokes_goldenhour_banner', { chance: .7 });
            return false;
          }
          return p.x > me.x - 400;
        });
        /* the night's fireworks */
        if (Math.floor(sky) === 2 && Math.random() < dt * .7) fireworks.push({ x: me.x + rnd(100, 700), y: me.y - rnd(180, 300), t: 0, hue: Math.floor(rnd(0, 360)) });
        fireworks.forEach(function (f) { f.t += dt; }); fireworks = fireworks.filter(function (f) { return f.t < 1.6; });
        if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

        ctx.score(Math.floor(dist) + score);
        /* the camera leads you downhill */
        var tx = me.x - W * .32, ty = me.y - H * .56;
        camX += (tx - camX) * Math.min(1, dt * 6); camY += (ty - camY) * Math.min(1, dt * 3);
        cases = cases.filter(function (c) { return c.x > me.x - 400; });
        rails = rails.filter(function (r) { return r.x1 > me.x - 400; });
        ramps = ramps.filter(function (r) { return r.x + r.len > me.x - 400; });
        var cut = Math.floor((me.x - 800) / STEP); for (var i = 0; i < cut; i++) if (ground[i]) ground[i] = undefined;
        posture(dt);
      }

      function stepMe(dt) {
        var top = maxSpeed();
        if (me.rail) {
          /* grinding: along the cable, sparks, points */
          var r = me.rail;
          me.vx = clamp(me.vx + 120 * dt, MIN, top);
          me.x += me.vx * dt; me.y = railY(r, me.x); me.ang = Math.atan(r.slope);
          score += 40 * dt; comboT = 1.2;
          if (Math.random() < dt * 40) sparks.push({ x: me.x - 8, y: me.y, vx: rnd(-160, -40), vy: rnd(-120, 0), life: .35 });
          if (Math.random() < dt * 10) ctx.sfx('grind');
          if (me.x > r.x1) { me.rail = null; me.ground = false; me.vy = me.vx * r.slope - 60; me.spin = 0; me.air = 0; }
          return;
        }
        if (me.ground) {
          var a = slopeAt(me.x);
          /* downhill gathers speed; uphill and the snow slow it */
          me.vx = clamp(me.vx + (Math.sin(a) * G * .55 - me.vx * .08) * dt, MIN, top);
          var nx = me.x + me.vx * Math.cos(a) * dt;
          var ny = groundAt(nx);
          if (ny === null) { me.ground = false; me.vy = me.vx * Math.sin(a); me.spin = 0; me.air = 0; me.x = nx; return; }
          /* off the end of a ramp: launched */
          for (var k = 0; k < ramps.length; k++) {
            var rp = ramps[k];
            if (me.x <= rp.x + rp.len && nx > rp.x + rp.len) {
              me.ground = false; me.vy = Math.min(-240, me.vx * Math.sin(a) - 120); me.spin = 0; me.air = 0; me.x = nx;
              ctx.sfx('jump'); return;
            }
          }
          /* over a crest faster than the ground falls away: airborne */
          var fall = ny - me.y, ballistic = me.vx * Math.sin(a) * dt + G * dt * dt;
          if (fall > ballistic + 1.5 && me.vx > 260) { me.ground = false; me.vy = me.vx * Math.sin(a); me.spin = 0; me.air = 0; me.x = nx; return; }
          me.x = nx; me.y = ny; me.ang += wrap(a - me.ang) * Math.min(1, dt * 18);
          hitCases();
          return;
        }
        /* in the air */
        me.air += dt;
        var grav = active === 'banner' ? G * .3 : G;
        me.vy += grav * dt;
        if (active === 'banner' && holding) me.vy -= 900 * dt;                  /* the banner climbs */
        if (active === 'banner') { me.vy = clamp(me.vy, -260, 220); me.vx = Math.max(me.vx, 300); }
        if (active === 'balloon' && holding && me.vy > 50) me.vy = 50;           /* the balloons float you */
        me.x += me.vx * dt; me.y += me.vy * dt;
        var turn = holding && active !== 'banner' ? -6.4 : 0;
        if (active === 'banner') me.ang += wrap(-.15 - me.ang) * Math.min(1, dt * 6);
        me.ang += turn * dt; me.spin += turn * dt;
        hitCases();
        /* a cable underneath: land on it to grind */
        for (var i = 0; i < rails.length; i++) {
          var r2 = rails[i];
          if (me.x < r2.x0 || me.x > r2.x1 || me.vy < 0) continue;
          var ry = railY(r2, me.x);
          if (ry !== null && me.y >= ry && me.y - me.vy * dt <= ry + 4) {
            /* a cable only catches a rider who is upright; mid-flip, you go past it */
            if (Math.abs(wrap(me.ang - Math.atan(r2.slope))) > .75) continue;
            me.rail = r2; me.y = ry; landed(true); return;
          }
        }
        var gy = groundAt(me.x);
        if (gy === null) { if (me.y > camY + H + 140) crash(true); return; }
        if (me.y >= gy) {
          var ga = slopeAt(me.x);
          /* the banner always sets you down clean */
          if (active !== 'banner' && Math.abs(wrap(me.ang - ga)) > .72) return crash();
          me.y = gy; me.ground = true; me.ang = ga; landed(false);
        }
      }
      function landed(onRail) {
        var flips = Math.floor(Math.abs(me.spin) / (Math.PI * 2) + .2);
        if (flips > 0) {
          combo += flips; comboT = 1.6;
          var pts = 100 * flips * Math.max(1, combo);
          score += pts;
          me.vx = Math.min(maxSpeed(), me.vx + 50 * flips);
          banner = { text: (flips > 1 ? flips + '× ' : '') + words('goldenhour_flip') + '  +' + pts, t: 1.2 };
          ctx.sfx('combo');
          if (combo >= 3) ctx.quip('jokes_goldenhour_trick', { mood: 'good', chance: .5 });
        } else if (me.air > .9) { score += 30; }
        if (onRail) { combo = Math.max(1, combo); ctx.sfx('grind'); }
        else { ctx.sfx('thud', { vol: .3 }); landT = .22; puff(me.x, me.y, Math.min(12, 4 + me.air * 6)); }
        me.spin = 0; me.air = 0;
      }
      function puff(x, y, n) { for (var i = 0; i < n; i++) dust.push({ x: x + rnd(-10, 10), y: y - 2, vx: rnd(-70, 70), vy: rnd(-70, -15), life: rnd(.3, .7), r: rnd(1.5, 3.5) }); }
      function hitCases() {
        for (var i = 0; i < cases.length; i++) {
          var c = cases[i];
          if (c.kind !== 'case' || Math.abs(me.x - c.x) > 18) continue;
          var cy = heightAt(c.x);
          if (cy !== null && me.y > cy - 26) return crash();
        }
      }
      function crash(fell) {
        if (me.crashed) return;
        if (hat && !fell) {
          hat = 0; ctx.sfx('break'); banner = { text: words('goldenhour_p_hat_used').toUpperCase(), t: 1.4 };
          me.ang = slopeAt(me.x); me.spin = 0; me.vy = -260; me.ground = false;
          cases = cases.filter(function (c) { return Math.abs(c.x - me.x) > 60; });
          return;
        }
        me.crashed = true; ctx.sfx('crash'); ctx.shake(6);
        /* the rider and the lid part ways */
        body = { x: me.x, y: me.y - 14, vx: me.vx * .55, vy: Math.min(-160, me.vy - 120), rot: me.ang, vr: 7 + rnd(0, 4) };
        puff(me.x, me.y, 14);
        ctx.quip('jokes_goldenhour_crash', { mood: 'bad', force: true });
        setTimeout(function () { ctx.over(); }, 1700);
      }
      function crashed(dt) {
        /* the lid slides on */
        me.vx *= Math.pow(.35, dt); me.vy += G * dt; me.x += me.vx * dt; me.y += me.vy * dt;
        var gy = groundAt(me.x); if (gy !== null && me.y > gy) { me.y = gy; me.vy = 0; me.ang += wrap(slopeAt(me.x) - me.ang) * Math.min(1, dt * 10); }
        /* the rider tumbles, bouncing, and comes to rest */
        if (body) {
          body.vy += G * dt; body.x += body.vx * dt; body.y += body.vy * dt; body.rot += body.vr * dt;
          var by = groundAt(body.x);
          if (by !== null && body.y > by - 6) { body.y = by - 6; body.vy = -Math.abs(body.vy) * .35; body.vx *= .7; body.vr *= .6; if (Math.abs(body.vy) > 60) puff(body.x, by, 4); }
        }
        var fx = body ? body.x : me.x, fy = body ? body.y : me.y;
        camX += (fx - W * .4 - camX) * Math.min(1, dt * 4); camY += (fy - H * .56 - camY) * Math.min(1, dt * 3);
      }

      /* The rider's body follows what is happening, smoothly. */
      function posture(dt) {
        var T = { c: .3, tuck: 0, lean: .2, aL: -.6, aR: .9, eL: .3, eR: -.3, lift: 0 };
        var sp = clamp((me.vx - MIN) / 450, 0, 1), sway = Math.sin(time * 3) * .15;
        if (me.rail) {
          T.c = .45; T.lean = .12; T.aL = -1.55 + Math.sin(time * 9) * .2; T.aR = 1.6 - Math.sin(time * 9) * .2; T.eL = .1; T.eR = -.1;
        } else if (me.ground) {
          T.c = .3 + sp * .45; T.lean = .2 + sp * .25; T.aL = -.6 + sway; T.aR = .9 + sway; T.eL = .4; T.eR = -.4;
          if (landT > 0) { T.c = 1; T.aL = .8; T.aR = 1.1; T.lean = .5; }
        } else if (active === 'banner') {
          T.c = .2; T.lean = .55; T.aL = 2.9; T.aR = 2.7; T.eL = 0; T.eR = 0;
        } else if (me.air < .14) {
          T.c = 0; T.lean = 0; T.aL = 2.5; T.aR = 2.3; T.eL = .2; T.eR = -.2;        /* the pop */
        } else if (holding) {
          T.c = .9; T.tuck = 1; T.lean = .9; T.aL = .7; T.aR = .5; T.eL = 1.6; T.eR = 1.4;   /* tucked, hugging the knees */
          if (active === 'balloon') { T.aL = 3; T.eL = 0; }
        } else if (me.air > .55) {
          T.c = .75; T.lean = .55; T.aL = -1.1; T.aR = 1.15; T.eR = 1.7;              /* a grab on the lid's edge */
        } else {
          T.c = .4; T.lean = .2; T.aL = -1.3 + Math.sin(time * 7) * .2; T.aR = 1.5; T.eL = .5; T.eR = -.5;
        }
        if (active === 'balloon' && !holding && !me.ground) T.aL = 3;
        var k = Math.min(1, dt * 14);
        for (var key in T) pose[key] += (T[key] - pose[key]) * k;
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        var i0 = Math.floor(sky), f = sky - i0, A1 = SKY[i0], B1 = SKY[(i0 + 1) % SKY.length];
        var col = function (k) { return mix(A1[k], B1[k], f); };
        var gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, col('top')); gr.addColorStop(.55, col('mid')); gr.addColorStop(1, col('low'));
        g.fillStyle = gr; g.fillRect(-20, -20, W + 40, H + 40);
        var night = Math.max(0, 1 - Math.abs(sky - 2.2) * 1.4);
        /* stars, the sun or the moon, with its halo */
        if (night > 0) { g.fillStyle = 'rgba(255,255,255,' + night * .8 + ')'; for (var s = 0; s < 60; s++) g.fillRect((s * 131 + 7) % W, (s * 71) % (H * .6), 1.3, 1.3); }
        var sunY = H * (.2 + .55 * Math.abs(Math.sin(sky / SKY.length * Math.PI)));
        var halo = g.createRadialGradient(W * .74, sunY, 10, W * .74, sunY, 110);
        halo.addColorStop(0, 'rgba(255,240,200,' + (.45 - night * .25).toFixed(2) + ')'); halo.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = halo; g.fillRect(W * .74 - 110, sunY - 110, 220, 220);
        g.fillStyle = col('sun'); g.globalAlpha = .95; g.beginPath(); g.arc(W * .74, sunY, 24, 0, 7); g.fill(); g.globalAlpha = 1;
        /* clouds, lit from below by whatever the sky is doing */
        clouds.forEach(function (cl) {
          var x = ((cl.x - camX * cl.k) % (W * 3) + W * 3) % (W * 3) - W * .5;
          if (x < -cl.w || x > W + cl.w) return;
          g.fillStyle = 'rgba(255,236,214,' + (.14 + (1 - night) * .1).toFixed(2) + ')';
          g.beginPath(); g.ellipse(x, cl.y, cl.w * .5, 9, 0, 0, 7); g.ellipse(x + cl.w * .2, cl.y - 6, cl.w * .28, 9, 0, 0, 7); g.ellipse(x - cl.w * .2, cl.y - 3, cl.w * .22, 7, 0, 0, 7); g.fill();
        });
        /* the far hills, the festival on them, mist, the near hills with trees */
        layer(g, .12, 150, col('far'), 40, .004);
        festival(g, .2, night);
        mist(g, 200, col('low'), .22);
        layer(g, .35, 220, mix(A1.far, A1.hill, .5), 26, .009, true, night);
        mist(g, 265, col('low'), .14);
        fireworks.forEach(function (fw) { firework(g, fw); });
        /* the ground you ride */
        terrain(g, col('hill'), col('edge'));
        rails.forEach(function (r) { rail(g, r); });
        ramps.forEach(function (r) { ramp(g, r); });
        cases.forEach(function (c) { caseOn(g, c, night); });
        if (!started || intro >= 0) openedCase(g);
        sticks.forEach(function (s) { stick(g, s); });
        powers.forEach(function (p) { power(g, p); });
        balls.forEach(function (b) { ball(g, b); });
        sparks.forEach(function (p) { g.fillStyle = 'rgba(255,214,120,' + p.life * 2.5 + ')'; g.fillRect(p.x - camX, p.y - camY, 2, 2); });
        dust.forEach(function (p) { g.fillStyle = 'rgba(255,246,230,' + (p.life * .9).toFixed(2) + ')'; g.beginPath(); g.arc(p.x - camX, p.y - camY, p.r, 0, 7); g.fill(); });
        drawMe(g);
        /* the air: a drift of pollen by day, snow at night */
        snow.forEach(function (p) { p.y += p.v * .016; p.x -= me.vx * .002; if (p.y > H) p.y = -4; if (p.x < 0) p.x = W; g.fillStyle = 'rgba(255,255,255,' + (.15 + night * .4) + ')'; g.fillRect(p.x, p.y, 1.5, 1.5); });
        hud(g, night);
      }
      function layer(g, k, base, c, amp, freq, trees, night) {
        var yAt = function (x) { var wx = x + camX * k; return base + Math.sin(wx * freq) * amp + Math.sin(wx * freq * 2.7) * amp * .3 - camY * k * .2; };
        g.fillStyle = c; g.beginPath(); g.moveTo(0, H);
        for (var x = 0; x <= W; x += 10) g.lineTo(x, yAt(x));
        g.lineTo(W, H); g.closePath(); g.fill();
        if (!trees) return;
        /* pines along the ridge, and at night the festival's string lights between them */
        var off = camX * k, prev = null;
        for (var tx = -((off % 34) + 34) % 34; tx < W + 34; tx += 34) {
          var id = Math.round((tx + off) / 34), keep = ((id * 7919) % 13) < 6;
          if (!keep) { prev = null; continue; }
          var ty = yAt(tx) + 2, th = 18 + ((id * 31) % 12);
          g.fillStyle = c; g.beginPath(); g.moveTo(tx - 7, ty); g.lineTo(tx, ty - th); g.lineTo(tx + 7, ty); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(tx - 5, ty - th * .45); g.lineTo(tx, ty - th - 5); g.lineTo(tx + 5, ty - th * .45); g.closePath(); g.fill();
          if (night > .2 && prev) {
            for (var b = 1; b < 6; b++) {
              var u = b / 6, lx = lerp(prev.x, tx, u), ly = lerp(prev.y, ty - th * .6, u) + Math.sin(u * Math.PI) * 6;
              g.fillStyle = ['rgba(255,214,120,', 'rgba(255,79,216,', 'rgba(47,216,255,'][b % 3] + (night * .9).toFixed(2) + ')';
              g.fillRect(lx - 1, ly - 1, 2, 2);
            }
          }
          prev = { x: tx, y: ty - th * .6 };
        }
      }
      function mist(g, y, c, a) {
        var m = g.createLinearGradient(0, y - 40 - camY * .05, 0, y + 30 - camY * .05);
        var rgb = c.match(/\d+/g).join(',');
        m.addColorStop(0, 'rgba(' + rgb + ',0)'); m.addColorStop(.6, 'rgba(' + rgb + ',' + a + ')'); m.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = m; g.fillRect(0, y - 40 - camY * .05, W, 70);
      }
      function festival(g, k, night) {
        var off = camX * k;
        for (var i = 0; i < 4; i++) {
          var sx = ((i * 380 - off) % 1520 + 1520) % 1520 - 200, base = 190 - camY * .04;
          if (sx < -180 || sx > W + 40) continue;
          /* a stage: roof, truss legs, and at night its beams */
          g.fillStyle = 'rgba(20,12,24,.85)'; g.fillRect(sx, base - 34, 90, 34); g.fillRect(sx - 8, base - 46, 106, 12);
          if (night > .2) {
            for (var b = 0; b < 4; b++) {
              var a = Math.sin(time * .7 + b + i) * .5;
              g.save(); g.translate(sx + 12 + b * 22, base - 46); g.rotate(a + Math.PI);
              var gr = g.createLinearGradient(0, 0, 0, 220); var hue = [190, 300, 45, 160][(b + i) % 4];
              gr.addColorStop(0, 'hsla(' + hue + ',90%,65%,' + (.35 * night) + ')'); gr.addColorStop(1, 'hsla(' + hue + ',90%,65%,0)');
              g.fillStyle = gr; g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.lineTo(28, 220); g.lineTo(-28, 220); g.closePath(); g.fill(); g.restore();
            }
          } else {
            /* by day, flags on the roof */
            for (var fl = 0; fl < 3; fl++) { g.fillStyle = ['#FF4FD8', '#2FD8FF', '#FFB547'][fl]; g.globalAlpha = .6; g.beginPath(); var fx = sx + 14 + fl * 34; g.moveTo(fx, base - 46); g.lineTo(fx, base - 60); g.lineTo(fx + 9 + Math.sin(time * 4 + fl) * 2, base - 56); g.lineTo(fx, base - 52); g.fill(); g.globalAlpha = 1; }
          }
          /* tents beside it */
          g.fillStyle = 'rgba(30,18,32,.8)';
          for (var t = 0; t < 3; t++) { g.beginPath(); g.moveTo(sx + 110 + t * 30, base); g.lineTo(sx + 122 + t * 30, base - 16); g.lineTo(sx + 134 + t * 30, base); g.fill(); }
        }
      }
      /* the hill: a lit band along its top (the snow line, Alto's), then the body */
      function terrain(g, c, edge) {
        var x0 = Math.floor(camX / STEP) - 1, x1 = Math.ceil((camX + W) / STEP) + 1;
        function shape(dy) {
          var open = false;
          for (var i = x0; i <= x1; i++) {
            var p = ground[i];
            if (!p || p.y === null) { if (open) { g.lineTo((i * STEP) - camX, H + 50); g.closePath(); g.fill(); open = false; } continue; }
            if (!open) { g.beginPath(); g.moveTo(p.x - camX, H + 50); open = true; }
            g.lineTo(p.x - camX, p.y - camY + dy);
          }
          if (open) { g.lineTo((x1 * STEP) - camX, H + 50); g.closePath(); g.fill(); }
        }
        g.fillStyle = edge; g.globalAlpha = .55; shape(0); g.globalAlpha = 1;
        g.fillStyle = c; shape(5);
      }
      function rail(g, r) {
        var y0 = railY(r, r.x0), y1 = railY(r, r.x1); if (y0 === null) return;
        /* the truss towers at each end */
        [r.x0, r.x1].forEach(function (x) {
          var gy = heightAt(x); if (gy === null) return;
          var top = railY(r, x), sx = x - camX;
          g.strokeStyle = '#5a6478'; g.lineWidth = 1.5; g.beginPath();
          g.moveTo(sx - 3, gy - camY); g.lineTo(sx - 3, top - camY - 4); g.moveTo(sx + 3, gy - camY); g.lineTo(sx + 3, top - camY - 4);
          for (var yy = gy; yy > top; yy -= 8) { g.moveTo(sx - 3, yy - camY); g.lineTo(sx + 3, yy - 8 - camY); }
          g.stroke();
        });
        /* bunting hanging from the cable */
        var n = Math.floor((r.x1 - r.x0) / 18);
        for (var i = 0; i < n; i++) {
          var bx = r.x0 + 9 + i * 18, by = railY(r, bx) + 2;
          g.fillStyle = ['#FF4FD8', '#2FD8FF', '#FFB547', '#5CF2C4'][i % 4];
          g.beginPath(); g.moveTo(bx - 6 - camX, by - camY); g.lineTo(bx + 6 - camX, by - camY); g.lineTo(bx - camX + Math.sin(time * 5 + i) * 1.5, by + 10 - camY); g.closePath(); g.fill();
        }
        g.strokeStyle = '#10131a'; g.lineWidth = 5; g.beginPath(); g.moveTo(r.x0 - camX, y0 - camY); g.lineTo(r.x1 - camX, y1 - camY); g.stroke();
        g.strokeStyle = '#FFB547'; g.lineWidth = 3; g.stroke();
      }
      /* a ramp: a spare lid leant on a case */
      function ramp(g, r) {
        var x0 = r.x, x1 = r.x + r.len, y0 = heightAt(x0), y1 = heightAt(x1); if (y0 === null || y1 === null) return;
        g.fillStyle = '#1d222c';
        g.beginPath(); g.moveTo(x0 - camX, y0 - camY); g.lineTo(x1 - camX, y1 - r.h - camY); g.lineTo(x1 - camX, y1 - camY); g.closePath(); g.fill();
        g.fillStyle = '#3b4457'; g.fillRect(x1 - 18 - camX, y1 - r.h - camY, 18, r.h);
        g.strokeStyle = '#c9d1dc'; g.lineWidth = 2; g.beginPath(); g.moveTo(x0 - camX, y0 - camY); g.lineTo(x1 - camX, y1 - r.h - camY); g.stroke();
        g.fillStyle = '#5CF2C4'; g.beginPath(); g.moveTo(x1 - 10 - camX, y1 - r.h - 6 - camY); g.lineTo(x1 - 2 - camX, y1 - r.h - 10 - camY); g.lineTo(x1 - 4 - camX, y1 - r.h - 2 - camY); g.fill();
      }
      function caseOn(g, c, night) {
        var gy = heightAt(c.x);
        if (c.kind === 'stage') {
          /* a stage deck's edge at the lip of the gap, its LEDs lit */
          var ex = c.x - camX, sideY = heightAt(c.x + c.side * 10); if (sideY === null) return;
          var ey = sideY - camY, dx = c.side < 0 ? -40 : 0;
          g.fillStyle = '#1a1220'; g.fillRect(ex + dx, ey, 40, 120);
          g.fillStyle = '#FFB547'; g.fillRect(ex + dx, ey, 40, 3);
          for (var k = 0; k < 5; k++) { g.fillStyle = (Math.floor(time * 4) + k) % 2 ? '#FF5A6E' : '#5a1e27'; g.fillRect(ex + dx + 4 + k * 8, ey + 7, 3, 3); }
          return;
        }
        if (gy === null) return;
        var x = c.x - camX, y = gy - camY;
        /* its shadow, so it sits on the hill */
        g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y, 22, 4, 0, 0, 7); g.fill();
        g.save(); g.translate(x, y); g.rotate(slopeAt(c.x) * .6);
        /* a glow behind it, so it reads against the dark hill at any hour */
        g.shadowColor = 'rgba(255,90,110,.9)'; g.shadowBlur = 14;
        g.fillStyle = '#4a5468'; g.fillRect(-17, -28, 34, 26); g.shadowBlur = 0;
        /* hazard tape round its middle */
        g.save(); g.beginPath(); g.rect(-17, -18, 34, 7); g.clip();
        g.fillStyle = '#FFD34A'; g.fillRect(-17, -18, 34, 7);
        g.fillStyle = '#10131a'; for (var sx = -24; sx < 20; sx += 7) { g.beginPath(); g.moveTo(sx, -11); g.lineTo(sx + 4, -11); g.lineTo(sx + 9, -18); g.lineTo(sx + 5, -18); g.fill(); }
        g.restore();
        g.strokeStyle = '#dfe5ee'; g.lineWidth = 1.5; g.strokeRect(-17, -28, 34, 26);
        g.fillStyle = '#dfe5ee'; [[-17, -28], [17, -28], [-17, -2], [17, -2]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 2.4, 0, 7); g.fill(); });
        g.fillStyle = '#10131a'; g.beginPath(); g.arc(-11, 0, 2.6, 0, 7); g.arc(11, 0, 2.6, 0, 7); g.fill();
        /* and a beacon on top, blinking */
        var on = Math.sin(time * 7) > 0;
        g.fillStyle = on ? '#FF5A6E' : '#7a2430'; if (on) { g.shadowColor = '#FF5A6E'; g.shadowBlur = 16; }
        g.beginPath(); g.arc(0, -31, 3, Math.PI, 0); g.fill(); g.shadowBlur = 0;
        g.restore();
      }
      /* the case at the top whose lid you ride, open */
      function openedCase(g) {
        var gy = heightAt(caseAt); if (gy === null) return;
        var x = caseAt - camX, y = gy - camY;
        g.save(); g.translate(x, y); g.rotate(slopeAt(caseAt) * .5);
        g.fillStyle = '#2b3242'; g.fillRect(-20, -30, 40, 28);
        g.fillStyle = '#10131a'; g.fillRect(-17, -30, 34, 5);              /* open: the foam inside */
        g.strokeStyle = '#c9d1dc'; g.lineWidth = 1.5; g.strokeRect(-20, -30, 40, 28);
        g.fillStyle = '#FFB547'; g.fillRect(-20, -14, 40, 3);
        g.fillStyle = '#10131a'; g.beginPath(); g.arc(-13, 0, 3, 0, 7); g.arc(13, 0, 3, 0, 7); g.fill();
        g.restore();
      }
      function stick(g, s) {
        var x = s.x - camX, y = s.y - camY; if (x < -10 || x > W + 10) return;
        g.save(); g.translate(x, y); g.rotate(Math.sin(time * 3 + s.x) * .4);
        g.fillStyle = ['#5CF2C4', '#FF4FD8', '#2FD8FF', '#FFB547'][Math.floor(s.x) % 4]; g.shadowColor = g.fillStyle; g.shadowBlur = 10;
        g.fillRect(-2, -8, 4, 16); g.shadowBlur = 0; g.restore();
      }
      function power(g, p) {
        if (p.y === null) return;
        var x = p.x - camX, y = p.y - camY + Math.sin(time * 4) * 3;
        var gl = g.createRadialGradient(x, y, 2, x, y, 26);
        gl.addColorStop(0, 'rgba(255,240,200,.55)'); gl.addColorStop(1, 'rgba(255,240,200,0)');
        g.fillStyle = gl; g.fillRect(x - 26, y - 26, 52, 52);
        g.fillStyle = 'rgba(16,19,26,.85)'; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill();
        g.strokeStyle = '#FFD34A'; g.lineWidth = 2; g.stroke();
        powerIcon(g, p.kind, x, y, 1);
      }
      function powerIcon(g, kind, x, y, k) {
        g.save(); g.translate(x, y); g.scale(k, k); g.lineCap = 'round';
        if (kind === 'magnet') {
          g.fillStyle = '#FFD34A'; g.beginPath(); g.arc(-3, 0, 4, 0, 7); g.fill();
          g.fillStyle = 'rgba(255,211,74,.55)'; g.beginPath(); g.moveTo(0, -3); g.lineTo(8, -6); g.lineTo(8, 6); g.lineTo(0, 3); g.fill();
        } else if (kind === 'hat') {
          g.fillStyle = '#FFD34A'; g.beginPath(); g.arc(0, 2, 7, Math.PI, 0); g.fill(); g.fillRect(-9, 1, 18, 2.5);
        } else if (kind === 'balloon') {
          [['#FF4FD8', -4, -3], ['#2FD8FF', 4, -4], ['#5CF2C4', 0, -7]].forEach(function (b) { g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(b[1], b[2] + 4); g.lineTo(0, 8); g.stroke(); g.fillStyle = b[0]; g.beginPath(); g.ellipse(b[1], b[2], 3.4, 4.2, 0, 0, 7); g.fill(); });
        } else if (kind === 'banner') {
          g.strokeStyle = '#c9d1dc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, -6); g.stroke();
          g.fillStyle = '#FF4FD8'; g.beginPath(); g.moveTo(-8, -6); g.lineTo(8, -6); g.lineTo(6, 4); g.lineTo(-6, 4); g.closePath(); g.fill();
          g.fillStyle = '#fff'; g.fillRect(-4, -3, 8, 1.5); g.fillRect(-3, 0, 6, 1.5);
        }
        g.restore();
      }
      function ball(g, b) {
        var x = b.x - camX, y = b.y - camY, r = 10;
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        ['#FF5A6E', '#2FD8FF', '#FFD34A'].forEach(function (c, i) { g.fillStyle = c; g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, time * 4 + i * 2.1, time * 4 + i * 2.1 + 1); g.closePath(); g.fill(); });
      }
      function firework(g, fw) {
        var x = fw.x - camX * .5, y = fw.y - camY * .5, r = fw.t * 70, a = Math.max(0, 1 - fw.t / 1.6);
        for (var i = 0; i < 16; i++) { var an = i / 16 * Math.PI * 2; g.fillStyle = 'hsla(' + fw.hue + ',90%,65%,' + a + ')'; g.fillRect(x + Math.cos(an) * r, y + Math.sin(an) * r + fw.t * fw.t * 20, 2, 2); }
      }

      /* ---- the lid and the rider ---- */
      /* THE LID, side on: black panel, an aluminium extrusion along both
         edges, a ball corner at each end, rivets, the handle, a strip of
         the department's tape. */
      function lid(g) {
        g.fillStyle = '#1d222c'; g.fillRect(-17, -6, 34, 6);
        g.fillStyle = '#c9d1dc'; g.fillRect(-17, -6.5, 34, 1.6); g.fillRect(-17, -1.2, 34, 1.4);
        g.fillStyle = '#FFB547'; g.fillRect(-9, -4.2, 10, 2);
        g.fillStyle = '#8f99a8'; for (var r = -14; r <= 14; r += 4) g.fillRect(r, -5.6, 1, 1);
        g.fillStyle = '#5a6478'; g.fillRect(4, -4.6, 7, 3); g.fillStyle = '#c9d1dc'; g.fillRect(5, -4, 5, 1);   /* the handle */
        [-17, 17].forEach(function (x) {
          var cg = g.createRadialGradient(x - 1, -4.5, .5, x, -3.5, 3.6);
          cg.addColorStop(0, '#ffffff'); cg.addColorStop(1, '#8f99a8');
          g.fillStyle = cg; g.beginPath(); g.arc(x, -3.5, 3.6, 0, 7); g.fill();
        });
      }
      /* two bones from a to b, the joint bending toward `side` */
      function joint(ax, ay, bx, by, l, side) {
        var dx = bx - ax, dy = by - ay, d = Math.min(Math.hypot(dx, dy), l * 2 - .01), h = Math.sqrt(Math.max(0, l * l - d * d / 4));
        var mx = (ax + bx) / 2, my = (ay + by) / 2, n = Math.hypot(dx, dy) || 1;
        var px = -dy / n * h, py = dx / n * h;
        return (px * side > 0) ? { x: mx + px, y: my + py } : { x: mx - px, y: my - py };
      }
      /* THE RIDER in the lid's frame (feet on it at y = -6) */
      function rider(g, P, free) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        var hipH = 20 - 9 * P.c - 6 * P.tuck, hip = { x: -1 + P.lean * 3, y: -6 - hipH };
        var feet = free ? [{ x: -5, y: -6 + P.tuck * 4 }, { x: 5, y: -6 + P.tuck * 2 }] : [{ x: -6, y: -6 }, { x: 6, y: -6 }];
        var sh = { x: hip.x + Math.sin(P.lean) * 13, y: hip.y - Math.cos(P.lean) * 13 };
        var head = { x: hip.x + Math.sin(P.lean) * 19.5, y: hip.y - Math.cos(P.lean) * 19.5 };
        /* the back arm, behind the body */
        arm(g, sh, P.aL, P.eL, '#d9a37e');
        /* legs: thighs and shins, knees forward */
        g.strokeStyle = PANTS; g.lineWidth = 4.2;
        feet.forEach(function (f, i) {
          var hp = { x: hip.x + (i ? 1.5 : -1.5), y: hip.y }, kn = joint(hp.x, hp.y, f.x, f.y, 11, 1);
          g.beginPath(); g.moveTo(hp.x, hp.y); g.lineTo(kn.x, kn.y); g.lineTo(f.x, f.y); g.stroke();
          g.fillStyle = '#0d0f15'; g.fillRect(f.x - 3, f.y - 2, 7, 3);                       /* boots */
        });
        /* the jacket */
        g.strokeStyle = JACKET; g.lineWidth = 8.5;
        g.beginPath(); g.moveTo(hip.x, hip.y + 1); g.lineTo(sh.x, sh.y); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.4;                       /* hi-vis stripe */
        var mx = lerp(hip.x, sh.x, .45), my = lerp(hip.y, sh.y, .45), nx = Math.cos(P.lean) * 4.2, ny = Math.sin(P.lean) * 4.2;
        g.beginPath(); g.moveTo(mx - nx, my - ny); g.lineTo(mx + nx, my + ny); g.stroke();
        /* head, beanie (or the hard hat), the scarf streaming */
        g.fillStyle = SKIN; g.beginPath(); g.arc(head.x, head.y, 5, 0, 7); g.fill();
        g.fillStyle = hat ? '#FFD34A' : BEANIE; g.beginPath(); g.arc(head.x, head.y - 1.2, 5.4, Math.PI * 1.02, Math.PI * 1.98); g.fill();
        if (hat) g.fillRect(head.x - 7, head.y - 1.8, 14, 1.8);
        else { g.beginPath(); g.arc(head.x - 1, head.y - 6.6, 1.8, 0, 7); g.fill(); }
        g.fillStyle = '#10131a'; g.fillRect(head.x + 1.6, head.y - .8, 1.6, 1.6);
        g.strokeStyle = SCARF; g.lineWidth = 2.2; g.beginPath(); g.moveTo(sh.x, sh.y - 1);
        g.quadraticCurveTo(sh.x - 9, sh.y - 3 + Math.sin(time * 14) * 2, sh.x - 15 - me.vx * .012, sh.y + 1 + Math.sin(time * 11) * 3); g.stroke();
        /* the front arm */
        arm(g, sh, P.aR, P.eR, SKIN);
      }
      function arm(g, sh, a, e, c) {
        var el = { x: sh.x + Math.sin(a) * 7, y: sh.y + Math.cos(a) * 7 }, hd = { x: el.x + Math.sin(a + e) * 7, y: el.y + Math.cos(a + e) * 7 };
        g.strokeStyle = JACKET; g.lineWidth = 3.4; g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(el.x, el.y); g.stroke();
        g.strokeStyle = c; g.lineWidth = 2.6; g.beginPath(); g.moveTo(el.x, el.y); g.lineTo(hd.x, hd.y); g.stroke();
      }
      function drawMe(g) {
        if (!started) return drawIntro(g);
        var x = me.x - camX, y = me.y - camY;
        /* the balloons or the banner, above */
        if (active === 'balloon' && !me.crashed) balloons(g, x, y - 46);
        g.save(); g.translate(x, y); g.rotate(me.ang); g.scale(1.2, 1.2);
        lid(g);
        if (!me.crashed) rider(g, pose, false);
        g.restore();
        if (active === 'banner' && !me.crashed) bannerWing(g, x, y);
        if (me.crashed && body) {
          g.save(); g.translate(body.x - camX, body.y - camY); g.rotate(body.rot); g.translate(0, 10);
          rider(g, { c: .7, tuck: .7, lean: .8, aL: 2.2 + Math.sin(time * 18), aR: -1.8 + Math.cos(time * 15), eL: .6, eR: -.6, lift: 0 }, true);
          g.restore();
        }
        if (active === 'magnet') {
          g.strokeStyle = 'rgba(255,214,120,.35)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y - 16, 30 + Math.sin(time * 8) * 3, 0, 7); g.stroke();
        }
      }
      function balloons(g, x, y) {
        [['#FF4FD8', -8, -4], ['#2FD8FF', 7, -8], ['#5CF2C4', 0, -16]].forEach(function (b, i) {
          var bx = x + b[1] + Math.sin(time * 2 + i) * 2, by = y + b[2];
          g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(bx, by + 7); g.lineTo(x - 2, y + 22); g.stroke();
          g.fillStyle = b[0]; g.beginPath(); g.ellipse(bx, by, 6, 7.5, 0, 0, 7); g.fill();
          g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(bx - 2, by - 3, 1.6, 0, 7); g.fill();
        });
      }
      function bannerWing(g, x, y) {
        var flap = Math.sin(time * 10) * 3, wy = y - 44;
        g.strokeStyle = '#c9d1dc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 30, wy); g.lineTo(x + 30, wy - 4); g.stroke();
        g.fillStyle = '#FF4FD8'; g.beginPath(); g.moveTo(x - 30, wy); g.lineTo(x + 30, wy - 4);
        g.quadraticCurveTo(x + 6, wy + 14 + flap, x - 30, wy + 12 - flap); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '700 7px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('THAUMA', x - 2, wy + 4);
      }
      /* the opening, frame by frame: reach, the lid off, it lands, the hop */
      function drawIntro(g) {
        var t = intro < 0 ? 0 : intro;
        var gy = heightAt(caseAt), cx = caseAt - camX, cy = gy - camY;
        var bx = me.x - camX, byy = me.y - camY;
        /* the lid: on the case, then flying, then on the slope */
        var lt = ease((t - .2) / .42);
        var lx = lerp(cx, bx, lt), ly = lerp(cy - 32, byy, lt) - Math.sin(lt * Math.PI) * 26, la = lerp(0, Math.PI * 2 + me.ang, lt);
        if (t < .2) { lx = cx; ly = cy - 32 - Math.sin(t / .2 * Math.PI) * 3; la = slopeAt(caseAt) * .5; }
        g.save(); g.translate(lx, ly); g.rotate(la); lid(g); g.restore();
        /* the rider: beside the case, reaching; then a hop onto the lid */
        var ht = ease((t - .7) / .45);
        var rx = lerp(cx + 26, bx, ht), ry = lerp(heightAt(caseAt + 26) - camY, byy, ht) - Math.sin(ht * Math.PI) * 18;
        var P = t < .2 ? { c: .2, tuck: 0, lean: .1, aL: -.3, aR: 2.6 * (t / .2), eL: .3, eR: .2 }
          : t < .7 ? { c: .1, tuck: 0, lean: .2, aL: -.6, aR: 1.4, eL: .3, eR: -.3 }
          : { c: .5 * (1 - ht) + .3, tuck: 0, lean: .3, aL: 1.8 * (1 - ht), aR: 1.8 * (1 - ht) + .8, eL: .3, eR: -.3 };
        if (intro < 0) { P.aR = .2 + Math.sin(time * 2) * .05; P.aL = -.2; P.c = .05 + Math.sin(time * 2) * .03; }
        g.save(); g.translate(rx, ry); g.rotate(t >= .7 ? lerp(0, me.ang, ht) : 0);
        rider(g, P, false);
        g.restore();
      }
      function hud(g, night) {
        var ink = night > .5 ? 'rgba(220,226,240,.92)' : 'rgba(40,24,40,.88)';
        g.font = '700 14px Sora, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillStyle = ink; g.fillText(Math.floor(dist) + ' M', 14, 12);
        g.fillStyle = '#5CF2C4'; g.fillRect(14, 34, 4, 12); g.fillStyle = ink; g.fillText(String(glow), 24, 32);
        if (combo > 1) { g.fillStyle = '#FFD34A'; g.font = '700 18px Sora, sans-serif'; g.fillText('×' + combo, 14, 54); }
        /* what you are carrying: the hard hat, and the timed power with its ring running down */
        var hx = W - 26;
        if (active) {
          g.fillStyle = 'rgba(16,19,26,.7)'; g.beginPath(); g.arc(hx, 26, 15, 0, 7); g.fill();
          g.strokeStyle = '#FFD34A'; g.lineWidth = 2.5; g.beginPath(); g.arc(hx, 26, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * activeT / POWER_T[active]); g.stroke();
          powerIcon(g, active, hx, 26, 1); hx -= 38;
        }
        if (hat) { g.fillStyle = 'rgba(16,19,26,.7)'; g.beginPath(); g.arc(hx, 26, 15, 0, 7); g.fill(); powerIcon(g, 'hat', hx, 26, 1); }
        if (banner && banner.text) {
          g.globalAlpha = Math.min(1, banner.t * 2); g.font = '700 22px Sora, sans-serif'; g.textAlign = 'center';
          g.fillStyle = '#FFF4D6'; g.shadowColor = '#FFB547'; g.shadowBlur = 12; g.fillText(banner.text, W / 2, 60); g.shadowBlur = 0;
          if (banner.sub) { g.font = '600 13px Inter, sans-serif'; g.fillText(banner.sub, W / 2, 88); }
          g.globalAlpha = 1;
        }
        if (!started && intro < 0) {
          g.fillStyle = night > .5 ? '#EDF2F8' : '#2a1426'; g.font = '600 17px Inter, sans-serif'; g.textAlign = 'center';
          g.fillText(words('goldenhour_hint'), W / 2, H * .26);
        }
      }

      return { update: update, draw: draw, press: function (d) { if (d === 'go') press(); }, release: function (d) { if (d === 'go') release(); }, stop: function () {} };
    }
  };
})();
