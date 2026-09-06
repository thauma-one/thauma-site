-- 0029 — the protected account is a SYSTEM account, not a person
--
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- admin@thauma.one exists so that there is always a way in: 0026 made it
-- undeletable, undisableable, and unable to lose the administrator role. But
-- everywhere else it was treated as an ordinary member of staff. It carried a
-- person's name, held two of the four roles, and had grown a staff profile
-- with a public slug.
--
-- That is confusing in a way that matters. Two accounts reading "Chase Roush"
-- in the audit log is not a cosmetic problem — it makes the record of who did
-- what ambiguous, which is the one thing an audit log is for.
--
-- So: an impersonal name, every role permanently, and no public profile.
--
-- WHY EVERY ROLE RATHER THAN JUST ADMIN. The account's whole purpose is to be
-- the way back in when something is wrong. A failsafe that can reach the
-- administration pages but not the staff console is a failsafe with a gap in
-- it, and the gap is only discovered on the day it is needed.

-- ---------------------------------------------------------------------------
-- 1. An impersonal name.
--
-- Scoped to protected accounts, of which there is one. Nothing here guesses at
-- a name it is replacing: whatever it said, a system account should not be
-- named after a person, and the person it was named after has their own
-- account now.
UPDATE users SET name = 'Thauma master account' WHERE protected = 1;

-- ---------------------------------------------------------------------------
-- 2. Every role, granted now.
--
-- OR IGNORE because two of the four are usually already there, and re-running
-- a migration must be uneventful.
INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, granted_at)
SELECT u.id, r.role, u.id, '2026-09-06T00:00:00.000Z'
  FROM users u
 CROSS JOIN (SELECT 'admin' AS role UNION ALL SELECT 'staff'
             UNION ALL SELECT 'partner' UNION ALL SELECT 'board') r
 WHERE u.protected = 1;

-- ---------------------------------------------------------------------------
-- 3. And it keeps them.
--
-- Replaces users_protected_keeps_admin, which guarded one role of the four. A
-- trigger naming a specific role has to be edited every time a role is added,
-- and the edit that gets forgotten is the one that leaves the failsafe short.
DROP TRIGGER IF EXISTS users_protected_keeps_admin;

CREATE TRIGGER users_protected_keeps_roles
BEFORE DELETE ON user_roles
FOR EACH ROW WHEN (SELECT protected FROM users WHERE id = OLD.user_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'this account is protected and keeps every role');
END;

-- ---------------------------------------------------------------------------
-- 4. No public profile.
--
-- A staff profile is a page on the public website with a photo, a region and a
-- contact address. A system account has none of those things to tell the
-- truth about, and one had already been created with the slug chase-roush1 —
-- a near-collision with the real person's own page, which is exactly the
-- confusion this migration exists to remove.
--
-- THE TRANSLATIONS GO FIRST, EXPLICITLY. staff_profile_translations declares
-- ON DELETE CASCADE, and a cascade only fires when foreign keys are enforced —
-- which is a per-connection pragma, off by default in SQLite and not something
-- a migration gets to assume about whoever runs it. Tested: deleting the
-- profile alone left two orphaned translation rows behind, which
-- PRAGMA foreign_key_check then reports for the life of the database.
DELETE FROM staff_profile_translations
 WHERE user_id IN (SELECT id FROM users WHERE protected = 1);

DELETE FROM staff_profiles
 WHERE user_id IN (SELECT id FROM users WHERE protected = 1);

CREATE TRIGGER staff_profiles_not_for_system
BEFORE INSERT ON staff_profiles
FOR EACH ROW WHEN (SELECT protected FROM users WHERE id = NEW.user_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'the master account is not a person and has no public profile');
END;
