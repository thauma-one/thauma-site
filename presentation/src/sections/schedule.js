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

/* MONTHS, NOT DAYS. None of these dates are actually nailed down — the first
   one is still marked unverified in the config — and a slide that says
   "28 February 2027" claims a precision the plan does not have. A month reads
   as a plan; a date reads as a promise, and this is a room where the founder
   should not be making promises he has not made yet.

   The ISO dates stay in the config, because they are real data the milestone
   records hold and the site formats properly. Only the deck rounds them off. */
function when(iso, until) {
  const parse = (v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return null;
    const d = new Date(v + "T00:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const a = parse(iso), b = parse(until);
  if (!a) return iso || "";
  const f = (d, o) => new Intl.DateTimeFormat("en-GB", o).format(d);
  const full = { month: "long", year: "numeric" };

  if (!b) return f(a, full);
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) return f(a, full);
    /* "March – September 2027" — the year said once, at the end. */
    return `${f(a, { month: "long" })} – ${f(b, full)}`;
  }
  return `${f(a, full)} – ${f(b, full)}`;
}

/* WHERE TODAY SITS ON THE LINE.

   Anchored to the points as they are actually laid out, not to arithmetic on
   the dates — the track spaces milestones evenly rather than by elapsed time,
   so a marker placed at the true percentage of the period would drift away
   from the milestones it is meant to sit between. Same reasoning the partner
   widget records for its own NOW marker. */
function placeNow(root, milestones) {
  const marker = root.querySelector("[data-now]");
  const points = [...root.querySelectorAll("[data-point]")];
  if (!marker || !points.length) return;

  const times = milestones.map((m) => new Date(m.date + "T00:00:00").getTime());
  const mid = (p) => p.offsetLeft + p.offsetWidth / 2;
  const now = Date.now();
  let x;

  if (now <= times[0]) {
    /* Before anything has happened, which is where today is. Half a gap ahead
       of the first milestone, so the line reads as running toward it. */
    const gap = points.length > 1 ? mid(points[1]) - mid(points[0]) : 220;
    x = mid(points[0]) - gap * 0.55;
  } else if (now >= times[times.length - 1]) {
    x = mid(points[points.length - 1]);
  } else {
    let i = 0;
    while (i < times.length - 1 && now > times[i + 1]) i++;
    const span = times[i + 1] - times[i] || 1;
    x = mid(points[i]) + (mid(points[i + 1]) - mid(points[i])) * ((now - times[i]) / span);
  }

  marker.style.left = `${Math.round(x)}px`;
  marker.hidden = false;
  /* Next frame, or the browser folds the unhide and the fade into one paint. */
  requestAnimationFrame(() => marker.classList.add("is-in"));
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
            <!-- The line. It is called a timeline and there was not one: five
                 dots floating unconnected read as five separate cards rather
                 than one journey, which is the whole argument of the section. -->
            <div class="track-rule"></div>
            <!-- Where today actually is, in the partner roadmap's language. -->
            <div class="track-now" data-now hidden>
              <span class="now-line"></span>
              <span class="now-label">NOW</span>
            </div>
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
    /* THE SECTION BUILDS ITSELF. It used to open with the whole timeline
       already standing there, spending the moment with the most attention on
       it doing nothing. The line draws outward, the milestones arrive along it
       in the order they happen, today's marker rises — and only then does the
       camera move to the first one. Seeing the whole eight months before being
       walked through them is the argument the section is making.

       This is one beat, not several: it is an entrance, and a presenter should
       not have to press four times to finish arriving. */
    beats.push(async ({ root, config }) => {
      await cascade([...root.querySelectorAll("[data-open]")], { gap: 0 });

      /* LEAD-IN ROOM. The track is laid out from x=0, so building it where it
         sits puts the first milestone hard against the left edge and pushes
         today's marker — which belongs BEFORE the first milestone — clean off
         the screen. Park the line so the first date sits at about two fifths
         across, leaving the run-up visible. Set without a transition, because
         this is where the section begins rather than somewhere it travels. */
      const track = root.querySelector(".track");
      const first = root.querySelector("[data-point]");
      if (track && first) {
        const win = track.parentElement.clientWidth;
        const lead = win * 0.42 - (first.offsetLeft + first.offsetWidth / 2);
        track.style.transition = "none";
        track.style.transform = `translateX(${Math.round(lead)}px)`;
        void track.offsetWidth;            // commit it before motion resumes
        track.style.transition = "";
      }

      root.querySelector(".track-rule").classList.add("is-drawn");
      await motion.wait(T.normal);

      for (const point of root.querySelectorAll("[data-point]")) {
        point.classList.add("is-built");
        await motion.wait(T.quick * 0.45);
      }

      placeNow(root, config.timeline.milestones);
      await motion.wait(T.normal);

      await focusPoint(track, 0);
    });
    for (let i = 1; i < 5; i++) {
      beats.push(async ({ root }) => {
        await focusPoint(root.querySelector(".track"), i);
      });
    }
    return beats;
  })(),
};
