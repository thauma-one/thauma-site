-- 0061_notices_cleared.sql — a notice cleared from the bell, still findable
--
-- Chase, 2026-10-13: "have a way for bell notifications to be cleared from
-- the dropdown, but something to where they can still find past
-- notifications if they clear, and it clears automatically, but not
-- immediately … just have a 6 hour timer on it? Still with the ability to
-- find past cleared notifications."
--
-- The bell's list holds what is unread, and what was read in the last six
-- hours and not cleared. Everything else — cleared by hand, or read more
-- than six hours ago — is under "Past notifications", kept for a year
-- (workers/src/notices.js; the daily job deletes after that).
--
-- Additive: before it, the bell shows what it showed under 0060 and clearing
-- says the database needs updating.

ALTER TABLE notices ADD COLUMN cleared_at TEXT;
