-- 0057_mail_signatures_named.sql — several signatures per sender, by name
--
-- Chase, 2026-10-13: "you added the ability to have different types of
-- signatures right? Because sometimes a Thauma email may come from me and
-- from Thauma, but both are made on my account."
--
-- 0055 kept ONE signature per sender. Now a sender (a ministry, or
-- '~organisation' for Thauma's own mail) keeps as many as it likes, each with
-- a name — "Thauma", "Chase Roush" — and the {{signature}} in a mailing says
-- which (data-sig="<id>"); a {{signature}} that names none takes the first.
-- Anyone who sends that sender's mail may use and edit them, as before.
--
-- A signature written under 0055 is carried over as "Signature", then the
-- old table goes. The code reads this one in a statement that tolerates its
-- absence, so a deploy ahead of the migration simply has no signatures.

CREATE TABLE IF NOT EXISTS mail_sigs (
  id          TEXT PRIMARY KEY,           -- sig_ + 16 hex
  owner       TEXT NOT NULL,              -- a partner id, or '~organisation'
  name        TEXT NOT NULL,
  html        TEXT NOT NULL DEFAULT '',   -- bold, italic, underline, links, line breaks, a picture
  sort_order  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_sigs_owner ON mail_sigs(owner, sort_order);

INSERT INTO mail_sigs (id, owner, name, html, sort_order, updated_at, updated_by)
SELECT 'sig_' || lower(hex(randomblob(8))), owner, 'Signature', html, 0, updated_at, updated_by
  FROM mail_signatures WHERE html <> '';

DROP TABLE IF EXISTS mail_signatures;
