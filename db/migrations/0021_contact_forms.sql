-- 0021_contact_forms.sql — a contact form per partner, and one for Thauma
--
-- WHAT THIS REPLACES. The contact form was configured by deploy variables:
-- CONTACT_TO and CONTACT_FROM in wrangler.toml. That works for exactly one
-- form. It cannot answer "where should Mira's messages go", it cannot be
-- changed without a deploy, and it means a partner's contact form would send
-- from Thauma's address to Thauma's inbox — which is the wrong ministry
-- receiving somebody's private message.
--
-- ONE FORM PER PARTNER, the same shape as the sign-up form. Not several: a
-- partner has one place people write to them, and the alternative is a screen
-- for managing forms nobody has more than one of.
--
-- partner_id NULL is the ORGANISATION, the convention used throughout this
-- schema — so thauma.one's own contact page is a row here rather than a
-- special case in code.
--
-- STILL STORES NOTHING. The messages themselves are emailed and kept nowhere,
-- which was the original decision and is the right one: a contact form is the
-- easiest way to accumulate personal data nobody remembers holding, and under
-- GDPR that is a record somebody is responsible for. The mailbox is the system
-- of record. This table holds CONFIGURATION, not correspondence.

CREATE TABLE contact_forms (
  partner_id   TEXT PRIMARY KEY REFERENCES partners(id) ON DELETE CASCADE,

  -- Where messages are delivered. A real mailbox somebody reads, which is why
  -- it is typed rather than chosen: it is usually a personal or shared inbox,
  -- not one of the sending addresses.
  deliver_to   TEXT NOT NULL,

  -- Who it appears to come from. MUST be one of that partner's verified
  -- sender addresses — the visitor's own address goes in Reply-To instead,
  -- because sending as them would fail SPF and land the message in junk.
  from_address TEXT,

  -- What the form says. Empty means the widget's own wording.
  heading      TEXT,
  blurb        TEXT,
  button       TEXT,
  thanks       TEXT,

  -- Off by default. A form that emails an address nobody has confirmed is a
  -- form that loses messages silently.
  is_open      INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),

  updated_at   TEXT NOT NULL
);

-- SQLite makes a NULL primary key possible, which is what lets the
-- organisation have a row here at all. The index keeps that single row unique;
-- without it two "no partner" rows could exist and the endpoint would pick one
-- at random.
CREATE UNIQUE INDEX idx_contact_forms_org
  ON contact_forms ((partner_id IS NULL)) WHERE partner_id IS NULL;
