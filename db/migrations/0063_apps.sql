-- 0063_apps.sql — the apps: phones that asked to be told, and "I prayed"
--
-- docs/APP-PLAN.md, and Chase's decisions at its foot (2026-10-13): the
-- console and every ministry with a site can be installed as an app, both
-- built together; "I prayed" is a count only.
--
-- PUSH_SUBSCRIPTIONS. One row per phone or browser that turned notifications
-- on (lib/webpush.js). Who it belongs to depends on the app:
--   staff      the console app: a person (user_id); what reaches them is
--              their bell's switches (Settings › Notifications, the App/Web
--              column) — one switch for the bell and this phone.
--   supporter  a ministry's app (partner_id): nobody's account, nobody's
--              name — a phone that asked this ministry for news. topics is
--              what it asked for (prayer, updates, goals).
--   public     thauma.one's own app: Thauma's news.
-- The endpoint is the push service's address for that one phone; the row
-- goes when the service says it is gone (the app removed, permission
-- withdrawn), or after repeated failures.
--
-- PRAYER_PRAYED. One row per phone per request, so a count can be shown
-- ("14 people prayed") and pressing again does nothing. `device` is a hash
-- of a random id the app makes on the phone — not a person, not an address,
-- and nothing that follows anyone anywhere.
--
-- Additive: until it is applied, the apps install and work, notifications
-- cannot be turned on, and "I prayed" says it could not be kept.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            TEXT PRIMARY KEY,                -- hash of the endpoint
  endpoint      TEXT NOT NULL UNIQUE,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  audience      TEXT NOT NULL CHECK (audience IN ('staff', 'supporter', 'public')),
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  partner_id    TEXT REFERENCES partners(id) ON DELETE CASCADE,
  lang          TEXT,
  topics        TEXT NOT NULL DEFAULT '[]',      -- JSON, supporters: prayer, updates, goals
  created_at    TEXT NOT NULL,
  last_sent_at  TEXT,
  fails         INTEGER NOT NULL DEFAULT 0,
  CHECK (audience <> 'staff' OR user_id IS NOT NULL),
  CHECK (audience <> 'supporter' OR partner_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS push_by_user ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS push_by_partner ON push_subscriptions (partner_id, audience);

CREATE TABLE IF NOT EXISTS prayer_prayed (
  prayer_id  TEXT NOT NULL REFERENCES prayer(id) ON DELETE CASCADE,
  device     TEXT NOT NULL,
  at         TEXT NOT NULL,
  PRIMARY KEY (prayer_id, device)
);
