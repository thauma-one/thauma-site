# What to do next

Written 2026-08-16. In order. Stop wherever you like — each step leaves things
in a working state.

**Where things stand** (updated 2026-08-19): `dev` is pushed. Both databases
are migrated and up to date. The live site is still unchanged — **the merge to
`main` is the one thing left, and it is deliberately waiting for you**, because
it ships 66 commits and deploys production in one go.

Nothing is broken and nothing is on a timer.

One thing to do when you get a moment: **rotate the GitHub App private key.**
It was printed into a chat transcript on 2026-08-19 by a command of mine that
did not redact it properly. It is not in git and never has been. Generate a new
key on the App, delete the old one, redo the `openssl` step in section 3, and
update `.dev.vars` plus the two Cloudflare secrets.

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

## 4b. CHECK THE CREDENTIAL ACTUALLY WORKS

```
cd /DATA/AppData/thauma
node deploy/check-github-app.mjs
```

It asks GitHub what the app can do and prints the answer. Run it before
believing the setup is finished.

**Why it exists:** thauma-site is a PUBLIC repository, and reading a public
repository needs no permissions at all. So an app with none reads every file
perfectly, the Content page lists every section, and everything looks right —
until the first save, which fails. That happened on 2026-08-17 and the
symptom was a 502 with no useful message.

If it reports MISSING, the fix is two steps and the second is the one people
miss: set the permissions in the app's settings, **then approve the change on
the installation.** GitHub does not apply a permissions change to an existing
install by itself. Until you approve it, the settings page shows the right
thing and the token still has nothing.

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

## 7. The database — done, and now it runs itself

**This is finished. Nothing for you to do here.** Written down because the
answer changed on 2026-08-18.

Both databases were two migrations behind. That is what made "remove a person"
return a 500: the code had been rewritten to let somebody leave without
erasing who logged what, and the live tables still had the old rules. Applied
to both, and every row in dev survived the rebuild (4 users, 8 interactions,
8 milestones, 5 resources — same before and after).

**From now on you never do this by hand.** The Publish page has a database
panel:

- **Green** — the database is up to date. Nothing to do.
- **Amber, with an Apply button** — the database is behind the code. Press it.
  Type `MIGRATE`. It runs each change in order and records it, so nothing runs
  twice.
- If one fails, it stops there and tells you which file and which line. It
  will not carry on and it will not pretend it worked.

**Apply the database changes BEFORE you publish**, not after. The order is:
merge → apply → publish. New code that expects a table which isn't there yet
breaks the moment it deploys; a database slightly ahead of the code breaks
nothing.

---

## 8. When the page and reality disagree

On the Publish page there's a fold-out: **"Something looks out of step"**.

Open it and you get two things the ordinary buttons won't give you:

- **Rebuild the preview site** and **Rebuild the live site** — the same actions
  as the buttons above, but they don't first check whether it's needed.
- A line at the bottom reading `Live branch is at abc1234 · last deployed
  def5678`. **If those two match, "up to date" is true.** If they differ, the
  site is genuinely behind whatever the page says.

This exists because "nothing is waiting" is assembled from GitHub's answer
about the last successful deploy, and if that answer is ever wrong there was
previously no way to act on it. Rebuilding the live site still asks you to
type `PUBLISH` — the guard matters most exactly when the page's idea of what
is waiting is not to be trusted.

---

## What Save actually pushes — a correction worth having

**Save does push to origin.** Your Slovenian import, all 209 values, went to
`main` through it. So did adding the language, and removing it.

What Save *cannot* push is **code**. The console writes files under
`src/_data/` and nothing else, deliberately — a content editor that could
rewrite the Worker would be a much larger thing to trust. So while your words
were on `main`, the code that renders them was sitting on this Pi, which is
why the Site page looked older than the content it was showing.

That gap is now closed, and the Publish page's SHA line above is what makes it
visible next time.

---

## Verified: the toggles do not publish anything

You asked. The answer was *nearly* yes.

Every page and language toggle saves with `[skip ci]`, which tells GitHub to
run no workflow — so flipping a switch commits and stops. Confirmed against
the actual commits on `main`.

**One path did not.** Deleting a language called a function that had never
been given the `[skip ci]` flag, so `Delete sl: 0 translated strings` landed
as an ordinary push and deployed production. Nobody asked for it. Fixed, and
there is now a test that walks every write in the Worker and fails if one of
them is missing the flag — the mechanism working was never the problem, one
caller not using it was.

---

## Fixed on 2026-08-19 — nothing for you to do, but worth knowing

**The milestone list was never loading.** Not slow, not empty — the editor was
switched off entirely. It checked the page's name before wiring itself up, and
when Milestones and Support became one page called Ministry, that check stopped
matching. Every button on it went unwired and the list sat on "Loading…"
forever. Goals and prayer had been updated to the new name; milestones was
missed. All three now check for the list they need instead of the page's name,
so renaming a page cannot do this again.

**Goals and prayer looked nothing like milestones** because they were drawing
row markup whose class names have never existed in the stylesheet. They now
draw the same row, and all three share one implementation of "a row that opens
into a form" (`src/js/staff-rowpanel.js`) rather than three copies that drift.
The Edit and Delete buttons on the goals list were also printing the literal
text `ms.edit` and `ms.delete` — those keys do not exist.

**The roadmap showed the marker past a date that had not happened.** The pins
get spread apart when they crowd, and the marker was placed by raw arithmetic
instead — two different rulers on one rail. In the vertical layout it was worse:
that column is laid out by how tall each entry's text is, so a percentage of
elapsed time meant nothing at all. It is measured against the real dots now.
There is a test that fails if it ever drifts back.

**The detail panel opens under the milestone you pressed**, instead of at the
bottom of the whole timeline. It is re-measured whenever it opens or closes,
because inserting it moves everything below it — that coupling is why this
looked unfixable the first time.

**Three prayer requests are seeded** on dev so the section has something real
in it. English only, deliberately: see the note below about translations.

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
