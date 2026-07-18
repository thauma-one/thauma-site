# CLAUDE.md — Thauma Site Conventions

Read this before changing anything. These rules keep the codebase clean
across sessions.

## What this is
Trilingual (EN/HR/SR) static site for Thauma, a church-production
ministry. Eleventy 3 + Decap CMS (/admin) + Netlify (Identity, Forms,
Functions, Edge Functions). Live at https://thauma.one; the dev branch
is served live through a tunnel at https://dev.thauma.one.

## Hard rules
1. ALL user-facing copy lives in src/_data/i18n/{en,hr,sr}.json. NEVER
   hardcode display text in templates. Every new string is added to ALL
   languages AND to the matching fields in src/admin/config.yml.
   Copy tone follows COPY-REVISION.md (need-first, own-terms; never
   headline "free").
2. Never hardcode the language list. Iterate site.languages
   (src/_data/site.json). site.languages is the on/off toggle (admin
   multi-select, hardcoded options en/hr/sr); adding a NEW language is:
   new i18n JSON + option in the admin languages field + edge-function
   LANG_MAP entry + admin translations-collection file entry. The sr
   copy is a mechanical ijekavian-Cyrillic transliteration of hr — NOT
   native-reviewed; a Serbian speaker must check it before real launch.
3. Design tokens are CSS variables at the top of src/css/main.css.
   BLUE (--blue) = technical voice (cues, frames, structure).
   SEAFOAM (--foam) = ministry voice (values, giving, people).
   Never introduce new colors; use the token families (hi/dim/glow).
   The two-voice split extends to ::selection and focus rings.
4. Type system: Sora (weight 100 for display thin, 600 for bold
   emphasis) + Inter (200/300 body). Headings pattern:
   thin text + <b>bold text</b>. Fonts are self-hosted (src/fonts/,
   see the @font-face comment in main.css before touching them).
5. Work on the dev branch. NEVER push to main - merging to main is a
   human decision (it deploys and spends credits).
6. The repo is PUBLIC. Nothing sensitive is ever committed. Sensitive
   staff data belongs in netlify/functions/ (see staff-data.js pattern)
   or external storage - never in src/ or content files.
7. comingSoon flag (site.json): when true, production builds only the
   landing page. The dev server always builds everything
   (src/src.11tydata.js handles this - be careful editing it).
8. CACHE BUSTING: main.css and main.js are referenced with ?v=N in
   FOUR files — base.njk, 404.njk, coming-soon.njk, staff/index.html
   (main.js in the first three). The dev tunnel edge-caches assets for
   4 hours, so EVERY change to either file must bump its ?v=N in all
   referencing files, then verify `curl -sI https://dev.thauma.one/...`
   returns cf-cache-status: MISS.
9. NEVER run `npx eleventy` / `npm run build` bare while the dev server
   runs — it overwrites the live _site/ with the comingSoon-gated
   production build. Trigger dev rebuilds by touching a watched source
   file (e.g. `touch src/404.njk`); check production output with
   `npx eleventy --output=/tmp/<dir>` and delete it after.

## How pages work
- Page templates in src/*.njk paginate over site.languages via
  pageSlug frontmatter; src/src.11tydata.js computes permalinks.
- Layout: src/_includes/layouts/base.njk (nav, footer, lang dropdown,
  page wheel, hreflang - all generated from site.languages).
- Nav order lives in src/_data/navPages.js (function export so it
  re-reads site.showEvents every build). It drives the desktop links,
  the mobile menu, and the page wheel's numbering — never hand-copy
  the page list anywhere else.
- The landing page (src/coming-soon.njk) is standalone and owns the
  star + sweep animation (one shared 9s timeline).

## Motion system (read before touching any animation)
All of it is reduced-motion gated and orchestrated around MPA View
Transitions. The pieces:
- Cross-page transitions: @view-transition in main.css; the outgoing
  page holds, the incoming fades in (.5s). main.js's whenPageSettled /
  atPageReveal helper is the single gate: EVERY on-load animation is
  held while a transition runs (an animating incoming page forces its
  live snapshot to re-rasterize per frame = stutter). html classes:
  vt-active (transition running, cleared at settle), vt-came
  (persistent: this arrival was a transition, .rise headers skipped —
  the fade IS their entrance), vt-leaving (+ give-pressed) set at
  pageswap to freeze interactive states for the outgoing snapshot
  (Give fill COMPLETES rather than cuts; underline pulse freezes
  full). All cleared again at pagereveal (bfcache safety).
- Page wheel (mobile page label under the nav): per-character roll
  from the previous page's label (sessionStorage), built pre-paint
  showing the OLD label, rolls at settle. Top-down, 1.3s.
- Character cascade: section cues (+ their counter numbers), .work
  labels, and value numbers roll in per-character on scroll-in,
  matching the wheel's motion exactly. Torn back to plain text after.
- Scroll reveals (.sr/.in): batches stagger 90ms top-to-bottom. On
  transitioned arrivals, above-fold targets are un-hidden pre-paint
  (they ride the fade); below-fold keep scroll fades.
- Whisper-parallax: .frame img + .person-photo img drift 4.5% of
  frame height, using 1.12x extra zoom as edge headroom. SAFE FOCAL
  RANGE depends on the slot's zoom: at zoom 100, focal_y must stay in
  37.5–62.5%; at zoom 110, ~19–81%. Going outside exposes the frame
  edge mid-drift — bump zoom before pushing focal_y further.
- Grid→bio morph: team-card photo and bio portrait share a
  view-transition-name (person-<slug>, via data-vt-person attrs,
  assigned in main.js DESKTOP ONLY). The morph is the portraits' only
  entrance treatment — per-photo entrances were tried twice (drop-in,
  develop) and rejected; don't reintroduce one.
- Shared easing: cubic-bezier(.55,.05,.45,.95) for rolls/pulses/fades,
  cubic-bezier(.16,1,.3,1) for the dropdown/menu unfurls (which open
  animated but close with a hard cut — that's intentional).
- Kerning is disabled (font-kerning:none) on the wheel and cascade
  labels so per-character layout matches the resting text exactly.

## How collections work (the Team pattern - copy it)
- Content: one .md per item in src/content/<collection>/ with
  bilingual fields as {en, hr} objects in front matter.
- Data: src/_data/<collection>.js reads the folder (gray-matter);
  a *Pages.js file crosses items x languages for detail pages.
  ALWAYS function exports, never static values (rebuild staleness).
- Templates: listing page (paginated by language) + detail page
  (paginated over the crossed data, permalink handled in
  src.11tydata.js).
- Admin: folder collection in src/admin/config.yml with create: true.
- Team members support photo, bio_photo (falls back to photo) and an
  optional bio_photo_2; bio frames adapt to each photo's real aspect
  ratio (team.js computes it at build time).
- Events and Resources should be built exactly this way when real
  content exists.

## Formatting/output conventions
- Bilingual markdown in front matter is rendered with the `md` filter.
- Photos: src/img/, WebP, 1800px wide, 200-400KB (process uploads with
  the project-local sharp: resize width 1800, quality ~68-82 to taste).
  All four page-photo slots (home_who, about_posture, mission_horizon,
  give_impact) are filled; framing is focal_x/focal_y/zoom in site.json
  (adjustable in /admin) — mind the parallax safe focal range above.
  No visible captions on framed photos; the i18n *_img_tag strings are
  alt text only.
- Every interactive/animated element must respect
  prefers-reduced-motion.
