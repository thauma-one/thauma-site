// GENERATED FILE — DO NOT EDIT.
// Source: db/queries.sql
// Regenerate: python3 db/generate_queries_module.py
//
// Workers cannot read files at runtime, so the SQL is bundled here.
// db/queries.sql remains the single source of truth; workers/test/db.test.mjs
// asserts this file is in sync with it, so a stale copy fails the tests
// rather than silently shipping old SQL.

/** sha256 of db/queries.sql at generation time, first 16 hex chars. */
export const SOURCE_DIGEST = "a2ba386ea17f935e";

export const QUERIES = {
  admin_audit_recent: `SELECT a.at, a.action, a.entity, a.entity_id, a.detail,
       a.partner_id, COALESCE(u.name, a.user_id) AS actor
FROM audit_log a
LEFT JOIN users u ON u.id = a.user_id
ORDER BY a.at DESC
LIMIT :limit;`,
  admin_count_admins: `SELECT COUNT(*) AS n
FROM user_roles r JOIN users u ON u.id = r.user_id
WHERE r.role = 'admin' AND u.status = 'active';`,
  admin_partner_create: `INSERT INTO partners (id, slug, display_name, status, is_public, default_lang,
                      created_at, updated_at)
VALUES (:id, :slug, :display_name, 'prospective', 0, 'en', :now, :now);`,
  admin_partner_delete: `DELETE FROM partners WHERE id = :partner_id;`,
  admin_partner_grant: `INSERT OR IGNORE INTO partner_users (partner_id, user_id, role, granted_by, granted_at)
VALUES (:partner_id, :user_id, :role, :granted_by, :now);`,
  admin_partner_revoke: `DELETE FROM partner_users WHERE partner_id = :partner_id AND user_id = :user_id;`,
  admin_partner_set: `UPDATE partners SET display_name = :display_name, status = :status, updated_at = :now
WHERE id = :id;`,
  admin_partner_stats: `SELECT
  (SELECT COUNT(*) FROM contacts      WHERE partner_id = :partner_id) AS contacts,
  (SELECT COUNT(*) FROM interactions  WHERE partner_id = :partner_id) AS interactions,
  (SELECT COUNT(*) FROM goals         WHERE partner_id = :partner_id) AS goals,
  (SELECT COUNT(*) FROM milestones    WHERE partner_id = :partner_id) AS milestones,
  (SELECT COUNT(*) FROM api_keys      WHERE partner_id = :partner_id
                                        AND revoked_at IS NULL)       AS live_keys,
  (SELECT COUNT(*) FROM partner_users WHERE partner_id = :partner_id) AS members,
  (SELECT COUNT(*) FROM resources     WHERE partner_id = :partner_id) AS resources,
  (SELECT COUNT(*) FROM directory_contacts WHERE partner_id = :partner_id) AS directory;`,
  admin_partners: `SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang,
       (SELECT COUNT(*) FROM partner_users pu WHERE pu.partner_id = p.id) AS member_count
FROM partners p
ORDER BY p.display_name COLLATE NOCASE;`,
  admin_role_grant: `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, granted_at)
VALUES (:user_id, :role, :granted_by, :now);`,
  admin_role_revoke: `DELETE FROM user_roles WHERE user_id = :user_id AND role = :role;`,
  admin_user_create: `INSERT INTO users (id, email, name, global_role, status, created_at)
VALUES (:id, :email, :name, 'staff', 'invited', :now);`,
  admin_user_delete: `DELETE FROM users WHERE id = :id;`,
  admin_user_set: `UPDATE users SET name = :name, status = :status WHERE id = :id;`,
  admin_users: `SELECT
  u.id, u.email, u.name, u.status, u.created_at, u.last_login_at,
  COALESCE(u.preferred_lang, 'en') AS preferred_lang,
  (SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
  (SELECT GROUP_CONCAT(p.display_name, ' | ')
     FROM partner_users pu JOIN partners p ON p.id = pu.partner_id
    WHERE pu.user_id = u.id) AS partner_names,
  (SELECT GROUP_CONCAT(pu.partner_id) FROM partner_users pu WHERE pu.user_id = u.id) AS partner_ids
FROM users u
ORDER BY u.status, u.name COLLATE NOCASE;`,
  api_key_create: `INSERT INTO api_keys (id, partner_id, name, key_hash, scopes, created_by, created_at)
VALUES (:id, :partner_id, :name, :key_hash, :scopes, :created_by, :now);`,
  api_key_lookup: `SELECT k.id AS key_id, k.partner_id, k.scopes, p.slug, p.display_name
FROM api_keys k
JOIN partners p ON p.id = k.partner_id
WHERE k.key_hash = :key_hash
  AND k.revoked_at IS NULL
  AND p.status = 'active';`,
  api_key_revoke: `UPDATE api_keys SET revoked_at = :now
WHERE id = :id AND partner_id = :partner_id AND revoked_at IS NULL;`,
  api_key_touch: `UPDATE api_keys SET last_used_at = :now WHERE id = :key_id;`,
  api_keys_for_partner: `SELECT id, name, scopes, created_at, last_used_at, revoked_at
FROM api_keys
WHERE partner_id = :partner_id
ORDER BY revoked_at IS NOT NULL, created_at DESC;`,
  audit_recent_for_partner: `SELECT a.at, a.action, a.entity, a.entity_id, u.name AS actor
FROM audit_log a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;`,
  audit_write: `INSERT INTO audit_log (id, at, user_id, partner_id, action, entity, entity_id, detail)
VALUES (:id, :now, :user_id, :partner_id, :action, :entity, :entity_id, :detail);`,
  contact_timeline: `SELECT
  i.id,
  i.type,
  i.is_personal,
  i.channel,
  i.occurred_on,
  i.note,
  i.source,
  u.name AS logged_by_name
FROM interactions i
LEFT JOIN users u ON u.id = i.logged_by
WHERE i.contact_id = :contact_id
  AND i.partner_id = :partner_id
ORDER BY i.occurred_on DESC, i.created_at DESC;`,
  contacts_stewardship: `SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.city,
  c.country,
  c.newsletter_consent,
  c.postal_consent,
  t.last_contact_any,
  t.last_personal_contact,
  t.interaction_count,
  t.personal_count,
  CASE
    WHEN t.last_personal_contact IS NULL THEN NULL
    ELSE CAST(julianday(:today) - julianday(t.last_personal_contact) AS INTEGER)
  END AS days_since_personal
FROM contacts c
JOIN contact_touch t ON t.contact_id = c.id
WHERE c.partner_id = :partner_id
  AND c.status = 'active'
ORDER BY (t.last_personal_contact IS NULL) DESC, t.last_personal_contact ASC;`,
  dashboard_needs_attention: `SELECT COUNT(*) AS stale_count
FROM contact_touch
WHERE partner_id = :partner_id
  AND (last_personal_contact IS NULL
       OR last_personal_contact < date(:today, '-' || :stale_days || ' days'));`,
  dashboard_partner_summary: `SELECT
  (SELECT COUNT(*) FROM contacts
     WHERE partner_id = :partner_id AND status = 'active')                       AS contacts_total,
  (SELECT COUNT(*) FROM contacts
     WHERE partner_id = :partner_id AND status = 'active'
       AND newsletter_consent = 1)                                               AS newsletter_optin,
  (SELECT COUNT(*) FROM interactions
     WHERE partner_id = :partner_id AND is_personal = 1
       AND occurred_on >= date(:today, '-30 days'))                              AS personal_last_30,
  (SELECT COUNT(*) FROM goals
     WHERE partner_id = :partner_id)                                             AS goals_total;`,
  directory_delete: `DELETE FROM directory_contacts
WHERE id = :id AND user_id = :user_id AND partner_id = :partner_id;`,
  directory_for_user: `SELECT id, name, role, emails, phones, created_at, updated_at
FROM directory_contacts
WHERE user_id = :user_id AND partner_id = :partner_id
ORDER BY name COLLATE NOCASE;`,
  directory_upsert: `INSERT INTO directory_contacts
  (id, user_id, partner_id, name, role, emails, phones, created_at, updated_at)
VALUES
  (:id, :user_id, :partner_id, :name, :role, :emails, :phones, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  name = :name, role = :role, emails = :emails, phones = :phones,
  updated_at = :now
WHERE directory_contacts.user_id = :user_id
  AND directory_contacts.partner_id = :partner_id;`,
  goal_history: `SELECT raised_cents, donor_count, captured_at
FROM goal_snapshots
WHERE goal_id = :goal_id AND partner_id = :partner_id
ORDER BY captured_at ASC;`,
  goals_for_partner: `SELECT
  goal_id, label, kind, target_cents, currency,
  raised_cents, donor_count, percent, captured_at, is_public
FROM goal_progress
WHERE partner_id = :partner_id
ORDER BY kind, label;`,
  interactions_for_partner: `SELECT
  i.contact_id,
  i.id,
  i.type,
  i.is_personal,
  i.channel,
  i.occurred_on,
  i.note,
  i.source,
  u.name AS logged_by_name
FROM interactions i
JOIN contacts c ON c.id = i.contact_id
LEFT JOIN users u ON u.id = i.logged_by
WHERE i.partner_id = :partner_id
  AND c.status = 'active'
ORDER BY i.occurred_on DESC, i.created_at DESC;`,
  languages_all: `SELECT code, name, native_name, is_active, sort_order
FROM languages ORDER BY sort_order, name;`,
  milestone_delete: `DELETE FROM milestones WHERE id = :id AND partner_id = :partner_id;`,
  milestone_reorder: `UPDATE milestones SET sort_order = :sort_order, updated_at = :now
WHERE id = :id AND partner_id = :partner_id;`,
  milestone_translation_delete: `DELETE FROM milestone_translations
WHERE milestone_id = :milestone_id AND lang = :lang AND partner_id = :partner_id;`,
  milestone_translation_upsert: `INSERT INTO milestone_translations (
  milestone_id, lang, partner_id, title, description, target_label, updated_at
) VALUES (
  :milestone_id, :lang, :partner_id, :title, :description, :target_label, :now
)
ON CONFLICT(milestone_id, lang) DO UPDATE SET
  title = :title, description = :description,
  target_label = :target_label, updated_at = :now
WHERE milestone_translations.partner_id = :partner_id;`,
  milestone_translations_for_staff: `SELECT milestone_id, lang, title, description, target_label, updated_at
FROM milestone_translations
WHERE partner_id = :partner_id
ORDER BY milestone_id, lang;`,
  milestone_upsert: `INSERT INTO milestones (
  id, partner_id, parent_id, actual_date, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
) VALUES (
  :id, :partner_id, :parent_id, :actual_date, :status, :completion,
  :is_public, :is_featured, :sort_order, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  parent_id = :parent_id, actual_date = :actual_date, status = :status,
  completion = :completion, is_public = :is_public, is_featured = :is_featured,
  sort_order = :sort_order, updated_at = :now
WHERE milestones.partner_id = :partner_id;`,
  milestones_for_staff: `SELECT
  id, parent_id, actual_date, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
FROM milestones
WHERE partner_id = :partner_id
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;`,
  partner_language_set: `INSERT INTO partner_languages (partner_id, lang, is_enabled, sort_order)
VALUES (:partner_id, :lang, :is_enabled, :sort_order)
ON CONFLICT(partner_id, lang) DO UPDATE SET
  is_enabled = :is_enabled, sort_order = :sort_order;`,
  partner_languages_for_partner: `SELECT l.code, l.name, l.native_name, l.sort_order AS catalogue_order,
       COALESCE(pl.is_enabled, 0) AS is_enabled,
       COALESCE(pl.sort_order, l.sort_order) AS sort_order
FROM languages l
LEFT JOIN partner_languages pl
  ON pl.lang = l.code AND pl.partner_id = :partner_id
WHERE l.is_active = 1
ORDER BY sort_order, l.name;`,
  partner_set_default_lang: `UPDATE partners SET default_lang = :lang, updated_at = :now WHERE id = :partner_id;`,
  partner_settings: `SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang
FROM partners p WHERE p.id = :partner_id;`,
  partners_for_user: `SELECT p.id, p.slug, p.display_name, p.status, pu.role AS access_role,
       u.id AS user_id, u.name AS user_name,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang
FROM users u
JOIN partner_users pu ON pu.user_id = u.id
JOIN partners p ON p.id = pu.partner_id
WHERE u.email = :email
  AND u.status = 'active'
ORDER BY p.display_name;`,
  public_goals_for_partner: `SELECT
  goal_id, label, kind, target_cents, currency,
  raised_cents, donor_count, percent, captured_at
FROM goal_progress
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY kind, label;`,
  public_languages_for_partner: `SELECT l.code, l.name, l.native_name, pl.sort_order
FROM partner_languages pl
JOIN languages l ON l.code = pl.lang
WHERE pl.partner_id = :partner_id
  AND pl.is_enabled = 1
  AND l.is_active = 1
ORDER BY pl.sort_order, l.name;`,
  public_milestone_translations: `SELECT t.milestone_id, t.lang, t.title, t.description, t.target_label
FROM milestone_translations t
JOIN milestones m ON m.id = t.milestone_id
JOIN partner_languages pl ON pl.partner_id = t.partner_id AND pl.lang = t.lang
JOIN languages l ON l.code = t.lang
WHERE t.partner_id = :partner_id
  AND m.is_public = 1
  AND pl.is_enabled = 1
  AND l.is_active = 1
ORDER BY t.milestone_id, l.sort_order;`,
  public_milestones_for_partner: `SELECT
  id, parent_id, actual_date, status, completion, is_featured, sort_order
FROM milestones
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;`,
  resource_delete: `DELETE FROM resources WHERE id = :id AND partner_id IS :partner_id;`,
  resource_upsert: `INSERT INTO resources
  (id, partner_id, title, description, link, photo, visibility,
   created_by, created_at, updated_at)
VALUES
  (:id, :partner_id, :title, :description, :link, :photo, :visibility,
   :created_by, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  title = :title, description = :description, link = :link, photo = :photo,
  visibility = :visibility, updated_at = :now
WHERE resources.partner_id IS :partner_id;`,
  resources_visible: `SELECT id, partner_id, title, description, link, photo, visibility,
       created_at, updated_at
FROM resources
WHERE (partner_id = :partner_id OR partner_id IS NULL)
  AND instr(',' || :levels || ',', ',' || visibility || ',') > 0
ORDER BY title COLLATE NOCASE;`,
  user_by_email: `SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.email = :email AND u.status = 'active';`,
  user_set_preferred_lang: `UPDATE users SET preferred_lang = :lang WHERE email = :email AND status = 'active';`
};
