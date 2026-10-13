-- 0055_mail_signatures.sql — a signature for a ministry's mail
--
-- Chase, 2026-10-12: "In Mail, we should add another variable for adding an
-- email signature and the ability to create/edit the signature somewhere."
--
-- One per sender: a ministry (its partner id), or Thauma's own mail, kept
-- under '~organisation' — the same sentinel the mailing tables use for "the
-- organization", since a NULL cannot be a primary key. Written in the Mail
-- page's Signature box; put into a mailing wherever {{signature}} is.
--
-- Additive: the code reads it in a statement that tolerates its absence, so a
-- deploy ahead of this migration simply has no signature yet.

CREATE TABLE IF NOT EXISTS mail_signatures (
  owner       TEXT PRIMARY KEY,           -- a partner id, or '~organisation'
  html        TEXT NOT NULL DEFAULT '',   -- bold, italic, underline, links, line breaks
  updated_at  TEXT NOT NULL,
  updated_by  TEXT                        -- a user id; who last wrote it
);
