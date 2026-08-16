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

  var ROLE_LABEL = { admin: 'Administration', staff: 'Staff', board: 'Board' };
  var ALL_ROLES = ['admin', 'staff', 'board'];

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
      document.querySelectorAll('.adm-people, .adm-partners, .audit, .tiles, .quick, .ms-bar')
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
    if (!state.users.length) {
      $('admPeople').innerHTML = '<p class="empty">' + esc(tr('adm.noPeople')) + '</p>';
      return;
    }

    $('admPeople').innerHTML = state.users.map(function (u) {
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
          '<div class="adm-tags">' + roleTags + '</div>' +
          '<div class="adm-access">' +
            (u.partner_names.length
              ? esc(u.partner_names.join(', '))
              : '<span class="adm-none">' + esc(tr('adm.noPartners')) + '</span>') +
          '</div>' +
          '<span class="adm-status s-' + esc(u.status) + '">' +
            esc(tr('adm.status.' + u.status)) + '</span>' +
        '</div>' +

        (open ? personPanel(u) : '') +
      '</div>';
    }).join('');
  }

  /* Everything you can change about one person, in one place, with what each
     control actually does written next to it. */
  function personPanel(u) {
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

    return '<div class="adm-panel">' +
      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('adm.roles')) + '</span>' +
        '<div class="adm-roles">' + roles + '</div>' +
      '</div>' +

      '<div class="adm-section">' +
        '<span class="adm-label">' + esc(tr('adm.partnerAccess')) + '</span>' +
        '<div class="adm-chips">' + (partners || '<span class="hint">—</span>') + '</div>' +
        '<span class="switch-note">' + esc(tr('adm.partnerAccessNote')) + '</span>' +
      '</div>' +

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
        '<button type="button" class="del" data-remove="' + esc(u.id) + '">' +
          esc(tr('adm.removePerson')) + '</button>' +
      '</div>' +
    '</div>';
  }

  function renderPartners() {
    $('admPartners').innerHTML = state.partners.map(function (p) {
      var langs = state.languages.filter(function (l) { return l.is_active; });
      return '<div class="adm-partner">' +
        '<div><span class="adm-name">' + esc(p.display_name) + '</span>' +
          '<span class="adm-email">' + esc(p.slug) + ' · ' +
          p.member_count + ' ' + esc(tr('adm.members')) + '</span></div>' +
        '<label class="fld"><span>' + esc(tr('adm.defaultLang')) + '</span>' +
          '<select class="lang-pick" data-partner="' + esc(p.id) + '">' +
            langs.map(function (l) {
              return '<option value="' + esc(l.code) + '"' +
                (l.code === p.default_lang ? ' selected' : '') + '>' +
                esc((l.native_name || l.name) + ' (' + l.code + ')') + '</option>';
            }).join('') +
          '</select></label>' +
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

  document.addEventListener('click', function (e) {
    var row = e.target.closest('.adm-row');
    if (row) {
      var id = row.closest('[data-person]').dataset.person;
      state.editing = state.editing === id ? null : id;
      return renderPeople();
    }

    var sw = e.target.closest('[data-role]');
    if (sw) {
      var grant = sw.getAttribute('aria-checked') !== 'true';
      return change({ user_id: sw.dataset.user, role: sw.dataset.role, grant: grant }, sw);
    }
    var chip = e.target.closest('[data-partner][data-user]');
    if (chip) {
      var give = !chip.classList.contains('on');
      return change({ user_id: chip.dataset.user, partner_id: chip.dataset.partner,
                      partner_role: 'view', grant: give }, chip);
    }
    var rm = e.target.closest('[data-remove]');
    if (rm) {
      var u = state.users.filter(function (x) { return x.id === rm.dataset.remove; })[0];
      if (!u) return;
      if (!confirm(tr('adm.confirmRemove') + '\n\n' + u.name + ' (' + u.email + ')')) return;
      return removeUser(rm.dataset.remove, rm);
    }
  });

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
    var id = row.closest('[data-person]').dataset.person;
    state.editing = state.editing === id ? null : id;
    renderPeople();
  });

  document.addEventListener('change', function (e) {
    if (e.target.classList.contains('status-pick')) {
      return change({ user_id: e.target.dataset.user, status: e.target.value }, e.target);
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

  load();
})();
