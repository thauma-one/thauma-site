/* ============================================================
   admin-forms.js — Website › Forms: Thauma's own forms
   ============================================================
   Chase, 2026-09-27: "staff is only for staff functions and admin
   is for admin". Thauma's contact and sign-up forms left the staff
   console's Sharing page for here.

   What happens to what a visitor sends, and nothing else (see
   website/forms.njk): the contact form's Live switch, where its
   messages go, who they are sent as and the reasons a visitor
   picks from; which of Thauma's lists the sign-up form offers.
   Their words are site words, in Pages.

   ONE SOURCE, THE SAME CALLS STAFF SHARING MADE. /api/staff-mailing
   ?scope=organization holds Thauma's lists, contact form, reasons
   and sending addresses; the contact form saves whole (action
   contact-form) and a list saves whole, as the Mail page saves it.

   A WORKING COPY AND ONE BAR, like every screen in the console.
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('wfRoot');
  if (!root) return;

  var API = '/api/staff-mailing?scope=organization';
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
    if (st) st.textContent = on ? 'On' : 'Off';
  }

  var state = { mail: null, saved: null, draft: null, form: 'contact', busy: false,
                writing: 'en', beside: null };

  /* THE REASONS IN EVERY LANGUAGE the site publishes (0041). English is
     thauma.one's own and each reason's fallback name (`label`); the rest are
     `labels`. The site's languages are the ones this build publishes
     (#libLangs, website.njk). */
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

  function snapshot() {
    var m = state.mail || {}, c = m.contact || {}, open = {};
    (m.lists || []).forEach(function (l) { open[l.id] = !!l.is_open; });
    return {
      contact: {
        deliver_to: c.deliver_to || '', from_address: c.from_address || '', is_open: !!c.is_open,
        topics: (m.topics || []).map(function (t) {
          return { label: t.label || '', deliver_to: t.deliver_to || '', labels: Object.assign({}, t.labels || {}) };
        })
      },
      lists: open
    };
  }

  function changes() {
    var a = state.saved, b = state.draft, out = { lists: [] };
    if (!a || !b) return out;
    out.contact = !same(a.contact, b.contact);
    out.lists = Object.keys(b.lists).filter(function (id) { return a.lists[id] !== b.lists[id]; });
    return out;
  }
  function count() { var c = changes(); return (c.contact ? 1 : 0) + c.lists.length; }

  /* ---- drawing --------------------------------------------------------- */

  function drawPick() {
    [].forEach.call(root.querySelectorAll('[data-wf]'), function (b) {
      var on = b.dataset.wf === state.form;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    [].forEach.call(root.querySelectorAll('[data-wf-panel]'), function (p) {
      p.hidden = p.dataset.wfPanel !== state.form;
    });
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

  function drawWriting() {
    $('wfWritingRow').hidden = LANGS.length < 2;
    if (LANGS.indexOf(state.writing) === -1) state.writing = HOME;
    var others = LANGS.filter(function (c) { return c !== state.writing; });
    if (others.indexOf(state.beside) === -1) state.beside = others[0] || null;
    $('wfWriting').innerHTML = LANGS.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + '</option>';
    }).join('');
    $('wfWriting').value = state.writing;
    $('wfBesideWrap').hidden = !others.length;
    $('wfBeside').innerHTML = others.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(langName(c)) + '</option>';
    }).join('');
    $('wfBeside').value = state.beside || '';
  }

  function drawTopics() {
    var t = state.draft.contact.topics, w = state.writing, b = state.beside;
    $('wfTopics').innerHTML = t.length ? t.map(function (x, i) {
      var ref = b ? topicName(x, b) : '';
      return '<div class="ct-topic" data-topic="' + i + '">' +
        '<span class="ct-topic-name">' +
          (ref ? '<small class="ms-ref" lang="' + esc(b) + '">' + esc(ref) + '</small>' : '') +
          '<input type="text" class="ct-topic-label" maxlength="80" lang="' + esc(w) + '"' +
            ' value="' + esc(topicName(x, w)) + '"' +
            ' placeholder="' + esc(w === HOME ? tr('ml.ctTopicLabel') : x.label) + '">' +
        '</span>' +
        '<input type="email" class="ct-topic-to" maxlength="200" value="' + esc(x.deliver_to) + '"' +
          ' placeholder="' + esc(tr('ml.ctTopicTo')) + '">' +
        '<span class="ct-topic-move">' +
          '<button type="button" data-move-topic="' + i + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') +
            ' aria-label="' + esc(tr('ml.ctMoveUp')) + '">&#9650;</button>' +
          '<button type="button" data-move-topic="' + i + '" data-dir="1"' + (i === t.length - 1 ? ' disabled' : '') +
            ' aria-label="' + esc(tr('ml.ctMoveDown')) + '">&#9660;</button>' +
        '</span>' +
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
        '<span class="switch-track"><span class="switch-state">' + (on ? 'On' : 'Off') +
        '</span><span class="switch-knob"></span></span>' +
        '<span class="switch-label">' + esc(l.name) + '</span></button>';
    }).join('') : '<p class="empty">' + esc(tr('ml.empty')) + '</p>';
  }

  function drawBar() {
    var n = count();
    $('wfBar').hidden = !n;
    $('wfCount').textContent = n === 1 ? tr('up.pending1') : fill('up.pendingN', { n: n });
  }

  function drawAll() { drawPick(); drawWriting(); drawContact(); drawLists(); drawBar(); }

  /* ---- loading and saving ---------------------------------------------- */

  async function call(method, body) {
    var res = await fetch(API, {
      method: method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || (tr('err.refused') + ' (' + res.status + ')'));
    return out;
  }

  async function load() {
    try { state.mail = await call('GET'); }
    catch (e) { $('wfProblem').textContent = e.message; $('wfProblem').hidden = false; return; }
    $('wfProblem').hidden = true;
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
        action: 'contact-form',
        deliver_to: k.deliver_to.trim(), from_address: k.from_address, is_open: k.is_open,
        /* The form's old word columns ride along unchanged; thauma.one's
           words are its own site words (Pages). */
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
          id: l.id, name: l.name, description: l.description || '',
          from_name: l.from_name, from_email: l.from_email, reply_to: l.reply_to || '',
          /* Every field: one left out is saved as off. */
          is_open: !!d.lists[l.id], archive_public: !!l.archive_public, form_thanks_url: l.form_thanks_url || '',
          form_heading: l.form_heading || '', form_blurb: l.form_blurb || '', form_button: l.form_button || ''
        });
      });
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

  root.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-wf]');
    if (pick) { state.form = pick.dataset.wf; drawPick(); return; }
    if (!state.draft) return;
    var t = state.draft.contact.topics;
    var mv = e.target.closest('[data-move-topic]');
    if (mv) {
      var i = +mv.dataset.moveTopic, j = i + (+mv.dataset.dir);
      if (j < 0 || j >= t.length) return;
      var x = t[i]; t[i] = t[j]; t[j] = x;
      drawTopics(); drawBar(); return;
    }
    var dr = e.target.closest('[data-drop-topic]');
    if (dr) { t.splice(+dr.dataset.dropTopic, 1); drawTopics(); drawBar(); return; }
    var li = e.target.closest('[data-list]');
    if (li) { state.draft.lists[li.dataset.list] = !state.draft.lists[li.dataset.list]; drawLists(); drawBar(); }
  });
  $('wfCtOpen').addEventListener('click', function () {
    if (!state.draft) return;
    state.draft.contact.is_open = !state.draft.contact.is_open;
    setSwitch(this, state.draft.contact.is_open); drawBar();
  });
  $('wfCtTo').addEventListener('input', function () { if (state.draft) { state.draft.contact.deliver_to = this.value; drawBar(); } });
  $('wfCtFrom').addEventListener('change', function () { if (state.draft) { state.draft.contact.from_address = this.value; drawBar(); } });
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
    drawBar();
  });
  $('wfAddTopic').addEventListener('click', function () {
    if (!state.draft) return;
    state.draft.contact.topics.push({ label: '', deliver_to: '', labels: {} });
    drawTopics(); drawBar();
    var rows = root.querySelectorAll('#wfTopics .ct-topic-label');
    if (rows.length) rows[rows.length - 1].focus();
  });
  $('wfWriting').addEventListener('change', function () { state.writing = this.value; drawWriting(); drawTopics(); });
  $('wfBeside').addEventListener('change', function () { state.beside = this.value; drawTopics(); });
  $('wfSave').addEventListener('click', save);
  $('wfDiscard').addEventListener('click', discard);

  window.addEventListener('beforeunload', function (e) {
    if (!count()) return;
    e.preventDefault();
    e.returnValue = '';
  });

  load();
})();
