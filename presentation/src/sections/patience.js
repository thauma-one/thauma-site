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
import { el, pixel, rushThenArrive, cascade, motion, T } from "../motifs.js";

/* Symbolic, not illustrated — the spec asks for one small icon per promise,
   not a scene. Drawn as pixel art on a 16x16 grid, which is legible beside
   Sora in a way drawn art pretending to be hand-made would not be, and which
   can be edited by looking at it. "#" is a filled pixel, "+" a half-weight
   one, "." empty. See pixel() in motifs.js. */
const ICONS = {
  /* Genesis 15: count the stars, if you are able to count them. */
  stars: pixel([
    "................",
    "......+.....#...",
    ".....+#+........",
    "......+.........",
    "...#............",
    "..........+.....",
    ".........+#+..#.",
    "..........+.....",
    "....+...........",
    "...+#+..........",
    "....+.......#...",
    "................",
    "............+...",
    ".#.........+#+..",
    "............+...",
    "................",
  ], { class: "icon" }),

  /* 1 Samuel 16: the horn of oil, tipped and pouring. */
  horn: pixel([
    "................",
    ".............##.",
    "............###.",
    "...........####.",
    ".........#####..",
    "........#####...",
    "......######....",
    ".....#####......",
    "...######.......",
    "..#####.........",
    ".#####..........",
    ".####...........",
    "..##............",
    "...#............",
    "................",
    "....+...........",
  ], { class: "icon" }),
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
