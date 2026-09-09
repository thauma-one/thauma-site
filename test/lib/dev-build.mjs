/**
 * dev-build.mjs — an UNGATED build, for tests about public pages
 *
 * WHY THIS IS NOT `npx eleventy --output=...`
 * ---------------------------------------------------------------------------
 * site.json's visibility block has two columns, live and dev, and comingSoon is
 * TRUE on the live one — so a plain build produces twenty files: the console,
 * the 404, and a coming-soon page where the site will be. Every interior page
 * is deliberately absent.
 *
 * Which column a build uses is decided by ELEVENTY_RUN_MODE, and Eleventy sets
 * that itself — `serve` or `watch` under the dev server, `build` otherwise. It
 * cannot be exported into place; src/_data/visible.js says so, and it is right.
 *
 * So the only honest way to get the dev column is to actually run the watcher.
 * It writes the site once and then waits; this kills it as soon as the file the
 * caller needs appears.
 *
 * WHAT THIS EXISTS TO PREVENT. Tests that read `_site` pass on this machine,
 * because the Pi's dev service keeps it current, and fail in CI, which builds
 * the gated site into _site_prod and has no interior pages at all. That is the
 * worst shape a test can have: green where it does not matter and red where it
 * does — or worse, green in both because it quietly skipped.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

export async function buildDevSite(outDir, waitFor, { timeoutMs = 60000, contentDir } = {}) {
  rmSync(outDir, { recursive: true, force: true });

  /* THE BINARY DIRECTLY, NOT THROUGH npx.
   *
   * npx spawns eleventy as its own child, so killing npx leaves the watcher
   * running — sixteen of them accumulated across one test run, each holding a
   * file watch on the whole project, and the suite went from seconds to
   * timing out. A watcher nobody stops is a watcher that outlives the test
   * that started it.
   *
   * detached puts it in its own process group so the kill below reaches the
   * whole tree even if it ever grows one. */
  const bin = new URL("../../node_modules/.bin/eleventy", import.meta.url).pathname;
  /* `contentDir` points the collections somewhere other than src/content, so
     a test can assert against committed fixtures without writing a single
     file into the real site. See test/fixtures/README.md. */
  const child = spawn(bin, ["--watch", `--output=${outDir}`, "--quiet"], {
    stdio: ["ignore", "pipe", "pipe"], detached: true,
    env: contentDir ? { ...process.env, THAUMA_CONTENT_DIR: contentDir } : process.env,
  });
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += String(b); });

  const target = `${outDir}/${waitFor}`;
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      if (existsSync(target)) return { ok: true, dir: outDir };
      if (child.exitCode !== null) {
        return { ok: false, error: `eleventy exited early: ${stderr.slice(-400)}` };
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { ok: false, error: `timed out waiting for ${waitFor}\n${stderr.slice(-400)}` };
  } finally {
    /* The watcher does not stop on its own. SIGTERM, then SIGKILL if it is
       still there — a test run that leaves an eleventy watching a directory
       nobody reads is a test run that slows every later one. */
    /* The GROUP, negated pid — otherwise anything eleventy spawned survives.
       Both calls are guarded: the child may already be gone. */
    const stop = (sig) => {
      try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch {} }
    };
    stop("SIGTERM");
    const hard = setTimeout(() => stop("SIGKILL"), 1500);
    hard.unref?.();
    /* Nothing should keep the test process alive waiting for it. */
    child.unref?.();
  }
}
