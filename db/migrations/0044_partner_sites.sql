-- 0044_partner_sites.sql — a partner's own website, at <name>.thauma.one
--
-- Chase, 2026-09-28/29: a ministry that does not want to build a website can
-- switch one on — a templated Thauma site that reads its own timeline, goals,
-- prayer, videos and forms, at an address made from the owner's first and
-- last name. The owner arranges it (pages, sections, look, motion, links);
-- the rest of the team may look and ask to edit.
--
-- partner_sites   one row per partner that has ever opened its Website tab.
--   subdomain     the <name> in <name>.thauma.one. Made from the ministry's
--                 name when the row is created; ONLY an administrator changes
--                 it (two people with one name). Lower-case letters and
--                 digits, 2–40.
--   enabled       1 = visitors can open it. Off keeps everything.
--   draft         the whole site as JSON — languages, look, motion, links,
--                 pages and their sections — as the owner is editing it.
--   published     the same, as visitors see it. NULL until the first Publish.
--   dns_state     'ready', 'pending', or what went wrong making the address.
--
-- partner_site_editors   people the owner has let edit, besides the owner.
-- partner_site_requests  people on the team who asked to; one open request
--                        each, with an optional note.
--
-- Additive: new tables only. Reverting the code leaves them unread.

CREATE TABLE partner_sites (
  partner_id   TEXT PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,
  subdomain    TEXT NOT NULL UNIQUE
               CHECK (length(subdomain) BETWEEN 2 AND 40
                      AND subdomain NOT GLOB '*[^a-z0-9]*'),
  enabled      INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  draft        TEXT NOT NULL,
  published    TEXT,
  published_at TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  dns_state    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE partner_site_editors (
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (partner_id, user_id)
);

CREATE TABLE partner_site_requests (
  partner_id   TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note         TEXT,
  requested_at TEXT NOT NULL,
  PRIMARY KEY (partner_id, user_id)
);
