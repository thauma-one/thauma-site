/**
 * The Title page, the presenter's prep screen, and the close.
 *
 * They live together because none is a content beat: one is a checklist for
 * one person, one is an entrance, and one is a wind-down.
 */
import { el, cascade, motion, T } from "../motifs.js";
import { unverified } from "../../config.js";

/* ---------------------------------------------------------------- SECTION 0
   Not audience-facing. The founder taps through this alone before anybody sees
   anything, and pressing Begin is what starts the presentation.

   Deliberately NOT a section-skip system. The spec asks for a quick
   pre-meeting checklist, not a production control room, and the way that gets
   ruined is by adding one more useful-sounding control at a time.

   The unverified figures are listed here because this is the last moment
   before somebody says them out loud in front of a family. */
export const prep = {
  key: "prep",
  title: "Before you begin",

  render({ config, state }) {
    const soft = unverified(config);
    return el(`
      <div class="slide is-narrow prep">
        <p class="cue">Presenter</p>
        <h2>Before you begin</h2>

        <label class="prep-row" data-no-advance>
          <span>Live figures</span>
          <input type="checkbox" data-prep="online" ${state.presenter.online ? "checked" : ""}>
          <span class="prep-note">Off is fine. Offline is a first-class path — the deck is
            complete without a network, and the ask shows last known totals.</span>
        </label>

        <label class="prep-row" data-no-advance>
          <span>Opening tier</span>
          <select data-prep="tier">
            ${config.ask.tiers.map((t) =>
              `<option value="${t.key}" ${state.presenter.defaultTier === t.key ? "selected" : ""}>
                 ${t.name} — $${t.amount}</option>`).join("")}
          </select>
          <span class="prep-note">Where the ask starts for this family. Still adjustable live.</span>
        </label>

        <label class="prep-row" data-no-advance>
          <span>Who you are seeing</span>
          <input type="text" data-prep="note" placeholder="For your notes — never shown"
                 value="${state.presenter.note || ""}">
        </label>

        ${soft.length ? `
        <div class="prep-soft">
          <p class="cue foam">${soft.length} figures are not verified</p>
          <ul>${soft.map((s) => `<li><b>${s.label}</b>${
            s.source ? `<span> — ${s.source}</span>` : ""}</li>`).join("")}</ul>
        </div>` : ""}

        <button type="button" class="begin" data-begin data-no-advance>Begin</button>
      </div>
    `);
  },

  steps: [async () => {}],

  wire(root, state, { onBegin }) {
    root.addEventListener("change", (e) => {
      const f = e.target.closest("[data-prep]");
      if (!f) return;
      const key = f.dataset.prep;
      if (key === "online") state.presenter.online = f.checked;
      if (key === "tier") state.presenter.defaultTier = f.value;
      if (key === "note") state.presenter.note = f.value;
    });
    root.addEventListener("click", (e) => {
      if (!e.target.closest("[data-begin]")) return;
      state.presenter.started = true;
      onBegin();
    });
  },
};

/* ------------------------------------------------------------------- TITLE
   Thauma leads. The founder's identity follows as PART of it, not above it —
   which is not only tone: donors give to Thauma, which holds discretion, not
   to a person. The two-part reveal says that before a word is spoken. */
export const title = {
  key: "title",
  title: "Thauma",

  render({ config }) {
    return el(`
      <div class="slide is-narrow title-slide">
        <div class="wordmark in" data-t>
          <h1>${config.meta.title}</h1>
          <span class="spark" aria-hidden="true"></span>
        </div>
        <p class="wordmark-note in" data-t2>${config.meta.wordmarkNote}</p>
        <p class="presenter in" data-t3>${config.meta.presenter}</p>
      </div>
    `);
  },

  steps: [
    async ({ root }) => {
      await cascade([root.querySelector("[data-t]")], { gap: 0 });
      await motion.wait(T.normal);
      /* The smallest possible nod to what the word means — present just long
         enough to register, then it stops. Not a lingering effect. */
      root.querySelector(".spark")?.classList.add("is-lit");
      await motion.wait(T.beat);
      await cascade([root.querySelector("[data-t2]")], { gap: 0 });
      await motion.wait(T.quick);
      await cascade([root.querySelector("[data-t3]")], { gap: 0 });
    },
  ],
};

/* ---------------------------------------------------------------- SECTION 7
   The quietest screen in the deck. Almost everything that happens here is
   physical and spoken — the lanyard handed over, the name written on it, the
   thanks. The screen's job is to stay out of the way. */
export const closing = {
  key: "closing",
  title: "Thank you",

  render({ config }) {
    const c = config.closing;
    return el(`
      <div class="slide is-narrow close-slide">
        <div class="qr in" data-c>${qr(c.qr)}</div>
        <p class="lead in" data-c>${c.thanks}</p>
        <p class="in" data-c>${c.referral}</p>
      </div>
    `);
  },

  steps: [async ({ root }) => cascade([...root.querySelectorAll("[data-c]")], { gap: 320 })],
};

/* The code itself is generated at build time into QR_CODES — see build.mjs.
   A drawn-on placeholder would be worse than an obvious gap: somebody would
   point a phone at it in a living room and it would fail in front of everyone.
   So when a code is genuinely missing, the URL stands alone and is readable,
   which is a thing a person can actually act on. */
function qr(url) {
  const code = (typeof QR_CODES !== "undefined" && QR_CODES[url]) || "";
  return `<div class="qr-frame${code ? "" : " is-bare"}">
            ${code}
            <span class="qr-url">${url.replace(/^https?:\/\//, "")}</span>
          </div>`;
}
