# Backlog — Chase's review of 2026-10-03 (and earlier "later" items)

Start with docs/HANDOFF.md (context, rules, what is known). One list, so
nothing is lost between sessions. Each item keeps Chase's own
words where they decide something. **Status** says what is already known.
Order inside each part is rough priority, broken things first.

Legend: **BUG** something is broken · **BUILD** new · **DESIGN** needs a
decision or a look first.

---

## 1. Mail (highest: it blocks testing everything downstream)

Chase: "the whole mailing situation needs looked at and fixed." All of it
was seen on the LIVE site, thauma.one. People
without admin access to Resend will send and receive mail, so everything
must work from the console alone. He wants Resend's tools explored to build
this out well. The Resend and Cloudflare connections he added do not load
in the 2026-10-03 session; start a fresh one.

- **BUG Attachments: "Method Not Allowed."** Found: the composer uploads
  with `PUT /api/staff-mailing?attach=<name>` (src/editor/composer.js
  pickAttachment). `workers/src/staff-mailing.js` has no PUT handler, so the
  answer is its 405. The save and send sides exist (mailing_attachment_add,
  loadAttachments). Only the upload into R2 `attachments/` was never built.
- **FIXED on dev 2026-10-03 (9941bae), not yet published.** Cause: Test and Send
  read buildMailing's `{ value }` wrapper as the message, so render() got
  `undefined`. Mail errors now show their message in the console (461b0e7).
  Old notes follow.
  **BUG "Send me a test" and Send: "The server refused the request (500)."**
  Not on dev (dev's log is clean since 0047), so it was staging or live.
  This machine's wrangler login cannot read those deployments' secrets or
  logs. Next step: Chase presses Send me a test while the session tails that
  site's log (wrangler tail, or the Cloudflare tools in a new session).
  Suspects to rule out: RESEND_API_KEY / MAIL_FROM / SIGNUP_SALT missing on
  that deployment, MEDIA binding, an unverified sender domain.
- **BUG Pictures in a draft are not saved** (the text is).
- **BUG Back deletes the draft.** Wanted: autosave; drafts deleted only by
  hand or once sent; a list of drafts to reopen.
- **BUG Confirmation email:** branding DONE on dev (6ddeeb9): a ministry's
  confirmation is in its own email look with "Powered by Thauma".
  - ~~a small "undefined" at the bottom~~ FIXED on dev (a37d63e);
  - a download button on the banner image;
  - branded THAUMA for Chase Roush's list. It must be the ministry's brand,
    with a small Thauma note at the bottom, like the Site Creator footer.
- **BUILD Composer:**
  - font size;
  - Cmd/Ctrl+B lights the Bold button (it only lights when pressed);
  - more than one color;
  - a link editor;
  - the photo editor (see §4);
  - variables such as the recipient's name.
- **Email look: DONE on dev (9532d1d)** — follows the published website,
  with a designer (Mail › Email look); needs migration 0050 applied for
  the designer to save. Was: make it feel like a real email rather than a box
  on a dark background. Must hold up in Gmail, Apple Mail and Outlook, on
  desktop and mobile. Per ministry, not Thauma's look: either derived from
  their site's design and kept up to date, or an email style designer.
- **Confirm / unsubscribe pages: DONE on dev (6ddeeb9)** in the ministry's
  look after the link verifies. Was: "just so plain and
  boring compared to the rest of the site." Match the brand everywhere.
- ~~**DESIGN Tags management:** "not user friendly."~~ DONE on dev (13bff11):
  chips on each subscriber row, + to add or create, × to remove, press to
  filter.
- **BUG Links in emails point at whichever site sent them** (found
  2026-10-03). "Here We Go!" went out from dev with a dev.thauma.one
  unsubscribe link: it works only while the Pi is on. Pointing every link at
  thauma.one is NOT enough on its own: unsubscribe links are signed with
  SIGNUP_SALT, and dev and staging sign with DIFFERENT keys (the same
  subscriber got t=6fdef5df… from staging and t=bd4f0c25… from dev), so live
  would refuse a dev-signed link. Fix: one SIGNUP_SALT on all three (set in
  the Cloudflare dashboard for thauma and thauma-production, and in the Pi's
  .dev.vars), THEN build every subscriber-facing link from thauma.one.
  Changing the salt voids links already sent (today only Chase's tests) and
  pending account/address/test-inbox links. Pictures already use thauma.one.
  **Code side DONE on dev (003f6c5):** every subscriber link (confirm,
  unsubscribe, List-Unsubscribe, archive) is built from
  lib/origin.js subscriberOrigin() — SUBSCRIBER_ORIGIN if set, else as
  before. **Switched on 2026-10-05:** Chase set one SIGNUP_SALT on all
  three (and RESEND_WEBHOOK_SECRET on both workers); SUBSCRIBER_ORIGIN =
  "https://thauma.one" in all three envs. To prove end to end: subscribe
  a real address from dev, send to it from dev, press its unsubscribe.
- **BUG Tests and real sends still land in Gmail spam** (2026-10-03),
  even to a proven Gmail test inbox. Confirmations from the same address
  reach the inbox. Ruled out: SPF/DKIM present on both domains, DMARC p=none
  on thauma.one, Resend reports "delivered". Seen so far: Gmail's reason is
  "similar to messages that were identified as spam in the past"; the
  newsletter template adds List-Unsubscribe headers and ~180 invisible
  preheader characters that the confirmation template lacks; links point at
  dev/next. Chase deferred this until after the Site Creator work.
  **Tried on dev (003f6c5), unproven:** the preheader padding is now the
  plain &zwnj;&nbsp; pair ×24 instead of 240 figure spaces / BOMs /
  combining joiners. The other difference (links on dev/next) goes with
  the item above.
- **Opens and bounces: BUILT on dev (1215533), NOT SWITCHED ON.**
  /api/resend-webhook (signed) records bounces (permanent → subscriber
  bounced), complaints (→ unsubscribed), opens, clicks; Sent rows show
  "· 2 bounced · 5 opened · 3 clicked". To switch on AFTER publishing:
  create the Resend webhook for https://thauma.one/api/resend-webhook
  (bounced, complained, opened, clicked) and set its whsec_ secret as
  RESEND_WEBHOOK_SECRET on thauma-production and thauma (and the Pi's
  dev vars). Open/click tracking is OFF on both sending domains — decide
  with the spam fix (pixel + rewritten links).

## 2. Staff Resources

- **BUG "Where it goes" can't be changed** once a resource is saved
  (personal ⇄ Thauma).
- **BUG Personal resources can't be deleted.**

## 3. Site Creator

**Done on dev 2026-10-03/04 (not yet published):** text size/color in a box;
alignment for every section; per-page scroll indicator; placeholder words;
Opening → Hero with an accent line; jump-to-section; Header section; verses
(3 looks); Photo and Words (wrap, uncropped portraits, transparent PNGs);
Navigation tab (current-page looks incl. thauma.one's pinging underline,
White/Your color, line under the menu, phone drop-down/full/drawer with the
language inside, Give page vs giving link, social icons in the menu); Custom
Cards; Sign-up/Contact/Give styles; Links tiers, type label, quieter
pictures; Videos button styles + newest video as title; phone timeline
(chaseroush.com design, smooth open/close/X, line in sync); full-width photo
height + press-to-aim; Links tab smart order + site icons; clean links;
preview always a real desktop; meta tags + sitemap + an Advanced tab (Google
and share previews, title/description per language, name cards made at
Publish); ONE photo editor (src/js/photo-editor.js, by purpose: site
sections, hero, bands, email pictures, share pictures; non-destructive).
R2 hygiene: readable upload names everywhere; no button (Chase: storage
is managed by the system, never by a person). A replaced picture is
released when its editing ends (page closed, other draft opened, draft
deleted; never at the save, because of Undo) and deleted if nothing
anywhere names it; a daily sweep removes anything unused for 30 days
(media-cleanup.js). Text sizes in px like Word
(4–200, − / + or typed). Console loads Sora/Inter.
"Bold" and "Dot below" nav looks: added back on dev (2026-10-05). Still open:
Footer: small print under the tagline (Split, Columns), Background /
Line above / Room options. Colors: ONE ministry pair shared with
Sharing, same picker (color-pair.js), saved at once; a site's old own
accent is kept until changed. Thauma's uploads use the one photo editor
(photo-crop.js is now an adapter); Website › Photos' framing window
stays (it models the parallax drift). Thauma's four
page photos now in R2 (site/…, dfefacc); the old src/img copies and
the stray _site_devtest/ build are for Chase to delete.

Also on dev (2026-10-04): verse placement on the Words tab, named by the
words it follows; Photo tab preview frames like the site; Advanced ›
Saved versions (migration 0049, apply it).

Chase: "the general interface for the Site Creator is really good!"

### Everywhere
- **BUILD Text size and color,** including different sizes and colors
  WITHIN one text box.
- **BUILD Alignment** for every section: left, right, center, indent.
  Buttons must follow their section's alignment. BUG: in the Words section
  the button does not move with the text.
- **BUILD Placeholder words in every language** whenever a section is
  added. Chase asked for this before: "It helps those who may not know how
  to phrase some things."
- **BUILD "Jump to section"** for buttons that point at the same page. When
  a dropdown opens (the timeline), scroll a little, keeping the timeline's
  title in view.
- **BUILD A "Show scroll indicator" option per page.**
- **DESIGN Section backgrounds:**
  - Raised currently looks the same as Plain on the Give and Sign-up band
    layouts;
  - I recommended a few site-wide band styles in Design, picked per section
    (§ earlier "later" list).

### Pages and navigation
- **BUG Page names in the nav:** the label does not follow Editing /
  Reference, and there is no Reference language at all there.
- **BUILD A Navigation tab, above Pages** (like Footer):
  - an optional colored line under the nav (chaseroush.com);
  - mobile: one hamburger holding pages and language, animated open, as on
    chaseroush.com and thauma.one, offered as options;
  - current-page styles: lit and underlined (chaseroush.com), an animated
    underline (thauma.one), and more.
- **BUILD A Header section** (page title area). Headers "should offer some
  of the most creativity and versatility": colors, small print, a watermark
  whose text differs from the page name (chaseroush.com).

### Sections
- **Rename "Opening" to "Hero".** Add a splash of color, such as
  chaseroush.com's colored divider under the title (.hero-divider).
- **Photo and Words:**
  - text wrapping around the photo (chaseroush.com About);
  - portrait photos must not be cut off;
  - transparent photos must work;
  - the photo editor (§4).
- **Full-width photo:** height cropping and positioning.
- **Words and Photo-and-Words:** insert a verse in several styles: the
  existing Quote look, plain text with a colored vertical line on the left,
  and a third to design.
- **BUILD Custom Cards section** (chaseroush.com Mission): Attached or
  Detached, like the vertical lines between cards on chaseroush.com.
- **Cards sections, reworked** (Sign-up, Contact, Give; maybe Goals,
  Prayer, Timeline):
  - Card, Integrated (band) and 2–3 more styles, each with alignment and
    background options;
  - maybe the same styles for pasted embeds;
  - Floating (embed) vs Integrated (built into the page) was Chase's
    framing for the forms.
- **Contact:** more appealing, like chaseroush.com while keeping the UX;
  "the card is really skinny on a desktop"; one or two more styles.
- **Give:** the card style "just doesn't look good"; Band doesn't change the
  background.
  - The Give PAGE needs the most flexibility, carefully, because it is
    about money. Choose between a Give button in the nav straight to the
    donation link, or a Give page with information and its own Support
    button. chaseroush.com's Give page mixes giving financially and giving
    in prayer, with different looks on one page.
  - A Support link in the footer straight to giving: word, icon, or a
    colored button.
- **Links (Resources):**
  - tiers, so a link's card size shows its importance;
  - a free "type" label shown in color at the top right (chaseroush.com
    Resources);
  - photos there are too loud: "isn't subtle and distracts".
- **Videos:**
  - styling options for the buttons under the videos (alignment, box style,
    subtle links like chaseroush.com);
  - an option for the latest video's title and date to be the section's
    title (chaseroush.com).
- **Timeline on mobile:** it jumps around when a milestone is pressed.
  Match chaseroush.com's mobile timeline and its animations
  (projects/chaseroush_missions/js/timeline-*.js).

### Links tab
- **DESIGN Smart order:**
  - a link to a page of the site sits above the others;
  - a web address could fetch its favicon, restyle it like the social
    icons, and sit beside them.
- **Explain or rework "also show them at the top"** (design.headerLinks: it
  puts the social icons in the header menu).

### Footer
- Standard and Subtle tagline colors looked the same on Center: FIXED
  2026-10-03 (render.js .foot-center .tagline no longer sets a color).
- More footer options later ("We will need to edit the options of the
  footer some more in the future").

### Clean links and redirects
- **BUILD** chaseroush.thauma.one/YouTube → the YouTube address; the same
  for each social, Give, and custom links by their name. Per language too:
  /hr/Darivanje, and Cyrillic to work out.

### Sharing and search
- **BUILD Automatic meta tags** (Open Graph and Twitter cards, canonical,
  sitemap), per page and language, branded per site. A different picture
  per page, overridable. Today a page has only title, description and
  hreflang.

### Photos and storage (Chase raised these earlier)
- **BUILD Photo editor** wherever a photo is added (sites, mail): size,
  crop, position, border, a darkening overlay (especially for backgrounds).
- **BUILD R2 hygiene:**
  - delete unused uploads, including those in drafts never published;
  - keep the original for re-editing, but never pile up edits;
  - readable object names. (DONE on dev, automatic daily cleanup.)
  - Thauma's four page photos: DONE, in R2 under site/.

### Tabled (said "later")
- The Sharing page's color picker in the Site Creator.
- Sharing vs Site Creator colors. My view: the site's design wins on a Site
  Creator site; Sharing colors are for other websites; say so on Sharing.
- About page shows only the quote. Fill "Who we are" from the Thauma team
  profile? (asked, unanswered).

## 4. Arcade
**DONE on dev (2026-10-05, see ARCADE-SPEC.md revision log):** every note
below, plus Stage Runner, Golden Hour, Follow Spot, Strike and Cue Stack,
music (off by default), the coin-and-dive way in, and 85 jokes.
**Round 3 DONE on dev (2026-10-05):** Chase's play-through notes — pace
eased in every game, letter-led door glitches, phone audio wake-up, phone
arrows (Soundcheck, Strike) and cross (Follow Spot), Load Out's physics
and scoring restored, Panel Fixer's aiming-score bug and powers, Golden
Hour and Stage Runner reworked.
**Round 4 DONE on dev (2026-10-05):** a genre per game, jokes on the
game-over card only, a quieter bigger cabinet, difficulty choices
(Soundcheck, Cue Stack, Follow Spot's kid), the per-game notes, and
scoring at one pace (see ARCADE-SPEC.md). Still for Chase: play it again,
music on a phone, and a native check of the hr/sr/sl words. The online
boards hold scores from the old, faster scoring — clear them with the
scores API (GAME_ADMIN_TOKEN) if wanted.

### Everywhere
- **Same feel on mobile and desktop,** only different controls:
  - Load Out's motor is slower on mobile;
  - the Soundcheck paddle is sluggish on desktop and twitchy on mobile;
  - Cable Run has a slight input delay.

  Likely frame-rate-dependent movement: use time-based steps.
- **Mobile:** no double-tap zoom and no press-to-magnify while a game is up.
- **Music:** 8-bit style per game, catchy but not wearing, with an easy
  mute.
- **An entrance into a game** (a coin in, then a zoom?), short. Perhaps a
  cabinet frame on desktop.
- **Out-of-order cabinets** show their game animating behind the static.

### Getting in
- The glitches should escalate faster:
  - 1st: "Did I just see something?" (subtler than now);
  - 2nd: noticeable;
  - then "Woah!"
- More effects: screen tearing, RGB drift, background effects.
- Falling apart is cleaner but "didn't fit the feel". The power-off is good.
- Rebuild the site on the way back. BUG: returning to Thauma remembered the
  broken look.
- A slightly less invisible door, such as a subtle icon in the footer's
  corner, without hurting the formal feel.

### Games
- **Load Out:**
  - faster pace;
  - allow a drop before the wobble settles, perhaps with fewer points until
    the tower is stable;
  - lowering the platform must not touch the physics;
  - better weight indicators, perhaps green light / red heavy;
  - varied, realistic case weights.
- **Soundcheck:**
  - speeds up too slowly;
  - on mobile, a shorter field so the finger doesn't hide the paddle;
  - controls: drag (speed from stick tilt) or left/right, both with a
    visual;
  - power-ups (a loop ball…), with a lower top speed to enjoy them;
    classic and modern modes;
  - the dB meter does nothing;
  - jokes are too subtle and too brief. Show them after a miss.
- **Panel Fixer** (needs the most work): throwing mechanics, dull graphics,
  no undo after the first press, may be too easy once fixed. Peggle-style
  aiming; touch-and-drag tossing on mobile.
- **Cable Run:**
  - speed up as the cable grows;
  - "doesn't feel like snake" and it's unclear why;
  - a shorter field and a true d-pad shape;
  - free-moving snake was considered, but it won't suit desktop.
- **Ideas (not started):**
  - Signal Run (DMX / mic cable / snacks to the green room, in
    ARCADE-SPEC.md);
  - something like Alto's Adventure, with themed touches.

### Scores
- The initials filter is intentional, and was checked 2026-10-03:
  - three characters, A–Z and 0–9 only;
  - leetspeak is normalized;
  - a word blocklist plus a list of three-letter offenders;
  - any match becomes "???" (workers/src/game-scores.js).
- **Removing a score:** an API exists (`POST {action:"delete", game, index,
  token}`), gated by the GAME_ADMIN_TOKEN secret, but there is no console
  control. BUILD a "Scores" control for admins.
- Scores are client-submitted and forgeable by design. Decide whether that
  still holds once the arcade is public.
