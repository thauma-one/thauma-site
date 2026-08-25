-- 0020_attachments.sql — files that travel WITH a mailing
--
-- NOT THE SAME THING AS AN INLINE PICTURE, and conflating the two is the
-- usual mistake. A picture in the body is fetched by the reader's mail client
-- from a URL: it costs the message nothing but that URL, and it lives in R2
-- under newsletter/<partner>/. An attachment travels inside every copy sent,
-- never appears in the HTML at all, and is handed to the mail provider as a
-- separate parameter.
--
-- WHICH IS WHY THE SIZE RULES DIFFER. A 2MB photo linked in the body is 60
-- characters of HTML. The same photo attached is 2MB multiplied by however
-- many people are on the list, every one of it counted against Gmail's
-- clipping limit and the provider's own ceiling. The Worker enforces a much
-- smaller cap on attachments for that reason.
--
-- The bytes live in R2 and only the pointer lives here. A blob column would
-- put megabytes into every row read — including the list of drafts, which
-- reads them for nothing but a filename.

CREATE TABLE mailing_attachments (
  id          TEXT PRIMARY KEY,
  mailing_id  TEXT NOT NULL REFERENCES mailings(id) ON DELETE CASCADE,

  -- The name the recipient sees, not the key it is stored under.
  filename    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes       INTEGER NOT NULL,

  -- Where it lives in R2. Content-addressed, so the same file attached twice
  -- is one object and a half-failed upload leaves nothing to clean up.
  object_key  TEXT NOT NULL,

  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_mailing_attachments ON mailing_attachments (mailing_id, sort_order);
