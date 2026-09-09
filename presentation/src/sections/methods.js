/**
 * Section 3 — How Thauma meets the need (5–6 min)
 *
 * Three methods converging on ONE destination — not four equal bullets.
 * Community is not a fourth item on the list; it is what the other three exist
 * to reach, and the visual has to make that difference visible or the section
 * collapses back into a list.
 *
 * So: three build up in sequence, then RESOLVE into a fourth thing that is not
 * beside them. The converging lines are a quiet nod to the founder's own
 * napkin origin story, which the spec asks for without narrating.
 *
 * Nothing here illustrates brokenness. The posture is partnership, never
 * rescue — no damaged gear, no struggling volunteers, no before-and-after.
 */
import { el, cascade, motion, T } from "../motifs.js";

export const methods = {
  key: "methods",
  title: "How we meet the need",

  render({ config }) {
    const m = config.methods;
    return el(`
      <div class="slide">
        <p class="cue in" data-open>How we meet it</p>

        <div class="converge">
          <svg viewBox="0 0 720 260" class="converge-svg" aria-hidden="true">
            <!-- Three lines that MEET. Drawn stroke-first so the convergence
                 is watched happening rather than presented as a diagram. -->
            <path class="flow" data-flow="0" d="M40 40 C 240 40, 300 130, 480 130"/>
            <path class="flow" data-flow="1" d="M40 130 C 240 130, 300 130, 480 130"/>
            <path class="flow" data-flow="2" d="M40 220 C 240 220, 300 130, 480 130"/>
            <circle class="node" data-node cx="480" cy="130" r="7"/>
          </svg>

          <ol class="method-list">
            ${m.steps.map((s, i) => `
              <li class="method in" data-method="${i}">
                <h3>${s.title}</h3>
                <p>${s.body}</p>
              </li>`).join("")}
          </ol>
        </div>

        <div class="destination in" data-dest>
          <p class="cue foam">${m.destination.title}</p>
          <p class="lead">${m.destination.body}</p>
          <p class="dest-note">${m.destination.note}</p>
        </div>
      </div>
    `);
  },

  steps: [
    async ({ root }) => cascade([...root.querySelectorAll("[data-open]")], { gap: 220 }),

    /* Each method arrives with its own line reaching toward the meeting
       point. They are three, and they are going somewhere. */
    async ({ root }) => {
      const flows = [...root.querySelectorAll(".flow")];
      const items = [...root.querySelectorAll("[data-method]")];
      for (let i = 0; i < items.length; i++) {
        flows[i]?.classList.add("is-drawn");
        items[i].classList.add("is-in");
        await motion.wait(T.normal);
      }
    },

    /* ARRIVAL, not a fourth bullet. The node lands after the lines have all
       reached it, and the destination is set apart from the list above it. */
    async ({ root }) => {
      await motion.wait(T.quick);
      root.querySelector("[data-node]").classList.add("is-in");
      await motion.wait(T.beat);
      root.querySelector("[data-dest]").classList.add("is-in");
    },
  ],
};
