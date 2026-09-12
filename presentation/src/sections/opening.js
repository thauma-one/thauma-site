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
        <div data-figure-group><b data-stat="population"></b><span>Population</span></div>
        <div data-figure-group><b data-stat="protestants"></b><span>Protestants</span></div>
        <div data-figure-group><b data-stat="share"></b><span>of the country</span></div>
      </div>
    </figure>`;
}

/** Put the three figures in without ceremony, for the screen that compares. */
function setStats(root, c) {
  const card = root.querySelector(`[data-country="${c.key}"]`);
  if (!card) return;
  const put = (name, text) => {
    const cell = card.querySelector(`[data-stat="${name}"]`);
    cell.className = "";               // drop any cascade spans from before
    cell.textContent = text;
    cell.closest("[data-figure-group]").classList.add("is-in");
  };
  put("population", num(c.population.value));
  put("protestants", num(c.protestants.value));
  put("share", `${c.share.value}%`);
  card.classList.add("is-in");
}

/**
 * One country, a figure at a time, each on its own press.
 *
 * WRITTEN, NOT CLOCKED. The flip board belongs to the years — three of them on
 * one screen was both too much machinery for a comparison and too wide to fit,
 * which is why the digits were coming out shorn. These are cascaded in, which
 * is the deck's other way of making type arrive and costs no width at all.
 */
async function tellCountry(root, c, gate) {
  const card = root.querySelector(`[data-country="${c.key}"]`);
  if (!card) return;
  card.classList.add("is-in");

  const stats = [
    ["population", num(c.population.value)],
    ["protestants", num(c.protestants.value)],
    ["share", `${c.share.value}%`],
  ];

  for (let i = 0; i < stats.length; i++) {
    if (i) await gate();
    const cell = card.querySelector(`[data-stat="${stats[i][0]}"]`);
    cell.className = "";
    cell.textContent = stats[i][1];
    cell.closest("[data-figure-group]").classList.add("is-in");
    await charCascade(cell, { stagger: 45, duration: 760 });
  }
}

/** What the board reads, figure and unit together, for the line above. */
const said = (b) => `${num(b.value, b.cells)}${b.unit ? (b.unit === "%" ? "%" : " " + b.unit) : ""}`;

/** One beat: a figure taking the board. */
const beat = (i) => async ({ root, config }) => {
  const b = config.opening.beats[i];
  const frame = root.querySelector("[data-board]");
  const figure = root.querySelector("[data-figure]");
  const unit = root.querySelector("[data-unit]");

  root.querySelector("[data-board]").hidden = false;
  root.querySelector("[data-countries]").hidden = true;

  /* The unit and the board are sized before anything turns over, so nothing
     moves sideways once the clock is running. */
  unit.textContent = b.unit || "";
  fitBoard(figure, unit, frame, b.cells || num(b.value, b.cells).length);

  await flipTo(figure, num(b.value, b.cells), { cells: b.cells });
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

      <!-- A number and its unit. Nothing else belongs on a clock face. -->
      <div class="board" data-board>
        <div class="board-row">
          <div class="figure board-figure" data-figure></div>
          <span class="board-unit" data-unit></span>
        </div>
      </div>

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

    /* America, then Croatia, then the two of them together. */
    const stage = (keys, { maps = true } = {}) => async ({ root, config, gate }) => {
      root.querySelector("[data-board]").hidden = true;
      const box = root.querySelector("[data-countries]");
      box.hidden = false;
      box.classList.toggle("is-pair", keys.length > 1);
      box.classList.toggle("no-maps", !maps);
      for (const c of config.opening.countries) {
        root.querySelector(`[data-country="${c.key}"]`).hidden = !keys.includes(c.key);
      }
      await new Promise((r) => requestAnimationFrame(r));

      if (keys.length > 1) {
        /* THE COMPARISON. Both sets of figures are already known by this point,
           so nothing is re-performed — the two move into their new places and
           that movement is the whole beat. The discs go: side by side they were
           the picture, stacked they would only be in the way of the numbers. */
        for (const c of config.opening.countries) setStats(root, c);
        return;
      }

      for (const key of keys) {
        await tellCountry(root, config.opening.countries.find((c) => c.key === key), gate);
      }
    };
    beats.push(stage(["us"]));
    beats.push(stage(["hr"]));
    beats.push(stage(["us", "hr"], { maps: false }));
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
