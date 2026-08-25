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

## Set up the mail domains in Resend  (2026-08-21 — do this before sending anything)

The free tier allows **three domains**. Two are spent, one is held back
deliberately: the moment a second partner is real they need one, and having it
free means not choosing between them.

| # | domain | carries |
|---|---|---|
| 1 | `chaseroush.thauma.one` | your newsletter, prayer list, confirmations |
| 2 | `thauma.one` | org identity, contact forms, account invites — low volume |
| 3 | *held* | the next partner |

**Never send a newsletter from bare `thauma.one`.** Subdomains carry largely
independent reputation, but receivers also read the organisational domain as a
signal — so complaints at the parent bleed downward into every subdomain.
Keeping `thauma.one` low-volume is what protects the rest of them.

In order:

1. **Resend → Domains → Add Domain**, twice: `chaseroush.thauma.one` and
   `thauma.one`.
2. For each, Resend shows DNS records — an **MX** and **TXT** for the return
   path, a **DKIM** TXT, and an **SPF** TXT. Add every one in Cloudflare DNS,
   **DNS-only (grey cloud), not proxied.** A proxied record breaks
   verification. Then press Verify.
3. Add a **DMARC** record on `thauma.one`, which Resend does not give you:

   ```
   Name:  _dmarc
   Type:  TXT
   Value: v=DMARC1; p=none; rua=mailto:dmarc@thauma.one; fo=1
   ```

   `p=none` reports without rejecting anything — start there. Subdomains
   inherit this unless they publish their own, so one record covers all of
   them. Create `dmarc@thauma.one` as a Workspace alias so the reports arrive;
   they are how you find out if somebody is spoofing you.

4. In the console: **Admin → Partners → Chase Roush**, type
   `chaseroush.thauma.one` into **Sending domain**, Save, then press
   **Add the standard four**. That creates `news@`, `prayer@`, `contact@` and
   `connect@`.
5. Create Workspace aliases for **`contact@`** and **`connect@`** only — the
   two anybody is meant to write back to, plus whatever you put in a list's
   Reply-to. **Sending needs no mailbox; receiving does.** `news@` and
   `prayer@` never need one, because nothing is supposed to arrive there. A
   reply to an address with no mailbox is lost in silence, which is the only
   reason this step exists.
6. **Staff → Mailing → each list → Settings**: pick the From address from the
   dropdown. It is a list now, not a text box — see below for why.

**Why the sender became a picker.** Resend verifies *domains*, not addresses.
Once a domain is verified, **every** address at it sends — including one with a
typo. `nesw@…` leaves successfully, reads as correct in the log, and drops
every reply into nothing. Nobody finds out until somebody says "I wrote back
and never heard". A chosen address cannot be mistyped.

**Reply-to is still free text**, on purpose. Replies can go anywhere somebody
reads — a personal address, a shared inbox, a team alias — and none of those
need to be sending addresses. Leave it empty and replies go to the From
address.

**Renaming a sending domain moves everything at it.** Type the new domain,
press Save, and the dialog names every address that moves and every mailing
list that follows before anything happens. Deleting an address does the same:
lists that SEND from it are archived (hidden and stopped — subscribers kept,
reversible); lists that only REPLY to it carry on with their reply-to cleared.

This replaced a version that refused all three operations, which sounded
careful and was unusable: the only way to fix a mistyped domain was to delete
addresses that could not be deleted while a list used them, and the lists could
only be repointed at addresses that could not exist until the rename went
through. A guard that only says no is an obstruction.

**What SPF/DKIM/DMARC actually buy you.** They prove a message really came from
you. They do not guarantee the inbox. Without them you are junked almost
automatically; with them you are *eligible*, and after that it is complaint
rate, bounce rate and whether people open things. Double opt-in matters more
than any DNS record — a list of people who asked for it is the real
deliverability strategy, and that is already how sign-up works.

**One secret production needs before a newsletter can go out:**

```
npx wrangler secret put SIGNUP_SALT --env production
```

Any long random string — `openssl rand -hex 32` gives one. Unsubscribe links
are signed with it, and the send **refuses** without it rather than posting a
thousand emails whose only way out does not work. (It briefly fell back to
`MAIL_FROM`, which lives in `wrangler.toml` in the repo — a signing key anybody
can read is not one, so the fallback is gone.) A local one is already in
`.dev.vars`; it is gitignored and does not travel.

**Still to apply to production:** migrations `0015` through `0018`. None of the
mailing work is on `main` yet.

---

## How the embeds size themselves

**A Thauma embed is not an iframe.** The two lines you paste are a `<div>` and
a `<script>`; the script draws the form directly into your page inside a shadow
root. So:

- **Width** — it takes whatever the container you put it in gives it, up to a
  readable cap (about 480px for a form), and centres in anything wider. Put it
  in a narrow sidebar and it is narrow; put it in a full-width section and it
  centres.
- **Height** — there is no fixed height. It is exactly as tall as its content,
  and it grows as somebody types into the message box. **Nothing ever scrolls
  inside it on a real page.**
- **Narrow layout** — the widget measures its own *container*, not the window,
  and tightens the type and padding below about 420px. A 380px sidebar on a
  desktop monitor gets the compact layout too, which a CSS media query could
  never do because it only knows the window's width.

**The console's preview is the one place an iframe is involved**, for
isolation — and an iframe does have a fixed height it cannot learn from its
contents. That is why the preview used to scroll while a real page never
would. The widget now measures itself and posts its height to the frame
(`__thaumaHeight`, the same protocol the Ministry page's embeds use).

**And the preview is scaled to fit its box**, capped at 480px tall, with the
percentage shown beside the Desktop/Mobile toggle. A contact form is genuinely
around 700px tall, so at 1:1 you had to scroll the console to see the end of
its own preview — which defeats what a preview is for.

The FRAME stays full size and the WRAPPER is what scales. That distinction is
load-bearing: scaling the iframe would shrink the drawing surface with it, and
the widget would then be answering a different question about how wide its
container is. A 480px card in a 640px frame shown at 63% is honest; a card
asked to draw itself at 448px is a different card.

## The subscriber list  (2026-08-24)

⚠ **A sticky table header must be opaque.** `thead th` had
`background: rgba(255,255,255,.025)` — a tint, not a background — so rows
scrolled straight through it and column labels sat legibly on top of people's
names. It looked like a layout bug and was a transparency one, and because the
rule is global it did this to **every table in the console**, including
Stewardship. Now `var(--bg2)`, with an upward shadow that fills the strip left
when the page's own bar wraps to two lines and is taller than `--header-h`.

Built for hundreds rather than dozens.

- **One line per person, in a real table.** A card each is readable at ten and
  unusable at three hundred — the eye cannot compare down a column that keeps
  moving. A screen now holds about twenty-five rows instead of six.
- **Search** by name or address, **filter** by status, **sort** by newest,
  oldest, name, address or status. Every control resets to page one, because
  staying on page four of a search that now matches three people is a blank
  screen with no explanation.
- **Paging with a real total** — "Showing 101–200 of 340". The server always
  paged at 100; there was simply no way to reach page two, and no way to know
  there was one.
- **Edit in place.** Click the pencil and the row becomes two fields.

**Changing somebody's address sends them back to unconfirmed and emails a
fresh confirmation.** That is the consent model, not caution: without it,
"edit" is a way to subscribe any address in the world without its owner ever
agreeing. It is also right for the innocent case — correcting a typo is a guess
about a *different* mailbox, and that one has never said yes. Changing a name
does none of this; a name is a label, not consent.

⚠ **An absent filter must be `""`, never `NULL`.** The query asks
`:status = ''` to mean "no filter", and `clean()` returns `NULL` for a missing
parameter. In SQLite `NULL = ''` is not FALSE — it is NULL, so the whole `OR`
collapses and every row fails the test. The list came back **completely empty
while the counts above it stayed correct**, which is a hard symptom to read
backwards. Guarded now in `db/test_schema.py`, which runs the real queries
against real rows.

**The sort is chosen by a `CASE` inside the query**, never spliced into it. A
sort order arriving from a browser and being interpolated into SQL is the
classic injection, and the classic mitigation — an allow-list in the Worker —
has to be got right in every caller forever. Bound like any other value, an
unrecognised sort simply falls through to newest-first.

## Tags  (2026-08-25)

**Staff → Mailing → Subscribers → Tags.** They belong to the ministry, not to a
list — the same set applies everywhere, which is why the manager sits beside
the subscriber table rather than inside one list's Settings, where it would
read as belonging to that list.

- Add, rename (blur or Enter) and delete. A delete says what it takes off:
  *"Home church comes off 12 people"*, not *"are you sure"*.
- **Filter the list by tag.** A column you can read but not filter by is
  decoration, and that is what the Tags column was until now.
- Tick them on a person in the edit row. Tags are sent separately from the
  name and address because they are a different kind of change: something the
  ministry records *about* somebody, not something they agreed to — so unlike
  an address change they never touch a confirmation.
- Two tags cannot share a name. A list where you cannot tell which one you are
  applying is one you cannot untangle afterwards either.

The tag filter uses `EXISTS`, not a join — a join returns one row per matching
tag and quietly duplicates anybody carrying two.

## Thauma's own contact page  (2026-08-25)

`/contact/` now has the **reason dropdown and subject** the partner forms got,
and posts to `/api/contact` as before.

**The API, not the embed widget** — the page already has the site's own markup
and styling, and dropping the widget in would replace something that fits with
something that only resembles it. The API is the shared part; the appearance
stays the page's own.

The reasons are **fetched at runtime**, because the page is built by CI and CI
has no database. If that fetch fails the select stays hidden and the form works
exactly as it did: the dropdown is an improvement to the page, never a
dependency of it.

As with the partner forms, the reason's label and delivery address are looked
up on the server from the posted id.

## Contact forms  (2026-08-22)

> ⚠ **Dev seed data uses `.invalid` addresses only.** `db/seed.dev.contact.sql`
> once delivered the organisation's form to `admin@thauma.one`, and a routine
> `curl` against the local endpoint on 2026-08-22 put a test message into a
> real inbox. Running the Worker locally does not stop it calling Resend for
> real — the only reliable guard is a destination that cannot receive, and
> `.invalid` is reserved by RFC 2606 so it never can.

**Staff → Mailing → Contact form.** One per ministry, sitting beside the
sign-up form because they are the same kind of thing: a form on somebody else's
website that reaches you.

Two lines to paste, same as the sign-up snippet:

```html
<div data-thauma-contact></div>
<script src="https://thauma.one/embed/v1/<your-slug>/contact.js" defer></script>
```

- **Where messages go** is a mailbox you type. **What they come from** is
  chosen from your verified sending addresses — the same picker as a
  newsletter's sender, for the same reason: the mail provider verifies domains
  rather than addresses, so a typo sends successfully and loses every reply.
- **The visitor's address goes in Reply-to, never in From.** Sending as them
  fails SPF and DKIM and lands the message in junk.
- **Nothing is stored.** Messages are emailed and kept nowhere. That was the
  original contact form's decision and it is the right one: a contact form is
  the easiest way to end up holding people's personal messages without meaning
  to, and under GDPR that is a record somebody is responsible for. Your mailbox
  is the system of record.
- **"What is this about" is a dropdown you define** — General, Prayer request,
  Partnership, whatever fits. Empty means no dropdown at all. Modelled on
  chaseroush.com's, which also has a free-text **Subject** underneath it, so
  this does too: the reason tells you the category, the subject tells you
  whether to open it now.
- **A reason can route the message somewhere else.** Prayer requests to
  `prayer@`, partnership enquiries to whoever handles support, everything else
  to the form's own address. That is the difference between a form that sorts
  itself and an inbox somebody sorts by hand every morning.
- The reason and its address are **looked up on the server** from the id the
  form posts. Trusting a submitted label would let anybody choose the words in
  your subject line; trusting a submitted address would make this an open relay.
- **Off by default.** Switching it off removes the form from every website it
  is on, without anybody editing those pages. It refuses to go live without a
  sending address, because a live form with nowhere to send from collects
  messages and loses them.
- **A visualiser above the settings**, with a **Desktop / Mobile** toggle —
  the same position, the same classes and the same control as the roadmap and
  goal embeds on the Ministry page. The sign-up form's preview moved up to
  match, so all three embed screens now read the same way.

  Narrow is a real constraint rather than a picture of one: the widget picks
  its layout from the width it is given, so 380px produces exactly what a phone
  would. That is also why the preview sits above rather than beside — 380px
  inside a half-width column is not a phone, it is a squeeze.

  Unlike the email composer's preview — removed because a browser is not a mail
  client — this one is honest: a contact form ends up on a web page, so a
  browser is exactly what will draw it. It follows the heading, blurb, button
  and thank-you text as you type them.
- **Colours are not set here.** They come from the ministry's palette on the
  Sign-up forms tab and are shared by every widget, so there is one control
  rather than two that disagree.
- **Thauma's own form embeds too**, at `/embed/v1/thauma/contact.js`. `thauma`
  is a reserved word rather than a partner row — Thauma is the thing partners
  belong to, so a slug join could never find it, and a real row would need
  excluding from every partner list and count in the system.
- Honeypot, per-IP rate limit and a hashed IP, shared with the sign-up form's
  counter so switching between the two does not reset the allowance.

**Thauma's own contact page now reads the same configuration.** `CONTACT_TO`
and `CONTACT_FROM` in `wrangler.toml` still work as a fallback, but the
organisation has a row like everybody else — so changing where site messages go
is no longer a deploy.

**Both public forms share one stylesheet** (`workers/src/lib/embed-form.js`).
They must look like the same ministry sent them, and two files that started
identical do not stay that way.

## The composer  (2026-08-21)

**Staff → Mailing → Composer.** One column, in the console's own colours,
running TipTap.

**The toolbar tells the truth.** A button is lit when the cursor is inside that
formatting, and it updates on cursor movement alone — click into bold text
without typing and Bold lights up. That is `test/composer-toolbar.test.mjs`,
which runs in `npm test` and both deploy workflows against the **built bundle**,
so a build that stopped shipping the editor fails before it ships.

Bold, italic, underline, strikethrough, two sizes, your brand colour, headings,
lists, quotes, links, pictures, dividers. Nothing else — everything offered has
to be something email actually renders.

**There is no live preview, on purpose.** There was one, and its own warning
label was the argument against it: a browser is not a mail client, so it could
only ever check layout, while **Send me a test** shows the real message in a
real inbox. Two answers to one question, and the misleading one was the one
always on screen.

What survived it is the **size readout** in the top bar, because nothing else
warns: Gmail cuts a message off at about 102KB and shows "Message clipped", and
because the cut can land mid-tag, everything after it can fail to render. It
measures the full rendered email — shell, inline styles and Outlook block — not
just what you typed.

**No To field, and no Cc or Bcc.** This sends to a list, and every subscriber
gets their own separate message with their own unsubscribe link. One message to
many could carry only one such link; a typed address would bypass double
opt-in; bulk Bcc is a spam signal that would damage the sending domain for
every list on it.

**Pictures and attachments are different things**, and the UI keeps them apart.
A picture goes *in* the message and is fetched by the reader's mail client from
a URL — cheap, any size, shrunk to 1200px and stored as JPEG because Outlook
2016 cannot display WebP. An attachment travels *with* the message in every
copy sent, so it is capped at 2MB, handed to Resend separately, and never
touches the HTML.

**Why it changed three times.** The first version ran on
`document.execCommand`; the second on Markdown in a textarea. The first one's
real failure was not its bugs but that nothing could see them — `execCommand`
does not exist outside a real browser and the code caught the error, so every
passing test proved a button called a function and never that pressing Bold
made anything bold. The second was testable and reliable but felt like writing
in syntax and reading the result somewhere else. TipTap is the version where
both are true.

**One build step**, and only one. `src/editor/` is bundled to
`src/js/composer.bundle.js` by the Eleventy build itself, so CI and the Pi's
watcher both produce it without being told. Every other script in the console
is still a plain file. 125KB over the wire, on one screen, staff only.

⚠ **The bundle's output path is excluded from watching, and it is only written
when its bytes change.** Both guards matter: `src/js` is passthrough-copied and
therefore watched, so writing the bundle there looked to the watcher like an
edit — which started another build, which wrote it again, about once a second.
On 2026-08-22 that took the dev site down completely, and from the outside it
just looked like pages never finished loading. `test/composer-toolbar.test.mjs`
asserts both guards are still in place.

**Past updates** are at `/archive/<partner>/<list>/<slug>`, linked from the
footer of every mailing. A list only appears there if **Archive publicly** is on
in its Settings — newsletters are meant to be read, prayer updates name people
and are not. That is a property of the list rather than a decision to remake
every week.

**The unsubscribe link** is at the bottom of every mailing and in the
`List-Unsubscribe` header, which is what puts Gmail's and Outlook's one-click
button beside your name. It needs no sign-in and asks no questions: somebody
who cannot find the exit presses "report spam" instead, and that damages the
sending domain for everybody else the ministry writes to.

**One local gotcha, unrelated to mail:** the pinned wrangler (4.86.0) only
supports compatibility dates up to 2026-05-03, and `wrangler.toml` asks for
2026-08-04. So `npx wrangler dev --local` refuses to start until you add
`--compatibility-date=2026-05-03`. Worth knowing, because starting the Worker
is the *only* check that catches a Worker which fails to boot — the kind that
502s every route at once. `node --check` and the unit tests cannot see it.

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

**d. Let the tunnel reach it. ALREADY DONE — nothing to do here.**

The tunnel config is `~/.cloudflared/config.yml` (your home directory, no
`sudo`), not `/etc/cloudflared/config.yml`, and it has routed this correctly
since 2026-08-18. Verified 2026-08-19 by sending a signed delivery through the
public hostname: it returned `202 syncing` and the sync ran.

**e. Tell GitHub** — repo → Settings → Webhooks → Add webhook:
- Payload URL: `https://dev.thauma.one/__github-sync`
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

## Where production actually stands — 2026-08-20

**The production console had never worked, and it was not anything we shipped.**
`GITHUB_APP_PRIVATE_KEY` is a 28-line PEM, and pasting one into the Cloudflare
dashboard's secret box loses the newlines. The secret still stores, still lists,
and never works. Everything backed by GitHub — Content, Site, Publish — rendered
empty; everything backed only by the database worked. That pattern is what gave
it away. Fixed by piping the value instead of pasting it:
`node deploy/set-production-github-secrets.mjs`.

Production now has: all 14 migrations, your admin account, the Chase Roush
partner, English enabled. The public site is healthy and the embed endpoint
returns a clean 404 rather than a 500.

**Still to finish:** `db/seed.production-content.sql` did not land — the
milestone, goal and prayer tables are still empty on production and the run
reported nothing here. The file's columns match production's schema exactly, so
the cause is not a schema mismatch. Pick this up before doing anything else with
production content.

---

## THE BIG ONE, for a fresh day

You said it plainly:

> "I want the dev site and live sites to match content once the dev site
> publishes. It's meant to be a full testing site."

**That is not how it works, and it is a design gap rather than a bug.** Two
kinds of content travel differently:

- **Words** (`src/_data/`) live in git. Publish carries them. This works.
- **Records** (milestones, goals, prayer, partners, staff profiles) live in the
  database. `dev` and `next` read `thauma-ops-dev`; the live site reads
  `thauma-ops`. **Publish has never moved a database row and cannot today.**

That is why production's roadmap was empty while dev's was full. Nothing was
broken; the two halves were never connected.

Making publishing carry records is real work and needs decisions first — which
side authors, what happens when both change, and how the test fixtures (Mira)
and supporter PII are kept out of the trip. `db/refresh_dev.py` already scrubs
names and emails when copying production DOWN to dev; anything going UP must not
run that pipe backwards.

---

## Save now reaches the dev site — fixed 2026-08-19

**The complaint was right every time.** You pressed Save, the words went to
GitHub, and dev.thauma.one did not change. Nothing was ever broken and nothing
was ever lost — the edit was safely on `main` within a second. The gap was
that the Pi's copy of the site sits on the `dev` branch, content is always
written to `main` (deliberately — one copy of the words, so publishing never
needs a merge), and the sync only ever compared `dev` against `dev`. It ran
every five minutes, correctly found nothing, and reported success.

`deploy/git-sync.sh` now also brings `main`'s content across. So:

**Press Save, and within five minutes dev.thauma.one shows it. No terminal.**

It is deliberately narrow. It merges `main` only when everything `main` has
that `dev` does not is confined to `src/_data/` — the files nothing but the
content editor writes. If `main` carries code as well, it refuses and says so,
because that is a publish in flight and not a script's decision. It also
refuses to touch a working tree with uncommitted changes. `npm test` runs
`deploy/test-git-sync.sh`, which builds real repositories and checks that each
of those refusals actually refuses.

### To make it instant instead of five minutes

Two things are still undone from section 5, and until both are done the timer
is what is covering you.

1. ~~The tunnel is not routing the webhook.~~ **It is.** I tested the wrong
   address. The path is `/__github-sync`, not `/_sync`, and the config lives in
   `~/.cloudflared/config.yml`, not `/etc/cloudflared/`. A signed delivery to
   `https://dev.thauma.one/__github-sync` returns `202 syncing`.
2. **GitHub is not sending anything yet.** Section 5(e). The receiver has had
   no delivery from GitHub since it started.

---

## Also fixed on 2026-08-19 — nothing for you to do, but worth knowing

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

## The staff pages are edited from the People page now

Open a person on `/admin/users/` and there is a **Staff page** section in their
panel. Switch **Shown on the staff pages** on and you get their title, bio (two
languages side by side), region, public email, order and web address. Board
members leave it off; that is what it is for.

Saving writes it immediately and **does not change the live site** — same as
every other edit. The site catches up when you press Publish.

The list sorts by name, region, partner, role or status. Anyone without the
sorted-on value goes to the bottom rather than the top.

**Photos are not in there yet**, and the panel says so. They need somewhere to
live, which is the next item.

---

## Two things for you, when you are at a computer

### 0. FIRST: give the deploy token permission to see R2

**Preview failed, and Publish will fail the same way until this is done.**

Adding the photo bucket to `wrangler.toml` means every deploy now asks the
Cloudflare API about `thauma-media`. The token GitHub Actions uses cannot:

```
A request to the Cloudflare API (/accounts/…/r2/buckets/thauma-media) failed.
Authentication error [code: 10000]
```

The bucket is fine and in the right account — the same command from the Pi
lists it. It is only the CI token that is short a permission.

1. **dash.cloudflare.com → My Profile → API Tokens**
2. Edit the token used by GitHub Actions (it is the value of the repository
   secret `CLOUDFLARE_API_TOKEN`)
3. Add permission: **Account → Workers R2 Storage → Edit**
4. Save

If you cannot tell which token it is, make a new one with Workers Scripts:Edit,
Workers R2 Storage:Edit, D1:Edit and Workers KV Storage:Edit, then replace the
repository secret at **github.com/thauma-one/thauma-site → Settings → Secrets
and variables → Actions → `CLOUDFLARE_API_TOKEN`**.

Then press **Preview** again.

**How long it takes:** the failed run reached the deploy step in 39 seconds,
having done checkout, install, build and the whole test suite. A successful one
is about a minute. If nothing has changed after three, something is wrong —
look at **github.com/thauma-one/thauma-site/actions**, which is where the
reason always is.

---

### 1. Merge, THEN apply, THEN publish — in that order

**Correcting what this file said before.** It told you to apply the migrations
before publishing, which skipped a step: the Apply button reads the migration
files from `main`, and everything built recently is on `dev`. Until `dev` is
merged, the Publish page has nothing to offer you and correctly says there is
nothing to do — which is what you were looking at.

**The database panel is not a separate thing to find.** It is the amber box on
the Publish page, the one that currently reads *"This release touches the
database… the live database has already run everything it needs."* That is
true right now, and will change to an **Apply** button once step (a) is done.

```
cd /DATA/AppData/thauma
git checkout main && git pull
git merge dev --no-edit
git push origin main
git checkout dev
```

**Merging deploys nothing.** The production workflow only runs when the Publish
button asks it to — the comment at the top of `.github/workflows/deploy.yml`
says so. Safe at any hour.

Then, on the Publish page:

- **b.** The amber box now offers **Apply**. Press it, type `MIGRATE`.
  - `0013` puts Slovenian in the language catalogue. Until it runs, Slovenian
    is live on the public site and no partner can write content in it.
  - `0014` adds the staff profile tables. The Staff page section cannot save
    without it.
- **c.** Press **Preview**, look at `next.thauma.one`.
- **d.** Press **Publish**.

Schema first, code second. New code that expects a table which is not there
breaks the moment it deploys; a database slightly ahead of the code breaks
nothing.

### 2. One webhook, and Save becomes instant

**No `sudo`, and no file to edit.** I had this wrong twice: the tunnel config is
`~/.cloudflared/config.yml` in your home directory — not `/etc/cloudflared/` —
and it has been routing the webhook correctly since 18 August. The path is
`/__github-sync`, not `/_sync`. I tested the wrong address and reported it
broken. It is not.

Verified 2026-08-19: a signed delivery to `https://dev.thauma.one/__github-sync`
returns `202 syncing`, and the Pi ran the sync.

**So the only thing missing is telling GitHub to call it.**

Get the secret:

```
grep GITHUB_WEBHOOK_SECRET ~/.config/thauma-sync.env
```

Then **github.com/thauma-one/thauma-site → Settings → Webhooks → Add webhook**:

| Field | Value |
|---|---|
| Payload URL | `https://dev.thauma.one/__github-sync` |
| Content type | `application/json` |
| Secret | the value you just copied |
| Events | **Just the push event** |
| Active | ✅ |

GitHub sends a test delivery the moment you save it. Open the webhook →
**Recent Deliveries** and you want a green tick with `202 syncing`.

If it shows `401 bad signature`, the secret does not match — re-copy it and
watch for a trailing space. That is the only failure mode left; the path and
the listener are both confirmed working.

---

### 3. The R2 bucket — done, and wired

`thauma-media` exists and is bound in all three environments. The uploader is
built: choose a photo on a person's Staff page section and the browser resizes
it to 1600px and converts it to WebP before anything is sent, so a 12MP photo
does not become a 12MP upload. Replacing is just choosing another one.

**⚠ Worth knowing before you press create:** this lands in your PERSONAL
Cloudflare account, like everything else Cloudflare-side. R2 does not transfer
between accounts, so when Thauma gets its own account this bucket has to be
recreated and the files copied across. Photos are the least painful thing to
move — far easier than a database — so this is a note, not a reason to wait.

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
