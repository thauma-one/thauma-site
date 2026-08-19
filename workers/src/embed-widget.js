/**
 * embed-widget.js — the script that renders on somebody else's website
 *
 * Exported as a STRING because it is served to browsers rather than run in the
 * Worker. Keeping it here means it ships and versions with the endpoint that
 * serves it, instead of being a static asset pinned by a caching rule nobody
 * remembers writing.
 *
 * ONE CONSTRAINT WHILE EDITING: the widget source below contains no backticks
 * and no dollar-brace, because it lives inside a template literal. String
 * concatenation throughout — slightly uglier, and it removes a whole class of
 * escaping mistake that would only show up in a stranger's browser.
 *
 * THE DESIGN IS PORTED FROM chaseroush.com's TIMELINE
 * ---------------------------------------------------------------------------
 * Not reinvented. That timeline was designed and refined over months and Chase
 * asked for this to match it, so the pieces are carried across deliberately:
 *
 *   · a two-colour gradient rather than a flat fill, with a soft outer glow
 *   · a shimmer sweeping the filled portion every three seconds
 *   · a NOW marker on the roadmap — pulsing line, label, entrance animation
 *   · status dots: complete is solid and glowing, in-progress glows on a
 *     two-second cycle, upcoming is a hollow ring
 *   · percentages that count up from zero on a cubic ease-out
 *   · horizontal on a wide screen, vertical on a narrow one — genuinely
 *     different layouts, not one squashed
 *   · a legend, because three dot styles need naming once
 *   · 1.6s cubic-bezier(.16,1,.3,1) on every bar fill, which is the easing
 *     that makes the whole thing feel like one object
 *
 * The one thing that could NOT be carried across is the palette. CR's timeline
 * burns amber against a cool site; here the accent is chosen per partner, so
 * the second colour is derived from the first with color-mix rather than
 * named. Same structure, their colour.
 *
 * EVERY ANIMATION IS BEHIND prefers-reduced-motion. The shimmer, the pulse,
 * the glow and the count-up all stop — the widget still says the same thing,
 * it simply stops moving.
 *
 * WHAT THE WIDGET GUARANTEES TO THE PAGE IT LANDS ON
 * ---------------------------------------------------------------------------
 * A widget is a guest. It runs on sites Thauma does not control, cannot test,
 * and will never see. So:
 *
 *   · IT CANNOT BREAK THE HOST PAGE. Everything is inside a shadow root, so
 *     the host's CSS cannot reach in and this cannot leak out. Every failure
 *     path ends in a quiet message in its own box, never a thrown error.
 *   · IT TOUCHES NO GLOBALS but one namespaced object, and defines no styles
 *     outside its own root.
 *   · IT SENDS NOTHING BACK. No analytics, no cookies, no beacons. A partner
 *     embedding this is not handing us their visitors.
 *   · IT GROWS TO ITS CONTENT and never scrolls. Where it is framed — only
 *     the console preview does that — it posts its height out so the frame
 *     can follow.
 */

export const WIDGET_JS = String.raw`
/* Thauma embed widget. https://thauma.one
   Put this on a page:

     <div data-thauma="chase-roush" data-widget="goal"></div>
     <script src="https://thauma.one/embed/v1/widget.js" async></script>

   Options, all optional, as attributes on the div:

     data-widget   goal | roadmap        which visualiser        (default goal)
     data-lang     en | hr | sr | ...    which language          (default en)
     data-accent   #6D4AFF               overrides the partner's colour
     data-theme    auto | light | dark   overrides the partner's setting
*/
(function () {
  'use strict';

  if (window.__thaumaEmbed) return;          /* the script included twice */
  window.__thaumaEmbed = true;

  /* Where this script came from IS where the data comes from. Deriving it
     means a partner copying the snippet cannot point the markup at one host
     and the data at another, and staging embeds staging without an edit. */
  var ORIGIN = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s) return new URL(s).origin;
    } catch (e) { /* fall through */ }
    return 'https://thauma.one';
  })();

  var SEL = '[data-thauma]';
  var cache = {};        /* slug -> Promise, so two widgets are one fetch */

  var reduced = !!(window.matchMedia &&
                   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---- tiny helpers ------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* NaN when there is no usable date — and the null guard is the point.
     new Date(null) is the epoch, not an invalid date, so a milestone with no
     actual_date would sort to 1970 and appear FIRST. That is the exact bug the
     sort below claims to prevent, and it survives in this helper's ancestor on
     chaseroush.com because that data never carries a null. */
  function toTime(d) {
    if (d === null || d === undefined || d === '') return NaN;
    return new Date(d).getTime();
  }

  /* Sort that pushes undated items to the END rather than to 1970. */
  function byDate(a, b) {
    var ta = toTime(a.actual_date), tb = toTime(b.actual_date);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return ta - tb;
  }

  /* Currency from minor units. Intl knows that yen has no decimal places and
     that a Croatian reader expects 1.234,56 — hardcoding two decimals and a
     comma would be wrong in both directions. */
  function money(cents, currency, lang) {
    var amount = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(lang || 'en', {
        style: 'currency', currency: currency || 'USD',
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2
      }).format(amount);
    } catch (e) {
      return (currency || '') + ' ' + Math.round(amount);
    }
  }

  function whenDate(iso, lang) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(lang || 'en', {
        year: 'numeric', month: 'short'
      }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 7); }
  }

  /* The text for one milestone in the requested language, falling back to
     English and then to whatever exists. A roadmap with a blank row because
     one translation is missing looks broken; showing the English is honest
     and useful. */
  function pick(text, lang) {
    if (!text) return null;
    return text[lang] || text.en || text[Object.keys(text)[0]] || null;
  }

  var WORDS = {
    en: { now: 'NOW', complete: 'Completed', in_progress: 'In progress',
          upcoming: 'Upcoming', cancelled: 'Cancelled',
          of: 'of', partners: 'partners', partner: 'partner',
          empty: 'Nothing to show yet.', focus: 'Focus' },
    hr: { now: 'SADA', complete: 'Završeno', in_progress: 'U tijeku',
          upcoming: 'Nadolazeće', cancelled: 'Otkazano',
          of: 'od', partners: 'podupiratelja', partner: 'podupiratelj',
          empty: 'Još nema ničega za prikazati.', focus: 'Fokus' },
    sr: { now: 'САДА', complete: 'Завршено', in_progress: 'У току',
          upcoming: 'Предстоји', cancelled: 'Отказано',
          of: 'од', partners: 'подржавалаца', partner: 'подржавалац',
          empty: 'Још нема ничега за приказ.', focus: 'Фокус' }
  };
  function w(lang, key) { return (WORDS[lang] || WORDS.en)[key] || WORDS.en[key]; }

  /* ---- styles -------------------------------------------------------- */

  function styles(accent, mode) {
    /* Light and dark are both written out. The accent is the ONE colour that
       varies per partner; everything else is a derived neutral, so a partner
       choosing an unfortunate colour cannot make the text unreadable. */
    var light =
      ':host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;--track:#eef0f6}';
    var dark =
      ':host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;--track:#22222e}';

    var scheme;
    if (mode === 'light') scheme = light;
    else if (mode === 'dark') scheme = dark;
    else scheme = light + '@media(prefers-color-scheme:dark){' + dark + '}';

    return scheme +

      /* THE DUAL COLOUR. On chaseroush.com this is two named tokens; here the
         accent is per-partner, so the second is mixed from the first. The
         fallback keeps a single flat colour on browsers without color-mix
         rather than losing the fill entirely. */
      ':host{--accent:' + accent + ';--accent-hi:' + accent + ';' +
        '--glow:' + accent + '55}' +
      '@supports (color:color-mix(in srgb,red,blue)){' +
        ':host{--accent-hi:color-mix(in srgb,var(--accent) 55%,#fff);' +
          '--glow:color-mix(in srgb,var(--accent) 45%,transparent)}}' +

      ':host{all:initial;display:block;' +
        'font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,' +
        'Helvetica,Arial,sans-serif;color:var(--fg);line-height:1.5;' +
        '-webkit-font-smoothing:antialiased}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +

      '.card{background:var(--bg);border:1px solid var(--line);' +
        'border-radius:14px;padding:20px 22px}' +
      '.stack{display:flex;flex-direction:column;gap:14px}' +

      /* ---------- goal ---------- */
      '.label{font-size:13px;letter-spacing:.04em;text-transform:uppercase;' +
        'color:var(--dim);font-weight:600}' +
      '.amount{font-size:30px;font-weight:700;letter-spacing:-.02em;' +
        'font-variant-numeric:tabular-nums;margin-top:6px}' +
      '.amount .of{font-size:15px;font-weight:500;color:var(--dim);' +
        'letter-spacing:0}' +

      /* The track, the gradient fill, the glow and the shimmer — the four
         layers that make the bar read as lit rather than painted. */
      '.track{height:10px;background:var(--track);border-radius:99px;' +
        'margin:14px 0 10px;overflow:hidden;position:relative}' +
      '.fill{height:100%;width:0;border-radius:99px;position:relative;' +
        'overflow:hidden;background:linear-gradient(90deg,var(--accent),var(--accent-hi));' +
        'box-shadow:0 0 12px var(--glow);' +
        'transition:width 1.6s cubic-bezier(.16,1,.3,1)}' +
      '.fill:after{content:"";position:absolute;top:0;left:-100%;' +
        'width:100%;height:100%;' +
        'background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);' +
        'animation:sweep 3s infinite}' +
      '@keyframes sweep{0%{left:-100%}100%{left:200%}}' +

      '.meta{display:flex;justify-content:space-between;gap:12px;' +
        'font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}' +
      '.pct{color:var(--accent);font-weight:700}' +

      /* ---------- roadmap, shared ---------- */
      '.legend{display:flex;flex-wrap:wrap;gap:10px 18px;margin-bottom:22px;' +
        'font-size:12px;color:var(--dim)}' +
      '.lg{display:inline-flex;align-items:center;gap:7px}' +
      '.lgd{width:11px;height:11px;border-radius:50%;flex:0 0 auto}' +
      '.lgd.complete{background:var(--accent);box-shadow:0 0 7px var(--glow)}' +
      '.lgd.in_progress{background:var(--accent-hi);box-shadow:0 0 7px var(--glow)}' +
      '.lgd.upcoming{background:transparent;box-shadow:inset 0 0 0 2px var(--line)}' +

      /* ---------- roadmap, horizontal (wide) ---------- */
      '.rail{display:none;position:relative;padding:78px 8px 96px}' +
      '.railtrack{height:4px;border-radius:99px;position:relative;' +
        'background:var(--track)}' +
      '.railfill{position:absolute;left:0;top:0;height:100%;width:0;' +
        'border-radius:99px;overflow:hidden;' +
        'background:linear-gradient(90deg,var(--accent),var(--accent-hi));' +
        'box-shadow:0 0 14px var(--glow);' +
        'transition:width 1.6s cubic-bezier(.16,1,.3,1)}' +
      '.railfill:after{content:"";position:absolute;top:0;left:-100%;' +
        'width:100%;height:100%;' +
        'background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);' +
        'animation:sweep 3s infinite}' +

      /* NOW: a pulsing line with a label, entering once on load. */
      '.now{position:absolute;top:0;transform:translateX(-50%);z-index:6;' +
        'animation:nowIn .9s cubic-bezier(.16,1,.3,1) .45s both}' +
      '@keyframes nowIn{from{opacity:0;transform:translateX(-50%) scaleY(.3)}' +
        'to{opacity:1;transform:translateX(-50%) scaleY(1)}}' +
      '.nowline{width:2px;height:46px;background:var(--accent-hi);' +
        'position:absolute;top:-21px;left:50%;transform:translateX(-50%);' +
        'box-shadow:0 0 9px var(--glow);animation:pulse 2s ease-in-out infinite}' +
      '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
      '.nowlabel{position:absolute;bottom:28px;left:50%;' +
        'transform:translateX(-50%);white-space:nowrap;font-size:11px;' +
        'font-weight:700;letter-spacing:.1em;color:var(--accent-hi)}' +

      '.pin{position:absolute;top:-30px;transform:translateX(-50%);' +
        'width:132px;margin-left:0;text-align:center;cursor:default}' +
      '.dot{width:18px;height:18px;border-radius:50%;border:3px solid;' +
        'display:block;margin:0 auto 9px;' +
        'transition:transform .2s cubic-bezier(.16,1,.3,1)}' +
      '.dot.complete{background:var(--accent);border-color:var(--accent);' +
        'box-shadow:0 0 14px var(--glow)}' +
      '.dot.in_progress{background:var(--accent-hi);border-color:var(--accent-hi);' +
        'animation:glow 2s ease-in-out infinite}' +
      '@keyframes glow{0%,100%{box-shadow:0 0 13px var(--glow)}' +
        '50%{box-shadow:0 0 24px var(--glow),0 0 34px var(--glow)}}' +
      '.dot.upcoming{background:var(--bg);border-color:var(--line)}' +
      '.dot.cancelled{background:var(--bg);border-color:var(--line);opacity:.5}' +
      '.pin:hover .dot{transform:scale(1.22)}' +
      '.up .lab{margin-top:0}' +
      '.lab{font-size:13px;line-height:1.4}' +
      '.lab b{display:block;font-weight:650;margin-bottom:3px}' +
      '.lab .d{font-size:11.5px;color:var(--dim)}' +
      '.lab .p{display:block;margin-top:3px;color:var(--accent);font-weight:700;' +
        'font-variant-numeric:tabular-nums}' +
      /* Alternate above and below the rail so long titles never collide. */
      '.pin.down{top:22px}' +
      '.pin.down .dot{margin:0 auto}' +
      '.pin.down .lab{margin-top:9px}' +

      /* ---------- roadmap, vertical (narrow) ---------- */
      '.col{position:relative;padding-left:34px}' +
      '.col:before{content:"";position:absolute;left:8px;top:6px;bottom:6px;' +
        'width:2px;background:var(--track);border-radius:2px}' +
      '.colfill{position:absolute;left:8px;top:6px;width:2px;border-radius:2px;' +
        'height:0;background:linear-gradient(180deg,var(--accent),var(--accent-hi));' +
        'box-shadow:0 0 8px var(--glow);' +
        'transition:height 1.6s cubic-bezier(.16,1,.3,1);overflow:hidden}' +
      '.colfill:after{content:"";position:absolute;left:0;top:-100%;' +
        'width:100%;height:56px;' +
        'background:linear-gradient(180deg,transparent,rgba(255,255,255,.75),transparent);' +
        'animation:vsweep 3s ease-in-out infinite}' +
      '@keyframes vsweep{0%{top:-100%}100%{top:200%}}' +
      '.step{position:relative;padding-bottom:22px}' +
      '.step:last-child{padding-bottom:0}' +
      '.sdot{position:absolute;left:-34px;top:2px;width:18px;height:18px;' +
        'border-radius:50%;border:3px solid;box-sizing:border-box}' +
      '.sdot.complete{background:var(--accent);border-color:var(--accent);' +
        'box-shadow:0 0 12px var(--glow)}' +
      '.sdot.in_progress{background:var(--accent-hi);border-color:var(--accent-hi);' +
        'animation:glow 2s ease-in-out infinite}' +
      '.sdot.upcoming{background:var(--bg);border-color:var(--line)}' +
      '.sdot.cancelled{background:var(--bg);border-color:var(--line);opacity:.5}' +
      '.when{font-size:11.5px;color:var(--dim);letter-spacing:.03em;' +
        'text-transform:uppercase;font-weight:600}' +
      '.title{font-size:15px;font-weight:650;margin-top:2px}' +
      '.step.cancelled .title{text-decoration:line-through;opacity:.6}' +
      '.desc{font-size:14px;color:var(--dim);margin-top:3px}' +
      '.spc{margin-top:4px;color:var(--accent);font-weight:700;font-size:13px;' +
        'font-variant-numeric:tabular-nums}' +
      '.feat{display:inline-block;margin-left:7px;font-size:10.5px;' +
        'color:var(--accent);border:1px solid var(--accent);border-radius:99px;' +
        'padding:1px 7px;vertical-align:1px;font-weight:700;letter-spacing:.04em}' +

      /* The vertical NOW dot rides the filled line. */
      '.vnow{position:absolute;left:9px;width:9px;height:9px;border-radius:50%;' +
        'background:#fff;transform:translate(-50%,-50%);z-index:4;' +
        'box-shadow:0 0 6px rgba(255,255,255,.9),0 0 13px var(--glow);' +
        'animation:vnowIn .8s cubic-bezier(.16,1,.3,1) .55s both,' +
          'ndot 2s ease-in-out infinite}' +
      '@keyframes vnowIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes ndot{0%,100%{transform:translate(-50%,-50%) scale(1)}' +
        '50%{transform:translate(-50%,-50%) scale(1.35)}}' +

      /* Which layout you get. Deliberately a container-independent width
         query on the HOST, because the widget does not know how wide the
         column it was dropped into is until it is measured. */
      '.is-wide .rail{display:block}' +
      '.is-wide .col{display:none}' +

      '.foot{margin-top:18px;padding-top:12px;border-top:1px solid var(--line);' +
        'font-size:12px;color:var(--dim)}' +
      '.foot a{color:inherit;text-decoration:none;' +
        'border-bottom:1px solid var(--line)}' +
      '.foot a:hover{color:var(--fg)}' +
      '.msg{font-size:14px;color:var(--dim);padding:16px 0;text-align:center}' +

      /* EVERY moving part stops. The widget still says the same thing. */
      '@media(prefers-reduced-motion:reduce){' +
        '.fill,.railfill,.colfill{transition:none}' +
        '.fill:after,.railfill:after,.colfill:after{animation:none;display:none}' +
        '.dot.in_progress,.sdot.in_progress,.nowline,.vnow,.now{animation:none}' +
      '}';
  }

  /* ---- count-up ------------------------------------------------------- */

  function countUp(node, target) {
    target = Math.round(target || 0);
    if (reduced) { node.textContent = String(target); return; }
    var dur = 1500, start = null;
    function frame(t) {
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---- the visualisers ----------------------------------------------- */

  function goalCard(goal, lang) {
    var card = el('div', 'card');

    card.appendChild(el('div', 'label', goal.label));

    var amt = el('div', 'amount');
    amt.appendChild(document.createTextNode(money(goal.raised_cents, goal.currency, lang)));
    if (goal.target_cents) {
      amt.appendChild(el('span', 'of',
        ' ' + w(lang, 'of') + ' ' + money(goal.target_cents, goal.currency, lang)));
    }
    card.appendChild(amt);

    /* percent can exceed 100, and over-funded is worth showing rather than
       clamping into a bar that looks merely finished. The BAR clamps; the
       number does not. */
    var pct = typeof goal.percent === 'number' ? goal.percent : 0;

    var track = el('div', 'track');
    var fill = el('div', 'fill');
    track.appendChild(fill);
    card.appendChild(track);

    var meta = el('div', 'meta');
    var pctEl = el('span', 'pct');
    var num = el('span', null, '0');
    pctEl.appendChild(num);
    pctEl.appendChild(document.createTextNode('%'));
    meta.appendChild(pctEl);
    if (goal.donor_count) {
      meta.appendChild(el('span', null, goal.donor_count + ' ' +
        w(lang, goal.donor_count === 1 ? 'partner' : 'partners')));
    }
    card.appendChild(meta);

    /* Painted after layout so the transition actually runs — setting the
       width in the same frame the element is created skips the animation. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
        countUp(num, pct);
      });
    });

    return card;
  }

  /* Spread milestones along the rail by DATE, then push apart anything that
     would overlap. Undated entries fall back to even spacing. Ported from
     chaseroush.com — the ten-pass relaxation is what stops two milestones a
     week apart printing on top of each other. */
  function positions(rows) {
    var n = rows.length;
    var evenly = rows.map(function (_, i) { return n <= 1 ? 50 : (i / (n - 1)) * 100; });

    var times = rows.map(function (m) { return toTime(m.actual_date); });
    var valid = times.filter(function (t) { return !isNaN(t); });
    if (valid.length < 2) return { pos: evenly, now: null };

    var min = Math.min.apply(null, valid);
    var max = Math.max.apply(null, valid);
    if (!(max > min)) return { pos: evenly, now: null };

    var pos = times.map(function (t) {
      if (isNaN(t)) return 100;
      return Math.min(100, Math.max(0, ((t - min) / (max - min)) * 100));
    });

    var gap = 13;
    for (var pass = 0; pass < 10; pass++) {
      var moved = false;
      for (var i = 1; i < pos.length; i++) {
        if (pos[i] - pos[i - 1] < gap) {
          var over = gap - (pos[i] - pos[i - 1]);
          pos[i - 1] = Math.max(0, pos[i - 1] - over / 2);
          pos[i] = Math.min(100, pos[i] + over / 2);
          moved = true;
        }
      }
      if (!moved) break;
    }

    var nowT = Date.now();
    var now = (nowT >= min && nowT <= max) ? ((nowT - min) / (max - min)) * 100 : null;
    return { pos: pos, now: now };
  }

  function roadmap(rows, lang) {
    var card = el('div', 'card');

    var legend = el('div', 'legend');
    ['complete', 'in_progress', 'upcoming'].forEach(function (s) {
      var item = el('span', 'lg');
      item.appendChild(el('span', 'lgd ' + s));
      item.appendChild(el('span', null, w(lang, s)));
      legend.appendChild(item);
    });
    card.appendChild(legend);

    var usable = rows.filter(function (m) {
      var t = pick(m.text, lang);
      return t && t.title;
    }).slice().sort(byDate);

    if (!usable.length) return null;

    var P = positions(usable);
    var done = usable.filter(function (m) { return m.status === 'complete'; }).length;
    var progress = usable.length ? (done / usable.length) * 100 : 0;

    /* ---- horizontal ---- */
    var rail = el('div', 'rail');
    var rt = el('div', 'railtrack');
    var rf = el('div', 'railfill');
    rt.appendChild(rf);

    if (P.now !== null) {
      var near = P.pos.some(function (x) { return Math.abs(x - P.now) < 6; });
      var now = el('div', 'now');
      now.style.left = P.now + '%';
      if (!near) now.appendChild(el('div', 'nowlabel', w(lang, 'now')));
      now.appendChild(el('div', 'nowline'));
      rt.appendChild(now);
    }

    usable.forEach(function (m, i) {
      var t = pick(m.text, lang);
      var pin = el('div', 'pin' + (i % 2 ? ' down' : ''));
      pin.style.left = P.pos[i] + '%';
      pin.appendChild(el('span', 'dot ' + (m.status || 'upcoming')));

      var lab = el('div', 'lab');
      var b = el('b', null, t.title);
      if (m.is_featured) b.appendChild(el('span', 'feat', w(lang, 'focus')));
      lab.appendChild(b);
      var d = whenDate(m.actual_date, lang);
      if (d) lab.appendChild(el('span', 'd', d));
      if (typeof m.completion === 'number' && m.completion > 0) {
        var p = el('span', 'p');
        var pn = el('span', null, '0');
        p.appendChild(pn);
        p.appendChild(document.createTextNode('%'));
        lab.appendChild(p);
        requestAnimationFrame(function () { countUp(pn, m.completion); });
      }
      pin.appendChild(lab);
      rail.appendChild(pin);
    });
    rail.appendChild(rt);
    card.appendChild(rail);

    /* ---- vertical ---- */
    var col = el('div', 'col');
    var cf = el('div', 'colfill');
    col.appendChild(cf);

    usable.forEach(function (m) {
      var t = pick(m.text, lang);
      var step = el('div', 'step ' + (m.status || 'upcoming'));
      step.appendChild(el('span', 'sdot ' + (m.status || 'upcoming')));

      var d = whenDate(m.actual_date, lang);
      if (d) step.appendChild(el('div', 'when', d));

      var title = el('div', 'title', t.title);
      if (m.is_featured) title.appendChild(el('span', 'feat', w(lang, 'focus')));
      step.appendChild(title);

      if (t.description) step.appendChild(el('div', 'desc', t.description));
      if (typeof m.completion === 'number' && m.completion > 0) {
        var sp = el('div', 'spc');
        var sn = el('span', null, '0');
        sp.appendChild(sn);
        sp.appendChild(document.createTextNode('%'));
        step.appendChild(sp);
        requestAnimationFrame(function () { countUp(sn, m.completion); });
      }
      col.appendChild(step);
    });
    card.appendChild(col);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        rf.style.width = progress + '%';
        cf.style.height = progress + '%';

        /* The white dot that marks today on the vertical line. Only while it
           is genuinely between the ends — at 0 or 100 it would sit on top of
           a milestone dot and read as a second status. */
        if (progress > 3 && progress < 97) {
          var vn = el('div', 'vnow');
          vn.style.top = progress + '%';
          col.appendChild(vn);
        }
      });
    });

    return card;
  }

  /* ---- rendering one placement --------------------------------------- */

  /* Which layout, decided by MEASURED width rather than the viewport. A
     widget dropped into a 320px sidebar on a desktop needs the vertical
     layout, and a media query would give it the horizontal one. */
  function applyWidth(host) {
    var wide = host.getBoundingClientRect().width >= 620;
    host.classList.toggle('is-wide', wide);
  }

  /* Tell a framing page how tall this is, so the frame can grow instead of
     scrolling. Only the console preview frames a widget; on a real site the
     div simply takes its natural height and this posts into the void. */
  function reportHeight(root) {
    if (window.parent === window) return;
    try {
      var h = Math.ceil(document.documentElement.scrollHeight);
      window.parent.postMessage({ __thaumaHeight: h }, '*');
    } catch (e) { /* cross-origin parent: nothing to do */ }
  }

  function render(node, data) {
    var lang   = node.getAttribute('data-lang') || 'en';
    var kind   = node.getAttribute('data-widget') || 'goal';
    var accent = node.getAttribute('data-accent') || (data.theme && data.theme.accent) || '#6D4AFF';
    var mode   = node.getAttribute('data-theme')  || (data.theme && data.theme.mode)   || 'auto';

    /* Anything not a six-digit hex is dropped rather than passed into CSS.
       It is the one attribute value that reaches a stylesheet. */
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = '#6D4AFF';
    if (['auto', 'light', 'dark'].indexOf(mode) === -1) mode = 'auto';

    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';

    var style = document.createElement('style');
    style.textContent = styles(accent, mode);
    root.appendChild(style);

    var host = el('div', 'host');
    var body;

    if (kind === 'roadmap') {
      body = roadmap(data.milestones || [], lang);
    } else {
      var goals = data.goals || [];
      if (goals.length) {
        body = el('div', 'stack');
        goals.forEach(function (g) { body.appendChild(goalCard(g, lang)); });
      }
    }

    if (!body) {
      body = el('div', 'card');
      body.appendChild(el('div', 'msg', w(lang, 'empty')));
    }
    host.appendChild(body);

    /* Attribution, and a way back. Not a tracking link — a plain anchor. */
    var foot = el('div', 'foot');
    var a = el('a', null, data.partner ? data.partner.display_name : 'Thauma');
    a.href = ORIGIN + '/partners/' + (data.partner ? data.partner.slug : '');
    a.rel = 'noopener';
    a.target = '_blank';
    foot.appendChild(a);
    body.appendChild(foot);

    root.appendChild(host);

    applyWidth(host);
    if (window.ResizeObserver) {
      /* window.X, not the bare global. The guard already names it that way,
         and matching it means the widget runs anywhere the window object is
         modelled, rather than only where these are true globals. */
      new window.ResizeObserver(function () { applyWidth(host); reportHeight(root); })
        .observe(node);
    } else {
      window.addEventListener('resize', function () { applyWidth(host); });
    }

    /* After the entrance animations have settled, and once more shortly
       after, because fonts land late and change the height. */
    setTimeout(function () { reportHeight(root); }, 60);
    setTimeout(function () { reportHeight(root); }, 900);
  }

  function fail(node, message) {
    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';
    var style = document.createElement('style');
    style.textContent = styles('#6D4AFF', node.getAttribute('data-theme') || 'auto');
    root.appendChild(style);
    var card = el('div', 'card');
    card.appendChild(el('div', 'msg', message));
    root.appendChild(card);
    setTimeout(function () { reportHeight(root); }, 40);
  }

  function load(slug) {
    /* PREVIEW. The console injects the payload rather than letting this fetch,
       for one reason: the public endpoint returns 404 until a partner switches
       embedding on, so a preview that fetched could only ever show you what
       you had already published. Look, then decide.

       Only ever set by the console, in a sandboxed iframe it built itself. A
       page that sets this is feeding the widget its own data, which is a thing
       anyone could do by writing their own HTML anyway. */
    if (window.__thaumaPreview && window.__thaumaPreview.partner &&
        window.__thaumaPreview.partner.slug === slug) {
      return Promise.resolve(window.__thaumaPreview);
    }

    if (!cache[slug]) {
      cache[slug] = fetch(ORIGIN + '/embed/v1/' + encodeURIComponent(slug) + '.json', {
        /* No credentials, ever. Saying so explicitly is what keeps the
           wildcard CORS on the other end safe. */
        credentials: 'omit',
        mode: 'cors'
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 404
          ? 'This ministry is not sharing a widget.'
          : 'Could not load.');
        return r.json();
      });
    }
    return cache[slug];
  }

  function mount(node) {
    if (node.__thaumaMounted) return;
    node.__thaumaMounted = true;

    var slug = node.getAttribute('data-thauma');
    if (!slug) return fail(node, 'No ministry named.');

    load(slug).then(function (data) {
      try { render(node, data); }
      catch (e) { fail(node, 'Could not display this.'); }
    }).catch(function (e) {
      fail(node, e.message || 'Could not load.');
    });
  }

  function scan() {
    var nodes = document.querySelectorAll(SEL);
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  /* Placements added later — a tab that renders on click, a CMS that injects
     after load. Cheap, and without it the widget silently does not appear on
     exactly the sites most likely to be built that way. */
  if (window.MutationObserver) {
    new window.MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { scan(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* One escape hatch, for pages that build their DOM entirely in script. */
  window.Thauma = { render: scan };
})();
`;
