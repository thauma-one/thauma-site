-- seed.production-content.sql — the working content, copied from dev
--
-- Generated 2026-08-20 from the Pi's dev database, for the p_chase partner
-- only. Mira Petrovic is a TEST FIXTURE and is deliberately excluded: she
-- exists to prove that acting-as resolves to the person being viewed, and
-- putting her in production would make her a real partner nobody sent.
--
-- INSERT OR IGNORE throughout, so running it twice changes nothing. Every row
-- here is deletable from the console afterwards — nothing this creates is
-- structural.
--
-- Publication flags are carried across as they are on dev. If a milestone was
-- unpublished there it stays unpublished here; this copies content, it does
-- not decide what the world sees.


-- ---------- milestones (8 rows) ----------
INSERT OR IGNORE INTO milestones (id, partner_id, parent_id, actual_date, status, completion, sort_order, is_public, is_featured, created_at, updated_at) VALUES
  ('m_chase_get_fingerprinted', 'p_chase', 'm_chase_visa_application', '2027-05-16', 'upcoming', 0, 5, 0, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_1st_missions_trip', 'p_chase', NULL, '2026-09-24', 'upcoming', 0, 0, 1, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_fundraising', 'p_chase', NULL, '2026-09-03', 'in_progress', 0, 1, 1, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_2nd_missions_trip', 'p_chase', NULL, '2027-02-01', 'upcoming', 0, 2, 1, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_visa_application', 'p_chase', NULL, '2027-04-30', 'upcoming', 0, 3, 1, 0, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_move_to_croatia', 'p_chase', NULL, '2027-09-30', 'upcoming', 0, 6, 1, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_support_raising', 'p_chase', NULL, '2027-03-15', 'upcoming', 0, 7, 1, 1, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z'),
  ('m_chase_submit_the_application', 'p_chase', 'm_chase_visa_application', '2027-06-14', 'upcoming', 0, 4, 1, 0, '2026-08-15T16:14:35Z', '2026-08-15T16:14:35Z');

-- ---------- milestone_translations (22 rows) ----------
INSERT OR IGNORE INTO milestone_translations (milestone_id, lang, partner_id, title, description, target_label, updated_at) VALUES
  ('m_chase_proclaim_1st_missions_trip', 'en', 'p_chase', 'Proclaim! 1st Missions Trip', 'This is a missions trip with Proclaim International somewhere in the world. There are 2 options currently for 2026, but I don''t know which one I should go on yet. Both are occuring at the same time.', 'End of September - Start of October 2026', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_fundraising', 'en', 'p_chase', 'Proclaim! Fundraising', 'The support need for the Victory English Camp in September is around $5000. Any support you can give is greatly appreciated!', 'Now', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_2nd_missions_trip', 'en', 'p_chase', 'Proclaim! 2nd Missions Trip', 'As I explore if long term missions is what God is calling me to, I will need to continue to do short term missions. I do not know what trip I will be serving on, but I''m hoping it is in February! I would love for this trip to be music related!', 'February 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_visa_application', 'en', 'p_chase', 'Visa Application', 'In order to do missions internationally, I will need to apply for a Visa. There are a lot of steps and it will take a lot of time to do. From what I can tell, the primary steps are showing that I have reliable income, getting different types of insurance, getting a letter of guarantee, and completing the application form.', 'April 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_move_to_croatia', 'en', 'p_chase', 'Move to Croatia', 'This is when I hope God has put all the pieces in place and has said "It''s time to go, Chase!" It''s a time I can''t wait to come, and I pray that this does not get delayed!!!', 'End of September 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_support_raising', 'en', 'p_chase', 'Support Raising', 'In order to be able to support myself while doing, I will need the support of many donors and supporters! This will be a full-time endeavor over the course of months, but I pray that God helps me to be strong, reminds me of the people I need to partner with, and brings other people into my life to help support me in more ways than one.', 'March - September 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_submit_the_application', 'en', 'p_chase', 'Submit the Application', 'This is the final step of the Visa Application process and there is a lot of documentation that is needed.', 'June 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_get_fingerprinted', 'en', 'p_chase', 'Get Fingerprinted', 'I will need to be fingerprinted in order to apply for long term visa.', 'April 2027', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_1st_missions_trip', 'hr', 'p_chase', 'Proclaim! 1. misijsko putovanje', 'Ovo je misionarsko putovanje s Proclaim Internationalom negdje u svijetu. Trenutno postoje dvije opcije za 2026., ali još ne znam na koje bih trebao ići. Obje se odvijaju u isto vrijeme.', 'Kraj rujna - početak listopada 2026.', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_fundraising', 'hr', 'p_chase', 'Proclaim! Prikupljanje sredstava', 'Potrebna podrška za Pobjednički engleski kamp u rujnu iznosi oko 5000 dolara.', '3. rujna 2026.', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_2nd_missions_trip', 'hr', 'p_chase', 'Proclaim! 2. misijsko putovanje', 'Nastavljam istraživati je li dugoročne misije ono na što me Bog poziva.', 'Veljača 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_visa_application', 'hr', 'p_chase', 'Zahtjev za vizu', 'In order to do missions internationally, I will need to apply for a Visa. There are a lot of steps and it will take a lot of time to do. From what I can tell, the primary steps are showing that I have reliable income, getting different types of insurance, getting a letter of guarantee, and completing the application form.', 'Travanj 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_move_to_croatia', 'hr', 'p_chase', 'Preseljenje u Hrvatsku', 'Ovo je trenutak kada se nadam da je Bog sve složio na svoje mjesto i rekao "Vrijeme je da kreneš, Chase!" To je trenutak kojeg jedva čekam, i molim se da se ovo ne odgodi!!!', 'Kraj rujna 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_support_raising', 'hr', 'p_chase', 'Prikupljanje podrške', 'Kako bih se mogao uzdržavati dok to radim, trebat ću podršku mnogih donatora i podupiratelja! Ovo će biti potpuno zalaganje kroz nekoliko mjeseci, ali molim se da mi Bog pomogne biti jak, podsjeća me na ljude s kojima trebam surađivati i dovodi druge ljude u moj život koji će me podupirati na više načina.', 'Ožujak - Rujan 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_submit_the_application', 'hr', 'p_chase', 'Pošalji prijavu', 'Ovo je posljednji korak procesa prijave za vizu i potrebno je mnogo dokumentacije.', 'Lipanj 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_get_fingerprinted', 'hr', 'p_chase', 'Uzimanje otisaka prstiju', 'Morat ću uzeti otiske prstiju za prijavu dugoročne vize.', 'Travanj 2027.', '2026-08-15T16:14:35Z'),
  ('m_chase_proclaim_1st_missions_trip', 'sr', 'p_chase', 'Proclaim! 1. мисионарско путовање', 'Мисионарско путовање са Proclaim International-ом.', 'Крај септембра 2026.', '2026-08-15T00:00:00Z'),
  ('m_chase_proclaim_fundraising', 'sr', 'p_chase', 'Proclaim! Прикупљање средстава', 'Потребна подршка за камп у септембру износи око 5000 долара.', 'Сада', '2026-08-15T00:00:00Z'),
  ('m_chase_proclaim_2nd_missions_trip', 'sr', 'p_chase', 'Proclaim! 2. мисионарско путовање', 'Наставак истраживања дугорочних мисија.', 'Фебруар 2027.', '2026-08-15T00:00:00Z'),
  ('m_chase_visa_application', 'sr', 'p_chase', 'Захтев за визу', 'Пријава за визу има много корака и захтева време.', 'Април 2027.', '2026-08-15T00:00:00Z'),
  ('m_chase_move_to_croatia', 'sr', 'p_chase', 'Пресељење у Хрватску', 'Тренутак када се надам да је све спремно за полазак.', 'Крај септембра 2027.', '2026-08-15T00:00:00Z'),
  ('m_chase_support_raising', 'sr', 'p_chase', 'Прикупљање подршке', 'Прикупљање подршке за пресељење у Хрватску.', NULL, '2026-08-15T00:00:00Z');

-- ---------- goals (2 rows) ----------
INSERT OR IGNORE INTO goals (id, partner_id, label, kind, target_cents, currency, external_ref, starts_on, ends_on, is_public, created_at, updated_at, description) VALUES
  ('g_monthly', 'p_chase', 'Monthly support', 'monthly', 450000, 'USD', 'donorbox:chase-roush-monthly', '2026-01-15', NULL, 1, '2026-01-15T09:00:00Z', '2026-08-14T09:00:00Z', NULL),
  ('g_setup', 'p_chase', 'Setup and travel', 'one_time', 1200000, 'USD', 'donorbox:chase-roush-setup', '2026-01-15', NULL, 1, '2026-01-15T09:00:00Z', '2026-08-14T09:00:00Z', NULL);

-- ---------- goal_snapshots (4 rows) ----------
INSERT OR IGNORE INTO goal_snapshots (id, goal_id, partner_id, raised_cents, donor_count, source, captured_at) VALUES
  ('s_m1', 'g_monthly', 'p_chase', 180000, 7, 'donorbox', '2026-05-01T06:00:00Z'),
  ('s_m2', 'g_monthly', 'p_chase', 252000, 11, 'donorbox', '2026-07-01T06:00:00Z'),
  ('s_m3', 'g_monthly', 'p_chase', 306000, 14, 'donorbox', '2026-08-14T06:00:00Z'),
  ('s_s1', 'g_setup', 'p_chase', 410000, 9, 'donorbox', '2026-08-14T06:00:00Z');

-- ---------- prayer (3 rows) ----------
INSERT OR IGNORE INTO prayer (id, partner_id, is_public, is_answered, answered_on, sort_order, created_at, updated_at) VALUES
  ('pr_housing', 'p_chase', 1, 0, NULL, 1, '2026-08-19 14:41:05', '2026-08-19 14:41:05'),
  ('pr_team', 'p_chase', 1, 0, NULL, 2, '2026-08-19 14:41:05', '2026-08-19 14:41:05'),
  ('pr_visa', 'p_chase', 1, 1, '2026-07-12', 3, '2026-08-19 14:41:05', '2026-08-19 14:41:05');

-- ---------- prayer_translations (3 rows) ----------
INSERT OR IGNORE INTO prayer_translations (prayer_id, lang, partner_id, title, description, answer_text, updated_at) VALUES
  ('pr_housing', 'en', 'p_chase', 'Housing in Croatia', 'Somewhere in Zagreb within reach of the church, that a family can afford on support income.', NULL, '2026-08-19 14:41:05'),
  ('pr_team', 'en', 'p_chase', 'The sending team', 'For the churches and partners deciding this autumn whether to come alongside this work.', NULL, '2026-08-19 14:41:05'),
  ('pr_visa', 'en', 'p_chase', 'Clarity on the visa route', 'Which residence permit actually fits long-term ministry, before the application window opens.', 'The route is settled and the paperwork list is in hand — what looked like a wall turned out to be a queue.', '2026-08-19 14:41:05');
