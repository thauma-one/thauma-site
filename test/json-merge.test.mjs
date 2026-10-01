#!/usr/bin/env node
/**
 * Merging the word files entry by entry (deploy/json-merge.mjs)
 *   node test/json-merge.test.mjs
 *
 * The case this exists for: a staff member edits words on the live site
 * (main) while dev adds or edits words of its own. As lines, neighboring
 * edits conflict and the sync stops; as entries, they never disagreed. And
 * when the same entry really was changed on both sides, the newer value wins
 * and the older one is reported, not lost in silence.
 *
 * The second half runs real git in a temporary directory, with the driver
 * wired exactly as the sync wires it, so the seam is tested, not just the
 * function.
 */
import { mergeJson } from "../deploy/json-merge.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

console.log("word files merge entry by entry\n");

check("different entries changed on each side: both kept", () => {
  const base = { nav: { about: "About", give: "Give" }, home: { h1: "Hi" } };
  const ours = { nav: { about: "About us", give: "Give" }, home: { h1: "Hi" } };
  const theirs = { nav: { about: "About", give: "Give" }, home: { h1: "Hello" } };
  eq(mergeJson(base, ours, theirs), { nav: { about: "About us", give: "Give" }, home: { h1: "Hello" } }, "merged");
});

check("an entry new on either side is kept, in the place it was written", () => {
  const base = { a: 1, c: 3 };
  const ours = { a: 1, b: 2, c: 3 };
  const theirs = { a: 1, c: 3, d: 4 };
  const out = mergeJson(base, ours, theirs);
  eq(Object.keys(out), ["a", "b", "c", "d"], "order");
});

check("removed on one side and untouched on the other: removed", () => {
  eq(mergeJson({ a: 1, b: 2 }, { a: 1 }, { a: 1, b: 2 }), { a: 1 }, "ours removed");
  eq(mergeJson({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 }), { a: 1 }, "theirs removed");
});

check("the same entry changed on both sides: the picker decides, and it is reported", () => {
  const clashes = [];
  const out = mergeJson({ t: "x" }, { t: "ours" }, { t: "theirs" }, () => "theirs", [], clashes);
  eq(out, { t: "theirs" }, "picked");
  eq(clashes.map((c) => c.path), ["t"], "reported");
});

check("a list is one value, never interleaved", () => {
  const clashes = [];
  mergeJson({ l: [1, 2] }, { l: [2, 1] }, { l: [1, 2, 3] }, () => "ours", [], clashes);
  eq(clashes.length, 1, "a real clash, not a splice");
});

/* ------------------------------------------------ real git, real driver */
const DRIVER = fileURLToPath(new URL("../deploy/json-merge.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "thauma-json-merge-"));
const git = (args, env = {}) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, ...env },
  stdio: ["ignore", "pipe", "pipe"] });
const at = (t) => ({ GIT_AUTHOR_DATE: t, GIT_COMMITTER_DATE: t });
const FILE = "src/_data/i18n/en.json";
const write = (obj) => writeFileSync(join(dir, FILE), JSON.stringify(obj, null, 2) + "\n");
const read = () => JSON.parse(readFileSync(join(dir, FILE), "utf8"));

function repo(withDriver) {
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.name", "t"]); git(["config", "user.email", "t@t"]);
  mkdirSync(join(dir, "src/_data/i18n"), { recursive: true });
  if (withDriver) {
    writeFileSync(join(dir, ".gitattributes"), "src/_data/**/*.json merge=jsonentries\n");
    git(["config", "merge.jsonentries.driver", `node ${DRIVER} %O %A %B %P`]);
  }
  write({ nav: { about: "About", mission: "Mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
  git(["add", "-A"]); git(["commit", "-q", "-m", "base"], at("2026-09-01T10:00:00Z"));
  git(["checkout", "-q", "-b", "dev"]);
}
function merge(env = {}) {
  try { git(["merge", "--no-edit", "main"], { THAUMA_MERGE_OURS: "dev", THAUMA_MERGE_THEIRS: "main", ...env }); return true; }
  catch { return false; }
}

try {
  check("PLAIN GIT: neighboring edits to different entries conflict (why this exists)", () => {
    repo(false);
    write({ nav: { about: "About us", mission: "Mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
    git(["commit", "-qam", "dev edits about"]);
    git(["checkout", "-q", "main"]);
    write({ nav: { about: "About", mission: "Our mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
    git(["commit", "-qam", "staff edits mission"]);
    git(["checkout", "-q", "dev"]);
    assert(!merge(), "plain git merged it — the test no longer shows the problem");
    git(["merge", "--abort"]);
  });
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);

  check("WITH THE DRIVER: the same neighboring edits merge, both kept", () => {
    repo(true);
    write({ nav: { about: "About us", mission: "Mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
    git(["commit", "-qam", "dev edits about"]);
    git(["checkout", "-q", "main"]);
    write({ nav: { about: "About", mission: "Our mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
    git(["commit", "-qam", "staff edits mission"]);
    git(["checkout", "-q", "dev"]);
    assert(merge(), "the driver did not merge it");
    eq(read().nav, { about: "About us", mission: "Our mission", give: "Give" }, "both edits");
  });
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);

  check("the same entry on both sides: the NEWER edit wins, whichever side it is on", () => {
    repo(true);
    write({ nav: { about: "About", mission: "Mission", give: "Give" }, home: { h1: "Dev's heading", lede: "Welcome" } });
    git(["commit", "-qam", "dev heading"], at("2026-09-02T10:00:00Z"));
    git(["checkout", "-q", "main"]);
    write({ nav: { about: "About", mission: "Mission", give: "Give" }, home: { h1: "Staff's heading", lede: "Welcome" } });
    git(["commit", "-qam", "staff heading, later"], at("2026-09-02T12:00:00Z"));
    git(["checkout", "-q", "dev"]);
    assert(merge(), "did not merge");
    eq(read().home.h1, "Staff's heading", "the later edit (main's) won");
    const report = readFileSync(join(dir, ".git/thauma-merge-report"), "utf8");
    assert(report.includes("home.h1") && report.includes("Dev's heading"), "the replaced value is reported: " + report);
  });
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);

  check("…and the other way round: dev's later edit wins over main's earlier one", () => {
    repo(true);
    git(["checkout", "-q", "main"]);
    write({ nav: { about: "About", mission: "Mission", give: "Give" }, home: { h1: "Staff's heading", lede: "Welcome" } });
    git(["commit", "-qam", "staff heading, earlier"], at("2026-09-02T10:00:00Z"));
    git(["checkout", "-q", "dev"]);
    write({ nav: { about: "About", mission: "Mission", give: "Give" }, home: { h1: "Dev's heading", lede: "Welcome" } });
    git(["commit", "-qam", "dev heading, later"], at("2026-09-02T12:00:00Z"));
    assert(merge(), "did not merge");
    eq(read().home.h1, "Dev's heading", "the later edit (dev's) won");
  });
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);

  check("a file that is not JSON on one side is left to git as a real conflict", () => {
    repo(true);
    writeFileSync(join(dir, FILE), "{ not json");
    git(["commit", "-qam", "broken on dev"]);
    git(["checkout", "-q", "main"]);
    write({ nav: { about: "About", mission: "Our mission", give: "Give" }, home: { h1: "Hello", lede: "Welcome" } });
    git(["commit", "-qam", "staff edit"]);
    git(["checkout", "-q", "dev"]);
    assert(!merge(), "it guessed at a broken file");
    git(["merge", "--abort"]);
  });
} finally {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
