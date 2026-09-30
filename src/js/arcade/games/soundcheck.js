/* =====================================================================
   Soundcheck — Pong on the desk (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "let's keep the soundcheck as pong" … "Don't do any
   feedback audio. That would be a loss. People hate hearing that. Just
   fun references tied into the game would be good."

   You hold the fader at the bottom; front of house holds the one at the
   top. Every return turns the gain up: the signal travels faster and the
   meter on the side climbs. FOH gets sharper as the rally grows. The
   match ends when FOH has five; the score is every return you made plus
   ten for each point you took.

   Toggle: hold the left or right half, or ← → / A D.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 640;
  var PW = 74, PH = 12, R = 6;
  var YOU_Y = H - 52, FOH_Y = 52;
  var BASE = 250, TOP = 720, GROW = 1.045;
  var MATCH = 5;

  A.games.soundcheck = {
    size: { w: W, h: H },
    controls: 'toggle',
    create: function (ctx) {
      var words = ctx.words;
      var you = { x: W / 2, v: 0 }, foh = { x: W / 2 };
      var ball = null, trail = [], sparks = [];
      var hits = 0, rally = 0, mine = 0, theirs = 0, wait = 1, serveTo = 1;
      var time = 0;

      function serve() {
        var ang = (Math.random() - .5) * .9;
        ball = { x: W / 2, y: H / 2, vx: Math.sin(ang) * BASE, vy: Math.cos(ang) * BASE * serveTo, speed: BASE };
        rally = 0; trail = [];
        ctx.say(words('soundcheck_serve'));
      }

      function bounce(p, dir) {
        /* where it met the fader sets the angle, as in every Pong */
        var off = Math.max(-1, Math.min(1, (ball.x - p.x) / (PW / 2)));
        ball.speed = Math.min(TOP, ball.speed * GROW);
        var ang = off * 1.05;
        ball.vx = Math.sin(ang) * ball.speed;
        ball.vy = Math.cos(ang) * ball.speed * dir;
        for (var i = 0; i < 10; i++) sparks.push({ x: ball.x, y: ball.y, vx: (Math.random() - .5) * 180, vy: dir * Math.random() * 120, life: .4 });
        if (ball.speed > 480) ctx.shake(2 + (ball.speed - 480) / 80);
      }

      function update(dt) {
        time += dt;
        /* your fader: held halves push it, with a little weight to it */
        var push = (ctx.held.right ? 1 : 0) - (ctx.held.left ? 1 : 0);
        you.v += push * 2600 * dt;
        you.v *= push ? .9 : .78;
        you.v = Math.max(-430, Math.min(430, you.v));
        you.x = Math.max(PW / 2, Math.min(W - PW / 2, you.x + you.v * dt));

        if (wait > 0) { wait -= dt; if (wait <= 0) serve(); return; }

        /* FOH: watches the signal come, never perfectly, sharper with the rally */
        var reach = Math.min(560, 210 + rally * 16 + mine * 24);
        var goal = ball.vy < 0 ? ball.x + Math.sin(time * 1.7) * (26 - Math.min(20, rally)) : W / 2;
        var d = goal - foh.x;
        foh.x += Math.max(-reach * dt, Math.min(reach * dt, d));
        foh.x = Math.max(PW / 2, Math.min(W - PW / 2, foh.x));

        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < R) { ball.x = R; ball.vx = Math.abs(ball.vx); }
        if (ball.x > W - R) { ball.x = W - R; ball.vx = -Math.abs(ball.vx); }

        if (ball.vy > 0 && ball.y + R >= YOU_Y - PH / 2 && ball.y < YOU_Y + PH && Math.abs(ball.x - you.x) <= PW / 2 + R) {
          ball.y = YOU_Y - PH / 2 - R; bounce(you, -1);
          hits++; rally++;
          ctx.score(hits + mine * 10);
          if (rally % 6 === 0) ctx.say(words('soundcheck_rally'));
        }
        if (ball.vy < 0 && ball.y - R <= FOH_Y + PH / 2 && ball.y > FOH_Y - PH && Math.abs(ball.x - foh.x) <= PW / 2 + R) {
          ball.y = FOH_Y + PH / 2 + R; bounce(foh, 1);
        }

        if (ball.y > H + 20) {           /* past you */
          theirs++; ctx.shake(5); ctx.say(words('soundcheck_miss'));
          if (theirs >= MATCH) { ctx.over(); return; }
          serveTo = 1; wait = 1.1; ball = null;
        } else if (ball && ball.y < -20) { /* past FOH */
          mine++; ctx.score(hits + mine * 10); ctx.say(words('soundcheck_win'));
          serveTo = -1; wait = 1.1; ball = null;
        }

        if (ball) { trail.push({ x: ball.x, y: ball.y }); if (trail.length > 10) trail.shift(); }
        sparks.forEach(function (s) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; });
        sparks = sparks.filter(function (s) { return s.life > 0; });
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
        g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke(); g.setLineDash([]);

        meter(g);
        tally(g);

        fader(g, foh.x, FOH_Y, '#FF4FD8');
        fader(g, you.x, YOU_Y, '#2FD8FF');

        trail.forEach(function (p, i) {
          g.fillStyle = 'rgba(143,235,255,' + (i / trail.length * .35).toFixed(2) + ')';
          g.fillRect(p.x - R * .7, p.y - R * .7, R * 1.4, R * 1.4);
        });
        if (ball) {
          var hot = (ball.speed - BASE) / (TOP - BASE);
          g.shadowColor = hot > .6 ? '#FFB547' : '#2FD8FF'; g.shadowBlur = 16;
          g.fillStyle = hot > .6 ? '#FFE1A8' : '#E8FBFF';
          g.fillRect(ball.x - R, ball.y - R, R * 2, R * 2);
          g.shadowBlur = 0;
        }
        sparks.forEach(function (s) { g.fillStyle = 'rgba(143,235,255,' + (s.life * 2).toFixed(2) + ')'; g.fillRect(s.x, s.y, 2, 2); });
      }
      function fader(g, x, y, col) {
        g.fillStyle = '#1b2231'; roundRect(g, x - PW / 2, y - PH / 2, PW, PH, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x - PW / 2 + 3, y - PH / 2 + 2, PW - 6, 2);
        g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10;
        g.fillRect(x - PW / 2 + 6, y - 1, PW - 12, 2);
        g.shadowBlur = 0;
      }
      /* the gain meter: how fast the signal is travelling */
      function meter(g) {
        var lvl = ball ? (ball.speed - BASE) / (TOP - BASE) : 0;
        var n = 16, x = 10, top = H / 2 - 120, h = 240, seg = h / n;
        for (var i = 0; i < n; i++) {
          var on = i < Math.round(lvl * n) + 1;
          var y = top + h - (i + 1) * seg;
          g.fillStyle = on ? (i > 12 ? '#FF5A6E' : i > 9 ? '#FFB547' : '#5CF2C4') : 'rgba(255,255,255,.06)';
          g.fillRect(x, y + 1, 6, seg - 2);
        }
        g.save(); g.translate(x + 3, top + h + 10); g.fillStyle = 'rgba(138,150,166,.8)';
        g.font = '600 7px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillText(words('soundcheck_gain').toUpperCase(), 0, 0); g.restore();
      }
      function tally(g) {
        g.font = '600 9px Inter, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
        g.fillStyle = 'rgba(255,79,216,.85)';
        g.fillText(words('soundcheck_foh').toUpperCase() + '  ' + theirs + ' / ' + MATCH, W - 12, H / 2 - 16);
        g.fillStyle = 'rgba(47,216,255,.85)';
        g.fillText(words('soundcheck_you').toUpperCase() + '  ' + mine, W - 12, H / 2 + 16);
      }
      function roundRect(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }

      return { update: update, draw: draw, press: function () {}, stop: function () {} };
    }
  };
})();
