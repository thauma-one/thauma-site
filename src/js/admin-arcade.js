/* ============================================================
   admin-arcade.js — Website › Arcade: the hidden arcade's control room
   ============================================================
   Chase, 2026-10-06: "Let's create an arcade editor for the admins.
   It can turn on and off games on the live site (turns it to out of
   order) and can manage the high scores and delete/??? names if
   needed. As well as whatever other functionality you think it may
   need."

   Three parts, all from /api/admin/arcade (workers/src/admin-arcade.js):
   - GAMES: each game open or out of order, on the preview site and
     for everyone — the same two columns as Settings' page switches.
   - HIGH SCORES: every board, each score with its date; hide a name
     (???), block it everywhere, remove the score, or clear a board.
     Clearing is how old scores go after a game's scoring changes.
   - BLOCKED NAMES: names that become ??? on every score, now and later.

   SAVES AT ONCE, like Forms: a switch flipped here is the live site's
   arcade on the next visit, no Publish. Every answer is the whole
   state, and the screen redraws from it.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('aeRoot');
  if (!root) return;

  var API = '/api/admin/arcade';
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
  function name(id) { return tr('ae.game.' + id); }
  function day(at) {
    if (!at) return '';
    try { return new Date(at).toLocaleDateString(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  var state = null, busy = false;

  function sw(id, column, on) {
    return '<span class="v-cell is-' + column + '">' +
      '<button type="button" class="switch small" role="switch" data-game="' + id + '" data-column="' + column + '"' +
      ' aria-checked="' + (on ? 'true' : 'false') + '"' + (on ? ' data-on="1"' : '') + '>' +
      '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') + '</span><span class="switch-knob"></span></span>' +
      '</button></span>';
  }

  function render() {
    if (!state) return;
    $('aeGames').innerHTML = state.games.map(function (g) {
      return '<div class="v-row"><div class="v-label"><span class="s-name">' + esc(name(g.id)) + '</span>' +
        (!g.live ? ' <span class="ae-out" data-i18n="ae.out">' + esc(tr('ae.out')) + '</span>' : '') + '</div>' +
        sw(g.id, 'dev', g.dev) + sw(g.id, 'live', g.live) + '<span></span></div>';
    }).join('');

    $('aeBoards').innerHTML = state.games.map(function (g) {
      var rows = g.scores.map(function (sc, i) {
        var hidden = sc.name === '???';
        return '<li><span class="ae-rank">' + (i + 1) + '</span>' +
          '<b class="ae-name' + (hidden ? ' is-hidden' : '') + '">' + esc(sc.name) + '</b>' +
          '<span class="ae-score">' + (sc.score | 0) + '</span>' +
          '<span class="ae-day">' + esc(day(sc.at)) + '</span>' +
          '<span class="ae-acts">' +
            (hidden ? '' : '<button type="button" class="ghost-btn xs" data-act="hide" data-i="' + i + '" data-game="' + g.id + '" title="' + esc(tr('ae.hideTitle')) + '">???</button>' +
              '<button type="button" class="ghost-btn xs" data-act="block" data-i="' + i + '" data-game="' + g.id + '">' + esc(tr('ae.block')) + '</button>') +
            '<button type="button" class="ae-x" data-act="remove" data-i="' + i + '" data-game="' + g.id + '" aria-label="' + esc(tr('ae.remove')) + '" title="' + esc(tr('ae.remove')) + '">&times;</button>' +
          '</span></li>';
      }).join('');
      return '<div class="ae-board">' +
        '<div class="ae-board-head"><span class="s-name">' + esc(name(g.id)) + '</span>' +
          (g.scores.length ? '<button type="button" class="ghost-btn xs" data-act="clear" data-game="' + g.id + '">' + esc(tr('ae.clear')) + '</button>' : '') + '</div>' +
        (rows ? '<ol>' + rows + '</ol>' : '<p class="ae-empty">' + esc(tr('ae.empty')) + '</p>') +
      '</div>';
    }).join('');

    $('aeBlocked').innerHTML = state.blocked.length
      ? state.blocked.map(function (b) {
          return '<span class="ae-chip"><b>' + esc(b.name) + '</b>' +
            '<button type="button" class="ae-x" data-act="unblock" data-name="' + esc(b.name) + '" aria-label="' + esc(fill('ae.unblock', { name: b.name })) + '" title="' + esc(fill('ae.unblock', { name: b.name })) + '">&times;</button></span>';
        }).join('')
      : '<p class="ae-empty">' + esc(tr('ae.noneBlocked')) + '</p>';
  }

  async function call(body) {
    busy = true; root.classList.add('is-busy');
    try {
      var res = await fetch(API, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
      var data = await res.json().catch(function () { return {}; });
      if (res.status === 409 && data.games) { state = data; render(); toast(tr('ae.changed'), 'warn'); return false; }
      if (!res.ok) {
        if (res.status === 403) { $('aeProblem').textContent = tr('ae.adminsOnly'); $('aeProblem').hidden = false; }
        else toast(data.error || tr('err.refused'), 'error');
        return false;
      }
      $('aeProblem').hidden = true;
      state = data; render();
      if (body) toast(tr('ws.saved'));
      return true;
    } catch (e) {
      toast(tr('err.refused'), 'error');
      return false;
    } finally { busy = false; root.classList.remove('is-busy'); }
  }

  root.addEventListener('click', async function (e) {
    if (busy) return;
    var s = e.target.closest('[role=switch][data-game]');
    if (s) {
      var on = s.getAttribute('aria-checked') !== 'true';
      return call({ action: 'game', game: s.dataset.game, column: s.dataset.column, on: on });
    }
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.dataset.act, g = b.dataset.game && state.games.find(function (x) { return x.id === b.dataset.game; });
    var sc = g && b.dataset.i != null ? g.scores[+b.dataset.i] : null;
    if (act === 'unblock') return call({ action: 'unblock', name: b.dataset.name });
    if (act === 'hide') return call({ action: 'hide', game: g.id, name: sc.name, score: sc.score });
    if (act === 'block') {
      var okB = await window.StaffConfirm({ title: fill('ae.blockQ', { name: sc.name }), confirm: tr('ae.block'), cancel: tr('ms.cancel') });
      if (okB) call({ action: 'block', name: sc.name });
      return;
    }
    if (act === 'remove') {
      var okR = await window.StaffConfirm({ title: fill('ae.removeQ', { name: sc.name, score: sc.score, game: name(g.id) }), confirm: tr('ae.remove'), cancel: tr('ms.cancel'), danger: true });
      if (okR) call({ action: 'remove', game: g.id, name: sc.name, score: sc.score });
      return;
    }
    if (act === 'clear') {
      var okC = await window.StaffConfirm({ title: fill('ae.clearQ', { game: name(g.id) }), confirm: tr('ae.clear'), cancel: tr('ms.cancel'), danger: true });
      if (okC) call({ action: 'clear', game: g.id });
    }
  });

  $('aeBlockForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('aeBlockName').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!v || busy) return;
    call({ action: 'block', name: v }).then(function (ok) { if (ok) $('aeBlockName').value = ''; });
  });
  $('aeBlockName').addEventListener('input', function (e) {
    var v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (v !== e.target.value) e.target.value = v;
  });

  call(null);
})();
