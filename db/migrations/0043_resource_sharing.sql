-- 0043_resource_sharing.sql — sharing a resource with a group, and who may edit
--
-- Sharing was one person at a time, by typing their email address into the
-- browser's own prompt, and whoever could see a resource could pass it on.
-- Chase, 2026-09-28: a share dialog with groups and a type-to-find box for
-- people; "can view" unless the owner says "can edit"; only the owner shares
-- or deletes. The endpoint enforces who may share; this holds the facts.
--
-- resource_shares.can_edit   1 = this person may change the resource's
--                            title, description, link and photo. Never delete
--                            it, never share it. 0 for every existing share,
--                            which is what they could do before.
--
-- resource_group_shares      a resource shared with a group rather than a
--                            person:
--   audience  'team'      the members of one ministry (partner_id): the
--                         owner's team, as it was when they shared
--             'everyone'  every active account; administrators only
--   can_edit  as above
--
-- One row per audience per resource: sharing twice with the team is the same
-- as sharing once. Additive; reverting the code strands nothing — the rows
-- are simply not read.

ALTER TABLE resource_shares ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 0;

CREATE TABLE resource_group_shares (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  audience    TEXT NOT NULL CHECK (audience IN ('team', 'everyone')),
  -- The ministry for 'team'; NULL for 'everyone'. A team share goes when its
  -- ministry does.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,
  can_edit    INTEGER NOT NULL DEFAULT 0 CHECK (can_edit IN (0, 1)),
  shared_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  shared_at   TEXT NOT NULL,
  PRIMARY KEY (resource_id, audience),
  CHECK ((audience = 'team') = (partner_id IS NOT NULL))
);

CREATE INDEX idx_resource_group_shares_partner
  ON resource_group_shares (partner_id) WHERE partner_id IS NOT NULL;
