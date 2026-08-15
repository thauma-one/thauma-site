# Thauma → Cloudflare Workers: runbook

> ## ⚠️ BLOCKING — read before merging `dev` into `main`
>
> **The Access application covers `dev.thauma.one/staff*` only. Production
> `thauma.one/staff/` is NOT gated** — verified 2026-08-15, it returns 200 to
> anyone.
>
> Today that is harmless: `main` is 90+ commits behind and serves the old
> Identity page whose backing function 404s, so there is no data behind it.
>
> **The moment `dev` merges to `main`, that changes.** The staff console —
> including the stewardship table with supporter names, emails and contact
> history — deploys to a public URL with no gate in front of it.
>
> **Before merging:** add a second Access application for `thauma.one/staff*`
> with the same policy, and confirm:
> ```
> curl -s -o /dev/null -w '%{http_code}' https://thauma.one/staff/    # must be 302
> ```

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

## Phase 1 — finish Access (blocked on you)

- [ ] Netlify → Site configuration → Environment variables:
      ```
      ACCESS_TEAM_DOMAIN = thaumaone.cloudflareaccess.com
      ACCESS_AUD         = 04468ad531e25f3c53af5d0b4ed0bdd3073241f76a070c741efe40f58019fdfb
      ```
- [ ] `sudo systemctl restart thauma-dev` — `netlify dev` reads env at startup
- [ ] **Verify:** `curl -s -o /dev/null -w '%{http_code}' https://dev.thauma.one/.netlify/functions/staff-data`
      → **401**, not 500. 500 means the variables did not take.
- [ ] **Verify in a browser:** load `/staff/`, confirm Directory and Resources
      list, add a contact, reload, confirm it persisted.
- [ ] Optionally add a second Access application covering
      `/.netlify/functions/staff-data` so unauthenticated requests never reach
      the function. Do this **after** the above works, not before — otherwise a
      failure is ambiguous.

**Rollback:** revert `677677e`. Netlify Identity is still configured on the
site, so the old page works again immediately.

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

## Phase 3 — replace Decap

Git Gateway is a Netlify Identity service, so it dies with Identity. `/admin`
must be replaced before hosting moves.

- [ ] Build the content editor into `/staff/` (CR's admin is the pattern)
- [ ] Writes go to GitHub via the API, as CR's page editor already does
- [ ] **Verify:** edit a string, confirm the commit lands and the site rebuilds
- [ ] Delete `src/admin/`, drop `decap-server` from `package.json`

**Rollback:** keep Decap installed until the replacement has been used in
anger for a week.

---

## Phase 4 — KV for the blob stores

- [ ] `wrangler kv namespace create STAFF_DATA`
- [ ] `wrangler kv namespace create GAME_SCORES`
- [ ] Export the current Netlify Blobs contents (via the live function: `GET
      /.netlify/functions/staff-data`, save the JSON)
- [ ] `wrangler kv key put --binding=STAFF_DATA data '<the json>'`
- [ ] **Verify:** `wrangler kv key get --binding=STAFF_DATA data`

---

## Phase 5 — hosting

Only now, and by this point it really is just hosting.

- [ ] `wrangler.toml` with static assets, D1 + KV bindings, and Cron Triggers
- [ ] Route `/` through `lang-redirect`, `/api/contact` through `contact-form`
- [ ] Set every env var: `ACCESS_*`, `RESEND_API_KEY`, `CONTACT_TO`,
      `CONTACT_FROM`, `GAME_ADMIN_TOKEN`
- [ ] Deploy to a workers.dev subdomain **first** and test everything there
- [ ] **Verify on workers.dev:** `/` redirects by language, `/en/` renders,
      `/staff/` challenges, the contact form sends, the 404 game saves a score
- [ ] Point `thauma.one` at the Worker
- [ ] Update the contact form's `action` to `/api/contact` and remove
      `data-netlify="true"`
- [ ] Keep the Netlify site alive but undeployed for a week

**Rollback:** point DNS back at Netlify. Keep it deployable until you are sure.

---

## Phase 6 — cleanup

- [ ] Delete `netlify/functions/*`, `netlify/edge-functions/*`, `netlify.toml`
- [ ] Remove `@netlify/blobs` from `package.json`
- [ ] Update `CLAUDE.md` and `docs/SPEC.md`
- [ ] Archive the Netlify site

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

Expected **once Phase 1 is complete and production is gated**: `302/301`,
`200`, `302`, `401`, three `route*.mx.cloudflare.net`.

Actual on production today: `302`, `200`, **`200`**, `404`, 3 MX. The third
value is the one that must change before `dev` merges — see the warning at the
top.

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
python3 db/test_schema.py          # 14 — schema guarantees
python3 db/build_snapshot.py       # regenerates the offline console dataset
cd workers && npm test             # 100 — Access, lang, functions, contact, db
node netlify/functions/_shared/access.test.js   # 15 — the Netlify-side Access check
```

All must pass before each phase is considered done.
