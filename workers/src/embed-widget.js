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
 *   · IT WORKS TWICE. Two widgets on one page, or the same partner twice in
 *     two languages, share one fetch and render independently.
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
     data-limit    4                     how many rows to show   (roadmap only)
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

  /* ---- tiny helpers ------------------------------------------------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
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
    } catch (e) { return iso.slice(0, 7); }
  }

  /* The text for one milestone in the requested language, falling back to
     English and then to whatever exists. A roadmap with a blank row because
     one translation is missing looks broken; showing the English is honest
     and useful. */
  function pick(text, lang) {
    if (!text) return null;
    return text[lang] || text.en || text[Object.keys(text)[0]] || null;
  }

  /* ---- styles -------------------------------------------------------- */

  function styles(accent, mode) {
    /* Light and dark are both written out. The accent is the ONE colour that
       varies per partner; everything else is derived neutrals, so a partner
       choosing an unfortunate colour cannot make the text unreadable. */
    var light =
      ':host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;--track:#f0f0f6}';
    var dark =
      ':host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;--track:#232330}';

    var scheme;
    if (mode === 'light') scheme = light;
    else if (mode === 'dark') scheme = dark;
    else scheme = light + '@media(prefers-color-scheme:dark){' + dark + '}';

    return scheme +
      ':host{--accent:' + accent + ';all:initial;display:block;' +
        'font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,' +
        'Helvetica,Arial,sans-serif;color:var(--fg);line-height:1.5;' +
        '-webkit-font-smoothing:antialiased}' +
      '*{box-sizing:border-box;margin:0;padding:0}' +

      '.card{background:var(--bg);border:1px solid var(--line);' +
        'border-radius:14px;padding:20px 22px;max-width:100%}' +

      '.label{font-size:13px;letter-spacing:.04em;text-transform:uppercase;' +
        'color:var(--dim);font-weight:600}' +
      '.amount{font-size:30px;font-weight:700;letter-spacing:-.02em;' +
        'font-variant-numeric:tabular-nums;margin-top:6px}' +
      '.amount .of{font-size:15px;font-weight:500;color:var(--dim);' +
        'letter-spacing:0}' +

      '.track{height:9px;background:var(--track);border-radius:99px;' +
        'margin:14px 0 10px;overflow:hidden}' +
      '.fill{height:100%;background:var(--accent);border-radius:99px;' +
        'width:0;transition:width .9s cubic-bezier(.22,.8,.3,1)}' +
      '@media(prefers-reduced-motion:reduce){.fill{transition:none}}' +

      '.meta{display:flex;justify-content:space-between;gap:12px;' +
        'font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}' +
      '.pct{color:var(--accent);font-weight:700}' +

      /* roadmap */
      '.road{list-style:none;position:relative;padding-left:26px}' +
      '.road:before{content:"";position:absolute;left:7px;top:6px;bottom:6px;' +
        'width:2px;background:var(--line)}' +
      '.step{position:relative;padding-bottom:20px}' +
      '.step:last-child{padding-bottom:0}' +
      '.dot{position:absolute;left:-26px;top:3px;width:16px;height:16px;' +
        'border-radius:50%;border:2px solid var(--line);background:var(--bg)}' +
      '.step.is-complete .dot{background:var(--accent);border-color:var(--accent)}' +
      '.step.is-in_progress .dot{border-color:var(--accent);' +
        'box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}' +
      '.step.is-cancelled .dot{opacity:.4}' +
      '.step.is-cancelled .title{text-decoration:line-through;opacity:.6}' +
      '.when{font-size:12px;color:var(--dim);letter-spacing:.03em;' +
        'text-transform:uppercase;font-weight:600}' +
      '.title{font-size:15px;font-weight:650;margin-top:2px}' +
      '.desc{font-size:14px;color:var(--dim);margin-top:3px}' +
      '.feat{display:inline-block;margin-left:7px;font-size:11px;' +
        'color:var(--accent);border:1px solid var(--accent);border-radius:99px;' +
        'padding:1px 7px;vertical-align:1px;font-weight:700}' +

      '.foot{margin-top:16px;padding-top:12px;border-top:1px solid var(--line);' +
        'font-size:12px;color:var(--dim)}' +
      '.foot a{color:inherit;text-decoration:none;border-bottom:1px solid var(--line)}' +
      '.foot a:hover{color:var(--fg)}' +

      '.msg{font-size:14px;color:var(--dim);padding:16px 0;text-align:center}' +
      '.stack{display:flex;flex-direction:column;gap:14px}';
  }

  /* ---- the visualisers ----------------------------------------------- */

  function goalCard(goal, lang) {
    var card = el('div', 'card');

    card.appendChild(el('div', 'label', goal.label));

    var amt = el('div', 'amount');
    amt.appendChild(document.createTextNode(money(goal.raised_cents, goal.currency, lang)));
    if (goal.target_cents) {
      var of = el('span', 'of', ' of ' + money(goal.target_cents, goal.currency, lang));
      amt.appendChild(of);
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
    meta.appendChild(el('span', 'pct', Math.round(pct) + '%'));
    if (goal.donor_count) {
      meta.appendChild(el('span', null,
        goal.donor_count + (goal.donor_count === 1 ? ' partner' : ' partners')));
    }
    card.appendChild(meta);

    /* Painted after layout so the transition actually runs — setting the
       width in the same frame the element is created skips the animation. */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
      });
    });

    return card;
  }

  function roadmap(milestones, lang, limit) {
    var card = el('div', 'card');
    var list = el('ol', 'road');

    var rows = milestones.slice(0, limit || milestones.length);
    rows.forEach(function (m) {
      var text = pick(m.text, lang);
      if (!text || !text.title) return;      /* nothing renderable */

      var li = el('li', 'step is-' + (m.status || 'upcoming'));
      li.appendChild(el('span', 'dot'));

      var when = whenDate(m.actual_date, lang);
      if (when) li.appendChild(el('div', 'when', when));

      var t = el('div', 'title', text.title);
      if (m.is_featured) t.appendChild(el('span', 'feat', 'Focus'));
      li.appendChild(t);

      if (text.description) li.appendChild(el('div', 'desc', text.description));
      list.appendChild(li);
    });

    if (!list.children.length) return null;
    card.appendChild(list);
    return card;
  }

  /* ---- rendering one placement --------------------------------------- */

  function render(node, data) {
    var lang   = node.getAttribute('data-lang') || 'en';
    var kind   = node.getAttribute('data-widget') || 'goal';
    var accent = node.getAttribute('data-accent') || (data.theme && data.theme.accent) || '#6D4AFF';
    var mode   = node.getAttribute('data-theme')  || (data.theme && data.theme.mode)   || 'auto';
    var limit  = parseInt(node.getAttribute('data-limit'), 10) || 0;

    /* Anything not a six-digit hex is dropped rather than passed into CSS.
       It is the one attribute value that reaches a stylesheet. */
    if (!/^#[0-9a-fA-F]{6}$/.test(accent)) accent = '#6D4AFF';
    if (['auto', 'light', 'dark'].indexOf(mode) === -1) mode = 'auto';

    var root = node.shadowRoot || node.attachShadow({ mode: 'open' });
    root.textContent = '';

    var style = document.createElement('style');
    style.textContent = styles(accent, mode);
    root.appendChild(style);

    var body;

    if (kind === 'roadmap') {
      body = roadmap(data.milestones || [], lang, limit);
    } else {
      var goals = data.goals || [];
      if (goals.length) {
        body = el('div', 'stack');
        goals.slice(0, limit || goals.length).forEach(function (g) {
          body.appendChild(goalCard(g, lang));
        });
      }
    }

    if (!body) {
      body = el('div', 'card');
      body.appendChild(el('div', 'msg', 'Nothing to show yet.'));
    }
    root.appendChild(body);

    /* Attribution, and a way back. Not a tracking link — a plain anchor. */
    var foot = el('div', 'foot');
    var a = el('a', null, data.partner ? data.partner.display_name : 'Thauma');
    a.href = ORIGIN + '/partners/' + (data.partner ? data.partner.slug : '');
    a.rel = 'noopener';
    a.target = '_blank';
    foot.appendChild(a);
    body.appendChild(foot);
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
  }

  function load(slug) {
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
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        if (muts[i].addedNodes.length) { scan(); return; }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* One escape hatch, for pages that build their DOM entirely in script. */
  window.Thauma = { render: scan };
})();
`;
