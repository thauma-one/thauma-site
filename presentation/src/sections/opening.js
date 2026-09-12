/**
 * Section 1 — Numbers, alone
 *
 * WHAT THIS SECTION IS FOR, in the founder's words: the room should leave it
 * thinking "that gap is much bigger than I realized". Everything here serves
 * that and nothing else.
 *
 * It used to be a different visual idea every ninety seconds — a text stack,
 * then two hand-drawn country blobs, then a pie chart that could not draw the
 * 0.18% it existed to show. Three unrelated devices, none of them landing,
 * and about 120 words of narration printed on screen for the founder to read
 * aloud against himself.
 *
 * It is now ONE device the whole way through: a single board, one figure at a
 * time, sized to fill the frame. The gap is made visible rather than
 * remembered — the number just left stays on screen above the new one, small
 * and dimmed, so 300,000 and 7,000 are looked at TOGETHER.
 *
 * The nouns do the rest. "Churches in the United States" against "Protestants
 * in all of Croatia" is the argument, and the mismatch in units is the point:
 * it must never be softened into comparing like with like.
 */
import { charCascade, flipTo, motion, setInstant, T } from "../motifs.js";

/**
 * FILL THE FRAME, measured from the BOARD rather than from the text.
 *
 * A flip board is a fixed number of cells, so its width is known before any
 * value is in it — four cells at 0.6em each, plus the unit beside them. Sizing
 * from the rendered characters instead would resize the board every time a
 * value with fewer digits arrived, which is the one thing a clock must not do.
 */
function fitBoard(figure, unit, frame, cells) {
  if (!figure || !frame) return;
  const room = frame.clientWidth * 0.9;
  const ceiling = Math.min(300, (frame.ownerDocument.defaultView?.innerHeight || 800) * 0.4);
  if (!room) return;

  /* Cells are .60em wide with .035em between them, and the unit runs about
     3.4 characters of its own much smaller size — call it 1.5em of the
     figure's. Generous rather than exact: too small merely leaves air. */
  const emWide = cells * 0.635 + (unit && unit.textContent ? 1.5 : 0);
  const size = Math.max(48, Math.min(ceiling, Math.floor(room / emWide)));
  figure.style.fontSize = `${size}px`;
}

/* A flip clock has no thousands separator — it has cells. Where a beat fixes
   the board width, the value is written plainly so that "2000" is four cells
   and not five; everywhere else the separator stays, because a number being
   read rather than clocked still wants it. */
const num = (n, cells) =>
  cells ? String(n) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What the board reads, figure and unit together, for the line above. */
const said = (b) => `${num(b.value, b.cells)}${b.unit ? (b.unit === "%" ? "%" : " " + b.unit) : ""}`;

/** One beat: a figure taking the board, or the section's single line. */
const beat = (i) => async ({ root, config }) => {
  const b = config.opening.beats[i];
  const frame = root.querySelector("[data-board]");
  const prior = root.querySelector("[data-prior]");
  const figure = root.querySelector("[data-figure]");
  const unit = root.querySelector("[data-unit]");
  const label = root.querySelector("[data-label]");
  const line = root.querySelector("[data-line-text]");

  if (b.line) {
    line.hidden = false;
    await new Promise((r) => requestAnimationFrame(r));
    line.classList.add("is-in");
    return;
  }

  line.classList.remove("is-in");
  line.hidden = true;

  /* THE GAP, held on screen. The figure being replaced does not vanish — it
     goes up, small and quiet, so the new one is read against it. `clear`
     starts a fresh movement, where there is nothing to compare against yet. */
  const previous = config.opening.beats[i - 1];
  if (b.clear || !previous || previous.line || !previous.value) {
    prior.innerHTML = "";
    prior.classList.remove("is-in");
  } else {
    prior.innerHTML = `<b>${said(previous)}</b> ${previous.label || ""}`;
    prior.classList.add("is-in");
  }

  /* The unit and the board are sized before anything turns over, so nothing
     moves sideways once the clock is running. */
  unit.textContent = b.unit || "";
  fitBoard(figure, unit, frame, b.cells || num(b.value).length);

  await flipTo(figure, num(b.value, b.cells), { cells: b.cells });

  label.textContent = b.label || "";
  label.classList.toggle("is-in", Boolean(b.label));
};

export const opening = {
  key: "opening",
  title: "Opening",

  render({ config }) {
    const o = config.opening;
    const node = document.createElement("div");
    node.className = "slide is-board";
    node.innerHTML = `
      <p class="cue" data-cue>${o.cue}</p>

      <div class="board" data-board>
        <!-- The number just left, kept so the next one is read against it. -->
        <div class="board-prior in" data-prior aria-hidden="true"></div>
        <div class="board-row">
          <div class="figure board-figure" data-figure></div>
          <span class="board-unit" data-unit></span>
        </div>
        <div class="figure-label board-label in" data-label></div>
      </div>

      <p class="lead in" data-line-text hidden>${o.line.text}</p>
    `;
    return node;
  },

  steps: (() => {
    const beats = [];

    /* THE NAME, full size and alone. Nothing else is on screen — the board is
       empty rather than sitting at zero, because a row of noughts is a reading
       and nothing has been read yet. */
    beats.push(async ({ root }) => {
      const cue = root.querySelector("[data-cue]");
      cue.classList.add("is-big");
      await charCascade(cue, { stagger: 90, duration: 1200 });
    });

    /* It takes its place, and the clock starts of its own accord. One press
       for both: the heading moving and the first figure arriving are one
       gesture, not two. */
    beats.push(async (ctx) => {
      ctx.root.querySelector("[data-cue]").classList.remove("is-big");
      await motion.wait(880);
      await beat(0)(ctx);
    });

    for (let i = 1; i < 8; i++) beats.push(beat(i));
    return beats;
  })(),

  /* Re-running the beat with motion off lands exactly the state it produces,
     without performing it — and without a second description of the section
     living somewhere else to drift out of step with the real one. */
  async rewind({ root, config, state, step }) {
    setInstant(true);
    try { await opening.steps[step]({ root, config, state, gate: () => Promise.resolve() }); }
    finally { setInstant(false); }
  },
};
