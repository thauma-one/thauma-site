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
/* OPEN A PLACE IN THE MAPS APP SOMEBODY ACTUALLY USES.
 *
 * The markup carries a neutral web map, so the link works with no JavaScript,
 * on any platform, and forces nothing. This upgrades it where the operating
 * system genuinely has a default worth honoring:
 *
 *   Apple      maps://  — the Maps app, which IS the default on iOS and macOS
 *   Android    geo:     — the real standard for a place; Android hands it to
 *                         whatever the person chose, Google Maps or not
 *   elsewhere  left alone; a desktop has no maps app to open, and geo: there
 *              is a dead link
 *
 * DELIBERATELY NOT GOOGLE. A Google Maps URL is the one every platform
 * recognizes, which is why it is the usual answer and why every map link opens
 * Google whatever you use. Recognized by everything is not the same as right
 * for anybody.
 *
 * Sniffing the platform is normally a mistake — but "which app should open
 * this" is a question about the device, not about the browser's capabilities,
 * and there is no feature to test for. Anything unrecognised keeps the web
 * map, so being wrong costs nothing.
 */
(function enhanceMapLinks() {
  var links = document.querySelectorAll('a[data-map]');
  if (!links.length) return;

  var ua = navigator.userAgent || '';
  var isApple = /iPad|iPhone|iPod/.test(ua) ||
                (/Macintosh/.test(ua) && 'ontouchend' in document) ||
                /Mac OS X/.test(ua);
  var isAndroid = /Android/.test(ua);
  if (!isApple && !isAndroid) return;          // the web map is the right answer

  Array.prototype.forEach.call(links, function (a) {
    var place = a.getAttribute('data-map');
    if (!place) return;
    var q = encodeURIComponent(place);
    /* `?q=` is a SEARCH in both schemes, which is what a written address is —
       geocoding it here would mean holding coordinates for a venue that has
       not been confirmed yet. */
    a.setAttribute('href', isApple ? 'maps://?q=' + q : 'geo:0,0?q=' + q);
    /* A native app is not a new browser tab. Leaving target=_blank on it opens
       an empty tab behind the map on iOS. */
    a.removeAttribute('target');
    a.removeAttribute('rel');
  });
})();

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
  var targets = Array.prototype.slice.call(document.querySelectorAll('section h2, section .lede, section .body-text, .val h3, .val p, .conviction > div:not(.num), .work > div:not(.label), .person, .give-card, .frame, .empty, .resource-card, .bio-photo, .invite, .record-band'));
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
      /* THE INVITATION'S ONE MOMENT, hung on the reveal that already exists
         rather than a second observer watching the same element. The light
         draws along the card's top edge as it arrives and never again — a loop
         would be decoration, and the brief asked for one moment, not several.

         The date rolls in under it, per character, through the SAME cascade
         the section cues and the page wheel use. Called rather than copied:
         the date is inside a card that is still fading up, so the cascade's
         own observer would have rolled it while it was invisible and the
         moment would have been spent before anybody could see it. .6s in,
         which is after the seam has drawn most of the way across. */
      if (el.classList.contains('invite')) {
        el.classList.add('sr-in');
        var when = el.querySelector('.invite-date');
        if (when && window.ThaumaRollChars) {
          setTimeout(function () { window.ThaumaRollChars(when, 0, 40); }, 600);
        }
      }
      setTimeout(function () { el.style.transitionDelay = ''; }, 800 + i * 90);
    });
  }, { threshold: 0.12 });
  whenPageSettled(function () {
    toObserve.forEach(function (el) { io.observe(el); });
  });
}

// ---- The library's four doors, search and formats (2026-09-25) ----
// Filed by the MOMENT somebody is in, not by subject — see the reasoning in
// src/_data/resources.js. This filters the grid in the browser: the library
// is a few dozen cards at most, so asking a server would add a wait to
// something that should feel like sorting objects on a table.
//
// THE DOOR IS IN THE URL. ?door=crisis&q=hum survives a reload and can be
// sent to somebody — "here, this is the page you want" — which a filter held
// only in memory cannot do. replaceState, not pushState: refining a search
// should not fill the back button with every keystroke.
(function () {
  var lib = document.getElementById('lib');
  if (!lib) return;

  var grid = document.getElementById('libGrid');
  var none = document.getElementById('libNone');
  var q = document.getElementById('libQ');
  var cards = Array.prototype.slice.call(grid.querySelectorAll('.resource-card'));
  var doors = Array.prototype.slice.call(lib.querySelectorAll('.door'));
  var fmts = Array.prototype.slice.call(lib.querySelectorAll('.fmt'));

  // The controls are inert without this file, so they stay out of the page
  // until it runs. See the comment in resources.njk.
  lib.classList.add('lib-js');

  var state = { door: null, fmt: null, q: '' };

  function matches(card, ignore) {
    if (state.door && ignore !== 'door' && card.dataset.moment !== state.door) return false;
    if (state.fmt && ignore !== 'fmt' && card.dataset.format !== state.fmt) return false;
    if (state.q && (card.dataset.text || '').indexOf(state.q) === -1) return false;
    return true;
  }

  /* A CARD THE FILTER SHOWS MUST BE VISIBLE.
     The scroll-reveal hides every card behind `sr` until its observer adds
     `in`. A card that was display:none when that observer ran was never
     revealed — so arriving at ?door=crisis and then clearing the door showed
     the right cards as empty boxes. Reveal on the way back in, but only after
     the first pass, or the load-time fade would be skipped for the whole
     grid. */
  var settledOnce = false;
  function ensureVisible(card) {
    if (!settledOnce) return;
    if (card.classList.contains('sr')) card.classList.add('in');
  }

  function apply() {
    var shown = 0;
    cards.forEach(function (card) {
      var on = matches(card);
      card.hidden = !on;
      if (on) { shown++; ensureVisible(card); }
    });

    // COUNTS ARE WHAT IS LEFT, not what exists. A door reading 6 that shows
    // nothing once you press it is a lie the first time and ignored after.
    // Each door counts against the OTHER filters but not against itself, so
    // the numbers describe what pressing it would actually give you.
    doors.forEach(function (b) {
      var n = cards.filter(function (c) {
        return c.dataset.moment === b.dataset.door && matches(c, 'door');
      }).length;
      b.querySelector('.door-n').textContent = n ? n : '';
      // Dimmed rather than disabled: a door that leads nowhere right now is
      // still worth seeing, and a control that vanishes under your hand is
      // worse than one that is plainly quiet.
      b.classList.toggle('is-empty', n === 0);
      b.setAttribute('aria-pressed', state.door === b.dataset.door ? 'true' : 'false');
    });
    fmts.forEach(function (b) {
      var n = cards.filter(function (c) {
        return c.dataset.format === b.dataset.fmt && matches(c, 'fmt');
      }).length;
      b.classList.toggle('is-empty', n === 0);
      b.setAttribute('aria-pressed', state.fmt === b.dataset.fmt ? 'true' : 'false');
    });

    none.hidden = shown !== 0;
    grid.hidden = shown === 0;

    var p = new URLSearchParams();
    if (state.door) p.set('door', state.door);
    if (state.fmt) p.set('format', state.fmt);
    if (state.q) p.set('q', state.q);
    var qs = p.toString();
    try {
      history.replaceState(null, '', qs ? location.pathname + '?' + qs : location.pathname);
    } catch (e) { /* file:// and some embedded browsers refuse; filtering still works */ }
  }

  // Pressing the door you are already inside returns you to everything —
  // the same control both ways, so there is no separate "clear" to find.
  doors.forEach(function (b) {
    b.addEventListener('click', function () {
      state.door = state.door === b.dataset.door ? null : b.dataset.door;
      apply();
    });
  });
  fmts.forEach(function (b) {
    b.addEventListener('click', function () {
      state.fmt = state.fmt === b.dataset.fmt ? null : b.dataset.fmt;
      apply();
    });
  });
  if (q) {
    q.addEventListener('input', function () {
      state.q = q.value.trim().toLowerCase();
      apply();
    });
  }
  document.getElementById('libClear').addEventListener('click', function () {
    state = { door: null, fmt: null, q: '' };
    if (q) q.value = '';
    apply();
    if (q) q.focus();
  });

  // Arriving with a door already chosen, from a link somebody was sent.
  var incoming = new URLSearchParams(location.search);
  var d = incoming.get('door'), f = incoming.get('format'), iq = incoming.get('q');
  if (d && doors.some(function (b) { return b.dataset.door === d; })) state.door = d;
  if (f && fmts.some(function (b) { return b.dataset.fmt === f; })) state.fmt = f;
  if (iq) { state.q = iq.trim().toLowerCase(); if (q) q.value = iq; }
  apply();
  /* Everything from here is a person pressing something, so a card coming
     back into the grid has to arrive visible. */
  settledOnce = true;
})();

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

    /* Lent to the invitation, which needs the same roll on its own schedule
       rather than on this observer's. One implementation, two callers. */
    window.ThaumaRollChars = reveal;

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

// The arcade's ways in live in js/arcade/doors.js (ARCADE-SPEC.md), sent
// only while the arcade is switched on.

// ---- STAY CONNECTED (2026-09-28): Thauma's sign-up form, from the footer ----
// Hand-built on the API rather than pasted from the embed (Chase: "I like
// custom coding it"). The lists are asked for once per page; the footer link
// appears only when there is one to join. The window is a native <dialog>, so
// focus stays inside it, Escape closes it and the page behind is inert. The
// server answers every sign-up the same way (so nobody learns who is already
// subscribed), and so does this: "check your email".
(function () {
  var dlg = document.getElementById('stay');
  var opener = document.querySelector('[data-stay-open]');
  if (!dlg || !opener || typeof dlg.showModal !== 'function') return;
  var API = '/embed/v1/thauma/signup';
  var form = document.getElementById('stayForm');
  var box = document.getElementById('stayLists');
  var msg = document.getElementById('stayMsg');
  var done = document.getElementById('stayDone');
  /* The fields by id: a form has a `name` of its own. */
  var email = document.getElementById('stay-email');
  var nameIn = document.getElementById('stay-name');
  var trap = form.querySelector('input[name=website]');
  var lists = [], started = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  fetch(API, { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      lists = (b && b.lists) || [];
      if (!lists.length) return;
      // One list needs no choosing: it is simply what they are joining.
      box.hidden = lists.length < 2;
      box.insertAdjacentHTML('beforeend', lists.map(function (l) {
        return '<label class="stay-list"><input type="checkbox" name="list" value="' + esc(l.slug) + '" checked>' +
          '<span><b>' + esc(l.name) + '</b>' +
          (l.description ? '<small>' + esc(l.description) + '</small>' : '') + '</span></label>';
      }).join(''));
      opener.hidden = false;
    })
    .catch(function () { /* no link rather than a broken one */ });

  function open() {
    form.hidden = false;
    done.hidden = true;
    msg.textContent = '';
    msg.className = 'stay-msg';
    started = Date.now();
    dlg.showModal();
  }
  opener.addEventListener('click', open);
  dlg.addEventListener('click', function (e) {
    // The close button, or a click on the backdrop (the dialog element itself).
    if (e.target === dlg || e.target.closest('[data-stay-close]')) dlg.close();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var picked = lists.length < 2 ? lists.map(function (l) { return l.slug; })
      : [].slice.call(form.querySelectorAll('input[name=list]:checked')).map(function (i) { return i.value; });
    if (!email.value.trim() || !email.checkValidity()) { email.focus(); return; }
    if (!picked.length) {
      msg.className = 'stay-msg bad';
      msg.textContent = dlg.getAttribute('data-pick-one');
      return;
    }
    var btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    msg.className = 'stay-msg';
    msg.textContent = dlg.getAttribute('data-sending');
    fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(), name: nameIn.value.trim(), lists: picked,
        website: trap ? trap.value : '', elapsed: Date.now() - started,
        // So the confirmation arrives in the language they were reading.
        lang: document.documentElement.lang || ''
      })
    }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (b) {
      if (!b || !b.ok) throw new Error('refused');
      // Replaced, not added to: a filled form under a thank-you invites a
      // second submission.
      form.hidden = true;
      done.hidden = false;
      done.focus();
      form.reset();
      [].forEach.call(form.querySelectorAll('input[name=list]'), function (i) { i.checked = true; });
    }).catch(function () {
      msg.className = 'stay-msg bad';
      msg.textContent = dlg.getAttribute('data-error');
    }).then(function () { btn.disabled = false; msg.textContent = msg.className.indexOf('bad') > -1 ? msg.textContent : ''; });
  });
})();
