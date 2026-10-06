-- 0051_mail_bounces_seen.sql — when a ministry last cleared its bounce warning
--
-- Chase, 2026-10-05: "Should there be a warning on the Home page saying how
-- many emails were bounced until it is manually cleared?" Home counts the
-- bounces that arrived after this moment; Clear sets it to now. NULL means
-- never cleared, so every bounce counts.
--
-- Additive: reverting the code strands nothing.

ALTER TABLE partners ADD COLUMN mail_bounces_seen_at TEXT;
