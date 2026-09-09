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
import { el, cascade, motion, T } from "../motifs.js";
import { loadLive } from "../deck.js";

const money = (n) => "$" + Number(n).toLocaleString("en-US");

/* Small figures, one per person in the tier — the reference model's language.
   A filled figure is somebody who has said yes; an open one is a seat, and the
   whole ask is that somebody takes one. */
function crew(count, filled) {
  return Array.from({ length: count }, (_, i) =>
    `<span class="crew${i < filled ? " is-filled" : ""}" aria-hidden="true">
       <svg viewBox="0 0 12 26"><circle cx="6" cy="4" r="3.4"/>
         <path d="M6 8.5c-2.6 0-4 1.7-4 4v5h1.5l.6 8h3.8l.6-8H10v-5c0-2.3-1.4-4-4-4z"/>
       </svg></span>`).join("");
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
              <tr class="tier in" data-tier="${t.key}" data-i="${i}">
                <td class="tier-name"><b>${t.name}</b><span class="tier-role">${t.role}</span></td>
                <td class="tier-amount">${money(t.amount)}</td>
                <td class="tier-crew">${crew(t.target, filled)}</td>
                <td class="tier-open"><span data-open-count>${t.target - filled}</span> open</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>

        <p class="seed in" data-open>${a.seedRound}</p>

        <!-- Two quiet corners. Present, never competing with the chart, and
             opening either is view state — it must not move the deck. -->
        <button type="button" class="corner corner-left" data-no-advance
                data-toggle="budget">What the number is made of</button>
        <button type="button" class="corner corner-right" data-no-advance
                data-toggle="annual">Can't do monthly?</button>

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
    async ({ root }) => {
      const rows = [...root.querySelectorAll(".tier")];
      for (const row of rows) {
        row.classList.add("is-in");
        await motion.wait(T.quick);
      }
    },
  ],

  /* Corner toggles, wired once when the section mounts. These are the reason
     the section exists as a tool rather than a slide. */
  wire(root, state) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-toggle]");
      if (!btn) return;
      const which = btn.dataset.toggle;
      const panel = root.querySelector(`[data-panel="${which}"]`);
      const open = panel.hidden;
      panel.hidden = !open;
      state.view[which === "budget" ? "budgetOpen" : "annualOpen"] = open;
      btn.classList.toggle("is-on", open);
    });
  },
};
