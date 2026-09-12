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
import { el, countTo, cascade, charCascade, showOnly, scaleCollapse,
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

export const opening = {
  key: "opening",
  title: "Opening",

  render({ config }) {
    const o = config.opening;
    const total = o.religion.reduce((n, r) => n + r.share, 0);
    let angle = -90;
    const slices = o.religion.map((r) => {
      const sweep = (r.share / total) * 360;
      const s = { ...r, from: angle, to: angle + sweep };
      angle += sweep;
      return s;
    });

    return el(`
      <div class="slide">
        <p class="cue" data-cue>The work nobody names</p>

        <div class="stack" data-part="vocation" hidden>
          ${o.vocation.map((v) => `<p class="lead in" data-v>${v.text}</p>`).join("")}
          <div class="quiet in" data-v>
            ${o.invisibility.map((line) => `<p>${line}</p>`).join("")}
          </div>
        </div>

        <div data-part="usa" hidden>
          <div class="figure-row">
            <div><div class="figure" data-count="churches">0</div>
                 <div class="figure-label">${o.usa.churches.label}</div></div>
            <div><div class="figure" data-count="typical">0</div>
                 <div class="figure-label">${o.usa.typical.label}</div></div>
          </div>
          <p class="in" data-u>${o.usa.tension.oneInThree}</p>
          <p class="in" data-u>${o.usa.tension.topTenth}</p>
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
          <p class="lead in" data-c>${o.croatia.attribution}</p>
          <div class="figure-row">
            <div><div class="figure" data-count="protestants">0</div>
                 <div class="figure-label">${o.croatia.protestants.label}</div></div>
            <div><div class="figure" data-count="average">0</div>
                 <div class="figure-label">${o.croatia.averageCongregation.label}</div></div>
            <div><div class="figure" data-count="largest">0</div>
                 <div class="figure-label">${o.croatia.largestKnown.label}</div></div>
          </div>
        </div>

        <div data-part="pie" hidden>
          <svg viewBox="-110 -110 220 220" class="pie" aria-label="Croatia's religious makeup">
            ${slices.map((s) => `
              <path class="slice${s.emphasis ? " is-tiny" : ""}" data-slice="${s.name}"
                    d="${arc(s.from, s.to)}"/>`).join("")}
          </svg>
          <p class="figure-label in" data-c>
            Protestant: ${o.croatia.share.value} per cent of the country.
          </p>
        </div>
      </div>
    `);
  },

  steps: [
    /* THE ARRIVAL. Heading rolls in on the site's character cascade, the claim
       lands under it, and the two quiet lines follow — about three seconds,
       unattended, the way the timeline opens. An entrance is not something a
       presenter should have to press through. */
    async ({ root }) => {
      const part = await showOnly(root, "vocation");
      await Promise.all([
        charCascade(root.querySelector("[data-cue]"), { stagger: 55, duration: 1300 }),
        (async () => {
          await motion.wait(500);
          for (const line of part.querySelectorAll(".lead")) {
            line.classList.add("is-in");
            await motion.wait(520);
          }
          await motion.wait(260);
          part.querySelector(".quiet").classList.add("is-in");
        })(),
      ]);
    },

    /* Familiar ground. The counts are eased rather than linear so they feel
       like they are building toward something, not being read out. */
    async ({ root, config }) => {
      const part = await showOnly(root, "usa");
      const o = config.opening.usa;
      await Promise.all([
        countTo(part.querySelector('[data-count="churches"]'), o.churches.value, { duration: T.slow }),
        countTo(part.querySelector('[data-count="typical"]'), o.typical.value, { duration: T.slow }),
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
       the map it refers to stays on screen under them. */
    async ({ root, config }) => {
      const part = await showOnly(root, "croatia", { keep: ["maps"] });
      /* The map is context for these numbers now, so it gives them the room. */
      root.querySelector('[data-part="maps"]')?.classList.add("is-behind");
      const c = config.opening.croatia;
      await cascade([part.querySelector("[data-c]")], { gap: 0 });
      await Promise.all([
        countTo(part.querySelector('[data-count="protestants"]'), c.protestants.value),
        countTo(part.querySelector('[data-count="average"]'), c.averageCongregation.value),
        countTo(part.querySelector('[data-count="largest"]'), c.largestKnown.value),
      ]);
    },

    /* The slice pops outward. The motion itself communicates smallness —
       something you would miss if it were not pointed at. */
    async ({ root }) => {
      const part = await showOnly(root, "pie");
      await motion.wait(T.quick);
      part.querySelector(".pie").classList.add("is-drawn");
      await motion.wait(T.slow);
      part.querySelector(".slice.is-tiny")?.classList.add("is-out");
      await cascade([...part.querySelectorAll("[data-c]")], { gap: 200 });
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

/** One pie slice as a path. Radius fixed; the viewBox is centered on zero. */
function arc(from, to) {
  const r = 96;
  const p = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${(Math.cos(rad) * r).toFixed(2)} ${(Math.sin(rad) * r).toFixed(2)}`;
  };
  const large = to - from > 180 ? 1 : 0;
  return `M 0 0 L ${p(from)} A ${r} ${r} 0 ${large} 1 ${p(to)} Z`;
}
