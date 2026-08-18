-- 0011_embeds.sql — let a partner put their progress on somebody else's site
--
-- WHY THESE COLUMNS EXIST AND WHY THE FIRST ONE IS THE IMPORTANT ONE
-- ============================================================================
-- The partner API (/api/partner/v1/site) needs a key and sends no CORS
-- headers, deliberately: it is fetched by a BUILD, so the key never reaches a
-- browser and a page cannot read it with a key somebody pasted into
-- client-side JavaScript.
--
-- An embed is the opposite shape. It runs in a visitor's browser, on a site
-- Thauma does not control, and so it cannot carry a secret of any kind. That
-- makes the embed endpoint unauthenticated, and unauthenticated means anyone
-- who can guess a slug can read it.
--
-- `embed_enabled` is what makes that acceptable. It is OFF for everybody until
-- a partner turns it on, so the set of readable partners is a list somebody
-- chose rather than the whole table. A partner who has not opted in returns
-- 404 from the embed endpoint — not 403, which would confirm they exist.
--
-- THE OTHER TWO ARE APPEARANCE, AND THEY ARE STORED RATHER THAN PASSED
-- ============================================================================
-- The embed code can override colours per-placement, but the DEFAULT lives
-- here. A partner sets their colours once, and every page that embeds them
-- picks it up — including pages they have already published and will never
-- edit again. Sending appearance only through the snippet would mean a
-- rebrand is a hunt through other people's websites.
--
-- accent is stored as text and validated in the Worker rather than by a CHECK
-- constraint: SQLite has no regular expressions, and a CHECK that only tested
-- the length would pass '#zzzzzz' while looking like it had done something.

ALTER TABLE partners ADD COLUMN embed_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (embed_enabled IN (0, 1));

-- NULL means "use the Thauma default". Not a hardcoded hex here, so changing
-- the house colour does not require rewriting every row that never chose one.
ALTER TABLE partners ADD COLUMN embed_accent TEXT;

ALTER TABLE partners ADD COLUMN embed_theme TEXT NOT NULL DEFAULT 'auto'
  CHECK (embed_theme IN ('auto', 'light', 'dark'));

-- The embed endpoint's only lookup is by slug among enabled partners, and it
-- is hit by every page view of every site that embeds anything. Without this
-- it is a table scan on the hot path of code running in strangers' browsers.
CREATE INDEX IF NOT EXISTS idx_partners_embed
  ON partners (slug) WHERE embed_enabled = 1;
