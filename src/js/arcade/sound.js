/* =====================================================================
   sound.js — the arcade's music and sounds (ARCADE-SPEC.md §3)
   =====================================================================
   Chase, 2026-10-04: "The arcade section where you choose a game should
   have a tune as well, then you can make the coin sound effect and
   stereotypical arcade sound for starting the game … Do you know Wreck It
   Ralph's arcade style music? That's the feel I want. It may be slightly
   higher res than 8 bit." And: OFF by default, with an easy way to turn it
   on.

   ALL OF IT IS MADE HERE, in the browser, with the Web Audio API: no files
   to download. The voices are the old consoles' — pulse waves at three
   widths, a triangle bass, noise for the drums — and then a little more
   than they could do: the lead doubled a few cents apart and given an
   echo, a soft sine under the bass. That is the "slightly higher res".

   THE TUNES are written below as chords and a melody per bar; the bass,
   the arpeggios and the drums are played from the chords in each tune's
   own style. One for the menu and one per game, each a loop.

   ThaumaSound.on / toggle() / onChange(fn)   the one switch (and M)
   ThaumaSound.music(name)                    a tune, looping (or null)
   ThaumaSound.sfx(name)                      a sound
   ThaumaSound.duck(bool)                     the music down, for pause
   ThaumaSound.beat()                         the tune's clock, for Cue Stack
   ===================================================================== */
(function () {
  'use strict';
  if (window.ThaumaSound) return;

  var KEY = 'thauma.arcade.sound';
  var on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (e) { /* private mode */ }
  var listeners = [];

  var ac = null, master, musicBus, sfxBus, echo, noiseBuf, waves = {};
  function audio() {
    if (ac) return ac;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    var comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    master = ac.createGain(); master.gain.value = .55;
    master.connect(comp); comp.connect(ac.destination);
    musicBus = ac.createGain(); musicBus.gain.value = .62; musicBus.connect(master);
    sfxBus = ac.createGain(); sfxBus.gain.value = .9; sfxBus.connect(master);
    /* the echo on the lead: a dotted eighth, fed back a little */
    echo = { send: ac.createGain(), delay: ac.createDelay(1), fb: ac.createGain(), tone: ac.createBiquadFilter() };
    echo.send.gain.value = .22; echo.fb.gain.value = .3; echo.tone.type = 'lowpass'; echo.tone.frequency.value = 3200;
    echo.send.connect(echo.delay); echo.delay.connect(echo.tone); echo.tone.connect(echo.fb); echo.fb.connect(echo.delay);
    echo.tone.connect(musicBus);
    /* a second of white noise, for every drum */
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    /* pulse waves at the consoles' three widths */
    [.125, .25, .5].forEach(function (duty) {
      var n = 40, re = new Float32Array(n), im = new Float32Array(n);
      for (var k = 1; k < n; k++) {
        re[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
        im[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
      }
      waves[duty] = ac.createPeriodicWave(re, im);
    });
    return ac;
  }

  /* ------------------------------------------------------------ notes */
  var NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(name) {
    var m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!m) return null;
    return NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
  }
  function hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  var QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], dim: [0, 3, 6] };
  function chord(sym) {
    var m = /^([A-G][#b]?)(.*)$/.exec(sym);
    var root = midi(m[1] + '3') % 12;
    return { root: root, tones: QUAL[m[2]] || QUAL[''] };
  }

  /* One voice: an oscillator through an envelope. */
  function voice(at, freq, dur, o) {
    var osc = ac.createOscillator(), env = ac.createGain();
    if (o.wave) osc.setPeriodicWave(waves[o.wave]); else osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(freq, at);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), at + dur);
    if (o.detune) osc.detune.value = o.detune;
    if (o.vib) {
      var lfo = ac.createOscillator(), depth = ac.createGain();
      lfo.frequency.value = 5.5; depth.gain.setValueAtTime(0, at); depth.gain.linearRampToValueAtTime(freq * .012, at + .18);
      lfo.connect(depth); depth.connect(osc.frequency); lfo.start(at); lfo.stop(at + dur + .3);
    }
    var v = o.vol || .1, a = o.a || .004, rel = o.rel || .06;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(v, at + a);
    env.gain.setTargetAtTime(v * (o.sus == null ? .65 : o.sus), at + a, o.dec || .08);
    env.gain.setTargetAtTime(0, at + dur, rel / 3);
    osc.connect(env); env.connect(o.to || musicBus);
    if (o.echo) env.connect(echo.send);
    osc.start(at); osc.stop(at + dur + rel * 2 + .05);
  }
  function noise(at, dur, o) {
    var src = ac.createBufferSource(), f = ac.createBiquadFilter(), env = ac.createGain();
    src.buffer = noiseBuf;
    f.type = o.filter || 'highpass'; f.frequency.value = o.freq || 6000; if (o.q) f.Q.value = o.q;
    var v = o.vol || .1;
    env.gain.setValueAtTime(v, at); env.gain.exponentialRampToValueAtTime(.001, at + dur);
    src.connect(f); f.connect(env); env.connect(o.to || musicBus);
    src.start(at, Math.random() * .5); src.stop(at + dur + .02);
  }
  var DRUM = {
    k: function (at, to) { voice(at, 150, .16, { type: 'sine', slide: 42, vol: .55, a: .002, sus: .5, dec: .06, to: to }); },
    s: function (at, to) { noise(at, .14, { filter: 'bandpass', freq: 1900, q: .8, vol: .28, to: to }); voice(at, 190, .07, { type: 'triangle', slide: 120, vol: .16, to: to }); },
    h: function (at, to) { noise(at, .035, { freq: 8000, vol: .07, to: to }); },
    o: function (at, to) { noise(at, .16, { freq: 7000, vol: .06, to: to }); }
  };

  /* ------------------------------------------------------------ tunes */
  /* Each bar: a chord (or two, "C,G"), and the melody as NOTE.LENGTH in
     sixteenths, r for a rest. Every bar adds up to 16. */
  var TUNES = {
    /* the menu: bright and bouncy, the hidden-arcade theme */
    menu: { bpm: 148, bass: 'octave', arp: 'up16', lead: .25,
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['C', 'E5.2 G5.2 C6.2 G5.2 E5.2 G5.2 C6.4'],
        ['G', 'D6.2 B5.2 G5.2 B5.2 D6.4 r.2 B5.2'],
        ['Am', 'C6.2 A5.2 E5.2 A5.2 C6.2 E6.2 D6.2 C6.2'],
        ['F', 'A5.4 F5.2 A5.2 C6.6 r.2'],
        ['C', 'G5.2 E5.2 G5.2 C6.2 E6.4 D6.2 C6.2'],
        ['G', 'B5.2 D6.2 G6.4 F6.2 E6.2 D6.4'],
        ['F', 'C6.2 A5.2 F5.2 A5.2 C6.2 D6.2 E6.2 F6.2'],
        ['G', 'G6.6 F6.2 E6.2 D6.2 B5.4']] },
    /* Load Out: a heavy groove for heavy cases */
    loadout: { bpm: 116, bass: 'riff', arp: 'stab', lead: .5,
      k: 'x.....x...x.....', s: '....x.......x...', h: '..x...x...x...x.',
      bars: [
        ['Em', 'E5.3 G5.3 A5.2 B5.4 r.4'],
        ['Em', 'D6.2 B5.2 A5.2 G5.2 A5.8'],
        ['C', 'G5.3 E5.3 G5.2 C6.4 B5.4'],
        ['D', 'A5.2 F#5.2 D5.4 r.8'],
        ['Em', 'E5.3 G5.3 A5.2 B5.4 D6.4'],
        ['Em', 'E6.4 D6.2 B5.2 A5.4 G5.4'],
        ['C', 'G5.2 A5.2 B5.2 C6.2 E6.4 D6.4'],
        ['B7', 'D#6.4 B5.4 F#5.4 D#5.4']] },
    /* Soundcheck: fast and electric */
    soundcheck: { bpm: 160, bass: 'octave', arp: 'up16', lead: .25,
      k: 'x...x...x...x...', s: '....x.......x..x', h: 'xxxxxxxxxxxxxxxx',
      bars: [
        ['Am', 'A5.2 C6.2 E6.2 A6.2 G6.2 E6.2 C6.2 E6.2'],
        ['F', 'F6.4 E6.2 C6.2 A5.4 C6.4'],
        ['C', 'G6.2 E6.2 C6.2 E6.2 G6.4 C7.4'],
        ['G', 'B6.4 A6.2 G6.2 D6.4 B5.4'],
        ['Am', 'A5.2 C6.2 E6.2 A6.2 B6.2 A6.2 E6.2 C6.2'],
        ['F', 'F6.2 A6.2 C7.2 A6.2 F6.4 E6.4'],
        ['Dm,E', 'D6.4 F6.4 E6.4 G#6.4'],
        ['E', 'A6.8 E6.4 B5.4']] },
    /* Panel Fixer: playful, a little cheeky */
    panelfixer: { bpm: 136, bass: 'walk', arp: 'up8', lead: .125,
      k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['F', 'C6.1 r.1 A5.1 r.1 F5.2 A5.2 C6.4 F6.4'],
        ['C', 'E6.2 G6.2 E6.2 C6.2 G5.4 r.4'],
        ['Dm', 'F6.2 E6.2 D6.2 A5.2 D6.4 F6.4'],
        ['Bb', 'D6.4 Bb5.2 F5.2 Bb5.4 D6.4'],
        ['F', 'C6.1 r.1 A5.1 r.1 F5.2 A5.2 C6.4 A6.4'],
        ['C', 'G6.2 F6.2 E6.2 D6.2 E6.4 C6.4'],
        ['Bb,C', 'D6.2 F6.2 Bb6.4 A6.2 G6.2 E6.4'],
        ['F', 'F6.8 r.4 C6.2 r.2']] },
    /* Cable Run: driving, like the clock is running */
    cablerun: { bpm: 150, bass: 'pump', arp: 'up16', lead: .25,
      k: 'x..x..x.x..x..x.', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['Dm', 'D6.2 r.2 D6.2 F6.2 A6.4 G6.2 F6.2'],
        ['Dm', 'E6.2 F6.2 D6.4 A5.8'],
        ['Bb', 'Bb5.2 D6.2 F6.2 Bb6.2 A6.4 F6.4'],
        ['C', 'G6.2 E6.2 C6.2 E6.2 G6.8'],
        ['Dm', 'D6.2 r.2 D6.2 F6.2 A6.4 D7.4'],
        ['Dm', 'C7.2 A6.2 F6.2 A6.2 D7.8'],
        ['Bb', 'Bb6.4 A6.2 G6.2 F6.4 D6.4'],
        ['A', 'E6.4 C#6.4 A5.4 E6.4']] },
    /* Follow Spot: showtime */
    followspot: { bpm: 128, bass: 'walk', arp: 'stab', lead: .5,
      k: 'x.......x.......', s: '....x.......x...', h: 'x..xx..xx..xx..x',
      bars: [
        ['Bb', 'F5.3 Bb5.3 D6.2 F6.6 r.2'],
        ['Gm', 'G6.2 F6.2 D6.2 Bb5.2 G5.8'],
        ['Eb', 'Eb6.3 D6.3 C6.2 Bb5.4 G5.4'],
        ['F', 'A5.4 C6.4 F6.8'],
        ['Bb', 'F5.3 Bb5.3 D6.2 F6.4 Bb6.4'],
        ['Gm', 'A6.2 G6.2 F6.2 D6.2 Bb5.8'],
        ['Eb,F', 'G6.4 Eb6.4 A6.4 F6.4'],
        ['Bb', 'Bb6.12 r.4']] },
    /* Strike: rock, loud */
    strike: { bpm: 172, bass: 'pump', arp: 'up16', lead: .25,
      k: 'x.x...x.x.x...x.', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx',
      bars: [
        ['Em', 'B5.2 E6.2 G6.2 B6.2 A6.2 G6.2 E6.4'],
        ['C', 'G6.2 E6.2 C6.2 E6.2 G6.8'],
        ['G', 'D6.2 G6.2 B6.2 D7.2 B6.4 G6.4'],
        ['D', 'A6.2 F#6.2 D6.4 F#6.8'],
        ['Em', 'B5.2 E6.2 G6.2 B6.2 E7.4 D7.4'],
        ['C', 'C7.2 B6.2 G6.2 E6.2 C6.8'],
        ['Am', 'A5.2 C6.2 E6.2 A6.2 G6.4 E6.4'],
        ['B', 'F#6.4 D#6.4 B5.8']] },
    /* Cue Stack: four on the floor, for a rhythm game */
    cuestack: { bpm: 128, bass: 'offbeat', arp: 'stab', lead: .25,
      k: 'x...x...x...x...', s: '....x.......x...', h: '..o...o...o...o.',
      bars: [
        ['Cm', 'G5.2 C6.2 Eb6.2 G6.2 F6.4 Eb6.4'],
        ['Ab', 'C6.4 Eb6.2 Ab6.2 G6.8'],
        ['Eb', 'G6.2 Bb6.2 G6.2 Eb6.2 Bb5.8'],
        ['Bb', 'D6.4 F6.4 Bb6.4 D7.4'],
        ['Cm', 'G5.2 C6.2 Eb6.2 G6.2 F6.4 Eb6.4'],
        ['Ab', 'C6.4 Eb6.2 Ab6.2 G6.8'],
        ['Eb', 'G6.2 Bb6.2 G6.2 Eb6.2 Bb5.8'],
        ['Bb', 'D7.8 C7.4 Bb6.4']] },
    /* Stage Runner: flat out */
    stagerunner: { bpm: 166, bass: 'octave', arp: 'up16', lead: .25,
      k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx',
      bars: [
        ['G', 'D6.2 G6.2 B6.2 D7.2 B6.2 G6.2 D6.4'],
        ['D', 'F#6.2 A6.2 D7.4 C7.2 A6.2 F#6.4'],
        ['Em', 'G6.2 B6.2 E7.4 D7.2 B6.2 G6.4'],
        ['C', 'E6.2 G6.2 C7.4 B6.2 A6.2 G6.4'],
        ['G', 'D6.2 G6.2 B6.2 D7.2 G7.4 F#7.4'],
        ['D', 'E7.2 D7.2 A6.2 F#6.2 D6.8'],
        ['C', 'E6.2 G6.2 C7.2 E7.2 D7.4 C7.4'],
        ['D', 'B6.4 A6.4 F#6.4 A6.4']] },
    /* Golden Hour: slow, warm, the sun going down */
    goldenhour: { bpm: 92, bass: 'pad', arp: 'up8', lead: 'soft',
      k: 'x.........x.....', s: '................', h: '..x...x...x...x.',
      bars: [
        ['D', 'F#5.8 A5.4 E5.4'],
        ['G', 'D5.6 B4.2 D5.8'],
        ['Bm', 'F#5.8 E5.4 D5.4'],
        ['A', 'C#5.12 r.4'],
        ['D', 'F#5.4 A5.4 D6.8'],
        ['G', 'B5.6 A5.2 G5.8'],
        ['Em', 'E5.4 F#5.4 G5.4 B5.4'],
        ['A', 'A5.16']] }
  };
  /* Parsed once: per bar, the chords by sixteenth and the melody's notes. */
  Object.keys(TUNES).forEach(function (k) {
    var t = TUNES[k];
    t.parsed = t.bars.map(function (b) {
      var chords = b[0].split(',').map(chord), notes = [], at = 0;
      b[1].split(/\s+/).forEach(function (tok) {
        var p = tok.split('.'), len = +p[1];
        if (p[0] !== 'r') notes.push({ at: at, len: len, n: midi(p[0]) });
        at += len;
      });
      return { chords: chords, notes: notes };
    });
  });

  /* ------------------------------------------------------- the player */
  var want = null, playing = null, songStart = 0, nextStep = 0, step = 0, timer = 0, ducked = false;
  function stepLen(t) { return 60 / t.bpm / 4; }
  /* Load Out's bass: the root, chugging, with a lift to the fifth */
  var RIFF = [0, null, 0, null, 0, 7, 7, null, 0, null, 0, null, 5, 3, null, 0];

  function playStep(t, s, at) {
    var bar = t.parsed[Math.floor(s / 16) % t.parsed.length], i = s % 16;
    var ch = bar.chords[bar.chords.length > 1 && i >= 8 ? 1 : 0];
    var dur = stepLen(t);
    /* melody */
    bar.notes.forEach(function (n) {
      if (n.at !== i) return;
      var f = hz(n.n), len = n.len * dur * .92;
      if (t.lead === 'soft') {
        voice(at, f, len, { type: 'triangle', vol: .2, a: .03, sus: .8, dec: .3, rel: .5, echo: true, vib: true });
        voice(at, f * 2, len, { type: 'sine', vol: .04, a: .05, sus: .6, rel: .5 });
      } else {
        voice(at, f, len, { wave: t.lead, vol: .085, sus: .7, echo: true, vib: n.len >= 4 });
        voice(at, f, len, { wave: t.lead, vol: .05, detune: -9, sus: .7 });
      }
    });
    var root = ch.root, tones = ch.tones;
    /* bass */
    var b = 36 + root + (root > 5 ? -12 : 0);
    var bp = { octave: i % 2 === 0 ? (i % 4 === 0 ? b : b + 12) : null,
      pump: i % 2 === 0 ? b : null,
      walk: i % 4 === 0 ? b + [0, 7, 12, 7][i / 4] : null,
      offbeat: i % 4 === 2 ? b + 12 : null,
      riff: RIFF[i] == null ? null : b + RIFF[i],
      pad: i === 0 ? b : null }[t.bass];
    if (bp != null) {
      var bl = t.bass === 'pad' ? dur * 16 : t.bass === 'walk' ? dur * 3.6 : dur * 1.7;
      voice(at, hz(bp), bl, { type: 'triangle', vol: t.bass === 'pad' ? .2 : .26, sus: .8, rel: t.bass === 'pad' ? .8 : .05, a: t.bass === 'pad' ? .2 : .004 });
      voice(at, hz(bp), bl, { type: 'sine', vol: .12, sus: .8, rel: .1 });
    }
    /* arpeggio, or chord stabs */
    var top = 60 + root;
    if (t.arp === 'up16' || (t.arp === 'up8' && i % 2 === 0)) {
      var seq = tones.concat([12]), k = t.arp === 'up16' ? i % seq.length : (i / 2) % seq.length;
      voice(at, hz(top + seq[k]), dur * .8, { wave: .125, vol: t.lead === 'soft' ? .025 : .035, sus: .4, dec: .04 });
    } else if (t.arp === 'stab' && (i === 4 || i === 12 || (t.bass === 'offbeat' && i % 4 === 2))) {
      tones.forEach(function (tn) { voice(at, hz(top + tn), dur * 1.4, { wave: .125, vol: .04, sus: .3, dec: .05 }); });
    }
    /* drums, with a fill on the last bar of the loop */
    var last = Math.floor(s / 16) % t.parsed.length === t.parsed.length - 1 && i >= 12 && t.s.indexOf('x') >= 0;
    if (t.k[i] === 'x') DRUM.k(at);
    if (t.s[i] === 'x' || (last && i > 12)) DRUM.s(at);
    if (t.h[i] === 'x') DRUM.h(at);
    if (t.h[i] === 'o') DRUM.o(at);
  }

  function schedule() {
    var t = playing && TUNES[playing];
    if (!t || !ac) return;
    while (nextStep < ac.currentTime + .14) {
      playStep(t, step, nextStep);
      nextStep += stepLen(t); step++;
    }
  }
  function startTune(name) {
    stopTune();
    if (!on || !name || !TUNES[name] || !audio()) return;
    playing = name; step = 0;
    nextStep = songStart = ac.currentTime + .06;
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setValueAtTime(ducked ? .18 : .62, ac.currentTime);
    timer = setInterval(schedule, 25); schedule();
  }
  function stopTune() { clearInterval(timer); timer = 0; playing = null; }

  /* ------------------------------------------------------------ sounds */
  function seq(at, notes, o) {
    notes.forEach(function (n, k) { voice(at + k * (o.gap || .06), hz(midi(n)), o.len || .08, Object.assign({ to: sfxBus }, o)); });
  }
  var SFX = {
    /* the coin: the two notes every arcade has */
    coin: function (at) { voice(at, hz(midi('B5')), .07, { wave: .5, vol: .16, to: sfxBus, sus: .9 }); voice(at + .07, hz(midi('E6')), .4, { wave: .5, vol: .16, to: sfxBus, sus: .7, dec: .15, rel: .2 }); },
    /* PLAYER 1 START: the jingle */
    start: function (at) { seq(at, ['C5', 'E5', 'G5', 'C6', 'E6', 'G6'], { wave: .25, gap: .055, len: .07, vol: .12 }); voice(at + .36, hz(midi('C7')), .5, { wave: .25, vol: .12, to: sfxBus, vib: true, rel: .25 }); },
    ready: function (at) { voice(at, hz(midi('G5')), .09, { wave: .5, vol: .1, to: sfxBus }); },
    go: function (at) { ['C6', 'E6', 'G6'].forEach(function (n) { voice(at, hz(midi(n)), .28, { wave: .25, vol: .08, to: sfxBus, rel: .15 }); }); },
    move: function (at) { voice(at, 1200, .03, { wave: .5, vol: .06, to: sfxBus, sus: .2 }); },
    back: function (at) { voice(at, 600, .08, { wave: .5, vol: .07, to: sfxBus, slide: 300 }); },
    drop: function (at) { voice(at, 520, .18, { wave: .25, vol: .08, to: sfxBus, slide: 180 }); },
    thud: function (at, o) { var v = (o && o.vol) || 1; voice(at, 110, .2, { type: 'sine', slide: 40, vol: .5 * v, to: sfxBus }); noise(at, .12, { filter: 'lowpass', freq: 600, vol: .25 * v, to: sfxBus }); },
    hit: function (at) { voice(at, 880, .05, { wave: .5, vol: .1, to: sfxBus, sus: .5 }); },
    wall: function (at) { voice(at, 440, .04, { wave: .5, vol: .07, to: sfxBus, sus: .5 }); },
    point: function (at) { seq(at, ['E6', 'B6'], { wave: .25, gap: .07, len: .09, vol: .1 }); },
    miss: function (at) { voice(at, 440, .35, { wave: .5, vol: .1, to: sfxBus, slide: 110 }); },
    powerup: function (at) { seq(at, ['C6', 'E6', 'G6', 'C7', 'E7'], { wave: .125, gap: .04, len: .06, vol: .1 }); },
    powerdown: function (at) { voice(at, 700, .4, { wave: .25, vol: .1, to: sfxBus, slide: 120, vib: true }); },
    fix: function (at) { seq(at, ['G6', 'D7', 'G7'], { type: 'triangle', gap: .05, len: .12, vol: .14 }); },
    break: function (at) { noise(at, .25, { filter: 'bandpass', freq: 3200, q: 2, vol: .22, to: sfxBus }); voice(at, 300, .15, { wave: .125, vol: .07, to: sfxBus, slide: 80 }); },
    jump: function (at) { voice(at, 260, .16, { wave: .25, vol: .09, to: sfxBus, slide: 760 }); },
    slide: function (at) { noise(at, .22, { filter: 'bandpass', freq: 1400, q: 1, vol: .14, to: sfxBus }); },
    collect: function (at) { voice(at, hz(midi('E7')), .06, { wave: .5, vol: .07, to: sfxBus, sus: .6 }); voice(at + .05, hz(midi('A7')), .1, { wave: .5, vol: .06, to: sfxBus }); },
    crash: function (at) { noise(at, .5, { filter: 'lowpass', freq: 1800, vol: .4, to: sfxBus }); voice(at, 180, .35, { wave: .5, vol: .12, to: sfxBus, slide: 50 }); },
    cheer: function (at) { noise(at, .9, { filter: 'bandpass', freq: 2200, q: .6, vol: .12, to: sfxBus }); },
    flip: function (at) { noise(at, .18, { filter: 'bandpass', freq: 900, q: 1.5, vol: .12, to: sfxBus }); },
    grind: function (at) { noise(at, .12, { filter: 'bandpass', freq: 5200, q: 4, vol: .07, to: sfxBus }); },
    combo: function (at) { seq(at, ['A6', 'E7'], { wave: .25, gap: .05, len: .07, vol: .09 }); },
    perfect: function (at) { voice(at, hz(midi('C7')), .09, { wave: .25, vol: .08, to: sfxBus }); },
    good: function (at) { voice(at, hz(midi('G6')), .07, { wave: .25, vol: .06, to: sfxBus }); },
    whiff: function (at) { noise(at, .08, { filter: 'lowpass', freq: 900, vol: .1, to: sfxBus }); },
    zap: function (at) { voice(at, 1800, .12, { wave: .125, vol: .08, to: sfxBus, slide: 200 }); },
    boom: function (at) { noise(at, .8, { filter: 'lowpass', freq: 900, vol: .5, to: sfxBus }); voice(at, 90, .6, { type: 'sine', slide: 30, vol: .5, to: sfxBus }); },
    gameover: function (at) { seq(at, ['G5', 'E5', 'C5', 'G4'], { wave: .5, gap: .16, len: .18, vol: .11 }); },
    newbest: function (at) { seq(at, ['C6', 'C6', 'C6', 'G6', 'E6', 'G6', 'C7'], { wave: .25, gap: .09, len: .1, vol: .11 }); }
  };

  /* ------------------------------------------------------ waking it up */
  /* Phones only let sound start inside a touch (Chase, 2026-10-05: "The
     music also didn't work on mobile"). So every touch, click or key,
     while the sound is on, wakes the audio inside that very gesture — a
     resume plus one silent sample, which is what iOS counts. And an
     iPhone's silent switch mutes Web Audio unless the page says it is
     playing media: audioSession 'playback' where Safari has it (17+), and
     before that the old way, a silent <audio> loop, which moves the page
     onto the media channel. Coming back to the tab (iOS leaves it
     'interrupted' after a call or a lock) wakes it too. */
  var silent = null;
  function silentLoop() {
    if (silent || navigator.audioSession || !/iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
    var n = 2205, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    var w = function (o, str) { for (var i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true);
    v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    silent = document.createElement('audio');
    silent.setAttribute('x-webkit-airplay', 'deny'); silent.preload = 'auto'; silent.loop = true;
    silent.src = URL.createObjectURL(new Blob([b], { type: 'audio/wav' }));
  }
  function wake() {
    if (!on || !audio()) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    silentLoop();
    if (silent && silent.paused) { var pr = silent.play(); if (pr && pr.catch) pr.catch(function () {}); }
    if (ac.state !== 'running') ac.resume();
    var src = ac.createBufferSource();
    src.buffer = ac.createBuffer(1, 1, 22050); src.connect(ac.destination); src.start(0);
  }
  ['pointerdown', 'touchend', 'click', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { if (on && (!ac || ac.state !== 'running' || (silent && silent.paused))) wake(); }, { capture: true, passive: true });
  });
  document.addEventListener('visibilitychange', function () {
    if (!ac || !on) return;
    if (document.hidden) { if (silent) silent.pause(); }
    else if (ac.state !== 'running') ac.resume();
  });

  /* ---------------------------------------------------------- the API */
  function set(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* private mode */ }
    if (on) { wake(); startTune(want); }
    else { stopTune(); if (silent) silent.pause(); if (ac && ac.state === 'running') ac.suspend(); }
    listeners.forEach(function (fn) { fn(on); });
  }

  window.ThaumaSound = {
    get on() { return on; },
    toggle: function () { set(!on); if (on) this.sfx('coin'); },
    set: set,
    onChange: function (fn) { listeners.push(fn); },
    music: function (name) {
      if (name === want && playing === name) return;
      want = name || null;
      startTune(want);
    },
    sfx: function (name, o) {
      if (!on || !SFX[name] || !audio()) return;
      if (ac.state !== 'running') ac.resume();
      SFX[name](ac.currentTime + .01, o);
    },
    duck: function (d) {
      ducked = !!d;
      if (ac && musicBus) musicBus.gain.setTargetAtTime(ducked ? .18 : .62, ac.currentTime, .12);
    },
    /* Where the tune is: { t: seconds since its first beat, bpm }, or null
       when nothing is playing. Cue Stack plays to it. */
    beat: function () {
      if (!on || !playing || !ac) return null;
      var lat = (ac.outputLatency || ac.baseLatency || 0);
      return { t: ac.currentTime - songStart - lat, bpm: TUNES[playing].bpm };
    },
    tunes: Object.keys(TUNES)
  };
})();
