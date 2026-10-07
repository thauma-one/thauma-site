/**
 * editor.js — the writing surface, on TipTap
 *
 * THE THIRD ATTEMPT, and the reasons the first two failed are the design here.
 *
 * The first was a contenteditable div driven by document.execCommand. That is
 * the standard way to build a rich-text editor and it is a swamp: cursor
 * position, selection state, undo, and whatever markup the browser decides to
 * emit. Worse, it could not be tested — execCommand does not exist outside a
 * real browser, and the code wrapped it in try/catch, so every passing test
 * proved a button called a function and never that anything got formatted.
 *
 * The second was Markdown in a textarea. That fixed the testability completely
 * and removed a whole class of bug, but it is not the experience this screen
 * wanted: writing a newsletter in syntax and reading it in a frame beside you
 * is a translation job, not writing.
 *
 * So: a proven editor, and the one thing both previous attempts got wrong is
 * treated as the acceptance test rather than a finishing touch.
 *
 * ============================================================================
 * THE TOOLBAR STATE BUG, AND WHY IT IS THE POINT
 * ============================================================================
 * A toolbar button must be highlighted when the cursor is inside that
 * formatting — not only after you type. The common way to get this wrong is to
 * refresh the toolbar on content changes alone, which means:
 *
 *   type bold text  ->  Bold highlights        (correct)
 *   click into plain text  ->  Bold stays highlighted   (WRONG)
 *
 * because moving the cursor changes no content and fires no update. TipTap
 * exposes the two events separately for exactly this reason, and BOTH are
 * wired below. The test is:
 *
 *   type bold text, click away into plain text (Bold un-highlights), click
 *   back into the bold text (Bold re-highlights) — without typing anything
 *   during the clicking.
 *
 * `refresh()` is also called on focus and on blur, because a click that lands
 * in the editor for the first time is a focus event before it is a selection
 * one, and a stale highlight while the editor is not focused is the same lie
 * in a quieter voice.
 * ============================================================================
 */
import { Editor, Mark, Node, mergeAttributes, nodeInputRule, nodePasteRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

/**
 * The ministry's own accent, as a mark.
 *
 * NOT A COLOR VALUE. Storing `color:#E4572E` would freeze one partner's
 * palette into another's message the moment a draft is copied, and would
 * survive a rebrand as a stale color nobody can find. The mark records the
 * INTENT — "this is the brand color" — and the server resolves it at render
 * time against whatever that ministry currently uses.
 *
 * It also matches what the sanitiser already keeps: `<span data-c="accent">`
 * is in newsletter.js's allow-list, so this survives the round trip untouched.
 */
/* THE PALETTE (2026-10-03): the brand color plus a few tones, still stored as
   a NAME (`data-c`) that newsletter.js resolves per light or dark email. The
   old Accent mark's `<span data-c="accent">` parses into this one, so every
   existing draft keeps its color. Must match COLORS in newsletter.js.
   Those are the QUICK PICKS; any #rrggbb is accepted too (Chase, 2026-10-03:
   "a full palette, with a few predetermined quick picks"). */
export const TONES = ["accent", "accent2", "dim", "red", "green", "blue", "gold"];
export const isTone = (c) => TONES.includes(c) || /^#[0-9a-f]{6}$/i.test(String(c || ""));

const Tone = Mark.create({
  name: "tone",
  addAttributes() {
    return {
      c: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-c"),
        renderHTML: (attrs) => (attrs.c ? { "data-c": attrs.c } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-c]", getAttrs: (el) => (isTone(el.getAttribute("data-c")) ? null : false) }];
  },
  renderHTML({ HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes), 0]; },
  addCommands() {
    return {
      /* null clears; one tone at a time, replaced rather than nested. */
      setTone: (c) => ({ commands }) => (c ? commands.setMark("tone", { c }) : commands.unsetMark("tone")),
    };
  },
});

/* A PERSONAL WORD (2026-10-03): the recipient's first or full name, filled
   per person by the server (fillVariables in newsletter.js). An atom, so it
   is moved and deleted as one piece and can't be half-edited.

   WRITTEN AS {{first_name}} AND {{full_name}} (2026-10-07, Chase: "change the
   variables again … reference chaseroush.com's code in its email composer for
   what it does with variables … in Thauma's styling"). chaseroush.com's
   composer shows the token itself and lets you type it; so does this one —
   typed or pasted, {{first_name}} becomes the variable (input and paste
   rules below), and the legend's buttons insert the same thing. Stored as
   data-var ("name" for the full name, as before) so every saved draft and
   sent mailing still reads. */
export const VARIABLES = ["first_name", "name"];
export const VAR_TOKENS = { first_name: "{{first_name}}", name: "{{full_name}}" };
const VAR_FROM = { first_name: "first_name", full_name: "name", name: "name" };
const tokenVar = (t) => VAR_FROM[/[a-z_]+/.exec(t)[0]];
/* A token already in saved words (written before, or arrived as text) shown
   as the variable it is. Only in text, never inside a tag's attributes. */
export function tokensToVariables(html) {
  return String(html || "").replace(/(<[^>]*>)|\{\{\s*(first_name|full_name|name)\s*\}\}/g,
    (m, tag, v) => (tag ? tag : `<span data-var="${VAR_FROM[v]}"></span>`));
}
/* a picture's width: 10–99 (% of the column), or an old name; else full */
export function picPct(v) {
  const named = { sm: "33", md: "50", lg: "75" }[v];
  if (named) return named;
  return /^\d{1,2}$/.test(String(v || "")) && +v >= 10 ? String(+v) : null;
}

const Variable = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      v: { default: "first_name", parseHTML: (el) => el.getAttribute("data-var"),
           renderHTML: (a) => ({ "data-var": a.v }) },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-var]", getAttrs: (el) => (VARIABLES.includes(el.getAttribute("data-var")) ? null : false) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "cp-var" }), VAR_TOKENS[node.attrs.v] || node.attrs.v];
  },
  renderText({ node }) { return VAR_TOKENS[node.attrs.v] || node.attrs.v; },
  addInputRules() {
    /* the whole token is the group: a rule with a group replaces only it */
    return [nodeInputRule({ find: /(\{\{\s*(?:first_name|full_name|name)\s*\}\})$/, type: this.type,
      getAttributes: (m) => ({ v: tokenVar(m[1]) }) })];
  },
  addPasteRules() {
    return [nodePasteRule({ find: /(\{\{\s*(?:first_name|full_name|name)\s*\}\})/g, type: this.type,
      getAttributes: (m) => ({ v: tokenVar(m[1]) }) })];
  },
  addCommands() {
    return {
      insertVariable: (v) => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { v } }),
    };
  },
});

/**
 * Two sizes, and only two.
 *
 * A size picker in email invites 11px body text that nobody over fifty can
 * read, and font-size is one of the few properties every client honors — so a
 * bad choice is faithfully reproduced everywhere. Larger and smaller, relative
 * to a body size chosen once in the renderer.
 */
const Size = Mark.create({
  name: "size",
  addAttributes() {
    return {
      sz: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-sz"),
        /* a size in px (2026-10-06) shows at its size while writing; the
           stored copy keeps only data-sz, which the email resolves itself */
        renderHTML: (attrs) => (attrs.sz ? (/^\d+$/.test(attrs.sz) ? { "data-sz": attrs.sz, style: "font-size:" + attrs.sz + "px" } : { "data-sz": attrs.sz }) : {}),
      },
    };
  },
  parseHTML() { return [{ tag: "span[data-sz]" }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      /* Toggling to the SAME size clears it, which is what pressing a
         highlighted button should do. Toggling to the other size replaces
         rather than nesting — two size marks on one word is a question the
         renderer should never have to answer. */
      setSize: (sz) => ({ editor, commands }) => (
        editor.isActive("size", { sz })
          ? commands.unsetMark("size")
          : commands.setMark("size", { sz })
      ),
      /* The size menu: a choice rather than a toggle; null is Normal. */
      setFontSize: (sz) => ({ commands }) => (
        sz ? commands.setMark("size", { sz }) : commands.unsetMark("size")
      ),
    };
  },
});

/* What each button does, and how to tell whether it is currently on.
   One table, so a button cannot exist without a state check — which is how
   the first version ended up with decorative buttons. */
export const TOOLS = {
  bold:      { run: (c) => c.toggleBold(),                 on: (e) => e.isActive("bold") },
  italic:    { run: (c) => c.toggleItalic(),               on: (e) => e.isActive("italic") },
  underline: { run: (c) => c.toggleUnderline(),            on: (e) => e.isActive("underline") },
  strike:    { run: (c) => c.toggleStrike(),               on: (e) => e.isActive("strike") },
  larger:    { run: (c) => c.setSize("lg"),                on: (e) => e.isActive("size", { sz: "lg" }) },
  smaller:   { run: (c) => c.setSize("sm"),                on: (e) => e.isActive("size", { sz: "sm" }) },
  h2:        { run: (c) => c.toggleHeading({ level: 2 }),  on: (e) => e.isActive("heading", { level: 2 }) },
  h3:        { run: (c) => c.toggleHeading({ level: 3 }),  on: (e) => e.isActive("heading", { level: 3 }) },
  bullet:    { run: (c) => c.toggleBulletList(),           on: (e) => e.isActive("bulletList") },
  ordered:   { run: (c) => c.toggleOrderedList(),          on: (e) => e.isActive("orderedList") },
  quote:     { run: (c) => c.toggleBlockquote(),           on: (e) => e.isActive("blockquote") },
  rule:      { run: (c) => c.setHorizontalRule(),          on: () => false },
};

/**
 * Build the editor and keep the toolbar honest.
 *
 * @param opts.element   where the editor mounts
 * @param opts.toolbar   the element holding [data-tool] buttons
 * @param opts.content   starting HTML
 * @param opts.onChange  called when the CONTENT changes, not the selection
 */
export function createEditor(opts) {
  const buttons = Array.from(opts.toolbar.querySelectorAll("[data-tool]"));
  /* Transactions can fire while the Editor below is still being built, before
     the `editor` binding exists; refresh waits for it. */
  let ready = false;

  const editor = new Editor({
    element: opts.element,
    content: opts.content || "",
    extensions: [
      StarterKit.configure({
        /* Off, because the renderer has nothing to do with them and a mail
           client would show them unstyled. Turning them off in the editor is
           the honest version of "this is not supported" — the alternative is a
           writer using a feature that silently disappears on save. */
        code: false,
        codeBlock: false,
        heading: { levels: [2, 3] },
        /* where a moved picture will land */
        dropcursor: { color: "var(--voice-tech)", width: 2 },
        link: {
          openOnClick: false,
          /* An href the sanitiser would strip must not be creatable here, or
             the link looks fine while writing and is gone on save. */
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener", target: "_blank" },
        },
      }),
      /* A picture remembers its ORIGINAL (data-orig) once the photo editor
         has made a cropped copy, so editing again starts from the original. */
      Image.extend({
        addAttributes() {
          return { ...this.parent?.(), orig: { default: null,
            parseHTML: (el) => el.getAttribute("data-orig"),
            renderHTML: (a) => (a.orig ? { "data-orig": a.orig } : {}) },
            /* how wide it shows, as a share of the column, dragged freely
               (2026-10-06, Chase: "The picture size needs to be adjustable in
               the composer itself, and freeform size adjustment"): 10–99,
               full width when unset. The old sm / md / lg still read. */
            w: { default: null,
              parseHTML: (el) => picPct(el.getAttribute("data-w")),
              renderHTML: (a) => (a.w ? { "data-w": a.w } : {}) },
            /* left or right with the words beside it, or (unset) on a line
               of its own, centered — chaseroush.com's three (2026-10-07) */
            al: { default: null,
              parseHTML: (el) => (/^(left|right)$/.test(el.getAttribute("data-al") || "") ? el.getAttribute("data-al") : null),
              renderHTML: (a) => (a.al ? { "data-al": a.al } : {}) } };
        },
        /* THE PICTURE IN THE EDITOR (2026-10-07, after chaseroush.com's
           composer, which Chase liked for pictures but found "a little in
           your face"): selected, it shows a small bar on the picture —
           left, center, right, full width, edit, remove — and a handle at
           each corner. Dragging a corner follows the pointer (a centered
           picture grows on both sides, so it moves twice as far) and the
           width shows only while dragging; it is written when the drag
           ends, as one change to undo. The picture itself is dragged to
           move it (the editor's own drop line shows where). */
        addNodeView() {
          const labels = opts.picLabels || {};
          return ({ node, editor, getPos }) => {
            const wrap = document.createElement("div");
            wrap.className = "cp-img";
            wrap.draggable = true;
            const img = document.createElement("img");
            img.draggable = false;
            const pct = document.createElement("span");
            pct.className = "cp-img-pct";
            const bar = document.createElement("span");
            bar.className = "cp-img-bar";
            bar.setAttribute("role", "toolbar");
            const ICON = {
              left: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="3" width="6" height="6" rx="1"/><path d="M9 4h6M9 7h6M1 12h14"/></svg>',
              center: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="2" width="8" height="7" rx="1"/><path d="M1 12h14"/></svg>',
              right: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="9" y="3" width="6" height="6" rx="1"/><path d="M1 4h6M1 7h6M1 12h14"/></svg>',
              full: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 8h14M4 5 1 8l3 3M12 5l3 3-3 3"/></svg>',
              edit: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l1-3 7-7 2 2-7 7-3 1z"/></svg>',
              remove: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
            };
            for (const k of ["left", "center", "right", "full", "edit", "remove"]) {
              if (k === "edit" && !opts.onEditImage) continue;
              const b = document.createElement("button");
              b.type = "button"; b.dataset.pic = k; b.innerHTML = ICON[k];
              b.title = labels[k] || k; b.setAttribute("aria-label", labels[k] || k);
              if (k === "full" || k === "remove") bar.appendChild(Object.assign(document.createElement("i"), { className: "cp-img-sep" }));
              bar.appendChild(b);
            }
            const corners = ["tl", "tr", "bl", "br"].map((c) => {
              const h = document.createElement("span");
              h.className = "cp-img-handle " + c; h.dataset.corner = c;
              h.setAttribute("aria-hidden", "true");
              return h;
            });
            wrap.append(img, bar, pct, ...corners);
            const draw = (n) => {
              img.src = n.attrs.src || ""; img.alt = n.attrs.alt || "";
              const w = n.attrs.w ? +n.attrs.w : 100;
              wrap.style.width = w + "%"; pct.textContent = w + "%";
              wrap.classList.toggle("al-left", n.attrs.al === "left");
              wrap.classList.toggle("al-right", n.attrs.al === "right");
              for (const b of bar.querySelectorAll("[data-pic]")) {
                const on = (b.dataset.pic === "left" && n.attrs.al === "left") || (b.dataset.pic === "right" && n.attrs.al === "right") ||
                  (b.dataset.pic === "center" && !n.attrs.al) || (b.dataset.pic === "full" && w >= 100);
                b.setAttribute("aria-pressed", on ? "true" : "false");
              }
            };
            draw(node);
            const set = (attrs) => {
              const pos = typeof getPos === "function" ? getPos() : null;
              if (pos == null) return;
              editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, Object.assign({}, node.attrs, attrs)));
            };
            /* A picture set beside the words starts at under half the column:
               full width beside anything is not beside it. */
            const beside = () => (node.attrs.w && +node.attrs.w <= 60 ? node.attrs.w : "40");
            bar.addEventListener("mousedown", (e) => e.preventDefault());
            bar.addEventListener("click", (e) => {
              const b = e.target.closest("[data-pic]");
              if (!b) return;
              e.preventDefault(); e.stopPropagation();
              const k = b.dataset.pic;
              if (k === "left" || k === "right") set({ al: k, w: beside() });
              else if (k === "center") set({ al: null });
              else if (k === "full") set({ al: null, w: null });
              else if (k === "edit") opts.onEditImage();
              else if (k === "remove") {
                const pos = getPos();
                editor.view.dispatch(editor.view.state.tr.delete(pos, pos + node.nodeSize));
                editor.commands.focus();
              }
            });
            for (const h of corners) {
              h.addEventListener("pointerdown", (e) => {
                e.preventDefault(); e.stopPropagation();
                const col = wrap.parentElement.getBoundingClientRect().width || 1;
                const x0 = e.clientX, w0 = wrap.getBoundingClientRect().width;
                /* a left corner grows leftward; a centered picture grows both ways */
                const dir = (h.dataset.corner[1] === "l" ? -1 : 1) * (node.attrs.al ? 1 : 2);
                let w = node.attrs.w ? +node.attrs.w : 100;
                wrap.classList.add("is-drag");
                h.setPointerCapture(e.pointerId);
                const move = (ev) => {
                  w = Math.max(10, Math.min(100, Math.round((w0 + (ev.clientX - x0) * dir) / col * 100)));
                  wrap.style.width = w + "%"; pct.textContent = w + "%";
                };
                const up = () => {
                  h.removeEventListener("pointermove", move);
                  wrap.classList.remove("is-drag");
                  set({ w: w >= 100 ? null : String(w) });
                };
                h.addEventListener("pointermove", move);
                h.addEventListener("pointerup", up, { once: true });
              });
            }
            return {
              dom: wrap,
              update(n) { if (n.type !== node.type) return false; node = n; draw(n); return true; },
              selectNode() { wrap.classList.add("is-sel"); },
              deselectNode() { wrap.classList.remove("is-sel"); },
              stopEvent: (e) => bar.contains(e.target) || corners.includes(e.target),
              ignoreMutation: () => true,
            };
          };
        },
      }).configure({ inline: false, allowBase64: false }),
      Tone,
      Size,
      Variable,
    ],

    /* PICTURES DROPPED OR PASTED IN (2026-10-07, after chaseroush.com's
       drop-to-upload): files go to opts.onImageFiles, which uploads them and
       puts them where they landed. A picture dragged within the message is
       not a file, and moves as before. */
    editorProps: {
      handleDrop: (view, event, slice, moved) => {
        const files = !moved && event.dataTransfer ? pictureFiles(event.dataTransfer.files) : [];
        if (!files.length || !opts.onImageFiles) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        opts.onImageFiles(files, at ? at.pos : null);
        return true;
      },
      handlePaste: (view, event) => {
        const files = event.clipboardData ? pictureFiles(event.clipboardData.files) : [];
        if (!files.length || !opts.onImageFiles) return false;
        event.preventDefault();
        opts.onImageFiles(files, null);
        return true;
      },
    },

    /* BOTH OF THESE, and that is the whole fix.
       onUpdate fires when the content changes. onSelectionUpdate fires when
       only the cursor moves. Wiring the first alone is the common bug: click
       into plain text after typing bold, and Bold stays lit because nothing
       was typed. */
    onUpdate: () => { refresh(); if (opts.onChange) opts.onChange(); },
    onSelectionUpdate: () => refresh(),
    onFocus: () => refresh(),
    onBlur: () => refresh(),
    /* AND THIS ONE (2026-10-03). Ctrl/Cmd+B with nothing selected changes
       neither the content nor the selection, only the STORED marks — the
       formatting the next typed letter will get. That is a transaction and
       nothing else, so Bold stayed dark until something was typed. A button
       press hid the bug: its .focus() fires onFocus. */
    onTransaction: () => { if (ready) refresh(); },
  });
  ready = true;

  function refresh() {
    for (const b of buttons) {
      const tool = TOOLS[b.dataset.tool];
      if (!tool) continue;
      const on = !!tool.on(editor);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("is-on", on);
    }
    const linked = editor.isActive("link");
    /* Edit picture is live only while a picture is selected. */
    const picBtn = opts.toolbar.querySelector('[data-cmd="editimage"]');
    if (picBtn) picBtn.disabled = !editor.isActive("image");
    const linkBtn = opts.toolbar.querySelector('[data-cmd="link"]');
    if (linkBtn) {
      linkBtn.setAttribute("aria-pressed", linked ? "true" : "false");
      linkBtn.classList.toggle("is-on", linked);
    }
    /* The size and color menus show the current choice (composer.js). */
    if (opts.onRefresh) opts.onRefresh(editor);
  }

  opts.toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (!b) return;
    e.preventDefault();
    const tool = TOOLS[b.dataset.tool];
    if (tool) tool.run(editor.chain().focus()).run();
  });

  refresh();
  return { editor, refresh };
}

/**
 * Put a link on the selection, or take one off.
 *
 * Separate from TOOLS because it needs a value from somebody, and a button
 * that opens a prompt is a different thing from a button that toggles.
 */
export function applyLink(editor, href) {
  if (!href) return editor.chain().focus().unsetLink().run();
  return editor.chain().focus().extendMarkRange("link")
    .setLink({ href }).run();
}

export function insertImage(editor, src, at) {
  if (at != null) return editor.chain().focus().insertContentAt(at, { type: "image", attrs: { src } }).run();
  return editor.chain().focus().setImage({ src }).run();
}

/* The pictures among some files: what the upload takes. */
export function pictureFiles(list) {
  return Array.from(list || []).filter((f) => /^image\/(jpeg|png|webp|gif)$/i.test(f.type));
}
