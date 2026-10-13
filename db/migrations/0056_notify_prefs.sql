-- 0056_notify_prefs.sql — which notices a person wants by email
--
-- Chase, 2026-10-12: "Can we add email notifications for some things and the
-- ability to toggle certain ones on and off? I'm mainly thinking for admins
-- and getting email notifications when someone accepts an invitation."
--
-- The notices themselves are a list in code (workers/src/lib/notify.js), each
-- with who may receive it and whether it starts on. A row here is a person's
-- own choice; no row means that notice's starting value. Set on Settings ›
-- Account › "Email me when".
--
-- Additive: the code reads it in a statement that tolerates its absence, so a
-- deploy ahead of this migration simply uses every notice's starting value.

CREATE TABLE IF NOT EXISTS notify_prefs (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- a notice in lib/notify.js, e.g. 'invite_accepted'
  is_on       INTEGER NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);
