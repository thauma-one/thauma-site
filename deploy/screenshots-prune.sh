#!/usr/bin/env bash
#
# Keeps screenshots/ from growing without bound. Two rules, in this order:
#
#   1. AGE  — delete anything older than MAX_AGE_DAYS (default 30).
#   2. SIZE — if the folder is still over MAX_BYTES (default 1 GiB), delete the
#             oldest files until it is under, so a runaway capture loop cannot
#             fill the SD card before the age rule ever applies.
#
# Age alone is not enough: animation work writes frame sequences, 30+ files at a
# time, and a full-page render at 1440x4000 is ~10x a viewport one. A single bad
# loop can write more in an hour than a normal month.
#
# README.md is never touched — it is the only tracked file in that folder and it
# documents the capture commands.
#
# Run by screenshots-prune.timer (daily). Safe by hand, and --dry-run shows what
# it would remove without removing it:
#
#   bash deploy/screenshots-prune.sh --dry-run
#
set -uo pipefail

DIR="${SCREENSHOT_DIR:-/DATA/AppData/thauma/screenshots}"
MAX_AGE_DAYS="${MAX_AGE_DAYS:-30}"
MAX_BYTES="${MAX_BYTES:-1073741824}"   # 1 GiB
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

[[ -d "$DIR" ]] || { echo "no such folder: $DIR"; exit 0; }

human() { numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"; }
gone=0; freed=0

rm_file() {  # $1 path  $2 size
  if (( DRY )); then echo "  would delete $(human "$2")  $1"
  else rm -f -- "$1" && echo "  deleted $(human "$2")  $1"; fi
  gone=$((gone+1)); freed=$((freed+$2))
}

# Everything except README.md, oldest first, as "<mtime> <size> <path>".
list_files() {
  find "$DIR" -type f ! -name 'README.md' -printf '%T@ %s %p\n' 2>/dev/null | sort -n
}

echo "pruning $DIR (age > ${MAX_AGE_DAYS}d, then size > $(human "$MAX_BYTES"))"

# ---- 1. age
cutoff=$(( $(date +%s) - MAX_AGE_DAYS * 86400 ))
while read -r ts size path; do
  (( ${ts%.*} < cutoff )) && rm_file "$path" "$size"
done < <(list_files)

# ---- 2. size
total=$(list_files | awk '{s+=$2} END {print s+0}')
if (( total > MAX_BYTES )); then
  echo "  over cap: $(human "$total")"
  while read -r ts size path; do
    (( total <= MAX_BYTES )) && break
    rm_file "$path" "$size"
    total=$((total - size))
  done < <(list_files)
fi

# Empty subfolders left behind by a frame sequence are noise; the folder itself stays.
find "$DIR" -mindepth 1 -type d -empty -delete 2>/dev/null

remaining=$(list_files | awk '{s+=$2} END {print s+0}')
count=$(list_files | wc -l)
echo "done: removed $gone file(s), freed $(human "$freed"); $count file(s), $(human "$remaining") left"
