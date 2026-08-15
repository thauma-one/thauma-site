/**
 * store.js — a tiny JSON store
 *
 * Netlify Blobs stored one JSON document per key. Workers KV does exactly the
 * same thing, so this is a direct swap rather than a redesign:
 *
 *   Netlify   getStore(name).get(key, {type:'json'}) / .setJSON(key, value)
 *   Workers   env.BINDING.get(key, 'json')           / .put(key, JSON.stringify(value))
 *
 * KV DELIBERATELY, NOT D1. These two documents (`staff-directory` and
 * `game-scores`) are blobs read and written whole — there is nothing to query,
 * join, or scope by partner. D1 is for the relational data in db/schema; using
 * it here would add a query layer to something that has no queries.
 *
 * KV IS EVENTUALLY CONSISTENT. A write can take a moment to be visible from
 * another edge location, and two simultaneous writers last-write-wins. Both of
 * these documents are edited by one person at a time, so that is acceptable —
 * but it is the reason not to put anything transactional here.
 *
 * memoryStore() exists so the handlers can be tested without a KV binding.
 */

/** Wrap a KV namespace binding. */
export function kvStore(binding) {
  if (!binding) throw new Error("store: missing KV binding");
  return {
    async get(key) {
      return await binding.get(key, "json");
    },
    async put(key, value) {
      await binding.put(key, JSON.stringify(value));
    },
  };
}

/** In-memory equivalent, for tests. Deep-copies so callers can't mutate it by reference. */
export function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get(key) {
      const raw = data.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async put(key, value) {
      data.set(key, JSON.stringify(value));
    },
    _dump: () => Object.fromEntries([...data].map(([k, v]) => [k, JSON.parse(v)])),
  };
}

/** JSON response helper — the Workers equivalent of the old `json()` shape. */
export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

/** Parse a JSON request body, returning null rather than throwing on garbage. */
export async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison, for comparing secrets.
 * Length is not secret here, so an early return on length is fine.
 */
export function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
