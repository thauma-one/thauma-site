-- 0027_subscriber_language.sql — which language to write to somebody in
--
-- WHY NOW, WHEN THE TRANSLATIONS ARE NOT READY. Because this fact is
-- perishable and the translations are not. A template can be translated in any
-- week of any year; the language somebody was reading when they signed up
-- exists for one request and is gone. Recording it now means that when the
-- Croatian confirmation email is written, the people who should receive it are
-- already known — rather than being guessed at from an address, which cannot
-- be done.
--
-- CAPTURED, NOT ASKED. The sign-up form does not offer a language picker: the
-- page it sits on already is one. Somebody reading /hr/ and typing their
-- address into the form on it has told us, and asking again would be a
-- question with an obvious answer.
--
-- NULL MEANS "we never knew". Not "English" — a default that pretends to be a
-- choice is how a Croatian supporter ends up on the English list forever with
-- nobody able to tell whether that was decided or assumed. The send falls back
-- to the partner's own default when this is NULL, and that fallback is visible
-- in code rather than frozen into the data.
--
-- IT REFERENCES languages(code) so a value can only be one the site actually
-- publishes, and switching a language off does not orphan anybody.

ALTER TABLE subscribers ADD COLUMN lang TEXT REFERENCES languages(code);

-- The read that matters is "everyone on this list who reads Croatian", for a
-- send that has a Croatian version. Partial, because the rows worth grouping
-- are the ones where somebody actually told us.
CREATE INDEX idx_subscribers_lang ON subscribers (list_id, lang) WHERE lang IS NOT NULL;
