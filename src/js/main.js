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

    // ---- Trail effects: generic, page-agnostic, no new CSS needed ----
    function flashPixel() {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;width:2px;height:2px;background:#EDF2F8;opacity:.85;z-index:9999;pointer-events:none;left:' + (Math.random() * 100) + 'vw;top:' + (Math.random() * 100) + 'vh;';
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 120);
    }

    function flashWhisper() {
      var lang = document.documentElement.lang === 'hr' ? 'hr' : 'en';
      var phrases = (window.THAUMA_TAUNTS && window.THAUMA_TAUNTS[lang]) || ['404'];
      var phrase = phrases[Math.floor(Math.random() * phrases.length)];
      var el = document.createElement('div');
      el.textContent = phrase;
      el.style.cssText = 'position:fixed;left:50%;top:40%;transform:translate(-50%,-50%);color:rgba(237,242,248,.1);font-family:Sora,sans-serif;font-weight:100;font-size:clamp(20px,4vw,40px);letter-spacing:.06em;z-index:9998;pointer-events:none;white-space:nowrap;text-align:center;opacity:0;transition:opacity .5s ease';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 500); }, 650);
    }

    function glowPulse() {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9997;box-shadow:inset 0 0 70px rgba(92,242,196,.3);opacity:0;transition:opacity .2s ease';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 200); }, 160);
      document.documentElement.style.transition = 'transform .07s ease';
      document.documentElement.style.transform = 'translateX(1px)';
      setTimeout(function () { document.documentElement.style.transform = ''; }, 80);
    }

    function dimPage() {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9996;background:rgba(0,0,0,.16);opacity:0;transition:opacity .5s ease';
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.style.opacity = '1'; });
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 500); }, 900);
    }

    function staticPop() {
      var el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;background:repeating-linear-gradient(0deg,rgba(255,255,255,.07) 0 1px,transparent 1px 2px);opacity:.85';
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 90);
    }

    // Back-loaded escalation: a ratio of sequence progress maps to a tier.
    // Regressing from progress > 0 back to 0 (wrong input) pops instead.
    var lastProgress = {};
    function trailStep(kind, progress, max) {
      var prev = lastProgress[kind] || 0;
      if (!reducedMotion) {
        if (progress === 0 && prev > 0) {
          staticPop();
        } else if (progress > 0) {
          var ratio = progress / max;
          if (ratio >= 0.8) dimPage();
          else if (ratio >= 0.6) glowPulse();
          else if (ratio >= 0.4) flashWhisper();
          else if (ratio >= 0.2) flashPixel();
        }
      }
      lastProgress[kind] = progress;
    }

    // ---- Door 1: 5 taps on the wordmark, ~2s idle resets the count ----
    // The logo is a real link; a normal single click still navigates home,
    // just after a short delay so a fast follow-up tap can cancel it.
    document.querySelectorAll('.logo').forEach(function (logo) {
      var tapCount = 0, idleTimer = null, navTimer = null;
      logo.addEventListener('click', function (e) {
        e.preventDefault();
        var href = logo.getAttribute('href');
        clearTimeout(idleTimer);
        clearTimeout(navTimer);
        tapCount++;
        if (tapCount >= 5) {
          tapCount = 0;
          openGame();
          return;
        }
        trailStep('tap', tapCount, 5);
        idleTimer = setTimeout(function () { trailStep('tap', 0, 5); tapCount = 0; }, 2000);
        navTimer = setTimeout(function () { location.href = href; }, 550);
      });
    });

    // ---- Door 2: Konami code, anywhere ----
    var KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
    var konamiPos = 0;
    document.addEventListener('keydown', function (e) {
      if (isTypingContext(e.target)) return;
      var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === KONAMI[konamiPos]) {
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
