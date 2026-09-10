/**
 * Section 6 — The financial ask (4–5 min, genuinely variable)
 *
 * DIFFERENT IN KIND FROM EVERY OTHER SECTION. Sections 1–5 are a fixed
 * narrative, the same in every meeting. This one is a live tool, shaped by
 * however the conversation actually goes — the founder will not know in
 * advance whether a given family needs the full walkthrough, a quick pivot to
 * the annual chart, or a different number entirely. So it is built for
 * presenter control before anything else.
 *
 * THE FIGURES ARE OFFLINE FOR NOW, and that is a decision rather than a
 * shortfall: the partner API has no concept of a tier. It returns per-goal
 * aggregates — raised_cents and donor_count — which can say "fourteen donors"
 * and cannot say "three of them are Lead Engineers". Until commitments are
 * recorded per tier, "two A2 spots left" has no source. The wiring is here and
 * reads from one place, so the day that data exists this changes in one file.
 */
import { el, pixel, cascade, motion, T } from "../motifs.js";
import { loadLive } from "../deck.js";

const money = (n) => "$" + Number(n).toLocaleString("en-US");

/* One figure per person in the tier — the reference model's language. A filled
   figure is somebody who has said yes; an open one is a seat, and the whole ask
   is that somebody takes one. Pixel art, matching the promise icons; the shape
   is deliberately the same for both states so the only difference the eye
   catches is fill, not form. */
const FIGURE = [
  "..###..",
  "..###..",
  "..###..",
  ".#####.",
  "#######",
  "#######",
  "#.###.#",
  "..###..",
  "..###..",
  "..###..",
  "..#.#..",
  "..#.#..",
  "..#.#..",
];

/* THE TWO QUIET CORNERS, as marks rather than sentences.

   "What the number is made of" and "Can't do monthly?" were written out in the
   corners of the most sensitive slide in the deck — a person being asked for
   money could read both and know there was a cheaper option before it was
   offered. They are now symbols: a ledger and a coin, in the same pixel hand as
   the crew figures, so they look like part of the drawing. The presenter knows
   what they are. Nobody else needs to. */
const LEDGER = [
  "#######",
  "#.....#",
  "#.###.#",
  "#.....#",
  "#.####.",
  "#.....#",
  "#######",
];
const COIN = [
  "..###..",
  ".#...#.",
  "#..#..#",
  "#.###.#",
  "#..#..#",
  ".#...#.",
  "..###..",
];

function crew(count, filled) {
  return Array.from({ length: count }, (_, i) =>
    `<span class="crew${i < filled ? " is-filled" : ""}">${
      pixel(FIGURE)
    }</span>`).join("");
}

/* THE SEATS ALREADY TAKEN, paid into the chart once the rows are up.

   render() draws every row from whatever counts existed when the section
   mounted, and the live fetch only resolves a step later — so without this the
   figures sit at zero while the sentence underneath them says "1 A2 spot left".
   The same fact twice, disagreeing, which is the one thing this section must
   never do. The spec makes these figures the live-data centerpiece: they fill
   one at a time as the real numbers arrive, so the count reads as current and
   actually moving rather than decorative. */
async function fillSeats(root, config, counts) {
  if (!counts) return;
  for (const tier of config.ask.tiers) {
    const row = root.querySelector(`.tier[data-tier="${tier.key}"]`);
    if (!row) continue;
    const filled = Math.max(0, Math.min(tier.target, counts[tier.key] || 0));
    const seats = [...row.querySelectorAll(".crew")];

    /* A count that went DOWN is a correction, not a moment. It is emptied
       without ceremony — only a seat being taken is worth animating. */
    for (const seat of seats.slice(filled)) seat.classList.remove("is-filled");

    const open = row.querySelector("[data-open-count]");
    if (open) open.textContent = tier.target - filled;

    await cascade(seats.slice(0, filled).filter((s) => !s.classList.contains("is-filled")),
      { gap: Math.round(T.quick / 3), cls: "is-filled", gated: false });
  }
}

/* THE LIVE CONTROL. The spec calls this section a tool operated in real time,
   not a fixed display: the presenter walks in with a tier chosen for this
   family and moves it as the conversation actually goes.

   The sentence it writes is the spec's own ("There are 2 A2 spots left — would
   you be one?"), generated from the live counts so it can never contradict the
   figures drawn right above it. When a tier is full it says so plainly instead
   of asking for a seat that does not exist — being asked to join something
   already complete is worse than being told it filled up.

   The WORDS are in config.js with the rest of the copy. Only the filling-in
   happens here. */

/** One ask line, filled in from config.ask.askLine.

    The singular/plural choice travels with the words rather than living here,
    because a sentence rewritten in config.js would otherwise need this file
    edited to stay grammatical — which is the exact coupling the spec's
    "copy apart from animation code" rule exists to prevent. */
function phrase(template, { n, tier, amount }) {
  return template
    .replace(/\{(\w+)\/(\w+)\}/g, (_, one, many) => (n === 1 ? one : many))
    .replace(/\{n\}/g, n)
    .replace(/\{tier\}/g, tier)
    .replace(/\{amount\}/g, amount)
    .replace(/\*([^*]+)\*/g, "<b>$1</b>");
}
function selectTier(root, config, state, key) {
  const tier = config.ask.tiers.find((t) => t.key === key);
  if (!tier) return;
  state.view.tier = key;

  for (const row of root.querySelectorAll(".tier")) {
    row.classList.toggle("is-current", row.dataset.tier === key);
  }

  const counts = state.live.counts || config.ask.offlineCounts;
  const open = tier.target - (counts[tier.key] || 0);
  const line = root.querySelector("[data-tier-ask]");
  if (!line) return;

  const words = config.ask.askLine;
  line.innerHTML = phrase(open > 0 ? words.open : words.full,
    { n: open, tier: tier.name, amount: money(tier.amount) });
  line.classList.add("is-in");
}

export const ask = {
  key: "ask",
  title: "The ask",

  render({ config, state }) {
    const a = config.ask;
    const counts = (state.live.counts) || a.offlineCounts;
    const committed = a.tiers.reduce((n, t) => n + (counts[t.key] || 0) * t.amount, 0);

    return el(`
      <div class="slide">
        <p class="cue in" data-open>Joining the crew</p>

        <div class="ask-head in" data-open>
          <div class="figure">${money(a.monthly)}<span class="per">/month</span></div>
          <p class="figure-label">${a.reasoning}</p>
        </div>

        <table class="tiers">
          <tbody>
            ${a.tiers.map((t, i) => {
              const filled = counts[t.key] || 0;
              return `
              <tr class="tier in" data-tier="${t.key}" data-i="${i}" data-no-advance>
                <td class="tier-name"><b>${t.name}</b><span class="tier-role">${t.role}</span></td>
                <td class="tier-amount">${money(t.amount)}</td>
                <td class="tier-crew">${crew(t.target, filled)}</td>
                <td class="tier-open"><span data-open-count>${t.target - filled}</span> open</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>

        <!-- THE ASK ITSELF, as a sentence about one tier. The spec is explicit
             that this section is a live tool rather than a slide: the presenter
             arrives with a starting tier chosen on the prep screen and moves it
             during the conversation. So the sentence is generated, never
             hardcoded, and moving it must not advance the deck. -->
        <p class="tier-ask in" data-tier-ask data-no-advance></p>

        <p class="seed in" data-open>${a.seedRound}</p>

        <!-- Two quiet corners. Present, never competing with the chart, and
             opening either is view state — it must not move the deck. -->
        <button type="button" class="corner corner-left" data-no-advance
                data-toggle="budget" aria-label="What the number is made of"
                >${pixel(LEDGER, { class: "corner-mark" })}</button>
        <button type="button" class="corner corner-right" data-no-advance
                data-toggle="annual" aria-label="Annual giving instead of monthly"
                >${pixel(COIN, { class: "corner-mark" })}</button>

        <div class="panel" data-panel="budget" hidden data-no-advance>
          <h3>What the number is made of</h3>
          <p class="philosophy">${a.budget.philosophy}</p>
          <p class="figure-label">${a.budget.philosophySource}</p>
          <ul class="budget-lines">
            ${a.budget.lines.map((l) => `<li>${l}</li>`).join("")}
          </ul>
        </div>

        <div class="panel" data-panel="annual" hidden data-no-advance>
          <h3>Annual partnerships</h3>
          <p>${a.annual.note}</p>
          <div class="pyramid">
            ${a.annual.rows.map((r) => `
              <div class="pyramid-row">
                <span class="pyramid-amount">${money(r.amount)}</span>
                ${Array.from({ length: r.target }, () => `<span class="brick"></span>`).join("")}
              </div>`).join("")}
          </div>
          <p class="figure-label">${a.annual.followUp}</p>
        </div>

        <p class="live-note in" data-live-note></p>
      </div>
    `);
  },

  steps: [
    async ({ root, state }) => {
      await cascade([...root.querySelectorAll("[data-open]")], { gap: 220 });

      /* Says where the numbers came from. Offline is a first-class path, so
         this reports rather than apologizes — but it must never claim to be
         current when it is not. */
      const note = root.querySelector("[data-live-note]");
      const live = await loadLive();
      note.textContent = live.fetchedAt
        ? `Live as of ${new Date(live.fetchedAt).toLocaleTimeString()}`
        : "Figures shown are the last known totals.";
      note.classList.add("is-in");
    },

    /* Tiers arrive one at a time, top of the pyramid down. Not all at once:
       the shape is the argument — each step down has more people in it, and
       the smallest step is the one with the most room. */
    async ({ root, config, state }) => {
      /* One tier per press. The shape is the argument — each step down has
         more people in it — and the presenter is saying that out loud as each
         row lands, so the rows arrive at the speed of the sentence. */
      await cascade([...root.querySelectorAll(".tier")], { gap: T.quick });

      /* Now the seats that are already taken. This happens here, not in the
         step that fetched them, because the rows are still invisible until the
         loop above runs — a chart filling itself behind an opacity of 0 is a
         moment nobody sees. */
      await fillSeats(root, config, state.live.counts);

      /* The starting point chosen on the prep screen. It is a starting point
         and nothing more — the next thing that happens is usually the
         presenter moving it. */
      selectTier(root, config, state, state.view.tier || state.presenter.defaultTier);
    },
  ],

  /* Up and down move the ask a tier at a time, so the presenter never has to
     look away from the person they are talking to in order to find a row.
     Left and right are untouched: this borrows the axis the deck is not using
     rather than overriding navigation. Returning true means "handled". */
  onKey(e, { root, state, config }) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return false;
    const tiers = config.ask.tiers;
    const at = tiers.findIndex((t) => t.key === state.view.tier);
    const to = e.key === "ArrowDown"
      ? Math.min(tiers.length - 1, at + 1)
      : Math.max(0, at - 1);
    e.preventDefault();
    if (to !== at) selectTier(root, config, state, tiers[to].key);
    return true;
  },

  /* Corner toggles and row selection, wired when the section mounts. These are
     the reason the section exists as a tool rather than a slide. */
  wire(root, state, { config }) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-toggle]");
      if (btn) {
        const which = btn.dataset.toggle;
        const panel = root.querySelector(`[data-panel="${which}"]`);
        const open = panel.hidden;
        panel.hidden = !open;
        state.view[which === "budget" ? "budgetOpen" : "annualOpen"] = open;
        btn.classList.toggle("is-on", open);
        return;
      }

      /* Moving the ask by pointing at the row being talked about. */
      const row = e.target.closest(".tier");
      if (row) selectTier(root, config, state, row.dataset.tier);
    });

  },

};
