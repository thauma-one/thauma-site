# Thauma → Cloudflare Workers: runbook

> ## Cutover complete — 2026-08-15
>
> thauma.one is served by the Worker. Netlify's builds are stopped and its
> last deploy is the rollback. `main` is production and deploys itself.
>
> The warning that stood here — do not merge `dev` to `main`, because the
> staff console would land on an ungated host — is resolved. Access gates
> `/staff*` on thauma.one, and the Worker verifies the token itself regardless.
>
> **Still open:** archive the Netlify site once the rollback window closes.
> `unrivaled-snickerdoodle-1134e3.netlify.app/staff/` answers 200 with a stale
> page.

Ordered, checkable steps. Every phase ends with something verifiable and
something you can roll back to.

**Principle:** remove Netlify dependencies **one at a time, while still on
Netlify**. By the time hosting moves, it should be *only* hosting moving.
The failure mode to avoid is doing the hosting move and the Identity
replacement and the CMS replacement in the same afternoon, then not knowing
which one broke.

---

## Phase 0 — done

- [x] `thauma.one` moved to a Thauma-owned Cloudflare account
- [x] Zero Trust org created — `thaumaone.cloudflareaccess.com`
- [x] `thauma-dev` tunnel recreated in the Thauma account
- [x] Cloudflare Access in front of `dev.thauma.one/staff*`
- [x] `staff-data.js` verifies the Access JWT (Netlify Identity removed)
- [x] Workers ports written and tested: `lang-redirect`, `game-scores`,
      `staff-data`, `contact-form`, Access verification, D1 query layer

---

## Phase 1 — Access — done

- [x] Access gates `/staff*` on dev, staging and production, each with its own
      application and audience tag
- [x] The Worker verifies the JWT itself, so an endpoint outside `/staff*` is
      not protected only by a routing rule
- [x] `ACCESS_AUD` is a comma-separated list — one Worker serves several
      hostnames, each with its own tag

The Netlify environment variables this phase once described are moot: Netlify
no longer serves Thauma.

---

## Phase 2 — D1 — done 2026-08-15

- [x] Authenticate wrangler (scoped API token in `~/.config/cloudflare-thauma.env`
      — `wrangler login` cannot complete on a headless Pi)
- [x] `wrangler d1 create thauma-ops` and `thauma-ops-dev`
- [x] Apply `db/migrations/0001_init.sql` to both
- [x] Seed **the dev database only**: `--file=db/seed.dev.sql`
- [x] **Verified:** 10 tables
- [x] Point the console's four snapshot sections at `/api/staff-snapshot`
      (`partnerSnapshot()` in `workers/src/lib/db.js`) instead of `snapshot.json`
- [x] **Verified:** Jordan Reyes shows **166 days** since personal contact
      against `thauma-ops-dev`, with last-contact-any 14 days ago

> **The number is 166, not the 165 this runbook used to predict, and that is
> the point.** `db/build_snapshot.py` pins `TODAY = "2026-08-14"`; the live
> endpoint uses the real current date, so the figure now advances by one every
> day. A frozen number here would have meant the console was still reading the
> file.

**Two defects were found by wiring this up, both invisible until now:**

- `partners_for_user` was keyed on `users.id` (`u_chase`) while Cloudflare
  Access only ever supplies an email address. **Every authenticated request
  would have returned 403.** Now keyed on `users.email`, which is UNIQUE
  COLLATE NOCASE, and gated on `users.status = 'active'`.
- `partnerSnapshot()` never returned `timelines`, which the stewardship drawer
  reads as `d.timelines[c.id]`. The page threw on first render. Added, along
  with `interactions_for_partner` so it costs one query rather than one per
  contact.

**Rollback:** set `SNAPSHOT_URL` in `src/js/staff.js` back to
`/staff/data/snapshot.json`; the generated file is still built and still
served. One line.

### Still to do in this phase

- [ ] Grant Chase's **actual** Access email a partner. The seed grants
      `chase@thauma.one`; if the address Access authenticates with differs, the
      console shows "no partner access yet" and names the address it saw.
- [ ] Apply the schema to `thauma-ops` (production) — it is created but empty.

**Do not skip:** take an export as soon as there is real data.
`wrangler d1 export thauma-ops --output=backup.sql`, kept **off Cloudflare**.

---

## Phase 2.5 — main is production — done 2026-08-15

Not in the original plan. It became necessary the moment hosting moved: for
two weeks the only way to update thauma.one was someone running
`wrangler deploy` by hand on a Raspberry Pi, and there was no branch that
meant "what is live" — the live site was a snapshot of a working directory.
An editor needs somewhere real to commit to, so this had to come first.

- [x] Netlify builds **stopped**. It still serves its last deploy as the
      rollback, and no longer picks up commits. This mattered more than it
      looks: `unrivaled-snickerdoodle-1134e3.netlify.app/staff/` returns 200,
      and had Netlify rebuilt from the merge it would have published the
      current staff console to a public address with no Access in front of it.
- [x] `main` fast-forwarded to `dev` — 118 commits, no conflicts possible
- [x] `.github/workflows/deploy.yml`: push to `main` → build → test → deploy →
      verify
- [x] First automated deploy confirmed: a new Worker version landed without
      anyone touching a terminal
- [x] Netlify byte-for-byte unchanged afterwards, proving builds really are off

**`main` now means production. Anything merged there goes live.** `dev` stays
the working branch.

### Still to do here

- [ ] After the rollback week, archive the Netlify site. Until then
      `…netlify.app/staff/` serves a stale, harmless build — its backing
      function 404s — but it is a public URL with a staff page on it, and it
      should not outlive its usefulness.

---

## Phase 3 — the content editor — BUILT 2026-08-15, awaiting its token

The last piece of the original plan. Decap died with Netlify Identity at the
cutover and `src/admin/` was deleted; this is its replacement.

```
/admin/content/   the words     src/_data/i18n/*.json    210 strings each
/admin/site/      the settings  src/_data/site.json
```

### Built

- [x] An editor under `/admin/`, not `/staff/` — copy and settings are
      org-level, not partner-scoped.
- [x] `workers/src/lib/github.js` — the Contents API, with UTF-8-safe base64.
      `btoa` throws above U+00FF and `atob` returns one byte per character,
      and every file this moves is Croatian or Serbian. It mangles rather than
      throwing, so an English test cannot catch it. There are round-trip tests
      for Cyrillic and for an emoji.
- [x] `workers/src/admin-content.js` — admin role, a derived path, leaf edits
      only, audited.
- [x] SHA-based conflict detection. An edit here and an edit in VS Code cannot
      silently overwrite each other; the second gets a 409 saying to reload.
- [x] `decap-server` dropped from `package.json`. **`@netlify/blobs` stays** —
      `netlify/functions/*`, kept as the rollback, still requires it. Remove it
      when the Netlify site is archived, not before.
- [x] 32 tests for the endpoint, 14 for the client. Four run against the real
      content files.

### Left to do — needs a person

**Create a GitHub App owned by the `thauma-one` organisation.** Not a personal
access token: a fine-grained PAT is owned by a HUMAN and acts as them, so the
site's content pipeline would stop working the day that person left the org —
which SPEC §2 rules out in as many words. An App belongs to the organisation,
and its installation tokens are minted on demand and last an hour, so there is
also no expiry date on which the editor quietly stops working.

- [ ] **github.com/organizations/thauma-one/settings/apps → New GitHub App**
      - Name: `Thauma Content`, Homepage: `https://thauma.one`
      - **Uncheck "Webhook → Active"** — nothing here listens for webhooks, and
        an App with one configured and no listener produces failed deliveries
        forever.
      - Permissions → Repository permissions, exactly two:
        **Contents: Read and write** (reading and committing the files) and
        **Actions: Read and write** (Preview and Publish, which start a build
        with `workflow_dispatch`). Nothing else.

        Missing the second is the likeliest setup mistake, and GitHub's 403 for
        it says nothing useful — `dispatchWorkflow()` catches that case and
        names the permission rather than passing the shrug through.
      - "Where can this GitHub App be installed": **Only on this account**
      - Create, then note the **App ID** shown at the top.
- [ ] **Generate a private key** on the same page. It downloads a `.pem`.
- [ ] **Install it**: left sidebar → Install App → `thauma-one` → **Only select
      repositories** → `thauma-site`. After installing, the URL ends in
      `/settings/installations/<NUMBER>` — that number is the **installation ID**.
- [ ] **Convert the key.** GitHub gives you PKCS#1; WebCrypto imports PKCS#8
      and nothing else, and its failure for the wrong one names neither format:
      ```
      openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
        -in ~/Downloads/thauma-content.*.private-key.pem \
        -out ~/key-pkcs8.pem
      ```
      (`github.js` checks for this and says so, but converting first is quicker
      than reading the error.)
- [ ] **Set all three as secrets** — no file editing, and the App ID and
      installation ID authorise nothing without the key, so keeping them
      together is simpler than splitting them across `wrangler.toml`:
      ```
      npx wrangler secret put GITHUB_APP_ID --env production
      npx wrangler secret put GITHUB_INSTALLATION_ID --env production
      npx wrangler secret put GITHUB_APP_PRIVATE_KEY --env production   # paste the whole PKCS#8 file
      ```
      Repeat without `--env production` to give staging the same credential.
- [ ] **Delete the downloaded `.pem` files** once the secret is set. They are
      the credential.

### Verifying — three things, and the third is the one that surprises people

- [ ] **Read:** open `/admin/content/`. It should list the sections rather than
      saying it is not connected.
- [ ] **Write:** change one string, save, and confirm the commit appears in
      `git log` attributed to the person who typed it.
- [ ] **⚠ Confirm the commit TRIGGERS THE DEPLOY.** Commits made with a GitHub
      App installation token do fire `push` events and do start workflows —
      unlike the `GITHUB_TOKEN` handed to a running Action, which deliberately
      does not, to stop loops. These are different credentials and the rule is
      different, but they are confusable enough to check rather than assume. If
      the Action does not start, the editor will appear to work while nothing
      ever reaches the site.

### A PAT still works, if you would rather

`githubConfig()` accepts `GITHUB_TOKEN` as an alternative and the App wins when
both are set. A machine account (`thauma-bot`, on `admin@thauma.one`) holding a
fine-grained token is a legitimate simpler answer — org-controlled, no code
path to learn. It costs an account to look after and a token that expires.

### The flow, after the 2026-08-16 rework

```
Save      commits to `main` with [skip ci] — saved, not deployed
Preview   dispatches deploy-staging.yml against `main`
Publish   dispatches deploy.yml against `main` — the site changes
```

No branches appear in the interface and no merge is involved. `dev` is for
code; `sync-dev.yml` keeps it current with `main` on a ten-minute schedule so
website edits cannot be lost under a later code merge.

**deploy-staging.yml is dispatch-only, deliberately.** It had a push trigger on
`dev`; leaving it would have meant `sync-dev` rebuilding staging behind
somebody's back, so "Preview" would quietly have started meaning "whatever was
pushed most recently". To try code on staging, dispatch it manually with ref
`dev`.

### Keeping the Pi in sync

Three pieces, because the website can now change the repository without anyone
touching the Pi:

| piece | what |
|---|---|
| `deploy/git-sync.sh` | `git merge --ff-only`. Refuses on uncommitted work or divergence and changes nothing. |
| `deploy/git-sync-hook.js` | GitHub webhook receiver on 127.0.0.1:8994, HMAC-verified, exposed at `dev.thauma.one/_sync` through the tunnel. Instant. |
| `thauma-sync.timer` | The same script every five minutes. The backup for when a delivery fails. |

Tested 2026-08-16: unsigned, wrongly-signed and malformed-signature deliveries
all refused; a good signature accepted; a bad repository path fails safely.

### What it cannot do, deliberately

Add a key, remove one, reorder them, or change a value's type. The browser
sends leaf edits — `home.title` → new value — and the server re-reads the file
and applies each one in place. Structural change is a git operation, because a
CMS that can restructure the data its own build depends on can break the build.
That also keeps the diff to one line per edited string, so `git log` stays
usable for reviewing what somebody actually changed.

`site.json`'s `languages` list is refused on the server as well as in the
browser: renaming an entry orphans a translation file and breaks the build.

### Known gap

**Adding an array item** — a new `notFound.taunts` line — is structural, so it
is a git edit. Doing it in the console would mean writing all three language
files in one commit, which the Contents API cannot do; that needs the Git Data
API (blob → tree → commit → ref). Worth it only if it turns out to be asked
for.

---

## Access — one login for both consoles

### ⚠ Do NOT clear the path on the production application

The tempting fix for "/admin isn't covered" is to remove the path so the
application covers the whole hostname. On `dev.thauma.one` that is merely
inconvenient. **On `thauma.one` it puts the entire public website behind a
login** — every visitor to `/en/`, every page, bounced to a sign-in screen.

Add the path. Do not remove it.

### The shape to aim for

One application per hostname, each covering BOTH paths. Cloudflare Access
applications accept several domain entries, so this is one app, one policy, one
audience tag — which is what "a single login" means in practice.

```
Thauma console (production)   thauma.one/staff        thauma.one/admin
Thauma console (staging)      next.thauma.one/staff   next.thauma.one/admin
Thauma console (dev)          dev.thauma.one/staff    dev.thauma.one/admin
```

Three applications rather than one covering everything, deliberately:
production keeps its own policy so a change made while testing cannot loosen
the live site. `ACCESS_AUD` is already a comma-separated list, so each keeps
its own tag and the code needs no change.

### Steps

Zero Trust → Access → Applications → the application → **Edit**

1. Under **Application domain**, there is an existing entry with path `staff`.
2. **Add a domain** — same hostname, path `admin`.
3. Save. Repeat per hostname.

**Verify in a browser**, signed out (a private window):

| | expected |
|---|---|
| `/staff/` | Cloudflare login page |
| `/admin/` | the same Cloudflare login page |
| `/en/` | the public site, no login — **production especially** |

If `/admin/` shows Thauma's own dark "You need to sign in" page rather than
Cloudflare's, the path is still not covered: that page is the Worker's own
fallback, not Access.

### Why the Worker checks anyway

`isProtected()` in `worker.js` refuses `/staff*` and `/admin*` regardless of
what the dashboard says. That is not redundant — it is the reason the
misconfiguration on 2026-08-16 was a locked door rather than an open one. Two
tests assert the two areas behave identically, because "they are both in the
same `if`" stays true only until somebody edits one clause.

### MFA — the real answer is an identity provider

Access currently uses **one-time PIN**: a code sent to the email address. That
is a single factor — whoever can read the mailbox can sign in.

Real MFA comes from federating Access to an identity provider that enforces it,
then requiring it in the policy:

1. Zero Trust → Settings → **Authentication** → add a login method
   (Google Workspace, Microsoft Entra, GitHub, Okta…)
2. Enforce 2-step verification in that provider
3. In the Access policy, **Require → Login Method**, and remove one-time PIN so
   it cannot be used as a way around the requirement

**This is the same decision as the mailbox one.** thauma.one has no mailboxes —
MX points at Cloudflare Email Routing, which only forwards. Buying Google
Workspace or Microsoft 365 solves mailboxes, identity and MFA together, and
turns "who works here" into one list instead of three. Worth deciding once.

SPEC §5 records the longer-term intent: Access federating to SAML/OIDC, with
UniFi Identity Enterprise as a candidate IdP.

---

## Phase 4 — KV — SUPERSEDED

This planned to move Netlify Blobs into KV. It happened, and then 0005 moved
the same data out of KV and into D1, because a single KV document could not
express ownership: directory and resources shared one entry for the whole
installation, and saving it whole meant concurrent edits destroyed each other.

KV still holds `GAME_SCORES`, which is genuinely a document read and written
whole. `STAFF_DATA` is unused and can be deleted.

---

## Phase 5 — hosting — DONE 2026-08-15

Reordered ahead of Phase 3 deliberately. The runbook claimed Decap had to go
first because Git Gateway dies with Identity — but that is a *consequence* of
the hosting move, not a prerequisite. Checked before deciding: Decap manages
the trilingual copy files, and exactly one commit in the repo's history was
ever CMS-authored. `/admin` goes dark at the flip; copy stays editable in git.

### Done

- [x] Production D1 `thauma-ops` has the schema — 11 tables, 2 views, 6
      triggers, **zero rows**
- [x] `[env.production]` builds from `_site_prod`, its own directory
- [x] `thauma-production` deployed, routes `thauma.one/*` and
      `www.thauma.one/*` registered
- [x] Worker 301s `www` to the apex, so www stops depending on Netlify
- [x] `ACCESS_AUD` removed from production so `/staff/` is hard closed
- [x] Staging proven: `next.thauma.one` has run the same Worker for a day

### Step 1 — flip two DNS records (thauma.one zone)

| record | from | to |
|---|---|---|
| `thauma.one` | **A** `75.2.60.5`, DNS only | **AAAA** `100::`, **Proxied** |
| `www.thauma.one` | **CNAME** `unrivaled-snickerdoodle-1134e3.netlify.app`, DNS only | **AAAA** `100::`, **Proxied** |

`100::` is the discard prefix. Nothing is ever sent there — the address exists
only to give the hostname a proxied record so the Workers route can fire. This
is the same pattern `next.thauma.one` already uses.

**Verify immediately:**
```bash
curl -sI https://thauma.one/en/ | grep -iE '^(server|cf-ray)'   # expect cf-ray, no "Netlify"
curl -s -o /dev/null -w 'apex %{http_code}\n' https://thauma.one/
curl -s -o /dev/null -w 'en   %{http_code}\n' https://thauma.one/en/
curl -s -o /dev/null -w 'www  %{http_code}\n' https://www.thauma.one/
curl -s -o /dev/null -w 'staff %{http_code}\n' https://thauma.one/staff/
dig +short MX thauma.one
```
Expect `302`, `200`, `301`, **`500`** for staff (hard closed — correct until
step 2), and the three `route*.mx.cloudflare.net` unchanged. **The MX records
are untouched by this change; email keeps working.**

**Rollback**, if anything is wrong — restore the two records exactly:
```
thauma.one       A      75.2.60.5                                    DNS only
www.thauma.one   CNAME  unrivaled-snickerdoodle-1134e3.netlify.app    DNS only
```
The Netlify site stays deployed and unchanged, so this is a full rollback.
Keep it that way for at least a week.

### Step 2 — Access application for production

Zero Trust → Access → Applications → **Add a self-hosted application**

- Application domain: `thauma.one`, path `staff`
- Same policy as the `dev.thauma.one` application
- Copy the **Application Audience (AUD) tag**

Then in `wrangler.toml`, under `[env.production.vars]`, replace the
ACCESS_AUD comment block with the real value and redeploy:

```toml
ACCESS_AUD = "<the new tag>"
```
```bash
npx @11ty/eleventy --output=_site_prod
npx wrangler deploy --env production
curl -s -o /dev/null -w 'staff %{http_code}\n' https://thauma.one/staff/   # now 302
```

**Do not paste dev's tag here.** Access sets `CF_Authorization` across the
parent domain, so a dev session's token reaches `thauma.one` and would be
accepted — the exact cross-application hole the `aud` check exists to close.

### Step 3 — afterwards

- [ ] Keep the Netlify site deployed but idle for a week
- [ ] Then Phase 3: replace Decap
- [ ] `main` still lags `dev` by 112 commits. The Worker deploys from the
      working tree, not from `main`, so the cutover never needed that merge —
      but Netlify still builds from `main`, so leave it alone while Netlify is
      the rollback.

---

## Phase 6 — cleanup

- [ ] Delete `netlify/functions/*`, `netlify/edge-functions/*`, `netlify.toml`
      — nothing serves them, but they still look like live code
- [ ] Remove `@netlify/blobs` from `package.json`
- [ ] Delete the unused `STAFF_DATA` KV namespace (see Phase 4)
- [ ] Archive the Netlify site once the rollback window closes
- [x] `docs/SPEC.md` rewritten 2026-08-15

---

## Verification script

Run at any point; every line should be the expected code.

```bash
# public site
curl -s -o /dev/null -w 'apex      %{http_code}\n' https://thauma.one/
curl -s -o /dev/null -w 'en        %{http_code}\n' https://thauma.one/en/
# staff must challenge, never 200
curl -s -o /dev/null -w 'staff     %{http_code}\n' https://thauma.one/staff/
# the function must refuse without a token
curl -s -o /dev/null -w 'staffdata %{http_code}\n' https://thauma.one/.netlify/functions/staff-data
# mail still routed
dig +short MX thauma.one
```

Expected, and true as of the cutover: `302`, `200`, `302`, `401`, three
`route*.mx.cloudflare.net`.

**`staff` returning 200 means something is open that should not be.** That is
the check worth wiring into a cron.

**`staff` returning 200, or `staffdata` returning 200, means something is
open that should not be.** That is the check worth wiring into a cron.

---

## Things that will bite

- **`netlify dev` reads env at startup.** Changing a variable in the dashboard
  does nothing until the service restarts.
- **Eleventy's incremental serve does not delete removed files from `_site/`.**
  Clean stale paths by hand. Never run a bare `npm run build` while the dev
  server is up — see `CLAUDE.md` rule 9.
- **Pi-hole caches negative DNS for 30 minutes.** Create a record *before*
  querying it, or `docker exec Roushhouse-PiHole pihole reloaddns`.
- **Split-horizon DNS** means testing from the Pi does not exercise the public
  path. Force it: `curl --resolve host:443:<cloudflare-ip>`.
- **Two Netlify accounts, one active.** Thauma is active; CR's dev service
  carries its own token in `~/.config/netlify-cr-auth.env`.
- **Cloudflare tunnels are account-scoped.** A zone in one account cannot route
  to a tunnel in another — that is what broke `dev.thauma.one` during the move.
- **Secrets in systemd `Environment=`** are expanded into the command line and
  visible in `ps`. Use `EnvironmentFile=` *and* have the program read the
  variable itself.
- **Access applications are path-scoped, and this bit twice.** `/staff*` does
  not cover `/.netlify/functions/*` — and it does not cover `/admin*` either.
  On 2026-08-16 `/admin/` returned a bare `{"error":"Not authorized"}` in the
  browser: Access never intercepted the path, so no login was ever offered.
  **Clear the path on the Access application so it covers the whole hostname**,
  or add a second application for `admin`. The Worker now serves a sign-in page
  rather than JSON when a PAGE is refused, so the failure is at least legible —
  but the application still has to be right.
- **`wrangler dev` rewrites the hostname.** Both `url.hostname` and the `Host`
  header come back as the route in wrangler.toml, whatever the browser asked
  for. Anything built from them — a login URL, a callback, an absolute link —
  is wrong locally and right in production, which is the worst combination.
  Prefer relative URLs.

---

## Test suites

```bash
python3 db/test_schema.py          # 30 — every migration, in order
python3 db/build_snapshot.py       # regenerates the offline console dataset
cd workers && npm test             # 180 — Access, boundary, editors, admin, db
node netlify/functions/_shared/access.test.js   # 15 — the Netlify-side Access check
```

All must pass before each phase is considered done.
