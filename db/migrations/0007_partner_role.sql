-- ============================================================================
-- 0007_partner_role.sql — a fourth role: partner
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- WHAT THE THREE ROLES MISSED
-- ---------------------------------------------------------------------------
-- 'staff' was doing two jobs. Somebody Thauma SENDS — whose supporters, goals
-- and website these are — is not the same as somebody who helps with that
-- work: an administrator lending a hand, or a ministry associate joining a
-- local team. Both needed the console; only one of them is the ministry.
--
-- So:
--
--   partner   a person Thauma sends. Has a partner record, appears in the
--             partner list, and is who a partner can be created FOR. Edits
--             their own content.
--
--   staff     helps with somebody else's work. Same console, no ministry of
--             their own, and no partner record created for them.
--
-- The distinction was invisible before, which is exactly why granting the
-- staff role and waiting for a partner to appear did not work: nothing in the
-- system knew that was supposed to mean anything.
--
-- WHY THIS ONE CAN BE A REBUILD WHEN 0006's COULD NOT
-- ---------------------------------------------------------------------------
-- 0006 tried to widen a CHECK on `users` and D1 refused: seven tables
-- reference it, so DROP TABLE runs an implicit delete check against all of
-- them, and PRAGMA foreign_keys = OFF is ignored inside the transaction D1
-- wraps a migration in.
--
-- NOTHING references user_roles. Rebuilding it touches no other table, so the
-- swap D1 would not allow on `users` is fine here. Checked, not assumed.
-- ============================================================================

CREATE TABLE user_roles_new (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin','partner','staff','board')),
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

INSERT INTO user_roles_new (user_id, role, granted_by, granted_at)
SELECT user_id, role, granted_by, granted_at FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

CREATE INDEX idx_user_roles_role ON user_roles(role);

-- Anyone who already owns a partner IS a partner, whatever they were called
-- before. Nobody's access changes; the system just learns which of the two
-- jobs 'staff' was doing for them.
INSERT OR IGNORE INTO user_roles (user_id, role, granted_at)
SELECT pu.user_id, 'partner', '2026-08-15T00:00:00Z'
FROM partner_users pu
WHERE pu.role = 'owner';
