#!/usr/bin/env node
/**
 * Machine translation never costs anything (0046, translate.js)
 *   node workers/test/ai-usage.test.mjs
 *
 * Chase, 2026-09-29: "I want to make sure I don't exceed the credit usage …
 * You can make sure of that." Three things make it sure, and each is held
 * here: the three sites' shares add up to less than the account's free
 * 10,000 Neurons; a call's worst case is a real ceiling; and the reservation
 * refuses to pass the share even when two calls arrive at once.
 *
 * The reservation runs against real SQLite where node:sqlite exists (Node
 * 22); CI's Node 20 skips just that part.
 */
import { readFileSync } from "node:fs";
import { answerCeiling, worstCase, dailyShare, dayKey } from "../src/translate.js";
import { QUERIES } from "../src/lib/queries.generated.js";
import { createDb } from "../src/lib/db.js";

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); pass++; }
  catch (e) { console.log(`  FAIL  ${name}\n          ${e.message}`); fail++; }
};
const assert = (c, m) => { if (!c) throw new Error(m); };
console.log("translation's daily share\n");

const TOML = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");

await check("the three sites' shares add up to 9,000 or less — under the free 10,000", () => {
  const shares = [...TOML.matchAll(/^AI_DAILY_NEURONS\s*=\s*"(\d+)"/gm)].map((m) => Number(m[1]));
  assert(shares.length === 3, `expected a share for each of 3 sites, found ${shares.length}`);
  const sum = shares.reduce((a, b) => a + b, 0);
  assert(sum <= 9000, `the shares add up to ${sum}; above 9,000 there is no margin under 10,000`);
  assert(dailyShare({}) * 3 <= 9000, "a site that names no share still fits three times");
});

await check("a call's worst case is a ceiling: the answer is capped by what was sent", () => {
  const one = [{ id: "a", text: "Give" }];
  const max = answerCeiling(one);
  assert(max < 200, `one word may not get ${max} tokens of answer`);
  assert(answerCeiling([{ id: "a", text: "x".repeat(20000) }]) === 4096, "and never more than 4,096");
  const w = worstCase("system", JSON.stringify({ items: one }), max);
  assert(w > 0 && w < 50, `one word's worst case is ${w} Neurons`);
  /* Cyrillic is two bytes a letter, so it costs more to reserve. */
  assert(worstCase("", "Дај", 0) > worstCase("", "Daj", 0), "bytes, not letters");
});

let sqlite = null;
try { sqlite = await import("node:sqlite"); } catch {}
if (!sqlite) {
  console.log("  SKIP  the reservation against real SQLite (node:sqlite is not available)");
} else {
  await check("the reservation never passes the share, whatever order calls arrive in", async () => {
    const raw = new sqlite.DatabaseSync(":memory:");
    raw.exec(readFileSync(new URL("../../db/migrations/0046_ai_usage.sql", import.meta.url), "utf8"));
    const binding = { prepare: (sql) => {
      const st = raw.prepare(sql);
      const b = (...args) => ({ all: async () => ({ results: st.all(...args) }), first: async () => st.get(...args), run: async () => st.run(...args) });
      return { bind: b, ...b() };
    } };
    const db = createDb(binding);
    const day = "2026-09-29", cap = 100;
    const took = [];
    for (let i = 0; i < 12; i++) took.push((await db.query("ai_usage_reserve", { day, est: 10, cap })).length === 1);
    assert(took.filter(Boolean).length === 10, `10 calls of 10 fit in 100; ${took.filter(Boolean).length} did`);
    let row = await db.queryOne("ai_usage_today", { day });
    assert(row.neurons === 100 && row.calls === 10, `total ${row.neurons} over ${row.calls} calls`);
    await db.query("ai_usage_settle", { day, est: 10, actual: 2 });
    row = await db.queryOne("ai_usage_today", { day });
    assert(row.neurons === 92, `settled to what was used: ${row.neurons}`);
    assert((await db.query("ai_usage_reserve", { day, est: 9, cap })).length === 0, "92 + 9 would pass 100");
    assert((await db.query("ai_usage_reserve", { day, est: 8, cap })).length === 1, "92 + 8 fits exactly");
    assert((await db.query("ai_usage_reserve", { day: "2026-09-30", est: 150, cap })).length === 0, "one call bigger than the share never runs");
    assert((await db.query("ai_usage_reserve", { day: "2026-09-30", est: 10, cap })).length === 1, "and a new day starts at nothing");
  });
}

await check("each site counts its share in its own row of the one database", () => {
  const at = new Date("2026-09-29T23:59:00Z");
  assert(dayKey({ SITE_ORIGIN: "https://dev.thauma.one" }, at) === "2026-09-29 dev.thauma.one", "dev keeps its own row");
  assert(dayKey({ SITE_ORIGIN: "https://thauma.one/" }, at) === "2026-09-29 thauma.one", "live keeps its own row");
  assert(dayKey({ SITE_ORIGIN: "https://next.thauma.one" }, at) !== dayKey({ SITE_ORIGIN: "https://thauma.one" }, at),
    "staging and live never share a count");
  assert(dayKey({}, at) === "2026-09-29", "no origin: the bare date");
});

void QUERIES;
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
