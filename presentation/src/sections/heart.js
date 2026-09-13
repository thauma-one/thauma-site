/**
 * Section 2 — The Heart: people feel seen
 *
 * The spec calls this the quietest, most personal moment in the deck and warns
 * in its own words against over-decorating the most important sentence in it.
 * So there is exactly one piece of motion: the ordinary word is struck and the
 * real one is written by hand above it. Everything else arrives and stops.
 *
 * ABOVE IT, NOT AFTER IT. Writing the replacement into the line re-flows the
 * sentence, and this sentence must not move while somebody is reading it. The
 * written word floats over the struck one, so the line is set once and never
 * shifts by a pixel.
 *
 * And it is written rather than revealed. The word is the stroke a pen makes,
 * paid out from its own beginning — not letters sitting behind a shutter.
 */
import { el, correct, charCascade, unCascade, motion, setInstant, T } from "../motifs.js";

/** The lines under the sentence, in the order they are spoken. */
const LINES = ["principle", "who", "scripture"];

export const heart = {
  key: "heart",
  title: "The heart",

  render({ config }) {
    const c = config.heart;
    return el(`
      <div class="slide is-narrow is-heart">
        <p class="cue foam" data-cue>The heart</p>

        <!-- ONE LINE, set once. The written word is absolutely placed above
             the struck one, so nothing here can re-flow. -->
        <p class="correction" data-sentence>
          ${c.correction.before}
          <span class="struck-slot">
            <span data-strike>${c.correction.struck}</span>
            <span class="hand-slot" data-written></span>
          </span>
          ${c.correction.after}
        </p>

        <div class="heart-lines">
          ${LINES.map((k) => `<p class="lead in" data-heart-line="${k}">${c[k]}</p>`).join("")}
        </div>
      </div>
    `);
  },

  steps: (() => {
    const beats = [];

    /* The sentence arrives printed and ORDINARY. It has to be read as the
       normal thing to say before it is worth correcting. */
    beats.push(async ({ root }) => {
      const cue = root.querySelector("[data-cue]");
      cue.classList.remove("cc");
      cue.textContent = "The heart";
      await charCascade(cue, { stagger: 55, duration: 1100 });
      root.querySelector("[data-sentence]").classList.add("is-in");
      await motion.wait(T.normal);
    });

    /* THE CORRECTION. The only motion in the section. */
    beats.push(async ({ root, config }) => {
      await correct(root.querySelector(".correction"), { hand: config.heart.correction.hand });
    });

    /* Then one line at a time, and nothing else moves. */
    for (const key of LINES) {
      beats.push(async ({ root }) => {
        root.querySelector(`[data-heart-line="${key}"]`).classList.add("is-in");
        await motion.wait(T.quick);
      });
    }
    return beats;
  })(),

  /**
   * Backwards, beat by beat. The lines go out the way they came in; the
   * correction un-writes itself — the stroke is paid back into its own start,
   * which is the only honest reverse of a pen — and then the strike lifts.
   */
  async back({ root, config, step }) {
    const lineAt = step - 2;                    // beats 2..4 are the three lines
    if (lineAt >= 0 && lineAt < LINES.length) {
      root.querySelector(`[data-heart-line="${LINES[lineAt]}"]`).classList.remove("is-in");
      await motion.wait(T.quick);
      return;
    }

    if (step === 1) {
      const written = root.querySelector("[data-written] .hw");
      if (written) {
        for (const path of [...written.querySelectorAll(".hw-stroke")].reverse()) {
          const len = path.getTotalLength ? path.getTotalLength() : 400;
          path.style.transition = `stroke-dashoffset 360ms ${T.hand}`;
          path.style.strokeDashoffset = len;
          await motion.wait(300);
        }
        await motion.wait(160);
        written.remove();
      }
      root.querySelector("[data-strike]").classList.remove("is-struck");
      await motion.wait(T.quick);
      return;
    }

    /* And out of the section: the sentence and its heading withdraw. */
    root.querySelector("[data-sentence]").classList.remove("is-in");
    await unCascade(root.querySelector("[data-cue]"), { stagger: 34, duration: 520 });
  },
};
