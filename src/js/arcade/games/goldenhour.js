/* =====================================================================
   Golden Hour — down the festival hills on a road case lid
   =====================================================================
   Chase, 2026-10-04: "For Alto's Adventure.... I just liked that game, so
   having something like it could be fun! So get creative with this too …
   There are a lot of elements that make this game unique to play."

   WHAT MAKES ALTO ALTO, kept: one button; momentum you can feel on every
   slope; backflips that carry speed into the landing; grinds; a world that
   goes quietly from sunset to night and back while you ride; and things
   that have got loose, to chase.

   THE THAUMA OF IT: you are crew at an outdoor festival, riding the lid of
   a road case down the hills between the stages after load-in. The sun
   goes down; the stage lights sweep the sky; fireworks at night. You
   grind along the cable runs, jump the gaps between stages and the cases
   somebody left on the hill, and chase the beach balls that escaped the
   crowd.

   TAP to jump. HOLD in the air to flip backwards; let go to stop turning.
   Land with the board along the slope or it's over. Each flip on a jump
   is a trick, tricks in one go make a combo, and every trick is speed.

   Glow sticks are points; the HEADLAMP pulls them in; the HARD HAT saves
   one fall.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 600, H = 400;
  var G = 980, STEP = 16, MIN = 170, MAX = 620;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrap(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
  function mix(c1, c2, t) {
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    var r = Math.round(lerp(a >> 16, b >> 16, t)), g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t)), bl = Math.round(lerp(a & 255, b & 255, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  /* The sky through one evening: golden hour, dusk, night, dawn, day. */
  var SKY = [
    { top: '#3b2a5c', mid: '#e5735a', low: '#ffc27a', hill: '#3a1f33', far: '#6b3b5a', sun: '#fff1c9' },
    { top: '#1c1838', mid: '#7a3b6a', low: '#d9705c', hill: '#26152a', far: '#47284a', sun: '#ffd9a8' },
    { top: '#05060f', mid: '#10142c', low: '#1d1f3f', hill: '#0b0c18', far: '#151832', sun: '#e8eeff' },
    { top: '#1a2340', mid: '#4f5f8a', low: '#e8a98a', hill: '#202439', far: '#3c4566', sun: '#fff1c9' },
    { top: '#3d7cc9', mid: '#8fc0e8', low: '#f2e6c8', hill: '#3b5a48', far: '#6f8fa0', sun: '#fffbe8' }
  ];

  A.games.goldenhour = {
    size: { w: W, h: H },
    controls: 'tap',
    speaker: 'LX',
    create: function (ctx) {
      var words = ctx.words;
      /* ---- the world: ground, gaps, rails, cases, glow sticks, balls ---- */
      var ground = [];                       /* { x, y } every STEP px; null y = a gap */
      var rails = [], cases = [], sticks = [], balls = [], powers = [], fireworks = [], sparks = [], snow = [];
      var genX = 0, genY = 200, slope = .28, nextFeature = 900;
      var me = { x: 120, y: 0, vx: MIN, vy: 0, ang: 0, ground: true, rail: null, spin: 0, flips: 0, air: 0, crashed: false };
      var score = 0, glow = 0, dist = 0, combo = 0, comboT = 0, time = 0, sky = 0;
      var magnet = 0, hat = 0, holding = false, started = false, camX = 0, camY = 0, banner = null;

      function heightAt(x) {
        var i = Math.floor(x / STEP);
        var a = ground[i], b = ground[i + 1];
        if (!a || !b || a.y === null || b.y === null) return null;
        return lerp(a.y, b.y, (x - a.x) / STEP);
      }
      function slopeAt(x) {
        var y1 = heightAt(x - 6), y2 = heightAt(x + 6);
        return y1 === null || y2 === null ? 0 : Math.atan2(y2 - y1, 12);
      }
      function generate(until) {
        while (genX < until) {
          /* the hills: a falling line with swells in it */
          slope = clamp(slope + rnd(-.035, .035), .12, .5);
          var swell = Math.sin(genX * .006) * 30 + Math.sin(genX * .017) * 10;
          genY += slope * STEP;
          var y = genY + swell;
          if (genX > nextFeature) feature();
          ground[Math.round(genX / STEP)] = { x: genX, y: ground[Math.round(genX / STEP)] && ground[Math.round(genX / STEP)].y === null ? null : y };
          if (Math.random() < .06) sticks.push({ x: genX, y: y - 30 - rnd(0, 40) });
          genX += STEP;
        }
      }
      /* now and then: a gap between stages, a cable run to grind, a case
         on the hill, a beach ball loose, a power */
      function feature() {
        var r = Math.random(), x0 = genX + 120;
        if (r < .3 && dist > 600) {
          /* the gap: a stage on each side, nothing between */
          var len = rnd(70, 140) + Math.min(80, dist / 60);
          for (var gx = x0; gx < x0 + len; gx += STEP) ground[Math.round(gx / STEP)] = { x: gx, y: null };
          cases.push({ x: x0 - 26, kind: 'stage' }); cases.push({ x: x0 + len + 10, kind: 'stage' });
          arc(x0, genY - 40, len);
        } else if (r < .55) {
          /* a cable run strung between two posts: grind it */
          var rl = rnd(160, 300), lift = rnd(26, 50);
          rails.push({ x0: x0, x1: x0 + rl, y0: null, lift: lift, slope: slope * .8 });
        } else if (r < .78) {
          cases.push({ x: x0, kind: 'case' });
        } else if (r < .92) {
          balls.push({ x: x0 + 200, y: 0, vy: 0, ox: x0 + 200, caught: false, hue: Math.floor(rnd(0, 4)) });
        } else {
          powers.push({ x: x0, y: null, kind: Math.random() < .5 ? 'magnet' : 'hat' });
        }
        nextFeature = genX + rnd(380, 720) - Math.min(200, dist / 50);
      }
      function arc(x0, y0, len) { for (var i = 0; i < 5; i++) sticks.push({ x: x0 + len * (i + .5) / 5, y: y0 - Math.sin((i + .5) / 5 * Math.PI) * 60 }); }
      function railY(r, x) {
        if (r.y0 === null) { var h = heightAt(r.x0); if (h === null) return null; r.y0 = h - r.lift; }
        return r.y0 + (x - r.x0) * r.slope;
      }

      generate(1400);
      me.y = heightAt(me.x) || 200;
      camX = me.x - W * .32; camY = me.y - H * .55;
      for (var s = 0; s < 40; s++) snow.push({ x: rnd(0, W), y: rnd(0, H), v: rnd(10, 30) });

      /* ------------------------------------------------------ input */
      function press() {
        if (!started) { started = true; return; }
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
        sky = (sky + dt / 45) % SKY.length;            /* a whole evening every few minutes */
        generate(me.x + 1600);
        if (!started) return;
        if (me.crashed) {
          me.vx *= Math.pow(.2, dt); me.vy += G * dt; me.x += me.vx * dt; me.y += me.vy * dt;
          var gy = heightAt(me.x); if (gy !== null && me.y > gy) { me.y = gy; me.vy = 0; }
          camX += (me.x - W * .32 - camX) * Math.min(1, dt * 4); camY += (me.y - H * .56 - camY) * Math.min(1, dt * 3);
          return;
        }

        var steps = 3, h = dt / steps;
        for (var k = 0; k < steps; k++) stepMe(h);
        dist = me.x / 10;
        if (comboT > 0) { comboT -= dt; if (comboT <= 0 && combo > 1) endCombo(); }
        magnet = Math.max(0, magnet - dt);

        /* glow sticks, balls, powers */
        sticks = sticks.filter(function (s) {
          if (s.x < me.x - 400) return false;
          var dx = me.x - s.x, dy = (me.y - 16) - s.y, d = Math.hypot(dx, dy);
          if (magnet > 0 && d < 220) { s.x += dx * dt * 5; s.y += dy * dt * 5; }
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
          if (p.y === null) { var py = heightAt(p.x); p.y = py === null ? 0 : py - 34; }
          if (Math.hypot(p.x - me.x, p.y - (me.y - 16)) < 26) {
            if (p.kind === 'magnet') magnet = 12; else hat = 1;
            ctx.sfx('powerup'); banner = { text: words('goldenhour_p_' + p.kind).toUpperCase(), t: 1.6 };
            return false;
          }
          return p.x > me.x - 400;
        });
        /* the night's fireworks */
        if (Math.floor(sky) === 2 && Math.random() < dt * .7) fireworks.push({ x: me.x + rnd(100, 700), y: me.y - rnd(180, 300), t: 0, hue: Math.floor(rnd(0, 360)) });
        fireworks.forEach(function (f) { f.t += dt; }); fireworks = fireworks.filter(function (f) { return f.t < 1.6; });
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 400 * dt; p.life -= dt; }); sparks = sparks.filter(function (p) { return p.life > 0; });
        if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }

        ctx.score(Math.floor(dist) + score);
        /* the camera leads you downhill */
        var tx = me.x - W * .32, ty = me.y - H * .56;
        camX += (tx - camX) * Math.min(1, dt * 6); camY += (ty - camY) * Math.min(1, dt * 3);
        cases = cases.filter(function (c) { return c.x > me.x - 400; });
        rails = rails.filter(function (r) { return r.x1 > me.x - 400; });
        var cut = Math.floor((me.x - 800) / STEP); for (var i = 0; i < cut; i++) if (ground[i]) ground[i] = undefined;
      }

      function stepMe(dt) {
        if (me.rail) {
          /* grinding: along the cable, sparks, points */
          var r = me.rail;
          me.vx = clamp(me.vx + 120 * dt, MIN, MAX);
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
          me.vx = clamp(me.vx + (Math.sin(a) * G * .55 - me.vx * .08) * dt, MIN, MAX);
          var nx = me.x + me.vx * Math.cos(a) * dt;
          var ny = heightAt(nx);
          if (ny === null) { me.ground = false; me.vy = me.vx * Math.sin(a); me.spin = 0; me.air = 0; me.x = nx; return; }
          /* over a crest faster than the ground falls away: airborne */
          var fall = ny - me.y, ballistic = me.vx * Math.sin(a) * dt + G * dt * dt;
          if (fall > ballistic + 1.5 && me.vx > 260) { me.ground = false; me.vy = me.vx * Math.sin(a); me.spin = 0; me.air = 0; me.x = nx; return; }
          me.x = nx; me.y = ny; me.ang += wrap(a - me.ang) * Math.min(1, dt * 18);
          hitCases();
          return;
        }
        /* in the air */
        me.air += dt;
        me.vy += G * dt;
        me.x += me.vx * dt; me.y += me.vy * dt;
        var turn = holding ? -6.4 : 0;
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
        var gy = heightAt(me.x);
        if (gy === null) { if (me.y > camY + H + 140) crash(true); return; }
        if (me.y >= gy) {
          var ga = slopeAt(me.x);
          if (Math.abs(wrap(me.ang - ga)) > .72) return crash();
          me.y = gy; me.ground = true; me.ang = ga; landed(false);
        }
      }
      function landed(onRail) {
        var flips = Math.floor(Math.abs(me.spin) / (Math.PI * 2) + .2);
        if (flips > 0) {
          combo += flips; comboT = 1.6;
          var pts = 100 * flips * Math.max(1, combo);
          score += pts;
          me.vx = Math.min(MAX, me.vx + 60 * flips);
          banner = { text: (flips > 1 ? flips + '× ' : '') + words('goldenhour_flip') + '  +' + pts, t: 1.2 };
          ctx.sfx('combo');
          if (combo >= 3) ctx.quip('jokes_goldenhour_trick', { mood: 'good', chance: .5 });
        } else if (me.air > .9) { score += 30; }
        if (onRail) { combo = Math.max(1, combo); ctx.sfx('grind'); }
        me.spin = 0; me.air = 0;
        if (!onRail) ctx.sfx('thud', { vol: .3 });
      }
      function endCombo() { combo = 0; }
      function hitCases() {
        for (var i = 0; i < cases.length; i++) {
          var c = cases[i];
          if (c.kind !== 'case' || Math.abs(me.x - c.x) > 18) continue;
          var cy = heightAt(c.x);
          if (cy !== null && me.y > cy - 24) return crash();
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
        ctx.quip('jokes_goldenhour_crash', { mood: 'bad', force: true });
        setTimeout(function () { ctx.over(); }, 1500);
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        var i0 = Math.floor(sky), f = sky - i0, A1 = SKY[i0], B1 = SKY[(i0 + 1) % SKY.length];
        var col = function (k) { return mix(A1[k], B1[k], f); };
        var gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, col('top')); gr.addColorStop(.55, col('mid')); gr.addColorStop(1, col('low'));
        g.fillStyle = gr; g.fillRect(-20, -20, W + 40, H + 40);
        var night = Math.max(0, 1 - Math.abs(sky - 2.2) * 1.4);
        /* stars, the sun or the moon */
        if (night > 0) { g.fillStyle = 'rgba(255,255,255,' + night * .8 + ')'; for (var s = 0; s < 60; s++) g.fillRect((s * 131 + 7) % W, (s * 71) % (H * .6), 1.3, 1.3); }
        var sunY = H * (.2 + .55 * Math.abs(Math.sin(sky / SKY.length * Math.PI)));
        g.fillStyle = col('sun'); g.globalAlpha = .9; g.beginPath(); g.arc(W * .74, sunY, 26, 0, 7); g.fill(); g.globalAlpha = 1;
        /* the far hills, and the festival on them: tents, a stage, its lights */
        layer(g, .12, 150, col('far'), 40, .004);
        festival(g, .2, night);
        layer(g, .35, 220, mix(A1.far, A1.hill, .5), 26, .009);
        fireworks.forEach(function (fw) { firework(g, fw); });
        /* the ground you ride */
        terrain(g, col('hill'));
        rails.forEach(function (r) { rail(g, r); });
        cases.forEach(function (c) { caseOn(g, c); });
        sticks.forEach(function (s) { stick(g, s); });
        powers.forEach(function (p) { power(g, p); });
        balls.forEach(function (b) { ball(g, b); });
        sparks.forEach(function (p) { g.fillStyle = 'rgba(255,214,120,' + p.life * 2.5 + ')'; g.fillRect(p.x - camX, p.y - camY, 2, 2); });
        rider(g);
        /* the air: a drift of pollen by day, snow at night */
        snow.forEach(function (p) { p.y += p.v * .016; p.x -= me.vx * .002; if (p.y > H) p.y = -4; if (p.x < 0) p.x = W; g.fillStyle = 'rgba(255,255,255,' + (.15 + night * .4) + ')'; g.fillRect(p.x, p.y, 1.5, 1.5); });
        hud(g, night);
      }
      function layer(g, k, base, c, amp, freq) {
        g.fillStyle = c; g.beginPath(); g.moveTo(0, H);
        for (var x = 0; x <= W; x += 10) { var wx = x + camX * k; g.lineTo(x, base + Math.sin(wx * freq) * amp + Math.sin(wx * freq * 2.7) * amp * .3 - camY * k * .2); }
        g.lineTo(W, H); g.closePath(); g.fill();
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
          }
          /* tents beside it */
          g.fillStyle = 'rgba(30,18,32,.8)';
          for (var t = 0; t < 3; t++) { g.beginPath(); g.moveTo(sx + 110 + t * 30, base); g.lineTo(sx + 122 + t * 30, base - 16); g.lineTo(sx + 134 + t * 30, base); g.fill(); }
        }
      }
      function terrain(g, c) {
        var x0 = Math.floor(camX / STEP) - 1, x1 = Math.ceil((camX + W) / STEP) + 1;
        g.fillStyle = c;
        var open = false;
        for (var i = x0; i <= x1; i++) {
          var p = ground[i];
          if (!p || p.y === null) { if (open) { g.lineTo((i * STEP) - camX, H + 50); g.closePath(); g.fill(); open = false; } continue; }
          if (!open) { g.beginPath(); g.moveTo(p.x - camX, H + 50); open = true; }
          g.lineTo(p.x - camX, p.y - camY);
        }
        if (open) { g.lineTo((x1 * STEP) - camX, H + 50); g.closePath(); g.fill(); }
        /* the lit edge of the slope */
        g.strokeStyle = 'rgba(255,214,160,.28)'; g.lineWidth = 2; g.beginPath(); var on = false;
        for (var j = x0; j <= x1; j++) { var q = ground[j]; if (!q || q.y === null) { on = false; continue; } if (!on) { g.moveTo(q.x - camX, q.y - camY); on = true; } else g.lineTo(q.x - camX, q.y - camY); }
        g.stroke();
      }
      function rail(g, r) {
        var y0 = railY(r, r.x0), y1 = railY(r, r.x1); if (y0 === null) return;
        g.strokeStyle = '#2a2230'; g.lineWidth = 3;
        [r.x0, r.x1].forEach(function (x) { var gy = heightAt(x); if (gy !== null) { g.beginPath(); g.moveTo(x - camX, gy - camY); g.lineTo(x - camX, railY(r, x) - camY); g.stroke(); } });
        g.strokeStyle = '#FFB547'; g.lineWidth = 3; g.beginPath(); g.moveTo(r.x0 - camX, y0 - camY); g.lineTo(r.x1 - camX, y1 - camY); g.stroke();
        g.strokeStyle = '#10131a'; g.lineWidth = 1; g.stroke();
      }
      function caseOn(g, c) {
        var gy = heightAt(c.x); if (gy === null) return;
        var x = c.x - camX, y = gy - camY;
        if (c.kind === 'stage') { g.fillStyle = '#1a1220'; g.fillRect(x - 6, y - 60, 12, 60); g.fillStyle = '#FFB547'; g.fillRect(x - 6, y - 62, 12, 3); return; }
        g.save(); g.translate(x, y); g.rotate(slopeAt(c.x));
        g.fillStyle = '#151a24'; g.fillRect(-16, -24, 32, 24);
        g.strokeStyle = '#8f99a8'; g.lineWidth = 1.5; g.strokeRect(-16, -24, 32, 24);
        g.fillStyle = '#FF5A6E'; g.fillRect(-16, -6, 32, 3);
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
        g.fillStyle = 'rgba(255,240,200,.25)'; g.beginPath(); g.arc(x, y, 14, 0, 7); g.fill();
        g.strokeStyle = '#FFD34A'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#FFD34A'; g.font = '700 13px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(p.kind === 'magnet' ? '✦' : '⛑', x, y + 1);
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
      function rider(g) {
        var x = me.x - camX, y = me.y - camY;
        g.save(); g.translate(x, y); g.rotate(me.ang);
        /* the board: a road case lid, with its handle */
        g.fillStyle = '#121620'; g.fillRect(-15, -5, 30, 5); g.fillStyle = '#FFB547'; g.fillRect(-15, -2, 30, 1.5);
        g.fillStyle = '#c9d1dc'; g.fillRect(-3, -6, 6, 1.5);
        /* the rider, crouched by speed, arms out */
        var crouch = me.crashed ? 0 : clamp((me.vx - MIN) / (MAX - MIN), 0, 1) * 4 + (me.ground ? 0 : 2);
        g.strokeStyle = '#151a24'; g.lineWidth = 3.5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-5, -5); g.lineTo(-3, -14 + crouch); g.moveTo(5, -5); g.lineTo(3, -14 + crouch); g.stroke();
        g.fillStyle = '#151a24'; g.fillRect(-5, -27 + crouch, 10, 14);
        g.strokeStyle = '#e2b48f'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(-5, -24 + crouch); g.lineTo(-12, -20 + crouch); g.moveTo(5, -24 + crouch); g.lineTo(12, -22 + crouch); g.stroke();
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(0, -32 + crouch, 5, 0, 7); g.fill();
        /* a beanie, and a hard hat if they have one */
        g.fillStyle = hat ? '#FFD34A' : '#FF5A6E'; g.beginPath(); g.arc(0, -34 + crouch, 5.5, Math.PI, 0); g.fill();
        /* the scarf, streaming */
        g.strokeStyle = '#2FD8FF'; g.lineWidth = 2; g.beginPath(); g.moveTo(-2, -28 + crouch);
        g.quadraticCurveTo(-12, -30 + crouch + Math.sin(time * 14) * 2, -18 - me.vx * .01, -26 + crouch + Math.sin(time * 11) * 3); g.stroke();
        g.restore();
        if (magnet > 0) { g.strokeStyle = 'rgba(255,214,120,.35)'; g.beginPath(); g.arc(x, y - 16, 28 + Math.sin(time * 8) * 3, 0, 7); g.stroke(); }
      }
      function hud(g, night) {
        g.font = '700 14px Sora, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillStyle = night > .5 ? 'rgba(220,226,240,.92)' : 'rgba(40,24,40,.88)';
        g.fillText(Math.floor(dist) + ' M', 14, 12);
        g.fillStyle = '#5CF2C4'; g.fillRect(14, 34, 4, 12); g.fillStyle = night > .5 ? 'rgba(220,226,240,.92)' : 'rgba(40,24,40,.88)';
        g.fillText(String(glow), 24, 32);
        if (combo > 1) { g.fillStyle = '#FFD34A'; g.font = '700 18px Sora, sans-serif'; g.fillText('×' + combo, 14, 54); }
        if (banner) {
          g.globalAlpha = Math.min(1, banner.t * 2); g.font = '700 22px Sora, sans-serif'; g.textAlign = 'center';
          g.fillStyle = '#FFF4D6'; g.shadowColor = '#FFB547'; g.shadowBlur = 12; g.fillText(banner.text, W / 2, 60); g.shadowBlur = 0; g.globalAlpha = 1;
        }
        if (!started) {
          g.fillStyle = night > .5 ? '#EDF2F8' : '#2a1426'; g.font = '600 17px Inter, sans-serif'; g.textAlign = 'center';
          g.fillText(words('goldenhour_hint'), W / 2, H * .3);
        }
      }

      return { update: update, draw: draw, press: function (d) { if (d === 'go') press(); }, release: function (d) { if (d === 'go') release(); }, stop: function () {} };
    }
  };
})();
