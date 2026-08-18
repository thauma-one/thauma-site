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

# Nothing waiting for us. The common case, and it should be silent-ish.
if [ "$(git rev-parse "$UPSTREAM")" = "$BEFORE" ]; then
  exit 0
fi

# Uncommitted work is the one case where pulling could destroy something. Say
# so plainly and stop; the timer will try again once it is committed or stashed.
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "REFUSED: uncommitted changes in the working tree. Commit or stash them."
  exit 1
fi

if ! git -c advice.diverging=false merge --ff-only "$UPSTREAM" --quiet 2>/dev/null; then
  log "REFUSED: $BRANCH and $UPSTREAM have diverged. This needs a person."
  exit 1
fi

AFTER="$(git rev-parse HEAD)"
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
