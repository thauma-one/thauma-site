-- 0062_releases.sql — what each Publish put live, for What's new
--
-- Chase, 2026-10-13: "add a notification to users when the site was updated
-- with a changelog. Essentially when the publish button is pressed." Then:
-- "Make sure the changelog is understandable to an end user. And separate
-- into different sections by the different pages of the site filtered to
-- each user by their role and what they can see."
--
-- The words are src/_data/changelog.json, written with each change. When
-- Publish is pressed, every entry no release has yet is copied here — text
-- in every language included, so a release reads the same whatever the code
-- says later — with the parts of the public site whose content changed.
-- What's new (/staff/changes/) shows them by page, each person only the
-- pages they can open (workers/src/changes.js).
--
-- Additive: before it, Publish still tells everyone and What's new says
-- nothing has been published since.

CREATE TABLE IF NOT EXISTS releases (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  by_name    TEXT,
  entries    TEXT NOT NULL DEFAULT '[]',  -- JSON: changelog.json entries, as they were
  content    TEXT NOT NULL DEFAULT '[]'   -- JSON: Website tabs whose content changed
);
CREATE INDEX IF NOT EXISTS releases_by_time ON releases (at);
