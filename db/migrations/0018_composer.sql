-- 0018_composer.sql — writing, sending, and keeping what was sent
--
-- The composer needed four things the mailings table did not have.
--
-- A SLUG, because a sent mailing gets a public address in the archive and an
-- id is not one somebody can read or link to in a footer.
--
-- A PREHEADER, the line an inbox shows next to the subject. Left unset, mail
-- clients scrape the first words of the body, which is usually "View this in
-- your browser" — the one line nobody wants as their summary.
--
-- A PUBLIC ARCHIVE FLAG ON THE LIST, not on each mailing. chaseroush.com has
-- this right: newsletters are public, prayer updates are not, and that is a
-- property of the LIST rather than a decision to remake every time somebody
-- writes. Per-mailing would mean one forgetful moment publishes a prayer
-- request naming somebody.
--
-- A SENT COUNT, frozen at send time. Counting recipients later gives a number
-- that drifts as people unsubscribe, so "sent to 128" would quietly become
-- "sent to 119" — a record of what happened must not move.

ALTER TABLE mailing_lists ADD COLUMN archive_public INTEGER NOT NULL DEFAULT 0
  CHECK (archive_public IN (0, 1));

ALTER TABLE mailings ADD COLUMN slug TEXT;
ALTER TABLE mailings ADD COLUMN preheader TEXT;
ALTER TABLE mailings ADD COLUMN sent_count INTEGER NOT NULL DEFAULT 0;

-- Unique WITHIN a list, so two lists may each have a "june-update".
-- Partial: drafts have no slug yet, and NULLs must not collide.
CREATE UNIQUE INDEX idx_mailings_slug ON mailings (list_id, slug)
  WHERE slug IS NOT NULL;
