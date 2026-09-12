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
import { setBeatGate, setInstant, isInstant, motion, T } from "./motifs.js";

export const state = {
  presenter: {
    online: false,          // offline is the default: it always works
    defaultTier: "sys",
    note: "",
    started: false,
    /* Whether the deck waits for the presenter between beats. True whenever a
       person is driving it; turned off for shared links, which have nobody to
       press the bar, and by the tests, which drive the beats themselves. */
    gated: true,
  },
  nav: { section: 0, step: 0, playing: false },
  live: { counts: null, fetchedAt: null, error: null },
  /* `tier` is which row the ask is currently pointed at. It lives in view
     state, not presenter state: the prep screen chooses where it STARTS, and
     the presenter moves it during the conversation. */
  view: { budgetOpen: false, annualOpen: false, tier: null },
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

  /* STRAIGHT TO ONE SECTION. Reviewing the deck a section at a time otherwise
     means pressing through everything in front of it, which costs more than
     the change being reviewed. ?s=schedule opens there; ?s=6 does the same by
     index. Add &play=1 to skip the gates and watch it run, which is the only
     way to see the pacing of one section without driving it. */
  const jump = params.get("s");
  if (jump !== null) {
    const byIndex = Number(jump);
    const i = Number.isInteger(byIndex) && String(byIndex) === jump.trim()
      ? byIndex
      : sections.findIndex((x) => x.key === jump);
    if (i >= 0 && i < sections.length) {
      state.nav.section = i;
      state.presenter.started = true;
    }
  }
  if (params.get("play") === "1") state.presenter.gated = false;

  if (params.get("view") === "1" || params.has("shared")) {
    state.mode = "view";
    state.presenter.started = true;
    /* AND START PAST IT. Setting the flag was not enough — the deck still
       rendered section 0, so a shared link opened on somebody else's
       pre-meeting checklist. Index 1 is the title. An explicit ?s= wins:
       a link sent to one person, opened at one section, is a deliberate
       thing and this must not quietly drag it back to the front. */
    if (jump === null) state.nav.section = 1;
  }
  render();
  wire();
}

/** The DOM swap on its own. No beats. */
async function paint() {
  const section = currentSection();
  if (!section) return null;

  /* SECTIONS ARRIVE AND LEAVE, they do not cut. Wiping innerHTML and painting
     the next one put the deck's hardest transition — a whole screen changing —
     on the only moment with no motion at all: text simply appeared. The old
     screen now withdraws and the new one settles in behind it, which is the
     same restraint every beat inside a section already has.

     Skipped while replaying, where nothing is meant to be watched. */
  const outgoing = root.firstChild && !isInstant();
  if (outgoing) {
    root.classList.add("is-leaving");
    await motion.wait(T.quick * 0.55);
  }

  root.innerHTML = "";
  const node = section.render({ config, state });
  root.appendChild(node);
  root.dataset.section = section.key;
  announce(section);

  if (outgoing) {
    root.classList.remove("is-leaving");
    root.classList.add("is-arriving");
    /* Two frames, not one: the class has to be painted before it is taken away
       or the browser collapses both states into no transition at all. */
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove("is-arriving")));
  }
  return section;
}

async function render() {
  if (!(await paint())) return;
  /* NOT AWAITED. A section's first step suspends on a gate until the presenter
     presses the bar, so awaiting it here would mean goTo() never resolves —
     the deck would render and then hang on its own caller. The DOM is in place
     by this line; the beats after it belong to the presenter. */
  play();
}

/** Paint and run the first beat to completion. Only safe while replaying,
    where gates resolve immediately and nothing waits. */
async function renderNow() {
  if (!(await paint())) return;
  await play();
}

/* ONE PRESS, ONE THING.

   A step describes a whole passage — the tiers arriving, a figure counting up,
   a line being written. Left to itself a step runs its beats on timers, which
   means one press fires a long sequence the presenter cannot talk over. A gate
   hands control back mid-step: the step suspends until the next press, so the
   pace belongs to the person in the room rather than to a number in this file.

   Shared links resolve gates immediately — nobody is there to press. */
let pendingGate = null;
let replaying = false;

function gate() {
  /* A replay is not a performance. Nobody is pressing the bar through it. */
  if (isInstant() || replaying) return Promise.resolve();
  if (!state.presenter.gated || state.mode === "view") return Promise.resolve();
  /* Suspended is not playing. The flag exists to swallow presses that would
     stack up mid-animation; while a beat waits for the bar the presenter has
     the floor, and leaving it set would lock them out of going back. */
  state.nav.playing = false;
  return new Promise((resolve) => {
    pendingGate = () => { state.nav.playing = true; resolve(); };
  });
}

/** Let a suspended step continue. Returns true if a press was spent doing it. */
/* Every reveal in every section runs through cascade(), so handing it the gate
   here makes the whole deck press-driven in one place. */
setBeatGate(() => gate());

function releaseGate() {
  if (!pendingGate) return false;
  const resume = pendingGate;
  pendingGate = null;
  resume();
  return true;
}

/** Run the current step's animation. Steps are indexes into section.steps. */
async function play() {
  const section = currentSection();
  if (!section || !section.steps) return;
  const step = section.steps[state.nav.step];
  if (!step) return;
  state.nav.playing = true;
  try { await step({ root, config, state, gate }); }
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
  /* A suspended beat has first claim on the press — that IS the advance. */
  if (releaseGate()) return;
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
/**
 * BACK ONE BEAT, the way every presentation tool has worked for thirty years.
 *
 * This used to reset the whole section — one press of the left arrow threw away
 * everything the presenter had built up and started the section again, which in
 * front of somebody is worse than not being able to go back at all.
 *
 * A beat cannot simply be undone: each one is an animation that leaves the DOM
 * changed, and step four exists only because steps one to three ran. So going
 * back rebuilds the section and replays it instantly up to the beat wanted.
 * From the first beat of a section, it lands on the LAST beat of the one
 * before, which is what "back" means to anybody who has used slides.
 */
export async function prev() {
  /* Going back abandons a suspended beat. The orphaned step finishes into
     nodes that render() has already discarded, which is harmless. */
  pendingGate = null;
  if (state.nav.playing) return;

  if (state.nav.step > 0) { await rewindTo(state.nav.section, state.nav.step - 1); return; }
  if (state.nav.section > 0) {
    const i = state.nav.section - 1;
    const steps = sections[i].steps || [];
    await rewindTo(i, Math.max(0, steps.length - 1));
  }
}

/** Rebuild a section and replay it, unwatched, up to one beat. */
async function rewindTo(sectionIndex, step) {
  state.nav.section = sectionIndex;
  state.nav.step = 0;
  replaying = true;
  setInstant(true);
  try {
    await renderNow();
    const steps = currentSection()?.steps || [];

    /* Everything BEFORE the destination is scaffolding — it only has to leave
       the DOM in the right state, and watching it rebuild would be nonsense. */
    for (let i = 1; i < step && i < steps.length; i++) {
      state.nav.step = i;
      try { await steps[i]({ root, config, state, gate }); }
      catch (err) { console.error("replay step failed:", err); }
    }

    /* THE DESTINATION IS WATCHED. Landing on a beat should look like arriving
       at it — the camera pans, the row appears — or going back reads as a jump
       cut, which is exactly what it looked like before this. */
    if (step > 0 && step < steps.length) {
      setInstant(false);
      state.nav.step = step;
      try { await steps[step]({ root, config, state, gate }); }
      catch (err) { console.error("replay step failed:", err); }
    }
  } finally {
    setInstant(false);
    replaying = false;
  }
}

export async function goTo(index) {
  state.nav.section = Math.max(0, Math.min(sections.length - 1, index));
  state.nav.step = 0;
  await render();
}

/* FULL SCREEN. A support-raising conversation happens on a laptop on somebody's
   coffee table, and a browser's tab strip and bookmarks bar sitting above the
   deck are the difference between a presentation and a web page. Bound to F,
   and offered on the prep screen so it does not have to be remembered. */
export async function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: "hide" });
  } catch { /* refused by the browser, which is its right — nothing breaks */ }
}

function wire() {
  document.addEventListener("keydown", (e) => {
    /* e.target is not always an element — a keypress with nothing focused
       targets the document, which has no matches(). Left unguarded this throws
       inside the handler and every arrow key stops working for the rest of the
       presentation, which is not a failure anybody could recover from in a
       living room. */
    const t = e.target;
    if (t instanceof Element && t.matches("input, textarea, select")) return;

    /* A section may own keys of its own — the ask moves its tier on up/down.
       It gets first refusal, and the deck keeps left/right regardless, so a
       section can never take navigation away from the presenter. */
    const section = sections[state.nav.section];
    if (section?.onKey && section.onKey(e, { root, state, config })) return;

    if ([" ", "ArrowRight", "PageDown", "Enter"].includes(e.key)) { e.preventDefault(); next(); }
    else if (["ArrowLeft", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); prev(); }
    else if (e.key === "Home") goTo(0);
    else if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
  });

  /* Tap to advance, but never when the tap was meant for something — a corner
     toggle, the ask-amount box, a link. */
  document.addEventListener("click", (e) => {
    if (e.target instanceof Element &&
        e.target.closest("button, a, input, select, textarea, [data-no-advance]")) return;
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
