-- 0015_mailing.sql — mailing lists, subscribers, and sends
--
-- THE TWO WORDS THAT DECIDE THIS SCHEMA: customisation and isolation.
--
-- Isolation: a partner must never see another partner's subscribers. That is
-- enforced here, in the shape of the data, rather than by remembering to add a
-- WHERE clause. Every subscriber row carries the partner it belongs to, and a
-- trigger refuses one that disagrees with its list — the same guard
-- prayer_translations already uses, for the same reason.
--
-- Customisation: a partner creates the lists they want. One may run a prayer
-- list and a newsletter; another only a newsletter. So a list is a ROW, not a
-- constant in a source file — which is what chaseroush.com has today, and the
-- reason it can only ever have the two lists somebody typed into subscribe.js.
--
-- WHAT THIS DELIBERATELY DOES NOT COPY FROM CR
-- ============================================================================
-- CR keeps each list as one JSON file in R2: read the whole file, modify it,
-- write the whole file. Two people subscribing in the same second both read the
-- old list and one of them is silently discarded. That is a correctness bug at
-- any size rather than a scaling one, and every partner running a sign-up form
-- makes it likelier. Rows and a unique index make it impossible instead.
--
-- PII LIVES HERE, AND IT IS THE MOST OF IT ANYWHERE IN THIS SCHEMA.
-- Everything else is aggregates or the ministry's own words. These are real
-- people's addresses, given on the understanding they would be written to.
-- db/refresh_dev.py MUST scrub `subscribers` and `mailing_recipients` before
-- copying production down to dev — see the note added there in this change.


-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------
CREATE TABLE mailing_lists (
  id           TEXT PRIMARY KEY,

  -- NULL MEANS THE ORGANISATION. Thauma's own newsletter belongs to nobody's
  -- partner account, and only admin or communications may send to it. Modelling
  -- it as a partner row would make Thauma a partner, which it is not.
  partner_id   TEXT REFERENCES partners(id) ON DELETE CASCADE,

  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,

  -- SENDER IDENTITY PER LIST, not per account. One Resend account serves
  -- everyone, so "who is this from" is a property of the list: CR already
  -- sends its newsletter from connect@ and its prayer list from prayer@, and
  -- that instinct is right — it just needs to be data.
  from_name    TEXT NOT NULL,
  from_email   TEXT NOT NULL,
  reply_to     TEXT,

  -- Whether a public sign-up form may add to it. Off by default: a list nobody
  -- chose to expose should not be reachable from the open internet.
  is_open      INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),

  -- Soft delete. A list with history is not a row to throw away — the sends
  -- reference it, and "who did we mail in March" must stay answerable.
  archived_at  TEXT,

  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- COALESCE, because SQLite treats NULLs as distinct in a UNIQUE constraint —
-- without it, two organisation lists could both be called `newsletter`.
CREATE UNIQUE INDEX idx_mailing_lists_slug
  ON mailing_lists (COALESCE(partner_id, '~organisation'), slug);
CREATE INDEX idx_mailing_lists_partner ON mailing_lists (partner_id, archived_at);


-- ---------------------------------------------------------------------------
-- Subscribers
-- ---------------------------------------------------------------------------
CREATE TABLE subscribers (
  id            TEXT PRIMARY KEY,
  list_id       TEXT NOT NULL REFERENCES mailing_lists(id) ON DELETE CASCADE,

  -- Denormalised from the list so that isolation is one indexed column rather
  -- than a join every partner-scoped query must remember. Kept honest by the
  -- triggers below; it is not free to have two sources of truth, so they pay
  -- for it.
  partner_id    TEXT REFERENCES partners(id) ON DELETE CASCADE,

  email         TEXT NOT NULL,
  name          TEXT,

  -- DOUBLE OPT-IN, which CR gets right and this copies. `pending` until the
  -- address proves it wants this. Nothing is ever sent to `pending`.
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'subscribed', 'unsubscribed', 'bounced')),

  -- The confirmation token, stored because it must be checked against a link
  -- somebody clicks days later. Cleared once used, so a stale link stops
  -- working rather than confirming a second time.
  confirm_token TEXT,

  source        TEXT,          -- which form or import this came from
  subscribed_at TEXT NOT NULL,
  confirmed_at  TEXT,
  unsubscribed_at TEXT,
  updated_at    TEXT NOT NULL
);

-- One address once per list. This is the constraint CR's JSON file cannot have,
-- and the whole reason a simultaneous signup cannot be lost here.
CREATE UNIQUE INDEX idx_subscribers_unique ON subscribers (list_id, email);
CREATE INDEX idx_subscribers_partner ON subscribers (partner_id, status);
CREATE INDEX idx_subscribers_email ON subscribers (email);

-- A subscriber's partner must be the partner that owns the list. IS NOT
-- DISTINCT FROM rather than =, so an organisation list (partner_id NULL) and
-- its subscribers match rather than failing the comparison.
CREATE TRIGGER subscriber_same_partner
BEFORE INSERT ON subscribers
FOR EACH ROW
WHEN NEW.partner_id IS NOT (SELECT partner_id FROM mailing_lists WHERE id = NEW.list_id)
BEGIN
  SELECT RAISE(ABORT, 'subscriber partner_id does not match its list');
END;

CREATE TRIGGER subscriber_same_partner_update
BEFORE UPDATE OF partner_id, list_id ON subscribers
FOR EACH ROW
WHEN NEW.partner_id IS NOT (SELECT partner_id FROM mailing_lists WHERE id = NEW.list_id)
BEGIN
  SELECT RAISE(ABORT, 'subscriber partner_id does not match its list');
END;


-- ---------------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------------
-- CR keeps tags as an array on each subscriber and renames by rewriting every
-- file. A join table makes a rename one UPDATE and makes "everyone tagged X" a
-- query rather than a scan.
CREATE TABLE mailing_tags (
  id          TEXT PRIMARY KEY,
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_mailing_tags_name
  ON mailing_tags (COALESCE(partner_id, '~organisation'), name);

CREATE TABLE subscriber_tags (
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,
  tag_id        TEXT NOT NULL REFERENCES mailing_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (subscriber_id, tag_id)
);

CREATE INDEX idx_subscriber_tags_tag ON subscriber_tags (tag_id);


-- ---------------------------------------------------------------------------
-- Sends
-- ---------------------------------------------------------------------------
CREATE TABLE mailings (
  id           TEXT PRIMARY KEY,
  list_id      TEXT NOT NULL REFERENCES mailing_lists(id),
  partner_id   TEXT REFERENCES partners(id) ON DELETE CASCADE,

  subject      TEXT NOT NULL,
  body_html    TEXT,
  body_text    TEXT,

  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'sending', 'sent', 'failed', 'cancelled')),

  -- ATTRIBUTION, so SET NULL rather than the default refusal. Who sent a
  -- mailing is worth recording, and it must not become a reason somebody
  -- cannot be removed from the system later. The mailing outlives them; the
  -- link to them does not have to.
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  started_at   TEXT,
  finished_at  TEXT
);

CREATE INDEX idx_mailings_partner ON mailings (partner_id, created_at);
CREATE INDEX idx_mailings_list ON mailings (list_id, created_at);


-- PER-RECIPIENT STATE, which is the thing CR has no way to answer.
-- CR sends with Promise.allSettled over every recipient at once and records
-- only a total. So "did this person receive it" has no answer, and a run that
-- dies halfway cannot be resumed without mailing somebody twice. A row per
-- recipient makes both ordinary.
CREATE TABLE mailing_recipients (
  mailing_id    TEXT NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,

  -- The address as it was AT SEND TIME. A subscriber may change theirs, and
  -- the record of where a message actually went must not change with them.
  email         TEXT NOT NULL,

  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'sent', 'failed', 'bounced', 'skipped')),
  provider_id   TEXT,          -- Resend's id, for tracing a complaint back
  error         TEXT,
  updated_at    TEXT NOT NULL,

  PRIMARY KEY (mailing_id, subscriber_id)
);

CREATE INDEX idx_mailing_recipients_status ON mailing_recipients (mailing_id, status);


-- ---------------------------------------------------------------------------
-- The communications role
-- ---------------------------------------------------------------------------
-- SQLite cannot alter a CHECK constraint, so the table is rebuilt — the same
-- dance 0007 did when `partner` was added, and for the same reason.
--
-- WHAT IT MEANS: may send as the ORGANISATION, to organisation lists. It is
-- deliberately separate from `admin`: sending to everyone Thauma has ever
-- collected is a different act from managing accounts, and one person may
-- reasonably have either without the other.
CREATE TABLE user_roles_new (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('admin','partner','staff','board','communications')),
  -- ON DELETE SET NULL, CARRIED FORWARD FROM 0010. A rebuild silently reverts
  -- whatever the previous definition fixed, and this one was fixed on purpose:
  -- without it, deleting somebody who had ever granted a role was refused, so
  -- a person could not leave. db/test_schema.py caught this exact regression
  -- when the table was rebuilt here.
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, role)
);

INSERT INTO user_roles_new (user_id, role, granted_by, granted_at)
  SELECT user_id, role, granted_by, granted_at FROM user_roles;

DROP TABLE user_roles;
ALTER TABLE user_roles_new RENAME TO user_roles;

CREATE INDEX idx_user_roles_role ON user_roles(role);
