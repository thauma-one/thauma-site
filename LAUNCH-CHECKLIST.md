# THAUMA LAUNCH CHECKLIST — Zero to Live, In Order

Follow top to bottom. Nothing here assumes an account exists until
this document creates it. Each step ends with a ✅ check so you know
it worked before moving on. Exact button names may drift slightly as
these companies update their dashboards — the *sequence* is what
matters.

Have ready: a credit card (~$15 total today), your personal email,
your phone (for 2FA), and the thauma-site.zip unzipped on your
computer.

---

## PART 0 — Password vault (10 min)

1. Go to bitwarden.com → Create account (free) with your personal
   email. Choose one strong master password — this is the only
   password you'll ever memorize again.
2. Install the Bitwarden browser extension.
3. RULE FOR THE REST OF THIS DOCUMENT: every account you create below
   gets a Bitwarden-generated password and gets saved to the vault
   immediately. Every 2FA recovery code gets pasted into that entry's
   notes.

✅ You can log into Bitwarden in your browser extension.

---

## PART 1 — Buy the domain (15 min)

1. Go to namecheap.com → create an account (personal email is fine
   here — this account just *owns* the domain).
2. Search "thauma.one" → add to cart → checkout. Decline every upsell
   (no Private Email, no premium DNS, no SSL — you get all of that
   free elsewhere).
3. After purchase: Dashboard → Domain List → thauma.one → Manage.
   - Turn ON auto-renew.
   - Confirm the domain lock / transfer lock is ON.
   - Confirm WHOIS privacy ("Domain Privacy") is ON (free at
     Namecheap).

✅ thauma.one appears in your Namecheap Domain List with auto-renew on.

---

## PART 2 — Cloudflare takes over DNS (20 min + waiting)

Namecheap owns the domain; Cloudflare will *operate* it (DNS, email,
future redirects). 

1. Go to cloudflare.com → Sign up (personal email for now — you can't
   have an @thauma.one address until this very step is done. Chicken,
   meet egg).
2. "Add a domain" → type thauma.one → select the **Free** plan.
3. Cloudflare scans for existing DNS records (there won't be any —
   fine) → Continue.
4. Cloudflare shows you TWO NAMESERVERS (names like
   ada.ns.cloudflare.com). Keep this tab open.
5. New tab: Namecheap → Domain List → thauma.one → Manage →
   find NAMESERVERS → change "Namecheap BasicDNS" to **Custom DNS** →
   paste Cloudflare's two nameservers → save (green checkmark).
6. Back in Cloudflare: click "Check nameservers" / Continue. Now you
   wait — usually under an hour, occasionally longer. Cloudflare
   emails you when the domain goes Active. Continue to Part 3's
   step 1-4 while waiting; stop before step 5.

✅ Cloudflare dashboard shows thauma.one as **Active**.

---

## PART 3 — Email routing: hello@thauma.one (15 min)

Requires Part 2 to show Active.

1. Cloudflare dashboard → thauma.one → **Email** → Email Routing →
   Get started / Enable.
2. Destination address: your personal email → Cloudflare sends a
   verification email → click the link in it.
3. Create custom addresses:
   - hello@thauma.one → forwards to your personal email
   - admin@thauma.one → forwards to your personal email
4. If it asks to "add the required DNS records automatically" — yes.
5. TEST: from any other account, send an email to hello@thauma.one.

✅ The test email lands in your personal inbox.

---

## PART 4 — GitHub organization + the code (30 min)

1. If you don't have a personal GitHub account, create one at
   github.com (personal email). If you have one (chaseroush.com
   lives somewhere), use it — your personal account will be a
   *member* of the org; the org owns the code.
2. Top-right + menu → "New organization" → Free plan →
   Organization name: **thauma** (or thauma-one if taken) →
   Contact email: admin@thauma.one (it works now — Part 3!).
3. In the new org: "New repository" → name: **thauma-site** →
   Private → do NOT initialize with a README → Create.
4. Get the code in. Easiest path, no git required:
   - On the empty repo page, click "uploading an existing file".
   - Open your unzipped thauma-site folder, select ALL its contents
     (the src folder, netlify folder, netlify.toml, package.json,
     README.md, etc. — the contents, not the folder itself).
   - Drag them into the browser window → wait for uploads →
     Commit changes.
   - NOTE: browser upload can silently skip hidden files. After
     committing, check the repo file list for **.eleventy.js** and
     **.gitignore**. If either is missing, "Add file → Create new
     file", name it exactly, and paste its contents from your local
     copy.
5. (The Pi will replace this upload flow with proper git later —
   today, the browser is fine.)

✅ Repo shows src/, netlify/, netlify.toml, package.json, .eleventy.js.

---

## PART 5 — Netlify: the site goes live (30 min)

1. Go to netlify.com → Sign up → **Continue with GitHub** → authorize.
   (Signing up via GitHub avoids yet another password and makes the
   repo connection automatic.)
2. "Add new site" → "Import an existing project" → GitHub → select
   the **thauma** organization → pick **thauma-site**. If the org
   doesn't appear, click "Configure Netlify on GitHub" and grant it
   access to the org.
3. Build settings: leave everything default — the repo's netlify.toml
   already declares the build command and publish folder. Deploy.
4. Watch the first deploy (1–2 min). When it's green, click the
   generated URL (something.netlify.app).

✅ The site loads and lands on /en/ with the THAUMA wordmark.

5. Custom domain: Site configuration → Domain management →
   "Add a domain" → thauma.one → Netlify tells you what DNS records
   to create (typically an A/ALIAS or CNAME for the apex, and
   www if you want it).
6. Cloudflare → thauma.one → DNS → Records → add exactly what Netlify
   asked for. **IMPORTANT: click the orange cloud on those records so
   it turns GREY ("DNS only").** Netlify runs its own CDN and SSL;
   proxying through Cloudflare's orange cloud on top of it causes
   redirect loops and certificate errors.
7. Back in Netlify: wait for domain verification, then for the free
   SSL certificate to provision (minutes to an hour).
8. While you're in Netlify, two settings that save credits:
   - Build & deploy → Branches and deploy contexts → production
     branch = main; branch deploys = None; deploy previews = None.

✅ https://thauma.one loads the site with a padlock, and visiting the
   bare domain redirects you to /en/.

---

## PART 6 — Identity, admin, staff (30 min)

1. Netlify → your site → Integrations (or Extensions) → search
   **Identity** → Enable Identity.
2. Identity settings:
   - Registration: **Invite only**.
   - Services → **Enable Git Gateway**.
3. Identity tab → "Invite users" → invite admin@thauma.one (it
   forwards to you) → open the invite email → **the accept link must
   be opened on your live site** — if the link dumps you on the
   homepage with a long #invite_token in the URL, go to
   https://thauma.one/admin/ and it will prompt you to complete
   signup → set a password (Bitwarden!).
4. Go to https://thauma.one/admin/ → log in → you should see
   "Site Copy (by language)" and "Site Settings".
5. TEST THE PIPELINE: open Site Copy → English → change one word
   (e.g., a footer line) → Publish → within ~2 minutes the live site
   shows the change. This proves CMS → GitHub → Netlify all work.
6. Visit https://thauma.one/staff/ → Sign In with the same login →
   the placeholder staff cards appear.

✅ An /admin edit appears on the live site; /staff shows content after
   login.

---

## PART 7 — Contact form check (10 min)

1. On the live site, go to Contact → submit a test message.
2. Netlify → your site → Forms → the submission appears.
3. Forms → Settings → Form notifications → Add notification →
   Email → hello@thauma.one. Future submissions now land in your
   inbox.

✅ Test submission visible in Netlify AND notification configured.

---

## PART 8 — Housekeeping (10 min)

1. Bitwarden audit: Namecheap, Cloudflare, GitHub (+org), Netlify,
   Netlify Identity — all saved, all with 2FA enabled where offered,
   recovery codes in notes.
2. Send yourself one email FROM your personal address TO
   hello@thauma.one titled "Thauma credentials live in Bitwarden" —
   future-you's breadcrumb.
3. Keep the Namecheap receipt (founder contribution / reimbursable
   once the nonprofit exists).

✅ Done. The site is live, editable from /admin, and costs $0/month.

---

## What's deliberately NOT today

- The Pi / Claude Code / branches — separate session, separate guide
  (thauma-pi-dev-guide.md). Until then, edit via /admin or GitHub's
  web editor; every save deploys automatically.
- Donorbox — decide provider later; paste the URL into /admin →
  Site Settings when ready.
- Photos, logo, Events — all /admin-editable when the assets exist.
- thauma.hr, thauma.ngo — post-registration checklist.
