#!/usr/bin/env bash
# git-sync.sh — bring the Pi's working copy up to date with GitHub
#
# ONE SCRIPT, TWO TRIGGERS. The webhook calls it the moment something is
# pushed; the timer calls it every few minutes in case the webhook never
# arrived. Both run exactly this, so there is no "it works when the timer does
# it" class of bug.
#
# WHY IT HAS TO EXIST
# -----------------------------------------------------------------------------
# The content editor commits from the website. That means the repository can
# change without anybody touching this machine — and until this existed, the
# Pi's folder simply went stale and stayed stale. A system where one surface
# can write somewhere another surface cannot read is broken, and this is the
# read.
#
# --ff-only IS THE SAFETY, NOT A PREFERENCE
# -----------------------------------------------------------------------------
# It refuses anything that is not a clean fast-forward. If there is work in
# progress here that would conflict, the pull FAILS and changes nothing, which
# is the correct outcome for an unattended script running every five minutes.
# A `git pull` that merges, or worse rebases, on a timer would eventually eat
# somebody's afternoon.
#
# IT BRINGS THE WORDS ACROSS, TOO
# -----------------------------------------------------------------------------
# Content is edited on CONTENT_BRANCH (`main`) in every environment, but this
# machine's checkout normally sits on `dev`. Syncing a branch against its own
# upstream therefore never saw content edits at all: Save worked, the words
# reached GitHub, and dev.thauma.one went on showing the old text. See the
# section below for the rules — it is deliberately narrow.
#
# IT PUSHES TOO, AND ONLY COMMITS
# -----------------------------------------------------------------------------
# The pull half was built first and the push half was not, so work committed on
# this machine sat here until somebody remembered to push it. On 2026-08-17
# nineteen commits had been waiting long enough that the live branch had the
# site's WORDS and none of the code that rendered them.
#
# What it pushes is COMMITS, never edits. Auto-pushing every file change would
# publish half-written code, break the build for everyone else, and fill the
# history with commits nobody wrote a message for. Committing stays a decision;
# getting the commit to GitHub does not have to be.
#
# Exit codes: 0 nothing to do or synced cleanly; 1 refused (needs a human).
#
# Tested by deploy/test-git-sync.sh, which runs in `npm test`. Change the rules
# below and that is where you prove the refusals still refuse.
set -uo pipefail

REPO="${THAUMA_REPO:-/DATA/AppData/thauma}"
cd "$REPO" || { echo "sync: no repo at $REPO"; exit 1; }

log() { echo "[git-sync $(date -Is)] $*"; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse HEAD)"

if ! git fetch --quiet origin 2>/dev/null; then
  log "fetch failed — network or credentials. Nothing changed."
  exit 1
fi

UPSTREAM="origin/$BRANCH"
if ! git rev-parse --verify --quiet "$UPSTREAM" >/dev/null; then
  log "no $UPSTREAM — branch is local only, nothing to sync"
  exit 0
fi

# ---- push: commits made here that GitHub has not got -----------------------
#
# Before the pull, deliberately. If both sides have moved the merge below
# refuses and stops — and it is better to have sent our work first than to have
# it sitting here while somebody works out the divergence.
AHEAD="$(git rev-list --count "$UPSTREAM..$BRANCH" 2>/dev/null || echo 0)"
BEHIND="$(git rev-list --count "$BRANCH..$UPSTREAM" 2>/dev/null || echo 0)"

if [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -gt 0 ]; then
  log "REFUSED to push: $BRANCH and $UPSTREAM have both moved ($AHEAD here, $BEHIND there). This needs a person."
elif [ "$AHEAD" -gt 0 ]; then
  # --no-force, and no --set-upstream: this may only fast-forward the remote.
  # An unattended script must never be able to overwrite what is on GitHub.
  if git push --quiet origin "$BRANCH" 2>/dev/null; then
    log "pushed $AHEAD commit(s) to $UPSTREAM"
  else
    log "push failed — network or credentials. Nothing was lost; it is still committed here."
  fi
fi

# Uncommitted work is the one case where pulling could destroy something. Say
# so plainly and stop; the timer will try again once it is committed or stashed.
# Checked once, here, because both the pull below and the content merge after it
# would be unsafe with a dirty tree.
if ! git diff --quiet || ! git diff --cached --quiet; then
  # Only worth saying if there was actually something to bring in.
  if [ "$(git rev-parse "$UPSTREAM")" != "$BEFORE" ]; then
    log "REFUSED: uncommitted changes in the working tree. Commit or stash them."
    exit 1
  fi
  exit 0
fi

# ---- pull: our own branch ---------------------------------------------------
if [ "$(git rev-parse "$UPSTREAM")" != "$BEFORE" ]; then
  if ! git -c advice.diverging=false merge --ff-only "$UPSTREAM" --quiet 2>/dev/null; then
    log "REFUSED: $BRANCH and $UPSTREAM have diverged. This needs a person."
    exit 1
  fi
fi

# ---- pull: the WORDS, which do not live on this branch ----------------------
#
# WHY THIS EXISTS
# -----------------------------------------------------------------------------
# Content is edited in exactly one place: CONTENT_BRANCH, which is `main` in
# every environment (wrangler.toml says why — one copy of the words, so that
# publishing never needs a merge). The Pi's checkout normally sits on `dev`, and
# everything above this line syncs a branch against its OWN upstream. So the
# sequence was: press Save, the words land on main, this script runs, correctly
# finds nothing on dev, and dev.thauma.one goes on showing the old text.
#
# Nothing was broken and nothing was lost — the edit was always safely on main —
# but "I pressed Save and the site did not change" is the most repeated
# complaint about this system, and it was right every time. This is the half
# that was missing.
#
# NARROW ON PURPOSE
# -----------------------------------------------------------------------------
# It merges main only when everything main has that we do not is confined to
# CONTENT_PATHS. Code on main is somebody's publish in flight, and an
# unattended script has no business merging that into a working branch. That
# judgement is exactly what --ff-only protects everywhere else, and it still
# does: this is a deliberate, bounded exception for files nobody writes by hand.
CONTENT_BRANCH="${THAUMA_CONTENT_BRANCH:-main}"
CONTENT_PATHS='^src/_data/'

if [ "$BRANCH" != "$CONTENT_BRANCH" ] \
   && git rev-parse --verify --quiet "origin/$CONTENT_BRANCH" >/dev/null; then

  INCOMING="$(git rev-list --count "HEAD..origin/$CONTENT_BRANCH" 2>/dev/null || echo 0)"

  if [ "$INCOMING" -gt 0 ]; then
    BASE="$(git merge-base HEAD "origin/$CONTENT_BRANCH")"
    # What main carries that we do not, ignoring anything we already have.
    OTHER="$(git diff --name-only "$BASE" "origin/$CONTENT_BRANCH" | grep -vE "$CONTENT_PATHS" || true)"

    if [ -n "$OTHER" ]; then
      log "not merging $CONTENT_BRANCH: it carries more than content ($(echo "$OTHER" | tr '\n' ' ' | cut -c1-90)). A person should decide about that."
    elif git -c advice.diverging=false merge --no-edit --quiet \
           -m "Merge content from $CONTENT_BRANCH" "origin/$CONTENT_BRANCH" 2>/dev/null; then
      log "merged content from $CONTENT_BRANCH ($INCOMING commit(s))"
      if git push --quiet origin "$BRANCH" 2>/dev/null; then
        log "pushed the content merge to $UPSTREAM"
      else
        log "content merge is committed here; the push failed. Nothing was lost."
      fi
    else
      git merge --abort >/dev/null 2>&1 || true
      log "REFUSED: merging $CONTENT_BRANCH conflicts with $BRANCH. This needs a person."
    fi
  fi
fi

AFTER="$(git rev-parse HEAD)"
if [ "$AFTER" = "$BEFORE" ]; then
  exit 0
fi

CHANGED="$(git diff --name-only "$BEFORE" "$AFTER")"
log "updated $BRANCH: ${BEFORE:0:7} -> ${AFTER:0:7} ($(echo "$CHANGED" | wc -l) files)"

# STALE OUTPUT. Eleventy never deletes a page it has stopped generating, so
# turning one off in Site settings leaves the old HTML on disk and dev
# .thauma.one goes on serving it. Measured 2026-08-16.
#
# Only when site.json actually changed: that is the only edit that can remove a
# page, and blowing away _site on every content change would make the dev site
# blink for no reason.
if echo "$CHANGED" | grep -q '^src/_data/site\.json$'; then
  log "site.json changed — clearing _site so removed pages actually disappear"
  rm -rf "$REPO/_site"
  # The watcher rebuilds on the next source event; give it one.
  touch "$REPO/src/_data/site.json"
fi

exit 0
