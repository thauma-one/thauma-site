# Thauma & Chase Roush — architecture and direction

**Status:** living document. Last substantive update 2026-08-15, after the
production cutover, both consoles, and the content editor.
**Purpose:** continuity. If this work is picked up cold — by someone else, or
by the same people months later — this file should be enough to understand
what exists, why it is shaped this way, and what comes next.

Read `CLAUDE.md` for the public site's conventions. This file is the layer
above that: the two-site relationship, the ownership model, the data model,
and the migration in progress.

---

## 1. The two sites

| | Thauma | Chase Roush |
|---|---|---|
| what | the **organisation** — a US entity, 501(c)(3) in progress | a **ministry partner** of Thauma |
| repo | `thauma-one/thauma-site` | `chaseroushtech/chaseroush_missions` |
| stack | Eleventy 3, **Cloudflare Workers + D1**, multilingual | static HTML, Netlify, 30 functions, EN/HR |
| live | thauma.one (coming-soon gated, on Workers) | chaseroush.com (still Netlify) |
| dev | dev.thauma.one | dev.chaseroush.com |

**They are siblings, not one system.** Thauma will eventually operate as its
own entity with its own accounts, owned by the organisation rather than by
Chase personally. Changing Thauma must never change Chase Roush.

### The contract between them

The **only** link is a versioned HTTP API that Thauma publishes and CR
consumes **at build time**. Not shared repos, not shared code, not a shared
build.

**Built 2026-08-15: `GET /api/partner/v1/site`**, authenticated by a partner
API key. Returns public goal aggregates and public milestones. Nothing else,
ever — see §4a.

Build-time and not browser-side, for three reasons: an API key shipped to the
browser is public; CR must survive Thauma being down; and runtime fetching is
the exact flaw CR has today (`header-loader.js` pulls page titles from R2 on
every load, so headings pop in late).

Flow: Thauma content changes → Thauma pings CR's build hook → CR rebuilds and
deploys static HTML.

### Design relationship

Same grammar, different values. One type scale, ~3 radii, one easing curve,
tinted near-black grounds, `hi`/`dim`/`glow` accent families. Thauma is cool
(blue `#2FD8FF` / seafoam `#5CF2C4`); CR is warm. Each owns its own copy of
`tokens.css` — CR's is a copy, never an import.

CR's palette is **provisional** and documented as such in its own token file.
It took many rounds and is not settled; see `docs/` history and the reference
images Chase supplied. The rule extracted from those references: **red and
purple must never touch at the same weight** — they are reconciled either by a
gradient through magenta, or separated by a dark desaturated zone.

Do not port Thauma's specific flourishes (page wheel, numbered cues, meter)
onto CR. That vocabulary is production-console language and is costume on a
personal site.

---

## 2. Ownership model — read this before creating anything

**Thauma resources belong to Thauma accounts. This is a hard requirement,
not tidiness.** The organisation must be able to own its infrastructure
independently of Chase.

| | Thauma-owned? |
|---|---|
| GitHub `thauma-one` | ✅ |
| Netlify account "Thauma" (`admin@thauma.one`) | ✅ |
| **Cloudflare account** | ✅ **as of 2026-08-14** |
| **GitHub App** (content editor's credential) | ✅ **org-owned, not a personal token** |

The Cloudflare split was done on 2026-08-14. Before that, `thauma.one` lived
in Chase's personal account alongside his house, NAS and Plex.

**Why it mattered:** Cloudflare account-level resources — D1, R2, Workers,
Zero Trust organisations — **do not transfer between accounts**. Anything
built in the wrong account has to be rebuilt, not migrated. Doing the split
before building meant one migration instead of two.

Current state:

```
thauma.one       Thauma account   NS: cheryl/harvey     Zero Trust: thaumaone.cloudflareaccess.com
chaseroush.com   personal account NS: cleo/paige        Zero Trust: chaseroush.cloudflareaccess.com
```

Side benefit: a problem in one account no longer takes out the other.

**Mitigations still worth doing:** keep the domain registrar outside
Cloudflare, hardware key on both accounts, and take D1 exports off-platform.
The schema is portable SQLite precisely so that is cheap.

---

## 3. Where things are

### Live

```
thauma.one       the Worker, PROXIED       production — cut over 2026-08-15
next.thauma.one  the Worker                staging, same code, dev database
dev.thauma.one   the Pi tunnel             wrangler dev, local D1
chaseroush.com   Netlify                   untouched, migrates later
```

**Netlify no longer serves Thauma.** Its builds are stopped and its last
deploy is kept as the rollback. `…netlify.app/staff/` is still a public URL
with a stale staff page on it — archive the site once the rollback window
closes.

`main` is production: pushing there builds, tests, deploys and verifies via
`.github/workflows/deploy.yml`. There is no manual publish step. `dev` is the
working branch.

### The database

Nine migrations, applied to all three databases in order. **33 schema tests**
(`python3 db/test_schema.py`), which run every migration against a clean
SQLite and assert the guarantees below.

| migration | what it added |
|---|---|
| `0001_init` | partners, users, contacts, interactions, goals, audit |
| `0002_milestones` | the public roadmap |
| `0003_languages` | language catalogue + per-partner publishing + translations |
| `0004_settings` | `partners.default_lang` |
| `0005_directory_resources` | per-person address book, shared library with levels |
| `0006_roles` | `user_roles` — replaced the single-value `global_role` |
| `0007_partner_role` | the fourth role: **partner** |
| `0008_audit_survives_deletion` | audit entries outlive what they describe |
| `0009_audit_actor_is_an_address` | ...including the person, not just the partner |

```
thauma-ops       production   schema only, no real data yet
thauma-ops-dev   shared dev   seeded, scrubbed by db/refresh_dev.py
local            the Pi       .wrangler/state, reseeded from seed.dev.sql
```

### The Worker

One entry point, `workers/src/worker.js`. **286 tests** (`cd workers && npm test`).

| file | what |
|---|---|
| `lang-redirect.js` | geo language routing on `/` |
| `lib/access.js` | Cloudflare Access JWT, WebCrypto |
| `lib/db.js` | named queries, tenant scoping, the public allow-list |
| `lib/apikey.js` | partner API keys, SHA-256 |
| `lib/nopii.js` | the content gate on the public boundary |
| `lib/mail.js` | transactional email through Resend, and the invite |
| `staff-snapshot` (in worker.js) | dashboard/support/stewardship/activity |
| `staff-milestones.js` | the roadmap editor |
| `staff-settings.js` | account, languages, API keys |
| `staff-data.js` | directory (per person) + resources (per partner) |
| `admin.js` | organisation administration — the only UNSCOPED endpoint |
| `admin-content.js` | the site's own words and settings — the only endpoint that COMMITS |
| `admin-publish.js` | Preview and Publish — the only endpoint that DEPLOYS |
| `admin-actas.js` | start/stop viewing another person's console |
| `lib/actas.js` | who a request counts as, and the record of what was touched |
| `lib/github.js` | the Contents API, App authentication, UTF-8-safe base64 |
| `partner-api.js` | `/api/partner/v1/site` — the only public-facing key route |
| `contact-form.js`, `game-scores.js` | ported from Netlify |

### Two consoles

```
/staff/   eight pages — dashboard, support, stewardship, milestones,
          directory, resources, activity, settings. PARTNER-SCOPED: what one
          person sees of one ministry.

/admin/   seven pages — overview, people, partners, content, site, publish,
          activity. ORG-WIDE: accounts, roles, partner access, each partner's
          default language, the site's own words and settings, moving the
          working branch onto the live one, and the whole audit log.
```

They look different on purpose — amber accent, ADMINISTRATION wordmark, a
stripe above the header — because somebody who cannot tell which one they are
in will eventually do something org-wide believing it was local. Each links to
the other; the link INTO administration appears only for accounts holding the
role.

**Still not built:** the resource visibility picker and a board-facing view. `src/admin/` — Decap CMS — was deleted at the same time; it had been
inert since the cutover and was occupying the path.

---

## 4. The data model

`db/migrations/0001_init.sql`. Three decisions are enforced by the schema
rather than by convention, because all three are cheap now and painful later.

**1. Every tenant-owned row carries `partner_id NOT NULL.`** A query that
forgets to scope is a bug you can grep for, not a silent cross-tenant leak. A
trigger also forces an interaction's `partner_id` to match its contact's.

**2. No donor PII. Ever.** There is deliberately no `donations` table, no
amount on `contacts`, and no donor identity on `goal_snapshots` — only
`raised_cents`, `donor_count`, `source`, `captured_at`, pulled from the giving
platform. A partner reads their own donor detail by logging into that platform.
**Chase cannot see another partner's donor list because it is not here to
see** — a technical guarantee, not a policy promise. `test_schema.py` asserts
those columns are absent, so adding one fails the tests.

**3. Consent is per-purpose and per-partner.** Giving is not newsletter
consent. `newsletter_consent` has its own source and timestamp;
`postal_consent` is separate again. Croatia is in the EU, so those timestamps
are evidence.

### Derived, never stored

`contacts` has no `last_contacted` column on purpose. The `contact_touch` view
computes `last_contact_any` and `last_personal_contact` **separately**, and a
trigger makes it impossible to log a newsletter as personal contact.

This is the single most important behaviour in the system. The seed data
demonstrates why: Jordan Reyes was newslettered 13 days ago but has not been
personally contacted in 165. One `last_contacted` column would have shown 13
and hidden the problem entirely.

### Who owns what — added after the KV mistake

| | scope | why |
|---|---|---|
| `contacts` | partner | supporters belong to the partner, not a person |
| `directory_contacts` | **person** | somebody's own address book |
| `resources` | partner, or org-wide | a library, shared on purpose |
| `milestones` | partner | published to partner websites |

Directory and Resources lived in a **single KV entry** until 2026-08-15 — one
document for the whole installation, shared by every staff member of every
partner, saved whole on every change so two people editing on the same
afternoon meant the second erased the first. Both are now rows with owners,
and every write touches one of them.

### Languages are data, not columns

`0002` gave milestones `title` and `title_hr`, mirroring a bilingual partner
site. Thauma already had three languages and Serbian had nowhere to go.

```
languages           the ORGANISATION's catalogue. Admin-managed.
partner_languages   which of those a partner publishes.
milestone_translations   one row per milestone per language.
```

Adding a language is a row. Disabling one hides it from the **public API
only** — text already written stays, so a translation can be prepared before
it goes live, and switching one off is never destructive. A test asserts that.

### Roles — four, and a person may hold several

| role | what it means |
|---|---|
| **admin** | administers the organisation: accounts, roles, partner settings |
| **partner** | somebody Thauma SENDS. Granting it CREATES their ministry record |
| **staff** | helps with somebody else's ministry. No record of their own |
| **board** | board-level resources only. No supporter data, no administration |

`partner` and `staff` were one role until 0007, and the gap was invisible:
granting `staff` and waiting for a partner to appear did nothing, because
nothing in the system knew that was supposed to mean anything.

Revoking `partner` does **not** delete the ministry. Supporters, goals and
milestones live there; a toggle must never destroy them. Removing a partner is
a separate, deliberate act — see below.

`users.global_role` is **legacy**. Widening its CHECK meant rebuilding
`users`, which D1 refuses while seven tables reference it. Backfilled, never
read.

### Identity is not access

This cost real time and is easy to reintroduce.

```
user_by_email        WHO somebody is. Name, roles, language. No partner.
partners_for_user    WHICH partners they can reach. May return NONE.
```

They were one query, so a person with no partner had no identity — no name, no
roles, no way in. An administrator whose partner grant was removed could not
open the administration area, because the query meant to supply their roles
returned no rows.

**An account with no partner is ordinary.** An administrator does not need one.
A board member does not need one. Somebody invited and not yet placed does not
need one. Administration requires the admin ROLE; staff screens require a
partner and say which of the two is missing when there is not one.

### Deleting a partner

Destroys supporters, interactions, goals, milestones, translations, API keys,
resources and directories — by cascade, so nothing is orphaned and nothing is
recoverable. Guarded by typing DELETE, checked **on the server**, because a
dialog is only a suggestion. The confirmation counts what will go first: "4
supporters, 8 logged interactions" says something "this cannot be undone" does
not.

**`audit_log` deliberately has no foreign key to `partners`.** An entry saying
"somebody deleted partner p_chase" must go on saying it afterwards. A foreign
key enforces that a reference points at something CURRENT, which is the
opposite of what a historical record needs. `ON DELETE SET NULL` was tried
first and was refused by the append-only trigger — correctly, and the refusal
pointed at the better answer.

### Acting as somebody else

An administrator can open a partner's console to see exactly what they see —
the alternative to building this is asking for their password.

**The cookie is a request, not a credential.** `thauma_act_as` names a user id
and grants nothing. Every request still carries a Cloudflare Access JWT, that
JWT is still verified, and the REAL caller is looked up and checked for the
admin role *before* the cookie is read. A staff member who sets it by hand gets
exactly their own data, so there is nothing to sign and no session to store —
the worst a forged cookie achieves is being ignored.

Everything falls back to the caller's own identity when anything is off: not an
admin, no such person, suspended. Failing back to yourself is the only safe
direction; the opposite failure is an administrator silently editing the wrong
person's ministry.

**Three signals at once**, for the same reason the admin area has three: a band
across the top naming whose account it is, a border round the whole viewport,
and a fixed watermark. Chase's first instinct was a flashing banner — that is a
photosensitivity hazard, and self-defeating, because a thing that blinks becomes
background while a thing that is always there is a thing you are looking at.

**Audited in three places.** Start and stop, by the endpoint; and every request
that CHANGES something, by `auditActingWrite` at the single point every method
passes through — a per-handler approach has to be remembered by whoever writes
the next handler, and eventually is not. Reads are deliberately not logged per
request: a page load is a dozen of them, and a log that records every one hides
the writes that matter. The audit row names the ADMINISTRATOR, never the person
being acted as; a row naming the target would say a partner did something they
did not do.

### The audit log references nothing, and that took two migrations

`audit_log.partner_id` lost its foreign key in 0008. `user_id` lost its in
0009, and the note in 0008 predicted exactly that: *"if that ever becomes a
problem, it wants the same treatment and the same reasoning."*

It became a problem twice on 2026-08-16, and the symptoms looked unrelated:

- **Removing a person failed.** Deleting a user whose id appeared in the log
  was refused by the key, so the endpoint 500'd and the person stayed.
- **Every audit write had been failing, silently.** Handlers pass the address
  Access supplies; an email is not a `users.id`, so each insert violated the
  same key. `audit()` catches and logs rather than failing the action it
  describes — right, and the reason this only ever appeared in `wrangler tail`.

So the log had been recording nothing at all while acting-as, the feature it
exists to make accountable, was built on top of it.

**The column now holds an email address on purpose.** `u_a7f31c` means nothing
once that row is deleted — which is the precise case that produced the
migration — while `chase@thauma.one` still says who it was. It is also the only
identifier the identity provider ever supplies. The readers join on email and
`COALESCE` to the stored value, so a deleted person still shows as somebody
rather than as a blank.

### Access control

Two independent layers. `users.global_role` is org authority (`admin`/`staff`);
`partner_users.role` is a per-partner grant (`owner`/`assist`/`view`). **An
admin is not automatically entitled to read a partner's contacts.**
`audit_log` is append-only, enforced by triggers on UPDATE and DELETE.

**Email is the join between the identity provider and the database.**
`partners_for_user` looks a person up by `users.email`, not by `users.id`.
Cloudflare Access — and any SAML/OIDC provider that replaces it — hands over an
email address and nothing else; `u_chase` is an internal id no IdP has ever
heard of. The query was originally keyed on the id, which meant every
authenticated request returned 403; caught on 2026-08-15 when the console was
first pointed at live data. The lookup also requires `users.status = 'active'`,
so revoking someone is one column update rather than a hunt through
`partner_users`.

Whoever holds the credentials can read the database — no schema prevents that.
What a schema can do is make access deliberate, logged, and visible to the
partner whose data it is.

---

## 4a. The public boundary — read before adding any endpoint

Two APIs. They authenticate different things, and they must never merge.

| | staff console | partner API |
|---|---|---|
| route | `/api/staff-*` | `/api/partner/v1/site` |
| authenticates | a **person**, via Cloudflare Access | a **build**, via an API key |
| audience | staff, signed in | chaseroush.com's CI |
| may return | that partner's operational data | only what is safe on a public page |

A build has no browser and nobody to click a login, so it cannot use Access. A
public site's credential must therefore be one that unlocks almost nothing —
which is the whole design.

### The three guarantees, enforced rather than promised

1. **`PUBLIC_QUERIES` is an allow-list.** The partner API may run exactly two
   queries. A query added tomorrow is private until somebody deliberately adds
   it to that set. A deny-list would have silently exposed every future query.
2. **`assertPublicSafe()` proves the public queries cannot reach private
   tables.** It greps their SQL for `contacts`, `interactions`, `users`,
   `audit_log`, `api_keys`, and for a missing `is_public = 1` or `:partner_id`.
   It runs in the test suite **and at Worker startup**, so a bad deploy fails
   at boot rather than serving supporter records to a website.
3. **`partnerPublicSite()` names every field it returns.** It does not spread
   database rows. Adding a column to `milestones` does not publish it; someone
   has to write it down. The private endpoint fails toward showing too much,
   the public one toward showing too little.

Keys are **SHA-256 hashed** in `api_keys`; the raw key is printed once by
`db/mint_api_key.py` and never stored. `?key=` in a query string is refused —
query strings reach access logs, browser history and `Referer` headers. The
partner id comes from the key, never from the request.

### ⚠️ "Timeline" means two opposite things

| | what it is | publishable |
|---|---|---|
| **milestones** | public ministry roadmap — trips, training, support raising | yes, that is its purpose |
| **interactions** | private stewardship history — who was called and the note about it | **never** |

They share a word and nothing else. The partner API never uses the word
"timeline", and the public table is named `milestones`, so "expose the
timeline" cannot be resolved to the wrong table by someone moving quickly.
This is the single most dangerous ambiguity in the system.

### The fourth gate: content, not shape

The three guarantees above all constrain the **shape** of a response.
`milestones.description` is free text a human types, and no shape rule stops
somebody pasting a supporter's address into it.

`workers/src/lib/nopii.js` walks the assembled payload and refuses it — 500,
publishing nothing — if any field NAME looks personal at any depth, or if any
string VALUE contains an email address. A build breaking is a bad afternoon; a
supporter's address on a public page is scraped, cached and indexed before
anyone notices.

Phone numbers are deliberately **not** value-matched: every pattern loose
enough to catch `+1 816 555 0142` also catches dates, amounts and percentages,
and a guard that cries wolf gets switched off.

`ALLOWED_EXACT` is the only way a name-matching field passes, and every entry
carries its reason. It currently holds two, and a test fails if it grows past
four:

- `display_name` — the partner's own published identity, not a supporter's.
- `donor_count` — an aggregate. `donor` stays forbidden, so `donor_name` and
  `donor_email` are still refused. **This entry exists because the guard
  caught the real payload on first run** — which is the mechanism working.

### Planned: embeddable widgets — and what they change

Not built, deliberately deferred. Recorded because it constrains decisions
being made now.

The intent is embeddable **timeline** and **goal card** widgets a partner can
drop onto their own site. Essentially CR's admin timeline plus presentation
controls, served over the API, with a visualiser in the console showing the
result before it is published.

**IT MUST LOOK LIKE THE SITE IT IS EMBEDDED IN.** This is a requirement, not a
nicety, and it is the reason the widget cannot simply be an iframe of a Thauma
page. A partner's site is warm where Thauma is cool; a widget carrying Thauma's
palette onto chaseroush.com would read as a foreign object. Chase has raised it
twice — it is recorded here so it survives whoever picks the work up.

Configured per-milestone in the console:

| control | why |
|---|---|
| **colour scheme** | the whole point — it has to match the host site |
| background on/off | some hosts have their own section background |
| milestone line colour | the strongest single accent in the timeline |
| shimmer on/off | motion is a taste decision, and a `prefers-reduced-motion` one |
| default currency | a goal card reads differently in $ and € |
| start date | which part of a long roadmap the widget opens on |

**This changes the threat model, so build it deliberately.** Today's partner
API is consumed by a *build*, server-side, with a key that never reaches a
browser. An embed is consumed by a *browser*, on someone else's page, and its
credential is public by construction.

Consequences to design for when the time comes:

- **A second key tier.** An embed key is public and must be treated as such —
  scoped to one partner, read-only, rate-limited, revocable, and never the
  same credential as a build key. Do not widen `read:public`; add a scope.
- **CORS becomes necessary**, which today's endpoint deliberately omits. That
  is a real loosening and should apply to the embed route only, never to
  `/api/partner/v1/site`.
- **Presentation config belongs on the milestone**, which is why `milestones`
  has room for it — add a `display_config` JSON column in a later migration
  rather than a parallel table.
- **Store the config SERVER-side, do not read it from the script tag.** Passing
  colours as `data-` attributes on the embed snippet looks simpler and means
  the visualiser and the live widget are two implementations of the same
  styling that will drift. It also means changing a colour is an edit to
  somebody else's website rather than a save in the console. The snippet should
  carry an id and nothing else.
- The `nopii` gate applies to embed responses too. It is not optional there;
  it is more important.

### The other boundary: writing to the repository

`/api/admin/content` and `/api/admin/publish` are the only endpoints that hold
a **GitHub credential**. A save is a commit; a publish moves the live branch
and the Action deploys it. Every other handler's worst case is showing the
wrong data to somebody already signed in; these two can change the site.

**The credential is a GitHub App owned by the organisation, not a personal
access token.** A fine-grained PAT is owned by a human and acts as them, so the
content pipeline would hang off one individual — which §2 rules out. An App
belongs to `thauma-one`; nobody's departure touches it, and its installation
tokens are minted on demand and last an hour, so there is no expiry date on
which the editor quietly stops working. A PAT is still accepted (a machine
account holding one is a legitimate simpler answer) and the App wins when both
are set.

Four things follow, and each has a test:

1. **The admin role, checked first, failing closed** — the same gate as
   `admin.js`, and it runs before GitHub is contacted at all.
2. **The path is never taken from the request.** The client sends a short key
   (`en`, `site`); the server derives the path from it. There is no input that
   reaches a path, so there is nothing to traverse — `../../.github/workflows/`
   is simply not a language code.
3. **The client sends leaf edits, not a document.** `home.title` → new value.
   The server re-reads the file and applies each one in place, so keys cannot
   be added, removed, reordered or retyped however the browser behaves.
   Structural change stays a git operation, because a CMS that can restructure
   the data its own build depends on can break the build. It also keeps the
   diff to one line per edited string.
4. **Saving is not publishing.** Every content commit carries `[skip ci]`, so
   it lands on the site's branch and no workflow runs. Preview and Publish then
   ask for a build explicitly, through `workflow_dispatch`, which is not a push
   and is unaffected by the marker. Writing to the live branch is therefore not
   the same as writing to the live site, and that is what makes one branch
   safe.

### Save, Preview, Publish — and no branch a person can see

The console shows three words and never the word "branch":

```
Save      commits to the site's branch with [skip ci]. Nothing deploys.
Preview   dispatches the staging workflow against that branch.
Publish   dispatches the production workflow. The site changes.
```

**This replaced a two-branch promote model on 2026-08-16, one day after it was
built.** Branches and merges are how teams ship CODE; what is being shipped
here is sentences, and the machinery cost more than it protected for a
single-operator org. The design it moved to is a git-backed CMS — git as the
database, one branch, publish means "run the build" — which is what Decap,
Tina and most of the static-site world do.

`dev` still exists, for code. It is nobody's business but the developer's, and
`.github/workflows/sync-dev.yml` keeps it current with `main` so content edits
made on the website cannot be lost under a later code merge.

**"What is not yet published" comes from the DEPLOY, not the branch.** A branch
does not record which of its commits is live, so the only honest answer is "the
last successful production run built commit X". A failed deploy therefore
correctly leaves the work still showing as unpublished.

The page lists the changes and the files, and names any **database migrations**
separately and above the button — that is the one warning about something the
deploy will not fix by itself. Publishing takes the word `PUBLISH` typed out
and checked on the server.

⚠ **`btoa` is wrong for these files.** It throws above U+00FF and `atob`
returns one byte per character — and every file this endpoint moves is Croatian
or Serbian. It does not fail loudly; it mangles multi-byte characters into
mojibake, commits them, and deploys them. `lib/github.js` encodes through
`TextEncoder`/`TextDecoder`, with round-trip tests for Cyrillic and for an
emoji, because an English test cannot catch this.

### Data minimisation is not automatic

Found 2026-08-15: `contacts_stewardship` selected `email` and `phone`, and the
stewardship table rendered **neither**. Every console load shipped a partner's
whole contact list to draw a column of dates. Behind Access, so not a breach —
but a payload is what ends up in a log, an extension or a screenshot, and
"we sent it but drew it invisibly" is not minimisation. Both columns removed;
a test asserts they stay gone. If a screen needs to contact someone, add a
`contact_detail` query returning **one** person by id.

---

### Which pages the public can see — two columns, not one

`site.json`'s `visibility` block gives every page and section **two** values:

```
live   what visitors get
dev    what dev.thauma.one shows
```

`src/_data/visible.js` picks the column from `ELEVENTY_RUN_MODE` — the Pi's
watch output uses `dev`, both real builds use `live`. **next.thauma.one uses
the LIVE column deliberately**: it exists to show what is about to be
published, and a preview built from the dev column would show something no
visitor will ever see.

**One flag could not do this job.** Turning Events off has to hide it from
visitors and NOT hide it from whoever is building the Events page. That was
handled by scattering `or not env.isProduction` through the templates, which
meant the dev site could never be made to *look* like the live one — you could
hide a page and then had no way to check the result. The dev column defaults to
showing everything and can be flipped per switch to simulate.

Turning a page off means **not building it** (`permalink: false`), not hiding
it with CSS. An unlinked page is still reachable, still crawlable and still in
the sitemap.

⚠ **`require()` caches JSON, and `eleventy --watch` never restarts.** Measured
2026-08-16: flipping a switch rebuilt every page and changed nothing, because
the data files read `site.json` with `require`. They use `fs.readFileSync` now,
and `test/visibility.test.mjs` has a regression test — a build succeeding is
not evidence it read the file.

Separately: Eleventy never deletes a page it has stopped generating, so the
Pi's `_site` keeps stale HTML after a page is switched off.
`deploy/git-sync.sh` clears it when `site.json` changes.

---

## 4b. Email

Two kinds, and they must never share a sending domain.

| | transactional | bulk |
|---|---|---|
| what | invites, confirmations, alerts | newsletters |
| sender | `mail.thauma.one` | `news.thauma.one` (not built) |
| if it fails | somebody cannot sign in | somebody misses an update |

**One person marking a newsletter as junk must not degrade the reputation that
delivers an account invite.** That is the whole reason for the split, and it is
why `MAIL_FROM` is a separate variable from any future bulk sender rather than
a convenient shared one.

### `lib/mail.js` — and why it looks like 2004

Outlook on Windows renders mail with **Microsoft Word's** layout engine. No
flexbox, no grid, no CSS variables, no external stylesheet — and Gmail strips a
`<style>` block in `<head>`, so anything defined there is simply gone. So:
tables for layout, inline styles on every element, 600px maximum, websafe fonts
only, no background images.

Modern markup renders beautifully in whichever client the developer happens to
use and breaks for a large minority of everyone else. `mail.test.mjs` asserts
these properties structurally, because email is the one thing here that cannot
be checked by looking at it.

**Every send carries a plain-text part.** HTML-only is a real spam signal, and
some people genuinely read mail as text.

### The invite is honest about the two doors

A row in `users` is not an account: Cloudflare Access must also allow the
address, which is a separate act in a separate dashboard. So the invite says
what to do if they are turned away, and names who to ask — an invite that says
"you're all set" and then bounces somebody generates a support message every
single time.

The link is built from the **request's own origin**, so an invite sent from
staging points at staging. A hard-coded site URL is how a test invite tells
somebody to sign in to the live site.

A failed send does not fail the account creation that triggered it. The account
is the real thing; the email is a convenience, and "created, but the invite
could not be sent" is a state an administrator can act on — hence
`resend_invite`.

### Not built, and what it will need

Newsletters. When they come:

- **Resend Broadcasts may remove most of the work** for Thauma's own list —
  a no-code editor, audiences, automatic unsubscribe flows, scheduling. Checked
  2026-08-16.
- **It cannot express this system's multi-tenancy.** Resend API keys are
  `full_access` or `sending_access` and scope only by DOMAIN — not by audience,
  segment or topic. A key that can manage contacts manages *every* partner's.
  And `unsubscribed` is documented as global to the contact, so one partner's
  unsubscribe could silently remove somebody from another partner's list.
- **Therefore D1 stays the source of truth** and Resend is delivery. Consent
  evidence (`newsletter_consent`, with source and timestamp) has to live where
  partner scoping is already enforced in SQL.
- **Topics** are Resend's mechanism for letting a recipient choose which sender
  they hear from — the right fit for Thauma vs each partner.
- **Double opt-in is not something Resend does.** It needs a `pending` state and
  a confirm token: one migration.
- Gmail and Yahoo require `List-Unsubscribe`, one-click unsubscribe, and DMARC
  for bulk senders. **thauma.one has no DMARC record at all** as of 2026-08-16,
  and its SPF authorises only Cloudflare's forwarder.

### thauma.one cannot receive mail into a mailbox

MX points at Cloudflare Email Routing, which **forwards only** — there is no
IMAP or SMTP behind `admin@thauma.one`. A guide to setting up Outlook or Mail
cannot be written until real mailboxes exist somewhere (Google Workspace,
Microsoft 365, Fastmail). That is a purchasing decision, not a code one.

---

## 5. Authentication

**Cloudflare Access**, replacing Netlify Identity (done 2026-08-14).

Access gates the hostname/path at the edge and passes a signed JWT. The
function **verifies that JWT itself** rather than trusting the edge, because
the Access application is scoped to `/staff*` while functions are served from
`/.netlify/functions/*` — outside that path. Measured, not assumed:

```
/staff/                        302  gated
/.netlify/functions/staff-data 401  NOT gated
```

The token is accepted from either the `Cf-Access-Jwt-Assertion` header or the
`CF_Authorization` cookie, so it works regardless of how the app is scoped
later. Checks signature, `exp`, `nbf`, `iss` and `aud`. **The `aud` check is
the one people skip** — without it, a valid token for any other Access
application in any org would be accepted.

`requireAccess` fails closed: missing config returns 500, never open.

**Both consoles are gated identically, by one list.** `isProtected()` in
`worker.js` is the only definition of which paths need a person, and two tests
compare the two areas' actual behaviour rather than trusting the source to stay
symmetrical. This is not redundant with the Access application — on 2026-08-16
that application covered `staff` and not `admin`, and this check is why
`/admin/` was refused rather than served to anyone who asked.

⚠ **Never widen an Access application to a bare hostname on production.** It
would gate the entire public site. Add the path; do not remove it.

**MFA is not in place.** One-time PIN sends a code to an email address, which
is a single factor. Real MFA means federating Access to an identity provider
that enforces it and requiring that login method in the policy — the same
decision as buying mailboxes, since thauma.one currently has none (§4b).

**Roles live in the database, not in Access.** Access answers *who is this*;
`partners_for_user` answers *what may they touch*, and `user_roles` answers
*what authority do they hold*. Every handler resolves all three before doing
anything. **Do not reintroduce a role list in an env var** — the schema models
it, and an env var cannot be audited.

The identity a handler gets is an **email address and nothing more**. Names
come from `users.name`; Access frequently carries no name at all, which is why
the console shows its own record and treats Access as a fallback.

Longer term, Access federates to SAML/OIDC, so UniFi Identity Enterprise could
be the IdP and Ubiquiti Verify the MFA. Access is for *the team*; if
supporters ever need accounts, that is app-level auth and a different problem.

---

## 6. The migration — done 2026-08-15

thauma.one runs on Cloudflare Workers. What is left is listed in
`docs/MIGRATION-RUNBOOK.md`; the summary:

| Netlify dependency | replacement | state |
|---|---|---|
| Netlify Identity | Cloudflare Access | done |
| Netlify Functions | one Worker, one router | done |
| Netlify Blobs | D1 | done — see §4 |
| Netlify Forms | `contact-form.js` + Resend | done |
| Edge function (geo language) | `lang-redirect.js` | done |
| build on push | GitHub Actions — `main` deploys; staging and sync are their own workflows | done |
| **Git Gateway (Decap CMS)** | **custom editor** | **built 2026-08-15 — needs its token** |

Site copy is editable through `/admin/content/` and `/admin/site/`, which
commit to the repository rather than writing to D1. **The editor needs a
GitHub token before it can do anything** — see the runbook. Until one is set it
loads and says it is not connected, which is the correct state rather than a
failure.

### Two things that cost real time, worth remembering

**A migration can pass on local SQLite and fail on D1.** `0006` was first
written as a table rebuild, which worked via `executescript` and was refused
by D1 with a foreign-key error — because `PRAGMA foreign_keys = OFF` is
ignored inside a transaction, and D1 wraps a migration file in one. Test both.

**Order matters inside a migration.** A trigger or foreign key naming a table
being rebuilt is validated mid-swap and fails. `0003` carries the working
order in its comments.

### Chase Roush migrates later

Audited in `docs/WORKERS-AUDIT.md` (CR repo): the only Node built-in used
across all 30 functions is `crypto`, there is no Identity coupling, and the
recommendation is one adapter presenting the Netlify handler interface over a
Workers `fetch`. The genuinely uncertain part is `_redirects`, not the
functions.

---

## 7. Giving — buy, don't build

Donation records live in the giving platform (Donorbox or similar). Thauma
stores **aggregates only**: goal, raised, donor count, captured-at, pulled from
the platform's API.

Staff see their own donor detail by logging into that platform directly. This
is the correct legal posture, it saves building a donor CRM, and it is the
honest answer to "I don't want access to their data" — it isn't in the
database.

**Open and important:** designated giving to a named individual is a
compliance surface. A dashboard reading *"Chase's goal: $18,000"* describes
something that, framed that way, may not be legal — what is legal is a
*ministry fund* over which the org retains discretion and control. The copy is
part of the compliance, not decoration. Chase is handling the legal side
separately; do not invent wording.

**Unverified:** whether Donorbox scopes donors per staff member. If all
partners share one account they can see each other's donors — that is the
single most important thing to test before committing to a platform.

---

## 8. Local development (the Raspberry Pi)

```
/DATA/AppData/thauma              Thauma repo, branch dev  → dev.thauma.one
~/projects/chaseroush_missions    CR repo, branch dev      → dev.chaseroush.com
```

| service | what | scope |
|---|---|---|
| `thauma-dev` | `eleventy --watch` + `wrangler dev --env dev` (+socat 8992) | system |
| `cloudflared-thauma-dev` | tunnel | system |
| `chaseroush-dev` | `netlify dev --port 8993` | **user** |
| `cloudflared-chaseroush-dev` | tunnel | **user** |

The unit lives in `deploy/thauma-dev.service`, version-controlled rather than
only in `/etc`.

### Gotchas, in the order they will bite

- **`wrangler` is pinned EXACTLY to 4.86.0.** 4.123+ needs Node 22; this Pi
  has Node 20, and the newer wrangler refuses to start. A caret range would
  break local dev on a routine `npm install`, with an error about Node that
  looks unrelated to whatever you were doing.
- **`wrangler dev` needs `--env dev`**, which serves `_site` and simulates D1
  and KV locally. Seed it once from `db/seed.dev.sql`. This is a **third**
  database; Node 22 + wrangler ≥ 4.123 would collapse it back to two.
- **`wrangler dev --remote` is not usable here.** It runs the Worker on
  Cloudflare's edge under *next.thauma.one's* Access application, so a browser
  that already passed dev.thauma.one's Access gets bounced to a second login.
- **`eleventy --watch`, never `--serve`,** in the dev service. `--watch` keeps
  `ELEVENTY_RUN_MODE` at a value `src/_data/env.js` treats as a dev server, so
  the comingSoon gate stays off. A bare build sets it to `build` and silently
  serves the gated site.
- **Three build directories, and mixing them publishes the wrong thing.**
  `_site` is the dev server's ungated watch output, `_site_next` staging,
  `_site_prod` production. Production pointed at `_site` once; it would have
  published every unreleased page.
- **Split-horizon DNS.** Pi-hole resolves several hostnames to LAN IPs, so
  testing from the Pi does not exercise the public path. Use `curl --resolve`.
- **Pi-hole caches negative DNS for 30 minutes.** Create a record *before*
  querying it, or `docker exec Roushhouse-PiHole pihole reloaddns`.
- **Secrets in systemd `Environment=`** are expanded into the command line and
  visible in `ps`. Use `EnvironmentFile=` *and* have the program read the
  variable itself.
- **`wrangler tail thauma`** shows Worker errors. An uncaught exception
  becomes a Cloudflare HTML 500, which a page reports as "a reply this page
  could not read" — the message will not name the variable.

---

## 8a. The console — conventions worth keeping

Decisions made across the milestone editor and Settings. They are not
preferences; each was arrived at by getting it wrong first.

### Two save models, chosen per screen

**Milestones holds a working copy.** `saved` is the last server response,
`draft` is what the screen shows, and a row is unsaved when they differ.
Nothing reaches the database until Save. A sticky bar appears only when
something is unsaved, unsaved rows carry a coloured edge, and leaving the page
warns. Publishing is a decision somebody should be able to change their mind
about before it is live.

**Settings saves immediately.** Each control is one decision with an obvious
result, and a working copy would be ceremony around flipping a switch. The
cost is a moment where the screen could lead the database, so every control
disables while its request is in flight and the page reloads from the server
afterwards.

Do not unify these. The difference is the point.

### Errors say which failure happened

One try/catch around a fetch AND its rendering reports a render bug as a
network failure. That happened, said "cannot reach the server" for two rounds,
and hid a real crash. Three paths, three messages:

```
the request never completed  -> the network, with a retry
the server answered an error -> the status and its message
the page failed to draw      -> "this page failed to display", plus console
```

The third is the one that matters — it cannot be mistaken for a connection
problem, so it does not send anyone looking in the wrong place.

### Toasts for events, a pinned message for conditions

Bottom-centre toasts announce outcomes. Progress messages are not announced —
a "Saving…" toast is replaced by its own result and carries nothing the
disabled control did not. Errors do not auto-dismiss.

"Cannot reach the server" is a **condition**, so it is one message pinned top
centre that clears when a request succeeds, not a toast stacking copies of
itself.

### Translation

`staff-i18n.js` translates the interface in the browser, keyed on the
account's language and cached per tab. Everything user-visible needs a key,
including **placeholders, aria-labels and titles** — a text box is not
translated because its label is. Strings built in JavaScript need one too.

A missing key returns null and the sweep leaves the element alone, so a gap
degrades to the original English rather than printing `page.directory.heading`
on the screen. Identifiers — `audit_log`, `THAUMA_API_KEY`, query paths — are
deliberately **not** translated: they are things you type, not things you read.

### Who is who, in the header

The pill is the **signed-in person**, from `users.name`. Beside it is their
role. Each fact appears once, and only `paintIdentity()` writes the pill —
`renderSnapshot()` used to overwrite it with the partner's name a moment after
load, on the four pages that fetch a snapshot.

Which partner's records are on screen is named **on the page**, where there is
room to label it. A bare name in a corner cannot carry that distinction.

The identity cache is `sessionStorage`, not `localStorage`: it exists to stop
a flash while navigating within one session, and on a shared machine
`localStorage` would show the previous person's name to the next one.

### Confirming something irreversible

`window.StaffConfirm()` — a real dialog, because `window.confirm` cannot say
more than a sentence, cannot mark which button is dangerous, and looks like the
browser rather than the application.

- The **consequence** is stated, not "are you sure": *Administration reaches
  every partner's settings.* *Partner builds a record with its own supporters.*
- Focus lands on **Cancel**. A dialog that opens with the destructive button
  focused turns a stray Enter into the thing it was asking about.
- `type: 'DELETE'` adds a type-to-confirm field and keeps the button disabled
  until it matches — and the server checks the same word.

### `hidden` loses to `display`

Any element that sets `display` needs an explicit `[hidden]{display:none}`.
Hiding a `display:flex` column left its fields on screen.

---

## 9. Open decisions and what is next

### Next, in order

1. **Create the GitHub App and verify the editor.** Phase 3 is built and
   tested; the one thing it cannot have without a person is its credential.
   An App owned by `thauma-one` with Contents AND Actions: read and write —
   not a personal token, for the reason in §2. Full steps in the runbook, Phase 3, including
   the PKCS#1 → PKCS#8 conversion and the one surprising check: **confirm the
   App's commit actually triggers the deploy workflow.**

2. **A board view.** `board` currently grants board-marked resources and
   nothing else, so a board member with no partner signs in to an empty
   console. What they should see — org-wide goal totals, the roadmap, and
   explicitly NOT supporters — is a governance decision, not a technical one.
3. **Resource visibility picker.** The levels work server-side; nothing sets
   them.
4. **Timeline visualiser**, then **goal cards**.
5. **The embed** last, deliberately: it is the one that puts a credential in a
   browser. See §4a.

### Open

| decision | notes |
|---|---|
| **Node 22 on the Pi** | would remove the third database and let dev bind to the real dev D1. Deferred because it moves Chase Roush's toolchain too, and the sites are meant to be independent. |
| **CR palette** | provisional, ~8 rounds without resolution |
| **Giving platform** | leaning Donorbox; per-staff donor scoping still untested |
| **CR migration timing** | agreed in principle, not scheduled |
| **Translations** | written by an assistant, not a speaker. Structurally correct, good enough to prove the mechanism, and wanting a real pass before anyone relies on them. |
| **Untranslated-string CI check** | offered, not built. Today's sweep decays otherwise. |

### Housekeeping

- **Archive the Netlify site** once the rollback window closes.
  `…netlify.app/staff/` is a public URL with a stale staff page on it.
- **`www` deep-link redirect rule** — `www.thauma.one/en/` serves rather than
  redirecting, because `run_worker_first` is an allow-list and `/en/` is not
  on it. A Cloudflare Redirect Rule fixes it without routing every asset
  through the Worker.

---

## 10. Conventions

- Forward-only numbered migrations. Never edit an applied one.
- Money is **INTEGER cents**. Never a float.
- Timestamps ISO-8601 UTC; dates `YYYY-MM-DD`.
- Enums are TEXT + CHECK — SQLite has no native enum.
- Queries live as literal SQL in `db/queries.sql`, parsed by name. No ORM, so
  swapping database drivers never touches the interface.
- The UI is built against **query output**, not fixtures.
- Work on `dev`. **`main` is production**: pushing there builds, tests and
  deploys automatically via `.github/workflows/deploy.yml`. Merge to it
  deliberately — there is no confirmation step and no manual publish.
