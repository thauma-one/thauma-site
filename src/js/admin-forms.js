/* ============================================================
   admin-forms.js — Website › Sharing: what of Thauma's appears
   on other websites
   ============================================================
   Laid out as the staff Sharing page is (Chase, 2026-10-27:
   "Admin Updates and Sharing operate differently from staff …
   Events and Resources don't have the Sharing visualizers
   anywhere"): the four on the left, the real thing in the middle,
   and what decides it and the code to paste on the right (see
   website/forms.njk).

   EVENTS AND RESOURCES are what the site wrote out with its pages
   (/embed-data/thauma.json, _data/thaumaEmbed.js), drawn by the
   same widget.js a ministry's are; shared while their page is on.

   THE TWO FORMS: /api/staff-mailing?scope=organization holds
   Thauma's lists, contact form, reasons, sending addresses and the
   pasted forms' words; the contact form saves whole (action
   contact-form), a list saves whole as the Mail page saves it, and
   the words save per form (action form-words). The preview is the
   real form.js / contact.js for "thauma" with the words as typed.

   A WORKING COPY AND ONE BAR, like every screen in the console.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('wfRoot');
  if (!root) return;

  var API = '/api/staff-mailing?scope=organization';
  var DATA = '/embed-data/thauma.json';
  var ITEMS = ['events', 'resources', 'signup', 'contact'];
  /* Thauma's two voices (main.css --blue, --foam): the forms have no
     palette of their own to read them from. */
  var ACCENT = '#2FD8FF', ACCENT2 = '#5CF2C4';
  var PREVIEW_MAX_H = 480, DESKTOP_W = 1000;

  var $ = function (id) { return document.getElementById(id); };
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function setSwitch(btn, on) {
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    var st = btn.querySelector('.switch-state');
    if (st) st.textContent = tr(on ? 'switch.on' : 'switch.off');
  }

  /* Updates' "Share settings and code → Sharing" opens its own (?item=). */
  var asked = new URLSearchParams(location.search).get('item');
  var state = { mail: null, data: null, saved: null, draft: null, item: ITEMS.indexOf(asked) !== -1 ? asked : 'events', busy: false,
                device: 'wide', lang: 'en', theme: 'dark', writing: 'en', beside: null };

  /* The site's languages: the ones this build publishes (#libLangs, areas.njk). */
  var HOME = 'en';
  var LANGS = (function () {
    try { return JSON.parse(document.getElementById('libLangs').textContent) || [HOME]; }
    catch (e) { return [HOME]; }
  })();
  function langName(code) {
    try {
      var n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      return n ? n.charAt(0).toUpperCase() + n.slice(1) : code;
    } catch (e) { return code; }
  }
  function topicName(x, lang) { return lang === HOME ? x.label : ((x.labels || {})[lang] || ''); }
  function isForm(item) { return item === 'signup' || item === 'contact'; }

  /* A form's words with the empty ones left out, so typing then clearing
     a field is no change. */
  function tidy(byLang) {
    var out = {};
    Object.keys(byLang || {}).sort().forEach(function (l) {
      var w = byLang[l] || {}, keep = {};
      ['heading', 'blurb', 'button', 'thanks'].forEach(function (k) { if (String(w[k] || '').trim()) keep[k] = String(w[k]).trim(); });
      if (Object.keys(keep).length) out[l] = keep;
    });
    return out;
  }

  function snapshot() {
    var m = state.mail || {}, c = m.contact || {}, open = {}, fw = m.form_words || {};
    (m.lists || []).forEach(function (l) { open[l.id] = !!l.is_open; });
    return {
      contact: {
        deliver_to: c.deliver_to || '', from_address: c.from_address || '', is_open: !!c.is_open,
        topics: (m.topics || []).map(function (t) {
          return { label: t.label || '', deliver_to: t.deliver_to || '', labels: Object.assign({}, t.labels || {}) };
        })
      },
      lists: open,
      formWords: { signup: clone(fw.signup || {}), contact: clone(fw.contact || {}) }
    };
  }

  function changes() {
    var a = state.saved, b = state.draft, out = { lists: [], words: [] };
    if (!a || !b) return out;
    out.contact = !same(a.contact, b.contact);
    out.lists = Object.keys(b.lists).filter(function (id) { return a.lists[id] !== b.lists[id]; });
    out.words = ['signup', 'contact'].filter(function (f) { return !same(tidy(a.formWords[f]), tidy(b.formWords[f])); });
    return out;
  }
  function count() { var c = changes(); return (c.contact ? 1 : 0) + c.lists.length + c.words.length; }
  function itemDirty(item) {
    var c = changes();
    if (item === 'contact') return c.contact || c.words.indexOf('contact') !== -1;
    if (item === 'signup') return !!c.lists.length || c.words.indexOf('signup') !== -1;
    return false;
  }

  /* OUT OR NOT: Events and Resources while their page is on; the contact
     form by its switch; the sign-up form while any list is on it. */
  function itemLive(item) {
    var d = state.draft;
    if (item === 'events' || item === 'resources') return !!(state.data && (state.data.shared || []).indexOf(item) !== -1);
    if (!d) return false;
    if (item === 'contact') return d.contact.is_open;
    return Object.keys(d.lists).some(function (id) { return d.lists[id]; });
  }

  /* ---- drawing --------------------------------------------------------- */

  function drawList() {
    $('wfList').innerHTML = ITEMS.map(function (item) {
      var live = itemLive(item), on = item === state.item;
      return '<button type="button" class="sh-item' + (on ? ' is-on' : '') + (itemDirty(item) ? ' is-dirty' : '') +
          '" data-wf="' + item + '"' + (on ? ' aria-current="true"' : '') + '>' +
        '<span class="sh-item-name">' + esc(tr('sh.item.' + item)) + '</span>' +
        '<span class="sh-item-state' + (live ? ' is-live' : '') + '">' + esc(tr(live ? 'sh.live' : 'sh.notShared')) + '</span>' +
      '</button>';
    }).join('');
  }

  function drawSide() {
    var item = state.item;
    [].forEach.call(root.querySelectorAll('[data-wf-panel]'), function (p) {
      p.hidden = p.dataset.wfPanel.split(' ').indexOf(item) === -1;
    });
    if (item === 'events' || item === 'resources') {
      var on = itemLive(item);
      $('wfPageState').textContent = tr(on ? 'wf.pageOn' : 'wf.pageOff');
      $('wfPageState').classList.toggle('is-live', on);
      $('wfPageLink').href = '/admin/website/?page=' + item;
    }
    $('wfTheme').value = state.theme;
    $('wfCode').textContent = code();
  }

  function drawContact() {
    var c = state.draft.contact;
    setSwitch($('wfCtOpen'), c.is_open);
    if (document.activeElement !== $('wfCtTo')) $('wfCtTo').value = c.deliver_to;
    var senders = (state.mail && state.mail.senders) || [];
    var opts = senders.slice();
    if (c.from_address && !opts.some(function (a) { return a.address === c.from_address; })) {
      opts.unshift({ address: c.from_address, missing: true });
    }
    $('wfCtFrom').innerHTML = '<option value="">' + esc(tr('ml.fromPick')) + '</option>' +
      opts.map(function (a) {
        return '<option value="' + esc(a.address) + '"' + (a.address === c.from_address ? ' selected' : '') + '>' +
          esc(a.address + (a.missing ? '  (' + tr('ml.fromGone') + ')' : '')) + '</option>';
      }).join('');
    drawTopics();
  }

  /* A topic's own key while the page is open (topics carry no id), so a
     dragged one keeps focus through the redraw (StaffSort, staff.js). */
  var topicKeys = new WeakMap(), topicN = 0;
  function topicKey(x) { if (!topicKeys.has(x)) topicKeys.set(x, 't' + (++topicN)); return topicKeys.get(x); }

  /* The reasons in the language the words are being written in. */
  function drawTopics() {
    var t = state.draft.contact.topics, w = state.writing, b = state.beside;
    $('wfTopics').innerHTML = t.length ? t.map(function (x, i) {
      var ref = b ? topicName(x, b) : '';
      return '<div class="ct-topic" data-topic="' + i + '" data-k="' + topicKey(x) + '">' +
        (window.StaffSort ? StaffSort.grip(tr('ws.dragMove')) : '') +
        '<span class="ct-topic-name">' +
          (ref ? '<small class="ms-ref" lang="' + esc(b) + '">' + esc(ref) + '</small>' : '') +
          '<input type="text" class="ct-topic-label" maxlength="80" lang="' + esc(w) + '"' +
            ' value="' + esc(topicName(x, w)) + '"' +
            ' placeholder="' + esc(w === HOME ? tr('ml.ctTopicLabel') : x.label) + '">' +
        '</span>' +
        '<input type="email" class="ct-topic-to" maxlength="200" value="' + esc(x.deliver_to) + '"' +
          ' placeholder="' + esc(tr('ml.ctTopicTo')) + '">' +
        '<button type="button" class="del" data-drop-topic="' + i + '" aria-label="' + esc(tr('common.delete')) + '">×</button>' +
      '</div>';
    }).join('') : '<p class="hint">' + esc(tr('ml.ctNoTopics')) + '</p>';
  }

  function drawLists() {
    var lists = (state.mail && state.mail.lists) || [], d = state.draft;
    $('wfLists').innerHTML = lists.length ? lists.map(function (l) {
      var on = !!d.lists[l.id];
      return '<button type="button" class="switch small" role="switch" aria-checked="' + on + '"' +
        ' data-list="' + esc(l.id) + '">' +
        '<span class="switch-track"><span class="switch-state">' + tr(on ? 'switch.on' : 'switch.off') +
        '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(l.name) + '</span></button>';
    }).join('') : '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
  }

  /* THE WORDS ON A PASTED FORM, "Writing X beside Y" as on staff Sharing. */
  var WORD_FIELDS = {
    signup: [['heading', 'ml.formHeading', 120, 'ml.formHeadingFallback'],
             ['blurb', 'ml.formBlurb', 240, null],
             ['button', 'ml.formButton', 40, 'ml.formPreviewFallback']],
    contact: [['heading', 'ml.ctHeading', 120, null], ['blurb', 'ml.ctBlurb', 240, null],
              ['button', 'ml.ctButton', 40, null], ['thanks', 'ml.ctThanks', 240, null]]
  };
  function wordsIn(item, lang) {
    var byLang = state.draft.formWords[item];
    return byLang[lang] || (byLang[lang] = { heading: '', blurb: '', button: '', thanks: '' });
  }
  function drawWords() {
    var item = state.item;
    $('wfWords').hidden = !isForm(item);
    if (LANGS.indexOf(state.writing) === -1) state.writing = HOME;
    var others = LANGS.filter(function (c) { return c !== state.writing; });
    if (others.indexOf(state.beside) === -1) state.beside = others[0] || null;
    $('wfWriting').innerHTML = LANGS.map(function (c) {
      var has = isForm(item) && Object.keys(tidy(state.draft.formWords[item])).indexOf(c) !== -1;
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + (!isForm(item) || has ? '' : ' · ' + esc(tr('sh.defaults'))) + '</option>';
    }).join('');
    $('wfWriting').value = state.writing;
    $('wfBesideWrap').hidden = !others.length;
    $('wfBeside').innerHTML = others.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + '</option>';
    }).join('');
    $('wfBeside').value = state.beside || '';
    if (!isForm(item)) return;
    var mine = wordsIn(item, state.writing);
    var ref = state.beside ? (state.draft.formWords[item][state.beside] || {}) : {};
    $('wfWordFields').innerHTML = WORD_FIELDS[item].map(function (f) {
      return '<label class="fld"><span>' + esc(tr(f[1])) + '</span>' +
        (ref[f[0]] ? '<small class="ms-ref" lang="' + esc(state.beside) + '">' + esc(ref[f[0]]) + '</small>' : '') +
        '<input type="text" data-word="' + f[0] + '" maxlength="' + f[2] + '" value="' + esc(mine[f[0]] || '') + '"' +
        ' lang="' + esc(state.writing) + '"' + (f[3] ? ' placeholder="' + esc(tr(f[3])) + '"' : '') + '></label>';
    }).join('');
  }

  function drawLangs() {
    if (LANGS.indexOf(state.lang) === -1) state.lang = HOME;
    $('wfLang').innerHTML = LANGS.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + '</option>';
    }).join('');
    $('wfLang').value = state.lang;
  }

  function drawBar() {
    var n = count();
    $('wfBar').hidden = !n;
    document.body.classList.toggle('has-savebar', !!n);
    $('wfCount').textContent = n === 1 ? tr('up.pending1') : fill('up.pendingN', { n: n });
  }

  /* ---- the code and the preview ---------------------------------------- */

  function code() {
    var item = state.item, origin = location.origin;
    var lang = state.lang && state.lang !== HOME ? ' data-lang="' + esc(state.lang) + '"' : '';
    var theme = state.theme !== 'auto' ? ' data-theme="' + esc(state.theme) + '"' : '';
    if (isForm(item)) {
      var tag = item === 'signup' ? 'form' : 'contact';
      return '<div data-thauma-' + tag + ' data-accent="' + ACCENT + '" data-accent2="' + ACCENT2 + '"' + theme + lang + '></div>\n' +
        '<script src="' + origin + '/embed/v1/thauma/' + tag + '.js" defer></' + 'script>';
    }
    return '<div data-thauma="thauma" data-widget="' + item + '"' + theme + lang + '></div>\n' +
      '<script src="' + origin + '/embed/v1/widget.js" async></' + 'script>';
  }

  var timer = null;
  function drawPreviewSoon() { clearTimeout(timer); timer = setTimeout(drawPreview, 180); }

  /* The real widget or form, in a frame sandboxed to scripts only, drawn
     from the screen rather than from what is saved — the preview leads
     Save. */
  function drawPreview() {
    var frame = $('wfFrame'), item = state.item;
    if (!state.draft) return;
    fit(lastH);
    var mode = state.theme;
    var bg = mode === 'light' ? '#ffffff' : mode === 'dark' ? '#0b0f15' : 'Canvas';
    var head = '<!doctype html><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light dark">' +
      '<body style="margin:0;padding:20px;background:' + bg + '">';
    var theme = ' data-theme="' + esc(mode) + '"', lang = ' data-lang="' + esc(state.lang) + '"';

    if (!isForm(item)) {
      if (!state.data) { frame.removeAttribute('srcdoc'); return; }
      frame.srcdoc = head +
        '<script>window.__thaumaPreview=' + JSON.stringify(state.data).replace(/</g, '\\u003c') + '</' + 'script>' +
        '<div data-thauma="thauma" data-widget="' + item + '"' + theme + lang + '></div>' +
        '<script src="' + location.origin + '/embed/v1/widget.js"></' + 'script>';
      return;
    }
    var fa = ' data-accent="' + ACCENT + '" data-accent2="' + ACCENT2 + '"' + theme + lang;
    /* In the preview's language, with its words as typed. */
    var words = state.draft.formWords[item][state.lang] || {};
    WORD_FIELDS[item].forEach(function (f) {
      var v = String(words[f[0]] || '').trim();
      if (v) fa += ' data-' + f[0] + '="' + esc(v) + '"';
    });
    var tag = item === 'signup' ? 'form' : 'contact';
    frame.srcdoc = head + '<div data-thauma-' + tag + fa + '></div>' +
      '<script src="/embed/v1/thauma/' + tag + '.js?t=' + Date.now() + '"></' + 'script>';
  }

  /* The frame takes the height its content reports. A form is scaled to
     fit rather than scrolled, and says so. */
  window.addEventListener('message', function (e) {
    var h = e.data && e.data.__thaumaHeight;
    var frame = $('wfFrame');
    if (!h || !frame || frame.contentWindow !== e.source) return;
    fit(Math.max(180, Math.min(2400, h)));
  });

  var lastH = 300;
  function fit(h) {
    lastH = h;
    var frame = $('wfFrame'), wrap = $('wfScale'), stage = $('wfStage');
    var scale;
    if (isForm(state.item)) {
      scale = Math.min(1, PREVIEW_MAX_H / h);
      wrap.style.inlineSize = (100 / scale) + '%';
    } else if (state.device === 'wide') {
      var w = stage.getBoundingClientRect().width || DESKTOP_W;
      scale = Math.min(1, w / DESKTOP_W);
      wrap.style.inlineSize = scale < 1 ? DESKTOP_W + 'px' : '100%';
    } else {
      scale = 1;
      wrap.style.inlineSize = '100%';
    }
    frame.style.blockSize = h + 'px';
    wrap.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
    stage.style.blockSize = Math.ceil(h * scale) + 'px';
    $('wfScaleNote').textContent = scale < 0.99 ? fill('emb.shownAt', { n: Math.round(scale * 100) }) : '';
  }
  window.addEventListener('resize', function () { fit(lastH); });

  function drawAll() {
    drawList(); drawSide(); drawLangs(); drawWords(); drawContact(); drawLists(); drawBar(); drawPreviewSoon();
  }
  /* After an edit: everything but the field being typed in. */
  function changed() { drawList(); drawSide(); drawBar(); drawPreviewSoon(); }

  /* ---- loading and saving ---------------------------------------------- */

  async function call(method, body) {
    var res = await fetch(API, {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    var out = await res.json().catch(function () { return {}; });
    /* Saved by someone else since this page loaded it (workers/src/lib/
       fresh.js): ask. Saving mine sends it again with overwrite; keeping
       theirs skips it, and the reload after saving shows theirs. */
    if (res.status === 409 && out.changed && body) {
      if (await window.StaffChanged(out)) return call(method, Object.assign({}, body, { overwrite: true }));
      return {};
    }
    if (!res.ok) throw new Error(out.error || (tr('err.refused') + ' (' + res.status + ')'));
    return out;
  }

  async function load() {
    var got = await Promise.allSettled([
      call('GET'),
      fetch(DATA, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
    ]);
    if (got[0].status !== 'fulfilled') {
      $('wfProblem').textContent = got[0].reason.message; $('wfProblem').hidden = false; return;
    }
    $('wfProblem').hidden = true;
    state.mail = got[0].value;
    state.data = got[1].status === 'fulfilled' ? got[1].value : null;
    state.saved = snapshot();
    state.draft = clone(state.saved);
    drawAll();
  }

  async function save() {
    if (state.busy) return;
    var c = changes(), d = state.draft, failed = [];
    state.busy = true;
    $('wfSave').disabled = $('wfDiscard').disabled = true;
    async function step(fn) { try { await fn(); } catch (e) { failed.push(e.message); } }

    if (c.contact) await step(function () {
      var k = d.contact, old = (state.mail && state.mail.contact) || {};
      return call('POST', {
        action: 'contact-form', updated_at: old.updated_at,
        deliver_to: k.deliver_to.trim(), from_address: k.from_address, is_open: k.is_open,
        /* The form's old word columns ride along unchanged; its words are
           per language now (form-words). */
        heading: old.heading || '', blurb: old.blurb || '', button: old.button || '', thanks: old.thanks || '',
        topics: k.topics.filter(function (t) { return t.label.trim(); })
          .map(function (t) { return { label: t.label.trim(), deliver_to: t.deliver_to.trim(), labels: t.labels }; })
      });
    });
    for (var i = 0; i < c.lists.length; i++) {
      var l = ((state.mail && state.mail.lists) || []).filter(function (x) { return x.id === c.lists[i]; })[0];
      if (!l) continue;
      /* The whole list, as the Mail page saves it. */
      await step(function () {
        return call('POST', {
          id: l.id, updated_at: l.updated_at, name: l.name, description: l.description || '',
          from_name: l.from_name, from_email: l.from_email, reply_to: l.reply_to || '',
          /* Every field: one left out is saved as off. */
          is_open: !!d.lists[l.id], archive_public: !!l.archive_public, form_thanks_url: l.form_thanks_url || '',
          form_heading: l.form_heading || '', form_blurb: l.form_blurb || '', form_button: l.form_button || ''
        });
      });
    }
    for (var j = 0; j < c.words.length; j++) {
      var form = c.words[j];
      await step(function () { return call('POST', { action: 'form-words', form: form, words: tidy(d.formWords[form]) }); });
    }

    state.busy = false;
    $('wfSave').disabled = $('wfDiscard').disabled = false;
    await load();
    if (failed.length) toast(fill('up.failed', { n: failed.length, first: failed[0] }), 'err');
    else toast(tr('toast.saved'), 'ok');
  }

  async function discard() {
    var n = count();
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: n === 1 ? tr('up.discardTitle1') : fill('up.discardTitle', { n: n }),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.draft = clone(state.saved);
    drawAll();
  }

  /* ---- wiring ---------------------------------------------------------- */

  /* topics drag into order, or move by the arrow keys on their grip */
  if (window.StaffSort) StaffSort(root, { items: '#wfTopics > .ct-topic', handle: '.ct-topic .sort-grip',
    key: function (it) { return it.dataset.k; },
    drop: function (l, from, to) { var t = state.draft.contact.topics; t.splice(to, 0, t.splice(from, 1)[0]); drawTopics(); changed(); } });
  root.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-wf]');
    if (pick) {
      state.item = pick.dataset.wf;
      lastH = 300;
      drawList(); drawSide(); drawWords(); drawPreviewSoon();
      return;
    }
    if (!state.draft) return;
    var t = state.draft.contact.topics;
    var dr = e.target.closest('[data-drop-topic]');
    if (dr) { t.splice(+dr.dataset.dropTopic, 1); drawTopics(); changed(); return; }
    var li = e.target.closest('[data-list]');
    if (li) { state.draft.lists[li.dataset.list] = !state.draft.lists[li.dataset.list]; drawLists(); changed(); }
  });
  [].forEach.call(root.querySelectorAll('[data-wf-width]'), function (b) {
    b.addEventListener('click', function () {
      state.device = b.dataset.wfWidth;
      [].forEach.call(root.querySelectorAll('[data-wf-width]'), function (x) {
        var on = x === b;
        x.classList.toggle('is-on', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      $('wfStage').classList.toggle('is-narrow', state.device === 'narrow');
      drawPreviewSoon();
    });
  });
  $('wfLang').addEventListener('change', function () { state.lang = this.value; drawSide(); drawPreviewSoon(); });
  $('wfTheme').addEventListener('change', function () { state.theme = this.value; drawSide(); drawPreviewSoon(); });
  $('wfCopy').addEventListener('click', function () {
    navigator.clipboard.writeText(code()).then(function () { toast(tr('ml.copied'), 'ok'); })
      .catch(function () { toast(tr('ml.copyManual'), 'err'); });
  });
  $('wfCtOpen').addEventListener('click', function () {
    if (!state.draft) return;
    state.draft.contact.is_open = !state.draft.contact.is_open;
    setSwitch(this, state.draft.contact.is_open); changed();
  });
  $('wfCtTo').addEventListener('input', function () { if (state.draft) { state.draft.contact.deliver_to = this.value; changed(); } });
  $('wfCtFrom').addEventListener('change', function () { if (state.draft) { state.draft.contact.from_address = this.value; changed(); } });
  $('wfTopics').addEventListener('input', function (e) {
    var row = e.target.closest('[data-topic]');
    if (!row || !state.draft) return;
    var t = state.draft.contact.topics[+row.dataset.topic];
    var v = row.querySelector('.ct-topic-label').value;
    if (state.writing === HOME) t.label = v;
    else {
      t.labels = t.labels || {};
      /* An emptied translation is no translation. */
      if (v.trim()) t.labels[state.writing] = v; else delete t.labels[state.writing];
    }
    t.deliver_to = row.querySelector('.ct-topic-to').value;
    changed();
  });
  $('wfAddTopic').addEventListener('click', function () {
    if (!state.draft) return;
    state.draft.contact.topics.push({ label: '', deliver_to: '', labels: {} });
    drawTopics(); changed();
    var rows = root.querySelectorAll('#wfTopics .ct-topic-label');
    if (rows.length) rows[rows.length - 1].focus();
  });
  $('wfWordFields').addEventListener('input', function (e) {
    var f = e.target.closest('[data-word]');
    if (!f || !state.draft || !isForm(state.item)) return;
    wordsIn(state.item, state.writing)[f.dataset.word] = f.value;
    changed();
  });
  /* The words and the reasons are written in one language at a time, and
     the preview follows it. */
  $('wfWriting').addEventListener('change', function () {
    state.writing = state.lang = this.value;
    drawWords(); drawLangs(); drawTopics(); drawSide(); drawPreviewSoon();
  });
  $('wfBeside').addEventListener('change', function () { state.beside = this.value; drawWords(); drawTopics(); });
  $('wfSave').addEventListener('click', save);
  $('wfDiscard').addEventListener('click', discard);

  window.addEventListener('beforeunload', function (e) {
    if (!count()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  load();
})();
