/* ============================================================
   composer.js — writing and sending a mailing
   ============================================================
   The only bundled script in the console. Everything else is a plain script
   tag; this one earns a build step because it runs TipTap, and TipTap is a
   package tree rather than a file. See .eleventy.js for the hook that builds
   it, and editor.js for the editor itself.

   NO "To" FIELD, AND THAT IS DELIBERATE.
   ------------------------------------------------------------
   A composer with To / Cc / Bcc is a personal mail client. This one sends to a
   LIST: every confirmed subscriber gets their own separate message carrying
   their own unsubscribe link and List-Unsubscribe header. Those cannot be
   reconciled —

     - one message to many can only carry one unsubscribe link, which would
       remove whoever pressed it from somebody else's row, or nobody's;
     - a typed address bypasses the double opt-in this whole system rests on;
     - bulk Bcc is a well-known spam signal, and one flagged send damages the
       sending domain for every list on it.

   So the recipient row is a list picker, and the count beside it is real.
   ============================================================ */
import { EditorState } from "@tiptap/pm/state";
import { createEditor, applyLink, insertImage } from "./editor.js";

(function () {
  "use strict";
  const mount = document.getElementById("cpBody");
  if (!mount) return;

  const API = "/api/staff-mailing";
  const $ = (id) => document.getElementById(id);
  const tr = (k) => (window.StaffI18n && window.StaffI18n.t(k)) || k;
  const toast = (m, k) => { if (window.StaffToast) window.StaffToast(m, k); };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const cp = {
    lists: [], mailings: [], attachments: [],
    you: null, testInbox: null,
    listId: null, id: null,
    savedHtml: "", savedSubject: "", savedPreheader: "", dirty: false,
    /* The draft as the SERVER last gave it — what is stored, cleaned — for a
       save to be compared against (workers/src/lib/fresh.js). */
    base: null,
  };
  /* The save that is out, if any, and the pending autosave. Up here because
     the editor's change handler reaches them from the moment it exists. */
  let saving = null;
  let autoTimer = null;
  const AUTOSAVE_MS = 3000;

  /* The composer shares the mailing page's scope switch: whose lists these are
     is one decision for the whole screen, not one per panel. */
  function url(extra) {
    const qs = [];
    const scope = window.StaffMailing && window.StaffMailing.scope();
    if (scope === "organization") qs.push("scope=organization");
    if (extra) qs.push(extra);
    return API + (qs.length ? "?" + qs.join("&") : "");
  }

  /* ---- the editor ----------------------------------------------------- */

  const { editor, refresh } = createEditor({
    element: mount,
    toolbar: document.querySelector(".cp-tools"),
    onChange: () => { markDirty(); measureSoon(); },
    varLabels: { first_name: tr("ml.cpVarFirst"), name: tr("ml.cpVarFull") },
    onRefresh: (ed) => showChoices(ed),
  });

  /* ---- size, color, link, name: one row under the toolbar --------------
     Each opens a row of choices instead of a dialog or a prompt, and the
     size and color buttons show what the cursor is in now. */
  const ROWS = { size: "cpSizeRow", color: "cpColorRow", link: "cpLinkRow", variable: "cpVarRow" };

  function showChoices(ed) {
    const sz = ed.getAttributes("size").sz || "";
    const tone = ed.getAttributes("tone").c || "";
    document.querySelectorAll("#cpSizeRow [data-size]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.size === sz ? "true" : "false");
    });
    document.querySelectorAll("#cpColorRow [data-tone]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.tone === tone ? "true" : "false");
    });
    /* A picked color shows in the picker, which reads as chosen. */
    const anyColor = /^#[0-9a-f]{6}$/i.test(tone);
    $("cpColorAny").closest(".cp-tone-any").classList.toggle("is-on", anyColor);
    if (anyColor) $("cpColorAny").value = tone;
    const sizeBtn = document.querySelector('.cp-tools [data-cmd="size"]');
    if (sizeBtn) sizeBtn.dataset.sz = sz;
    const colorBtn = document.querySelector('.cp-tools [data-cmd="color"]');
    if (colorBtn) {
      colorBtn.dataset.tone = anyColor ? "any" : tone;
      colorBtn.style.setProperty("--any", anyColor ? tone : "");
    }
  }

  function openRow(which) {
    for (const [cmd, id] of Object.entries(ROWS)) {
      const open = cmd === which && $(id).hidden;
      $(id).hidden = !open;
      const b = document.querySelector(`.cp-tools [data-cmd="${cmd}"]`);
      if (b) b.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (which === "link" && !$("cpLinkRow").hidden) {
      const href = editor.getAttributes("link").href || "";
      $("cpLinkUrl").value = href;
      $("cpLinkRemove").hidden = !href;
      $("cpLinkUrl").focus();
    }
  }
  const closeRows = () => openRow(null);

  $("cpSizeRow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-size]");
    if (!b) return;
    editor.chain().focus().setFontSize(b.dataset.size || null).run();
    closeRows();
  });
  $("cpColorRow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tone]");
    if (!b) return;
    editor.chain().focus().setTone(b.dataset.tone || null).run();
    closeRows();
  });
  /* "input" follows the picker live; the row stays open until "change". */
  $("cpColorAny").addEventListener("input", (e) => {
    editor.chain().setTone(e.target.value.toLowerCase()).run();
  });
  $("cpColorAny").addEventListener("change", () => { editor.commands.focus(); closeRows(); });
  $("cpVarRow").addEventListener("click", (e) => {
    const b = e.target.closest("[data-var]");
    if (!b) return;
    editor.chain().focus().insertVariable(b.dataset.var).run();
    closeRows();
  });

  /* ---- loading -------------------------------------------------------- */

  async function load(listId) {
    let res, body;
    try {
      res = await fetch(url(listId ? "mailings=" + encodeURIComponent(listId) : ""),
        { credentials: "same-origin", cache: "no-store" });
      body = await res.json();
    } catch (e) {
      toast(tr("err.unreachable") + " " + e.message, "bad");
      return;
    }
    if (!res.ok) { toast(body.error || tr("err.refused"), "bad"); return; }

    cp.lists = body.lists || [];
    cp.mailings = body.mailings || [];
    cp.you = body.you || null;
    cp.testInbox = body.test_inbox || null;
    renderPickers();
    renderTestTo();
    /* The page around this shows the drafts waiting and what has gone out;
       both just changed if this load follows a save or a send. */
    if (window.StaffMailing && window.StaffMailing.changed) window.StaffMailing.changed(body);
  }

  function renderPickers() {
    $("cpNoLists").hidden = !!cp.lists.length;
    $("cpSplit").hidden = !cp.lists.length;
    if (!cp.lists.length) return;

    if (!cp.listId || !cp.lists.some((l) => l.id === cp.listId)) {
      cp.listId = cp.lists[0].id;
    }
    $("cpList").innerHTML = cp.lists.map((l) =>
      `<option value="${esc(l.id)}"${l.id === cp.listId ? " selected" : ""}>` +
      `${esc(l.name)}</option>`).join("");

    /* The real number, beside the picker rather than buried in a dialog. It is
       the one fact that makes Send feel like what it is. */
    const list = cp.lists.filter((l) => l.id === cp.listId)[0];
    $("cpCount").textContent = list
      ? tr("ml.cpConfirmed").replace("{n}", list.subscribed) : "";

    const drafts = cp.mailings.filter((m) => m.status === "draft");
    $("cpDraft").innerHTML =
      `<option value="">${esc(tr("ml.cpNewDraft"))}</option>` +
      drafts.map((m) =>
        `<option value="${esc(m.id)}"${m.id === cp.id ? " selected" : ""}>` +
        `${esc(m.subject || tr("ml.cpUntitled"))}</option>`).join("");

  }

  /* FILES THIS DRAFT HAS SEEN (media-cleanup.js). A picture replaced or an
     attachment dropped stays in storage while the draft is open, because the
     editor's undo can bring it back. When the draft is left (another opened,
     or the page closed) the ones it no longer uses are handed back; the
     server deletes them only if no mailing or site anywhere still names them. */
  const seen = new Set();
  const note = (text) => { for (const m of String(text || "").matchAll(/\/media\/((?:newsletter|attachments|partnersite)\/[A-Za-z0-9._\/-]+)/g)) seen.add(m[1]); };
  function releaseSeen() {
    const now = editor.getHTML() + "\n" + cp.attachments.map((a) => a.object_key).join("\n");
    const gone = [...seen].filter((k) => !now.includes(k));
    seen.clear();
    if (!gone.length) return;
    fetch("/api/staff-media-release", { method: "POST", keepalive: true, credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: gone }) }).catch(() => {});
  }
  window.addEventListener("pagehide", releaseSeen);
  /* Back to this page from the browser's memory: its undo would reach files
     already handed back, so it starts fresh from the server. */
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

  function openDraft(id) {
    releaseSeen();
    const m = cp.mailings.filter((x) => x.id === id)[0];
    cp.id = m ? m.id : null;
    $("cpSubject").value = m ? (m.subject || "") : "";
    $("cpPreheader").value = m ? (m.preheader || "") : "";

    /* `false` so loading a draft is not recorded as an edit — otherwise every
       draft is dirty the moment it opens and the unsaved warning cries wolf. */
    editor.commands.setContent(m ? (m.body_html || "") : "", false);
    /* A FRESH UNDO HISTORY per draft. Loading is otherwise an undoable step,
       so Undo in one draft reached back into the last one, and to pictures
       already handed back above. */
    const st = editor.state;
    editor.view.updateState(EditorState.create({ doc: st.doc, plugins: st.plugins, selection: st.selection }));

    cp.attachments = (m && m.attachments) || [];
    note(m && m.body_html);
    cp.attachments.forEach((a) => seen.add(a.object_key));
    cp.base = m ? { subject: m.subject, preheader: m.preheader, body_html: m.body_html } : null;
    cp.savedHtml = editor.getHTML();
    cp.savedSubject = $("cpSubject").value;
    cp.savedPreheader = $("cpPreheader").value;
    cp.dirty = false;
    setState("");
    renderAttachments();
    refresh();
    measure();
  }

  const setState = (msg) => { $("cpState").textContent = msg || ""; };

  function markDirty() {
    cp.dirty = editor.getHTML() !== cp.savedHtml ||
      $("cpSubject").value !== cp.savedSubject ||
      $("cpPreheader").value !== cp.savedPreheader;
    setState(cp.dirty ? tr("ml.cpUnsaved") : "");
    if (cp.dirty) autosaveSoon(); else clearTimeout(autoTimer);
  }

  /* ---- links and pictures --------------------------------------------- */

  /* A real field, not window.prompt: it shows the link already there, can
     edit or remove it, and refuses what the server would strip. A bare
     address gets https:// and one with an @ becomes mailto:. */
  function linkApply() {
    let href = $("cpLinkUrl").value.trim();
    if (!href) { applyLink(editor, null); closeRows(); return; }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      href = /^[^\s/@]+@[^\s@]+\.[^\s@]+$/.test(href) ? "mailto:" + href : "https://" + href;
    }
    if (!/^(https?:\/\/[^\s]+|mailto:[^\s]+)$/i.test(href)) { toast(tr("ml.cpLinkBad"), "bad"); return; }
    applyLink(editor, href);
    closeRows();
    markDirty(); measureSoon();
  }
  function linkRemove() {
    applyLink(editor, null);
    closeRows();
    markDirty(); measureSoon();
  }
  $("cpLinkApply").addEventListener("click", linkApply);
  $("cpLinkRemove").addEventListener("click", linkRemove);
  $("cpLinkUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); linkApply(); }
    if (e.key === "Escape") { e.preventDefault(); closeRows(); editor.commands.focus(); }
  });

  /* UPLOADED AND LINKED, never embedded. A base64 image inside the HTML is the
     fastest way past Gmail's ~102KB clipping limit — one paste turns a 40KB
     email into a 900KB one, and Gmail then cuts the message off mid-tag. */
  async function shrink(file, maxPx) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    /* JPEG, not WebP — the one place the console's own rule is inverted.
       Outlook 2016 cannot display WebP at all, so a staff photo's best format
       is a newsletter's broken image. */
    return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.85));
  }

  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      setState(tr("ml.cpUploading"));
      try {
        const blob = await shrink(file, 1200);
        const res = await fetch("/api/admin/media?kind=newsletter", {
          method: "POST", credentials: "same-origin",
          headers: { "Content-Type": blob.type, "X-File-Name": String(file.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").slice(0, 80) }, body: blob,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
        insertImage(editor, body.url);
        note(body.url);
        markDirty(); measureSoon();
        setState("");
        /* Chosen, then straight into the editor (one step, not two). */
        let at = null;
        editor.state.doc.descendants((n, pos) => { if (n.type.name === "image" && n.attrs.src === body.url) at = pos; });
        if (at !== null) { editor.commands.setNodeSelection(at); editImage(); }
      } catch (e) { setState(""); toast(e.message, "bad"); }
    });
    input.click();
  }

  /* THE PHOTO EDITOR, for a picture in the message (photo-editor.js, the
     same editor as the Site Creator's). A mail client cannot apply settings,
     so the result is real pixels: exported at email size, uploaded, and put
     in place of the picture — which keeps its ORIGINAL in data-orig, so
     editing again starts from the original rather than from a crop. */
  async function editImage() {
    if (!window.PhotoEditor || !editor.isActive("image")) return;
    const a = editor.getAttributes("image");
    const orig = a.orig || a.src;
    try {
      const v = await window.PhotoEditor.open(orig, { purpose: "mail", removable: true });
      if (!v) return;
      if (v.remove) { editor.chain().focus().deleteSelection().run(); markDirty(); measureSoon(); return; }
      setState(tr("ml.cpUploading"));
      const blob = await window.PhotoEditor.exportBlob(orig, v, { max: 1200 });
      const res = await fetch("/api/admin/media?kind=newsletter", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type, "X-File-Name": (orig.split("/").pop() || "").replace(/-?[0-9a-f]{16}\.[a-z]+$/, "") + "-edit" }, body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
      editor.chain().focus().updateAttributes("image", { src: body.url, orig }).run();
      note(body.url);
      markDirty(); measureSoon();
      setState("");
    } catch (e) { setState(""); toast(e.message, "bad"); }
  }

  /* ---- attachments ----------------------------------------------------
     A DIFFERENT MECHANISM FROM AN INLINE PICTURE, and conflating the two is
     the usual mistake. A picture is fetched by the reader's mail client from a
     URL in the body. An attachment travels WITH the message and never appears
     in the HTML at all — it is handed to Resend separately at send time.

     Which is also why the size rules differ: an inline picture costs the email
     nothing but a URL, and an attachment costs its full weight in every copy
     sent. */
  function renderAttachments() {
    const box = $("cpFiles");
    box.hidden = !cp.attachments.length;
    $("cpFileList").innerHTML = cp.attachments.map((f, i) =>
      '<li class="cp-file">' +
        `<span class="cp-file-name">${esc(f.filename)}</span>` +
        `<span class="cp-file-size">${(f.bytes / 1024).toFixed(0)} KB</span>` +
        `<button type="button" class="del" data-drop-file="${i}" ` +
          `aria-label="${esc(tr("common.delete") + " " + f.filename)}">×</button>` +
      "</li>").join("");
  }

  function pickAttachment() {
    const input = document.createElement("input");
    input.type = "file";
    input.addEventListener("change", async function () {
      const file = this.files && this.files[0];
      if (!file) return;
      setState(tr("ml.cpUploading"));
      try {
        /* url(), so a file for one of Thauma's own lists lands in the
           organization's folder — the folder its save will accept. */
        const res = await fetch(
          url("attach=" + encodeURIComponent(file.name)), {
            method: "PUT", credentials: "same-origin",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
        cp.attachments.push(body.file);
        seen.add(body.file.object_key);
        renderAttachments();
        markDirty();
        setState("");
      } catch (e) { setState(""); toast(e.message, "bad"); }
    });
    input.click();
  }

  /* ---- saving --------------------------------------------------------- */

  async function post(payload, opts) {
    let res, body;
    try {
      res = await fetch(url(), Object.assign({
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, opts || {}));
      body = await res.json().catch(() => ({}));
    } catch (e) { return { error: tr("err.unreachable") + " " + e.message }; }
    if (res.status === 409 && body.changed) return { changed: body };
    if (!res.ok) return { error: body.error || `${tr("err.refused")} (${res.status})` };
    return body;
  }

  /* Anything somebody would mind losing: a subject, a word, a picture, a
     file. A draft with none of those is not worth a row. */
  function hasWords() {
    return !!$("cpSubject").value.trim() || !editor.isEmpty || cp.attachments.length > 0;
  }

  /* ONE SAVE AT A TIME. Autosave, Save, Back and Send can all ask at once;
     two posts for a NEW draft would make two drafts, because the first has
     not yet told this page its id. A second ask waits for the first and then
     saves only if something is still unsaved. */

  async function save(quiet, opts) {
    if (saving) {
      await saving;
      if (!cp.dirty && cp.id) return cp.mailings.filter((m) => m.id === cp.id)[0] || {};
    }
    if (!hasWords()) {
      if (!quiet) toast(tr("ml.cpNeedSubject"), "bad");
      return null;
    }
    saving = saveNow(quiet, opts);
    try { return await saving; } finally { saving = null; }
  }

  async function saveNow(quiet, opts) {
    clearTimeout(autoTimer);
    setState(tr("common.saving"));
    /* LAYER A HANDS OVER ITS RICH CONTENT AND STOPS THERE. Turning it into
       email-safe HTML happens on the server, not here: the server has to
       sanitise whatever a browser sends regardless, the archive re-renders
       from this same stored source, and each recipient's unsubscribe link has
       to be injected per message. Converting in the browser would mean three
       implementations of one thing, two of which nobody ever receives. */
    const payload = {
      action: "mailing-save", id: cp.id || undefined, list_id: cp.listId,
      subject: $("cpSubject").value, preheader: $("cpPreheader").value,
      body_html: editor.getHTML(),
      attachments: cp.attachments.slice(),
      base: cp.id ? cp.base : undefined,
    };
    const wasNew = !cp.id;
    const before = cp.mailings.filter((m) => m.id === cp.id)[0];
    let body = await post(payload, opts);
    /* Saved by someone else since this draft opened: ask. Saving mine sends
       it again with overwrite; keeping theirs opens their version. */
    if (body.changed) {
      setState("");
      if (!(await window.StaffChanged(body.changed))) {
        const id = cp.id;
        await load(cp.listId);
        openDraft(id);
        return null;
      }
      body = await post(Object.assign({}, payload, { overwrite: true }), opts);
    }
    if (body.error) {
      setState("");
      toast(body.error, "bad");
      return null;
    }
    const m = body.mailing;
    cp.base = { subject: m.subject, preheader: m.preheader, body_html: m.body_html };
    cp.id = m.id;

    /* WHAT WAS SENT is what is saved — not what the editor holds now. Words
       typed while the request was out are still unsaved, and stay marked so;
       reading the editor here would call them saved and drop them. */
    cp.savedHtml = payload.body_html;
    cp.savedSubject = payload.subject;
    cp.savedPreheader = payload.preheader;
    markDirty();
    if (!cp.dirty) setState(tr("ml.cpSaved"));

    /* The draft list on this page holds the body each draft reopens with, so
       it is updated here rather than left to the next load. */
    const row = Object.assign({}, m, { status: "draft" });
    const at = cp.mailings.findIndex((x) => x.id === m.id);
    if (at === -1) cp.mailings.unshift(row); else cp.mailings[at] = row;
    renderPickers();
    $("cpDraft").value = cp.id;

    /* The page's Drafts card and counts change only when a draft appears or
       is renamed; a reload for every pause in typing would be a request for
       nothing. */
    if (!quiet || wasNew || !before || before.subject !== m.subject) await load(cp.listId);
    measure();
    if (cp.dirty) autosaveSoon();
    return m;
  }

  /* AUTOSAVE, quietly, a few seconds after the typing stops. Never two at
     once: save() queues behind one that is out. */
  function autosaveSoon() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      if (cp.dirty && hasWords()) save(true);
    }, AUTOSAVE_MS);
  }

  /* LEAVING NEVER LOSES WORDS. Back, New, another draft, another list: each
     saves what is on screen first. True when it is safe to move on. */
  async function flush() {
    clearTimeout(autoTimer);
    if (saving) await saving;
    if (!cp.dirty || !hasWords()) return true;
    return !!(await save(true));
  }

  /* ---- how heavy is it -------------------------------------------------
     There was a live preview here — the real rendered email in a frame beside
     the editor. It is gone, and its own warning label was the argument: a
     browser is not a mail client, so it could only ever be a layout check,
     while the test send shows the actual message in an actual inbox. Two
     answers to one question, and the misleading one was the one on screen the
     whole time.

     THE WEIGHT STAYED, because nothing else warns about it. Gmail cuts a
     message off at about 102KB and shows "Message clipped" — and because the
     cut can land mid-tag, everything after it can fail to render. The server
     measures the FULL rendered email, shell and inline styles and all, since
     that is what the limit applies to. */
  let measureTimer = null;
  const measureSoon = () => {
    clearTimeout(measureTimer);
    measureTimer = setTimeout(measure, 700);
  };

  async function measure() {
    const el = $("cpSize");
    if (!el) return;
    if (!cp.id) { el.textContent = ""; el.className = "cp-size"; return; }
    const res = await fetch(url("measure=" + encodeURIComponent(cp.id)),
      { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json().catch(() => ({}));
    if (typeof body.bytes !== "number") return;
    el.textContent = (body.bytes / 1024).toFixed(1) + " KB";
    el.className = "cp-size" + (body.tooBig ? " is-over" : "");
    el.title = body.tooBig || tr("ml.cpSizeOk");
  }

  /* ---- where a test goes (0048) ---------------------------------------
     The address is shown beside the button and pressing it changes it. A
     new inbox is proven by a link first; until then tests keep going to the
     sign-in address, and the new one shows as waiting. */
  function renderTestTo() {
    const el = $("cpTestTo");
    if (!el) return;
    const signIn = cp.you ? cp.you.email : "";
    const ti = cp.testInbox;
    el.textContent = ti ? ti.email : signIn;
    el.classList.toggle("is-waiting", !!(ti && !ti.confirmed));
    el.title = ti && !ti.confirmed ? tr("ml.cpTestWaiting") : tr("ml.cpTestTo");
    $("cpTestReset").hidden = !ti;
    $("cpTestEmail").placeholder = signIn;
  }

  async function chooseTestInbox(clear) {
    const email = $("cpTestEmail").value.trim();
    if (!clear && !email) return;
    const body = await post(clear ? { action: "test-inbox-clear" }
                                  : { action: "test-inbox", email });
    if (body.error) { toast(body.error, "bad"); return; }
    cp.testInbox = body.test_inbox || null;
    $("cpTestBox").hidden = true;
    renderTestTo();
    if (cp.testInbox) toast(tr("ml.cpTestLinkSent").replace("{email}", cp.testInbox.email), "ok");
  }

  /* ---- sending -------------------------------------------------------- */

  async function test(btn) {
    if (cp.dirty || !cp.id) { if (!await save()) return; }
    if (!cp.id) return;
    btn.disabled = true;
    setState(tr("ml.cpSending"));
    const body = await post({ action: "mailing-test", id: cp.id });
    btn.disabled = false;
    setState("");
    if (body.error) { toast(body.error, "bad"); return; }
    toast(tr("ml.cpTestSent").replace("{email}", body.to), "ok");
  }

  async function send(btn) {
    /* SAVED FIRST, ALWAYS. Sending what is on screen while the server holds
       something else is the one mistake with no remedy — the message is gone,
       and it is not the one anybody read on this page. */
    if (cp.dirty || !cp.id) { if (!await save()) return; }
    const list = cp.lists.filter((l) => l.id === cp.listId)[0];
    if (!list) return;

    const ok = await window.StaffConfirm({
      title: tr("ml.cpConfirmTitle"),
      body: tr("ml.cpConfirmBody")
        .replace("{n}", list.subscribed)
        .replace("{list}", list.name)
        .replace("{subject}", $("cpSubject").value.trim()),
      note: tr("ml.cpConfirmNote"),
      type: "SEND",
      typeLabel: list.name + " —",
      confirm: tr("ml.cpSend"),
      cancel: tr("ms.cancel"),
      danger: true,
    });
    if (!ok) return;

    btn.disabled = true;
    setState(tr("ml.cpSending"));
    const body = await post({ action: "mailing-send", id: cp.id });
    btn.disabled = false;
    setState("");
    if (body.error) { toast(body.error, "bad"); await load(cp.listId); return; }

    toast(tr("ml.cpSentTo").replace("{n}", body.sent) +
      (body.failed ? " · " + body.failed + " " + tr("ml.cpFailed") : ""),
      body.failed ? "bad" : "ok");
    cp.id = null;
    await load(cp.listId);
    openDraft(null);
  }

  async function remove(btn) {
    if (!cp.id) { openDraft(null); return; }
    const ok = await window.StaffConfirm({
      title: tr("ml.cpDelete"), body: tr("ml.cpDeleteBody"),
      confirm: tr("ml.cpDeleteDo"), cancel: tr("ms.cancel"), danger: true,
    });
    if (!ok) return;
    const body = await post({ action: "mailing-delete", id: cp.id });
    if (body.error) { toast(body.error, "bad"); return; }
    cp.id = null;
    await load(cp.listId);
    openDraft(null);
    toast(tr("toast.deleted"), "ok");
  }

  /* ---- wiring --------------------------------------------------------- */

  /* "SENDING TO" MOVES THIS DRAFT. Changing it used to start an empty one on
     the other list and drop what was written. Now the words go with it; with
     nothing written, the other list simply opens. */
  $("cpList").addEventListener("change", async function () {
    const to = this.value, from = cp.listId;
    if (saving) await saving;
    if (!hasWords()) {
      cp.listId = to; cp.id = null;
      await load(cp.listId); openDraft(null);
      return;
    }
    cp.listId = to;
    if (!(await save(true))) { cp.listId = from; this.value = from; return; }
    const id = cp.id;
    await load(cp.listId);
    openDraft(id);
  });
  $("cpDraft").addEventListener("change", async function () {
    const want = this.value || null;
    if (!(await flush())) { this.value = cp.id || ""; return; }
    openDraft(want);
  });
  $("cpNew").addEventListener("click", async () => {
    if (!(await flush())) return;
    openDraft(null); $("cpSubject").focus();
  });
  $("cpSave").addEventListener("click", () => save());
  $("cpTest").addEventListener("click", function () { test(this); });
  $("cpTestTo").addEventListener("click", function () {
    const box = $("cpTestBox");
    box.hidden = !box.hidden;
    if (!box.hidden) {
      $("cpTestEmail").value = cp.testInbox ? cp.testInbox.email : "";
      $("cpTestEmail").focus();
    }
  });
  $("cpTestLink").addEventListener("click", () => chooseTestInbox(false));
  $("cpTestReset").addEventListener("click", () => chooseTestInbox(true));
  $("cpTestEmail").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); chooseTestInbox(false); }
    if (e.key === "Escape") { $("cpTestBox").hidden = true; }
  });
  $("cpSend").addEventListener("click", function () { send(this); });
  $("cpDelete").addEventListener("click", function () { remove(this); });
  $("cpAttach").addEventListener("click", pickAttachment);

  /* The commands that need a value or a file, rather than a toggle. Toggles
     are handled inside createEditor, beside the state check that keeps their
     buttons honest. */
  document.querySelector(".cp-tools").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cmd]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.cmd === "image") { closeRows(); return pickImage(); }
    if (b.dataset.cmd === "editimage") { closeRows(); return editImage(); }
    if (ROWS[b.dataset.cmd]) return openRow(b.dataset.cmd);
  });

  $("cpFileList").addEventListener("click", (e) => {
    const b = e.target.closest("[data-drop-file]");
    if (!b) return;
    cp.attachments.splice(Number(b.dataset.dropFile), 1);
    renderAttachments();
    markDirty();
  });

  $("cpSubject").addEventListener("input", () => { markDirty(); measureSoon(); });
  $("cpPreheader").addEventListener("input", () => { markDirty(); measureSoon(); });

  /* Leaving with unsaved words is the small loss this page can actually
     prevent, so it is the one thing worth interrupting for. */
  window.addEventListener("beforeunload", (e) => {
    if (!cp.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  /* The editor handle is exposed on purpose. It is what lets a test drive a
     real selection change and read the toolbar back — the exact behavior that
     two previous editors got wrong and no test ever caught, because neither
     could be reached from outside. A debugging surface that makes the hard
     thing checkable is worth more than the tidiness of hiding it. */
  /* WRITE AND DRAFTS, from the Mail page's first card (board 10). Write
     starts a new mailing to the list on screen. Drafts opens the newest one,
     on a list that has some, with the picker ready for the rest. Whatever was
     on screen is saved first — leaving never discards (Chase, 2026-10-03). */
  async function write(listId) {
    if (!(await flush())) return;
    /* Loaded with its mailings every time, so the drafts picker is filled —
       the first load of the page asks for no list's mailings at all. */
    cp.listId = listId || cp.listId || (cp.lists[0] && cp.lists[0].id) || null;
    await load(cp.listId);
    openDraft(null);
    $("cpSubject").focus();
  }
  /* One draft, from the Mail page's Drafts card. */
  async function open(listId, id) {
    if (!(await flush())) return;
    cp.listId = listId;
    await load(cp.listId);
    openDraft(id);
    $("cpSubject").focus();
  }
  async function drafts() {
    if (!(await flush())) return;
    const has = (l) => l && l.drafts > 0;
    const mine = cp.lists.filter((l) => l.id === cp.listId)[0];
    const list = has(mine) ? mine : cp.lists.filter(has)[0];
    if (list && list.id !== cp.listId) cp.listId = list.id;
    await load(cp.listId);
    const first = cp.mailings.filter((m) => m.status === "draft")[0];
    openDraft(first ? first.id : null);
    $("cpDraft").focus();
  }

  /* A tab put away or a phone locked is often the last moment this page
     gets: save then, on a request that outlives the page. keepalive caps a
     body at 64KB, so a very long draft may miss this one — beforeunload
     still asks before anything is lost. */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && cp.dirty && hasWords() && !saving) {
      save(true, { keepalive: true });
    }
  });

  window.StaffComposer = { reload: () => load(cp.listId), write, drafts, open, flush, editor };
  load(null).then(() => openDraft(null));
})();
