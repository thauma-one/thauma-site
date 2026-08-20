-- seed.production-first-admin.sql — the first account in the production database
--
-- WHY THIS EXISTS
-- ============================================================================
-- Production had schema and no rows: users 0, user_roles 0, partners 0. So
-- Cloudflare Access would let somebody in — that is authentication, and the
-- Access application was correct all along — and then the Worker would answer
-- "that address has no partner access yet", because authorisation is these
-- tables and they were empty. The console had never worked against production;
-- everything anybody had ever used was thauma-ops-dev.
--
-- RUN ONCE. Every statement is INSERT OR IGNORE, so running it twice changes
-- nothing rather than failing halfway through and leaving a partial account.
--
-- ADMIN IS admin@thauma.one AND THAT IS DELIBERATE. It is the organisation's
-- address, not a person's, so the account that can always get in does not
-- depend on any individual still being here. It is the same principle the
-- GitHub organisation and the Netlify account already follow.

-- ---------- the person ------------------------------------------------------
-- global_role is the legacy single-role column kept in step with user_roles
-- below; the roles table is what the Worker actually reads.
INSERT OR IGNORE INTO users
  (id, email, name, global_role, status, created_at, last_login_at, preferred_lang)
VALUES
  ('u_admin', 'admin@thauma.one', 'Chase Roush', 'admin', 'active',
   datetime('now'), NULL, 'en');

-- ---------- what they may do ------------------------------------------------
-- granted_by is themselves: there was nobody else to do it, and recording a
-- fiction would be worse than recording that.
INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, granted_at) VALUES
  ('u_admin', 'admin', 'u_admin', datetime('now')),
  ('u_admin', 'staff', 'u_admin', datetime('now'));

-- ---------- something to administer ----------------------------------------
-- A real partner rather than a placeholder, because the staff console is empty
-- and unusable without one. is_public 0: nothing here reaches a public page
-- until somebody switches it on deliberately.
INSERT OR IGNORE INTO partners
  (id, slug, display_name, status, giving_provider, giving_url, is_public,
   default_lang, created_at, updated_at)
VALUES
  ('p_chase', 'chase-roush', 'Chase Roush', 'active', NULL, NULL, 0,
   'en', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO partner_users (partner_id, user_id, role, granted_by, granted_at)
VALUES ('p_chase', 'u_admin', 'owner', 'u_admin', datetime('now'));

-- ---------- languages this partner publishes -------------------------------
-- English on, the rest off. partner_languages_for_partner LEFT JOINs from the
-- catalogue, so an absent row already means "not enabled" — English is stated
-- explicitly so the console opens with one column filled rather than none.
INSERT OR IGNORE INTO partner_languages (partner_id, lang, is_enabled, sort_order)
VALUES ('p_chase', 'en', 1, 0);
