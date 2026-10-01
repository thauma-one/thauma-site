-- 0047_goal_list_texts.sql — goal names and sign-up list names, in every language
--
-- Chase, 2026-10-01: "We need to fix that on Goals and Sign Up." A goal's
-- name and description, and a mailing list's name and description, were one
-- string each, in whatever language somebody typed. Milestones and prayer
-- are translated, and everything a visitor reads must be (the public
-- translatability rule), so a Croatian page showed English goals and an
-- English "Prayer" box.
--
-- texts   JSON, { lang: { label, description } } on goals and
--         { lang: { name, description } } on mailing_lists, for the
--         languages it has been written in BESIDES the ministry's own
--         (partners.default_lang). The existing columns stay what they were:
--         the wording in the ministry's language, and the fallback for any
--         language without a translation. NULL = no translations yet, which is
--         every row today, so nothing a visitor sees changes.
--
-- On the row, the same shape as contact_topics.labels (0041): the editors
-- save a goal or a list as one record, and a JSON column travels with it
-- through the "someone else saved this" check (lib/fresh.js). Additive:
-- reverting the code that reads it strands nothing.

ALTER TABLE goals ADD COLUMN texts TEXT;
ALTER TABLE mailing_lists ADD COLUMN texts TEXT;
