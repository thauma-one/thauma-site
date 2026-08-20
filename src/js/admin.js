/* ============================================================
   admin.js — organisation administration
   ============================================================
   Talks to /api/admin, which refuses anyone without the admin
   role. These pages are reachable by anyone Access lets through,
   because Access authenticates rather than authorises — so a
   403 here is a normal outcome, not an error, and it gets an
   explanation rather than a red message.

   SAVES IMMEDIATELY, like Settings and unlike the milestone
   editor. Each control is one decision about one person, and
   nothing here is prose edited in passes. Every control disables
   while its request is in flight, and the page reloads from what
   the server returned rather than from what it hoped.
   ============================================================ */
(function () {
  'use strict';

  var page = document.body.getAttribute('data-admin-page');
  if (!page) return;

  var API = '/api/admin';
  var $ = function (id) { return document.getElementById(id); };
  var state = { users: [], partners: [], languages: [], audit: [], editing: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tr(key) { return window.StaffI18n ? window.StaffI18n.t(key) : key; }
  function toast(msg, kind) { if (window.StaffToast) window.StaffToast(msg, kind); }

  var ROLE_LABEL = { admin: 'Administration', partner: 'Partner',
                     staff: 'Staff', board: 'Board' };
  // Order matters on screen: the two that change what somebody IS come first.
  var ALL_ROLES = ['admin', 'partner', 'staff', 'board'];

  /* Roles that deserve a sentence before they are granted. Administration
     because of what it reaches, Partner because it CREATES something — a
     ministry record with its own supporters, goals and site. A toggle that
     quietly builds a thing should say so first. */
  var CONFIRM_ROLES = { admin: true, partner: true };

  /* ---- viewing somebody else's console --------------------------------- */

  async function viewAs(userId, name, btn) {
    /* A sentence about what happens, not "are you sure". What happens is that
       every screen starts showing a different person's data — including their
       supporters — and that is worth one deliberate pause. */
    var ok = await window.StaffConfirm({
      title: tr('act.confirmTitle').replace('{name}', name),
      body: tr('act.confirmBody').replace('{name}', name),
      note: tr('act.confirmNote'),
      confirm: tr('act.confirmDo'),
      cancel: tr('ms.cancel')
    });
    if (!ok) return;

    btn.disabled = true;
    var res, body;
    try {
      res = await fetch('/api/admin/act-as', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
      });
      body = await res.json();
    } catch (err) {
      toast(tr('err.unreachable') + ' ' + err.message, 'bad');
      btn.disabled = false;
      return;
    }
    if (!res.ok) {
      toast((body && body.error) || tr('err.refused'), 'bad');
      btn.disabled = false;
      return;
    }
    /* The cached identity is the ADMINISTRATOR's. Carrying it into somebody
       else's console would paint their name and their roles over the wrong
       account until the first fetch returned. Clear it and let the target's
       console fill it in. */
    try { sessionStorage.removeItem('thauma.staff.who'); } catch (e) {}

    /* Cache the acting state BEFORE navigating, so the target's console knows
       whose it is — and in which language — on its very first paint. Without
       this the first page loads in English with no banner, and both appear a
       moment later when the API answers, which reads as a glitch at exactly
       the moment somebody needs to trust what they are looking at. */
    try {
      sessionStorage.setItem('thauma.staff.acting', JSON.stringify(body.acting));
    } catch (e) {}
    if (body.acting && body.acting.lang && window.StaffI18n) {
      window.StaffI18n.setLang(body.acting.lang, { transient: true });
    }

    // Straight into the console being supported.
    location.href = '/staff/';
  }

  /* ---- loading -------------------------------------------------------- */

  async function load() {
    var res, body;
    try {
      res = await fetch(API, { credentials: 'same-origin', cache: 'no-store' });
    } catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreachable') + ' ' + e.message, load);
      return;
    }
    try { body = await res.json(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.unreadable') + ' (' + res.status + ')', load);
      return;
    }

    if (res.status === 403) {
      // NOT an error. This account simply is not an administrator, and the
      // page says so plainly rather than shouting about a failure.
      if ($('notAdmin')) $('notAdmin').hidden = false;
      document.querySelectorAll('.adm-people, .adm-partners, .adm-content, .adm-site, ' +
                                '.audit, .tiles, .quick, .ms-bar, .ms-savebar, .note')
        .forEach(function (el) { el.hidden = true; });
      if (window.StaffProblemClear) window.StaffProblemClear();
      return;
    }
    if (!res.ok) {
      if (window.StaffProblem) {
        window.StaffProblem(
          res.status === 401 ? tr('err.expired')
            : tr('err.refused') + ' (' + res.status + ')' +
              (body.error ? ' — ' + body.error : ''),
          res.status === 401 ? null : load);
      }
      return;
    }

    if (window.StaffProblemClear) window.StaffProblemClear();
    state = body;
    if (body.you && window.StaffIdentity) window.StaffIdentity(body.you);
    // Still viewing somebody? Say so here as well — the cookie does not
    // stop applying just because this page ignores it.
    if (window.StaffActing) window.StaffActing(body);

    try { render(); }
    catch (e) {
      if (window.StaffProblem) window.StaffProblem(tr('err.renderFailed') + ': ' + e.message, null);
      console.error('admin render failed:', e);
    }
  }

  /* Sends one change, then reloads. The server is the only thing that knows
     what actually happened — including the refusals, which are the point. */
  async function change(payload, control, method) {
    if (control) control.disabled = true;
    try {
      var res = await fetch(API, {
        method: method || 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
      var keep = state.editing;
      await load();
      // The panel stays open: you are usually making several changes to
      // one person, and closing it after each would be its own chore.
      if (keep) { state.editing = keep; renderPeople(); }
      toast(tr('toast.saved'), 'ok');
      return body;
    } catch (e) {
      await load();
      // Refusals here are deliberate and explanatory — "that is the last
      // administrator" is the system working, so it is shown in full.
      toast(e.message, 'err');
      return null;
    } finally {
      if (control) control.disabled = false;
    }
  }

  /* ---- rendering ------------------------------------------------------ */

  function render() {
    if (page === 'index') return renderOverview();
    if (page === 'users') return renderPeople();
    if (page === 'partners') return renderPartners();
    if (page === 'activity') return renderAudit();
  }

  function renderOverview() {
    var active = state.users.filter(function (u) { return u.status === 'active'; }).length;
    var admins = state.users.filter(function (u) { return u.roles.indexOf('admin') >= 0; }).length;
    $('admUserCount').textContent = state.users.length;
    $('admPartnerCount').textContent = state.partners.length;
    $('admAuditCount').textContent = state.audit.length;

    $('admTiles').innerHTML = [
      { k: tr('adm.tile.people'), v: state.users.length, s: active + ' active' },
      { k: tr('adm.tile.admins'), v: admins,
        s: admins === 1 ? tr('adm.tile.onlyAdmin') : tr('adm.tile.canAdminister'),
        cls: admins === 1 ? 'alert' : '' },
      { k: tr('adm.tile.partners'), v: state.partners.length, s: tr('adm.tile.sending') },
      { k: tr('adm.tile.languages'), v: state.languages.length, s: tr('adm.tile.offered') }
    ].map(function (t) {
      return '<div class="tile ' + (t.cls || '') + '">' +
        '<span class="k">' + esc(t.k) + '</span>' +
        '<span class="v tnum">' + esc(t.v) + '</span>' +
        '<span class="s">' + esc(t.s) + '</span></div>';
    }).join('');
  }

  /* ROWS THAT OPEN, not a wall of controls.

     The first version put every switch and chip for every person on screen at
     once. With three accounts that is a block of text; with thirty it is
     unusable, and nothing tells you which person you are about to change.

     Same pattern as the milestone editor, for the same reason: a row you can
     read, and a panel that belongs to it. */
  function renderPeople() {
    /* The active sort has to be re-marked on every render: the buttons live
       outside #admPeople, so nothing else would ever update them. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-sort]'), function (b) {
      b.classList.toggle('is-on', b.dataset.sort === ui.sort);
      b.setAttribute('aria-pressed', b.dataset.sort === ui.sort ? 'true' : 'false');
    });

    if (!state.users.length) {
      $('admPeople').innerHTML = '<p class="empty">' + esc(tr('adm.noPeople')) + '</p>';
      return;
    }

    $('admPeople').innerHTML = sortedPeople().map(function (u) {
      var open = state.editing === u.id;
      var roleTags = u.roles.length
        ? u.roles.map(function (r) {
            return '<span class="role-tag ' + esc(r) + '">' +
              esc(ROLE_LABEL[r] || r) + '</span>';
          }).join('')
        : '<span class="role-tag none">' + esc(tr('adm.noRoles')) + '</span>';

      return '<div class="adm-person' + (u.status !== 'active' ? ' is-inactive' : '') +
             (open ? ' is-open' : '') + '" data-person="' + esc(u.id) + '">' +

        '<div class="adm-row" role="button" tabindex="0" aria-expanded="' +
          (open ? 'true' : 'false') + '">' +
          '<span class="ms-chev" aria-hidden="true"></span>' +
          '<div class="adm-who">' +
            '<span class="adm-name">' + esc(u.name) + '</span>' +
            '<span class="adm-email">' + esc(u.email) + '</span>' +
          '</div>' +
          '<div class="adm-tags">' + roleTags +
            (profileFor(u.id) && profileFor(u.id).is_public
              ? '<span class="role-tag on-site">' + esc(tr('adm.onSite')) + '</span>' : '') +
          '</div>' +
          '<div class="adm-access">' +
            (u.partner_names.length
              ? esc(u.partner_names.join(', '))
              : '<span class="adm-none">' + esc(tr('adm.noPartners')) + '</span>') +
          '</div>' +
          '<span class="adm-status s-' + esc(u.status) + '">' +
            esc(tr('adm.status.' + u.status)) + '</span>' +
        '</div>' +

        personPanel(u, open) +
      '</div>';
    }).join('');
  }

  /* THE PUBLIC HALF OF A PERSON.

     The People page holds everyone — staff, board, and people whose partner
     role has nothing to do with Thauma — so most rows will never have this
     switched on, and that is the ordinary case rather than an omission. The
     toggle is the whole decision; everything under it is only reachable once
     it is on, because a bio nobody will read is not worth the screen space.

     Two language columns, the same shape as the milestone and prayer editors.
     Learning one teaches all three, and a role title is exactly the kind of
     thing that gets translated late. */
  function profileLangs() {
    var on = (state.languages || []).filter(function (l) { return l.is_active; });
    if (!ui.profileLangA) ui.profileLangA = (on[0] || {}).code || null;
    if (!ui.profileLangB) {
      var other = on.filter(function (l) { return l.code !== ui.profileLangA; });
      ui.profileLangB = (other[0] || {}).code || null;
    }
    return on;
  }

  function langPicker(which, selected) {
    return '<select class="lang-pick" data-plang="' + which + '">' +
      profileLangs().map(function (l) {
        return '<option value="' + esc(l.code) + '"' +
          (l.code === selected ? ' selected' : '') + '>' +
          esc((l.native_name || l.name) + ' (' + l.code + ')') + '</option>';
      }).join('') + '</select>';
  }

  function profileColumn(u, which, code, text) {
    var t = (code && text[code]) || { role_title: '', bio: '' };
    return '<div class="pf-col">' +
      langPicker(which, code) +
      '<label class="fld"><span>' + esc(tr('adm.pf.roleTitle')) + '</span>' +
        '<input type="text" data-pf="role_title" data-col="' + which + '"' +
        ' value="' + esc(t.role_title || '') + '" maxlength="120"></label>' +
      '<label class="fld"><span>' + esc(tr('adm.pf.bio')) + '</span>' +
        '<textarea data-pf="bio" data-col="' + which + '" rows="6"' +
        ' maxlength="4000">' + esc(t.bio || '') + '</textarea></label>' +
    '</div>';
  }

  /* One photo, with what it is FOR written on it. "Photo" and "second photo"
     told you nothing about which appears where, and the two are cropped
     differently by the page that shows them. */
  function photoSlot(u, kind, url) {
    return '<div class="pf-photo" data-slot="' + esc(kind) + '">' +
      '<span class="adm-label">' + esc(tr('adm.pf.' + kind)) + '</span>' +
      '<div class="pf-shot">' +
        (url
          ? '<img src="' + esc(url) + '" alt="">'
          : '<span class="pf-empty">' + esc(tr('adm.pf.noPhoto')) + '</span>') +
      '</div>' +
      '<input type="hidden" data-pf="' + esc(kind) + '" value="' + esc(url) + '">' +
      '<input type="file" accept="image/*" hidden' +
        ' data-pf-file="' + esc(kind) + '" data-user="' + esc(u.id) + '">' +
      '<div class="pf-photo-acts">' +
        '<button type="button" class="ghost-btn" data-pf-pick="' + esc(kind) + '">' +
          esc(tr(url ? 'adm.pf.replace' : 'adm.pf.choose')) + '</button>' +
        (url ? '<button type="button" class="del" data-pf-clear="' + esc(kind) + '">' +
          esc(tr('adm.pf.remove')) + '</button>' : '') +
      '</div>' +
      '<span class="hint" data-pf-shot-status="' + esc(kind) + '"></span>' +
    '</div>';
  }

  /* SHRUNK AND CONVERTED IN THE BROWSER, before a byte is sent.

     A Worker cannot decode a JPEG without a library and has a CPU budget
     measured in milliseconds, so a 12MP upload would spend all of it. The
     browser is already holding the file decoded, has a canvas, and is doing
     nothing. 1600px is larger than any frame the site renders, so this is not
     a quality decision — it is the difference between a 6MB upload over the
     tunnel and a 200KB one.

     WebP where the browser will encode it, JPEG where it will not: toBlob
     hands back a PNG when asked for a type it does not support, which would
     be several times larger than the JPEG it replaced. Checking the type we
     actually got is the only way to notice. */
  async function shrinkImage(file, maxPx) {
    var bitmap = await createImageBitmap(file);
    var scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * scale));
    var h = Math.max(1, Math.round(bitmap.height * scale));

    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();

    var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/webp', 0.85); });
    if (!blob || blob.type !== 'image/webp') {
      blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', 0.85); });
    }
    return blob;
  }

  async function uploadPhoto(userId, kind, file, slot) {
    var status = slot.querySelector('[data-pf-shot-status]');
    var say = function (k) { if (status) status.textContent = tr(k); };

    try {
      say('adm.pf.shrinking');
      var blob = await shrinkImage(file, 1600);
      if (!blob) throw new Error('this browser could not convert that image');

      say('adm.pf.uploading');
      var res = await fetch('/api/admin/media?for=' + encodeURIComponent(userId) +
                            '&kind=' + encodeURIComponent(kind), {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': blob.type },
        body: blob
      });
      var body = await res.json();
      if (!res.ok) { if (status) status.textContent = body.error || tr('err.refused'); return; }

      /* Shown immediately and held in the hidden field — but NOT saved. The
         profile still saves on Save, so uploading a photo and changing your
         mind costs nothing. */
      slot.querySelector('[data-pf="' + kind + '"]').value = body.url;
      slot.querySelector('.pf-shot').innerHTML =
        '<img src="' + esc(body.url) + '" alt="">';
      if (status) {
        status.textContent = fill('adm.pf.shotReady', { kb: Math.round(body.bytes / 1024) });
      }
    } catch (e) {
      if (status) status.textContent = tr('adm.pf.shotFailed') + ' ' + e.message;
    }
  }

  function profileSection(u) {
    var p = profileFor(u.id);
    var on = !!(p && p.is_public);
    var text = profileText(p);
    profileLangs();

    return '<div class="adm-section adm-profile" data-profile="' + esc(u.id) + '">' +
      '<span class="adm-label">' + esc(tr('adm.pf.heading')) + '</span>' +

      '<button type="button" class="switch small" role="switch" data-pf-public="' + esc(u.id) + '"' +
        ' aria-checked="' + (on ? 'true' : 'false') + '">' +
        '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
          '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(tr('adm.pf.shown')) +
          '<span class="switch-note">' + esc(tr('adm.pf.shownNote')) + '</span>' +
        '</span></button>' +

      '<div class="pf-body"' + (on ? '' : ' hidden') + '>' +
        '<div class="pf-grid">' +
          '<label class="fld"><span>' + esc(tr('adm.pf.region')) + '</span>' +
            '<input type="text" data-pf="region" maxlength="120"' +
            ' value="' + esc((p && p.region) || '') + '"' +
            ' placeholder="Kansas City, USA &rarr; Croatia"></label>' +
          '<label class="fld"><span>' + esc(tr('adm.pf.email')) + '</span>' +
            '<input type="email" data-pf="public_email" maxlength="200"' +
            ' value="' + esc((p && p.public_email) || '') + '">' +
            '<span class="fld-hint">' + esc(tr('adm.pf.emailHint')) + '</span></label>' +
          '<label class="fld"><span>' + esc(tr('adm.pf.order')) + '</span>' +
            '<input type="number" data-pf="sort_order" step="1"' +
            ' value="' + ((p && p.sort_order) || 0) + '"></label>' +
          '<label class="fld"><span>' + esc(tr('adm.pf.address')) + '</span>' +
            '<input type="text" data-pf="slug" maxlength="80"' +
            ' value="' + esc((p && p.slug) || '') + '"' +
            ' placeholder="' + esc(slugHint(u.name)) + '">' +
            '<span class="fld-hint">' + esc(tr('adm.pf.addressHint')) + '</span></label>' +
        '</div>' +

        '<div class="pf-langs">' +
          profileColumn(u, 'a', ui.profileLangA, text) +
          profileColumn(u, 'b', ui.profileLangB, text) +
        '</div>' +

        '<div class="pf-photos">' +
          photoSlot(u, 'photo', (p && p.photo) || '') +
          photoSlot(u, 'bio_photo', (p && p.bio_photo) || '') +
        '</div>' +

        '<div class="pf-actions">' +
          '<button type="button" class="solid-btn" data-pf-save="' + esc(u.id) + '">' +
            esc(tr('adm.pf.save')) + '</button>' +
          '<span class="hint" data-pf-status="' + esc(u.id) + '">' +
            esc(tr('adm.pf.saveNote')) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* Mirrors the server's slugify closely enough to show what the address will
     be. The server decides; this only fills the placeholder. */
  function slugHint(name) {
    return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u0111\u0110]/g, 'd').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /* Everything you can change about one person, in one place, with what each
     control actually does written next to it. */
  function personPanel(u, open) {
    var roles = ALL_ROLES.map(function (r) {
      var on = u.roles.indexOf(r) >= 0;
      return '<button type="button" class="switch small" role="switch"' +
        ' data-user="' + esc(u.id) + '" data-role="' + esc(r) + '"' +
        ' aria-checked="' + (on ? 'true' : 'false') + '">' +
        '<span class="switch-track"><span class="switch-state">' +
          (on ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(ROLE_LABEL[r]) +
          '<span class="switch-note">' + esc(tr('adm.role.' + r)) + '</span>' +
        '</span></button>';
    }).join('');

    var partners = state.partners.map(function (p) {
      var has = u.partner_ids.indexOf(p.id) >= 0;
      return '<button type="button" class="chip-toggle' + (has ? ' on' : '') + '"' +
        ' data-user="' + esc(u.id) + '" data-partner="' + esc(p.id) + '"' +
        ' aria-pressed="' + (has ? 'true' : 'false') + '">' +
        esc(p.display_name) + '</button>';
    }).join('');

    return '<div class="adm-panel"' + (open ? '' : ' hidden') + '>' +
      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('adm.roles')) + '</span>' +
        '<div class="adm-roles">' + roles + '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('adm.partnerAccess')) + '</span>' +
        '<div class="adm-chips">' + (partners || '<span class="hint">—</span>') + '</div>' +
        '<span class="switch-note">' + esc(tr('adm.partnerAccessNote')) + '</span>' +
      '</div>' +

      profileSection(u) +

      '<div class="adm-section adm-danger">' +
        '<div class="fld">' +
          '<span>' + esc(tr('adm.signInStatus')) + '</span>' +
          '<select class="status-pick" data-user="' + esc(u.id) + '">' +
            ['invited', 'active', 'suspended'].map(function (s) {
              return '<option value="' + s + '"' + (u.status === s ? ' selected' : '') + '>' +
                esc(tr('adm.status.' + s)) + '</option>';
            }).join('') +
          '</select>' +
          '<span class="switch-note">' + esc(tr('adm.statusNote')) + '</span>' +
        '</div>' +
        /* IT SUPPORT, NOT IMPERSONATION. Opening somebody's console is how
           you answer "my stewardship page is empty and it should not be"
           without asking for their password. It is audited on the way in, on
           the way out, and on every change made in between, and the console
           says whose account it is on every screen while it lasts. */
        /* Only while they are still invited. Once somebody is active they
           have signed in, and offering to re-send an invite would just be a
           button that confuses them. */
        (u.status === 'invited'
          ? '<button type="button" class="ghost-btn" data-reinvite="' + esc(u.id) + '">' +
              esc(tr('adm.resendInvite')) + '</button>'
          : '') +
        (u.status === 'active' && u.id !== (state.you && state.you.id)
          ? '<button type="button" class="ghost-btn view-as" data-view-as="' + esc(u.id) +
            '" data-name="' + esc(u.name || u.email) + '">' +
              esc(tr('act.viewAs')) + '</button>'
          : '') +
        '<button type="button" class="del" data-remove="' + esc(u.id) + '">' +
          esc(tr('adm.removePerson')) + '</button>' +
      '</div>' +
    '</div>';
  }

  /* SORT LIVES OUTSIDE `state`, which is replaced wholesale by every load.
     Keeping it in there meant re-sorting to name after each save, which is the
     one moment you are most likely to still be looking for the row you just
     changed. */
  var ui = { sort: 'name', profileLangA: null, profileLangB: null };

  var SORTS = ['name', 'region', 'partner', 'role', 'status'];

  function profileFor(id) {
    return (state.profiles || []).filter(function (p) { return p.user_id === id; })[0] || null;
  }

  /* Unpacks what staff_profiles_all packed — unit separator between fields,
     record separator between languages. See the query for why. */
  function profileText(p) {
    var out = {};
    if (!p || !p.translations) return out;
    String(p.translations).split('\u001e').forEach(function (rec) {
      var bits = rec.split('\u001f');
      if (bits[0]) out[bits[0]] = { role_title: bits[1] || '', bio: bits[2] || '' };
    });
    return out;
  }

  function sortedPeople() {
    var rows = (state.users || []).slice();
    var key = ui.sort;
    return rows.sort(function (a, b) {
      var pa = profileFor(a.id), pb = profileFor(b.id);
      var av = '', bv = '';
      if (key === 'region') { av = (pa && pa.region) || ''; bv = (pb && pb.region) || ''; }
      else if (key === 'partner') {
        av = (a.partner_names || []).join(', '); bv = (b.partner_names || []).join(', ');
      } else if (key === 'role') {
        av = (a.roles || []).slice().sort().join(','); bv = (b.roles || []).slice().sort().join(',');
      } else if (key === 'status') { av = a.status || ''; bv = b.status || ''; }

      /* EMPTY SORTS LAST, whichever direction. A blank region floating to the
         top of a list you sorted BY region is the opposite of what you asked
         for — you sorted to find the ones that have one. */
      if (av && !bv) return -1;
      if (!av && bv) return 1;
      if (av !== bv) return av.localeCompare(bv);
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }

  var PARTNER_STATUS = ['prospective', 'active', 'on_leave', 'alumni'];

  function renderPartners() {
    // Anyone who could own a partner. Board members are not offered: the role
    // is about oversight, not about being sent.
    var sel = $('admPartnerUser');
    if (sel) {
      sel.innerHTML = '<option value="">' + esc(tr('adm.nobodyYet')) + '</option>' +
        state.users.filter(function (u) { return u.roles.indexOf('staff') >= 0; })
          .map(function (u) {
            return '<option value="' + esc(u.id) + '">' + esc(u.name) + '</option>';
          }).join('');
    }

    $('admPartners').innerHTML = state.partners.map(function (p) {
      var active = state.languages.filter(function (l) { return l.is_active; });

      /* THE PARTNER'S OWN LANGUAGE IS ALWAYS AN OPTION, even if it has since
         been switched off site-wide. The list used to be the active languages
         only, so a partner set to a retired language showed the FIRST option
         instead — the page quietly reported the wrong answer, and saving
         anything else on the row would have written that wrong answer back. */
      var langs = active.slice();
      if (p.default_lang && !langs.some(function (l) { return l.code === p.default_lang; })) {
        langs.push({ code: p.default_lang, name: p.default_lang, retired: true });
      }

      return '<div class="adm-partner">' +
        '<div class="adm-who">' +
          '<span class="adm-name">' + esc(p.display_name) +
            '<span class="adm-status s-' + esc(p.status) + '">' +
              esc(tr('adm.pstatus.' + p.status)) + '</span></span>' +
          '<span class="adm-email">' + esc(p.slug) + ' · ' +
          p.member_count + ' ' + esc(tr('adm.members')) +
          (p.member_count ? '' : ' — ' + esc(tr('adm.nobodyAttached'))) + '</span>' +
        '</div>' +

        /* Both pickers in one column. They were separate grid children, so a
           three-column row wrapped and left the delete button stranded in the
           middle of the second line looking like it belonged to the language. */
        '<div class="adm-partner-set">' +
          '<label class="fld"><span>' + esc(tr('adm.pstatusLabel')) + '</span>' +
            '<select class="status-pick" data-partner-status="' + esc(p.id) + '">' +
              PARTNER_STATUS.map(function (s) {
                return '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' +
                  esc(tr('adm.pstatus.' + s)) + '</option>';
              }).join('') +
            '</select></label>' +
          '<label class="fld"><span>' + esc(tr('adm.defaultLang')) + '</span>' +
            '<select class="lang-pick" data-partner="' + esc(p.id) + '">' +
              langs.map(function (l) {
                return '<option value="' + esc(l.code) + '"' +
                  (l.code === p.default_lang ? ' selected' : '') + '>' +
                  esc((l.native_name || l.name) + ' (' + l.code + ')') +
                  (l.retired ? ' — ' + esc(tr('adm.langRetired')) : '') + '</option>';
              }).join('') +
            '</select>' +
            /* Named and explained, because there are TWO language settings in
               this console and they were indistinguishable here. This one is
               the partner's public site; the other is the person's own console
               language, on their People row. Reading one as the other is what
               makes a correct value look wrong. */
            '<span class="fld-hint">' + esc(tr('adm.defaultLangHint')) + '</span>' +
          '</label>' +
        '</div>' +

        '<button type="button" class="del danger" data-del-partner="' + esc(p.id) + '">' +
          esc(tr('adm.deletePartner')) + '</button>' +
      '</div>';
    }).join('') || '<p class="empty">—</p>';
  }

  function renderAudit() {
    if (!state.audit.length) {
      $('admAudit').innerHTML = '<p class="empty">' + esc(tr('adm.noAudit')) + '</p>';
      return;
    }
    $('admAudit').innerHTML = state.audit.map(function (a) {
      return '<div class="audit-r">' +
        '<span class="tnum">' + esc((a.at || '').replace('T', ' ').replace('Z', '')) + '</span>' +
        '<span><b>' + esc(a.action) + '</b></span>' +
        '<span>' + esc(a.entity) + (a.entity_id ? ' · ' + esc(a.entity_id) : '') +
          ' — ' + esc(a.actor || 'system') + '</span></div>';
    }).join('');
  }

  /* ---- wiring --------------------------------------------------------- */

  var PANEL_MS = 600;
  function reducedMotion() {
    return window.matchMedia &&
           window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* The same measure-then-animate as the milestone panel: height cannot
     transition to or from `auto`, and a max-height guess makes short panels
     appear to snap open and then hang. */
  function slide(el, opening) {
    return new Promise(function (resolve) {
      if (reducedMotion()) {
        el.hidden = !opening; el.style.height = ''; el.style.opacity = '';
        return resolve();
      }
      el.classList.add('is-animating');
      if (opening) {
        el.hidden = false;
        el.style.height = '0px'; el.style.opacity = '0';
        void el.offsetHeight;
        el.style.height = el.scrollHeight + 'px'; el.style.opacity = '1';
      } else {
        el.style.height = el.scrollHeight + 'px'; el.style.opacity = '1';
        void el.offsetHeight;
        el.style.height = '0px'; el.style.opacity = '0';
      }
      setTimeout(function () {
        if (!opening) el.hidden = true;
        el.style.height = ''; el.style.opacity = '';
        el.classList.remove('is-animating');
        resolve();
      }, PANEL_MS);
    });
  }

  async function togglePerson(id) {
    var wasOpen = state.editing;
    // Close whatever is open first, so two panels are never moving at once.
    if (wasOpen && wasOpen !== id) {
      var prev = document.querySelector('[data-person="' + wasOpen + '"] .adm-panel');
      if (prev && !prev.hidden) await slide(prev, false);
      document.querySelector('[data-person="' + wasOpen + '"]')
        .classList.remove('is-open');
    }

    var card = document.querySelector('[data-person="' + id + '"]');
    var panel = card && card.querySelector('.adm-panel');
    if (!panel) return;

    if (wasOpen === id) {
      state.editing = null;
      card.classList.remove('is-open');
      card.querySelector('.adm-row').setAttribute('aria-expanded', 'false');
      return slide(panel, false);
    }

    state.editing = id;
    card.classList.add('is-open');
    card.querySelector('.adm-row').setAttribute('aria-expanded', 'true');
    await slide(panel, true);
    var top = window.scrollY + card.getBoundingClientRect().top -
              (document.querySelector('.top') || { offsetHeight: 0 }).offsetHeight - 12;
    window.scrollTo({ top: Math.max(0, top),
                      behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /* The toggle only reveals the form. NOTHING is written until Save — turning
     somebody's page off is a publication decision and should not happen
     because a finger landed on a switch while scrolling. */
  function toggleProfilePublic(btn) {
    var on = btn.getAttribute('aria-checked') !== 'true';
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.querySelector('.switch-state').textContent = on ? 'On' : 'Off';
    var body = btn.parentNode.querySelector('.pf-body');
    if (body) body.hidden = !on;
  }

  async function saveProfile(userId, btn) {
    var sect = document.querySelector('[data-profile="' + userId + '"]');
    if (!sect) return;
    var status = sect.querySelector('[data-pf-status]');
    var val = function (name) {
      var el = sect.querySelector('.pf-grid [data-pf="' + name + '"]');
      return el ? el.value.trim() : '';
    };
    var shot = function (kind) {
      var el = sect.querySelector('[data-slot="' + kind + '"] [data-pf="' + kind + '"]');
      return el ? el.value.trim() : '';
    };

    /* Both columns, keyed by whichever language each is showing. Reading the
       pickers rather than assuming a and b are the first two languages — they
       are whatever the person editing chose. */
    var text = {};
    ['a', 'b'].forEach(function (which) {
      var pick = sect.querySelector('[data-plang="' + which + '"]');
      if (!pick || !pick.value) return;
      var role = sect.querySelector('[data-pf="role_title"][data-col="' + which + '"]');
      var bio = sect.querySelector('[data-pf="bio"][data-col="' + which + '"]');
      text[pick.value] = {
        role_title: role ? role.value.trim() : '',
        bio: bio ? bio.value.trim() : ''
      };
    });

    var payload = {
      user_id: userId,
      is_public: sect.querySelector('[data-pf-public]').getAttribute('aria-checked') === 'true',
      slug: val('slug'),
      region: val('region'),
      public_email: val('public_email'),
      sort_order: parseInt(val('sort_order'), 10) || 0,
      /* Read from the slots, not the grid — the hidden field each one carries
         already holds the URL the upload returned. */
      photo: shot('photo'),
      bio_photo: shot('bio_photo'),
      text: text
    };

    btn.disabled = true;
    if (status) status.textContent = tr('adm.pf.saving');
    try {
      var res = await fetch('/api/admin/profile', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var body = await res.json();
      if (!res.ok) {
        if (status) status.textContent = body.error || tr('err.refused');
        return;
      }
      /* The database write and the repository write are separate, and the
         second can fail alone. Saying which happened beats a tick that means
         "half of it". */
      if (status) {
        status.textContent = body.file
          ? tr('adm.pf.saved')
          : tr('adm.pf.savedNoFile') + (body.fileError ? ' — ' + body.fileError : '');
      }
      await load();
    } catch (e) {
      if (status) status.textContent = tr('err.unreachable') + ' ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  /* Re-reads the columns when a picker changes, so switching language shows
     that language's text rather than leaving the previous one in the box. */
  document.addEventListener('change', function (e) {
    var file = e.target.closest('[data-pf-file]');
    if (file) {
      var f = file.files && file.files[0];
      if (f) uploadPhoto(file.dataset.user, file.dataset.pfFile, f, file.closest('[data-slot]'));
      file.value = '';   // so choosing the same file twice fires again
      return;
    }

    var pick = e.target.closest('[data-plang]');
    if (!pick) return;
    if (pick.dataset.plang === 'a') ui.profileLangA = pick.value;
    else ui.profileLangB = pick.value;
    render();
  });

  document.addEventListener('click', function (e) {
    /* Checked BEFORE the row, because every one of these lives inside the
       expanded panel and the panel is inside the person — letting the row
       handler see them first would collapse the row you are editing. */
    var sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      ui.sort = sortBtn.dataset.sort;
      return render();
    }

    var pub = e.target.closest('[data-pf-public]');
    if (pub) return toggleProfilePublic(pub);

    var save = e.target.closest('[data-pf-save]');
    if (save) return saveProfile(save.dataset.pfSave, save);

    /* The visible button opens the real file input, which is hidden because
       browsers will not let it be styled and it reads as a foreign control. */
    var pick = e.target.closest('[data-pf-pick]');
    if (pick) {
      var slotEl = pick.closest('[data-slot]');
      return slotEl.querySelector('[data-pf-file]').click();
    }

    var clear = e.target.closest('[data-pf-clear]');
    if (clear) {
      var cs = clear.closest('[data-slot]');
      cs.querySelector('[data-pf="' + clear.dataset.pfClear + '"]').value = '';
      cs.querySelector('.pf-shot').innerHTML =
        '<span class="pf-empty">' + esc(tr('adm.pf.noPhoto')) + '</span>';
      clear.remove();
      /* Removed from the FORM, not from the bucket. Save is what makes it
         true, and the object stays reachable until nothing points at it —
         deleting on click would break the live page before Publish ran. */
      return;
    }

    var row = e.target.closest('.adm-row');
    if (row) {
      return togglePerson(row.closest('[data-person]').dataset.person);
    }

    var sw = e.target.closest('[data-role]');
    if (sw) return roleToggle(sw);
    var chip = e.target.closest('[data-partner][data-user]');
    if (chip) {
      var give = !chip.classList.contains('on');
      return change({ user_id: chip.dataset.user, partner_id: chip.dataset.partner,
                      partner_role: 'view', grant: give }, chip);
    }
    var dp = e.target.closest('[data-del-partner]');
    if (dp) return deletePartner(dp.dataset.delPartner, dp);

    var ri = e.target.closest('[data-reinvite]');
    if (ri) {
      return change({ user_id: ri.dataset.reinvite, resend_invite: true }, ri)
        .then(function (body) { if (body) toast(tr('toast.inviteSent'), 'ok'); });
    }

    var va = e.target.closest('[data-view-as]');
    if (va) return viewAs(va.dataset.viewAs, va.dataset.name, va);

    var rm = e.target.closest('[data-remove]');
    if (rm) {
      var person = state.users.filter(function (x) { return x.id === rm.dataset.remove; })[0];
      if (!person) return;
      return window.StaffConfirm({
        title: tr('adm.removePerson'),
        body: person.name + ' (' + person.email + ')',
        note: tr('adm.confirmRemove'),
        confirm: tr('adm.confirmRemoveDo'),
        cancel: tr('ms.cancel'),
        danger: true
      }).then(function (ok) { if (ok) removeUser(rm.dataset.remove, rm); });
    }
  });

  async function roleToggle(sw) {
    var role = sw.dataset.role;
    var grant = sw.getAttribute('aria-checked') !== 'true';
    var u = state.users.filter(function (x) { return x.id === sw.dataset.user; })[0];
    if (!u) return;

    if (CONFIRM_ROLES[role]) {
      var ok = await window.StaffConfirm({
        title: (grant ? tr('adm.confirm.grant') : tr('adm.confirm.revoke')) +
               ' ' + ROLE_LABEL[role],
        body: u.name + ' (' + u.email + ')',
        note: tr('adm.confirm.' + role + (grant ? 'On' : 'Off')),
        confirm: grant ? tr('adm.confirm.doGrant') : tr('adm.confirm.doRevoke'),
        cancel: tr('ms.cancel'),
        danger: !grant || role === 'admin'
      });
      if (!ok) return;
    }

    var body = await change({ user_id: sw.dataset.user, role: role, grant: grant }, sw);

    // Granting Partner builds a ministry. Say what appeared, and where.
    if (body && body.created_partner) {
      await window.StaffConfirm({
        title: tr('adm.partnerCreated'),
        body: tr('adm.partnerCreatedBody').replace('{name}', body.created_partner.display_name),
        confirm: tr('adm.goToPartners'),
        cancel: tr('adm.stayHere')
      }).then(function (go) { if (go) location.href = '/admin/partners/'; });
    }
  }

  /* Deleting a partner destroys supporters and their contact history. The
     dialog names what goes, counted from the database rather than described
     in the abstract — "this cannot be undone" means nothing next to
     "4 supporters, 8 interactions". */
  async function deletePartner(id, btn) {
    var p = state.partners.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var s = (state.partner_stats || {})[id] || {};

    var parts = [];
    function add(n, key) { if (n) parts.push(n + ' ' + tr('adm.count.' + key)); }
    add(s.contacts, 'contacts');
    add(s.interactions, 'interactions');
    add(s.goals, 'goals');
    add(s.milestones, 'milestones');
    add(s.resources, 'resources');
    add(s.directory, 'directory');
    add(s.live_keys, 'liveKeys');
    add(s.members, 'members');

    var ok = await window.StaffConfirm({
      title: tr('adm.deletePartner'),
      body: parts.length
        ? tr('adm.deleteBody') + ' ' + parts.join(', ') + '.'
        : tr('adm.deleteEmpty'),
      note: tr('adm.deleteNote'),
      // The name goes in the label, because typing DELETE proves you meant to
      // delete something — not that you picked the right row.
      typeLabel: p.display_name + ' —',
      type: 'DELETE',
      confirm: tr('adm.deleteDo'),
      cancel: tr('ms.cancel'),
      danger: true
    });
    if (!ok) return;

    btn.disabled = true;
    try {
      var res = await fetch(API + '?kind=partner&id=' + encodeURIComponent(id) +
                            '&confirm=DELETE', {
        method: 'DELETE', credentials: 'same-origin'
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
      await load();
      toast(tr('toast.deleted'), 'ok');
    } catch (e) {
      await load();
      toast(e.message, 'err');
    } finally { btn.disabled = false; }
  }

  async function removeUser(id, btn) {
    btn.disabled = true;
    try {
      var res = await fetch(API + '?id=' + encodeURIComponent(id), {
        method: 'DELETE', credentials: 'same-origin'
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
      await load();
      toast(tr('toast.deleted'), 'ok');
    } catch (e) {
      await load();
      toast(e.message, 'err');
    } finally { btn.disabled = false; }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var row = e.target.closest('.adm-row');
    if (!row) return;
    e.preventDefault();
    togglePerson(row.closest('[data-person]').dataset.person);
  });

  document.addEventListener('change', function (e) {
    if (e.target.classList.contains('status-pick')) {
      return change({ user_id: e.target.dataset.user, status: e.target.value }, e.target);
    }
    if (e.target.dataset.partnerStatus) {
      return change({ for_partner: e.target.dataset.partnerStatus,
                      partner_status: e.target.value }, e.target);
    }
    if (e.target.classList.contains('lang-pick') && e.target.dataset.partner) {
      return change({ for_partner: e.target.dataset.partner, default_lang: e.target.value }, e.target);
    }
  });

  if ($('admAddUser')) {
    $('admAddUser').addEventListener('click', function () {
      $('admUserForm').hidden = false;
      $('admName').focus();
    });
    $('admCancel').addEventListener('click', function () { $('admUserForm').hidden = true; });
    $('admUserForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        var res = await fetch(API, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: $('admName').value, email: $('admEmail').value })
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
        $('admUserForm').hidden = true;
        $('admName').value = ''; $('admEmail').value = '';
        await load();
        // The note matters more than the confirmation: the row exists, the
        // account does not, and nobody can sign in until both are true.
        toast(body.note || tr('toast.saved'), 'ok');
      } catch (err) {
        toast(err.message, 'err');
      } finally { btn.disabled = false; }
    });
  }

  if ($('admAddPartner')) {
    $('admAddPartner').addEventListener('click', function () {
      $('admPartnerForm').hidden = false;
      $('admPartnerName').focus();
    });
    $('admPartnerCancel').addEventListener('click', function () {
      $('admPartnerForm').hidden = true;
    });
    $('admPartnerForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        var res = await fetch(API, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'partner',
            display_name: $('admPartnerName').value,
            user_id: $('admPartnerUser').value || undefined
          })
        });
        var body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || ('failed (' + res.status + ')'));
        $('admPartnerForm').hidden = true;
        $('admPartnerName').value = '';
        await load();
        toast(tr('toast.saved'), 'ok');
      } catch (err) { toast(err.message, 'err'); }
      finally { btn.disabled = false; }
    });
  }

  load();
})();
