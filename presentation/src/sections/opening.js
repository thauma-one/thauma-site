/**
 * Section 1 — Opening hook (3–4 min)
 *
 * Ground the room in a need they have never considered, then collapse the
 * scale from familiar to specific — before the founder appears as a subject at
 * all. The spec is firm that this section is about the field, not about him:
 * no photographs of him, and no borrowed quotes where his own knowledge
 * carries the point.
 *
 * The Croatia figures are presented as PERSONAL KNOWLEDGE rather than
 * statistics, which does double duty — it is honest about where they come
 * from, and it quietly establishes that real relationships already exist on
 * the ground.
 */
import { el, cascade, charCascade, swapFigure, showOnly, scaleCollapse,
         setInstant, motion, T } from "../motifs.js";

/* Deliberately not cartographic. A recognizable silhouette carries "United
   States" and "Croatia" at a glance; accurate topology would cost hundreds of
   kilobytes in a file that has to work from a memory stick, and would draw the
   eye to coastline detail rather than to the density of dots. */
const US = "M60 120 L150 96 L232 88 L318 84 L402 90 L470 104 L512 128 L500 168 " +
  "L452 196 L392 208 L318 214 L242 208 L166 190 L104 164 Z";
const HR = "M180 150 L232 128 L286 120 L330 134 L352 160 L338 186 L306 196 " +
  "L300 232 L282 268 L262 246 L268 208 L240 196 L206 186 Z";

function pins(count, seed, spread) {
  /* Placed by a fixed pseudo-random walk rather than at random: the dots have
     to land in the same place every time the deck is shown, or the same slide
     looks different in two meetings. */
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: count }, () => {
    const r = { x: spread.x + rnd() * spread.w, y: spread.y + rnd() * spread.h,
                size: 0.8 + rnd() * 2.2 };
    return `<circle cx="${r.x.toFixed(1)}" cy="${r.y.toFixed(1)}" r="${r.size.toFixed(1)}"
                    class="pin" style="--d:${(rnd() * 900).toFixed(0)}ms"/>`;
  }).join("");
}

/* Which dots are lit, chosen once rather than at random — the same slide has
   to look the same in two different meetings. Spread apart so they do not read
   as one smudge. */
const LIT = new Set([383, 712]);

/* The second and third figures are the same beat with a different index. */
const ageBeat = (i) => async ({ root, config }) => {
  const part = await showOnly(root, "age");
  const a = config.opening.age[i];
  await swapFigure(part.querySelector("[data-age-value]"), a.value.toLocaleString("en-US"));
  part.querySelector("[data-age-label]").textContent = a.label;
};

export const opening = {
  key: "opening",
  title: "Opening",

  render({ config }) {
    const o = config.opening;
    return el(`
      <div class="slide">
        <p class="cue" data-cue>The work nobody names</p>

        <!-- ONE BOARD, three numbers. The proportion between two thousand and
             twenty-five is the entire argument, and a proportion is something a
             room should see rather than hear read out. -->
        <div data-part="age" hidden>
          <div class="figure" data-age-value></div>
          <div class="figure-label" data-age-label></div>
          <p class="lead in" data-heart>${o.heart.text}</p>
        </div>

        <div data-part="usa" hidden>
          <div class="figure-row">
            <div><div class="figure" data-count="churches"></div>
                 <div class="figure-label">${o.usa.churches.label}</div></div>
            <div><div class="figure" data-count="typical"></div>
                 <div class="figure-label">${o.usa.typical.label}</div></div>
          </div>
          <p class="lead in" data-u>${o.usa.tension.point}</p>
        </div>

        <div class="zoom-stage" data-part="maps" hidden>
          <div class="zoom-frame" data-frame="us">
            <svg viewBox="0 0 560 300" class="map" aria-label="Churches across the United States">
              <path d="${US}" class="land"/>
              <g class="pins">${pins(160, 7, { x: 80, y: 96, w: 400, h: 108 })}</g>
            </svg>
          </div>
          <div class="zoom-frame" data-frame="hr" hidden>
            <svg viewBox="0 0 560 300" class="map" aria-label="Churches across Croatia">
              <path d="${HR}" class="land"/>
              <g class="pins">${pins(14, 31, { x: 210, y: 140, w: 130, h: 100 })}</g>
            </svg>
          </div>
        </div>

        <div data-part="croatia" hidden>
          <div class="figure-row">
            <div><div class="figure" data-count="protestants"></div>
                 <div class="figure-label">${o.croatia.protestants.label}</div></div>
            <div><div class="figure" data-count="average"></div>
                 <div class="figure-label">${o.croatia.averageCongregation.label}</div></div>
            <div><div class="figure" data-count="largest"></div>
                 <div class="figure-label">${o.croatia.largestKnown.label}</div></div>
          </div>
          <p class="lead in" data-c>${o.croatia.anchor}</p>
        </div>

        <!-- A pie cannot draw 0.18%. A thousand dots can. -->
        <div data-part="field" hidden>
          <div class="field" data-field>
            ${Array.from({ length: o.field.of }, (_, i) =>
              `<i${LIT.has(i) ? ' class="on"' : ""}></i>`).join("")}
          </div>
          <p class="figure-label in" data-f>${o.field.label}</p>
        </div>
      </div>
    `);
  },

  steps: [
    /* THE ARRIVAL, and the first of the three figures. */
    async ({ root, config }) => {
      const part = await showOnly(root, "age");
      part.querySelector("[data-heart]").classList.remove("is-in");
      const a = config.opening.age[0];
      await Promise.all([
        charCascade(root.querySelector("[data-cue]"), { stagger: 55, duration: 1300 }),
        (async () => {
          await motion.wait(420);
          await swapFigure(part.querySelector("[data-age-value]"), a.value.toLocaleString("en-US"));
          part.querySelector("[data-age-label]").textContent = a.label;
        })(),
      ]);
    },

    /* Twenty-five, against two thousand. */
    ageBeat(1),
    /* And ten, against twenty-five. */
    ageBeat(2),

    /* The one moment in the section that is about him rather than the field. */
    async ({ root }) => {
      await showOnly(root, "age");
      root.querySelector("[data-heart]").classList.add("is-in");
    },

    /* Familiar ground. The figures roll in rather than counting up — a count
       draws attention to the counting instead of to what it lands on. */
    async ({ root, config }) => {
      const part = await showOnly(root, "usa");
      const o = config.opening.usa;
      await Promise.all([
        swapFigure(part.querySelector('[data-count="churches"]'), o.churches.value.toLocaleString("en-US")),
        swapFigure(part.querySelector('[data-count="typical"]'), String(o.typical.value)),
      ]);
      await cascade([...part.querySelectorAll("[data-u]")], { gap: 260 });
    },

    /* The collapse. A match cut, not a camera flight — see motifs.js. */
    async ({ root }) => {
      const maps = await showOnly(root, "maps");
      maps.classList.remove("is-behind");
      await motion.wait(T.beat);
      await scaleCollapse(root.querySelector('[data-frame="us"]'),
                          root.querySelector('[data-frame="hr"]'));
    },

    /* The personal numbers land while the mismatch is still visually fresh, so
       the map they refer to stays on screen under them. */
    async ({ root, config }) => {
      const part = await showOnly(root, "croatia", { keep: ["maps"] });
      root.querySelector('[data-part="maps"]')?.classList.add("is-behind");
      const c = config.opening.croatia;
      await Promise.all([
        swapFigure(part.querySelector('[data-count="protestants"]'), c.protestants.value.toLocaleString("en-US")),
        swapFigure(part.querySelector('[data-count="average"]'), String(c.averageCongregation.value)),
        swapFigure(part.querySelector('[data-count="largest"]'), String(c.largestKnown.value)),
      ]);
      await cascade([...part.querySelectorAll("[data-c]")], { gap: 0 });
    },

    /* A thousand dots, and two of them. Nothing else on the screen. */
    async ({ root }) => {
      const part = await showOnly(root, "field");
      await motion.wait(T.quick);
      part.querySelector("[data-field]").classList.add("is-lit");
      await motion.wait(T.slow);
      await cascade([...part.querySelectorAll("[data-f]")], { gap: 0 });
    },
  ],

  /* Going back re-runs the beat with motion switched off, which lands exactly
     the state that beat produces without performing it again. Re-running the
     real step rather than describing its finished state somewhere else means
     the two can never drift — the description would be a second copy of the
     section, and it is the copy that rots. */
  async rewind({ root, config, state, step }) {
    setInstant(true);
    try { await opening.steps[step]({ root, config, state, gate: () => Promise.resolve() }); }
    finally { setInstant(false); }
  },
};
