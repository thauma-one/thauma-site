// GENERATED FILE — DO NOT EDIT.
// Source: db/queries.sql
// Regenerate: python3 db/generate_queries_module.py
//
// Workers cannot read files at runtime, so the SQL is bundled here.
// db/queries.sql remains the single source of truth; workers/test/db.test.mjs
// asserts this file is in sync with it, so a stale copy fails the tests
// rather than silently shipping old SQL.

/** sha256 of db/queries.sql at generation time, first 16 hex chars. */
export const SOURCE_DIGEST = "081c0596535d523c";

export const QUERIES = {
  admin_audit_recent: `SELECT a.at, a.action, a.entity, a.entity_id, a.detail,
       a.partner_id, COALESCE(u.name, a.user_id) AS actor,
       t.name AS target_name, p.display_name AS partner_name
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id OR u.id = a.user_id
LEFT JOIN users t
  ON a.entity IN ('user', 'user_role', 'partner_access', 'acting', 'staff_profile') AND t.id = a.entity_id
LEFT JOIN partners p ON p.id = a.partner_id
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
  admin_partner_grant: `INSERT INTO partner_users (partner_id, user_id, role, granted_by, granted_at)
VALUES (:partner_id, :user_id, :role, :granted_by, :now)
ON CONFLICT (partner_id, user_id) DO UPDATE
   SET role = excluded.role,
       granted_by = excluded.granted_by,
       granted_at = excluded.granted_at;`,
  admin_partner_members: `SELECT pu.partner_id, pu.user_id, pu.role, pu.granted_at,
       u.name AS user_name, u.email, u.status
FROM partner_users pu
JOIN users u ON u.id = pu.user_id
ORDER BY u.name COLLATE NOCASE;`,
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
  ai_usage_reserve: `INSERT INTO ai_usage (day, neurons, calls)
SELECT :day, :est, 1 WHERE :est <= :cap
ON CONFLICT(day) DO UPDATE SET neurons = neurons + excluded.neurons, calls = calls + 1
  WHERE ai_usage.neurons + excluded.neurons <= :cap
RETURNING neurons;`,
  ai_usage_settle: `UPDATE ai_usage SET neurons = MAX(0, neurons - :est + :actual) WHERE day = :day;`,
  ai_usage_today: `SELECT neurons, calls FROM ai_usage WHERE day = :day;`,
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
  api_key_set_scopes: `UPDATE api_keys SET scopes = :scopes
WHERE id = :id AND partner_id = :partner_id AND revoked_at IS NULL;`,
  api_key_touch: `UPDATE api_keys SET last_used_at = :now WHERE id = :key_id;`,
  api_keys_for_partner: `SELECT k.id, k.name, k.scopes, k.created_at, k.last_used_at, k.revoked_at,
       u.name AS created_by_name
FROM api_keys k
LEFT JOIN users u ON u.id = k.created_by
WHERE k.partner_id = :partner_id
ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC;`,
  audit_recent_for_partner: `SELECT a.at, a.action, a.entity, a.entity_id, a.detail,
       COALESCE(u.name, a.user_id) AS actor,
       TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')) AS contact_name,
       t.name AS target_name
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id OR u.id = a.user_id
LEFT JOIN contacts c
  ON c.partner_id = a.partner_id
 AND c.id = CASE WHEN a.entity = 'contact' THEN a.entity_id
                 WHEN json_valid(a.detail) THEN json_extract(a.detail, '$.contact_id') END
LEFT JOIN users t
  ON a.entity IN ('user', 'user_role', 'partner_access', 'acting', 'staff_profile') AND t.id = a.entity_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;`,
  audit_write: `INSERT INTO audit_log (id, at, user_id, partner_id, action, entity, entity_id, detail)
VALUES (:id, :now, :user_id, :partner_id, :action, :entity, :entity_id, :detail);`,
  contact_delete: `DELETE FROM contacts WHERE id = :id AND partner_id = :partner_id;`,
  contact_detail: `SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.address_1,
  c.address_2,
  c.city,
  c.region,
  c.postal_code,
  c.country,
  c.giving_ref,
  c.notes,
  c.created_at,
  t.last_contact_any,
  t.last_personal_contact,
  t.interaction_count,
  t.personal_count
FROM contacts c
JOIN contact_touch t ON t.contact_id = c.id
WHERE c.id = :contact_id
  AND c.partner_id = :partner_id
  AND c.status = 'active';`,
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
  contact_form_save_org: `INSERT INTO contact_forms
  (partner_id, deliver_to, from_address, heading, blurb, button, thanks,
   is_open, updated_at)
VALUES
  (NULL, :deliver_to, :from_address, :heading, :blurb, :button, :thanks,
   :is_open, :now)
ON CONFLICT ((partner_id IS NULL)) WHERE partner_id IS NULL DO UPDATE SET
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
  contact_topic_add: `INSERT INTO contact_topics (id, partner_id, label, labels, deliver_to, sort_order, created_at)
VALUES (:id, :partner_id, :label, :labels, :deliver_to, :sort_order, :now);`,
  contact_topics_clear: `DELETE FROM contact_topics WHERE partner_id IS :partner_id;`,
  contact_topics_for_partner: `SELECT id, label, labels, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS :partner_id
ORDER BY sort_order, label COLLATE NOCASE;`,
  contact_upsert: `INSERT INTO contacts (
  id, partner_id, first_name, last_name, email, phone,
  address_1, address_2, city, region, postal_code, country,
  notes, status, created_at, updated_at
) VALUES (
  :id, :partner_id, :first_name, :last_name, :email, :phone,
  :address_1, :address_2, :city, :region, :postal_code, :country,
  :notes, 'active', :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  first_name = :first_name, last_name = :last_name, email = :email,
  phone = :phone, address_1 = :address_1, address_2 = :address_2,
  city = :city, region = :region, postal_code = :postal_code,
  country = :country, notes = :notes, updated_at = :now
WHERE contacts.partner_id = :partner_id;`,
  contacts_stewardship: `SELECT
  c.id,
  c.first_name,
  c.last_name,
  c.city,
  c.country,
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
  (SELECT COUNT(*) FROM interactions
     WHERE partner_id = :partner_id AND is_personal = 1
       AND occurred_on >= date(:today, '-30 days'))                              AS personal_last_30,
  (SELECT COUNT(*) FROM goals
     WHERE partner_id = :partner_id)                                             AS goals_total;`,
  directory_delete: `DELETE FROM directory_contacts
WHERE id = :id AND partner_id = :partner_id;`,
  directory_for_partner: `SELECT d.id, d.name, d.role, d.emails, d.phones, d.created_at, d.updated_at,
       u.name AS added_by
FROM directory_contacts d
LEFT JOIN users u ON u.id = d.user_id
WHERE d.partner_id = :partner_id
ORDER BY d.name COLLATE NOCASE;`,
  directory_upsert: `INSERT INTO directory_contacts
  (id, user_id, partner_id, name, role, emails, phones, created_at, updated_at)
VALUES
  (:id, :user_id, :partner_id, :name, :role, :emails, :phones, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  name = :name, role = :role, emails = :emails, phones = :phones,
  updated_at = :now
WHERE directory_contacts.partner_id = :partner_id;`,
  embed_look_clear: `DELETE FROM embed_looks WHERE partner_id = :partner_id AND kind = :kind;`,
  embed_look_set: `INSERT INTO embed_looks (partner_id, kind, accent, accent2, turn, theme, updated_at)
VALUES (:partner_id, :kind, :accent, :accent2, :turn, :theme, :now)
ON CONFLICT (partner_id, kind) DO UPDATE SET
  accent     = excluded.accent,
  accent2    = excluded.accent2,
  turn       = excluded.turn,
  theme      = excluded.theme,
  updated_at = excluded.updated_at;`,
  embed_looks_for_partner: `SELECT kind, accent, accent2, turn, theme
  FROM embed_looks
 WHERE partner_id = :partner_id
 ORDER BY kind;`,
  form_word_insert: `INSERT INTO form_words (partner_id, form, lang, heading, blurb, button, thanks, updated_at)
VALUES (:partner_id, :form, :lang, :heading, :blurb, :button, :thanks, :now);`,
  form_words_clear: `DELETE FROM form_words WHERE partner_id IS :partner_id AND form = :form;`,
  form_words_for_owner: `SELECT form, lang, heading, blurb, button, thanks
  FROM form_words
 WHERE partner_id IS :partner_id
 ORDER BY form, lang;`,
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
  goal_stamps: `SELECT id, updated_at FROM goals WHERE partner_id = :partner_id;`,
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
  interaction_add: `INSERT INTO interactions (
  id, contact_id, partner_id, type, is_personal, channel,
  occurred_on, note, logged_by, source, created_at
) VALUES (
  :id, :contact_id, :partner_id, :type, :is_personal, :channel,
  :occurred_on, :note, :logged_by, 'manual', :now
);`,
  interaction_delete: `DELETE FROM interactions
 WHERE id = :id AND contact_id = :contact_id AND partner_id = :partner_id
   AND source = 'manual';`,
  interaction_update: `UPDATE interactions
   SET type = :type, is_personal = :is_personal, channel = :channel,
       occurred_on = :occurred_on, note = :note
 WHERE id = :id AND contact_id = :contact_id AND partner_id = :partner_id
   AND source = 'manual';`,
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
  life_event_delete: `DELETE FROM life_events WHERE id = :id AND partner_id = :partner_id;`,
  life_event_upsert: `INSERT INTO life_events (
  id, contact_id, partner_id, kind, occurred_on, note, recurs,
  logged_by, created_at, updated_at
) VALUES (
  :id, :contact_id, :partner_id, :kind, :occurred_on, :note, :recurs,
  :logged_by, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  kind = :kind, occurred_on = :occurred_on, note = :note,
  recurs = :recurs, updated_at = :now
WHERE life_events.partner_id = :partner_id;`,
  life_events_for_contact: `SELECT
  e.id,
  e.kind,
  e.occurred_on,
  e.note,
  e.recurs,
  e.created_at,
  e.updated_at,
  u.name AS logged_by_name
FROM life_events e
LEFT JOIN users u ON u.id = e.logged_by
WHERE e.contact_id = :contact_id
  AND e.partner_id = :partner_id
ORDER BY (e.occurred_on IS NULL) DESC, e.occurred_on DESC, e.created_at DESC;`,
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
    WHERE s.list_id = l.id AND s.status = 'unsubscribed') AS unsubscribed,
  (SELECT COUNT(*) FROM mailings m
    WHERE m.list_id = l.id AND m.status = 'draft')       AS drafts
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
  mailings_sent_for_list: `SELECT m.id, m.slug, m.subject, m.status, m.finished_at, m.sent_count
  FROM mailings m
  JOIN mailing_lists l ON l.id = m.list_id
 WHERE m.list_id = :list_id AND l.partner_id IS :partner_id
   AND m.status = 'sent'
 ORDER BY m.finished_at DESC
 LIMIT 100;`,
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
  id, partner_id, parent_id, actual_date, end_date, date_precision, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
) VALUES (
  :id, :partner_id, :parent_id, :actual_date, :end_date, :date_precision, :status, :completion,
  :is_public, :is_featured, :sort_order, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  parent_id = :parent_id, actual_date = :actual_date, end_date = :end_date,
  date_precision = :date_precision, status = :status,
  completion = :completion, is_public = :is_public, is_featured = :is_featured,
  sort_order = :sort_order, updated_at = :now
WHERE milestones.partner_id = :partner_id;`,
  milestones_for_staff: `SELECT
  id, parent_id, actual_date, end_date, date_precision, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
FROM milestones
WHERE partner_id = :partner_id
ORDER BY (actual_date IS NULL), actual_date ASC, sort_order ASC;`,
  partner_for_site: `SELECT id, slug, display_name, giving_url, embed_accent, embed_accent2, embed_theme, embed_turn,
       timeline_start, timeline_end,
       embed_roadmap, embed_goal, embed_prayer, embed_videos
  FROM partners
 WHERE id = :partner_id;`,
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
       embed_roadmap = :embed_roadmap,
       embed_goal    = :embed_goal,
       embed_prayer  = :embed_prayer,
       embed_videos  = :embed_videos,
       embed_accent  = :embed_accent,
       embed_accent2 = :embed_accent2,
       embed_turn    = :embed_turn,
       embed_theme   = :embed_theme,
       updated_at    = :now
 WHERE id = :partner_id;`,
  partner_set_signup_form: `UPDATE partners SET signup_form_open = :open, updated_at = :now WHERE id = :partner_id;`,
  partner_set_timeline: `UPDATE partners
   SET timeline_start = :timeline_start,
       timeline_end   = :timeline_end,
       updated_at     = :now
 WHERE id = :partner_id;`,
  partner_settings: `SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang,
       p.embed_enabled, p.embed_accent, p.embed_accent2, p.embed_theme, p.embed_turn,
       p.embed_roadmap, p.embed_goal, p.embed_prayer, p.embed_videos,
       p.signup_form_open,
       p.timeline_start, p.timeline_end
FROM partners p WHERE p.id = :partner_id;`,
  partner_site_alias_add: `INSERT OR REPLACE INTO partner_site_aliases (subdomain, partner_id, created_at)
VALUES (:subdomain, :partner_id, :now);`,
  partner_site_alias_remove: `DELETE FROM partner_site_aliases WHERE subdomain = :subdomain;`,
  partner_site_aliases_clear: `DELETE FROM partner_site_aliases WHERE partner_id = :partner_id;`,
  partner_site_aliases_for: `SELECT subdomain FROM partner_site_aliases WHERE partner_id = :partner_id ORDER BY created_at;`,
  partner_site_all: `SELECT partner_id, subdomain, enabled, published_at, dns_state, archived_at,
       (SELECT GROUP_CONCAT(a.subdomain, ',') FROM partner_site_aliases a
         WHERE a.partner_id = partner_sites.partner_id) AS aliases
  FROM partner_sites;`,
  partner_site_archive: `UPDATE partner_sites SET enabled = 0, archived_at = :now, dns_state = NULL, updated_at = :now
 WHERE partner_id = :partner_id;`,
  partner_site_by_alias: `SELECT s.subdomain, s.enabled
  FROM partner_site_aliases a JOIN partner_sites s ON s.partner_id = a.partner_id
 WHERE a.subdomain = :subdomain;`,
  partner_site_by_subdomain: `SELECT s.partner_id, s.subdomain, s.enabled, s.published,
       p.slug, p.display_name, p.giving_url, p.status
  FROM partner_sites s
  JOIN partners p ON p.id = s.partner_id
 WHERE s.subdomain = :subdomain;`,
  partner_site_create: `INSERT OR IGNORE INTO partner_sites (partner_id, subdomain, enabled, draft, created_at, updated_at)
VALUES (:partner_id, :subdomain, 0, :draft, :now, :now);`,
  partner_site_delete: `DELETE FROM partner_sites WHERE partner_id = :partner_id;`,
  partner_site_discard: `UPDATE partner_sites SET draft = published, updated_at = :now
 WHERE partner_id = :partner_id AND published IS NOT NULL;`,
  partner_site_editor_add: `INSERT OR IGNORE INTO partner_site_editors (partner_id, user_id, granted_by, granted_at)
VALUES (:partner_id, :user_id, :granted_by, :now);`,
  partner_site_editor_remove: `DELETE FROM partner_site_editors WHERE partner_id = :partner_id AND user_id = :user_id;`,
  partner_site_editors_clear: `DELETE FROM partner_site_editors WHERE partner_id = :partner_id;`,
  partner_site_editors_for: `SELECT e.user_id, u.name, u.email, e.granted_at
  FROM partner_site_editors e JOIN users u ON u.id = e.user_id
 WHERE e.partner_id = :partner_id
 ORDER BY u.name COLLATE NOCASE;`,
  partner_site_get: `SELECT partner_id, subdomain, enabled, draft, published, published_at, dns_state, archived_at,
       (SELECT u.name FROM users u WHERE u.id = partner_sites.published_by) AS published_by_name,
       updated_at
  FROM partner_sites
 WHERE partner_id = :partner_id;`,
  partner_site_is_editor: `SELECT 1 AS ok FROM partner_site_editors WHERE partner_id = :partner_id AND user_id = :user_id;`,
  partner_site_needing_dns: `SELECT partner_id, subdomain FROM partner_sites
 WHERE enabled = 1 AND archived_at IS NULL
   AND (dns_state IS NULL OR dns_state <> 'ready');`,
  partner_site_owner: `SELECT pu.user_id, u.name, u.email
  FROM partner_users pu JOIN users u ON u.id = pu.user_id
 WHERE pu.partner_id = :partner_id AND pu.role = 'owner'
 ORDER BY pu.granted_at LIMIT 1;`,
  partner_site_publish: `UPDATE partner_sites
   SET published = draft, published_at = :now, published_by = :user_id, updated_at = :now
 WHERE partner_id = :partner_id;`,
  partner_site_request_add: `INSERT INTO partner_site_requests (partner_id, user_id, note, requested_at)
VALUES (:partner_id, :user_id, :note, :now)
ON CONFLICT(partner_id, user_id) DO UPDATE SET note = excluded.note, requested_at = excluded.requested_at;`,
  partner_site_request_remove: `DELETE FROM partner_site_requests WHERE partner_id = :partner_id AND user_id = :user_id;`,
  partner_site_requests_clear: `DELETE FROM partner_site_requests WHERE partner_id = :partner_id;`,
  partner_site_requests_for: `SELECT r.user_id, u.name, u.email, r.note, r.requested_at
  FROM partner_site_requests r JOIN users u ON u.id = r.user_id
 WHERE r.partner_id = :partner_id
 ORDER BY r.requested_at;`,
  partner_site_save_draft: `UPDATE partner_sites SET draft = :draft, updated_at = :now WHERE partner_id = :partner_id;`,
  partner_site_set_dns: `UPDATE partner_sites SET dns_state = :dns_state, updated_at = :now WHERE partner_id = :partner_id;`,
  partner_site_set_enabled: `UPDATE partner_sites
   SET enabled = :enabled, updated_at = :now,
       archived_at = CASE WHEN :enabled = 1 THEN NULL ELSE archived_at END
 WHERE partner_id = :partner_id;`,
  partner_site_set_subdomain: `UPDATE partner_sites SET subdomain = :subdomain, dns_state = NULL, updated_at = :now
 WHERE partner_id = :partner_id;`,
  partner_site_subdomain_taken: `SELECT partner_id FROM partner_sites WHERE subdomain = :subdomain AND partner_id <> :partner_id
UNION ALL
SELECT partner_id FROM partner_site_aliases WHERE subdomain = :subdomain AND partner_id <> :partner_id;`,
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
  people_find: `SELECT u.id AS user_id, u.name,
       (SELECT GROUP_CONCAT(p.display_name, ', ')
          FROM partner_users pu JOIN partners p ON p.id = pu.partner_id
         WHERE pu.user_id = u.id) AS ministries
  FROM users u
 WHERE u.status = 'active'
   AND u.id <> :user_id
   AND COALESCE(u.protected, 0) = 0
   AND (u.name LIKE '%' || :q || '%' OR u.email LIKE :q || '%')
 ORDER BY u.name COLLATE NOCASE
 LIMIT 8;`,
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
       p.display_name, p.embed_accent, p.embed_accent2, p.embed_theme, p.embed_turn,
       k.accent AS look_accent, k.accent2 AS look_accent2,
       k.turn AS look_turn, k.theme AS look_theme
FROM contact_forms c
JOIN partners p ON p.slug = :partner_slug AND c.partner_id IS p.id
LEFT JOIN embed_looks k ON k.partner_id = p.id AND k.kind = 'contact'
WHERE c.is_open = 1;`,
  public_contact_form_org: `SELECT deliver_to, from_address, heading, blurb, button, thanks
FROM contact_forms
WHERE partner_id IS NULL AND is_open = 1;`,
  public_contact_topics: `SELECT t.id, t.label, t.labels, t.deliver_to, t.sort_order
FROM contact_topics t
JOIN partners p ON p.slug = :partner_slug AND t.partner_id IS p.id
ORDER BY t.sort_order, t.label COLLATE NOCASE;`,
  public_contact_topics_org: `SELECT id, label, labels, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS NULL
ORDER BY sort_order, label COLLATE NOCASE;`,
  public_form_words: `SELECT w.lang, w.heading, w.blurb, w.button, w.thanks
  FROM form_words w
  JOIN partners p ON p.slug = :partner_slug AND w.partner_id = p.id
 WHERE w.form = :form;`,
  public_form_words_org: `SELECT lang, heading, blurb, button, thanks
  FROM form_words
 WHERE partner_id IS NULL AND form = :form;`,
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
       p.embed_accent, p.embed_accent2, p.embed_theme, p.embed_turn,
       k.accent AS look_accent, k.accent2 AS look_accent2,
       k.turn AS look_turn, k.theme AS look_theme
  FROM mailing_lists l
  JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
  LEFT JOIN embed_looks k ON k.partner_id = p.id AND k.kind = 'signup'
 WHERE l.is_open = 1 AND l.archived_at IS NULL
   AND p.signup_form_open = 1     -- the form's own Live switch (0038)
 ORDER BY l.name COLLATE NOCASE;`,
  public_lists_for_signup_org: `SELECT l.id, l.partner_id, l.name, l.slug, l.description,
       l.from_name, l.from_email, l.reply_to,
       l.form_heading, l.form_blurb, l.form_button, l.form_thanks_url
  FROM mailing_lists l
 WHERE l.partner_id IS NULL AND l.is_open = 1 AND l.archived_at IS NULL
 ORDER BY l.name COLLATE NOCASE;`,
  public_mailings_for_partner: `SELECT m.slug, m.subject, m.preheader, m.finished_at AS sent_at,
       l.slug AS list_slug, l.name AS list_name
  FROM mailings m
  JOIN mailing_lists l ON l.id = m.list_id
 WHERE l.partner_id IS :partner_id
   AND l.archive_public = 1
   AND m.status = 'sent'
   AND m.slug IS NOT NULL
 ORDER BY m.finished_at DESC
 LIMIT 50;`,
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
  id, parent_id, actual_date, status,
  CASE WHEN status = 'upcoming' THEN 0 ELSE completion END AS completion,
  is_featured, sort_order
FROM milestones
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY (actual_date IS NULL), actual_date ASC, sort_order ASC;`,
  public_partner_for_embed: `SELECT id, slug, display_name, embed_accent, embed_accent2, embed_theme, embed_turn,
       timeline_start, timeline_end,
       embed_roadmap, embed_goal, embed_prayer, embed_videos
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
  resource_can_edit_shared: `SELECT 1 AS ok FROM resource_shares
 WHERE resource_id = :id AND user_id = :user_id AND can_edit = 1
UNION ALL
SELECT 1 FROM resource_group_shares g
 WHERE g.resource_id = :id AND g.can_edit = 1
   AND (g.audience = 'everyone'
        OR EXISTS (SELECT 1 FROM partner_users pu
                    WHERE pu.partner_id = g.partner_id AND pu.user_id = :user_id))
LIMIT 1;`,
  resource_delete: `DELETE FROM resources WHERE id = :id AND partner_id IS :partner_id;`,
  resource_group_share_remove: `DELETE FROM resource_group_shares WHERE resource_id = :resource_id AND audience = :audience;`,
  resource_group_share_set: `INSERT INTO resource_group_shares (resource_id, audience, partner_id, can_edit, shared_by, shared_at)
VALUES (:resource_id, :audience, :partner_id, :can_edit, :shared_by, :now)
ON CONFLICT(resource_id, audience) DO UPDATE SET
  can_edit = excluded.can_edit, partner_id = excluded.partner_id;`,
  resource_group_shares_for: `SELECT g.audience, g.partner_id, p.display_name AS partner_name, g.can_edit, g.shared_at
  FROM resource_group_shares g
  LEFT JOIN partners p ON p.id = g.partner_id
 WHERE g.resource_id = :resource_id
 ORDER BY g.audience;`,
  resource_owner: `SELECT id, owner_user_id, partner_id FROM resources WHERE id = :id;`,
  resource_share_add: `INSERT INTO resource_shares (resource_id, user_id, shared_by, shared_at, can_edit)
VALUES (:resource_id, :user_id, :shared_by, :now, :can_edit)
ON CONFLICT(resource_id, user_id) DO UPDATE SET can_edit = excluded.can_edit;`,
  resource_share_remove: `DELETE FROM resource_shares WHERE resource_id = :resource_id AND user_id = :user_id;`,
  resource_shared_with: `SELECT sh.user_id, u.name, u.email, sh.shared_at,
       (SELECT b.name FROM users b WHERE b.id = sh.shared_by) AS shared_by_name,
       sh.can_edit
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
       'shared' AS shelf, s.can_edit,
       (SELECT u.name FROM users u WHERE u.id = r.owner_user_id) AS shared_by_name
  FROM resources r
  JOIN (SELECT resource_id, MAX(can_edit) AS can_edit FROM (
          SELECT sh.resource_id, sh.can_edit FROM resource_shares sh
           WHERE sh.user_id = :user_id
          UNION ALL
          SELECT g.resource_id, g.can_edit FROM resource_group_shares g
           WHERE g.audience = 'everyone'
          UNION ALL
          SELECT g.resource_id, g.can_edit FROM resource_group_shares g
            JOIN partner_users pu ON pu.partner_id = g.partner_id AND pu.user_id = :user_id
           WHERE g.audience = 'team')
        GROUP BY resource_id) s ON s.resource_id = r.id
 WHERE r.owner_user_id IS NOT NULL
   AND r.owner_user_id <> :user_id

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
  staff_profile_file_state: `UPDATE staff_profiles
   SET file_synced_at = :file_synced_at,
       file_error     = :file_error
 WHERE user_id = :user_id;`,
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
   photo_master, bio_photo_master, bio_photo_aspect,
   sort_order, created_at, updated_at)
VALUES
  (:user_id, :is_public, :slug, :region, :public_email, :photo, :bio_photo,
   :photo_master, :bio_photo_master, :bio_photo_aspect,
   :sort_order, :now, :now)
ON CONFLICT(user_id) DO UPDATE SET
  is_public    = excluded.is_public,
  slug         = excluded.slug,
  region       = excluded.region,
  public_email = excluded.public_email,
  photo        = excluded.photo,
  bio_photo    = excluded.bio_photo,
  photo_master = excluded.photo_master,
  bio_photo_master = excluded.bio_photo_master,
  bio_photo_aspect = excluded.bio_photo_aspect,
  sort_order   = excluded.sort_order,
  updated_at   = excluded.updated_at;`,
  staff_profiles_all: `SELECT
  u.id AS user_id, u.name, u.email, u.status,
  sp.is_public, sp.slug, sp.region, sp.public_email,
  sp.photo, sp.bio_photo, sp.photo_master, sp.bio_photo_master,
  sp.bio_photo_aspect, sp.sort_order, sp.updated_at,
  sp.file_synced_at, sp.file_error,
  (SELECT GROUP_CONCAT(t.lang || CHAR(31) || COALESCE(t.role_title, '') ||
                       CHAR(31) || COALESCE(t.bio, ''), CHAR(30))
     FROM staff_profile_translations t WHERE t.user_id = u.id) AS translations
FROM users u
LEFT JOIN staff_profiles sp ON sp.user_id = u.id
ORDER BY u.name COLLATE NOCASE;`,
  staff_profiles_public: `SELECT
  u.id AS user_id, u.name, u.email,
  sp.slug, sp.region, sp.public_email, sp.photo, sp.bio_photo,
  sp.bio_photo_aspect, sp.sort_order
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
  translation_glossary_add: `INSERT INTO translation_glossary (id, lang, source, target, created_at, updated_at, updated_by)
VALUES (:id, :lang, :source, :target, :now, :now, :user_id)
ON CONFLICT(lang, source) DO UPDATE SET
  target = excluded.target, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`,
  translation_glossary_all: `SELECT id, lang, source, target FROM translation_glossary
ORDER BY lang, source COLLATE NOCASE;`,
  translation_glossary_delete: `DELETE FROM translation_glossary WHERE id = :id;`,
  translation_glossary_update: `UPDATE translation_glossary
SET source = :source, target = :target, updated_at = :now, updated_by = :user_id
WHERE id = :id;`,
  translation_guide_set: `INSERT INTO translation_guides (lang, guidance, updated_at, updated_by)
VALUES (:lang, :guidance, :now, :user_id)
ON CONFLICT(lang) DO UPDATE SET
  guidance = excluded.guidance, updated_at = excluded.updated_at, updated_by = excluded.updated_by;`,
  translation_guides_all: `SELECT lang, guidance FROM translation_guides ORDER BY lang;`,
  translation_keep_add: `INSERT INTO translation_keep (id, term, created_at, created_by)
VALUES (:id, :term, :now, :user_id)
ON CONFLICT(term) DO NOTHING;`,
  translation_keep_all: `SELECT id, term FROM translation_keep ORDER BY term COLLATE NOCASE;`,
  translation_keep_delete: `DELETE FROM translation_keep WHERE id = :id;`,
  translation_state_baseline: `INSERT OR IGNORE INTO translation_state (source, key, lang, english_hash, text_hash, confirmed_at, confirmed_by)
SELECT json_extract(r.value, '$.source'), json_extract(r.value, '$.key'), :lang,
       json_extract(r.value, '$.english_hash'), json_extract(r.value, '$.text_hash'), :now, NULL
FROM json_each(:rows) AS r;`,
  translation_state_confirm: `INSERT INTO translation_state (source, key, lang, english_hash, text_hash, confirmed_at, confirmed_by)
SELECT json_extract(r.value, '$.source'), json_extract(r.value, '$.key'), :lang,
       json_extract(r.value, '$.english_hash'), json_extract(r.value, '$.text_hash'), :now, :user_id
FROM json_each(:rows) AS r WHERE true
ON CONFLICT(source, key, lang) DO UPDATE SET
  english_hash = excluded.english_hash,
  text_hash = excluded.text_hash,
  confirmed_at = excluded.confirmed_at,
  confirmed_by = excluded.confirmed_by;`,
  translation_state_for_lang: `SELECT source, key, english_hash, text_hash
FROM translation_state
WHERE lang = :lang;`,
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
  user_by_id_any_status: `SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.id = :id;`,
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
