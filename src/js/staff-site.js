/* ============================================================
   staff-site.js — the ministry's own website (Website tab, 0044)
   ============================================================
   Pages · Design · Links · Footer · Settings, from /api/staff-site.

   HOW SAVING WORKS. Every change goes into the working copy on the
   server a moment after it is made ("Saved"), so nothing is lost
   between visits and the preview beside the sections shows it. What
   visitors see changes only with Publish, in the bar along the foot.

   WHO MAY CHANGE IT. The owner, and whoever the owner allows. Anyone
   else on the team sees the same screens with every control switched
   off, and a way to ask. The server enforces that; this only draws it.

   Words are written one language at a time — Editing and Reference,
   with Swap and Translate — like every other editor here.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-staff-page') !== 'website') return;

  var API = '/api/staff-site';
  var $ = function (id) { return document.getElementById(id); };
  var state = { body: null, doc: null, tab: 'pages', page: null, langA: null, langB: null,
                timer: null, saving: false, again: false, frameTimer: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function fill(k, v) { return window.StaffI18n && window.StaffI18n.fill ? window.StaffI18n.fill(k, v) : tr(k); }
  function toast(m, kind) { if (window.StaffToast) window.StaffToast(m, kind); }
  function canEdit() { return !!(state.body && state.body.can.edit); }
  function uid() { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* What each kind of section is made of — the same list as site/model.js. */
  var SECTIONS = {
    hero: { variants: ['behind', 'beside', 'words', 'monogram'], words: ['kicker', 'thin', 'bold', 'text', 'button'], photo: true, buttons: true, link: 'button' },
    text: { variants: ['left', 'center'], words: ['thin', 'bold', 'text', 'button'], link: 'button' },
    photoText: { variants: ['left', 'right', 'above'], words: ['thin', 'bold', 'text', 'button'], photo: true, link: 'both' },
    photo: { variants: ['drift', 'still', 'zoom'], words: ['caption'], photo: true, link: 'photo' },
    quote: { variants: ['large', 'quiet'], words: ['quote', 'who'] },
    timeline: { variants: ['condensed', 'full'], words: ['thin', 'bold', 'text'], data: 'updates/#milestones' },
    goals: { variants: ['cards'], words: ['thin', 'bold', 'text'], data: 'updates/#goals' },
    prayer: { variants: ['list'], words: ['thin', 'bold', 'text'], data: 'updates/#prayer' },
    videos: { variants: ['stage'], words: ['thin', 'bold', 'text'], data: 'updates/#videos' },
    newsletters: { variants: ['list'], words: ['thin', 'bold', 'text'], data: 'mail/' },
    signup: { variants: ['band', 'card'], words: ['thin', 'bold', 'text'], data: 'sharing/#signup' },
    contact: { variants: ['form'], words: ['thin', 'bold', 'text'], data: 'sharing/#contact' },
    give: { variants: ['band', 'card'], words: ['thin', 'bold', 'text', 'button'] },
    links: { variants: ['list', 'cards'], words: ['thin', 'bold', 'text'], items: true },
  };
  /* Everything but the opening and a full-width photo can sit on a raised band. */
  var FLAT = { hero: 1, photo: 1 };
  /* On a section of the ministry's data, "text" is the line under the heading. */
  function fieldName(type, f) { return f === 'text' && (SECTIONS[type].data || type === 'links') && type !== 'signup' && type !== 'contact' ? tr('ws.f.subtitle') : tr('ws.f.' + f); }
  var ORDER = ['hero', 'text', 'photoText', 'photo', 'quote', 'timeline', 'goals', 'prayer', 'videos', 'newsletters', 'signup', 'contact', 'give', 'links'];
  var MOTION = {
    entrance: ['rise', 'fade', 'slide', 'zoom', 'none'], photos: ['drift', 'zoom', 'still'],
    headings: ['letters', 'words', 'plain'], buttons: ['lift', 'glow', 'plain'],
    pages: ['fade', 'cut'], progress: ['on', 'off'],
  };
  var SOCIALS = ['youtube', 'instagram', 'facebook', 'x', 'tiktok', 'linkedin', 'spotify', 'email'];
  var LOOKS = ['night', 'paper', 'bold'];
  /* Each look's own background, shown in the picker until the owner picks one. */
  var LOOK_BG = { night: '#0A0D12', paper: '#F6F2EA', bold: '#F4F4F1' };
  var FOOTERS = ['split', 'center', 'columns'];
  var SOCIAL_NAME = { youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook', x: 'X', tiktok: 'TikTok',
    linkedin: 'LinkedIn', spotify: 'Spotify', email: 'Email' };

  /* ---- the languages --------------------------------------------------- */

  function langName(code) {
    var l = (state.body.languages || []).filter(function (x) { return x.code === code; })[0];
    return l ? (l.native_name || l.name) : code;
  }
  function fillPair() {
    var langs = state.doc.languages;
    if (langs.indexOf(state.langA) === -1) state.langA = langs.indexOf(state.doc.fallback) !== -1 ? state.doc.fallback : langs[0];
    var others = langs.filter(function (l) { return l !== state.langA; });
    if (others.indexOf(state.langB) === -1) state.langB = others[0] || null;
    $('wsLangA').innerHTML = langs.map(function (l) { return '<option value="' + esc(l) + '">' + esc(langName(l)) + '</option>'; }).join('');
    $('wsLangA').value = state.langA;
    $('wsLangB').innerHTML = langs.map(function (l) {
      return '<option value="' + esc(l) + '"' + (l === state.langA ? ' hidden disabled' : '') + '>' + esc(langName(l)) + '</option>';
    }).join('');
    $('wsLangB').value = state.langB || '';
    $('wsRefWrap').hidden = !others.length;
    /* Words are written on Pages, Links and Footer; Design and Settings have none. */
    $('wsWriting').hidden = !(state.tab === 'pages' || state.tab === 'links' || state.tab === 'footer');
  }
  $('wsLangA').addEventListener('change', function () { state.langA = this.value; if (state.langB === state.langA) state.langB = null; fillPair(); draw(); });
  $('wsLangB').addEventListener('change', function () { state.langB = this.value; draw(); });

  /* ---- saving ---------------------------------------------------------- */

  function changed(redrawPreview) {
    if (!canEdit()) return;
    $('wsSaved').textContent = tr('ws.saving');
    clearTimeout(state.timer);
    state.timer = setTimeout(save, 650);
    if (redrawPreview !== false) { clearTimeout(state.frameTimer); state.frameTimer = setTimeout(refreshFrame, 1600); }
  }
  async function save() {
    if (state.saving) { state.again = true; return; }
    state.saving = true;
    try {
      var body = await send({ action: 'save', draft: state.doc });
      state.body.site = body.site;
      $('wsSaved').textContent = tr('ws.saved');
      drawBar(); drawStatus();
    } catch (e) {
      $('wsSaved').textContent = '';
      toast(e.message, 'err');
    }
    state.saving = false;
    if (state.again) { state.again = false; save(); }
  }
  async function send(payload) {
    var res = await fetch(API, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    var body = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
    return body;
  }
  async function act(payload, message) {
    clearTimeout(state.timer);
    if (state.saving || state.timer) { try { await send({ action: 'save', draft: state.doc }); } catch (e) {} }
    try {
      apply(await send(payload));
      if (message) toast(message, 'ok');
      refreshFrame();
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ---- the whole page -------------------------------------------------- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
      body = await res.json();
    } catch (e) { if (window.StaffProblem) window.StaffProblem(tr('err.unreachable'), load); return; }
    if (body && body.you && window.StaffIdentity) window.StaffIdentity(body.you, body.partner);
    if (!res.ok) { if (window.StaffProblem) window.StaffProblem(body.error || tr('err.refused'), load); return; }
    if (window.StaffActing) window.StaffActing(body);
    apply(body);
  }

  function apply(body) {
    state.body = body;
    state.doc = body.draft;
    if (state.page && !state.doc.pages.some(function (p) { return p.id === state.page; })) state.page = null;
    $('wsRoot').hidden = false;
    $('wsStatus').hidden = false;
    var h = document.querySelector('.page-head h1');
    if (h && !body.can.owner && body.owner) {
      h.removeAttribute('data-i18n-html');
      h.innerHTML = esc(fill('ws.theirs', { name: body.owner.name || body.partner.display_name })).replace(/\s(\S+)$/, ' <b>$1</b>');
    }
    document.body.classList.toggle('ws-readonly', !body.can.edit);
    drawStatus(); drawAsk(); drawBar(); fillPair(); draw();
  }

  function drawStatus() {
    var s = state.body.site;
    var on = $('wsOn');
    on.setAttribute('aria-checked', s.enabled ? 'true' : 'false');
    on.querySelector('.switch-state').textContent = s.enabled ? 'On' : 'Off';
    on.disabled = !state.body.can.owner;
    on.hidden = !state.body.can.owner;
    $('wsState').textContent = s.enabled ? tr('ws.isLive') : s.archived ? tr('ws.isArchived') : tr('ws.isOff');
    var shown = s.address.replace(/^https?:\/\//, '').replace(/\/$/, '');
    $('wsAddress').textContent = shown + (s.enabled && s.dns && s.dns !== 'ready' ? ' · ' + tr('ws.dnsPending') : '');
    $('wsOpen').href = s.address;
    $('wsOpen').hidden = !s.enabled;
    $('wsPreview').href = s.preview;
    $('wsStatus').classList.toggle('is-on', !!s.enabled);
  }

  function drawAsk() {
    var b = state.body, box = $('wsAsk');
    box.hidden = b.can.edit;
    if (b.can.edit) return;
    var owner = (b.owner && b.owner.name) || b.partner.display_name;
    $('wsAskTitle').textContent = fill('ws.onlyOwner', { name: owner });
    if (b.my_request) {
      $('wsAskText').textContent = fill('ws.asked', { name: owner });
      $('wsAskBtn').hidden = true; $('wsAskNote').parentNode.hidden = true;
    } else {
      $('wsAskText').textContent = fill('ws.askText', { name: owner });
      $('wsAskBtn').hidden = false; $('wsAskNote').parentNode.hidden = false;
    }
  }
  $('wsAskBtn').addEventListener('click', function () {
    act({ action: 'request', note: $('wsAskNote').value.trim() }, tr('ws.askSent'));
  });

  function drawBar() {
    var show = canEdit() && state.body.site.unpublished;
    $('wsBar').hidden = !show;
    document.body.classList.toggle('has-savebar', show);
    $('wsDiscard').hidden = !state.body.site.published_at;
    $('wsBarText').textContent = state.body.site.published_at ? tr('ws.unpublished') : tr('ws.neverPublished');
  }
  $('wsPublish').addEventListener('click', function () { act({ action: 'publish' }, tr('ws.published')); });
  $('wsDiscard').addEventListener('click', async function () {
    var ok = window.StaffConfirm ? await window.StaffConfirm({ title: tr('ws.discardTitle'), confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true }) : true;
    if (ok) act({ action: 'discard' }, tr('toast.discarded'));
  });
  $('wsOn').addEventListener('click', async function () {
    var turningOn = this.getAttribute('aria-checked') !== 'true';
    var ok = window.StaffConfirm ? await window.StaffConfirm({
      title: turningOn ? tr('ws.onTitle') : tr('ws.offTitle'),
      body: turningOn ? fill('ws.onBody', { address: state.body.site.address.replace(/^https?:\/\//, '').replace(/\/$/, '') }) : tr('ws.offBody'),
      confirm: turningOn ? tr('ws.turnOn') : tr('ws.turnOff'), cancel: tr('ms.cancel'), danger: !turningOn,
    }) : true;
    if (ok) {
      try { sessionStorage.removeItem('thauma.mysite'); } catch (e) {}
      act({ action: 'enable', on: turningOn }, turningOn ? tr('ws.nowLive') : tr('ws.nowOff'));
    }
  });

  /* ---- tabs ------------------------------------------------------------ */

  document.querySelector('.ws-side').addEventListener('click', function (e) {
    var t = e.target.closest('[data-ws-tab]');
    if (!t) return;
    state.tab = t.getAttribute('data-ws-tab');
    [].forEach.call(document.querySelectorAll('[data-ws-tab]'), function (b) {
      if (b === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    [].forEach.call(document.querySelectorAll('[data-ws-panel]'), function (p) { p.hidden = p.getAttribute('data-ws-panel') !== state.tab; });
    fillPair(); draw();
  });

  function draw() {
    if (state.tab === 'pages') drawPages();
    if (state.tab === 'design') drawDesign();
    if (state.tab === 'links') drawLinks();
    if (state.tab === 'footer') drawFooter();
    if (state.tab === 'settings') drawSettings();
    /* The site beside whatever is being changed: the page being arranged, or
       Home for the look, the links and the footer. */
    var showFrame = (state.tab === 'pages' && !!state.page) || state.tab === 'design' || state.tab === 'links' || state.tab === 'footer';
    $('wsPreviewPane').hidden = !showFrame;
    $('wsRoot').classList.toggle('with-preview', showFrame);
    if (showFrame) refreshFrame();
    if (!canEdit()) {
      [].forEach.call($('wsRoot').querySelectorAll('.ws-panel input, .ws-panel textarea, .ws-panel select, .ws-panel button:not([data-ws-open]):not([data-ws-back])'), function (el) { el.disabled = true; });
    }
  }

  function refreshFrame() {
    if ($('wsPreviewPane').hidden) return;
    var s = state.body.site, lang = state.langA;
    var page = state.tab === 'pages' && state.page ? state.page : 'home';
    var path = s.preview.replace(/\?draft$/, '') + lang + '/' + (page === 'home' ? '' : page + '/');
    $('wsPreviewPath').textContent = '/' + lang + '/' + (page === 'home' ? '' : page + '/');
    /* On the Footer tab, the footer and nothing else (Chase, 2026-09-29). */
    var foot = state.tab === 'footer';
    $('wsPreviewPane').classList.toggle('only-foot', foot);
    $('wsFrame').src = path + '?draft' + (foot ? '&part=footer' : '') + '&t=' + Date.now();
  }

  /* ---- small pieces ---------------------------------------------------- */

  function chips(name, options, current, labelOf) {
    return '<div class="ws-chips" role="group">' + options.map(function (o) {
      return '<button type="button" class="ws-chip" data-chip="' + esc(name) + '" data-value="' + esc(o) + '" aria-pressed="' + (o === current) + '">' +
        esc(labelOf(o)) + '</button>';
    }).join('') + '</div>';
  }
  function sw(attr, on, label) {
    return '<button type="button" class="switch small" role="switch" ' + attr + ' aria-checked="' + (on ? 'true' : 'false') + '"' +
      (label ? ' aria-label="' + esc(label) + '"' : '') + '><span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
      '</span><span class="switch-knob"></span></span>' + (label ? '<span class="switch-label">' + esc(label) + '</span>' : '') + '</button>';
  }
  function row(label, control) {
    return '<div class="ws-row"><span class="ws-lbl">' + esc(label) + '</span><div class="ws-ctl">' + control + '</div></div>';
  }
  function ref(words) {
    var b = state.langB, v = b && words && words[b];
    return v ? '<small class="ms-ref" lang="' + esc(b) + '">' + esc(v) + '</small>' : '';
  }
  function pageLabel(p, lang) {
    return (p.label && p.label[lang]) || tr('ws.page.' + p.id);
  }
  /* Where something sends a visitor: nowhere, one of the site's pages, or an
     address typed out. `key` is what the change handler finds it by. A page
     that is switched off is still offered, marked, and the link simply does
     not show until the page does. */
  function linkPicker(key, value, allowNone) {
    var v = value || '', isUrl = v && v.indexOf('page:') !== 0;
    var opts = (allowNone ? '<option value="">' + esc(tr('ws.link.none')) + '</option>' : '') +
      '<optgroup label="' + esc(tr('ws.link.pages')) + '">' + state.doc.pages.map(function (p) {
        var name = pageLabel(p, state.langA);
        return '<option value="page:' + esc(p.id) + '"' + (v === 'page:' + p.id ? ' selected' : '') + '>' +
          esc(p.on ? name : fill('ws.link.hidden', { page: name })) + '</option>';
      }).join('') + '</optgroup>' +
      '<option value="url"' + (isUrl ? ' selected' : '') + '>' + esc(tr('ws.link.url')) + '</option>';
    return '<span class="ws-link"><select data-link="' + esc(key) + '">' + opts + '</select>' +
      (isUrl ? '<input type="url" data-link-url="' + esc(key) + '" value="' + esc(v === 'https://' ? '' : v) + '" placeholder="https://">' : '') + '</span>';
  }

  /* ---- Pages ----------------------------------------------------------- */

  function drawPages() {
    if (state.page) return drawSections();
    var pages = state.doc.pages;
    $('wsPages').innerHTML =
      '<div class="ws-head"><h2>' + esc(tr('ws.menuOrder')) + '</h2></div>' +
      '<ol class="ws-list">' + pages.map(function (p, i) {
        var n = p.sections.length;
        return '<li class="ws-page' + (p.on ? '' : ' is-off') + '" data-pi="' + i + '">' +
          '<span class="ws-move">' +
            '<button type="button" class="ws-icon" data-page-up="' + i + '" aria-label="' + esc(tr('ws.up')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="ws-icon" data-page-down="' + i + '" aria-label="' + esc(tr('ws.down')) + '"' + (i === pages.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '</span>' +
          '<span class="ws-pname">' + esc(tr('ws.page.' + p.id)) + '</span>' +
          '<label class="ws-plabel"><span class="sr-only">' + esc(tr('ws.inMenu')) + '</span>' + ref(p.label) +
            '<input type="text" maxlength="40" data-page-label="' + i + '" value="' + esc((p.label || {})[state.langA] || '') + '" placeholder="' + esc(tr('ws.page.' + p.id)) + '" lang="' + esc(state.langA) + '"></label>' +
          (p.id === 'home' ? '<span class="ws-always">' + esc(tr('ws.always')) + '</span>'
            : sw('data-page-on="' + i + '"', p.on, tr('ws.shown'))) +
          '<button type="button" class="ghost-btn" data-ws-open="' + esc(p.id) + '">' +
            esc(n ? (n === 1 ? tr('ws.sections1') : fill('ws.sectionsN', { n: n })) : tr('ws.empty')) + '</button>' +
        '</li>';
      }).join('') + '</ol>';
  }

  /* ---- one page's sections --------------------------------------------- */

  function currentPage() { return state.doc.pages.filter(function (p) { return p.id === state.page; })[0]; }

  function drawSections() {
    var p = currentPage();
    if (!p) { state.page = null; return drawPages(); }
    var html = '<div class="ws-head"><button type="button" class="link-btn" data-ws-back>← ' + esc(tr('ws.tab.pages')) + '</button>' +
      '<h2>' + esc(fill('ws.sectionsOf', { page: pageLabel(p, state.langA) })) + '</h2></div>';
    html += p.sections.length ? p.sections.map(sectionCard).join('') : '<p class="empty">' + esc(tr('ws.noSections')) + '</p>';
    html += '<button type="button" class="ws-addbtn" data-ws-add>+ ' + esc(tr('ws.addSection')) + '</button>';
    $('wsPages').innerHTML = html;
  }

  function sectionCard(s, i) {
    var spec = SECTIONS[s.type], p = currentPage(), last = p.sections.length - 1;
    var w = (s.words || {})[state.langA] || {};
    var html = '<article class="ws-sec" data-si="' + i + '">' +
      '<div class="ws-sec-head"><span class="ws-num">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<b class="ws-type">' + esc(tr('ws.sec.' + s.type)) + '</b>' +
        '<button type="button" class="ws-icon" data-sec-up="' + i + '" aria-label="' + esc(tr('ws.up')) + '"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="ws-icon" data-sec-down="' + i + '" aria-label="' + esc(tr('ws.down')) + '"' + (i === last ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="ws-icon del" data-sec-remove="' + i + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button>' +
      '</div>';
    if (spec.variants.length > 1) {
      html += '<div class="ws-sec-row"><span class="ws-small">' + esc(tr('ws.layout')) + '</span>' +
        chips('variant:' + i, spec.variants, s.variant, function (v) { return tr('ws.v.' + s.type + '.' + v); }) + '</div>';
    }
    if (spec.photo) {
      html += '<div class="ws-sec-row ws-photo"><span class="ws-small">' + esc(tr('ws.photo')) + '</span>' +
        (s.photo ? '<img src="' + esc(s.photo) + '" alt="">' : '<span class="ws-nophoto">' + esc(tr('ws.noPhoto')) + '</span>') +
        '<label class="ghost-btn sm ws-file">' + esc(s.photo ? tr('ws.changePhoto') : tr('ws.choosePhoto')) +
          '<input type="file" accept="image/*" data-sec-photo="' + i + '" hidden></label>' +
        (s.photo ? '<button type="button" class="link-btn" data-sec-unphoto="' + i + '">' + esc(tr('ws.removePhoto')) + '</button>' : '') +
        '<span class="hint" data-photo-status="' + i + '"></span></div>';
    }
    if (spec.buttons) {
      html += '<div class="ws-sec-row"><span class="ws-small">' + esc(tr('ws.buttons')) + '</span>' + ['give', 'stay', 'contact'].map(function (b) {
        var on = (s.buttons || []).indexOf(b) !== -1;
        return '<label class="chk"><input type="checkbox" data-sec-btn="' + i + ':' + b + '"' + (on ? ' checked' : '') + '><span>' + esc(tr('ws.btn.' + b)) + '</span></label>';
      }).join('') + '</div>';
    }
    if (spec.link) {
      html += '<div class="ws-sec-row"><span class="ws-small">' + esc(tr(spec.link === 'photo' ? 'ws.link.photo' : 'ws.link.button')) + '</span>' +
        linkPicker('sec:' + i, s.link, true) +
        (spec.link === 'both' && s.link && s.photo ? '<label class="chk"><input type="checkbox" data-sec-photolink="' + i + '"' + (s.photoLink ? ' checked' : '') + '><span>' + esc(tr('ws.link.photoToo')) + '</span></label>' : '') +
        '</div>';
    }
    if (!FLAT[s.type]) {
      html += '<div class="ws-sec-row"><span class="ws-small">' + esc(tr('ws.bg')) + '</span>' +
        chips('raised:' + i, ['plain', 'raised'], s.raised ? 'raised' : 'plain', function (v) { return tr('ws.bg.' + v); }) + '</div>';
    }
    /* A button's words only once there is a button (Give always has one). */
    var fields = spec.words.filter(function (f) { return f !== 'button' || !spec.link || s.link; });
    html += '<div class="ws-fields">' + fields.map(function (f) {
      var long = f === 'text' || f === 'quote';
      var src = {}; Object.keys(s.words || {}).forEach(function (l) { src[l] = (s.words[l] || {})[f]; });
      return '<label class="fld' + (long ? ' ws-wide' : '') + '"><span>' + esc(fieldName(s.type, f)) + '</span>' + ref(src) +
        (long ? '<textarea rows="' + (f === 'text' && !SECTIONS[s.type].data ? 4 : 2) + '" data-sec-word="' + i + ':' + f + '" lang="' + esc(state.langA) + '">' + esc(w[f] || '') + '</textarea>'
              : '<input type="text" data-sec-word="' + i + ':' + f + '" value="' + esc(w[f] || '') + '"' + (f === 'button' ? ' placeholder="' + esc(tr('ws.readMore')) + '"' : '') + ' lang="' + esc(state.langA) + '">') + '</label>';
    }).join('') + '</div>';
    if (spec.items) {
      /* Each link is a small card: its picture, its words, where it goes. */
      html += '<div class="ws-items">' + (s.items || []).map(function (it, j) {
        var t = (it.words || {})[state.langA] || {}, k = i + ':' + j;
        return '<div class="ws-card">' +
          '<div class="ws-card-pic">' + (it.photo ? '<img src="' + esc(it.photo) + '" alt="">' : '<span class="ws-nophoto">' + esc(tr('ws.noPhoto')) + '</span>') +
            '<label class="ghost-btn sm ws-file">' + esc(it.photo ? tr('ws.changePhoto') : tr('ws.choosePhoto')) +
            '<input type="file" accept="image/*" data-item-photo="' + k + '" hidden></label>' +
            (it.photo ? '<button type="button" class="link-btn" data-item-unphoto="' + k + '">' + esc(tr('ws.removePhoto')) + '</button>' : '') +
            '<span class="hint"></span></div>' +
          '<div class="ws-card-words">' +
            '<input type="text" placeholder="' + esc(tr('ws.itemTitle')) + '" data-item="' + k + ':title" value="' + esc(t.title || '') + '" lang="' + esc(state.langA) + '">' +
            '<input type="text" placeholder="' + esc(tr('ws.itemText')) + '" data-item="' + k + ':text" value="' + esc(t.text || '') + '" lang="' + esc(state.langA) + '">' +
            linkPicker('item:' + k, it.url || 'https://', false) + '</div>' +
          '<button type="button" class="ws-icon del" data-item-remove="' + k + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
      }).join('') + '<button type="button" class="link-btn" data-item-add="' + i + '">+ ' + esc(tr('ws.addLink')) + '</button></div>';
    }
    if (spec.data) {
      html += '<p class="ws-data">' + esc(tr('ws.data.' + s.type)) + ' <a href="/staff/' + spec.data + '">' + esc(tr('ws.editThere')) + ' →</a></p>';
    }
    if (s.type === 'give') html += '<p class="ws-data">' + esc(tr('ws.data.give')) + '</p>';
    return html + '</article>';
  }

  /* ---- adding a section ------------------------------------------------ */

  var SKETCH = {
    hero: [[0,0,100,100,'p'],[8,50,60,12,'t'],[8,70,18,10,'a'],[29,70,22,10,'o']],
    text: [[10,14,50,12,'t'],[10,36,80,6,'l'],[10,48,76,6,'l'],[10,60,82,6,'l'],[10,72,60,6,'l']],
    photoText: [[6,14,42,72,'p'],[54,22,36,10,'t'],[54,42,38,6,'l'],[54,54,34,6,'l'],[54,66,36,6,'l']],
    photo: [[0,18,100,64,'p']],
    quote: [[12,30,76,14,'t'],[20,50,60,14,'t'],[38,72,24,5,'l']],
    timeline: [[8,48,84,4,'l'],[8,48,30,4,'b'],[10,42,7,16,'b','50%'],[30,42,7,16,'a','50%'],[52,42,7,16,'o','50%'],[76,42,7,16,'o','50%']],
    goals: [[8,20,38,60,'l'],[54,20,38,60,'l'],[12,60,22,6,'a'],[58,60,12,6,'a']],
    prayer: [[8,16,84,18,'l'],[8,42,84,18,'l'],[8,68,84,18,'l']],
    videos: [[8,8,84,56,'p'],[45,28,10,16,'a','50%'],[8,72,24,18,'l'],[38,72,24,18,'l'],[68,72,24,18,'l']],
    newsletters: [[8,14,84,16,'l'],[8,38,84,16,'l'],[8,62,84,16,'l']],
    signup: [[6,28,88,44,'l'],[12,44,34,10,'t'],[66,42,22,14,'a']],
    contact: [[10,14,80,12,'l'],[10,34,80,12,'l'],[10,54,80,20,'l'],[10,80,20,10,'a']],
    give: [[10,20,60,12,'t'],[10,42,76,6,'l'],[10,54,70,6,'l'],[10,70,26,12,'a']],
    links: [[8,14,84,20,'l'],[8,40,84,20,'l'],[8,66,84,20,'l']],
  };
  function sketch(type) {
    return (SKETCH[type] || []).map(function (r) {
      return '<span class="sk sk-' + r[4] + '" style="left:' + r[0] + '%;top:' + r[1] + '%;width:' + r[2] + '%;height:' + r[3] + '%' +
        (r[5] ? ';border-radius:' + r[5] : '') + '"></span>';
    }).join('');
  }
  function openAdd() {
    var p = currentPage();
    $('wsAddTitle').innerHTML = esc(tr('ws.addTo')) + ' <b>' + esc(pageLabel(p, state.langA)) + '</b>';
    $('wsTiles').innerHTML = ORDER.map(function (t) {
      return '<button type="button" class="ws-tile" data-add-type="' + t + '"><span class="ws-sketch" aria-hidden="true">' + sketch(t) + '</span>' +
        '<b>' + esc(tr('ws.sec.' + t)) + '</b><span>' + esc(tr('ws.sec.' + t + '.what')) + '</span></button>';
    }).join('');
    $('wsAddBack').hidden = false; void $('wsAddBack').offsetHeight; $('wsAddBack').classList.add('in');
    var first = $('wsTiles').querySelector('button'); if (first) first.focus();
  }
  function closeAdd() { $('wsAddBack').classList.remove('in'); $('wsAddBack').hidden = true; }
  $('wsAddClose').addEventListener('click', closeAdd);
  $('wsAddBack').addEventListener('click', function (e) {
    if (e.target === this) return closeAdd();
    var t = e.target.closest('[data-add-type]');
    if (!t) return;
    var type = t.getAttribute('data-add-type'), spec = SECTIONS[type], words = {};
    state.doc.languages.forEach(function (l) { words[l] = {}; spec.words.forEach(function (f) { words[l][f] = ''; }); });
    var s = { id: uid(), type: type, variant: spec.variants[0], words: words };
    if (spec.photo) s.photo = null;
    if (spec.buttons) s.buttons = ['give', 'stay'];
    if (spec.items) s.items = [];
    currentPage().sections.push(s);
    closeAdd(); drawSections(); changed();
    var cards = $('wsPages').querySelectorAll('.ws-sec');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('wsAddBack').hidden) closeAdd(); });

  /* ---- Design ---------------------------------------------------------- */

  var LOOK_SAMPLE = {
    night: 'background:#0A0D12;color:#EDF2F8;font-family:Sora,system-ui', paper: 'background:#F6F2EA;color:#1A1C22;font-family:Georgia,serif',
    bold: 'color:#041D24;font-family:system-ui;font-weight:800',
  };
  function drawDesign() {
    var d = state.doc.design, th = state.body.theme || { accent: '#1AE4FF', accent2: '#25FFA1' };
    var col = d.colors || (d.colors = { background: null, accent: null });
    var acc = col.accent || th.accent;
    var name = state.body.partner.display_name;
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.look')) + '</h2></div><div class="ws-looks">' + LOOKS.map(function (l) {
      /* Each card wears the owner's colors, so the choice is seen as it will be. */
      var bg = l === 'bold' ? 'background:' + acc + ';' : '';
      var btn = 'background:' + (l === 'bold' ? '#041D24' : acc) + ';color:' + (l === 'bold' ? acc : '#06110c');
      var own = col.background && l !== 'bold' ? ';background:' + col.background + ';color:' + (dark(col.background) ? '#F2F3F5' : '#15171C') : '';
      return '<button type="button" class="ws-look" data-chip="look" data-value="' + l + '" aria-pressed="' + (d.look === l) + '">' +
        '<span class="ws-look-sample" style="' + bg + LOOK_SAMPLE[l] + own + '"><span class="ws-look-name">' + esc(name) + '</span>' +
        '<span class="ws-look-btn" style="' + btn + '">' + esc(tr('ws.btn.give')) + '</span></span>' +
        '<span class="ws-look-cap"><b>' + esc(tr('ws.look.' + l)) + '</b><span>' + esc(tr('ws.look.' + l + '.what')) + '</span></span></button>';
    }).join('') + '</div>';
    html += '<div class="ws-rows">' +
      /* THE OWNER'S COLORS (Chase, 2026-09-29). A picker each, showing what
         is in use now; Reset goes back to the look's background, or the
         ministry's accent from Sharing. The rest follows on the site. */
      row(tr('ws.bgColor'), colorPick('background', col.background, LOOK_BG[d.look] || '#0A0D12')) +
      row(tr('ws.accentColor'), colorPick('accent', col.accent, th.accent)) +
      row(tr('ws.menu'), chips('menu', ['top', 'center', 'button'], d.menu, function (v) { return tr('ws.menu.' + v); })) +
      row(tr('ws.brand'), chips('brand', ['name', 'logo'], d.brand, function (v) { return v === 'name' ? name : tr('ws.brand.logo'); }) +
        (d.brand === 'logo' ? (d.logo ? '<img class="ws-logo" src="' + esc(d.logo) + '" alt="">' : '') +
          '<label class="ghost-btn sm ws-file">' + esc(d.logo ? tr('ws.changePhoto') : tr('ws.chooseLogo')) + '<input type="file" accept="image/*" data-logo hidden></label>' : '')) +
      '</div><div class="ws-head"><h2>' + esc(tr('ws.motion')) + '</h2></div><div class="ws-rows">' +
      Object.keys(MOTION).map(function (k) {
        return row(tr('ws.m.' + k), chips('motion:' + k, MOTION[k], d.motion[k], function (v) { return tr('ws.m.' + k + '.' + v); }));
      }).join('') + '</div>';
    $('wsDesign').innerHTML = html;
  }

  function dark(hex) {
    var n = [1, 3, 5].map(function (i) { var v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] < 0.25;
  }
  function colorPick(which, chosen, fallback) {
    return '<label class="ws-color"><input type="color" data-color="' + which + '" value="' + esc((chosen || fallback).toLowerCase()) + '">' +
      '<span>' + esc(chosen ? chosen.toUpperCase() : tr(which === 'accent' ? 'ws.colorMinistry' : 'ws.colorLook')) + '</span></label>' +
      (chosen ? '<button type="button" class="link-btn" data-color-reset="' + which + '">' + esc(tr('ws.colorReset')) + '</button>' : '');
  }

  /* ---- Links ----------------------------------------------------------- */

  function drawLinks() {
    var links = state.doc.links;
    var social = function (k) { return links.filter(function (x) { return x.kind === k; })[0]; };
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.socials')) + '</h2></div><div class="ws-rows">' + SOCIALS.map(function (k) {
      var l = social(k);
      return row(SOCIAL_NAME[k], '<input type="' + (k === 'email' ? 'email' : 'url') + '" data-social="' + k + '" value="' + esc(l ? l.url.replace(/^mailto:/, '') : '') + '" placeholder="' +
        esc(k === 'email' ? 'you@example.org' : 'https://') + '">');
    }).join('') + row(tr('ws.atTop'), sw('data-header-links', state.doc.design.headerLinks, '')) + '</div>';
    var custom = links.map(function (l, i) { return { l: l, i: i }; }).filter(function (x) { return x.l.kind === 'custom'; });
    html += '<div class="ws-head"><h2>' + esc(tr('ws.custom')) + '</h2></div><div class="ws-customs">' + custom.map(function (x) {
      return '<div class="ws-item">' + ref(x.l.label) +
        '<input type="text" maxlength="40" placeholder="' + esc(tr('ws.linkName')) + '" data-custom-label="' + x.i + '" value="' + esc((x.l.label || {})[state.langA] || '') + '" lang="' + esc(state.langA) + '">' +
        linkPicker('custom:' + x.i, x.l.url || 'https://', false) +
        '<button type="button" class="ws-icon del" data-custom-remove="' + x.i + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
    }).join('') + '<button type="button" class="link-btn" data-custom-add>+ ' + esc(tr('ws.addLink')) + '</button></div>';
    $('wsLinks').innerHTML = html;
  }

  /* ---- Footer ---------------------------------------------------------- */

  /* Each layout drawn small, so the choice is seen rather than described. */
  var FOOT_SKETCH = {
    split: [[6,30,26,12,'t'],[6,52,34,7,'l'],[70,30,24,12,'o'],[62,56,32,7,'l']],
    center: [[26,18,48,8,'l'],[40,38,20,10,'o'],[22,58,56,8,'t'],[30,76,40,6,'l']],
    columns: [[5,24,22,12,'t'],[34,24,16,6,'l'],[34,38,14,6,'l'],[56,24,16,6,'l'],[56,38,14,6,'l'],[78,24,16,12,'o'],[5,74,90,5,'l']],
  };
  function drawFooter() {
    var f = state.doc.footer || (state.doc.footer = { layout: 'split', menu: false, socials: 'icons', words: {} });
    var w = (f.words || {})[state.langA] || {};
    var src = function (k) { var o = {}; Object.keys(f.words || {}).forEach(function (l) { o[l] = (f.words[l] || {})[k]; }); return o; };
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.footer.layout')) + '</h2></div><div class="ws-looks ws-foots">' + FOOTERS.map(function (k) {
      return '<button type="button" class="ws-look" data-chip="footer:layout" data-value="' + k + '" aria-pressed="' + (f.layout === k) + '">' +
        '<span class="ws-sketch ws-foot-sketch" aria-hidden="true">' + (FOOT_SKETCH[k] || []).map(function (r) {
          return '<span class="sk sk-' + r[4] + '" style="left:' + r[0] + '%;top:' + r[1] + '%;width:' + r[2] + '%;height:' + r[3] + '%"></span>';
        }).join('') + '</span>' +
        '<span class="ws-look-cap"><b>' + esc(tr('ws.footer.' + k)) + '</b><span>' + esc(tr('ws.footer.' + k + '.what')) + '</span></span></button>';
    }).join('') + '</div>';
    html += '<div class="ws-rows">' +
      row(tr('ws.footer.menu'), sw('data-footer-menu', f.menu, '')) +
      row(tr('ws.footer.socials'), chips('footer:socials', ['icons', 'words'], f.socials, function (v) { return tr('ws.footer.socials.' + v); })) +
      '</div><div class="ws-fields">' +
      '<label class="fld ws-wide"><span>' + esc(tr('ws.footer.tagline')) + '</span>' + ref(src('tagline')) +
        '<input type="text" maxlength="120" data-footer-word="tagline" value="' + esc(w.tagline || '') + '" lang="' + esc(state.langA) + '"></label>' +
      '<label class="fld ws-wide"><span>' + esc(tr('ws.footer.small')) + '</span>' + ref(src('small')) +
        '<textarea rows="2" maxlength="400" data-footer-word="small" lang="' + esc(state.langA) + '">' + esc(w.small || '') + '</textarea></label>' +
      '</div>';
    $('wsFooter').innerHTML = html;
  }

  /* ---- Settings -------------------------------------------------------- */

  function drawSettings() {
    var b = state.body, d = state.doc;
    var sub = b.site.subdomain;
    var who = '<div class="ws-people"><div class="ws-person"><b>' + esc((b.owner && b.owner.name) || b.partner.display_name) + '</b> <span class="ws-small">· ' + esc(tr('ws.owner')) + '</span></div>' +
      (b.editors || []).map(function (e) {
        return '<div class="ws-person"><b>' + esc(e.name) + '</b> <span class="ws-small">· ' + esc(tr('ws.canEdit')) + '</span>' +
          (b.can.owner ? '<button type="button" class="link-btn" data-revoke="' + esc(e.user_id) + '">' + esc(tr('ws.remove')) + '</button>' : '') + '</div>';
      }).join('') +
      (b.requests || []).map(function (r) {
        return '<div class="ws-person is-asking"><span><b>' + esc(r.name) + '</b> ' + esc(tr('ws.asksToEdit')) +
          (r.note ? '<br><span class="ws-small">“' + esc(r.note) + '”</span>' : '') + '</span>' +
          '<button type="button" class="ghost-btn sm" data-decline="' + esc(r.user_id) + '">' + esc(tr('ws.decline')) + '</button>' +
          '<button type="button" class="solid-btn sm" data-grant="' + esc(r.user_id) + '">' + esc(tr('ws.allow')) + '</button></div>';
      }).join('') + '</div>';
    var html = '<div class="ws-rows">' +
      row(tr('ws.address'), '<span class="ws-addr"><b>' + esc(sub) + '</b>.thauma.one</span><span class="ws-small">' + esc(tr('ws.addressWho')) + '</span>') +
      row(tr('ws.languages'), '<span class="ws-langs">' + b.languages.map(function (l) {
        var on = d.languages.indexOf(l.code) !== -1;
        return '<label class="chk"><input type="checkbox" data-site-lang="' + esc(l.code) + '"' + (on ? ' checked' : '') +
          (on && d.languages.length === 1 ? ' disabled' : '') + '><span>' + esc(l.native_name || l.name) + '</span></label>';
      }).join('') + '</span>') +
      row(tr('ws.fallback'), '<select data-fallback>' + d.languages.map(function (l) {
        return '<option value="' + esc(l) + '"' + (l === d.fallback ? ' selected' : '') + '>' + esc(langName(l)) + '</option>';
      }).join('') + '</select>') +
      row(tr('ws.giveLink'), '<input type="url" data-give value="' + esc(d.give || '') + '" placeholder="https://">') +
      row(tr('ws.whoEdits'), who) +
      '</div><div class="ws-head"><h2>' + esc(tr('ws.startAgain')) + '</h2></div><div class="ws-starts">' +
      ['full', 'basic', 'blank'].map(function (k) {
        return '<button type="button" class="ws-start" data-start="' + k + '"><b>' + esc(tr('ws.start.' + k)) + '</b><span>' + esc(tr('ws.start.' + k + '.what')) + '</span></button>';
      }).join('') + '</div>';
    $('wsSettings').innerHTML = html;
  }

  /* ---- every change ---------------------------------------------------- */

  function words(obj, lang) { obj.words = obj.words || {}; obj.words[lang] = obj.words[lang] || {}; return obj.words[lang]; }
  function move(list, i, by) { var j = i + by; if (j < 0 || j >= list.length) return; var x = list[i]; list[i] = list[j]; list[j] = x; }

  $('wsRoot').addEventListener('input', function (e) {
    var t = e.target, p = currentPage(), v = t.value;
    if (t.dataset.pageLabel !== undefined) { var pg = state.doc.pages[+t.dataset.pageLabel]; pg.label = pg.label || {}; pg.label[state.langA] = v; return changed(); }
    if (t.dataset.secWord) { var a = t.dataset.secWord.split(':'); words(p.sections[+a[0]], state.langA)[a[1]] = v; return changed(); }
    if (t.dataset.item) { var b = t.dataset.item.split(':'); words(p.sections[+b[0]].items[+b[1]], state.langA)[b[2]] = v; return changed(); }
    if (t.dataset.linkUrl) { setLink(t.dataset.linkUrl, v.trim() || 'https://'); return changed(); }
    if (t.dataset.color) {
      state.doc.design.colors = state.doc.design.colors || {};
      state.doc.design.colors[t.dataset.color] = t.value.toUpperCase();
      var lbl = t.parentNode.querySelector('span'); if (lbl) lbl.textContent = t.value.toUpperCase();
      return changed();
    }
    if (t.dataset.footerWord) { var fw = state.doc.footer.words; fw[state.langA] = fw[state.langA] || {}; fw[state.langA][t.dataset.footerWord] = v; return changed(); }
    if (t.dataset.social) {
      var k = t.dataset.social, list = state.doc.links, at = list.findIndex(function (x) { return x.kind === k; });
      var url = v.trim(); if (k === 'email' && url && !/^mailto:/.test(url)) url = 'mailto:' + url;
      if (!url) { if (at !== -1) list.splice(at, 1); } else if (at === -1) list.push({ kind: k, url: url, label: {} }); else list[at].url = url;
      return changed();
    }
    if (t.dataset.customLabel !== undefined) { var cl = state.doc.links[+t.dataset.customLabel]; cl.label = cl.label || {}; cl.label[state.langA] = v; return changed(); }
    if (t.dataset.give !== undefined) { state.doc.give = v.trim(); return changed(); }
  });

  /* "sec:<i>" is a section's link; "item:<i>:<j>" is one card's. */
  function setLink(key, value) {
    var a = key.split(':');
    if (a[0] === 'custom') { state.doc.links[+a[1]].url = value; return; }
    var s = currentPage().sections[+a[1]];
    if (a[0] === 'sec') s.link = value; else s.items[+a[2]].url = value;
  }

  $('wsRoot').addEventListener('change', async function (e) {
    var t = e.target, p = currentPage();
    /* A color settled on: the look cards redraw in it (not while dragging,
       which would close the picker under the pointer). */
    if (t.dataset.color) { drawDesign(); return; }
    if (t.dataset.link) {
      /* "Another address" opens a box for it, empty and waiting. */
      setLink(t.dataset.link, t.value === 'url' ? 'https://' : t.value);
      if (state.tab === 'links') drawLinks(); else drawSections();
      changed();
      var box = $('wsRoot').querySelector('[data-link-url="' + t.dataset.link + '"]');
      if (box) box.focus();
      return;
    }
    if (t.dataset.secPhotolink) { p.sections[+t.dataset.secPhotolink].photoLink = t.checked; return changed(); }
    if (t.dataset.itemPhoto) { var ip = t.dataset.itemPhoto.split(':'); return upload(t, function (url) { p.sections[+ip[0]].items[+ip[1]].photo = url; drawSections(); }); }
    if (t.dataset.secBtn) {
      var a = t.dataset.secBtn.split(':'), s = p.sections[+a[0]];
      s.buttons = (s.buttons || []).filter(function (x) { return x !== a[1]; });
      if (t.checked) s.buttons.push(a[1]);
      return changed();
    }
    if (t.dataset.siteLang) {
      var code = t.dataset.siteLang, langs = state.doc.languages;
      if (t.checked && langs.indexOf(code) === -1) langs.push(code);
      if (!t.checked) state.doc.languages = langs.filter(function (l) { return l !== code; });
      if (state.doc.languages.indexOf(state.doc.fallback) === -1) state.doc.fallback = state.doc.languages[0];
      fillPair(); drawSettings(); return changed();
    }
    if (t.dataset.fallback !== undefined) { state.doc.fallback = t.value; return changed(); }
    if (t.dataset.secPhoto) return upload(t, function (url) { p.sections[+t.dataset.secPhoto].photo = url; drawSections(); });
    if (t.dataset.logo !== undefined) return upload(t, function (url) { state.doc.design.logo = url; drawDesign(); });
  });

  $('wsRoot').addEventListener('click', async function (e) {
    var t = e.target.closest('button');
    if (!t || t.disabled) return;
    var p = currentPage(), d = t.dataset;
    if (d.wsOpen) { state.page = d.wsOpen; draw(); window.scrollTo(0, 0); return; }
    if (d.wsBack !== undefined) { state.page = null; draw(); return; }
    if (d.wsAdd !== undefined) return openAdd();
    if (d.pageUp) { move(state.doc.pages, +d.pageUp, -1); drawPages(); return changed(); }
    if (d.pageDown) { move(state.doc.pages, +d.pageDown, 1); drawPages(); return changed(); }
    if (d.pageOn) { var pg = state.doc.pages[+d.pageOn]; pg.on = !pg.on; drawPages(); return changed(); }
    if (d.secUp) { move(p.sections, +d.secUp, -1); drawSections(); return changed(); }
    if (d.secDown) { move(p.sections, +d.secDown, 1); drawSections(); return changed(); }
    if (d.secRemove) {
      var s = p.sections[+d.secRemove];
      var ok = window.StaffConfirm ? await window.StaffConfirm({ title: fill('ws.removeTitle', { kind: tr('ws.sec.' + s.type) }), confirm: tr('ws.remove'), cancel: tr('ms.cancel'), danger: true }) : true;
      if (ok) { p.sections.splice(+d.secRemove, 1); drawSections(); changed(); }
      return;
    }
    if (d.secUnphoto) { p.sections[+d.secUnphoto].photo = null; drawSections(); return changed(); }
    if (d.itemAdd) { var sec = p.sections[+d.itemAdd]; sec.items = sec.items || []; sec.items.push({ url: 'https://', photo: null, words: {} }); drawSections(); return; }
    if (d.itemUnphoto) { var up = d.itemUnphoto.split(':'); p.sections[+up[0]].items[+up[1]].photo = null; drawSections(); return changed(); }
    if (d.colorReset) { state.doc.design.colors[d.colorReset] = null; drawDesign(); return changed(); }
    if (d.footerMenu !== undefined) { state.doc.footer.menu = !state.doc.footer.menu; drawFooter(); return changed(); }
    if (d.itemRemove) { var r = d.itemRemove.split(':'); p.sections[+r[0]].items.splice(+r[1], 1); drawSections(); return changed(); }
    if (d.customAdd !== undefined) { state.doc.links.push({ kind: 'custom', url: 'https://', label: {} }); drawLinks(); return; }
    if (d.customRemove) { state.doc.links.splice(+d.customRemove, 1); drawLinks(); return changed(); }
    if (d.headerLinks !== undefined) { state.doc.design.headerLinks = !state.doc.design.headerLinks; drawLinks(); return changed(); }
    if (d.chip) {
      var val = d.value, name = d.chip;
      if (name.indexOf('variant:') === 0) { p.sections[+name.slice(8)].variant = val; drawSections(); }
      else if (name.indexOf('raised:') === 0) { p.sections[+name.slice(7)].raised = val === 'raised'; drawSections(); }
      else if (name.indexOf('footer:') === 0) { state.doc.footer[name.slice(7)] = val; drawFooter(); }
      else if (name.indexOf('motion:') === 0) { state.doc.design.motion[name.slice(7)] = val; drawDesign(); }
      else if (name === 'look' || name === 'menu' || name === 'brand') { state.doc.design[name] = val; drawDesign(); }
      return changed();
    }
    if (d.start) {
      var ok2 = window.StaffConfirm ? await window.StaffConfirm({ title: fill('ws.startTitle', { kind: tr('ws.start.' + d.start) }),
        body: tr('ws.startBody'), confirm: tr('ws.startGo'), cancel: tr('ms.cancel'), danger: true }) : true;
      if (ok2) { state.page = null; act({ action: 'start', kind: d.start }, tr('ws.started')); }
      return;
    }
    if (d.grant) return act({ action: 'grant', user_id: d.grant }, tr('ws.allowed'));
    if (d.decline) return act({ action: 'decline', user_id: d.decline });
    if (d.revoke) return act({ action: 'revoke', user_id: d.revoke });
  });

  /* A picture: made smaller and WebP in the browser, then stored with the
     ministry's other pictures. */
  async function upload(input, done) {
    var file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    var status = input.closest('.ws-sec-row, .ws-ctl, .ws-card-pic');
    var note = status && status.querySelector('.hint');
    if (note) note.textContent = tr('ws.uploading');
    try {
      var bitmap = await createImageBitmap(file);
      var scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      var c = document.createElement('canvas');
      c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
      c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
      var blob = await new Promise(function (r) { c.toBlob(r, 'image/webp', 0.84); });
      var res = await fetch('/api/admin/media?kind=partnersite', { method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'image/webp' }, body: blob });
      var body = await res.json();
      if (!res.ok) throw new Error(body.error || tr('common.saveFailed'));
      done(body.url);
      changed();
    } catch (err) {
      if (note) note.textContent = '';
      toast(err.message, 'err');
    }
  }

  load();
})();
