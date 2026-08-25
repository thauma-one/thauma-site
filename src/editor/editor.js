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
import { Editor, Mark, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";

/**
 * The ministry's own accent, as a mark.
 *
 * NOT A COLOUR VALUE. Storing `color:#E4572E` would freeze one partner's
 * palette into another's message the moment a draft is copied, and would
 * survive a rebrand as a stale colour nobody can find. The mark records the
 * INTENT — "this is the brand colour" — and the server resolves it at render
 * time against whatever that ministry currently uses.
 *
 * It also matches what the sanitiser already keeps: `<span data-c="accent">`
 * is in newsletter.js's allow-list, so this survives the round trip untouched.
 */
const Accent = Mark.create({
  name: "accent",
  parseHTML() { return [{ tag: 'span[data-c="accent"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-c": "accent" }), 0];
  },
  addCommands() {
    return { toggleAccent: () => ({ commands }) => commands.toggleMark(this.name) };
  },
});

/**
 * Two sizes, and only two.
 *
 * A size picker in email invites 11px body text that nobody over fifty can
 * read, and font-size is one of the few properties every client honours — so a
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
  accent:    { run: (c) => c.toggleAccent(),               on: (e) => e.isActive("accent") },
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
      Image.configure({ inline: false, allowBase64: false }),
      Accent,
      Size,
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
  });

  function refresh() {
    for (const b of buttons) {
      const tool = TOOLS[b.dataset.tool];
      if (!tool) continue;
      const on = !!tool.on(editor);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.classList.toggle("is-on", on);
    }
    const linked = editor.isActive("link");
    const linkBtn = opts.toolbar.querySelector('[data-cmd="link"]');
    if (linkBtn) {
      linkBtn.setAttribute("aria-pressed", linked ? "true" : "false");
      linkBtn.classList.toggle("is-on", linked);
    }
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
