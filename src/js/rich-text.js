/* rich-text.js — formatted words in a box, and the bar that formats them
   =========================================================================
   One place for the formatting the Site Creator's boxes have had since
   2026-10-03 (bold, italic, underline, a link, a size, a color, line breaks),
   so Thauma's own Website › Pages can have the same (Chase, 2026-10-07:
   "allowing the text controls that the Site Creator has is a big win,
   including how the text styles, sizes, colors").

   A FORMATTED BOX is any contenteditable element with data-rt. Selecting
   words inside one shows the bar above them; the box's page reads the words
   back with RichText.from(box) on its own input event.

   STORED AS MEANING, not looks: <b> <i> <u> <a href> and
   <span data-sz data-c>, line breaks as "\n". Each place that shows the
   words draws them in its own colors (workers/src/lib/tones.js names them;
   the Site Creator's render.js and the site's `rich` filter draw them).

     RichText.html(stored, withLinks)  the stored words, into a box
     RichText.from(box)                a box's words, as stored
     RichText.sizeOnScreen(root)       show chosen sizes while editing
   ========================================================================= */
(function () {
  'use strict';
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var tr = function (k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; };

  /* Stored formatted words back into a box: only the marks it may hold, links
     kept only inside the box being edited. */
  /* A formatted box is empty when it holds no words, whatever markup the
     browser left behind; only then does its suggestion show (staff.css). */
  document.addEventListener('input', function (e) {
    var rt = e.target && e.target.closest && e.target.closest('.rt[data-ph]');
    if (rt) rt.classList.toggle('is-empty', !rt.textContent.trim());
  });
  function inlineHtml(v, withLinks) {
    var out = String(v || '').replace(/<(?!\/?(b|i|u)>)(?!a href="[^"]*">)(?!\/a>)(?!span( data-(sz|c)="[^"]*")+>)(?!\/span>)[^>]*>/g, '');
    if (!withLinks) out = out.replace(/<\/?a[^>]*>/g, '');
    /* A picked color has no class to wear; it is painted where it is shown.
       richFrom reads data-c, never the paint. */
    out = out.replace(/<span([^>]*) data-c="(#[0-9a-f]{6})"([^>]*)>/gi, '<span$1 data-c="$2"$3 style="color:$2">');
    return out.replace(/\n/g, '<br>');
  }
  /* A box's contents as they are stored: what a browser's editable box makes
     — <div> per line, <strong>, pasted styles — reduced to <b>, <i>, <u>,
     <a href> and line breaks. The server cleans it again (model.richClean);
     this keeps the working copy tidy and the change dots honest. */
  function richFrom(el) {
    var out = '';
    var TAGS = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', a: 'a' };
    (function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { out += esc(c.nodeValue.replace(/ /g, ' ')); continue; }
        if (c.nodeType !== 1) continue;
        var t = c.nodeName.toLowerCase();
        if (t === 'br') { out += '\n'; continue; }
        if (/^(div|p|li|h[1-6]|blockquote)$/.test(t) && out && !/\n$/.test(out)) out += '\n';
        var tag = TAGS[t];
        if (tag === 'a') {
          var h = c.getAttribute('href') || '';
          if (/^(https?:\/\/|mailto:|page:[a-z]+$)/i.test(h)) out += '<a href="' + esc(h) + '">'; else tag = null;
        } else if (t === 'span') {
          var sz = c.getAttribute('data-sz'), cc = c.getAttribute('data-c'), at = '';
          if (SIZES.indexOf(sz) !== -1 || isNumSize(sz)) at += ' data-sz="' + sz + '"';
          if (isTone(cc)) at += ' data-c="' + cc.toLowerCase() + '"';
          if (at) { out += '<span' + at + '>'; tag = 'span'; }
        } else if (tag) out += '<' + tag + '>';
        walk(c);
        if (tag) out += '</' + tag + '>';
      }
    })(el);
    return out.replace(/<(b|i|u)><\/\1>|<span[^>]*><\/span>/g, '').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  }

  /* SIZE AND COLOR WITHIN THE WORDS (Chase, 2026-10-03: "different sizes and
     colors WITHIN one text box"; "a full palette, with a few predetermined
     quick picks"). Stored as meaning, <span data-sz data-c>, the names the
     Mail composer uses (workers/src/lib/tones.js); the site draws them in its
     own colors, light or dark. */
  var SIZES = ['sm', 'lg', 'xl'];
  /* Like Word (Chase, 2026-10-04: "in font size like Word and not percentage
     based … the ability to go really really small"): a size in pixels, typed
     or stepped through Word's ladder, stored as data-sz="14px". The first
     version's multiples (data-sz="1.35") still read. */
  var LADDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];
  function sizePx(v) { return /^\d{1,3}(\.5)?px$/.test(String(v || '')) ? +String(v).slice(0, -2) : null; }
  /* A chosen size shows at its size while editing (the stored words keep only
     data-sz; the presets have their own CSS). */
  function sizeOnScreen(root) {
    [].forEach.call(root.querySelectorAll('span[data-sz]'), function (sp) {
      var v = sp.getAttribute('data-sz');
      sp.style.fontSize = sizePx(v) ? v : isNumSize(v) ? v + 'em' : '';
    });
  }
  function isNumSize(v) {
    var px = sizePx(v);
    return px ? px >= 4 && px <= 200 : /^\d(\.\d{1,2})?$/.test(String(v || '')) && +v >= 0.5 && +v <= 3;
  }
  var TONE_NAMES = ['accent', 'accent2', 'dim', 'red', 'green', 'blue', 'gold'];
  /* Swatches as a dark ground shows them, the console's own. */
  var TONE_SWATCH = { dim: '#9AA6B6', red: '#FF8A80', green: '#6FE3A6', blue: '#8DB8FF', gold: '#F2C14E' };
  function isTone(c) { return TONE_NAMES.indexOf(c) !== -1 || /^#[0-9a-f]{6}$/i.test(String(c || '')); }

  /**
   * Give the selected words a size or a color (attr data-sz / data-c), or
   * take it away (value ""). Words wholly inside a span that already has one
   * are split out of it, so one word of a red phrase can turn blue and keep
   * the rest of what it wore. Returns a range over the words, to select.
   */
  function applyMark(box, range, attr, value) {
    var anc = range.commonAncestorContainer;
    anc = anc.nodeType === 1 ? anc : anc.parentNode;
    var outer = anc && anc.closest ? anc.closest('span[' + attr + ']') : null;
    if (outer && !box.contains(outer)) outer = null;
    var set = function (el, v) {
      if (v) el.setAttribute(attr, v); else el.removeAttribute(attr);
      if (attr === 'data-c') el.style.color = /^#/.test(v || '') ? v : '';
      if (!el.getAttribute('style')) el.removeAttribute('style');
    };
    var marked = function (el) { return el.hasAttribute('data-sz') || el.hasAttribute('data-c'); };
    var strip = function (root) {
      [].slice.call(root.querySelectorAll('span[' + attr + ']')).forEach(function (sp) {
        set(sp, '');
        if (!marked(sp)) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.parentNode.removeChild(sp); }
      });
    };
    var out = document.createRange();
    if (outer) {
      /* The words before and after the selection keep the old value, each in
         a copy of the span; the span itself becomes the selected words. */
      var tailR = document.createRange();
      tailR.setStart(range.endContainer, range.endOffset); tailR.setEnd(outer, outer.childNodes.length);
      var tail = outer.cloneNode(false); tail.appendChild(tailR.extractContents());
      var headR = document.createRange();
      headR.setStart(outer, 0); headR.setEnd(range.startContainer, range.startOffset);
      var head = outer.cloneNode(false); head.appendChild(headR.extractContents());
      if (head.textContent) outer.parentNode.insertBefore(head, outer);
      if (tail.textContent) outer.parentNode.insertBefore(tail, outer.nextSibling);
      strip(outer);
      set(outer, value);
      if (marked(outer)) { out.selectNodeContents(outer); return out; }
      var first = outer.firstChild, last = outer.lastChild;
      while (outer.firstChild) outer.parentNode.insertBefore(outer.firstChild, outer);
      outer.parentNode.removeChild(outer);
      if (first) { out.setStartBefore(first); out.setEndAfter(last); }
      return out;
    }
    var frag = range.extractContents();
    strip(frag);
    if (value) {
      var w = document.createElement('span');
      set(w, value);
      w.appendChild(frag);
      range.insertNode(w);
      out.selectNodeContents(w);
    } else {
      var f0 = frag.firstChild, f1 = frag.lastChild;
      range.insertNode(frag);
      if (f0) { out.setStartBefore(f0); out.setEndAfter(f1); }
    }
    return out;
  }

  /* ---- the formatting bar ------------------------------------------------ */

  /* B, I, U and a link, above whatever is selected in a formatted box —
     the only formatting there is, so a person is never faced with a
     toolbar full of choices (Chase: "without overly complicating
     everything"). The usual keys work too: Ctrl/Cmd + B, I, U. */
  var fmt = document.createElement('div');
  fmt.className = 'ws-fmt';
  fmt.hidden = true;
  fmt.innerHTML = [['bold', 'B'], ['italic', 'I'], ['underline', 'U']].map(function (x) {
    return '<button type="button" data-fmt="' + x[0] + '" class="ws-fmt-' + x[0] + '" aria-label="' + esc(tr('ws.fmt.' + x[0])) + '" title="' + esc(tr('ws.fmt.' + x[0])) + '">' + x[1] + '</button>';
  }).join('') +
    '<button type="button" data-fmt="size" class="ws-fmt-size" aria-expanded="false" aria-label="' + esc(tr('ml.cpSize')) + '" title="' + esc(tr('ml.cpSize')) + '">Aa</button>' +
    '<button type="button" data-fmt="color" class="ws-fmt-color" aria-expanded="false" aria-label="' + esc(tr('ml.cpColor')) + '" title="' + esc(tr('ml.cpColor')) + '"><i class="is-none"></i></button>' +
    '<button type="button" data-fmt="link" aria-label="' + esc(tr('ws.fmt.link')) + '" title="' + esc(tr('ws.fmt.link')) + '">' +
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg></button>' +
    '<div class="ws-fmt-row" data-fmt-row="size" hidden>' + [['', 'ml.cpSizeNormal'], ['sm', 'ml.cpSizeSm'], ['lg', 'ml.cpSizeLg'], ['xl', 'ml.cpSizeXl']].map(function (x) {
      return '<button type="button" data-fmt-sz="' + x[0] + '" class="ws-fmt-sz-' + (x[0] || 'n') + '" aria-pressed="false">' + esc(tr(x[1])) + '</button>';
    }).join('') +
    '<span class="ws-fmt-step"><button type="button" data-fmt-step="-1" aria-label="' + esc(tr('ws.fmt.smaller')) + '" title="' + esc(tr('ws.fmt.smaller')) + '">−</button>' +
    '<input type="number" min="4" max="200" step="1" data-fmt-szval placeholder="16" aria-label="' + esc(tr('ml.cpSize')) + '">' +
    '<button type="button" data-fmt-step="1" aria-label="' + esc(tr('ws.fmt.larger')) + '" title="' + esc(tr('ws.fmt.larger')) + '">+</button></span></div>' +
    '<div class="ws-fmt-row" data-fmt-row="color" hidden>' + [''].concat(TONE_NAMES).map(function (c) {
      var key = 'ml.cpTone' + (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'None');
      return '<button type="button" class="ws-fmt-tone" data-fmt-c="' + c + '" aria-pressed="false" aria-label="' + esc(tr(key)) + '" title="' + esc(tr(key)) + '"><i' +
        (TONE_SWATCH[c] ? ' style="background:' + TONE_SWATCH[c] + '"' : c === 'accent2' ? ' style="background:var(--ws-acc2)"' : '') + '></i></button>';
    }).join('') +
    '<label class="ws-fmt-tone ws-fmt-any" title="' + esc(tr('ml.cpToneAny')) + '"><input type="color" value="#3366cc" data-fmt-any aria-label="' + esc(tr('ml.cpToneAny')) + '"></label></div>';
  document.body.appendChild(fmt);
  /* ABOVE THE WORDS, BY ITS BOTTOM EDGE. Opening a row of choices makes the
     bar taller; placed by its top it grew down over the words being changed
     (Chase, 2026-10-04). Below them only when there is no room above. */
  var fmtAt = null;
  function placeFmt() {
    if (!fmtAt) return;
    var top = fmtAt.top - fmt.offsetHeight - 8;
    fmt.style.top = (top < window.scrollY + 8 ? fmtAt.bottom + 8 : top) + 'px';
  }
  function fmtRow(which) {
    [].forEach.call(fmt.querySelectorAll('[data-fmt-row]'), function (r) {
      var open = r.getAttribute('data-fmt-row') === which && r.hidden;
      r.hidden = !open;
      var b = fmt.querySelector('[data-fmt="' + r.getAttribute('data-fmt-row') + '"]');
      if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (!fmt.hidden) placeFmt();
  }
  /* What the selection already wears, shown on the bar. */
  /* The element the selection starts in. A range that starts BETWEEN nodes
     (as one does right after a size is applied) names the parent and an
     offset; the node at that offset is the one meant. */
  function selElement() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0), n = r.startContainer;
    if (n.nodeType === 1 && n.childNodes[r.startOffset]) n = n.childNodes[r.startOffset];
    if (n.nodeType === 3 && r.startOffset >= n.length && n.nextSibling) n = n.nextSibling;
    return n && (n.nodeType === 1 ? n : n.parentNode);
  }
  function markOf(box, attr) {
    var n = selElement();
    var sp = n && n.closest ? n.closest('span[' + attr + ']') : null;
    return sp && box.contains(sp) ? sp.getAttribute(attr) : '';
  }
  /* The size the words are now, in px, whether chosen or inherited. */
  function sizeNow(box) {
    var px = sizePx(markOf(box, 'data-sz'));
    if (px) return px;
    var n = selElement();
    var c = n && box.contains(n) ? parseFloat(getComputedStyle(n).fontSize) : 16;
    return Math.round((c || 16) * 2) / 2;
  }
  function showMarks(box) {
    var sz = markOf(box, 'data-sz'), c = markOf(box, 'data-c');
    [].forEach.call(fmt.querySelectorAll('[data-fmt-sz]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-fmt-sz') === sz ? 'true' : 'false'); });
    var szv = fmt.querySelector('[data-fmt-szval]');
    if (szv && document.activeElement !== szv) szv.value = sizeNow(box);
    [].forEach.call(fmt.querySelectorAll('[data-fmt-c]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-fmt-c') === c ? 'true' : 'false'); });
    var any = /^#/.test(c), dot = fmt.querySelector('.ws-fmt-color i');
    fmt.querySelector('.ws-fmt-any').classList.toggle('is-on', any);
    if (any) fmt.querySelector('[data-fmt-any]').value = c;
    dot.style.background = any ? c : TONE_SWATCH[c] || (c === 'accent' ? 'var(--ws-acc)' : c === 'accent2' ? 'var(--ws-acc2)' : '');
    dot.classList.toggle('is-none', !c);
  }
  function boxOfSelection() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var n = sel.anchorNode; n = n && (n.nodeType === 1 ? n : n.parentNode);
    var box = n && n.closest && n.closest('[data-rt]');
    return box && box.getAttribute('contenteditable') === 'true' ? box : null;
  }
  var fmtWords = '';
  document.addEventListener('selectionchange', function () {
    var box = boxOfSelection();
    if (!box) { if (!fmt.contains(document.activeElement)) fmt.hidden = true; return; }
    /* PINNED while a row of choices is open: the words change size under
       it, and a bar that re-centered on them would jump with every press. */
    var said = window.getSelection().toString();
    var pinned = !fmt.hidden && said === fmtWords && fmt.querySelector('[data-fmt-row]:not([hidden])');
    if (pinned) return showMarks(box);
    fmtWords = said;
    fmtRow(null);
    var r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    fmt.hidden = false;
    fmtAt = { top: window.scrollY + r.top, bottom: window.scrollY + r.bottom };
    placeFmt();
    fmt.style.left = Math.max(8, window.scrollX + r.left + r.width / 2 - fmt.offsetWidth / 2) + 'px';
    [].forEach.call(fmt.querySelectorAll('[data-fmt]'), function (b) {
      var c = b.getAttribute('data-fmt');
      if (c === 'bold' || c === 'italic' || c === 'underline') b.setAttribute('aria-pressed', document.queryCommandState(c) ? 'true' : 'false');
    });
    showMarks(box);
  });
  /* Keep the selection: a press on the bar must not take focus from the box.
     Except the color picker, which needs focus to open; the selection is
     kept aside for it instead. */
  var anyAt = null;
  fmt.addEventListener('mousedown', function (e) {
    if (e.target.closest('[data-fmt-any], .ws-fmt-any, [data-fmt-szval]')) {
      var box = boxOfSelection();
      anyAt = box ? { box: box, range: window.getSelection().getRangeAt(0).cloneRange() } : null;
      return;
    }
    e.preventDefault();
  });
  function markSelection(box, range, attr, value) {
    var r = applyMark(box, range, attr, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    return r;
  }
  fmt.querySelector('[data-fmt-any]').addEventListener('input', function () {
    if (!anyAt) return;
    anyAt.range = markSelection(anyAt.box, anyAt.range, 'data-c', this.value.toLowerCase());
  });
  /* A typed size: applied as it is typed, the words kept selected. */
  fmt.querySelector('[data-fmt-szval]').addEventListener('input', function () {
    var n = Math.round(+this.value * 2) / 2;
    if (!anyAt || !(n >= 4 && n <= 200)) return;
    anyAt.range = markSelection(anyAt.box, anyAt.range, 'data-sz', n + 'px');
    sizeOnScreen(anyAt.box);
  });
  fmt.querySelector('[data-fmt-szval]').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !anyAt) return;
    e.preventDefault();
    anyAt.box.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(anyAt.range);
    anyAt = null;
  });
  fmt.querySelector('[data-fmt-any]').addEventListener('change', function () {
    if (!anyAt) return;
    anyAt.box.focus();
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(anyAt.range);
    anyAt = null;
    fmtRow(null);
  });
  fmt.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-fmt], [data-fmt-sz], [data-fmt-c], [data-fmt-step]'), box = boxOfSelection();
    if (!b || !box) return;
    /* − / + : the next step on Word's ladder from the size the words are now. */
    if (b.hasAttribute('data-fmt-step')) {
      var cur = sizeNow(box), dir = +b.getAttribute('data-fmt-step');
      var next = dir > 0 ? (LADDER.filter(function (n) { return n > cur; })[0] || Math.min(200, cur + 8))
                         : (LADDER.filter(function (n) { return n < cur; }).pop() || 4);
      var rs = markSelection(box, window.getSelection().getRangeAt(0), 'data-sz', next + 'px');
      var sel2 = window.getSelection(); sel2.removeAllRanges(); sel2.addRange(rs);
      sizeOnScreen(box);
      showMarks(box);
      return;
    }
    if (b.hasAttribute('data-fmt-sz') || b.hasAttribute('data-fmt-c')) {
      var attr = b.hasAttribute('data-fmt-sz') ? 'data-sz' : 'data-c';
      var r = markSelection(box, window.getSelection().getRangeAt(0), attr, b.getAttribute(attr === 'data-sz' ? 'data-fmt-sz' : 'data-fmt-c'));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      fmtRow(null);
      sizeOnScreen(box);
      showMarks(box);
      return;
    }
    var c = b.getAttribute('data-fmt');
    if (c === 'size' || c === 'color') { fmtRow(c); return; }
    if (c === 'link') {
      var range = window.getSelection().getRangeAt(0).cloneRange();
      var url = window.StaffPrompt ? await window.StaffPrompt({ title: tr('ws.fmt.linkAsk'), label: tr('ws.fmt.linkLabel'),
        placeholder: 'https://…', confirm: tr('ws.fmt.link'), cancel: tr('ms.cancel') }) : null;
      if (!url) return;
      url = String(url).trim();
      if (!/^(https?:\/\/|mailto:)/i.test(url)) url = /@/.test(url) ? 'mailto:' + url : 'https://' + url;
      box.focus();
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.execCommand('createLink', false, url);
    } else {
      document.execCommand(c, false, null);
    }
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });


  window.RichText = { html: inlineHtml, from: richFrom, sizeOnScreen: sizeOnScreen };
})();
