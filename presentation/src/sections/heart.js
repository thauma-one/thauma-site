/**
 * Section 2 — The Heart: people feel seen (3 min)
 *
 * The shortest section and the quietest. The spec warns explicitly against
 * over-decorating the most important sentence in the deck, so there is exactly
 * one piece of motion here: the correction. Everything else fades in and stops.
 *
 * The correction does more than illustrate the point — it enacts it. The room
 * watches the ordinary version of the sentence get changed in real time, the
 * same way the founder corrects it in his own thinking. It also plants the
 * motif that pays off twice more without ever being explained.
 */
import { el, correct, cascade, motion } from "../motifs.js";

export const heart = {
  key: "heart",
  title: "The heart",

  render({ config }) {
    const c = config.heart;
    return el(`
      <div class="slide is-narrow">
        <p class="cue foam in" data-r>The heart</p>

        <div class="hand-ground in" data-r>
          <p class="correction">
            ${c.correction.before}
            <span data-strike>${c.correction.struck}</span>
            <span data-written></span>
            ${c.correction.after}
          </p>
        </div>

        <div class="stack">
          ${c.principle.map((line) => `<p class="in" data-p>${line}</p>`).join("")}
        </div>

        <p class="lead in" data-p>${c.who}</p>
        <p class="in" data-p>${c.scripture}</p>
      </div>
    `);
  },

  steps: [
    /* The sentence arrives printed and ORDINARY. It has to be read as the
       normal thing to say before it is worth correcting. */
    async ({ root }) => {
      await cascade([...root.querySelectorAll("[data-r]")], { gap: 220 });
      await motion.wait(300);
      await correct(root.querySelector(".hand-ground"), {
        struck: root.querySelector("[data-strike]").textContent,
        written: "FEEL",
      });
    },
    /* Then the operating principle underneath it — what the conviction
       actually changes about how the work is done. */
    async ({ root }) => {
      await cascade([...root.querySelectorAll("[data-p]")], { gap: 240 });
    },
  ],
};
