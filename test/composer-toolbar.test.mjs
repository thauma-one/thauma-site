#!/usr/bin/env node
/**
 * The composer toolbar reports the truth
 *   node test/composer-toolbar.test.mjs
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS NOT OPTIONAL
 * ---------------------------------------------------------------------------
 * The composer was built three times. The first ran on document.execCommand
 * and the second on a Markdown textarea, and the first one's real failure was
 * not its bugs — it was that NOTHING COULD SEE THEM. execCommand and
 * queryCommandState do not exist outside a real browser, the editor wrapped
 * both in try/catch, and so every test that passed proved a button called a
 * function and never once that pressing Bold made anything bold. Long runs of
 * green results describing nothing.
 *
 * TipTap can be driven from a test, so the behaviour that sank the previous
 * two is now checked here on every run rather than discovered in use.
 *
 * THE TEST THAT DEFINES DONE
 * ---------------------------------------------------------------------------
 *   type bold text
 *   -> click away into plain text   (Bold must un-highlight)
 *   -> click back into the bold text (Bold must re-highlight)
 *   with NO typing during the clicking.
 *
 * The common way to fail it is to refresh the toolbar on content changes
 * alone. Moving a cursor changes no content, so the highlight goes stale and
 * the toolbar quietly lies about what you are typing into. editor.js wires
 * both onUpdate and onSelectionUpdate for exactly this reason.
 *
 * This drives the REAL bundle — the same file the browser gets — rather than
 * the source, so a build that silently stopped shipping the editor fails here.
 */
import { JSDOM } from "jsdom";
import { readFileSync, existsSync } from "node:fs";

const BUNDLE = "src/js/composer.bundle.js";
/* CI DOES NOT BUILD INTO _site. Staging builds to _site_next and production to
   _site_prod, so looking only in _site meant both of these printed SKIP and
   exited 0 in the one place they most needed to run — silently no coverage,
   which is the exact failure this file was written to stop happening to
   somebody else. */
const PAGE = ["_site", "_site_next", "_site_prod"]
  .map((d) => `${d}/staff/mailing/index.html`)
  .find((p) => existsSync(p)) || "_site/staff/mailing/index.html";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(a === b, `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("composer toolbar — does it tell the truth\n");

if (!existsSync(BUNDLE) || !existsSync(PAGE)) {
  console.log(`  SKIP  ${!existsSync(BUNDLE) ? BUNDLE : PAGE} is missing — run the build first.`);
  process.exit(0);
}

/* ------------------------- a console in a box -------------------------- */

const LISTS = [{
  id: "ml_1", partner_id: "p_chase", slug: "newsletter", name: "Newsletter",
  from_name: "Chase", from_email: "news@chaseroush.thauma.one",
  is_open: 1, archive_public: 1, subscribed: 128, pending: 4, unsubscribed: 9,
}];

async function boot() {
  const dom = new JSDOM(readFileSync(PAGE, "utf8"), {
    runScripts: "outside-only",
    url: "https://next.thauma.one/staff/mailing/",
    pretendToBeVisual: true,
  });
  const w = dom.window;

  /* ProseMirror measures things jsdom does not implement. Stubbed to zero,
     which is enough: nothing here depends on layout, only on state. */
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => (
    { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 });
  w.Element.prototype.scrollIntoView = () => {};

  let mailings = [];
  const body = {
    you: { email: "c@thauma.one", roles: ["staff", "admin"] },
    scope: "partner", may_theme: true,
    partner: { id: "p_chase", slug: "chase-roush", display_name: "Chase Roush" },
    lists: LISTS, tags: [], senders: [],
    embed: { accent: "#E4572E", theme: "auto", enabled: true },
  };
  w.fetch = async (u, o = {}) => {
    const url = String(u);
    const sent = o.body && typeof o.body === "string" ? JSON.parse(o.body) : null;
    if (url.includes("measure=")) {
      // The size only. The live preview it used to return is gone — a browser
      // is not a mail client, and the test send is the honest check.
      return { ok: true, status: 200, json: async () => ({ bytes: 6100, tooBig: null }) };
    }
    if (sent && sent.action === "mailing-save") {
      mailings = [{ id: "mg_1", list_id: sent.list_id, subject: sent.subject,
        status: "draft", body_html: sent.body_html,
        attachments: sent.attachments || [], sent_count: 0, failed: 0 }];
      return { ok: true, status: 200, json: async () => ({ ok: true, mailing: mailings[0] }) };
    }
    return { ok: true, status: 200, json: async () => ({ ...body, mailings }) };
  };
  w.StaffProblem = () => {}; w.StaffProblemClear = () => {};
  w.StaffToast = () => {}; w.StaffActing = () => {}; w.StaffIdentity = () => {};
  w.console.error = () => {};

  for (const f of ["staff-i18n.js", "staff.js", "staff-rowpanel.js", "staff-mailing.js"]) {
    try { w.eval(readFileSync("src/js/" + f, "utf8")); } catch { /* not under test */ }
  }
  w.eval(readFileSync(BUNDLE, "utf8"));
  await new Promise((r) => setTimeout(r, 400));

  const D = w.document;
  D.querySelector('[data-view="composer"]')
    .dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));

  return { w, D, editor: w.StaffComposer && w.StaffComposer.editor };
}

const lit = (D, tool) =>
  D.querySelector(`.cp-tools [data-tool="${tool}"]`).getAttribute("aria-pressed");
const settle = () => new Promise((r) => setTimeout(r, 60));

const ctx = await boot();

/* ------------------------------ it mounted ----------------------------- */

await check("the bundle loads and the editor mounts", () => {
  assert(ctx.D.querySelector(".cp-body .ProseMirror"), "no editor in the page");
  assert(ctx.editor, "no editor handle — the rest of this file cannot run");
});

await check("the browser preview is gone, and its size warning is not", () => {
  /* The preview could only ever check layout — a browser is not a mail client
     — while the test send shows the real message in a real inbox. Two answers
     to one question, and the misleading one was the one always on screen.

     The weight had no substitute, so it stayed: Gmail cuts a message off at
     about 102KB and shows "Message clipped", and nothing else warns. */
  assert(!ctx.D.getElementById("cpFrame"), "the preview frame is still here");
  assert(!ctx.D.querySelector(".cp-caveat"),
    "the 'browser is not a mail client' note outlived the thing it warned about");
  assert(ctx.D.getElementById("cpSize"), "the size readout went with it — it should not have");
  assert(ctx.D.getElementById("cpTest"), "the test send is now the only real check and must exist");
});

await check("the composer uses the console's colours, not its own", () => {
  /* It had a white card, to make writing feel like the email being previewed
     beside it. The preview went, so the reason went. A white panel in a dark
     console reads as a different application. */
  const css = readFileSync("src/css/staff.css", "utf8");
  const block = css.slice(css.indexOf("   THE COMPOSER"));
  const card = /\.cp-card\{([^}]*)\}/.exec(block);
  assert(card, "no .cp-card rule found");
  assert(/var\(--panel\)/.test(card[1]),
    `the writing card is not using the console's panel colour: ${card[1]}`);
  assert(!/#fff\b|#ffffff/i.test(card[1]), `a hard-coded white survived: ${card[1]}`);
});

await check("there is no To, Cc or Bcc field", () => {
  /* Not an omission. This composer sends to a LIST: every subscriber gets
     their own message with their own unsubscribe link. One message to many
     could carry only one such link, a typed address would bypass double
     opt-in, and bulk Bcc is a spam signal that would damage the sending
     domain for every list on it. */
  for (const id of ["cpTo", "cpCc", "cpBcc"]) {
    assert(!ctx.D.getElementById(id), `${id} exists — this is a list composer`);
  }
  assert(ctx.D.getElementById("cpList"), "the list picker is missing");
});

/* ----------------------- THE TEST THAT DEFINES DONE --------------------- */

await check("Bold un-highlights and re-highlights on CURSOR MOVEMENT ALONE", async () => {
  const { editor, D } = ctx;
  editor.chain().focus().clearContent().insertContent("Plain start. ").run();
  editor.chain().focus().toggleBold().insertContent("BOLDWORD").toggleBold().run();
  editor.chain().focus().insertContent(" plain tail.").run();
  await settle();
  eq(lit(D, "bold"), "false", "step 1: after typing bold then plain, Bold should be off");

  const text = editor.state.doc.textContent;
  const insideBold = text.indexOf("BOLDWORD") + 5;   // doc positions are 1-based
  const insidePlain = text.indexOf("plain tail") + 5;

  /* SELECTION ONLY. No insertContent, no keystroke — exactly what clicking
     does. This is the step that fails when only onUpdate is wired. */
  editor.commands.setTextSelection(insideBold);
  await settle();
  eq(lit(D, "bold"), "true",
    "step 2: moving the cursor INTO bold text must light Bold with no typing");

  editor.commands.setTextSelection(insidePlain);
  await settle();
  eq(lit(D, "bold"), "false", "step 3: moving back to plain text must un-light it");

  editor.commands.setTextSelection(insideBold);
  await settle();
  eq(lit(D, "bold"), "true", "step 4: and back into bold must light it again");
});

await check("every toolbar button has a state check behind it", () => {
  /* The first composer shipped buttons that were decorative. One table in
     editor.js pairs each command with how to read it back, so a button cannot
     exist without one — this asserts the markup agrees. */
  const buttons = [...ctx.D.querySelectorAll(".cp-tools [data-tool]")];
  assert(buttons.length >= 10, `only ${buttons.length} tools found`);
  for (const b of buttons) {
    assert(b.hasAttribute("aria-pressed") || b.dataset.tool === "rule",
      `${b.dataset.tool} has no state to report`);
  }
});

await check("block buttons report the block the cursor is in", async () => {
  const { editor, D } = ctx;
  editor.chain().focus().clearContent().insertContent("A line.").run();
  await settle();
  eq(lit(D, "h2"), "false", "a paragraph is not a heading");

  editor.chain().focus().toggleHeading({ level: 2 }).run();
  await settle();
  eq(lit(D, "h2"), "true", "inside a heading, H1 should be lit");
  eq(lit(D, "bullet"), "false", "a heading is not a bullet");

  editor.chain().focus().toggleHeading({ level: 2 }).toggleBulletList().run();
  await settle();
  eq(lit(D, "bullet"), "true", "inside a list, the bullet button should be lit");
  eq(lit(D, "h2"), "false", "and the heading button should not be");
});

/* --------------------- the marks the renderer expects ------------------- */

await check("the brand colour is stored as INTENT, not as a colour value", async () => {
  /* A literal #E4572E would freeze one ministry's palette into another's
     message the moment a draft was copied, and would survive a rebrand as a
     stale colour nobody can find. The server resolves the mark at render time
     against whatever that ministry currently uses. */
  const { editor, D } = ctx;
  editor.chain().focus().clearContent().insertContent("Zagreb").run();
  editor.chain().focus().selectAll().toggleAccent().run();
  await settle();
  eq(lit(D, "accent"), "true", "the accent button should be lit");
  const html = editor.getHTML();
  assert(/data-c="accent"/.test(html), `expected a data-c mark: ${html}`);
  assert(!/#[0-9a-fA-F]{6}/.test(html), `a literal colour leaked in: ${html}`);
});

await check("the two sizes round-trip as data-sz", async () => {
  const { editor, D } = ctx;
  editor.chain().focus().clearContent().insertContent("Big").run();
  editor.chain().focus().selectAll().setSize("lg").run();
  await settle();
  eq(lit(D, "larger"), "true", "the larger button should be lit");
  assert(/data-sz="lg"/.test(editor.getHTML()), `expected data-sz: ${editor.getHTML()}`);
});

await check("what the editor emits is what the sanitiser keeps", async () => {
  /* If the two ever disagreed, formatting would vanish on save with no
     explanation — which is the single most demoralising bug an editor can
     have, and one this project has already shipped once. */
  const { sanitise } = await import("../workers/src/lib/newsletter.js");
  const { editor } = ctx;
  editor.chain().focus().clearContent()
    .insertContent("<h2>Heading</h2><p>Text with <strong>bold</strong>, " +
      '<em>italic</em>, <u>under</u> and <span data-c="accent">accent</span>.</p>' +
      "<ul><li>one</li></ul><ol><li>first</li></ol>" +
      "<blockquote><p>quoted</p></blockquote><hr>" +
      '<p><a href="https://x.test">link</a></p>').run();
  await settle();

  const html = editor.getHTML();
  const kept = sanitise(html);
  for (const [what, needle] of [
    ["headings", "<h2>"], ["bold", "<strong>"], ["italic", "<em>"],
    ["underline", "<u>"], ["the accent mark", 'data-c="accent"'],
    ["bullets", "<ul>"], ["numbers", "<ol>"], ["quotes", "<blockquote>"],
    ["dividers", "<hr>"], ["links", 'href="https://x.test"'],
  ]) {
    assert(kept.includes(needle),
      `${what} did not survive the sanitiser — it would disappear on save`);
  }
});

await check("a link the sanitiser would strip cannot be made here", async () => {
  // Otherwise the link looks fine while writing and is gone on save.
  const { editor } = ctx;
  editor.chain().focus().clearContent().insertContent("click").selectAll()
    .setLink({ href: "javascript:alert(1)" }).run();
  await settle();
  assert(!/javascript:/i.test(editor.getHTML()),
    `a javascript: link was created: ${editor.getHTML()}`);
});

/* ------------------------ the build cannot loop ------------------------
   On 2026-08-22 this took the dev site down completely. The bundle is written
   into src/js, which is passthrough-copied and therefore WATCHED — so every
   build looked to the watcher like somebody had edited a file, which started
   another build, about once a second until it was stopped. From the outside
   the site simply never finished loading, and the cause was nowhere near the
   symptom.

   Two guards, and this checks both, because either one alone would be quiet
   to remove during a refactor. */

await check("the bundle output cannot retrigger the watcher", () => {
  const cfg = readFileSync(".eleventy.js", "utf8");

  assert(/watchIgnores\.add/.test(cfg),
    "the bundle's output path is not excluded from watching — writing it will " +
    "start a rebuild, which writes it again, forever");

  /* The second guard matters more than it looks: esbuild writing identical
     bytes still updates the file's timestamp, and a watcher counts that as a
     change. Skipping the write when nothing changed means the loop cannot
     start even if the ignore above is lost. */
  assert(/write:\s*false/.test(cfg) && /!==\s*current/.test(cfg),
    "the bundle is written unconditionally — an identical rebuild still " +
    "touches the file, and a touched file is a change to a watcher");
});

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
