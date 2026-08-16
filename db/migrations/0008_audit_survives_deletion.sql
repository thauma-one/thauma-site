-- ============================================================================
-- 0008_audit_survives_deletion.sql — the record outlives the thing
-- ============================================================================
-- Forward-only. Never edit once applied.
--
-- THE BUG
-- ---------------------------------------------------------------------------
-- Deleting a partner would have failed outright. Every table hanging off
-- `partners` cascades except `audit_log`, whose partner_id had no ON DELETE
-- rule at all — so the foreign key simply refused the delete. And there is
-- always at least one audit row: creating a partner writes one.
--
-- Found by a test asserting that everything referencing partners cascades,
-- written while building the delete button. It failed on the first run.
--
-- WHY audit_log IS RIGHT NOT TO CASCADE
-- ---------------------------------------------------------------------------
-- An audit log that disappears with the thing it describes is not an audit
-- log. Deleting a partner destroys their supporters and history; the record
-- that somebody did that is the one thing that must survive it. Cascading
-- would have made the deletion erase its own evidence.
--
-- FIRST ATTEMPT: ON DELETE SET NULL. It failed immediately, and the failure
-- was instructive — SET NULL performs an UPDATE, and the trigger that makes
-- this table append-only refused it. Correctly.
--
-- WHAT IT ACTUALLY WANTS IS NO FOREIGN KEY AT ALL.
--
-- Nulling the link would have lost information: an entry that says "somebody
-- deleted partner p_chase" should go on saying p_chase after p_chase is gone.
-- That is the entire job. A foreign key enforces that a reference points at
-- something that currently exists — which is the opposite of what a historical
-- record needs, because the thing it describes is often gone by definition.
--
-- So partner_id stays as a plain value. Deleting a partner now touches this
-- table not at all: no cascade, no update, nothing for the trigger to refuse,
-- and the entry keeps naming what was destroyed. admin.js also writes the
-- display name and the row counts into `detail` before the delete, since the
-- rows will not be there to count afterwards.
--
-- THE REBUILD IS SAFE HERE
-- ---------------------------------------------------------------------------
-- Nothing references audit_log, so the swap D1 refused on `users` in 0006 is
-- fine — the same reason it was fine for user_roles in 0007.
--
-- The triggers make audit_log append-only, and a rebuild is INSERT ... SELECT
-- followed by DROP, never an UPDATE, so they do not stand in the way. They are
-- recreated below: dropping the table drops them, and an append-only table
-- that quietly stopped being append-only would be worse than the bug.
--
-- user_id keeps its foreign key. Users are not deleted casually and the
-- reference is useful; if that ever becomes a problem, it wants the same
-- treatment and the same reasoning.
-- ============================================================================

CREATE TABLE audit_log_new (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id),
  -- DELIBERATELY NOT A FOREIGN KEY. See the note above: a historical record
  -- must be able to name something that no longer exists.
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

-- Append-only, in fact rather than by convention.
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
