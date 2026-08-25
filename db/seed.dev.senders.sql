-- seed.dev.senders.sql — sending domains and addresses for the dev partners
--
-- ONE DOMAIN PER PARTNER, which is the whole point: sending reputation is
-- tracked per domain, so one ministry's junk reports stay with that ministry
-- instead of degrading everybody's mail. The organisation's own domain is kept
-- out of bulk entirely — an account invite must never be delayed because
-- somebody else's newsletter was reported.
--
-- The local parts are generic and the DOMAIN carries the identity. That is
-- deliberate: `news@` reads the same for everybody, and nobody has to invent a
-- scheme per ministry.
--
-- can_receive marks the ones that need a real mailbox. Sending needs none;
-- RECEIVING does, and a list pointing its replies at an address with no
-- mailbox loses them in silence.

-- Derived from the display name, NOT the slug. The slug is `chase-roush`
-- because it lands in URLs where a hyphen reads well; a sending domain is read
-- aloud, typed into DNS, and verified by hand, and the hyphen is one more
-- character to get wrong in three places. They are allowed to differ.
UPDATE partners SET sending_domain = 'chaseroush.thauma.one' WHERE id = 'p_chase';
UPDATE partners SET sending_domain = 'mira.thauma.one'        WHERE id = 'p_mira';

DELETE FROM sender_addresses;

INSERT INTO sender_addresses (id, partner_id, address, label, can_receive, created_at) VALUES
  ('sa_cr_news',    'p_chase', 'news@chaseroush.thauma.one',    'Newsletter',     0, datetime('now')),
  ('sa_cr_prayer',  'p_chase', 'prayer@chaseroush.thauma.one',  'Prayer updates', 0, datetime('now')),
  ('sa_cr_contact', 'p_chase', 'contact@chaseroush.thauma.one', 'Contact form',   1, datetime('now')),
  ('sa_cr_connect', 'p_chase', 'connect@chaseroush.thauma.one', 'Connect',        1, datetime('now')),

  ('sa_mi_news',    'p_mira',  'news@mira.thauma.one',           'Newsletter',     0, datetime('now')),
  ('sa_mi_prayer',  'p_mira',  'prayer@mira.thauma.one',         'Prayer updates', 0, datetime('now')),
  ('sa_mi_contact', 'p_mira',  'contact@mira.thauma.one',        'Contact form',   1, datetime('now')),
  ('sa_mi_connect', 'p_mira',  'connect@mira.thauma.one',        'Connect',        1, datetime('now')),

  -- The organisation, partner_id NULL. Low volume and never complained about,
  -- which is exactly what keeps thauma.one clean enough to also carry the
  -- transactional mail everybody depends on to sign in.
  ('sa_org_news',    NULL, 'news@thauma.one',    'Newsletter',   0, datetime('now')),
  ('sa_org_contact', NULL, 'contact@thauma.one', 'Contact form', 1, datetime('now')),
  ('sa_org_hello',   NULL, 'hello@thauma.one',   'General',      1, datetime('now'));

-- The existing dev lists were seeded with addresses at the old shared domain.
-- Left alone they would be unsaveable — the sender is now a picker, and their
-- address is not on it. Moved rather than blanked, so the lists keep working.
UPDATE mailing_lists SET from_email = 'news@chaseroush.thauma.one'   WHERE id = 'ml_cr_news';
UPDATE mailing_lists SET from_email = 'prayer@chaseroush.thauma.one' WHERE id = 'ml_cr_pray';
UPDATE mailing_lists SET from_email = 'news@mira.thauma.one'          WHERE id = 'ml_mira_news';

-- A reply-to somebody actually reads, on the list where replies are the point.
UPDATE mailing_lists SET reply_to = 'connect@chaseroush.thauma.one' WHERE id = 'ml_cr_news';
