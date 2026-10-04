/**
 * embed-widget.js — the script that renders on somebody else's website
 *
 * Exported as a STRING because it is served to browsers rather than run in the
 * Worker. Keeping it here means it ships and versions with the endpoint that
 * serves it.
 *
 * ONE CONSTRAINT WHILE EDITING: no backticks and no dollar-brace anywhere in
 * the widget source, because it lives inside a template literal — except the
 * one that inlines COLOUR_JS, which is the point of it.
 *
 * PORTED FROM chaseroush.com's TIMELINE — THE WHOLE THING, NOT THE SKIN
 * ---------------------------------------------------------------------------
 * The first attempt took the colors and the animations and stopped, which
 * missed what that page actually is. Rebuilt on the second pass:
 *
 *   · TWO COLORS, not one. Completed and in-progress are visibly different
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
 * GOAL CARDS follow the giving page: name, description behind a colored rule,
 * the percentage large on the right with raised / target beneath it, a full
 * width bar, and either what remains or a funded badge.
 *
 * THE COLOR MATHS IS NOT COPIED HERE: this file is a string shipped to
 * browsers and cannot import anything, so it inlines COLOUR_JS from
 * embed-colour.js — the one browser copy of the maths, which a test compares
 * with the Worker's functions on every run.
 */

import { COLOUR_JS } from "./embed-colour.js";

export const WIDGET_JS = String.raw`
/* Thauma embed widget. https://thauma.one

     <div data-thauma="chase-roush" data-widget="goal"></div>
     <script src="https://thauma.one/embed/v1/widget.js" async></script>

   Attributes, all optional:
     data-widget   goal | roadmap | prayer | videos (default goal)
     data-style    condensed   the roadmap as a still timeline: no legend,
                               nothing to press, no details
     data-lang     en | hr | sr | ...    (default: the host page's own language)
     data-accent   #6D4AFF               overrides the ministry's color
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

  /* A video went up on a DAY, and saying "Aug 2026" about something posted
     last Tuesday reads as older than it is. Milestones are the opposite — they
     land in a month — which is why monthYear stays and this sits beside it. */
  function fullDate(iso, lang) {
    if (!iso) return '';
    try {
      return new Intl.DateTimeFormat(lang || 'en',
        { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 10); }
  }

  function pick(text, lang) {
    if (!text) return null;
    return text[lang] || text.en || text[Object.keys(text)[0]] || null;
  }

  /* The date a READER sees. target_label is a sentence somebody wrote and is
     always preferred; the formatted date is only a fallback for a milestone
     nobody has labeled. */
  function dateText(m, lang) {
    var t = pick(m.text, lang);
    if (t && t.target_label) return t.target_label;
    return monthYear(m.actual_date, lang);
  }

  /* THE WORDS COME WITH THE DATA. Each payload carries { lang: { now, ... } }
     from the public wording file (emailsAndForms.json, "widget"), translated
     on Thauma's Translate page, so a newly added language speaks its own words
     here without this script changing. English is kept below only for a
     payload that predates them. */
  var FALLBACK = { now: 'Now', complete: 'Completed', in_progress: 'In progress',
    upcoming: 'Upcoming', canceled: 'Canceled', completeWord: 'Complete',
    remaining: 'remaining', funded: 'Funded', partners: 'partners', partner: 'partner',
    breakdown: 'Breakdown', empty: 'Nothing to show yet.', close: 'Close',
    answered: 'Answered', praying: 'Still praying', watch: 'Watch on YouTube', play: 'Play',
    notShared: 'This ministry is not sharing this here.' };
  var WORDS = { en: FALLBACK };
  function w(lang, key) {
    var t = WORDS[lang] || {}, en = WORDS.en || {};
    return t[key] || en[key] || FALLBACK[key];
  }

  /* ---------- the COLOR PAIR ----------
     Completed and in-progress are different hues, which is what the legend is
     for. The ministry sends both, resolved (embed.js); the maths here is for
     a page that overrides the first with data-accent, where the second is
     rotated -33 degrees from it, the distance that separates cyan from green
     on chaseroush.com. A gray accent has no hue to rotate, so it separates by
     lightness instead. The same maths as the Worker's: embed-colour.js. */

${COLOUR_JS}
  var rgba = alpha;

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

  /* ---------- the page's own look ----------
     A Site Creator page says what it looks like (data-look, JSON: bg, fg,
     dim, line, panel, track, font, and a dark set), and its cards, dropdowns
     and panels wear that instead of this widget's own (Chase, 2026-10-01:
     the background mismatch "was also a thing with all of the cards and
     milestone dropdowns"). bg is the CARD here, worked out by the page for
     the band it sits on, so a raised band gets cards that stand apart from
     it. Every value is checked before it reaches CSS, as in the forms. */
  function siteLook(node, accent, done) {
    var raw = node.getAttribute('data-look'), o;
    if (!raw) return '';
    try { o = JSON.parse(raw); } catch (e) { return ''; }
    var COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\))$/, FONT = /^[\w\s'",.-]{1,200}$/;
    var VARS = { bg: '--bg', fg: '--fg', dim: '--dim', line: '--line', panel: '--panel', track: '--track' };
    function rules(x) {
      var css = '';
      if (!x || typeof x !== 'object') return css;
      Object.keys(VARS).forEach(function (k) { if (typeof x[k] === 'string' && COLOR.test(x[k])) css += VARS[k] + ':' + x[k] + ';'; });
      if (typeof x.font === 'string' && FONT.test(x.font)) css += 'font-family:' + x.font + ';';
      if (typeof x.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(x.bg)) {
        css += '--prog-t:' + readable(accent, x.bg) + ';--done-t:' + readable(done, x.bg) + ';';
      }
      return css ? ':host{' + css + '}' : '';
    }
    var light = rules(o), dark = rules(o.dark);
    /* The names on cards in the page's display face, not this widget's serif. */
    var display = typeof o.display === 'string' && FONT.test(o.display)
      ? '.gname,.dtitle,.ptitle{font-family:' + o.display + '}' : '';
    return light + (dark ? '@media(prefers-color-scheme:dark){' + dark + '}' : '') + display;
  }

  /* ---------- styles ---------- */

  function styles(accent, done, mode) {

    /* TEXT IN THE COLORS reads on every page: --prog-t and --done-t are the
       pair nudged just far enough to be legible on this scheme's background
       (readable, embed-colour.js). Fills and dots keep the colors as chosen. */
    var light = ':host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;' +
                '--track:#eef0f6;--panel:#f7f8fb;' +
                '--prog-t:' + readable(accent, '#ffffff') + ';--done-t:' + readable(done, '#ffffff') + '}';
    var dark  = ':host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;' +
                '--track:#22222e;--panel:#1c1c25;' +
                '--prog-t:' + readable(accent, '#15151c') + ';--done-t:' + readable(done, '#15151c') + '}';

    var scheme = mode === 'light' ? light
               : mode === 'dark'  ? dark
               : light + '@media(prefers-color-scheme:dark){' + dark + '}';

    return scheme +
      ':host{--prog:' + accent + ';--done:' + done + ';' +
        '--glow-p:' + rgba(accent, 0.45) + ';--glow-d:' + rgba(done, 0.45) + ';' +
        '--faint-p:' + rgba(accent, 0.16) + ';--faint-d:' + rgba(done, 0.16) + ';' +
        '--on-prog:' + onColor(accent) + ';--on-done:' + onColor(done) + ';' +
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
      '.gpct{font-size:30px;font-weight:700;line-height:1;color:var(--done-t);' +
        'font-variant-numeric:tabular-nums}' +
      '.gmoney{margin-top:5px;font-size:13.5px;font-weight:600;color:var(--prog-t);' +
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
        'font-weight:700;color:var(--done-t);border:1px solid var(--done);' +
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
        /* Small: it names the line, it is not a heading, and at 11px bold it
           competed with the milestone titles (Chase, 2026-09-27). */
        'white-space:nowrap;text-transform:uppercase;font-size:9px;font-weight:600;letter-spacing:.14em;' +
        'color:var(--prog-t)}' +
      '.nlabel.below{bottom:auto;top:26px}' +

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
      '.dot.canceled{background:var(--bg);border-color:var(--line);opacity:.45}' +
      '.pin:hover .dot{transform:scale(1.22)}' +
      '.pin.sel .dot{transform:scale(1.3)}' +
      '.pin:focus-visible{outline:2px solid var(--prog);outline-offset:4px;' +
        'border-radius:6px}' +
      /* CONDENSED: nothing to press, so nothing reacts to the pointer. */
      '.road.still .pin,.road.still .step{cursor:default}' +
      '.road.still .pin:hover .dot,.road.still .step:hover .sdot{transform:none}' +

      '.plab{font-size:13.5px;line-height:1.45;display:block}' +
      '.plab b{display:block;font-weight:700;margin-bottom:2px}' +
      '.plab .pd{display:block;font-size:12px;color:var(--dim)}' +
      '.plab .pp{display:block;margin-top:2px;font-weight:700;color:var(--done-t);' +
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
      '.sdot.canceled{background:var(--bg);border-color:var(--line);opacity:.45}' +
      '.step:hover .sdot{transform:scale(1.15)}' +
      '.step.sel .sdot{transform:scale(1.25)}' +
      '.step:focus-visible{outline:2px solid var(--prog);outline-offset:3px;' +
        'border-radius:6px}' +
      '.sdate{display:block;font-size:12px;color:var(--dim);font-weight:600;' +
        'letter-spacing:.03em}' +
      '.stitle{display:block;font-size:15.5px;font-weight:700;margin-top:2px}' +
      '.step.canceled .stitle{text-decoration:line-through;opacity:.6}' +
      '.spct{display:block;margin-top:3px;font-size:13px;font-weight:700;' +
        'color:var(--done-t);font-variant-numeric:tabular-nums}' +

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
      /* 44px, not 34: the close button is 30px wide and sits 14px from the
         edge, so it occupies the first 44px of that gutter. Reserving less
         put the × on top of the percentage — visible in the real console as
         a "0%" with a cross through it. */
      '.dhead{display:flex;justify-content:space-between;align-items:flex-start;' +
        'gap:28px;padding-right:44px}' +
      '.dtitle{font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-.01em;' +
        'font-family:Georgia,Cambria,"Times New Roman",serif}' +
      '.ddate{margin-top:7px;font-size:14px;font-weight:700;color:var(--prog-t)}' +
      '.dpct{text-align:right;flex-shrink:0}' +
      '.dpct b{display:block;font-size:30px;line-height:1;color:var(--done-t);' +
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
      '.kmark.complete{background:var(--done);color:var(--on-done)}' +
      '.kmark.in_progress{background:var(--prog);color:var(--on-prog)}' +
      '.kmark.upcoming{box-shadow:inset 0 0 0 2px var(--faint-p);color:var(--dim)}' +
      '.kmark.canceled{box-shadow:inset 0 0 0 2px var(--line);color:var(--dim);opacity:.6}' +
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
      /* Answered prayer is the OTHER color of the pair — the same distinction
         the roadmap draws between finished and in flight. */
      '.pcard.answered{border-color:var(--faint-d)}' +
      '.pcard.answered:hover{border-color:var(--done)}' +
      '.pbadge{position:absolute;top:18px;right:18px;border-radius:20px;' +
        'padding:3px 12px;font-size:11.5px;font-weight:700;letter-spacing:.05em;' +
        'color:var(--done-t);border:1px solid var(--done);background:var(--faint-d)}' +
      '.ptitle{font-size:22px;font-weight:700;line-height:1.25;padding-right:96px;' +
        'letter-spacing:-.01em;font-family:Georgia,Cambria,"Times New Roman",serif}' +
      '.pbody{margin-top:9px;color:var(--dim);font-size:14.5px;line-height:1.6;' +
        'border-left:3px solid var(--prog);padding-left:12px}' +
      /* The answer gets the second color, so a card carrying both reads as
         request then outcome without a heading for either. */
      '.panswer{margin-top:14px;color:var(--dim);font-size:14.5px;line-height:1.6;' +
        'border-left:3px solid var(--done);padding-left:12px}' +
      '.pwhen{display:block;margin-top:8px;font-size:11.5px;color:var(--dim);' +
        'letter-spacing:.03em;text-transform:uppercase;font-weight:600}' +
      /* ---- narrow ----
         The widget picks its layout from the width it is GIVEN, so this is
         what a phone gets and also what the console's Mobile preview shows.

         Everything here is the same correction: type set for a 900px card
         does not fit 380px, and a row of two things side by side becomes two
         rows. The title was the worst of it — 26px serif in a flex row beside
         the percentage left it about 150px to work with, so "Proclaim! 1st
         Missions Trip" came out five lines tall. */
      '@media(max-width:560px){' +
        '.ptitle{padding-right:0;font-size:19px}' +
        '.pbadge{position:static;display:inline-block;margin-bottom:10px}' +

        '.detail{padding:20px 18px}' +
        '.dclose{top:10px;right:10px;width:28px;height:28px;font-size:16px}' +
        /* Stacked, so the title has the full width instead of a column beside
           the percentage. */
        '.dhead{flex-direction:column;gap:10px;padding-right:38px}' +
        '.dtitle{font-size:20px;line-height:1.25}' +
        /* Laid out along the line rather than stacked — "0%" over "Complete"
           costs two rows for two words. */
        '.dpct{text-align:left;display:flex;align-items:baseline;gap:7px}' +
        '.dpct b{display:inline;font-size:23px}' +
        '.dpct i{display:inline;margin-top:0}' +

        '.gcard{padding:18px 16px}' +
        '.gtop{flex-direction:column;align-items:flex-start;gap:8px}' +
        '.gname{font-size:18px}' +
        '.gpct{font-size:25px}' +
        '.gright{text-align:left}' +

        '.stitle{font-size:15px}' +
        '.sdate{font-size:11.5px}' +
      '}' +

      '.is-wide .rail{display:block}' +
      '.is-wide .col{display:none}' +

      /* ============ VIDEOS ============
         A stage and a row (videoCards). The ministry's color is on the play
         button and the first button of the rail — never painted over
         somebody's picture: the only shade on a still is the dark one that
         keeps its title readable. */
      /* NO TALLER THAN THE SCREEN ALLOWS (Chase, 2026-10-01: "the video
         player takes up the entire height of the screen. So it's just in
         your face"). The stage, its row and its buttons are sized together
         from the window's height — room left for a heading and the row — so
         on a desktop the whole section fits; a phone, narrower than that,
         keeps the full width. Never below 520px wide where there is room. */
      '.vshow{display:flex;flex-direction:column;gap:14px;' +
        'width:min(100%,max(520px,calc((100svh - 440px) * 16 / 9)));margin-inline:auto}' +
      '.vstage{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;' +
        'background:#000;box-shadow:0 18px 40px -22px rgba(0,0,0,.55)}' +
      '.vhero{display:block;width:100%;height:100%;color:#fff;text-decoration:none}' +
      /* Declared boxes, so nothing reflows as stills arrive. hqdefault is 4:3
         with bars baked in; cover crops it back to the frame it was shot in. */
      '.vshot{position:relative;width:100%;height:100%}' +
      '.vthumb{display:block;width:100%;height:100%;object-fit:cover}' +
      '.vhero .vthumb{transition:transform .6s cubic-bezier(.16,1,.3,1)}' +
      '.vhero:hover .vthumb{transform:scale(1.03)}' +
      '.vcap{position:absolute;left:0;right:0;bottom:0;padding:48px 22px 18px;' +
        'background:linear-gradient(180deg,transparent,rgba(0,0,0,.78))}' +
      '.vtitle{font-size:clamp(16px,2.4vw,22px);font-weight:700;line-height:1.25;' +
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;' +
        'text-shadow:0 1px 12px rgba(0,0,0,.4)}' +
      '.vdate{margin-top:6px;font-size:13px;opacity:.82}' +
      /* The play control, round, in the ministry's color. */
      '.vplay{position:absolute;left:50%;top:50%;width:68px;height:68px;margin:-34px 0 0 -34px;' +
        'border-radius:50%;background:var(--prog);box-shadow:0 8px 28px -6px var(--glow-p);' +
        'transition:transform .25s ease}' +
      '.vplay:after{content:"";position:absolute;left:27px;top:22px;border-style:solid;' +
        'border-width:12px 0 12px 19px;border-color:transparent transparent transparent var(--on-prog)}' +
      '.vhero:hover .vplay{transform:scale(1.08)}' +
      '.vplay.sm{width:34px;height:34px;margin:-17px 0 0 -17px;box-shadow:none;opacity:.92}' +
      '.vplay.sm:after{left:13px;top:10px;border-width:7px 0 7px 11px}' +
      '.vframe{position:absolute;inset:0;width:100%;height:100%;border:0}' +
      /* The row: the others, to pick from; the one on the stage is marked. */
      '.vrow{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}' +
      '.vcard{display:block;color:inherit;text-decoration:none;border-radius:10px;padding:6px;' +
        'transition:background .2s ease}' +
      '.vcard:hover{background:var(--panel)}' +
      '.vcard.is-on{background:var(--faint-p)}' +
      '.vmini{position:relative;aspect-ratio:16/9;border-radius:8px;overflow:hidden;background:var(--track)}' +
      '.vctitle{margin-top:7px;font-size:13px;font-weight:600;line-height:1.3;' +
        'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +

      /* The rail: real buttons. The first is filled in the ministry's color,
         the rest outlined; each carries an arrow, because each leaves. */
      /* As wide as the videos above (.vshow), so their edges line up. */
      '.vlinks{display:flex;flex-wrap:wrap;gap:10px;margin:18px auto 0;' +
        'width:min(100%,max(520px,calc((100svh - 440px) * 16 / 9)))}' +
      '.vlink{display:inline-flex;align-items:center;gap:10px;padding:12px 20px;border-radius:999px;' +
        'border:1.5px solid var(--prog);color:var(--fg);font-size:14px;font-weight:650;' +
        'text-decoration:none;line-height:1.2;transition:background .2s ease,transform .2s ease,box-shadow .2s ease}' +
      '.vlink:hover{background:var(--faint-p);transform:translateY(-1px)}' +
      '.vlink.is-first{background:var(--prog);color:var(--on-prog);box-shadow:0 8px 22px -10px var(--glow-p)}' +
      '.vlink.is-first:hover{background:var(--prog);box-shadow:0 10px 26px -8px var(--glow-p)}' +
      '.varrow{font-size:15px;line-height:1}' +
      /* THE RAIL'S STYLE AND PLACE, from the page around it (data-links,
         data-links-align): Outlined drops the filled first button; Subtle
         is words and an arrow, as chaseroush.com's updates page does. */
      '.vlinks.is-outline .vlink.is-first{background:none;color:var(--fg);box-shadow:none}' +
      '.vlinks.is-subtle{gap:6px 26px}' +
      '.vlinks.is-subtle .vlink{border:0;padding:4px 0;border-radius:0;background:none;box-shadow:none;color:var(--fg);font-weight:600}' +
      '.vlinks.is-subtle .vlink:hover{background:none;transform:none;text-decoration:underline;text-underline-offset:4px}' +
      '.vlinks.is-subtle .varrow{color:var(--prog)}' +
      '.vlinks.al-center{justify-content:center}.vlinks.al-right{justify-content:flex-end}' +

      '.foot{margin-top:20px;padding-top:12px;border-top:1px solid var(--line);' +
        'font-size:12px;color:var(--dim)}' +
      '.foot a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}' +
      '.foot a:hover{color:var(--fg)}' +
      '.msg{font-size:14px;color:var(--dim);padding:18px 0;text-align:center}' +

      '@media(prefers-reduced-motion:reduce){' +
        '.gfill,.rfill,.cfill,.dfill,.kbarf{transition:none}' +
        '.gfill:after,.rfill:after,.dfill:after{animation:none;display:none}' +
        '.dot.in_progress,.sdot.in_progress,.nline,.vnow,.now,.detail{animation:none}' +
        '.gcard:hover{transform:none}' +
        '.vplay,.vlink,.vcard,.vhero .vthumb{transition:none}' +
        '.vhero:hover .vthumb,.vhero:hover .vplay,.vlink:hover{transform:none}}';
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
    /* The name in the visitor's language where the ministry wrote one
       (0047), else its own wording. */
    var tx = (g.text && g.text[lang]) || {};
    left.appendChild(el('div', 'gname', tx.label || g.label));
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

    var about = tx.description || g.description;
    if (about) left.appendChild(el('div', 'gdesc', about));

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

  /* Maps a moment onto a set of anchors — [{t, v}] sorted by t — by linear
     interpolation between the two it falls between.

     Both layouts need this and neither can use a plain percentage of the
     period. The rail SPREADS crowded pins away from their true dates, and the
     column lays its steps out by content height, so in both the geometry stops
     matching the arithmetic. Interpolating through the anchors themselves is
     what keeps the NOW marker on the correct side of every milestone. */
  function interp(t, anchors) {
    if (!anchors.length) return null;
    if (t <= anchors[0].t) return anchors[0].v;
    var last = anchors[anchors.length - 1];
    if (t >= last.t) return last.v;
    for (var i = 1; i < anchors.length; i++) {
      var a = anchors[i - 1], b = anchors[i];
      if (t <= b.t) {
        var span = b.t - a.t;
        return span > 0 ? a.v + ((t - a.t) / span) * (b.v - a.v) : a.v;
      }
    }
    return last.v;
  }

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

    if (isNaN(min) || isNaN(max) || !(max > min)) {
      return { pos: evenly, now: null, times: times, min: NaN, max: NaN };
    }

    var pos = times.map(function (t) {
      if (isNaN(t)) return 100;
      return Math.min(100, Math.max(0, ((t - min) / (max - min)) * 100));
    });

    /* Alternating above and below halves the crowding, so a pin only has to
       clear its SECOND neighbor rather than its first. */
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

    /* ANCHORED TO THE PINS IT SITS AMONG, not to the raw arithmetic. The
       de-crowding loop above moves pins off their true dates, so a marker
       placed at the period's true percentage could show up PAST a milestone
       that has not happened yet. */
    var nowT = Date.now();
    var anchors = [{ t: min, v: 0 }];
    times.forEach(function (t, i) { if (!isNaN(t)) anchors.push({ t: t, v: pos[i] }); });
    anchors.push({ t: max, v: 100 });
    anchors.sort(function (a, b) { return a.t - b.t; });

    var now = (nowT >= min && nowT <= max) ? interp(nowT, anchors) : null;
    return { pos: pos, now: now, times: times, min: min, max: max };
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

  /* STILL is the CONDENSED timeline (data-style="condensed"; Chase,
     2026-09-27): for a home page or a side column, the timeline and nothing
     else — no legend, nothing to press, no details, no breakdown count. The
     rail, NOW, and each milestone's title, date and percentage. */
  function roadmap(milestones, lang, bounds, still) {
    var parsed = parse(milestones, lang);
    var rows = parsed.parents, kids = parsed.kids;
    if (!rows.length) return null;

    var road = el('div', 'road' + (still ? ' still' : ''));

    if (!still) {
      var legend = el('div', 'legend');
      ['complete', 'in_progress', 'upcoming'].forEach(function (s) {
        var item = el('span', 'lg');
        item.appendChild(el('span', 'lgd ' + s));
        item.appendChild(el('span', null, w(lang, s)));
        legend.appendChild(item);
      });
      road.appendChild(legend);
    }

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

      if (immediate || reduced) {
        slot.textContent = '';
        if (typeof placeNow === 'function') placeNow();
        return;
      }

      panel.classList.add('leaving');
      setTimeout(function () {
        /* Only if nothing has opened in the meantime — a fast second click
           must not have its new panel removed by the old one's timer. */
        if (slot.firstChild === panel) {
          slot.textContent = '';
          if (typeof placeNow === 'function') placeNow();
        }
      }, 400);
    }

    function openDetail(i) {
      if (open === i) { closeDetail(); return; }
      /* ON A PHONE, ONE SMOOTH MOTION (Chase: the timeline "jumps around
         when a milestone is pressed" — match chaseroush.com). Measured
         2026-10-04: with a panel open, pressing a step further down threw it
         459px up the screen in one frame as the old panel vanished. As
         chaseroush.com does: swap at once, then glide the pressed step to just
         under the site's header while its panel grows open beneath it. */
      var tapped = steps[i] && steps[i].offsetParent ? steps[i] : null;
      var calm = still || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      /* The old panel SHRINKS AWAY instead of vanishing: its content moves
         into a holder left where it was, which collapses while the new one
         grows. A vanishing panel is what threw the pressed step up the screen. */
      var ghost = null;
      if (tapped && !calm && open !== -1 && slot.firstChild) {
        ghost = document.createElement('div');
        ghost.style.cssText = 'overflow:hidden;height:' + slot.offsetHeight + 'px;transition:height .45s cubic-bezier(.16,1,.3,1)';
        while (slot.firstChild) ghost.appendChild(slot.firstChild);
        slot.parentNode.insertBefore(ghost, slot);
      }
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
      placeSlot(i);
      slot.appendChild(detailPanel(rows[i], kids, lang, closeDetail));
      if (typeof placeNow === 'function') placeNow();
      if (tapped) glideTo(tapped, slot, ghost, calm);
    }

    function glideTo(step, box, ghost, calm) {
      /* Where the step will be once the old panel above it (if any) is gone. */
      var above = ghost && (ghost.compareDocumentPosition(step) & 4 /* FOLLOWING */) ? ghost.offsetHeight : 0;
      if (!calm) {
        box.style.overflow = 'hidden';
        box.style.maxHeight = '0px';
        void box.offsetHeight;
        box.style.transition = 'max-height .45s cubic-bezier(.16,1,.3,1)';
        box.style.maxHeight = box.scrollHeight + 'px';
        if (ghost) ghost.style.height = '0px';
        setTimeout(function () {
          box.style.maxHeight = ''; box.style.overflow = ''; box.style.transition = '';
          if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
          if (typeof placeNow === 'function') placeNow();
        }, 500);
      }
      /* The site's own sticky header, whichever site this is embedded in. */
      var head = document.querySelector('header.top, .main-nav, header');
      var under = head ? Math.max(0, head.getBoundingClientRect().bottom) : 0;
      var by = step.getBoundingClientRect().top - above - under - 16;
      if (Math.abs(by) > 2 && window.scrollBy) window.scrollBy({ top: by, behavior: calm ? 'auto' : 'smooth' });
    }

    /* THE PANEL OPENS WHERE IT WAS ASKED FOR.

       In the column the steps ARE the list, so a panel parked permanently at
       the bottom made you look away from the thing you just pressed — on a
       phone the milestone you tapped could be scrolled off the top by the
       time its own details appeared. It belongs directly under that step.

       The rail is a different shape and keeps the old behavior: its pins sit
       along a single line, so beneath the rail IS beneath the pin.

       Moving the slot changes every step height below it, which is why the
       NOW marker is re-measured immediately after — that coupling is what
       makes this look broken when it is done without measuring. */
    function isColumn() {
      /* Ask the element which layout is showing rather than repeating the
         breakpoint here. Undefined in a non-visual environment, which has no
         layout to have an opinion about, so that falls to the rail. */
      return typeof col.offsetParent !== 'undefined' && col.offsetParent !== null;
    }

    function placeSlot(i) {
      var st = steps[i];
      if (isColumn() && st && typeof st.after === 'function') { st.after(slot); return; }
      /* Already parked at the end of the rail. Re-appending would be a no-op
         in a browser, but only because a browser reparents — asking for a move
         that is not needed is how the same node ends up counted twice. */
      var kids = road.children;
      if (kids && kids.length && kids[kids.length - 1] === slot) return;
      road.appendChild(slot);
    }

    /* ---- horizontal ---- */
    var rail = el('div', 'rail');
    var track = el('div', 'rtrack');
    var rfill = el('div', 'rfill');
    track.appendChild(rfill);

    if (P.now !== null) {
      /* THE WORD IS ALWAYS THERE. It used to be dropped whenever any pin was
         within 7% of the marker, which on a real roadmap was most of the time.
         Pins alternate above and below the rail, so the word goes to the side
         whose nearest dot is further away. */
      var gapUp = 100, gapDown = 100;
      P.pos.forEach(function (x, i) {
        var d = Math.abs(x - P.now);
        if (i % 2 === 0) gapUp = Math.min(gapUp, d); else gapDown = Math.min(gapDown, d);
      });
      var below = gapUp < 3.5 && gapDown > gapUp;
      var nowEl = el('div', 'now');
      nowEl.style.left = P.now + '%';
      nowEl.appendChild(el('div', 'nlabel' + (below ? ' below' : ''), w(lang, 'now')));
      nowEl.appendChild(el('div', 'nline'));
      track.appendChild(nowEl);
    }

    rows.forEach(function (m, i) {
      var t = pick(m.text, lang) || {};
      var up = i % 2 === 0;
      var pin = el(still ? 'div' : 'button', 'pin ' + (up ? 'up' : 'down'));
      if (!still) { pin.type = 'button'; pin.setAttribute('aria-expanded', 'false'); }
      pin.style.left = P.pos[i] + '%';

      var lab = el('span', 'plab');
      /* No FOCUS badge: chaseroush.com's timeline does not mark one, and the
         pin is already carrying a title, a date and a percentage — a fourth
         thing on one line is clutter. (Featured itself is gone, 2026-09-27.) */
      lab.appendChild(el('b', null, t.title));

      var dt = dateText(m, lang);
      if (dt) lab.appendChild(el('span', 'pd', dt));

      var pc = pctOf(m);
      if (pc > 0) lab.appendChild(el('span', 'pp', pc + '%'));

      var kc = kids[m.id];
      if (kc && kc.length && !still) {
        lab.appendChild(el('span', 'kidcount', kc.length + ' · ' + w(lang, 'breakdown')));
      }

      var dot = el('span', 'dot ' + (m.status || 'upcoming'));
      /* Label away from the rail, dot against it. */
      if (up) { pin.appendChild(lab); pin.appendChild(dot); }
      else { pin.appendChild(dot); pin.appendChild(lab); }

      if (!still) pin.addEventListener('click', function () { openDetail(i); });
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
      var step = el(still ? 'div' : 'button', 'step ' + (m.status || 'upcoming'));
      if (!still) { step.type = 'button'; step.setAttribute('aria-expanded', 'false'); }
      step.appendChild(el('span', 'sdot ' + (m.status || 'upcoming')));

      var dt = dateText(m, lang);
      if (dt) step.appendChild(el('span', 'sdate', dt));

      step.appendChild(el('span', 'stitle', t.title));

      var pc = pctOf(m);
      var kc2 = still ? null : kids[m.id];
      if (pc > 0 || (kc2 && kc2.length)) {
        var line = el('span', 'spct', pc > 0 ? pc + '%' : '');
        if (kc2 && kc2.length) {
          line.appendChild(el('span', 'kidcount', kc2.length + ' · ' + w(lang, 'breakdown')));
        }
        step.appendChild(line);
      }

      if (!still) step.addEventListener('click', function () { openDetail(i); });
      steps.push(step);
      col.appendChild(step);
    });
    road.appendChild(col);
    if (!still) road.appendChild(slot);

    /* THE COLUMN IS LAID OUT BY CONTENT, NOT BY DATE. Each step is as tall as
       its own text, so a percentage of elapsed time means nothing in this
       geometry — 40% of the period is not 40% of the pixels. Placing the
       marker at progress% is what put it PAST milestones that have not
       happened yet: on an eight-item roadmap the arithmetic said 37% and 37%
       of the pixels landed below the second dot, which was a year out.

       So it is measured against the real dots, and RE-measured whenever the
       layout moves — opening a detail panel pushes every step below it down,
       which is exactly when a marker frozen at build time starts lying. */
    var vn = el('div', 'vnow');
    col.appendChild(vn);

    function placeNow() {
      /* The rail fills TO THE MARKER. The marker sits among the pins after
         they are spread apart (see positions()), so the raw elapsed-time
         percentage and the marker disagree by however far the pins moved —
         the fill used to stop visibly short of NOW, or run past it. */
      rfill.style.width = (P.now !== null ? P.now : progress) + '%';

      var h = col.offsetHeight;
      var measurable = typeof h === 'number' && isFinite(h) && h > 0;

      /* Nothing to measure — no layout yet, or a non-visual environment. The
         percentage is wrong in the ways described above but it is the only
         thing available, and a marker roughly placed beats none at all. */
      if (!measurable) {
        cfill.style.height = progress + '%';
        vn.hidden = !(progress > 3 && progress < 97);
        vn.style.top = progress + '%';
        return;
      }

      var anchors = [];
      steps.forEach(function (st, i) {
        var t = P.times && P.times[i];
        if (t === undefined || isNaN(t)) return;
        var dot = st.querySelector ? st.querySelector('.sdot') : null;
        var y = st.offsetTop + (dot ? dot.offsetTop + dot.offsetHeight / 2 : 0);
        if (isFinite(y)) anchors.push({ t: t, v: y });
      });
      /* The period's own ends, so the fill starts at the top on the first day
         and reaches the bottom on the last, rather than at whichever milestone
         happens to be first or last. */
      if (P.min !== undefined && !isNaN(P.min)) anchors.push({ t: P.min, v: 0 });
      if (P.max !== undefined && !isNaN(P.max)) anchors.push({ t: P.max, v: h });
      anchors.sort(function (a, b) { return a.t - b.t; });

      if (!anchors.length) {
        cfill.style.height = progress + '%';
        vn.hidden = !(progress > 3 && progress < 97);
        vn.style.top = progress + '%';
        return;
      }

      var nowT = Date.now();
      var y = interp(nowT, anchors);
      cfill.style.height = Math.max(0, y) + 'px';
      vn.style.top = y + 'px';
      vn.hidden = !(nowT > anchors[0].t && nowT < anchors[anchors.length - 1].t);
    }

    later(placeNow);
    window.addEventListener('resize', placeNow);

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

  /* A SHOWCASE, NOT A LIST (Chase, 2026-09-28: "it looks more like a list of
     information than a presented file"). The newest video is the stage —
     full width, its title over the picture, a play button in the ministry's
     color — and the rest sit beneath it as a row to pick from.

     IT PLAYS HERE. Pressing play swaps the still for YouTube's player
     (youtube-nocookie.com, the privacy-enhanced host), so nothing is loaded
     from YouTube until somebody asks to watch. Picking a video underneath
     plays it on the stage. Every one is still a real link to YouTube, so a
     new tab, a middle click or a page that blocks frames still gets there.

     (No backticks below WIDGET_JS: the whole script is a template literal.) */
  function videoCards(rows, lang) {
    var usable = (rows || []).filter(function (v) {
      return v && v.id && v.title && /^[A-Za-z0-9_-]{6,20}$/.test(String(v.id));
    });
    if (!usable.length) return null;

    var wrap = el('div', 'vshow');
    var stage = el('div', 'vstage');
    /* Emptied node by node, never by assigning markup (see embed.test). */
    function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
    wrap.appendChild(stage);

    function still(v) {
      var img = document.createElement('img');
      img.className = 'vthumb';
      img.src = v.thumbnail_url || ('https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg');
      img.alt = '';
      img.loading = 'lazy';
      img.width = 480; img.height = 360;
      return img;
    }
    function link(v, cls) {
      var a = el('a', cls);
      a.href = v.url || ('https://www.youtube.com/watch?v=' + v.id);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      return a;
    }
    function play(v) {
      var f = document.createElement('iframe');
      f.className = 'vframe';
      f.src = 'https://www.youtube-nocookie.com/embed/' + v.id + '?autoplay=1&rel=0&modestbranding=1';
      f.title = v.title;
      f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      f.setAttribute('allowfullscreen', '');
      clear(stage);
      stage.appendChild(f);
      stage.classList.add('is-playing');
    }
    function show(v, autoplay) {
      stage.classList.remove('is-playing');
      clear(stage);
      if (autoplay) return play(v);
      var a = link(v, 'vhero');
      a.setAttribute('aria-label', w(lang, 'play') + ': ' + v.title);
      var shot = el('div', 'vshot');
      shot.appendChild(still(v));
      shot.appendChild(el('span', 'vplay'));
      var cap = el('div', 'vcap');
      cap.appendChild(el('div', 'vtitle', v.title));
      if (v.published_at) cap.appendChild(el('div', 'vdate', fullDate(v.published_at, lang)));
      shot.appendChild(cap);
      a.appendChild(shot);
      a.addEventListener('click', function (e) {
        if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (e.preventDefault) e.preventDefault();
        play(v);
      });
      stage.appendChild(a);
    }
    show(usable[0], false);

    if (usable.length > 1) {
      var row = el('div', 'vrow');
      usable.forEach(function (v, i) {
        var a = link(v, 'vcard' + (i === 0 ? ' is-on' : ''));
        a.setAttribute('aria-label', w(lang, 'play') + ': ' + v.title);
        var shot = el('div', 'vmini');
        shot.appendChild(still(v));
        shot.appendChild(el('span', 'vplay sm'));
        a.appendChild(shot);
        a.appendChild(el('div', 'vctitle', v.title));
        a.addEventListener('click', function (e) {
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          if (e.preventDefault) e.preventDefault();
          [].forEach.call(row.children, function (c) { c.classList.toggle('is-on', c === a); });
          show(v, true);
          if (stage.scrollIntoView) stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        row.appendChild(a);
      });
      wrap.appendChild(row);
    }
    return wrap;
  }

  /* The rail underneath — the channel, a newsletter, a giving page — as
     real buttons (Chase, 2026-09-28): the first filled in the ministry's
     color, the rest outlined, each with an arrow, because each leaves for
     somewhere else. chaseroush.com has had one under its player for a year,
     and it is the most-used thing in that section.

     THE SCHEME IS CHECKED AGAIN HERE. The console refuses anything but http
     and https before storing it, and this refuses it again before it becomes
     an href — because a row could predate that check, and a javascript: URL
     in a link on somebody else's website is script execution on their page. */
  function linkRail(links, railStyle, railAlign) {
    var usable = (links || []).filter(function (l) {
      return l && l.label && /^https?:\/\//i.test(String(l.url || ''));
    });
    if (!usable.length) return null;

    var rail = el('div', 'vlinks' + (railStyle ? ' is-' + railStyle : '') + (railAlign ? ' al-' + railAlign : ''));
    usable.forEach(function (l, i) {
      var a = el('a', 'vlink' + (i === 0 ? ' is-first' : ''));
      a.appendChild(el('span', null, l.label));
      a.appendChild(el('span', 'varrow', '↗'));
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      rail.appendChild(a);
    });
    return rail;
  }

  /* ---------- placement ---------- */

  function applyWidth(host) {
    host.classList.toggle('is-wide', host.getBoundingClientRect().width >= 680);
  }

  /* MEASURE THE CONTENT, NOT THE DOCUMENT.
     documentElement.scrollHeight is never smaller than the frame it is in, so
     reporting it to a parent that then SETS the frame to that value is a
     ratchet: every measurement returns the height the last one produced, plus
     whatever margin the parent adds. Changing a color rebuilt the preview and
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
    if (data.words && data.words.en) WORDS = data.words;
    var kind   = node.getAttribute('data-widget') || 'goal';
    var lang   = chooseLang(node, data);

    /* EACH WIDGET IS SHARED ON ITS OWN (the Sharing page). The data leaves
       out a part that is not shared, so drawing it would read "nothing to
       show yet" — which is untrue. Say what is true instead. The console's
       preview is exempt: you look before you decide. */
    if (Array.isArray(data.shared) && data !== window.__thaumaPreview &&
        data.shared.indexOf(kind) === -1) {
      fail(node, w(lang, 'notShared'));
      return;
    }
    /* What this widget wears: its own look if the ministry gave it one,
       the ministry's otherwise (0040). */
    var look = (data.looks && data.looks[kind]) || data.theme || {};
    var accent = node.getAttribute('data-accent') || look.accent || '#6D4AFF';
    var mode   = node.getAttribute('data-theme')  || look.mode   || 'auto';

    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = '#6D4AFF';
    if (['auto', 'light', 'dark'].indexOf(mode) === -1) mode = 'auto';

    /* The pair: chosen if the ministry chose one, derived if not. An override
       on the div wins for both, and overriding only the first re-derives the
       second so the relationship is never left half-applied. */
    var second = node.getAttribute('data-accent2');
    if (!second || !/^#[0-9a-fA-F]{6}$/.test(second)) {
      second = node.getAttribute('data-accent')
        ? companion(accent)
        : (look.accent2 || companion(accent));
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(second)) second = companion(accent);

    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';

    var style = document.createElement('style');
    style.textContent = styles(accent, second, mode) + siteLook(node, accent, second);
    root.appendChild(style);

    var host = el('div', 'host');
    var body;

    if (kind === 'roadmap') {
      body = roadmap(data.milestones || [], lang, data.timeline,
                     node.getAttribute('data-style') === 'condensed');
    } else if (kind === 'prayer') {
      body = prayerCards(data.prayer || [], lang);
    } else if (kind === 'videos') {
      body = videoCards(data.videos || [], lang);
      var rs = node.getAttribute('data-links'), ra = node.getAttribute('data-links-align');
      var rail = linkRail(data.video_links, rs === 'outline' || rs === 'subtle' ? rs : '',
                          ra === 'center' || ra === 'right' ? ra : '');
      /* The rail shows even with no videos: a channel that has not posted yet
         is exactly when "subscribe" is worth offering. */
      if (rail) {
        var box = el('div');
        if (body) box.appendChild(body);
        else box.appendChild(el('div', 'msg', w(lang, 'empty')));
        box.appendChild(rail);
        body = box;
      }
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

    /* The credit line says whose this is — on somebody else's page. On the
       ministry's own site (data-foot="off") it would only repeat the name
       at the top of the page. */
    if (node.getAttribute('data-foot') !== 'off') {
      var foot = el('div', 'foot');
      var a = el('a', null, data.partner ? data.partner.display_name : 'Thauma');
      a.href = ORIGIN + '/partners/' + (data.partner ? data.partner.slug : '');
      a.rel = 'noopener';
      a.target = '_blank';
      foot.appendChild(a);
      host.appendChild(foot);
    }

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
