# Handoff — read this first (written 2026-10-03, end of a long session)

The previous session (dba64cb9…, 2026-09-28 → 10-03) ran out of room. This
file holds what the next one needs. Then read **docs/BACKLOG.md** (every
open item) and the memory notes in §6.

---

## 1. Where to start: MAIL, on the LIVE site

Chase: "I was doing everything on the live site since that is the final
destination." Every mail problem in BACKLOG §1 was seen on
**https://thauma.one**, not on dev or staging.

He connected Claude to **Resend** and **Cloudflare Developers**. Those tools
did not load in the old session; check for them first (ToolSearch "resend",
"cloudflare"). He wants Resend's features explored to build mail out
properly. People WITHOUT access to Resend's dashboard will send and receive
mail, so everything must work from Thauma's console.

What is already known:

1. **Attachments, "Method Not Allowed":**
   - `src/editor/composer.js` pickAttachment sends
     `PUT /api/staff-mailing?attach=<filename>` with the raw file;
   - `workers/src/staff-mailing.js` has NO PUT handler, so the 405 comes
     from its fallthrough (≈ line 1180);
   - built already: the save side (`mailing-save` takes
     `body.attachments`, keys must start `attachments/`, → the
     `mailing_attachment_add` query) and the send side (`loadAttachments`,
     reading R2 binding `MEDIA`, base64 to Resend);
   - missing: the upload. Store to R2 under `attachments/<partner or
     org>/…` and answer `{ file: { key, filename, bytes } }`, the shape
     composer.js pushes into `cp.attachments`. Mind size limits (Resend
     ≈40MB per email in total) and partner scoping.
2. **"Send me a test" and Send, 500 on live:**
   - `mailing-test` is at ≈ line 798 of staff-mailing.js, `mailing-send`
     right after; they go through `buildMailing` → `messageFor` →
     `sendMail` (lib/mail.js);
   - a 500 means something threw, uncaught (a refusal from Resend would be
     a 502 with its error);
   - the cause is NOT known. The local wrangler login cannot list
     production secrets or read its logs (the API refused);
   - next step: watch live's log (Cloudflare tools, or `npx wrangler tail
     --env production` if permitted) while Chase presses "Send me a test"
     once;
   - suspects: a missing RESEND_API_KEY or SIGNUP_SALT secret on
     production, `unsubscribeUrl` (lib/unsub.js), the MEDIA binding, the
     sender address. MAIL_FROM / CONTACT_FROM are
     "Thauma <noreply@thauma.one>" in every vars block of wrangler.toml.
3. **Other mail bugs,** not yet investigated:
   - pictures in a draft are lost on save;
   - Back deletes the draft (wanted: autosave + a drafts list);
   - the confirmation email shows a small "undefined" at the bottom and a
     download button on its banner;
   - the confirmation for Chase Roush's list is branded THAUMA. It must be
     the ministry's brand, with a small Thauma note at the bottom.
4. Then the design work in BACKLOG §1: the composer, the email look, the
   subscribe pages, tags, and opens and bounces.
   - The `mailing_recipients` columns `opened_at` and click tracking exist
     from 0016, but nothing writes them; Resend webhooks are the natural
     source.

**Mail code map:**
- `workers/src/staff-mailing.js`: the Mail API;
- `lib/mail.js`: `sendMail`, `listConfirmEmail`;
- `lib/mail-i18n.js`: email words;
- `lib/newsletter.js`: render, sanitize;
- `lib/unsub.js`;
- `signup.js`, `confirm.js`, `confirm-email.js`, `unsubscribe.js`: the
  public pages and links;
- `contact.js`: contact form;
- console side: `src/editor/composer.js`, `src/js/staff-mailing.js`,
  `src/_includes/mail-body.njk`, `src/js/admin-forms.js`.

Second in line: **Staff Resources:** "Where it goes" can't be changed
after saving, and personal resources can't be deleted (BACKLOG §2).

---

## 2. How Chase works (non-negotiable)

- He does not write code. Hand back **every command, in order,
  copy-pasteable**. For commands he must run, the `!` prefix runs them in
  the session.
- **Verify before asserting.** Say so when something is a guess. Check the
  seams between pieces, not just each piece.
- **Commit finished work. Push `dev` freely. NEVER push or merge to
  `main`:** his **Publish** button does that. Every commit ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: <this session's link>
  ```
- **No throwaway files in the repo.** Scratch work goes in the session's
  scratchpad. Run `git status --porcelain` before saying done.
- **Tests:**
  - run BOTH folders: `test/*.test.mjs` and `workers/test/*.test.mjs`
    (88 files);
  - gate the commit on the result:
    `fails=0; for t in test/*.test.mjs workers/test/*.test.mjs; do node "$t" >/dev/null 2>&1 || { fails=1; echo FAIL $t; }; done; [ $fails = 0 ] && git commit …`
  - once, a failing test got committed and pushed anyway.
- **Console text:**
  - every visible word lives in `src/js/staff-i18n.js` (en/hr/sr, equal
    counts);
  - no parentheticals; US spelling (a test enforces it);
  - Croatian console uses formal address.
- **Site text** lives in `src/_data/i18n/*.json`. Serbian is Croatian
  transliterated to ijekavian Cyrillic; names stay Latin.
- **Languages will grow** (to ~30): never one column per language. Use
  the "Editing ⇄ Reference" picker pattern (milestones, Goals, List
  settings). Everything public must be translatable.
- **UX over words:** if a control needs a sentence of explanation,
  redesign the control.
- **Never run bare `eleventy` / `npm run build`** while the dev server
  runs.
- **Credits:** Chase watches usage. Prefer focused work. Table big design
  items unless he asks.

## 3. The three sites and the one database

- **dev.thauma.one:** `wrangler dev --env dev` on this Pi (systemd
  `thauma-dev.service`; log via `journalctl -u thauma-dev`). It runs the
  **working tree live:** a saved file is the dev site.
- **next.thauma.one:** staging, deployed by `.github/workflows/deploy-staging.yml`
  from `dev` (the Preview button).
- **thauma.one:** live, deployed from `main` (the Publish button merges
  dev→main).
- **ONE database, `thauma-ops`, for all three** (since 68f8ce3). A dev
  edit is a real edit. KV and R2 are shared too: never write test arcade
  scores.
- **Migrations:** additive only. A new one goes live like this:
  1. commit the migration ALONE first (dev reads new columns immediately
     and breaks until it is applied: 0047 broke the Website page for a
     while);
  2. Chase opens **Review and publish** in any Website screen's bottom bar;
  3. the box "The database is behind the code." appears;
  4. he presses **Apply changes** and types `MIGRATE`.

  There is NO "Admin › Publish › Migrations" menu; I wrongly sent him
  there once. Since 3014072, Apply reads files from STAGING_BRANCH (dev),
  the branch Publish checks.
- **The auto-mode classifier blocks me from writing to the live database
  and from weakening security checks.** When blocked, explain and give
  Chase the command to run himself with `!`. Read-only `wrangler d1
  execute thauma-ops --remote --command "SELECT …"` works.
- dev.thauma.one has a Worker-less route so its static files come from the
  Pi, not live (pending-cloudflare-fixes memory).

## 4. What the last session built (all published unless noted)

- **chaseroush.com ↔ Thauma.** Repo: /home/chaseroushtech/projects/chaseroush_missions,
  branch `dev`; dev.chaseroush.com serves that folder live, behind
  Cloudflare Access on purpose, because its functions hold live
  credentials.
  - `js/thauma-data.js` reads the public API
    `https://thauma.one/embed/v1/chase-roush.json` (slug **chase-roush**).
  - No fallback to the old JSON files; the last good answer is kept in
    localStorage.
  - Wired: Give (goals and prayer), timeline (home and Timeline), Updates
    (video and latest newsletter), Contact (reasons from
    `GET /embed/v1/chase-roush/contact`, posts to Thauma), Stay connected
    (lists from `GET …/signup`, posts to Thauma).
  - `index.html`, `about.html`, `mission.html` and `timeline.html` are
    read-only on disk (0444); leave them unless Chase says otherwise.
  - The `node_modules` deletions in that working tree predate this work;
    don't commit them.
- **Public API rules** (memory: public-api-sharing-rules):
  - the Sharing page is the ONE switch; `partners.is_public` is no longer
    checked;
  - Resources, Directory, Stewardship and mailing-list people are on
    PRIVATE_TABLES and can never be published;
  - wanted later: a human-readable view of what the API broadcasts.
- **0047:** `texts` JSON on goals and mailing_lists, holding the other
  languages. Goals and List settings have Editing ⇄ Reference + Translate.
  The API, widgets, sign-up form, confirmation email and both sites use
  them.
- **Site Creator** (chaseroush.thauma.one):
  - forms and widgets take the site's look via `data-look` (checked
    values; Raised bands swap card/panel);
  - initials tab icon (any alphabet; Croatian Lj/Nj/Dž), with Filled /
    Letters / Photo;
  - scroll hint: Scroll / Arrow / Mouse / None;
  - the footer has no name and no language menu, a tagline color choice,
    and Split / Columns fixed;
  - social handles accepted ("@name");
  - external links open new tabs;
  - videos sized to the screen.
- **Arcade:** four games built and gated off for live (`site.json`
  visibility.sections.arcade). ARCADE-SPEC.md is the spec; ideas are listed
  there.

## 5. Open questions waiting on Chase
- About page: fill "Who we are" from his Thauma team profile, or will he
  write it?
- Section backgrounds: site-wide band styles chosen in Design, picked per
  section (my recommendation)?
- Before the arcade goes public: scores are forgeable (the browser submits
  them); is that acceptable?
- The privacy policy page for Google OAuth: a draft outline was given
  2026-09-30 and Chase will review it. Not built. The cleanup the policy
  would describe (spam-log pruning on a schedule) was blocked by the
  classifier.

## 6. Memory notes to read

They live in `/home/chaseroushtech/.claude/projects/-DATA-AppData-thauma/memory/`.
A session started from /home/chaseroushtech does NOT load them by itself,
so read `MEMORY.md` there and the notes it lists. Especially:
- where-migrations-run
- one-database-decision
- run-both-test-folders
- concurrent-edits-rule
- public-api-sharing-rules
- languages-will-grow
- ux-not-words
- console-screenshots (how to see /staff and /admin locally despite
  Access)
- hidden-arcade-project
- pending-cloudflare-fixes
