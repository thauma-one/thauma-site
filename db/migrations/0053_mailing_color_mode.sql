-- 0053_mailing_color_mode.sql — a mailing in light, dark, or the reader's own
--
-- Chase, 2026-10-06: "Maybe the mailer needs a selection tool for light mail,
-- dark mail, or match system settings of the receiver. Because my computer is
-- in dark mode, so I'd want to read the update in dark mode." Chosen per
-- mailing in the composer: 'light', 'dark' or 'auto' (the reader's setting,
-- where their mail app says what it is). NULL is 'auto'.
--
-- Additive: reverting the code strands nothing. The code reads and writes it
-- in separate statements that tolerate its absence, so a deploy ahead of the
-- migration sends 'auto'.

ALTER TABLE mailings ADD COLUMN color_mode TEXT;
