/**
 * Section 4 — Aligning with God's timeline, not ours (4–5 min)
 *
 * Not a list of problems: a statement of how Thauma is built. The foundation
 * is laid slowly on purpose.
 *
 * THIS SECTION OWNS THE FAST MOTION. It is the one place in the deck where
 * quicker movement is earned, precisely because it is contrasted against a
 * slowdown — which is why the spec forbids fast motion anywhere else. Used
 * decoratively elsewhere it would spend the meaning this depends on.
 *
 * The two completed timelines end in handwriting because those stories are
 * finished. Thauma's does not, and the visual has to say so on its own.
 */
import { el, rushThenArrive, cascade, motion, T } from "../motifs.js";

/* Symbolic, not illustrated. The spec asks for single small icons rather than
   detailed scenes, and simple geometry sits better beside Sora than drawn art
   pretending to be hand-made would. */
const ICONS = {
  stars: `<svg viewBox="0 0 40 40" class="icon" aria-hidden="true">
    <g fill="currentColor">
      <circle cx="9" cy="12" r="1.6"/><circle cx="20" cy="7" r="2.1"/>
      <circle cx="31" cy="13" r="1.5"/><circle cx="14" cy="24" r="1.3"/>
      <circle cx="26" cy="27" r="1.8"/><circle cx="33" cy="31" r="1.2"/>
      <circle cx="7" cy="31" r="1.4"/>
    </g></svg>`,
  horn: `<svg viewBox="0 0 40 40" class="icon" aria-hidden="true">
    <path d="M8 26c0-7 5-13 12-14 5-1 9 1 11 4-3 1-5 3-6 6-1 4-4 7-8 8-4 1-8-1-9-4z"
          fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M20 12c1-3 3-5 6-6" fill="none" stroke="currentColor" stroke-width="1.4"
          stroke-linecap="round"/></svg>`,
};

function promiseBlock(id, data) {
  return `
    <div class="promise rush" data-promise="${id}" hidden>
      <div class="promise-head in" data-head>
        <span class="promise-icon">${ICONS[data.icon] || ""}</span>
        <h3>${data.promise}</h3>
      </div>
      <div data-line class="promise-line"></div>
      <ol class="beats">
        ${data.beats.map((b) => `
          <li data-beat><span>${b.label}</span>${
            b.note ? `<span class="beat-note"> — ${b.note}</span>` : ""}</li>`).join("")}
      </ol>
      <div data-arrival class="arrival"></div>
    </div>`;
}

export const patience = {
  key: "patience",
  title: "God's timeline",

  render({ config }) {
    const p = config.patience;
    return el(`
      <div class="slide">
        <p class="cue foam in" data-open>Patience</p>
        <div class="stack">
          ${p.american.map((l) => `<p class="lead in" data-open>${l}</p>`).join("")}
          <p class="in" data-open>${p.testimony}</p>
        </div>

        ${promiseBlock("abraham", p.abraham)}
        ${promiseBlock("david", p.david)}

        <div class="promise" data-promise="thauma" hidden>
          <div class="promise-head in" data-head><h3>And ours</h3></div>
          ${p.thauma.why.map((l) => `<p class="in" data-why>${l}</p>`).join("")}
          <div class="line-unresolved" data-unresolved></div>
          <p class="hope in" data-why>${p.thauma.hope.text}</p>
          <p class="in" data-why>${p.thauma.named}</p>
        </div>
      </div>
    `);
  },

  steps: [
    /* The impatience, and the counter-commitment. Plain text, no motion
       beyond arriving — the argument has to land before the device does. */
    async ({ root }) => {
      await cascade([...root.querySelectorAll("[data-open]")], { gap: 260 });
    },

    /* Abraham. Twenty-five years pass in a few seconds, each one a real
       event rather than empty time, and then it stops. */
    async ({ root, config }) => {
      const block = root.querySelector('[data-promise="abraham"]');
      block.hidden = false;
      block.querySelector("[data-head]").classList.add("is-in");
      await motion.wait(T.quick);
      await rushThenArrive(block, { hand: config.patience.abraham.fulfillment.hand });
    },

    /* David. Same device, and the spec is deliberate that this one contains a
       PARTIAL fulfillment before the whole — a promise sometimes arrives in
       pieces. The beats carry that; the device does not need to change. */
    async ({ root, config }) => {
      const block = root.querySelector('[data-promise="david"]');
      block.hidden = false;
      block.querySelector("[data-head]").classList.add("is-in");
      await motion.wait(T.quick);
      await rushThenArrive(block, { hand: config.patience.david.fulfillment.hand });
    },

    /* Thauma's own — and it must NOT resolve. No slowdown into a fixed point,
       no handwriting, no endpoint. The line simply thins and fades, and the
       hope is set faintly rather than boldly. */
    async ({ root }) => {
      const block = root.querySelector('[data-promise="thauma"]');
      block.hidden = false;
      block.querySelector("[data-head]").classList.add("is-in");
      await motion.wait(T.quick);
      await cascade([...block.querySelectorAll("[data-why]")], { gap: 260 });
    },
  ],
};
