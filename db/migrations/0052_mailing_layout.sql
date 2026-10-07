-- 0052_mailing_layout.sql — a mailing on a card, or integrated
--
-- Chase, 2026-10-05: "I would still like to be able to choose between card
-- and integrated for the mail." Chosen per mailing in the composer. NULL
-- means a card (what every mailing so far has been).
--
-- Additive: reverting the code strands nothing. The code reads and writes it
-- in separate statements that tolerate its absence, so a deploy ahead of the
-- migration keeps sending cards.

ALTER TABLE mailings ADD COLUMN layout TEXT;
