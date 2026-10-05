# ARCADE-SPEC.md — The Hidden Arcade

A living document: append and revise, don't rediscover. Replaces
GAME-SPEC.md (the single hidden Flappy-style game, retired 2026-09-29; its
full history is in git).

**Status (2026-10-05):**
- **Nine cabinets, all playable:** Load Out, Soundcheck, Panel Fixer,
  Cable Run, Stage Runner, Golden Hour, Follow Spot, Strike, Cue Stack.
- **Music and sound** (sound.js): synthesized, off by default.
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

**The runtime (src/js/arcade/play.js)**, built 2026-09-30:
- **A fixed play area** of the game's own size (Load Out is 360×640),
  scaled whole and letterboxed. The old game's three rounds of mobile fixes
  came from sizing its world to the window.
- **The three control types:** tap anywhere / Space / Enter; hold a half /
  ← → / A D; and arrows / WASD, plus the button strip and swipes on touch
  screens.
- **Pause:** Esc / P, the pause button, or the tab going to the
  background.
- **Game over:** a new-best flag, the board, and 3-letter initials (↑↓ to
  change, ←→ to move, letters type, Enter saves).
- **THE CARD LOCKS AFTER GAME OVER** until the player has stopped for half
  a second, however long they keep mashing. A fixed delay let a steady
  tapper land on Save and put "AAA" on the board. Focus starts on the first
  letter, never on Save.
- **The contract:** `ThaumaArcade.games[id] = { size, controls, needs,
  create(ctx) }`, where `create` returns `{ update(dt), draw(g),
  press(dir), stop() }`. ctx has `score()`, `shake()`, `say()` (the stage
  manager's radio line), `over()`, `held` and `words()`.
- **Loading:** the runtime, each game and its vendor scripts load only when
  a cabinet is played.

**Load Out (built 2026-09-30):**
- **Physics:** Planck.js 1.5.0 (a port of Box2D, MIT), copied from the
  npm package into the build. It's the engine stacking games are built on.
- **Six cases:** 12 to 120 kg.
- **Weight you can see:**
  - the kg stencil;
  - heavy builds (diamond plate, hazard tape, big corners);
  - a longer chain and a slower motor;
  - less swing on the hook;
  - the motor's LOAD gauge;
  - a landing jolt of weight × speed, with dust.
- **Rules:** three spares, and a case off the stage costs one. The score
  is the tower's best height in cm. Early cases are kind; later ones are
  longer and heavier.
- **Radio lines** (`loadout_lost`, `_nice`, `_heavy`) are English with my
  Croatian and Slovenian, and Serbian transliterated. They are jokes, so a
  native speaker should rewrite them.

**Soundcheck (built 2026-09-30):**
- You hold the bottom fader; FOH (front of house) holds the top one, and
  gets sharper as the rally grows.
- Every return turns up the gain, and a meter on the side climbs.
- No feedback audio (Chase's call); radio lines instead.
- The match ends when FOH has 5 points. Score is your returns plus 10 per
  point you win.
- Versus (two players) waits: toggle input has one pair of halves.

**Cable Run (built 2026-09-30):**
- Snake as a cable on a stage deck: gear (mic, DI box, in-ear pack) plugs
  in and lengthens it.
- **The worship leader** crosses a row that glows first. Bare cable in
  their path trips them and ends the run.
- **Gaff tape** rolls: one tapes down the oldest half of the cable for 9s;
  taped cable is safe to walk and to cross.
- Nothing moves until the first direction press. In play, a run that
  started on its own hit the wall before the player found the cable.

**Panel Fixer (built 2026-09-30), darts-style as Chase chose:**
- A column of ten panels up the right side, and the tech bottom-left.
- **Throwing:** tap to lock the sweeping angle, tap to lock the pulsing
  power, and the ball flies on a real arc. A short dotted preview shows
  while you aim.
- **Hits:** a broken panel (dead, flickering, or the wrong color, with a
  red corner flag) is reseated. A working one is knocked out, at -50.
- Off the truss and into a broken panel is a bank shot (+150).
- **Rounds:** broken panels and a throw budget; clearing the wall turns
  leftover throws into points. Fixes in a row multiply up to ×5. From round
  4, working panels fail on their own.
- **Aim ranges come from a simulation of every angle × power.** The first
  guess reached only the lower six panels and never the truss. 0.25–1.45
  rad and 450–1100 px/s reach every row (the top ones hardest) and allow
  the odd bank.

**NEVER TEST AGAINST THE REAL BOARD.** Dev shares live's storage. A test on
2026-09-30 mashed Space through game over and saved "AAA 103" to the real
Load Out board. The key was brand new, so it was deleted and the storage is
exactly as before. The scratch browser harness now fails every POST to
/api/game-scores.

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
- **Signal Run** (working name; Chase, 2026-10-01): an endless runner like
  Subway Surfers. Chase's first idea is voltage running down a mic cable.
  His preferred one ("this may be more fun") is a DMX signal travelling to
  a light. A third version: a stagehand running snacks to the talent in the
  green room. Not started: idea only, at Chase's word ("Add it to the list.
  Don't work on it").

## 5. Revision log

- 2026-09-29: first build.
  - Failure engine, six ways in, arcade shell with seven cabinets, and
    `/arcade/`.
  - The Flappy game, its collage wall, its words and GAME-SPEC.md retired.
  - The score boards rebuilt per game, and the partner-site closed page
    redone (THAUMA over a drifting hero gradient, one link, and the door).
  - A tapped door's own element is never torn: a clipped band doesn't
    take taps, and the fifth tap missed on the closed page.
  - 2026-09-30: the game runtime (play.js) and Load Out, played through in
    headless Chromium at desktop and phone size, including mashing through
    game over.
  - Verified in headless Chromium at 1280×800 and 390×844 (touch) on the
    dev server, stage by stage, including the round trip back to the page
    and reduced motion.
- 2026-10-04/05: Chase's full round of notes, and the rest of the arcade.
  - **The way in:** a coin into the cabinet's door (B5→E6), CREDIT 1, the
    start jingle, a dive into the screen, then PLAYER 1 · title · READY ·
    GO (about 3s; 1s on Again). Desktop games sit in a cabinet sized to
    their shape (marquee, bezel, a deck that moves with the keys).
  - **sound.js:** Web Audio only, no files. Pulse leads doubled and
    echoed, triangle bass + sine, noise drums; ten loops (menu and one per
    game) written as chords + melody in the file; ~30 effects. One switch
    (top right, or M), OFF by default, remembered. `beat()` gives Cue
    Stack the tune's clock.
  - **The radio (play.js ctx.quip):** 85 jokes in `jokes_<game>_<event>`
    lists (en/hr/sl written, sr from hr), a speaker tag in [brackets], shown
    3.6–6.5s by length, round-robin, placed per game (`quipAt`) where it
    covers no play. Jokes need native speakers to check, as before.
  - **Controls:** tap with hold (`release`), stick (a fader to drag on a
    phone), aim (drag + let go), lanes (D F J K / four pads), swipe-only
    and cross d-pads, `ctx.pad()` per game. Frame time 0–0.1s; no zoom,
    magnifier or selection while playing.
  - **Load Out:** faster; drops before the tower settles score less
    (RUSHED 30 / STEADY 100); mic case, amp rack, LED panels, cable trunk,
    lighting, speaker in lbs (±12%); weight lights; camera moves only
    between drops.
  - **Soundcheck:** CLASSIC / MODERN; 22 powers in four kinds (good, hex,
    trick = the meme throws, bad); FOH plans its return line by the
    capsules' worth (imperfectly); the dB meter charges a SMASH.
  - **Panel Fixer:** rebuilt Peggle-style on an LED wall that is a
    picture; broken panels are the targets, green ones powers (spare
    balls, power cycle, laser guide, hot ball), a catch case, SHOWTIME;
    the tech is animated with moods.
  - **Cable Run:** speeds with length, early turns, gliding head, cross pad.
  - **New:** Stage Runner (Subway Surfers: the stage manager's errands,
    the PM chasing), Golden Hour (Alto-like festival hills, day/night),
    Follow Spot, Strike (spell for WILD powers), Cue Stack (rhythm).
  - **Doors:** stage 1 is one blink now; 2 noticeable; 3 adds red/cyan
    text and the picture lurching; 4 tears whole sections in bands. A
    faint joystick in the footer's corner is a one-press door. A page
    that comes back from the browser's memory after the closed page's
    hand-off rebuilds itself (the fall reversed).

- 2026-10-05, round 3: Chase played it. "Everything progresses too fast …
  ease you into games and pace them … Give things time to breath. But also,
  work on the graphics some more too."
  - **The way in:** the letters lead again (he preferred the lettering
    glitching to the overlays). A JOLT throws one real letter far off its
    line for three frames (big, skewed, red/cyan, sometimes the wrong
    character) and back. Stage 1: two letters of a big word jolt, one
    aftershock. 2: slips, misfires, jolts every 1.1s. 3: the voice swap,
    jolts in bunches, a big word slices for 170ms. 4: photos tear, a section
    slices every 1.3s. The whole-page hue flicker and constant color/band
    overlays are gone.
  - **Sound on phones:** every touch wakes the audio inside the gesture;
    audioSession 'playback' (or a silent <audio> loop) past the iPhone's
    silent switch; resume from 'interrupted'. Not tested on a phone here.
  - **Pace, every game:** Soundcheck 215→540 (was 270→790), powers one at
    a time 7–11s apart, families introduced in turn; Load Out back to the
    first version's physics (kg 12–120, motor 58+5/case, 0.45s) with lb
    stencils, height scoring (+10 a steady drop); Panel Fixer slower ball,
    6 broken on wall 1; Cable Run 0.18→0.075s; Strike 255→520; Cue Stack a
    new pattern every 7 bars; Follow Spot in four acts; Stage Runner
    8.5→20, teaching one obstacle at a time; Golden Hour top speed 470→620
    over 3 km, features further apart.
  - **Phones:** Soundcheck and Strike take two arrow buttons (no drag
    fader); Follow Spot a d-pad cross whose up/down arrive with "tilt".
  - **Panel Fixer:** the score-while-aiming bug (the preview called the
    real collide()) fixed; the ball goes where you point (solved arc); a
    chute down the middle; seven drawn powers; CREW CALL brings two crew
    who throw at the middle.
  - **Golden Hour:** an opening that pulls the lid off a road case; the lid
    drawn as one (ball corners, extrusion, handle); a fully animated rider
    (crouch, pop, tuck, grab, squash, grind, a tumble apart on a crash);
    taped, lit, glowing obstacles; ramps; BALLOONS (hover) and BANNER
    (wingsuit) with the HEADLAMP and HARD HAT; clouds, mist, pines, string
    lights.
  - **Stage Runner:** errands from the talent, drummer, pastor and kids'
    choir, carried overhead to the green room where they wait and say
    thanks; crew who wave and high-five; the runner from behind (CREW on
    the back) with a run cycle, a tucked jump, a slide; yellow-jacket
    cable ramps, a lit tug, hazard-taped truss; a dressed venue.
  - **Follow Spot:** WELCOME / WORSHIP / THE MESSAGE / ONE MORE SONG; a
    sheep (the sermon illustration), a moth in the beam, the fog machine.
  - **Strike:** a stage behind the letters, LED-tile bricks, a ball trail.
