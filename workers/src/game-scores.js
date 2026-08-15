/**
 * game-scores — leaderboard + futility counter for the hidden 404 game
 * (GAME-SPEC.md §6, Phase 3)
 *
 * Port of netlify/functions/game-scores.js. The moderation and sanitisation
 * logic is carried over UNCHANGED — it is the interesting part of this file and
 * a port is the wrong moment to redesign it.
 *
 * No auth on GET or on score submission: scores are client-submitted and
 * forgeable by design, and the stakes are bragging rights on a hidden page.
 * Deletion is the one destructive action and is gated by a shared secret.
 *
 * Changed from the original:
 *   - Netlify Blobs   -> KV binding (see lib/store.js)
 *   - exports.handler -> export default { fetch }
 *   - the admin token comparison is now CONSTANT-TIME. The original used `!==`.
 *     Negligible risk for a leaderboard, but this is the one destructive path
 *     in the file and a constant-time compare costs nothing.
 *
 * GET  -> { scores: [{name, score}] (top 3, desc), totalDeaths }
 * POST { name, score }                         -> add a score
 * POST { death: true }                         -> increment totalDeaths
 * POST { action:"delete", index, token }       -> remove scores[index]
 */
import { kvStore, json, readJson, timingSafeEqualStr } from "./lib/store.js";

const KEY = "data";
const MAX_SCORES = 3;
const MAX_SCORE_VALUE = 999999;
const MAX_NAME_LEN = 20;
const FALLBACK_NAME = "Anonymous";

// Deliberately non-exhaustive. Normalised matching (below) catches the common
// leetspeak dodges without needing a huge word list for a low-stakes hidden
// leaderboard. A match replaces the name ENTIRELY rather than masking part of
// it — safer than trying to censor in place.
const BLOCKLIST = [
  "fuck", "shit", "bitch", "cunt", "asshole", "bastard", "dick", "pussy",
  "nigger", "nigga", "faggot", "fag", "retard", "whore", "slut", "rape",
  "nazi", "hitler", "kike", "spic", "chink", "tranny",
];

export function normalizeForModeration(s) {
  return String(s)
    .toLowerCase()
    .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
    .replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
    .replace(/@/g, "a").replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
}

export function isCrude(s) {
  const n = normalizeForModeration(s);
  return BLOCKLIST.some((w) => n.includes(w));
}

export function sanitizeName(v) {
  const raw = (typeof v === "string" ? v : "").trim();
  // Letters (any script), digits, spaces and a few safe punctuation marks —
  // no HTML or control characters. Collapse repeated whitespace.
  const cleaned = raw
    .replace(/[^\p{L}\p{N} '\-.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);

  // BUG FIX vs the Netlify original, which only moderated `cleaned`.
  // The character filter above strips @ and $ BEFORE normalizeForModeration
  // can map them back to "a" and "s" — so those two substitutions could never
  // fire, and "@sshole" sailed through as "sshole". Moderate the RAW input as
  // well.
  //
  // KNOWN AND ACCEPTED: substring matching means innocent names containing a
  // blocked word are caught too (the Scunthorpe problem). That was already
  // true of the original, and for a hidden leaderboard where the penalty is
  // being renamed "Anonymous", over-blocking is the cheaper mistake.
  if (!cleaned || isCrude(raw) || isCrude(cleaned)) return FALLBACK_NAME;
  return cleaned;
}

export function sanitizeScore(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_SCORE_VALUE);
}

const EMPTY = () => ({ scores: [], totalDeaths: 0 });

/** Exported for tests: the handler with its store injected. */
export async function handle(request, env, store) {
  if (request.method === "GET") {
    return json((await store.get(KEY)) || EMPTY());
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }

  const body = await readJson(request);
  if (body === null) return json({ error: "Invalid JSON" }, 400);

  const existing = (await store.get(KEY)) || EMPTY();

  if (body.action === "delete") {
    const adminToken = env?.GAME_ADMIN_TOKEN;
    // No token configured means deletion is disabled, not open.
    if (!adminToken || !timingSafeEqualStr(String(body.token || ""), adminToken)) {
      return json({ error: "Not authorized" }, 403);
    }
    const index = Number(body.index);
    if (Number.isInteger(index) && index >= 0 && index < existing.scores.length) {
      existing.scores.splice(index, 1);
      await store.put(KEY, existing);
    }
    return json(existing);
  }

  if (body.death) {
    existing.totalDeaths = (existing.totalDeaths || 0) + 1;
    await store.put(KEY, existing);
    return json(existing);
  }

  const score = sanitizeScore(body.score);
  if (score > 0) {
    existing.scores.push({ name: sanitizeName(body.name), score });
    existing.scores.sort((a, b) => b.score - a.score);
    existing.scores = existing.scores.slice(0, MAX_SCORES);
  }
  await store.put(KEY, existing);
  return json(existing);
}

export default {
  async fetch(request, env) {
    return handle(request, env, kvStore(env.GAME_SCORES));
  },
};
