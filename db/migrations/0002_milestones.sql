-- ============================================================================
-- 0002_milestones.sql — public ministry milestones
-- ============================================================================
-- Forward-only. Applied to thauma-ops-dev and thauma-ops in order. Never edit
-- an applied migration.
--
-- WHY THIS TABLE EXISTS
-- ---------------------------------------------------------------------------
-- chaseroush.com renders a public roadmap of a partner's ministry: trips,
-- training, support-raising steps. It lives today as a hand-edited JSON file
-- in R2 (assets.chaseroush.com/JSON/milestones.json, 8 entries), which means
-- there is no editor, no history, no review, and the partner site owns content
-- the ORGANISATION should be the system of record for.
--
-- Moving it here is what lets Thauma manage it and publish it to any partner
-- site through the partner API.
--
-- ---------------------------------------------------------------------------
-- "TIMELINE" IS AN AMBIGUOUS WORD IN THIS SYSTEM. READ THIS.
-- ---------------------------------------------------------------------------
-- Two unrelated things get called a timeline:
--
--   MILESTONES (this table)  A public roadmap. Written to be read by
--                            strangers. Safe to publish by definition.
--
--   INTERACTIONS             Private stewardship history — who was called,
--                            when, and the note about it. Publishing one row
--                            of it would be a serious breach.
--
-- They share a word and nothing else. This table is deliberately NOT named
-- `timeline`, and the partner API deliberately never uses that word, so that
-- "expose the timeline" can never be resolved to the wrong table by someone
-- moving quickly. See db/queries.sql, section PARTNER API.
-- ============================================================================

CREATE TABLE milestones (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  -- Bilingual, matching the existing CR site. `_hr` may be NULL: a milestone
  -- with no translation yet should still publish in English rather than
  -- blocking the whole list.
  title         TEXT NOT NULL,
  title_hr      TEXT,
  description   TEXT,
  description_hr TEXT,

  -- Free text, NOT a date. The current data reads "End of September - Start
  -- of October 2026" because that is the honest precision available. Storing
  -- it as a date would force a false one.
  target_label    TEXT,
  target_label_hr TEXT,
  -- The real date, when there is one. Used for ordering; NULL sorts last.
  actual_date   TEXT,

  status        TEXT NOT NULL DEFAULT 'upcoming'
                  CHECK (status IN ('upcoming','in_progress','complete','cancelled')),
  completion    INTEGER NOT NULL DEFAULT 0
                  CHECK (completion BETWEEN 0 AND 100),

  -- Self-reference: sub-steps hang off a parent milestone, as the CR site
  -- already renders them.
  parent_id     TEXT REFERENCES milestones(id) ON DELETE SET NULL,
  sort_order    INTEGER NOT NULL DEFAULT 0,

  -- PUBLICATION IS EXPLICIT AND DEFAULTS TO OFF.
  --
  -- Same principle as goals.is_public: a row is private until somebody
  -- decides otherwise. A draft milestone about an unannounced trip must not
  -- reach a partner site because a default was permissive. The partner API
  -- filters on this and the tests assert it.
  is_public     INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  -- Whether the partner site should feature it on the home page.
  is_featured   INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),

  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_milestones_partner ON milestones(partner_id);
CREATE INDEX idx_milestones_public ON milestones(partner_id, is_public);

-- A sub-step must belong to the same partner as its parent. Same guarantee
-- the interactions/contacts trigger gives: cross-tenant nesting should be
-- impossible, not merely unlikely.
CREATE TRIGGER milestones_parent_same_partner
BEFORE INSERT ON milestones
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT partner_id FROM milestones WHERE id = NEW.parent_id) <> NEW.partner_id
    THEN RAISE(ABORT, 'milestone parent belongs to a different partner')
  END;
END;

CREATE TRIGGER milestones_parent_same_partner_update
BEFORE UPDATE OF parent_id, partner_id ON milestones
FOR EACH ROW WHEN NEW.parent_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN (SELECT partner_id FROM milestones WHERE id = NEW.parent_id) <> NEW.partner_id
    THEN RAISE(ABORT, 'milestone parent belongs to a different partner')
  END;
END;
