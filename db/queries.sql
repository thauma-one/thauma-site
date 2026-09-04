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
  -- So the screen can say why the controls are missing, rather than offering
  -- buttons the database will refuse. See 0026_protected_account.sql.
  u.protected,
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
ORDER BY l.name COLLATE NOCASE;


-- name: mailing_list_upsert
INSERT INTO mailing_lists
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
-- The partner scope is re-checked on UPDATE. Without it, knowing an id would
-- be enough to rewrite somebody else's list.
WHERE mailing_lists.partner_id IS :partner_id;


-- name: mailing_list_one
SELECT id, partner_id, slug, name, description, from_name, from_email,
       reply_to, is_open, archive_public, form_heading, form_blurb, form_button,
       form_thanks_url, archived_at, created_at, updated_at
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
-- Paged, searched and sorted, because a list is the one table here that grows
-- without limit. At a hundred people a fixed newest-first list is fine; at a
-- thousand it is a filing cabinet with no drawers.
--
-- The partner check is on the LIST, so a subscriber cannot be read by knowing
-- a list id alone.
--
-- SORTING BY CASE, not by interpolating a column name. A sort order arriving
-- from a browser and being spliced into SQL is the classic injection, and the
-- classic mitigation — an allow-list in the Worker — has to be got right in
-- every caller forever. This way the database decides, the parameter is bound
-- like any other value, and an unrecognised sort simply falls through to the
-- default rather than being an error or a hole.
--
-- The trailing subscribed_at DESC is both the default and the tiebreaker, so
-- two people who sorted equal never swap places between pages.
SELECT
  s.id, s.email, s.name, s.status, s.source,
  s.subscribed_at, s.confirmed_at, s.unsubscribed_at,
  (SELECT GROUP_CONCAT(t.name, ', ')
     FROM subscriber_tags st JOIN mailing_tags t ON t.id = st.tag_id
    WHERE st.subscriber_id = s.id) AS tags
FROM subscribers s
JOIN mailing_lists l ON l.id = s.list_id
WHERE s.list_id = :list_id AND l.partner_id IS :partner_id
  AND (:status = '' OR s.status = :status)
  -- Matched against the name as well as the address: somebody looking for
  -- "Ann" has no reason to know which of three addresses she used.
  -- ESCAPE IS NOT OPTIONAL. The Worker backslash-escapes % and _ so a name
  -- containing one is searched for literally rather than matching half the
  -- list. Without this clause SQLite does not know what the backslash means
  -- and treats it as an ordinary character — so the escaping stops the
  -- wildcard AND stops the match, and searching "50%" finds nobody at all.
  AND (:q = '' OR s.email LIKE :like ESCAPE '\'
               OR COALESCE(s.name, '') LIKE :like ESCAPE '\')
  -- Tags exist to group people, so they have to be a way of finding them.
  -- EXISTS rather than a join: a join would return one row per matching tag
  -- and quietly duplicate anybody carrying two.
  AND (:tag = '' OR EXISTS (SELECT 1 FROM subscriber_tags st2
                             WHERE st2.subscriber_id = s.id AND st2.tag_id = :tag))
ORDER BY
  CASE WHEN :sort = 'email'  THEN s.email END COLLATE NOCASE ASC,
  CASE WHEN :sort = 'name'   THEN COALESCE(NULLIF(s.name, ''), s.email) END COLLATE NOCASE ASC,
  CASE WHEN :sort = 'oldest' THEN s.subscribed_at END ASC,
  CASE WHEN :sort = 'status' THEN s.status END ASC,
  s.subscribed_at DESC
LIMIT :limit OFFSET :offset;


-- name: subscribers_for_list_count
-- How many the current search matches, so the console can say "showing 1–100
-- of 340" rather than leaving somebody to guess whether there is more. The
-- WHERE clause is a copy of the one above and has to stay one — a count that
-- disagrees with its list is worse than no count.
SELECT COUNT(*) AS n
FROM subscribers s
JOIN mailing_lists l ON l.id = s.list_id
WHERE s.list_id = :list_id AND l.partner_id IS :partner_id
  AND (:status = '' OR s.status = :status)
  AND (:q = '' OR s.email LIKE :like ESCAPE '\'
               OR COALESCE(s.name, '') LIKE :like ESCAPE '\')
  AND (:tag = '' OR EXISTS (SELECT 1 FROM subscriber_tags st2
                             WHERE st2.subscriber_id = s.id AND st2.tag_id = :tag));


-- name: subscriber_set_name
-- A name is not consent, so it can be corrected freely.
UPDATE subscribers SET name = :name, updated_at = :now WHERE id = :id;


-- name: subscriber_change_email
-- CHANGING AN ADDRESS SENDS THE ROW BACK TO 'pending'.
--
-- This is not caution, it is the whole consent model. Without it, editing a
-- confirmed subscriber's address is a way to subscribe ANY address without
-- that person ever agreeing — which is exactly what double opt-in exists to
-- prevent, and it would be doable from a console screen labelled "edit".
--
-- It also happens to be right for the innocent case. Correcting
-- "ann@gmial.com" to "ann@gmail.com" is a guess about a different mailbox, and
-- the new one has never said yes.
UPDATE subscribers
SET email = :email,
    status = 'pending',
    confirm_token = :token,
    confirmed_at = NULL,
    updated_at = :now
WHERE id = :id;


-- name: subscriber_add
-- ADDED BY HAND, AND STILL `pending`.
--
-- The first version made these `subscribed` immediately, reasoning that
-- somebody who asked a staff member in person has already consented and a
-- confirmation email would be ceremony. That missed the second thing a
-- confirmation does: it is the only proof the ADDRESS WORKS. Skipping it means
-- discovering a typo weeks later, when a send bounces and nobody remembers
-- what was typed in. So everybody confirms, however they arrived, and `source`
-- records which way that was.
--
-- The partner check is on the LIST, so this cannot add to somebody else's.
INSERT INTO subscribers
  (id, list_id, partner_id, email, name, status, confirm_token, source,
   subscribed_at, updated_at)
SELECT :id, l.id, l.partner_id, :email, :name, 'pending', :token, :source,
       :now, :now
  FROM mailing_lists l
 WHERE l.id = :list_id AND l.partner_id IS :partner_id;


-- name: public_lists_for_signup
-- EVERY list a partner has opened, for ONE form with a checkbox each.
--
-- The first version served a form per list, which meant a partner running a
-- newsletter and a prayer list pasted two forms onto a page and a visitor
-- typed their address twice. chaseroush.com already had this right: one form,
-- "I want to receive", a box per list.
--
-- `is_open` is the switch a partner controls, so closing a list removes its
-- checkbox from every page the form is on without anybody editing those pages.
--
-- THE EXISTS CLAUSE IS NOT BELT AND BRACES, it is the fix for a real leak.
-- `partner_id IS (SELECT id FROM partners WHERE slug = :partner_slug)` reads as
-- "belonging to this partner", and it is — right up until the slug matches
-- nobody. Then the subquery is NULL, `partner_id IS NULL` is TRUE, and the
-- query returns the ORGANISATION's lists, because NULL partner_id is how the
-- organisation is spelled throughout this schema. So any invented slug served
-- Thauma's own sign-up form, and anybody submitting it joined Thauma's lists.
--
-- The pattern is worth remembering: a NULL-matching comparison and a NULL
-- meaning "the organisation" are safe apart and dangerous together, because a
-- lookup that finds nothing produces the same NULL as a row that means
-- something.
--
-- The colours come along so the form can be drawn in the ministry's accent
-- like every other embed. NOT gated on embed_enabled: that switch governs
-- publishing the ministry's DATA, and a colour is not data — a list's own
-- is_open is what decides whether this form exists at all.
SELECT l.id, l.partner_id, l.name, l.slug, l.description,
       l.from_name, l.from_email, l.reply_to,
       l.form_heading, l.form_blurb, l.form_button, l.form_thanks_url,
       p.embed_accent, p.embed_accent2, p.embed_theme
  FROM mailing_lists l
  JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
 WHERE l.is_open = 1 AND l.archived_at IS NULL
 ORDER BY l.name COLLATE NOCASE;


-- name: signup_attempt_record
INSERT OR REPLACE INTO signup_attempts (ip_hash, list_id, at, outcome)
VALUES (:ip_hash, :list_id, :at, :outcome);


-- name: signup_attempts_recent
-- How many times this machine has tried, across ALL lists rather than one.
-- Somebody hammering a partner's forms would otherwise get a fresh allowance
-- per list simply by rotating between them.
SELECT COUNT(*) AS n FROM signup_attempts
 WHERE ip_hash = :ip_hash AND at > :since;


-- name: signup_attempts_prune
-- Kept for minutes, not for records. This is a log of who visited a page, with
-- no purpose past the rate window, and the cheapest way to not hold personal
-- data is to not hold it.
DELETE FROM signup_attempts WHERE at < :before;


-- name: subscriber_existing_for_signup
-- Whether this address is already known to this list, and in what state. Used
-- to decide what to DO, never to decide what to SAY — the public answer is the
-- same either way.
SELECT id, status FROM subscribers WHERE list_id = :list_id AND email = :email;


-- name: subscriber_resend_token
-- Somebody who signed up, never confirmed, and signed up again. Replacing the
-- token rather than adding a row keeps one pending record per address and
-- makes the newest email the only working one.
UPDATE subscribers
SET confirm_token = :token, subscribed_at = :now, updated_at = :now, name = COALESCE(:name, name)
WHERE list_id = :list_id AND email = :email AND status = 'pending';


-- name: subscriber_reopen_pending
-- Somebody who unsubscribed or bounced, asking again through a form.
--
-- BACK TO `pending`, NEVER STRAIGHT TO `subscribed`. They previously said stop,
-- or their address stopped working, and a form post is not enough to overturn
-- either — anybody who knows the address could send it. The confirmation link
-- is what lets them return, because only they can click it.
UPDATE subscribers
SET status = 'pending',
    confirm_token = :token,
    name = COALESCE(:name, name),
    subscribed_at = :now,
    unsubscribed_at = NULL,
    confirmed_at = NULL,
    updated_at = :now
WHERE list_id = :list_id AND email = :email
  AND status IN ('unsubscribed', 'bounced');


-- name: subscriber_resend_confirm
-- A NEW TOKEN, not the old one resent.
--
-- The first message may have gone to spam, been deleted, or never arrived at
-- all — and the person asking for it again has no way to tell which. Issuing a
-- fresh token means the newest email is always the working one, so somebody
-- who finds both in their inbox cannot pick the wrong link and be told it is
-- invalid. The old one stops working the moment this runs.
--
-- Only for `pending`. Somebody already subscribed has nothing to confirm, and
-- somebody who unsubscribed must not be sent a link back in by staff — that is
-- what the sign-up form is for, at their own request.
UPDATE subscribers
SET confirm_token = :token, subscribed_at = :now, updated_at = :now
WHERE id = :id AND status = 'pending'
  AND list_id IN (SELECT id FROM mailing_lists WHERE partner_id IS :partner_id);


-- name: subscriber_one
SELECT s.id, s.email, s.name, s.status, s.confirm_token, s.list_id,
       l.name AS list_name, l.from_name, l.from_email, l.reply_to
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE s.id = :id AND l.partner_id IS :partner_id;


-- name: subscriber_by_token
-- The confirmation link. NOT partner-scoped, deliberately and uniquely: the
-- person clicking it is a member of the public with no account, and the token
-- is the only thing identifying them. It is 32 random bytes and single-use.
--
-- RETURNS SEVERAL ROWS WHEN SOMEBODY TICKED SEVERAL BOXES. One submission
-- writes one row per list and shares one token across them, so a person who
-- asked for a newsletter and a prayer list gets ONE email rather than two —
-- and confirms both with one click, which is what they thought they were
-- doing when they ticked two boxes.
SELECT s.id, s.email, s.name, s.status, s.list_id,
       l.name AS list_name, l.slug AS list_slug
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE s.confirm_token = :token AND s.status = 'pending'
 ORDER BY l.name COLLATE NOCASE;


-- name: subscriber_confirm
-- Clears the token as it confirms, so the link works once. A confirmation link
-- that stays live is a way to re-subscribe somebody who later unsubscribed,
-- from an email still sitting in their inbox.
UPDATE subscribers
SET status = 'subscribed', confirmed_at = :now, confirm_token = NULL, updated_at = :now
WHERE confirm_token = :token AND status = 'pending';


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
       p.sending_domain,
       (SELECT COUNT(*) FROM partner_users pu WHERE pu.partner_id = p.id) AS member_count,
       (SELECT COUNT(*) FROM sender_addresses sa WHERE sa.partner_id = p.id) AS sender_count
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


-- ============================================================================
-- WHERE MAIL COMES FROM
--
-- Resend verifies DOMAINS, not addresses. Once a domain is verified every
-- address at it sends, including one with a typo in it — which leaves
-- successfully, looks correct in the log, and drops every reply into nothing.
-- So the addresses are a list an administrator maintains, and the person
-- writing a newsletter chooses from it. A chosen address cannot be mistyped.
--
-- ONE DOMAIN PER PARTNER. Sending reputation is tracked per domain, so a
-- partner's junk reports stay with that partner instead of degrading
-- everybody. The organisation's own domain is kept out of bulk entirely: an
-- account invite must never be delayed because somebody else's newsletter was
-- reported.
-- ============================================================================

-- name: admin_partner_set_domain
-- Typed by an administrator, never derived. It has to match a domain somebody
-- actually verified with the mail provider, and only they know which — a
-- domain guessed from the slug would look right and send nothing.
UPDATE partners SET sending_domain = :sending_domain, updated_at = :now
WHERE id = :id;


-- name: sender_addresses_for_partner
-- What this owner may send as. `IS` rather than `=` so NULL matches NULL and
-- the same query serves a partner asking for theirs and an administrator
-- asking for the organisation's.
SELECT id, partner_id, address, label, can_receive, created_at
FROM sender_addresses
WHERE partner_id IS :partner_id
ORDER BY label COLLATE NOCASE, address COLLATE NOCASE;


-- name: admin_sender_addresses
-- Every address in the system, for the Partners screen. Org-wide by design —
-- reading it is an administrative act, the same as admin_partners.
--
-- IT NAMES THE LISTS, not just a count. A count can only produce "2 lists use
-- this, you cannot delete it", which is a wall: it says no without saying what
-- to do about it. Names let the console say what WILL happen and let somebody
-- agree to it — which is the difference between a guard and an obstruction.
--
-- Sending and replying are counted apart because the consequences differ. A
-- list that loses its SENDER cannot send at all. A list that loses its
-- REPLY-TO carries on, with replies falling back to the sender. Treating
-- those the same would archive a list over a setting that has a sane default.
SELECT sa.id, sa.partner_id, sa.address, sa.label, sa.can_receive, sa.created_at,
       p.display_name AS partner_name,
       (SELECT COUNT(*) FROM mailing_lists l
         WHERE l.archived_at IS NULL
           AND (l.from_email = sa.address OR l.reply_to = sa.address)) AS used_by,
       (SELECT GROUP_CONCAT(l.name, ' | ') FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.from_email = sa.address) AS sends_for,
       (SELECT GROUP_CONCAT(l.name, ' | ') FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.reply_to = sa.address) AS replies_for,
       -- What archiving those lists would take out of reach. Named in the
       -- dialog, because "2 lists" and "2 lists and 128 subscribers" are
       -- different decisions.
       (SELECT COALESCE(SUM((SELECT COUNT(*) FROM subscribers s
                              WHERE s.list_id = l.id AND s.status = 'subscribed')), 0)
          FROM mailing_lists l
         WHERE l.archived_at IS NULL AND l.from_email = sa.address) AS sends_subscribers
FROM sender_addresses sa
LEFT JOIN partners p ON p.id = sa.partner_id
ORDER BY p.display_name COLLATE NOCASE, sa.address COLLATE NOCASE;


-- name: admin_sender_address_add
INSERT INTO sender_addresses (id, partner_id, address, label, can_receive, created_at)
VALUES (:id, :partner_id, :address, :label, :can_receive, :now);


-- name: admin_sender_address_delete
-- Refused in admin.js while a live list still sends from it, because removing
-- it would leave that list pointing at an address no longer offered — and the
-- next person to open its settings would find the field empty with no way to
-- know what it held.
DELETE FROM sender_addresses WHERE id = :id;


-- name: admin_sender_readdress
-- Moves ONE address to a new domain, keeping its id. Keeping the id matters:
-- the row is the same address doing the same job at a new domain, and a
-- delete-and-recreate would lose that continuity in the audit log.
UPDATE sender_addresses SET address = :address WHERE id = :id;


-- name: admin_lists_repoint
-- Follows an address when it moves. Both columns in one statement, each
-- guarded by its own CASE, so a list that used the old address for BOTH
-- sending and replies is corrected once rather than in two passes that could
-- half-succeed.
--
-- Archived lists are included ON PURPOSE, unlike everywhere else. An archived
-- list can be brought back, and one restored with a from_email at a domain
-- that no longer exists would look fine and send nothing.
UPDATE mailing_lists
SET from_email = CASE WHEN from_email = :old THEN :new ELSE from_email END,
    reply_to   = CASE WHEN reply_to   = :old THEN :new ELSE reply_to   END,
    updated_at = :now
WHERE from_email = :old OR reply_to = :old;


-- name: admin_lists_drop_reply_to
-- A list whose REPLY-TO address is being deleted keeps working: replies fall
-- back to the sender, which is what an empty reply_to already means. Clearing
-- it is the whole repair, and archiving over it would be destroying a list to
-- fix a setting that has a default.
UPDATE mailing_lists SET reply_to = NULL, updated_at = :now WHERE reply_to = :address;


-- name: admin_lists_archive_by_sender
-- A list whose SENDER is being deleted cannot send at all, so it is archived
-- rather than left looking operational.
--
-- ARCHIVED, NEVER DELETED. Subscribers are the one thing here that cannot be
-- recreated — every one of them is a person who agreed to be written to, and
-- a double opt-in cannot be replayed. Archiving hides the list and stops it
-- sending; the people on it stay, and restoring it is a column away.
UPDATE mailing_lists SET archived_at = :now, updated_at = :now
WHERE from_email = :address AND archived_at IS NULL;

-- ============================================================================
-- THE COMPOSER — writing, sending, and what was sent
--
-- A mailing is scoped by BOTH list_id and partner_id on every read. The list
-- already belongs to one partner, so partner_id is redundant — and it is the
-- redundancy that matters: a bug in how the list id is chosen cannot then
-- reach another ministry's drafts.
-- ============================================================================

-- name: mailings_for_list
-- Drafts first, then what was sent, newest first within each. Somebody opening
-- this screen is usually continuing a draft, not admiring history.
--
-- THE BODY COMES ALONG, BUT ONLY FOR DRAFTS. The composer opens a draft
-- straight from this list, and without it the editor comes up empty on a
-- message somebody has already written — there is no worse bug on this screen.
--
-- A sent mailing's body is deliberately left out. It can never be opened for
-- editing, and a year of newsletters would put every word ever written into a
-- request that needed nothing but their subjects.
--
-- Written as `--` rather than a /* */ block on purpose: only line comments are
-- stripped when these become JavaScript, so a block comment travels to D1 with
-- every call — and a colon inside one reads as a stray bind parameter.
SELECT m.id, m.list_id, m.subject, m.preheader, m.status, m.slug,
       m.sent_count, m.created_at, m.started_at, m.finished_at,
       CASE WHEN m.status = 'draft' THEN m.body_html END AS body_html,
       (SELECT COUNT(*) FROM mailing_recipients r
         WHERE r.mailing_id = m.id AND r.status = 'failed') AS failed
FROM mailings m
WHERE m.list_id = :list_id AND m.partner_id IS :partner_id
ORDER BY CASE m.status WHEN 'draft' THEN 0 ELSE 1 END,
         COALESCE(m.finished_at, m.created_at) DESC;


-- name: mailing_one
SELECT id, list_id, partner_id, subject, preheader, body_md, body_html, body_text,
       status, slug, sent_count, created_at, started_at, finished_at
FROM mailings
WHERE id = :id AND partner_id IS :partner_id;


-- name: mailing_upsert
-- body_md IS THE SOURCE. It is what somebody typed, kept character for
-- character, and reopening a draft reads it back rather than reading back
-- markup a browser happened to generate.
--
-- body_html is DERIVED from it and stored anyway, already sanitised, because
-- it is what the archive renders and what a sent mailing is a record of — and
-- a sent mailing must not change because the converter improved later.
INSERT INTO mailings (id, list_id, partner_id, subject, preheader,
                      body_md, body_html, body_text, status, created_by, created_at)
VALUES (:id, :list_id, :partner_id, :subject, :preheader,
        :body_md, :body_html, :body_text, 'draft', :created_by, :now)
ON CONFLICT(id) DO UPDATE SET
  subject = excluded.subject,
  preheader = excluded.preheader,
  body_md = excluded.body_md,
  body_html = excluded.body_html,
  body_text = excluded.body_text
-- A sent mailing is a RECORD. Editing one would rewrite what people were told
-- they received, and the archive would stop matching the inbox.
WHERE mailings.status = 'draft';


-- name: mailing_delete
-- Drafts only, for the same reason.
DELETE FROM mailings
WHERE id = :id AND partner_id IS :partner_id AND status = 'draft';


-- name: mailing_start
-- The guard against sending twice, and it is a WHERE clause rather than a
-- check in the Worker on purpose: two requests arriving together both pass an
-- if-statement, and only one can win an UPDATE that names the old status.
UPDATE mailings
SET status = 'sending', started_at = :now, slug = :slug
WHERE id = :id AND partner_id IS :partner_id AND status = 'draft';


-- name: mailing_finish
UPDATE mailings
SET status = :status, finished_at = :now, sent_count = :sent_count
WHERE id = :id AND partner_id IS :partner_id;


-- name: mailing_recipient_add
-- The address AS IT IS NOW. A subscriber may change theirs, and the record of
-- where a message actually went must not change with them.
INSERT INTO mailing_recipients (mailing_id, subscriber_id, email, status, updated_at)
VALUES (:mailing_id, :subscriber_id, :email, :status, :now)
ON CONFLICT(mailing_id, subscriber_id) DO UPDATE SET
  status = excluded.status, updated_at = excluded.updated_at;


-- name: mailing_recipient_result
UPDATE mailing_recipients
SET status = :status, provider_id = :provider_id, error = :error, updated_at = :now
WHERE mailing_id = :mailing_id AND subscriber_id = :subscriber_id;


-- name: subscribers_to_send
-- ONLY 'subscribed'. Not pending — they have not agreed yet, and sending to
-- them is the exact thing double opt-in exists to prevent. Not bounced, whose
-- address is already refusing mail, and not unsubscribed, which needs no
-- explanation.
SELECT s.id, s.email, s.name
FROM subscribers s
WHERE s.list_id = :list_id AND s.partner_id IS :partner_id
  AND s.status = 'subscribed'
ORDER BY s.subscribed_at
LIMIT :limit OFFSET :offset;


-- name: subscribers_to_send_count
SELECT COUNT(*) AS n FROM subscribers
WHERE list_id = :list_id AND partner_id IS :partner_id AND status = 'subscribed';


-- name: subscriber_by_id_public
-- For the unsubscribe link, which arrives with no session. The token is
-- verified in the Worker before this runs — it is an HMAC of the id, so the id
-- alone is not enough to reach anybody.
SELECT id, list_id, partner_id, email, status FROM subscribers WHERE id = :id;


-- name: subscriber_unsubscribe_by_id
UPDATE subscribers
SET status = 'unsubscribed', unsubscribed_at = :now, updated_at = :now
WHERE id = :id;


-- ---- the public archive ----------------------------------------------------
-- archive_public lives on the LIST, not on each mailing: newsletters are
-- public and prayer updates are not, and that is a property of the list rather
-- than a decision to remake every time somebody writes. Per-mailing would mean
-- one forgetful moment publishes a prayer request naming somebody.

-- name: public_archive_for_list
SELECT m.slug, m.subject, m.preheader, m.finished_at
FROM mailings m
JOIN mailing_lists l ON l.id = m.list_id
JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
WHERE l.slug = :list_slug AND l.archive_public = 1 AND l.archived_at IS NULL
  AND m.status = 'sent' AND m.slug IS NOT NULL
ORDER BY m.finished_at DESC
LIMIT 50;


-- name: public_archive_one
SELECT m.subject, m.preheader, m.body_html, m.finished_at,
       l.name AS list_name, l.from_name,
       p.display_name, p.embed_accent, p.embed_theme
FROM mailings m
JOIN mailing_lists l ON l.id = m.list_id
JOIN partners p ON p.slug = :partner_slug AND l.partner_id IS p.id
WHERE l.slug = :list_slug AND l.archive_public = 1 AND l.archived_at IS NULL
  AND m.status = 'sent' AND m.slug = :slug;

-- name: mailing_attachments_for
SELECT id, filename, content_type, bytes, object_key, sort_order
FROM mailing_attachments
WHERE mailing_id = :mailing_id
ORDER BY sort_order, filename COLLATE NOCASE;


-- name: mailing_attachment_add
INSERT INTO mailing_attachments
  (id, mailing_id, filename, content_type, bytes, object_key, sort_order, created_at)
VALUES (:id, :mailing_id, :filename, :content_type, :bytes, :object_key, :sort_order, :now);


-- name: mailing_attachment_clear
-- The console sends the whole list on every save, so the set is replaced
-- rather than diffed. Cheap at this size, and it makes removing one a matter
-- of not sending it — which is exactly what the delete button does.
DELETE FROM mailing_attachments WHERE mailing_id = :mailing_id;

-- ============================================================================
-- CONTACT FORMS
--
-- One per partner, and one for the organisation with partner_id NULL. The
-- messages themselves are emailed and stored nowhere — see 0021 for why — so
-- everything here is configuration.
-- ============================================================================

-- name: contact_form_for_partner
-- `IS` rather than `=`, so NULL matches NULL and one query serves a partner
-- asking for theirs and an administrator asking for Thauma's.
SELECT partner_id, deliver_to, from_address, heading, blurb, button, thanks,
       is_open, updated_at
FROM contact_forms
WHERE partner_id IS :partner_id;


-- name: contact_form_save
INSERT INTO contact_forms
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
  updated_at   = excluded.updated_at;


-- name: public_contact_form
-- Resolve a slug to a partner's form, for the UNAUTHENTICATED endpoint.
--
-- THE JOIN IS THE SCOPE CHECK, and it is written this way for a reason that
-- cost a real leak once. `partner_id IS (SELECT id FROM partners WHERE slug =
-- :slug)` reads as "belonging to this partner" — until the slug matches
-- nobody, when the subquery is NULL, `partner_id IS NULL` is TRUE, and the
-- query hands back the ORGANISATION's row. The sign-up form had exactly that
-- bug: any invented slug served Thauma's own form.
--
-- `is_open` is the switch, so closing the form takes it off every page it is
-- embedded on without anybody editing those pages.
SELECT c.deliver_to, c.from_address, c.heading, c.blurb, c.button, c.thanks,
       p.display_name, p.embed_accent, p.embed_accent2, p.embed_theme
FROM contact_forms c
JOIN partners p ON p.slug = :partner_slug AND c.partner_id IS p.id
WHERE c.is_open = 1;


-- name: public_contact_form_org
-- Thauma's own, for the site's contact page. A separate query rather than the
-- one above with a NULL parameter: the organisation has no slug to join on,
-- and inventing one would be the same trap in a new place.
SELECT deliver_to, from_address, heading, blurb, button, thanks
FROM contact_forms
WHERE partner_id IS NULL AND is_open = 1;

-- name: contact_topics_for_partner
SELECT id, label, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS :partner_id
ORDER BY sort_order, label COLLATE NOCASE;


-- name: contact_topics_clear
-- The console sends the whole dropdown on every save, so the set is replaced
-- rather than diffed. Removing an option is a matter of not sending it, which
-- is exactly what the delete button does — and there is no second code path
-- that could disagree with the first about ordering.
DELETE FROM contact_topics WHERE partner_id IS :partner_id;


-- name: contact_topic_add
INSERT INTO contact_topics (id, partner_id, label, deliver_to, sort_order, created_at)
VALUES (:id, :partner_id, :label, :deliver_to, :sort_order, :now);


-- name: public_contact_topics
-- The dropdown, for the UNAUTHENTICATED endpoint. Joined through partners the
-- same way public_contact_form is, and for the same reason: a NULL-matching
-- comparison against a slug nobody has would hand back the ORGANISATION's
-- topics. See public_contact_form for the leak that taught this.
SELECT t.id, t.label, t.deliver_to, t.sort_order
FROM contact_topics t
JOIN partners p ON p.slug = :partner_slug AND t.partner_id IS p.id
ORDER BY t.sort_order, t.label COLLATE NOCASE;


-- name: public_contact_topics_org
-- Thauma's own. A separate query because the organisation has no slug to join
-- on, and inventing one would be the same trap in a new place.
SELECT id, label, deliver_to, sort_order
FROM contact_topics
WHERE partner_id IS NULL
ORDER BY sort_order, label COLLATE NOCASE;

-- name: subscriber_tags_for
-- Which tags one person carries. Scoped through the LIST, so knowing a
-- subscriber id is not enough to read somebody else's.
SELECT t.id, t.name
FROM subscriber_tags st
JOIN mailing_tags t ON t.id = st.tag_id
JOIN subscribers s ON s.id = st.subscriber_id
JOIN mailing_lists l ON l.id = s.list_id
WHERE st.subscriber_id = :subscriber_id AND l.partner_id IS :partner_id
ORDER BY t.sort_order, t.name COLLATE NOCASE;


-- name: subscriber_tags_clear
DELETE FROM subscriber_tags WHERE subscriber_id = :subscriber_id;


-- name: subscriber_tag_add
-- The tag must belong to the same partner as the subscriber. Written as a
-- SELECT rather than a VALUES so the check cannot be skipped by a caller that
-- forgets it: a tag id from another ministry simply inserts nothing.
INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id)
SELECT :subscriber_id, t.id
  FROM mailing_tags t
  JOIN subscribers s ON s.id = :subscriber_id
  JOIN mailing_lists l ON l.id = s.list_id
 WHERE t.id = :tag_id
   AND t.partner_id IS l.partner_id;


-- name: mailing_tag_usage
-- How many people carry each tag, so deleting one can say what it will take
-- off rather than asking for confidence in the abstract.
SELECT t.id, COUNT(st.subscriber_id) AS n
FROM mailing_tags t
LEFT JOIN subscriber_tags st ON st.tag_id = t.id
WHERE t.partner_id IS :partner_id
GROUP BY t.id;

-- ============================================================================
-- ACTING ON MANY PEOPLE AT ONCE
--
-- Every one of these takes an explicit list of ids AND the partner, and joins
-- through mailing_lists to check it. An id arriving from a browser is a claim,
-- not a credential — and a bulk endpoint is exactly where one borrowed id
-- would do the most damage.
--
-- The id list is spliced as a placeholder run built by the Worker, because a
-- bound parameter cannot be a list in SQLite. The Worker generates the ?s from
-- the COUNT of ids and binds every value, so nothing from the request is ever
-- concatenated into the SQL itself.
-- ============================================================================

-- name: subscribers_bulk_status
-- Only statuses that REDUCE what may be sent. 'subscribed' is deliberately not
-- reachable here: marking somebody confirmed is a claim that they agreed, and
-- a claim like that made two hundred at a time is how a list stops being one
-- people opted into. One at a time, deliberately, or not at all.
UPDATE subscribers
SET status = :status,
    unsubscribed_at = CASE WHEN :status = 'unsubscribed' THEN :now ELSE unsubscribed_at END,
    updated_at = :now
WHERE id IN (SELECT s.id FROM subscribers s
               JOIN mailing_lists l ON l.id = s.list_id
              WHERE l.partner_id IS :partner_id AND s.id IN (IDS));


-- name: subscribers_bulk_tag_add
INSERT OR IGNORE INTO subscriber_tags (subscriber_id, tag_id)
SELECT s.id, t.id
  FROM subscribers s
  JOIN mailing_lists l ON l.id = s.list_id
  JOIN mailing_tags t ON t.id = :tag_id AND t.partner_id IS l.partner_id
 WHERE l.partner_id IS :partner_id AND s.id IN (IDS);


-- name: subscribers_bulk_tag_remove
DELETE FROM subscriber_tags
WHERE tag_id = :tag_id
  AND subscriber_id IN (SELECT s.id FROM subscribers s
                          JOIN mailing_lists l ON l.id = s.list_id
                         WHERE l.partner_id IS :partner_id AND s.id IN (IDS));


-- name: subscribers_bulk_delete
-- Removes the row entirely. Different from unsubscribing: unsubscribing is a
-- record that somebody asked to stop, which is worth keeping. Deleting is for
-- data that should never have been held.
DELETE FROM subscribers
WHERE id IN (SELECT s.id FROM subscribers s
               JOIN mailing_lists l ON l.id = s.list_id
              WHERE l.partner_id IS :partner_id AND s.id IN (IDS));


-- ===========================================================================
-- VIDEOS — a channel's latest, cached from its public Atom feed
--
-- The only tables here whose every column is already public. That is what
-- lets public_videos_for_partner sit in PUBLIC_QUERIES; it is not a licence
-- to join anything else to them.
-- ===========================================================================

-- name: video_source_get
SELECT partner_id, source_id, source_kind, source_title, is_public, max_items,
       synced_at, sync_error, updated_at
  FROM video_sources
 WHERE partner_id IS :partner_id;


-- name: video_source_save
INSERT INTO video_sources
  (partner_id, source_id, source_kind, source_title, is_public, max_items, updated_at)
VALUES
  (:partner_id, :source_id, :source_kind, :source_title, :is_public, :max_items, :now)
ON CONFLICT(partner_id) DO UPDATE SET
  source_id    = excluded.source_id,
  source_kind  = excluded.source_kind,
  source_title = excluded.source_title,
  is_public    = excluded.is_public,
  max_items    = excluded.max_items,
  -- Pointing at a DIFFERENT source invalidates what was synced from the old
  -- one. Clearing these makes the console say "never checked" rather than
  -- showing a timestamp that belongs to somebody else's videos.
  synced_at    = CASE WHEN video_sources.source_id = excluded.source_id
                      THEN video_sources.synced_at ELSE NULL END,
  sync_error   = CASE WHEN video_sources.source_id = excluded.source_id
                      THEN video_sources.sync_error ELSE NULL END,
  updated_at   = excluded.updated_at;


-- name: video_source_clear
DELETE FROM video_sources WHERE partner_id IS :partner_id;


-- name: video_source_synced
UPDATE video_sources
   SET synced_at = :now, sync_error = NULL
 WHERE partner_id IS :partner_id;


-- name: video_source_failed
-- Keeps the videos already stored. A feed that fails to load is a reason to
-- show yesterday's videos with a warning in the console, not a reason for a
-- partner site to lose its video shelf.
UPDATE video_sources
   SET synced_at = :now, sync_error = :error
 WHERE partner_id IS :partner_id;


-- name: video_sources_all
-- Every source worth syncing, for the scheduled run. Unconfigured and
-- switched-off sources are skipped: syncing something nobody displays is an
-- outbound request per quarter hour in exchange for nothing.
SELECT partner_id, source_id, source_kind
  FROM video_sources
 WHERE is_public = 1 AND source_id <> ''
 ORDER BY partner_id;


-- name: videos_for_source
SELECT video_id, title, published_at
  FROM videos
 WHERE source_id = :source_id
 ORDER BY published_at DESC
 LIMIT :limit;


-- name: video_upsert
INSERT INTO videos (source_id, video_id, title, published_at, fetched_at)
VALUES (:source_id, :video_id, :title, :published_at, :now)
ON CONFLICT(source_id, video_id) DO UPDATE SET
  -- A title can be edited after publishing, and the published date corrected.
  title        = excluded.title,
  published_at = excluded.published_at,
  fetched_at   = excluded.fetched_at;


-- name: videos_prune
-- Anything not seen in the run that just finished. A video deleted, made
-- private, or REMOVED FROM THE PLAYLIST must stop being shown here, and this
-- is what notices — the upsert above can only ever add.
DELETE FROM videos WHERE source_id = :source_id AND fetched_at < :now;


-- name: public_videos_for_partner
-- The partner API's read. Scoped through video_sources so it returns rows
-- only for a source that partner configured AND switched on — the videos
-- table itself has no partner column and must never be read without this
-- join standing in for one.
SELECT v.video_id, v.title, v.published_at
  FROM videos v
  JOIN video_sources c ON c.source_id = v.source_id
 WHERE c.partner_id IS :partner_id AND c.is_public = 1
 ORDER BY v.published_at DESC
 -- COALESCE, and it is load-bearing. A partner with no source row makes the
 -- subquery NULL, and SQLite rejects `LIMIT NULL` with "datatype mismatch" —
 -- which would throw inside partnerPublicSite and take down the WHOLE partner
 -- API response, videos or not, for every partner who never set one. That is
 -- most of them. Found by running this against the real database rather than
 -- reading it.
 LIMIT COALESCE(
   (SELECT max_items FROM video_sources WHERE partner_id IS :partner_id), 0);


-- name: video_links_for_partner
SELECT id, label, url, sort_order
  FROM video_links
 WHERE partner_id IS :partner_id
 ORDER BY sort_order, label COLLATE NOCASE;


-- name: video_links_clear
-- The console sends the whole rail on every save, so the set is replaced
-- rather than diffed. Removing a button is a matter of not sending it, which
-- is exactly what the delete control does — and there is no second code path
-- that can disagree about what "removed" means.
DELETE FROM video_links WHERE partner_id IS :partner_id;


-- name: video_link_add
INSERT INTO video_links (id, partner_id, label, url, sort_order, created_at)
VALUES (:id, :partner_id, :label, :url, :sort_order, :now);


-- name: public_video_links_for_partner
-- The buttons under the shelf, for the partner API and the embed. Gated on
-- the CHANNEL's publication switch, not on their own: these belong to the
-- video section, and a partner who has switched videos off has switched the
-- whole section off. Without the join they would keep appearing under
-- nothing.
SELECT l.label, l.url
  FROM video_links l
  JOIN video_sources c ON c.partner_id IS l.partner_id
 WHERE l.partner_id IS :partner_id AND c.is_public = 1
 ORDER BY l.sort_order, l.label COLLATE NOCASE;


-- ===========================================================================
-- ACCOUNT CONFIRMATION — an invited person proving they hold the address
-- ===========================================================================

-- name: user_for_confirm
-- By id, because that is what the signed link carries. No status filter: the
-- page needs to tell somebody WHY nothing happened, and "already confirmed"
-- and "no such account" are different sentences.
SELECT id, email, name, status FROM users WHERE id = :id;


-- name: user_confirm
-- INVITED ONLY, and that is the whole guard. A suspended account must not be
-- reactivated by an old invitation somebody still has in their inbox — the
-- administrator who suspended them did so deliberately, and a link cannot
-- overrule that. Re-running it on an already-active account changes nothing,
-- which is what makes the link safe to click twice.
UPDATE users
   SET status = 'active'
 WHERE id = :id AND status = 'invited';


-- name: user_email_taken
-- Somebody ELSE already using this address. users.email is UNIQUE COLLATE
-- NOCASE, so the database would refuse anyway — this exists to say so in a
-- sentence, before an email is sent to an address that can never be adopted.
SELECT id FROM users WHERE email = :email AND id <> :id;


-- name: user_set_email
-- The person's own address, changed after they proved they can read the new
-- one. Not restricted by status: an invited account correcting a typo in its
-- own address is exactly when this matters most.
UPDATE users SET email = :email WHERE id = :id;
