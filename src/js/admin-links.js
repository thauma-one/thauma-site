/* ============================================================
   admin-links.js — Website › Links: where Thauma's site links
   ============================================================
   Suggestion 5 from 2026-10-07 ("Yes"): one footer and links
   model, the Site Creator's. Two parts, as a partner site's Links
   tab has them:
     - THE SOCIAL LINKS: a row of icons; tap one to give it an
       address. site.json `socials.<kind>`.
     - THE SITE'S OWN LINKS: each with its name in every language,
       where it goes (a page of the site or the web), in line with
       the socials or separated, as words or as an icon (its site's
       icon, a picture of its own, or its initials), dragged into
       order (StaffSort). site.json `links`, a list the content
       endpoint cleans item by item (cleanSiteLinks).
   SAVED AS CHANGED, like Settings and Photos: one quiet commit
   to site.json a moment after the last change, announced to the
   other Website tabs ('thauma:site-saved') so every tab saves
   against the new version. The footer draws them
   (base.njk, partials/foot-*.njk).
   ============================================================ */
(function () {
  'use strict';
  var root = document.getElementById('lkRoot');
  if (!root) return;
  var CONTENT = '/api/admin/content';
  var ICONS = {};
  try { ICONS = JSON.parse(document.getElementById('lkIcons').textContent); } catch (e) { ICONS = { kinds: [], icon: {}, name: {} }; }
  var PAGES = ['home', 'about', 'mission', 'values', 'team', 'resources', 'events', 'give', 'contact'];
  var state = { site: null, sha: null, langs: ['en'], openSocial: null, open: null, timer: null, pending: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(k) { return window.StaffI18n ? window.StaffI18n.t(k) : k; }
  function toast(m, kind) { if (window.StaffToast) window.StaffToast(m, kind); }
  function langName(code) {
    try { var n = new Intl.DisplayNames([code], { type: 'language' }).of(code); if (n && n !== code) return n.charAt(0).toUpperCase() + n.slice(1); }
    catch (e) { /* a code Intl does not know */ }
    return code;
  }
  function pageName(id) { var k = 'lbl.s.' + id; return tr(k) !== k ? tr(k) : id; }
  function chips(name, options, current, labelOf) {
    return '<div class="ws-chips" role="group">' + options.map(function (o) {
      return '<button type="button" class="ws-chip" data-lk-chip="' + esc(name) + '" data-value="' + esc(o) + '" aria-pressed="' + (o === current) + '">' + esc(labelOf(o)) + '</button>';
    }).join('') + '</div>';
  }
  function grip() { return window.StaffSort ? StaffSort.grip(tr('ws.dragMove')) : ''; }

  /* ---- loading and saving ----------------------------------------------- */

  async function load() {
    var res = await fetch(CONTENT + '?file=site', { credentials: 'same-origin', cache: 'no-store' }).catch(function () { return null; });
    var body = res ? await res.json().catch(function () { return null; }) : null;
    if (!res || !res.ok || !body || !body.data) {
      root.innerHTML = '<p class="empty">' + esc((body && body.error) || tr('err.refused')) + '</p>';
      return;
    }
    state.site = body.data; state.sha = body.sha;
    state.site.socials = state.site.socials || {};
    state.site.links = Array.isArray(state.site.links) ? state.site.links : [];
    state.langs = state.site.languages || ['en'];
    draw();
  }
  /* A moment after the last change, everything waiting goes as one commit. */
  function soon(path, value) {
    state.pending[path] = value;
    clearTimeout(state.timer);
    state.timer = setTimeout(flush, 700);
  }
  async function flush() {
    var changes = state.pending; state.pending = {};
    if (!Object.keys(changes).length) return;
    var res = await fetch(CONTENT, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: 'site', sha: state.sha, changes: changes }) }).catch(function () { return null; });
    var body = res ? await res.json().catch(function () { return {}; }) : {};
    if (!res || !res.ok) { toast((body && body.error) || tr('err.refused'), 'err'); return load(); }
    if (body.sha) state.sha = body.sha;
    document.dispatchEvent(new CustomEvent('thauma:site-saved', { detail: { sha: state.sha, changes: changes, from: 'links' } }));
    toast(tr('ln.saved'), 'ok');
  }
  /* Another tab saved site.json: its version is the one to save against. */
  document.addEventListener('thauma:site-saved', function (e) {
    var d = e.detail || {};
    if (d.from === 'links') return;
    if (d.sha) state.sha = d.sha;
  });

  /* ---- drawing ------------------------------------------------------------ */

  function where(u) {
    if (!u || u === 'https://') return tr('ws.link.nowhere');
    return u.indexOf('page:') === 0 ? pageName(u.slice(5)) : u.replace(/^(https:\/\/|mailto:)/, '');
  }
  function draw() {
    var S = state.site.socials, links = state.site.links;
    var html = '<div class="ws-head"><h2>' + esc(tr('ws.socials')) + '</h2></div><div class="ws-socials">' +
      ICONS.kinds.map(function (k) {
        var set = !!S[k], open = state.openSocial === k;
        return '<button type="button" class="ws-soc' + (set ? ' is-set' : '') + '" data-lk-social="' + k + '" aria-pressed="' + open + '" aria-label="' +
          esc(ICONS.name[k] + (set ? '' : ' — ' + tr('ws.notSet'))) + '" title="' + esc(ICONS.name[k]) + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.icon[k] + '</svg></button>';
      }).join('') + '</div>';
    if (state.openSocial) {
      var k = state.openSocial;
      html += '<div class="ws-socbox"><b>' + esc(ICONS.name[k]) + '</b>' +
        '<input type="' + (k === 'email' ? 'email' : 'url') + '" data-lk-social-url="' + k + '" value="' + esc((S[k] || '').replace(/^mailto:/, '')) + '" placeholder="' +
          (k === 'email' ? 'hello@thauma.one' : 'https://') + '" aria-label="' + esc(ICONS.name[k]) + '">' +
        (S[k] ? '<button type="button" class="link-btn" data-lk-social-clear="' + k + '">' + esc(tr('ws.remove')) + '</button>' : '') + '</div>';
    }
    html += '<p class="ws-small ws-soc-hint">' + esc(tr('ws.socialsHow')) + '</p>';

    html += '<div class="ws-head ws-head-row"><h2>' + esc(tr('ws.custom')) + '</h2>' +
      '<button type="button" class="solid-btn sm" data-lk-add>+ ' + esc(tr('ws.addLink')) + '</button></div>';
    if (!links.length) html += '<p class="ws-small">' + esc(tr('ws.noCustom')) + '</p>';
    else html += '<div class="ws-linkrows ws-own-links">' + links.map(function (l, i) {
      var open = state.open === i, label = (l.label || {}).en || (l.label || {})[state.langs[0]] || '';
      var row = '<div class="ws-linkitem" data-k="' + i + ':' + esc(l.url) + '"><div class="ws-linkrow' + (open ? ' is-open' : '') + '">' + grip() +
        '<b>' + esc(label || tr('ws.itemUntitled')) + '</b><span>→ ' + esc(where(l.url)) + '</span>' +
        '<button type="button" class="link-btn" data-lk-open="' + i + '">' + esc(open ? tr('ws.close') : tr('ws.edit')) + '</button>' +
        '<button type="button" class="ws-icon del" data-lk-remove="' + i + '" aria-label="' + esc(tr('ws.remove')) + '">✕</button></div>';
      if (!open) return row + '</div>';
      var page = l.url && l.url.indexOf('page:') === 0;
      return row + '<div class="ws-linkedit"><div class="lk-names">' +
        state.langs.map(function (code) {
          return '<label class="fld"><span>' + esc(tr('ws.linkName') + ' · ' + langName(code)) + '</span>' +
            '<input type="text" maxlength="40" data-lk-label="' + i + ':' + esc(code) + '" value="' + esc((l.label || {})[code] || '') + '" lang="' + esc(code) + '"></label>';
        }).join('') + '</div>' +
        '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.link.goesTo')) + '</span>' +
          chips('kind:' + i, ['page', 'web'], page ? 'page' : 'web', function (v) { return tr(v === 'page' ? 'ws.link.kind.page' : 'ws.link.kind.url'); }) +
          (page ? '<select data-lk-page="' + i + '">' + PAGES.map(function (id) { return '<option value="' + id + '"' + (l.url === 'page:' + id ? ' selected' : '') + '>' + esc(pageName(id)) + '</option>'; }).join('') + '</select>'
                : '<input type="url" data-lk-url="' + i + '" value="' + esc(l.url && l.url !== 'https://' ? l.url : '') + '" placeholder="https://">') + '</div>' +
        '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.linkPlace')) + '</span>' +
          chips('place:' + i, ['inline', 'apart'], l.place === 'inline' ? 'inline' : 'apart', function (v) { return tr('ws.linkPlace.' + v); }) + '</div>' +
        (l.place !== 'inline' ? '<div class="ws-field"><span class="ws-lbl2">' + esc(tr('ws.showAs')) + '</span>' +
          chips('show:' + i, ['icon', 'words'], l.show === 'icon' ? 'icon' : 'words', function (v) { return tr('ws.showAs.' + v); }) + '</div>' : '') +
        (l.place === 'inline' || l.show === 'icon' ? '<div class="ws-sec-row">' + (l.iconImg ? '<img class="ws-thumb ws-thumb-icon" src="' + esc(l.iconImg) + '" alt="">' : '') +
          '<label class="ghost-btn sm ws-file">' + esc(tr(l.iconImg ? 'ws.iconChange' : 'ws.iconOwn')) + '<input type="file" accept="image/*" data-lk-icon="' + i + '" hidden></label>' +
          (l.iconImg ? '<button type="button" class="link-btn" data-lk-unicon="' + i + '">' + esc(tr('ws.iconAuto')) + '</button>' : '') + '<span class="hint"></span></div>' : '') +
        '</div></div>';
    }).join('') + '</div>';
    root.innerHTML = html;
  }

  /* ---- changing -------------------------------------------------------------- */

  function linksChanged() { draw(); soon('links', state.site.links); }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var d = b.dataset, links = state.site.links;
    if (d.lkSocial) { state.openSocial = state.openSocial === d.lkSocial ? null : d.lkSocial; draw(); var inp = root.querySelector('[data-lk-social-url]'); if (inp) inp.focus(); return; }
    if (d.lkSocialClear) { state.site.socials[d.lkSocialClear] = ''; soon('socials.' + d.lkSocialClear, ''); state.openSocial = null; return draw(); }
    if (d.lkAdd !== undefined) { links.push({ url: 'https://', label: {}, place: 'apart', show: 'words' }); state.open = links.length - 1; return draw(); }
    if (d.lkOpen) { state.open = state.open === +d.lkOpen ? null : +d.lkOpen; return draw(); }
    if (d.lkRemove) { links.splice(+d.lkRemove, 1); state.open = null; return linksChanged(); }
    if (d.lkUnicon) { delete links[+d.lkUnicon].iconImg; return linksChanged(); }
    if (d.lkChip) {
      var a = d.lkChip.split(':'), l = links[+a[1]], v = d.value;
      if (a[0] === 'kind') l.url = v === 'page' ? 'page:home' : 'https://';
      else if (a[0] === 'place') l.place = v;
      else if (a[0] === 'show') l.show = v;
      return linksChanged();
    }
  });
  root.addEventListener('input', function (e) {
    var t = e.target, d = t.dataset, links = state.site.links;
    if (d.lkSocialUrl) {
      var v = t.value.trim();
      if (d.lkSocialUrl === 'email' && v && !/^mailto:/.test(v)) v = 'mailto:' + v;
      state.site.socials[d.lkSocialUrl] = v;
      return soon('socials.' + d.lkSocialUrl, v);
    }
    if (d.lkLabel) {
      var a = d.lkLabel.split(':'), l = links[+a[0]];
      l.label = l.label || {};
      if (t.value.trim()) l.label[a[1]] = t.value; else delete l.label[a[1]];
      return soon('links', links);
    }
    if (d.lkUrl) {
      var u = t.value.trim();
      if (u && !/^(https:\/\/|mailto:)/.test(u)) u = /@/.test(u) && !/\//.test(u) ? 'mailto:' + u : 'https://' + u.replace(/^http:\/\//, '');
      links[+d.lkUrl].url = u || 'https://';
      return soon('links', links);
    }
  });
  root.addEventListener('change', async function (e) {
    var t = e.target, d = t.dataset, links = state.site.links;
    if (d.lkPage) { links[+d.lkPage].url = 'page:' + t.value; return linksChanged(); }
    if (d.lkIcon && t.files && t.files[0]) {
      var hint = t.closest('.ws-sec-row').querySelector('.hint');
      try {
        hint.textContent = tr('lib.uploading');
        var blob = await small(t.files[0], 256);
        var res = await fetch('/api/admin/media?kind=site', { method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': blob.type, 'X-File-Name': 'link-icon' }, body: blob });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || tr('err.refused'));
        links[+d.lkIcon].iconImg = body.url;
        linksChanged();
      } catch (err) { hint.textContent = err.message; }
    }
  });
  /* an icon is small: no need to send a photograph */
  async function small(file, max) {
    var bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(function (r) { c.toBlob(r, 'image/png'); });
  }
  if (window.StaffSort) StaffSort(root, { items: '.ws-own-links > .ws-linkitem', handle: '.ws-linkitem .sort-grip',
    key: function (it) { return it.dataset.k; },
    drop: function (l, from, to) {
      var links = state.site.links, opened = state.open != null ? links[state.open] : null;
      links.splice(to, 0, links.splice(from, 1)[0]);
      state.open = opened ? links.indexOf(opened) : null;
      linksChanged();
    } });

  load();
})();
