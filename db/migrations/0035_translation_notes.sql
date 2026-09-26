-- 0035_translation_notes.sql — what every translator reads, AI or human
--
-- Chase, 2026-09-26: a translation has to fit the culture it is for, and some
-- phrases have no direct equivalent — "All of Me For All of Him" has no
-- literal Croatian, and the rendering he was given is "Sve od mene Darujem
-- Njega". Knowledge like that has to live somewhere every translator reads
-- it: the file handed to a person or to Claude, and later the auto-translate
-- button. Three kinds of it:
--
--   translation_keep       words never translated, in any language
--                          ("Thauma", "θαῦμα", "501(c)3")
--   translation_glossary   a fixed rendering of a phrase in one language
--   translation_guides     how a language is written: script, dialect,
--                          tone. lang '*' is guidance for every language.
--
-- IN THE DATABASE, NOT A SITE FILE. None of this is public; saving it must not
-- wait for a Publish. The languages themselves live in site.json, so `lang`
-- is a code checked for shape by the endpoint, not a foreign key.
--
-- ORGANIZATION-WIDE. A partner-specific glossary (their own names, their own
-- phrases) is a later step if it is ever needed; nothing here prevents it.
--
-- Authorship is SET NULL on a person's removal, like every other attribution:
-- the note survives the person who wrote it.

CREATE TABLE IF NOT EXISTS translation_keep (
  id          TEXT PRIMARY KEY,
  term        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS translation_glossary (
  id          TEXT PRIMARY KEY,
  lang        TEXT NOT NULL,
  source      TEXT NOT NULL COLLATE NOCASE,
  target      TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (lang, source)
);

CREATE TABLE IF NOT EXISTS translation_guides (
  lang        TEXT PRIMARY KEY,
  guidance    TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- What is already known, so the notes are useful on the day they exist.
-- OR IGNORE: a database that already has an entry keeps its own wording.
INSERT OR IGNORE INTO translation_keep (id, term, created_at) VALUES
  ('tk_thauma',  'Thauma',   '2026-09-26T00:00:00Z'),
  ('tk_thaumag', 'θαῦμα',    '2026-09-26T00:00:00Z'),
  ('tk_501c3',   '501(c)3',  '2026-09-26T00:00:00Z'),
  ('tk_irs',     'IRS',      '2026-09-26T00:00:00Z');

INSERT OR IGNORE INTO translation_glossary (id, lang, source, target, created_at, updated_at) VALUES
  ('tg_motto_hr', 'hr', 'All of Me For All of Him', 'Sve od mene Darujem Njega',
   '2026-09-26T00:00:00Z', '2026-09-26T00:00:00Z');

INSERT OR IGNORE INTO translation_guides (lang, guidance, updated_at) VALUES
  ('*', 'Translate the meaning the way a native copywriter would, never word for word. Lead with the real technical need and the concrete work; care for people is the engine underneath, not the banner. Never headline "free". Warm, plain, direct. Where a headline has a thin part and a bold part, keep the bold on the matching words.',
   '2026-09-26T00:00:00Z'),
  ('hr', 'Standard Croatian, Latin script.', '2026-09-26T00:00:00Z'),
  ('sr', 'Standard Serbian as written in Serbia: Cyrillic script, ekavian forms (месечна, овде). Serbian vocabulary — never Croatian words written in Cyrillic.',
   '2026-09-26T00:00:00Z'),
  ('sl', 'Standard Slovenian, Latin script.', '2026-09-26T00:00:00Z');
