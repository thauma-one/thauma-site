/**
 * motifs.js — the three recurring ideas, built once
 *
 * The spec's most important note: if these are implemented as one-off effects
 * per section, the deck feels busy and incoherent — the opposite of the
 * direction. So each is ONE component with parameters, and every section
 * composes from them.
 *
 * The test the spec sets: a viewer watching the whole deck should think "that
 * is the same idea returning", not "that is a different effect that happens to
 * look similar". Shared timing is what makes that true, so every motif draws
 * its easing and durations from ONE table below rather than choosing its own.
 */

/* ---------------------------------------------------------------- the language

   One easing vocabulary for the whole deck. Motifs 2 and 3 must feel RELATED
   without being identical, which the spec is explicit about — so they share
   these curves and differ in framing and duration, not in character. */
export const T = {
  /* Everything settling into place. Slow out, no overshoot — restraint. */
  settle: "cubic-bezier(.16,1,.3,1)",
  /* Ordinary time passing. Starts fast, because it is not the point. */
  rush: "cubic-bezier(.4,0,.2,1)",
  /* A hand moving. Deliberately not linear — nobody writes at constant speed. */
  hand: "cubic-bezier(.35,.1,.25,1)",

  quick: 380,
  normal: 620,
  slow: 980,
  /* The pause before a correction, or before a fulfillment lands. It is doing
     real work: the audience has to finish reading the ordinary version before
     it is changed. */
  beat: 700,
};

const reduced = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

/* ============================================================== MOTIF 1
   THE HANDWRITTEN CORRECTION

   Printed text is the default, the expected, the ordinary. Handwriting is the
   human addition that actually matters. This is the deck's signature idea and
   it appears three times — the BE/FEEL correction, the two fulfillment lines —
   with the same stroke weight, the same curve, the same feel.

   HOW THE WRITING IS DRAWN. The glyphs are rendered from a handwriting face
   into an SVG <text>, and the stroke is revealed with a dash offset so it
   appears to be written rather than to fade in. That is an approximation of
   real handwriting and is knowingly chosen for now: the intended end state is
   the founder's ACTUAL hand, traced to paths. Because the component takes
   either a string or a ready-made path, swapping one for the other later is a
   config change and touches nothing here.
   ============================================================== */

let handSeq = 0;

/**
 * @param {object} o
 * @param {string} [o.text]   words to write, rendered from the handwriting face
 * @param {string} [o.path]   an SVG path — real traced handwriting, when it exists
 * @param {number} [o.size]   font size in px
 */
export function handwrite(o = {}) {
  const id = `hw${++handSeq}`;
  const size = o.size || 44;
  const el = document.createElement("div");
  el.className = "hw";

  if (o.path) {
    el.innerHTML =
      `<svg class="hw-svg" viewBox="${o.viewBox || "0 0 600 120"}" aria-label="${esc(o.text || "")}">
         <path class="hw-stroke" d="${o.path}" />
       </svg>`;
  } else {
    /* WRITTEN, NOT FADED. The fill arrives a moment after the stroke starts,
       so the letters look drawn and then inked rather than simply appearing. */
    el.innerHTML =
      `<svg class="hw-svg" viewBox="0 0 1000 ${size * 1.7}" preserveAspectRatio="xMinYMid meet">
         <text class="hw-text" x="4" y="${size * 1.15}" font-size="${size}">${esc(o.text || "")}</text>
       </svg>`;
  }
  el.dataset.hw = id;
  return el;
}

/** Run the writing. Resolves when the hand has finished. */
export async function playHandwrite(el, { delay = 0, duration = T.slow } = {}) {
  if (delay) await wait(delay);
  const target = el.querySelector(".hw-stroke, .hw-text");
  if (!target) return;
  if (reduced()) { el.classList.add("is-written", "is-instant"); return; }

  /* The dash length has to exceed the real path length or the tail never
     closes. Measured where the browser can measure it, generously guessed
     where it cannot — a <text> element has no getTotalLength. */
  let len = 1200;
  if (typeof target.getTotalLength === "function") {
    try { len = Math.max(200, target.getTotalLength()); } catch { /* keep the guess */ }
  } else {
    len = Math.max(600, (el.textContent || "").length * 90);
  }
  target.style.setProperty("--hw-len", len);
  target.style.setProperty("--hw-dur", `${duration}ms`);
  el.classList.add("is-writing");
  await wait(duration);
  el.classList.add("is-written");
}

/**
 * The full correction: printed word, a beat, a struck-through line drawn by
 * hand, then the replacement written above it.
 *
 * The beat is not padding. The audience has to have finished reading the
 * ordinary version before it is corrected, or the correction has nothing to
 * push against.
 */
export async function correct(host, { struck, written, size = 44 } = {}) {
  const strike = host.querySelector("[data-strike]");
  const slot = host.querySelector("[data-written]");
  if (!strike || !slot) return;

  await wait(T.beat);
  strike.classList.add("is-struck");
  await wait(T.quick);

  const hand = handwrite({ text: written, size });
  slot.appendChild(hand);
  await playHandwrite(hand, { duration: T.slow });
}

/* ============================================================== MOTIF 2
   ZOOM TO A FIXED POINT — two uses, kept visually distinct

   The spec is firm: used twice, and they must not read as the same device
   repeated. Section 1 is GEOGRAPHIC — travel, distance, scale collapsing.
   Section 5 is TEMPORAL — focus on a moment, not a place.

   So they do not share a component. They share only the easing above, which is
   what makes them feel like relatives rather than twins.
   ============================================================== */

/**
 * GEOGRAPHIC. A match cut, not a literal camera move — the United States and
 * Croatia are most of a hemisphere apart, and a true continuous zoom between
 * them is a globe rotation: expensive, and it draws attention to itself, which
 * this deck forbids. The outgoing frame contracts as the incoming one expands
 * through the same center, so the SCALE COLLAPSE reads without pretending it is
 * one unbroken shot.
 */
export async function scaleCollapse(fromEl, toEl, { duration = T.slow } = {}) {
  if (reduced()) { fromEl.hidden = true; toEl.hidden = false; return; }
  fromEl.style.setProperty("--zoom-dur", `${duration}ms`);
  toEl.style.setProperty("--zoom-dur", `${duration}ms`);
  toEl.hidden = false;
  fromEl.classList.add("is-collapsing");
  toEl.classList.add("is-arriving");
  await wait(duration);
  fromEl.hidden = true;
  fromEl.classList.remove("is-collapsing");
  toEl.classList.remove("is-arriving");
}

/**
 * TEMPORAL. In → out → pan → in, along a date line. The payoff is a zoom onto
 * a point in TIME; Section 4's payoff was a slowdown. Same emotional beat —
 * arrival, focus — reached by a different mechanic, which is what keeps them
 * reading as related rather than repeated.
 */
export async function focusPoint(track, index, { duration = T.normal } = {}) {
  const points = [...track.querySelectorAll("[data-point]")];
  const point = points[index];
  if (!point) return;

  points.forEach((p, i) => p.classList.toggle("is-focus", i === index));

  if (reduced()) {
    track.style.transform = `translateX(${-point.offsetLeft + track.parentElement.clientWidth / 2}px)`;
    return;
  }

  /* Pull back before travelling, so the point being left is seen as one of
     many before the next one fills the frame. Without it the line reads as a
     slideshow of unrelated dates. */
  track.style.setProperty("--focus-dur", `${duration}ms`);
  track.classList.add("is-wide");
  await wait(duration * 0.45);
  const center = track.parentElement.clientWidth / 2;
  track.style.transform = `translateX(${center - point.offsetLeft - point.offsetWidth / 2}px)`;
  await wait(duration * 0.55);
  track.classList.remove("is-wide");
  await wait(duration * 0.4);
}

/* ============================================================== MOTIF 3
   FAST MOTION, THEN SLOWDOWN

   Ordinary time moved fast; THIS moment matters. Used for Abraham and David,
   echoed in Section 5's beat structure, and nowhere else — the spec forbids
   fast motion as decoration precisely because it would spend the meaning of
   the one place it carries any.
   ============================================================== */

/**
 * @param {HTMLElement} host   holds [data-beat] elements and a [data-arrival]
 * @param {object} o
 * @param {number} [o.rush]    ms per intermediate beat — deliberately short
 * @param {string} [o.hand]    what gets written by hand at the arrival
 */
export async function rushThenArrive(host, o = {}) {
  const beats = [...host.querySelectorAll("[data-beat]")];
  const arrival = host.querySelector("[data-arrival]");
  const line = host.querySelector("[data-line]");
  const rush = o.rush || 260;

  if (line) {
    line.style.setProperty("--rush-dur", `${beats.length * rush}ms`);
    line.classList.add("is-rushing");
  }

  /* The years pass. Each beat is real and named — the spec is explicit that
     this is not empty time being skipped, it is a life being lived. */
  for (const beat of beats) {
    beat.classList.add("is-passing");
    await wait(rush);
  }

  if (line) { line.classList.remove("is-rushing"); line.classList.add("is-slowing"); }

  /* The slowdown IS the meaning. Everything before was ordinary. */
  await wait(T.beat);
  if (arrival) {
    arrival.classList.add("is-arriving");
    if (o.hand) {
      const hand = handwrite({ text: o.hand, size: o.size || 38 });
      arrival.appendChild(hand);
      await playHandwrite(hand, { duration: T.slow });
    }
  }
}

/* ================================================================ PRIMITIVES */

/**
 * A number counting up.
 *
 * Eased, not linear: a linear count reads as a readout, and these are meant to
 * feel like they are building toward something. Big numbers move in coarse
 * steps so the eye is not asked to read 300,000 intermediate values.
 */
export async function countTo(el, value, { duration = T.slow, format } = {}) {
  const fmt = format || ((n) => Math.round(n).toLocaleString("en-US"));
  if (reduced()) { el.textContent = fmt(value); return; }

  const started = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      /* Same shape as `settle` — the count and the motion agree. */
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(value * eased);
      if (t < 1) requestAnimationFrame(step);
      else { el.textContent = fmt(value); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

/** Reveal a group in sequence, top to bottom. Never all at once. */
export async function cascade(els, { gap = 140, cls = "is-in" } = {}) {
  for (const el of els) {
    el.classList.add(cls);
    await wait(gap);
  }
}

/**
 * Markup to an element.
 *
 * Every section needs this and each had written its own, which the build's
 * collision check caught the first time it ran — seven identical helpers in
 * one scope, where the last one silently wins. One copy, exported.
 */
/* PIXEL ART, drawn as a grid of unit squares.

   The illustrations are pixel art by request. Writing them as bitmaps rather
   than as <path> data means an icon can be read and edited as the picture it
   is — you can see the horn in the source — and it keeps every icon on one
   consistent grid instead of drifting between hand-tuned curves.

   `rows` is an array of equal-length strings. "." is empty, any other
   character is a filled pixel, and the character selects the shade so a
   single bitmap can carry two tones:
     "#" the icon's own color   "+" the same color at half weight

   shape-rendering:crispEdges is what keeps the squares square; without it the
   renderer antialiases each rect and the art turns to mush at small sizes. */
export function pixel(rows, opts = {}) {
  const h = rows.length;
  const w = rows[0].length;
  if (rows.some((r) => r.length !== w)) {
    /* A ragged bitmap silently shifts every pixel after the short row, which
       reads as a badly drawn icon rather than as the typo it is. */
    throw new Error("pixel(): all rows must be the same length");
  }
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === ".") continue;
      const dim = c === "+" ? ' opacity=".45"' : "";
      rects.push(`<rect x="${x}" y="${y}" width="1" height="1"${dim}/>`);
    }
  }
  const cls = opts.class ? ` class="${opts.class}"` : "";
  const label = opts.label
    ? ` role="img" aria-label="${opts.label}"`
    : ' aria-hidden="true"';
  return `<svg viewBox="0 0 ${w} ${h}"${cls}${label} fill="currentColor" ` +
         `shape-rendering="crispEdges">${rects.join("")}</svg>`;
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const motion = { reduced, wait };
