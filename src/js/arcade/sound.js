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

  var ac = null, master, musicBus, sfxBus, echo, verb, noiseBuf, waves = {};
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
    /* a small room, made of decaying noise */
    verb = ac.createConvolver();
    var len = Math.floor(ac.sampleRate * 1.4), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (var chn = 0; chn < 2; chn++) { var dd = ir.getChannelData(chn); for (var j = 0; j < len; j++) dd[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 3); }
    verb.buffer = ir;
    var verbOut = ac.createGain(); verbOut.gain.value = .35; verb.connect(verbOut); verbOut.connect(musicBus);
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
  var QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7], dim: [0, 3, 6], add9: [0, 4, 7, 14] };
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

  /* ------------------------------------------------------- instruments */
  /* Round 4 (Chase, 2026-10-05: "I love the arcade music on the home
     screen. The other types of music for each game seem very similar to
     each other … I'd like each one to be it's own style of music … the Cue
     Stack game needs to be the most catchy"). The menu keeps its chip
     sound; every game now has its own genre AND its own instruments, which
     is what made them sound alike before: one pulse lead, one triangle
     bass, one chip kit for all of them. */

  /* a synth note: oscillators (unison, detuned) through a filter with its
     own envelope, then an amp envelope; optional echo and reverb */
  function synth(at, freq, dur, o) {
    var n = o.voices || 1, env = ac.createGain(), f = ac.createBiquadFilter();
    f.type = o.filter || 'lowpass'; f.Q.value = o.q || 1;
    var c0 = o.cutoff || 3000, c1 = o.cutTo || c0;
    f.frequency.setValueAtTime(c0, at);
    if (c1 !== c0) f.frequency.exponentialRampToValueAtTime(Math.max(40, c1), at + (o.cutTime || dur));
    for (var k = 0; k < n; k++) {
      var osc = ac.createOscillator();
      if (o.wave) osc.setPeriodicWave(waves[o.wave]); else osc.type = o.type || 'sawtooth';
      osc.frequency.setValueAtTime(freq, at);
      osc.detune.value = n > 1 ? (k / (n - 1) - .5) * (o.spread || 14) : (o.detune || 0);
      if (o.vib) {
        var lfo = ac.createOscillator(), depth = ac.createGain();
        lfo.frequency.value = 5.2; depth.gain.setValueAtTime(0, at); depth.gain.linearRampToValueAtTime(freq * .01, at + .25);
        lfo.connect(depth); depth.connect(osc.frequency); lfo.start(at); lfo.stop(at + dur + .4);
      }
      osc.connect(f); osc.start(at); osc.stop(at + dur + (o.r || .08) * 3 + .05);
    }
    var v = (o.vol || .08) / Math.sqrt(n), a = o.a || .005, r = o.r || .08;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(v, at + a);
    env.gain.setTargetAtTime(v * (o.s == null ? .7 : o.s), at + a, o.d || .1);
    env.gain.setTargetAtTime(0, at + dur, r / 3);
    f.connect(env); env.connect(o.to || musicBus);
    if (o.echo) env.connect(echo.send);
    if (o.verb) { var vs = ac.createGain(); vs.gain.value = o.verb; env.connect(vs); vs.connect(verb); }
  }
  /* What plays the melody, by name */
  var LEAD = {
    pulse: function (at, f, len, t, long) { voice(at, f, len, { wave: t.leadWave || .25, vol: .085, sus: .7, echo: true, vib: long }); voice(at, f, len, { wave: t.leadWave || .25, vol: .05, detune: -9, sus: .7 }); },
    soft: function (at, f, len) { voice(at, f, len, { type: 'triangle', vol: .2, a: .03, sus: .8, dec: .3, rel: .5, echo: true, vib: true }); voice(at, f * 2, len, { type: 'sine', vol: .04, a: .05, sus: .6, rel: .5 }); },
    /* a bright synth lead, two saws */
    saw: function (at, f, len, t, long) { synth(at, f, len, { voices: 2, spread: 12, cutoff: 900, cutTo: 3400, cutTime: .06, q: 2, vol: .075, s: .75, echo: true, vib: long }); },
    /* the hook: a supersaw pluck, the filter snapping shut */
    pluck: function (at, f, len) { synth(at, f, Math.min(len, .5), { voices: 3, spread: 22, cutoff: 5200, cutTo: 700, cutTime: .22, vol: .1, s: .25, d: .12, r: .18, echo: true, verb: .3 });
                                   synth(at, f * 2, Math.min(len, .3), { type: 'square', cutoff: 3000, cutTo: 900, cutTime: .15, vol: .025, s: .2 }); },
    /* a vibraphone / electric piano: sine with a bell on top */
    ep: function (at, f, len) { synth(at, f, len, { type: 'sine', cutoff: 8000, vol: .16, s: .35, d: .35, r: .4, verb: .25 });
                                synth(at, f * 4, .25, { type: 'sine', cutoff: 8000, vol: .035, s: .05, d: .06 }); },
    /* brass: saws whose filter opens as the note speaks */
    /* a soft felt piano: a quick strike, a long fade, the room around it */
    piano: function (at, f, len, t) {
      var v = (t && t.pianoVol) || 1;
      synth(at, f, Math.max(len, 1.6), { type: 'triangle', cutoff: 2600, cutTo: 900, cutTime: .6, a: .004, vol: .11 * v, s: .18, d: .9, r: 1.2, verb: .55 });
      synth(at, f * 2, .5, { type: 'sine', cutoff: 6000, vol: .025 * v, s: .05, d: .3, r: .4, verb: .4 });
    },
    brass: function (at, f, len, t, long) { synth(at, f, len, { voices: 3, spread: 10, cutoff: 500, cutTo: 2600, cutTime: .09, q: 1.5, a: .03, vol: .1, s: .8, vib: long, verb: .15 }); }
  };
  /* The drum kits */
  var KIT = {
    chip: DRUM,
    rock: {
      k: function (at) { voice(at, 160, .2, { type: 'sine', slide: 45, vol: .7, a: .002, sus: .4, dec: .07 }); noise(at, .02, { filter: 'lowpass', freq: 3000, vol: .2 }); },
      s: function (at) { noise(at, .2, { filter: 'bandpass', freq: 2300, q: .7, vol: .38 }); voice(at, 210, .09, { type: 'triangle', slide: 140, vol: .22 }); },
      h: function (at) { noise(at, .04, { freq: 9000, vol: .08 }); },
      o: function (at) { noise(at, .22, { freq: 7500, vol: .07 }); },
      c: function (at) { noise(at, .9, { freq: 5000, vol: .09 }); }
    },
    jazz: {
      k: function (at) { voice(at, 110, .18, { type: 'sine', slide: 50, vol: .35, a: .004, sus: .4 }); },
      s: function (at) { noise(at, .28, { filter: 'lowpass', freq: 3800, vol: .07 }); },          /* a brush */
      h: function (at) { noise(at, .05, { freq: 8000, vol: .04 }); },
      r: function (at) { noise(at, .35, { filter: 'bandpass', freq: 6500, q: 4, vol: .09 }); voice(at, 5200, .3, { type: 'sine', vol: .012, sus: .3 }); },
      o: function (at) { noise(at, .2, { freq: 7000, vol: .04 }); }
    },
    house: {
      k: function (at) { voice(at, 140, .26, { type: 'sine', slide: 40, vol: .8, a: .002, sus: .5, dec: .1 }); },
      s: function (at) { [0, .012, .024].forEach(function (d) { noise(at + d, .09, { filter: 'bandpass', freq: 1500, q: 1.2, vol: .22 }); }); noise(at + .03, .18, { filter: 'bandpass', freq: 1400, q: .8, vol: .12, to: verb }); },   /* a clap */
      h: function (at) { noise(at, .03, { freq: 10000, vol: .06 }); },
      o: function (at) { noise(at, .17, { freq: 8000, vol: .09 }); }
    },
    gated: {
      k: function (at) { voice(at, 130, .3, { type: 'sine', slide: 40, vol: .7, a: .002, sus: .5 }); },
      s: function (at) { noise(at, .32, { filter: 'bandpass', freq: 1800, q: .5, vol: .32 }); noise(at, .45, { filter: 'bandpass', freq: 1600, q: .5, vol: .2, to: verb }); },   /* the big 80s snare */
      h: function (at) { noise(at, .04, { freq: 9000, vol: .05 }); },
      o: function (at) { noise(at, .2, { freq: 8000, vol: .05 }); }
    },
    lofi: {
      k: function (at) { voice(at, 100, .22, { type: 'sine', slide: 45, vol: .45, a: .006, sus: .4 }); },
      s: function (at) { noise(at, .16, { filter: 'lowpass', freq: 2200, vol: .14 }); },
      h: function (at) { noise(at, .03, { filter: 'bandpass', freq: 6000, q: 2, vol: .04 }); },
      o: function (at) { noise(at, .12, { filter: 'bandpass', freq: 5500, q: 2, vol: .04 }); }
    }
  };

  /* ------------------------------------------------------------ tunes */
  /* Each bar: a chord (or two, "C,G"), and the melody as NOTE.LENGTH in
     sixteenths, r for a rest. Every bar adds up to 16. Drum rows: k kick,
     s snare (or clap), h hat (x closed, o open, r ride). `swing` delays the
     off-beats. */
  var TUNES = {
    /* the menu: bright and bouncy, the hidden-arcade theme (unchanged —
       Chase: "I love the arcade music on the home screen") */
    menu: { bpm: 148, vol: .62, bass: 'octave', arp: 'up16', lead: 'pulse', kit: 'chip',
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
    /* Load Out: a folk march in a minor key, an oom-pah bass under it —
       the falling-block puzzle's spirit, an original tune (round 5: the
       blues-rock "vibe" was wrong) */
    loadout: { bpm: 140, bass: 'walk', arp: 'stab', lead: 'pulse', leadWave: .5, kit: 'chip',
      k: 'x.......x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['Em', 'B5.4 G5.2 A5.2 B5.4 A5.2 G5.2'],
        ['B', 'F#5.4 F#5.2 A5.2 B5.4 A5.2 F#5.2'],
        ['Em', 'G5.4 E5.2 G5.2 B5.4 E6.4'],
        ['B7', 'D#6.4 B5.2 A5.2 F#5.8'],
        ['Am', 'C6.4 A5.2 C6.2 E6.4 D6.2 C6.2'],
        ['Em', 'B5.4 G5.2 B5.2 E6.4 D6.2 B5.2'],
        ['B7', 'A5.2 B5.2 C6.2 A5.2 F#5.2 A5.2 D#5.4'],
        ['Em', 'E5.8 r.4 B4.4']] },
    /* Soundcheck: bright arcade pop, the melody bouncing high and low like
       a rally, bell chords off the beat, a clean punchy kit (round 5: the
       synthwave "vibe" was wrong) */
    soundcheck: { bpm: 136, bass: 'octave', arp: 'bellstab', lead: 'pulse', leadWave: .125, kit: 'rock',
      k: 'x.....x.x.......', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', cp: '..x...x...x...x.',
      bars: [
        ['C', 'E6.2 r.2 C6.2 r.2 G6.2 r.2 E6.4'],
        ['G', 'D6.2 r.2 B5.2 r.2 G6.2 r.2 D6.4'],
        ['Am', 'C6.2 r.2 A5.2 r.2 E6.2 r.2 C6.2 D6.2'],
        ['F', 'C6.4 A5.4 F6.4 E6.4'],
        ['C', 'G6.2 r.2 E6.2 r.2 C7.2 r.2 G6.4'],
        ['G', 'B6.2 A6.2 G6.2 F6.2 D6.4 B5.4'],
        ['F', 'A6.2 r.2 F6.2 r.2 C7.4 A6.4'],
        ['G', 'G6.6 F6.2 D6.4 B5.4']] },
    /* Panel Fixer: bossa lounge — a vibraphone, brushes and a ride */
    panelfixer: { bpm: 132, bass: 'bossa', arp: 'bossa', lead: 'ep', kit: 'jazz',
      k: 'x.......x.......', s: '...x..x....x..x.', h: 'r.rr.rr.r.rr.rr.',
      bars: [
        ['Fmaj7', 'A5.3 C6.3 E6.2 D6.4 C6.4'],
        ['Dm7', 'F5.3 A5.3 C6.2 A5.8'],
        ['Gm7', 'Bb5.3 D6.3 F6.2 E6.2 D6.2 Bb5.4'],
        ['C7', 'E6.4 G5.4 Bb5.4 C6.4'],
        ['Fmaj7', 'A5.3 C6.3 E6.2 G6.4 F6.4'],
        ['Bbmaj7', 'D6.3 F6.3 A6.2 G6.4 F6.4'],
        ['Gm7,C7', 'Bb6.4 A6.2 G6.2 E6.4 C6.4'],
        ['Fmaj7', 'F6.12 r.4']] },
    /* Cable Run: drum & bass — a breakbeat, a growling reese bass */
    cablerun: { bpm: 172, bass: 'reese', arp: 'none', lead: 'pluck', kit: 'rock',
      k: 'x.........xx....', s: '....x..x....x..x', h: 'x.xxx.xxx.xxx.xx',
      bars: [
        ['Dm', 'A5.2 r.2 A5.2 D6.2 r.4 C6.2 A5.2'],
        ['Dm', 'F5.4 E5.4 D5.8'],
        ['Bb', 'A5.2 r.2 A5.2 D6.2 r.4 F6.2 E6.2'],
        ['A', 'C#6.8 r.8'],
        ['Dm', 'D6.2 r.2 D6.2 F6.2 r.2 A6.2 G6.2 F6.2'],
        ['Gm', 'G6.4 F6.2 D6.2 Bb5.8'],
        ['Bb', 'F6.2 D6.2 Bb5.2 D6.2 F6.4 A6.4'],
        ['A', 'E6.4 C#6.4 A5.8']] },
    /* Follow Spot: feel-good pop with a light, laid-back groove — soft
       electric-piano chords, a round sub bass, a plucked hook, a lo-fi kit
       (round 7, Chase: the big band was something he'd "hate listening to
       … on repeat for 5 minutes") */
    followspot: { bpm: 100, bass: 'sub', arp: 'epchords', lead: 'pluck', kit: 'lofi',
      k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['G', 'D6.3 B5.3 G5.2 A5.4 B5.4'],
        ['D', 'A5.3 F#5.3 D5.2 E5.4 F#5.4'],
        ['Em7', 'G5.3 B5.3 E6.2 D6.4 B5.4'],
        ['Cmaj7', 'C6.6 B5.2 G5.8'],
        ['G', 'D6.3 B5.3 G5.2 A5.4 B5.4'],
        ['D', 'A5.3 D6.3 F#6.2 E6.4 D6.4'],
        ['Cmaj7', 'E6.4 D6.4 B5.4 C6.4'],
        ['D', 'A5.8 r.8']] },
    /* Strike: heroic space-arcade electro — a saw arpeggio sweeping under
       a bright lead, four on the floor (round 5: the punk "vibe" was wrong) */
    strike: { bpm: 150, bass: 'synth8', arp: 'sawarp', lead: 'saw', kit: 'house',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.',
      bars: [
        ['Am', 'A5.4 C6.4 E6.4 A6.4'],
        ['F', 'G6.4 F6.4 E6.4 C6.4'],
        ['C', 'E6.4 G6.4 C7.4 B6.4'],
        ['G', 'D7.8 B6.8'],
        ['Am', 'A6.4 G6.2 E6.2 A6.4 C7.4'],
        ['F', 'B6.4 A6.4 F6.4 A6.4'],
        ['G', 'G6.4 B6.4 D7.4 G7.4'],
        ['E', 'G#6.8 E6.8']] },
    /* Cue Stack: THE catchy one — an EDM anthem at 128 (the game plays to
       this clock). Four on the floor, pumping supersaw chords, a pluck
       hook built on one repeated rhythm, a lift in the middle eight. */
    cuestack: { bpm: 128, bass: 'pumpbass', arp: 'pump', lead: 'pluck', kit: 'house',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.',
      bars: [
        ['Am', 'E6.2 E6.2 r.1 E6.1 r.2 D6.2 C6.2 D6.2 E6.2'],
        ['F', 'C6.2 C6.2 r.1 C6.1 r.2 A5.2 C6.2 D6.4'],
        ['C', 'E6.2 E6.2 r.1 E6.1 r.2 G6.2 E6.2 D6.2 C6.2'],
        ['G', 'D6.4 B5.4 G5.4 r.4'],
        ['Am', 'E6.2 E6.2 r.1 E6.1 r.2 D6.2 C6.2 D6.2 E6.2'],
        ['F', 'C6.2 C6.2 r.1 C6.1 r.2 A5.2 C6.2 D6.4'],
        ['C', 'E6.2 G6.2 A6.4 G6.2 E6.2 D6.2 C6.2'],
        ['G', 'D6.6 E6.2 D6.8'],
        ['F', 'A6.4 G6.4 E6.4 C6.4'],
        ['G', 'D6.4 E6.4 G6.8'],
        ['Am', 'A6.4 G6.4 E6.4 G6.4'],
        ['G', 'B6.8 D7.8'],
        ['Am', 'E6.2 E6.2 r.1 E6.1 r.2 D6.2 C6.2 D6.2 E6.2'],
        ['F', 'C6.2 C6.2 r.1 C6.1 r.2 A5.2 C6.2 D6.4'],
        ['C', 'E6.2 G6.2 A6.4 G6.2 E6.2 D6.2 C6.2'],
        ['G', 'G6.4 B6.4 D7.8']] },
    /* Stage Runner: disco-funk — octave bass, wah chords, brass hits */
    stagerunner: { bpm: 118, bass: 'disco', arp: 'funk', lead: 'saw', kit: 'house',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.', cp: 'x.xx.x.xx.x.x.xx',
      bars: [
        ['Em7', 'B5.2 D6.2 E6.2 r.2 G6.2 E6.2 D6.2 B5.2'],
        ['A7', 'C#6.2 E6.2 r.2 G6.2 E6.4 r.4'],
        ['Em7', 'B5.2 D6.2 E6.2 r.2 G6.2 A6.2 B6.4'],
        ['A7', 'A6.4 G6.2 E6.2 r.8'],
        ['Dm7', 'A5.2 C6.2 D6.2 r.2 F6.2 D6.2 C6.2 A5.2'],
        ['G7', 'B5.2 D6.2 r.2 F6.2 D6.4 r.4'],
        ['Em7', 'E6.2 G6.2 B6.4 A6.2 G6.2 E6.4'],
        ['A7', 'C#7.4 B6.2 A6.2 E6.8']] },
    /* Golden Hour: the first tune again (round 5: "go back to the other
       music"), warm and slow, the sun going down — and a second half that
       lifts, the festival glowing on the far hills */
    /* Golden Hour: ambient piano, Alto's evening — a slow broken chord, a
       few long notes over it, a soft pad underneath, no drums (round 7,
       Chase: "the music needs to change … I feel like I'm exploring a forest
       in Legend of Zelda") */
    goldenhour: { bpm: 72, vol: .9, bass: 'pad', arp: 'pianoarp', lead: 'piano', kit: 'chip',
      k: '................', s: '................', h: '................',
      bars: [
        ['Dmaj7', 'F#5.6 A5.2 E5.8'],
        ['Bm7', 'D5.6 F#5.2 C#5.8'],
        ['Gmaj7', 'B4.4 D5.4 F#5.8'],
        ['Aadd9', 'E5.12 r.4'],
        ['Dmaj7', 'A5.6 F#5.2 E5.4 D5.4'],
        ['F#m7', 'C#5.8 E5.8'],
        ['Gmaj7', 'D5.4 B4.4 A4.8'],
        ['Aadd9', 'r.16'],
        ['Em7', 'G5.6 B5.2 A5.8'],
        ['Gmaj7', 'F#5.6 D5.2 B4.8'],
        ['Dmaj7', 'A5.4 C#6.4 A5.8'],
        ['Aadd9', 'E5.16'],
        ['Bm7', 'F#5.6 D5.2 C#5.8'],
        ['Gmaj7', 'B4.6 D5.2 F#5.8'],
        ['Em7', 'E5.4 F#5.4 G5.8'],
        ['Aadd9', 'r.16']] },
    /* Cue Stack's other songs (round 7, Chase: "This game should also have
       multiple different songs to choose from. And they all need to be
       bops!!!!"). A funk tune with a horn line, a chugging bass riff and
       wah chords, 112 */
    cuestack_funk: { bpm: 112, bass: 'riff', arp: 'funk', lead: 'brass', kit: 'rock',
      k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.', cp: '..x...x...x..x..',
      bars: [
        ['Em7', 'B5.2 r.1 B5.1 D6.2 E6.2 r.2 D6.1 B5.1 A5.2 B5.2'],
        ['A7', 'C#6.2 r.2 E6.2 C#6.2 r.4 A5.2 B5.2'],
        ['Em7', 'G6.2 r.1 G6.1 F#6.2 E6.2 r.2 D6.2 E6.4'],
        ['A7', 'E6.6 D6.2 C#6.4 A5.4'],
        ['Cmaj7', 'G6.2 r.1 G6.1 E6.2 G6.2 r.2 A6.2 G6.4'],
        ['D', 'F#6.2 r.2 A6.2 F#6.2 D6.4 E6.4'],
        ['Em7', 'B5.2 D6.2 E6.2 G6.2 F#6.2 E6.2 D6.2 B5.2'],
        ['B7', 'D#6.8 F#6.4 r.4']] },
    /* and bright synth pop, a gated snare and a sweeping saw arp, 140 */
    cuestack_synth: { bpm: 140, bass: 'synth8', arp: 'sawarp', lead: 'pulse', leadWave: .25, kit: 'gated',
      k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.',
      bars: [
        ['D', 'F#6.2 A6.2 D7.2 A6.2 F#6.2 A6.2 E6.4'],
        ['A', 'E6.2 A6.2 C#7.2 A6.2 E6.4 r.4'],
        ['Bm', 'D6.2 F#6.2 B6.2 F#6.2 D6.2 F#6.2 A6.4'],
        ['G', 'G6.4 F#6.4 E6.4 D6.4'],
        ['D', 'F#6.2 A6.2 D7.2 A6.2 F#6.2 A6.2 B6.4'],
        ['A', 'C#7.4 B6.2 A6.2 E6.8'],
        ['G', 'B6.2 A6.2 G6.2 F#6.2 G6.4 A6.4'],
        ['A', 'A6.12 r.4']] }
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
  var DISCO = [0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 0, 12, 7, 10];

  function playStep(t, s, at) {
    var bar = t.parsed[Math.floor(s / 16) % t.parsed.length], i = s % 16;
    var ch = bar.chords[bar.chords.length > 1 && i >= 8 ? 1 : 0];
    var dur = stepLen(t);
    /* swing: the off-beats land late */
    if (t.swing) { if (i % 4 === 2) at += t.swing * dur; else if (i % 2 === 1) at += t.swing * dur * .5; }
    /* melody */
    bar.notes.forEach(function (n) {
      if (n.at !== i) return;
      LEAD[t.lead](at, hz(n.n), n.len * dur * .92, t, n.len >= 4);
    });
    var root = ch.root, tones = ch.tones;
    /* bass */
    var b = 36 + root + (root > 5 ? -12 : 0);
    var bp = { octave: i % 2 === 0 ? (i % 4 === 0 ? b : b + 12) : null,
      pump: i % 2 === 0 ? b : null,
      walk: i % 4 === 0 ? b + [0, 7, 12, 7][i / 4] : null,
      offbeat: i % 4 === 2 ? b + 12 : null,
      riff: RIFF[i] == null ? null : b + RIFF[i],
      pad: i === 0 ? b : null,
      sub: i === 0 || i === 10 ? b : null,
      synth8: i % 2 === 0 ? b + (i % 8 === 6 ? 12 : 0) : null,
      bossa: i === 0 || i === 8 ? b : i === 6 || i === 14 ? b + 7 : null,
      reese: i === 0 || i === 10 ? b : null,
      disco: i % 2 === 0 ? b + DISCO[i] : null,
      pumpbass: i % 4 === 2 ? b : null }[t.bass];
    if (bp != null) {
      if (t.bass === 'reese') synth(at, hz(bp), dur * (i === 0 ? 9.5 : 5.5), { voices: 2, spread: 28, cutoff: 380, cutTo: 900, cutTime: dur * 4, q: 3, vol: .2, s: .9, r: .1 });
      else if (t.bass === 'synth8') synth(at, hz(bp), dur * 1.6, { voices: 2, spread: 8, cutoff: 600, cutTo: 300, cutTime: dur * 1.5, vol: .16, s: .6 });
      else if (t.bass === 'disco') { synth(at, hz(bp), dur * 1.4, { type: 'square', cutoff: 1400, cutTo: 400, cutTime: .1, vol: .12, s: .5 }); voice(at, hz(bp), dur * 1.4, { type: 'sine', vol: .14, sus: .7 }); }
      else if (t.bass === 'pumpbass') { synth(at, hz(bp), dur * 1.8, { voices: 2, spread: 10, cutoff: 700, vol: .14, s: .8 }); voice(at, hz(bp - 12), dur * 1.8, { type: 'sine', vol: .22, sus: .8 }); }
      else if (t.bass === 'sub') voice(at, hz(bp), dur * (i === 0 ? 9 : 5.5), { type: 'sine', vol: .3, a: .02, sus: .85, rel: .3 });
      else {
        var bl = t.bass === 'pad' ? dur * 16 : t.bass === 'walk' || t.bass === 'bossa' ? dur * 3.6 : dur * 1.7;
        voice(at, hz(bp), bl, { type: 'triangle', vol: t.bass === 'pad' ? .2 : .26, sus: .8, rel: t.bass === 'pad' ? .8 : .05, a: t.bass === 'pad' ? .2 : .004 });
        voice(at, hz(bp), bl, { type: 'sine', vol: .12, sus: .8, rel: .1 });
      }
    }
    /* the chords: an arpeggio, stabs, power chords, a pad, comping */
    var top = 60 + root, cp = t.cp && t.cp[i] === 'x';
    if (t.arp === 'up16' || (t.arp === 'up8' && i % 2 === 0)) {
      var seq = tones.concat([12]), k = t.arp === 'up16' ? i % seq.length : (i / 2) % seq.length;
      voice(at, hz(top + seq[k]), dur * .8, { wave: .125, vol: .035, sus: .4, dec: .04 });
    } else if (t.arp === 'stab' && (i === 4 || i === 12)) {
      tones.forEach(function (tn) { voice(at, hz(top + tn), dur * 1.4, { wave: .125, vol: .04, sus: .3, dec: .05 }); });
    } else if (t.arp === 'pad' && i === 0) {
      tones.forEach(function (tn) { synth(at, hz(top + tn), dur * 15.5, { voices: 2, spread: 16, cutoff: 1300, a: .35, s: .9, r: .5, vol: .045, verb: .3 }); });
    } else if (t.arp === 'bossa' && '1..1..1...1..1..'[i] === '1') {
      tones.forEach(function (tn) { LEAD.ep(at, hz(top + tn - 12), dur * 1.6); });
    } else if (t.arp === 'brass' && cp) {
      tones.forEach(function (tn) { synth(at, hz(top + tn), dur * 1.4, { voices: 2, spread: 10, cutoff: 700, cutTo: 2200, cutTime: .06, a: .02, vol: .05, s: .7, verb: .15 }); });
    } else if (t.arp === 'pump' && i % 4 === 2) {
      /* the sidechained supersaw: off the beat, swelling */
      tones.concat([12]).forEach(function (tn) { synth(at, hz(top + tn), dur * 1.8, { voices: 3, spread: 24, cutoff: 2600, a: dur * .9, s: .9, r: .05, vol: .05, verb: .2 }); });
    } else if (t.arp === 'funk' && cp) {
      /* wah: the filter sweeping across the bar */
      var wah = 700 + 1800 * (.5 + .5 * Math.sin(i / 16 * Math.PI * 2));
      tones.forEach(function (tn) { synth(at, hz(top + tn), dur * .45, { type: 'square', cutoff: wah, q: 6, vol: .035, s: .3, d: .04 }); });
    } else if (t.arp === 'bellstab' && cp) {
      /* bells off the beat: an electric piano's top */
      tones.forEach(function (tn) { synth(at, hz(top + tn + 12), dur * 1.2, { type: 'sine', cutoff: 8000, vol: .05, s: .2, d: .12, r: .2 }); });
    } else if (t.arp === 'sawarp') {
      /* sixteenths up and down the chord, the filter sweeping across the bar */
      var up = tones.concat([12, tones[1] + 12]), seq2 = up.concat(up.slice(1, -1).reverse());
      var sweep = 900 + 2000 * (.5 + .5 * Math.sin(i / 16 * Math.PI * 2 - Math.PI / 2));
      synth(at, hz(top + seq2[i % seq2.length]), dur * .7, { type: 'sawtooth', cutoff: sweep, q: 4, vol: .032, s: .3, d: .05, echo: true });
    } else if (t.arp === 'pianoarp' && i % 2 === 0) {
      /* a slow broken chord, low to high and back, eighths */
      var pt = tones.length > 3 ? tones : tones.concat([12]);
      var walk = [-12, -5, pt[1], pt[2], pt[3], pt[2], pt[1], -5][i / 2];
      LEAD.piano(at, hz(top + walk), dur * 6, { pianoVol: .55 });
    } else if (t.arp === 'epchords' && (i === 0 || i === 6)) {
      tones.forEach(function (tn) { LEAD.ep(at, hz(top + tn - 12), dur * (i === 0 ? 5.5 : 9.5)); });
    }
    if (t.arp === 'pad' && i % 2 === 0) {
      /* synthwave's arpeggio, quiet under the pad */
      var sq = tones.concat([12]);
      synth(at, hz(top + 12 + sq[(i / 2) % sq.length]), dur * .9, { type: 'square', cutoff: 2200, cutTo: 600, cutTime: .12, vol: .03, s: .2, echo: true });
    }
    /* drums, with a fill on the last bar of the loop */
    var kit = KIT[t.kit] || DRUM;
    var last = Math.floor(s / 16) % t.parsed.length === t.parsed.length - 1 && i >= 12 && t.s.indexOf('x') >= 0;
    if (t.k[i] === 'x') kit.k(at);
    if (t.s[i] === 'x' || (last && i > 12)) kit.s(at);
    if (t.h[i] === 'x') kit.h(at);
    if (t.h[i] === 'o') kit.o(at);
    if (t.h[i] === 'r') (kit.r || kit.h)(at);
    /* a crash on the top of the loop, for the loud ones */
    if (s % (16 * t.parsed.length) === 0 && kit.c) kit.c(at);
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
    /* the echo: a dotted eighth of this tune */
    echo.delay.delayTime.setValueAtTime(60 / TUNES[name].bpm * .75, ac.currentTime);
    nextStep = songStart = ac.currentTime + .06;
    musicBus.gain.cancelScheduledValues(ac.currentTime);
    musicBus.gain.setValueAtTime(level(), ac.currentTime);
    timer = setInterval(schedule, 25); schedule();
  }
  /* each tune's own loudness (round 7, Chase: "the arcade home music is
     louder than the other games"), ducked under the pause */
  function level() { var t = playing && TUNES[playing]; return (ducked ? .18 : .62) * (t && t.vol || 1); }
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
    /* the pause: a bright little run up as it opens, and down as it closes
       (Chase: "an arcadey sound effect for when the pause menu comes up and
       down … like the classic Mario Party games") */
    pausein: function (at) { seq(at, ['C6', 'E6', 'G6', 'C7'], { wave: .25, gap: .045, len: .07, vol: .1 }); voice(at + .18, hz(midi('E7')), .22, { type: 'sine', vol: .08, to: sfxBus, rel: .2 }); },
    pauseout: function (at) { seq(at, ['C7', 'G6', 'E6', 'C6'], { wave: .25, gap: .045, len: .07, vol: .09 }); },
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
    /* for the jukebox: a tune's tempo, and what is playing */
    bpm: function (name) { return TUNES[name] ? TUNES[name].bpm : 0; },
    now: function () { return want; },
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
      if (ac && musicBus) musicBus.gain.setTargetAtTime(level(), ac.currentTime, .12);
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
