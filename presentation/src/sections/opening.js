/**
 * Section 1 — Numbers, alone
 *
 * WHAT THIS SECTION IS FOR, in the founder's words: the room should leave it
 * thinking "that gap is much bigger than I realised". Everything here serves
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
 * FILL THE FRAME. A figure that is the only thing on screen should occupy the
 * screen, and "300,000" and "2" cannot do that at the same font size — seven
 * characters against one. The size is measured rather than guessed, so every
 * number lands at the same visual weight however many digits it has.
 */
function fitFigure(figure, frame) {
  if (!figure || !frame) return;
  const room = frame.clientWidth * 0.88;
  const ceiling = Math.min(380, (frame.ownerDocument.defaultView?.innerHeight || 800) * 0.44);
  if (!room) return;

  figure.style.fontSize = `${ceiling}px`;
  const measured = figure.scrollWidth;
  if (!measured) return;
  let size = Math.max(56, Math.min(ceiling, Math.floor((ceiling * room) / measured)));
  figure.style.fontSize = `${size}px`;

  /* One correction, because the glyphs are not perfectly proportional. */
  if (figure.scrollWidth > room) {
    size = Math.max(56, Math.floor((size * room) / figure.scrollWidth));
    figure.style.fontSize = `${size}px`;
  }
}

const num = (n) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What the board reads, figure and unit together, for the line above. */
const said = (b) => `${num(b.value)}${b.unit ? (b.unit === "%" ? "%" : " " + b.unit) : ""}`;

/** One beat: either a figure taking the board, or the section's single line. */
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
  if (b.clear || !figure.textContent.trim() || !previous || previous.line) {
    prior.innerHTML = "";
    prior.classList.remove("is-in");
  } else {
    prior.innerHTML = `<b>${said(previous)}</b> ${previous.label}`;
    prior.classList.add("is-in");
  }

  label.classList.remove("is-in");
  unit.textContent = "";

  /* The figure is measured and sized BEFORE the board starts spinning, or it
     resizes itself underneath a running animation. */
  figure.classList.remove("flip");
  figure.textContent = num(b.value);
  fitFigure(figure, frame);
  await flipTo(figure, num(b.value));

  unit.textContent = b.unit || "";
  label.textContent = b.label;
  label.classList.add("is-in");
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
    /* The first beat carries the section's arrival with it. */
    beats.push(async (ctx) => {
      await Promise.all([
        charCascade(ctx.root.querySelector("[data-cue]"), { stagger: 55, duration: 1300 }),
        (async () => { await motion.wait(380); await beat(0)(ctx); })(),
      ]);
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
