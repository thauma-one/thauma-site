-- 0039_form_words.sql — a form's own words, in every language
--
-- The sign-up form and the contact form can carry a ministry's own heading,
-- a line under it, a button and (contact) what a visitor sees after sending.
-- Until now those were ONE string each, in whatever language somebody typed:
-- the sign-up form even borrowed them from whichever of its lists came first
-- alphabetically, so closing a list could change the form's heading. Every
-- other word on both forms was already translated. Chase, 2026-09-26:
-- everything a visitor reads must be translatable.
--
-- So the words belong to the FORM, per language:
--
--   partner_id  the ministry; NULL is Thauma's own form (the organization has
--               no partner row, the same convention as mailing_lists)
--   form        'signup' | 'contact'
--   lang        a language code; one row per language that has words
--   heading, blurb, button, thanks   NULL or empty = the widget's own
--               translated default in that language (thanks: contact only)
--
-- A language with no row shows the defaults, translated — never another
-- language's custom words.
--
-- BACKFILLED so nothing a visitor sees changes: each form's current words are
-- copied into the ministry's default language (English for Thauma's own) —
-- the contact form's from contact_forms, the sign-up form's from the list it
-- wears today (the first open list, alphabetically). The old columns stay, so
-- reverting the code that reads this strands nothing.

CREATE TABLE IF NOT EXISTS form_words (
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,
  form        TEXT NOT NULL CHECK (form IN ('signup', 'contact')),
  lang        TEXT NOT NULL,
  heading     TEXT,
  blurb       TEXT,
  button      TEXT,
  thanks      TEXT,
  updated_at  TEXT NOT NULL
);

-- One row per form per language per owner. COALESCE because NULL (Thauma) is
-- never equal to NULL in a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS form_words_one
  ON form_words (COALESCE(partner_id, ''), form, lang);

INSERT INTO form_words (partner_id, form, lang, heading, blurb, button, thanks, updated_at)
SELECT c.partner_id, 'contact', COALESCE(p.default_lang, 'en'),
       NULLIF(c.heading, ''), NULLIF(c.blurb, ''), NULLIF(c.button, ''), NULLIF(c.thanks, ''),
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM contact_forms c
  LEFT JOIN partners p ON p.id = c.partner_id
 WHERE COALESCE(c.heading, '') <> '' OR COALESCE(c.blurb, '') <> ''
    OR COALESCE(c.button, '') <> '' OR COALESCE(c.thanks, '') <> '';

INSERT INTO form_words (partner_id, form, lang, heading, blurb, button, thanks, updated_at)
SELECT partner_id, 'signup', lang, NULLIF(form_heading, ''), NULLIF(form_blurb, ''),
       NULLIF(form_button, ''), NULL, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
  FROM (
    SELECT l.partner_id, COALESCE(p.default_lang, 'en') AS lang,
           l.form_heading, l.form_blurb, l.form_button,
           ROW_NUMBER() OVER (PARTITION BY COALESCE(l.partner_id, '')
                              ORDER BY l.name COLLATE NOCASE) AS rn
      FROM mailing_lists l
      LEFT JOIN partners p ON p.id = l.partner_id
     WHERE l.is_open = 1 AND l.archived_at IS NULL
  )
 WHERE rn = 1
   AND (COALESCE(form_heading, '') <> '' OR COALESCE(form_blurb, '') <> ''
        OR COALESCE(form_button, '') <> '');
