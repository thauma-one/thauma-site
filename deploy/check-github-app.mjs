#!/usr/bin/env node
/**
 * check-github-app.mjs — what can the GitHub credential ACTUALLY do?
 *
 *   node deploy/check-github-app.mjs
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * On 2026-08-17 an App was set up, the Content page loaded, every section
 * listed, and the first attempt to write returned a 502. The App had been
 * created with NO repository permissions at all — and because thauma-site is
 * PUBLIC, reading it needs none, so everything looked correct right up until
 * something had to be saved.
 *
 * A credential that can read is not a credential that works. This asks GitHub
 * what the token can do rather than inferring it from a page that loaded, and
 * it is the check to run before believing the setup is finished.
 *
 * It prints no secrets. The key is read, used to sign, and never shown.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Read .dev.vars the way wrangler does, including a quoted multi-line value. */
function readDevVars() {
  let raw;
  try {
    raw = readFileSync(ROOT + ".dev.vars", "utf8");
  } catch {
    console.log("No .dev.vars in", ROOT);
    console.log("That is the correct state for a machine with no credentials.");
    process.exit(1);
  }
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
const REPO = env.GITHUB_REPO || "thauma-one/thauma-site";

const need = ["GITHUB_APP_ID", "GITHUB_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY"];
const missing = need.filter((k) => !env[k]);
if (missing.length) {
  console.log("Missing from .dev.vars:", missing.join(", "));
  process.exit(1);
}

const b64url = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
// iat backdated: GitHub rejects a token whose iat is in ITS future, and two
// clocks need not agree to the second.
const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID }));

let jwt;
try {
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${head}.${payload}`), env.GITHUB_APP_PRIVATE_KEY);
  jwt = `${head}.${payload}.${b64url(sig)}`;
} catch (e) {
  console.log("The private key could not sign:", e.message);
  console.log("If it mentions PKCS#1, run the openssl pkcs8 conversion — see NEXT-STEPS.");
  process.exit(1);
}

const gh = (path, init = {}) =>
  fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "thauma-app-check",
      ...init.headers,
    },
  });

const res = await gh(`/app/installations/${encodeURIComponent(env.GITHUB_INSTALLATION_ID)}/access_tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${jwt}` },
});
const body = await res.json().catch(() => ({}));

if (!res.ok) {
  console.log(`Could not get a token: ${res.status} ${body.message || ""}`);
  console.log("Check GITHUB_APP_ID and GITHUB_INSTALLATION_ID, and that the app is installed.");
  process.exit(1);
}

const perms = body.permissions || {};
const repos = (body.repositories || []).map((r) => r.full_name);

console.log("Token minted for", repos.length ? repos.join(", ") : body.repository_selection);
console.log();

/* What each one is FOR, so a missing line means something. */
const REQUIRED = [
  ["contents", "write", "saving words, and creating a language"],
  ["actions", "write", "the Preview and Publish buttons"],
];

let ok = true;
for (const [name, level, why] of REQUIRED) {
  const have = perms[name];
  const good = have === "write" || (level === "read" && have === "read");
  if (!good) ok = false;
  console.log(`  ${good ? "OK  " : "MISSING"}  ${name}: ${level.padEnd(5)}  ${have ? `(has "${have}")` : "(has nothing)"}  — ${why}`);
}

const extra = Object.keys(perms).filter((k) => !REQUIRED.some(([n]) => n === k));
if (extra.length) {
  console.log();
  console.log("  Also granted, and not needed:", extra.map((k) => `${k}:${perms[k]}`).join(", "));
}

console.log();
if (ok) {
  console.log("The credential can do everything the console needs.");
} else {
  console.log("THE CONSOLE WILL LOAD AND FAIL TO SAVE.");
  console.log();
  console.log("Reading a public repository needs no permissions at all, so every");
  console.log("page will look correct until something has to be written.");
  console.log();
  console.log("Fix it in two steps — the second is the one people miss:");
  console.log("  1. github.com/settings/apps -> the app -> Permissions & events");
  console.log("     Repository permissions: Contents = Read and write,");
  console.log("                             Actions  = Read and write");
  console.log("  2. APPROVE the change on the installation. GitHub does not apply");
  console.log("     it to an existing install by itself — until you do, the");
  console.log("     settings page shows the right thing and the token has nothing.");
}
process.exit(ok ? 0 : 1);
