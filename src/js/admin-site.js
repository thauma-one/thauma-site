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

   THE LANGUAGES ARE NOT HERE. Their switches, the default, the
   donation form per language and removing one moved to the
   Content page, the page that edits them (Chase, 2026-09-27:
   "all language controls can be on the page that actually
   edits the language"). isLanguage() keeps them off this form.

   comingSoon IS NOT AN ORDINARY SWITCH. It is the gate over the
   entire public site: with it on, every page is the holding
   page. It is shown as "Site on", the other way round (switchCell),
   so turning the site ON is the launch — the one control here
   that says so and asks first.
   ============================================================ */
(function () {
  'use strict';

  /* On the Website page, as its Settings tab; finds its own elements. */
  if (!document.getElementById('sRoot')) return;

  var API = '/api/admin/content';
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    sha: null, saved: {}, draft: {}, order: [],
    frozen: [], branch: '', repo: ''
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
      $('sRoot').hidden = true;
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
      $('sRoot').hidden = true;
      return;
    }

    state.sha = body.sha;
    state.frozen = body.frozen || [];
    state.branch = body.branch;
    state.repo = body.repo;
    state.langs = (body.data && body.data.languages) || [];
    state.hasDonations = !!(body.data && body.data.donorbox && typeof body.data.donorbox === 'object');
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
  /* REAL NAMES (mockup board 13): "Site name", "Address", "Social links",
     not name / url / socials. A setting the vocabulary does not know yet
     still appears, under its key — the form is derived from the file. */
  function has(key) { return tr(key) !== key; }
  function fieldLabel(p) {
    if (p.indexOf('donorbox.') === 0) return langName(p.slice(9));
    return has('set.f.' + p) ? tr('set.f.' + p) : p;
  }
  /* The social links belong to the site, so they sit in its card. */
  function cardOf(p) {
    var g = groupOf(p);
    return g === 'socials' ? '_general' : g;
  }
  function groupLabel(g) {
    if (g === '_general') return tr('set.g.site');
    return g.replace(/([A-Z_])/g, ' $1').replace(/_/g, '')
            .replace(/^./, function (c) { return c.toUpperCase(); }).trim();
  }

  /* `resourcesLibrary` -> "Resources library". The ids are the words already,
     just packed together. Not translated, for the same reason the content
     editor does not translate its section names: they identify a page or a
     block, and they are things you match against the site rather than read. */
  function humanise(id) {
    if (has('lbl.s.' + id)) return tr('lbl.s.' + id);
    if (has('set.v.' + id)) return tr('set.v.' + id);
    return id.replace(/([A-Z])/g, ' $1').toLowerCase()
             .replace(/^./, function (c) { return c.toUpperCase(); }).trim();
  }

  var isVisibility = function (p) { return p.indexOf('visibility.') === 0; };

  /* Everything about a language — edited on the Content page instead. */
  var isLanguage = function (p) {
    return p === 'defaultLang' || p === 'languages' || p.indexOf('languages.') === 0 ||
           p.indexOf('visibility.languages.') === 0;
  };

  /* THE GIVE PAGE'S DONATION FORM, ONE PER LANGUAGE. It is a setting of a
     page, not of a language (Chase, 2026-09-27: in the languages table it
     "doesn't make much sense"), so it is here — a line per language the site
     has, named by the language, with an empty line for a language added
     before it had a slot; saving that line creates it. */
  var isDonation = function (p) { return p.indexOf('donorbox.') === 0; };
  function langName(code) {
    try {
      var n = new Intl.DisplayNames([code], { type: 'language' }).of(code);
      if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1);
    } catch (e) { /* a code Intl does not know */ }
    return code;
  }
  function renderDonations() {
    if (!state.hasDonations) return '';
    return '<section class="s-group">' +
      '<h3>' + esc(tr('set.g.donate')) + '</h3>' +
      state.langs.map(function (code) {
        var p = 'donorbox.' + code;
        return field(p, state.draft[p] === undefined);
      }).join('') +
      '</section>';
  }

  var isImage = function (p) { return p.indexOf('images.') === 0; };
  /* Edited on their own tabs: the social links and the site's own links on
     Website › Links, each page's share picture on Pages (2026-10-07). */
  var isElsewhere = function (p) { return /^(socials|links|share)(\.|$)/.test(p); };

  /* THE PICTURES ARE ON Website › Photos (mockup board 14), where the focus
     is a dot on the picture rather than four numbers. isImage() keeps their
     settings off this form. */

  /* Frozen lists — `languages`, the only one — are not edited here, and the
     language list is shown where languages are managed (the Content page's
     picker), so they are left off this form entirely. */
  function isFrozenList(p) {
    return state.frozen.some(function (f) { return p.indexOf(f + '.') === 0; });
  }

  function render() {
    var groups = [];
    var seen = {};
    state.order.forEach(function (p) {
      // Visibility and images each get their own block below.
      if (isVisibility(p) || isImage(p) || isFrozenList(p) || isLanguage(p) || isDonation(p) || isElsewhere(p)) return;
      var g = cardOf(p);
      if (!seen[g]) { seen[g] = true; groups.push(g); }
    });

    /* The site first, then what visitors can see (board 13). */
    $('sRoot').innerHTML =
      groups.map(function (g) {
        var rows = state.order.filter(function (p) {
          return !isVisibility(p) && !isImage(p) && !isFrozenList(p) && !isLanguage(p) && !isDonation(p) && !isElsewhere(p) && cardOf(p) === g;
        });
        return '<section class="s-group">' +
          '<h3>' + esc(groupLabel(g)) + '</h3>' +
          rows.map(function (p) { return field(p); }).join('') +
          '</section>';
      }).join('') +
      renderDonations() +
      renderVisibility();
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

  /* SITE ON (Chase, 2026-10-08: "just be like site on and site off" — the
     holding page may one day say "maintenance" instead). Stored as it always
     was, visibility.comingSoon, which is the opposite: shown inverted. */
  var inverted = function (path) { return /^visibility\.comingSoon\./.test(path); };
  function switchCell(path, extraClass) {
    var v = inverted(path) ? !state.draft[path] : state.draft[path];
    var dirty = state.draft[path] !== state.saved[path];
    return '<span class="v-cell ' + (extraClass || '') + (dirty ? ' is-dirty' : '') +
             '" data-field="' + esc(path) + '">' +
      '<button type="button" class="switch small" role="switch" data-path="' + esc(path) + '"' +
      ' aria-checked="' + (v ? 'true' : 'false') + '"' + (v ? ' data-on="1"' : '') + '>' +
        '<span class="switch-track"><span class="switch-state">' +
          tr(v ? 'switch.on' : 'switch.off') + '</span><span class="switch-knob"></span></span>' +
      '</button></span>';
  }

  function visRow(label, base) {
    return '<div class="v-row">' +
      '<div class="v-label"><span class="s-name">' + esc(label) + '</span></div>' +
      switchCell(base + '.dev', 'is-dev') +
      switchCell(base + '.live', 'is-live') +
      '<span></span>' +
    '</div>';
  }

  function renderVisibility() {
    // Derived from whatever is in the file, so adding a page to site.json puts
    // a row here without anyone remembering to come and add one.
    var pages = [], sections = [], hasComingSoon = false;
    state.order.forEach(function (p) {
      if (!isVisibility(p)) return;
      var parts = p.split('.');          // visibility.pages.events.dev
      if (parts[1] === 'comingSoon') { hasComingSoon = true; return; }
      if (parts.length !== 4) return;
      var bucket = parts[1] === 'pages' ? pages
                 : parts[1] === 'sections' ? sections : null;
      if (!bucket) return;
      if (bucket.indexOf(parts[2]) === -1) bucket.push(parts[2]);
    });

    if (!pages.length && !sections.length && !hasComingSoon) return '';

    var head =
      '<div class="v-head">' +
        '<div class="v-label"></div>' +
        /* WHO SEES IT, and a way to look: the team's own dev.thauma.one
           first, then visitors on the live site — the order the work goes in
           (Chase, 2026-10-08: "the workflow is dev and then public"). The
           preview build at next.thauma.one follows the visitors' column, so
           it shows what is about to be published (visible.js). */
        '<span class="v-cell is-dev"><b>' + esc(tr('vis.devCol')) + '</b>' +
          '<a class="v-open" href="https://dev.thauma.one/" target="_blank" rel="noopener">dev.thauma.one ↗</a></span>' +
        '<span class="v-cell is-live"><b>' + esc(tr('vis.liveCol')) + '</b>' +
          '<a class="v-open" href="https://thauma.one/" target="_blank" rel="noopener">thauma.one ↗</a></span>' +
      '</div>';

    var body = '';
    if (hasComingSoon) {
      body += '<div class="v-sub">' + esc(tr('vis.wholeSite')) + '</div>' +
        visRow(tr('vis.comingSoon'), 'visibility.comingSoon');
    }
    if (pages.length) {
      body += '<div class="v-sub">' + esc(tr('vis.pages')) + '</div>' +
        pages.map(function (slug) {
          return visRow(humanise(slug), 'visibility.pages.' + slug);
        }).join('');
    }
    if (sections.length) {
      body += '<div class="v-sub">' + esc(tr('vis.sections')) + '</div>' +
        sections.map(function (id) {
          return visRow(has('vis.sec.' + id) ? tr('vis.sec.' + id) : humanise(id), 'visibility.sections.' + id);
        }).join('');
    }

    return '<section class="s-group v-group">' +
      '<h3>' + esc(tr('vis.title')) + '</h3>' +
      head + body +
    '</section>';
  }

  function field(p, isNew) {
    /* `isNew` means the key does not exist in the file yet — a language added
       before this setting did. It renders as an ordinary empty text box, and
       saving it creates the key. Treating it as a normal field is the point:
       nothing about the screen should say "this one is special". */
    /* Empty on both sides, so an untouched slot is not an unsaved change the
       moment the page opens; typing into it is, and saving creates the key. */
    if (isNew && state.draft[p] === undefined) {
      state.draft[p] = '';
      state.saved[p] = '';
      if (state.order.indexOf(p) === -1) state.order.push(p);
    }
    var v = state.draft[p];
    var frozen = isFrozen(p);
    var dirty = !frozen && state.draft[p] !== state.saved[p];
    var label = fieldLabel(p);

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
            tr(v ? 'switch.on' : 'switch.off') + '</span><span class="switch-knob"></span></span>' +
        '</button>';
    } else if (typeof v === 'number') {
      control = '<input type="number" data-path="' + esc(p) + '"' +
                ' aria-label="' + esc(label) + '" value="' + esc(v) + '">';
    } else {
      control = '<input type="text" data-path="' + esc(p) + '" value="' + esc(v) + '"' +
                ' aria-label="' + esc(label) + '"' +
                (/url|src|donorbox|youtube|instagram|facebook|^socials/.test(p)
                  ? ' spellcheck="false"' : '') + '>';
    }

    return '<div class="s-field' + (dirty ? ' is-dirty' : '') +
             (frozen ? ' is-frozen' : '') + '" data-field="' + esc(p) + '">' +
      '<div class="s-label">' +
        '<span class="s-name">' + esc(label) + '</span>' +
        (dirty ? '<span class="badge unsaved">' + esc(tr('ms.unsaved')) + '</span>' : '') +
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
    // belongs to the ROW and is shared by both columns. The colored edge is
    // the whole unsaved marker there.
    var label = el.querySelector('.s-label');
    if (!label) return;
    var badge = label.querySelector('.badge.unsaved');
    if (dirty && !badge) {
      badge = document.createElement('span');
      badge.className = 'badge unsaved';
      badge.textContent = tr('ms.unsaved');
      label.appendChild(badge);
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
  }

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
    var shown = inverted(p) ? !next : next;
    sw.setAttribute('aria-checked', shown ? 'true' : 'false');
    if (shown) sw.setAttribute('data-on', '1'); else sw.removeAttribute('data-on');
    sw.querySelector('.switch-state').textContent = tr(shown ? 'switch.on' : 'switch.off');
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
      toast((body && body.error) || (tr('err.refused') + ' (' + res.status + ')'), 'err');
      return;
    }

    state.saved = JSON.parse(JSON.stringify(state.draft));
    state.sha = body.sha;
    announce(body.sha, changes);
    toast(body.unchanged ? tr('con.nothingChanged')
                         : fill('con.saved', { n: body.changed.length }), 'ok');
    render();
    renderSaveBar();
  });

  /* THE WEBSITE'S TABS SHARE site.json (admin-website.js). A save on another
     tab moves the file on: take its new version, so the next save here is not
     refused as a conflict, and its values — except where this tab is in the
     middle of changing the same thing, which stays as typed. */
  function announce(sha, changes) {
    document.dispatchEvent(new CustomEvent('thauma:site-saved', { detail: { sha: sha, changes: changes, from: 'settings' } }));
  }
  document.addEventListener('thauma:site-saved', function (e) {
    var d = e.detail || {};
    if (d.from === 'settings' || !state.sha) return;
    if (d.sha) state.sha = d.sha;
    Object.keys(d.changes || {}).forEach(function (p) {
      var wasClean = state.draft[p] === state.saved[p];
      state.saved[p] = d.changes[p];
      if (wasClean) state.draft[p] = d.changes[p];
      if (state.order.indexOf(p) === -1) state.order.push(p);
    });
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
