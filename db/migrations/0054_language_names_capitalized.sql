-- 0054_language_names_capitalized.sql — a language's own name, capitalized
--
-- Intl writes some languages' names for themselves in lowercase — Slovenian
-- is "slovenščina" — and that is what was stored when Slovenian was added, so
-- it sat lowercase beside "English", "Hrvatski" and "Српски" in every list.
-- New languages are capitalized as they are added (admin-content.js
-- languageNames); this mends the rows already there.
--
-- SQLite's upper() only changes ASCII letters, which is every lowercase first
-- letter Intl has produced here; a name starting with anything else is left
-- as it is. Safe to run twice.

UPDATE languages
   SET native_name = upper(substr(native_name, 1, 1)) || substr(native_name, 2)
 WHERE native_name <> ''
   AND substr(native_name, 1, 1) <> upper(substr(native_name, 1, 1));
