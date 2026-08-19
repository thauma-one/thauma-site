#!/usr/bin/env bash
# test-git-sync.sh — exercises git-sync.sh against a throwaway origin
#
#   bash deploy/test-git-sync.sh
#
# This script runs UNATTENDED every five minutes and on every push, with the
# power to merge and to push. That is exactly the kind of thing that must not
# be verified by reading it. Everything here builds a real bare repository, a
# real Pi clone on `dev` and a real second clone standing in for the content
# editor writing to `main`, then asserts on what actually happened to the
# files — not on what the script printed.
#
# The cases that matter are the REFUSALS. Anyone can make a merge happen; the
# value of this script is that it declines to merge code, declines to touch a
# dirty tree, and says so instead of failing silently.
set -uo pipefail
SCRIPT=/DATA/AppData/thauma/deploy/git-sync.sh
ROOT=$(mktemp -d); trap 'rm -rf "$ROOT"' EXIT
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "  PASS  $1"; pass=$((pass+1)); else echo "  FAIL  $1"; echo "          got: $2"; echo "          want: $3"; fail=$((fail+1)); fi; }
q(){ git -C "$1" "${@:2}" >/dev/null 2>&1; }

setup(){
  rm -rf "$ROOT"/*; mkdir -p "$ROOT"
  git init --bare -q "$ROOT/origin.git"
  git clone -q "$ROOT/origin.git" "$ROOT/pi" 2>/dev/null
  cd "$ROOT/pi"
  git config user.email t@t; git config user.name T
  mkdir -p src/_data/i18n
  echo '{"a":"old"}' > src/_data/i18n/sl.json
  echo 'code v1' > worker.js
  git add -A; git commit -qm "base"
  git branch -M main; git push -q origin main
  git checkout -qb dev; git push -q origin dev
  # a second clone standing in for the content editor writing to main
  git clone -q "$ROOT/origin.git" "$ROOT/editor" 2>/dev/null
  git -C "$ROOT/editor" config user.email e@e; git -C "$ROOT/editor" config user.name E
  git -C "$ROOT/editor" checkout -q main
}

echo "1. a content edit on main reaches the Pi's dev branch"
setup
echo '{"a":"NEW"}' > "$ROOT/editor/src/_data/i18n/sl.json"
q "$ROOT/editor" add -A; q "$ROOT/editor" commit -m "Update sl content: 1 value [skip ci]"; q "$ROOT/editor" push origin main
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1); RC=$?
ok "exit code" "$RC" "0"
ok "the words are on dev's working tree" "$(cat "$ROOT/pi/src/_data/i18n/sl.json")" '{"a":"NEW"}'
ok "the merge was pushed" "$(git -C "$ROOT/pi" rev-parse dev)" "$(git -C "$ROOT/origin.git" rev-parse dev)"
echo "$OUT" | grep -q "merged content from main" && echo "  PASS  it said so" && pass=$((pass+1)) || { echo "  FAIL  no log line"; echo "$OUT"; fail=$((fail+1)); }

echo
echo "2. CODE on main is NOT merged — that is a person's decision"
setup
echo 'code v2' > "$ROOT/editor/worker.js"
q "$ROOT/editor" add -A; q "$ROOT/editor" commit -m "change code on main"; q "$ROOT/editor" push origin main
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1); RC=$?
ok "exit code" "$RC" "0"
ok "dev's code is untouched" "$(cat "$ROOT/pi/worker.js")" "code v1"
echo "$OUT" | grep -q "not merging main: it carries more than content" && echo "  PASS  it refused, out loud" && pass=$((pass+1)) || { echo "  FAIL  no refusal"; echo "$OUT"; fail=$((fail+1)); }

echo
echo "3. content AND code together is still refused"
setup
echo '{"a":"NEW"}' > "$ROOT/editor/src/_data/i18n/sl.json"; echo 'code v2' > "$ROOT/editor/worker.js"
q "$ROOT/editor" add -A; q "$ROOT/editor" commit -m "both"; q "$ROOT/editor" push origin main
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1)
ok "the words did NOT come across on their own" "$(cat "$ROOT/pi/src/_data/i18n/sl.json")" '{"a":"old"}'

echo
echo "4. a dirty working tree is never merged into"
setup
echo '{"a":"NEW"}' > "$ROOT/editor/src/_data/i18n/sl.json"
q "$ROOT/editor" add -A; q "$ROOT/editor" commit -m "content"; q "$ROOT/editor" push origin main
echo 'work in progress' >> "$ROOT/pi/worker.js"
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1)
ok "the in-progress edit survived" "$(tail -1 "$ROOT/pi/worker.js")" "work in progress"
ok "the words did not land" "$(cat "$ROOT/pi/src/_data/i18n/sl.json")" '{"a":"old"}'

echo
echo "5. nothing to do says nothing and exits 0"
setup
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1); RC=$?
ok "exit code" "$RC" "0"
ok "silent" "$OUT" ""

echo
echo "6. local dev commits are still pushed, and content still arrives"
setup
echo 'local work' > "$ROOT/pi/newfile.js"
q "$ROOT/pi" add -A; q "$ROOT/pi" commit -m "work done on the Pi"
echo '{"a":"NEW"}' > "$ROOT/editor/src/_data/i18n/sl.json"
q "$ROOT/editor" add -A; q "$ROOT/editor" commit -m "content"; q "$ROOT/editor" push origin main
OUT=$(THAUMA_REPO="$ROOT/pi" bash "$SCRIPT" 2>&1)
ok "the Pi's commit reached origin" "$(git -C "$ROOT/origin.git" log --oneline dev | grep -c 'work done on the Pi')" "1"
ok "and the words arrived too" "$(cat "$ROOT/pi/src/_data/i18n/sl.json")" '{"a":"NEW"}'

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
