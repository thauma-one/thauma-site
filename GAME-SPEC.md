# GAME-SPEC.md — The Hidden 404 Game

**STATUS: PHASE 3 SHIPPED, §5.5 COLLAGE WALL SHIPPED (dev-only
front-end; the leaderboard function itself deploys to production like
any Netlify Function — see §8 note).** All three phases and the
collage wall are now built. This remains a living document: append
and revise, don't rediscover.

Last revised: 2026-07-14 (collage wall built; leaderboard reworked to
free-text names + moderation + admin delete; PB reset added; a real
marker-distance bug fixed — see revision log)

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
| World background    | Nav/mission/values/taunts, i18n JSON (ALL languages, §5.5) |
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

**Door 3 (typed word) still runs the original generic ratio-based
curve** described below via the shared `trailStep()` function in
`main.js` — untouched.

**Doors 1 and 2 were given bespoke curves (2026-07-14), replacing the
generic table below for those two specifically** — direct feedback was
that the page-wide filter/invert effects were "too strong," and asked
for text to glitch more than the page:

- **Door 1 (wordmark, 5 taps):** taps 1-2 silent. Tap 3 = a sarcastic
  taunt line (reusing the whisper phrase pool), lingering much longer
  than the trail's usual quick flash so it's actually readable, with
  no accompanying page-wide flash — a calm beat, not a jolt. Tap 4 = a
  big glitch applied directly to the wordmark text itself (RGB-split +
  skew jitter via a dedicated `.thauma-text-glitch-active` class/
  keyframe), never touching `<html>`. Tap 5 enters the game. A wrong
  click (anywhere off the wordmark) just resets the count — no static
  pop.
- **Door 2 (Konami, 11 steps):** the first two inputs (both ArrowUp)
  are silent. Every correct input after that spawns one RGB-split
  "ghost" clone of a real, currently-visible text element on whatever
  page the sequence is being typed on (`spawnTextGhost()`/
  `pageTextTargets()` in `main.js`) — parked over the original and
  jittering briefly before fading. Fast input naturally piles up
  several ghosts at once since each lingers ~450-750ms; that
  accumulation IS the escalation, not a page-wide filter ramp. Wrong
  input just resets the position — no static pop.

**Original generic curve (door 3 only now):**

Sketch (10 steps):
| Steps | Effect |
|-------|--------|
| 1-2   | Nothing / a single faint glitch pixel |
| 3-4   | Cue-line flicker; a wisp of particles in a corner |
| 5-6   | Ghost of whisper-wall text flashes |
| 7-8   | Screen-edge seafoam glow pulse; slight jitter |
| 9     | Page dims a shade |
| 10    | Collapse begins |

**Wrong input (door 3) = the trail dies with a tiny static "pop."**
This taught the "there IS a sequence, and you broke it" lesson well
for door 3, but users reported it read as noise on doors 1/2 once
those got their own bespoke curves — those two now just reset
silently instead. Sequence timers reset after ~2s idle.

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


### 5.5 The collage wall (background layer) — SHIPPED (2026-07-14)

**Reference image:** a typographic-collage poster photo sits in the
same folder as this spec (rename to `game-collage-reference.jpg`).
Claude Code: VIEW IT before building — match its density, mixed sizes/
weights, and interlocking 0°/90° rotations, but in our palette at low
opacity.

The game's lowest visual layer is a continuously scrolling typographic
collage — a wall of words built from the site's own vocabulary, in
many languages, passing behind everything.

Build requirements:

1. **Layering:** drawn FIRST every frame — beneath all gameplay,
   including obstacle columns. Nothing renders under it.
2. **Legibility protection:** words in --dim plus faint blue tints at
   roughly 6–12% opacity against --bg. At a glance it must read as
   texture, not text. Gameplay readability always wins; if in doubt,
   lower the opacity.
3. **Motion:** scrolls with the run as parallax at ~30–40% of obstacle
   speed — a deep wall passing by. Respects prefers-reduced-motion
   (with the rest of the game, per §8).
4. **Endless & non-repeating:** procedurally generate collage panels
   ahead of the player; discard off-screen panels. Vary word choice,
   size, weight, rotation, and packing per panel — no visible tiling
   or repetition. (Same procedural-run philosophy as §6.)
5. **Words = site data, MANY languages:** the collage is deliberately
   POLYGLOT — it draws from the mission words, value titles, nav
   labels, and page vocabulary across ALL available i18n languages,
   plus the 404 whisper-wall phrase list (already multilingual). The
   player's chosen language governs HUD/gameplay text (§8); the
   collage intentionally does not — it is the ministry's vocabulary
   across tongues, all at once. As languages are added to the site,
   the collage grows richer automatically.
6. **Seafoam accent words (rare):** roughly 3–4 words per 100 render
   in --foam instead of dim slate — scaled by panel size/density
   (denser panels may carry slightly more; sparse panels fewer), and
   never two seafoam words adjacent to each other. These are glints,
   not highlights: at collage opacity they should feel like catching
   a word out of the corner of your eye. All other words stay in the
   dim/blue-tint family; seafoam is the only accent color used.
7. **Performance:** pre-render each generated panel to an offscreen
   canvas once, then blit while scrolling — do not redraw hundreds of
   text strings per frame.

Expected tuning pass after first build (normal, not failure):
density, size contrast between largest and smallest words, and
opacity will need eyeballing against real gameplay.

**Built as specced (2026-07-14).** `src/404.njk`: `COLLAGE_WORDS`
gathers nav labels, mission work labels, values titles, and the
`notFound.taunts` whisper list — iterating `site.languages` (not
hardcoded en/hr) so a future language is picked up automatically, per
the project's own i18n convention. `buildCollagePanel()` pre-renders
each 700px-wide panel once to an offscreen `<canvas>` (16-25 words,
mixed 13-53px sizes, 200/700 weights, mostly 0° with ~25% at 90°,
6-12% opacity in a dim blue tint, ~3.5% seafoam accents with a
never-two-in-a-row guard); `updateCollage()` scrolls existing panels
at `speed * 0.35` (within the 30-40% target), generates new panels
just ahead of the visible edge, and discards ones that have scrolled
off; `drawCollage()` just blits the cached canvases — no per-frame
text redraw. Reduced motion sets the parallax rate to 0 (wall stays,
motion doesn't). Verified via a jsdom run capturing actual
`fillText`/`drawImage` calls: 42-51 distinct words/phrases drawn
across a sample run (genuinely polyglot — English and Croatian mixed
in the same wall), zero undefined/empty entries, and `drawImage` call
volume roughly 20x `fillText` volume — confirming panels are built
once and reused, not redrawn from scratch every frame.

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
- **Global futility counter — SHIPPED (2026-07-14):** every death pings
  the leaderboard function (`{ death: true }`, fire-and-forget from
  `die()`) which increments a `totalDeaths` counter in the same Blob
  record as the scores. On death, there's a 1-in-6 chance (only once
  `totalDeaths` has actually loaded — never a fabricated number) that
  the reassembled 404's taunt line is replaced with
  `notFound.global_futility` ("The page has won {n} times.") instead
  of a normal taunt. Local markers tell your story; the global number
  tells everyone's.
- **Global leaderboard — SHIPPED (2026-07-14), reworked same day per
  feedback:** `netlify/functions/game-scores.js`, same Blobs pattern
  as `staff-data.js`. GET returns `{ scores, totalDeaths }`; POST
  submits a score, pings a death, or (admin-only) deletes an entry.
  **Free-text names up to 20 characters** (not the original 3-letter-
  initials idea) — letters/digits/spaces/`'`/`-`/`.` only, no
  fixed-width padding (a short name is just short, no trailing `?`
  filler). A small normalized blocklist (leetspeak substitutions
  folded before matching) catches crude names server-side; any match,
  or a blank name, becomes `FALLBACK_NAME` ("Anonymous") — the
  front-end substitutes the LOADED language's own `notFound.anonymous`
  before ever sending a blank name, so the server's hardcoded English
  fallback is only a safety net for direct API calls, not what a
  normal player sees. **Deletion** is gated behind a shared secret
  (`GAME_ADMIN_TOKEN`, a Netlify site environment variable — never in
  git, same posture as `BLOBS_LOCAL_TOKEN`): every leaderboard entry
  on the home screen has a small "×" that prompts for the token and
  POSTs `{ action: "delete", index }`; wrong/missing token or an unset
  env var always 403s. The trash icon is visible to any visitor (this
  is already a no-auth, forgeable-by-design leaderboard), but only
  someone holding the token can actually remove anything. Crown
  moment: on death, if the run's SIGNAL beats the current 10th-place
  score (or there are fewer than 10 entries yet), a name-entry panel
  appears on the fail screen (`notFound.new_global_best`) instead of
  just the normal Retry/Home buttons. Offline or the function being
  unreachable: the leaderboard list on the game's home screen simply
  stays hidden (`fetch` failure is caught silently) — local best and
  the rest of the game are unaffected either way. Accepted tradeoff:
  client-submitted scores are still forgeable; stakes remain bragging
  rights on a hidden page — deletion exists for cleanup/moderation,
  not to make the leaderboard authoritative.
  Function contract (as built):
  - `GET  /.netlify/functions/game-scores` → `{ scores: [{ name, score }], totalDeaths }` (top 10, desc)
  - `POST /.netlify/functions/game-scores` `{ name: "...", score: n }` → adds a score, returns the same shape
  - `POST /.netlify/functions/game-scores` `{ death: true }` → increments `totalDeaths`, returns the same shape
  - `POST /.netlify/functions/game-scores` `{ action: "delete", index: n, token: "..." }` → removes `scores[n]` if `token === GAME_ADMIN_TOKEN`, else 403
  - Server clamps names to 20 chars from an allowed charset, runs the
    profanity check, and clamps score to `0..999999`; a score of 0 or
    below is not recorded.
- **Personal-best reset — SHIPPED (2026-07-14):** a small, deliberately
  understated link on the game's home screen ("Reset personal best")
  clears `thauma_best` after a confirm dialog — requested directly
  ("there needs to be a way to reset your PB"). Scoped to the best
  only; death history and attempt count are untouched.

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
- **Netlify Functions aren't env-gated the same way (noted 2026-07-14):**
  `env.isProduction` only controls what the Eleventy *templates* emit
  (byte-absent from `_site/` in production). `netlify/functions/*.js`
  files deploy regardless — there's no per-file build gate for
  functions the way there is for `.njk` templates. `game-scores.js`
  therefore IS live and publicly callable on the production site even
  before the game's front-end ships there. Accepted deliberately, same
  reasoning as the leaderboard's own no-auth tradeoff above: no
  sensitive data, forgeable by design, worst case someone pokes the
  endpoint directly and adds a fake bragging-rights entry to a
  leaderboard nobody can see yet.

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

- 2026-07-13 — Added §5.5 the collage wall: polyglot typographic
  scrolling background (lowest layer, parallax, procedural panels,
  site-data words across all languages, rare seafoam accent words
  ~3-4/100 density-scaled, offscreen-canvas performance rule,
  reference image alongside this spec).

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
- 2026-07-14 — **Fourth playtest round + Phase 3 build.** STATUS moved
  to PHASE 3 SHIPPED. Several fixes plus the full arcade phase:
  1. **Marker occlusion fixed.** The best-line and death-marker
     vertical lines were drawn BEFORE the obstacle columns, so a
     passing column's opaque fill silently painted over a marker
     whenever their x-positions coincided — the lines were correct in
     data but intermittently invisible on screen. Reordered so both
     marker types draw AFTER the columns; they're now always on top.
  2. **Trail now tilts with the orb.** Each trail particle is pushed
     with the orb's `tilt` at that instant (`trail.push({x,y,tilt})`)
     and drawn as a tilted ellipse (same shape language as the orb
     itself) instead of a plain untilted circle — per direct feedback
     that "the orb tilts, but not the trail."
  3. **Doors 1 and 2 given bespoke escalation curves** (see §3.5 for
     the full writeup) — replacing the generic ratio-based trailStep
     curve for those two specifically, per feedback that the page-wide
     glitch was "too strong" and a request that text glitch more than
     the page. Door 3 (typed word) is unchanged.
  4. **Phase 3 built: the arcade.** `netlify/functions/game-scores.js`
     (Blobs-backed, no auth, same pattern as `staff-data.js`) serves a
     top-10 leaderboard plus a global death counter. Front-end
     (`src/404.njk`): fetches the leaderboard on game-open and renders
     it on the home screen (hidden entirely if the fetch fails —
     offline-safe by design); `die()` fire-and-forgets a death ping and,
     1-in-6 of the time once the count has actually loaded, quotes it
     instead of a normal taunt; a death whose SIGNAL beats the current
     10th-place score (or when fewer than 10 entries exist yet) shows a
     3-letter initials-entry panel on the fail screen instead of just
     Retry/Home, submitting via the same function. See §8 for a note
     that this function — unlike the `.njk`-templated game itself —
     deploys to production regardless of `env.isProduction`, since
     Netlify Functions aren't gated by the Eleventy build the same way;
     accepted deliberately given the no-auth, forgeable-by-design
     leaderboard already has no sensitive stakes.
  Verified: the marker/trail fixes and door 1/2 redesign via a jsdom
  scripted click/keydown harness (confirmed zero DOM changes on doors
  1-2's silent early inputs, the taunt div appearing on tap 3, the
  text-only glitch class landing on the wordmark — not `<html>` — on
  tap 4, correct navigation timing on tap/step 5, and ghost elements
  appearing on the page starting exactly at Konami's 3rd input).
  `game-scores.js` verified directly with a mocked Blobs store
  (initials sanitized/padded, scores sorted and trimmed to 10, garbage/
  negative scores rejected, death counter increments). The full
  front-end leaderboard flow (fetch, render, death ping, crown
  qualification, submit) verified via a 12-death jsdom scripted run
  with a mocked `fetch` and the same physics-mirroring autopilot used
  in earlier rounds — leaderboard rendered on open, at least one
  global-futility taunt line surfaced, the crown UI appeared and a
  submitted score round-tripped correctly. Production build
  re-confirmed fully game-free in `_site/404.html`; full 19-route site
  regression stayed clean.
- 2026-07-14 — **Fifth playtest round: a real marker bug, PB reset,
  leaderboard rework, and the collage wall built.**
  1. **Fixed a genuine marker-distance bug.** `bestMarkerX`/
     `deathMarkers` were computed using `COLUMN_W + COLUMN_GAP / 3`
     (194px) as the world-distance per 10 SIGNAL, but the real spacing
     between consecutive columns is `COLUMN_GAP + 40` (~460px) — more
     than double. This made both markers reach the orb far earlier
     than the run's actual SIGNAL warranted, relative to the columns
     the player is actually tracking — reported as "the PB line...
     stuck at around the 30-40 point gaps." Replaced with a single
     `WORLD_DIST_PER_10_SIGNAL` constant matching the real spacing,
     used by both markers.
  2. **Personal-best reset added** (see §6) — a subtle home-screen link
     behind a confirm dialog.
  3. **Leaderboard reworked** (see §6's Global leaderboard entry) from
     3-letter padded initials to free-text names up to 20 characters,
     no `?` padding, a profanity filter with a hardcoded "Anonymous"
     server fallback (client substitutes the loaded language's own
     string when the input is blank), and admin-token-gated deletion
     via a small "×" on each leaderboard entry.
  4. **§5.5 the collage wall built** — see that section for the full
     writeup. Replaces the simplified single-strip background from the
     previous round with the fully-specced procedural, polyglot,
     offscreen-cached panel system.
  Verified: the marker fix via the existing jsdom trail/marker
  methodology; PB reset and the leaderboard rework (name length,
  moderation via leetspeak-normalized blocklist matching, wrong-token
  vs. correct-token delete, empty-name fallback) via jsdom runs against
  the real `game-scores.js` (mocked Blobs store) and the front-end
  (mocked `fetch`/`window.prompt`/`window.confirm`); the collage wall
  by capturing actual `fillText`/`drawImage` calls across a 400-frame
  run (42-51 distinct polyglot words drawn, panels confirmed cached
  and reused rather than redrawn). Production build re-confirmed fully
  game-free; full 19-route site regression stayed clean.
