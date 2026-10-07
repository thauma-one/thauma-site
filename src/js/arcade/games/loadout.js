/* =====================================================================
   Load Out — stack the road cases (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "a tower stacking game with gravity physics. Cases
   of different sizes get stacked. There is even gravity on impact that
   could lean the tower. Hard to do well, but better payoff" … "We would
   need a good way to indicate weight."

   A chain motor rides the truss with a case on its hook; tap drops it.
   Real physics (Planck.js, a port of Box2D): weight, friction and
   momentum decide whether the tower holds or leans or goes. Three spare
   cases; each one that falls off the stage costs one. The score is the
   tower's best height, in centimeters, plus 10 for each steady drop.

   WEIGHT YOU CAN SEE, six ways at once, so no one has to read to know:
     · a weight light on the case and on the motor: green light, amber,
       red heavy (Chase, 2026-10-04)
     · the stencil on the case says it — "310 LB"
     · heavy cases are built heavy: diamond plate, big corners, hazard tape
     · the chain hangs longer under them, and the motor slows
     · they swing less on the hook — a light case bobs, a sub barely moves
     · the motor's LOAD gauge fills toward red
   and they land like it: the screen jolts with weight × speed.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 640, S = 40;          /* logical px; px per meter */
  var DECK_Y = 548;                       /* the stage's top, on screen, before the camera climbs */
  var DECK_W = 216;                       /* narrow enough to fall off */
  var TRUSS_Y = 46;
  /* 120 steps a second with more solver passes (round 4: "make sure the
     stack doesn't jitter from the weight" — a heavy case on light ones
     shivered at 60 steps and 3 position passes) */
  var STEP = 1 / 120;

  /* The cases (Chase, 2026-10-04: "Those are good cases. Weight is lbs"),
     at their real weights, each one a little different from the last (a
     cable trunk is never packed the same twice). kg is what the physics
     uses. */
  var CASES = [
    { key: 'mic',     w: 64,  h: 32, lb: 38,  kg: 12,  tape: '#5CF2C4', build: 'light' },
    { key: 'amp',     w: 82,  h: 56, lb: 165, kg: 85,  tape: '#FFB547', build: 'trunk' },
    { key: 'led',     w: 116, h: 30, lb: 190, kg: 30,  tape: '#9B7BFF', build: 'trunk' },
    { key: 'cable',   w: 96,  h: 46, lb: 240, kg: 38,  tape: '#2FD8FF', build: 'heavy' },
    { key: 'lights',  w: 124, h: 44, lb: 260, kg: 55,  tape: '#FF4FD8', build: 'heavy' },
    { key: 'speaker', w: 92,  h: 70, lb: 310, kg: 120, tape: '#FF5A6E', build: 'heavy' }
  ];
  /* The weight light: green light, amber, red heavy. */
  function tier(lb) { return lb < 100 ? 0 : lb < 220 ? 1 : 2; }
  var TIER = ['#5CF2C4', '#FFB547', '#FF5A6E'];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* Early cases are kind; later ones are longer and heavier. */
  function nextCase(n) {
    var pool = n < 3 ? [0, 1, 1, 2] : n < 8 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5, 5];
    var t = CASES[pool[Math.floor(Math.random() * pool.length)]];
    var lb = Math.round(t.lb * rnd(.88, 1.12) / 5) * 5;
    /* The stencil says the real pounds; the PHYSICS uses each case's own
       weight from the first version, so a light case lands lively on a
       heavy one (Chase, 2026-10-05: "I like that the weight numbers are
       more accurate … can the actual weights go back to what they were
       originally? I liked the more bouncy nature they had"). */
    return Object.assign({}, t, { lb: lb });
  }

  A.games.loadout = {
    size: { w: W, h: H },
    quipAt: .3,                           /* between the hook and the tower's top, clear of SPARES */
    controls: 'tap',
    needs: ['planck'],
    create: function (ctx) {
      var pl = window.planck;
      /* Stronger than 9.8: at 40px to the meter a real-gravity drop floats. */
      var world = new pl.World({ gravity: pl.Vec2(0, -26) });
      var words = ctx.words;

      /* The stage deck: a static slab whose top is world y = 0. */
      var deck = world.createBody({ position: pl.Vec2(W / 2 / S, -.4) });
      deck.createFixture(new pl.Box(DECK_W / 2 / S, .4), { friction: .9 });

      var bodies = [];                    /* cases in the world: { body, t } */
      var spares = 3, placed = 0, bestCm = 0, bonus = 0, nextTall = 450;   /* bonus: a little, for steady drops */
      var pops = [];                      /* "+100 STEADY" as it floats up */
      var cam = 0, camGoal = 0;           /* how far the view has climbed, px */
      var time = 0, acc = 0, motorX = W / 2, motorDir = 1;
      var hook = { t: nextCase(0), phase: rnd(0, 6) };
      var falling = [], cooldown = 0, lastTop = null;
      var dust = [];

      /* Landings: the jolt follows weight × closing speed. */
      world.on('post-solve', function (contact, impulse) {
        var n = impulse.normalImpulses[0] || 0, impact = false;
        /* a falling case that touches anything has landed: the next may drop */
        falling.forEach(function (r) {
          if (r.landed || (contact.getFixtureA().getBody() !== r.body && contact.getFixtureB().getBody() !== r.body)) return;
          r.landed = true; impact = true;
        });
        /* Only a LANDING jolts the camera (round 4: "make sure the stack
           doesn't jitter from the weight"). This fired on every contact
           above the threshold, and a tall stack's own weight presses its
           lowest cases that hard on every step while it is awake, so the
           screen shook, puffed and thudded for as long as the tower
           settled — worse the heavier it got. */
        if (impact && n > 6) {
          ctx.shake(Math.min(9, n / 7));
          if (n > 12 && time - lastThud > .12) { lastThud = time; ctx.sfx('thud', { vol: Math.min(1, n / 60) }); }
          var m = contact.getWorldManifold(null);
          if (m && m.points[0]) puff(m.points[0].x * S, screenY(m.points[0].y), Math.min(14, n / 3));
        }
      });

      var lastThud = 0;
      function screenY(worldY) { return DECK_Y + cam - worldY * S; }
      function puff(x, y, n) {
        if (ctx.reduced) return;
        for (var i = 0; i < n; i++) dust.push({ x: x + rnd(-10, 10), y: y, vx: rnd(-40, 40), vy: rnd(-50, -10), life: rnd(.4, .8) });
      }

      /* The hook: where the motor is, how long the chain hangs, how far
         the case swings — all of them answer to the case's weight. */
      function hookState() {
        var t = hook.t;
        var chain = 58 + t.kg * .28;
        var swing = .28 * (22 / (t.kg + 22)) + .02 * Math.min(1, placed / 15);   /* a wider swing, wider as the tower grows */
        var ang = Math.sin(time * (2.4 - t.kg / 120) + hook.phase) * swing;
        var hx = motorX, hy = TRUSS_Y + 14;
        var cx = hx + Math.sin(ang) * (chain + t.h / 2), cy = hy + Math.cos(ang) * (chain + t.h / 2);
        return { chain: chain, ang: ang, hx: hx, hy: hy, cx: cx, cy: cy };
      }
      /* faster than it was (BACKLOG §4: "faster pace"), and faster still as
         the tower grows; heavy cases still slow the motor */
      function motorSpeed() {
        /* the first version's pace (Chase, 2026-10-05: "everything
           progresses too fast … ease you into games") */
        return (62 + Math.min(placed, 24) * 6) * (1 / (1 + hook.t.kg / 90));
      }
      /* Is everything on the stage still? A case dropped on a tower that is
         still moving lands for fewer points (Chase: "allow a drop before
         the wobble settles, perhaps with fewer points"). */
      function steady() {
        return bodies.every(function (r) {
          if (r.lost || falling.indexOf(r) >= 0) return true;
          var v = r.body.getLinearVelocity();
          return Math.hypot(v.x, v.y) < .25 && Math.abs(r.body.getAngularVelocity()) < .35;
        });
      }

      function drop() {
        /* one case in the air at a time; a drop onto a tower still
           wobbling is allowed, as a rushed one */
        if (cooldown > 0 || spares <= 0 || falling.some(function (r) { return !r.landed; })) return;
        var t = hook.t, h = hookState();
        var body = world.createDynamicBody({
          position: pl.Vec2(h.cx / S, (DECK_Y + cam - h.cy) / S),
          angle: -h.ang,
          linearVelocity: pl.Vec2(motorDir * motorSpeed() / S, 0),
          angularVelocity: 0
        });
        body.createFixture(new pl.Box(t.w / 2 / S, t.h / 2 / S), {
          density: t.kg / ((t.w / S) * (t.h / S)) / 22, friction: .62, restitution: .02   /* less grip than .78 (round 4: "the physics feel easier") */
        });
        var rec = { body: body, t: t, lost: false, settle: 0, rushed: !steady() || falling.length > 0 };
        bodies.push(rec);
        falling.push(rec);
        ctx.sfx('drop');
        hook.t = nextCase(placed + 1); hook.phase = rnd(0, 6);
        if (tier(hook.t.lb) === 2) ctx.quip('jokes_loadout_heavy', { chance: .45 });
        cooldown = .45;
      }

      function towerTopPx() {
        var top = 0;
        bodies.forEach(function (r) {
          if (r.lost || falling.indexOf(r) >= 0) return;
          var p = r.body.getPosition(), a = r.body.getAngle();
          var hw = r.t.w / 2 / S, hh = r.t.h / 2 / S;
          var ext = Math.abs(Math.sin(a)) * hw + Math.abs(Math.cos(a)) * hh;
          top = Math.max(top, (p.y + ext) * S);
        });
        return top;
      }

      function update(dt) {
        time += dt;
        cooldown = Math.max(0, cooldown - dt);
        /* the motor rides the truss, faster as the tower grows */
        motorX += motorDir * motorSpeed() * dt;
        /* the whole case stays inside the play area, not just the hook */
        var edge = Math.max(44, hook.t.w / 2 + 8);
        if (motorX > W - edge) { motorX = W - edge; motorDir = -1; }
        if (motorX < edge) { motorX = edge; motorDir = 1; }

        acc += dt;
        while (acc >= STEP) { world.step(STEP, 10, 8); acc -= STEP; }

        /* a case off the stage is a spare gone */
        bodies.forEach(function (r) {
          if (!r.lost && r.body.getPosition().y < -2.5) {
            r.lost = true; world.destroyBody(r.body);
            spares--;
            falling = falling.filter(function (f) { return f !== r; });
            ctx.sfx('crash');
            if (!ctx.quip('jokes_loadout_lost', { mood: 'bad' })) ctx.say(words('loadout_lost'), { mood: 'bad' });
            ctx.shake(5);
          }
        });
        bodies = bodies.filter(function (r) { return !r.lost; });
        if (spares <= 0) { ctx.over(); return; }

        /* a dropped case has landed once it holds still for a moment: then
           its points — full for a steady drop, less for a rushed one */
        falling = falling.filter(function (r) {
          var v = r.body.getLinearVelocity(), av = r.body.getAngularVelocity();
          if (Math.hypot(v.x, v.y) < .12 && Math.abs(av) < .2) r.settle += dt; else r.settle = 0;
          if (r.settle < .3 && r.body.isAwake()) return true;
          placed++;
          var p = r.body.getPosition(), gain = r.rushed ? 0 : 10;
          bonus += gain;
          pops.push({ x: p.x * S, wy: p.y, text: (gain ? '+' + gain + ' ' : '') + words(r.rushed ? 'loadout_rushed' : 'loadout_steady'), good: !r.rushed, life: 1.3 });
          ctx.sfx(r.rushed ? 'hit' : 'point');
          if (lastTop && Math.abs(p.x - lastTop.x) * S < 5) ctx.quip('jokes_loadout_steady', { mood: 'good', chance: .5 });
          lastTop = { x: p.x };
          return false;
        });
        var top = towerTopPx();
        bestCm = Math.max(bestCm, Math.round(top / S * 100));
        ctx.score(bestCm + bonus);
        if (bestCm >= nextTall) { nextTall += 350; ctx.quip('jokes_loadout_tall', { mood: 'good' }); }
        /* The view climbs with the tower, so its top stays mid-screen. The
           camera only: the deck and every case stay exactly where the
           physics has them (BACKLOG §4: "lowering the platform must not
           touch the physics"). */
        /* It follows at once now (round 4: "when the stack gets high, we
           need the tower to lower immediately and not wait since some
           people will drop the next piece immediately") — quickly, and
           whether or not something is falling. */
        camGoal = Math.max(0, top - 250);
        cam += (camGoal - cam) * Math.min(1, dt * 7);
        pops.forEach(function (q) { q.life -= dt; q.wy += dt * .9; });
        pops = pops.filter(function (q) { return q.life > 0; });

        dust.forEach(function (d) { d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 90 * dt; d.life -= dt; });
        dust = dust.filter(function (d) { return d.life > 0; });
      }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        /* the room: dark, with a haze of stage light from above */
        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#0d1422'); bg.addColorStop(1, '#07090e');
        g.fillStyle = bg; g.fillRect(-20, -20, W + 40, H + 40);
        beams(g);

        /* the pit, and the deck */
        var dy = screenY(0);
        g.fillStyle = '#05070b'; g.fillRect(-20, dy + 30, W + 40, H);
        var dx = W / 2 - DECK_W / 2;
        var deckG = g.createLinearGradient(0, dy, 0, dy + 30);
        deckG.addColorStop(0, '#2a3242'); deckG.addColorStop(1, '#141a25');
        g.fillStyle = deckG; g.fillRect(dx, dy, DECK_W, 30);
        g.fillStyle = '#FFB547'; g.globalAlpha = .75; g.fillRect(dx + 8, dy + 3, DECK_W - 16, 2); g.globalAlpha = 1;   /* the gaff-taped edge */
        g.fillStyle = '#0a0d14'; g.fillRect(dx + 10, dy + 30, 10, H); g.fillRect(dx + DECK_W - 20, dy + 30, 10, H);  /* its legs */

        /* the drop line: where the case would fall, if nothing moved */
        if (cooldown <= 0) {
          var h0 = hookState();
          g.strokeStyle = 'rgba(255,181,71,.18)'; g.setLineDash([3, 6]); g.lineWidth = 1;
          g.beginPath(); g.moveTo(h0.cx, h0.cy + hook.t.h / 2); g.lineTo(h0.cx, dy); g.stroke(); g.setLineDash([]);
        }

        bodies.forEach(function (r) {
          var p = r.body.getPosition();
          drawCase(g, r.t, p.x * S, screenY(p.y), -r.body.getAngle());
        });

        dust.forEach(function (d) { g.fillStyle = 'rgba(200,210,225,' + (d.life * .6).toFixed(2) + ')'; g.fillRect(d.x, d.y, 2, 2); });

        drawRig(g);
        drawSpares(g);
        pops.forEach(function (q) {
          g.globalAlpha = Math.min(1, q.life * 1.5);
          g.font = '700 12px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillStyle = q.good ? '#5CF2C4' : '#FFB547';
          g.fillText(q.text, Math.max(50, Math.min(W - 50, q.x)), screenY(q.wy) - 30);
          g.globalAlpha = 1;
        });
      }

      function beams(g) {
        [[70, '47,216,255'], [W - 70, '255,79,216']].forEach(function (b) {
          var gr = g.createLinearGradient(0, TRUSS_Y, 0, H);
          gr.addColorStop(0, 'rgba(' + b[1] + ',.10)'); gr.addColorStop(1, 'rgba(' + b[1] + ',0)');
          g.fillStyle = gr;
          g.beginPath(); g.moveTo(b[0] - 6, TRUSS_Y); g.lineTo(b[0] + 6, TRUSS_Y); g.lineTo(b[0] + 90 * (b[0] < W / 2 ? 1 : -1) + 70, H); g.lineTo(b[0] + 90 * (b[0] < W / 2 ? 1 : -1) - 70, H); g.closePath(); g.fill();
        });
      }

      /* The truss, the motor with its LOAD gauge, the chain, the case. */
      function drawRig(g) {
        g.strokeStyle = '#3a4456'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(0, TRUSS_Y - 8); g.lineTo(W, TRUSS_Y - 8); g.moveTo(0, TRUSS_Y + 4); g.lineTo(W, TRUSS_Y + 4);
        for (var x = 0; x <= W; x += 16) { g.moveTo(x, TRUSS_Y - 8); g.lineTo(x + 8, TRUSS_Y + 4); g.lineTo(x + 16, TRUSS_Y - 8); }
        g.stroke();
        var h = hookState(), t = hook.t;
        /* motor */
        g.fillStyle = '#1b2230'; g.fillRect(h.hx - 16, TRUSS_Y - 2, 32, 18);
        g.strokeStyle = 'rgba(255,255,255,.12)'; g.strokeRect(h.hx - 15.5, TRUSS_Y - 1.5, 31, 17);
        var load = Math.min(1, t.lb / 330), col = TIER[tier(t.lb)];
        g.fillStyle = '#0a0d14'; g.fillRect(h.hx - 12, TRUSS_Y + 9, 24, 4);
        g.fillStyle = col;
        g.fillRect(h.hx - 12, TRUSS_Y + 9, 24 * load, 4);
        /* the weight light on the motor: green light, amber, red heavy */
        g.shadowColor = col; g.shadowBlur = 10; g.fillStyle = col;
        g.beginPath(); g.arc(h.hx + 11, TRUSS_Y + 3, 3, 0, 7); g.fill(); g.shadowBlur = 0;
        if (cooldown > 0) {
          chain(g, h.hx, h.hy, h.hx, h.hy + 30);
          return;
        }
        chain(g, h.hx, h.hy, h.cx, h.cy - t.h / 2);
        drawCase(g, t, h.cx, h.cy, h.ang);
      }
      function chain(g, x1, y1, x2, y2) {
        var n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 7));
        g.strokeStyle = '#8A96A6'; g.lineWidth = 1.4;
        for (var i = 0; i < n; i++) {
          var a = i / n, b = (i + 1) / n, cx = x1 + (x2 - x1) * (a + b) / 2, cy = y1 + (y2 - y1) * (a + b) / 2;
          g.beginPath();
          if (i % 2) g.ellipse(cx, cy, 1.6, 3.4, 0, 0, 7); else g.ellipse(cx, cy, 3, 3.4, 0, 0, 7);
          g.stroke();
        }
        g.fillStyle = '#c9d1dc'; g.beginPath(); g.arc(x2, y2, 2.4, 0, 7); g.fill();
      }

      function drawCase(g, t, x, y, ang) {
        g.save(); g.translate(x, y); g.rotate(ang);
        var w = t.w, h = t.h, x0 = -w / 2, y0 = -h / 2;
        var heavy = t.build === 'heavy', light = t.build === 'light';
        /* body */
        g.fillStyle = light ? '#262c38' : heavy ? '#171b24' : '#1b202b';
        round(g, x0, y0, w, h, light ? 7 : 3); g.fill();
        if (heavy) {
          /* diamond plate */
          g.save(); round(g, x0, y0, w, h, 3); g.clip();
          g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
          for (var i = -h; i < w; i += 7) { g.beginPath(); g.moveTo(x0 + i, y0); g.lineTo(x0 + i + h, y0 + h); g.stroke(); }
          /* hazard tape along the bottom */
          g.fillStyle = '#FFB547'; g.fillRect(x0, y0 + h - 8, w, 8);
          g.fillStyle = '#10131a';
          for (var k = -8; k < w; k += 12) { g.beginPath(); g.moveTo(x0 + k, y0 + h); g.lineTo(x0 + k + 6, y0 + h - 8); g.lineTo(x0 + k + 11, y0 + h - 8); g.lineTo(x0 + k + 5, y0 + h); g.closePath(); g.fill(); }
          g.restore();
        }
        if (!light) {
          /* aluminium edge rails and the ball corners every road case has */
          g.strokeStyle = '#8f99a8'; g.lineWidth = heavy ? 3 : 2;
          round(g, x0 + 1, y0 + 1, w - 2, h - 2, 3); g.stroke();
          var c = heavy ? 9 : 7;
          g.fillStyle = '#c9d1dc';
          [[x0, y0], [x0 + w - c, y0], [x0, y0 + h - c], [x0 + w - c, y0 + h - c]].forEach(function (p) { round(g, p[0], p[1], c, c, 2); g.fill(); });
        } else {
          /* a plastic case: latches */
          g.fillStyle = '#8f99a8'; g.fillRect(x0 + w * .25 - 4, y0 + 3, 8, 4); g.fillRect(x0 + w * .75 - 4, y0 + 3, 8, 4);
        }
        /* the department's tape, and the stencil */
        g.fillStyle = t.tape; g.globalAlpha = .9; g.fillRect(x0 + 6, y0 + (heavy ? 5 : 4), Math.min(26, w * .3), 3); g.globalAlpha = 1;
        /* its weight light, so the weight is seen before it is read */
        var tc = TIER[tier(t.lb)];
        g.fillStyle = tc; g.shadowColor = tc; g.shadowBlur = 8;
        g.beginPath(); g.arc(x0 + w - 7, y0 + 7, 2.6, 0, 7); g.fill(); g.shadowBlur = 0;
        g.fillStyle = 'rgba(237,242,248,.86)'; g.textAlign = 'center'; g.textBaseline = 'middle';
        var fs = Math.max(7, Math.min(11, h * .26));
        g.font = '600 ' + fs + 'px Sora, sans-serif';
        var name = words('loadout_' + t.key);
        g.fillText(name.length * fs * .66 > w - 14 ? name.slice(0, Math.floor((w - 14) / (fs * .66))) : name, 0, heavy ? -4 : -2);
        g.font = '600 ' + (fs * .82).toFixed(1) + 'px Sora, sans-serif';
        g.fillStyle = tc;
        g.fillText(t.lb + ' LB', 0, heavy ? fs * .9 - 2 : fs * .95);
        g.restore();
      }
      function round(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }
      function drawSpares(g) {
        g.fillStyle = 'rgba(138,150,166,.8)'; g.font = '600 8px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillText(words('loadout_spares').toUpperCase(), 10, 8);
        for (var i = 0; i < 3; i++) {
          g.fillStyle = i < spares ? '#FFB547' : 'rgba(255,255,255,.08)';
          round(g, 10 + i * 16, 20, 12, 8, 2); g.fill();
        }
      }

      return {
        update: update, draw: draw,
        press: function () { drop(); },
        stop: function () { bodies = []; falling = []; }
      };
    }
  };
})();
