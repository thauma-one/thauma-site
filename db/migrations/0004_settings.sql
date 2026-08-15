-- ============================================================================
-- 0004_settings.sql — the two language settings, which are not the same setting
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- These were conflated in conversation for several rounds, so they are written
-- down here plainly:
--
--   users.preferred_lang     PER PERSON. Which language the editor opens in.
--                            Chase works in English, a Croatian colleague
--                            works in Croatian, and they are editing the same
--                            milestones. Changed by the person themselves.
--                            Added in 0003.
--
--   partners.default_lang    PER PARTNER, ADMIN ONLY. The language a partner
--                            site treats as authoritative: what a visitor gets
--                            before choosing, and what a consumer falls back
--                            to when a translation is missing. Expected to
--                            stay English; it exists so that assumption is a
--                            row rather than a hard-coded string.
--
-- Nobody's editing preference should change what a website shows, and nobody
-- should have to change what a website shows to work in their own language.
-- ============================================================================

ALTER TABLE partners ADD COLUMN default_lang TEXT REFERENCES languages(code);

-- Existing partners get the language the sites already treat as primary.
UPDATE partners SET default_lang = 'en' WHERE default_lang IS NULL;
