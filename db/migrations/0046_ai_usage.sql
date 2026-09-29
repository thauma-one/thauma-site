-- 0046_ai_usage.sql — how much machine translation each day has used
--
-- Chase, 2026-09-29: "I want to make sure I don't exceed the credit usage …
-- You can make sure of that." Workers AI gives the ACCOUNT 10,000 Neurons a
-- day free; past that, a Paid plan is charged. This is the counter that keeps
-- each deployment inside its share of it (workers/src/translate.js):
--
--   before a call   its worst case is RESERVED — added only if the total stays
--                   under the day's cap, in one statement, so two people
--                   translating at once cannot both slip under it
--   after the call  the reservation is replaced by what Cloudflare reports
--                   the call actually used (usage.neurons)
--
-- One row per UTC day, which is when Cloudflare's allowance resets.
-- Additive: one table.

CREATE TABLE ai_usage (
  day      TEXT PRIMARY KEY,               -- YYYY-MM-DD, UTC
  neurons  REAL NOT NULL DEFAULT 0,
  calls    INTEGER NOT NULL DEFAULT 0
);
