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
--
-- NO EMAIL, NO PHONE. This query used to select both and the stewardship table
-- rendered neither — every console load shipped the partner's full contact
-- list to the browser to display a column of dates. Behind Access, so not a
-- breach, but the payload is the thing that ends up in a log, an extension, or
-- a screenshot, and "we sent it but drew it invisibly" is not minimisation.
--
-- When a screen genuinely needs to CONTACT someone, add a `contact_detail`
-- query that returns one person by id. One row on purpose: fetching the whole
-- list to reach one person is how this happened in the first place.
SELECT
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


-- name: milestones_for_staff
-- EVERY milestone, published or not. The console's editing view.
--
-- Distinct from public_milestones_for_partner, which filters is_public = 1.
-- Two queries rather than one with a flag, because the difference between
-- "what staff can see" and "what the world can see" is the whole point and
-- should not come down to an argument somebody forgets to pass.
SELECT
  id, parent_id, title, title_hr, description, description_hr,
  target_label, target_label_hr, actual_date, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
FROM milestones
WHERE partner_id = :partner_id
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;


-- name: milestone_upsert
-- Create or update in one statement. The id is generated by the caller so a
-- retry cannot produce a duplicate row — an editor that saves twice on a slow
-- connection should not leave two milestones behind.
--
-- partner_id is in the conflict target's WHERE, so an UPDATE can never move a
-- row to another partner even if an id from elsewhere is supplied.
INSERT INTO milestones (
  id, partner_id, parent_id, title, title_hr, description, description_hr,
  target_label, target_label_hr, actual_date, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
) VALUES (
  :id, :partner_id, :parent_id, :title, :title_hr, :description, :description_hr,
  :target_label, :target_label_hr, :actual_date, :status, :completion,
  :is_public, :is_featured, :sort_order, :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  parent_id = :parent_id, title = :title, title_hr = :title_hr,
  description = :description, description_hr = :description_hr,
  target_label = :target_label, target_label_hr = :target_label_hr,
  actual_date = :actual_date, status = :status, completion = :completion,
  is_public = :is_public, is_featured = :is_featured, sort_order = :sort_order,
  updated_at = :now
WHERE milestones.partner_id = :partner_id;


-- name: milestone_delete
-- Scoped by partner as well as id: an id alone must never be enough to delete
-- somebody else's row. Children are re-parented to NULL by the schema's
-- ON DELETE SET NULL rather than vanishing with the parent.
DELETE FROM milestones WHERE id = :id AND partner_id = :partner_id;


-- name: milestone_reorder
-- Ordering is its own operation. Dragging a row should not rewrite its text.
UPDATE milestones SET sort_order = :sort_order, updated_at = :now
WHERE id = :id AND partner_id = :partner_id;


-- ============================================================================
-- PARTNER API — everything below this line may be served to a PUBLIC WEBSITE
-- ============================================================================
-- Queries above this line answer a signed-in human in the staff console.
-- Queries below it answer chaseroush.com's build, authenticated by an API key
-- that lives in a partner site's build environment. Treat every byte they
-- return as though it were already on a public page, because it will be.
--
-- THREE RULES, ENFORCED IN CODE, NOT BY CARE
-- ---------------------------------------------------------------------------
-- 1. A public query must NEVER name `contacts`, `interactions`, `users`,
--    `audit_log` or `api_keys`. workers/test/db.test.mjs greps for exactly
--    that and fails. This is the guarantee that matters: not "we remember not
--    to", but "the query set cannot express it".
--
-- 2. Every public query filters `is_public = 1`. Publication is a decision
--    somebody made, never a default. Both tables default the flag to 0.
--
-- 3. Every public query is scoped by :partner_id, resolved from the API KEY —
--    never from a query string. A key identifies one partner and can only
--    ever read that partner.
--
-- WHY NOT REUSE goals_for_partner: it returns private goals too. The staff
-- console is allowed to see a goal that is not published; a partner site is
-- not. Two queries, because they answer two different questions, and because
-- a shared one would eventually grow a boolean argument that somebody passes
-- wrongly.
-- ============================================================================


-- name: public_goals_for_partner
-- Aggregates only, and only the goals marked public. No donor identity exists
-- anywhere in this database to leak — see the note above goal_snapshots.
SELECT
  goal_id, label, kind, target_cents, currency,
  raised_cents, donor_count, percent, captured_at
FROM goal_progress
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY kind, label;


-- name: public_milestones_for_partner
-- The public ministry roadmap. NOT stewardship history — see the warning at
-- the top of db/migrations/0002_milestones.sql before touching this.
SELECT
  id, parent_id,
  title, title_hr,
  description, description_hr,
  target_label, target_label_hr,
  actual_date, status, completion, is_featured, sort_order
FROM milestones
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;


-- name: api_key_lookup
-- Resolve a presented key to its partner. Takes the HASH, never the key
-- itself — the raw key is not stored, so a database dump does not yield
-- working credentials.
--
-- Not in the public set: it reads api_keys. It is the query that decides who
-- is asking, which is why it runs before any of them, exactly as
-- partners_for_user does for the console.
SELECT k.id AS key_id, k.partner_id, k.scopes, p.slug, p.display_name
FROM api_keys k
JOIN partners p ON p.id = k.partner_id
WHERE k.key_hash = :key_hash
  AND k.revoked_at IS NULL
  AND p.status = 'active';


-- name: api_key_touch
-- Record use. A key that stops being used is a key that can be revoked, and a
-- key used from somewhere unexpected is worth seeing.
UPDATE api_keys SET last_used_at = :now WHERE id = :key_id;


-- ============================================================================
-- STAFF CONSOLE (continued)
-- ============================================================================

-- name: audit_recent_for_partner
-- Shown to the PARTNER, not just to admins. If someone read their data, they
-- should be able to see that it happened.
SELECT a.at, a.action, a.entity, a.entity_id, u.name AS actor
FROM audit_log a
LEFT JOIN users u ON u.id = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;
