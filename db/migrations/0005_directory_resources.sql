-- ============================================================================
-- 0005_directory_resources.sql — give the address book and the library owners
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- Both lived in a single KV entry under the key "data". Not per person, not
-- even per partner — ONE document for the whole installation. Every staff
-- member of every partner read and wrote the same object, and because the
-- editor saved the whole thing at once, two people editing on the same
-- afternoon meant the second silently erased the first.
--
-- It survived this long because there was one user and no real data in it.
-- The KV entry was still empty when this migration was written, so nothing had
-- to be carried across.
--
-- WHO OWNS WHAT, NOW
-- ---------------------------------------------------------------------------
--   directory_contacts   PER PERSON. Chase's contacts are Chase's. A colleague
--                        sharing the partner does not see them. This is
--                        somebody's own professional address book, not a
--                        shared asset, and treating it as shared was the
--                        clearest thing wrong with the old arrangement.
--
--   resources            PER PARTNER, or organisation-wide when partner_id is
--                        NULL. Shared on purpose — it is a library. What is
--                        NOT shared is visibility: a resource can be limited
--                        to admins or the board while staff-level material
--                        stays visible to everyone.
--
-- Both carry partner_id so a query that forgets to scope is a bug you can
-- grep for, which is the rule the rest of this schema already follows.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The address book — one per person
-- ---------------------------------------------------------------------------
CREATE TABLE directory_contacts (
  id          TEXT PRIMARY KEY,
  -- The owner. ON DELETE CASCADE: removing a staff member takes their private
  -- address book with them rather than leaving it ownerless in the database.
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id  TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  name        TEXT NOT NULL,
  role        TEXT,

  -- JSON arrays. A directory card is read and written whole, never queried by
  -- individual address, so two more tables would buy nothing and cost a join
  -- on every read. If we ever need "who else knows this person", normalise
  -- then — not in advance.
  emails      TEXT NOT NULL DEFAULT '[]',
  phones      TEXT NOT NULL DEFAULT '[]',

  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_directory_owner ON directory_contacts(user_id);
CREATE INDEX idx_directory_partner ON directory_contacts(partner_id);

-- A contact cannot be filed under a partner its owner has no access to.
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


-- ---------------------------------------------------------------------------
-- The library — shared, with levels
-- ---------------------------------------------------------------------------
CREATE TABLE resources (
  id          TEXT PRIMARY KEY,
  -- NULL means organisation-wide: material every partner should see. A
  -- partner id means it belongs to that partner alone.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,

  title       TEXT NOT NULL,
  description TEXT,
  link        TEXT,
  photo       TEXT,

  -- WHO MAY SEE IT. 'staff' is the default because the common case is
  -- material everyone needs; anything narrower has to be chosen.
  --
  -- 'board' has no matching role yet. It is in the CHECK now so that adding
  -- the role later is a change to who can read, not a migration of every row
  -- — and a forgotten CHECK is how enums end up holding typos.
  visibility  TEXT NOT NULL DEFAULT 'staff'
                CHECK (visibility IN ('staff','admin','board')),

  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_resources_partner ON resources(partner_id, visibility);
