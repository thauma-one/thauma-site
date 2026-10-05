/* =====================================================================
   fail.js — the page fails, for real (ARCADE-SPEC.md §2)
   =====================================================================
   Chase, 2026-09-29: "as you get closer to entering, things start to
   'fail' and glitch more until finally everything falls apart … in
   general, the entire thing feels like an overlay and not like the page
   itself is being glitched."

   SO NOTHING HERE IS DRAWN ON TOP. Every effect moves, splits, recolors or
   tears an element the page already has: its headings' own letters slip,
   its own links lose their line, its own two voices (--blue, --foam) trade
   places, its own photos tear. The one exception is the last beat — the
   screen itself switching off like an old CRT — because by then there is
   no page left to act on.

   FOUR STAGES, then the collapse, escalating fast (Chase, 2026-10-03:
   "1st: did I just see something? 2nd: noticeable; then Woah!"): one
   blink; slipping letters and drifting links; the voices swapping, the big
   words splitting into red and cyan, the picture lurching; then tearing —
   the photos and whole sections sliding in bands. A door calls progress(door, 1..4); each
   stage adds to the ones before it. Stop, and the page HEALS: everything
   snaps back after a moment, which is what keeps it from overstaying ("some
   elements are up long enough … to not be worth it") and makes the site feel
   like it is fighting back.

   Loaded by doors.js on the first sign of intent; exposes window.ThaumaFail.
   Reduced motion: no stage does anything, and enter() goes straight in.
   ===================================================================== */
(function () {
  'use strict';

  var EASE = 'cubic-bezier(.55,.05,.45,.95)';           /* the site's own */
  var FALL = 'cubic-bezier(.5,0,.9,.4)';                  /* letting go: accelerating */
  var HEAL_MS = 1900;

  var CSS = [
    '.arc-ch{display:inline-block;font-kerning:none;white-space:pre}.arc-w{white-space:nowrap}',
    '.arc-healing .arc-moved,.arc-healing .arc-ch{transition:translate .14s ' + EASE + ',rotate .14s ' + EASE + ',scale .14s ' + EASE + '}',
    '.arc-pressed{scale:.96;filter:brightness(.78)}',
    '@keyframes arc-tear{0%,40%,100%{clip-path:inset(0 0 0 0);translate:0 0}',
    '8%{clip-path:inset(14% 0 58% 0);translate:-12px 0}16%{clip-path:inset(52% 0 22% 0);translate:9px 0}',
    '24%{clip-path:inset(0 0 0 0);translate:0 0}30%{clip-path:inset(33% 0 41% 0);translate:-6px 0}',
    '64%{clip-path:inset(71% 0 4% 0);translate:7px 0}70%{clip-path:inset(0 0 0 0);translate:0 0}}',
    '.arc-tear{animation:arc-tear 1.1s steps(1,end) infinite}',
    /* RGB DRIFT: the page's own big words split into their red and cyan, jittering */
    '@keyframes arc-rgb{0%,100%{text-shadow:2px 0 rgba(255,40,90,.8),-2px 0 rgba(0,230,255,.8)}33%{text-shadow:-3px 1px rgba(255,40,90,.8),3px -1px rgba(0,230,255,.8)}66%{text-shadow:1px -1px rgba(255,40,90,.8),-1px 2px rgba(0,230,255,.8)}}',
    '.arc-rgb{animation:arc-rgb .16s steps(1,end) infinite}',
    '.arc-rgb2{animation:arc-rgb .09s steps(1,end) infinite;letter-spacing:.02em}',
    /* THE PICTURE GIVES: the whole page's colors lurch for a frame */
    'html.arc-flick{filter:hue-rotate(38deg) saturate(1.7) contrast(1.15)}',
    'html.arc-flick2{filter:invert(.08) hue-rotate(-60deg) saturate(2)}',
    /* SCREEN TEARING: a section of the page slips sideways in bands */
    '@keyframes arc-band{0%,55%,100%{clip-path:inset(0 0 0 0);translate:0 0}5%{clip-path:inset(20% 0 62% 0);translate:18px 0}10%{clip-path:inset(48% 0 30% 0);translate:-24px 0}',
    '15%{clip-path:inset(0 0 0 0);translate:0 0}60%{clip-path:inset(70% 0 8% 0);translate:-14px 0}66%{clip-path:inset(8% 0 80% 0);translate:22px 0}}',
    '.arc-band{animation:arc-band .85s steps(1,end) infinite}',
    '.arc-lit{color:var(--blue-hi,#8FEBFF);text-shadow:0 0 .5em rgba(47,216,255,.75);transition:color .3s,text-shadow .3s}',
    'html.arc-off{background:#07090E!important;overflow:hidden!important}',
    'html.arc-off body{visibility:hidden}',
    /* The beam: what is left of the screen as it switches off. */
    '.arc-beam{position:fixed;left:0;right:0;top:50%;height:2px;margin-top:-1px;z-index:2147483000;pointer-events:none;',
    'background:#F4FFFF;box-shadow:0 0 18px 4px rgba(143,235,255,.8),0 0 60px 10px rgba(47,216,255,.35);transform-origin:50% 50%}'
  ].join('');

  var PIECES = [
    'nav .logo', '.links a', '.nav-actions > *', '.page-wheel',
    'main .cue', 'main .wordmark', 'main .dict-word', 'main .dict-ipa', 'main .dict-defs', 'main h1', 'main h2', 'main h3',
    'main p', 'main li', 'main .btn', 'main .frame', 'main figure', 'main .hero-line', 'main .hero-sub',
    'main .workline', 'main .btn-row', 'main .card', 'main .person', 'main img',
    'footer .foot-tag', 'footer .foot-links', 'footer .foot-legal', 'footer .foot-socials', 'footer .foot-region'
  ].join(',');
  var WORDS = '.wordmark,.dict-word,main h1,main h2,.hero-line,main .cue,.lede,.hero-sub,nav .logo,.foot-tag,main h3';
  var LINKS = '.links a,.nav-actions > *,.foot-links a,.btn,.give-btn,.lang-toggle';
  var MEDIA = '.frame,main img,.wordmark,.dict-word,main h1,.workline';
  var TOKENS = [['--blue', '--foam'], ['--blue-hi', '--foam-hi'], ['--blue-dim', '--foam-dim'], ['--blue-glow', '--foam-glow']];

  function create() {
    var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var root = document.documentElement;
    if (!document.getElementById('arc-fail-css')) {
      var st = document.createElement('style'); st.id = 'arc-fail-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }

    var level = 0;
    var saved = new Map();          /* element -> its original innerHTML (split or lit) */
    var moved = new Set();          /* elements given a translate/rotate/scale */
    var torn = new Set();
    var tickers = [];
    var healTimer = null, onHealed = null;
    var fallen = [];                /* the collapse's animations, reversed on the way back */
    /* The element a door is being tapped on is never torn: a torn element
       is clipped, and a tap on a clipped-away band does not reach it — the
       fifth tap would miss (found on the closed page, 2026-09-29). */
    var spared = new Set();
    var busy = false;

    /* ---------------------------------------------------------- helpers */
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(list, n) {
      var a = list.slice(), out = [];
      while (a.length && out.length < n) out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
      return out;
    }
    function onScreen(el) {
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth &&
        getComputedStyle(el).visibility !== 'hidden';
    }
    function visible(sel) {
      return Array.prototype.filter.call(document.querySelectorAll(sel), function (el) {
        return !el.closest('[hidden],#arcade,dialog') && onScreen(el);
      });
    }
    /* Text a stage may take apart: nothing inside it that listens or holds a
       picture, so putting its innerHTML back restores it exactly. */
    function plain(el) { return !el.querySelector('a,button,input,select,textarea,svg,img,video,iframe,canvas'); }

    /* A real element's letters, each its own span. Whitespace stays text so
       the line still wraps where it did. */
    function split(el) {
      if (el.querySelector('.arc-ch')) return Array.prototype.slice.call(el.querySelectorAll('.arc-ch'));
      if (!saved.has(el)) saved.set(el, el.innerHTML);
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = [], n;
      while ((n = walker.nextNode())) nodes.push(n);
      var chars = [];
      /* Each word's letters stay together in an unbreakable run: letters as
         separate boxes would otherwise let a line wrap mid-word. */
      nodes.forEach(function (t) {
        var frag = document.createDocumentFragment();
        t.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
          var w = document.createElement('span'); w.className = 'arc-w';
          Array.from(part).forEach(function (c) {
            var s = document.createElement('span'); s.className = 'arc-ch'; s.textContent = c;
            s.dataset.c = c; w.appendChild(s); chars.push(s);
          });
          frag.appendChild(w);
        });
        t.parentNode.replaceChild(frag, t);
      });
      return chars;
    }
    /* Every element a stage touches has its own style and class attributes
       remembered first, and gets exactly those back when the page heals —
       not an empty style="" where there was none. */
    var original = new Map();
    function remember(el) {
      if (!original.has(el)) original.set(el, { style: el.getAttribute('style'), cls: el.getAttribute('class') });
    }
    function putBack() {
      original.forEach(function (o, el) {
        if (o.style === null) el.removeAttribute('style'); else el.setAttribute('style', o.style);
        if (o.cls === null) el.removeAttribute('class'); else el.setAttribute('class', o.cls);
      });
      original.clear();
    }
    function nudge(el, x, y, r) {
      remember(el);
      el.style.translate = x.toFixed(1) + 'px ' + y.toFixed(1) + 'px';
      if (r) el.style.rotate = r.toFixed(1) + 'deg';
      el.classList.add('arc-moved'); moved.add(el);
    }
    function every(ms, fn) { var id = setInterval(fn, ms); tickers.push(id); return id; }
    var GLYPHS = '#%&@$*?!/\\<>[]{}=+~^0123456789';

    /* One letter rolls, like the page wheel: the old one leaves upward and
       the new one arrives from below. Used for the doors' own words too. */
    function rollChar(span, to, ms) {
      if (reduced || !span.animate) { span.textContent = to; return; }
      span.animate([{ translate: '0 0', opacity: 1 }, { translate: '0 -60%', opacity: 0 }], { duration: ms / 2, easing: EASE })
        .onfinish = function () {
          span.textContent = to;
          span.animate([{ translate: '0 60%', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: ms / 2, easing: EASE });
        };
    }

    /* ----------------------------------------------------------- stages */
    var STAGES = [null,
      /* 1 — DID I JUST SEE SOMETHING? (Chase, 2026-10-03: subtler than it
         was.) One letter misfires for a blink, one slips a pixel, and then
         nothing — easy to doubt, which is the point. */
      function () {
        var el = pick(visible(WORDS).filter(plain), 1)[0];
        if (!el) return;
        var cs = split(el), c = cs[Math.floor(Math.random() * cs.length)], d = cs[Math.floor(Math.random() * cs.length)];
        if (c) { var was = c.dataset.c; c.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)]; setTimeout(function () { if (c.isConnected) c.textContent = was; }, 110); }
        if (d) nudge(d, 0, rnd(-1.2, 1.2), 0);
      },
      /* 2 — NOTICEABLE. Real letters slip off the line, links drift out of
         it, letters misfire to the wrong character and back, something looks
         pressed that nobody touched. */
      function () {
        pick(visible(WORDS).filter(plain), 3).forEach(function (el) {
          split(el).forEach(function (c) { if (Math.random() < .16) nudge(c, rnd(-1, 1), rnd(-2.5, 2.5), rnd(-4, 4)); });
        });
        every(700, function () {
          var cs = document.querySelectorAll('.arc-ch'); if (!cs.length) return;
          var c = cs[Math.floor(Math.random() * cs.length)];
          nudge(c, rnd(-1.5, 1.5), rnd(-3, 3), rnd(-6, 6));
        });
        visible(LINKS).forEach(function (el) { if (Math.random() < .6) nudge(el, rnd(-4, 4), rnd(-3, 3), rnd(-1.5, 1.5)); });
        every(240, function () {
          var cs = document.querySelectorAll('.arc-ch'); if (!cs.length) return;
          var c = cs[Math.floor(Math.random() * cs.length)], was = c.dataset.c;
          c.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
          setTimeout(function () { if (level) c.textContent = was; }, 110);
        });
        var b = pick(visible('.btn,.give-btn'), 1)[0];
        if (b) { remember(b); b.classList.add('arc-pressed'); moved.add(b); }
      },
      /* 3 — THE WRONG VOICE. Blue and seafoam trade places across the whole
         site for a beat (the two-voice split is the site's grammar, so this
         reads as the page misspeaking), and headings stutter between their
         thin and bold weights. */
      function () {
        var cs = getComputedStyle(root), real = {};
        TOKENS.forEach(function (p) { real[p[0]] = cs.getPropertyValue(p[0]); real[p[1]] = cs.getPropertyValue(p[1]); });
        function swap(on) {
          TOKENS.forEach(function (p) {
            if (on) { root.style.setProperty(p[0], real[p[1]]); root.style.setProperty(p[1], real[p[0]]); }
            else { root.style.removeProperty(p[0]); root.style.removeProperty(p[1]); }
          });
        }
        [0, 130, 300, 420].forEach(function (t, i) { setTimeout(function () { if (level >= 3) swap(i % 2 === 0); }, t); });
        every(1300, function () { swap(true); setTimeout(function () { swap(false); }, 90 + Math.random() * 120); });
        every(170, function () {
          var cs2 = document.querySelectorAll('.arc-ch'); if (!cs2.length) return;
          var c = cs2[Math.floor(Math.random() * cs2.length)];
          c.style.fontWeight = c.style.fontWeight ? '' : '600';
        });
        swap.real = real; STAGES.swap = swap;
        /* WOAH: the big words split into red and cyan, and the whole
           picture lurches now and then */
        pick(visible(WORDS), 4).forEach(function (el) { remember(el); el.classList.add('arc-rgb'); });
        every(900, function () {
          root.classList.add('arc-flick');
          setTimeout(function () { root.classList.remove('arc-flick'); }, 60 + Math.random() * 70);
        });
      },
      /* 4 — TEARING. The page's own pictures and biggest words are sliced
         into bands that jump sideways. */
      function () {
        pick(visible(MEDIA).filter(function (el) { return !spared.has(el); }), 4).forEach(function (el) { remember(el); el.classList.add('arc-tear'); el.style.animationDelay = (-Math.random()).toFixed(2) + 's'; torn.add(el); });
        visible(LINKS).forEach(function (el) { nudge(el, rnd(-9, 9), rnd(-6, 6), rnd(-4, 4)); });
        /* SCREEN TEARING: whole sections slip in bands; the color split
           goes faster; the picture gives more often */
        pick(visible('main > section, main > header, header.hero, main .wrap > section').filter(function (el) { return !spared.has(el) && !el.contains(Array.from(spared)[0] || null); }), 2)
          .forEach(function (el) { remember(el); el.classList.add('arc-band'); el.style.animationDelay = (-Math.random()).toFixed(2) + 's'; torn.add(el); });
        document.querySelectorAll('.arc-rgb').forEach(function (el) { el.classList.add('arc-rgb2'); });
        every(520, function () {
          root.classList.add(Math.random() < .5 ? 'arc-flick' : 'arc-flick2');
          setTimeout(function () { root.classList.remove('arc-flick', 'arc-flick2'); }, 50 + Math.random() * 60);
        });
      }
    ];

    function progress(door, n, heal) {
      if (reduced || busy) return;
      n = Math.max(0, Math.min(4, n | 0));
      while (level < n) { level++; STAGES[level](); }
      clearTimeout(healTimer);
      onHealed = heal || null;
      healTimer = setTimeout(function () { healNow(); }, HEAL_MS);
    }

    /* Everything back, with a snap. */
    function healNow(quiet) {
      clearTimeout(healTimer);
      tickers.forEach(clearInterval); tickers = [];
      if (STAGES.swap) { STAGES.swap(false); STAGES.swap = null; }
      torn.forEach(function (el) { el.classList.remove('arc-tear', 'arc-band'); el.style.animationDelay = ''; }); torn.clear();
      root.classList.remove('arc-flick', 'arc-flick2');
      document.querySelectorAll('.arc-rgb').forEach(function (el) { el.classList.remove('arc-rgb', 'arc-rgb2'); });
      root.classList.add('arc-healing');
      moved.forEach(function (el) { el.style.translate = ''; el.style.rotate = ''; el.classList.remove('arc-pressed'); });
      var finish = function () {
        root.classList.remove('arc-healing');
        if (root.getAttribute('class') === '') root.removeAttribute('class');
        if (root.getAttribute('style') === '') root.removeAttribute('style');
        moved.clear();
        saved.forEach(function (html, el) { el.innerHTML = html; }); saved.clear();
        putBack();
      };
      if (quiet) finish(); else setTimeout(finish, 170);
      level = 0;
      litByLetter = {};
      var cb = onHealed; onHealed = null;
      if (cb) cb(!!quiet);
    }

    /* ------------------------------------------------- the typed word */
    /* "thauma" typed anywhere: each letter lights the same letter wherever
       the page already shows it. */
    var litByLetter = {};
    function light(ch) {
      if (reduced) return;
      ch = ch.toLowerCase();
      var count = 0;
      visible(WORDS + ',main p,main li').filter(plain).forEach(function (el) {
        split(el).forEach(function (c) {
          if (count < 10 && c.dataset.c.toLowerCase() === ch && !c.classList.contains('arc-lit')) {
            c.classList.add('arc-lit'); count++;
            (litByLetter[ch] = litByLetter[ch] || []).push(c);
          }
        });
      });
    }
    /* The lit letters leave their words and line up in the middle of the
       screen as THAUMA, while the rest of the page falls away around them.
       Each is lifted out of its word into a layer of its own at the same
       spot first, so the word falling does not take it along — and the
       word is left with a gap where it was. */
    var keepLayer = null;
    function converge(word) {
      var used = new Set(), chosen = [];
      Array.from(word.toLowerCase()).forEach(function (ch) {
        var c = (litByLetter[ch] || []).find(function (s) { return !used.has(s) && s.isConnected && onScreen(s); });
        if (c) { used.add(c); chosen.push(c); }
      });
      if (chosen.length !== word.length) return 0;
      keepLayer = document.createElement('div');
      keepLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482000;visibility:visible';
      document.body.appendChild(keepLayer);
      var size = Math.min(innerWidth / (word.length * 1.25), 120), gap = size * .92;
      var x0 = innerWidth / 2 - (gap * (word.length - 1)) / 2;
      chosen.forEach(function (c, i) {
        var r = c.getBoundingClientRect(), cs = getComputedStyle(c);
        var fs = parseFloat(cs.fontSize) || 16;
        var hole = document.createElement('span'); hole.className = 'arc-ch';
        hole.style.width = r.width + 'px'; hole.textContent = '\u00a0';
        c.parentNode.replaceChild(hole, c);
        c.style.cssText = 'position:absolute;left:' + r.left + 'px;top:' + r.top + 'px;margin:0;font-size:' + fs + 'px;' +
          'font-family:' + cs.fontFamily + ';font-weight:' + cs.fontWeight + ';line-height:' + r.height + 'px';
        c.textContent = c.textContent.toUpperCase();
        keepLayer.appendChild(c);
        var dx = x0 + gap * i - (r.left + r.width / 2), dy = innerHeight / 2 - (r.top + r.height / 2);
        c.animate([{ translate: '0 0', scale: 1 }, { translate: dx + 'px ' + dy + 'px', scale: size / fs }],
          { duration: 700, delay: i * 60, easing: EASE, fill: 'forwards' });
      });
      return chosen.length;
    }

    /* ------------------------------------------------------ the collapse */
    function pieces() {
      var all = visible(PIECES);
      var set = new Set(all);
      return all.filter(function (el) {
        for (var p = el.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
        return true;
      });
    }
    function fallAll(first) {
      var list = pieces();
      /* The biggest word comes apart letter by letter, as the 404 always did. */
      var big = list.filter(function (el) { return el.matches('.wordmark,.dict-word,main h1') && plain(el); })[0];
      var parts = [];
      list.forEach(function (el) {
        if (el === big) split(el).forEach(function (c) { parts.push({ el: c, ch: true }); });
        else parts.push({ el: el });
      });
      parts.forEach(function (p) {
        var r = p.el.getBoundingClientRect();
        var dy = innerHeight - r.top + r.height + rnd(40, 260);
        var dx = rnd(-240, 240) * (p.ch ? 1.3 : 1);
        var rot = rnd(-70, 70) * (p.ch ? 1.4 : .6);
        var delay = (first && (p.el === first || first.contains(p.el))) ? 0 : rnd(60, 520);
        var dur = rnd(900, 1400);
        /* a moment's grip lost, then gravity */
        var shake = p.el.animate([{ translate: '0 0' }, { translate: rnd(-3, 3) + 'px ' + rnd(-2, 2) + 'px' }, { translate: '0 0' }],
          { duration: 120, delay: Math.max(0, delay - 120), iterations: 1 });
        var a = p.el.animate([{ translate: '0 0', rotate: '0deg' }, { translate: dx.toFixed(0) + 'px ' + dy.toFixed(0) + 'px', rotate: rot.toFixed(0) + 'deg' }],
          { duration: dur, delay: delay, easing: FALL, fill: 'both' });
        fallen.push(a); void shake;
      });
      return parts.length;
    }
    function beam(off) {
      var b = document.createElement('div'); b.className = 'arc-beam';
      document.body.parentNode.appendChild(b);
      var frames = off
        ? [{ transform: 'scale(1,40)', opacity: .0 }, { transform: 'scale(1,1)', opacity: 1, offset: .35 }, { transform: 'scale(.004,1)', opacity: 1, offset: .8 }, { transform: 'scale(0,0)', opacity: 0 }]
        : [{ transform: 'scale(0,0)', opacity: 0 }, { transform: 'scale(.004,1)', opacity: 1, offset: .2 }, { transform: 'scale(1,1)', opacity: 1, offset: .6 }, { transform: 'scale(1,300)', opacity: 0 }];
      var a = b.animate(frames, { duration: off ? 520 : 560, easing: EASE, fill: 'forwards' });
      return new Promise(function (res) { a.onfinish = function () { b.remove(); res(); }; });
    }

    /* The page runs out of stages, falls, and the screen switches off.
       Resolves once it is dark. On its own for a page that hands off to
       another address (the partner-site closed page); inside enter() for
       the arcade opening in place. */
    function collapse(opts) {
      opts = opts || {};
      clearTimeout(healTimer);
      if (reduced) return Promise.resolve();
      /* Falling pieces must not widen the page: on a phone the browser
         zooms out to show overflow, and the arcade, sized to the viewport,
         would open shifted and shrunk (seen at 390px, 2026-09-29). */
      root.style.overflow = 'hidden';
      document.body.style.overflow = 'clip';
      /* Whatever stages the door had not reached yet go by in a burst — a
         single press on the 404 still watches the page fail before it falls. */
      var ramp = [];
      for (var k = level + 1; k <= 4; k++) ramp.push(k);
      return ramp.reduce(function (p, k) {
        return p.then(function () { level = k; STAGES[k](); return new Promise(function (res) { setTimeout(res, 170); }); });
      }, Promise.resolve()).then(function () {
        torn.forEach(function (el) { el.classList.remove('arc-tear', 'arc-band'); }); torn.clear();
        tickers.forEach(clearInterval); tickers = [];
        root.classList.remove('arc-flick', 'arc-flick2');
        document.querySelectorAll('.arc-rgb').forEach(function (el) { el.classList.remove('arc-rgb', 'arc-rgb2'); });
        if (STAGES.swap) { STAGES.swap(false); STAGES.swap = null; }
        var kept = opts.word ? converge(opts.word) : 0;
        return new Promise(function (res) { setTimeout(res, kept ? 1000 : 200); });
      })
        .then(function () { fallAll(opts.first); return new Promise(function (res) { setTimeout(res, 1150); }); })
        .then(function () {
          /* The page itself squeezes into the line, then the line to a dot. */
          var body = document.body, off = beam(true);
          body.style.transformOrigin = '50% ' + (scrollY + innerHeight / 2) + 'px';
          var sq = body.animate([{ transform: 'none', filter: 'brightness(1)' }, { transform: 'scale(1,.004)', filter: 'brightness(3)' }],
            { duration: 200, easing: EASE, fill: 'forwards' });
          return off.then(function () { root.classList.add('arc-off'); sq.cancel(); body.style.transformOrigin = ''; });
        });
    }

    /* The last door opens: failure runs to its end, the page falls, the
       screen switches off, and the arcade powers on in its place — the same
       document, no new page (Chase: "it isn't loading a new page, but that
       you found something secret!"). */
    function enter(door, opts) {
      if (busy) return Promise.resolve();
      busy = true;
      var arcadeReady = window.THAUMA_ARCADE.loadArcade();
      return collapse(opts)
        .then(function () { return arcadeReady; })
        .then(function (A) {
          busy = false;
          return A.mount({ from: door, onExit: reduced ? function () { return Promise.resolve(); } : restore });
        });
    }

    /* Back from the arcade: the screen switches on and the debris flies
       home — the collapse, reversed. */
    function restore() {
      busy = true;
      root.classList.remove('arc-off');
      var on = beam(false), body = document.body;
      body.style.transformOrigin = '50% ' + (scrollY + innerHeight / 2) + 'px';
      body.animate([{ transform: 'scale(1,.004)', filter: 'brightness(3)' }, { transform: 'none', filter: 'brightness(1)' }],
        { duration: 380, delay: 200, easing: EASE, fill: 'backwards' }).onfinish = function () { body.style.transformOrigin = ''; };
      if (keepLayer) { keepLayer.remove(); keepLayer = null; }
      fallen.forEach(function (a) { a.playbackRate = 1.6; a.reverse(); });
      return Promise.all([on, new Promise(function (res) { setTimeout(res, 1000); })]).then(function () {
        fallen.forEach(function (a) { a.cancel(); }); fallen = [];
        document.querySelectorAll('.arc-ch').forEach(function (c) { c.getAnimations().forEach(function (a) { a.cancel(); }); });
        root.style.overflow = ''; document.body.style.overflow = '';
        /* no empty style="" left behind where there was none */
        if (document.body.getAttribute('style') === '') document.body.removeAttribute('style');
        litByLetter = {};
        healNow(true);
        busy = false;
      });
    }

    return {
      progress: progress, heal: healNow, light: light, enter: enter, collapse: collapse, restore: restore,
      spare: function (el) { spared.add(el); },
      rollChar: rollChar, split: split, get level() { return level; }, reduced: reduced
    };
  }

  window.ThaumaFail = { create: create };
})();
