/**
 * embed-widget.js — the script that renders on somebody else's website
 *
 * Exported as a STRING because it is served to browsers rather than run in the
 * Worker. Keeping it here means it ships and versions with the endpoint that
 * serves it.
 *
 * ONE CONSTRAINT WHILE EDITING: no backticks and no dollar-brace anywhere in
 * the widget source, because it lives inside a template literal.
 *
 * PORTED FROM chaseroush.com's TIMELINE — THE WHOLE THING, NOT THE SKIN
 * ---------------------------------------------------------------------------
 * The first attempt took the colours and the animations and stopped, which
 * missed what that page actually is. Rebuilt on the second pass:
 *
 *   · TWO COLOURS, not one. Completed and in-progress are visibly different
 *     hues — that is the first thing the legend tells you. The second is
 *     derived from a partner's chosen accent; see embed-colour.js.
 *   · IT IS INTERACTIVE. Clicking a milestone opens a details panel beneath
 *     the rail: title, date, big percentage, progress bar, description, close
 *     button. Clicking the open one closes it. Keyboard reaches it.
 *   · PARENTS AND CHILDREN. Only top-level milestones sit on the rail; a
 *     parent's percentage is the AVERAGE of its children, and the children
 *     appear as a breakdown inside the parent's panel. Without this a roadmap
 *     of any depth flattens into an unreadable row of dots.
 *   · THE DATE IS A WRITTEN LABEL. `target_label` is what a person typed —
 *     "End of September - Start of October 2026". `actual_date` is the machine
 *     date used only for POSITION. Formatting actual_date and showing that,
 *     which the first version did, throws away the sentence somebody wrote and
 *     replaces it with "Oct 2026".
 *   · THE ROADMAP IS NOT IN A CARD. It is the thing itself. Only goals are
 *     cards, because a goal is a discrete object and a roadmap is a continuum.
 *   · LABELS DO NOT COLLIDE. Alternating above and below, never wrapping, with
 *     the spacing relaxation from CR's position maths.
 *
 * GOAL CARDS follow the giving page: name, description behind a coloured rule,
 * the percentage large on the right with raised / target beneath it, a full
 * width bar, and either what remains or a funded badge.
 *
 * THE COLOUR MATHS IS DUPLICATED HERE, deliberately and unavoidably: this file
 * is a string shipped to browsers and cannot import anything. embed-colour.js
 * holds the same functions for the Worker and the tests, and a test asserts
 * the two agree on a spread of inputs — which is the only thing that keeps a
 * necessary duplication honest.
 */

export const WIDGET_JS = String.raw`
/* Thauma embed widget. https://thauma.one

     <div data-thauma="chase-roush" data-widget="goal"></div>
     <script src="https://thauma.one/embed/v1/widget.js" async></script>

   Attributes, all optional:
     data-widget   goal | roadmap | prayer (default goal)
     data-lang     en | hr | sr | ...    (default: the host page's own language)
     data-accent   #6D4AFF               overrides the ministry's colour
     data-theme    auto | light | dark
*/
(function () {
  'use strict';

  if (window.__thaumaEmbed) return;
  window.__thaumaEmbed = true;

  var ORIGIN = (function () {
    try {
      var s = document.currentScript && document.currentScript.src;
      if (s) return new URL(s).origin;
    } catch (e) {}
    return 'https://thauma.one';
  })();

  var SEL = '[data-thauma]';
  var cache = {};

  var reduced = !!(window.matchMedia &&
                   window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  /* NaN when there is no usable date. new Date(null) is the epoch, not an
     invalid date, so without this an undated milestone sorts to 1970 and
     appears first — the exact bug the sort exists to prevent. */
  function toTime(d) {
    if (d === null || d === undefined || d === '') return NaN;
    return new Date(d).getTime();
  }

  function byDate(a, b) {
    var ta = toTime(a.actual_date), tb = toTime(b.actual_date);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return ta - tb;
  }

  function money(cents, currency, lang) {
    var amount = (cents || 0) / 100;
    try {
      return new Intl.NumberFormat(lang || 'en', {
        style: 'currency', currency: currency || 'USD',
        maximumFractionDigits: amount % 1 === 0 ? 0 : 2
      }).format(amount);
    } catch (e) { return (currency || '') + ' ' + Math.round(amount); }
  }

  function monthYear(iso, lang) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(lang || 'en',
        { year: 'numeric', month: 'short' }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 7); }
  }

  function pick(text, lang) {
    if (!text) return null;
    return text[lang] || text.en || text[Object.keys(text)[0]] || null;
  }

  /* The date a READER sees. target_label is a sentence somebody wrote and is
     always preferred; the formatted date is only a fallback for a milestone
     nobody has labelled. */
  function dateText(m, lang) {
    var t = pick(m.text, lang);
    if (t && t.target_label) return t.target_label;
    return monthYear(m.actual_date, lang);
  }

  var WORDS = {
    en: { now: 'NOW', complete: 'Completed', in_progress: 'In progress',
          upcoming: 'Upcoming', cancelled: 'Cancelled', completeWord: 'Complete',
          remaining: 'remaining', funded: 'Funded',
          partners: 'partners', partner: 'partner', breakdown: 'Breakdown',
          empty: 'Nothing to show yet.', close: 'Close',
          answered: 'Answered', praying: 'Still praying' },
    hr: { now: 'SADA', complete: 'Završeno', in_progress: 'U tijeku',
          upcoming: 'Nadolazeće', cancelled: 'Otkazano', completeWord: 'Završeno',
          remaining: 'preostalo', funded: 'Financirano',
          partners: 'podupiratelja', partner: 'podupiratelj', breakdown: 'Raščlamba',
          empty: 'Još nema ničega za prikazati.', close: 'Zatvori',
          answered: 'Uslišano', praying: 'Još molimo' },
    sr: { now: 'САДА', complete: 'Завршено', in_progress: 'У току',
          upcoming: 'Предстоји', cancelled: 'Отказано', completeWord: 'Завршено',
          remaining: 'преостало', funded: 'Финансирано',
          partners: 'подржавалаца', partner: 'подржавалац', breakdown: 'Рашчламба',
          empty: 'Још нема ничега за приказ.', close: 'Затвори',
          answered: 'Услишено', praying: 'Још молимо' }
  };
  function w(lang, key) { return (WORDS[lang] || WORDS.en)[key] || WORDS.en[key]; }

  /* ---------- the COLOUR PAIR ----------
     Completed and in-progress are different hues, which is what the legend is
     for. The second is rotated -33 degrees from the first, the same distance
     that separates cyan from green on chaseroush.com. A grey accent has no hue
     to rotate, so it separates by lightness instead. */

  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, d = max - min;
    if (d === 0) return { h: 0, s: 0, l: l };
    var s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    var h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h * 60, s: s, l: l };
  }

  function hslToHex(o) {
    var h = ((o.h % 360) + 360) % 360, s = o.s, l = o.l;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    function to(v) { var q = Math.round((v + m) * 255).toString(16); return q.length < 2 ? '0' + q : q; }
    return '#' + to(r) + to(g) + to(b);
  }

  function companion(hex) {
    var o = hexToHsl(hex);
    if (!o) return hex;
    if (o.s < 0.12) {
      var l = o.l > 0.5 ? Math.max(0.28, o.l - 0.3) : Math.min(0.82, o.l + 0.3);
      return hslToHex({ h: o.h, s: o.s, l: l });
    }
    return hslToHex({ h: o.h - 33, s: Math.min(1, o.s * 1.05), l: Math.min(0.72, o.l * 1.04) });
  }

  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return 'rgba(109,74,255,' + a + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- parsing: parents, children, aggregate ---------- */

  function parse(milestones, lang) {
    var usable = (milestones || []).filter(function (m) {
      var t = pick(m.text, lang);
      return t && t.title;
    });

    var byId = {};
    usable.forEach(function (m) { byId[m.id] = m; });

    var kids = {};
    usable.forEach(function (m) {
      if (m.parent_id && byId[m.parent_id]) {
        (kids[m.parent_id] = kids[m.parent_id] || []).push(m);
      }
    });
    Object.keys(kids).forEach(function (k) { kids[k].sort(byDate); });

    /* A milestone whose parent is not in this payload is promoted to the rail
       rather than dropped — otherwise an unpublished parent silently hides
       every child underneath it. */
    var parents = usable.filter(function (m) {
      return !m.parent_id || !byId[m.parent_id];
    }).slice().sort(byDate);

    /* A PARENT'S PERCENTAGE IS ITS CHILDREN'S. Where a milestone has been
       broken down, the breakdown is the truth — a parent carrying its own
       hand-typed number would disagree with the rows underneath it. */
    parents.forEach(function (p) {
      var c = kids[p.id];
      if (c && c.length) {
        var sum = c.reduce(function (s, x) { return s + (Number(x.completion) || 0); }, 0);
        p._rolled = Math.round(sum / c.length);
      }
    });

    return { parents: parents, kids: kids };
  }

  function pctOf(m) {
    return typeof m._rolled === 'number' ? m._rolled : (Number(m.completion) || 0);
  }

  /* ---------- styles ---------- */

  function styles(accent, done, mode) {

    var light = ':host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;' +
                '--track:#eef0f6;--panel:#f7f8fb}';
    var dark  = ':host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;' +
                '--track:#22222e;--panel:#1c1c25}';

    var scheme = mode === 'light' ? light
               : mode === 'dark'  ? dark
               : light + '@media(prefers-color-scheme:dark){' + dark + '}';

    return scheme +
      ':host{--prog:' + accent + ';--done:' + done + ';' +
        '--glow-p:' + rgba(accent, 0.45) + ';--glow-d:' + rgba(done, 0.45) + ';' +
        '--faint-p:' + rgba(accent, 0.16) + ';--faint-d:' + rgba(done, 0.16) + ';' +
        'all:initial;display:block;color:var(--fg);line-height:1.5;' +
        'font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,' +
          'Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +
      'button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}' +

      /* ============ GOAL CARDS ============ */
      '.goals{display:flex;flex-direction:column;gap:22px}' +
      '.gcard{background:var(--bg);border:1.5px solid var(--line);border-radius:10px;' +
        'padding:22px 26px;transition:border-color .3s ease,box-shadow .3s ease,' +
        'transform .3s ease}' +
      '.gcard:hover{border-color:var(--faint-p);transform:translateY(-4px);' +
        'box-shadow:0 4px 16px rgba(0,0,0,.18)}' +
      '.gtop{display:flex;justify-content:space-between;align-items:center;gap:20px;' +
        'margin-bottom:4px}' +
      '.gleft{flex:1;min-width:0}' +
      '.gname{font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.25;' +
        'font-family:Georgia,Cambria,"Times New Roman",serif}' +
      '.gdesc{margin-top:8px;color:var(--dim);font-size:14.5px;line-height:1.55;' +
        'border-left:3px solid var(--prog);padding-left:12px}' +
      '.gright{text-align:right;flex-shrink:0}' +
      '.gpct{font-size:30px;font-weight:700;line-height:1;color:var(--done);' +
        'font-variant-numeric:tabular-nums}' +
      '.gmoney{margin-top:5px;font-size:13.5px;font-weight:600;color:var(--prog);' +
        'font-variant-numeric:tabular-nums;white-space:nowrap}' +
      '.gbar{height:10px;border-radius:5px;margin-top:16px;overflow:hidden;' +
        'position:relative;border:1px solid var(--faint-p);' +
        'background:linear-gradient(90deg,var(--faint-p),var(--faint-d))}' +
      '.gfill{height:100%;width:0;border-radius:5px;position:relative;overflow:hidden;' +
        'background:linear-gradient(90deg,var(--prog),var(--done));' +
        'box-shadow:0 0 12px var(--glow-p);' +
        'transition:width 1.5s cubic-bezier(.4,0,.2,1)}' +
      '.gfoot{margin-top:10px;display:flex;justify-content:space-between;' +
        'align-items:center;gap:12px;font-size:13px;color:var(--dim);font-weight:500;' +
        'min-height:20px}' +
      '.gfoot .sp{margin-left:auto}' +
      '.gbadge{display:inline-block;border-radius:20px;padding:3px 12px;font-size:12.5px;' +
        'font-weight:700;color:var(--done);border:1px solid var(--done);' +
        'background:var(--faint-d)}' +

      '.gfill:after,.rfill:after,.dfill:after{content:"";position:absolute;top:0;' +
        'left:-100%;width:100%;height:100%;' +
        'background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);' +
        'animation:sweep 3s infinite}' +
      '@keyframes sweep{0%{left:-100%}100%{left:200%}}' +

      /* ============ ROADMAP: not a card ============ */
      '.legend{display:flex;justify-content:center;flex-wrap:wrap;gap:12px 28px;' +
        'font-size:13px;color:var(--dim);margin-bottom:6px}' +
      '.lg{display:inline-flex;align-items:center;gap:9px}' +
      '.lgd{width:13px;height:13px;border-radius:50%;flex:0 0 auto}' +
      '.lgd.complete{background:var(--done);box-shadow:0 0 9px var(--glow-d)}' +
      '.lgd.in_progress{background:var(--prog);box-shadow:0 0 9px var(--glow-p)}' +
      '.lgd.upcoming{background:transparent;box-shadow:inset 0 0 0 2px var(--faint-p)}' +

      /* ---- horizontal rail ---- */
      '.rail{display:none;position:relative;padding:112px 12px 124px}' +
      '.rtrack{height:4px;border-radius:99px;position:relative;' +
        'background:linear-gradient(90deg,var(--faint-p),var(--faint-d))}' +
      '.rfill{position:absolute;left:0;top:0;height:100%;width:0;border-radius:99px;' +
        'overflow:hidden;background:linear-gradient(90deg,var(--prog),var(--done));' +
        'box-shadow:0 0 16px var(--glow-p);' +
        'transition:width 1.6s cubic-bezier(.16,1,.3,1)}' +

      '.now{position:absolute;top:0;transform:translateX(-50%);z-index:7;' +
        'animation:nowIn .9s cubic-bezier(.16,1,.3,1) .45s both}' +
      '@keyframes nowIn{from{opacity:0;transform:translateX(-50%) scaleY(.3)}' +
        'to{opacity:1;transform:translateX(-50%) scaleY(1)}}' +
      '.nline{width:2px;height:44px;background:var(--prog);position:absolute;top:-20px;' +
        'left:50%;transform:translateX(-50%);box-shadow:0 0 10px var(--glow-p);' +
        'animation:pulse 2s ease-in-out infinite}' +
      '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
      '.nlabel{position:absolute;bottom:26px;left:50%;transform:translateX(-50%);' +
        'white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.11em;' +
        'color:var(--prog)}' +

      /* A pin is a button. Absolutely placed, never wrapping, alternating
         above and below so long titles cannot collide. */
      '.pin{position:absolute;transform:translateX(-50%);text-align:center;' +
        'display:block;padding:0;white-space:nowrap;z-index:3}' +
      '.pin.up{bottom:14px}' +
      '.pin.down{top:14px}' +
      '.dot{width:19px;height:19px;border-radius:50%;border:3px solid;display:block;' +
        'margin:0 auto;transition:transform .2s cubic-bezier(.16,1,.3,1),' +
        'box-shadow .2s ease}' +
      '.pin.up .dot{margin-top:10px}' +
      '.pin.down .dot{margin-bottom:10px}' +
      '.dot.complete{background:var(--done);border-color:var(--done);' +
        'box-shadow:0 0 15px var(--glow-d)}' +
      '.dot.in_progress{background:var(--prog);border-color:var(--prog);' +
        'animation:glow 2s ease-in-out infinite}' +
      '@keyframes glow{0%,100%{box-shadow:0 0 14px var(--glow-p)}' +
        '50%{box-shadow:0 0 26px var(--glow-p),0 0 38px var(--glow-p)}}' +
      '.dot.upcoming{background:var(--bg);border-color:var(--faint-p)}' +
      '.dot.cancelled{background:var(--bg);border-color:var(--line);opacity:.45}' +
      '.pin:hover .dot{transform:scale(1.22)}' +
      '.pin.sel .dot{transform:scale(1.3)}' +
      '.pin:focus-visible{outline:2px solid var(--prog);outline-offset:4px;' +
        'border-radius:6px}' +

      '.plab{font-size:13.5px;line-height:1.45;display:block}' +
      '.plab b{display:block;font-weight:700;margin-bottom:2px}' +
      '.plab .pd{display:block;font-size:12px;color:var(--dim)}' +
      '.plab .pp{display:block;margin-top:2px;font-weight:700;color:var(--done);' +
        'font-variant-numeric:tabular-nums}' +
      '.kidcount{display:block;font-size:11px;color:var(--dim);margin-top:1px;' +
        'opacity:.85;font-weight:500}' +

      /* ---- vertical column ---- */
      '.col{position:relative;padding-left:36px}' +
      '.col:before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:2px;' +
        'border-radius:2px;background:linear-gradient(180deg,var(--faint-p),var(--faint-d))}' +
      '.cfill{position:absolute;left:9px;top:8px;width:2px;border-radius:2px;height:0;' +
        'background:linear-gradient(180deg,var(--prog),var(--done));' +
        'box-shadow:0 0 9px var(--glow-p);' +
        'transition:height 1.6s cubic-bezier(.16,1,.3,1)}' +
      '.vnow{position:absolute;left:10px;width:9px;height:9px;border-radius:50%;' +
        'background:#fff;transform:translate(-50%,-50%);z-index:4;' +
        'box-shadow:0 0 7px rgba(255,255,255,.9),0 0 14px var(--glow-p);' +
        'animation:vnowIn .8s cubic-bezier(.16,1,.3,1) .55s both,ndot 2s ease-in-out infinite}' +
      '@keyframes vnowIn{from{opacity:0}to{opacity:1}}' +
      '@keyframes ndot{0%,100%{transform:translate(-50%,-50%) scale(1)}' +
        '50%{transform:translate(-50%,-50%) scale(1.35)}}' +

      '.step{position:relative;display:block;width:100%;text-align:left;' +
        'padding:0 0 26px}' +
      '.step:last-child{padding-bottom:2px}' +
      '.sdot{position:absolute;left:-36px;top:2px;width:19px;height:19px;' +
        'border-radius:50%;border:3px solid;transition:transform .2s ease}' +
      '.sdot.complete{background:var(--done);border-color:var(--done);' +
        'box-shadow:0 0 13px var(--glow-d)}' +
      '.sdot.in_progress{background:var(--prog);border-color:var(--prog);' +
        'animation:glow 2s ease-in-out infinite}' +
      '.sdot.upcoming{background:var(--bg);border-color:var(--faint-p)}' +
      '.sdot.cancelled{background:var(--bg);border-color:var(--line);opacity:.45}' +
      '.step:hover .sdot{transform:scale(1.15)}' +
      '.step.sel .sdot{transform:scale(1.25)}' +
      '.step:focus-visible{outline:2px solid var(--prog);outline-offset:3px;' +
        'border-radius:6px}' +
      '.sdate{display:block;font-size:12px;color:var(--dim);font-weight:600;' +
        'letter-spacing:.03em}' +
      '.stitle{display:block;font-size:15.5px;font-weight:700;margin-top:2px}' +
      '.step.cancelled .stitle{text-decoration:line-through;opacity:.6}' +
      '.spct{display:block;margin-top:3px;font-size:13px;font-weight:700;' +
        'color:var(--done);font-variant-numeric:tabular-nums}' +

      '.feat{display:inline-block;margin-left:8px;font-size:10.5px;color:var(--prog);' +
        'border:1px solid var(--prog);border-radius:99px;padding:1px 8px;' +
        'vertical-align:2px;font-weight:700;letter-spacing:.04em}' +

      /* ---- the details panel ---- */
      /* The entrance and the exit are chaseroush.com's, to the frame: half a
         second in from thirty pixels above, four tenths out to twenty. The
         first version had a shorter, softer entrance and NO exit at all — the
         panel simply vanished, which is the half that was noticed. */
      '.detail{margin-top:16px;background:var(--panel);border:1px solid var(--line);' +
        'border-radius:12px;padding:26px 28px;position:relative;' +
        'animation:slideIn .5s ease}' +
      '.detail.leaving{animation:slideOut .4s ease forwards;pointer-events:none}' +
      '@keyframes slideIn{from{opacity:0;transform:translateY(-30px)}' +
        'to{opacity:1;transform:translateY(0)}}' +
      '@keyframes slideOut{from{opacity:1;transform:translateY(0)}' +
        'to{opacity:0;transform:translateY(-20px)}}' +
      '.dclose{position:absolute;top:14px;right:14px;width:30px;height:30px;' +
        'border-radius:50%;background:var(--track);color:var(--dim);font-size:17px;' +
        'line-height:1;display:flex;align-items:center;justify-content:center;' +
        'transition:background .2s ease,color .2s ease}' +
      '.dclose:hover{background:var(--line);color:var(--fg)}' +
      '.dhead{display:flex;justify-content:space-between;align-items:flex-start;' +
        'gap:28px;padding-right:34px}' +
      '.dtitle{font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-.01em;' +
        'font-family:Georgia,Cambria,"Times New Roman",serif}' +
      '.ddate{margin-top:7px;font-size:14px;font-weight:700;color:var(--prog)}' +
      '.dpct{text-align:right;flex-shrink:0}' +
      '.dpct b{display:block;font-size:30px;line-height:1;color:var(--done);' +
        'font-variant-numeric:tabular-nums}' +
      '.dpct i{display:block;margin-top:4px;font-size:12px;color:var(--dim);' +
        'font-style:normal}' +
      '.dbar{height:9px;border-radius:5px;margin:20px 0 18px;overflow:hidden;' +
        'position:relative;background:linear-gradient(90deg,var(--faint-p),var(--faint-d))}' +
      '.dfill{height:100%;width:0;border-radius:5px;position:relative;overflow:hidden;' +
        'background:linear-gradient(90deg,var(--prog),var(--done));' +
        'transition:width 1.5s cubic-bezier(.4,0,.2,1)}' +
      '.ddesc{background:var(--bg);border-left:3px solid var(--prog);border-radius:6px;' +
        'padding:16px 18px;color:var(--dim);font-size:15px;line-height:1.75}' +

      /* ---- children, inside the parent's detail ---- */
      '.kids{margin-top:24px}' +
      '.kids h4{font-size:12px;letter-spacing:.09em;text-transform:uppercase;' +
        'color:var(--dim);font-weight:700;margin-bottom:10px}' +
      '.kid{display:flex;align-items:flex-start;gap:14px;padding:13px 0;' +
        'border-top:1px solid var(--line)}' +
      '.kmark{flex:0 0 auto;width:20px;height:20px;border-radius:50%;font-size:11px;' +
        'display:flex;align-items:center;justify-content:center;font-weight:700;' +
        'margin-top:2px}' +
      '.kmark.complete{background:var(--done);color:var(--bg)}' +
      '.kmark.in_progress{background:var(--prog);color:var(--bg)}' +
      '.kmark.upcoming{box-shadow:inset 0 0 0 2px var(--faint-p);color:var(--dim)}' +
      '.kmark.cancelled{box-shadow:inset 0 0 0 2px var(--line);color:var(--dim);opacity:.6}' +
      '.kbody{flex:1;min-width:0}' +
      '.kbody h5{font-size:14.5px;font-weight:700}' +
      '.kdate{font-size:11.5px;color:var(--dim);margin-top:1px}' +
      '.kdesc{font-size:13.5px;color:var(--dim);margin-top:5px;line-height:1.6}' +
      '.kpct{flex:0 0 76px;text-align:right}' +
      '.kbar{height:5px;border-radius:3px;background:var(--track);overflow:hidden}' +
      '.kbarf{height:100%;width:0;border-radius:3px;' +
        'background:linear-gradient(90deg,var(--prog),var(--done));' +
        'transition:width 1.2s cubic-bezier(.4,0,.2,1)}' +
      '.kpct em{display:block;margin-top:4px;font-size:11.5px;color:var(--dim);' +
        'font-style:normal;font-variant-numeric:tabular-nums}' +

      /* ============ PRAYER ============ */
      '.prayers{display:flex;flex-direction:column;gap:22px}' +
      '.pcard{background:var(--bg);border:1.5px solid var(--line);border-radius:10px;' +
        'padding:22px 26px;position:relative;' +
        'transition:border-color .3s ease,box-shadow .3s ease,transform .3s ease}' +
      '.pcard:hover{border-color:var(--faint-p);transform:translateY(-4px);' +
        'box-shadow:0 4px 16px rgba(0,0,0,.18)}' +
      /* Answered prayer is the OTHER colour of the pair — the same distinction
         the roadmap draws between finished and in flight. */
      '.pcard.answered{border-color:var(--faint-d)}' +
      '.pcard.answered:hover{border-color:var(--done)}' +
      '.pbadge{position:absolute;top:18px;right:18px;border-radius:20px;' +
        'padding:3px 12px;font-size:11.5px;font-weight:700;letter-spacing:.05em;' +
        'color:var(--done);border:1px solid var(--done);background:var(--faint-d)}' +
      '.ptitle{font-size:22px;font-weight:700;line-height:1.25;padding-right:96px;' +
        'letter-spacing:-.01em;font-family:Georgia,Cambria,"Times New Roman",serif}' +
      '.pbody{margin-top:9px;color:var(--dim);font-size:14.5px;line-height:1.6;' +
        'border-left:3px solid var(--prog);padding-left:12px}' +
      /* The answer gets the second colour, so a card carrying both reads as
         request then outcome without a heading for either. */
      '.panswer{margin-top:14px;color:var(--dim);font-size:14.5px;line-height:1.6;' +
        'border-left:3px solid var(--done);padding-left:12px}' +
      '.pwhen{display:block;margin-top:8px;font-size:11.5px;color:var(--dim);' +
        'letter-spacing:.03em;text-transform:uppercase;font-weight:600}' +
      '@media(max-width:560px){.ptitle{padding-right:0;font-size:19px}' +
        '.pbadge{position:static;display:inline-block;margin-bottom:10px}}' +

      '.is-wide .rail{display:block}' +
      '.is-wide .col{display:none}' +

      '.foot{margin-top:20px;padding-top:12px;border-top:1px solid var(--line);' +
        'font-size:12px;color:var(--dim)}' +
      '.foot a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}' +
      '.foot a:hover{color:var(--fg)}' +
      '.msg{font-size:14px;color:var(--dim);padding:18px 0;text-align:center}' +

      '@media(prefers-reduced-motion:reduce){' +
        '.gfill,.rfill,.cfill,.dfill,.kbarf{transition:none}' +
        '.gfill:after,.rfill:after,.dfill:after{animation:none;display:none}' +
        '.dot.in_progress,.sdot.in_progress,.nline,.vnow,.now,.detail{animation:none}' +
        '.gcard:hover{transform:none}}';
  }

  /* ---------- count-up ---------- */

  function countUp(node, target) {
    target = Math.round(target || 0);
    if (reduced) { node.textContent = String(target); return; }
    var dur = 1400, start = null;
    function frame(t) {
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur);
      node.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* Two frames, so the CSS transition actually runs — setting a width in the
     same frame the node is created skips the animation entirely. */
  function later(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  /* ---------- goal cards ---------- */

  function goalCard(g, lang) {
    var card = el('div', 'gcard');
    var top = el('div', 'gtop');

    var left = el('div', 'gleft');
    left.appendChild(el('div', 'gname', g.label));
    top.appendChild(left);

    var pct = typeof g.percent === 'number' ? g.percent : 0;

    var right = el('div', 'gright');
    var pctEl = el('div', 'gpct');
    var num = el('span', null, '0');
    pctEl.appendChild(num);
    pctEl.appendChild(document.createTextNode('%'));
    right.appendChild(pctEl);

    right.appendChild(el('div', 'gmoney', g.target_cents
      ? money(g.raised_cents, g.currency, lang) + ' / ' + money(g.target_cents, g.currency, lang)
      : money(g.raised_cents, g.currency, lang)));
    top.appendChild(right);
    card.appendChild(top);

    if (g.description) left.appendChild(el('div', 'gdesc', g.description));

    var bar = el('div', 'gbar');
    var fill = el('div', 'gfill');
    bar.appendChild(fill);
    card.appendChild(bar);

    var foot = el('div', 'gfoot');
    if (g.donor_count) {
      foot.appendChild(el('span', null, g.donor_count + ' ' +
        w(lang, g.donor_count === 1 ? 'partner' : 'partners')));
    }
    var short = (g.target_cents || 0) - (g.raised_cents || 0);
    if (g.target_cents && short <= 0) {
      foot.appendChild(el('span', 'gbadge sp', '✓ ' + w(lang, 'funded')));
    } else if (g.target_cents) {
      foot.appendChild(el('span', 'sp',
        money(short, g.currency, lang) + ' ' + w(lang, 'remaining')));
    }
    card.appendChild(foot);

    later(function () {
      fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      countUp(num, pct);
    });

    return card;
  }

  /* ---------- roadmap ---------- */

  function positions(rows, bounds) {
    var n = rows.length;
    var evenly = rows.map(function (_, i) { return n <= 1 ? 50 : (i / (n - 1)) * 100; });

    var times = rows.map(function (m) { return toTime(m.actual_date); });
    var valid = times.filter(function (t) { return !isNaN(t); });

    /* THE BOUNDS WIN WHERE THEY EXIST. Without them a roadmap spans only its
       own milestones, so the last dated entry always sits at 100% and the
       whole arc reads as finished the moment it passes. With them the rail is
       the period the ministry actually named, and a milestone three years out
       sits three years out. */
    var bs = bounds && toTime(bounds.start), be = bounds && toTime(bounds.end);
    var min = (bs !== undefined && !isNaN(bs)) ? bs
            : valid.length ? Math.min.apply(null, valid) : NaN;
    var max = (be !== undefined && !isNaN(be)) ? be
            : valid.length ? Math.max.apply(null, valid) : NaN;

    if (isNaN(min) || isNaN(max) || !(max > min)) return { pos: evenly, now: null };

    var pos = times.map(function (t) {
      if (isNaN(t)) return 100;
      return Math.min(100, Math.max(0, ((t - min) / (max - min)) * 100));
    });

    /* Alternating above and below halves the crowding, so a pin only has to
       clear its SECOND neighbour rather than its first. */
    var gap = 11;
    for (var pass = 0; pass < 12; pass++) {
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

  function detailPanel(m, kids, lang, onClose) {
    var d = el('div', 'detail');
    d.setAttribute('role', 'region');

    var close = el('button', 'dclose', '×');
    close.type = 'button';
    close.setAttribute('aria-label', w(lang, 'close'));
    close.addEventListener('click', onClose);
    d.appendChild(close);

    var t = pick(m.text, lang) || {};
    var head = el('div', 'dhead');
    var ttl = el('div');
    ttl.appendChild(el('div', 'dtitle', t.title));
    var dt = dateText(m, lang);
    if (dt) ttl.appendChild(el('div', 'ddate', dt));
    head.appendChild(ttl);

    var pct = pctOf(m);
    var pw = el('div', 'dpct');
    var b = el('b');
    var num = el('span', null, '0');
    b.appendChild(num);
    b.appendChild(document.createTextNode('%'));
    pw.appendChild(b);
    pw.appendChild(el('i', null, w(lang, 'completeWord')));
    head.appendChild(pw);
    d.appendChild(head);

    var bar = el('div', 'dbar');
    var fill = el('div', 'dfill');
    bar.appendChild(fill);
    d.appendChild(bar);

    if (t.description) d.appendChild(el('div', 'ddesc', t.description));

    /* THE BREAKDOWN. Children live here rather than on the rail — putting
       every child on one line is what turns a roadmap into a row of
       unreadable dots. */
    var subs = kids[m.id];
    if (subs && subs.length) {
      var wrap = el('div', 'kids');
      wrap.appendChild(el('h4', null, w(lang, 'breakdown')));
      subs.forEach(function (s) {
        var st = pick(s.text, lang) || {};
        var status = s.status || 'upcoming';
        var row = el('div', 'kid');

        row.appendChild(el('div', 'kmark ' + status,
          status === 'complete' ? '✓' : status === 'in_progress' ? '◐' : '○'));

        var body = el('div', 'kbody');
        body.appendChild(el('h5', null, st.title));
        var sd = dateText(s, lang);
        if (sd) body.appendChild(el('div', 'kdate', sd));
        if (st.description) body.appendChild(el('div', 'kdesc', st.description));
        row.appendChild(body);

        var kp = el('div', 'kpct');
        var kb = el('div', 'kbar');
        var kf = el('div', 'kbarf');
        kb.appendChild(kf);
        kp.appendChild(kb);
        var kn = el('em');
        var knum = el('span', null, '0');
        kn.appendChild(knum);
        kn.appendChild(document.createTextNode('%'));
        kp.appendChild(kn);
        row.appendChild(kp);

        var spct = Number(s.completion) || 0;
        later(function () {
          kf.style.width = Math.max(0, Math.min(100, spct)) + '%';
          countUp(knum, spct);
        });

        wrap.appendChild(row);
      });
      d.appendChild(wrap);
    }

    later(function () {
      fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      countUp(num, pct);
    });

    return d;
  }

  function roadmap(milestones, lang, bounds) {
    var parsed = parse(milestones, lang);
    var rows = parsed.parents, kids = parsed.kids;
    if (!rows.length) return null;

    var road = el('div', 'road');

    var legend = el('div', 'legend');
    ['complete', 'in_progress', 'upcoming'].forEach(function (s) {
      var item = el('span', 'lg');
      item.appendChild(el('span', 'lgd ' + s));
      item.appendChild(el('span', null, w(lang, s)));
      legend.appendChild(item);
    });
    road.appendChild(legend);

    var P = positions(rows, bounds);

    /* THE RAIL SHOWS ELAPSED TIME, not a tally of finished milestones — the
       same thing chaseroush.com does. A count would jump in steps and would
       sit at 0% for a ministry a year into a three-year arc with nothing
       marked complete yet. Where no bounds are set there is no period to
       measure, so it falls back to the tally. */
    var progress;
    var bs2 = bounds && toTime(bounds.start), be2 = bounds && toTime(bounds.end);
    if (!isNaN(bs2) && !isNaN(be2) && be2 > bs2) {
      var t = Date.now();
      progress = t <= bs2 ? 0 : t >= be2 ? 100 : ((t - bs2) / (be2 - bs2)) * 100;
    } else {
      var fin = rows.filter(function (m) { return m.status === 'complete'; }).length;
      progress = rows.length ? (fin / rows.length) * 100 : 0;
    }

    var slot = el('div');
    var open = -1;
    var pins = [], steps = [];

    function deselect() {
      pins.concat(steps).forEach(function (p) {
        p.classList.remove('sel');
        p.setAttribute('aria-expanded', 'false');
      });
    }

    /* Play the exit, THEN remove. The dots deselect immediately so the rail
       responds to the click at once while the panel is still leaving —
       waiting for both would feel like a delay rather than an animation. */
    function closeDetail(immediate) {
      open = -1;
      deselect();

      var panel = slot.firstChild;
      if (!panel) return;

      if (immediate || reduced) { slot.textContent = ''; return; }

      panel.classList.add('leaving');
      setTimeout(function () {
        /* Only if nothing has opened in the meantime — a fast second click
           must not have its new panel removed by the old one's timer. */
        if (slot.firstChild === panel) slot.textContent = '';
      }, 400);
    }

    function openDetail(i) {
      if (open === i) { closeDetail(); return; }
      open = i;
      /* Replacing one panel with another swaps immediately: animating the old
         one out while the new one comes in puts two overlapping panels in the
         same place. */
      pins.forEach(function (p, j) {
        p.classList.toggle('sel', j === i);
        p.setAttribute('aria-expanded', j === i ? 'true' : 'false');
      });
      steps.forEach(function (p, j) {
        p.classList.toggle('sel', j === i);
        p.setAttribute('aria-expanded', j === i ? 'true' : 'false');
      });
      slot.textContent = '';
      slot.appendChild(detailPanel(rows[i], kids, lang, closeDetail));
    }

    /* ---- horizontal ---- */
    var rail = el('div', 'rail');
    var track = el('div', 'rtrack');
    var rfill = el('div', 'rfill');
    track.appendChild(rfill);

    if (P.now !== null) {
      var near = P.pos.some(function (x) { return Math.abs(x - P.now) < 7; });
      var nowEl = el('div', 'now');
      nowEl.style.left = P.now + '%';
      if (!near) nowEl.appendChild(el('div', 'nlabel', w(lang, 'now')));
      nowEl.appendChild(el('div', 'nline'));
      track.appendChild(nowEl);
    }

    rows.forEach(function (m, i) {
      var t = pick(m.text, lang) || {};
      var up = i % 2 === 0;
      var pin = el('button', 'pin ' + (up ? 'up' : 'down'));
      pin.type = 'button';
      pin.style.left = P.pos[i] + '%';
      pin.setAttribute('aria-expanded', 'false');

      var lab = el('span', 'plab');
      /* No FOCUS badge. is_featured is still in the payload for anyone
         building their own design, but chaseroush.com's timeline does not
         mark it and the pin is already carrying a title, a date and a
         percentage — a fourth thing on one line is clutter. */
      lab.appendChild(el('b', null, t.title));

      var dt = dateText(m, lang);
      if (dt) lab.appendChild(el('span', 'pd', dt));

      var pc = pctOf(m);
      if (pc > 0) lab.appendChild(el('span', 'pp', pc + '%'));

      var kc = kids[m.id];
      if (kc && kc.length) {
        lab.appendChild(el('span', 'kidcount', kc.length + ' · ' + w(lang, 'breakdown')));
      }

      var dot = el('span', 'dot ' + (m.status || 'upcoming'));
      /* Label away from the rail, dot against it. */
      if (up) { pin.appendChild(lab); pin.appendChild(dot); }
      else { pin.appendChild(dot); pin.appendChild(lab); }

      pin.addEventListener('click', function () { openDetail(i); });
      pins.push(pin);
      track.appendChild(pin);
    });
    rail.appendChild(track);
    road.appendChild(rail);

    /* ---- vertical ---- */
    var col = el('div', 'col');
    var cfill = el('div', 'cfill');
    col.appendChild(cfill);

    rows.forEach(function (m, i) {
      var t = pick(m.text, lang) || {};
      var step = el('button', 'step ' + (m.status || 'upcoming'));
      step.type = 'button';
      step.setAttribute('aria-expanded', 'false');
      step.appendChild(el('span', 'sdot ' + (m.status || 'upcoming')));

      var dt = dateText(m, lang);
      if (dt) step.appendChild(el('span', 'sdate', dt));

      step.appendChild(el('span', 'stitle', t.title));

      var pc = pctOf(m);
      var kc2 = kids[m.id];
      if (pc > 0 || (kc2 && kc2.length)) {
        var line = el('span', 'spct', pc > 0 ? pc + '%' : '');
        if (kc2 && kc2.length) {
          line.appendChild(el('span', 'kidcount', kc2.length + ' · ' + w(lang, 'breakdown')));
        }
        step.appendChild(line);
      }

      step.addEventListener('click', function () { openDetail(i); });
      steps.push(step);
      col.appendChild(step);
    });
    road.appendChild(col);
    road.appendChild(slot);

    later(function () {
      rfill.style.width = progress + '%';
      cfill.style.height = progress + '%';
      if (progress > 3 && progress < 97) {
        var vn = el('div', 'vnow');
        vn.style.top = progress + '%';
        col.appendChild(vn);
      }
    });

    return road;
  }

  /* ---------- prayer ---------- */

  function prayerCards(rows, lang) {
    var usable = (rows || []).filter(function (r) {
      var t = pick(r.text, lang);
      return t && t.title;
    });
    if (!usable.length) return null;

    var wrap = el('div', 'prayers');
    usable.forEach(function (r) {
      var t = pick(r.text, lang) || {};
      var card = el('div', 'pcard' + (r.is_answered ? ' answered' : ''));

      if (r.is_answered) card.appendChild(el('span', 'pbadge', '✓ ' + w(lang, 'answered')));
      card.appendChild(el('div', 'ptitle', t.title));
      if (t.description) card.appendChild(el('div', 'pbody', t.description));

      /* The account of what happened, when there is one. "Answered" with no
         account of how is a badge rather than a testimony. */
      if (r.is_answered && t.answer_text) {
        var a = el('div', 'panswer', t.answer_text);
        if (r.answered_on) a.appendChild(el('span', 'pwhen', monthYear(r.answered_on, lang)));
        card.appendChild(a);
      }
      wrap.appendChild(card);
    });
    return wrap;
  }

  /* ---------- placement ---------- */

  function applyWidth(host) {
    host.classList.toggle('is-wide', host.getBoundingClientRect().width >= 680);
  }

  /* MEASURE THE CONTENT, NOT THE DOCUMENT.
     documentElement.scrollHeight is never smaller than the frame it is in, so
     reporting it to a parent that then SETS the frame to that value is a
     ratchet: every measurement returns the height the last one produced, plus
     whatever margin the parent adds. Changing a colour rebuilt the preview and
     the box grew a few pixels, permanently, every time.
     The body's own rect is the content plus its padding and does not know how
     tall the frame is, so it settles instead of climbing. */
  function reportHeight() {
    if (window.parent === window) return;
    try {
      var b = document.body;
      var h = b ? Math.ceil(b.getBoundingClientRect().height) : 0;
      if (h > 0) window.parent.postMessage({ __thaumaHeight: h }, '*');
    } catch (e) {}
  }

  /* THE HOST PAGE'S OWN LANGUAGE, when the snippet does not name one. A
     Croatian church embedding this should get Croatian without being told to
     add an attribute — and the widget knows which languages this ministry
     publishes, so it can only ever choose one that exists. */
  function chooseLang(node, data) {
    var asked = node.getAttribute('data-lang');
    if (asked) return asked;

    var have = (data.languages || []).map(function (l) { return l.code; });
    if (!have.length) return 'en';

    var tags = [];
    var pageLang = document.documentElement && document.documentElement.getAttribute('lang');
    if (pageLang) tags.push(String(pageLang).toLowerCase());
    var nav = window.navigator;
    if (nav && nav.language) tags.push(String(nav.language).toLowerCase());

    for (var i = 0; i < tags.length; i++) {
      if (have.indexOf(tags[i]) !== -1) return tags[i];
      var base = tags[i].split('-')[0];        /* hr-HR -> hr */
      if (have.indexOf(base) !== -1) return base;
    }
    return have.indexOf('en') !== -1 ? 'en' : have[0];
  }

  function render(node, data) {
    var kind   = node.getAttribute('data-widget') || 'goal';
    var lang   = chooseLang(node, data);
    var accent = node.getAttribute('data-accent') || (data.theme && data.theme.accent) || '#6D4AFF';
    var mode   = node.getAttribute('data-theme')  || (data.theme && data.theme.mode)   || 'auto';

    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = '#6D4AFF';
    if (['auto', 'light', 'dark'].indexOf(mode) === -1) mode = 'auto';

    /* The pair: chosen if the ministry chose one, derived if not. An override
       on the div wins for both, and overriding only the first re-derives the
       second so the relationship is never left half-applied. */
    var second = node.getAttribute('data-accent2');
    if (!second || !/^#[0-9a-fA-F]{6}$/.test(second)) {
      second = node.getAttribute('data-accent')
        ? companion(accent)
        : ((data.theme && data.theme.accent2) || companion(accent));
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(second)) second = companion(accent);

    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';

    var style = document.createElement('style');
    style.textContent = styles(accent, second, mode);
    root.appendChild(style);

    var host = el('div', 'host');
    var body;

    if (kind === 'roadmap') {
      body = roadmap(data.milestones || [], lang, data.timeline);
    } else if (kind === 'prayer') {
      body = prayerCards(data.prayer || [], lang);
    } else {
      var goals = data.goals || [];
      if (goals.length) {
        body = el('div', 'goals');
        goals.forEach(function (g) { body.appendChild(goalCard(g, lang)); });
      }
    }

    if (!body) {
      body = el('div');
      body.appendChild(el('div', 'msg', w(lang, 'empty')));
    }
    host.appendChild(body);

    var foot = el('div', 'foot');
    var a = el('a', null, data.partner ? data.partner.display_name : 'Thauma');
    a.href = ORIGIN + '/partners/' + (data.partner ? data.partner.slug : '');
    a.rel = 'noopener';
    a.target = '_blank';
    foot.appendChild(a);
    host.appendChild(foot);

    root.appendChild(host);

    applyWidth(host);
    if (window.ResizeObserver) {
      new window.ResizeObserver(function () { applyWidth(host); reportHeight(); }).observe(node);
    } else if (window.addEventListener) {
      window.addEventListener('resize', function () { applyWidth(host); });
    }

    /* Posted repeatedly: opening a detail changes the height, fonts land late,
       and the fills animate. Cheap, and the frame follows. */
    [60, 500, 1000, 1800].forEach(function (ms) { setTimeout(reportHeight, ms); });
    root.addEventListener('click', function () { setTimeout(reportHeight, 80); });
  }

  function fail(node, message) {
    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';
    var style = document.createElement('style');
    style.textContent = styles('#6D4AFF', companion('#6D4AFF'),
                                node.getAttribute('data-theme') || 'auto');
    root.appendChild(style);
    var box = el('div');
    box.appendChild(el('div', 'msg', message));
    root.appendChild(box);
    setTimeout(reportHeight, 40);
  }

  function load(slug) {
    /* The console injects the payload rather than letting this fetch: the
       public endpoint 404s until embedding is switched on, so a preview that
       fetched could only ever show what had already been published. */
    if (window.__thaumaPreview && window.__thaumaPreview.partner &&
        window.__thaumaPreview.partner.slug === slug) {
      return Promise.resolve(window.__thaumaPreview);
    }

    if (!cache[slug]) {
      cache[slug] = fetch(ORIGIN + '/embed/v1/' + encodeURIComponent(slug) + '.json', {
        credentials: 'omit', mode: 'cors'
      }).then(function (r) {
        if (!r.ok) throw new Error(r.status === 404
          ? 'This ministry is not sharing a widget.' : 'Could not load.');
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

  if (window.MutationObserver) {
    new window.MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { scan(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  window.Thauma = { render: scan };
})();
`;
