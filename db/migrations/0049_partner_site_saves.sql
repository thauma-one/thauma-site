-- 0049_partner_site_saves.sql — versions of a ministry's site to go back to
--
-- Chase, 2026-10-04: "In advanced, can we add a Site save state? So people
-- can play around with the design, yet go back to a design they liked if
-- things don't go well."
--
-- Undo already steps back through one sitting's changes, and Discard goes
-- back to what visitors see. Neither reaches a design from last week. A save
-- is a named copy of the whole working copy (pages, design, links, footer)
-- at a moment, kept until deleted.
--
-- kind      'manual'    saved by a person, with the name they gave it
--           'published' made by Publish, so every live version can be had
--                       back; only the newest few of these are kept
-- doc       the working copy as stored (JSON, cleaned by model.js again
--           when it is brought back, so an old save meets today's rules)
-- created_by the person's name at the time, for the list ("by Chase")
--
-- Restoring puts the copy into the WORKING copy through the editor's
-- ordinary save, so Undo can step back from a restore and nothing reaches
-- visitors until Publish.
--
-- Additive: reverting the code strands nothing.

CREATE TABLE partner_site_saves (
  id          TEXT PRIMARY KEY,
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'published')),
  doc         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  created_by  TEXT
);

CREATE INDEX idx_partner_site_saves ON partner_site_saves (partner_id, created_at);
