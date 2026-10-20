-- 0064_release_notice.sql — tell people when the site IS live, not when Publish was pressed
--
-- Chase, 2026-10-19: "When the site is published, the notification should
-- appear after the site is live." Publish starts a build that takes minutes;
-- the notice used to go out at the press. Now Publish marks its release as
-- waiting (notify_after = the moment it started the build), and the Worker's
-- quarter-hourly job (worker.js scheduled → lib/release-notice.js) sends it
-- once the production deploy that started after that moment has SUCCEEDED,
-- claiming the row first (notified_at) so the three sites, which share this
-- database, send it exactly once.
--
-- Additive: until it is applied, Publish tells everyone at the press, as
-- before.

ALTER TABLE releases ADD COLUMN notify_after TEXT;
ALTER TABLE releases ADD COLUMN notified_at TEXT;
