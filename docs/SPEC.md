# Thauma & Chase Roush — architecture and direction

**Status:** living document. Last substantive update 2026-08-15 (overnight
port session).
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
| stack | Eleventy 3, Netlify, trilingual EN/HR/SR | static HTML, Netlify, 30 functions, EN/HR |
| live | thauma.one (coming-soon gated) | chaseroush.com |
| dev | dev.thauma.one | dev.chaseroush.com |

**They are siblings, not one system.** Thauma will eventually operate as its
own entity with its own accounts, owned by the organisation rather than by
Chase personally. Changing Thauma must never change Chase Roush.

### The contract between them

The **only** link is a versioned HTTP API that Thauma publishes and CR
consumes **at build time**. Not shared repos, not shared code, not a shared
build.

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

### Live and working

- **dev.thauma.one** — Eleventy dev server on :8991 via a tunnel in the
  Thauma account (`thauma-dev`, `31c1630c…`). `/staff*` is gated by
  Cloudflare Access; `/en/` is deliberately open so the site can be shown
  without handing out logins.
- **dev.chaseroush.com** — `netlify dev --offline` on :8993 via
  `chaseroush-dev` in the personal account, fully gated by Access. Runs with
  live Netlify env, so it behaves like production including the admin.
- Both survive reboot (systemd; CR's are **user** units + `loginctl
  enable-linger`, Thauma's are system units).

### Built, not yet live

- **`db/`** — the operations schema. 10 tables, 2 views, 5 triggers,
  14 passing tests (`python3 db/test_schema.py`).
- **`/staff/`** — the staff console, now **a page per section** sharing
  `layouts/staff.njk`: dashboard, support, stewardship, directory, resources,
  activity. Directory and Resources are live against `staff-data.js`; the
  other four render `src/staff/data/snapshot.json`. Badged on screen so the
  distinction is visible. One script serves all six and loads only what each
  page needs.
- **`netlify/functions/_shared/access.js`** — Cloudflare Access JWT
  verification, 15 passing tests.
- **`workers/`** — the Cloudflare Workers port. **Nothing is wired up**; these
  are new files alongside the working Netlify ones.

| file | what | tests |
|---|---|---|
| `workers/src/lang-redirect.js` | geo language routing | 17 |
| `workers/src/lib/access.js` | Access JWT via WebCrypto | 16 |
| `workers/src/game-scores.js` + `staff-data.js` | ported functions, KV-backed | 23 |
| `workers/src/contact-form.js` | Netlify Forms replacement | 16 |
| `workers/src/lib/db.js` | D1 query layer | 18 |

Run with `cd workers && npm test` — **90 tests**.

- **`docs/MIGRATION-RUNBOOK.md`** — ordered, checkable migration phases with
  rollback points. **Read its warning before merging `dev` to `main`.**
- **`docs/WORKERS-AUDIT.md`** (in the CR repo) — all 30 CR functions audited
  for Workers compatibility.

### ⚠️ Known-open

**Production `thauma.one/staff/` is NOT gated by Access** — the application
covers `dev.thauma.one/staff*` only. Harmless today, because `main` is 90+
commits behind and serves a page whose backing function 404s. **It stops being
harmless the moment `dev` merges to `main`.** A second Access application for
`thauma.one/staff*` is required first. See the runbook.

### Known-blocked

`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are **not yet set** on the Netlify site,
so `staff-data.js` returns 500 (fails closed). Directory and Resources will
not work until they are:

```
ACCESS_TEAM_DOMAIN = thaumaone.cloudflareaccess.com
ACCESS_AUD         = 04468ad531e25f3c53af5d0b4ed0bdd3073241f76a070c741efe40f58019fdfb
```

Then `sudo systemctl restart thauma-dev` — `netlify dev` reads env at startup.

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

### Access control

Two independent layers. `users.global_role` is org authority (`admin`/`staff`);
`partner_users.role` is a per-partner grant (`owner`/`assist`/`view`). **An
admin is not automatically entitled to read a partner's contacts.**
`audit_log` is append-only, enforced by triggers on UPDATE and DELETE.

Whoever holds the credentials can read the database — no schema prevents that.
What a schema can do is make access deliberate, logged, and visible to the
partner whose data it is.

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

**Roles are currently absent.** Access has no equivalent of the old
staff/admin roles, so for now the Access policy *is* the gate. When
`users`/`partner_users` go live, look the email up there. **Do not
reintroduce a role list in an env var** — the schema already models it.

Longer term, Access federates to SAML/OIDC, so UniFi Identity Enterprise could
be the IdP and Ubiquiti Verify the MFA. Access is for *the team*; if
supporters ever need accounts, that is app-level auth and a different problem.

---

## 6. The migration: Netlify → Cloudflare Workers

**Decided 2026-08-14.** Target is **Workers with static assets**, not Pages —
Cloudflare now steers new projects to Workers and directs all investment there.

Cost is not a factor: hosting is $0 with unmetered static bandwidth, D1's free
tier is ~1000× what this needs. **The cost is migration effort and risk.**

### What breaks, and its replacement

| Netlify dependency | replacement | status |
|---|---|---|
| Netlify Identity | Cloudflare Access | ✅ done |
| Git Gateway (Decap CMS) | custom admin | planned — dies with Identity |
| Netlify Blobs | D1 or KV | to do |
| Netlify Forms (contact page) | Worker handler + Resend | to do |
| Edge function (geo language) | Worker using `request.cf.country` | to do |

Full step-by-step in **`docs/MIGRATION-RUNBOOK.md`**. Summary:

### Order

1. **Access** in front of `/staff/` — done, on Netlify, before anything moved.
2. **D1** in the Thauma account; wire the console's four prototype sections.
3. **Custom admin** replacing Decap.
4. **Hosting → Workers**, last, when it is just hosting + edge function + form
   handler.

Removing the hard dependencies one at a time, rather than all at once during a
hosting move.

**Chase Roush migrates later, separately.** Audited in
`docs/WORKERS-AUDIT.md` (CR repo): the only Node built-in used across all 30
functions is `crypto`, there is no Identity coupling, and the recommendation is
**one adapter** presenting the Netlify V1 handler interface over a Workers
`fetch` handler — so every function keeps working unchanged and can be
modernised individually. The genuinely uncertain part is translating
`_redirects`, not the functions.

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
/DATA/AppData/thauma              Thauma repo, branch dev  → serves dev.thauma.one
~/projects/chaseroush_missions    CR repo, branch dev      → serves dev.chaseroush.com
```

| service | what | scope |
|---|---|---|
| `thauma-dev` | `netlify dev --port 8991` (+socat 8992) | system |
| `cloudflared-thauma-dev` | tunnel, `~/.cloudflared/config.yml` | system |
| `chaseroush-dev` | `netlify dev --port 8993` (+socat 8994) | **user** |
| `cloudflared-chaseroush-dev` | tunnel, `config-cr.yml` | **user** |
| `cloudflared` | RemoteHouse Pi tunnel (personal, unrelated) | system |

**Gotchas that cost time before:**

- The dev sites serve **whatever branch is checked out** in those directories.
  Switching branches in place changes what is live. Use worktrees, and put
  them somewhere agreed — not a new folder in `$HOME`.
- The Netlify CLI is logged into **two accounts** but only one is active.
  Thauma is active; CR's service carries its own token via
  `~/.config/netlify-cr-auth.env` (0600) so both work without switching.
- `netlify dev` reads env vars **at startup**. Changing them in the dashboard
  requires a service restart.
- Eleventy's incremental serve does not delete removed files from `_site/`.
  Clean stale paths by hand — never run a bare `npm run build` while the dev
  server is up (see `CLAUDE.md` rule 9).
- Split-horizon DNS: Pi-hole resolves several hostnames to LAN IPs, so testing
  from the Pi does **not** exercise the public path. Force it with
  `curl --resolve` against the Cloudflare IP.
- Pi-hole caches negative DNS answers for 30 minutes. Create a record
  *before* querying it, or flush with `docker exec Roushhouse-PiHole pihole
  reloaddns`.
- Secrets in systemd `Environment=` are expanded into the process command
  line and visible in `ps`. Use `EnvironmentFile=` **and** have the program
  read the variable itself rather than passing it as an argument.

---

## 9. Open decisions

| decision | notes |
|---|---|
| **CR palette** | provisional, ~8 rounds without resolution. See the reference rule in §1. |
| **Giving platform** | leaning Donorbox; per-staff donor scoping untested |
| **Auth IdP long-term** | Access now; UniFi Identity Enterprise possible via SAML/OIDC |
| **CR migration timing** | agreed in principle, not scheduled |
| **Subscribers** | old lists deleted (they were publicly readable in R2); starting fresh in `contacts` |

---

## 10. Conventions

- Forward-only numbered migrations. Never edit an applied one.
- Money is **INTEGER cents**. Never a float.
- Timestamps ISO-8601 UTC; dates `YYYY-MM-DD`.
- Enums are TEXT + CHECK — SQLite has no native enum.
- Queries live as literal SQL in `db/queries.sql`, parsed by name. No ORM, so
  swapping database drivers never touches the interface.
- The UI is built against **query output**, not fixtures.
- Work on `dev`. **Never push to `main`** — that is a human decision and it
  deploys.
