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

## Phase 3 — replace Decap — OUTSTANDING

The last piece of the original plan. `/admin` went dark at the cutover, so
**site copy cannot currently be edited through a UI** — the trilingual files in
`src/_data/i18n/` are editable in git and nowhere else.

Not urgent: exactly one commit in this repo's history was ever CMS-authored,
and the site is still coming-soon gated. It becomes urgent at launch.

- [ ] Build the content editor into `/staff/`
- [ ] Writes go to GitHub via the Contents API, as CR's `save-file.js` does
- [ ] **Verify:** edit a string, confirm the commit lands and the Action
      deploys it
- [ ] Delete `src/admin/`, drop `decap-server` from `package.json`

**What it should reuse rather than reinvent:** the working-copy model and save
bar from the milestone editor, the language columns, and the toast/problem
split. See SPEC §8a.

**Before it:** the admin area, which gives user management, roles and the site
master language somewhere to live — and which the content editor will want for
deciding who may publish copy.

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
- **Access applications are path-scoped.** `/staff*` does not cover
  `/.netlify/functions/*`. Verify with curl rather than assuming.

---

## Test suites

```bash
python3 db/test_schema.py          # 27 — every migration, in order
python3 db/build_snapshot.py       # regenerates the offline console dataset
cd workers && npm test             # 159 — Access, boundary, editors, db
node netlify/functions/_shared/access.test.js   # 15 — the Netlify-side Access check
```

All must pass before each phase is considered done.
