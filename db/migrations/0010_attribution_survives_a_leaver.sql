-- ============================================================================
-- 0010_attribution_survives_a_leaver.sql — removing a person, for real
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- 0009 WAS ONLY A THIRD OF THE ANSWER
-- ---------------------------------------------------------------------------
-- It removed the foreign key on `audit_log`, and removing a person still
-- failed with the same error. Five OTHER columns reference users(id) with no
-- ON DELETE rule, and any one of them holding the id refuses the delete:
--
--   partner_users.granted_by    who granted this partner access
--   user_roles.granted_by       who granted this role
--   api_keys.created_by         who minted this key
--   resources.created_by        who added this document
--   interactions.logged_by      who logged this conversation
--
-- On the dev database it was `interactions.logged_by`, holding five rows. The
-- error is identical whichever one it is, which is why fixing audit_log looked
-- like it should have been enough and was not. **Grep for every reference to a
-- table before declaring its deletions fixed** — I fixed one and reported the
-- problem solved, twice.
--
-- SET NULL, NOT CASCADE, AND NOT NO-KEY
-- ---------------------------------------------------------------------------
-- Three different columns, three different right answers, and they are worth
-- separating:
--
--   audit_log        NO FOREIGN KEY AT ALL (0008, 0009). Its whole job is to
--                    name who did something. The name must outlive them, so
--                    the column holds a plain value nothing can null.
--
--   these five       ON DELETE SET NULL. They are ATTRIBUTION on a row whose
--                    real content is something else — a conversation, a
--                    document, a grant. Losing "who logged it" is a shame;
--                    losing the conversation is data loss. The row stays and
--                    authorship becomes unknown.
--
--   partner_users.user_id, user_roles.user_id, directory_contacts.user_id
--                    ON DELETE CASCADE already, correctly. These ARE the
--                    person: their roles, their access, their address book.
--                    Nothing of them should outlive the account.
--
-- THE REBUILDS ARE SAFE
-- ---------------------------------------------------------------------------
-- D1 refuses a rebuild when other tables reference the one being rebuilt —
-- that is what stopped 0006 rebuilding `users`. Nothing references any of
-- these five, so the swap is fine. Checked, not assumed.
--
-- Indexes and triggers are recreated below: dropping a table drops both, and
-- `interactions` carries the two triggers that keep a newsletter from being
-- logged as personal contact and an interaction from crossing partners. Losing
-- either would be far worse than the bug this migration fixes.
-- ============================================================================

-- ---------- partner_users ---------------------------------------------------
-- ⚠ THE TRIGGER COMES DOWN FIRST, AND THIS IS NOT OPTIONAL.
--
-- `directory_owner_has_partner` (0005, on directory_contacts) reads
-- partner_users. SQLite validates EVERY trigger during ALTER TABLE ... RENAME,
-- so with partner_users dropped and not yet renamed back, the rename itself
-- fails: "no such table: main.partner_users". The DROP has already happened by
-- then, so the schema is left without the table at all and every subsequent
-- statement fails too.
--
-- Measured 2026-08-16: this took the whole migration set from 33 passing tests
-- to 0. 0003 recorded the same trap in its own comments — "a trigger or
-- foreign key naming a table being rebuilt is validated mid-swap and fails" —
-- and it is worth re-reading before any future rebuild.
DROP TRIGGER IF EXISTS directory_owner_has_partner;

CREATE TABLE partner_users_new (
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner','assist','view')),
  granted_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (partner_id, user_id)
);
INSERT INTO partner_users_new SELECT partner_id, user_id, role, granted_by, granted_at FROM partner_users;
DROP TABLE partner_users;
ALTER TABLE partner_users_new RENAME TO partner_users;
CREATE INDEX idx_partner_users_user ON partner_users(user_id);

-- Back, unchanged, now that the table it reads exists again. A contact cannot
-- be filed under a partner its owner has no access to.
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

-- ---------- user_roles ------------------------------------------------------
CREATE TABLE user_roles_new (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin','partner','staff','board')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);
INSERT INTO user_roles_new SELECT user_id, role, granted_by, granted_at FROM user_roles;
DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;
CREATE INDEX idx_user_roles_role ON user_roles(role);

-- ---------- api_keys --------------------------------------------------------
CREATE TABLE api_keys_new (
  id            TEXT PRIMARY KEY,
  partner_id    TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT NOT NULL DEFAULT 'read:public',
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);
INSERT INTO api_keys_new SELECT id, partner_id, name, key_hash, scopes, created_by,
                                created_at, last_used_at, revoked_at FROM api_keys;
DROP TABLE api_keys;
ALTER TABLE api_keys_new RENAME TO api_keys;
CREATE INDEX idx_api_keys_partner ON api_keys(partner_id);

-- ---------- resources -------------------------------------------------------
CREATE TABLE resources_new (
  id          TEXT PRIMARY KEY,
  -- NULL means organisation-wide: material every partner should see.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  link        TEXT,
  photo       TEXT,
  visibility  TEXT NOT NULL DEFAULT 'staff'
                CHECK (visibility IN ('staff','admin','board')),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT INTO resources_new SELECT id, partner_id, title, description, link, photo,
                                 visibility, created_by, created_at, updated_at FROM resources;
DROP TABLE resources;
ALTER TABLE resources_new RENAME TO resources;
CREATE INDEX idx_resources_partner ON resources(partner_id, visibility);

-- ---------- interactions ----------------------------------------------------
-- ⚠ SAME TRAP, DIFFERENT OBJECT. The `contact_touch` VIEW reads interactions,
-- and a view is validated during the rename exactly as a trigger is. Down
-- first, back afterwards.
--
-- Found by asking the schema which objects reference each table being rebuilt,
-- rather than by hitting them one at a time — which is how the trigger above
-- was found, one failed run later. The general form: before any rebuild, list
-- every view and trigger whose SQL mentions the table and is not ON it.
DROP VIEW IF EXISTS contact_touch;

CREATE TABLE interactions_new (
  id            TEXT PRIMARY KEY,
  contact_id    TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  partner_id    TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'call','text','email','visit','meal','video_call',
                  'handwritten','newsletter','postal_mail','event','other')),
  is_personal   INTEGER NOT NULL CHECK (is_personal IN (0,1)),
  channel       TEXT NOT NULL DEFAULT 'digital' CHECK (channel IN ('digital','physical','in_person')),
  occurred_on   TEXT NOT NULL,
  note          TEXT,
  logged_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','newsletter','import')),
  created_at    TEXT NOT NULL
);
INSERT INTO interactions_new SELECT id, contact_id, partner_id, type, is_personal,
                                    channel, occurred_on, note, logged_by, source,
                                    created_at FROM interactions;
DROP TABLE interactions;
ALTER TABLE interactions_new RENAME TO interactions;

CREATE INDEX idx_interactions_contact  ON interactions(contact_id, occurred_on DESC);
CREATE INDEX idx_interactions_partner  ON interactions(partner_id, occurred_on DESC);
CREATE INDEX idx_interactions_personal ON interactions(partner_id, is_personal, occurred_on DESC);

-- THE MOST IMPORTANT LINES IN THIS FILE. These two triggers are what make
-- "personally contacted" mean something, and dropping the table dropped them.
-- Recreated exactly as they were.
CREATE TRIGGER trg_interactions_bulk_not_personal
BEFORE INSERT ON interactions
FOR EACH ROW WHEN NEW.type IN ('newsletter') AND NEW.is_personal = 1
BEGIN
  SELECT RAISE(ABORT, 'newsletter interactions cannot be marked personal');
END;

CREATE TRIGGER trg_interactions_partner_match
BEFORE INSERT ON interactions
FOR EACH ROW WHEN NEW.partner_id <> (SELECT partner_id FROM contacts WHERE id = NEW.contact_id)
BEGIN
  SELECT RAISE(ABORT, 'interaction.partner_id must match contact.partner_id');
END;

-- Back, unchanged. THE most important object in this schema: it computes
-- last_contact_any and last_personal_contact SEPARATELY, which is what makes
-- "newslettered 13 days ago, not actually spoken to in 165" visible instead of
-- hidden behind a single reassuring number.
CREATE VIEW contact_touch AS
SELECT
  c.id                AS contact_id,
  c.partner_id        AS partner_id,
  MAX(i.occurred_on)  AS last_contact_any,
  MAX(CASE WHEN i.is_personal = 1 THEN i.occurred_on END) AS last_personal_contact,
  COUNT(i.id)         AS interaction_count,
  SUM(CASE WHEN i.is_personal = 1 THEN 1 ELSE 0 END)      AS personal_count
FROM contacts c
LEFT JOIN interactions i ON i.contact_id = c.id
WHERE c.status = 'active'
GROUP BY c.id, c.partner_id;
