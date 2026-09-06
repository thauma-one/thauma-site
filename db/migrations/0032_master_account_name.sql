-- 0032 — the master account's name, in the case a name is written in
--
-- 0029 set it to 'Thauma master account'. It is a proper noun for a thing, and
-- it appears beside people's names in the audit log and in the console's
-- People list, where sentence case reads as a description of an account rather
-- than the name of one.
--
-- Scoped to protected accounts and to the exact string 0029 wrote, so this
-- cannot rename an account somebody has since named deliberately.
UPDATE users
   SET name = 'Thauma Master Account'
 WHERE protected = 1
   AND name = 'Thauma master account';
