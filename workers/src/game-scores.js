/**
 * game-scores — the hidden arcade's high scores (ARCADE-SPEC.md §4)
 *
 * ONE BOARD PER GAME, the top five, with classic three-letter initials —
 * entered with the same controls the games use, so a phone never has to
 * open its keyboard. Rebuilt 2026-09-29 for the arcade; the single Flappy
 * game's board (top 3, free-text names, a death counter) went with it, and
 * its old KV key is simply no longer read.
 *
 * No auth on reading or submitting: scores are client-submitted and
 * forgeable by design, and the stakes are bragging rights on a hidden page.
 * Deletion is the one destructive action and is gated by a shared secret
 * (GAME_ADMIN_TOKEN), compared in constant time.
 *
 * GET  ?game=<id>                              -> { game, scores: [{ name, score }] } (top 5, desc)
 * POST { game, name, score }                   -> adds a score, returns the board
 * POST { action:"delete", game, index, token } -> removes scores[index]
 */
import { kvStore, json, readJson, timingSafeEqualStr } from "./lib/store.js";

/* The cabinets (js/arcade/arcade.js). A board exists only for a game that
   does, so the KV namespace cannot be filled with invented keys. */
export const GAMES = ["loadout", "soundcheck", "panelfixer", "cablerun", "stagerunner", "goldenhour", "followspot", "strike", "cuestack"];
const MAX_SCORES = 5;
const MAX_SCORE_VALUE = 9999999;
const HIDDEN = "???";
const keyFor = (game) => "board:" + game;

// Deliberately non-exhaustive. Normalized matching (below) catches the common
// leetspeak dodges without needing a huge word list for a low-stakes hidden
// leaderboard. A match replaces the initials ENTIRELY rather than masking
// part of them.
const BLOCKLIST = [
  "fuck", "shit", "bitch", "cunt", "asshole", "bastard", "dick", "pussy",
  "nigger", "nigga", "faggot", "fag", "retard", "whore", "slut", "rape",
  "nazi", "hitler", "kike", "spic", "chink", "tranny",
];
/* Three letters is short enough that the classic arcade offenders need
   naming on their own. */
const THREE = new Set(["ASS", "FUK", "FUC", "FCK", "FKU", "KKK", "CUM", "TIT", "FAG", "NIG", "NGR", "SEX",
  "DIK", "DIC", "CNT", "KYS", "SS", "HH", "WTF", "STD", "POO", "PEE", "JIZ", "COK", "COC", "VAG", "PUS", "HOE"]);

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

/**
 * Up to three letters or digits, upper-cased (the entry screen offers A–Z
 * and 0–9). Anything crude — as it stands, spelled in leetspeak, or one of
 * the classic three-letter offenders — becomes "???".
 */
export function sanitizeInitials(v) {
  const raw = typeof v === "string" ? v : "";
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  if (!clean) return HIDDEN;
  if (THREE.has(clean) || THREE.has(clean.replace(/[0-9]/g, (d) => ({ 0: "O", 1: "I", 3: "E", 4: "A", 5: "S", 7: "T" })[d] || d))) return HIDDEN;
  if (isCrude(raw) || isCrude(clean)) return HIDDEN;
  return clean;
}

export function sanitizeScore(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_SCORE_VALUE);
}

/** Exported for tests: the handler with its store injected. */
export async function handle(request, env, store) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  }
  let body = null;
  if (request.method === "POST") {
    body = await readJson(request);
    if (body === null) return json({ error: "Invalid JSON" }, 400);
  }
  const game = request.method === "GET" ? new URL(request.url).searchParams.get("game") : body.game;
  if (!GAMES.includes(game)) return json({ error: "No such game." }, 404);

  const board = (await store.get(keyFor(game))) || { scores: [] };
  const answer = () => json({ game, scores: board.scores });
  if (request.method === "GET") return answer();

  if (body.action === "delete") {
    const adminToken = env?.GAME_ADMIN_TOKEN;
    // No token configured means deletion is disabled, not open.
    if (!adminToken || !timingSafeEqualStr(String(body.token || ""), adminToken)) {
      return json({ error: "Not authorized" }, 403);
    }
    const index = Number(body.index);
    if (Number.isInteger(index) && index >= 0 && index < board.scores.length) {
      board.scores.splice(index, 1);
      await store.put(keyFor(game), board);
    }
    return answer();
  }

  const score = sanitizeScore(body.score);
  if (score > 0) {
    board.scores.push({ name: sanitizeInitials(body.name), score });
    board.scores.sort((a, b) => b.score - a.score);
    board.scores = board.scores.slice(0, MAX_SCORES);
    await store.put(keyFor(game), board);
  }
  return answer();
}

export default {
  async fetch(request, env) {
    return handle(request, env, kvStore(env.GAME_SCORES));
  },
};
