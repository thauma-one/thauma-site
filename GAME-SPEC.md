# GAME-SPEC.md — The Hidden 404 Game

**STATUS: PHASE 2 SHIPPED, SIMPLIFIED (dev-only).** Phase 3
(leaderboard) is still concept — do not build it until this line says
so. This remains a living document: append and revise, don't
rediscover.

Last revised: 2026-07-13 (Phase 2 world simplified, PB flash → text,
death markers moved in-world — see revision log)

---

## 1. The concept in one paragraph

Hidden behind secret triggers across the site lives a game. Finding it
collapses the 404 page — the error literally falls apart — and the
player runs endlessly through a hidden world built from the site's own
pages, collecting its words, surviving its static. Dying means the 404
glitches back together, taunting a little harder each time. Surviving
means the darkness slowly lifts. There is no winning — only a personal
best, a global arcade leaderboard, and the quiet fact that anyone who
plays for five minutes has accidentally toured the entire ministry.

Theology smuggled in, wordlessly: endure in the dark, and the light
comes up.

**Touchstone:** Chrome's offline dinosaur game — a hidden game that
only appears when something's gone wrong. **RESOLVED (2026-07-13):**
the game lives on `/404` only. No secret direct URL. A bookmarkable
entrance undercuts the "hidden until something breaks" premise; the
four doors (§3) are the only ways in, by design.

---

## 2. Architecture principle (the important part)

**The game contains no content. It READS the site's content.**
Same principle as the rest of the codebase: one source of truth,
everything renders from it. This is what lets the game evolve as the
site does, with zero game edits.

| Game element        | Reads from                                   |
|---------------------|----------------------------------------------|
| World background    | Values-page titles, i18n JSON (both languages) |
| Whisper background  | The 404's multilingual phrase list           |
| Colors              | CSS variables (--blue, --foam, --bg, etc.)   |
| Language            | The thauma_lang cookie, like every page      |
| Player character    | A single swappable draw function (see §7)    |

**Hardcoded on purpose:** mechanics — physics, collision, difficulty
curve, the collapse/reassemble theater. Engine stays stable; content
flows through it.

Rule of thumb: *if it's a word, a color, a page, or a value → data.
If it's how the game feels → code.*

Known limit: this covers site **evolution**, not **revolution**. A
full redesign (new metaphors, no cue labels, no sweep line) requires a
matching art pass on the game. The game is a page like any other; it
inherits the design system and shares its fate.

---

## 3. The four doors (triggers) — STABLE IDEA

All triggers navigate to `/404#play`; the game page sees the hash and
begins the collapse immediately. Implementation is a small listener in
main.js (loaded by every page).

1. **Wordmark taps** — 5 quick taps/clicks on THAUMA in the nav
   (counter resets after ~2s idle). The mobile door. Classic
   "tap the version number" pattern.
2. **Konami code** — ↑ ↑ ↓ ↓ ← → ← → B A, typed anywhere on any page.
   The desktop-nerd door. Church techs are the target demographic of
   this door and everyone knows it but Chase.
3. **Typed word** — typing `thauma` anywhere (keystroke buffer). The
   deep-cut door; desktop bonus, never the only path.
4. **The hidden 404 spot** — an element of the 404 page itself that
   glitches faintly and responds to interaction. The lore door: the
   secret lives inside the error.
   **RESOLVED (2026-07-13):** the spot is the "404" numeral itself
   (the big dict-word treatment on the redesigned 404 — see the
   dictionary-entry redesign shipped 2026-07-12). Interacting with it
   opens the door. It also carries an **idle ambient glitch-pulse**
   (~5s cadence, exact timing/feel is a build-time call) as a
   standing "something's here" hint — distinct from and in addition
   to the input-escalation trail in §3.5, which only fires once a
   sequence is in progress. The numeral hints at all times; the trail
   warms only once someone's already reaching for it.

Design intent: "slightly hidden." A 404 is a page people reload away
from in seconds — door 4 rewards the curious; doors 1–3 reward the
playful and let the secret spread by word of mouth.

**RESOLVED (2026-07-13):** all four doors ship together in Phase 1,
not phased — doors 1-3 (wordmark taps, Konami, typed word) are meant
to be findable anywhere on the site by design, so Phase 1 touches
`main.js`/nav (small, env-gated additions) alongside the 404-only
door 4, rather than starting 404-only and adding the others later.

### 3.5 The trail warms (progressive trigger feedback) — STABLE IDEA

Sequence-based triggers (Konami, wordmark taps, typed word) give
escalating sensory feedback as the sequence progresses — the page
reacts to being "almost opened." This is the discoverability
mechanism: an accidental partial input produces a barely-visible
shimmer, curiosity does the rest. The secret becomes a breadcrumb
trail; discovery becomes a story people tell.

Escalation curve is BACK-LOADED on purpose: steps 1-2 nearly
imperceptible (arrow keys scroll pages; early Konami steps fire
accidentally all the time — the trail must whisper before it speaks).

Sketch (Konami, 10 steps):
| Steps | Effect |
|-------|--------|
| 1-2   | Nothing / a single faint glitch pixel |
| 3-4   | Cue-line flicker; a wisp of particles in a corner |
| 5-6   | Ghost of whisper-wall text flashes |
| 7-8   | Screen-edge seafoam glow pulse; slight jitter |
| 9     | Page dims a shade |
| 10    | Collapse begins |

Wordmark taps (5) run the compressed curve: nothing, glint, letter
flicker, building glow + jitter, collapse.

**Wrong input = the trail dies with a tiny static "pop."** This is
the most important effect: it teaches (a) there IS a sequence and
(b) you broke it — converting accidental discovery into deliberate
puzzle-solving. Sequence timers reset after ~2s idle.

Constraints: all effects respect prefers-reduced-motion (no trail
under reduced motion — triggers still work, silently); effects must
never interfere with reading/using the page (opacity ceilings, no
layout shift); pure CSS/canvas, no assets.

---

## 4. The theater (collapse & reassemble) — STABLE IDEA

**Opening:** the 404's elements fail like a system, not a fade —
letters lose grip and tumble with physics, text flickers like a dying
fixture, a tiny monospace `ERR: PAGE_INTEGRITY_LOST` appears. Optional:
one UI fragment remains and becomes the first obstacle.
**RESOLVED (2026-07-13), post-playtest revision:** the first build of
this was too fast (~650ms, one uniform fade) and led straight into
gameplay — both wrong. Now: ~2.1s, two screen-wide glitch punches
(open + midway), and every element gets its OWN scatter trajectory
rather than fading as one block — the "404" numeral splits into
individual characters (first char left, last char right, per a
specific "someone let go and the pieces scattered independently"
note), everything else (nav, cue, ipa, definition, lede, button,
footer) gets randomized dx/dy/rotation too. **The theater no longer
leads into a run directly — it leads to a new home-screen state**
(best score, last 3 deaths, a Play button, and its own "Go back to
Thauma" button) that didn't exist in the original design. The death
screen's Home button also returns here now, not to real-site nav or
the static 404 look — round-tripping through the menu is the norm,
not a one-way trip out.

**Losing:** glitch burst; the 404 reassembles itself out of the game's
debris — fragments fly back into letterforms. Retry copy escalates
with an attempt counter. **RESOLVED (2026-07-13):** persists in
localStorage across visits (same pattern as personal best / death
markers, §6) — the escalation is meant to be earned, not reset every
session:

**SHIPPED (2026-07-13):** expanded from 4 sample tiers to 32 full
taunts per language, indexed directly by attempt count (clamped to
the array length, so it settles on the last line for very high
counts rather than cycling). The full list is the single source of
truth in `src/_data/i18n/{en,hr}.json` under `notFound.taunts` —
don't duplicate it here, edit there. Sample of the range, oldest
idea to newest:

| Attempts | EN                                | HR (draft — founder to refine)     |
|----------|-----------------------------------|-------------------------------------|
| 1        | Page not found.                   | Stranica nije pronađena.            |
| 2        | Page still not found.             | Stranica i dalje nije pronađena.    |
| 4        | The page is winning.              | Stranica pobjeđuje.                 |
| 8        | The page respects your persistence.| Stranica poštuje tvoju upornost.   |
| 32       | Welcome back. The page missed you, sort of. | Dobrodošli natrag. Stranica vas je, na neki način, nedostajala. |

**Texture ideas (optional, cheap):** page title flickers between
`404 · Thauma` and glitched variants during play; barely-audible
static that cuts to silence on collapse (OFF by default, tiny toggle).

---

## 5. The world (zones) — DEPENDS ON SITE DESIGN

**SIMPLIFIED (2026-07-13) — the four-zone cycle (About/Mission/Values/
Team) was built once (see revision log) and then deliberately cut back**:
it read as busywork rather than spectacle — a banner every 150 SIGNAL,
per-zone mechanics, a forced-language HUD glitch — more moving parts
than payoff. Replaced with one continuous, much simpler backdrop: the
site's own convictions (the real Values-page titles, both languages
together) drift past as a single looping strip of text behind the
columns, scrolling at its own slow constant rate — independent of run
state, so it never resets and never accelerates. No banner, no
per-zone mechanic, no collectibles, no forced-language moments.

Intent unchanged in spirit — the game still visibly carries the site's
own words through the background — just delivered as ambient texture
instead of a structured tour. If zones-as-structure get revisited later,
treat this note and the Phase 2 revision-log entry as the "why we
backed off" record, not a dead end to silently retry.

---

## 6. Progression & spectacle — STABLE IDEA

Endless. No win state. Score is labeled **SIGNAL**.

- **Personal best:** localStorage. The single most celebrated moment
  is passing your OWN best mid-run — no screen flash; instead a short
  randomized funny-but-encouraging line (`notFound.pb_lines`, same dry
  voice as the death taunts) appears briefly near the top of the play
  area. **CHANGED (2026-07-13):** was a full-screen color fade; that
  read as a jump-scare rather than a celebration, and didn't fit the
  taunts' established deadpan tone. The randomized line does both jobs
  — confirms the moment, keeps the game's voice consistent — in one
  cheaper effect.
- **Milestone brightening — REMOVED (2026-07-13).** The background no
  longer lifts shade by SIGNAL tier; it read as a gimmick without much
  payoff and fought the new value-words backdrop for attention. The
  background is now a fixed dark tone throughout a run.
- **Procedural runs (hard requirement):** every run is different —
  obstacle placement and gap patterns are randomized per run. No
  memorizable layout; skill is reaction, not recall.
- **Death markers — SIMPLIFIED (2026-07-13):** the original design
  called for a dedicated bottom progress-bar/track DOM element with
  tick marks; built once, but its percent-of-max math silently broke
  down once a run went past its own assumed ceiling ("stops working
  after 300"). Replaced with the same mechanism already used for the
  best-run line: markers now live IN the world itself as scrolling
  vertical lines (rose/pink for the last up-to-3 deaths, seafoam for
  the personal best), computed once at run start from the same
  distance math as the best-line and just scrolling with everything
  else — no separate DOM bar, no percent-of-max ceiling to outgrow.
  Marker data (the actual death SIGNAL values) still persists in
  localStorage; only the on-screen representation changed.
- **Global futility counter:** the leaderboard function also counts
  every death worldwide. The reassembled 404 occasionally quotes it:
  "The page has won 4,182 times." Local markers tell your story; the
  global number tells everyone's. (Phase 3 — requires the function.)
- **Global leaderboard:** Netlify Function + Netlify blob storage
  (same pattern as staff-data). GET top 10 / POST score. **Three-letter
  initials only** — arcade-correct and nearly moderation-proof. Crown
  moment: "NEW GLOBAL BEST — ENTER INITIALS." Offline: leaderboard
  hides, local best still works. Accepted tradeoff: client-submitted
  scores are forgeable; stakes are bragging rights on a hidden page.
  Function contract sketch:
  - `GET  /.netlify/functions/game-scores` → `[{ initials, score }]` (top 10)
  - `POST /.netlify/functions/game-scores` `{ initials: "ABC", score: n }`
    (server clamps initials to 3 chars A–Z, score to a sane integer)

---

## 7. The mechanic — UNDECIDED (deliberately)

The game engine exposes a swappable core so the mechanic can change
without touching the theater, zones, or leaderboard:

- Shell owns: triggers, collapse/reassemble, zones, milestones,
  scoring, leaderboard.
- Module owns: `startGame()`, per-frame update/draw, collision,
  `endGame(score)` callback.
- Player character is ONE draw function — currently a plain glowing
  orb/dot (deliberately LOGOLESS: no star, nothing that could ossify
  into a proto-logo). When a real logo exists, swapping it in is a
  ten-minute change.

Candidate mechanics (all: one file, canvas-drawn, no assets, no
libraries, target < 15KB):

| Candidate       | One-liner                                        | Notes                          |
|-----------------|--------------------------------------------------|--------------------------------|
| Flappy Light    | Orb flies through gaps in glitch-static columns  | Proven fun; front-runner       |
| Hold the Signal | Keep a dot steady on the sweep line vs static    | Most native to existing design |
| Fader Rush      | Drag drifting faders back to target line         | Most on-brand; fiddly inputs   |
| Cable Runner    | Dino-style: jump static blocks on the line       | Simplest; lost round 1         |
| Cue Simon       | Repeat growing light-cue sequences               | Most mobile-chill; least adrenaline |

Decision deferred until build time. The shell makes the choice cheap
to revisit.

---

## 7.5 Build phasing (when STATUS changes)

Env-gating changed the old "wait until the site settles" logic: the
game reads site data (evolves with the site) and ships dev-only
(invisible until released). Build early is now safe; the discipline is
PHASING:

- **Phase 1 — the shell:** four doors, warming trail, collapse /
  reassemble theater, escalating taunts, ONE placeholder mechanic
  (Flappy Light — proven, simplest to feel good), procedural runs,
  local best + death markers. Env-gated. Complete and delightful on
  its own; also the ideal first Claude Code project (self-contained,
  zero risk to real pages, endless small iterations).
  **RESOLVED (2026-07-13):** the game itself lives self-contained
  inside `src/404.njk` (same pattern as `coming-soon.njk` owning its
  own theater) — not a separate loaded script. Doors 1-3's listeners
  are the one exception, living in `main.js`/nav since they must be
  reachable sitewide.
- **Phase 2 — the world:** zones reading site data, milestones,
  dark-lifting progression.
- **Phase 3 — the arcade:** leaderboard function + blob storage,
  initials entry, global futility counter.

Handoff prompt when ready: "Read GAME-SPEC.md and build Phase 1
exactly as specced, on the dev branch, env-gated. Ask me anything
ambiguous before building."

## 8. Constraints (non-negotiable at build time)

- One HTML file (or 404-integrated), no images, no game libraries,
  canvas-drawn, < 15KB target.
- Bilingual via i18n data, language from cookie.
- prefers-reduced-motion: **RESOLVED (2026-07-13)** — a completed
  trigger sequence still launches the game itself (Flappy Light etc.
  still playable), but skips the collapse/reassemble theater and the
  §3.5 warming-trail effects entirely, going straight to gameplay. The
  static 404 with home link is always what's shown before any trigger
  completes. The game is a gift, never a barrier.
- Touch and keyboard parity for play (triggers may be input-specific).
- Nothing in the game may block or delay the 404's core job: a lost
  visitor finding their way home. Home link remains reachable at all
  times.
- localStorage OK (this is the real site, not an artifact).
- **Environment gating:** when built, the game (triggers included)
  ships wrapped in the site's env layer (src/_data/env.js):
  active whenever `not env.isProduction` — i.e., on the Pi dev server
  and any non-production build — and absent from the live site until
  the guard is deliberately removed at release. Testing on dev while
  main stays clean is the default state, not a special mode.
  **RESOLVED (2026-07-13):** `env.isProduction` reuses the existing
  `ELEVENTY_RUN_MODE` dev-server check already gating `comingSoon` in
  `src/src.11tydata.js` (`isDevServer = process.env.ELEVENTY_RUN_MODE
  && process.env.ELEVENTY_RUN_MODE !== "build"`) — one consistent
  signal for "is this a real deploy," not a second detection scheme.

---

## 9. Open questions (append here)

- Sound design: worth it at all, or pure silence?
- Should zone content update per-language mid-run when playing in HR?
- Leaderboard reset policy (never? yearly "seasons"?)
- What replaces the "old way in" idea (catching the landing sweep)
  once the landing page retires at launch — keep as legend, or add a
  post-launch equivalent?

---

## 10. Revision log

- 2026-07-13 — **Second playtest revision.** Named the game
  ("WONDER" / "ČUDO" — a direct translation of thauma itself, easy to
  rename, just a text string). SIGNAL → SCORE ("REZULTAT" in HR),
  SIGNAL read as confusing. Progress track moved from the top edge to
  a thin neon line near the bottom with a slow breathing glow, and
  recent-death/summit ticks now carry a small pulsing dot floating
  above the track so they're visible during actual play, not just a
  sliver on a line. Added a vertical "best" line that scrolls in the
  same world as the columns and reaches the orb exactly when a run
  matches the old best, with a full-screen flash the instant it's
  actually beaten (tied to the authoritative score check, not the
  line's approximate position). The orb now tilts with its own
  velocity and carries a short comet-tail, so it visibly reads as the
  thing moving rather than just the world scrolling under it. Pulled
  a piece of Phase 2 forward per direct request: a parallax layer of
  real site nav words (both languages) drifts slower than the
  foreground, and the glitch-static columns got noise-slice texture
  and bright gap-edges instead of flat fills. Fixed: doors 1-3
  (arriving via #play from elsewhere) now skip the collapse theater
  entirely and land straight on the game home screen — you never saw
  the static page, so replaying its collapse made no sense; door 4 (on
  the page itself) still plays the full theater. Found and fixed a
  real bug in the wordmark-tap door: a mismatched 550ms/2000ms timer
  pair could let a slower tap rhythm trigger a stray navigation
  mid-sequence, wiping the count on the resulting page load — unified
  into one forgiving ~900ms window, verified correct with a
  deterministic fake-timer unit test (no stray nav across taps 1-4,
  fires exactly on tap 5, a lone click still navigates normally).
  Konami extended to accept Enter as a supplemental "Start" after B-A;
  first two arrow presses still scroll the page normally, from the
  3rd correct input on the page stops moving under the sequence. The
  404 numeral no longer shows a pointer cursor (cursor:text instead),
  so the page still reads and selects like an ordinary page until you
  already know to interact with it. Escalating trail effects now
  compound (multiple stacked bursts) at higher tiers instead of only
  swapping which single function fires. All re-verified via jsdom
  (door 4 theater path, hash-arrival direct path, gameplay with
  seeded localStorage best/deaths, tick rendering) plus the isolated
  timer unit test, before committing.
- 2026-07-13 — **Phase 1 playtest revision.** First-hand feedback
  after the initial build: the trail/idle-pulse effects were too
  subtle to actually notice, the collapse was too fast and went
  straight into a run, physics were too punishing (gravity too
  strong relative to the flap impulse, gaps too narrow/frequent),
  the death-marker track was too small to read, and Home-on-death
  went to real-site nav instead of somewhere game-specific. Fixed:
  real glitch effects everywhere (RGB-split text-shadow, filter
  jitter, scanline bursts — `main.js`'s trail functions and the
  numeral's idle pulse both rebuilt on this); collapse slowed to
  ~2.1s with independent per-character/per-element scatter (see §4);
  a new game home-screen state added between theater and gameplay,
  and as the Home button's destination, with its own "Go back to
  Thauma" exit; physics retuned (gravity 0.35→0.22, flap -6.6→-7.8,
  gap 190→260px, column spacing 340→460px — verified numerically:
  peak rise per flap went from 62px into a 190px gap to 138px into a
  260px gap) and confirmed to actually score points under a
  physics-matched autopilot in the jsdom harness, not just avoid
  crashing; death-marker track thickened (2px→6px bar, 2-3px→4-6px
  ticks) and best/recent-deaths now also shown as text on the home
  screen; added an orb particle trail and a death-moment screen
  shake. Re-verified the full flow (theater → home screen → play →
  death → home → play again) and doors 1-3 on a real page, both
  error-free, before and after the changes.
- 2026-07-13 — **Phase 1 built.** STATUS moved to PHASE 1 SHIPPED
  (dev-only). Taunts expanded from 4 sample tiers to 32 full lines per
  language (`i18n.*.notFound.taunts`, now the source of truth, spec
  keeps a small sample). Files touched: `src/_data/env.js` (new —
  isProduction), `src/_includes/layouts/base.njk` (window.THAUMA_ENV
  + window.THAUMA_TAUNTS, the latter env-gated out of production
  entirely), `src/js/main.js` (doors 1-3 + generic page-agnostic
  trail effects — this file isn't currently templated, so the
  listener code itself ships to production but is runtime-inert via
  the isProduction check; only the taunts/canvas/game logic in
  base.njk and 404.njk are fully byte-absent from production output),
  `src/404.njk` (door 4 + idle pulse, collapse/reassemble theater,
  Flappy Light canvas mechanic, SIGNAL scoring, personal best,
  milestone brightening, death-marker track reusing the site's
  existing `.meter` motif, escalating taunts, reduced-motion path).
  Verified: production build (`npm run build`) confirmed fully
  game-free in `_site/`; dev server confirmed the game present and
  working; full 23-route site regression swept clean on both local
  dev and the public tunnel; game logic itself verified by running
  the actual rendered page in a scripted jsdom environment (mocked
  canvas/matchMedia/requestAnimationFrame) through open → play →
  column-collision death → floor death → retry → scoring (confirmed
  columns-passed increments SIGNAL correctly) → reduced-motion
  (confirmed theater skipped, game opens immediately) — no runtime
  errors across 15+ full attempt cycles.
- 2026-07-13 — The 404 page itself was redesigned (dictionary-entry
  style matching About's `thau·ma` treatment: cue label, big Sora
  numeral, IPA-style line, one-line definition), using the real
  site's nav/footer/fonts/colors and i18n data — the foundation §2
  assumed ("the game is a page like any other"). Pre-build Q&A for
  Phase 1: door 4 = the "404" numeral + an idle ~5s ambient
  glitch-pulse hint (new, distinct from §3.5's trail); all four doors
  ship together sitewide, not phased; reduced-motion still launches
  gameplay, only the theater/trail are skipped; env.isProduction
  reuses the existing ELEVENTY_RUN_MODE check; no secret URL — 404
  only, Chrome-offline-dinosaur as the touchstone; attempt counter
  persists in localStorage; game code is self-contained inside
  404.njk except doors 1-3's sitewide listeners. STATUS unchanged:
  CONCEPT — still not building until explicitly told to.
- 2026-07-12 — Procedural runs made a hard requirement. Ghost-run
  idea REJECTED (assumes fixed tracks); replaced with the death-marker
  progress track (summit marker + last 3 ticks). Added global futility
  counter. Added §7.5 build phasing.
- 2026-07-12 — Added §3.5 "the trail warms": progressive escalating
  feedback on trigger sequences, wrong-input static pop, back-loaded
  curve. Resolves the hidden-vs-findable tension.
- 2026-07-12 — Added environment-gating constraint (test on dev,
  absent from production until release) via the new env.js layer.
- 2026-07-12 — Initial capture: four doors, collapse theater, zones
  concept, endless + milestones, arcade leaderboard, swappable
  mechanic, logoless constraint. STATUS: CONCEPT.
- 2026-07-13 — **Third playtest round: corrections, not new features.**
  Columns/orb/background reverted per direct feedback: (1) column fill
  reverted from noise-slice texture back to the original flat
  `rgba(47,216,255,.5)` rectangles — the "spiced up" texture read as a
  regression, not an improvement; (2) orb rendering fixed to a single
  tilted ellipse (tilt derived from `orb.vy`) with the original fading
  particle trail underneath — the previous pass had accidentally left
  both a tilt AND a separate comet-tail duplicate shape, which the user
  correctly read as "two effects fighting," not one; (3) the
  background-parallax "site words drift past" feature was undone
  entirely (not tuned, removed) per explicit "I didn't like that. For
  now." — the words-in-background idea itself isn't dead, just not
  this implementation; (4) `openGameHome()` no longer removes
  `.thauma-collapsing` from `<body>` — that class only mattered while
  the page was mid-collapse, and removing it early snapped the static
  page instantly back to normal, visible for a moment through the game
  view's own opacity fade-in, undercutting "smoothly transition from
  glitch to game home" (there's nothing left under the now-permanently-
  opaque game view to revert, so simply never removing it is correct,
  not a workaround); (5) door 1 retargeted from the nav `.logo` to the
  homepage hero `.wordmark` (index.njk only) — the header logo is a
  real site-home link on every page and can't double as a hidden-game
  trigger without fighting its own job; the retarget also dropped the
  timer entirely (tapping elsewhere just resets the count, no
  expiration) per "I'm not sure we need a time limit"; (6) death's
  reveal (taunt/stats/buttons) now waits ~420ms behind a `punch()`
  glitch (screen-glitch + shake, called twice) before showing, instead
  of a quiet immediate fade — echoing the collapse theater's punch
  rhythm, per "make that more like what we did for when the site falls
  apart." All verified via the same jsdom scripted-play methodology
  used in prior rounds (mocked canvas/matchMedia/RAF via `beforeParse`,
  full open → play → death → retry cycles) plus a full 23-route site
  regression and a production-build game-free check. Committed as
  `7bbaada`.
- 2026-07-13 — **Phase 2 built ("the world," §5). STATUS moved to
  PHASE 2 SHIPPED (dev-only).** Endless run now cycles through four
  150-SIGNAL zones themed after real pages, in order: About, Mission,
  Values, Team — reusing each page's real i18n `.title` (About/
  Mission/Values) so the zone names aren't invented copy; the Team
  zone deliberately always announces in Croatian ("Tim"), hardcoded
  regardless of site language, and also glitches the SCORE/Best HUD
  labels to Croatian for that zone's duration before reverting — a
  small, deliberate "everything glitches into Croatian" flavor beat
  rather than a bug. Zone changes announce via a new
  `#thauma-zone-banner` element styled to match the site's real `.cue`
  label typography (small, letter-spaced, uppercase, foam-colored),
  fading in for ~2.2s per change. Zone-specific mechanics: About drifts
  faint translucent Greek letters (θαυμα) across the backdrop; Mission
  spawns collectible work-words (reusing the real
  `mission.work1/2/3_label` strings) that drift with the columns, and
  catching all three in one zone visit awards a +20 SIGNAL bonus on
  top of normal scoring; Values labels each column with one of the
  real convictions' numerals (`values.items.length`, read not
  duplicated); Team is the forced-Croatian banner/HUD beat above. After
  a full four-zone cycle, the base speed ramp gets a flat +0.4 bump per
  completed loop — "the loop restarts faster," compounding on the
  existing signal-based ramp rather than replacing it. Verified via a
  jsdom scripted run using a physics-mirroring "shadow autopilot" (an
  external simulation using the same GRAVITY/FLAP constants and
  per-frame order as the real update loop, since the orb's real
  position isn't reachable from outside the game's closure) that held
  a stable flight for 60,000 frames with `Math.random` pinned
  deterministic for reproducibility: confirmed 14 consecutive full
  zone cycles (all four banners in order, repeating), 21 distinct
  mission-zone +20 collectible bonuses (isolated from normal +10
  scoring by watching for non-10 SIGNAL deltas), and the SCORE/Best
  labels correctly reading Croatian only during Team-zone visits and
  English otherwise — zero runtime errors, zero unintended deaths.
  Confirmed the production build (`npm run build`) still emits zero
  bytes of game code (`thauma-game`, `thauma-zone-banner`,
  `VALUES_COUNT` all absent from `_site/404.html`), and a full
  23-route site regression stayed clean. Phase 3 (leaderboard) remains
  CONCEPT — not authorized to build yet.
- 2026-07-13 — **Phase 2 simplified per direct playtest feedback: "the
  world is kinda lackluster."** STATUS moved to PHASE 2 SHIPPED,
  SIMPLIFIED. Three changes, all in §5/§6:
  1. **The four-zone cycle was cut.** No more `#thauma-zone-banner`,
     zone-indexed mechanics (Greek-letter drift, Mission collectibles,
     Values numerals, forced-Croatian Team beat), or the per-loop speed
     bump — all removed from `src/404.njk` along with their supporting
     data (`zoneTitles`, `missionWords`, `VALUES_COUNT`,
     `TEAM_ZONE_LABEL`). Replaced with one continuous backdrop: the
     real Values-page titles (`i18n.en/hr.values.items[].title`), both
     languages concatenated into a single looping text strip, drawn as
     a repeating canvas tile (`buildBgTile()`/`drawBackgroundWords()`)
     scrolling at its own slow constant rate (`bgScrollX += 0.35` per
     frame) — independent of run state, so it keeps looping smoothly
     across retries instead of resetting.
  2. **Milestone background-brightening removed.** `bgColor()`'s
     8-tier lighten-with-SIGNAL logic is gone; the play-field background
     is now a fixed `#0B0F15` throughout a run.
  3. **The bottom DOM progress bar/track is gone** (`.thauma-track`,
     `#thauma-progress`, `.thauma-tick`, `trackMax()`/`makeTick()`/
     `updateTrackDom()` all removed) — its percent-of-max math broke
     down once a run passed its own assumed ceiling. The best-run
     marker mechanic (a dashed vertical line scrolling through the
     world, already working correctly) was generalized: the last-3
     deaths now get the same treatment as a small `deathMarkers` array,
     drawn as dimmer rose-colored lines alongside the existing seafoam
     best-line — both live purely in canvas world-space now, no DOM bar.
  4. **The personal-best full-screen color flash (`beatFlash`) is
     gone**, replaced by `showPbToast()`: a short randomized
     funny-but-encouraging line (new `notFound.pb_lines` i18n array,
     10 lines per language, matching the death-taunts' dry deadpan
     voice) fading in near the top of the play area for ~1.8s.
  Verified via a jsdom scripted run (20,000 frames, physics-mirroring
  shadow autopilot as in the Phase 2 test) confirming: the background
  strip draws every frame with zero errors even with 3 preloaded
  recent-death values, the PB toast fires with real randomized text on
  the first best-beating column, and a separate no-flap run that dies
  immediately still reaches the fail overlay with correct taunt/stats
  and a working Retry (fresh death-marker set rebuilt, no crash).
  Confirmed no leftover DOM references to the removed track/zone
  elements. Production build re-confirmed fully game-free; full
  19-route site regression stayed clean.
