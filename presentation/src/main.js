/**
 * main.js — assembles the deck
 *
 * Sections are registered in order. Nothing here knows what any of them say;
 * the content is entirely in config.js, which is the whole point of keeping
 * them apart — a figure changing must never mean opening animation code.
 */
import { mount, registerSection, state, next, prev, goTo, currentSection } from "./deck.js";
import { config } from "../config.js";
import { prep, title, closing } from "./sections/bookends.js";
import { opening } from "./sections/opening.js";
import { heart } from "./sections/heart.js";
import { methods } from "./sections/methods.js";
import { patience } from "./sections/patience.js";
import { schedule } from "./sections/schedule.js";
import { ask } from "./sections/ask.js";

[prep, title, opening, heart, methods, patience, schedule, ask, closing]
  .forEach(registerSection);

/* Named for what it is, so it cannot collide with deck.js's own module-level
   `root` once the build flattens every file into one scope. */
const deckRoot = document.getElementById("deck");

/* Sections that own live controls get wired when they mount. The deck rebuilds
   its DOM on every section change, so a listener bound once at startup would
   be pointing at elements that no longer exist. */
const observer = new MutationObserver(() => {
  const section = currentSection();
  if (!section || !section.wire || deckRoot.dataset.wired === section.key) return;
  deckRoot.dataset.wired = section.key;
  section.wire(deckRoot, state, { config, onBegin: () => goTo(1) });
});
observer.observe(deckRoot, { childList: true });

mount(deckRoot);

/* A faint reminder of how to move, for the presenter only. A viewer following
   a shared link gets the same keys but does not need telling. */
if (state.mode === "present") {
  const hint = document.createElement("div");
  hint.className = "deck-hint";
  hint.textContent = "space / → advance";
  document.body.appendChild(hint);
}

/* Exposed so the page can be driven from a clicker or a test without
   reaching into module internals. */
/* The one global. A clicker, a test, or a person in a console can drive the
   deck without reaching into internals — and there is exactly one name on
   `window` rather than a scattering. */
window.Deck = { next, prev, goTo, state, config, section: currentSection };
