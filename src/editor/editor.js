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
import { Editor, Mark, Node, mergeAttributes } from "@tiptap/core";
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
   is moved and deleted as one piece and its label can't be half-edited. The
   label inside is the editor's only; a reader gets the name, or nothing. */
export const VARIABLES = ["first_name", "name"];

const Variable = Node.create({
  name: "variable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addOptions() { return { labels: { first_name: "First name", name: "Name" } }; },
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
    return ["span", mergeAttributes(HTMLAttributes, { class: "cp-var" }),
            this.options.labels[node.attrs.v] || node.attrs.v];
  },
  renderText({ node }) { return this.options.labels[node.attrs.v] || node.attrs.v; },
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
        renderHTML: (attrs) => (attrs.sz ? { "data-sz": attrs.sz } : {}),
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
            renderHTML: (a) => (a.orig ? { "data-orig": a.orig } : {}) } };
        },
      }).configure({ inline: false, allowBase64: false }),
      Tone,
      Size,
      Variable.configure({ labels: opts.varLabels || { first_name: "First name", name: "Name" } }),
    ],

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

export function insertImage(editor, src) {
  return editor.chain().focus().setImage({ src }).run();
}
