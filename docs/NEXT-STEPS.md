# What to do next

Written 2026-08-16. In order. Stop wherever you like — each step leaves things
in a working state.

**Where things stand:** everything is committed on `dev` and nothing has been
pushed. The live site is unchanged. Nothing is broken and nothing is on a timer.

---

## How it works now, in one picture

```
        you edit a word on the website
                    │
                    ▼
              SAVE  ──────────►  saved in GitHub. Site does not change.
                    │
                    ├── PREVIEW ────►  next.thauma.one rebuilds. Still not live.
                    │
                    └── PUBLISH ────►  thauma.one rebuilds. Now it is live.
```

You never touch a branch and you never open a terminal. `dev` still exists —
it's where code gets written — but it isn't yours to think about.

The Pi keeps itself in sync automatically: instantly when GitHub sends a
webhook, and within five minutes anyway if that fails.

---

## 0. Test acting-as — works now, no setup

There is a second test partner in the local database. **Mira Petrović** is
deliberately unlike Chase: euros not dollars, Serbian not Croatian, one goal
not two, six supporters not four. If the numbers do not change when you open
her console, acting-as is not working.

1. `dev.thauma.one/staff/` — sign in here FIRST. The Access application covers
   `staff` and not `admin`, so this is what gets you a login. (Fix that in the
   dashboard: add `admin` as a second path on the application.)
2. `dev.thauma.one/admin/users/` → open **Mira Petrović** → **View their console**
3. You should land on `/staff/` with a purple band, a purple border, and a
   watermark bottom-right that stays put while scrolling.
4. Check the numbers actually changed:
   - Support → **€1,800/month**, not $4,500
   - Stewardship → **6 supporters**, and **Nikola Jovanović** should stand out:
     newslettered two weeks ago, last actually spoken to in July 2025
   - Milestones → **3**, with **Serbian** columns, and one missing translation
5. Go to `/admin/` while still viewing — **the banner must still be there.**
6. Press **Stop** → you should land back on **the People page**, no purple,
   and the "Admin area" link back in the staff nav.

---

## 1. Push what's built (2 minutes)

Nothing deploys from this — staging is now dispatch-only.

```
cd /DATA/AppData/thauma
git push origin dev
```

---

## 2. Create the GitHub App (~15 minutes of clicking, no terminal)

This is the credential the website uses to save and publish. It belongs to the
Thauma organisation, not to you personally, so it keeps working if you ever
step away from it.

1. Go to **github.com/organizations/thauma-one/settings/apps** → **New GitHub App**
2. **Name:** `Thauma Content`  ·  **Homepage:** `https://thauma.one`
3. **Uncheck "Webhook → Active."** Easy to miss, and it generates failed
   deliveries forever if you leave it on.
4. **Permissions → Repository permissions**, set exactly two:
   - **Contents: Read and write** — saving words
   - **Actions: Read and write** — the Preview and Publish buttons
5. **Where can this be installed:** Only on this account
6. **Create.** Write down the **App ID** shown at the top.
7. **Generate a private key** — it downloads a `.pem` file.
8. Left sidebar → **Install App** → thauma-one → **Only select repositories** →
   `thauma-site`. After installing, the address bar ends in
   `/settings/installations/NUMBER`. **Write down that number.**

---

## 3. Convert the key (one command — the only terminal step)

GitHub gives you a format Cloudflare can't read. I could not find a way to do
this in a browser without pasting your private key into someone else's website,
which is not a thing to do with a private key.

```
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in ~/Downloads/thauma-content.*.private-key.pem \
  -out ~/key-pkcs8.pem
```

Then open `~/key-pkcs8.pem` in a text editor and copy **all** of it, including
the `-----BEGIN` and `-----END` lines.

---

## 4. Add three secrets in the Cloudflare dashboard (no terminal)

**dash.cloudflare.com** → Workers & Pages → **thauma-production** → Settings →
**Variables and Secrets** → Add.

For each one, choose type **Secret** (not Text):

| Name | Value |
|---|---|
| `GITHUB_APP_ID` | the App ID from step 2 |
| `GITHUB_INSTALLATION_ID` | the number from step 8 |
| `GITHUB_APP_PRIVATE_KEY` | the whole contents of `key-pkcs8.pem` |

Then **Save and deploy**.

Do the same on the **thauma** worker (that's staging) so Preview works there
too.

**Then delete both `.pem` files.** They are the credential.

---

## 5. Turn on instant sync for the Pi (needs one sudo edit)

Skip this if you like — the five-minute timer covers it. This just makes it
immediate.

**a. Make up a password** for the webhook. Anything long and random.

**b. Put it in a file** — in a terminal:
```
echo 'GITHUB_WEBHOOK_SECRET=your-made-up-password' > ~/.config/thauma-sync.env
chmod 600 ~/.config/thauma-sync.env
```

**c. Install the two services:**
```
sudo cp /DATA/AppData/thauma/deploy/thauma-sync*.service /etc/systemd/system/
sudo cp /DATA/AppData/thauma/deploy/thauma-sync.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now thauma-sync.timer thauma-sync-hook
```

**d. Let the tunnel reach it.** `sudo nano /etc/cloudflared/config.yml` and make
the ingress section read:
```yaml
ingress:
  - hostname: dev.thauma.one
    path: ^/_sync
    service: http://localhost:8994
  - hostname: dev.thauma.one
    service: http://localhost:8991
  - service: http_status:404
```
Then `sudo systemctl restart cloudflared-thauma-dev`.

**e. Tell GitHub** — repo → Settings → Webhooks → Add webhook:
- Payload URL: `https://dev.thauma.one/_sync`
- Content type: `application/json`
- Secret: the password from step (a)
- Events: **Just the push event**

---

## 6. Try it (5 minutes)

1. Open `https://thauma.one/admin/content/`
2. Change one word. **Save.**
3. Check the live site did **not** change. That's the point of Save.
4. Press **Preview.** Wait a minute, then look at `next.thauma.one`.
5. Press **Publish**, type `PUBLISH`. Wait a minute or two.

**⚠ If Publish does nothing:** the App is probably missing the Actions
permission. The page will say so. Go back to step 2.4, add it, and accept the
new permission on the installation.

---

## 7. Before the first Publish — check the database

The live site is a long way behind and the new code expects database tables
that may not exist there yet.

**dash.cloudflare.com** → Storage & Databases → **D1** → `thauma-ops` → Console,
and run:

```sql
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;
```

You should see `partners`, `users`, `contacts`, `milestones`, `user_roles`,
`resources`, `directory_contacts`, `audit_log` among others. **If that list is
short or empty, stop and tell me** — the migrations need applying first, and
publishing without them breaks the live site.

---

## Left over from before

- [ ] **Archive the Netlify site.** The rollback week is up around the 22nd.
      `unrivaled-snickerdoodle-1134e3.netlify.app/staff/` is a public address
      with an old staff page on it.
- [ ] **Add the `www` deep-link redirect rule** in Cloudflare.

---

## Decisions, not tasks

No deadline. These need you, not code.

- **What should a board member see?** Right now they sign in to an almost empty
  console. Org-wide giving totals? The roadmap? Definitely not supporters.
- **The Croatian and Serbian translations** were written by an assistant, not a
  speaker. They want a real pass before anyone relies on them.
- **The Chase Roush palette** is still unresolved after about eight rounds.
