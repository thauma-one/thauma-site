/* =====================================================================
   Cue Stack — call the show (ARCADE-SPEC.md §4)
   =====================================================================
   Chase, 2026-09-30: "Cue Stack (4 lanes): top to bottom, rhythm-style."
   And 2026-10-04: build the out-of-order ones.

   The four lanes are the four departments a show caller cues: LIGHTS,
   SOUND, VIDEO and PYRO. Cues fall down the stack to the GO line; hit
   their lane as they cross it. Each one you land fires on the stage above
   the stack — a wash of light, the speakers kicking, the screen changing,
   a flame — so a good run looks like a good show. Long cues are held.

   It plays to the cabinet's own tune when the sound is on (sound.js
   beat()), and to its own clock when it is off; the chart is the same.

   Perfect is close, good is near, a miss drains the house. Keep the house
   and the show goes on, faster every few bars. D F J K or ← ↓ ↑ →; on a
   phone, four pads.
   ===================================================================== */
(function () {
  'use strict';
  var A = window.ThaumaArcade;
  if (!A) return;

  var W = 360, H = 600, BPM = 128, SPB = 60 / BPM;
  var LINE = H - 70, TOP = 150;
  var COLS = ['#9B7BFF', '#2FD8FF', '#5CF2C4', '#FFB547'];
  var LANES = ['lights', 'sound', 'video', 'pyro'];
  /* HOW HARD (round 4, Chase: "Cue stack need to get harder faster. And
     having different difficulty levels would be good"): how fast the cues
     fall (px a beat), how many bars before a busier pattern joins (it was
     7 for everyone), which pattern it starts on, the timing windows (s),
     and what a miss costs the house. */
  var DIFF = {
    easy:   { px: 115, every: 6, start: 0, win: [.06, .12, .18], drain: .06,  col: '#5CF2C4' },
    normal: { px: 145, every: 3, start: 1, win: [.05, .1, .16],  drain: .085, col: '#FFB547' },
    hard:   { px: 180, every: 2, start: 3, win: [.04, .08, .13], drain: .1,   col: '#FF5A6E' }
  };
  var LEVELS = ['easy', 'normal', 'hard'];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  A.games.cuestack = {
    size: { w: W, h: H },
    controls: 'lanes',
    speaker: 'SM',
    create: function (ctx) {
      var words = ctx.words;
      var notes = [], chartTo = 0, clock = 0, house = 1, combo = 0, best = 0, score = 0, time = 0;
      var judge = null, fired = [0, 0, 0, 0], laneFlash = [0, 0, 0, 0], held = [null, null, null, null];
      var lastBeat = 0, wallAt = performance.now(), level = null, D = DIFF.normal, barBase = 0;
      function choose(l) {
        if (level) return;
        level = l; D = DIFF[l]; ctx.sfx('go');
        /* two bars to listen first, from the next bar line */
        chartTo = Math.ceil(clock / 4) * 4 + 8; barBase = chartTo / 4;
        ctx.say(words('diff_' + l), { tag: 'SM' });
      }

      /* THE CHART: bars of four beats, written from patterns, busier as
         the show goes on; never two cues on one lane closer than a half
         beat, never more than two at once. */
      var PAT = [
        [[0, 1], [2, 2]],
        [[0, 0], [1, 1], [2, 2], [3, 3]],
        [[0, 0], [2, 1], [1, 2], [3, 3], [3.5, 2]],
        [[0, 0], [0, 3], [1, 1], [2, 2], [2.5, 1], [3, 0]],
        [[0, 1], [.5, 2], [1, 1], [1.5, 2], [2, 0], [3, 3]],
        [[0, 0, 2], [2, 3], [3, 1]],
        [[0, 3], [1, 2], [1.5, 1], [2, 0], [2.5, 1], [3, 2], [3.5, 3]],
        [[0, 1, 1.5], [2, 2, 1.5], [3.5, 0]],
        [[0, 0], [.5, 1], [1, 2], [1.5, 3], [2, 2], [2.5, 1], [3, 0], [3, 3]]
      ];
      function chart(toBeat) {
        while (chartTo < toBeat) {
          var bar = Math.floor(chartTo / 4), lvl = Math.min(PAT.length - 1, D.start + Math.floor((bar - barBase) / D.every));
          /* mostly the newest patterns, now and then an easier one for breath */
          var p = PAT[Math.random() < .7 ? Math.max(0, lvl - Math.floor(Math.random() * 2)) : Math.floor(Math.random() * (lvl + 1))];
          var shift = Math.floor(Math.random() * 4);
          p.forEach(function (n) {
            notes.push({ beat: chartTo + n[0], lane: (n[1] + shift) % 4, len: n[2] || 0, state: 'wait' });
          });
          chartTo += 4;
        }
      }

      /* where the show is, in beats: the tune's clock when there is one,
         nudged toward it gently so nothing jumps; our own when not */
      function beatNow(dt) {
        clock += dt / SPB;
        var S = window.ThaumaSound, b = S && S.beat && S.beat();
        if (b && b.bpm === BPM) {
          var audio = b.t / SPB, d = audio - clock;
          var phase = d - Math.round(d);                        /* keep the beat, whatever bar the tune is on */
          clock += phase * Math.min(1, dt * 6);
        }
        return clock;
      }

      function update(dt) {
        time += dt;
        /* back from a pause: the cues that went by while away just go */
        var now = performance.now(), gap = (now - wallAt) / 1000; wallAt = now;
        var beat = beatNow(dt);
        if (!level) return;
        chart(beat + 12);
        notes.forEach(function (n) {
          if (gap > .4 && n.state === 'wait' && n.beat < beat) n.state = 'gone';
          if (n.state === 'wait' && (beat - n.beat) * SPB > D.win[2]) miss(n);
          if (n.state === 'hold') {
            if (!held[n.lane]) { n.state = 'gone'; combo = 0; }
            else if (beat >= n.beat + n.len) { n.state = 'done'; score += 20; ctx.score(score); fire(n.lane); }
            else { score += dt * 10; }
          }
        });
        notes = notes.filter(function (n) { return n.state === 'wait' || n.state === 'hold' || (beat - n.beat) < 2; });
        fired = fired.map(function (f) { return Math.max(0, f - dt * 2.2); });
        laneFlash = laneFlash.map(function (f) { return Math.max(0, f - dt * 5); });
        if (judge) { judge.t -= dt; if (judge.t <= 0) judge = null; }
        if (Math.floor(beat / 32) > Math.floor(lastBeat / 32) && beat > 40) ctx.quip('jokes_cuestack_show', { mood: 'good', chance: .7 });
        lastBeat = beat;
        ctx.score(Math.floor(score));
      }
      function miss(n) {
        n.state = 'gone'; combo = 0; house -= D.drain;
        judge = { text: words('cuestack_miss'), col: '#FF5A6E', t: .5 };
        ctx.sfx('whiff');
        if (house <= .3) ctx.quip('jokes_cuestack_miss', { mood: 'bad' });
        if (house <= 0) { house = 0; ctx.sfx('gameover'); setTimeout(function () { ctx.over(); }, 600); update = function () {}; }
      }
      function press(lane) {
        laneFlash[lane] = 1;
        var beat = clock, best = null;
        notes.forEach(function (n) {
          if (n.state !== 'wait' || n.lane !== lane) return;
          var off = Math.abs(n.beat - beat) * SPB;
          if (off <= D.win[2] && (!best || off < best.off)) best = { n: n, off: off };
        });
        if (!best) return;                                       /* a press on nothing costs nothing */
        var n = best.n, perfect = best.off <= D.win[0], good = best.off <= D.win[1];
        if (!good) { miss(n); return; }
        combo++; if (combo > bestCombo) bestCombo = combo;
        var mult = combo >= 25 ? 3 : combo >= 10 ? 2 : 1;
        /* round 4: the same pace as the other games (was 300/120, ×4) */
        score += (perfect ? 5 : 2) * mult;
        house = Math.min(1, house + .02);
        judge = { text: words(perfect ? 'cuestack_perfect' : 'cuestack_good'), col: perfect ? '#5CF2C4' : '#FFB547', t: .45 };
        ctx.sfx(perfect ? 'perfect' : 'good');
        fire(lane);
        if (n.len) { n.state = 'hold'; } else n.state = 'done';
        if (combo === 50) ctx.quip('jokes_cuestack_combo', { mood: 'good', force: true });
      }
      var bestCombo = 0;
      function fire(lane) { fired[lane] = 1; }

      /* ------------------------------------------------------ drawing */
      function draw(g) {
        g.fillStyle = '#07080f'; g.fillRect(-20, -20, W + 40, H + 40);
        stage(g);
        if (!level) return ctx.cards(g, words('diff_pick'), LEVELS.map(function (l, i) {
          return { title: words('diff_' + l), line: words('diff_' + l + '_line'), key: ['←', '↓ ↑', '→'][i], col: DIFF[l].col };
        }), time);
        var beat = clock, lw = W / 4;
        /* the stack */
        for (var l = 0; l < 4; l++) {
          g.fillStyle = l % 2 ? 'rgba(255,255,255,.025)' : 'rgba(255,255,255,.012)'; g.fillRect(l * lw, TOP, lw, H - TOP);
          if (laneFlash[l] > 0) { var gr = g.createLinearGradient(0, LINE, 0, TOP); gr.addColorStop(0, hexA(COLS[l], .35 * laneFlash[l])); gr.addColorStop(1, hexA(COLS[l], 0)); g.fillStyle = gr; g.fillRect(l * lw, TOP, lw, LINE - TOP); }
        }
        /* beat lines */
        for (var b = Math.ceil(beat); b < beat + 5; b++) {
          var y = LINE - (b - beat) * D.px; if (y < TOP) break;
          g.fillStyle = b % 4 === 0 ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.04)'; g.fillRect(0, y, W, 1);
        }
        /* the GO line, pulsing on the beat */
        var pulse = 1 - (beat - Math.floor(beat));
        g.fillStyle = 'rgba(255,255,255,' + (.35 + .3 * pulse) + ')'; g.fillRect(0, LINE - 1, W, 3);
        for (var k = 0; k < 4; k++) {
          g.strokeStyle = COLS[k]; g.lineWidth = 2; g.globalAlpha = .5 + laneFlash[k] * .5;
          g.strokeRect(k * lw + 8, LINE - 12, lw - 16, 24); g.globalAlpha = 1;
          g.fillStyle = 'rgba(138,150,166,.8)'; g.font = '600 8px Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
          g.fillText(words('cuestack_' + LANES[k]).toUpperCase(), k * lw + lw / 2, LINE + 18);
          if (!ctx.touch) g.fillText('DFJK'[k], k * lw + lw / 2, LINE + 30);
        }
        /* the cues */
        notes.forEach(function (n) {
          if (n.state === 'done' || n.state === 'gone') return;
          var y = LINE - (n.beat - beat) * D.px, x = n.lane * lw;
          if (n.len) {
            var y2 = LINE - (n.beat + n.len - beat) * D.px;
            g.fillStyle = hexA(COLS[n.lane], n.state === 'hold' ? .6 : .3); g.fillRect(x + lw / 2 - 7, Math.max(TOP, y2), 14, Math.min(LINE, y) - Math.max(TOP, y2));
            if (n.state === 'hold') y = LINE;
          }
          if (y < TOP - 10 || y > H) return;
          g.fillStyle = COLS[n.lane]; g.shadowColor = COLS[n.lane]; g.shadowBlur = 10;
          round(g, x + 10, y - 9, lw - 20, 18, 5); g.fill(); g.shadowBlur = 0;
          g.fillStyle = 'rgba(0,0,0,.45)'; g.font = '700 9px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('GO', x + lw / 2, y + 1);
        });
        /* the house, the combo, the call */
        g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(12, TOP - 14, W - 24, 5);
        g.fillStyle = house > .5 ? '#5CF2C4' : house > .25 ? '#FFB547' : '#FF5A6E'; g.fillRect(12, TOP - 14, (W - 24) * house, 5);
        g.fillStyle = 'rgba(138,150,166,.8)'; g.font = '600 8px Inter, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
        g.fillText(words('cuestack_house').toUpperCase(), 12, TOP - 18);
        if (combo > 1) { g.textAlign = 'right'; g.fillStyle = '#EDF2F8'; g.font = '700 13px Sora, sans-serif'; g.fillText(combo + ' ' + words('cuestack_combo').toUpperCase(), W - 12, TOP - 18); }
        if (judge) { g.globalAlpha = Math.min(1, judge.t * 3); g.fillStyle = judge.col; g.font = '700 22px Sora, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(judge.text.toUpperCase(), W / 2, LINE - 70); g.globalAlpha = 1; }
      }
      /* THE SHOW the cues are firing: a little stage over the stack */
      function stage(g) {
        var h = TOP - 30, beat = clock;
        g.fillStyle = '#0c0b14'; g.fillRect(0, 0, W, h);
        /* video wall */
        var v = fired[2];
        g.fillStyle = v > 0 ? 'hsl(' + (Math.floor(beat) * 47 % 360) + ',70%,' + (18 + v * 30) + '%)' : '#141322';
        g.fillRect(W / 2 - 70, 14, 140, 56);
        g.fillStyle = 'rgba(0,0,0,.35)'; for (var i = 1; i < 7; i++) g.fillRect(W / 2 - 70 + i * 20, 14, 1, 56);
        /* lights: beams from the truss */
        g.strokeStyle = '#1f2533'; g.beginPath(); g.moveTo(0, 8); g.lineTo(W, 8); g.stroke();
        for (var k = 0; k < 5; k++) {
          var a = fired[0], x = 30 + k * 75;
          if (a > 0) {
            g.save(); g.translate(x, 8); g.rotate(Math.sin(beat * Math.PI / 2 + k) * .4);
            var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, hexA('#9B7BFF', .5 * a)); gr.addColorStop(1, hexA('#9B7BFF', 0));
            g.fillStyle = gr; g.beginPath(); g.moveTo(-3, 0); g.lineTo(3, 0); g.lineTo(26, h); g.lineTo(-26, h); g.closePath(); g.fill(); g.restore();
          }
          g.fillStyle = a > 0 ? '#c9b8ff' : '#2a2638'; g.fillRect(x - 4, 6, 8, 6);
        }
        /* speakers kick */
        var s = fired[1];
        [[14, 40], [W - 44, 40]].forEach(function (p) {
          g.fillStyle = '#151320'; g.fillRect(p[0], p[1], 30, 60);
          g.fillStyle = '#2FD8FF'; g.globalAlpha = .25 + s * .6;
          g.beginPath(); g.arc(p[0] + 15, p[1] + 40, 9 + s * 3, 0, 7); g.fill(); g.globalAlpha = 1;
        });
        /* pyro */
        var f = fired[3];
        if (f > 0) [70, W - 70].forEach(function (x) {
          var gr2 = g.createLinearGradient(0, h, 0, h - 90 * f); gr2.addColorStop(0, 'rgba(255,120,40,.9)'); gr2.addColorStop(1, 'rgba(255,240,180,0)');
          g.fillStyle = gr2; g.beginPath(); g.moveTo(x - 10, h); g.quadraticCurveTo(x + Math.sin(time * 40) * 6, h - 50 * f, x, h - 90 * f); g.quadraticCurveTo(x - Math.sin(time * 33) * 6, h - 50 * f, x + 10, h); g.fill();
        });
        /* the band, and the crowd's hands on the beat */
        g.fillStyle = '#0a0910'; g.fillRect(0, h - 10, W, 10);
        for (var c = 0; c < 40; c++) { var up = Math.max(0, Math.sin((beat * Math.PI) + c)) * 5; g.fillStyle = '#07060c'; g.fillRect(c * 9, h - 8 - up, 6, 8 + up); }
      }
      function hexA(hex, a) { var n = parseInt(hex.slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')'; }
      function round(g, x, y, w, h, r) {
        g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
        g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
      }

      return {
        update: function (dt) { update(dt); }, draw: draw,
        press: function (d) {
          var m = /^l(\d)$/.exec(d); if (!m) return;
          /* the choice: the left lane easy, the middle two normal, the right hard */
          if (!level) { choose(LEVELS[[0, 1, 1, 2][+m[1]]]); return; }
          held[+m[1]] = true; press(+m[1]);
        },
        tapAt: function (x, y) {
          if (level) return false;
          var i = ctx.cardAt(x, y); if (i >= 0) { choose(LEVELS[i]); return true; }
          return false;
        },
        release: function (d) { var m = /^l(\d)$/.exec(d); if (m) held[+m[1]] = null; },
        stop: function () {}
      };
    }
  };
})();
