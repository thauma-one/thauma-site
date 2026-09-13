/**
 * Pins are placed INSIDE the country, tested against its own geometry.
 *
 * Scattering around a state's center put dots in the Gulf of Mexico, off the
 * Pacific coast and over the Canadian border, because a jitter radius knows
 * nothing about a coastline. Every candidate is now asked of the outline
 * itself — `isPointInFill` on the real paths — and rejected if it is not on
 * land. That also quietly drops the places the map does not contain: these
 * files are the lower forty-eight, so Alaska and Hawaii simply find nowhere to
 * land rather than appearing in the ocean beside California.
 *
 * It has to run after the SVG is in the document, since the test is a question
 * put to a rendered element. Where that is impossible — jsdom has no geometry —
 * the pins are placed unconstrained, which keeps the deck testable and costs
 * only a picture nobody is looking at.
 */
function fillDensity(card, c, map) {
  const group = card.querySelector("[data-pins]");
  if (!group || group.childElementCount || !map) return;

  const inner = card.querySelector("svg svg") || card.querySelector("svg");
  const land = [...card.querySelectorAll(".disc-land path")];
  const [, , vw, vh] = map.viewBox.split(/\s+/).map(Number);
  const unit = Math.max(vw, vh);
  const spread = c.spread || 0.02;

  const probe = inner.createSVGPoint ? inner.createSVGPoint() : null;
  const canTest = probe && land.length && typeof land[0].isPointInFill === "function";
  const onLand = (x, y) => {
    if (!canTest) return true;
    probe.x = x; probe.y = y;
    return land.some((path) => { try { return path.isPointInFill(probe); } catch { return true; } });
  };

  let n = c.seed;
  const rnd = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const total = c.centers.reduce((sum, x) => sum + x[2], 0);
  const made = [];

  for (const [lat, lon, weight] of c.centers) {
    const want = Math.max(1, Math.round((weight / total) * c.dots));
    const [cx, cy] = project(map.geo, map.viewBox, lat, lon);
    const reach = unit * spread * (0.9 + Math.sqrt(weight / total) * 4.2);

    let placed = 0;
    for (let tries = 0; tries < want * 30 && placed < want; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * reach;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const size = unit * (0.0022 + rnd() * 0.003);
      if (!onLand(x, y)) continue;
      made.push([x, y, size]);
      placed++;
    }
  }

  group.innerHTML = made.map(([x, y, r], i) =>
    `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"
             style="--d:${Math.round((i / Math.max(1, made.length)) * 1700)}ms"/>`).join("");
}

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
import { charCascade, unCascade, flipTo, motion, setInstant, T } from "../motifs.js";
/* NOT ALIASED. The build inlines each module and strips its import lines,
   so an alias names something the bundle never declares — `config as x` became
   a ReferenceError at module load and took the whole deck down with it. */
import { config } from "../../config.js";

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
  /* Smaller overall than it was. Filling nine tenths of the width made the
     board the only thing in the room; at two thirds it is still the subject
     and the screen has somewhere to breathe. */
  const room = frame.clientWidth * 0.64;
  const ceiling = Math.min(230, (frame.ownerDocument.defaultView?.innerHeight || 800) * 0.3);
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
/**
 * SIT THE UNIT ON THE FIGURE'S OWN BASELINE.
 *
 * CSS cannot do this on its own here. Every flap clips its contents, and a
 * clipped inline-block reports its box bottom as its baseline, so baseline
 * alignment lines the word up with the bottom of the CARD rather than with the
 * foot of the number — which put the descender of "years" well below the
 * digits. The real baselines are computable from the font's own metrics, so
 * they are computed: where the digit's baseline falls inside its line box,
 * where the word's falls inside its own, and the difference applied.
 */
function seatUnit(figure, unit) {
  if (!figure || !unit || !unit.textContent.trim()) return;
  const cell = figure.querySelector(".flap");
  if (!cell || typeof document.createElement("canvas").getContext !== "function") return;

  const cx = document.createElement("canvas").getContext("2d");
  if (!cx) return;
  const baselineIn = (rect, weight, size, family, sample) => {
    cx.font = `${weight} ${size}px ${family}`;
    const m = cx.measureText(sample);
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    if (!asc && !desc) return null;
    return rect.top + (rect.height - (asc + desc)) / 2 + asc;
  };

  const f = getComputedStyle(figure), u = getComputedStyle(unit);
  unit.style.transform = "";
  const onDigits = baselineIn(cell.getBoundingClientRect(),
    f.fontWeight, parseFloat(f.fontSize), f.fontFamily, "0");
  const onWord = baselineIn(unit.getBoundingClientRect(),
    u.fontWeight, parseFloat(u.fontSize), u.fontFamily, "x");
  if (onDigits == null || onWord == null) return;

  unit.style.transform = `translateY(${Math.round(onDigits - onWord)}px)`;
}

const num = (n, cells) =>
  cells ? String(n) : n.toLocaleString("en-US", { maximumFractionDigits: 2 });


/* THE COUNTRY, DRAWN WHERE IT IS.

   The map files carry a geoViewBox — the longitude and latitude of the
   drawing's own four edges — which makes the coordinate space linear in both.
   A real place therefore has a real position on the page, and the density
   field stops being scatter that says "a country" and starts being the
   country: the eastern seaboard crowded, the mountain west nearly empty,
   Zagreb heavy and the Croatian interior almost bare.
   
   Pins are dealt out in proportion to population and jittered around their
   city, by a fixed pseudo-random walk rather than at random — the same slide
   has to look the same in two different meetings. */
function project(geo, box, lat, lon) {
  const [vx, vy, vw, vh] = box.split(/\s+/).map(Number);
  return [
    vx + ((lon - geo.west) / (geo.east - geo.west)) * vw,
    vy + ((geo.north - lat) / (geo.north - geo.south)) * vh,
  ];
}

function densityField(map, centers, count, seed, spread = 0.02) {
  if (!map) return "";
  const [, , vw, vh] = map.viewBox.split(/\s+/).map(Number);
  const unit = Math.max(vw, vh);
  let n = seed;
  const rnd = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const total = centers.reduce((sum, c) => sum + c[2], 0);
  const out = [];
  let i = 0;
  for (const [lat, lon, weight] of centers) {
    /* At least one pin for every city, so a small place is still on the map. */
    const share = Math.max(1, Math.round((weight / total) * count));
    const [cx, cy] = project(map.geo, map.viewBox, lat, lon);
    for (let k = 0; k < share; k++) {
      /* A heavier place spreads further, but every place spreads — a state's
         worth of people is a region, not a point. */
      const reach = unit * spread * (0.9 + Math.sqrt(weight / total) * 4.2);
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * reach;
      out.push(`<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}"
                        cy="${(cy + Math.sin(a) * r).toFixed(1)}"
                        r="${(unit * (0.0022 + rnd() * 0.003)).toFixed(2)}"
                        style="--d:${Math.round((i / count) * 1700)}ms"/>`);
      i++;
    }
  }
  return out.join("");
}

/** One country: its outline and density inside the disc, figures beneath. */
function countryCard(c) {
  const map = typeof MAPS !== "undefined" ? MAPS[c.map || c.key] : null;
  /* NO FRAME. The circle was a placeholder from the sketch, drawn before there
     was a country to put in it; with the real outline there it only cropped the
     shape and made it small. The map is the picture now. */
  const inner = map
    ? `<g class="disc-land">${map.paths.map((d) => `<path d="${d}"/>`).join("")}</g>
       <g class="disc-pins" data-pins></g>`
    : `<g class="disc-pins" data-pins></g>`;

  return `
    <figure class="country" data-country="${c.key}">
      <svg class="country-disc" viewBox="${map ? map.viewBox : "0 0 100 100"}"
           preserveAspectRatio="xMidYMid meet" aria-label="${c.name}">
        ${inner}
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
 * one screen was both too much machinery for a comparison and too wide to fit.
 * These are cascaded in, which is the deck's other way of making type arrive
 * and costs no width at all.
 */
async function tellCountry(root, c, gate) {
  const card = root.querySelector(`[data-country="${c.key}"]`);
  if (!card) return;

  fillDensity(card, c, typeof MAPS !== "undefined" ? MAPS[c.map || c.key] : null);

  /* From nothing, every time it is arrived at — including on the way back. */
  const pins = card.querySelector("[data-pins]");
  pins.classList.remove("is-in");
  card.classList.remove("is-in");
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  card.classList.add("is-in");
  await motion.wait(T.normal);
  pins.classList.add("is-in");
  await motion.wait(1900);

  const stats = [
    ["population", num(c.population.value)],
    ["protestants", num(c.protestants.value)],
    ["share", `${c.share.value}%`],
  ];

  /* Then one figure per press. */
  for (const [name, text] of stats) {
    await gate();
    const cell = card.querySelector(`[data-stat="${name}"]`);
    cell.className = "";
    cell.textContent = text;
    cell.closest("[data-figure-group]").classList.add("is-in");
    await charCascade(cell, { stagger: 45, duration: 760 });
  }
}

/**
 * MOVE, DO NOT REDRAW. Croatia's figures are already on screen and already
 * read; the comparison should carry them to their new place rather than throw
 * them away and write them again somewhere else. Measured before and after the
 * layout changes, put back where they were, and released.
 */
function slideIntoPlace(nodes, rearrange, ms = 760) {
  const before = nodes.map((n) => n.getBoundingClientRect());
  rearrange();
  nodes.forEach((n, i) => {
    const after = n.getBoundingClientRect();
    const dx = before[i].left - after.left;
    const dy = before[i].top - after.top;
    if (!dx && !dy) return;
    n.style.transition = "none";
    n.style.transform = `translate(${dx}px, ${dy}px)`;
    void n.offsetWidth;
    n.style.transition = `transform ${ms}ms cubic-bezier(.42, 0, .28, 1)`;
    n.style.transform = "";
  });
}

/**
 * THE STAGES CHANGE, they do not cut. Going from the clock to the countries
 * swapped one for the other in a single frame, which is the only hard cut left
 * in the section. The one leaving withdraws upward and the one arriving comes
 * up from below, the same grammar the deck uses between sections.
 */
async function swapStage(root, wanted) {
  const board = root.querySelector("[data-board]");
  const countries = root.querySelector("[data-countries]");
  const leaving = wanted === "board" ? countries : board;
  const entering = wanted === "board" ? board : countries;

  if (!leaving.hidden) {
    leaving.classList.add("is-out");
    await motion.wait(360);
    leaving.hidden = true;
    leaving.classList.remove("is-out");
  }
  if (entering.hidden) {
    entering.classList.add("is-pre");
    entering.hidden = false;
    /* Two frames, or the un-hiding and the arrival collapse into one paint. */
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    entering.classList.remove("is-pre");
    await motion.wait(320);
  }
}

/** The heading at full size, centered on the screen, set without animating. */
function enlargeCue(root, cue) {
  cue.style.transition = "none";
  cue.classList.add("is-big");
  const here = cue.getBoundingClientRect();
  const screen = root.getBoundingClientRect();
  const dy = (screen.top + screen.height / 2) - (here.top + here.height / 2);
  cue.style.transform = `translateY(${Math.round(dy)}px)`;
  void cue.offsetWidth;
  cue.style.transition = "";
}

/** The phrase above the clock, in the two halves it arrives in. */
function phraseTo(root, i) {
  const want = { a: i >= 0, b: i >= 1 };
  let changed = false;
  for (const key of ["a", "b"]) {
    const el = root.querySelector(`[data-phrase="${key}"]`);
    if (!el) continue;
    if (el.classList.contains("is-in") !== want[key]) changed = true;
    el.classList.toggle("is-in", want[key]);
  }
  return changed;
}

/** One beat: a figure taking the board. */
const beat = (i) => async ({ root, config }) => {
  const b = config.opening.beats[i];
  const frame = root.querySelector("[data-board]");
  const figure = root.querySelector("[data-figure]");
  const unit = root.querySelector("[data-unit]");

  await swapStage(root, "board");

  /* MEASURED, NOT SHOWN. The row needs its real height before a word appears
     above it, or the phrase settles and then shifts when the first cell is
     built. So on the first figure the board IS built — and hidden while it is.
     Nothing about the flip changes: the cells are blank, so the first turn
     still takes its full revolution from nothing. The unit waits here too; it
     belongs to the first flip, not to the moment before it. */
  const cells = b.cells || num(b.value, b.cells).length;
  unit.textContent = b.unit || "";
  fitBoard(figure, unit, frame, cells);

  const firstFigure = !figure.dataset.width;
  if (firstFigure) {
    figure.style.visibility = "hidden";
    unit.style.visibility = "hidden";
    await flipTo(figure, "", { cells });
    seatUnit(figure, unit);
  }

  /* "The Church" is read before the first figure turns under it. Everything
     after that arrives WITH its figure — the phrase completing itself and the
     board changing are one moment, not two. */
  const arriving = phraseTo(root, i);
  if (arriving && i === 0) await motion.wait(820);

  /* And now the board, and "years" with it, on the turn. */
  figure.style.visibility = "";
  unit.style.visibility = "";

  /* The cells are built synchronously at the head of flipTo, so the unit can
     be seated against them while the board is still turning — it used to be
     placed afterwards, which meant it sat visibly low for the whole run and
     then jumped. */
  const turning = flipTo(figure, num(b.value, b.cells), { cells });
  seatUnit(figure, unit);
  await turning;
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
        <p class="board-phrase">
          <span data-phrase="a">${o.phrase.a}</span>
          <span data-phrase="b">${o.phrase.b}</span>
        </p>
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

      /* RETURNABLE. Stepping back to the opening used to leave the last figure
         standing on the board behind a title that had already been read — the
         beat only ever ran forward from nothing, so it never cleared anything.
         It resets the board to empty, which is also what makes the first
         figure take its full revolution again on the way back in. */
      await swapStage(root, "board");
      phraseTo(root, -1);
      const figure = root.querySelector("[data-figure]");
      figure.innerHTML = "";
      figure.dataset.width = "";
      root.querySelector("[data-unit]").textContent = "";

      /* Put it at full size and in the middle of the SCREEN before anything is
         watched. Measured rather than guessed: the slide's own flow would
         center it against whatever else happens to be in the slide, which at
         this moment is an empty board and nothing else. */
      enlargeCue(root, cue);

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

    /* One beat per figure the config actually holds. This was hard-coded to
       four and the closing statement was later taken out of the sequence,
       which left a beat pointing at nothing — it threw, the step runner
       swallowed it, and the section simply lost a press. */
    for (let i = 1; i < config.opening.beats.length; i++) beats.push(beat(i));

    /* America, then Croatia, then the two of them together. */
    const stage = (keys, { maps = true } = {}) => async ({ root, config, gate }) => {
      const box = root.querySelector("[data-countries]");
      if (keys.length === 1) {
        box.classList.remove("is-pair", "no-maps");

        /* ONE COUNTRY GIVES WAY TO THE NEXT. Croatia used to cut in, because
           the stage itself was already on screen — only the card inside it was
           being swapped, and nothing was animating that. The one leaving goes
           first, then the one arriving is built from nothing. */
        const leaving = [...root.querySelectorAll("[data-country]")]
          .filter((c) => !c.hidden && !keys.includes(c.dataset.country));
        if (leaving.length && !box.hidden) {
          for (const c of leaving) c.classList.remove("is-in");
          await motion.wait(420);
        }
        for (const c of config.opening.countries) {
          root.querySelector(`[data-country="${c.key}"]`).hidden = !keys.includes(c.key);
        }
      }
      await swapStage(root, "countries");

      if (keys.length > 1) {
        /* THE COMPARISON. Croatia is already up and already read, so it travels
           to its new place rather than being redrawn there. America arrives
           while that is happening — the two movements are one beat. */
        const staying = root.querySelector('[data-country="hr"]');
        const arriving = root.querySelector('[data-country="us"]');
        arriving.classList.remove("is-in");

        /* THE THINGS THAT STAY ON SCREEN ARE WHAT HAS TO TRAVEL — the name and
           the figures, not the card around them. Moving the card looked wrong
           for a real reason: the disc vanishes in the same instant, so the
           figures leap up inside the card before the card has gone anywhere.
           Croatia appeared to jump to the top and then come down. Carrying the
           parts a person is actually looking at takes them straight from where
           they were to where they land. */
        slideIntoPlace(
          [staying.querySelector(".country-name"), staying.querySelector(".country-stats")],
          () => {
            box.classList.add("is-pair", "no-maps");
            arriving.hidden = false;
          });

        setStats(root, config.opening.countries.find((c) => c.key === "us"));
        arriving.classList.remove("is-in");
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        arriving.classList.add("is-in");
        await motion.wait(760);
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

  /**
   * EVERY BEAT, BACKWARDS.
   *
   * Going back should undo what was just done rather than land the previous
   * state by rebuilding — a density field that filled in empties out, a figure
   * that cascaded in cascades out, a card that dropped in drops back out, and
   * the clock turns to the number before it exactly as it turned to this one.
   * What the undoing looks like depends entirely on what the beat did, which
   * is why only the section can say.
   */
  async back({ root, config, state, step }) {
    const beats = config.opening.beats;
    const firstCountry = beats.length + 1;      // title, then one beat per figure
    const figure = root.querySelector("[data-figure]");
    const unit = root.querySelector("[data-unit]");
    const box = root.querySelector("[data-countries]");
    const card = (k) => root.querySelector(`[data-country="${k}"]`);

    /* Out of a country: its figures leave, then the field empties, then the
       country itself goes — the arrival in reverse order. */
    const dismiss = async (key) => {
      const c = card(key);
      for (const cell of [...c.querySelectorAll("[data-stat]")].reverse()) {
        await unCascade(cell, { stagger: 26, duration: 420 });
        cell.closest("[data-figure-group]").classList.remove("is-in");
      }
      c.querySelector("[data-pins]").classList.remove("is-in");
      await motion.wait(700);
      c.classList.remove("is-in");
      await motion.wait(520);
      c.hidden = true;
    };

    /* The comparison, undone: America leaves and Croatia walks back to where
       it stood on its own. */
    if (step === firstCountry + 2) {
      const us = card("us"), hr = card("hr");
      us.classList.remove("is-in");
      await motion.wait(520);
      slideIntoPlace(
        [hr.querySelector(".country-name"), hr.querySelector(".country-stats")],
        () => { us.hidden = true; box.classList.remove("is-pair", "no-maps"); });
      await motion.wait(780);
      hr.querySelector("[data-pins]").classList.add("is-in");
      return;
    }

    /* Croatia leaves and America is standing where it was left. */
    if (step === firstCountry + 1) {
      await dismiss("hr");
      const us = card("us");
      us.hidden = false;
      setStats(root, config.opening.countries.find((c) => c.key === "us"));
      us.querySelector("[data-pins]").classList.add("is-in");
      await motion.wait(520);
      return;
    }

    /* America leaves and the clock comes back, reading its last figure. */
    if (step === firstCountry) {
      await dismiss("us");
      await swapStage(root, "board");
      const last = beats[beats.length - 1];
      unit.textContent = last.unit || "";
      fitBoard(figure, unit, root.querySelector("[data-board]"),
        last.cells || num(last.value, last.cells).length);
      const turning = flipTo(figure, num(last.value, last.cells), { cells: last.cells });
      seatUnit(figure, unit);
      await turning;
      return;
    }

    /* Inside the clock: turn to the figure before this one. */
    if (step > 1) {
      const b = beats[step - 2];
      if (phraseTo(root, step - 2)) await motion.wait(620);
      unit.textContent = b.unit || "";
      const turning = flipTo(figure, num(b.value, b.cells), { cells: b.cells });
      seatUnit(figure, unit);
      await turning;
      return;
    }

    /* And back to the name, alone and full size. */
    const cue = root.querySelector("[data-cue]");
    phraseTo(root, -1);
    await motion.wait(620);
    figure.innerHTML = "";
    figure.dataset.width = "";
    unit.textContent = "";
    await motion.wait(240);
    enlargeCue(root, cue);
    cue.classList.remove("cc");
    cue.textContent = config.opening.cue;
  },

  /* Re-running the beat with motion off lands exactly the state it produces,
     without performing it — and without a second description of the section
     living somewhere else to drift out of step with the real one. */
  async rewind({ root, config, state, step }) {
    setInstant(true);
    try { await opening.steps[step]({ root, config, state, gate: () => Promise.resolve() }); }
    finally { setInstant(false); }
  },
};
