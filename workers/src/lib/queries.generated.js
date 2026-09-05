// GENERATED FILE — DO NOT EDIT.
// Source: db/queries.sql
// Regenerate: python3 db/generate_queries_module.py
//
// Workers cannot read files at runtime, so the SQL is bundled here.
// db/queries.sql remains the single source of truth; workers/test/db.test.mjs
// asserts this file is in sync with it, so a stale copy fails the tests
// rather than silently shipping old SQL.

/** sha256 of db/queries.sql at generation time, first 16 hex chars. */
export const SOURCE_DIGEST = "fe9395580d83c38d";

export const QUERIES = {
  admin_audit_recent: `SELECT a.at, a.action, a.entity, a.entity_id, a.detail,
       a.partner_id, COALESCE(u.name, a.user_id) AS actor
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id
ORDER BY a.at DESC
LIMIT :limit;`,
  admin_count_admins: `SELECT COUNT(*) AS n
FROM user_roles r JOIN users u ON u.id = r.user_id
WHERE r.role = 'admin' AND u.status = 'active';`,
  admin_lists_archive_by_sender: `UPDATE mailing_lists SET archived_at = :now, updated_at = :now
WHERE from_email = :address AND archived_at IS NULL;`,
  admin_lists_drop_reply_to: `UPDATE mailing_lists SET reply_to = NULL, updated_at = :now WHERE reply_to = :address;`,
  admin_lists_repoint: `UPDATE mailing_lists
SET from_email = CASE WHEN from_email = :old THEN :new ELSE from_email END,
    reply_to   = CASE WHEN reply_to   = :old THEN :new ELSE reply_to   END,
    updated_at = :now
WHERE from_email = :old OR reply_to = :old;`,
  admin_partner_create: `INSERT INTO partners (id, slug, display_name, status, is_public, default_lang,
                      created_at, updated_at)
VALUES (:id, :slug, :display_name, 'prospective', 0, 'en', :now, :now);`,
  admin_partner_delete: `DELETE FROM partners WHERE id = :partner_id;`,
  admin_partner_grant: `INSERT OR IGNORE INTO partner_users (partner_id, user_id, role, granted_by, granted_at)
VALUES (:partner_id, :user_id, :role, :granted_by, :now);`,
  admin_partner_revoke: `DELETE FROM partner_users WHERE partner_id = :partner_id AND user_id = :user_id;`,
  admin_partner_set: `UPDATE partners SET display_name = :display_name, status = :status, updated_at = :now
WHERE id = :id;`,
  admin_partner_set_domain: `UPDATE partners SET sending_domain = :sending_domain, updated_at = :now
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
       p.sending_domain,
       (SELECT COUNT(*) FROM partner_users pu WHERE pu.partner_id = p.id) AS member_count,
       (SELECT COUNT(*) FROM sender_addresses sa WHERE sa.partner_id = p.id) AS sender_count
FROM partners p
ORDER BY p.display_name COLLATE NOCASE;`,
  admin_role_grant: `INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, granted_at)
VALUES (:user_id, :role, :granted_by, :now);`,
  admin_role_revoke: `DELETE FROM user_roles WHERE user_id = :user_id AND role = :role;`,
  admin_sender_address_add: `INSERT INTO sender_addresses (id, partner_id, address, label, can_receive, created_at)
VALUES (:id, :partner_id, :address, :label, :can_receive, :now);`,
  admin_sender_address_delete: `DELETE FROM sender_addresses WHERE id = :id;`,
  admin_sender_addresses: `SELECT sa.id, sa.partner_id, sa.address, sa.label, sa.can_receive, sa.created_at,
       p.display_name AS partner_name,
       (SELECT COUNT(*) FROM mailing_lists l
         WHERE l.archived_at IS NULL
           AND (l.from_email = sa.address OR l.reply_to = sa.address)) AS used_by,
       (SELECT GROUP_CONCAT(l.name, ' | ') FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.from_email = sa.address) AS sends_for,
       (SELECT GROUP_CONCAT(l.name, ' | ') FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.reply_to = sa.address) AS replies_for,
       (SELECT COALESCE(SUM((SELECT COUNT(*) FROM subscribers s
                              WHERE s.list_id = l.id AND s.status = 'subscribed')), 0)
          FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.from_email = sa.address) AS sends_subscribers
FROM sender_addresses sa
LEFT JOIN partners p ON p.id = sa.partner_id
ORDER BY p.display_name COLLATE NOCASE, sa.address COLLATE NOCASE;`,
  admin_sender_readdress: `UPDATE sender_addresses SET address = :address WHERE id = :id;`,
  admin_user_create: `INSERT INTO users (id, email, name, global_role, status, created_at)
VALUES (:id, :email, :name, 'staff', 'invited', :now);`,
  admin_user_delete: `DELETE FROM users WHERE id = :id;`,
  admin_user_set: `UPDATE users SET name = :name, status = :status WHERE id = :id;`,
  admin_users: `SELECT
  u.id, u.email, u.name, u.status, u.created_at, u.last_login_at,
  u.protected,
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
  audit_recent_for_partner: `SELECT a.at, a.action, a.entity, a.entity_id,
       COALESCE(u.name, a.user_id) AS actor
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;`,
  audit_write: `INSERT INTO audit_log (id, at, user_id, partner_id, action, entity, entity_id, detail)
VALUES (:id, :now, :user_id, :partner_id, :action, :entity, :entity_id, :detail);`,
  contact_form_for_partner: `SELECT partner_id, deliver_to, from_address, heading, blurb, button, thanks,
       is_open, updated_at
FROM contact_forms
WHERE partner_id IS :partner_id;`,
  contact_form_save: `INSERT INTO contact_forms
  (partner_id, deliver_to, from_address, heading, blurb, button, thanks,
   is_open, updated_at)
VALUES
  (:partner_id, :deliver_to, :from_address, :heading, :blurb, :button, :thanks,
   :is_open, :now)
ON CONFLICT(partner_id) DO UPDATE SET
  deliver_to   = excluded.deliver_to,
  from_address = excluded.from_address,
  heading      = excluded.heading,
  blurb        = excluded.blurb,
  button       = excluded.button,
  thanks       = excluded.thanks,
  is_open      = excluded.is_open,
  updated_at   = excluded.updated_at;`,
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
  contact_topic_add: `INSERT INTO contact_topics (id, partner_id, label, deliver_to, sort_order, created_at)
VALUES (:id, :partner_id, :label, :deliver_to, :sort_order, :now);`,
  contact_topics_clear: `DELETE FROM contact_topics WHERE partner_id IS :partner_id;`,
  contact_topics_for_partner: `SELECT id, label, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS :partner_id
ORDER BY sort_order, label COLLATE NOCASE;`,
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
  goal_delete: `DELETE FROM goals WHERE id = :id AND partner_id = :partner_id;`,
  goal_history: `SELECT raised_cents, donor_count, captured_at
FROM goal_snapshots
WHERE goal_id = :goal_id AND partner_id = :partner_id
ORDER BY captured_at ASC;`,
  goal_snapshot_insert: `INSERT INTO goal_snapshots (
  id, goal_id, partner_id, raised_cents, donor_count, source, captured_at
) VALUES (
  :id, :goal_id, :partner_id, :raised_cents, :donor_count, 'manual', :now
);`,
  goal_upsert: `INSERT INTO goals (
  id, partner_id, label, description, kind, target_cents, currency,
  is_public, created_at, updated_at
) VALUES (
  :id, :partner_id, :label, :description, :kind, :target_cents, :currency,
  :is_public, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  label = :label, description = :description, kind = :kind,
  target_cents = :target_cents, currency = :currency, is_public = :is_public,
  updated_at = :now
WHERE goals.partner_id = :partner_id;`,
  goals_for_partner: `SELECT
  goal_id, label, description, kind, target_cents, currency,
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
  language_deactivate: `UPDATE languages SET is_active = 0 WHERE code = :code;`,
  language_next_sort_order: `SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM languages;`,
  language_upsert: `INSERT INTO languages (code, name, native_name, sort_order, is_active, created_at)
VALUES (:code, :name, :native_name, :sort_order, 1, :now)
ON CONFLICT(code) DO UPDATE SET
  is_active   = 1,
  name        = excluded.name,
  native_name = excluded.native_name;`,
  languages_all: `SELECT code, name, native_name, is_active, sort_order
FROM languages ORDER BY sort_order, name;`,
  mailing_attachment_add: `INSERT INTO mailing_attachments
  (id, mailing_id, filename, content_type, bytes, object_key, sort_order, created_at)
VALUES (:id, :mailing_id, :filename, :content_type, :bytes, :object_key, :sort_order, :now);`,
  mailing_attachment_clear: `DELETE FROM mailing_attachments WHERE mailing_id = :mailing_id;`,
  mailing_attachments_for: `SELECT id, filename, content_type, bytes, object_key, sort_order
FROM mailing_attachments
WHERE mailing_id = :mailing_id
ORDER BY sort_order, filename COLLATE NOCASE;`,
  mailing_delete: `DELETE FROM mailings
WHERE id = :id AND partner_id IS :partner_id AND status = 'draft';`,
  mailing_finish: `UPDATE mailings
SET status = :status, finished_at = :now, sent_count = :sent_count
WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_list_archive: `UPDATE mailing_lists
SET archived_at = :now, updated_at = :now
WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_list_one: `SELECT id, partner_id, slug, name, description, from_name, from_email,
       reply_to, is_open, archive_public, form_heading, form_blurb, form_button,
       form_thanks_url, archived_at, created_at, updated_at
FROM mailing_lists
WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_list_slug_taken: `SELECT id FROM mailing_lists
WHERE partner_id IS :partner_id AND slug = :slug AND id <> :id;`,
  mailing_list_upsert: `INSERT INTO mailing_lists
  (id, partner_id, slug, name, description, from_name, from_email, reply_to,
   is_open, archive_public, form_heading, form_blurb, form_button, form_thanks_url,
   created_at, updated_at)
VALUES
  (:id, :partner_id, :slug, :name, :description, :from_name, :from_email,
   :reply_to, :is_open, :archive_public, :form_heading, :form_blurb, :form_button,
   :form_thanks_url, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  slug            = excluded.slug,
  name            = excluded.name,
  description     = excluded.description,
  from_name       = excluded.from_name,
  from_email      = excluded.from_email,
  reply_to        = excluded.reply_to,
  is_open         = excluded.is_open,
  archive_public  = excluded.archive_public,
  form_heading    = excluded.form_heading,
  form_blurb      = excluded.form_blurb,
  form_button     = excluded.form_button,
  form_thanks_url = excluded.form_thanks_url,
  updated_at      = excluded.updated_at
WHERE mailing_lists.partner_id IS :partner_id;`,
  mailing_lists_for_partner: `SELECT
  l.id, l.partner_id, l.slug, l.name, l.description,
  l.from_name, l.from_email, l.reply_to, l.is_open, l.archive_public,
  l.form_heading, l.form_blurb, l.form_button, l.form_thanks_url,
  l.created_at, l.updated_at,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'subscribed')  AS subscribed,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'pending')     AS pending,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'unsubscribed') AS unsubscribed
FROM mailing_lists l
WHERE l.partner_id IS :partner_id AND l.archived_at IS NULL
ORDER BY l.name COLLATE NOCASE;`,
  mailing_one: `SELECT id, list_id, partner_id, subject, preheader, body_md, body_html, body_text,
       status, slug, sent_count, created_at, started_at, finished_at
FROM mailings
WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_recipient_add: `INSERT INTO mailing_recipients (mailing_id, subscriber_id, email, status, updated_at)
VALUES (:mailing_id, :subscriber_id, :email, :status, :now)
ON CONFLICT(mailing_id, subscriber_id) DO UPDATE SET
  status = excluded.status, updated_at = excluded.updated_at;`,
  mailing_recipient_result: `UPDATE mailing_recipients
SET status = :status, provider_id = :provider_id, error = :error, updated_at = :now
WHERE mailing_id = :mailing_id AND subscriber_id = :subscriber_id;`,
  mailing_start: `UPDATE mailings
SET status = 'sending', started_at = :now, slug = :slug
WHERE id = :id AND partner_id IS :partner_id AND status = 'draft';`,
  mailing_tag_create: `INSERT INTO mailing_tags (id, partner_id, name, sort_order, created_at)
VALUES (:id, :partner_id, :name, :sort_order, :now);`,
  mailing_tag_delete: `DELETE FROM mailing_tags WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_tag_rename: `UPDATE mailing_tags SET name = :name
WHERE id = :id AND partner_id IS :partner_id;`,
  mailing_tag_usage: `SELECT t.id, COUNT(st.subscriber_id) AS n
FROM mailing_tags t
LEFT JOIN subscriber_tags st ON st.tag_id = t.id
WHERE t.partner_id IS :partner_id
GROUP BY t.id;`,
  mailing_tags_for_partner: `SELECT t.id, t.name, t.sort_order,
       (SELECT COUNT(*) FROM subscriber_tags st WHERE st.tag_id = t.id) AS used
FROM mailing_tags t
WHERE t.partner_id IS :partner_id
ORDER BY t.sort_order, t.name COLLATE NOCASE;`,
  mailing_upsert: `INSERT INTO mailings (id, list_id, partner_id, subject, preheader,
                      body_md, body_html, body_text, status, created_by, created_at)
VALUES (:id, :list_id, :partner_id, :subject, :preheader,
        :body_md, :body_html, :body_text, 'draft', :created_by, :now)
ON CONFLICT(id) DO UPDATE SET
  subject = excluded.subject,
  preheader = excluded.preheader,
  body_md = excluded.body_md,
  body_html = excluded.body_html,
  body_text = excluded.body_text
WHERE mailings.status = 'draft';`,
  mailings_for_list: `SELECT m.id, m.list_id, m.subject, m.preheader, m.status, m.slug,
       m.sent_count, m.created_at, m.started_at, m.finished_at,
       CASE WHEN m.status = 'draft' THEN m.body_html END AS body_html,
       (SELECT COUNT(*) FROM mailing_recipients r
         WHERE r.mailing_id = m.id AND r.status = 'failed') AS failed
FROM mailings m
WHERE m.list_id = :list_id AND m.partner_id IS :partner_id
ORDER BY CASE m.status WHEN 'draft' THEN 0 ELSE 1 END,
         COALESCE(m.finished_at, m.created_at) DESC;`,
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
  partner_set_embed: `UPDATE partners
   SET embed_enabled = :embed_enabled,
       embed_accent  = :embed_accent,
       embed_accent2 = :embed_accent2,
       embed_theme   = :embed_theme,
       updated_at    = :now
 WHERE id = :partner_id;`,
  partner_set_timeline: `UPDATE partners
   SET timeline_start = :timeline_start,
       timeline_end   = :timeline_end,
       updated_at     = :now
 WHERE id = :partner_id;`,
  partner_settings: `SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang,
       p.embed_enabled, p.embed_accent, p.embed_accent2, p.embed_theme,
       p.timeline_start, p.timeline_end
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
  prayer_delete: `DELETE FROM prayer WHERE id = :id AND partner_id = :partner_id;`,
  prayer_for_staff: `SELECT p.id, p.is_public, p.is_answered, p.answered_on, p.sort_order,
       p.created_at, p.updated_at
FROM prayer p
WHERE p.partner_id = :partner_id
ORDER BY p.sort_order ASC, p.created_at DESC;`,
  prayer_translation_delete: `DELETE FROM prayer_translations
WHERE prayer_id = :prayer_id AND lang = :lang AND partner_id = :partner_id;`,
  prayer_translation_upsert: `INSERT INTO prayer_translations (
  prayer_id, lang, partner_id, title, description, answer_text, updated_at
) VALUES (
  :prayer_id, :lang, :partner_id, :title, :description, :answer_text, :now
)
ON CONFLICT(prayer_id, lang) DO UPDATE SET
  title = :title, description = :description, answer_text = :answer_text,
  updated_at = :now
WHERE prayer_translations.partner_id = :partner_id;`,
  prayer_translations_for_staff: `SELECT t.prayer_id, t.lang, t.title, t.description, t.answer_text
FROM prayer_translations t
WHERE t.partner_id = :partner_id;`,
  prayer_upsert: `INSERT INTO prayer (
  id, partner_id, is_public, is_answered, answered_on, sort_order,
  created_at, updated_at
) VALUES (
  :id, :partner_id, :is_public, :is_answered, :answered_on, :sort_order,
  :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  is_public = :is_public, is_answered = :is_answered,
  answered_on = :answered_on, sort_order = :sort_order, updated_at = :now
WHERE prayer.partner_id = :partner_id;`,
  public_archive_for_list: `SELECT m.slug, m.subject, m.preheader, m.finished_at
FROM mailings m
JOIN mailing_lists l ON l.id = m.list_id
JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
WHERE l.slug = :list_slug AND l.archive_public = 1 AND l.archived_at IS NULL
  AND m.status = 'sent' AND m.slug IS NOT NULL
ORDER BY m.finished_at DESC
LIMIT 50;`,
  public_archive_one: `SELECT m.subject, m.preheader, m.body_html, m.finished_at,
       l.name AS list_name, l.from_name,
       p.display_name, p.embed_accent, p.embed_theme
FROM mailings m
JOIN mailing_lists l ON l.id = m.list_id
JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
WHERE l.slug = :list_slug AND l.archive_public = 1 AND l.archived_at IS NULL
  AND m.status = 'sent' AND m.slug = :slug;`,
  public_contact_form: `SELECT c.deliver_to, c.from_address, c.heading, c.blurb, c.button, c.thanks,
       p.display_name, p.embed_accent, p.embed_accent2, p.embed_theme
FROM contact_forms c
JOIN partners p ON p.slug = :partner_slug AND c.partner_id IS p.id
WHERE c.is_open = 1;`,
  public_contact_form_org: `SELECT deliver_to, from_address, heading, blurb, button, thanks
FROM contact_forms
WHERE partner_id IS NULL AND is_open = 1;`,
  public_contact_topics: `SELECT t.id, t.label, t.deliver_to, t.sort_order
FROM contact_topics t
JOIN partners p ON p.slug = :partner_slug AND t.partner_id IS p.id
ORDER BY t.sort_order, t.label COLLATE NOCASE;`,
  public_contact_topics_org: `SELECT id, label, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS NULL
ORDER BY sort_order, label COLLATE NOCASE;`,
  public_goals_for_partner: `SELECT
  goal_id, label, description, kind, target_cents, currency,
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
  public_lists_for_signup: `SELECT l.id, l.partner_id, l.name, l.slug, l.description,
       l.from_name, l.from_email, l.reply_to,
       l.form_heading, l.form_blurb, l.form_button, l.form_thanks_url,
       p.embed_accent, p.embed_accent2, p.embed_theme
  FROM mailing_lists l
  JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
 WHERE l.is_open = 1 AND l.archived_at IS NULL
 ORDER BY l.name COLLATE NOCASE;`,
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
  public_partner_for_embed: `SELECT id, slug, display_name, embed_accent, embed_accent2, embed_theme,
       timeline_start, timeline_end
FROM partners
WHERE slug = :slug
  AND embed_enabled = 1
  AND is_public = 1;`,
  public_prayer_for_partner: `SELECT id, is_answered, answered_on, sort_order
FROM prayer
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY is_answered ASC, sort_order ASC;`,
  public_prayer_translations: `SELECT t.prayer_id, t.lang, t.title, t.description, t.answer_text
FROM prayer_translations t
JOIN prayer p ON p.id = t.prayer_id
WHERE t.partner_id = :partner_id
  AND p.is_public = 1;`,
  public_video_links_for_partner: `SELECT l.label, l.url
  FROM video_links l
  JOIN video_sources c ON c.partner_id IS l.partner_id
 WHERE l.partner_id IS :partner_id AND c.is_public = 1
 ORDER BY l.sort_order, l.label COLLATE NOCASE;`,
  public_videos_for_partner: `SELECT v.video_id, v.title, v.published_at
  FROM videos v
  JOIN video_sources c ON c.source_id = v.source_id
 WHERE c.partner_id IS :partner_id AND c.is_public = 1
 ORDER BY v.published_at DESC
 LIMIT COALESCE(
   (SELECT max_items FROM video_sources WHERE partner_id IS :partner_id), 0);`,
  resource_can_see: `SELECT 1 AS ok
  FROM resources r
 WHERE r.id = :id
   AND (r.owner_user_id = :user_id
        OR r.owner_user_id IS NULL
        OR EXISTS (SELECT 1 FROM resource_shares sh
                    WHERE sh.resource_id = r.id AND sh.user_id = :user_id));`,
  resource_delete: `DELETE FROM resources WHERE id = :id AND partner_id IS :partner_id;`,
  resource_owner: `SELECT id, owner_user_id, partner_id FROM resources WHERE id = :id;`,
  resource_share_add: `INSERT OR IGNORE INTO resource_shares (resource_id, user_id, shared_by, shared_at)
VALUES (:resource_id, :user_id, :shared_by, :now);`,
  resource_share_remove: `DELETE FROM resource_shares WHERE resource_id = :resource_id AND user_id = :user_id;`,
  resource_shared_with: `SELECT sh.user_id, u.name, u.email, sh.shared_at,
       (SELECT b.name FROM users b WHERE b.id = sh.shared_by) AS shared_by_name
  FROM resource_shares sh
  JOIN users u ON u.id = sh.user_id
 WHERE sh.resource_id = :resource_id
 ORDER BY u.name COLLATE NOCASE;`,
  resource_upsert: `INSERT INTO resources
  (id, partner_id, owner_user_id, title, description, link, photo, visibility,
   created_by, created_at, updated_at)
VALUES
  (:id, :partner_id, :owner_user_id, :title, :description, :link, :photo, :visibility,
   :created_by, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  title = :title, description = :description, link = :link, photo = :photo,
  visibility = :visibility, updated_at = :now
WHERE resources.owner_user_id IS :owner_user_id
  AND resources.partner_id IS :partner_id;`,
  resources_visible: `SELECT r.id, r.partner_id, r.title, r.description, r.link, r.photo, r.visibility,
       r.owner_user_id, r.created_at, r.updated_at,
       'institutional' AS shelf,
       CASE WHEN :is_admin = 1 THEN 1 ELSE 0 END AS can_edit,
       NULL AS shared_by_name
  FROM resources r
 WHERE r.owner_user_id IS NULL
   AND (r.partner_id = :partner_id OR r.partner_id IS NULL)
   AND instr(',' || :levels || ',', ',' || r.visibility || ',') > 0

UNION ALL

SELECT r.id, r.partner_id, r.title, r.description, r.link, r.photo, r.visibility,
       r.owner_user_id, r.created_at, r.updated_at,
       'mine' AS shelf, 1 AS can_edit, NULL AS shared_by_name
  FROM resources r
 WHERE r.owner_user_id = :user_id

UNION ALL

SELECT r.id, r.partner_id, r.title, r.description, r.link, r.photo, r.visibility,
       r.owner_user_id, r.created_at, r.updated_at,
       'shared' AS shelf, 0 AS can_edit,
       (SELECT u.name FROM users u WHERE u.id = sh.shared_by) AS shared_by_name
  FROM resource_shares sh
  JOIN resources r ON r.id = sh.resource_id
 WHERE sh.user_id = :user_id

ORDER BY shelf, title COLLATE NOCASE;`,
  sender_addresses_for_partner: `SELECT id, partner_id, address, label, can_receive, created_at
FROM sender_addresses
WHERE partner_id IS :partner_id
ORDER BY label COLLATE NOCASE, address COLLATE NOCASE;`,
  signup_attempt_record: `INSERT OR REPLACE INTO signup_attempts (ip_hash, list_id, at, outcome)
VALUES (:ip_hash, :list_id, :at, :outcome);`,
  signup_attempts_prune: `DELETE FROM signup_attempts WHERE at < :before;`,
  signup_attempts_recent: `SELECT COUNT(*) AS n FROM signup_attempts
 WHERE ip_hash = :ip_hash AND at > :since;`,
  staff_profile_delete: `DELETE FROM staff_profiles WHERE user_id = :user_id;`,
  staff_profile_slug_taken: `SELECT user_id FROM staff_profiles WHERE slug = :slug AND user_id <> :user_id;`,
  staff_profile_translation_delete: `DELETE FROM staff_profile_translations WHERE user_id = :user_id AND lang = :lang;`,
  staff_profile_translation_upsert: `INSERT INTO staff_profile_translations (user_id, lang, role_title, bio, updated_at)
VALUES (:user_id, :lang, :role_title, :bio, :now)
ON CONFLICT(user_id, lang) DO UPDATE SET
  role_title = excluded.role_title,
  bio        = excluded.bio,
  updated_at = excluded.updated_at;`,
  staff_profile_upsert: `INSERT INTO staff_profiles
  (user_id, is_public, slug, region, public_email, photo, bio_photo,
   sort_order, created_at, updated_at)
VALUES
  (:user_id, :is_public, :slug, :region, :public_email, :photo, :bio_photo,
   :sort_order, :now, :now)
ON CONFLICT(user_id) DO UPDATE SET
  is_public    = excluded.is_public,
  slug         = excluded.slug,
  region       = excluded.region,
  public_email = excluded.public_email,
  photo        = excluded.photo,
  bio_photo    = excluded.bio_photo,
  sort_order   = excluded.sort_order,
  updated_at   = excluded.updated_at;`,
  staff_profiles_all: `SELECT
  u.id AS user_id, u.name, u.email, u.status,
  sp.is_public, sp.slug, sp.region, sp.public_email,
  sp.photo, sp.bio_photo, sp.sort_order, sp.updated_at,
  (SELECT GROUP_CONCAT(t.lang || CHAR(31) || COALESCE(t.role_title, '') ||
                       CHAR(31) || COALESCE(t.bio, ''), CHAR(30))
     FROM staff_profile_translations t WHERE t.user_id = u.id) AS translations
FROM users u
LEFT JOIN staff_profiles sp ON sp.user_id = u.id
ORDER BY u.name COLLATE NOCASE;`,
  staff_profiles_public: `SELECT
  u.id AS user_id, u.name, u.email,
  sp.slug, sp.region, sp.public_email, sp.photo, sp.bio_photo, sp.sort_order
FROM staff_profiles sp
JOIN users u ON u.id = sp.user_id
WHERE sp.is_public = 1
ORDER BY sp.sort_order, u.name COLLATE NOCASE;`,
  subscriber_add: `INSERT INTO subscribers
  (id, list_id, partner_id, email, name, status, confirm_token, source, lang,
   subscribed_at, updated_at)
SELECT :id, l.id, l.partner_id, :email, :name, 'pending', :token, :source, :lang,
       :now, :now
  FROM mailing_lists l
 WHERE l.id = :list_id AND l.partner_id IS :partner_id;`,
  subscriber_by_id_public: `SELECT id, list_id, partner_id, email, status, lang FROM subscribers WHERE id = :id;`,
  subscriber_by_token: `SELECT s.id, s.email, s.name, s.status, s.list_id,
       l.name AS list_name, l.slug AS list_slug
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE s.confirm_token = :token AND s.status = 'pending'
 ORDER BY l.name COLLATE NOCASE;`,
  subscriber_change_email: `UPDATE subscribers
SET email = :email,
    status = 'pending',
    confirm_token = :token,
    confirmed_at = NULL,
    updated_at = :now
WHERE id = :id;`,
  subscriber_confirm: `UPDATE subscribers
SET status = 'subscribed', confirmed_at = :now, confirm_token = NULL, updated_at = :now
WHERE confirm_token = :token AND status = 'pending';`,
  subscriber_delete: `DELETE FROM subscribers
WHERE id = :id
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);`,
  subscriber_existing_for_signup: `SELECT id, status FROM subscribers WHERE list_id = :list_id AND email = :email;`,
  subscriber_one: `SELECT s.id, s.email, s.name, s.status, s.confirm_token, s.list_id,
       l.name AS list_name, l.from_name, l.from_email, l.reply_to
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE s.id = :id AND l.partner_id IS :partner_id;`,
  subscriber_reopen_pending: `UPDATE subscribers
SET status = 'pending',
    confirm_token = :token,
    name = COALESCE(:name, name),
    subscribed_at = :now,
    unsubscribed_at = NULL,
    confirmed_at = NULL,
    updated_at = :now
WHERE list_id = :list_id AND email = :email
  AND status IN ('unsubscribed', 'bounced');`,
  subscriber_resend_confirm: `UPDATE subscribers
SET confirm_token = :token, subscribed_at = :now, updated_at = :now
WHERE id = :id AND status = 'pending'
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);`,
  subscriber_resend_token: `UPDATE subscribers
SET confirm_token = :token, subscribed_at = :now, updated_at = :now, name = COALESCE(:name, name)
WHERE list_id = :list_id AND email = :email AND status = 'pending';`,
  subscriber_resubscribe_by_id: `UPDATE subscribers
   SET status = 'subscribed', unsubscribed_at = NULL
 WHERE id = :id AND status = 'unsubscribed';`,
  subscriber_set_name: `UPDATE subscribers SET name = :name, updated_at = :now WHERE id = :id;`,
  subscriber_set_status: `UPDATE subscribers
SET status = :status,
    unsubscribed_at = CASE WHEN :status = 'unsubscribed' THEN :now ELSE unsubscribed_at END,
    updated_at = :now
WHERE id = :id
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);`,
  subscriber_tag_add: `INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id)
SELECT :subscriber_id, t.id
  FROM mailing_tags t
  JOIN subscribers s ON s.id = :subscriber_id
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE t.id = :tag_id
   AND t.partner_id IS l.partner_id;`,
  subscriber_tags_clear: `DELETE FROM subscriber_tags WHERE subscriber_id = :subscriber_id;`,
  subscriber_tags_for: `SELECT t.id, t.name
FROM subscriber_tags st
JOIN mailing_tags t ON t.id = st.tag_id
JOIN subscribers s ON s.id = st.subscriber_id
JOIN mailing_lists l ON l.id = s.list_id
WHERE st.subscriber_id = :subscriber_id AND l.partner_id IS :partner_id
ORDER BY t.sort_order, t.name COLLATE NOCASE;`,
  subscriber_unsubscribe_by_id: `UPDATE subscribers
SET status = 'unsubscribed', unsubscribed_at = :now, updated_at = :now
WHERE id = :id;`,
  subscribers_bulk_delete: `DELETE FROM subscribers
WHERE id IN (SELECT s.id FROM subscribers s
               JOIN mailing_lists l ON l.id = s.list_id
              WHERE l.partner_id IS :partner_id AND s.id IN (IDS));`,
  subscribers_bulk_status: `UPDATE subscribers
SET status = :status,
    unsubscribed_at = CASE WHEN :status = 'unsubscribed' THEN :now ELSE unsubscribed_at END,
    updated_at = :now
WHERE id IN (SELECT s.id FROM subscribers s
               JOIN mailing_lists l ON l.id = s.list_id
              WHERE l.partner_id IS :partner_id AND s.id IN (IDS));`,
  subscribers_bulk_tag_add: `INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id)
SELECT s.id, t.id
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
  JOIN mailing_tags t ON t.id = :tag_id AND t.partner_id IS l.partner_id
 WHERE l.partner_id IS :partner_id AND s.id IN (IDS);`,
  subscribers_bulk_tag_remove: `DELETE FROM subscriber_tags
WHERE tag_id = :tag_id
  AND subscriber_id IN (SELECT s.id FROM subscribers s
                          JOIN mailing_lists l ON l.id = s.list_id
                         WHERE l.partner_id IS :partner_id AND s.id IN (IDS));`,
  subscribers_for_list: `SELECT
  s.id, s.email, s.name, s.status, s.source,
  s.subscribed_at, s.confirmed_at, s.unsubscribed_at,
  (SELECT GROUP_CONCAT(t.name, ', ')
     FROM subscriber_tags st JOIN mailing_tags t ON t.id = st.tag_id
    WHERE st.subscriber_id = s.id) AS tags
FROM subscribers s
JOIN mailing_lists l ON l.id = s.list_id
WHERE s.list_id = :list_id AND l.partner_id IS :partner_id
  AND (:status = '' OR s.status = :status)
  AND (:q = '' OR s.email LIKE :like ESCAPE '\\'
               OR COALESCE(s.name, '') LIKE :like ESCAPE '\\')
  AND (:tag = '' OR EXISTS (SELECT 1 FROM subscriber_tags st2
                             WHERE st2.subscriber_id = s.id AND st2.tag_id = :tag))
ORDER BY
  CASE WHEN :sort = 'email'  THEN s.email END COLLATE NOCASE ASC,
  CASE WHEN :sort = 'name'   THEN COALESCE(NULLIF(s.name, ''), s.email) END COLLATE NOCASE ASC,
  CASE WHEN :sort = 'oldest' THEN s.subscribed_at END ASC,
  CASE WHEN :sort = 'status' THEN s.status END ASC,
  s.subscribed_at DESC
LIMIT :limit OFFSET :offset;`,
  subscribers_for_list_count: `SELECT COUNT(*) AS n
FROM subscribers s
JOIN mailing_lists l ON l.id = s.list_id
WHERE s.list_id = :list_id AND l.partner_id IS :partner_id
  AND (:status = '' OR s.status = :status)
  AND (:q = '' OR s.email LIKE :like ESCAPE '\\'
               OR COALESCE(s.name, '') LIKE :like ESCAPE '\\')
  AND (:tag = '' OR EXISTS (SELECT 1 FROM subscriber_tags st2
                             WHERE st2.subscriber_id = s.id AND st2.tag_id = :tag));`,
  subscribers_to_send: `SELECT s.id, s.email, s.name
FROM subscribers s
WHERE s.list_id = :list_id AND s.partner_id IS :partner_id
  AND s.status = 'subscribed'
ORDER BY s.subscribed_at
LIMIT :limit OFFSET :offset;`,
  subscribers_to_send_count: `SELECT COUNT(*) AS n FROM subscribers
WHERE list_id = :list_id AND partner_id IS :partner_id AND status = 'subscribed';`,
  user_by_email: `SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.email = :email AND u.status = 'active';`,
  user_by_id: `SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.id = :id AND u.status = 'active';`,
  user_confirm: `UPDATE users
   SET status = 'active'
 WHERE id = :id AND status = 'invited';`,
  user_email_taken: `SELECT id FROM users WHERE email = :email AND id <> :id;`,
  user_for_confirm: `SELECT id, email, name, status FROM users WHERE id = :id;`,
  user_set_email: `UPDATE users SET email = :email WHERE id = :id;`,
  user_set_preferred_lang: `UPDATE users SET preferred_lang = :lang WHERE email = :email AND status = 'active';`,
  video_link_add: `INSERT INTO video_links (id, partner_id, label, url, sort_order, created_at)
VALUES (:id, :partner_id, :label, :url, :sort_order, :now);`,
  video_links_clear: `DELETE FROM video_links WHERE partner_id IS :partner_id;`,
  video_links_for_partner: `SELECT id, label, url, sort_order
  FROM video_links
 WHERE partner_id IS :partner_id
 ORDER BY sort_order, label COLLATE NOCASE;`,
  video_source_clear: `DELETE FROM video_sources WHERE partner_id IS :partner_id;`,
  video_source_failed: `UPDATE video_sources
   SET synced_at = :now, sync_error = :error
 WHERE partner_id IS :partner_id;`,
  video_source_get: `SELECT partner_id, source_id, source_kind, source_title, is_public, max_items,
       synced_at, sync_error, updated_at
  FROM video_sources
 WHERE partner_id IS :partner_id;`,
  video_source_save: `INSERT INTO video_sources
  (partner_id, source_id, source_kind, source_title, is_public, max_items, updated_at)
VALUES
  (:partner_id, :source_id, :source_kind, :source_title, :is_public, :max_items, :now)
ON CONFLICT(partner_id) DO UPDATE SET
  source_id    = excluded.source_id,
  source_kind  = excluded.source_kind,
  source_title = excluded.source_title,
  is_public    = excluded.is_public,
  max_items    = excluded.max_items,
  synced_at    = CASE WHEN video_sources.source_id = excluded.source_id
                      THEN video_sources.synced_at ELSE NULL END,
  sync_error   = CASE WHEN video_sources.source_id = excluded.source_id
                      THEN video_sources.sync_error ELSE NULL END,
  updated_at   = excluded.updated_at;`,
  video_source_synced: `UPDATE video_sources
   SET synced_at = :now, sync_error = NULL
 WHERE partner_id IS :partner_id;`,
  video_sources_all: `SELECT partner_id, source_id, source_kind
  FROM video_sources
 WHERE is_public = 1 AND source_id <> ''
 ORDER BY partner_id;`,
  video_upsert: `INSERT INTO videos (source_id, video_id, title, published_at, fetched_at)
VALUES (:source_id, :video_id, :title, :published_at, :now)
ON CONFLICT(source_id, video_id) DO UPDATE SET
  title        = excluded.title,
  published_at = excluded.published_at,
  fetched_at   = excluded.fetched_at;`,
  videos_for_source: `SELECT video_id, title, published_at
  FROM videos
 WHERE source_id = :source_id
 ORDER BY published_at DESC
 LIMIT :limit;`,
  videos_prune: `DELETE FROM videos WHERE source_id = :source_id AND fetched_at < :now;`
};
