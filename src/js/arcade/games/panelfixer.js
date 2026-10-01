/* =====================================================================
   Panel Fixer — the official LED wall fix (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "throwing a tennis ball at the wall is an official
   troubleshooting technique … You have a guy on the left side of the
   screen throwing a ball to the right side to try and 'fix' the LED wall.
   We could mark locations that are 'not working properly' and have them
   aim the shots" … "Dart style for panel fixer is good."

   The wall stands on the right, a column of panels; some are dead,
   flickering or the wrong color. Tap to lock the angle as it sweeps, tap
   again to lock the power as the meter pulses, and the ball flies on a
   real arc — a short dotted stretch of it shows while you aim. A broken
   panel it hits is reseated; a working one is knocked out. Off the truss
   overhead and then into a broken panel is a bank shot.

   Each round has its broken panels and a budget of throws. Clear the wall
   and the throws left over are points; run out with panels still broken
   and it's over. Fixes in a row multiply; from round four, working panels
   start to fail on their own.

   Tap: tap anywhere, or Space.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 640;
  var FLOOR = 600, CEIL = 34;
  var WALL_X = 262, WALL_TOP = 64, ROWS = 10, PANEL = 52;
  var HAND = { x: 58, y: 548 };
  var G = 900, R = 6.5;
  var FAULTS = ['dead', 'flicker', 'tint'];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  A.games.panelfixer = {
    size: { w: W, h: H },
    controls: 'tap',
    create: function (ctx) {
      var words = ctx.words;
      var panels = [];
      for (var i = 0; i < ROWS; i++) panels.push({ fault: null, fixedAt: -9, hitAt: -9 });
      var round = 0, throws = 0, streak = 0, score = 0;
      var phase = 'angle', angle = 0, power = 0, clock = 0, time = 0;
      var ball = null, banked = false, trail = [], sparks = [];
      var failTimer = 0, betweenRounds = 0;

      function broken() { return panels.filter(function (p) { return p.fault; }).length; }
      function breakSome(n) {
        var ok = panels.map(function (p, i) { return p.fault ? -1 : i; }).filter(function (i) { return i >= 0; });
        for (var k = 0; k < n && ok.length; k++) {
          var i = ok.splice(Math.floor(Math.random() * ok.length), 1)[0];
          panels[i].fault = FAULTS[Math.floor(Math.random() * FAULTS.length)];
        }
      }
      function nextRound() {
        round++;
        breakSome(Math.min(2 + round, 7));
        throws = broken() + 3;
        failTimer = rnd(6, 10);
        phase = 'angle'; clock = 0;
      }
      nextRound();

      /* Ranges from a simulation of every angle × power (2026-09-30): the
         first ones reached only the lower six panels and never the truss.
         These reach every row — the top ones hardest — and allow the odd
         bank shot. */
      function angleNow() { return .25 + 1.2 * .5 * (1 + Math.sin(clock * 2.1 - Math.PI / 2)); }   /* 0.25 to 1.45 rad */
      function powerNow() { return .5 * (1 + Math.sin(clock * 3.3 - Math.PI / 2)); }
      function speedFor(p) { return 450 + p * 650; }

      function press() {
        if (betweenRounds > 0 || ball) return;
        if (phase === 'angle') { angle = angleNow(); phase = 'power'; clock = 0; return; }
        if (phase === 'power') {
          power = powerNow();
          var v = speedFor(power);
          ball = { x: HAND.x, y: HAND.y, vx: Math.cos(angle) * v, vy: -Math.sin(angle) * v };
          banked = false; trail = []; throws--; phase = 'flight';
        }
      }

      function land(missed) {
        ball = null;
        if (missed) streak = 0;
        if (!broken()) {
          score += 150 + throws * 60; ctx.score(score);
          ctx.say(words('panelfixer_clear'));
          betweenRounds = 1.6;
          return;
        }
        if (throws <= 0) { setTimeout(function () { ctx.over(); }, 500); phase = 'done'; return; }
        phase = 'angle'; clock = 0;
      }

      function hitPanel(row) {
        var p = panels[row];
        p.hitAt = time;
        for (var i = 0; i < 12; i++) sparks.push({ x: WALL_X, y: WALL_TOP + row * PANEL + PANEL / 2, vx: rnd(-160, -20), vy: rnd(-120, 120), life: .5 });
        if (p.fault) {
          p.fault = null; p.fixedAt = time; streak++;
          var gain = 100 * Math.min(streak, 5) + (banked ? 150 : 0);
          score += gain; ctx.score(score);
          ctx.say(words(banked ? 'panelfixer_bank' : 'panelfixer_fix'));
          ctx.shake(2);
        } else {
          p.fault = 'dead'; streak = 0; score = Math.max(0, score - 50); ctx.score(score);
          ctx.say(words('panelfixer_oops'));
          ctx.shake(4);
        }
      }

      function update(dt) {
        time += dt; clock += dt;
        if (betweenRounds > 0) { betweenRounds -= dt; if (betweenRounds <= 0) nextRound(); }
        /* from round four the wall starts to fail by itself */
        if (round >= 4 && phase !== 'done') {
          failTimer -= dt;
          if (failTimer <= 0) { breakSome(1); failTimer = rnd(7, 11); }
        }
        if (ball) {
          /* a few small steps a frame: the ball is fast, the panels are not thick */
          var n = 4, h = dt / n;
          for (var s = 0; s < n && ball; s++) {
            ball.vy += G * h; ball.x += ball.vx * h; ball.y += ball.vy * h;
            if (ball.y - R < CEIL && ball.vy < 0) { ball.y = CEIL + R; ball.vy = Math.abs(ball.vy) * .7; banked = true; ctx.shake(1.5); }
            if (ball.x + R >= WALL_X && ball.vx > 0) {
              var row = Math.floor((ball.y - WALL_TOP) / PANEL);
              if (row >= 0 && row < ROWS) {
                hitPanel(row);
                ball.x = WALL_X - R; ball.vx = -Math.abs(ball.vx) * .35; ball.vy *= .5;
                ball.hit = true;
              } else if (ball.y > FLOOR - 8) { ball.x = WALL_X - R; ball.vx = -Math.abs(ball.vx) * .3; }
            }
            if (ball.y + R >= FLOOR || ball.x < -20) { var missed = !ball.hit; land(missed); }
          }
          if (ball) { trail.push({ x: ball.x, y: ball.y }); if (trail.length > 14) trail.shift(); }
        }
        sparks.forEach(function (p) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; });
        sparks = sparks.filter(function (p) { return p.life > 0; });
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0b1020'); bg.addColorStop(1, '#07090e');
        g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);
        /* the truss overhead, and the floor */
        g.strokeStyle = '#3a4456'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, CEIL - 12); g.lineTo(W, CEIL - 12); g.moveTo(0, CEIL); g.lineTo(W, CEIL);
        for (var x = 0; x <= W; x += 14) { g.moveTo(x, CEIL - 12); g.lineTo(x + 7, CEIL); g.lineTo(x + 14, CEIL - 12); }
        g.stroke();
        g.fillStyle = '#10151f'; g.fillRect(0, FLOOR, W, H - FLOOR);
        g.fillStyle = 'rgba(255,181,71,.5)'; g.fillRect(0, FLOOR, W, 2);

        wall(g);
        tech(g);
        aim(g);

        trail.forEach(function (p, i) { g.fillStyle = 'rgba(216,245,90,' + (i / trail.length * .3).toFixed(2) + ')'; g.beginPath(); g.arc(p.x, p.y, R * .7, 0, 7); g.fill(); });
        if (ball) { g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(ball.x, ball.y, R, 0, 7); g.fill();
          g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.beginPath(); g.arc(ball.x - 2, ball.y, R * .8, -1, 1); g.stroke(); }
        sparks.forEach(function (p) { g.fillStyle = 'rgba(143,235,255,' + (p.life * 1.8).toFixed(2) + ')'; g.fillRect(p.x, p.y, 2, 2); });
        hud(g);
      }

      /* The wall: a column of panels, the working ones playing one moving
         picture between them, the broken ones each broken their own way. */
      function wall(g) {
        g.fillStyle = '#05070b'; g.fillRect(WALL_X - 4, WALL_TOP - 4, W - WALL_X + 8, ROWS * PANEL + 8);
        panels.forEach(function (p, i) {
          var y = WALL_TOP + i * PANEL, w = W - WALL_X - 6;
          var t = time * .6 + i * .18;
          if (!p.fault) {
            var gr = g.createLinearGradient(WALL_X, y, WALL_X + w, y + PANEL);
            gr.addColorStop(0, 'hsl(' + (190 + 40 * Math.sin(t)) + ',85%,' + (38 + 8 * Math.sin(t * 1.7)) + '%)');
            gr.addColorStop(1, 'hsl(' + (260 + 30 * Math.sin(t * .8)) + ',70%,34%)');
            g.fillStyle = gr;
          } else if (p.fault === 'dead') {
            g.fillStyle = '#0b0e14';
          } else if (p.fault === 'flicker') {
            g.fillStyle = Math.sin(time * 37 + i) > .2 ? '#0b0e14' : 'hsl(' + (200 + 40 * Math.sin(t)) + ',80%,42%)';
          } else {
            g.fillStyle = 'hsl(310,90%,' + (40 + 6 * Math.sin(time * 5)) + '%)';
          }
          g.fillRect(WALL_X, y + 1, w, PANEL - 2);
          if (p.fault === 'tint' || p.fault === 'flicker') {
            g.fillStyle = 'rgba(0,0,0,.35)';
            for (var k = 0; k < 3; k++) g.fillRect(WALL_X, y + 4 + ((time * 60 + k * 17 + i * 9) % (PANEL - 8)), w, 2);
          }
          if (p.fault) {
            /* the mark: a corner flag so broken panels can be found at a glance */
            g.fillStyle = Math.sin(time * 6) > 0 ? '#FF5A6E' : '#8a2432';
            g.beginPath(); g.moveTo(WALL_X, y + 2); g.lineTo(WALL_X + 12, y + 2); g.lineTo(WALL_X, y + 14); g.closePath(); g.fill();
          }
          if (time - p.fixedAt < .5) { g.fillStyle = 'rgba(92,242,196,' + (.5 - (time - p.fixedAt)).toFixed(2) + ')'; g.fillRect(WALL_X, y + 1, w, PANEL - 2); }
          g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(WALL_X, y, w, 1);
        });
      }
      function tech(g) {
        var x = HAND.x - 16, y = FLOOR;
        g.fillStyle = '#2FD8FF'; g.globalAlpha = .9;
        g.beginPath(); g.arc(x, y - 58, 8, 0, 7); g.fill();               /* head */
        g.fillRect(x - 7, y - 49, 14, 26);                                 /* body */
        g.fillRect(x - 7, y - 23, 5, 23); g.fillRect(x + 2, y - 23, 5, 23); /* legs */
        g.save(); g.translate(x + 5, y - 46); g.rotate(-(phase === 'flight' ? .4 : angle || .8));   /* the throwing arm */
        g.fillRect(0, -2.5, 22, 5); g.restore();
        g.globalAlpha = 1;
        if (!ball && phase !== 'done') { g.fillStyle = '#d8f55a'; g.beginPath(); g.arc(HAND.x, HAND.y, R, 0, 7); g.fill(); }
      }
      /* The aim: a line while the angle sweeps; the first stretch of the
         real arc while the power pulses. */
      function aim(g) {
        if (ball || betweenRounds > 0 || phase === 'done') return;
        var a = phase === 'angle' ? angleNow() : angle;
        if (phase === 'angle') {
          g.strokeStyle = 'rgba(216,245,90,.55)'; g.lineWidth = 2; g.setLineDash([2, 6]);
          g.beginPath(); g.moveTo(HAND.x, HAND.y); g.lineTo(HAND.x + Math.cos(a) * 90, HAND.y - Math.sin(a) * 90); g.stroke(); g.setLineDash([]);
        } else {
          var v = speedFor(powerNow()), vx = Math.cos(a) * v, vy = -Math.sin(a) * v;
          g.fillStyle = 'rgba(216,245,90,.6)';
          for (var t = .04; t < .3; t += .04) {
            var px = HAND.x + vx * t, py = HAND.y + vy * t + G * t * t / 2;
            g.beginPath(); g.arc(px, py, 2, 0, 7); g.fill();
          }
          /* the power meter */
          var p = powerNow();
          g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(14, 470, 8, 110);
          g.fillStyle = p > .8 ? '#FF5A6E' : p > .5 ? '#FFB547' : '#5CF2C4';
          g.fillRect(14, 470 + 110 * (1 - p), 8, 110 * p);
        }
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
        g.fillStyle = 'rgba(138,150,166,.85)';
        g.fillText(words('panelfixer_round').toUpperCase() + ' ' + round, 12, 48);
        g.fillText(words('panelfixer_throws').toUpperCase() + ' ' + Math.max(0, throws), 12, 62);
        if (streak > 1) { g.fillStyle = '#FF4FD8'; g.fillText('×' + Math.min(streak, 5), 12, 76); }
      }

      return { update: update, draw: draw, press: function () { press(); }, stop: function () {} };
    }
  };
})();
