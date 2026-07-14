// Global arcade leaderboard + futility counter for the hidden 404 game
// (GAME-SPEC.md §6, Phase 3). No auth — scores are client-submitted and
// forgeable by design; stakes are bragging rights on a hidden page, not
// anything worth protecting. Same Blobs pattern as staff-data.js.
//
// GET  -> { scores: [{ initials, score }] (top 10, desc), totalDeaths }
// POST { initials: "ABC", score: n } -> adds a score, returns the above
// POST { death: true }               -> increments totalDeaths, returns the above
const { getStore } = require("@netlify/blobs");

const STORE_NAME = "game-scores";
const KEY = "data";
const MAX_SCORES = 10;
const MAX_SCORE_VALUE = 999999;

function json(body, statusCode) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function sanitizeInitials(v) {
  var s = (typeof v === "string" ? v : "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
  return (s || "?").padEnd(3, "?");
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

    if (body.death) {
      existing.totalDeaths = (existing.totalDeaths || 0) + 1;
      await store.setJSON(KEY, existing);
      return json(existing, 200);
    }

    const score = sanitizeScore(body.score);
    if (score > 0) {
      existing.scores.push({ initials: sanitizeInitials(body.initials), score: score });
      existing.scores.sort((a, b) => b.score - a.score);
      existing.scores = existing.scores.slice(0, MAX_SCORES);
    }
    await store.setJSON(KEY, existing);
    return json(existing, 200);
  }

  const existing = (await store.get(KEY, { type: "json" })) || { scores: [], totalDeaths: 0 };
  return json(existing, 200);
};
