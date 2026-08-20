#!/usr/bin/env node
/**
 * set-production-github-secrets.mjs — copy the App credential from .dev.vars
 * onto the production Worker
 *
 *   node deploy/set-production-github-secrets.mjs
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * GITHUB_APP_PRIVATE_KEY is a multi-line PEM. Pasting one into the Cloudflare
 * dashboard's secret box is where it goes wrong: the newlines are what make it
 * a key, and a textarea is under no obligation to keep them. The secret then
 * EXISTS — `wrangler secret list` shows the name, and everything looks
 * configured — while every call to GitHub fails.
 *
 * The symptom is specific and was diagnosed from it on 2026-08-20: every admin
 * page backed by GitHub (Content, Site, Publish) rendered empty, while every
 * page backed only by D1 (Overview, People, Partners) worked. The credential
 * was the one thing those three shared.
 *
 * So this pipes the value instead of pasting it, from the copy in .dev.vars
 * that deploy/check-github-app.mjs has already verified against GitHub.
 *
 * PRINTS NOTHING SECRET. It reports lengths and first/last characters, which
 * is enough to see that a key arrived whole and not enough to reconstruct it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The same parser check-github-app.mjs uses, including the quoted multi-line value. */
function readDevVars() {
  const raw = readFileSync(ROOT + ".dev.vars", "utf8");
  const env = {};
  const re = /^([A-Z0-9_]+)\s*=\s*("[\s\S]*?"|'[\s\S]*?'|.*)$/gm;
  let m;
  while ((m = re.exec(raw))) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const env = readDevVars();
const NAMES = ["GITHUB_APP_ID", "GITHUB_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"];

const missing = NAMES.filter((n) => !env[n]);
if (missing.length) {
  console.log("Missing from .dev.vars:", missing.join(", "));
  console.log("Nothing was changed.");
  process.exit(1);
}

/* A key that is already broken locally must not be copied onto production. */
const key = env.GITHUB_APP_PRIVATE_KEY;
if (!key.includes("-----BEGIN") || !key.includes("-----END") || !key.includes("\n")) {
  console.log("The private key in .dev.vars does not look like a multi-line PEM.");
  console.log("Run: node deploy/check-github-app.mjs   — fix it there first.");
  process.exit(1);
}

console.log("Copying to the production Worker:\n");
for (const name of NAMES) {
  const v = env[name];
  const shape = name === "GITHUB_APP_PRIVATE_KEY"
    ? `${v.length} chars, ${v.split("\n").length} lines`
    : `${v.length} chars, ends "${v.slice(-3)}"`;
  process.stdout.write(`  ${name.padEnd(24)} ${shape.padEnd(26)} `);

  const res = spawnSync("npx",
    ["wrangler", "secret", "put", name, "--env", "production"],
    { input: v, cwd: ROOT, encoding: "utf8" });

  if (res.status === 0) console.log("set");
  else {
    console.log("FAILED");
    console.log((res.stderr || res.stdout || "").split("\n").slice(-6).join("\n"));
    process.exit(1);
  }
}

console.log("\nDone. The Worker picks these up immediately — no redeploy needed.");
console.log("Check it worked: open https://thauma.one/admin/content/");
