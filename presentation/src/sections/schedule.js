/**
 * Section 5 — The timeline (3 min)
 *
 * Concrete, dated, confident. Unlike Section 4's deliberately unresolved
 * spiritual timeline, this one is fully resolved: real logistics being planned,
 * not fruit being awaited. The contrast is the point of putting them near each
 * other.
 *
 * DISCRETE BEATS, NOT A SCROLL. Five milestones across about eight months —
 * a continuous scroll would spend most of its motion passing through visually
 * empty time. Each milestone is its own beat: zoom in tight (this is where the
 * founder talks), pull out to show it as one point on the line, pan, zoom in
 * again. Each click moves one beat, so he decides how long to linger.
 *
 * The visual language is the partner roadmap's — same dots, same rules, same
 * type treatment. It cannot literally reuse that component, which is rendered
 * by the Worker and talks to the API, and this file has to run from a memory
 * stick with no network.
 */
import { el, focusPoint, cascade, motion, T } from "../motifs.js";

/* Same formatting rule as the site's `when` filter — a date on a slide should
   read the way a date reads, not the way a database stores one. */
function when(iso, until) {
  const parse = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return null;
    const d = new Date(v + "T00:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const a = parse(iso), b = parse(until);
  if (!a) return iso || "";
  const f = (d, o) => new Intl.DateTimeFormat("en-GB", o).format(d);
  if (!b) return f(a, { day: "numeric", month: "long", year: "numeric" });
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${f(a, { day: "numeric" })}–${f(b, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  return `${f(a, { day: "numeric", month: "short" })} – ${f(b, { day: "numeric", month: "short", year: "numeric" })}`;
}

export const schedule = {
  key: "schedule",
  title: "The timeline",

  render({ config }) {
    const ms = config.timeline.milestones;
    return el(`
      <div class="slide">
        <p class="cue in" data-open>What happens next</p>
        <div class="track-window">
          <div class="track">
            ${ms.map((m, i) => `
              <div data-point data-i="${i}">
                <div class="point-dot"></div>
                <div class="point-date">${when(m.date, m.until)}</div>
                <div class="point-label">${m.label}</div>
              </div>`).join("")}
          </div>
        </div>
      </div>
    `);
  },

  /* One step per milestone — so a click moves to the next one, and the
     presenter controls how long each is held. */
  steps: (() => {
    const beats = [];
    beats.push(async ({ root }) => {
      await cascade([...root.querySelectorAll("[data-open]")], { gap: 0 });
      await motion.wait(T.quick);
      await focusPoint(root.querySelector(".track"), 0);
    });
    for (let i = 1; i < 5; i++) {
      beats.push(async ({ root }) => {
        await focusPoint(root.querySelector(".track"), i);
      });
    }
    return beats;
  })(),
};
