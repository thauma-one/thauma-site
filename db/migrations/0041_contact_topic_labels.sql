-- 0041_contact_topic_labels.sql — a contact form's reasons, in every language
--
-- The reasons a visitor picks from ("General", "Working with Thauma") were one
-- string each, in whatever language somebody typed, while everything else a
-- visitor reads on the form is translated (Chase, 2026-09-27: translate them;
-- everything public must be translatable).
--
-- labels   JSON, { lang: label } for the languages it has been written in.
--          A language without one shows `label`, which stays what it was:
--          the name as first written, and the fallback. NULL = no
--          translations yet, which is every row today, so nothing a visitor
--          sees changes.
--
-- On the row rather than in a table of its own because the console saves the
-- whole dropdown at once, replacing the rows (contact_topics_clear), so a
-- translation keyed by a row's id would be orphaned by every save. Additive:
-- reverting the code that reads it strands nothing.

ALTER TABLE contact_topics ADD COLUMN labels TEXT;
