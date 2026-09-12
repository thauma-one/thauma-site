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


/* A CIRCLE OF DOTS, standing in for the country until its outline arrives.

   Placed by a fixed pseudo-random walk rather than at random, so the same
   slide looks the same in two different meetings. The outline goes in behind
   these — the hook is `[data-outline]`, and nothing else has to change. */
function scatter(count, seed) {
  let n = seed;
  const rnd = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out = [];
  while (out.length < count) {
    const x = rnd() * 2 - 1, y = rnd() * 2 - 1;
    if (x * x + y * y > 0.82) continue;              // keep them inside the disc
    out.push(`<circle cx="${(50 + x * 46).toFixed(1)}" cy="${(50 + y * 46).toFixed(1)}"
                      r="${(0.7 + rnd() * 1.5).toFixed(2)}"/>`);
  }
  return out.join("");
}

/** One country: the disc, then population / Protestants / share beneath it. */
function countryCard(c) {
  return `
    <figure class="country" data-country="${c.key}">
      <svg class="country-disc" viewBox="0 0 100 100" aria-label="${c.name}">
        <circle class="disc-edge" cx="50" cy="50" r="47"/>
        <g data-outline></g>
        <g class="disc-pins">${scatter(c.dots, c.seed)}</g>
      </svg>
      <figcaption class="country-name">${c.name}</figcaption>
      <div class="country-stats">
        <div><b data-stat="population"></b><span>Population</span></div>
        <div><b data-stat="protestants"></b><span>Protestants</span></div>
        <div><b data-stat="share"></b><span>of the country</span></div>
      </div>
    </figure>`;
}

/** Fill one card's three figures, flipping each board. */
async function fillCountry(root, c) {
  const card = root.querySelector(`[data-country="${c.key}"]`);
  if (!card) return;
  card.classList.add("is-in");
  const put = (name, text, cells) =>
    flipTo(card.querySelector(`[data-stat="${name}"]`), text, { cells });
  await Promise.all([
    put("population", num(c.population.value)),
    put("protestants", num(c.protestants.value)),
    put("share", `${c.share.value}%`),
  ]);
}

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
    root.querySelector("[data-countries]").hidden = true;
    root.querySelector("[data-board]").hidden = false;
    line.hidden = false;
    await new Promise((r) => requestAnimationFrame(r));
    line.classList.add("is-in");
    return;
  }

  line.classList.remove("is-in");
  line.hidden = true;
  root.querySelector("[data-board]").hidden = false;
  root.querySelector("[data-countries]").hidden = true;

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

      <!-- THE TWO COUNTRIES. Same three figures, same three places, so the
           screen that shows both is a comparison rather than a new picture. -->
      <div class="countries" data-countries hidden>
        ${o.countries.map(countryCard).join("")}
      </div>
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

      /* Put it at full size and in the middle of the SCREEN before anything is
         watched. Measured rather than guessed: the slide's own flow would
         center it against whatever else happens to be in the slide, which at
         this moment is an empty board and nothing else. */
      cue.style.transition = "none";
      cue.classList.add("is-big");
      await new Promise((r) => requestAnimationFrame(r));
      const here = cue.getBoundingClientRect();
      const screen = root.getBoundingClientRect();
      const dy = (screen.top + screen.height / 2) - (here.top + here.height / 2);
      cue.style.transform = `translateY(${Math.round(dy)}px)`;
      void cue.offsetWidth;
      cue.style.transition = "";

      await charCascade(cue, { stagger: 90, duration: 1200 });
    });

    /* It takes its place, and the clock starts of its own accord. One press
       for both: the heading moving and the first figure arriving are one
       gesture, not two. */
    beats.push(async (ctx) => {
      const cue = ctx.root.querySelector("[data-cue]");
      cue.classList.remove("is-big");
      cue.style.transform = "";          // back to where it belongs
      await motion.wait(880);
      await beat(0)(ctx);
    });

    for (let i = 1; i < 4; i++) beats.push(beat(i));

    /* America, then Croatia, then both. The board and its prior line step
       aside; the countries take the screen. */
    const stage = (keys) => async ({ root, config }) => {
      /* The clock and its line have said what they had to say. */
      root.querySelector("[data-board]").hidden = true;
      root.querySelector("[data-prior]").classList.remove("is-in");
      const line = root.querySelector("[data-line-text]");
      line.classList.remove("is-in");
      line.hidden = true;
      const box = root.querySelector("[data-countries]");
      box.hidden = false;
      box.classList.toggle("is-pair", keys.length > 1);
      for (const c of config.opening.countries) {
        const card = root.querySelector(`[data-country="${c.key}"]`);
        card.hidden = !keys.includes(c.key);
      }
      await new Promise((r) => requestAnimationFrame(r));
      for (const key of keys) {
        await fillCountry(root, config.opening.countries.find((c) => c.key === key));
      }
    };
    beats.push(stage(["us"]));
    beats.push(stage(["hr"]));
    beats.push(stage(["us", "hr"]));
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
