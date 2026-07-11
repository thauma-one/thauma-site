# Thauma Website

> **First time setting this up?** Don't start here. Follow
> **LAUNCH-CHECKLIST.md** top to bottom — it creates every account and
> connects every service in the right order. This README is the
> technical reference for after you're live.


Bilingual (EN/HR), geo-aware, CMS-editable static site.
Built with Eleventy · Deployed on Netlify · Edited with Decap CMS.

## Quick start (local)

```bash
npm install
npm run dev        # local preview at http://localhost:8080/en/
npm run build      # production build to _site/
```

Note: the geo language redirect only runs on Netlify (it's an edge
function). Locally, go straight to /en/ or /hr/.

## Deploy

1. Push this folder to a GitHub repo.
2. In Netlify: "Add new site" -> "Import from Git" -> pick the repo.
   Build command and publish folder are read from netlify.toml.
3. Done. The site deploys on every push to `main`.

## Admin setup (one-time, ~5 minutes)

The point-and-click editor lives at `/admin/`.

1. Netlify dashboard -> your site -> Integrations -> Identity -> Enable.
2. Identity -> Registration -> set to **Invite only**.
3. Identity -> Services -> **Enable Git Gateway**.
4. Identity -> Invite users -> invite your own email.
5. Accept the invite, set a password, then visit yoursite.com/admin/.

You can now edit every piece of copy on the site (both languages),
flip the Events page on, and paste Donorbox URLs — all from a UI.
Every save is a Git commit, so there's a full history of every change.

## Staff area

`/staff/` uses the same Netlify Identity login. Invite team members
the same way you invited yourself. The current stub gates content
client-side — fine for links and contacts. Before storing anything
sensitive, move that data behind a Netlify Function that verifies
the Identity token server-side.

## How the language system works

- All copy lives in `src/_data/i18n/en.json` and `hr.json`.
- Every page template builds once per language (Eleventy pagination),
  producing /en/... and /hr/... versions.
- An edge function (`netlify/edge-functions/lang-redirect.js`) redirects
  "/" based on the visitor's country. A manual toggle choice is stored
  in a cookie and always wins.

### Adding a language (e.g., Serbian)

1. Copy `src/_data/i18n/en.json` -> `sr.json` and translate it.
2. Add "sr" to `languages` in `src/_data/site.json`.
3. Add country codes to LANG_MAP in the edge function.
4. Add a file entry for it in `src/admin/config.yml`.
That's it — every page generates in the new language automatically.


## Photos

Photos live in `src/img/` and are committed to the repo (they deploy
with the site). Two ways to add them:

1. **Through /admin/** — the CMS media library uploads straight to
   src/img/ and commits for you.
2. **Directly** — drop files into src/img/ and push.

To place a photo in one of the cinematic frames, open the page
template and swap the comment for an img tag:

```html
<div class="frame">
  <img src="/img/console-haze.webp" alt="FOH console in haze" loading="lazy">
  <span class="tag">...</span>
</div>
```

The dark gradient + letterbox treatment is applied by CSS automatically,
so photos need no pre-editing — export them bright and natural.

**Export guidelines:** ~1600-2000px wide, WebP format, aim for
200-400KB per image (squoosh.app makes this easy). Netlify's free
tier includes ~15GB bandwidth/month, so lean images keep you
comfortably inside it. If the photo library ever grows large
(galleries, event archives), move images to a Cloudflare R2 bucket
on a subdomain (img.thauma.one) and swap the src URLs — same pattern
as chaseroush.com.

## Donations

Create a Donorbox campaign (or another provider), copy the embed URL,
and paste it into Site Settings in /admin/ (or directly into
`src/_data/site.json` under `donorbox.en` / `donorbox.hr`).
The Give page automatically shows the right-language form.

## Turning Events on

Set `"showEvents": true` in Site Settings (/admin/) or site.json.
The page already exists at /en/events/ and /hr/events/.

## Structure

```
src/
  _data/
    site.json          <- settings: languages, events flag, donorbox
    i18n/en.json, hr.json  <- ALL site copy
  _includes/layouts/base.njk  <- nav, footer, language toggle
  *.njk                <- one template per page, builds per language
  css/main.css         <- the design system (color tokens at top)
  admin/               <- Decap CMS
  staff/               <- Identity-gated staff stub
netlify/edge-functions/lang-redirect.js  <- geo language detection
netlify.toml
```
