-- 0012_timeline_prayer_palette.sql
--
-- Three things a partner's public presence was missing.
--
-- 1. TIMELINE BOUNDS
-- ============================================================================
-- Without them a roadmap starts at its first milestone and ends at its last,
-- so the whole thing is "finished" the moment the last dated entry passes, and
-- work scheduled years out sits crammed against the right edge. The bounds are
-- what let a roadmap say "this is a three-year arc and we are eight months
-- in" — chaseroush.com carries timeline_start and timeline_end in its JSON for
-- exactly this, and drives the rail's fill from ELAPSED TIME between them
-- rather than from a count of completed milestones.
--
-- Dates, not labels: these are only ever compared, never shown.
--
-- 2. A SECOND COLOUR
-- ============================================================================
-- The widget derived one by rotating the accent's hue, which reproduces the
-- cyan/green relationship but gives a partner no say in the result. Storing
-- both means the pair can be chosen — and the derived value stays as the
-- DEFAULT, so nobody has to pick two colours to get a sensible one.
--
-- NULL means "derive it", which is different from any particular colour and is
-- why this is nullable rather than defaulted to a hex.
--
-- 3. PRAYER
-- ============================================================================
-- Requests a ministry publishes, and the answers when they come. Modelled on
-- milestones because it is the same shape: a language-neutral row carrying the
-- state, and one translation row per language.
--
-- `is_answered` is separate from a status enum on purpose. A prayer is not a
-- workflow — it is either still being asked or it has been answered, and the
-- answer usually deserves its own sentence, which is what answer_text is for.

ALTER TABLE partners ADD COLUMN timeline_start TEXT;
ALTER TABLE partners ADD COLUMN timeline_end   TEXT;

-- NULL means derive from the accent. See embed-colour.js.
ALTER TABLE partners ADD COLUMN embed_accent2 TEXT;


-- 4. A SENTENCE UNDER EACH GOAL
-- ============================================================================
-- The giving page this is modelled on puts a line of explanation under every
-- goal name — what the money is actually for. The table had a label and
-- nothing else, so the widget had a rule drawn for a description that could
-- never arrive.
--
-- A plain column rather than a translations table, matching `label`, which is
-- also untranslated. That is a real gap on a multilingual site and it is
-- pre-existing: giving goals a translation table is its own migration and its
-- own editing surface, and pretending otherwise by half-doing it here would
-- leave two mechanisms for the same job.
ALTER TABLE goals ADD COLUMN description TEXT;


CREATE TABLE prayer (
  id          TEXT PRIMARY KEY,
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  -- Same publication gate as everything else public: off until chosen.
  is_public   INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),

  is_answered INTEGER NOT NULL DEFAULT 0 CHECK (is_answered IN (0, 1)),
  -- When, if the ministry wants to say. Optional: "answered" is the fact,
  -- the date is a detail.
  answered_on TEXT,

  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_prayer_partner ON prayer (partner_id, sort_order);


CREATE TABLE prayer_translations (
  prayer_id   TEXT NOT NULL REFERENCES prayer(id) ON DELETE CASCADE,
  lang        TEXT NOT NULL REFERENCES languages(code),
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  -- What happened. Written when the prayer is marked answered, and shown
  -- instead of nothing — "answered" with no account of how is a badge, not a
  -- testimony.
  answer_text TEXT,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (prayer_id, lang)
);

CREATE INDEX idx_ptx_partner ON prayer_translations (partner_id, lang);

-- A translation cannot be filed under a different partner from its prayer.
-- The same guarantee milestone_translations has, and for the same reason: the
-- partner_id is denormalised onto this table so a public query can filter on
-- it in one place, which only holds if the two can never disagree.
CREATE TRIGGER prayer_tx_same_partner
BEFORE INSERT ON prayer_translations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT partner_id FROM prayer WHERE id = NEW.prayer_id) <> NEW.partner_id
    THEN RAISE(ABORT, 'prayer translation belongs to a different partner')
  END;
END;

CREATE TRIGGER prayer_tx_same_partner_update
BEFORE UPDATE OF prayer_id, partner_id ON prayer_translations
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT partner_id FROM prayer WHERE id = NEW.prayer_id) <> NEW.partner_id
    THEN RAISE(ABORT, 'prayer translation belongs to a different partner')
  END;
END;


-- 5. goal_progress, REBUILT
-- ============================================================================
-- Two changes, and the second is a correction.
--
-- It gains `description`, which is why the column above exists.
--
-- AND IT STOPS CLAMPING `percent` AT 100. The old definition wrapped the
-- division in MIN(100, ...), so a goal raising more than it asked for reported
-- exactly 100 — the good news was the one thing the number could not express.
-- Both the widget and the published developer guide already say percent may
-- exceed 100 and that a progress BAR should clamp while the NUMBER should not,
-- so this makes the data honest and the documentation true at the same time.
--
-- Consumers that draw a bar from this must clamp it themselves. The widget
-- does; anybody building their own is told to in the guide.
DROP VIEW IF EXISTS goal_progress;

CREATE VIEW goal_progress AS
SELECT
  g.id            AS goal_id,
  g.partner_id    AS partner_id,
  g.label         AS label,
  g.description   AS description,
  g.kind          AS kind,
  g.target_cents  AS target_cents,
  g.currency      AS currency,
  g.is_public     AS is_public,
  s.raised_cents  AS raised_cents,
  s.donor_count   AS donor_count,
  s.captured_at   AS captured_at,
  CASE WHEN g.target_cents > 0
       THEN CAST(s.raised_cents * 100.0 / g.target_cents AS INTEGER)
       ELSE 0 END AS percent
FROM goals g
LEFT JOIN goal_snapshots s
  ON s.id = (SELECT id FROM goal_snapshots
             WHERE goal_id = g.id ORDER BY captured_at DESC LIMIT 1);
