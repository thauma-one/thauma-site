/* ============================================================
   admin-site.js — site.json, as a form
   ============================================================
   Same endpoint and same save model as the content editor: a
   working copy, one Save, one commit. Different rendering,
   because these are settings rather than sentences.

   THE FORM IS DERIVED FROM THE FILE. There is no list of fields
   in this script. It walks site.json, and the type of each
   value decides the control — boolean gets the switch, number
   gets a number box, string gets a text box. A key added to
   site.json therefore appears here without anyone remembering
   to come and add it, and a key removed stops appearing rather
   than throwing.

   comingSoon IS NOT AN ORDINARY SWITCH. It is the gate over the
   entire public site: with it on, every page is the holding
   page. Turning it OFF is the launch, and it is the one control
   here that says so and asks first.
   ============================================================ */
(function () {
  'use strict';

  if (document.body.getAttribute('data-admin-page') !== 'site') return;

  var API = '/api/admin/content';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    sha: null, saved: {}, draft: {}, order: [],
    frozen: [], langs: [], branch: '', repo: ''
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  /* Translate and substitute together — see StaffI18n.fill. Every value named
     in one place, so a missing one is visible rather than invisible. */
  function fill(key, vars) {
    return window.StaffI18n && window.StaffI18n.fill
      ? window.StaffI18n.fill(key, vars) : tr(key);
  }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  function isLeaf(v) { return v === null || typeof v !== 'object'; }

  function leaves(obj, prefix, out) {
    out = out || {}; prefix = prefix || '';
    if (isLeaf(obj)) { out[prefix] = obj; return out; }
    var keys = Array.isArray(obj)
      ? obj.map(function (_, i) { return String(i); })
      : Object.keys(obj);
    keys.forEach(function (k) { leaves(obj[k], prefix ? prefix + '.' + k : k, out); });
    return out;
  }

  function isFrozen(p) {
    return state.frozen.some(function (f) { return p === f || p.indexOf(f + '.') === 0; });
  }

  function dirtyPaths() {
    return state.order.filter(function (p) {
      return !isFrozen(p) && state.draft[p] !== state.saved[p];
    });
  }

  /* Sentences for the settings that decide something big. A switch labelled
     `comingSoon` tells you its name; it does not tell you that it is the
     difference between a holding page and a website. */
  var EXPLAIN = {
    defaultLang: 'con.f.defaultLang',
    languages: 'con.f.languages',
    url: 'con.f.url'
  };

  /* A whole GROUP can carry an explanation, not just a field. `donorbox` is
     four blank boxes labelled en / hr / sr with nothing saying what belongs in
     them — which is how a setting ends up permanently empty. */
  var GROUP_EXPLAIN = {
    donorbox: 'con.g.donorbox',
    socials: 'con.g.socials'
  };

  /* ---- loading -------------------------------------------------------- */

  async function get() {
    var res, body;
    try {
      res = await fetch(API + '?file=site', { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, boot);
      return null;
    }
    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', boot);
      return null;
    }
    if (res.status === 403) {
      if ($('notAdmin')) $('notAdmin').hidden = false;
      $('sRoot').hidden = true; $('sNote').hidden = true;
      if (window.StaffProblemClear) window.StaffProblemClear();
      return null;
    }
    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401 ? tr('err.expired')
            : tr('err.refused') + ' (' + res.status + ')' + (body.error ? ' — ' + body.error : ''),
          res.status === 401 ? null : boot);
      }
      return null;
    }
    if (window.StaffProblemClear) window.StaffProblemClear();
    return body;
  }

  async function boot() {
    var body = await get();
    if (!body) return;
    if (body.configured === false) {
      var el = $('sNotConfigured');
      el.innerHTML = '<b>' + esc(tr('con.notConnected')) + '</b> ' +
                     esc(body.reason || body.error || '');
      el.hidden = false;
      $('sRoot').hidden = true; $('sNote').hidden = true;
      return;
    }

    state.sha = body.sha;
    state.frozen = body.frozen || [];
    state.branch = body.branch;
    state.repo = body.repo;
    state.langs = (body.data && body.data.languages) || [];
    state.saved = leaves(body.data);
    state.draft = JSON.parse(JSON.stringify(state.saved));
    state.order = Object.keys(state.saved);

    $('sRoot').hidden = false;
    render();
    renderSaveBar();
  }

  /* ---- rendering ------------------------------------------------------ */

  function groupOf(p) {
    return p.indexOf('.') === -1 ? '_general' : p.split('.')[0];
  }
  function groupLabel(g) {
    if (g === '_general') return tr('con.general');
    return g.replace(/([A-Z_])/g, ' $1').replace(/_/g, '')
            .replace(/^./, function (c) { return c.toUpperCase(); }).trim();
  }

  /* `resourcesLibrary` -> "Resources library". The ids are the words already,
     just packed together. Not translated, for the same reason the content
     editor does not translate its section names: they identify a page or a
     block, and they are things you match against the site rather than read. */
  /* The endonym, from the browser, rather than a table to maintain. A person
     picking languages recognises "Srpski" faster than "sr".
     
     The content editor prefers each file's own `name` row where it has one
     loaded; this page does not read those files, so Intl is the best available
     and gives the same answer for every language the site has today. */
  function langName(code) {
    try {
      var dn = new Intl.DisplayNames([code], { type: 'language' });
      var n = dn.of(code);
      if (n && n !== code) {
        return n.charAt(0).toUpperCase() + n.slice(1) + ' (' + code + ')';
      }
    } catch (e) { /* older browser, or a code Intl does not know */ }
    return code;
  }

  function humanise(id) {
    return id.replace(/([A-Z])/g, ' $1').toLowerCase()
             .replace(/^./, function (c) { return c.toUpperCase(); }).trim();
  }

  var isVisibility = function (p) { return p.indexOf('visibility.') === 0; };

  var isImage = function (p) { return p.indexOf('images.') === 0; };

  /* ---- images ---------------------------------------------------------
     Four fields per picture — src, focal_x, focal_y, zoom — rendered as
     sixteen consecutive rows called things like `about_posture.focal_y`.
     Technically complete and unusable: nothing on screen says these four
     belong together, and nothing says what a focal point is.

     One card per image, human labels, and a sentence explaining the idea
     once rather than implying it four times. */

  var IMAGE_FIELD = {
    src:     'set.img.file',
    focal_x: 'set.img.focalX',
    focal_y: 'set.img.focalY',
    zoom:    'set.img.zoom'
  };

  /* `home_who` -> "Home · who". Mechanical on purpose: inventing "Who we are"
     would be guessing at what the section renders, and a confidently wrong
     label is worse than a plain one. */
  function imageLabel(id) {
    return id.split('_').map(function (w, i) {
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' \u00b7 ');
  }

  function renderImages() {
    var ids = [];
    state.order.forEach(function (p) {
      if (!isImage(p)) return;
      var id = p.split('.')[1];
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    if (!ids.length) return '';

    return '<section class="s-group">' +
      '<h3>' + esc(tr('set.img.title')) + '</h3>' +
      '<p class="v-note">' + esc(tr('set.img.explain')) + '</p>' +
      ids.map(function (id) {
        var src = state.draft['images.' + id + '.src'] || '';
        return '<div class="s-img">' +
          '<div class="s-img-head">' +
            '<b>' + esc(imageLabel(id)) + '</b>' +
            '<code>' + esc(src) + '</code>' +
          '</div>' +
          '<div class="s-img-fields">' +
            ['src', 'focal_x', 'focal_y', 'zoom'].map(function (f) {
              var path = 'images.' + id + '.' + f;
              if (state.draft[path] === undefined) return '';
              return imgField(path, tr(IMAGE_FIELD[f] || f));
            }).join('') +
          '</div>' +
        '</div>';
      }).join('') +
    '</section>';
  }

  function imgField(path, label) {
    var v = state.draft[path];
    var dirty = state.draft[path] !== state.saved[path];
    var isNum = typeof v === 'number';
    return '<label class="s-imgf' + (dirty ? ' is-dirty' : '') +
             '" data-field="' + esc(path) + '">' +
      '<span>' + esc(label) + '</span>' +
      '<input type="' + (isNum ? 'number' : 'text') + '" data-path="' + esc(path) + '"' +
        (isNum ? ' min="0" max="300"' : '') +
        ' value="' + esc(v) + '">' +
    '</label>';
  }

  /* A FROZEN LIST IS ONE FACT, NOT FOUR.

     `languages` is an array, and rendering it a leaf at a time gave four rows
     labelled 0, 1, 2, 3 — each with its own disabled box holding two letters,
     filling half a screen to say something a single line says better. It is
     also the one setting on this page nobody can edit here, so it had the most
     space and the least purpose.

     Collapsed to a single row, with a note pointing at the buttons that DO
     change it. */
  function isFrozenList(p) {
    return state.frozen.some(function (f) { return p.indexOf(f + '.') === 0; });
  }

  function frozenListRow(name) {
    var values = state.order
      .filter(function (p) { return p.indexOf(name + '.') === 0; })
      .map(function (p) { return state.draft[p]; });
    if (!values.length) return '';
    return '<div class="s-field is-frozen">' +
      '<div class="s-label"><code>' + esc(name) + '</code>' +
        '<span class="s-hint">' + esc(tr('con.f.languages')) + '</span></div>' +
      '<div class="s-control"><span class="s-frozen">' +
        esc(values.join(' · ')) + '</span></div>' +
    '</div>';
  }

  function render() {
    var groups = [];
    var seen = {};
    state.order.forEach(function (p) {
      // Visibility and images each get their own block below.
      if (isVisibility(p) || isImage(p) || isFrozenList(p)) return;
      var g = groupOf(p);
      if (!seen[g]) { seen[g] = true; groups.push(g); }
    });

    $('sRoot').innerHTML =
      renderVisibility() +
      groups.map(function (g) {
        var rows = state.order.filter(function (p) {
          return !isVisibility(p) && !isImage(p) && !isFrozenList(p) && groupOf(p) === g;
        });
        return '<section class="s-group">' +
          '<h3>' + esc(groupLabel(g)) + '</h3>' +
          (GROUP_EXPLAIN[g] ? '<p class="v-note">' + esc(tr(GROUP_EXPLAIN[g])) + '</p>' : '') +
          rows.map(field).join('') +
          (g === '_general' ? frozenListRow('languages') : '') +
          '</section>';
      }).join('') +
      renderImages();
  }

  /* ---- the two columns ------------------------------------------------
     Every switch here exists twice: once for the dev site and once for the
     live one. Rendering them as sixteen separate rows called
     "visibility.pages.events.dev" would be technically the same information
     and useless — the whole point is that you can see, on one line, that
     Events is on for you and off for visitors.

     DEV IS A SIMULATOR, NOT A SECOND SITE. It defaults to showing everything,
     because that is what a dev site is for. Turning one off there answers
     "what does this look like without it?" without touching the public. */

  function switchCell(path, extraClass) {
    var v = state.draft[path];
    var dirty = state.draft[path] !== state.saved[path];
    return '<span class="v-cell ' + (extraClass || '') + (dirty ? ' is-dirty' : '') +
             '" data-field="' + esc(path) + '">' +
      '<button type="button" class="switch small" role="switch" data-path="' + esc(path) + '"' +
      ' aria-checked="' + (v ? 'true' : 'false') + '"' + (v ? ' data-on="1"' : '') + '>' +
        '<span class="switch-track"><span class="switch-state">' +
          (v ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
      '</button></span>';
  }

  function visRow(label, base, hint, removableCode) {
    return '<div class="v-row' + (removableCode ? ' has-remove' : '') + '">' +
      '<div class="v-label"><code>' + esc(label) + '</code>' +
        (hint ? '<span class="s-hint">' + esc(hint) + '</span>' : '') + '</div>' +
      switchCell(base + '.dev', 'is-dev') +
      switchCell(base + '.live', 'is-live') +
      /* Only languages can be removed. A page or a section is part of the
         site's structure and switching it off is the whole answer; a language
         is a FILE, and leaving a dead one around is how the list and the
         folder drift apart. */
      (removableCode
        ? '<button type="button" class="del danger" data-del-lang="' + esc(removableCode) +
          '" title="' + esc(tr('vis.removeLang')) + '">' + esc(tr('vis.remove')) + '</button>'
        : '<span></span>') +
    '</div>';
  }

  function renderVisibility() {
    // Derived from whatever is in the file, so adding a page to site.json puts
    // a row here without anyone remembering to come and add one.
    var pages = [], sections = [], langs = [], hasComingSoon = false;
    state.order.forEach(function (p) {
      if (!isVisibility(p)) return;
      var parts = p.split('.');          // visibility.pages.events.dev
      if (parts[1] === 'comingSoon') { hasComingSoon = true; return; }
      if (parts.length !== 4) return;
      var bucket = parts[1] === 'pages' ? pages
                 : parts[1] === 'sections' ? sections
                 : parts[1] === 'languages' ? langs : null;
      if (!bucket) return;
      if (bucket.indexOf(parts[2]) === -1) bucket.push(parts[2]);
    });

    if (!pages.length && !sections.length && !langs.length && !hasComingSoon) return '';

    var head =
      '<div class="v-head">' +
        '<div class="v-label"></div>' +
        '<span class="v-cell is-dev"><b>' + esc(tr('vis.devCol')) + '</b>' +
          '<span>' + esc(tr('vis.devColNote')) + '</span></span>' +
        '<span class="v-cell is-live"><b>' + esc(tr('vis.liveCol')) + '</b>' +
          '<span>' + esc(tr('vis.liveColNote')) + '</span></span>' +
      '</div>';

    var body = '';
    if (hasComingSoon) {
      body += '<div class="v-sub">' + esc(tr('vis.wholeSite')) + '</div>' +
        visRow(tr('vis.comingSoon'), 'visibility.comingSoon', tr('con.f.comingSoon'));
    }
    if (langs.length) {
      /* A language switched off produces no pages at all — not hidden ones.
         So this is the control that decides whether /sr/ exists, and the dev
         column is what lets somebody translate and see it in place for a
         fortnight before any visitor can reach it. */
      body += '<div class="v-sub">' + esc(tr('vis.languages')) + '</div>' +
        langs.map(function (code) {
          return visRow(langName(code), 'visibility.languages.' + code, '', code);
        }).join('') +
        /* English is deliberately absent above and named here instead. It is
           the fallback every missing translation resolves to; a site with no
           fallback has nothing to serve when a string is missing. Showing a
           switch that refuses to move would be worse than explaining why
           there isn't one. */
        '<div class="v-fixed">' + esc(tr('vis.langFallback')) + '</div>';
    }
    if (pages.length) {
      body += '<div class="v-sub">' + esc(tr('vis.pages')) + '</div>' +
        pages.map(function (slug) {
          return visRow(humanise(slug), 'visibility.pages.' + slug, '');
        }).join('');
    }
    if (sections.length) {
      body += '<div class="v-sub">' + esc(tr('vis.sections')) + '</div>' +
        sections.map(function (id) {
          return visRow(humanise(id), 'visibility.sections.' + id, '');
        }).join('');
    }

    return '<section class="s-group v-group">' +
      '<h3>' + esc(tr('vis.title')) + '</h3>' +
      '<p class="v-note">' + esc(tr('vis.explain')) + '</p>' +
      head + body +
    '</section>';
  }

  function field(p) {
    var v = state.draft[p];
    var frozen = isFrozen(p);
    var dirty = !frozen && state.draft[p] !== state.saved[p];
    var label = p.indexOf('.') === -1 ? p : p.slice(p.indexOf('.') + 1);
    var hint = EXPLAIN[p] ? tr(EXPLAIN[p]) : '';

    var control;
    if (frozen) {
      /* Shown, and shown as unchangeable. Hiding it would leave somebody
         hunting for where the language list is edited; this says it is not
         edited here, and why. */
      control = '<span class="s-frozen">' + esc(String(v)) + '</span>';
    } else if (typeof v === 'boolean') {
      control =
        '<button type="button" class="switch" role="switch" data-path="' + esc(p) + '"' +
        ' aria-checked="' + (v ? 'true' : 'false') + '"' + (v ? ' data-on="1"' : '') + '>' +
          '<span class="switch-track"><span class="switch-state">' +
            (v ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
        '</button>';
    } else if (typeof v === 'number') {
      control = '<input type="number" data-path="' + esc(p) + '" value="' + esc(v) + '">';
    } else if (p === 'defaultLang' && state.langs.length) {
      /* The one field with a real set of valid answers. A text box here means
         a typo silently breaks the fallback every translation depends on. */
      control = '<select data-path="' + esc(p) + '">' + state.langs.map(function (c) {
        return '<option value="' + esc(c) + '"' + (c === v ? ' selected' : '') + '>' +
               esc(c) + '</option>';
      }).join('') + '</select>';
    } else {
      control = '<input type="text" data-path="' + esc(p) + '" value="' + esc(v) + '"' +
                (/url|src|donorbox|youtube|instagram|facebook|^socials/.test(p)
                  ? ' spellcheck="false"' : '') + '>';
    }

    return '<div class="s-field' + (dirty ? ' is-dirty' : '') +
             (frozen ? ' is-frozen' : '') + '" data-field="' + esc(p) + '">' +
      '<div class="s-label">' +
        '<code>' + esc(label) + '</code>' +
        (dirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
        (hint ? '<span class="s-hint">' + esc(hint) + '</span>' : '') +
      '</div>' +
      '<div class="s-control">' + control + '</div>' +
    '</div>';
  }

  function markField(p) {
    var el = $('sRoot').querySelector('[data-field="' + p.replace(/"/g, '\\"') + '"]');
    if (!el) return;
    var dirty = state.draft[p] !== state.saved[p];
    el.classList.toggle('is-dirty', dirty);

    // A visibility cell is a bare switch with no label beside it — the label
    // belongs to the ROW and is shared by both columns. The coloured edge is
    // the whole unsaved marker there.
    var label = el.querySelector('.s-label');
    if (!label) return;
    var badge = label.querySelector('.badge.unsaved');
    if (dirty && !badge) {
      badge = document.createElement('span');
      badge.className = 'badge unsaved';
      badge.textContent = tr('ms.unsaved');
      label.insertBefore(badge, label.querySelector('.s-hint') || null);
    } else if (!dirty && badge) {
      badge.remove();
    }
  }

  function renderSaveBar() {
    var d = dirtyPaths();
    $('sSaveBar').hidden = !d.length;
    document.body.classList.toggle('has-savebar', !!d.length);
    if (!d.length) return;
    $('sDirtyCount').textContent = d.length === 1
      ? tr('con.oneChange') : d.length + ' ' + tr('con.nChanges');
    $('sSaveNote').textContent = tr('con.saveBarNoteSite').replace('{branch}', state.branch);
  }

  /* ---- removing a language --------------------------------------------
     Same shape as deleting a partner, because it is the same kind of act:
     something that exists nowhere else stops existing. Typed confirmation,
     checked on the server, and the count of what is being destroyed shown
     BEFORE the word is asked for — "47 translated strings" is a sentence
     somebody can weigh, "are you sure" is not. */

  $('sRoot').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-del-lang]');
    if (!btn) return;
    var code = btn.dataset.delLang;

    // First request with no confirmation: the server answers with the count
    // rather than doing anything.
    var probe, info;
    try {
      probe = await fetch(API + '?code=' + encodeURIComponent(code), {
        method: 'DELETE', credentials: 'same-origin'
      });
      info = await probe.json();
    } catch (err) {
      return toast(tr('err.unreachable') + ' ' + err.message, 'bad');
    }
    // Anything other than the expected "needs confirmation" is a real refusal
    // — English, or a language with no file — and it explains itself.
    if (probe.ok || info.translated === undefined) {
      return toast(info.error || tr('err.refused'), 'bad');
    }

    var ok = await window.StaffConfirm({
      title: tr('vis.removeTitle').replace('{lang}', langName(code)),
      body: info.translated
        ? tr('vis.removeBody').replace('{n}', info.translated).replace('{lang}', langName(code))
        : tr('vis.removeEmpty').replace('{lang}', langName(code)),
      note: tr('vis.removeNote'),
      type: 'DELETE',
      /* The same key the Publish page uses. Inventing a second one for the
         same word is how two dialogs end up saying it differently. */
      typeLabel: tr('pub.typeLabel'),
      confirm: tr('vis.removeDo'),
      cancel: tr('ms.cancel'),
      danger: true
    });
    if (!ok) return;

    btn.disabled = true;
    var res, body;
    try {
      res = await fetch(API + '?code=' + encodeURIComponent(code) + '&confirm=DELETE', {
        method: 'DELETE', credentials: 'same-origin'
      });
      body = await res.json();
    } catch (err) {
      toast(tr('err.unreachable') + ' ' + err.message, 'bad');
      btn.disabled = false;
      return;
    }
    if (!res.ok) {
      if (body && body.partial && window.StaffProblem) window.StaffProblem(body.error, null);
      else toast((body && body.error) || tr('err.refused'), 'bad');
      btn.disabled = false;
      return;
    }

    toast(fill('vis.removed', { lang: langName(code) }), 'ok');
    await boot();          // site.json changed under us; re-read rather than guess
  });

  /* ---- editing -------------------------------------------------------- */

  $('sRoot').addEventListener('input', function (e) {
    var el = e.target;
    var p = el.getAttribute('data-path');
    if (!p) return;
    /* Typed to match what the file holds. The endpoint refuses a type change,
       so a number box that sends "110" is a 400 rather than a save.

       An EMPTY number box becomes NaN, not 0. `Number('')` is 0, so clearing
       a focal point would otherwise silently commit the image shifted to its
       top-left corner — a change nobody made, that looks like a bug in the
       site. NaN is refused by the endpoint, which is the honest outcome. */
    state.draft[p] = el.type === 'number'
      ? (el.value.trim() === '' ? NaN : Number(el.value))
      : el.value;
    markField(p);
    renderSaveBar();
  });

  $('sRoot').addEventListener('change', function (e) {
    if (e.target.tagName === 'SELECT' && e.target.getAttribute('data-path')) {
      var p = e.target.getAttribute('data-path');
      state.draft[p] = e.target.value;
      markField(p);
      renderSaveBar();
    }
  });

  $('sRoot').addEventListener('click', async function (e) {
    var sw = e.target.closest('.switch[data-path]');
    if (!sw) return;
    var p = sw.getAttribute('data-path');
    var next = !state.draft[p];

    /* THE LAUNCH SWITCH. Turning it off replaces the holding page with the
       whole site, for everybody, and it is the only control here whose
       consequence is not recoverable by setting it back — by then it has been
       seen. So it asks, and only in that direction.

       ONLY THE LIVE COLUMN. The dev column's copy of the same switch changes
       what dev.thauma.one simulates and nothing else; asking for confirmation
       there would be ceremony, and ceremony performed by reflex stops working
       as a check on the column where it matters. */
    if (p === 'visibility.comingSoon.live' && next === false) {
      var ok = await window.StaffConfirm({
        title: tr('con.launchTitle'),
        body: tr('con.launchBody'),
        note: tr('con.launchNote'),
        confirm: tr('con.launchConfirm'),
        cancel: tr('ms.cancel')
      });
      if (!ok) return;
    }

    state.draft[p] = next;
    sw.setAttribute('aria-checked', next ? 'true' : 'false');
    if (next) sw.setAttribute('data-on', '1'); else sw.removeAttribute('data-on');
    sw.querySelector('.switch-state').textContent = next ? 'On' : 'Off';
    markField(p);
    renderSaveBar();
  });

  $('sDiscard').addEventListener('click', async function () {
    var n = dirtyPaths().length;
    if (!n) return;
    var ok = await window.StaffConfirm({
      title: tr('con.discardTitle'),
      body: tr('con.discardBody').replace('{n}', n),
      confirm: tr('ms.discard'), cancel: tr('ms.cancel'), danger: true
    });
    if (!ok) return;
    state.draft = JSON.parse(JSON.stringify(state.saved));
    render();
    renderSaveBar();
  });

  /* ---- saving --------------------------------------------------------- */

  $('sSave').addEventListener('click', async function () {
    var d = dirtyPaths();
    if (!d.length) return;

    var ok = await window.StaffConfirm({
      title: tr('con.saveTitle'),
      body: tr('con.saveSiteBody').replace('{n}', d.length).replace('{branch}', state.branch),
      note: tr('con.saveNote'),
      confirm: tr('con.save'), cancel: tr('ms.cancel')
    });
    if (!ok) return;

    var btn = this;
    btn.disabled = true; $('sDiscard').disabled = true;

    var changes = {};
    d.forEach(function (p) { changes[p] = state.draft[p]; });

    var res, body;
    try {
      res = await fetch(API, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'site', sha: state.sha, changes: changes })
      });
      body = await res.json();
    } catch (e) {
      toast(tr('err.unreachable') + ' ' + e.message, 'bad');
      btn.disabled = false; $('sDiscard').disabled = false;
      return;
    }

    btn.disabled = false; $('sDiscard').disabled = false;

    if (res.status === 409) {
      if (window.StaffProblem) window.StaffProblem(body.error, boot);
      return;
    }
    if (!res.ok) {
      toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'bad');
      return;
    }

    state.saved = JSON.parse(JSON.stringify(state.draft));
    state.sha = body.sha;
    toast(body.unchanged ? tr('con.nothingChanged')
                         : fill('con.saved', { n: body.changed.length }), 'ok');
    render();
    renderSaveBar();
  });

  window.addEventListener('beforeunload', function (e) {
    if (!dirtyPaths().length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  boot();
})();
