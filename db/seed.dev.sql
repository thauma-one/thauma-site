-- ============================================================================
-- seed.dev.sql — throwaway data for local development
-- ============================================================================
-- LOCAL ONLY. Never run against a real database: it inserts fixed ids that
-- would collide, and the people in it do not exist.
--
--   wrangler d1 execute thauma-ops --file=db/migrations/0001_init.sql
--   wrangler d1 execute thauma-ops --file=db/seed.dev.sql
--
-- Deliberately includes TWO partners. Most cross-tenant leaks are invisible
-- with a single tenant in the database — if the admin ever shows Mira's row
-- while you are scoped to Chase, something is scoped wrong.
-- ============================================================================

-- ---------- partners --------------------------------------------------------
INSERT INTO partners (id, slug, display_name, status, giving_provider, giving_url, is_public, created_at, updated_at) VALUES
  ('p_chase','chase-roush','Chase Roush','active','donorbox','https://donorbox.org/chase-roush-monthly',1,'2026-01-15T09:00:00Z','2026-08-14T09:00:00Z'),
  ('p_demo','demo-partner','Demo Partner','prospective',NULL,NULL,0,'2026-06-01T09:00:00Z','2026-06-01T09:00:00Z');

-- ---------- users -----------------------------------------------------------
INSERT INTO users (id, email, name, global_role, status, created_at, last_login_at) VALUES
  ('u_admin','admin@thauma.one','Org Admin','admin','active','2026-01-10T09:00:00Z','2026-08-14T08:00:00Z'),
  ('u_chase','chase@thauma.one','Chase Roush','staff','active','2026-01-15T09:00:00Z','2026-08-14T07:30:00Z'),
  ('u_demo','demo@thauma.one','Demo Partner','staff','invited','2026-06-01T09:00:00Z',NULL);

INSERT INTO partner_users (partner_id, user_id, role, granted_by, granted_at) VALUES
  ('p_chase','u_chase','owner','u_admin','2026-01-15T09:05:00Z'),
  ('p_demo','u_demo','owner','u_admin','2026-06-01T09:05:00Z');
-- NOTE: being global_role='admin' grants u_admin NOTHING here. Org authority
-- and partner access are separate — see db/README.md. The row below is an
-- EXPLICIT grant, which is exactly the point: an admin reading a partner's
-- data leaves a record saying somebody granted it.

-- TESTING GRANT — remove when Chase signs in as his own address.
-- admin@thauma.one is the address Cloudflare Access currently authenticates
-- on dev.thauma.one, so without this the console correctly refuses him and
-- there is nothing to look at. 'view' rather than 'owner': read-only is all
-- that is needed to exercise the console, and least privilege costs nothing.
INSERT INTO partner_users (partner_id, user_id, role, granted_by, granted_at) VALUES
  ('p_chase','u_admin','view','u_admin','2026-08-15T00:00:00Z');

-- ---------- contacts --------------------------------------------------------
INSERT INTO contacts (id, partner_id, first_name, last_name, email, phone, city, region, country,
                      newsletter_consent, newsletter_consent_source, newsletter_consent_at,
                      postal_consent, notes, created_at, updated_at) VALUES
  ('c_1','p_chase','Jordan','Reyes','jordan.reyes@example.com','+1-816-555-0142','Kansas City','MO','US',
   1,'web_form','2026-02-03T14:22:00Z',1,'Met at the sending-org banquet. Runs FOH at their church.',
   '2026-02-03T14:22:00Z','2026-08-01T10:00:00Z'),
  ('c_2','p_chase','Priya','Nandakumar','priya.n@example.com','+1-913-555-0188','Overland Park','KS','US',
   1,'web_form','2026-03-11T19:40:00Z',0,'Asked to be told before the departure date is set.',
   '2026-03-11T19:40:00Z','2026-07-20T10:00:00Z'),
  ('c_3','p_chase','Tomislav','Horvat','t.horvat@example.hr',NULL,'Zagreb',NULL,'HR',
   0,NULL,NULL,0,'Contact at the Zagreb church. Croatian — GDPR applies, no marketing without opt-in.',
   '2026-05-02T08:15:00Z','2026-05-02T08:15:00Z'),
  ('c_4','p_chase','Dale','Whitfield',NULL,'+1-660-555-0110','Sedalia','MO','US',
   0,NULL,NULL,1,'Postal only. No email address — sends cheques, prefers a letter.',
   '2026-04-18T11:00:00Z','2026-04-18T11:00:00Z'),
  -- other tenant: must never appear in a Chase-scoped query
  ('c_demo_1','p_demo','Mira','Kovac','mira@example.hr',NULL,'Split',NULL,'HR',
   1,'import','2026-06-02T09:00:00Z',0,'Belongs to the demo partner.',
   '2026-06-02T09:00:00Z','2026-06-02T09:00:00Z');

-- ---------- interactions ----------------------------------------------------
-- Jordan: recently newslettered, but not personally spoken to since March.
-- This is exactly the case a naive "last contacted" column gets wrong.
INSERT INTO interactions (id, contact_id, partner_id, type, is_personal, channel, occurred_on, note, logged_by, source, created_at) VALUES
  ('i_1','c_1','p_chase','call',1,'digital','2026-03-02','Caught up about the trip. Wants to give monthly once dates are firm.','u_chase','manual','2026-03-02T18:00:00Z'),
  ('i_2','c_1','p_chase','newsletter',0,'digital','2026-06-01',NULL,NULL,'newsletter','2026-06-01T12:00:00Z'),
  ('i_3','c_1','p_chase','newsletter',0,'digital','2026-08-01',NULL,NULL,'newsletter','2026-08-01T12:00:00Z'),
  ('i_4','c_2','p_chase','visit',1,'in_person','2026-07-19','Coffee. Asked good hard questions about the two-year term.','u_chase','manual','2026-07-19T20:00:00Z'),
  ('i_5','c_2','p_chase','newsletter',0,'digital','2026-08-01',NULL,NULL,'newsletter','2026-08-01T12:00:00Z'),
  ('i_6','c_3','p_chase','email',1,'digital','2026-05-02','Intro from the sending org. Replied in Croatian.','u_chase','manual','2026-05-02T09:00:00Z'),
  ('i_7','c_4','p_chase','postal_mail',0,'physical','2026-07-05','Summer letter, printed and posted.','u_chase','manual','2026-07-06T09:00:00Z'),
  ('i_8','c_4','p_chase','handwritten',1,'physical','2026-07-28','Thank-you note for the spring gift.','u_chase','manual','2026-07-29T09:00:00Z');

-- ---------- goals and aggregates -------------------------------------------
INSERT INTO goals (id, partner_id, label, kind, target_cents, currency, external_ref, starts_on, is_public, created_at, updated_at) VALUES
  ('g_monthly','p_chase','Monthly support','monthly',450000,'USD','donorbox:chase-roush-monthly','2026-01-15',1,'2026-01-15T09:00:00Z','2026-08-14T09:00:00Z'),
  ('g_setup','p_chase','Setup and travel','one_time',1200000,'USD','donorbox:chase-roush-setup','2026-01-15',1,'2026-01-15T09:00:00Z','2026-08-14T09:00:00Z');

-- Aggregates only. Four numbers per pull. No donor rows, ever.
INSERT INTO goal_snapshots (id, goal_id, partner_id, raised_cents, donor_count, source, captured_at) VALUES
  ('s_m1','g_monthly','p_chase',180000, 7,'donorbox','2026-05-01T06:00:00Z'),
  ('s_m2','g_monthly','p_chase',252000,11,'donorbox','2026-07-01T06:00:00Z'),
  ('s_m3','g_monthly','p_chase',306000,14,'donorbox','2026-08-14T06:00:00Z'),
  ('s_s1','g_setup','p_chase',410000, 9,'donorbox','2026-08-14T06:00:00Z');

-- ---------- api key ---------------------------------------------------------
-- Hash is fake. Real keys are generated by the admin and only the hash stored.
INSERT INTO api_keys (id, partner_id, name, key_hash, scopes, created_by, created_at) VALUES
  ('k_cr_build','p_chase','chaseroush.com build','sha256:0000000000000000000000000000000000000000000000000000000000000000','read:public','u_admin','2026-08-14T09:00:00Z');

-- ---------- audit -----------------------------------------------------------
INSERT INTO audit_log (id, at, user_id, partner_id, action, entity, entity_id, detail, ip) VALUES
  ('a_1','2026-08-14T08:00:00Z','u_admin','p_chase','read','goals','g_monthly','{"reason":"dashboard"}','127.0.0.1'),
  ('a_2','2026-08-14T07:30:00Z','u_chase','p_chase','update','contacts','c_1','{"fields":["notes"]}','127.0.0.1');
