-- 0060_notices.sql — the bell: notices kept in the console, unread until seen
--
-- Chase, 2026-10-13: "Add the in app notifications bell." Same day, on
-- people's own bios: "notify the changes back to the staff member. Even a
-- notification if it was approved or declined is good."
--
-- One row per notice per person who receives it. The notices themselves are
-- the list in workers/src/lib/notify.js — the same list email uses — and the
-- words are rendered when the bell is opened, in the reader's language at
-- that moment, from `kind` and `vars` (the notice's {placeholders}). A person
-- switches the bell on or off per notice on Settings › Notifications; that
-- choice is a notify_prefs row whose kind is 'bell:<kind>' (0056), so no
-- second table of switches.
--
-- A notice older than a year is deleted by the daily job; until then a
-- cleared or long-read one is under "Past notifications" (0061).
--
-- Additive: the code reads it in statements that tolerate its absence, so a
-- deploy ahead of this migration simply has an empty bell.

CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,              -- a notice in lib/notify.js
  vars        TEXT NOT NULL DEFAULT '{}', -- JSON: the words' {placeholders}
  link        TEXT,                       -- where it opens, a path on the console
  created_at  TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notices_by_user ON notices (user_id, created_at);
