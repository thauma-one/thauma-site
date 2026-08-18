-- ============================================================================
-- 0009_audit_actor_is_an_address.sql — the last foreign key on audit_log
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- 0008 SAID THIS WOULD HAPPEN
-- ---------------------------------------------------------------------------
-- Its closing note: "user_id keeps its foreign key. Users are not deleted
-- casually and the reference is useful; if that ever becomes a problem, it
-- wants the same treatment and the same reasoning."
--
-- It became a problem twice on 2026-08-16, and the two symptoms looked
-- unrelated:
--
--   1. REMOVING A PERSON FAILED. `admin_user_delete` runs DELETE FROM users,
--      audit_log.user_id references users(id) with no ON DELETE rule, and
--      there is always at least one audit row for anyone who has done
--      anything. The delete was refused, the endpoint returned 500, and the
--      person stayed. Reported as "I removed one, but it doesn't seem like it
--      actually removed them" — which was exactly right.
--
--   2. EVERY AUDIT WRITE WAS FAILING, SILENTLY. Every handler passes the
--      address Cloudflare Access supplies — `user.email` — as user_id. An
--      email is not a users.id, so each insert violated the same foreign key.
--      audit() catches and logs rather than failing the action it describes,
--      which is right, and meant this only ever appeared in `wrangler tail`.
--
-- So the audit log had been quietly recording nothing at all, while the
-- feature it was meant to make accountable — acting as another person — was
-- being built on top of it.
--
-- THE COLUMN HOLDS AN EMAIL ADDRESS, AND THAT IS THE RIGHT CHOICE
-- ---------------------------------------------------------------------------
-- Not a concession to what the code happened to pass. A historical record has
-- to stay meaningful after the thing it names is gone, and `u_a7f31c` means
-- nothing once that row is deleted — which is the exact case that produced
-- this migration. `chase@thauma.one` still says who it was.
--
-- It is also the only identifier the identity provider ever supplies. Access
-- hands over an address; internal ids are ours, and a record of who did
-- something should be written in the terms the authentication actually used.
--
-- Same reasoning as partner_id in 0008, one column along: a foreign key
-- enforces that a reference points at something CURRENT, which is the opposite
-- of what a historical record needs.
--
-- WHAT THIS DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not rewrite the existing rows. Two seed entries hold `u_admin` and
-- `u_chase`, and the readers COALESCE, so they still resolve to a name. Old
-- rows saying an id and new rows saying an address is the honest history of a
-- system that changed its mind; rewriting them would be inventing a past in
-- which it always agreed.
--
-- The queries that join `users` are updated to join on EMAIL instead, and to
-- fall back to the stored value when no user row matches — which is precisely
-- the case where somebody has been deleted and their name is gone.
-- ============================================================================

CREATE TABLE audit_log_new (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,

  -- WHO DID IT, as an email address. DELIBERATELY NOT A FOREIGN KEY, and no
  -- longer an internal id: this has to go on naming somebody after their
  -- account is deleted, which is the single most important thing an audit log
  -- does. See the note above.
  user_id     TEXT,

  -- Already free of its foreign key, in 0008, for the same reason.
  partner_id  TEXT,

  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  detail      TEXT,
  ip          TEXT
);

INSERT INTO audit_log_new (id, at, user_id, partner_id, action, entity, entity_id, detail, ip)
SELECT id, at, user_id, partner_id, action, entity, entity_id, detail, ip FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX idx_audit_partner ON audit_log(partner_id, at);
-- New: "what has this person done" is now a question worth asking quickly,
-- because acting-as makes the answer matter.
CREATE INDEX idx_audit_actor ON audit_log(user_id, at);

-- Append-only, in fact rather than by convention. Dropping the table dropped
-- these; an append-only table that quietly stopped being append-only would be
-- worse than the bug this migration fixes.
CREATE TRIGGER trg_audit_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER trg_audit_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
