# The app — a plan to decide from, not a build yet

Chase, 2026-10-13: "I assume that that means it is built similar to an app
for a phone, but is just a saved URL. I like that idea! We should build it
and have separate notification settings for the 'app'. … Maybe have something
for each partner that, when the page is saved, gives them a mobile version of
the prayer requests, goals, timeline, newsletter updates, other mailing
updates, etc? In a true app style format with a great UX, push notifications,
and ways to indicate that a prayer request has been acknowledged. And a giving
page. … the push notifications being the big thing. Not done automatically,
but pushed by the staff member when the page is fully updated (and a reminder
sent to the staff member to push it when it's done somehow that isn't more
words, but maybe a pop up?). And a way for the visitor to the site to know
that there is an app version of the page … And maybe a tutorial of the 'app'
once they first open it."

Also asked the same day: "Should we make a small chat function similar to
Microsoft Teams … Or an 'in app' notifications system for things similar to
the options for the email notifications?"

## What it is, technically

A **web app** (a PWA): the same site, plus a small manifest and a service
worker, so a phone can put it on the home screen with its own icon, open it
full screen without the browser's bars, keep the last-seen content for when
the signal drops, and — the big thing — **receive push notifications**.
No app store, no review, no separate code base; an update to the site is an
update to the app.

- **Android / Chrome:** installs from a prompt we can show at the right
  moment (the browser's `beforeinstallprompt`). Push works installed or not.
- **iPhone / iPad:** push works only once it is **added to the home screen**
  (iOS 16.4 or later, Safari's Share › Add to Home Screen). Apple does not let
  a page show an install button, so for iPhone the "get the app" button opens
  a two-step picture guide instead.
- **Push itself** is the Web Push standard: the browser gives us a
  subscription, we keep it (a new table), and the Worker sends to it, signed
  with a key pair of our own (VAPID — one secret, set once with wrangler; no
  outside service, no cost). The message is encrypted end to end; Cloudflare
  Workers can do the encryption with the crypto they already have.

## Three apps, one mechanism

1. **The console, as an app (staff).** Settings › Notifications gets a second
   group, "On this phone", beside "By email", with its own switches per
   notice (the same list, workers/src/lib/notify.js). New notices that fit a
   phone better than an inbox: *a message arrived through a contact form*
   (who and the subject, never the message on the lock screen), *someone
   asked to edit your site*, *a bio is waiting for approval*, *an invitation
   was accepted*. Smallest of the three; proves push end to end.

2. **A ministry's app (supporters).** Each ministry site
   (name.thauma.one) becomes installable: home, prayer, goals, timeline,
   updates (newsletters and other mailings), give — laid out as an app
   (bottom tabs, cards, pull to refresh) rather than as a web page. Its
   content is what the Site Creator already publishes, so nothing is written
   twice.
   - **Prayer, acknowledged:** "I prayed" on each request — a count the
     ministry sees ("14 people prayed"), never who. No account needed.
   - **Give:** the ministry's giving page, a tap away, as the site has it.
   - **Push, sent by the staff member, never automatic.** In the console, a
     "Tell your supporters" button: pick what changed (prayer, update,
     goal…), see the one-line notice as the phone will show it, send.
   - **The reminder that is not more words:** after a Publish in the Site
     Creator or Updates, a small pop-up — the notice already drafted from
     what changed, with Send and Not now. That is the whole reminder.
   - **"Get the app" on the site:** a quiet button in the menu (and once,
     gently, after a second visit) that installs on Android or opens the
     iPhone picture guide.
   - **First open:** a three-card walkthrough (what is here, turn on
     notifications, how to pray / give), skippable, shown once.

3. **thauma.one, and the arcade.** The same install and the same
   notifications for Thauma's own news; the arcade works offline once
   installed, which suits it well. Smallest after (1), once (2) exists.

## Order I would build it in

1. Push plumbing + the console app (1): VAPID key, service worker,
   subscriptions table, Settings › Notifications › "On this phone", a test
   send. Small; everything after stands on it.
2. A ministry's app (2), starting with prayer (with "I prayed"), updates and
   give; then the "Tell your supporters" button and the after-Publish pop-up;
   then "Get the app" and the first-open tour.
3. thauma.one and the arcade (3).

## In-app notifications and chat — my recommendation

- **In-app notifications: yes, and cheap.** A bell in the console header with
  the same notices as email and phone, unread until opened. It reuses the
  notice list; it is the natural home for "what happened while you were
  away". Worth building with step 1.
- **Teams-style chat: not now, maybe never.** Chat is a product of its own —
  real-time delivery, history, files, read receipts, moderation, and a place
  where sensitive things about supporters would be written outside
  Stewardship's protections. The team already has a chat (WhatsApp, Signal or
  similar). A lighter thing that does fit: **comments on the things
  themselves** (a prayer request, a draft mailing, a bio waiting for
  approval), which the bell would announce.

## What needs Chase's decision

1. Start with step 1 (the console app and push plumbing)? It needs one secret
   set with wrangler, which I would give you as a command.
2. For a ministry's app: is "I prayed" anonymous (a count only), or may a
   supporter add their first name?
3. Should a ministry's app be on for every ministry, or switched on per
   ministry like the site itself?
4. ~~In-app notification bell with step 1: yes or no?~~ Built 2026-10-13
   (Chase: "Add the in app notifications bell"), migration 0060.
