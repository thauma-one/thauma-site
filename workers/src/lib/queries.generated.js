// GENERATED FILE — DO NOT EDIT.
// Source: db/queries.sql
// Regenerate: python3 db/generate_queries_module.py
//
// Workers cannot read files at runtime, so the SQL is bundled here.
// db/queries.sql remains the single source of truth; workers/test/db.test.mjs
// asserts this file is in sync with it, so a stale copy fails the tests
// rather than silently shipping old SQL.

/** sha256 of db/queries.sql at generation time, first 16 hex chars. */
export const SOURCE_DIGEST = "3aa7254dbac4f822";

export const QUERIES = {
  audit_recent_for_partner: `SELECT a.at, a.action, a.entity, a.entity_id, u.name AS actor
FROM audit_log a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;`,
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
  c.email,
  c.phone,
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
  partners_for_user: `SELECT p.id, p.slug, p.display_name, p.status, pu.role AS access_role
FROM partner_users pu
JOIN partners p ON p.id = pu.partner_id
WHERE pu.user_id = :user_id
ORDER BY p.display_name;`
};
