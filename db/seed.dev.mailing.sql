-- seed.dev.mailing.sql — mailing lists and subscribers, for development
--
-- DEVELOPMENT ONLY. Every address is @example.invalid, which RFC 2606 reserves
-- so that nothing can ever be delivered to it — a seed that used real-looking
-- domains would be one careless send away from mailing strangers.
--
-- The stages are the point. A list is not a list of subscribers; it is a list
-- of people at different stages of having agreed, and the console has to show
-- that honestly:
--
--   pending       asked, has not confirmed. MUST NEVER BE MAILED.
--   subscribed    confirmed. The only ones a send may reach.
--   unsubscribed  asked to stop. Kept, because the record that they once
--                 asked to hear from you is what makes the next signup honest.
--   bounced       the address stopped working. Not a decision they made.
--
-- Two lists on one partner, deliberately: it is the case Chase named — one
-- partner wanting prayer AND newsletter while another wants only a newsletter.

INSERT OR IGNORE INTO mailing_lists
  (id, partner_id, slug, name, description, from_name, from_email, reply_to,
   is_open, created_at, updated_at)
VALUES
  ('ml_cr_news', 'p_chase', 'newsletter', 'Newsletter',
   'Monthly-ish. Where the work is and what it needs.',
   'Chase Roush', 'connect@thauma.one', NULL, 1,
   '2026-03-01T09:00:00Z', '2026-08-20T09:00:00Z'),

  ('ml_cr_pray', 'p_chase', 'prayer', 'Prayer Partners',
   'Shorter and more often. What to pray for this week.',
   'Chase Roush', 'prayer@thauma.one', NULL, 1,
   '2026-04-12T09:00:00Z', '2026-08-20T09:00:00Z'),

  -- Mira runs only a newsletter. Her list exists so that "can Chase see it"
  -- is a question somebody can actually check on this machine.
  ('ml_mira_news', 'p_mira', 'newsletter', 'Bilten',
   'Mesečno. Gde je rad i šta mu treba.',
   'Mira Petrović', 'mira@thauma.one', NULL, 1,
   '2026-05-02T09:00:00Z', '2026-08-20T09:00:00Z');


INSERT OR IGNORE INTO mailing_tags (id, partner_id, name, sort_order, created_at) VALUES
  ('tag_home',   'p_chase', 'Home church',   0, '2026-03-01T09:00:00Z'),
  ('tag_monthly','p_chase', 'Monthly giver', 1, '2026-03-01T09:00:00Z'),
  ('tag_met',    'p_chase', 'Met in person', 2, '2026-06-01T09:00:00Z');


-- ---------- the newsletter, at every stage ----------------------------------
INSERT OR IGNORE INTO subscribers
  (id, list_id, partner_id, email, name, status, confirm_token, source,
   subscribed_at, confirmed_at, unsubscribed_at, updated_at)
VALUES
  ('sub_n1','ml_cr_news','p_chase','alex.doe@example.invalid','Alex Doe',
   'subscribed', NULL, 'website form',
   '2026-03-04T18:22:00Z','2026-03-04T18:31:00Z',NULL,'2026-03-04T18:31:00Z'),

  ('sub_n2','ml_cr_news','p_chase','sam.roe@example.invalid','Sam Roe',
   'subscribed', NULL, 'website form',
   '2026-03-09T12:04:00Z','2026-03-09T12:09:00Z',NULL,'2026-03-09T12:09:00Z'),

  ('sub_n3','ml_cr_news','p_chase','jordan.poe@example.invalid','Jordan Poe',
   'subscribed', NULL, 'added by hand',
   '2026-04-02T09:00:00Z','2026-04-02T09:00:00Z',NULL,'2026-04-02T09:00:00Z'),

  -- Asked yesterday, has not clicked the link. Nothing may be sent here.
  ('sub_n4','ml_cr_news','p_chase','riley.moe@example.invalid','Riley Moe',
   'pending', 'tok_riley_not_confirmed_yet', 'website form',
   '2026-08-19T20:15:00Z',NULL,NULL,'2026-08-19T20:15:00Z'),

  -- Asked a month ago and never confirmed. Worth being visibly different from
  -- somebody who signed up an hour ago.
  ('sub_n5','ml_cr_news','p_chase','casey.loe@example.invalid',NULL,
   'pending', 'tok_casey_never_clicked', 'website form',
   '2026-07-14T08:41:00Z',NULL,NULL,'2026-07-14T08:41:00Z'),

  ('sub_n6','ml_cr_news','p_chase','morgan.noe@example.invalid','Morgan Noe',
   'unsubscribed', NULL, 'website form',
   '2026-03-20T11:00:00Z','2026-03-20T11:06:00Z','2026-06-30T07:12:00Z','2026-06-30T07:12:00Z'),

  -- The address stopped working. Not a decision they made, which is why it is
  -- its own status rather than being folded into unsubscribed.
  ('sub_n7','ml_cr_news','p_chase','taylor.zoe@example.invalid','Taylor Zoe',
   'bounced', NULL, 'imported',
   '2026-03-01T09:00:00Z','2026-03-01T09:05:00Z',NULL,'2026-07-02T03:11:00Z');


-- ---------- prayer, a smaller and newer list --------------------------------
INSERT OR IGNORE INTO subscribers
  (id, list_id, partner_id, email, name, status, confirm_token, source,
   subscribed_at, confirmed_at, unsubscribed_at, updated_at)
VALUES
  -- THE SAME PERSON AS sub_n1, on a second list. One address, two rows, two
  -- consents — which is the shape that lets somebody leave the newsletter and
  -- stay on prayer.
  ('sub_p1','ml_cr_pray','p_chase','alex.doe@example.invalid','Alex Doe',
   'subscribed', NULL, 'website form',
   '2026-04-14T19:00:00Z','2026-04-14T19:02:00Z',NULL,'2026-04-14T19:02:00Z'),

  ('sub_p2','ml_cr_pray','p_chase','dana.fox@example.invalid','Dana Fox',
   'subscribed', NULL, 'website form',
   '2026-05-01T07:30:00Z','2026-05-01T07:44:00Z',NULL,'2026-05-01T07:44:00Z'),

  ('sub_p3','ml_cr_pray','p_chase','kit.vale@example.invalid','Kit Vale',
   'pending', 'tok_kit_pending', 'website form',
   '2026-08-18T22:05:00Z',NULL,NULL,'2026-08-18T22:05:00Z');


-- ---------- Mira's, which Chase must not be able to see ---------------------
INSERT OR IGNORE INTO subscribers
  (id, list_id, partner_id, email, name, status, confirm_token, source,
   subscribed_at, confirmed_at, unsubscribed_at, updated_at)
VALUES
  ('sub_m1','ml_mira_news','p_mira','nikola.j@example.invalid','Nikola Jovanović',
   'subscribed', NULL, 'website form',
   '2026-05-06T10:00:00Z','2026-05-06T10:12:00Z',NULL,'2026-05-06T10:12:00Z'),

  ('sub_m2','ml_mira_news','p_mira','ana.k@example.invalid','Ana Kovač',
   'subscribed', NULL, 'website form',
   '2026-05-20T16:20:00Z','2026-05-20T16:25:00Z',NULL,'2026-05-20T16:25:00Z'),

  ('sub_m3','ml_mira_news','p_mira','petar.s@example.invalid','Petar Simić',
   'unsubscribed', NULL, 'website form',
   '2026-05-21T09:00:00Z','2026-05-21T09:03:00Z','2026-08-01T12:00:00Z','2026-08-01T12:00:00Z');


INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id) VALUES
  ('sub_n1','tag_home'), ('sub_n1','tag_monthly'),
  ('sub_n2','tag_home'),
  ('sub_n3','tag_met'),
  ('sub_p1','tag_monthly'), ('sub_p2','tag_met');
