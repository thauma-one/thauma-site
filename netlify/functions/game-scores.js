// Global arcade leaderboard + futility counter for the hidden 404 game
// (GAME-SPEC.md §6, Phase 3). No auth on GET/POST score — scores are
// client-submitted and forgeable by design; stakes are bragging rights on
// a hidden page, not anything worth protecting. Deletion is the one
// destructive action, gated behind a shared secret (GAME_ADMIN_TOKEN, set
// only as a Netlify site environment variable — never in git). Same Blobs
// pattern as staff-data.js.
//
// GET  -> { scores: [{ name, score }] (top 10, desc), totalDeaths }
// POST { name: "...", score: n }         -> adds a score, returns the above
// POST { death: true }                    -> increments totalDeaths, returns the above
// POST { action: "delete", index: n, token: "..." } -> removes scores[n], returns the above
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "game-scores";
const KEY = "data";
const MAX_SCORES = 10;
const MAX_SCORE_VALUE = 999999;
const MAX_NAME_LEN = 20;
const FALLBACK_NAME = "Anonymous";

// Small, deliberately non-exhaustive blocklist — normalized matching (below)
// catches the common leetspeak dodges without needing a huge word list for
// a low-stakes hidden-page leaderboard. Anything that matches gets replaced
// with FALLBACK_NAME entirely, not partially censored (safer than trying
// to mask just the offending part).
const BLOCKLIST = [
  "fuck", "shit", "bitch", "cunt", "asshole", "bastard", "dick", "pussy",
  "nigger", "nigga", "faggot", "fag", "retard", "whore", "slut", "rape",
  "nazi", "hitler", "kike", "spic", "chink", "tranny",
];

function json(body, statusCode) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeForModeration(s) {
  return s
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/[^a-z]/g, "");
}

function isCrude(s) {
  const normalized = normalizeForModeration(s);
  return BLOCKLIST.some((word) => normalized.includes(word));
}

function sanitizeName(v) {
  const raw = (typeof v === "string" ? v : "").trim();
  // Letters (any script), digits, spaces, and a few safe punctuation marks —
  // no HTML/control characters. Collapse repeated whitespace.
  const cleaned = raw
    .replace(/[^\p{L}\p{N} '\-.]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_LEN);
  if (!cleaned || isCrude(cleaned)) return FALLBACK_NAME;
  return cleaned;
}

function sanitizeScore(v) {
  var n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_SCORE_VALUE);
}

// netlify dev doesn't wire up automatic Blobs context for V1 functions
// locally (same gap documented in staff-data.js). BLOBS_LOCAL_TOKEN (set
// only in a local, gitignored .env) makes local runs talk to the real
// Blobs API directly; unset in production, where automatic context
// already works.
function getScoresStore() {
  const token = process.env.BLOBS_LOCAL_TOKEN;
  if (token && process.env.SITE_ID) {
    return getStore({ name: STORE_NAME, siteID: process.env.SITE_ID, token });
  }
  return getStore(STORE_NAME);
}

exports.handler = async (event) => {
  const store = getScoresStore();

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json({ error: "Invalid JSON" }, 400);
    }

    const existing = (await store.get(KEY, { type: "json" })) || { scores: [], totalDeaths: 0 };

    if (body.action === "delete") {
      const adminToken = process.env.GAME_ADMIN_TOKEN;
      if (!adminToken || body.token !== adminToken) {
        return json({ error: "Not authorized" }, 403);
      }
      const index = Number(body.index);
      if (Number.isInteger(index) && index >= 0 && index < existing.scores.length) {
        existing.scores.splice(index, 1);
        await store.setJSON(KEY, existing);
      }
      return json(existing, 200);
    }

    if (body.death) {
      existing.totalDeaths = (existing.totalDeaths || 0) + 1;
      await store.setJSON(KEY, existing);
      return json(existing, 200);
    }

    const score = sanitizeScore(body.score);
    if (score > 0) {
      existing.scores.push({ name: sanitizeName(body.name), score: score });
      existing.scores.sort((a, b) => b.score - a.score);
      existing.scores = existing.scores.slice(0, MAX_SCORES);
    }
    await store.setJSON(KEY, existing);
    return json(existing, 200);
  }

  const existing = (await store.get(KEY, { type: "json" })) || { scores: [], totalDeaths: 0 };
  return json(existing, 200);
};
