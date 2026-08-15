-- ============================================================================
-- 0003_languages.sql — multilingual, on demand
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- 0002 gave milestones `title` and `title_hr`, mirroring chaseroush.com's
-- bilingual JSON. Thauma's site already had three languages, so Serbian had
-- nowhere to go — and a fourth language would have meant another migration and
-- three more columns every time.
--
-- Caught from the editor UI on 2026-08-15, before any Serbian content existed.
--
-- TWO LAYERS, AND THE DISTINCTION IS THE POINT
-- ---------------------------------------------------------------------------
--   languages          the ORGANISATION's catalogue. Only an admin adds to it.
--                      Adding Spanish is one row, not a migration.
--
--   partner_languages  each PARTNER decides which of those their own API
--                      publishes. A partner who does not serve Serbian turns
--                      it off without affecting anyone else.
--
-- Disabling a language hides it from the PUBLIC API only. Translations already
-- written stay exactly where they are, so a translation can be prepared before
-- it is switched on, and switching one off is never destructive.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE languages (
  code        TEXT PRIMARY KEY,        -- BCP-47-ish: 'en', 'hr', 'sr', 'pt-BR'
  name        TEXT NOT NULL,           -- 'Croatian'   — shown to staff
  native_name TEXT,                    -- 'Hrvatski'   — shown to visitors
  -- Retiring a language is not deleting it. Content in a deactivated language
  -- stays readable; it simply stops being offered.
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

INSERT INTO languages (code, name, native_name, sort_order, created_at) VALUES
  ('en', 'English',  'English',   0, '2026-08-15T00:00:00Z'),
  ('hr', 'Croatian', 'Hrvatski',  1, '2026-08-15T00:00:00Z'),
  ('sr', 'Serbian',  'Српски',    2, '2026-08-15T00:00:00Z');


-- ---------------------------------------------------------------------------
-- Which languages a partner publishes
-- ---------------------------------------------------------------------------
CREATE TABLE partner_languages (
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES languages(code),
  is_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0,1)),
  -- The order they appear on the partner's own site.
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (partner_id, lang)
);


-- ---------------------------------------------------------------------------
-- Move the existing text out of milestones
-- ---------------------------------------------------------------------------
-- Held in a temporary table because the next step rebuilds `milestones`, and
-- the language columns have to survive the rebuild that removes them.
CREATE TABLE _tx_carry AS
SELECT id, partner_id, title, title_hr, description, description_hr,
       target_label, target_label_hr, updated_at
FROM milestones;


-- ---------------------------------------------------------------------------
-- Rebuild milestones without the language columns
-- ---------------------------------------------------------------------------
-- The create/copy/drop/rename dance rather than DROP COLUMN, because this
-- migration has to run identically on local SQLite, D1, and whatever the
-- database is in five years. DROP COLUMN needs SQLite 3.35+; this needs
-- nothing.
CREATE TABLE milestones_new (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES milestones_new(id) ON DELETE SET NULL,
  actual_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'upcoming'
                  CHECK (status IN ('upcoming','in_progress','complete','cancelled')),
  completion    INTEGER NOT NULL DEFAULT 0 CHECK (completion BETWEEN 0 AND 100),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_public     INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0,1)),
  is_featured   INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

INSERT INTO milestones_new (id, partner_id, parent_id, actual_date, status,
                            completion, sort_order, is_public, is_featured,
                            created_at, updated_at)
SELECT id, partner_id, parent_id, actual_date, status,
       completion, sort_order, is_public, is_featured, created_at, updated_at
FROM milestones;

DROP TABLE milestones;
ALTER TABLE milestones_new RENAME TO milestones;

CREATE INDEX idx_milestones_partner ON milestones(partner_id);
CREATE INDEX idx_milestones_public ON milestones(partner_id, is_public);

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


-- ---------------------------------------------------------------------------
-- Milestone text, one row per language
-- ---------------------------------------------------------------------------
-- CREATED AFTER THE REBUILD, AND IT HAS TO BE. Both the foreign key and the
-- trigger below name `milestones`; defining them before the rebuild meant
-- SQLite validated the trigger while that table was mid-swap and refused
-- the whole migration with "no such table: main.milestones".
-- partner_id is carried here as well as on the milestone. Denormalised on
-- purpose: every tenant-owned row in this schema can be scoped without a join,
-- so a query that forgets to scope is a bug you can grep for rather than a
-- silent cross-tenant read. A trigger keeps it honest.
CREATE TABLE milestone_translations (
  milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  lang         TEXT NOT NULL REFERENCES languages(code),
  partner_id   TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  target_label TEXT,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (milestone_id, lang)
);

CREATE INDEX idx_mtx_partner ON milestone_translations(partner_id, lang);

-- A translation cannot be filed under a different partner from its milestone.
-- Same guarantee the interactions/contacts trigger gives.
CREATE TRIGGER mtx_partner_match
BEFORE INSERT ON milestone_translations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT partner_id FROM milestones WHERE id = NEW.milestone_id) <> NEW.partner_id
    THEN RAISE(ABORT, 'translation partner does not match its milestone')
  END;
END;


-- ---------------------------------------------------------------------------
-- Land the carried text as translations
-- ---------------------------------------------------------------------------
-- English first: 0002's unsuffixed columns were always the English copy.
INSERT INTO milestone_translations (milestone_id, lang, partner_id, title,
                                    description, target_label, updated_at)
SELECT id, 'en', partner_id, title, description, target_label, updated_at
FROM _tx_carry
WHERE title IS NOT NULL;

-- Croatian only where it actually exists. A NULL title_hr meant "not
-- translated yet", and inserting an empty row would turn that into "translated
-- to nothing", which is worse — the editor could no longer tell them apart.
INSERT INTO milestone_translations (milestone_id, lang, partner_id, title,
                                    description, target_label, updated_at)
SELECT id, 'hr', partner_id, title_hr, description_hr, target_label_hr, updated_at
FROM _tx_carry
WHERE title_hr IS NOT NULL AND TRIM(title_hr) <> '';

DROP TABLE _tx_carry;


-- ---------------------------------------------------------------------------
-- Every existing partner keeps the languages the site already had
-- ---------------------------------------------------------------------------
INSERT INTO partner_languages (partner_id, lang, is_enabled, sort_order)
SELECT p.id, l.code, 1, l.sort_order FROM partners p CROSS JOIN languages l;


-- ---------------------------------------------------------------------------
-- A staff member's own working language
-- ---------------------------------------------------------------------------
-- What the editor shows in its left-hand column. NULL means "English", rather
-- than forcing an answer out of everyone who already exists.
ALTER TABLE users ADD COLUMN preferred_lang TEXT REFERENCES languages(code);
