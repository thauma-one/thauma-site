#!/usr/bin/env node
/**
 * git-sync-hook.js — GitHub webhook receiver, so a push syncs instantly
 *
 * The timer in thauma-sync.timer already keeps this machine up to date. This
 * exists to make it FEEL immediate: edit a word on the website, and the Pi has
 * it before you have switched windows. The timer stays as the backup for when
 * a delivery fails, GitHub is having a bad afternoon, or the tunnel was down.
 *
 * IT IS REACHABLE FROM THE INTERNET, so it is written like it.
 *
 *   · The signature is checked FIRST, before the body is parsed as anything.
 *   · timingSafeEqual, not `===`. A byte-at-a-time comparison leaks how much
 *     of a guess was right, which is enough to forge a signature given
 *     patience. The cost of doing it properly here is nothing.
 *   · No secret configured means REFUSE EVERYTHING. An unauthenticated
 *     endpoint that runs git commands is not a thing to fail open on.
 *   · The only thing it can do is run one fixed script with no arguments.
 *     Nothing from the request reaches a shell — not the branch, not the
 *     repository name, nothing.
 *
 * It binds 127.0.0.1. Cloudflare's tunnel is what exposes it, at
 * dev.thauma.one/_sync, so there is no port open on the LAN either.
 */
const http = require("node:http");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const path = require("node:path");

const PORT = Number(process.env.SYNC_PORT || 8994);
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const SCRIPT = path.join(__dirname, "git-sync.sh");
const MAX_BODY = 1024 * 1024; // GitHub push payloads are large but not this large

const log = (...a) => console.log(`[sync-hook ${new Date().toISOString()}]`, ...a);

/* Runs are serialised and coalesced. GitHub can deliver several pushes in a
   second — a merge, then the merge's own push — and two `git merge` processes
   in the same repository at the same time is how an index.lock error happens.
   A run already in flight simply sets a flag to go round again afterwards. */
let running = false;
let queued = false;

function sync() {
  if (running) { queued = true; return; }
  running = true;
  execFile("/bin/bash", [SCRIPT], { timeout: 120000 }, (err, stdout, stderr) => {
    running = false;
    const out = (stdout || "").trim();
    if (out) log(out);
    if (err) log("sync failed:", (stderr || err.message).trim());
    if (queued) { queued = false; sync(); }
  });
}

function verify(rawBody, header) {
  if (!SECRET) return false;
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // Lengths differing would make timingSafeEqual throw, and a length mismatch
  // is not secret — it just means the header was the wrong shape.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer((req, res) => {
  const reply = (code, msg) => {
    res.writeHead(code, { "Content-Type": "text/plain" });
    res.end(msg + "\n");
  };

  if (req.method === "GET" && req.url === "/_sync/health") {
    // Deliberately says nothing about whether a secret is configured.
    return reply(200, "ok");
  }
  if (req.method !== "POST") return reply(405, "method not allowed");

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on("data", (c) => {
    if (aborted) return;
    size += c.length;
    if (size > MAX_BODY) {
      aborted = true;
      reply(413, "too large");
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on("end", () => {
    if (aborted) return;
    const raw = Buffer.concat(chunks);

    // BEFORE anything else looks at the body.
    if (!verify(raw, req.headers["x-hub-signature-256"])) {
      log("rejected: bad or missing signature");
      return reply(401, "bad signature");
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") return reply(200, "pong");
    if (event !== "push") return reply(200, `ignored ${event}`);

    // Parsed only to write a useful log line. Nothing here steers the sync —
    // the script always does the same thing, on whatever branch is checked out.
    let ref = "?";
    try { ref = JSON.parse(raw.toString("utf8")).ref || "?"; } catch { /* ignore */ }
    log(`push ${ref} — syncing`);

    // Answer immediately. GitHub times a delivery out at 10 seconds and a
    // fetch over a domestic connection can take longer than that; a webhook
    // marked failed would send somebody looking for a problem that is not one.
    reply(202, "syncing");
    sync();
  });
});

server.listen(PORT, "127.0.0.1", () => {
  if (!SECRET) {
    log("WARNING: GITHUB_WEBHOOK_SECRET is not set — every delivery will be refused");
  }
  log(`listening on 127.0.0.1:${PORT}`);
});
