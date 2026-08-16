# What to do next

Written 2026-08-15, end of day. Everything below is in order. Stop wherever
you like — each step leaves things in a working state.

**Where things stand right now:** all the work is committed on `dev` and
nothing has been pushed. The live site is unchanged. Nothing is broken and
nothing is waiting on a timer.

---

## 1. Push what's done (5 minutes, low risk)

```
cd /DATA/AppData/thauma
git push origin dev
```

This deploys **staging only** — `next.thauma.one`. The live site is untouched.

Then open `https://next.thauma.one/admin/` and check the menu has seven items:
Overview, People, Partners, Content, Site, Publish, Activity.

Content, Site and Publish will say **"not connected yet."** That is correct —
they need step 2.

---

## 2. Create the GitHub App (~15 minutes of clicking)

This is the credential the content editor uses. It belongs to the Thauma
organisation, not to you personally — so it keeps working if you ever step
away from it.

Full steps: `docs/MIGRATION-RUNBOOK.md`, Phase 3, "Left to do — needs a person".

The short version:

1. github.com/organizations/thauma-one/settings/apps → **New GitHub App**
2. Name it `Thauma Content`. Homepage `https://thauma.one`.
3. **Uncheck "Webhook → Active"** — easy to miss, annoying to leave on.
4. Permissions → Repository permissions → **Contents: Read and write**. Nothing else.
5. Create it. **Write down the App ID** shown at the top.
6. **Generate a private key** — it downloads a `.pem` file.
7. Left sidebar → **Install App** → thauma-one → **Only select repositories** →
   `thauma-site`.
8. After installing, the address bar ends in `/settings/installations/NUMBER`.
   **Write down that number.**

---

## 3. Convert the key and set three secrets (~5 minutes)

The downloaded key is in a format Cloudflare can't read. One command fixes it:

```
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in ~/Downloads/thauma-content.*.private-key.pem \
  -out ~/key-pkcs8.pem
```

Then, from `/DATA/AppData/thauma`:

```
npx wrangler secret put GITHUB_APP_ID
npx wrangler secret put GITHUB_INSTALLATION_ID
npx wrangler secret put GITHUB_APP_PRIVATE_KEY
```

For the third one, paste the **entire contents** of `~/key-pkcs8.pem`,
including the `-----BEGIN` and `-----END` lines.

Then do all three again with `--env production` on the end, so the live site
has them too.

**Afterwards, delete both `.pem` files.** They are the credential.

---

## 4. Test it on staging (~5 minutes)

1. Open `https://next.thauma.one/admin/content/`
2. It should list sections down the left instead of saying "not connected".
3. Change one word. Save.
4. Check that a commit appeared: `git fetch && git log origin/dev -3`
5. **Check that the commit started a deploy** — github.com/thauma-one/thauma-site/actions
   should show "Deploy staging" running.

Step 5 is the one that might surprise us. If no deploy starts, stop and say so
— it means the editor looks like it works but nothing reaches the site.

---

## 5. Before you publish anything to the live site

The live site is 35 commits behind. That's everything: both consoles, the
roles model, seven database migrations, the content editor.

**Check the production database first.** The new code expects tables that may
not exist there yet:

```
npx wrangler d1 migrations list thauma-ops --remote
```

If anything is unapplied:

```
npx wrangler d1 migrations apply thauma-ops --remote
```

Do this **before** publishing, not after. Code that expects a missing table
fails on the live site.

---

## 6. Publish

`https://next.thauma.one/admin/publish/`

It shows you everything that's about to go live before you commit to it. Type
`PUBLISH` to confirm. The deploy runs on its own and takes a minute or two.

---

## Left over from before (no rush, but don't forget)

- [ ] **Archive the Netlify site.** The rollback week is up around the 22nd.
      `unrivaled-snickerdoodle-1134e3.netlify.app/staff/` is a public address
      with an old staff page on it.
- [ ] **Add the `www` deep-link redirect rule** in Cloudflare, so
      `www.thauma.one/en/` redirects instead of serving.

---

## Things that are decisions, not tasks

No deadline on these. They need you, not code.

- **What should a board member see?** Right now they sign in and get an almost
  empty console. Org-wide giving totals? The roadmap? Definitely not
  supporters. That's a governance call.
- **The Croatian and Serbian translations** were written by an assistant, not
  a speaker. They work, but they want a real pass before anyone relies on them.
- **The Chase Roush palette** is still unresolved after about eight rounds.
