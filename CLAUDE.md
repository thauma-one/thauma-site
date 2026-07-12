# CLAUDE.md — Thauma Site Conventions

Read this before changing anything. These rules keep the codebase clean
across sessions.

## What this is
Bilingual (EN/HR) static site for Thauma, a church-production ministry.
Eleventy 3 + Decap CMS (/admin) + Netlify (Identity, Forms, Functions,
Edge Functions). Live at https://thauma.one.

## Hard rules
1. ALL user-facing copy lives in src/_data/i18n/{en,hr}.json. NEVER
   hardcode display text in templates. Every new string is added to BOTH
   languages AND to the matching fields in src/admin/config.yml.
2. Never hardcode the language list. Iterate site.languages
   (src/_data/site.json). Adding a language must remain: new i18n JSON +
   entry in site.languages + edge-function LANG_MAP + admin config file
   entry. Nothing else.
3. Design tokens are CSS variables at the top of src/css/main.css.
   BLUE (--blue) = technical voice (cues, frames, structure).
   SEAFOAM (--foam) = ministry voice (values, giving, people).
   Never introduce new colors; use the token families (hi/dim/glow).
4. Type system: Sora (weight 100 for display thin, 600 for bold
   emphasis) + Inter (200/300 body). Headings pattern:
   thin text + <b>bold text</b>.
5. Work on the dev branch. NEVER push to main - merging to main is a
   human decision (it deploys and spends credits).
6. The repo is PUBLIC. Nothing sensitive is ever committed. Sensitive
   staff data belongs in netlify/functions/ (see staff-data.js pattern)
   or external storage - never in src/ or content files.
7. comingSoon flag (site.json): when true, production builds only the
   landing page. The dev server always builds everything
   (src/src.11tydata.js handles this - be careful editing it).

## How pages work
- Page templates in src/*.njk paginate over site.languages via
  pageSlug frontmatter; src/src.11tydata.js computes permalinks.
- Layout: src/_includes/layouts/base.njk (nav, footer, lang selector,
  hreflang - all generated from site.languages).
- The landing page (src/coming-soon.njk) is standalone and owns the
  star + sweep animation (one shared 9s timeline).

## How collections work (the Team pattern - copy it)
- Content: one .md per item in src/content/<collection>/ with
  bilingual fields as {en, hr} objects in front matter.
- Data: src/_data/<collection>.js reads the folder (gray-matter);
  a *Pages.js file crosses items x languages for detail pages.
- Templates: listing page (paginated by language) + detail page
  (paginated over the crossed data, permalink handled in
  src.11tydata.js).
- Admin: folder collection in src/admin/config.yml with create: true.
- Events and Resources should be built exactly this way when real
  content exists.

## Formatting/output conventions
- Bilingual markdown in front matter is rendered with the `md` filter.
- Photos: src/img/, WebP preferred, ~1600-2000px wide, 200-400KB.
  Cinematic treatment (darkening, letterbox) is CSS - photos go in
  bright and natural.
- Every interactive/animated element must respect
  prefers-reduced-motion.
