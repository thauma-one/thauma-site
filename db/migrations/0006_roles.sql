-- ============================================================================
-- 0006_roles.sql — administration, staff, board
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- Three org-level roles, and a person may hold more than one: a board member
-- who also does staff work is an ordinary situation, not an edge case. That
-- alone makes a join table the right shape — `users.global_role` could only
-- ever hold one answer.
--
-- WHY NOT JUST WIDEN THE OLD CHECK
-- ---------------------------------------------------------------------------
-- A CHECK cannot be altered in SQLite; widening one means rebuilding the
-- table. That was written and tried, and D1 refused it:
--
--   FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY
--
-- Seven tables reference users, so DROP TABLE runs an implicit delete check
-- against all of them. The usual escape is PRAGMA foreign_keys = OFF, and
-- SQLite ignores that pragma inside a transaction — which is exactly what D1
-- wraps a migration file in. It worked on local SQLite via executescript and
-- failed on D1, which is why migrations are tested against both.
--
-- A new table needs no rebuild, so the constraint that blocked the tidy
-- version pushed toward the better design rather than a worse one.
--
-- users.global_role IS NOW LEGACY. It stays because dropping a column has the
-- same rebuild problem, and it is backfilled below so nothing reading it
-- breaks mid-deploy. Nothing should read it after this migration — user_roles
-- is the authority. A later migration can remove it when there is a reason to
-- rebuild the table anyway.
-- ============================================================================

CREATE TABLE user_roles (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Stored values stay short and stable. The console shows
  -- "Administration"; the database says 'admin', which is what every existing
  -- row, seed file and query already contains.
  role      TEXT NOT NULL CHECK (role IN ('admin','staff','board')),
  granted_by TEXT REFERENCES users(id),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

CREATE INDEX idx_user_roles_role ON user_roles(role);

-- Everyone keeps exactly what they had.
INSERT INTO user_roles (user_id, role, granted_at)
SELECT id, global_role, '2026-08-15T00:00:00Z' FROM users;
