/**
 * admin-arcade.js — /api/admin/arcade (Website › Arcade)
 *
 * Chase, 2026-10-06: "Let's create an arcade editor for the admins. It can
 * turn on and off games on the live site (turns it to out of order) and can
 * manage the high scores and delete/??? names if needed."
 *
 *   GET                                         everything: the games and their
 *                                               switches, every board, the blocked names
 *   POST { action: "game", game, column, on }   open or close a game on "live" or "dev"
 *   POST { action: "remove", game, name, score }  take a score off its board
 *   POST { action: "hide", game, name, score }  show that score as ???
 *   POST { action: "clear", game }              empty a board
 *   POST { action: "block", name }              block a name: future scores with it
 *                                               show as ???, and so do the ones on
 *                                               the boards now
 *   POST { action: "unblock", name }            lift a block (the boards stay as they are)
 *
 * WHO. Administrators only, reading too: the boards hold nothing secret, but
 * this is the arcade's control room.
 *
 * SAVES AT ONCE, like Forms: nothing here is part of the site's files, so
 * nothing waits for Publish — a game closed here is out of order on the live
 * site with the next visit. The answer to every change is the whole state,
 * so the screen shows what is stored rather than what it hoped to store.
 *
 * TWO PEOPLE, ONE BOARD (docs/SPEC.md): a score is named by its name and
 * value, not by its place, and a score that is no longer there is refused
 * with 409 `changed` and the boards as they are now. A switch is one value
 * set to what was asked, so two admins flipping two switches never undo each
 * other.
 */
import { createDb } from "./lib/db.js";
import { requireAccess } from "./lib/access.js";
import { json, readJson, kvStore } from "./lib/store.js";
import { GAMES, CONFIG_KEY, readConfig, siteColumn } from "./game-scores.js";

const keyFor = (game) => "board:" + game;
const HIDDEN = "???";

async function gate(request, env) {
  const { user, denied } = await requireAccess(request, env);
  if (denied) return { denied };
  if (!env.DB) return { denied: json({ error: "No database bound to this deploy" }, 500) };
  if (!env.GAME_SCORES) return { denied: json({ error: "No score store bound to this deploy" }, 500) };
  const db = createDb(env.DB);
  const me = await db.queryOne("user_by_email", { email: user.email });
  if (!me) return { denied: json({ error: "This address is not an active account.", email: user.email }, 403) };
  const roles = String(me.roles || "").split(",").filter(Boolean);
  if (!roles.includes("admin")) return { denied: json({ error: "Only administrators manage the arcade." }, 403) };
  return { db, user };
}

async function audit(db, user, action, entityId, detail) {
  try {
    await db.query("audit_write", {
      id: "a_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20),
      now: new Date().toISOString(),
      user_id: user.email,
      partner_id: null,
      action,
      entity: "arcade",
      entity_id: entityId,
      detail: detail ? JSON.stringify(detail) : null,
    });
  } catch (err) {
    console.error("audit_write failed:", err.message);
  }
}

/** Three letters or digits, as the entry screen allows. */
export function cleanName(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
}

async function everything(store, env) {
  const cfg = readConfig(await store.get(CONFIG_KEY));
  const games = [];
  for (const id of GAMES) {
    const board = (await store.get(keyFor(id))) || { scores: [] };
    games.push({ id, live: cfg.games[id].live, dev: cfg.games[id].dev, scores: board.scores || [] });
  }
  return { site: siteColumn(env), games, blocked: cfg.blocked };
}

/** Exported for tests: the handler with its store and gate injected. */
export async function handle(request, env, store, who) {
  if (request.method === "GET") return json(await everything(store, env));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST" });
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const changed = async () => json({ error: "changed", ...(await everything(store, env)) }, 409);
  const done = async (action, id, detail) => {
    if (who) await audit(who.db, who.user, "arcade." + action, id, detail);
    return json(await everything(store, env));
  };

  if (body.action === "block" || body.action === "unblock") {
    const name = cleanName(body.name);
    if (!name) return json({ error: "A name is one to three letters or digits." }, 400);
    const raw = (await store.get(CONFIG_KEY)) || {};
    const cfg = readConfig(raw);
    let blocked = cfg.blocked.filter((b) => b.name !== name);
    if (body.action === "block") {
      blocked = blocked.concat([{ name, at: new Date().toISOString() }]);
      /* the boards now: that name becomes ??? wherever it stands */
      for (const id of GAMES) {
        const board = await store.get(keyFor(id));
        if (!board || !board.scores) continue;
        let hit = false;
        board.scores.forEach((s) => { if (s.name === name) { s.name = HIDDEN; hit = true; } });
        if (hit) await store.put(keyFor(id), board);
      }
    }
    await store.put(CONFIG_KEY, { ...raw, games: cfg.games, blocked });
    return done(body.action, name);
  }

  const game = body.game;
  if (!GAMES.includes(game)) return json({ error: "No such game." }, 404);

  if (body.action === "game") {
    const column = body.column === "dev" ? "dev" : body.column === "live" ? "live" : null;
    if (!column) return json({ error: "column is live or dev" }, 400);
    const raw = (await store.get(CONFIG_KEY)) || {};
    const cfg = readConfig(raw);
    cfg.games[game][column] = !!body.on;
    await store.put(CONFIG_KEY, { ...raw, games: cfg.games, blocked: cfg.blocked });
    return done("game", game, { column, on: !!body.on });
  }

  const board = (await store.get(keyFor(game))) || { scores: [] };
  if (body.action === "clear") {
    await store.put(keyFor(game), { scores: [] });
    return done("clear", game, { removed: (board.scores || []).length });
  }
  if (body.action === "remove" || body.action === "hide") {
    const i = (board.scores || []).findIndex((s) => s.name === body.name && s.score === Number(body.score));
    if (i < 0) return changed();
    if (body.action === "remove") board.scores.splice(i, 1);
    else board.scores[i].name = HIDDEN;
    await store.put(keyFor(game), board);
    return done(body.action, game, { name: body.name, score: Number(body.score) });
  }
  return json({ error: "Unknown action" }, 400);
}

export default {
  async fetch(request, env) {
    const g = await gate(request, env);
    if (g.denied) return g.denied;
    return handle(request, env, kvStore(env.GAME_SCORES), g);
  },
};
