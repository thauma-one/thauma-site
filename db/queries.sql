-- ============================================================================
-- queries.sql — the named queries the admin runs
-- ============================================================================
-- Kept as literal SQL, in one file, on purpose. Whatever backend we land on
-- (D1 over HTTP, Turso/libSQL, or plain SQLite) speaks the same dialect, so
-- these move across unchanged. The admin UI is built against the OUTPUT of
-- these queries, not against an ORM, which means swapping the driver never
-- touches the interface.
--
-- EVERY query that touches tenant data takes :partner_id. There is no
-- "select all contacts". If you add a query here without that parameter,
-- you have written a cross-tenant leak.
-- ============================================================================


-- name: dashboard_partner_summary
-- The numbers on the top of a partner's dashboard.
SELECT
  (SELECT COUNT(*) FROM contacts
     WHERE partner_id = :partner_id AND status = 'active')                       AS contacts_total,
  (SELECT COUNT(*) FROM contacts
     WHERE partner_id = :partner_id AND status = 'active'
       AND newsletter_consent = 1)                                               AS newsletter_optin,
  (SELECT COUNT(*) FROM interactions
     WHERE partner_id = :partner_id AND is_personal = 1
       AND occurred_on >= date(:today, '-30 days'))                              AS personal_last_30,
  (SELECT COUNT(*) FROM goals
     WHERE partner_id = :partner_id)                                             AS goals_total;


-- name: dashboard_needs_attention
-- The only number on the dashboard that should ever be red: people the
-- partner has not PERSONALLY contacted in over :stale_days. Newsletters do
-- not count, which is the entire point of splitting the two.
SELECT COUNT(*) AS stale_count
FROM contact_touch
WHERE partner_id = :partner_id
  AND (last_personal_contact IS NULL
       OR last_personal_contact < date(:today, '-' || :stale_days || ' days'));


-- name: contacts_stewardship
-- The main screen. One row per person, sorted worst-first: never-contacted
-- at the top, then longest-since-personal-touch.
SELECT
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
ORDER BY (t.last_personal_contact IS NULL) DESC, t.last_personal_contact ASC;


-- name: contact_timeline
-- Every touch for one person, newest first. Bulk sends appear inline with
-- personal ones so the history reads as a single story, but is_personal
-- keeps them visually distinguishable.
SELECT
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
ORDER BY i.occurred_on DESC, i.created_at DESC;


-- name: interactions_for_partner
-- Every timeline on one screen, in ONE query.
--
-- The stewardship table renders a drawer per contact, so the snapshot needs a
-- timeline for each. Running contact_timeline in a loop is N round trips to
-- D1 for one page — fine for the six seeded contacts, quietly awful at two
-- hundred. This returns the same columns for the whole partner and the caller
-- groups by contact_id.
--
-- contact_timeline stays: it is the right query for one person's history, and
-- a per-contact view will want it.
SELECT
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
ORDER BY i.occurred_on DESC, i.created_at DESC;


-- name: goals_for_partner
-- Progress meters. Reads the view, so the percentage is always derived from
-- the latest snapshot and can never disagree with it.
SELECT
  goal_id, label, kind, target_cents, currency,
  raised_cents, donor_count, percent, captured_at, is_public
FROM goal_progress
WHERE partner_id = :partner_id
ORDER BY kind, label;


-- name: goal_history
-- Snapshot series for one goal, for a sparkline. Aggregates only — there is
-- no donor-level data to chart, by design.
SELECT raised_cents, donor_count, captured_at
FROM goal_snapshots
WHERE goal_id = :goal_id AND partner_id = :partner_id
ORDER BY captured_at ASC;


-- name: partners_for_user
-- What a signed-in user is allowed to see. The admin must call this FIRST and
-- scope everything else to the result. Org-level global_role deliberately
-- grants nothing here — see db/README.md.
--
-- KEYED ON EMAIL, NOT users.id. The identity provider (Cloudflare Access)
-- hands us an email address and nothing else; `u_chase` is an internal id it
-- has never heard of. Looking up by :user_id meant every request 403'd,
-- because no Access email will ever equal a `u_` id. users.email is UNIQUE
-- COLLATE NOCASE for exactly this lookup.
--
-- status = 'active' is part of the gate: revoking access must be one column
-- update, not a scramble to find every partner_users row.
SELECT p.id, p.slug, p.display_name, p.status, pu.role AS access_role
FROM users u
JOIN partner_users pu ON pu.user_id = u.id
JOIN partners p ON p.id = pu.partner_id
WHERE u.email = :email
  AND u.status = 'active'
ORDER BY p.display_name;


-- name: audit_recent_for_partner
-- Shown to the PARTNER, not just to admins. If someone read their data, they
-- should be able to see that it happened.
SELECT a.at, a.action, a.entity, a.entity_id, u.name AS actor
FROM audit_log a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;
