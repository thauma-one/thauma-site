-- 0037_milestone_dates.sql — a milestone's date, picked once
--
-- Until now a milestone had two unrelated dates: actual_date, a day used only
-- for ordering, and target_label, a sentence typed per language ("End of
-- September – October 2026"). Nothing kept them in step, and every language
-- had to be typed by hand.
--
-- Board 8 of the console mockups (Chase, 2026-09-26): the date is PICKED ONCE,
-- at the precision that is honest — a day, a month, a season or a year — with
-- an optional end for a range. The Worker then writes each language's
-- target_label from it (Intl for months and days, emailsAndForms.json for
-- season words), so every public reader keeps reading target_label and none
-- of them changes. "Write it my way" keeps the typed sentence per language.
--
--   date_precision  'day' | 'month' | 'season' | 'year' — labels are
--                   generated from actual_date (and end_date)
--                   'custom' — the typed labels stand
--                   NULL — a milestone from before this migration; the editor
--                   treats it as 'custom' when it has typed labels, so no
--                   existing sentence is rewritten until somebody picks a date
--   end_date        the end of a range, same form as actual_date; NULL for a
--                   single date
--
-- actual_date stays the START, and the sort key: a month is stored as its
-- first day, a season as the first day of its first month (spring 03-01,
-- summer 06-01, fall 09-01, winter 12-01), a year as 01-01.
--
-- Additive only: two nullable columns, nothing rewritten, so reverting the
-- code that uses them strands no data.

ALTER TABLE milestones ADD COLUMN date_precision TEXT
  CHECK (date_precision IS NULL OR date_precision IN ('day','month','season','year','custom'));
ALTER TABLE milestones ADD COLUMN end_date TEXT;
