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
    listId: null, id: null,
    savedHtml: "", savedSubject: "", savedPreheader: "", dirty: false,
  };

  /* The composer shares the mailing page's scope switch: whose lists these are
     is one decision for the whole screen, not one per panel. */
  function url(extra) {
    const qs = [];
    const scope = window.StaffMailing && window.StaffMailing.scope();
    if (scope === "organisation") qs.push("scope=organisation");
    if (extra) qs.push(extra);
    return API + (qs.length ? "?" + qs.join("&") : "");
  }

  /* ---- the editor ----------------------------------------------------- */

  const { editor, refresh } = createEditor({
    element: mount,
    toolbar: document.querySelector(".cp-tools"),
    onChange: () => { markDirty(); measureSoon(); },
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
    renderPickers();
  }

  function renderPickers() {
    $("cpNoLists").hidden = !!cp.lists.length;
    $("cpSplit").hidden = !cp.lists.length;
    if (!cp.lists.length) { $("cpSent").hidden = true; return; }

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

    const sent = cp.mailings.filter((m) => m.status !== "draft");
    $("cpSent").hidden = !sent.length;
    $("cpSentList").innerHTML = sent.map((m) =>
      '<div class="cp-sent-row">' +
        `<span class="cp-sent-subject">${esc(m.subject)}</span>` +
        '<span class="cp-sent-meta">' +
          esc((m.finished_at || "").slice(0, 10)) + " · " +
          m.sent_count + " " + esc(tr("ml.cpRecipients")) +
          (m.failed ? " · " + m.failed + " " + esc(tr("ml.cpFailed")) : "") +
        "</span></div>").join("");
  }

  function openDraft(id) {
    const m = cp.mailings.filter((x) => x.id === id)[0];
    cp.id = m ? m.id : null;
    $("cpSubject").value = m ? (m.subject || "") : "";
    $("cpPreheader").value = m ? (m.preheader || "") : "";

    /* `false` so loading a draft is not recorded as an edit — otherwise every
       draft is dirty the moment it opens and the unsaved warning cries wolf. */
    editor.commands.setContent(m ? (m.body_html || "") : "", false);

    cp.attachments = (m && m.attachments) || [];
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
  }

  /* ---- links and pictures --------------------------------------------- */

  function linkPressed() {
    if (editor.isActive("link")) return applyLink(editor, null);
    const current = editor.getAttributes("link").href || "https://";
    const href = window.prompt(tr("ml.cpLinkPrompt"), current);
    if (href === null) return;
    if (!href.trim()) return applyLink(editor, null);
    if (!/^(https?:\/\/|mailto:)/i.test(href)) { toast(tr("ml.cpLinkBad"), "bad"); return; }
    applyLink(editor, href.trim());
    markDirty(); measureSoon();
  }

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
          headers: { "Content-Type": blob.type }, body: blob,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
        insertImage(editor, body.url);
        markDirty(); measureSoon();
        setState("");
      } catch (e) { setState(""); toast(e.message, "bad"); }
    });
    input.click();
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
        const res = await fetch(
          "/api/staff-mailing?attach=" + encodeURIComponent(file.name), {
            method: "PUT", credentials: "same-origin",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `failed (${res.status})`);
        cp.attachments.push(body.file);
        renderAttachments();
        markDirty();
        setState("");
      } catch (e) { setState(""); toast(e.message, "bad"); }
    });
    input.click();
  }

  /* ---- saving --------------------------------------------------------- */

  async function post(payload) {
    let res, body;
    try {
      res = await fetch(url(), {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) { return { error: tr("err.unreachable") + " " + e.message }; }
    if (!res.ok) return { error: body.error || `${tr("err.refused")} (${res.status})` };
    return body;
  }

  async function save(quiet) {
    if (!$("cpSubject").value.trim()) {
      if (!quiet) toast(tr("ml.cpNeedSubject"), "bad");
      return null;
    }
    setState(tr("common.saving"));
    /* LAYER A HANDS OVER ITS RICH CONTENT AND STOPS THERE. Turning it into
       email-safe HTML happens on the server, not here: the server has to
       sanitise whatever a browser sends regardless, the archive re-renders
       from this same stored source, and each recipient's unsubscribe link has
       to be injected per message. Converting in the browser would mean three
       implementations of one thing, two of which nobody ever receives. */
    const body = await post({
      action: "mailing-save", id: cp.id || undefined, list_id: cp.listId,
      subject: $("cpSubject").value, preheader: $("cpPreheader").value,
      body_html: editor.getHTML(),
      attachments: cp.attachments,
    });
    if (body.error) { setState(""); toast(body.error, "bad"); return null; }

    cp.id = body.mailing.id;
    cp.savedHtml = editor.getHTML();
    cp.savedSubject = $("cpSubject").value;
    cp.savedPreheader = $("cpPreheader").value;
    cp.dirty = false;
    setState(tr("ml.cpSaved"));
    await load(cp.listId);
    $("cpDraft").value = cp.id;
    measure();
    return body.mailing;
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

  $("cpList").addEventListener("change", async function () {
    cp.listId = this.value; cp.id = null;
    await load(cp.listId); openDraft(null);
  });
  $("cpDraft").addEventListener("change", function () { openDraft(this.value || null); });
  $("cpNew").addEventListener("click", () => {
    cp.id = null; openDraft(null); $("cpSubject").focus();
  });
  $("cpSave").addEventListener("click", () => save());
  $("cpTest").addEventListener("click", function () { test(this); });
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
    if (b.dataset.cmd === "link") return linkPressed();
    if (b.dataset.cmd === "image") return pickImage();
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
     real selection change and read the toolbar back — the exact behaviour that
     two previous editors got wrong and no test ever caught, because neither
     could be reached from outside. A debugging surface that makes the hard
     thing checkable is worth more than the tidiness of hiding it. */
  window.StaffComposer = { reload: () => load(cp.listId), editor };
  load(null).then(() => openDraft(null));
})();
