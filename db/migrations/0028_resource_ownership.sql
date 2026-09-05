-- 0028_resource_ownership.sql — whose a resource is, and who may change it
--
-- WHAT WAS MISSING. `resources` had two axes: WHOSE it is (partner_id, NULL
-- for the organisation) and WHO MAY SEE it (visibility). Nothing said who may
-- CHANGE it — so anybody who could open the page could edit the organisation's
-- own material, and there was nowhere for a person's own notes to live.
--
-- THE THIRD AXIS IS OWNERSHIP, and editability is DERIVED from it rather than
-- stored. A stored `is_editable` is a second copy of a fact that can drift
-- from the first; ownership cannot drift from itself.
--
--   owner_user_id NULL, partner_id NULL   the organisation's — admin edits
--   owner_user_id NULL, partner_id set    that ministry's — its own people edit
--   owner_user_id set                     a person's own — only they edit
--
-- Staff may not create organisation-wide material at all. Chase's call, and
-- the right one: they would be making something they then cannot edit, which
-- reads as a bug rather than a rule.
--
-- SHARING IS A TABLE, NOT A COLUMN. "Shared with" is many people per resource,
-- and a comma-separated column is how that becomes unqueryable a year later.
--
-- RESHARING IS ALLOWED. Also Chase's call: these are internal Thauma documents
-- among colleagues, not material where onward sharing is a betrayal of the
-- owner. So a share does not record permission to share — everyone who can see
-- a resource may pass it on, and shared_by keeps the trail of who did.

ALTER TABLE resources ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;

-- ON DELETE CASCADE, unlike created_by which is SET NULL in 0010: attribution
-- should survive somebody leaving, but a private shelf should not outlive its
-- owner as material nobody can see or delete.
CREATE INDEX idx_resources_owner ON resources (owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE TABLE resource_shares (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Who passed it on. Not an authorisation — resharing is open — but the trail
  -- that answers "how did I get this", which is the question somebody asks
  -- when a document turns up they did not expect.
  shared_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  shared_at   TEXT NOT NULL,

  PRIMARY KEY (resource_id, user_id)
);

CREATE INDEX idx_resource_shares_user ON resource_shares (user_id);

-- An owner sharing with themselves is a no-op that would show the resource
-- twice in a list built from a UNION. Refused at the door rather than
-- de-duplicated at every read.
CREATE TRIGGER resource_shares_not_the_owner
BEFORE INSERT ON resource_shares
FOR EACH ROW WHEN NEW.user_id = (SELECT owner_user_id FROM resources WHERE id = NEW.resource_id)
BEGIN
  SELECT RAISE(ABORT, 'a resource cannot be shared with its own owner');
END;
