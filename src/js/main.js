// ---- Netlify Identity links (invites, recoveries) land on the site root
// with a token in the URL hash; forward them to /staff/ (its Identity widget
// serves every role - admins continue to /admin after setting a password). ----
if (location.hash && /invite_token|recovery_token|confirmation_token|email_change_token/.test(location.hash)) {
  location.replace('/staff/' + location.hash);
}

// ---- Language toggle: remember the choice, then navigate ----
document.querySelectorAll('.lang-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var lang = btn.dataset.lang;
    document.cookie = 'thauma_lang=' + lang + ';path=/;max-age=31536000;samesite=lax';
    window.location.href = btn.dataset.target;
  });
});

// ---- Mobile menu ----
var menuBtn = document.querySelector('.menu-btn');
if (menuBtn) {
  menuBtn.addEventListener('click', function () {
    document.body.classList.toggle('menu-open');
  });
}

// ---- Mark the current page in the nav ----
document.querySelectorAll('.links a').forEach(function (a) {
  if (location.pathname === a.getAttribute('href')) a.classList.add('active');
});

// ---- Scroll reveals (skipped entirely under reduced motion) ----
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  var targets = document.querySelectorAll('section .cue, section h2, section .lede, section .body-text, .val, .conviction, .work, .person, .give-card, .frame, .empty');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  targets.forEach(function (el) { el.classList.add('sr'); io.observe(el); });
}

// ---- Scroll progress line (only where there's meaningful scroll) ----
if (document.body.scrollHeight > window.innerHeight * 1.3) {
  var bar = document.createElement('div');
  bar.className = 'scroll-progress';
  document.body.appendChild(bar);
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      var max = document.body.scrollHeight - window.innerHeight;
      bar.style.transform = 'scaleX(' + (max > 0 ? window.scrollY / max : 0) + ')';
      ticking = false;
    });
  }, { passive: true });
}

// ---- Hidden game doors (GAME-SPEC.md) — dev-only, absent in production ----
// Doors 1-3 live here because they must be reachable from any page. Door 4
// (the 404 numeral itself) lives in 404.njk, where that element exists.
if (window.THAUMA_ENV && !window.THAUMA_ENV.isProduction) {
  (function () {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function openGame() {
      location.href = '/404.html#play';
    }

    function isTypingContext(el) {
      var tag = el && el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable);
    }

    // ---- Trail effects: real glitch look (RGB-split, filter jitter, scan-
    // lines), not a subtle fade — injected once since main.js has no static
    // CSS file of its own at runtime. ----
    var glitchStyleTag = document.createElement('style');
    glitchStyleTag.textContent =
      '@keyframes thauma-trail-glitch{' +
      '0%,100%{filter:none;transform:translate(0,0)}' +
      '15%{filter:invert(.18) hue-rotate(180deg);transform:translate(-6px,0)}' +
      '30%{filter:contrast(1.9) brightness(1.35);transform:translate(5px,0)}' +
      '45%{filter:none;transform:translate(-4px,0)}' +
      '60%{filter:hue-rotate(90deg) saturate(2.2);transform:translate(6px,0)}' +
      '75%{filter:invert(.12);transform:translate(-3px,0)}' +
      '90%{filter:none;transform:translate(0,0)}}' +
      '.thauma-trail-glitch-active{animation:thauma-trail-glitch .4s steps(1,end)}' +
      '@keyframes thauma-trail-shake{0%,100%{transform:translate(0,0)}' +
      '25%{transform:translate(-4px,3px)}50%{transform:translate(3px,-4px)}75%{transform:translate(-3px,-2px)}}' +
      '.thauma-trail-shake-active{animation:thauma-trail-shake .14s steps(1,end) 3}';
    document.head.appendChild(glitchStyleTag);

    function glitchFlash() {
      var html = document.documentElement;
      html.classList.remove('thauma-trail-glitch-active');
      void html.offsetWidth;
      html.classList.add('thauma-trail-glitch-active');
    }

    function shakeBurst() {
      var html = document.documentElement;
      html.classList.remove('thauma-trail-shake-active');
      void html.offsetWidth;
      html.classList.add('thauma-trail-shake-active');
    }

    function scanlineBurst() {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;opacity:.92;' +
        'background:repeating-linear-gradient(0deg,rgba(255,255,255,.14) 0 2px,transparent 2px 4px),' +
        'repeating-linear-gradient(90deg,rgba(47,216,255,.09) 0 3px,transparent 3px 7px)';
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 220);
    }

    function flashPixel() {
      glitchFlash();
    }

    function flashWhisper() {
      var lang = document.documentElement.lang === 'hr' ? 'hr' : 'en';
      var phrases = (window.THAUMA_TAUNTS && window.THAUMA_TAUNTS[lang]) || ['404'];
      var phrase = phrases[Math.floor(Math.random() * phrases.length)];
      var el = document.createElement('div');
      el.textContent = phrase;
      el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);' +
        'color:rgba(237,242,248,.92);font-family:Sora,sans-serif;font-weight:200;' +
        'font-size:clamp(24px,5vw,46px);letter-spacing:.05em;z-index:99998;pointer-events:none;' +
        'white-space:nowrap;text-align:center;text-shadow:3px 0 rgba(255,45,106,.85),-3px 0 rgba(47,216,255,.85);' +
        'opacity:0;transition:opacity .08s ease';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 150); }, 380);
      glitchFlash();
      scanlineBurst();
    }

    function glowPulse() {
      glitchFlash();
      shakeBurst();
      scanlineBurst();
    }

    function dimPage() {
      glitchFlash();
      shakeBurst();
      scanlineBurst();
      setTimeout(scanlineBurst, 180);
    }

    function staticPop() {
      scanlineBurst();
      glitchFlash();
      shakeBurst();
    }

    // Back-loaded escalation: a ratio of sequence progress maps to a tier,
    // and each tier is louder than the last (more repeats/duration), not
    // just a different function — the site should feel like it's genuinely
    // breaking down more the closer you get.
    var lastProgress = {};
    function trailStep(kind, progress, max) {
      var prev = lastProgress[kind] || 0;
      if (!reducedMotion) {
        if (progress === 0 && prev > 0) {
          staticPop();
        } else if (progress > 0) {
          var ratio = progress / max;
          if (ratio >= 0.8) {
            dimPage();
            glitchFlash();
            shakeBurst();
            setTimeout(function () { glitchFlash(); scanlineBurst(); }, 140);
          } else if (ratio >= 0.6) {
            glowPulse();
            setTimeout(scanlineBurst, 100);
          } else if (ratio >= 0.4) {
            flashWhisper();
          } else if (ratio >= 0.2) {
            flashPixel();
          }
        }
      }
      lastProgress[kind] = progress;
    }

    // ---- Door 1: 5 taps on the homepage hero wordmark ----
    // Deliberately the big hero ".wordmark" (index.njk only), not the nav
    // ".logo" — that one's a real link to home on every page, which fights
    // this same click for a different job. No time limit: tapping anywhere
    // else on the page resets the count instead of it expiring on its own.
    document.querySelectorAll('.wordmark').forEach(function (mark) {
      var tapCount = 0;
      mark.addEventListener('click', function (e) {
        tapCount++;
        if (tapCount >= 5) {
          tapCount = 0;
          openGame();
          return;
        }
        trailStep('tap', tapCount, 5);
      });
      document.addEventListener('click', function (e) {
        if (mark.contains(e.target)) return;
        if (tapCount > 0) trailStep('tap', 0, 5);
        tapCount = 0;
      });
    });

    // ---- Door 2: Konami code, anywhere, Enter as a supplemental "Start" ----
    var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a', 'Enter'];
    var ARROWS = { ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
    var konamiPos = 0;
    document.addEventListener('keydown', function (e) {
      if (isTypingContext(e.target)) return;
      var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[konamiPos]) {
        // First two arrow presses still scroll normally (could easily be
        // incidental); from the 3rd correct input on, a sequence is clearly
        // forming, so stop the page from moving under it.
        if (ARROWS[key] && konamiPos >= 2) e.preventDefault();
        konamiPos++;
        if (konamiPos === KONAMI.length) {
          konamiPos = 0;
          openGame();
          return;
        }
        trailStep('konami', konamiPos, KONAMI.length);
      } else if (konamiPos > 0) {
        trailStep('konami', 0, KONAMI.length);
        konamiPos = 0;
      }
    });

    // ---- Door 3: typing "thauma" anywhere ----
    var WORD = 'thauma';
    var wordBuffer = '';
    function typedProgress(buffer, word) {
      for (var len = word.length; len > 0; len--) {
        if (buffer.slice(-len) === word.slice(0, len)) return len;
      }
      return 0;
    }
    document.addEventListener('keydown', function (e) {
      if (isTypingContext(e.target) || e.key.length !== 1) return;
      wordBuffer = (wordBuffer + e.key.toLowerCase()).slice(-20);
      var progress = typedProgress(wordBuffer, WORD);
      if (progress === WORD.length) {
        wordBuffer = '';
        openGame();
        return;
      }
      trailStep('word', progress, WORD.length);
    });
  })();
}
