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
    comingSoon: 'con.f.comingSoon',
    showEvents: 'con.f.showEvents',
    resourcesReady: 'con.f.resourcesReady',
    defaultLang: 'con.f.defaultLang',
    languages: 'con.f.languages',
    url: 'con.f.url'
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

  function render() {
    var groups = [];
    var seen = {};
    state.order.forEach(function (p) {
      var g = groupOf(p);
      if (!seen[g]) { seen[g] = true; groups.push(g); }
    });

    $('sRoot').innerHTML = groups.map(function (g) {
      var rows = state.order.filter(function (p) { return groupOf(p) === g; });
      return '<section class="s-group">' +
        '<h3>' + esc(groupLabel(g)) + '</h3>' +
        rows.map(field).join('') +
        '</section>';
    }).join('');
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
    var label = el.querySelector('.s-label');
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
    $('sSaveNote').textContent = tr('con.willCommitSite').replace('{branch}', state.branch);
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

    /* THE LAUNCH SWITCH. Turning comingSoon off replaces the holding page
       with the whole site, for everybody, and it is the only control on this
       page whose consequence is not recoverable by simply setting it back —
       by then it has been seen. So it asks, and only in that direction. */
    if (p === 'comingSoon' && next === false) {
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
      title: tr('con.publishTitle'),
      body: tr('con.publishSiteBody').replace('{n}', d.length).replace('{branch}', state.branch),
      note: tr('con.publishNote'),
      confirm: tr('con.commit'), cancel: tr('ms.cancel')
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
                         : tr('con.committed').replace('{n}', body.changed.length), 'ok');
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
