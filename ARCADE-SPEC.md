# ARCADE-SPEC.md — The Hidden Arcade

A living document: append and revise, don't rediscover. Replaces
GAME-SPEC.md (the single hidden Flappy-style game, retired 2026-09-29; its
full history is in git).

**Status (2026-09-29):**
- **Built:** the ways in, the failure engine and the arcade shell.
- **Not built yet:** the games. Every cabinet is "Coming soon" or "Out of order".
- **Release:** switched ON for dev and OFF for the live site
  (`site.json › visibility.sections.arcade`, or Website › Settings). Turn
  it on for live only once the games are worth finding.

---

## 0. What Chase asked for, in his words

- "It's a Production site with hidden elements. Everyone loves an Easter
  egg! I just want it to be polished if we do it."
- "Having multiple ways to enter, and as you get closer to entering the
  page, things start to 'fail' and glitch more until finally everything
  falls apart and you enter the site."
- "The entire thing feels like an overlay and not like the page itself is
  being glitched." (about the old doors: the thing to never do again)
- "It isn't loading a new page, but that you found something secret!" …
  "almost like changing menus in a game."
- "Lean into the arcade aesthetic. We can keep it modern and colorful, but
  having flares of arcade is a good idea."
- Controls are **tap** (screen tap / Space) or **toggle** (hold left or
  right half / ← → / A D). Cable Run, and Follow Spot once it "unlocks the
  tilt", may use a **d-pad** (a control strip across the bottom of the
  screen on phones; arrows / WASD).
- "Shareable is ok." The arcade has its own address, `/arcade/`.
- "This will go on the live site." Everything has a mobile version.

## 1. The ways in (src/js/arcade/doors.js)

| Door | Where | How |
|---|---|---|
| © 2026 | footer, every page | 5 taps. Each rolls one character, until it reads **▶ PLAY** |
| THAUMA | landing page and home hero wordmark | 5 taps |
| the page wheel | the page label under the nav, phones | 5 taps on the band around it (the wheel itself takes no taps) |
| 404 | the error's numeral | one press. It hints on its own: a digit misfires and rolls back every ~5s |
| Konami | anywhere | ↑ ↑ ↓ ↓ ← → ← → B A, then Enter. The first two presses show nothing |
| "thauma" | typed anywhere | each letter lights that letter wherever the page shows it; the last one gathers them into THAUMA |
| THAUMA, closed page | any `*.thauma.one` with no open site | 5 taps. The page fails and falls, then switches off into `thauma.one/arcade/`. Shown only once `/arcade/` is built for live (the Worker asks its own assets) |

- **Stages and healing:** every door drives stages 1 to 4 (§2). Stop partway
  and the page **heals**, snapping back after 1.9s, and the door's count
  starts over.
- **Konami:** a wrong key snaps everything back at once.
- **Sent only while switched on:** doors.js is included only while the
  arcade is switched on (`_includes/arcade-doors.njk`). fail.js and
  arcade.js load only when someone starts reaching for a door.

## 2. The failure engine (src/js/arcade/fail.js)

**Rule: nothing is drawn on top.** Every effect acts on an element the page
already has.

1. **Hairline cracks.** A few real letters slip off their line.
2. **Losing grip.** Links drift. Letters misfire to wrong characters and
   back. A button looks pressed that nobody touched.
3. **The wrong voice.** `--blue` and `--foam` (and their hi/dim/glow
   families) swap for a beat, and headings stutter between weights 100 and
   600.
4. **Tearing.** Photos and big words are sliced into bands that jump
   sideways (clip-path on the element itself).

**Collapse:**
- Any stages the door hadn't reached go by in a 170ms burst.
- The visible pieces then lose grip and fall. The biggest word comes apart
  letter by letter, as the 404 always did.
- The page squeezes into a bright line, then a dot, like an old CRT
  switching off. The beam is the only element the engine adds, because by
  then there is no page left to act on.

**Typed word:** the lit letters are lifted out of their words into their own
layer (the words keep the gap), then fly to the center as THAUMA while
everything else falls.

**Back from the arcade:** the screen switches on and the fall runs in
reverse (the same animations, reversed). The page ends byte-for-byte as it
was. test/arcade.test.mjs holds the heal to that, and a live round trip was
diffed on 2026-09-29.

**Reduced motion:** no stage does anything, and a finished door opens the
arcade directly.

Gotchas found on real screens:
- **Keep words whole.** Letters split into separate boxes let a line wrap
  mid-word, so each word's letters sit in one `white-space: nowrap` run.
- **Clip the page while it falls.** On a phone, pieces falling past the
  edges widened the page, the browser zoomed out, and the arcade opened
  shifted and shrunk. `body { overflow: clip }` while it falls.

## 3. The arcade (src/js/arcade/arcade.js, src/css/arcade.css)

- **Opens in place**, over the page it was found on, with no page load.
  `/arcade/` is pushed into the history, so the browser's Back closes it and
  the page flies home. At `/arcade/` directly (src/arcade.njk) it powers on
  by itself, and Back leads to the site's home.
- **The menu is a row of cabinets:**
  - moving: ← → / A D / swipe / tap a neighbor;
  - playing: Space / Enter / tap the chosen one;
  - leaving: Esc or Backspace.
- **Each cabinet has an attract screen:** a few seconds of its game, drawn
  small, with only the chosen cabinet and its neighbors animating.
  Unfinished ones flash "Coming soon"; the workshop ones have static and
  "Out of order" tape.
- **Palette: arcade only.** Amber, magenta, violet and red exist nowhere
  outside `#arcade` (Chase: "You can use the unique color palette for
  sure!"). Blue and seafoam are the site's own, so the arcade still reads
  as Thauma.
- **Words:** `arcade.*` in `_data/i18n/{en,hr,sr,sl}.json`, served as
  `/arcade/words.json`. Serbian is the mechanical transliteration of the
  Croatian, as everywhere.
- **Jokes need a person.** Game jokes can't be transliterated or
  machine-translated; Croatian and Serbian speakers should write them.

## 4. A game (next)

A game is a script that registers `ThaumaArcade.games[id] = { start(ctx) }`.
**Scores** (workers/src/game-scores.js): one board per game, the top 5,
with 3-letter initials.
- `GET /api/game-scores?game=<id>` returns `{ game, scores }`.
- `POST { game, name, score }` adds a score.
- Only the listed games have boards, so no invented keys.
- Crude initials (leetspeak and the classic three-letter offenders) become
  "???".
- Deleting a score needs `GAME_ADMIN_TOKEN`.

The shell still owes:
- a fixed logical play area, scaled whole to the screen (the old game's
  three rounds of mobile fixes came from sizing its world to the window);
- input for the three control types, including the phone control strip;
- pause, game over, and 3-letter initials for a global top 5 per game
  (`/api/game-scores?game=<id>`).

The launch four (Chase: "You can start with the four"):
1. **Load Out** (tap): road cases hang from a chain motor; tap to drop.
   - Real physics: weight, friction, and a tower that leans.
   - Chase: "We would need a good way to indicate weight." Heavier cases
     must *look* heavier: size, material, a weight stencil, how the chain
     sags, a thud.
   - Use a free physics engine (Chase: "Go ahead and grab the free physics
     engine"), loaded only with the game.
2. **Soundcheck** (toggle): Pong. Solo against a "sound guy" who gets
   better as the rally grows, plus a Versus mode.
   - **No feedback audio** ("People hate hearing that"). Fun production
     references instead.
3. **Panel Fixer** (tap), darts-style:
   - a tech on the left, the LED wall on the right, broken panels marked;
   - an aim line sweeps up and down, tap to lock it; a power meter fills,
     tap to throw;
   - a real ball arc with a short dotted preview of the curve;
   - hitting a working panel knocks it out.
4. **Cable Run** (d-pad): four-direction Snake drawn as a real cable, with
   the control strip across the bottom on phones.

Later:
- **Follow Spot** (toggle, then d-pad): looks like one-dimensional
  spotlight tracking until the director says "use your tilt". Then it's 2D,
  with backflips, stage dives and hiding behind other people. The performer
  you pick is the difficulty.
- **Strike** (toggle): brick breaker where every brick is a letter.
  - Spelling the target word in order, in a row, triggers a rare super
    power.
  - Chase: "Those words don't really have anything to do with the site …
    those power ups are tame. I want something WILD!" The words should
    come from the site; the powers should be spectacular. Still to design.
- **Cue Stack** (4 lanes): top to bottom, rhythm-style.
- **Truck Pack:** the Tetris-lite version of Load Out.

## 5. Revision log

- 2026-09-29: first build.
  - Failure engine, six ways in, arcade shell with seven cabinets, and
    `/arcade/`.
  - The Flappy game, its collage wall, its words and GAME-SPEC.md retired.
  - The score boards rebuilt per game, and the partner-site closed page
    redone (THAUMA over a drifting hero gradient, one link, and the door).
  - A tapped door's own element is never torn: a clipped band doesn't
    take taps, and the fifth tap missed on the closed page.
  - Verified in headless Chromium at 1280×800 and 390×844 (touch) on the
    dev server, stage by stage, including the round trip back to the page
    and reduced motion.
