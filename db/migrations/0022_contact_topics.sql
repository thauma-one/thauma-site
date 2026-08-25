-- 0022_contact_topics.sql — "what is this about?"
--
-- chaseroush.com's contact form asks for a reason before the message: General,
-- Prayer Request, Partnership / Support, Church Inquiry, Other. It is a small
-- field that does a lot of work — somebody deciding whether to write at all is
-- helped by seeing that their kind of message is expected, and the person
-- reading knows what they are opening before they open it.
--
-- CONFIGURABLE, NOT FIXED. A church planter and a project office field
-- completely different things, and hard-coding CR's five would make every
-- other ministry's form slightly wrong. Same reasoning as the sign-up form's
-- checkboxes, which are the partner's own lists rather than a fixed set.
--
-- THE OPTIONAL DELIVERY ADDRESS IS THE POINT OF A TABLE.
-- A JSON column would have held labels perfectly well. What it could not hold
-- is this: a prayer request going to prayer@, a partnership enquiry going to
-- somebody who handles support, and everything else going to the form's own
-- address. That is the difference between a form that sorts itself and an
-- inbox somebody has to sort by hand every morning.

CREATE TABLE contact_topics (
  id          TEXT PRIMARY KEY,

  -- NULL is the ORGANISATION, matching contact_forms and everything else here.
  partner_id  TEXT REFERENCES partners(id) ON DELETE CASCADE,

  -- What the visitor picks. Their words, in their language.
  label       TEXT NOT NULL,

  -- Where messages with this reason go. NULL means the form's own address,
  -- which is what most topics should be — an override is for the one or two
  -- that genuinely belong to somebody else.
  deliver_to  TEXT,

  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_contact_topics ON contact_topics (partner_id, sort_order);

-- One label once per owner. Two "Prayer" options in a dropdown is a form that
-- looks broken, and COALESCE is needed because SQLite treats NULLs as distinct
-- in a UNIQUE constraint — without it the organisation could have both.
CREATE UNIQUE INDEX idx_contact_topics_unique
  ON contact_topics (COALESCE(partner_id, '~organisation'), label);
