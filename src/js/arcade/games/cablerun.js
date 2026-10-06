/* =====================================================================
   Cable Run — run the cable, don't trip the band (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-29: "Cable run probably needs a full up down left right
   control scheme. For mobile, we may just reserve the bottom portion of
   the screen for the controls" … "I like the production-esque idea!"

   Snake, drawn as a real cable across a stage deck: every piece of gear
   you plug in makes it longer. Crossing your own cable or leaving the
   stage ends the run.

   THE PRODUCTION BIT. Now and then the worship leader walks straight
   across the stage along one row — the row glows first — and bare cable
   in their path trips them, which ends the run. GAFF TAPE rolls appear:
   one tapes down the oldest half of the cable for a while, and taped
   cable is safe for them to walk over and for you to cross.

   ROUND 4 (Chase, 2026-10-05: "still needs a bit of help. It feels too
   easy"): quicker from the start (0.15s a step, to 0.07); the stage fills
   up — every third piece of gear plugged leaves a monitor wedge or a mic
   stand behind, for good, and touching one ends the run; the worship
   leader crosses more often (every 6–13s, was 8–16) and faster.

   D-pad: arrows / WASD, the strip of four buttons on a touch screen, or
   a swipe.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  /* A shorter stage on a phone, so the d-pad fits under it (BACKLOG §4). */
  var C = 24, COLS = 15, W = C * COLS;
  var DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  var GEAR = ['mic', 'di', 'iem'];
  var TAPE_FOR = 9;             /* seconds a taping lasts */

  function rnd(n) { return Math.floor(Math.random() * n); }

  A.games.cablerun = {
    size: function (o) { return { w: W, h: C * (o && o.touch ? 17 : 22) }; },
    controls: 'dpad',
    pad: 'cross',
    create: function (ctx) {
      var words = ctx.words, ROWS = Math.round(ctx.H / C), H = ctx.H;
      var y0 = ROWS - 5;
      var cable = [{ x: 7, y: y0 }, { x: 7, y: y0 + 1 }, { x: 7, y: y0 + 2 }, { x: 7, y: y0 + 3 }];
      var dir = 'up', queue = [], grow = 0;
      var tick = 0, every = .15, plugged = 0, score = 0, lastHead = null, props = [];
      var gear = null, tape = null, taped = 0, tapeUntil = 0;
      var leader = null, nextLeader = 11, time = 0;
      var dead = false;
      /* Nothing moves until the first direction: a run that starts on its own
         is over before the player has found the cable (seen in play). */
      var started = false;

      function free(x, y) {
        return !cable.some(function (s) { return s.x === x && s.y === y; }) &&
          !props.some(function (p) { return p.x === x && p.y === y; }) &&
          !(gear && gear.x === x && gear.y === y) && !(tape && tape.x === x && tape.y === y);
      }
      function place(kind) {
        for (var i = 0; i < 200; i++) {
          var x = 1 + rnd(COLS - 2), y = 1 + rnd(ROWS - 2);
          if (free(x, y)) return { x: x, y: y, kind: kind, t: time };
        }
        return null;
      }
      gear = place(GEAR[rnd(3)]);

      /* The oldest stretch of cable is the tail end of the array. */
      function isTaped(i) { return time < tapeUntil && i >= cable.length - taped; }

      function crash(lines) {
        if (dead) return;
        dead = true; ctx.shake(6); ctx.sfx('crash');
        if (!ctx.quip('jokes_' + lines, { mood: 'bad', force: true })) ctx.say(words(lines), { mood: 'bad' });
        setTimeout(function () { ctx.over(); }, 900);
      }

      function step() {
        if (queue.length) dir = queue.shift();
        var d = DIRS[dir], head = cable[0];
        lastHead = { x: head.x, y: head.y };
        var nx = head.x + d[0], ny = head.y + d[1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return crash('cablerun_crash');
        /* the tail moves out of the way this step, so its cell is free */
        var hitAt = -1;
        for (var i = 0; i < cable.length - (grow ? 0 : 1); i++) if (cable[i].x === nx && cable[i].y === ny) { hitAt = i; break; }
        if (hitAt >= 0 && !isTaped(hitAt)) return crash('cablerun_crash');
        if (props.some(function (p) { return p.x === nx && p.y === ny; })) return crash('cablerun_crash');
        cable.unshift({ x: nx, y: ny });
        if (grow) grow--; else cable.pop();

        if (gear && gear.x === nx && gear.y === ny) {
          plugged++; grow += 2;
          score += 15 + cable.length; ctx.score(score);
          ctx.sfx('collect');
          /* faster as it grows (BACKLOG §4: "speed up as the cable grows"),
             but gently (Chase, 2026-10-05: "ease you into games"): 0.18s a
             step to start, 0.075 at the fastest, which takes ~35 pieces
             (was 0.16 → 0.058 by ~28) */
          every = Math.max(.07, .15 - (cable.length - 4) * .0035);
          /* every third plug, the stage gets a little more crowded: a
             wedge or a stand, never right in front of the plug */
          if (plugged % 3 === 0) {
            for (var tries = 0; tries < 60; tries++) {
              var pr = place(Math.random() < .5 ? 'wedge' : 'stand');
              if (pr && Math.abs(pr.x - nx) + Math.abs(pr.y - ny) > 4) { props.push(pr); break; }
            }
          }
          if (plugged % 5 === 0) ctx.quip('jokes_cablerun_plug', { mood: 'good' });
          gear = place(GEAR[rnd(3)]);
          if (!tape && plugged % 4 === 0) tape = place('tape');
        }
        if (tape && tape.x === nx && tape.y === ny) {
          taped = Math.ceil(cable.length / 2); tapeUntil = time + TAPE_FOR;
          tape = null; ctx.sfx('powerup');
          if (!ctx.quip('jokes_cablerun_tape', { mood: 'good' })) ctx.say(words('cablerun_tape'));
        }
      }

      function update(dt) {
        if (dead) return;
        time += dt;
        if (!started) return;   /* the hint breathes on `time` */
        if (tape && time - tape.t > 10) tape = null;

        /* the worship leader: a row glows, then they walk it */
        nextLeader -= dt;
        if (!leader && nextLeader <= 0) {
          var row = 2 + rnd(ROWS - 4), fromLeft = Math.random() < .5;
          leader = { row: row, x: fromLeft ? -1 : COLS, dir: fromLeft ? 1 : -1, warn: 1.9 };
          ctx.say(words('cablerun_leader'), { tag: 'SM' }); ctx.sfx('zap');
        }
        if (leader) {
          if (leader.warn > 0) leader.warn -= dt;
          else {
            leader.x += leader.dir * dt * (3.6 + Math.min(1.6, plugged * .06));
            var cx = Math.round(leader.x);
            for (var i = 0; i < cable.length; i++) {
              if (cable[i].y === leader.row && cable[i].x === cx && !isTaped(i)) return crash('cablerun_trip');
            }
            if (leader.x < -2 || leader.x > COLS + 1) { leader = null; nextLeader = Math.max(6, 13 - plugged * .35); }
          }
        }

        tick += dt;
        while (tick >= every && !dead) { tick -= every; step(); }
      }
      /* how far the head is through its cell, for drawing it gliding */
      function glide() { return started && !dead ? Math.min(1, tick / every) : 1; }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        /* the deck: boards, with the grain showing */
        g.fillStyle = '#121822'; g.fillRect(-20, -20, W + 40, H + 40);
        for (var y = 0; y < ROWS; y++) {
          g.fillStyle = y % 2 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.12)';
          g.fillRect(0, y * C, W, C);
          g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(((y * 97) % W), y * C, 1, C);
        }
        g.strokeStyle = 'rgba(255,181,71,.55)'; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, H - 2);   /* the stage's taped edge */

        if (leader && leader.warn > 0) {
          g.fillStyle = 'rgba(255,181,71,' + (.08 + .08 * Math.sin(time * 14)).toFixed(3) + ')';
          g.fillRect(0, leader.row * C, W, C);
        }
        props.forEach(function (p) { drawProp(g, p); });
        if (gear) drawGear(g, gear);
        if (tape) drawTape(g, tape);
        drawCable(g);
        if (leader && leader.warn <= 0) drawLeader(g, leader);
        if (!started) hint(g);
      }
      /* four small arrows around the plug end, breathing, until the first press */
      function hint(g) {
        var h = cable[0], x = cx(h), y = cy(h), a = .35 + .35 * Math.sin(time * 4);
        g.fillStyle = 'rgba(92,242,196,' + a.toFixed(2) + ')';
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) {
          var px = x + d[0] * 22, py = y + d[1] * 22;
          g.save(); g.translate(px, py); g.rotate(Math.atan2(d[1], d[0]));
          g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -5); g.lineTo(-3, 5); g.closePath(); g.fill(); g.restore();
        });
      }

      function cx(c) { return c.x * C + C / 2; }
      function cy(c) { return c.y * C + C / 2; }
      /* THE HEAD GLIDES, cell to cell, and the tail with it: the grid
         stays Snake's, but it moves like something alive rather than in
         jumps (BACKLOG §4: "doesn't feel like snake"). */
      function pts() {
        var k = glide(), out = cable.map(function (c) { return { x: cx(c), y: cy(c) }; });
        if (k < 1 && cable.length > 1) {
          var h = cable[0], prev = cable[1];
          out[0] = { x: cx(prev) + (cx(h) - cx(prev)) * (.5 + k * .5), y: cy(prev) + (cy(h) - cy(prev)) * (.5 + k * .5) };
        }
        return out;
      }
      function drawCable(g) {
        g.lineCap = 'round'; g.lineJoin = 'round';
        /* dark on a dark stage vanished in play: a lighter jacket and a sheen */
        g.strokeStyle = '#05070b'; g.lineWidth = 13;
        path(g); g.stroke();
        g.strokeStyle = '#46516a'; g.lineWidth = 9;
        path(g); g.stroke();
        g.strokeStyle = 'rgba(210,225,245,.35)'; g.lineWidth = 2;
        path(g); g.stroke();
        /* tape across the taped stretch */
        for (var i = 0; i < cable.length; i++) if (isTaped(i)) {
          var left = tapeUntil - time, blink = left < 2 && Math.sin(time * 16) > 0;
          g.fillStyle = blink ? 'rgba(143,150,166,.35)' : 'rgba(143,150,166,.85)';
          g.fillRect(cx(cable[i]) - 9, cy(cable[i]) - 5, 18, 10);
        }
        /* the connector at the head, the plug at the tail */
        var P = pts(), d = DIRS[dir];
        g.save(); g.translate(P[0].x, P[0].y); g.rotate(Math.atan2(d[1], d[0]));
        g.fillStyle = '#c9d1dc'; g.fillRect(-6, -7, 14, 14);
        g.fillStyle = '#10131a'; [[-3, 0], [3, -3], [3, 3]].forEach(function (p) { g.beginPath(); g.arc(p[0] + 2, p[1], 1.6, 0, 7); g.fill(); });
        g.restore();
        var t = cable[cable.length - 1];
        g.fillStyle = '#5CF2C4'; g.fillRect(cx(t) - 3, cy(t) - 3, 6, 6);
      }
      function path(g) {
        g.beginPath();
        /* a curve through the cells, with a little slack, so it reads as
           cable rather than blocks */
        var P = pts();
        g.moveTo(P[0].x, P[0].y);
        for (var i = 1; i < P.length - 1; i++) {
          var mx = (P[i].x + P[i + 1].x) / 2, my = (P[i].y + P[i + 1].y) / 2 + (i % 2 ? 1 : -1);
          g.quadraticCurveTo(P[i].x, P[i].y, mx, my);
        }
        if (P.length > 1) g.lineTo(P[P.length - 1].x, P[P.length - 1].y);
      }
      /* what the stage fills up with: a monitor wedge, a mic stand */
      function drawProp(g, p) {
        var x = p.x * C, y = p.y * C;
        g.fillStyle = 'rgba(255,90,110,.12)'; g.fillRect(x, y, C, C);
        if (p.kind === 'wedge') {
          g.fillStyle = '#1b2130'; g.beginPath(); g.moveTo(x + 2, y + C - 3); g.lineTo(x + C - 2, y + C - 3); g.lineTo(x + C - 5, y + 5); g.lineTo(x + 5, y + 9); g.closePath(); g.fill();
          g.fillStyle = '#0b0e14'; g.beginPath(); g.arc(x + C / 2, y + C / 2 + 2, 5, 0, 7); g.fill();
          g.strokeStyle = '#59647a'; g.lineWidth = 1; g.stroke();
        } else {
          g.strokeStyle = '#8f99a8'; g.lineWidth = 2; g.beginPath();
          g.moveTo(x + C / 2, y + 4); g.lineTo(x + C / 2, y + C - 6); g.moveTo(x + C / 2, y + C - 6); g.lineTo(x + 4, y + C - 2); g.moveTo(x + C / 2, y + C - 6); g.lineTo(x + C - 4, y + C - 2);
          g.stroke(); g.fillStyle = '#3a4456'; g.fillRect(x + C / 2 - 2, y + 2, 4, 6);
        }
        g.strokeStyle = 'rgba(255,90,110,.55)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, C - 1, C - 1);
      }
      function drawGear(g, it) {
        var x = cx(it), y = cy(it), pulse = 1.35 + Math.sin(time * 5) * .08;
        g.save(); g.translate(x, y); g.scale(pulse, pulse);
        g.shadowColor = '#FFB547'; g.shadowBlur = 10;
        if (it.kind === 'mic') {
          g.fillStyle = '#c9d1dc'; g.beginPath(); g.arc(0, -3, 5, 0, 7); g.fill();
          g.fillStyle = '#39445a'; g.fillRect(-2, 1, 4, 9);
        } else if (it.kind === 'di') {
          g.fillStyle = '#FFB547'; g.fillRect(-7, -5, 14, 10);
          g.fillStyle = '#10131a'; g.beginPath(); g.arc(-2, 0, 2, 0, 7); g.arc(3, 0, 2, 0, 7); g.fill();
        } else {
          g.fillStyle = '#9B7BFF'; g.fillRect(-5, -7, 10, 13);
          g.strokeStyle = '#c9d1dc'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(3, -7); g.lineTo(5, -12); g.stroke();
        }
        g.restore();
      }
      function drawTape(g, it) {
        var x = cx(it), y = cy(it);
        g.shadowColor = '#8A96A6'; g.shadowBlur = 8;
        g.strokeStyle = '#8f99a8'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 6.5, 0, 7); g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = '#121822'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill();
      }
      function drawLeader(g, l) {
        var x = l.x * C + C / 2, y = l.row * C + C / 2, bob = Math.sin(time * 14) * 1.5;
        g.fillStyle = '#FFB547'; g.shadowColor = '#FFB547'; g.shadowBlur = 12;
        g.beginPath(); g.arc(x, y - 7 + bob, 4.5, 0, 7); g.fill();
        g.fillRect(x - 5, y - 2 + bob, 10, 11);
        g.shadowBlur = 0;
        g.strokeStyle = '#FFB547'; g.lineWidth = 2;   /* a guitar across them */
        g.beginPath(); g.moveTo(x - 7, y + 6 + bob); g.lineTo(x + 8, y - 1 + bob); g.stroke();
      }

      return {
        update: update, draw: draw,
        press: function (d) {
          if (!DIRS[d]) return;
          if (!started) { started = true; if (d !== 'down') dir = d; return; }
          var last = queue.length ? queue[queue.length - 1] : dir;
          var opposite = { up: 'down', down: 'up', left: 'right', right: 'left' }[last];
          if (d !== last && d !== opposite && queue.length < 2) {
            queue.push(d);
            /* NO WAITING FOR THE BEAT (BACKLOG §4: "a slight input delay"):
               a turn pressed past the middle of a step happens now. */
            if (queue.length === 1 && tick > every * .45 && !dead) { tick = 0; step(); }
          }
        },
        stop: function () { dead = true; }
      };
    }
  };
})();
