-- 0026_protected_account.sql — one account that cannot be removed
--
-- WHAT THIS IS NOT. wouldStrandOrg() in workers/src/admin.js already refuses
-- to remove the LAST active administrator. That is a dynamic rule about the
-- organisation as a whole, and with two administrators either of them may
-- still be deleted. This is a different guarantee: a NAMED account that
-- survives regardless of how many others exist.
--
-- WHY IT LIVES IN THE DATABASE. The existing rule is enforced in one endpoint,
-- which protects the console and nothing else. A migration applied by hand, a
-- future endpoint, a bulk action written in a hurry — none of them consult it.
-- A trigger is consulted by all of them, because it is the last thing between
-- an intention and the disk.
--
-- WHY admin@thauma.one. It is the organisation's address rather than a
-- person's, so the account that can always get in does not depend on any
-- individual still being here — the same reasoning db/seed.production-first-
-- admin.sql already gives for creating it.
--
-- THE ESCAPE HATCH IS A MIGRATION. The flag cannot be cleared by an UPDATE,
-- so undoing this means writing SQL, committing it, and having it reviewed —
-- which is the correct amount of friction for "remove the account that can
-- always get back in". Deliberately not a switch in the console.
--
-- IT IS ONLY HALF THE GUARANTEE. Cloudflare Access is the front door, and an
-- account protected here but deleted there is locked out with a perfectly good
-- database row. Whatever syncs accounts into an Access group must leave this
-- one alone; that is enforced in the code that does the syncing, because this
-- database cannot see Cloudflare.

ALTER TABLE users ADD COLUMN protected INTEGER NOT NULL DEFAULT 0
  CHECK (protected IN (0, 1));

-- Marked by ADDRESS, not by id: a database seeded before this migration has
-- the account under whatever id its seed chose.
UPDATE users SET protected = 1 WHERE email = 'admin@thauma.one';

-- ---------------------------------------------------------------------------
-- The three ways an account can stop working, refused for this one.
-- ---------------------------------------------------------------------------

CREATE TRIGGER users_protected_no_delete
BEFORE DELETE ON users
FOR EACH ROW WHEN OLD.protected = 1
BEGIN
  SELECT RAISE(ABORT, 'this account is protected and cannot be deleted');
END;

-- Suspending or un-inviting it is deletion by another name, and clearing the
-- flag is deletion in two steps. The address may still be changed: it is the
-- one field somebody may genuinely need to correct, and the flow that changes
-- it confirms the new address before it takes effect.
CREATE TRIGGER users_protected_no_disable
BEFORE UPDATE ON users
FOR EACH ROW WHEN OLD.protected = 1
  AND (NEW.protected = 0 OR NEW.status <> 'active')
BEGIN
  SELECT RAISE(ABORT, 'this account is protected: it cannot be suspended, and its protection cannot be removed');
END;

-- An administrator with no admin role is locked out of administration, which
-- is the thing this account exists to guarantee.
CREATE TRIGGER users_protected_keeps_admin
BEFORE DELETE ON user_roles
FOR EACH ROW WHEN OLD.role = 'admin'
  AND (SELECT protected FROM users WHERE id = OLD.user_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'this account is protected and must keep the administrator role');
END;
