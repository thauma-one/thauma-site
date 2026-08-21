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
  goal_id, label, description, kind, target_cents, currency,
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


-- name: user_by_email
-- WHO SOMEBODY IS. Nothing about what they can reach.
--
-- This exists because partners_for_user was doing both jobs, and a person with
-- no partner therefore had no identity: an administrator whose partner grant
-- was removed could not open the administration area, because the query that
-- was supposed to tell the Worker their name and roles returned no rows.
--
-- An account with no partner is an ordinary thing. An administrator does not
-- need one. A board member does not need one. Someone invited last week and
-- not yet placed does not need one. "Which partners" is a separate question,
-- asked separately, and allowed to answer "none".
SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.email = :email AND u.status = 'active';


-- name: user_by_id
-- The same row, found by id instead of address.
--
-- ONLY for acting-as. Everything else looks a person up by EMAIL, because that
-- is what Cloudflare Access hands over and `u_chase` is an internal id no
-- identity provider has ever heard of. Here the id is right: an administrator
-- picks a person from a list this system produced, so the id is ours already
-- and asking for their email address first would be a round trip to learn
-- something we are about to look up anyway.
--
-- Same `status = 'active'` gate. Suspending somebody must also stop an
-- administrator standing inside their account.
SELECT u.id AS user_id, u.email, u.name AS user_name, u.status,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles
FROM users u
WHERE u.id = :id AND u.status = 'active';


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
-- preferred_lang rides along so the editor can open in the staff member's own
-- language without a second query on every page load.
-- roles is a comma-separated list from user_roles, which replaced
-- users.global_role in 0006 — a person may hold more than one. Handlers split
-- it rather than running a second query on every request.
SELECT p.id, p.slug, p.display_name, p.status, pu.role AS access_role,
       u.id AS user_id, u.name AS user_name,
       COALESCE((SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id),
                u.global_role) AS roles,
       COALESCE(u.preferred_lang, 'en') AS preferred_lang
FROM users u
JOIN partner_users pu ON pu.user_id = u.id
JOIN partners p ON p.id = pu.partner_id
WHERE u.email = :email
  AND u.status = 'active'
ORDER BY p.display_name;


-- name: milestones_for_staff
-- EVERY milestone, published or not. The console's editing view.
--
-- LANGUAGE-NEUTRAL ONLY. Text lives in milestone_translations, one row per
-- language, and comes back from milestone_translations_for_staff below. Two
-- queries assembled by the caller rather than one pivoted in SQL, because a
-- pivot has to name its languages — which is exactly the constraint 0003
-- removed. Adding Portuguese must not require touching a query.
SELECT
  id, parent_id, actual_date, status, completion,
  is_public, is_featured, sort_order, created_at, updated_at
FROM milestones
WHERE partner_id = :partner_id
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;


-- name: milestone_translations_for_staff
-- Every translation the partner has, in every language, including languages
-- they have currently switched off — the editor must be able to show and
-- prepare text that is not being published yet.
SELECT milestone_id, lang, title, description, target_label, updated_at
FROM milestone_translations
WHERE partner_id = :partner_id
ORDER BY milestone_id, lang;


-- name: milestone_upsert
-- The language-neutral row. Text is saved separately, per language.
--
-- The id is generated by the caller so a retry cannot produce a duplicate, and
-- partner_id is in the UPDATE's WHERE so an id from another tenant can never
-- move or rewrite their row.
INSERT INTO milestones (
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
WHERE milestones.partner_id = :partner_id;


-- name: milestone_translation_upsert
-- One language's text for one milestone.
INSERT INTO milestone_translations (
  milestone_id, lang, partner_id, title, description, target_label, updated_at
) VALUES (
  :milestone_id, :lang, :partner_id, :title, :description, :target_label, :now
)
ON CONFLICT(milestone_id, lang) DO UPDATE SET
  title = :title, description = :description,
  target_label = :target_label, updated_at = :now
WHERE milestone_translations.partner_id = :partner_id;


-- name: milestone_translation_delete
-- Clearing a language's title removes that translation rather than storing an
-- empty one. "Not translated" and "translated to nothing" have to stay
-- distinguishable, or the editor cannot show which languages still need work.
DELETE FROM milestone_translations
WHERE milestone_id = :milestone_id AND lang = :lang AND partner_id = :partner_id;


-- name: milestone_delete
-- Scoped by partner as well as id: an id alone must never be enough to delete
-- somebody else's row. Translations follow via ON DELETE CASCADE; children are
-- re-parented to NULL rather than vanishing with the parent.
DELETE FROM milestones WHERE id = :id AND partner_id = :partner_id;


-- name: milestone_reorder
-- Ordering is its own operation. Dragging a row should not rewrite its text.
UPDATE milestones SET sort_order = :sort_order, updated_at = :now
WHERE id = :id AND partner_id = :partner_id;


-- ============================================================================
-- LANGUAGES
-- ============================================================================

-- name: languages_all
-- The organisation's catalogue. Admin-managed; every partner chooses from it.
SELECT code, name, native_name, is_active, sort_order
FROM languages ORDER BY sort_order, name;


-- name: language_upsert
-- THE CATALOGUE MUST LEARN ABOUT A LANGUAGE SOMEBODY ADDED.
-- Adding a language writes two git files — the strings and the site's list —
-- and for a long time that was all it did. So a language could be live on the
-- public site while every screen that reads this table went on as though it
-- did not exist: no partner could publish content in it (this table is the
-- LEFT side of partner_languages_for_partner, so an absent row means the
-- language is not offered at all), and the admin Overview counted one fewer
-- language than the site was serving. Slovenian was in exactly that state.
--
-- Idempotent, and re-activating rather than duplicating: removing a language
-- only switches it off (see language_deactivate), so adding it back must be
-- able to find the row already there and turn it on with its translations
-- still attached.
INSERT INTO languages (code, name, native_name, sort_order, is_active, created_at)
VALUES (:code, :name, :native_name, :sort_order, 1, :now)
ON CONFLICT(code) DO UPDATE SET
  is_active   = 1,
  name        = excluded.name,
  native_name = excluded.native_name;


-- name: language_deactivate
-- SWITCHED OFF, NOT DELETED. partner_languages and every *_translations table
-- reference this row; deleting it would either fail on the foreign key or take
-- real translated text with it. A language that comes back should find its
-- work still there.
UPDATE languages SET is_active = 0 WHERE code = :code;


-- name: language_next_sort_order
-- Appended to the end of the catalogue rather than inserted into it: the order
-- is somebody's decision, and a new arrival has no claim on a position.
SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order FROM languages;


-- name: partner_languages_for_partner
-- Which of the catalogue this partner publishes, and in what order. LEFT JOIN
-- from languages so a newly added language appears immediately, switched off,
-- rather than being invisible until somebody inserts a row for every partner.
SELECT l.code, l.name, l.native_name, l.sort_order AS catalogue_order,
       COALESCE(pl.is_enabled, 0) AS is_enabled,
       COALESCE(pl.sort_order, l.sort_order) AS sort_order
FROM languages l
LEFT JOIN partner_languages pl
  ON pl.lang = l.code AND pl.partner_id = :partner_id
WHERE l.is_active = 1
ORDER BY sort_order, l.name;


-- name: partner_language_set
-- A partner switching one of their languages on or off.
INSERT INTO partner_languages (partner_id, lang, is_enabled, sort_order)
VALUES (:partner_id, :lang, :is_enabled, :sort_order)
ON CONFLICT(partner_id, lang) DO UPDATE SET
  is_enabled = :is_enabled, sort_order = :sort_order;


-- ============================================================================
-- ADMINISTRATION
-- ============================================================================
-- Everything here is gated on the caller holding the 'admin' role, checked in
-- workers/src/admin.js before any of it runs. These queries are NOT
-- partner-scoped — that is the whole point of them — which makes the role
-- check the only thing standing between a staff account and the whole
-- organisation. It is done once, at the top, and every branch runs after it.

-- name: admin_users
-- Everyone, with their roles and which partners they can reach. Two
-- GROUP_CONCATs rather than two round trips; the console splits them.
SELECT
  u.id, u.email, u.name, u.status, u.created_at, u.last_login_at,
  COALESCE(u.preferred_lang, 'en') AS preferred_lang,
  (SELECT GROUP_CONCAT(r.role) FROM user_roles r WHERE r.user_id = u.id) AS roles,
  (SELECT GROUP_CONCAT(p.display_name, ' | ')
     FROM partner_users pu JOIN partners p ON p.id = pu.partner_id
    WHERE pu.user_id = u.id) AS partner_names,
  (SELECT GROUP_CONCAT(pu.partner_id) FROM partner_users pu WHERE pu.user_id = u.id) AS partner_ids
FROM users u
ORDER BY u.status, u.name COLLATE NOCASE;


-- name: admin_user_create
-- Invited, not active. A row here does not grant access on its own: the person
-- must also exist in Cloudflare Access, and partners_for_user requires
-- status = 'active'. Two doors, deliberately — adding somebody here by mistake
-- lets them in nowhere.
INSERT INTO users (id, email, name, global_role, status, created_at)
VALUES (:id, :email, :name, 'staff', 'invited', :now);


-- ============================================================================
-- MAILING
--
-- EVERY QUERY HERE IS SCOPED BY partner_id, WITHOUT EXCEPTION. That is the
-- product requirement — a partner must never see another partner's
-- subscribers — and it is why these take :partner_id even where a list id
-- alone would be enough to find the row. A query that can be called with only
-- an id is a query that can be called with somebody else's id.
--
-- The organisation's own lists have partner_id NULL. `IS NOT DISTINCT FROM`
-- is spelled `IS` in SQLite, which matches NULL to NULL — so one query serves
-- both a partner asking for theirs and an administrator asking for Thauma's.
-- ============================================================================

-- name: mailing_lists_for_partner
-- Live lists, with what is actually on them. The counts are subqueries rather
-- than a GROUP BY join so that a list with no subscribers still appears —
-- which is exactly the list somebody has just created and wants to see.
SELECT
  l.id, l.partner_id, l.slug, l.name, l.description,
  l.from_name, l.from_email, l.reply_to, l.is_open,
  l.created_at, l.updated_at,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'subscribed')  AS subscribed,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'pending')     AS pending,
  (SELECT COUNT(*) FROM subscribers s
    WHERE s.list_id = l.id AND s.status = 'unsubscribed') AS unsubscribed
FROM mailing_lists l
WHERE l.partner_id IS :partner_id AND l.archived_at IS NULL
ORDER BY l.name COLLATE NOCASE;


-- name: mailing_list_upsert
INSERT INTO mailing_lists
  (id, partner_id, slug, name, description, from_name, from_email, reply_to,
   is_open, created_at, updated_at)
VALUES
  (:id, :partner_id, :slug, :name, :description, :from_name, :from_email,
   :reply_to, :is_open, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  slug        = excluded.slug,
  name        = excluded.name,
  description = excluded.description,
  from_name   = excluded.from_name,
  from_email  = excluded.from_email,
  reply_to    = excluded.reply_to,
  is_open     = excluded.is_open,
  updated_at  = excluded.updated_at
-- The partner scope is re-checked on UPDATE. Without it, knowing an id would
-- be enough to rewrite somebody else's list.
WHERE mailing_lists.partner_id IS :partner_id;


-- name: mailing_list_one
SELECT id, partner_id, slug, name, description, from_name, from_email,
       reply_to, is_open, archived_at, created_at, updated_at
FROM mailing_lists
WHERE id = :id AND partner_id IS :partner_id;


-- name: mailing_list_archive
-- SOFT. A list with history is not a row to discard: the sends reference it,
-- and "who did we mail in March" has to stay answerable. Subscribers stay
-- attached, so un-archiving restores the list rather than an empty shell.
UPDATE mailing_lists
SET archived_at = :now, updated_at = :now
WHERE id = :id AND partner_id IS :partner_id;


-- name: mailing_list_slug_taken
-- Across archived lists too: an archived list still owns its address, or
-- un-archiving would collide with whatever took the slug meanwhile.
SELECT id FROM mailing_lists
WHERE partner_id IS :partner_id AND slug = :slug AND id <> :id;


-- name: subscribers_for_list
-- Paged, because a list is the one table here that grows without limit. The
-- partner check is on the LIST, so a subscriber cannot be read by knowing a
-- list id alone.
SELECT
  s.id, s.email, s.name, s.status, s.source,
  s.subscribed_at, s.confirmed_at, s.unsubscribed_at,
  (SELECT GROUP_CONCAT(t.name, ', ')
     FROM subscriber_tags st JOIN mailing_tags t ON t.id = st.tag_id
    WHERE st.subscriber_id = s.id) AS tags
FROM subscribers s
JOIN mailing_lists l ON l.id = s.list_id
WHERE s.list_id = :list_id AND l.partner_id IS :partner_id
ORDER BY s.subscribed_at DESC
LIMIT :limit OFFSET :offset;


-- name: subscriber_add
-- ADDED BY HAND, by somebody who already has the person's permission — which
-- is why it lands as `subscribed` rather than `pending`. The double opt-in
-- exists to prove consent that arrived over the internet from a stranger; a
-- staff member typing in the address of somebody who asked them face to face
-- has that proof already, and making them wait for a confirmation email would
-- be ceremony rather than protection. `source` records which of the two
-- happened, so the difference stays visible afterwards.
--
-- The partner check is on the LIST, so this cannot add to somebody else's.
INSERT INTO subscribers
  (id, list_id, partner_id, email, name, status, source,
   subscribed_at, confirmed_at, updated_at)
SELECT :id, l.id, l.partner_id, :email, :name, 'subscribed', :source,
       :now, :now, :now
  FROM mailing_lists l
 WHERE l.id = :list_id AND l.partner_id IS :partner_id;


-- name: subscriber_delete
-- Removing somebody is removing them. There is no soft delete here on purpose:
-- an address kept after a request to be forgotten is the thing the request was
-- about. Unsubscribing (status change) is the other action, and is separate.
DELETE FROM subscribers
WHERE id = :id
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);


-- name: subscriber_set_status
UPDATE subscribers
SET status = :status,
    unsubscribed_at = CASE WHEN :status = 'unsubscribed' THEN :now ELSE unsubscribed_at END,
    updated_at = :now
WHERE id = :id
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);


-- name: mailing_tags_for_partner
SELECT t.id, t.name, t.sort_order,
       (SELECT COUNT(*) FROM subscriber_tags st WHERE st.tag_id = t.id) AS used
FROM mailing_tags t
WHERE t.partner_id IS :partner_id
ORDER BY t.sort_order, t.name COLLATE NOCASE;


-- name: mailing_tag_create
INSERT INTO mailing_tags (id, partner_id, name, sort_order, created_at)
VALUES (:id, :partner_id, :name, :sort_order, :now);


-- name: mailing_tag_rename
-- ONE UPDATE. chaseroush.com renames a tag by rewriting every subscriber file
-- it appears in; a join table makes the same operation a single row change,
-- and makes it impossible for a rename to half-succeed.
UPDATE mailing_tags SET name = :name
WHERE id = :id AND partner_id IS :partner_id;


-- name: mailing_tag_delete
DELETE FROM mailing_tags WHERE id = :id AND partner_id IS :partner_id;


-- name: staff_profiles_all
-- Every profile, joined to the person. LEFT JOIN FROM users, so somebody with
-- no profile still appears — the People page holds everyone, and "no public
-- profile" is the ordinary state for a board member rather than a gap.
--
-- The translations arrive as one packed string per person and are split by the
-- console, the same trick admin_users uses for roles: a second round trip per
-- person to fetch two short strings is not worth the latency.
SELECT
  u.id AS user_id, u.name, u.email, u.status,
  sp.is_public, sp.slug, sp.region, sp.public_email,
  sp.photo, sp.bio_photo, sp.sort_order, sp.updated_at,
  (SELECT GROUP_CONCAT(t.lang || CHAR(31) || COALESCE(t.role_title, '') ||
                       CHAR(31) || COALESCE(t.bio, ''), CHAR(30))
     FROM staff_profile_translations t WHERE t.user_id = u.id) AS translations
FROM users u
LEFT JOIN staff_profiles sp ON sp.user_id = u.id
ORDER BY u.name COLLATE NOCASE;


-- name: staff_profile_upsert
-- Idempotent so the console can save the same form twice without minting a
-- second row. created_at is preserved on update: it records when this person
-- was first given a profile, which is not the same as the last edit.
INSERT INTO staff_profiles
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
  updated_at   = excluded.updated_at;


-- name: staff_profile_translation_upsert
INSERT INTO staff_profile_translations (user_id, lang, role_title, bio, updated_at)
VALUES (:user_id, :lang, :role_title, :bio, :now)
ON CONFLICT(user_id, lang) DO UPDATE SET
  role_title = excluded.role_title,
  bio        = excluded.bio,
  updated_at = excluded.updated_at;


-- name: staff_profile_translation_delete
-- Emptying both fields for a language removes the row rather than storing two
-- empty strings, so "has this been translated" stays a question about rows.
DELETE FROM staff_profile_translations WHERE user_id = :user_id AND lang = :lang;


-- name: staff_profile_delete
DELETE FROM staff_profiles WHERE user_id = :user_id;


-- name: staff_profile_slug_taken
-- The slug is a public URL and must be unique across people, not merely across
-- published ones — an unpublished profile still owns its address, or turning
-- two toggles on in the wrong order would collide.
SELECT user_id FROM staff_profiles WHERE slug = :slug AND user_id <> :user_id;


-- name: staff_profiles_public
-- What the export writes to the repository: published profiles only, in the
-- order they should appear.
SELECT
  u.id AS user_id, u.name, u.email,
  sp.slug, sp.region, sp.public_email, sp.photo, sp.bio_photo, sp.sort_order
FROM staff_profiles sp
JOIN users u ON u.id = sp.user_id
WHERE sp.is_public = 1
ORDER BY sp.sort_order, u.name COLLATE NOCASE;


-- name: admin_user_set
-- Name and status. Email is NOT editable: it is the join to Cloudflare Access,
-- and changing it here would silently detach the account from the identity
-- that signs in. Delete and re-invite instead, which leaves a record.
UPDATE users SET name = :name, status = :status WHERE id = :id;


-- name: admin_user_delete
-- Cascades to user_roles, partner_users and their directory. Deliberate: a
-- person's private address book should not outlive their account.
DELETE FROM users WHERE id = :id;


-- name: admin_role_grant
INSERT OR IGNORE INTO user_roles (user_id, role, granted_by, granted_at)
VALUES (:user_id, :role, :granted_by, :now);


-- name: admin_role_revoke
DELETE FROM user_roles WHERE user_id = :user_id AND role = :role;


-- name: admin_partner_grant
INSERT OR IGNORE INTO partner_users (partner_id, user_id, role, granted_by, granted_at)
VALUES (:partner_id, :user_id, :role, :granted_by, :now);


-- name: admin_partner_revoke
DELETE FROM partner_users WHERE partner_id = :partner_id AND user_id = :user_id;


-- name: admin_partner_create
-- Creating a partner is creating a MINISTRY, not a login. It is the bundle a
-- sent person's supporters, goals, milestones and website content hang off,
-- and it exists separately from the account that manages it — because one
-- partner can have several people, and a person can help with more than one.
--
-- Starts 'prospective': a partner nobody has been sent as yet should not look
-- active on a dashboard.
INSERT INTO partners (id, slug, display_name, status, is_public, default_lang,
                      created_at, updated_at)
VALUES (:id, :slug, :display_name, 'prospective', 0, 'en', :now, :now);


-- name: admin_partner_set
UPDATE partners SET display_name = :display_name, status = :status, updated_at = :now
WHERE id = :id;


-- name: admin_partner_stats
-- What deleting this partner would destroy. Counted BEFORE asking, so the
-- confirmation can name real numbers instead of a generic warning — "this
-- cannot be undone" means nothing next to "4 supporters and 8 interactions".
SELECT
  (SELECT COUNT(*) FROM contacts      WHERE partner_id = :partner_id) AS contacts,
  (SELECT COUNT(*) FROM interactions  WHERE partner_id = :partner_id) AS interactions,
  (SELECT COUNT(*) FROM goals         WHERE partner_id = :partner_id) AS goals,
  (SELECT COUNT(*) FROM milestones    WHERE partner_id = :partner_id) AS milestones,
  (SELECT COUNT(*) FROM api_keys      WHERE partner_id = :partner_id
                                        AND revoked_at IS NULL)       AS live_keys,
  (SELECT COUNT(*) FROM partner_users WHERE partner_id = :partner_id) AS members,
  (SELECT COUNT(*) FROM resources     WHERE partner_id = :partner_id) AS resources,
  (SELECT COUNT(*) FROM directory_contacts WHERE partner_id = :partner_id) AS directory;


-- name: admin_partner_delete
-- Destroys the ministry and everything hanging off it: supporters,
-- interactions, goals, milestones, translations, API keys, resources and the
-- directories filed under it. All by ON DELETE CASCADE, so nothing is left
-- orphaned — and nothing is recoverable.
--
-- Guarded in admin.js by an exact-name confirmation, not by hiding the button.
-- A partner that cannot be removed is a database that fills with test data
-- nobody can clear.
DELETE FROM partners WHERE id = :partner_id;


-- name: admin_partners
SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang,
       (SELECT COUNT(*) FROM partner_users pu WHERE pu.partner_id = p.id) AS member_count
FROM partners p
ORDER BY p.display_name COLLATE NOCASE;


-- name: admin_count_admins
-- Used before removing the admin role or an account. An organisation with no
-- administrator cannot appoint one — the screen that grants roles is itself
-- admin-only — so the last one is refused rather than left to be discovered.
SELECT COUNT(*) AS n
FROM user_roles r JOIN users u ON u.id = r.user_id
WHERE r.role = 'admin' AND u.status = 'active';


-- name: admin_audit_recent
-- Org-wide, unlike audit_recent_for_partner. Reading it is itself an admin act.
--
-- JOINED ON EMAIL, not on id — audit_log.user_id holds an address since 0009,
-- because a record has to keep naming somebody after their account is gone.
-- COALESCE is what makes that work: no user row means no name, and the address
-- itself is shown instead. That is the deleted-person case, and it is the one
-- this log exists for.
--
-- The two seed rows predate 0009 and hold internal ids. They fall through to
-- COALESCE and display as ids, which is the honest history of a system that
-- changed its mind rather than a past invented to look consistent.
SELECT a.at, a.action, a.entity, a.entity_id, a.detail,
       a.partner_id, COALESCE(u.name, a.user_id) AS actor
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id
ORDER BY a.at DESC
LIMIT :limit;


-- ============================================================================
-- DIRECTORY (per person) and RESOURCES (shared, with levels)
-- ============================================================================

-- name: directory_for_user
-- SOMEBODY'S OWN address book. Scoped by user AND partner: the user id decides
-- whose it is, the partner id is the tenant guard every table here carries.
-- A colleague sharing the partner sees none of this.
SELECT id, name, role, emails, phones, created_at, updated_at
FROM directory_contacts
WHERE user_id = :user_id AND partner_id = :partner_id
ORDER BY name COLLATE NOCASE;


-- name: directory_upsert
INSERT INTO directory_contacts
  (id, user_id, partner_id, name, role, emails, phones, created_at, updated_at)
VALUES
  (:id, :user_id, :partner_id, :name, :role, :emails, :phones, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  name = :name, role = :role, emails = :emails, phones = :phones,
  updated_at = :now
-- Both halves of the ownership check: an id alone must never be enough to
-- rewrite a card, and neither must an id plus the right partner.
WHERE directory_contacts.user_id = :user_id
  AND directory_contacts.partner_id = :partner_id;


-- name: directory_delete
DELETE FROM directory_contacts
WHERE id = :id AND user_id = :user_id AND partner_id = :partner_id;


-- name: resources_visible
-- The library, filtered to what this person may see.
--
-- :levels is a comma-separated list the caller builds from the reader's role,
-- matched with instr() against a padded string so 'staff' cannot match
-- 'staffing'. Roles are not in the database yet; when they are, this query
-- does not change — only the list handed to it.
SELECT id, partner_id, title, description, link, photo, visibility,
       created_at, updated_at
FROM resources
WHERE (partner_id = :partner_id OR partner_id IS NULL)
  AND instr(',' || :levels || ',', ',' || visibility || ',') > 0
ORDER BY title COLLATE NOCASE;


-- name: resource_upsert
INSERT INTO resources
  (id, partner_id, title, description, link, photo, visibility,
   created_by, created_at, updated_at)
VALUES
  (:id, :partner_id, :title, :description, :link, :photo, :visibility,
   :created_by, :now, :now)
ON CONFLICT(id) DO UPDATE SET
  title = :title, description = :description, link = :link, photo = :photo,
  visibility = :visibility, updated_at = :now
WHERE resources.partner_id IS :partner_id;


-- name: resource_delete
DELETE FROM resources WHERE id = :id AND partner_id IS :partner_id;


-- ============================================================================
-- SETTINGS
-- ============================================================================

-- name: user_set_preferred_lang
-- A person choosing which language the editor opens in. Their own row only —
-- keyed on the email Access supplies, so one staff member cannot set another's
-- preference by guessing an id.
UPDATE users SET preferred_lang = :lang WHERE email = :email AND status = 'active';


-- name: partner_settings
-- The partner-level settings screen. default_lang is admin-only to CHANGE;
-- everyone who can see the partner can see what it is.
SELECT p.id, p.slug, p.display_name, p.status,
       COALESCE(p.default_lang, 'en') AS default_lang,
       p.embed_enabled, p.embed_accent, p.embed_accent2, p.embed_theme,
       p.timeline_start, p.timeline_end
FROM partners p WHERE p.id = :partner_id;


-- name: partner_set_embed
-- The embed settings, written together because they are edited together on
-- one panel and a half-applied change would leave a widget live in colours
-- nobody chose.
--
-- The accent is validated in the Worker, not here: SQLite has no regular
-- expressions, and a CHECK that only tested the length would pass '#zzzzzz'
-- while looking as though it had done something. This value ends up inside a
-- stylesheet in a stranger's browser.
UPDATE partners
   SET embed_enabled = :embed_enabled,
       embed_accent  = :embed_accent,
       embed_accent2 = :embed_accent2,
       embed_theme   = :embed_theme,
       updated_at    = :now
 WHERE id = :partner_id;


-- name: partner_set_default_lang
-- ADMIN ONLY — the endpoint checks global_role before running this. It changes
-- what a public website shows before a visitor chooses, which is not a
-- personal preference and should not be reachable from an account screen.
UPDATE partners SET default_lang = :lang, updated_at = :now WHERE id = :partner_id;


-- name: api_keys_for_partner
-- Never selects key_hash. The screen needs to know a key exists, what it is
-- for, and when it was last used — the hash is not useful to a human and a
-- payload that carries it is a payload that can leak it.
SELECT id, name, scopes, created_at, last_used_at, revoked_at
FROM api_keys
WHERE partner_id = :partner_id
ORDER BY revoked_at IS NOT NULL, created_at DESC;


-- name: api_key_create
INSERT INTO api_keys (id, partner_id, name, key_hash, scopes, created_by, created_at)
VALUES (:id, :partner_id, :name, :key_hash, :scopes, :created_by, :now);


-- name: api_key_revoke
-- Revoking sets a timestamp rather than deleting the row: a key that was once
-- live is part of the record of who could read what, and last_used_at is
-- evidence worth keeping after the key stops working.
UPDATE api_keys SET revoked_at = :now
WHERE id = :id AND partner_id = :partner_id AND revoked_at IS NULL;


-- name: audit_write
-- Append-only by trigger; this is the only way anything is ever added.
INSERT INTO audit_log (id, at, user_id, partner_id, action, entity, entity_id, detail)
VALUES (:id, :now, :user_id, :partner_id, :action, :entity, :entity_id, :detail);


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
  goal_id, label, description, kind, target_cents, currency,
  raised_cents, donor_count, percent, captured_at
FROM goal_progress
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY kind, label;


-- name: public_milestones_for_partner
-- The public ministry roadmap, language-neutral half. NOT stewardship history
-- — see the warning at the top of db/migrations/0002_milestones.sql.
SELECT
  id, parent_id, actual_date, status, completion, is_featured, sort_order
FROM milestones
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY sort_order ASC, (actual_date IS NULL), actual_date ASC;


-- name: public_milestone_translations
-- Text for published milestones, in the languages this partner has SWITCHED
-- ON. Three filters, and all three are load-bearing:
--
--   m.is_public = 1     the milestone is published at all
--   pl.is_enabled = 1   the partner publishes that language
--   l.is_active = 1     the organisation still offers it
--
-- A translation prepared in a language the partner has not enabled stays in
-- the database and out of the API — that is the whole point of being able to
-- write a translation before switching it on.
SELECT t.milestone_id, t.lang, t.title, t.description, t.target_label
FROM milestone_translations t
JOIN milestones m ON m.id = t.milestone_id
JOIN partner_languages pl ON pl.partner_id = t.partner_id AND pl.lang = t.lang
JOIN languages l ON l.code = t.lang
WHERE t.partner_id = :partner_id
  AND m.is_public = 1
  AND pl.is_enabled = 1
  AND l.is_active = 1
ORDER BY t.milestone_id, l.sort_order;


-- name: public_languages_for_partner
-- What languages a partner site should offer, so a consumer can build its own
-- switcher without guessing from which translations happen to exist.
SELECT l.code, l.name, l.native_name, pl.sort_order
FROM partner_languages pl
JOIN languages l ON l.code = pl.lang
WHERE pl.partner_id = :partner_id
  AND pl.is_enabled = 1
  AND l.is_active = 1
ORDER BY pl.sort_order, l.name;


-- name: public_partner_for_embed
-- Resolve a slug to a partner, for the UNAUTHENTICATED embed endpoint.
--
-- `embed_enabled = 1` is not a filter here, it is the authorisation. This
-- query runs for anybody on the internet who can type a URL, so a partner who
-- has not opted in must not be findable through it — the endpoint returns 404
-- on no rows, which does not confirm whether the slug exists.
--
-- is_public is checked as well. A partner can be public without embedding,
-- but embedding one who is NOT public would put them on somebody else's
-- website while their own listing is still hidden.
SELECT id, slug, display_name, embed_accent, embed_accent2, embed_theme,
       timeline_start, timeline_end
FROM partners
WHERE slug = :slug
  AND embed_enabled = 1
  AND is_public = 1;


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
-- COALESCE, not a bare u.name: an administrator who has since been removed
-- must still show as somebody. A blank in this column would read as "nobody
-- did this", which is the opposite of the truth.
SELECT a.at, a.action, a.entity, a.entity_id,
       COALESCE(u.name, a.user_id) AS actor
FROM audit_log a
LEFT JOIN users u ON u.email = a.user_id
WHERE a.partner_id = :partner_id
ORDER BY a.at DESC
LIMIT :limit;


-- ============================================================================
-- GOALS — editing, and hand-entered progress
-- ============================================================================
-- The console had no way to create or change a goal: they arrived by seed and
-- stayed. These are the milestone editor's shape, for the same reasons — the
-- id is generated by the caller so a retry cannot duplicate, and partner_id is
-- in every WHERE so an id from another tenant can never be moved or rewritten.

-- name: goal_upsert
INSERT INTO goals (
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
WHERE goals.partner_id = :partner_id;


-- name: goal_delete
DELETE FROM goals WHERE id = :id AND partner_id = :partner_id;


-- name: goal_snapshot_insert
-- Progress typed by hand, for a partner whose giving platform has no
-- integration. APPEND, never update: goal_progress reads the newest row, so
-- the history stays intact and a mistyped figure is corrected by entering the
-- right one rather than by editing the past.
--
-- source is 'manual' — the same column an API import would fill with its own
-- name, so where a number came from is always answerable.
INSERT INTO goal_snapshots (
  id, goal_id, partner_id, raised_cents, donor_count, source, captured_at
) VALUES (
  :id, :goal_id, :partner_id, :raised_cents, :donor_count, 'manual', :now
);


-- ============================================================================
-- PRAYER
-- ============================================================================

-- name: prayer_for_staff
-- Everything, published or not — this is the editor's list.
SELECT p.id, p.is_public, p.is_answered, p.answered_on, p.sort_order,
       p.created_at, p.updated_at
FROM prayer p
WHERE p.partner_id = :partner_id
ORDER BY p.sort_order ASC, p.created_at DESC;


-- name: prayer_translations_for_staff
SELECT t.prayer_id, t.lang, t.title, t.description, t.answer_text
FROM prayer_translations t
WHERE t.partner_id = :partner_id;


-- name: prayer_upsert
INSERT INTO prayer (
  id, partner_id, is_public, is_answered, answered_on, sort_order,
  created_at, updated_at
) VALUES (
  :id, :partner_id, :is_public, :is_answered, :answered_on, :sort_order,
  :now, :now
)
ON CONFLICT(id) DO UPDATE SET
  is_public = :is_public, is_answered = :is_answered,
  answered_on = :answered_on, sort_order = :sort_order, updated_at = :now
WHERE prayer.partner_id = :partner_id;


-- name: prayer_translation_upsert
INSERT INTO prayer_translations (
  prayer_id, lang, partner_id, title, description, answer_text, updated_at
) VALUES (
  :prayer_id, :lang, :partner_id, :title, :description, :answer_text, :now
)
ON CONFLICT(prayer_id, lang) DO UPDATE SET
  title = :title, description = :description, answer_text = :answer_text,
  updated_at = :now
WHERE prayer_translations.partner_id = :partner_id;


-- name: prayer_translation_delete
DELETE FROM prayer_translations
WHERE prayer_id = :prayer_id AND lang = :lang AND partner_id = :partner_id;


-- name: prayer_delete
DELETE FROM prayer WHERE id = :id AND partner_id = :partner_id;


-- name: public_prayer_for_partner
-- The published requests, language-neutral half. Same shape as
-- public_milestones_for_partner and gated the same way.
SELECT id, is_answered, answered_on, sort_order
FROM prayer
WHERE partner_id = :partner_id
  AND is_public = 1
ORDER BY is_answered ASC, sort_order ASC;


-- name: public_prayer_translations
-- Text for published prayer only. The join is what keeps an unpublished
-- request's words out of a public response.
SELECT t.prayer_id, t.lang, t.title, t.description, t.answer_text
FROM prayer_translations t
JOIN prayer p ON p.id = t.prayer_id
WHERE t.partner_id = :partner_id
  AND p.is_public = 1;


-- name: partner_set_timeline
-- The bounds the roadmap is drawn against. Both nullable: a partner who has
-- not set them gets a timeline that spans their own milestones, which is the
-- behaviour that existed before this.
UPDATE partners
   SET timeline_start = :timeline_start,
       timeline_end   = :timeline_end,
       updated_at     = :now
 WHERE id = :partner_id;
