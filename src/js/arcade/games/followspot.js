/* =====================================================================
   Follow Spot — keep the light on them (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-30: "looks like one-dimensional spotlight tracking until
   the director says 'use your tilt'. Then it's 2D, with backflips, stage
   dives and hiding behind other people. The performer you pick is the
   difficulty." And 2026-10-04: build the out-of-order ones too.

   You run the follow spot from the booth. Pick who you are lighting —
   the PASTOR walks and talks, the WORSHIP LEADER roams, the YOUTH PASTOR
   is everywhere at once — and keep the light on them. On target, the
   points run, faster the longer you hold it; off target, the director's
   patience runs out instead.

   ← → pan. Then, when the director calls it, ↑ ↓ tilt too: they jump,
   climb the risers, backflip, dive into the crowd, and hide behind the
   band (keep the light where they will come out). The iris closes as the
   night goes on.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 400, H = 560;
  var DECK = 400, CROWD = 470;
  var WHO = [
    { key: 'pastor',  speed: 52,  wander: .25, stunts: .2, col: '#2FD8FF' },
    { key: 'leader',  speed: 88,  wander: .5,  stunts: .55, col: '#5CF2C4' },
    { key: 'youth',   speed: 135, wander: .9,  stunts: 1,   col: '#FF4FD8' }
  ];

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  A.games.followspot = {
    size: { w: W, h: H },
    controls: 'dpad',
    padStart: ['left', 'up', 'right'],
    speaker: 'DIR',
    quipAt: .1,
    create: function (ctx) {
      var words = ctx.words;
      var who = null, tilt = false, time = 0, played = 0, score = 0, streak = 0, patience = 1;
      var spot = { x: W / 2, y: DECK - 50, vx: 0, vy: 0, r: 46 };
      var p = { x: W / 2, y: DECK, vy: 0, goal: W / 2, act: 'walk', t: 0, dir: 1, flip: 0, hidden: false, ground: DECK, pose: 0 };
      var band = [{ x: 80, h: 64, kind: 'bass' }, { x: 320, h: 70, kind: 'guitar' }, { x: 200, h: 58, kind: 'drums' }];
      var risers = [{ x0: 150, x1: 250, y: DECK - 40 }];
      var crowd = [], beams = [], pops = [], nextStunt = 6, onT = 0;
      for (var i = 0; i < 46; i++) crowd.push({ x: i * 9 + rnd(-3, 3), h: rnd(16, 28), ph: rnd(0, 6) });

      function choose(i) {
        if (who) return;
        who = WHO[i]; ctx.sfx('go'); ctx.pad(['left', 'right']);
        ctx.say(words('followspot_' + who.key + '_line'), { tag: 'DIR' });
      }

      /* ---- the performer's mind ---- */
      function think(dt) {
        p.t += dt;
        nextStunt -= dt * who.stunts;
        if (p.act === 'walk') {
          if (Math.abs(p.goal - p.x) < 6 || p.t > 3.5) { p.goal = clamp(p.x + rnd(-1, 1) * 220 * (.4 + who.wander), 30, W - 30); p.t = 0; }
          if (nextStunt <= 0 && tilt) startStunt();
          else if (nextStunt <= 0) { nextStunt = rnd(4, 8); p.act = 'dash'; p.t = 0; p.goal = p.x < W / 2 ? W - 40 : 40; }
        }
        var sp = who.speed * (1 + played / 90) * (p.act === 'dash' ? 2.1 : 1);
        if (p.act === 'walk' || p.act === 'dash' || p.act === 'hide') {
          var d = p.goal - p.x; p.dir = d > 0 ? 1 : -1;
          p.x += clamp(d, -sp * dt, sp * dt);
          if (p.act === 'dash' && Math.abs(d) < 4) { p.act = 'walk'; p.t = 0; }
          if (p.act === 'hide' && Math.abs(d) < 3) { p.hidden = true; if (p.t > 2.4) { p.hidden = false; p.act = 'walk'; p.t = 0; } }
        }
        /* the ground under them: the deck, or the riser */
        var riser = risers.filter(function (r) { return p.x > r.x0 && p.x < r.x1; })[0];
        p.ground = riser && (p.act === 'climb' || p.y <= riser.y + 2) ? riser.y : DECK;
        if (p.act === 'jump' || p.act === 'flip' || p.act === 'climb') {
          p.vy += 900 * dt; p.y += p.vy * dt;
          if (p.act === 'flip') p.flip += dt * 9;
          if (p.act === 'climb') p.x += p.dir * 60 * dt;
          if (p.y >= p.ground && p.vy > 0) { p.y = p.ground; p.vy = 0; p.act = 'walk'; p.t = 0; p.flip = 0; land(); }
        } else if (p.act === 'dive') {
          p.vy += 700 * dt; p.y += p.vy * dt; p.x += p.dir * 70 * dt;
          if (p.y > CROWD + 10) { p.vy = 0; p.y = CROWD + 10; p.act = 'surf'; p.t = 0; }
        } else if (p.act === 'surf') {
          /* crowd surfing: carried along, bobbing, then climbing back up */
          p.x += p.dir * 50 * dt; p.y = CROWD + 6 + Math.sin(p.t * 5) * 4;
          if (p.x < 30 || p.x > W - 30) p.dir = -p.dir;
          if (p.t > 3) { p.act = 'jump'; p.vy = -520; p.ground = DECK; }
        } else if (p.y < p.ground) { p.vy += 900 * dt; p.y = Math.min(p.ground, p.y + p.vy * dt); }
        else p.y = p.ground;
      }
      function startStunt() {
        nextStunt = rnd(3, 6) / Math.max(.4, who.stunts);
        var r = Math.random();
        if (r < .25) { p.act = 'jump'; p.vy = -460; }
        else if (r < .45) { p.act = 'flip'; p.vy = -560; ctx.quip('jokes_followspot_stunt', { chance: .5 }); }
        else if (r < .6 && who.stunts > .5) { p.act = 'dive'; p.vy = -380; p.dir = p.x < W / 2 ? 1 : -1; ctx.say(words('followspot_dive'), { tag: 'DIR' }); }
        else if (r < .8) { var b = band[Math.floor(Math.random() * band.length)]; p.act = 'hide'; p.goal = b.x; p.t = 0; }
        else { p.act = 'climb'; p.vy = -420; p.dir = p.x < 200 ? 1 : -1; }
        p.t = 0;
      }
      function land() { ctx.sfx('thud', { vol: .2 }); }

      /* ---- your light ---- */
      function update(dt) {
        time += dt;
        if (!who) return;
        played += dt;
        if (!tilt && played > 22) {
          tilt = true; ctx.pad(['left', 'up', 'down', 'right']);
          ctx.say(words('followspot_tilt'), { tag: 'DIR', mood: 'good', at: 'bottom' });
          ctx.sfx('zap');
        }
        think(dt);
        var ax = (ctx.held.right ? 1 : 0) - (ctx.held.left ? 1 : 0), ay = tilt ? (ctx.held.down ? 1 : 0) - (ctx.held.up ? 1 : 0) : 0;
        spot.vx = spot.vx + (ax * 290 - spot.vx) * Math.min(1, dt * 9);
        spot.vy = spot.vy + (ay * 260 - spot.vy) * Math.min(1, dt * 9);
        spot.x = clamp(spot.x + spot.vx * dt, 20, W - 20);
        if (tilt) spot.y = clamp(spot.y + spot.vy * dt, 140, CROWD + 20);
        spot.r = Math.max(24, 46 - played * .12);

        /* on them? the head and body count, not just the feet */
        var cy = p.y - 30, on = Math.hypot(p.x - spot.x, cy - spot.y) < spot.r + 6;
        if (p.hidden) on = Math.abs(p.x - spot.x) < spot.r;           /* where they will come out */
        if (on) {
          onT += dt; streak += dt;
          var m = streak > 8 ? 4 : streak > 4 ? 3 : streak > 2 ? 2 : 1;
          score += dt * 30 * m * (1 + WHO.indexOf(who) * .5);
          patience = Math.min(1, patience + dt * .08);
          if ((p.act === 'flip' || p.act === 'surf') && !p.nailed) { p.nailed = true; score += 150; pops.push({ x: p.x, y: p.y - 70, text: words('followspot_nailed'), life: 1.4 }); ctx.sfx('combo'); }
        } else {
          if (streak > 6) ctx.quip('jokes_followspot_lost', { mood: 'bad', chance: .6 });
          streak = 0;
          patience -= dt * (.11 + played / 900);
          if (patience <= 0) { patience = 0; ctx.say(words('followspot_fired'), { tag: 'DIR', mood: 'bad' }); ctx.sfx('gameover'); who = null; setTimeout(function () { ctx.over(); }, 1000); return; }
          if (patience < .3 && Math.random() < dt * .4) ctx.quip('jokes_followspot_dark', { mood: 'bad' });
        }
        if (p.act === 'walk') p.nailed = false;
        ctx.score(score);
        pops.forEach(function (q) { q.y -= 20 * dt; q.life -= dt; }); pops = pops.filter(function (q) { return q.life > 0; });
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        g.fillStyle = '#05060a'; g.fillRect(-20, -20, W + 40, H + 40);
        /* the stage: back wall truss, the deck, the risers */
        g.strokeStyle = '#1f2533'; g.lineWidth = 1.5; g.beginPath();
        for (var x = 0; x <= W; x += 16) { g.moveTo(x, 60); g.lineTo(x + 8, 72); g.lineTo(x + 16, 60); } g.moveTo(0, 60); g.lineTo(W, 60); g.moveTo(0, 72); g.lineTo(W, 72); g.stroke();
        /* stage wash, dim: the spot is what you see by */
        var wash = g.createLinearGradient(0, 80, 0, DECK);
        wash.addColorStop(0, 'rgba(60,40,90,.12)'); wash.addColorStop(1, 'rgba(40,30,60,.3)');
        g.fillStyle = wash; g.fillRect(0, 80, W, DECK - 80);
        g.fillStyle = '#12101a'; g.fillRect(0, DECK, W, 26);
        g.fillStyle = 'rgba(255,181,71,.35)'; g.fillRect(0, DECK, W, 2);
        risers.forEach(function (r) { g.fillStyle = '#1a1724'; g.fillRect(r.x0, r.y, r.x1 - r.x0, DECK - r.y); g.fillStyle = 'rgba(255,181,71,.3)'; g.fillRect(r.x0, r.y, r.x1 - r.x0, 2); });
        band.forEach(function (b) { if (b.kind === 'drums') musician(g, b, true); });
        if (who) performer(g);
        band.forEach(function (b) { if (b.kind !== 'drums') musician(g, b, false); });
        /* the light: beam from the booth, the pool on stage */
        if (who) light(g);
        crowdDraw(g);
        if (!who) return pick(g);
        hud(g);
        pops.forEach(function (q) { g.globalAlpha = Math.min(1, q.life * 2); g.fillStyle = '#FFB547'; g.font = '700 13px Sora, sans-serif'; g.textAlign = 'center'; g.fillText(q.text.toUpperCase(), q.x, q.y); });
        g.globalAlpha = 1;
      }
      function light(g) {
        var bx = W / 2, by = H + 40;
        g.save();
        g.globalCompositeOperation = 'lighter';
        var beam = g.createLinearGradient(bx, by, spot.x, spot.y);
        beam.addColorStop(0, 'rgba(255,245,220,.02)'); beam.addColorStop(1, 'rgba(255,245,220,.10)');
        g.fillStyle = beam; g.beginPath(); g.moveTo(bx - 6, by); g.lineTo(bx + 6, by); g.lineTo(spot.x + spot.r, spot.y); g.lineTo(spot.x - spot.r, spot.y); g.closePath(); g.fill();
        var gr = g.createRadialGradient(spot.x, spot.y, 2, spot.x, spot.y, spot.r * 1.15);
        var gel = streak > 8 ? '255,180,230' : streak > 4 ? '200,240,255' : '255,245,220';
        gr.addColorStop(0, 'rgba(' + gel + ',.55)'); gr.addColorStop(.75, 'rgba(' + gel + ',.32)'); gr.addColorStop(1, 'rgba(' + gel + ',0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(spot.x, spot.y, spot.r * 1.15, spot.r * 1.05, 0, 0, 7); g.fill();
        g.restore();
      }
      function performer(g) {
        if (p.hidden) return;
        var x = p.x, y = p.y, lit = Math.hypot(x - spot.x, y - 30 - spot.y) < spot.r + 10;
        g.save(); g.translate(x, y - 22); g.rotate(p.flip * (p.dir || 1)); g.translate(0, 22);
        g.globalAlpha = lit ? 1 : .45;
        var walk = Math.sin(time * 10) * (p.act === 'walk' || p.act === 'dash' ? 1 : .2);
        g.strokeStyle = '#1c1f2b'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-3, -18); g.lineTo(-3 + walk * 6, 0); g.moveTo(3, -18); g.lineTo(3 - walk * 6, 0); g.stroke();
        g.fillStyle = who.col; g.fillRect(-8, -42, 16, 25);
        g.strokeStyle = '#e2b48f'; g.lineWidth = 3.5;
        var up = p.act === 'jump' || p.act === 'flip' || p.act === 'surf';
        g.beginPath(); g.moveTo(-7, -38); g.lineTo(up ? -14 : -12, up ? -54 : -24); g.moveTo(7, -38); g.lineTo(up ? 14 : 12, up ? -54 : -28); g.stroke();
        if (who.key !== 'pastor' && !up) { g.fillStyle = '#c9d1dc'; g.fillRect(11, -32, 2, 8); }       /* a mic */
        else if (who.key === 'pastor') { g.fillStyle = '#6b4226'; g.fillRect(-14, -30, 8, 10); }        /* a Bible */
        g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(0, -50, 7, 0, 7); g.fill();
        g.fillStyle = who.key === 'youth' ? '#FFB547' : '#3b2a20'; g.beginPath(); g.arc(0, -53, 7, Math.PI, 0); g.fill();
        g.restore(); g.globalAlpha = 1;
      }
      function musician(g, b, back) {
        var y = back ? DECK - 30 : DECK, sw = Math.sin(time * 3 + b.x) * 2;
        g.fillStyle = back ? '#151320' : '#1b1826';
        if (b.kind === 'drums') { g.fillRect(b.x - 34, y - 6, 68, 36); g.beginPath(); g.arc(b.x, y + 12, 14, 0, 7); g.fillStyle = '#211d2e'; g.fill(); }
        g.fillStyle = back ? '#151320' : '#1d1a29';
        g.fillRect(b.x - 9, y - b.h + 16 + sw, 18, b.h - 16);
        g.beginPath(); g.arc(b.x, y - b.h + 8 + sw, 8, 0, 7); g.fill();
        if (b.kind !== 'drums') { g.strokeStyle = '#2a2638'; g.lineWidth = 4; g.beginPath(); g.moveTo(b.x - 18, y - 28 + sw); g.lineTo(b.x + 16, y - 44 + sw); g.stroke(); }
      }
      function crowdDraw(g) {
        g.fillStyle = '#07070c'; g.fillRect(0, CROWD, W, H - CROWD);
        crowd.forEach(function (c) {
          var up = Math.max(0, Math.sin(time * 4 + c.ph)) * 6;
          g.fillStyle = '#0d0c14'; g.fillRect(c.x, CROWD - c.h + 20, 8, c.h + 10);
          g.beginPath(); g.arc(c.x + 4, CROWD - c.h + 16, 5, 0, 7); g.fill();
          if (c.ph > 4) g.fillRect(c.x + 1, CROWD - c.h - 4 - up, 2, 14);
        });
      }
      function pick(g) {
        g.fillStyle = 'rgba(5,6,10,.7)'; g.fillRect(0, 0, W, H);
        g.fillStyle = '#EDF2F8'; g.font = '700 16px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(words('followspot_pick').toUpperCase(), W / 2, 120);
        WHO.forEach(function (w2, i) {
          var x = 22 + i * 124, y = 170, on = Math.sin(time * 4 + i * 2) > 0;
          g.fillStyle = 'rgba(12,14,22,.95)'; g.fillRect(x, y, 108, 190);
          g.strokeStyle = w2.col; g.lineWidth = on ? 2 : 1; g.strokeRect(x + .5, y + .5, 107, 189);
          g.fillStyle = w2.col; g.font = '700 12px Sora, sans-serif'; g.fillText(words('followspot_' + w2.key).toUpperCase(), x + 54, y + 26);
          g.fillStyle = 'rgba(237,242,248,.6)'; g.font = '500 10px Inter, sans-serif';
          g.fillText('★'.repeat(i + 1), x + 54, y + 48);
          g.fillStyle = w2.col; g.fillRect(x + 46, y + 80, 16, 30); g.fillStyle = '#e2b48f'; g.beginPath(); g.arc(x + 54, y + 72, 8, 0, 7); g.fill();
          g.fillStyle = w2.col; g.font = '700 22px Sora, sans-serif'; g.fillText(['←', '↑', '→'][i], x + 54, y + 160);
        });
      }
      function hud(g) {
        g.font = '600 9px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillStyle = 'rgba(138,150,166,.9)'; g.fillText(words('followspot_patience').toUpperCase(), 12, 12);
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(12, 26, 110, 6);
        g.fillStyle = patience > .5 ? '#5CF2C4' : patience > .25 ? '#FFB547' : '#FF5A6E'; g.fillRect(12, 26, 110 * patience, 6);
        var m = streak > 8 ? 4 : streak > 4 ? 3 : streak > 2 ? 2 : 1;
        if (m > 1) { g.textAlign = 'right'; g.fillStyle = '#FFB547'; g.font = '700 14px Sora, sans-serif'; g.fillText('×' + m, W - 12, 12); }
        if (!tilt) { g.textAlign = 'right'; g.fillStyle = 'rgba(138,150,166,.7)'; g.font = '600 9px Inter, sans-serif'; g.fillText(words('followspot_pan').toUpperCase(), W - 12, 32); }
      }

      return {
        update: update, draw: draw,
        press: function (d) {
          if (!who) { if (d === 'left') choose(0); else if (d === 'right') choose(2); else if (d === 'up' || d === 'go') choose(1); }
        },
        stop: function () {}
      };
    }
  };
})();
