-- ============================================================================
-- 0042_directory_outlives_a_leaver.sql — a shared card survives its author
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- The Directory became the MINISTRY'S address book on 2026-09-28, shared by
-- its team (Chase, 2026-09-26: "a new team member inherits the partner's
-- contacts"). directory_contacts.user_id was ON DELETE CASCADE, which 0010
-- called correct: "these ARE the person … their address book". It was, while
-- the book was theirs. Now it would mean removing somebody's account quietly
-- takes every pastor and technician they ever added out of their colleagues'
-- directory.
--
-- So user_id becomes what 0010 made every other "who did this" column:
-- ATTRIBUTION — nullable, ON DELETE SET NULL. The card stays; who added it
-- becomes unknown (the console then shows no "Added by"). Every row is copied
-- unchanged: nothing a person sees changes until somebody is removed.
--
-- THE REBUILD, done as 0010 did it, and for 0010's reasons:
--   · The trigger comes down FIRST. directory_owner_has_partner lives ON this
--     table; dropping the table drops it, and it must come back identical —
--     it is what stops a card being filed under a ministry its author cannot
--     reach.
--   · Nothing references directory_contacts, so D1 allows the swap. Checked
--     (grep "REFERENCES directory_contacts" finds nothing), not assumed.
--   · Both indexes come back.
-- ============================================================================

DROP TRIGGER IF EXISTS directory_owner_has_partner;

CREATE TABLE directory_contacts_new (
  id          TEXT PRIMARY KEY,
  -- Who added it. Attribution, not ownership: the ministry's team shares the
  -- card, and it outlives the account of whoever wrote it.
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT,
  emails      TEXT NOT NULL DEFAULT '[]',
  phones      TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT INTO directory_contacts_new
  (id, user_id, partner_id, name, role, emails, phones, created_at, updated_at)
SELECT id, user_id, partner_id, name, role, emails, phones, created_at, updated_at
  FROM directory_contacts;
DROP TABLE directory_contacts;
ALTER TABLE directory_contacts_new RENAME TO directory_contacts;
CREATE INDEX idx_directory_owner ON directory_contacts(user_id);
CREATE INDEX idx_directory_partner ON directory_contacts(partner_id);

-- Back, unchanged. A card cannot be filed under a ministry whose team its
-- author is not on.
CREATE TRIGGER directory_owner_has_partner
BEFORE INSERT ON directory_contacts
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM partner_users
      WHERE user_id = NEW.user_id AND partner_id = NEW.partner_id)
    THEN RAISE(ABORT, 'contact owner has no access to that partner')
  END;
END;
