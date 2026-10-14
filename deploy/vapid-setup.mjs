#!/usr/bin/env node
/**
 * vapid-setup.mjs — switch on phone notifications (Web Push) for every site
 *
 *   node deploy/vapid-setup.mjs            first time
 *   node deploy/vapid-setup.mjs --rotate   a new pair (every phone must turn
 *                                          notifications on again)
 *
 * WHAT IT DOES
 *   1. Makes one P-256 key pair (RFC 8292, "VAPID").
 *   2. Writes the PUBLIC half into wrangler.toml as VAPID_PUBLIC_KEY — top
 *      level (staging), [env.dev.vars] and [env.production.vars]. It is
 *      public by design: every phone is given it.
 *   3. Pipes the PRIVATE half to `wrangler secret put VAPID_PRIVATE_KEY` for
 *      staging and production, and writes it into .dev.vars (gitignored) for
 *      the dev server. It is never printed and never committed.
 *
 * ONE PAIR FOR ALL THREE SITES, because they share one database
 * (one-database decision, 2026-09-29): a phone that turned notifications on
 * from dev is sent to by whichever site has news, and a push service only
 * accepts a message signed by the key that phone subscribed with.
 *
 * PRINTS NOTHING SECRET: lengths only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOML = ROOT + "wrangler.toml";
const DEV_VARS = ROOT + ".dev.vars";
const rotate = process.argv.includes("--rotate");

let toml = readFileSync(TOML, "utf8");
if (/^VAPID_PUBLIC_KEY\s*=/m.test(toml) && !rotate) {
  console.log("Notifications already have keys (VAPID_PUBLIC_KEY is in wrangler.toml).");
  console.log("Nothing was changed. To replace them: node deploy/vapid-setup.mjs --rotate");
  process.exit(0);
}

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jwk = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const publicKey = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
const privateKey = jwk.d;
if (Buffer.from(publicKey, "base64url").length !== 65 || Buffer.from(privateKey, "base64url").length !== 32) {
  console.log("The key pair came out the wrong size. Nothing was changed.");
  process.exit(1);
}

/* 2. the public half, beside ONE_DATABASE in each of the three [vars] */
toml = toml.replace(/^VAPID_PUBLIC_KEY\s*=.*\n/gm, "").replace(/^# PHONE NOTIFICATIONS.*\n(?:#.*\n)*/gm, "");
let blocks = 0;
toml = toml.replace(/^ONE_DATABASE = "thauma-ops"\n/gm, (line) => {
  blocks++;
  return line + "# PHONE NOTIFICATIONS (Web Push): the public half of the one key pair all\n" +
    "# three sites share — see deploy/vapid-setup.mjs. The private half is a secret.\n" +
    `VAPID_PUBLIC_KEY = "${publicKey}"\n`;
});
if (blocks !== 3) {
  console.log(`Expected three [vars] blocks with ONE_DATABASE, found ${blocks}. Nothing was changed.`);
  process.exit(1);
}

/* 3. the private half: staging and production secrets, then .dev.vars */
console.log(`Key pair made (public ${publicKey.length} chars, private ${privateKey.length} chars).\n`);
for (const env of [null, "production"]) {
  const label = env || "staging";
  process.stdout.write(`  VAPID_PRIVATE_KEY → ${label.padEnd(11)} `);
  const res = spawnSync("npx", ["wrangler", "secret", "put", "VAPID_PRIVATE_KEY", ...(env ? ["--env", env] : [])],
    { input: privateKey, cwd: ROOT, encoding: "utf8" });
  if (res.status !== 0) {
    console.log("FAILED");
    console.log((res.stderr || res.stdout || "").split("\n").slice(-6).join("\n"));
    console.log("\nwrangler.toml was NOT changed. Fix the error above and run this again.");
    process.exit(1);
  }
  console.log("set");
}
let dev = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : "";
dev = dev.replace(/^VAPID_PRIVATE_KEY\s*=.*\n?/gm, "");
if (dev && !dev.endsWith("\n")) dev += "\n";
writeFileSync(DEV_VARS, dev + `VAPID_PRIVATE_KEY=${privateKey}\n`, { mode: 0o600 });
console.log("  VAPID_PRIVATE_KEY → .dev.vars    set");

writeFileSync(TOML, toml);
console.log("  VAPID_PUBLIC_KEY  → wrangler.toml (staging, dev, production)\n");
console.log("Done. Next: restart the dev server, then commit and push wrangler.toml.");
