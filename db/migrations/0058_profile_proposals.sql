-- 0058_profile_proposals.sql — a person's own changes to their bio, waiting
--
-- Chase, 2026-10-13: "How about they can edit, but it has to be approved by
-- an Admin before it goes live. Just make sure that there is something that
-- shows the edits that were made."
--
-- A person edits their own team-page words (title and bio in each language,
-- and their region) from Settings › Your bio. What they send is kept here,
-- one waiting set per person — sending again replaces it. An administrator
-- sees every change on that person's Team page, word by word, and Approve
-- saves it through the ordinary profile save (so it still reaches the site
-- with the next Publish); Decline drops it. Either way the row goes.
--
-- Additive: the code reads it in statements that tolerate its absence, so a
-- deploy ahead of this migration simply has nothing waiting.

CREATE TABLE IF NOT EXISTS staff_profile_proposals (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload       TEXT NOT NULL,              -- JSON: { region, text: { <lang>: { role_title, bio } } }
  submitted_at  TEXT NOT NULL
);
