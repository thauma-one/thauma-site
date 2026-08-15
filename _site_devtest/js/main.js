// ---- Netlify Identity links (invites, recoveries) land on the site root
// with a token in the URL hash; forward them to /staff/ (its Identity widget
// serves every role - admins continue to /admin after setting a password). ----
if (location.hash && /invite_token|recovery_token|confirmation_token|email_change_token/.test(location.hash)) {
  location.replace('/staff/' + location.hash);
}

// ---- Language toggle: remember the choice, then navigate (unchanged —
// this is the actual switch; the dropdown below it is just UI around it) ----
document.querySelectorAll('.lang-toggle').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var lang = btn.dataset.lang;
    document.cookie = 'thauma_lang=' + lang + ';path=/;max-age=31536000;samesite=lax';
    window.location.href = btn.dataset.target;
  });
});

// ---- Language dropdown: open/close + dismiss (2026-07-17) ----
// Open/closed state lives entirely in the .open class (not the `hidden`
// attribute) so main.css can transition it — display:none can't be
// animated, so the list has to stay in normal display the whole time and
// let opacity/transform/visibility do the showing and hiding instead.
// The outside-click/Escape listeners are registered once on document
// (not once per dropdown instance) and just close whichever is open.
(function () {
  var dropdowns = [];
  document.querySelectorAll('.lang-dropdown').forEach(function (dd) {
    var trigger = dd.querySelector('.lang-dropdown-trigger');
    var list = dd.querySelector('.lang-dropdown-list');
    if (!trigger || !list) return;
    function open() {
      dd.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    function close() {
      dd.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dd.classList.contains('open')) close(); else open();
    });
    dropdowns.push({ el: dd, close: close });
  });
  if (!dropdowns.length) return;
  document.addEventListener('click', function (e) {
    dropdowns.forEach(function (d) { if (!d.el.contains(e.target)) d.close(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') dropdowns.forEach(function (d) { d.close(); });
  });
})();

// ---- Mobile menu ----
var menuBtn = document.querySelector('.menu-btn');
if (menuBtn) {
  menuBtn.addEventListener('click', function () {
    document.body.classList.toggle('menu-open');
  });
}

// ---- Mark the current page in the nav (desktop links + mobile menu) ----
document.querySelectorAll('.links a, .mobile-menu a').forEach(function (a) {
  if (location.pathname === a.getAttribute('href')) a.classList.add('active');
});

// ---- View-transition sequencing (2026-07-21) ----
// A cross-page view transition crossfades a LIVE snapshot of this page —
// any animation running during the fade forces that snapshot to
// re-rasterize every frame, which is what made page changes stutter even
// after the cascade alone was sequenced. So now EVERYTHING on-load is held
// while a transition runs: the CSS animations (.rise headers, the
// active-link underline pulse) via html.vt-active + animation-play-state
// (see main.css), and the JS-driven ones (page wheel, scroll-reveal fades,
// character cascade) by queueing through whenPageSettled(). The fade plays
// over a fully static page; the choreography starts the moment it
// finishes. Without a transition (or without pagereveal support) settle is
// immediate and behavior is exactly as before.
var whenPageSettled, atPageReveal;
(function () {
  var settled = false, queue = [];
  var revealRan = false, revealQueue = [], viaTransition = false;
  function runReveal() {
    if (revealRan) return;
    revealRan = true;
    revealQueue.splice(0).forEach(function (fn) { fn(viaTransition); });
  }
  function settle() {
    // vt-active clears even if already settled: a bfcache restore re-adds
    // it (pagereveal fires again on the SAME, already-settled document),
    // and an early-return here left it stuck — pausing the underline
    // pulse forever on restored pages.
    document.documentElement.classList.remove('vt-active');
    if (settled) return;
    settled = true;
    queue.splice(0).forEach(function (fn) { fn(); });
  }
  whenPageSettled = function (fn) { if (settled) fn(); else queue.push(fn); };
  // Runs pre-first-paint, inside pagereveal itself, with a flag for
  // whether this arrival came through a view transition — for work that
  // must alter the page BEFORE the fade starts rendering it.
  atPageReveal = function (fn) { if (revealRan) fn(viaTransition); else revealQueue.push(fn); };
  if ('onpagereveal' in window) {
    var revealSeen = false;
    window.addEventListener('pagereveal', function (e) {
      revealSeen = true;
      // Clear the outgoing freezes (set at pageswap / Give press below):
      // on a back/forward-cache restore this same document comes back
      // alive, and stuck classes would leave buttons/links with
      // transition:none!important forever — snapping instead of easing.
      document.documentElement.classList.remove('vt-leaving', 'give-pressed');
      viaTransition = !!e.viewTransition;
      if (e.viewTransition) {
        // vt-active is removed at settle; vt-came stays for the page's
        // lifetime — a transitioned arrival's entrance IS the fade, so the
        // .rise header animation is skipped outright (headers visible
        // DURING the fade, giving it real content to fade in) instead of
        // held-then-played, which left the incoming page blank for the
        // whole fade and made it read as a hard cut + pop.
        document.documentElement.classList.add('vt-active', 'vt-came');
        runReveal();
        e.viewTransition.finished.then(settle, settle);
        setTimeout(settle, 900); // failsafe: never hold the page hostage
      } else {
        runReveal();
        settle();
      }
    });
    // pageswap fires on the OUTGOING page right before its snapshot is
    // captured: freeze the nav's interactive states (vt-leaving, see
    // main.css) so the capture is clean — including completing a
    // mid-press Give fill rather than cutting it (give-pressed).
    window.addEventListener('pageswap', function () {
      document.documentElement.classList.add('vt-leaving');
    });
    // Belt-and-braces for the same bfcache case as above, in case a
    // restore ever fires pageshow without pagereveal.
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) document.documentElement.classList.remove('vt-leaving', 'give-pressed');
    });
    // pagereveal fires before load in every normal case; if it somehow
    // never fires for this navigation, settle at load rather than never.
    window.addEventListener('load', function () { if (!revealSeen) { runReveal(); settle(); } });
  } else {
    settled = true;
    revealRan = true;
  }
})();

// ---- Grid -> bio portrait morph names (2026-07-21) ----
// The team page marks each card's photo and the bio page marks its main
// portrait with data-vt-person="<slug>"; giving the pair the same
// view-transition-name makes the browser morph the photo from its grid
// cell into the bio layout position (and back) across the navigation.
// Assigned here, before first paint, so both the outgoing capture and
// the incoming render see the names. Desktop only per direct request —
// the mobile layouts differ enough that the morph wasn't wanted there —
// and skipped where names aren't supported (no fallback needed; those
// browsers just keep the plain fade).
if (window.matchMedia('(min-width:901px)').matches && 'viewTransitionName' in document.documentElement.style) {
  document.querySelectorAll('[data-vt-person]').forEach(function (el) {
    el.style.viewTransitionName = 'person-' + el.dataset.vtPerson;
  });
}

// Pressing Give marks the document (give-pressed, cleared again at the
// next pagereveal) so the pageswap freeze can COMPLETE the fill for the
// outgoing snapshot instead of cutting it off — see main.css's
// vt-leaving rules.
document.querySelectorAll('.give-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.documentElement.classList.add('give-pressed');
  });
});

// ---- Page-location wheel: per-character cascade from the previous page's
// label (2026-07-20) ----
// This is a full server-rendered multi-page site, not a client router, so
// there's no single persistent DOM to animate a "from -> to" transition on
// across a navigation — the trick is sessionStorage: every page load
// stashes what it showed, and on the NEXT load, if that differs from this
// page's own label, the plain resting row is replaced with one mini-wheel
// per character — each an independent old-char/new-char pair — and every
// one of them is transitioned by exactly one character-row height, with an
// increasing transition-delay per character index so they roll in sequence
// rather than as one block. Only ever two characters exist in any given
// mini-wheel (old, new) — nothing scrolls through intermediate letters or
// intermediate nav pages. Direction is always top-down (new character
// slides down into place from above, old one exits downward) — this used
// to flip based on whether the new page came before or after the old one
// in nav order, but that made the motion feel inconsistent from one
// navigation to the next, so it's one fixed direction now. START_DELAY is
// baked directly into each character's own transition-delay (not a
// setTimeout before starting anything), so the whole cascade — the wait
// before it starts, plus its per-character stagger — is one CSS
// transition per character rather than a separate JS timer. The CSS
// resting position needs no JS to be correct, so a failed/blocked script
// just means no animation, never a wrong or missing label.
(function () {
  var container = document.querySelector('.page-wheel');
  var track = document.querySelector('.page-wheel-track');
  if (!container || !track) return;
  var currentLabel = track.dataset.wheelLabel || '';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var rowH = parseFloat(getComputedStyle(container).getPropertyValue('--wheel-row-h')) || 0;
  var prevLabel = currentLabel, hasPrev = false;
  try {
    var stored = sessionStorage.getItem('thauma_wheel_label');
    if (stored !== null) { prevLabel = stored; hasPrev = true; }
  } catch (e) { /* privacy mode etc. — just skip the animation */ }
  // Stash for the NEXT page immediately, not at settle: a fast click
  // mid-fade must still record where we were, or the page after next
  // rolls from a label two pages back.
  try { sessionStorage.setItem('thauma_wheel_label', currentLabel); } catch (e) { /* same */ }
  var START_DELAY = 700; // ms before the roll begins at all
  var STAGGER = 40; // ms added per character, cascading left to right
  var DURATION_MS = 1300;
  var EASING = 'cubic-bezier(.55,.05,.45,.95)'; // same curve navping (the
  // active-nav underline pulse) already uses elsewhere — a symmetric
  // ease-in-out, replacing the ease-out this started with, which read as
  // too abrupt/constant-speed at the start of each character's roll.
  var DURATION = (DURATION_MS / 1000) + 's ' + EASING;
  if (!reduced && rowH && hasPrev && prevLabel !== currentLabel) {
    // Measure each character's natural rendered width with a hidden span
    // that inherits the track's real font (canvas measureText, tried
    // before, reconstructs the font from a string and its metrics can
    // diverge from the DOM's — this can't). Both the outgoing and incoming
    // label have to be correctly spaced, at their own ends of the roll, so
    // each character box animates its WIDTH from the old character's to the
    // new character's alongside the vertical roll.
    var meas = document.createElement('span');
    meas.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;letter-spacing:normal';
    track.appendChild(meas);
    var widthOf = function (ch) { meas.textContent = ch; return meas.getBoundingClientRect().width; };
    var len = Math.max(prevLabel.length, currentLabel.length);
    var oldStr = prevLabel, newStr = currentLabel;
    while (oldStr.length < len) oldStr += ' ';
    while (newStr.length < len) newStr += ' ';
    var charRow = document.createElement('div');
    charRow.className = 'page-wheel-charrow';
    var cells = [];
    for (var i = 0; i < len; i++) {
      var wrap = document.createElement('span');
      wrap.className = 'pw-char';
      var newCell = document.createElement('span');
      newCell.className = 'pw-char-cell pw-new';
      newCell.textContent = newStr[i];
      var oldCell = document.createElement('span');
      oldCell.className = 'pw-char-cell pw-old';
      oldCell.textContent = oldStr[i];
      // Start (no transition): box sized to the OLD character, old char in
      // view, new char one row above. Both characters keep their natural
      // width; only the box (and thus the horizontal spacing) animates.
      wrap.style.transition = 'none';
      newCell.style.transition = 'none';
      oldCell.style.transition = 'none';
      wrap.style.width = widthOf(oldStr[i]) + 'px';
      oldCell.style.transform = 'translateY(0px)';
      newCell.style.transform = 'translateY(-' + rowH + 'px)';
      wrap.appendChild(newCell);
      wrap.appendChild(oldCell);
      charRow.appendChild(wrap);
      cells.push({ wrap: wrap, newCell: newCell, oldCell: oldCell,
                   newWidth: widthOf(newStr[i]), delay: START_DELAY + i * STAGGER });
    }
    track.removeChild(meas);
    // The swap to the char-row happens NOW — before first paint — so on a
    // transitioned arrival the wheel shows the OLD page's label during the
    // fade, matching the outgoing snapshot underneath (that region reads
    // as seamless). Only the roll itself waits for settle. Gating the
    // whole build at settle instead (previous attempt) let the
    // server-rendered CURRENT label paint during the fade and then flip
    // back to the old one — read as blank/wrong-page for a beat.
    track.innerHTML = '';
    track.appendChild(charRow);
    whenPageSettled(function () {
      charRow.getBoundingClientRect();
      requestAnimationFrame(function () {
        cells.forEach(function (c) {
          var t = ' ' + DURATION + ' ' + c.delay + 'ms';
          c.wrap.style.transition = 'width' + t;
          c.newCell.style.transition = 'transform' + t;
          c.oldCell.style.transition = 'transform' + t;
          // End: box sized to the NEW character; new char rolls into view,
          // old char rolls down and out below (clipped by overflow:hidden).
          c.wrap.style.width = c.newWidth + 'px';
          c.newCell.style.transform = 'translateY(0px)';
          c.oldCell.style.transform = 'translateY(' + rowH + 'px)';
        });
      });
      // Once the last character's transition is done, swap back to the
      // plain text row main.css already knows how to space correctly
      // (letter-spacing, no per-character width math) rather than leaving
      // the more complex per-character DOM sitting there indefinitely.
      var totalMs = START_DELAY + (len - 1) * STAGGER + DURATION_MS + 60;
      setTimeout(function () {
        track.innerHTML = '';
        var restRow = document.createElement('div');
        restRow.className = 'page-wheel-row';
        restRow.textContent = currentLabel;
        track.appendChild(restRow);
      }, totalMs);
    });
  }
})();

// ---- Scroll reveals (skipped entirely under reduced motion) ----
// The small labels (section .cue, .work .label) and the value numbers
// (.val .n, .conviction .num) are handled by the character-reveal cascade
// below instead — here their parents' TEXT parts still fade normally
// (.work > div:not(.label), .conviction > div:not(.num), .val h3/p);
// only the label/number itself rolls.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  var targets = Array.prototype.slice.call(document.querySelectorAll('section h2, section .lede, section .body-text, .val h3, .val p, .conviction > div:not(.num), .work > div:not(.label), .person, .give-card, .frame, .empty, .resource-card, .bio-photo'));
  // Hide (.sr) immediately — pre-paint — then split by arrival type at
  // pagereveal: on a TRANSITIONED arrival, anything already inside the
  // viewport is un-hidden again (still pre-paint, so it never flashes) and
  // simply rides the fade in with the rest of the page — hiding it and
  // fading it in after the transition read as "the transition didn't
  // apply to it" on content-dense pages (Values' convictions, Resources'
  // cards). Below-fold targets keep the scroll-triggered fade, observed
  // once the page settles. On a plain load (no transition) everything
  // keeps the load-time fade exactly as before.
  targets.forEach(function (el) { el.classList.add('sr'); });
  var toObserve = targets;
  atPageReveal(function (viaTransition) {
    if (!viaTransition) return;
    var vh = window.innerHeight;
    toObserve = [];
    targets.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < vh && r.bottom > 0) el.classList.remove('sr');
      else toObserve.push(el);
    });
  });
  var io = new IntersectionObserver(function (entries) {
    var batch = entries.filter(function (e) { return e.isIntersecting; })
                       .map(function (e) { return e.target; });
    if (!batch.length) return;
    // A batch that reveals together (a grid of team cards, the values
    // list, resource cards) cascades top-to-bottom instead of popping in
    // as one block — same choreography the label cascade uses. The delay
    // is cleared once the fade is over so it can't slow any later
    // transition (hover etc.) on the same element.
    batch.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
    batch.forEach(function (el, i) {
      io.unobserve(el);
      el.style.transitionDelay = (i * 90) + 'ms';
      el.classList.add('in');
      setTimeout(function () { el.style.transitionDelay = ''; }, 800 + i * 90);
    });
  }, { threshold: 0.12 });
  whenPageSettled(function () {
    toObserve.forEach(function (el) { io.observe(el); });
  });
}

// ---- Character-reveal cascade for small labels (2026-07-20) ----
// The section cue labels (and their leading counter number), the Mission
// work labels, and the Values numbers (home .val numerals + the Values-
// page .conviction numbers) roll their characters into place as they
// scroll in, cascading top-to-bottom when several are on screen at once.
// Torn back to plain text once each roll completes, so the resting DOM
// (and the CSS counter/letter-spacing) is untouched.
//
// Starts via whenPageSettled (the shared view-transition gate above), so
// during a cross-page transition its CSS-pre-hidden targets simply read
// as absent, then roll in once the fade finishes — running during the
// fade is what originally made transitions stutter. Without a transition
// it runs immediately.
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  function initCharReveal() {
    // Matched to the page-wheel's own roll so the two read as the same
    // motion: same 1.3s duration and ease-in-out curve, same ~40ms
    // per-character stagger, same top-down direction. ELEMENT_STAGGER is
    // this effect's own addition — the beat between labels in one batch.
    var CHAR_STAGGER = 40;      // ms between characters within one label
    var NUMBER_STAGGER = 150;   // wider gap for the 2-digit value numbers, so
                                // the second digit clearly follows the first
    var ELEMENT_STAGGER = 160;  // ms between labels revealed in the same batch
    var ROLL = '1.3s cubic-bezier(.55,.05,.45,.95)';
    var crTargets = Array.prototype.slice.call(document.querySelectorAll('section .cue, .work .label, .val .n, .conviction .num'));
    // Cue leading numbers mirror the CSS counter (section .cue::before,
    // decimal-leading-zero) — computed here so they can roll in with the
    // text; the ::before is hidden (.cr-nonum) only while a cue is rolling.
    var cueNum = 0;
    document.querySelectorAll('section .cue').forEach(function (el) {
      cueNum++;
      el.dataset.crNum = (cueNum < 10 ? '0' : '') + cueNum;
    });

    function buildRun(container, str, marginPx, opacity, lh, inners) {
      for (var i = 0; i < str.length; i++) {
        var box = document.createElement('span');
        box.className = 'cr-box';
        box.style.height = lh + 'px';
        box.style.marginRight = marginPx + 'px';
        var inner = document.createElement('span');
        inner.className = 'cr-in';
        inner.style.height = lh + 'px';
        inner.style.lineHeight = lh + 'px';
        if (opacity !== 1) inner.style.opacity = opacity;
        inner.textContent = str[i] === ' ' ? '\u00A0' : str[i];
        inner.style.transition = 'none';
        inner.style.transform = 'translateY(-' + lh + 'px)'; // starts above; drops in (top-down, like the wheel)
        box.appendChild(inner);
        container.appendChild(box);
        inners.push(inner);
      }
    }

    function reveal(el, elDelay, charStagger) {
      var cs = getComputedStyle(el);
      var fs = parseFloat(cs.fontSize);
      var lh = parseFloat(cs.lineHeight); if (isNaN(lh)) lh = fs * 1.25;
      var labelLs = parseFloat(cs.letterSpacing); if (isNaN(labelLs)) labelLs = 0;
      var label = el.textContent;
      var num = el.dataset.crNum;
      el.textContent = '';
      el.style.letterSpacing = '0';
      var inners = [];
      if (num) {
        // Leading number: the CSS counter is .2em-spaced and dimmed (.65),
        // then a 14px gap before the label — mirror that so the revert is
        // seamless.
        el.classList.add('cr-nonum');
        buildRun(el, num, fs * 0.2, 0.65, lh, inners);
        if (el.lastChild) el.lastChild.style.marginRight = (fs * 0.2 + 14) + 'px';
      }
      buildRun(el, label, labelLs, 1, lh, inners);
      el.style.opacity = '1';
      el.getBoundingClientRect();
      requestAnimationFrame(function () {
        inners.forEach(function (inner, i) {
          inner.style.transition = 'transform ' + ROLL + ' ' + (elDelay + i * charStagger) + 'ms';
          inner.style.transform = 'translateY(0)';
        });
      });
      var totalMs = elDelay + (inners.length - 1) * charStagger + 1300 + 80;
      setTimeout(function () {
        el.textContent = label;       // back to plain text (counter reappears)
        el.style.letterSpacing = '';
        el.classList.remove('cr-nonum');
      }, totalMs);
    }

    var crObserver = new IntersectionObserver(function (entries) {
      var show = entries.filter(function (e) { return e.isIntersecting; })
                        .map(function (e) { return e.target; });
      // Cascade top-to-bottom: sort this batch by vertical position, then
      // give each a base delay one ELEMENT_STAGGER after the one above it.
      show.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
      show.forEach(function (el, i) {
        crObserver.unobserve(el);
        // The value numbers (.n / .num) are only 1-2 chars, so they get the
        // wider NUMBER_STAGGER; multi-character labels get the tighter one.
        var isNumber = el.classList.contains('n') || el.classList.contains('num');
        reveal(el, i * ELEMENT_STAGGER, isNumber ? NUMBER_STAGGER : CHAR_STAGGER);
      });
    }, { threshold: 0.6 });
    crTargets.forEach(function (el) { crObserver.observe(el); });
  }

  whenPageSettled(initCharReveal);
})();

// ---- Whisper-parallax on framed photos + portraits (2026-07-20, portraits 2026-07-21) ----
// The photo drifts vertically a touch slower than the page as its frame
// passes through the viewport, for a subtle sense of depth. The frame's
// focal zoom lives in an inline transform:scale() with transform-origin
// at the focal point; this reads that base scale, bumps it just enough to
// create vertical headroom (so the drift never exposes the frame edge),
// and rewrites only `transform` (transform-origin, i.e. the focal point,
// is left untouched). Skipped entirely under reduced motion, where the
// images keep their exact framing.
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  var pFrames = [];
  document.querySelectorAll('.frame img, .person-photo img').forEach(function (img) {
    var m = /scale\(([\d.]+)\)/.exec(img.style.transform || '');
    var base = m ? parseFloat(m[1]) : 1;
    var scale = Math.max(base, 1) * 1.12; // >=1.12 => >=6% overflow each side
    img.style.willChange = 'transform';
    pFrames.push({ frame: img.parentNode, img: img, scale: scale });
  });
  if (pFrames.length) {
    var PMAX = 0.045; // drift, as a fraction of frame height (< the 6% headroom)
    var pTicking = false;
    var pUpdate = function () {
      var vh = window.innerHeight;
      pFrames.forEach(function (f) {
        var r = f.frame.getBoundingClientRect();
        var center = r.top + r.height / 2;
        var p = (center - vh / 2) / (vh / 2 + r.height / 2);
        if (p < -1) p = -1; else if (p > 1) p = 1;
        // Negative p * drift: as you scroll down (frame travels up), the
        // image drifts DOWN within the frame, so it moves slower than the
        // page and reads as "further back" (true background parallax).
        // Without the minus it swept up in sync with scroll, moving faster
        // than the page — which felt backward.
        var ty = -p * PMAX * r.height;
        f.img.style.transform = 'translate3d(0,' + ty.toFixed(1) + 'px,0) scale(' + f.scale.toFixed(3) + ')';
      });
      pTicking = false;
    };
    var pRequest = function () { if (!pTicking) { pTicking = true; requestAnimationFrame(pUpdate); } };
    window.addEventListener('scroll', pRequest, { passive: true });
    window.addEventListener('resize', pRequest);
    pUpdate(); // set initial positions so there's no jump on first scroll
  }
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
      '.thauma-trail-shake-active{animation:thauma-trail-shake .14s steps(1,end) 3}' +
      // Text-only glitch: applied directly to one element (the wordmark on
      // door 1's 4th tap) instead of the whole page — RGB-split + skew/
      // jitter on the element itself, no page-wide filter/invert at all.
      '@keyframes thauma-text-glitch{' +
      '0%,100%{transform:translate(0,0) skewX(0);text-shadow:none}' +
      '6%{transform:translate(-7px,3px) skewX(7deg);text-shadow:6px 0 rgba(255,45,106,.9),-6px 0 rgba(47,216,255,.9)}' +
      '13%{transform:translate(6px,-4px);text-shadow:none}' +
      '20%{transform:translate(-8px,2px) skewX(-6deg);text-shadow:-7px 1px rgba(255,45,106,.9),7px -1px rgba(92,242,196,.9)}' +
      '28%{transform:translate(5px,-3px);text-shadow:none}' +
      '36%{transform:translate(-4px,5px) skewX(5deg);text-shadow:5px 0 rgba(255,45,106,.85),-5px 0 rgba(47,216,255,.85)}' +
      '45%{transform:translate(7px,-2px);text-shadow:none}' +
      '54%{transform:translate(-6px,-3px) skewX(-4deg);text-shadow:-5px 0 rgba(255,45,106,.8),5px 0 rgba(92,242,196,.8)}' +
      '64%{transform:translate(4px,3px);text-shadow:none}' +
      '74%{transform:translate(-3px,-2px) skewX(3deg);text-shadow:4px 0 rgba(255,45,106,.7),-4px 0 rgba(47,216,255,.7)}' +
      '85%{transform:translate(2px,1px);text-shadow:none}' +
      '100%{transform:translate(0,0) skewX(0);text-shadow:none}}' +
      '.thauma-text-glitch-active{animation:thauma-text-glitch 1s steps(1,end)}';
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

    // lingerMs: how long the phrase stays fully visible before fading (the
    // sitewide trail's default is a quick flash; door 1's "let them read it"
    // moment passes a much longer value). skipPageEffects: door 1's step 3
    // is meant to be a calm, readable beat, not accompanied by a page-wide
    // flash — the trail's own use (via trailStep) still gets both.
    function flashWhisper(lingerMs, skipPageEffects) {
      var linger = lingerMs || 380;
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
      setTimeout(function () { el.style.opacity = '0'; setTimeout(function () { el.remove(); }, 150); }, linger);
      if (!skipPageEffects) {
        glitchFlash();
        scanlineBurst();
      }
    }

    // A big glitch on ONE element (RGB-split + skew jitter), not the page —
    // door 1's 4th tap: "the text glitches more than the page."
    function textGlitchBurst(el) {
      el.classList.remove('thauma-text-glitch-active');
      void el.offsetWidth;
      el.classList.add('thauma-text-glitch-active');
    }

    // A short-lived RGB-split clone of a real on-page text element, parked
    // over its original spot and jittering slightly — "adds elements to
    // whatever page they're on," built from that page's own text rather
    // than an invented overlay.
    function spawnTextGhost(el) {
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      var style = getComputedStyle(el);
      var ghost = document.createElement('div');
      ghost.textContent = el.textContent.trim().slice(0, 60);
      ghost.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
        'width:' + rect.width + 'px;max-height:' + rect.height + 'px;overflow:hidden;' +
        'font-family:' + style.fontFamily + ';font-size:' + style.fontSize + ';font-weight:' + style.fontWeight + ';' +
        'letter-spacing:' + style.letterSpacing + ';color:rgba(237,242,248,.85);pointer-events:none;z-index:99997;' +
        'text-shadow:3px 0 rgba(255,45,106,.85),-3px 0 rgba(47,216,255,.85);opacity:0;transition:opacity .08s ease';
      document.body.appendChild(ghost);
      requestAnimationFrame(function () { ghost.style.opacity = '.9'; });
      var jitter = setInterval(function () {
        ghost.style.transform = 'translate(' + (Math.random() * 8 - 4).toFixed(1) + 'px,' + (Math.random() * 6 - 3).toFixed(1) + 'px)';
      }, 90);
      var life = 450 + Math.random() * 300;
      setTimeout(function () {
        clearInterval(jitter);
        ghost.style.opacity = '0';
        setTimeout(function () { ghost.remove(); }, 200);
      }, life);
    }

    // Real, currently-visible text on whatever page the sequence is being
    // typed on — the ghosts are built from this, not a fixed invented list.
    function pageTextTargets() {
      return Array.prototype.filter.call(
        document.querySelectorAll('h1, h2, h3, .cue, .lede, .links a, .nav-actions a, .wordmark, p'),
        function (el) {
          var r = el.getBoundingClientRect();
          return el.textContent.trim().length > 1 && r.width > 0 && r.top < window.innerHeight && r.bottom > 0;
        }
      );
    }

    // Konami steps 3+: each correct input adds one more ghost element to
    // the page (steps 1-2, both ArrowUp, add nothing at all). Fast typers
    // naturally see several ghosts piled up at once since each lingers
    // ~450-750ms — the escalation is in the accumulation, not a count.
    function addPageGlitchElement() {
      if (reducedMotion) return;
      var targets = pageTextTargets();
      if (!targets.length) return;
      spawnTextGhost(targets[Math.floor(Math.random() * targets.length)]);
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
    // Bespoke escalation (not the shared trailStep ratio-curve): taps 1-2
    // are silent, tap 3 is a calm readable taunt (long linger, no page
    // flash), tap 4 is a big glitch on the wordmark text itself, tap 5
    // enters the game. A wrong click just resets the count — no static pop.
    document.querySelectorAll('.wordmark').forEach(function (mark) {
      var tapCount = 0;
      mark.addEventListener('click', function (e) {
        tapCount++;
        if (tapCount >= 5) {
          tapCount = 0;
          openGame();
          return;
        }
        if (tapCount === 3) flashWhisper(1900, true);
        else if (tapCount === 4) textGlitchBurst(mark);
      });
      document.addEventListener('click', function (e) {
        if (mark.contains(e.target)) return;
        tapCount = 0;
      });
    });

    // ---- Door 2: Konami code, anywhere, Enter as a supplemental "Start" ----
    // Bespoke escalation: the first two inputs (both ArrowUp) are silent;
    // every correct input after that adds one ghost-text element to
    // whatever page the sequence is being typed on, instead of a page-wide
    // flash — "the text glitches more than the page." Wrong input just
    // resets the position — no static pop.
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
        if (konamiPos > 2) addPageGlitchElement();
      } else if (konamiPos > 0) {
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
