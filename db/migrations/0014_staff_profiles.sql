-- 0014_staff_profiles.sql — the public half of a person
--
-- WHY THIS IS NOT COLUMNS ON `users`
-- ============================================================================
-- The People page holds EVERYONE: staff, board members, and people who hold a
-- partner role that has nothing to do with Thauma. Most of them never appear
-- on a public page, and `is_public` here is what decides — a board member has
-- an account, a role and no profile, which is the normal case and not an
-- exception to code around.
--
-- A separate table says that plainly: a row exists only for somebody who has
-- been given a public profile, so "has no profile" is the absence of a row
-- rather than eleven NULL columns on every account.
--
-- WHERE THE TRUTH LIVES
-- ============================================================================
-- These tables are the source of truth for EDITING — the console reads and
-- sorts from here, which is what makes "sort by region" a query rather than a
-- fetch of every markdown file in the repository.
--
-- They are NOT what the public site builds from. Saving a profile also writes
-- src/content/team/<slug>.md through the same GitHub path the content editor
-- uses, so the build stays hermetic, `git log` still shows who changed a bio,
-- and — the part that matters — a saved profile does NOT appear on the live
-- site until somebody presses Publish. Putting the public site on a live read
-- of this table would have quietly removed that gate.
--
-- The file exists if and only if is_public is 1. Switching the toggle off
-- deletes the file; the row, and the work in it, stays here.

CREATE TABLE staff_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Shown on the staff pages. Off until somebody decides otherwise, like every
  -- other publication flag in this schema.
  is_public    INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),

  -- The /team/<slug>/ address, and the markdown filename. Kept even while
  -- unpublished so that turning the toggle on twice does not produce two
  -- different URLs for one person.
  slug         TEXT NOT NULL UNIQUE,

  -- "Kansas City, USA → Croatia". One free-text field rather than from/to
  -- columns: some people are simply somewhere, and an arrow is punctuation
  -- rather than data.
  region       TEXT,

  -- SEPARATE FROM users.email ON PURPOSE. The sign-in address is an identity
  -- and may be a personal one; this is what gets printed on a public page for
  -- strangers to write to. Nobody should have to publish the address they log
  -- in with to appear on the team page.
  public_email TEXT,

  -- R2 object keys, not URLs. Where the bucket is served from is deployment
  -- configuration and has changed once already; the key is the durable part.
  photo        TEXT,
  bio_photo    TEXT,

  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE INDEX idx_staff_profiles_public ON staff_profiles (is_public, sort_order);


-- The same shape as milestone_translations and prayer_translations, so the
-- editor's two-language-column pattern works here without inventing a third
-- way to hold the same idea.
CREATE TABLE staff_profile_translations (
  user_id    TEXT NOT NULL REFERENCES staff_profiles(user_id) ON DELETE CASCADE,
  lang       TEXT NOT NULL REFERENCES languages(code),

  -- "Founder", "Production Director". A title, not a permission — the role
  -- switches on the People row are the ones that grant anything.
  role_title TEXT,
  bio        TEXT,

  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lang)
);

CREATE INDEX idx_staff_ptx_lang ON staff_profile_translations (lang);
