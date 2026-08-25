-- seed.dev.contact.sql — contact forms for the dev partners
--
-- ⚠ EVERY ADDRESS HERE IS `.invalid`, ON PURPOSE.
--
-- .invalid is reserved by RFC 2606 and can never be registered, so nothing
-- sent to one of these can reach a person. That is not caution for its own
-- sake: this seed was first written with `admin@thauma.one` as the
-- organisation's delivery address, and a routine `curl` against the local
-- endpoint on 2026-08-22 put a test message from "Ann" into a real inbox.
--
-- The endpoint being exercised locally still calls Resend for real. Local
-- means the Worker runs here, not that the outside world stops existing — so
-- the only reliable guard is that the DESTINATION cannot receive.

DELETE FROM contact_topics;
DELETE FROM contact_forms;

INSERT INTO contact_forms
  (partner_id, deliver_to, from_address, heading, blurb, button, thanks, is_open, updated_at)
VALUES
  ('p_chase', 'chase-dev@example.invalid', 'contact@chaseroush.thauma.one',
   'Get in touch', 'Questions, prayer requests, or just to say hello.',
   'Send', 'Thank you — your message is on its way.', 1, datetime('now')),

  ('p_mira', 'mira-dev@example.invalid', 'contact@mira.thauma.one',
   NULL, NULL, NULL, NULL, 0, datetime('now')),

  -- The organisation. partner_id NULL, reached at /embed/v1/thauma/contact.js.
  (NULL, 'dev-inbox@example.invalid', 'contact@thauma.one',
   'Contact Thauma', NULL, 'Send', NULL, 1, datetime('now'));

INSERT INTO contact_topics (id, partner_id, label, deliver_to, sort_order, created_at) VALUES
  ('ct_gen',    'p_chase', 'General',               NULL,                          0, datetime('now')),
  -- The one reason with an address of its own, so the routing is exercised.
  ('ct_pray',   'p_chase', 'Prayer request',        'prayer-dev@example.invalid',  1, datetime('now')),
  ('ct_part',   'p_chase', 'Partnership / support', NULL,                          2, datetime('now')),
  ('ct_church', 'p_chase', 'Church enquiry',        NULL,                          3, datetime('now')),
  ('ct_other',  'p_chase', 'Something else',        NULL,                          4, datetime('now')),

  ('ct_org1',   NULL,      'General',               NULL,                          0, datetime('now')),
  ('ct_org2',   NULL,      'Working with Thauma',   NULL,                          1, datetime('now'));
