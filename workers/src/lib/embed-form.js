/**
 * embed-form.js — the look every public Thauma form shares
 *
 * There are two forms a stranger can meet on somebody else's website: the
 * sign-up form and the contact form. They must look like the same ministry
 * sent them, and the only reliable way to guarantee that is for them to be the
 * same stylesheet rather than two that started identical.
 *
 * This file was the sign-up form's own styling until the contact form needed
 * it too. Copying would have worked on the day and diverged by the second
 * change — which is exactly what happened to the sign-up form's PREVIEW in the
 * console, a hand-built imitation that quietly stopped resembling the thing it
 * was imitating.
 *
 * WHY A CARD, AND WHY SHADOW DOM
 * ---------------------------------------------------------------------------
 * The first version emitted bare fields and inherited whatever the host page
 * did to them: dark-on-dark on a dark site, and unfinished-looking beside the
 * goal and roadmap widgets, which have been bordered cards in the ministry's
 * colours from the beginning.
 *
 * Shadow DOM matters more on a FORM than anywhere else. A host page's own rule
 * for input elements would otherwise reach in and reshape controls somebody
 * has to type into — and unlike a widget that only displays, getting that
 * wrong stops people finishing what they came to do.
 *
 * The shape is chaseroush.com's, which had it right: uppercase field labels,
 * generous padding, a full-width accent button, and a confirmation panel that
 * REPLACES the form rather than appearing under it — because a filled-in form
 * still on screen under a success message is an invitation to send it twice.
 */
import { companion } from "../embed-colour.js";

export function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export const LIGHT = ":host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;--panel:#f7f8fb;--field:#fff}";
export const DARK  = ":host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;--panel:#1c1c25;--field:#12121a}";

/** The palette, worked out where there is a real language to work it out in. */
export function palette(accent, accent2) {
  const a = /^#[0-9a-fA-F]{6}$/.test(String(accent || "")) ? accent : "#6D4AFF";
  const b = /^#[0-9a-fA-F]{6}$/.test(String(accent2 || "")) ? accent2 : companion(a);
  return { a, b };
}

export function formStyles() {
  /* Same tokens as the other widgets, so a page carrying two of them does not
     show two different ideas of what "the background" is. */
  const light = ":host{--bg:#fff;--fg:#12121a;--dim:#5c5c6b;--line:#e6e6ee;" +
                "--panel:#f7f8fb;--field:#fff}";
  const dark  = ":host{--bg:#15151c;--fg:#f2f2f7;--dim:#9a9aad;--line:#2a2a36;" +
                "--panel:#1c1c25;--field:#12121a}";

  return [
    "SCHEME",
    ":host{all:initial;display:block;color:var(--fg);line-height:1.5;",
      "font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,",
      "Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}",
    "*{box-sizing:border-box;margin:0;padding:0}",

    /* THE BOX. Same border weight and radius as a goal card. */
    /* CENTRED IN WHATEVER SPACE IT IS GIVEN. A form is capped at a readable
       width — a 900px-wide row of fields is unpleasant to fill in — but the
       host decides how wide the column is, and a 480px card hugging the left
       of a 900px container looks like a mistake rather than a decision. */
    ".card{background:var(--panel);border:1.5px solid var(--line);border-radius:12px;",
      "padding:30px 32px;max-width:30rem;margin-inline:auto}",
    ".ttl{font-size:22px;font-weight:700;letter-spacing:-.01em;line-height:1.25;",
      "font-family:Georgia,Cambria,'Times New Roman',serif}",
    ".blurb{margin-top:8px;color:var(--dim);font-size:14.5px;line-height:1.55}",
    ".form{margin-top:22px}",

    /* CR's field treatment: the label is a small uppercase heading, and the
       input is roomy enough to be obviously tappable. */
    ".fld{display:block;margin-bottom:18px}",
    ".fld>span{display:block;font-size:12px;font-weight:600;color:var(--dim);",
      "margin-bottom:7px;text-transform:uppercase;letter-spacing:.05em}",
    ".fld input{width:100%;padding:13px 15px;background:var(--field);font:inherit;",
      "font-size:15px;color:var(--fg);border:1px solid var(--line);border-radius:7px;",
      "transition:border-color .2s ease,box-shadow .2s ease}",
    ".fld input:focus{outline:0;border-color:var(--acc);box-shadow:0 0 0 3px var(--faint)}",
    ".fld input::placeholder{color:var(--dim);opacity:.65}",

    ".picks{border:0;margin-bottom:20px}",
    ".picks legend{font-size:12px;font-weight:600;color:var(--dim);margin-bottom:11px;",
      "text-transform:uppercase;letter-spacing:.05em}",
    ".pick{display:flex;align-items:center;gap:11px;cursor:pointer;padding:3px 0;",
      "margin-bottom:6px}",
    ".pick:last-child{margin-bottom:0}",
    ".pick input{accent-color:var(--acc);width:17px;height:17px;flex:0 0 auto;cursor:pointer}",
    ".pick span{font-weight:600;font-size:15px}",

    ".go{display:block;width:100%;padding:15px;background:var(--acc);color:#fff;",
      "border:0;border-radius:7px;font:inherit;font-size:15px;font-weight:600;",
      "cursor:pointer;transition:filter .2s ease,transform .1s ease}",
    ".go:hover:not(:disabled){filter:brightness(1.08)}",
    ".go:active:not(:disabled){transform:translateY(1px)}",
    ".go:disabled{opacity:.6;cursor:default}",

    ".fine{margin-top:13px;font-size:12.5px;color:var(--dim);text-align:center}",
    ".msg{margin-top:12px;font-size:13.5px;text-align:center;color:var(--acc2)}",
    ".msg.bad{color:#e5484d}",

    /* The confirmation REPLACES the form. Leaving a filled-in form on screen
       under a success message invites a second submission. */
    ".done{text-align:center;padding:14px 0 6px}",
    ".done .mark{font-size:34px;line-height:1;color:var(--acc2)}",
    ".done .big{margin-top:12px;font-size:19px;font-weight:700}",
    ".done .sub{margin-top:7px;color:var(--dim);font-size:14.5px;line-height:1.6}",

    /* NARROW IS A CONTAINER QUESTION, NOT A WINDOW ONE, so this is a class the
       widget sets from its own measured width rather than a media query. A
       380px column on a large monitor needs exactly this treatment, and a
       media query would never fire there. */
    ".card.tight{padding:22px 18px}",
    ".card.tight .ttl{font-size:19px}",
    ".card.tight .blurb{font-size:13.5px;margin-top:6px}",
    ".card.tight .form{margin-top:18px}",
    ".card.tight .fld{margin-bottom:14px}",
    ".card.tight .fld>span{font-size:11px;margin-bottom:5px}",
    ".card.tight .fld input,.card.tight .fld select,.card.tight .fld textarea{",
      "padding:11px 12px;font-size:14px}",
    ".card.tight .picks legend{font-size:11px;margin-bottom:9px}",
    ".card.tight .pick span{font-size:14px}",
    ".card.tight .go{padding:13px;font-size:14.5px}",
    ".card.tight .fine{font-size:11.5px;margin-top:11px}",
    ".card.tight .done .big{font-size:17px}",
    ".card.tight .done .sub{font-size:13.5px}",
  ].join("");
}



/* ===========================================================================
   HOW A FORM BEHAVES ONCE IT IS ON SOMEBODY'S PAGE

   Shipped as source because the widgets are strings served to other people's
   websites and cannot import anything. Two constraints while editing: no
   backticks and no dollar-brace, since this is inlined into template literals.

   THREE THINGS, and each answers a question about a form that is NOT an
   iframe on a real page — it is a div in the host's own document, taking
   whatever width their column gives it.

   1. HEIGHT REPORTING is for the CONSOLE'S PREVIEW ONLY. On a real page the
      widget flows in the document and is exactly as tall as its content, with
      nothing to scroll. In the preview it lives in an iframe, and an iframe
      has a fixed height it does not learn from its contents — so the widget
      measures itself and tells the parent.

      MEASURE THE BODY'S RECT, NOT documentElement.scrollHeight. The latter is
      never smaller than the frame it is in, so a parent that SETS the frame to
      the reported value creates a ratchet: every measurement returns what the
      last one produced, and the box grows a little, permanently, on every
      redraw. embed-widget.js learned that the hard way.

   2. WIDTH IS A REAL CONSTRAINT the widget answers for itself. It cannot use a
      media query, because a media query asks how wide the WINDOW is and the
      question here is how wide the CONTAINER is — a 380px column on a desktop
      monitor needs the narrow layout just as much as a phone does. So the
      width is measured and a class is set.

   3. THE MESSAGE BOX GROWS with what is typed. A fixed box that scrolls
      internally hides the beginning of somebody's own sentence from them while
      they are still writing it.
   =========================================================================== */
export const BEHAVIOUR_JS = [
  "function reportHeight() {",
  "  if (window.parent === window) return;",
  "  try {",
  "    var b = document.body;",
  "    var h = b ? Math.ceil(b.getBoundingClientRect().height) : 0;",
  "    if (h > 0) window.parent.postMessage({ __thaumaHeight: h }, '*');",
  "  } catch (e) {}",
  "}",
  "",
  "/* Under about 26rem the card tightens: smaller type, less padding. Keyed to",
  "   the CONTAINER rather than the viewport, because that is the thing that",
  "   actually decides how much room the form has. */",
  "function applyWidth(node, card) {",
  "  var w = node.getBoundingClientRect().width;",
  "  if (!w) return;",
  "  card.classList.toggle('tight', w < 420);",
  "}",
  "",
  "function autoGrow(box) {",
  "  if (!box) return;",
  "  var grow = function () {",
  "    box.style.height = 'auto';",
  "    /* +2 for the border, or the last line sits under it and the box",
  "       twitches by a pixel on every keystroke. */",
  "    box.style.height = (box.scrollHeight + 2) + 'px';",
  "  };",
  "  box.addEventListener('input', function () { grow(); reportHeight(); });",
  "  grow();",
  "}",
  "",
  "function watch(node, card) {",
  "  applyWidth(node, card);",
  "  autoGrow(card.querySelector('textarea'));",
  "  reportHeight();",
  "  if (window.ResizeObserver) {",
  "    new window.ResizeObserver(function () {",
  "      applyWidth(node, card); reportHeight();",
  "    }).observe(node);",
  "  }",
  "  /* Fonts land after first paint and change every measurement. */",
  "  if (document.fonts && document.fonts.ready) {",
  "    document.fonts.ready.then(reportHeight).catch(function () {});",
  "  }",
  "  window.addEventListener('load', reportHeight);",
  "}",
].join("\n");
