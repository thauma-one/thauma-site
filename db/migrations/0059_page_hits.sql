-- 0059_page_hits.sql — visits to the sites, counted without knowing who
--
-- Chase, 2026-10-13: "On the admin homepage, can we add an analytics section
-- for the site as well? Complete with visit numbers graph and a map that
-- shows where they visited from. … And maybe a few basic filters."
--
-- One row per page seen, sent by the page itself once it has loaded
-- (main.js on thauma.one, the partner sites' own script) to /api/hit. What is
-- kept is deliberately thin:
--   · no IP address, no cookie, no account — `session` is a random id the
--     browser tab makes and forgets when it closes, so "visits" counts tabs,
--     not people, and nothing here can follow anyone between visits
--   · country is the two letters Cloudflare already knows for the request
--   · the referrer is its host only ("google.com"), never the full address
-- A browser that says Do Not Track or Global Privacy Control sends nothing.
-- Rows older than 400 days are deleted by the daily job.
--
-- Additive: nothing reads it before the Overview asks, and both the counter
-- and the Overview tolerate its absence.

CREATE TABLE IF NOT EXISTS page_hits (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT NOT NULL,                  -- when, ISO
  day       TEXT NOT NULL,                  -- YYYY-MM-DD, UTC
  site      TEXT NOT NULL,                  -- 'thauma', or a partner id
  live      INTEGER NOT NULL DEFAULT 1,     -- 0 for dev, staging and previews
  path      TEXT NOT NULL,
  lang      TEXT,
  country   TEXT,                           -- two letters, from Cloudflare
  referrer  TEXT,                           -- a host, or NULL
  device    TEXT,                           -- 'phone' | 'tablet' | 'computer'
  session   TEXT NOT NULL                   -- a browser tab's random id
);
CREATE INDEX IF NOT EXISTS idx_page_hits_site_day ON page_hits(site, live, day);
