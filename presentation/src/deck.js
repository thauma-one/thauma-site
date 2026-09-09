/**
 * deck.js — navigation, state, and the playback model
 *
 * THE PLAYBACK MODEL, which the spec calls a hybrid and which is the thing
 * most likely to be got wrong: WITHIN a step, elements animate automatically —
 * numbers count, maps collapse, text builds. BETWEEN steps, nothing happens
 * until a person asks for it. It plays like a video and advances like a deck.
 *
 * A section is a list of STEPS rather than one animation, which is what lets
 * Section 5 give each milestone its own beat and Section 1 breathe between the
 * United States and Croatia — without either needing a special case.
 *
 * THREE KINDS OF STATE, KEPT APART, as the spec requires:
 *   presenter  — chosen before the meeting starts (online/offline, default tier)
 *   nav        — where we are now
 *   live       — what the API said, when it could be reached
 * Corner toggles in Section 6 are none of these; they are view state, and
 * opening one must never move the deck.
 */
import { config } from "../config.js";

export const state = {
  presenter: {
    online: false,          // offline is the default: it always works
    defaultTier: "sys",
    note: "",
    started: false,
  },
  nav: { section: 0, step: 0, playing: false },
  live: { counts: null, fetchedAt: null, error: null },
  view: { budgetOpen: false, annualOpen: false },
  /* A shared link is watched by somebody on their own. They get the deck and
     none of the presenter's controls. */
  mode: "present",
};

const sections = [];
let root = null;

export function registerSection(section) { sections.push(section); }
export function sectionCount() { return sections.length; }
export function currentSection() { return sections[state.nav.section]; }

export function mount(el) {
  root = el;
  /* A shared link opens at the title, never at the prep screen: the prep
     screen is a checklist for one person, and a viewer landing on somebody
     else's configuration would be confusing and slightly odd. */
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "1" || params.has("shared")) {
    state.mode = "view";
    state.presenter.started = true;
    /* AND START PAST IT. Setting the flag was not enough — the deck still
       rendered section 0, so a shared link opened on somebody else's
       pre-meeting checklist. Index 1 is the title. */
    state.nav.section = 1;
  }
  render();
  wire();
}

async function render() {
  const section = currentSection();
  if (!section) return;
  root.innerHTML = "";
  const node = section.render({ config, state });
  root.appendChild(node);
  root.dataset.section = section.key;
  announce(section);
  await play();
}

/** Run the current step's animation. Steps are indexes into section.steps. */
async function play() {
  const section = currentSection();
  if (!section || !section.steps) return;
  const step = section.steps[state.nav.step];
  if (!step) return;
  state.nav.playing = true;
  try { await step({ root, config, state }); }
  catch (err) { console.error("step failed:", err); }
  state.nav.playing = false;
}

/**
 * Forward. Within a section this advances a step and plays it; at the end of a
 * section it moves on. A press DURING an animation completes it rather than
 * queueing another — a presenter clicking twice should not find the deck two
 * beats ahead of what they are saying.
 */
export async function next() {
  const section = currentSection();
  if (!section) return;
  if (state.nav.playing) return;

  const steps = section.steps || [];
  if (state.nav.step < steps.length - 1) {
    state.nav.step += 1;
    await play();
    return;
  }
  if (state.nav.section < sections.length - 1) {
    state.nav.section += 1;
    state.nav.step = 0;
    await render();
  }
}

/**
 * Back goes to the START of the previous section, not to the previous step.
 *
 * Deliberate: stepping backwards through an animation means replaying it
 * half-finished, and a presenter reaching for "back" almost always means "take
 * me to the beginning of what I was just saying" rather than "undo one beat".
 */
export async function prev() {
  if (state.nav.playing) return;
  if (state.nav.step > 0) { state.nav.step = 0; await render(); return; }
  if (state.nav.section > 0) {
    state.nav.section -= 1;
    state.nav.step = 0;
    await render();
  }
}

export async function goTo(index) {
  state.nav.section = Math.max(0, Math.min(sections.length - 1, index));
  state.nav.step = 0;
  await render();
}

function wire() {
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if ([" ", "ArrowRight", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === "Home") goTo(0);
  });

  /* Tap to advance, but never when the tap was meant for something — a corner
     toggle, the ask-amount box, a link. */
  document.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select, textarea, [data-no-advance]")) return;
    next();
  });
}

/* Said out loud for a screen reader, since the visual change is the only other
   signal that the deck has moved. */
function announce(section) {
  let live = document.getElementById("deck-live");
  if (!live) {
    live = document.createElement("div");
    live.id = "deck-live";
    live.className = "sr-only";
    live.setAttribute("aria-live", "polite");
    document.body.appendChild(live);
  }
  live.textContent = section.title || "";
}

/**
 * Live tier counts, when there is a network and the presenter asked for it.
 *
 * OFFLINE IS NOT A DEGRADED PATH. The deck must be fully presentable in
 * somebody's front room with bad wifi, so this never blocks a render and never
 * throws: it returns the configured counts and records why. The spec's own
 * words — live data is an enhancement, never a dependency.
 */
export async function loadLive() {
  const fallback = { counts: config.ask.offlineCounts, fetchedAt: null, error: null };
  if (!state.presenter.online) { state.live = { ...fallback, error: "offline by choice" }; return state.live; }
  try {
    const res = await fetch("/api/presentation/tiers", { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`refused (${res.status})`);
    const body = await res.json();
    state.live = { counts: body.counts || config.ask.offlineCounts,
                   fetchedAt: new Date().toISOString(), error: null };
  } catch (err) {
    state.live = { ...fallback, error: err.message };
  }
  return state.live;
}
