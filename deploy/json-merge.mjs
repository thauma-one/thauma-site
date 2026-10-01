#!/usr/bin/env node
/**
 * json-merge.mjs — merging the site's word files entry by entry
 *
 * Chase, 2026-09-30: "The challenge occurs when we have someone editing a
 * file on the live site (like a staff user) while I'm editing the dev site.
 * So we almost need this timestamp cross referencing system in place for all
 * actions so things can be added and in sync without removing data."
 *
 * WHY. Words live in JSON files (src/_data/**). Git merges them as LINES, so
 * two edits to different entries that happen to sit on neighboring lines —
 * a staff member's on main, a new key added on dev — conflict, and the
 * ten-minute sync that brings main into dev fails and waits for a person.
 * Nothing about those edits actually disagrees.
 *
 * WHAT THIS DOES. A git merge driver (.gitattributes: merge=jsonentries).
 * It reads base, ours and theirs as JSON and merges them as a tree:
 *   · an entry changed on one side only        -> that side's value
 *   · an entry added on either side            -> kept
 *   · an entry removed on one side, untouched on the other -> removed
 *   · THE SAME ENTRY CHANGED ON BOTH SIDES     -> the value set MOST
 *     RECENTLY wins: each side's history of the file is walked back to the
 *     commit that set that value, and the later commit's time decides. The
 *     value that lost is written to the merge report, which the sync puts
 *     into the merge commit's message — replaced, never silently.
 * Lists (a page's taunts, a set of radio lines) are one value each: two
 * people reordering a list is not something to interleave.
 *
 * A side that is not valid JSON, or anything unexpected, exits 1 and git
 * treats the file as a normal conflict, which the sync reports and stops on.
 *
 * Wired in by .github/workflows/sync-dev.yml and deploy/git-sync.sh:
 *   git config merge.jsonentries.driver "node deploy/json-merge.mjs %O %A %B %P"
 * with THAUMA_MERGE_OURS / THAUMA_MERGE_THEIRS naming the two refs, so the
 * driver can ask each side's history when a value was set.
 */
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const GONE = undefined;

/**
 * The merge itself, pure. `pick(path, ours, theirs)` decides a real clash
 * and returns "ours" or "theirs"; every clash is also pushed to `clashes`.
 */
export function mergeJson(base, ours, theirs, pick = () => "ours", path = [], clashes = []) {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out = {};
    /* ours' order, with an entry new on theirs placed after the entry it
       followed there, so a file keeps reading the way both sides wrote it */
    const order = Object.keys(ours);
    let after = -1;
    for (const k of Object.keys(theirs)) {
      const i = order.indexOf(k);
      if (i !== -1) { after = i; continue; }
      if (k in b) continue;                 /* ours removed it: decided below */
      order.splice(after + 1, 0, k); after++;
    }
    for (const k of Object.keys(b)) if (!order.includes(k) && (k in ours || k in theirs)) order.push(k);
    for (const k of order) {
      const v = mergeJson(k in b ? b[k] : GONE, k in ours ? ours[k] : GONE, k in theirs ? theirs[k] : GONE,
        pick, path.concat(k), clashes);
      if (v !== GONE) out[k] = v;
    }
    return out;
  }
  const side = pick(path, ours, theirs);
  clashes.push({ path: path.join("."), kept: side, ours, theirs });
  return side === "theirs" ? theirs : ours;
}

/* ---------------------------------------------------- when was it set */
function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function valueAt(rev, file, path) {
  try {
    let v = JSON.parse(git(["show", `${rev}:${file}`]));
    for (const k of path) { if (!isObj(v) || !(k in v)) return GONE; v = v[k]; }
    return v;
  } catch { return GONE; }
}
/** The time (unix seconds) of the commit on `ref` that gave `path` its current value. */
export function setAt(ref, file, path) {
  const want = valueAt(ref, file, path);
  let when = 0;
  let commits;
  try { commits = git(["log", "--format=%H %ct", ref, "--", file]).trim().split("\n").filter(Boolean); }
  catch { return 0; }
  /* newest first: walk back while the value is still the one we have */
  for (const line of commits) {
    const [sha, ct] = line.split(" ");
    if (!same(valueAt(sha, file, path), want)) break;
    when = Number(ct);
  }
  return when;
}

/* ----------------------------------------------------------------- CLI */
function main([basePath, oursPath, theirsPath, file]) {
  let base, ours, theirs;
  try {
    const read = (p) => JSON.parse(readFileSync(p, "utf8") || "{}");
    base = read(basePath); ours = read(oursPath); theirs = read(theirsPath);
  } catch (e) {
    console.error(`json-merge: ${file} is not JSON on every side (${e.message}); leaving it to git.`);
    return 1;
  }
  const oursRef = process.env.THAUMA_MERGE_OURS || "HEAD";
  const theirsRef = process.env.THAUMA_MERGE_THEIRS || "MERGE_HEAD";
  const pick = (path) => {
    const a = setAt(oursRef, file, path), b = setAt(theirsRef, file, path);
    return b > a ? "theirs" : "ours";
  };
  const clashes = [];
  const merged = mergeJson(base, ours, theirs, pick, [], clashes);
  const raw = readFileSync(oursPath, "utf8");
  writeFileSync(oursPath, JSON.stringify(merged, null, 2) + (raw.endsWith("\n") ? "\n" : ""));
  if (clashes.length) {
    let gitDir = ".git";
    try { gitDir = git(["rev-parse", "--git-dir"]).trim(); } catch { /* keep the default */ }
    const lines = clashes.map((c) => {
      const lost = c.kept === "ours" ? c.theirs : c.ours;
      const from = c.kept === "ours" ? theirsRef : oursRef;
      return `  ${file} › ${c.path}: kept the newer value; replaced ${from}'s ${JSON.stringify(lost)}`;
    });
    appendFileSync(`${gitDir}/thauma-merge-report`, lines.join("\n") + "\n");
    console.error(lines.join("\n"));
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
