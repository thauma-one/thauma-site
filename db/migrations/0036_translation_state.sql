-- 0036_translation_state.sql — which translations still match their English
--
-- A translation is only as current as the English it was made from. When the
-- English of a line changes, every other language's version of that line is
-- OUTDATED — still there, still showing, and saying the old thing. Nothing in
-- the language files records that, because a translated string does not know
-- which English it was translated from.
--
-- So this table remembers it: for each line (source + key) in each language,
-- a short hash of the English at the moment that translation was last written
-- or approved. The Translate page hashes the English as it is now; a
-- different hash means the English moved on and the translation did not.
--
--   source   'site'   — src/_data/i18n/<lang>.json, the site's words
--            'emails' — src/_data/emailsAndForms.json, emails, the confirm
--                       and unsubscribe pages, the sign-up and contact forms
--   key      the dotted path inside that source, e.g. 'home.title'
--
-- AND A FINGERPRINT OF THE TRANSLATION, because the English is not the only
-- thing that moves. When a line's English AND its translation have both
-- changed since the record, somebody rewrote the two together — a developer
-- editing all the language files in one commit, which is how most copy
-- changes have been made — and the line is current, not outdated. Only
-- English that moved while the translation stood still is outdated.
--
-- A LINE WITH NO ROW IS TAKEN AS CURRENT, and gets a row the first time the
-- page sees it. Every translation that existed before this table did is
-- therefore accepted as matching today's English — the only honest starting
-- point, since nothing recorded what it was made from.
--
-- IN THE DATABASE, NOT THE REPOSITORY, for the same reason as the notes: it is
-- bookkeeping about the words, not words, and approving a translation must not
-- need a second commit to say that it was approved. Each database (dev,
-- staging, live) keeps its own; all three read the same files.
--
-- Authorship is SET NULL on a person's removal, like every other attribution.

CREATE TABLE IF NOT EXISTS translation_state (
  source        TEXT NOT NULL CHECK (source IN ('site', 'emails')),
  key           TEXT NOT NULL,
  lang          TEXT NOT NULL,
  english_hash  TEXT NOT NULL,
  text_hash     TEXT NOT NULL,
  confirmed_at  TEXT NOT NULL,
  confirmed_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (source, key, lang)
);

CREATE INDEX IF NOT EXISTS idx_translation_state_lang ON translation_state(lang);
