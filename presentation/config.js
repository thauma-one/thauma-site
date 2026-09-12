/**
 * config.js — everything the presentation SAYS
 *
 * Every number, date, phrase and tier lives here. Nothing in the animation
 * code contains a figure, because the spec is explicit that several of these
 * are unverified and will move, and editing a statistic must never mean
 * reading animation code to find where it was inlined.
 *
 * `verified: false` marks a figure the spec itself flagged as an estimate, a
 * personal source, or unsourced. It is not decoration: the presenter screen
 * lists them, so somebody can see at a glance what is still soft before
 * walking into a meeting. A number nobody has checked should be visible as
 * such to the person about to say it out loud.
 *
 * `source` is kept beside each figure for the same reason — if a supporter
 * asks "where does that come from", the answer is in the file rather than in
 * somebody's memory of a document.
 */

export const config = {
  meta: {
    /* WHOSE DECK THIS IS. The presentation belongs to a partner, not to the
       org — Thauma hosts it, Chase presents it. The slug is the URL segment it
       is published under (/<slug>/present/), so giving another partner their
       own deck later is a new config and a new slug, not a rebuild. */
    partnerSlug: "chaseroush",
    partnerName: "Chase Roush",

    title: "Thauma",
    presenter: "Chase Roush — Ministry Partner",
    /* The smallest nod to the word's meaning, per the Title Page brief. */
    wordmarkNote: "θαῦμα · wonder",
  },

  /* ---------------------------------------------------------------- SECTION 1 */
  /* ---------------------------------------------------------------- SECTION 1
     NUMBERS, ALONE.

     The section's job, in the founder's words, is that the room leaves it
     thinking "that gap is much bigger than I realised". So it is one device
     the whole way through — a single board, one figure at a time, filling the
     frame — and the gap is made VISIBLE rather than remembered: the number
     just left stays on screen above the new one, small and dimmed, so
     300,000 and 7,000 are looked at together rather than one after the other.

     The nouns carry the rest. "Churches in the United States" against
     "Protestants in all of Croatia" is the whole argument, and it is the one
     thing that must not be softened into matching units.

     Everything the founder would otherwise read aloud is gone. */
  opening: {
    heart: { text: "I have done this work. I know what it costs to be the person nobody names.",
             verified: false,
             source: "PLACEHOLDER written by Claude. The founder's own sentence goes here." },

    beats: [
      { value: 2000, label: "years of the church", verified: true,
        source: "Rounded on purpose — the point is the order of magnitude." },
      { value: 25, label: "years of church production as a role", verified: true,
        source: "Church Production Magazine has served the industry since 1999." },
      { value: 10, label: "years of it being normal", verified: true,
        source: "2025 church-staffing commentary: the technical director role was uncommon on staff org charts a decade ago." },

      { heart: true },

      /* A new movement, so the board is cleared before it. */
      { value: 300000, label: "churches in the United States", clear: true, verified: true,
        source: "Derived from Worship Leader Magazine's size-tier breakdown — 177,000 small churches at 59% implies ~300,000 total; cross-checked against Hartford Institute megachurch counts." },
      /* THE GAP. Churches there, people here — and 300,000 is still on screen. */
      { value: 7000, label: "Protestants in all of Croatia", verified: false,
        source: "Estimate from a local ministry leader in personal relationship with the founder. Corroborated: Evangelical (Lutheran) Church reports 3,600 across 13 congregations; Reformed Christian Church 3,000-4,000 across 21-23. Combined 6,600-7,600." },
      { value: 35, label: "in a typical congregation there", verified: false,
        source: "The founder's own relationships among Baptist congregations — not a national survey. Say so if asked." },
      { value: 2, label: "per thousand Croatians", verified: false,
        source: "0.18 per cent, rounded to something a room can hold." },
    ],

    /* KEPT FOR THE PREP SCREEN, not drawn. These are the things the founder
       says out loud, and their sourcing still has to be somewhere he can check
       it before walking in. */
    support: {
      typicalUS: { value: 60, label: "people in a typical American church", verified: true,
        source: "Same size-tier breakdown — the most common church size." },
      oneInThree: { text: "One in three American Protestants attend a church of 1,000 or more.",
        verified: true, source: "Christianity Today, July 2026, citing Hartford Institute / Scott Thumma." },
      topTenth: { text: "The largest 10% of churches hold 70-75% of all churchgoers.",
        verified: true, source: "Same." },
      largestKnown: { value: 120, label: "in one of the larger Croatian churches he knows",
        verified: false, source: "The founder's own relationships." },
      invisibility: { text: "Nobody puts the tech booth on the church website. Nobody's testimony starts with the sound guy.",
        verified: true, source: "Stated plainly, in the founder's own words." },

      /* Croatia's religious makeup. No longer drawn — a pie cannot render the
         0.18% it existed to show — but the figures are real and one of them is
         explicitly unsourced, so the record stays where the prep screen can
         still put it in front of the founder before he walks in. Deleting the
         chart must not quietly delete what was known about its numbers. */
      religion: [
        { name: "Catholic", share: 82, verified: true,
          source: "Catholic Church in Croatia reports 3,215,177 members (2021) against ~3.9M population." },
        { name: "Orthodox", share: 4.4, verified: false,
          source: "NOT YET SOURCED. The spec flags this as needing verification before use." },
        { name: "Other / none", share: 13.42, verified: false, source: "Remainder." },
        { name: "Protestant", share: 0.18, verified: false,
          source: "See beats — seven thousand people, country-wide." },
      ],
    },
  },

  /* ---------------------------------------------------------------- SECTION 2 */
  heart: {
    /* The deck's signature moment. `struck` is replaced by `written` in the
       founder's hand. */
    correction: { before: "I want people to", struck: "BE", written: "FEEL", after: "seen." },
    principle: [
      "This isn't a repair job, and it isn't a checklist of gear to fix.",
      "Before touching anything, listening comes first. The technical need is real — it is never only about the gear.",
      "That is the whole difference between a task and a relationship.",
    ],
    who: "The volunteer who is first in and last out, running a soundboard nobody thanks them for.",
    scripture: "Ephesians 4 says the body is built up when every part does its work. The booth is part of the body.",
  },

  /* ---------------------------------------------------------------- SECTION 3 */
  methods: {
    /* Three methods converging on one destination — NOT four bullets. */
    steps: [
      { key: "language", title: "Language and culture",
        body: "Not a step before the work. It is the mechanism of it — there is no real relationship with someone whose language and world you do not share. This is the lens the other two look through." },
      { key: "presence", title: "Hands-on presence",
        body: "Showing up and serving alongside, physically present in the actual work. We do not parachute in with answers." },
      { key: "training", title: "Training",
        body: "A peer with more experience walking alongside someone building skill. Opportunity and growth — never a list of what somebody does not know." },
    ],
    destination: { key: "community", title: "Community",
      body: "Technical people from across the Church, gathered for the needs of the Church, discovering they are not alone. We are better together.",
      note: "This is where the three are walking, not a fourth thing Thauma does." },
  },

  /* ---------------------------------------------------------------- SECTION 4 */
  patience: {
    american: [
      "Americans want results quickly, and countable.",
      "Missionaries commonly come home after three to five years, because it is hard.",
      "We are praying for a minimum of a decade.",
    ],
    testimony: "God has been teaching me that He moves on a timeline that is not mine.",

    /* Ordinary time moves fast; the moment that mattered is written by hand. */
    abraham: {
      icon: "stars", promise: "The promise to Abraham",
      beats: [
        { label: "Ishmael is born", note: "not the promised son" },
        { label: "The covenant of circumcision" },
        { label: "Sodom is destroyed" },
      ],
      fulfillment: { hand: "25 Years — Isaac Is Born" },
    },
    david: {
      icon: "horn", promise: "Samuel anoints David",
      beats: [
        { label: "He kills Goliath" },
        { label: "Years fleeing Saul in the wilderness" },
        { label: "King over Judah alone", note: "a promise arriving in pieces" },
      ],
      fulfillment: { hand: "15 Years — King Over All Israel" },
    },

    thauma: {
      why: [
        "Thauma does not set hard goals on a hard clock.",
        "That produces two bad outcomes: discouragement when a date is missed, or pressure to force an outcome instead of waiting on God's timing.",
        "This makes accountability genuinely harder, and I would rather say so than pretend otherwise.",
      ],
      /* Held loosely, and the visual must say so — dashed, faint, no endpoint. */
      hope: { text: "7–10 years…", note: "a community of tech people and churches, after the language and culture foundation. A hope, not a promise." },
      named: "God-sized goals — big enough to require Him.",
    },
  },

  /* ---------------------------------------------------------------- SECTION 5 */
  timeline: {
    /* Four of these are the real milestone dates already in the ministry's own
       records. "Leave current job" is not among them and is a placeholder. */
    milestones: [
      { key: "job", label: "Leave current job", date: "2027-02-28", verified: false,
        source: "PLACEHOLDER — not in the milestone records. Confirm before presenting." },
      { key: "vision", label: "Vision trip to Croatia", date: "2027-03-01", verified: true,
        source: "Milestone record: Croatia Vision Trip." },
      { key: "raise", label: "Fundraising season", date: "2027-03-15", until: "2027-09-30",
        verified: true, source: "Milestone record: Support Raising, through departure." },
      { key: "visa", label: "Visa application filed", date: "2027-04-30", verified: true,
        source: "Milestone record: Visa Application." },
      { key: "depart", label: "Departure for Croatia", date: "2027-09-30", verified: true,
        source: "Milestone record: Move to Croatia." },
    ],
  },

  /* ---------------------------------------------------------------- SECTION 6 */
  ask: {
    need: { low: 65000, high: 71000, label: "fully-loaded annual need" },
    buffer: { low: 12, high: 15, label: "per cent, for a three-year buffer" },
    monthly: 6000,
    reasoning: "We are asking a little above today's exact need, so we are not back here in eighteen months.",

    /* A true pyramid: each tier down has more people, small even gaps. */
    tiers: [
      { key: "pm",    name: "Production Manager", amount: 750, target: 1,  role: "Oversees the whole production" },
      { key: "lead",  name: "Lead Engineer",      amount: 500, target: 3,  role: "Senior technical leadership" },
      { key: "sys",   name: "System Tech",        amount: 300, target: 4,  role: "A specialized, respected technical role" },
      { key: "tech",  name: "Technician",         amount: 200, target: 6,  role: "Skilled operator" },
      { key: "a2",    name: "A2",                 amount: 100, target: 8,  role: "Second engineer" },
      { key: "stage", name: "Stage Hand",         amount: 50,  target: 10, role: "Everyone starts here. No shame in it." },
    ],
    tiersNote: "Tier names are a working draft.",

    annual: {
      note: "A separate path, not twelve times the monthly one.",
      rows: [
        { amount: 5000, target: 1 }, { amount: 2500, target: 2 },
        { amount: 1000, target: 3 }, { amount: 500, target: 4 },
        { amount: 250, target: 5 },
      ],
      followUp: "Ask what time of year suits them, and follow up on that date each year.",
    },

    /* Business Plan §9 steady-state, excluding the one-time vehicle line —
       that belongs to the seed round, not to ongoing support. */
    budget: {
      philosophy: "Compensation is set to provide honorably for the worker and household — neither poverty nor wealth by the standards of the community they live in, with real room for long-term stewardship and generosity, not bare survival.",
      philosophySource: "Bylaws, Article VII §5.",
      lines: [
        "Housing and living support", "Retirement contribution", "Per-child allowance",
        "Language study", "Ministry travel", "Equipment and training materials",
        "Croatia and US legal and compliance", "Accounting",
        "Fundraising and communications", "Home-assignment travel",
        "Contingency and inflation buffer",
      ],
      note: "Figures here must stay consistent with the business plan. Change both together.",
    },

    seedRound: "One-time startup costs — org fees, Croatia registration, the vision trip — are raised separately, before this campaign.",

    /* Used offline, and as the fallback whenever live data is unavailable.
       Every count is 0 until real commitments exist; the spec is explicit that
       offline is a first-class path, not a degraded one. */
    offlineCounts: { pm: 0, lead: 0, sys: 0, tech: 0, a2: 0, stage: 0 },

    /* THE ASK ITSELF, as words. This is the most important sentence in the
       whole deck, so it lives here with the other copy rather than inside the
       animation code — it can be reworded without opening a file that knows
       about timing curves.

       Fill-ins: {n} how many seats are open, {tier} the tier's name, {amount}
       its monthly figure. {is/are} and {spot/spots} pick the word on the LEFT
       when exactly one seat is open and the one on the right otherwise, so the
       sentence stays grammatical whichever way it is rewritten. Anything
       between *asterisks* is emphasized. */
    askLine: {
      open: "There {is/are} *{n}* {tier} {spot/spots} left at *{amount}/month* — would you be one?",
      full: "The *{tier}* tier is full. The nearest open seat is a good place to look.",
    },
  },

  /* ---------------------------------------------------------------- SECTION 7 */
  closing: {
    referral: "If anyone comes to mind who should hear this, send them my way.",
    thanks: "Thank you for your time.",
    qr: "https://thauma.one",
  },
};

/** Every figure the spec left unverified, for the presenter screen. */
export function unverified(cfg = config) {
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (node.verified === false) {
      found.push({ path, label: node.label || node.text || node.name || path,
                   source: node.source });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(cfg, "");
  return found;
}
