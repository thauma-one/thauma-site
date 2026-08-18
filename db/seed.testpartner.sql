-- ============================================================================
-- seed.testpartner.sql — a SECOND, fully populated partner
-- ============================================================================
-- LOCAL AND DEV ONLY. Never against production.
--
-- Apply on top of seed.dev.sql:
--   npx wrangler d1 execute thauma-ops-dev --local --env dev \
--       --file=db/seed.testpartner.sql
--
-- WHY THIS EXISTS
-- ---------------------------------------------------------------------------
-- Acting-as could not be tested. `admin@thauma.one` held a `view` grant on
-- p_chase and `chase@thauma.one` owned it, so both accounts resolved to the
-- SAME partner — opening Chase's console from the admin account showed
-- identical data, and there was no way to tell whether the feature worked or
-- silently did nothing. Reported 2026-08-16 as "all of the goals are the same
-- as my admin account", which was exactly right and not a bug in the feature.
--
-- EVERY VALUE HERE IS DELIBERATELY UNLIKE p_chase's. Different currency,
-- different language, different goal shape, different stewardship state. If
-- acting-as is broken the screen looks the same as before, and "the same" is
-- the one thing that is easy to miss. Made obvious on purpose:
--
--   p_chase   USD, English + Croatian, 2 goals, 4 supporters
--   p_mira    EUR, English + Serbian,  1 goal,  6 supporters, one badly overdue
--
-- Mira Petrović is fictional. So is everybody below.
--
-- ⚠ PLAIN `INSERT`, AND A DELETE BLOCK, ON PURPOSE
-- ---------------------------------------------------------------------------
-- The first version used `INSERT OR IGNORE` for re-runnability, and it hid
-- four constraint violations in silence: a contact status of 'lapsed', an
-- interaction channel of 'email', a type of 'meeting' and a source of
-- 'system'. The file reported success and inserted five contacts instead of
-- six and NO interactions at all.
--
-- A seed that quietly drops rows is worse than one that fails: the data it
-- produces looks plausible and is wrong, and the screen it feeds looks empty
-- for reasons nobody can see. So: delete first, then insert loudly.
-- ============================================================================

-- Re-runnable, and noisy when something is wrong. Order matters — children
-- before parents, or the foreign keys refuse.
DELETE FROM milestone_translations WHERE partner_id = 'p_mira';
DELETE FROM milestones            WHERE partner_id = 'p_mira';
DELETE FROM interactions          WHERE partner_id = 'p_mira';
DELETE FROM contacts              WHERE partner_id = 'p_mira';
DELETE FROM goal_snapshots        WHERE partner_id = 'p_mira';
DELETE FROM goals                 WHERE partner_id = 'p_mira';
DELETE FROM resources             WHERE partner_id = 'p_mira';
DELETE FROM directory_contacts    WHERE partner_id = 'p_mira';
DELETE FROM partner_languages     WHERE partner_id = 'p_mira';
DELETE FROM partner_users         WHERE partner_id = 'p_mira';
DELETE FROM user_roles            WHERE user_id    = 'u_mira';
DELETE FROM users                 WHERE id         = 'u_mira';
DELETE FROM partners              WHERE id         = 'p_mira';

-- ---------- the partner -----------------------------------------------------
INSERT INTO partners
  (id, slug, display_name, status, giving_provider, giving_url, is_public, default_lang, created_at, updated_at)
VALUES
  ('p_mira','mira-petrovic','Mira Petrović','active','donorbox',
   'https://donorbox.org/mira-petrovic',1,'en',
   '2026-03-02T09:00:00Z','2026-08-16T09:00:00Z');

-- ---------- the person, and their access ------------------------------------
-- preferred_lang 'sr' IS THE POINT, not a detail.
--
-- It was 'en' in the first version, and acting as her looked identical to
-- being yourself — same English console, same layout — so the only difference
-- was numbers you had to already know to check. Reported as "you said Mira's
-- account was in Serbian, but it's showing as English".
--
-- With 'sr' the whole interface changes the moment you open her console. That
-- is a test you cannot pass by accident, and it exercises the thing this data
-- exists to prove: that every screen resolves to the PERSON being viewed, not
-- to the person signed in.
--
-- The PARTNER's default_lang stays 'en' above — deliberately different. One is
-- what a visitor to her public site gets before choosing; the other is what
-- she reads the console in. Untangling those two took a round of its own once
-- already (see the 'Untie the site default language' commit), and this data
-- keeps them visibly separate.
INSERT INTO users (id, email, name, global_role, status, preferred_lang, created_at, last_login_at) VALUES
  ('u_mira','mira@thauma.one','Mira Petrović','staff','active','sr',
   '2026-03-02T09:00:00Z','2026-08-15T16:20:00Z');

INSERT INTO user_roles (user_id, role, granted_by, granted_at) VALUES
  ('u_mira','partner','u_admin','2026-03-02T09:00:00Z'),
  ('u_mira','staff','u_admin','2026-03-02T09:00:00Z');

INSERT INTO partner_users (partner_id, user_id, role, granted_by, granted_at) VALUES
  ('p_mira','u_mira','owner','u_admin','2026-03-02T09:00:00Z');

-- NOTE: u_admin is deliberately NOT granted access to p_mira.
-- That is the point. An administrator has no standing access to a partner's
-- supporters — reaching them requires acting-as, which is audited. If the
-- admin console ever shows Mira's contacts without acting-as, something is
-- scoped wrong.

-- ---------- languages: Serbian, where Chase has Croatian --------------------
INSERT INTO partner_languages (partner_id, lang, is_enabled, sort_order) VALUES
  ('p_mira','en',1,0),
  ('p_mira','sr',1,1),
  -- Present but NOT enabled: text can be prepared before it is published, and
  -- the console must show it as available-but-off rather than missing.
  ('p_mira','hr',0,2);

-- ---------- supporters ------------------------------------------------------
-- Six, against Chase's four, with a spread of stewardship states. Nikola is
-- the one that matters: newslettered recently, not spoken to in over a year.
-- A single `last_contacted` column would show him as healthy.
INSERT INTO contacts
  (id, partner_id, first_name, last_name, email, phone, city, region, country,
   newsletter_consent, newsletter_consent_source, newsletter_consent_at,
   postal_consent, notes, status, created_at, updated_at)
VALUES
  ('c_m1','p_mira','Nikola','Jovanović','nikola.j@example.com','+381 11 555 0110',
   'Beograd',NULL,'RS',1,'website','2025-02-11T10:00:00Z',0,
   'Met at the Novi Sad conference. Prefers a phone call to email.','active',
   '2026-03-05T09:00:00Z','2026-08-01T09:00:00Z'),
  ('c_m2','p_mira','Jelena','Marković','jelena.m@example.com','+381 21 555 0134',
   'Novi Sad',NULL,'RS',1,'event','2025-06-20T10:00:00Z',1,
   'Leads the prayer group at her church.','active',
   '2026-03-05T09:00:00Z','2026-08-10T09:00:00Z'),
  ('c_m3','p_mira','Stefan','Ilić','stefan.ilic@example.com',NULL,
   'Niš',NULL,'RS',0,NULL,NULL,0,
   'Gives quarterly. Has asked NOT to be added to the newsletter.','active',
   '2026-04-02T09:00:00Z','2026-07-15T09:00:00Z'),
  ('c_m4','p_mira','Ana','Kovačević','ana.k@example.com','+381 11 555 0178',
   'Beograd',NULL,'RS',1,'website','2026-01-08T10:00:00Z',0,
   NULL,'active','2026-04-20T09:00:00Z','2026-08-12T09:00:00Z'),
  ('c_m5','p_mira','Marko','Đorđević','marko.dj@example.com',NULL,
   'Kragujevac',NULL,'RS',1,'referral','2025-11-30T10:00:00Z',0,
   'Introduced by Jelena.','active','2026-05-11T09:00:00Z','2026-08-05T09:00:00Z'),
  -- ARCHIVED on purpose: the console should treat this row differently.
-- ('lapsed' is not a status this schema has — the CHECK allows active,
--  archived and deleted, and the first draft of this file learned that
--  by having the row silently discarded.)
  ('c_m6','p_mira','Petar','Nikolić','petar.n@example.com',NULL,
   'Subotica',NULL,'RS',0,NULL,NULL,0,
   'Moved abroad; address unknown.','archived',
   '2026-03-05T09:00:00Z','2026-06-01T09:00:00Z');

-- ---------- contact history -------------------------------------------------
-- is_personal = 0 for the newsletter. A trigger enforces that a newsletter can
-- never be logged as personal contact; this data is what makes the difference
-- visible on the stewardship screen.
--
-- `channel` is digital / physical / in_person — NOT 'email' or 'phone', which
-- is what the first draft of this file used, and why it inserted no
-- interactions whatsoever.
INSERT INTO interactions
  (id, contact_id, partner_id, type, is_personal, channel, occurred_on, note, logged_by, source, created_at)
VALUES
  ('i_m1','c_m1','p_mira','newsletter',0,'digital','2026-08-01',
   'August update',NULL,'newsletter','2026-08-01T09:00:00Z'),
  -- The last time anybody actually SPOKE to Nikola. Over a year ago.
  ('i_m2','c_m1','p_mira','call',1,'digital','2025-07-14',
   'Long call about the Beograd team. Asked to be phoned rather than emailed.',
   'u_mira','manual','2025-07-14T16:00:00Z'),
  ('i_m3','c_m2','p_mira','visit',1,'in_person','2026-08-10',
   'Coffee after the service. She is organising the autumn prayer week.',
   'u_mira','manual','2026-08-10T14:00:00Z'),
  ('i_m4','c_m2','p_mira','newsletter',0,'digital','2026-08-01',
   'August update',NULL,'newsletter','2026-08-01T09:00:00Z'),
  ('i_m5','c_m3','p_mira','email',1,'digital','2026-07-15',
   'Thanked him for the quarterly gift.','u_mira','manual','2026-07-15T11:00:00Z'),
  ('i_m6','c_m4','p_mira','newsletter',0,'digital','2026-08-01',
   'August update',NULL,'newsletter','2026-08-01T09:00:00Z'),
  ('i_m7','c_m5','p_mira','call',1,'digital','2026-08-05',
   'Introduced himself properly. Interested in the youth work.',
   'u_mira','manual','2026-08-05T18:30:00Z');

-- ---------- goal: ONE, in EUROS ---------------------------------------------
-- Chase's are in USD. If the currency on screen does not change when you open
-- Mira's console, the page is not reading her partner record.
INSERT INTO goals
  (id, partner_id, label, kind, target_cents, currency, external_ref, starts_on, ends_on, is_public, created_at, updated_at)
VALUES
  ('g_m1','p_mira','Monthly support','monthly',180000,'EUR','donorbox:mira-monthly',
   '2026-03-01',NULL,1,'2026-03-02T09:00:00Z','2026-08-16T09:00:00Z');

INSERT INTO goal_snapshots (id, goal_id, partner_id, raised_cents, donor_count, source, captured_at) VALUES
  ('gs_m1','g_m1','p_mira', 42000, 6,'donorbox','2026-05-01T00:00:00Z'),
  ('gs_m2','g_m1','p_mira', 78500,11,'donorbox','2026-07-01T00:00:00Z'),
  ('gs_m3','g_m1','p_mira',103500,14,'donorbox','2026-08-15T00:00:00Z');

-- ---------- milestones: three, against Chase's eight ------------------------
INSERT INTO milestones
  (id, partner_id, parent_id, actual_date, status, completion, sort_order, is_public, is_featured, created_at, updated_at)
VALUES
  ('ms_m1','p_mira',NULL,'2026-03-01','complete',100,0,1,0,'2026-03-02T09:00:00Z','2026-03-02T09:00:00Z'),
  ('ms_m2','p_mira',NULL,NULL,'in_progress',58,1,1,1,'2026-03-02T09:00:00Z','2026-08-16T09:00:00Z'),
  -- Not public: the editor must show it and the partner API must not.
  ('ms_m3','p_mira',NULL,NULL,'upcoming',0,2,0,0,'2026-03-02T09:00:00Z','2026-03-02T09:00:00Z');

INSERT INTO milestone_translations
  (milestone_id, lang, partner_id, title, description, target_label, updated_at)
VALUES
  ('ms_m1','en','p_mira','Commissioned in Beograd',
   'Sent by the home church in March, with the Beograd team already expecting us.',
   NULL,'2026-03-02T09:00:00Z'),
  ('ms_m1','sr','p_mira','Послање у Београду',
   'Послани од матичне цркве у марту, док нас је београдски тим већ очекивао.',
   NULL,'2026-03-02T09:00:00Z'),

  ('ms_m2','en','p_mira','Monthly support',
   'Reaching the monthly figure that lets the work continue without a second job.',
   '€1,800 / month','2026-08-16T09:00:00Z'),
  -- DELIBERATELY MISSING its Serbian translation. The editor should show this
  -- as an untranslated string rather than pretending it is done.

  ('ms_m3','en','p_mira','Youth programme',
   'Starting a weekly programme for the teenagers already coming on Sundays.',
   NULL,'2026-03-02T09:00:00Z');

-- ---------- her own resources and address book ------------------------------
INSERT INTO resources
  (id, partner_id, title, description, link, photo, visibility, created_by, created_at, updated_at)
VALUES
  ('r_m1','p_mira','Serbian support letter template',
   'The letter she sends to new supporters, already translated.',
   'https://example.com/mira-letter',NULL,'staff','u_mira',
   '2026-04-01T09:00:00Z','2026-04-01T09:00:00Z'),
  ('r_m2','p_mira','Beograd team contact sheet',
   'Who to call locally, and for what.',
   'https://example.com/beograd-team',NULL,'staff','u_mira',
   '2026-05-14T09:00:00Z','2026-05-14T09:00:00Z');

-- Per PERSON, not per partner: this is her own address book and nobody else's,
-- not even another user of the same ministry.
INSERT INTO directory_contacts
  (id, user_id, partner_id, name, role, emails, phones, created_at, updated_at)
VALUES
  ('dc_m1','u_mira','p_mira','Pastor Dragan Simić','Home church, Beograd',
   '["dragan@example.com"]','["+381 11 555 0190"]',
   '2026-03-10T09:00:00Z','2026-03-10T09:00:00Z'),
  ('dc_m2','u_mira','p_mira','Ivana Todorović','Translator',
   '["ivana.t@example.com"]','[]',
   '2026-04-22T09:00:00Z','2026-04-22T09:00:00Z');
